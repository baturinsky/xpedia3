/**
 * Runs the checks in `test/checks`, after building the modules they import.
 *
 * Each check is its own Node process: the checks are small programs with their
 * own globals and their own pack loading, and one crashing must not take the
 * rest of the run with it. A check that finds no pack to work on says so and
 * exits 0, so the same command works in a checkout that has no modpack examples.
 *
 * Usage: `npm test` runs everything; `npm test -- legs` runs the checks whose
 * name contains "legs".
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, root } from "./build.mjs";

let checksDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "checks");
let filters = process.argv.slice(2);

let checks = readdirSync(checksDir)
  .filter(name => name.endsWith(".mjs"))
  .sort()
  .filter(name => !filters.length || filters.some(f => name.includes(f)));

if (!checks.length) {
  console.error(`no check matches ${filters.join(", ")}`);
  process.exit(1);
}

await build();

let failed = [];
let started = Date.now();

for (let name of checks) {
  console.log(`\n=== ${name}`);
  let result = spawnSync(process.execPath, [path.join(checksDir, name)], {
    cwd: root,
    // The check's own helpers would otherwise rebuild what has just been built
    env: { ...process.env, XPEDIA_TEST_BUILT: "1" },
    stdio: "inherit",
  });
  if (result.status !== 0)
    failed.push(name);
}

let seconds = ((Date.now() - started) / 1000).toFixed(1);
if (failed.length) {
  console.error(`\n${failed.length} of ${checks.length} check(s) failed in ${seconds}s:`);
  for (let name of failed)
    console.error(`  ${name}`);
  process.exit(1);
}

console.log(`\nall ${checks.length} checks passed in ${seconds}s`);
