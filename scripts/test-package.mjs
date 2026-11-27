import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

// Fails when the npm tarball lacks a file agents and consumers rely on, ships a file
// that must stay out, or when llms.txt or README.md links something the tarball does
// not hold. Dist files are not checked here: lint runs before a build, and
// check-package-contents.sh covers them after one.

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
