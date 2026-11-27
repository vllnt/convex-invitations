import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

// Fails when the npm tarball lacks a file agents and consumers rely on, ships a file
// that must stay out, or when llms.txt points at something the tarball does not hold.
// Dist files are not checked here: lint runs before a build, and check-package-contents.sh
// covers them after one.

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
const TEST_FILE = /\.(test|spec)\.[^/]+$/;
const DOCS_DIRECTORY = "node_modules/@vllnt/convex-invitations/docs/";
const ECOSYSTEM_LINK = "](https://oss.vllnt.com/llms.txt)";

const read = (path) => readFileSync(path, "utf8");
const pkg = JSON.parse(read("package.json"));

const [{ files: entries }] = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
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

const llms = packed.has("llms.txt") ? read("llms.txt") : "";
for (const [, target] of llms.matchAll(/\]\(([^)]+)\)/g)) {
  if (target.startsWith("#")) continue;
  if (/^https?:/.test(target)) {
    // A GitHub main URL for a shipped file points at the wrong version.
    const blob = `${pkg.repository.url}/blob/`;
    if (
      target.startsWith(blob) &&
      packed.has(
        target
          .slice(blob.length)
          .replace(/^[^/]+\//, "")
          .split("#")[0],
      )
    ) {
      failures.push(
        `llms.txt links a shipped file by GitHub URL, use a relative link: ${target}`,
      );
    }
    continue;
  }
  const path = posix.normalize(target.split("#")[0]);
  if (!packed.has(path))
    failures.push(
      `llms.txt links a file that is not in the tarball: ${target}`,
    );
}
if (!llms.includes(ECOSYSTEM_LINK))
  failures.push(
    "llms.txt has no Ecosystem link to https://oss.vllnt.com/llms.txt",
  );
for (const path of ["llms.txt", "README.md"]) {
  if (packed.has(path) && !read(path).includes(DOCS_DIRECTORY)) {
    failures.push(
      `${path} does not say where the bundled docs live: ${DOCS_DIRECTORY}`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `FAIL package contents (${failures.length}):\n${failures.map((failure) => `  - ${failure}`).join("\n")}`,
  );
  process.exit(1);
}
console.log(
  `OK    package contents: ${packed.size} files, required files present, llms.txt links resolve inside the tarball`,
);
