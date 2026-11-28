import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

import {
  checkDocumentation,
  convexHost,
  writeHost,
} from "./check-documentation.mjs";

// Fails when the npm tarball lacks a file agents and consumers rely on, ships a file
// that must stay out, or when llms.txt or README.md links something the tarball does
// not hold. Then it builds, packs and installs the package in a temporary consumer,
// runs the docs contract (check-documentation.mjs) on what was installed, type-checks
// every README `ts` example in a stub Convex host, and runs the README test example
// under Vitest. check-package-contents.sh covers the dist file list after a build.

const REQUIRED = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "llms.txt",
  "docs/API.md",
];
// Anything else must live under these directories.
const SHIPPED_DIRECTORY = /^(dist|src)\//;
const TEST_FILE = /\.(test|spec)\.[^/]+$|(^|\/)__tests__\//;
const DOCS_DIRECTORY = "node_modules/@vllnt/convex-invitations/docs/";
const ECOSYSTEM_LINK = "](https://oss.vllnt.com/llms.txt)";
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const read = (path) => readFileSync(path, "utf8");
const pkg = JSON.parse(read("package.json"));
const repository = pkg.repository.url
  .replace(/^git\+/, "")
  .replace(/\.git$/, "");
const repositoryPattern = repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const githubFile = new RegExp(
  `^${repositoryPattern}/(?:blob|tree)/[^/]+/([^?#]+)`,
);

const [{ files: entries }] = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
);
const packed = new Set(entries.map((entry) => entry.path));
const failures = [];

for (const path of REQUIRED) {
  if (!packed.has(path)) failures.push(`missing from the tarball: ${path}`);
}
// Every export that points at source must ship, or the import breaks for consumers.
for (const target of JSON.stringify(pkg.exports).match(/\.\/src\/[^"]+/g) ??
  []) {
  if (!packed.has(target.slice(2)))
    failures.push(`export target missing from the tarball: ${target}`);
}
for (const path of packed) {
  if (TEST_FILE.test(path))
    failures.push(`test or spec file in the tarball: ${path}`);
  else if (!REQUIRED.includes(path) && !SHIPPED_DIRECTORY.test(path)) {
    failures.push(`file must not ship: ${path}`);
  }
}

// Only inline [text](target) links are checked; neither file uses reference links.
// Both files ship and are read from node_modules, so a relative link must resolve
// inside the tarball and a shipped file must not be linked on GitHub (wrong version).
for (const document of ["llms.txt", "README.md"]) {
  if (!packed.has(document)) continue;
  const text = read(document);
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (target.startsWith("#")) continue;
    if (SCHEME.test(target)) {
      const file = githubFile.exec(target)?.[1];
      if (document === "llms.txt" && file !== undefined && packed.has(file)) {
        failures.push(
          `llms.txt links a shipped file by GitHub URL, use a relative link: ${target}`,
        );
      }
      continue;
    }
    if (document === "llms.txt" && !target.startsWith("./")) {
      failures.push(`llms.txt relative links must start with ./: ${target}`);
    }
    if (!packed.has(posix.normalize(target.split(/[?#]/)[0]))) {
      failures.push(
        `${document} links a file that is not in the tarball: ${target}`,
      );
    }
  }
  if (!text.includes(DOCS_DIRECTORY)) {
    failures.push(
      `${document} does not say where the bundled docs live: ${DOCS_DIRECTORY}`,
    );
  }
}
if (packed.has("llms.txt") && !read("llms.txt").includes(ECOSYSTEM_LINK))
  failures.push(
    "llms.txt has no Ecosystem link to https://oss.vllnt.com/llms.txt",
  );

if (failures.length > 0) {
  console.error(
    `FAIL package contents (${failures.length}):\n${failures.map((failure) => `  - ${failure}`).join("\n")}`,
  );
  process.exit(1);
}
console.log(
  `OK    package contents: ${packed.size} files, required files present, llms.txt and README.md links resolve inside the tarball`,
);

const root = process.cwd();
const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`;
const temporary = mkdtempSync(join(tmpdir(), "invitations-consumer-"));
const run = (command, arguments_, cwd = temporary) =>
  execFileSync(command, arguments_, { cwd, stdio: "inherit" });
const typecheck = (moduleKind, types, files) =>
  run("pnpm", [
    "exec",
    "tsc",
    "--noEmit",
    "--strict",
    "--module",
    moduleKind,
    "--moduleResolution",
    moduleKind === "NodeNext" ? "NodeNext" : "Bundler",
    "--target",
    "ES2022",
    "--types",
    types,
    ...files,
  ]);
try {
  // Lint runs before a build in CI, so build here: the tarball needs dist/.
  run("pnpm", ["build"], root);
  run("pnpm", ["pack", "--pack-destination", temporary], root);
  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({
      pnpm: { ignoredBuiltDependencies: ["esbuild"] },
      private: true,
      type: "module",
    }),
  );
  // pnpm 11 reads the build-script policy from the workspace file, pnpm 10 from package.json.
  writeFileSync(
    join(temporary, "pnpm-workspace.yaml"),
    "allowBuilds:\n  esbuild: false\n",
  );
  // The lowest supported convex (the peer range floor) and the test helper's peers.
  run("pnpm", [
    "add",
    join(temporary, tarball),
    "convex@1.45.0",
    "typescript@5.9.3",
    "convex-test@0.0.56",
    "vite@8.2.2",
    "@types/node@22.20.2",
    "vitest@5.1.1",
    "@edge-runtime/vm@5.0.0",
  ]);
  // Docs contract on the installed package, then README examples in a stub host.
  const installed = join(temporary, "node_modules", pkg.name);
  const examples = checkDocumentation(installed, temporary);
  const hostFiles = writeHost(
    temporary,
    convexHost(installed, examples),
    examples,
  );
  typecheck("ESNext", "vite/client,node", hostFiles);
  // The README's own vitest.config.mts runs its test example.
  run("pnpm", ["exec", "vitest", "run"]);
  writeFileSync(
    join(temporary, "consumer.ts"),
    `
import { Invitations } from "${pkg.name}";
import type { ComponentApi } from "${pkg.name}/_generated/component.js";
import config from "${pkg.name}/convex.config.js";
import { defineApp } from "convex/server";
declare const component: ComponentApi;
const client = new Invitations(component);
const app = defineApp(); app.use(config);
void client; void app;
`,
  );
  typecheck("NodeNext", "node", ["consumer.ts"]);
  writeFileSync(
    join(temporary, "registration.ts"),
    `
import { register } from "${pkg.name}/test";
import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
const host = defineSchema({ unrelated: defineTable({ label: v.string() }) });
register(convexTest(host, {}), "custom");
`,
  );
  typecheck("ESNext", "vite/client,node", ["registration.ts"]);
  // The shipped test helper is TypeScript source: it must also compile for NodeNext consumers.
  typecheck("NodeNext", "node", ["registration.ts"]);
  run("node", [
    "--input-type=module",
    "-e",
    `import { Invitations } from "${pkg.name}"; import config from "${pkg.name}/convex.config.js"; if (!Invitations || !config) throw Error("missing export");`,
  ]);
  console.log(
    "OK    docs contract, README examples and consumer imports pass on the installed tarball",
  );
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
