/**
 * Exports the two reference packs to the published site repository and publishes it.
 *
 * Usage: node scripts/export-gitlab.mjs <commit name>
 *
 * The site repo holds the exports as loose files: the page, the language scripts
 * beside it and every image the pedia can show, laid out the way the game expects.
 * Those are build products, not sources, so each run rewrites them in place and
 * commits whatever changed.
 *
 * Nothing here touches the disk itself. Clearing a folder, deciding what a stale
 * file is and writing the page are all the CLI's job, and `xpedia-cli` is the only
 * thing this script runs against the filesystem. That keeps one implementation of
 * "what an export is" — the flags below are the whole of this script's opinion
 * about it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "cli", "xpedia-cli.mjs");
const site = "C:\\1\\xpedia-gitlab";

/**
 * The packs this publishes, and where each goes in the site.
 *
 * `xpiratez` and `xcf` are the folder names the site links use, so they are fixed
 * here rather than derived from the pack file's name: renaming an archive must
 * not move the page that readers have bookmarked.
 */
const packs = [
  {
    source: path.join(root, "misc", "modpackExamples", "Dioxine_XPiratez_o2.1.rar"),
    target: path.join(site, "public", "xpiratez"),
  },
  {
    source: path.join(root, "misc", "modpackExamples", "openxcom_xfiles_42.zip"),
    target: path.join(site, "public", "xcf"),
  },
];

/**
 * The flags every export uses, so the two pages cannot be built differently.
 *
 * `--force` because there is no terminal to answer the CLI's confirmation prompt
 * in: an export into last run's folder always has files to overwrite, and asking
 * is exactly what `--force` exists to skip.
 *
 * The manifest is left on, which is what lets the export prune files a pack no
 * longer makes: it is the record of what the last run wrote, and without it the
 * CLI cannot tell its own leftovers from a file that was always there. The site
 * repo ignores it with a `.gitignore`, so it stays a local note about a local
 * run rather than a committed file that says nothing about the pedia.
 */
const exportFlags = ["--split", "--assets", "--force"];

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

/**
 * Runs a command with its output going straight to the terminal, and returns its
 * exit code.
 *
 * Output is inherited rather than captured, and that is not a preference. A site
 * with two exported packs has a change set in the tens of thousands of paths:
 * `git status --porcelain` alone is megabytes, which is more than `spawnSync`
 * holds in a capture buffer, and asking for it anyway aborts the run with
 * `ENOBUFS` *after* the export has already been written. An exit code is the
 * whole answer any of these commands has to give, and a stream cannot fill up.
 *
 * `tolerate` is for the ones where a non-zero code is an answer rather than an
 * error — `git diff --quiet` uses 1 to mean "there are changes".
 */
function run(command, args, { cwd, tolerate = false } = {}) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) fail(`Can't run ${command}: ${result.error.message}`);
  if (result.status != 0 && !tolerate)
    fail(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  return result.status;
}

// The commit name is everything after the script's own path, so a name with
// spaces works whether the shell passed it as one argument or as several
const commitName = process.argv.slice(2).join(" ").trim();
if (!commitName) fail('A commit name is required: node scripts/export-gitlab.mjs "<commit name>"');

// Checked before anything is written, so a missing archive is not discovered
// after the first pack has already been replaced
if (!fs.existsSync(cli)) fail(`${cli} is missing. Build it first with \`npm run cli\`.`);

if (!fs.existsSync(path.join(site, ".git"))) fail(`${site} is not a git checkout.`);

for (const pack of packs) if (!fs.existsSync(pack.source)) fail(`${pack.source} is missing.`);

console.log(`Publishing to ${path.join(site, "public")}`);
console.log(`Commit name: ${commitName}`);

for (const pack of packs) {
  const name = path.basename(pack.target);
  console.log(`\n=== ${name} ===`);
  run(process.execPath, [cli, pack.source, pack.target, ...exportFlags]);

  // The exit code says the CLI finished; the page is what says it finished with
  // something. A target the CLI declined to write leaves no page at all.
  const index = path.join(pack.target, "index.html");
  if (!fs.existsSync(index) || fs.statSync(index).size == 0)
    fail(`${name} produced no page: ${index} is missing or empty`);
}

console.log(`\n=== Publishing ${site} ===`);
run("git", ["add", "--all"], { cwd: site });

// `--cached` after the add, so a deleted path and a new one both count: anything
// that needs committing is staged by now, and `--quiet` reports it as an exit code
// rather than as a line of output per file. On a repo with no commits yet this
// diffs against the empty tree, which is right: everything staged is new.
const changed = run("git", ["diff", "--cached", "--quiet"], { cwd: site, tolerate: true }) != 0;

if (changed) {
  run("git", ["commit", "--message", commitName], { cwd: site });
  // The commit's own summary, rather than a count kept while staging: it is what
  // `git show` would print, and it cannot disagree with what was committed
  run("git", ["show", "--shortstat", "--format=%h", "HEAD"], { cwd: site });
} else console.log("Nothing changed since the last export, so nothing to commit");

// Pushed in either case: a run that changed nothing still publishes a commit an
// earlier run left behind by failing on its way out
run("git", ["push"], { cwd: site });
console.log("Pushed");
