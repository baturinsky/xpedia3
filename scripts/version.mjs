/**
 * The version the app prints, and the build number that identifies a copy of it.
 *
 * Two separate things are tracked, because they answer different questions:
 *
 * - `version` lives in `package.json` and is bumped by hand when something is
 *   released. It names a release: "3.0.0 alpha 6".
 * - the build number is a counter in `build-number.txt`, advanced once per
 *   build. It tells one build of the same release from another, which is what a
 *   bug report needs.
 *
 * A release bakes both into the bundle with `define`, so an exported page keeps
 * the number it was built with. The dev server cannot do that: `define` is read
 * once when the config loads, so it would pin every reload to the number the
 * server started with. It writes a fresh number into each page instead, and both
 * live in the same counter file, so a dev instance and a build can be ordered.
 *
 * The counter is advanced here rather than by a `prebuild` script so that the
 * two builds a release runs cannot disagree: `npm run cli` is `vite build`
 * followed by `build-cli.mjs`, and the CLI must print the same number the page
 * was just built with, not the next one. Only the page build advances it.
 *
 * The git stamp is kept alongside for traceability. A build number alone says
 * "build 42" without saying what sources produced it, and two machines counting
 * independently would both reach 42 from different code; the stamp is what
 * turns a printed number back into a commit.
 *
 * This lives in `scripts/` because both builds need it: `vite.config.ts` for the
 * page and the exports, `build-cli.mjs` for the CLI, which esbuild bundles with
 * its own settings. One implementation keeps them from drifting apart.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const buildNumberFile = path.join(root, "build-number.txt");

/** The version in `package.json`, which is the single source of truth */
export function version() {
  let pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return String(pkg.version ?? "0.0.0");
}

/** The last build number produced, or 0 before the first one */
export function buildNumber() {
  try {
    let stored = parseInt(fs.readFileSync(buildNumberFile, "utf8").trim(), 10);
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  } catch {
    return 0;
  }
}

/**
 * Advances the build counter and returns the new number.
 *
 * A missing or unreadable file counts as 0, so a fresh checkout starts at 1
 * rather than failing the build.
 */
export function nextBuildNumber() {
  let next = buildNumber() + 1;
  fs.writeFileSync(buildNumberFile, `${next}\n`);
  return next;
}

/**
 * Advances the counter for the dev server and returns the new number.
 *
 * The dev server has no compiled bundle to freeze a number into, and `define` is
 * read once when the config loads, so the number has to be decided per page
 * request instead. Gaps are expected and harmless: the page is reloaded for its
 * own reasons, a number is spent whether or not the code changed, and the only
 * question the number answers is which instance was started later.
 *
 * It shares the same file as the release counter, so a dev instance and a build
 * can be compared directly: the later number is the later code.
 */
export function devBuildNumber() {
  return nextBuildNumber();
}

/**
 * `git describe` for the current tree, or an empty string outside a checkout.
 *
 * A published copy may have been built from a tarball with no `.git`, and a
 * missing stamp must not break the build: the build number is then shown on its
 * own.
 */
export function buildStamp() {
  try {
    return execSync("git describe --tags --always --dirty", {
      cwd: root,
      encoding: "utf8",
      // A missing git, or one that refuses the folder, is not a build error
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * The `define` entries both builds pass in.
 *
 * The values are JSON so the replacement is a string literal: `define` splices
 * the value in as source text, and a bare version such as `3.0.0-alpha.6` is not
 * a valid expression.
 *
 * `bump` is set by the page build only. The CLI passes it off, because it runs
 * straight after that build and has to report the same number: it reads back the
 * number the page build just wrote, rather than claiming the next one.
 *
 * `dev` leaves the number empty on purpose. The dev server gets its number from
 * the page it serves (see `devBuildNumber` in `vite.config.ts`), so a value baked
 * in here would win over that tag and pin every reload to the number the server
 * happened to load the config with.
 */
export function versionDefines({ bump = false, dev = false } = {}) {
  return {
    __XPEDIA_VERSION__: JSON.stringify(version()),
    __XPEDIA_BUILD__: JSON.stringify(
      dev ? "" : String(bump ? nextBuildNumber() : buildNumber())),
    __XPEDIA_STAMP__: JSON.stringify(buildStamp()),
  };
}
