/**
 * Bundles the few modules the checks run against, into `test/.gen` (ignored).
 *
 * The checks are plain Node programs, but the code under test is browser code:
 * `src/rul` is TypeScript, and `js-worker-search` is CommonJS. esbuild turns both
 * into an ESM module Node can import, which keeps the checks dependent on the
 * real sources rather than on a copy of them.
 */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "..");
export const gen = path.join(here, ".gen");

const shim = path.join(here, "helpers", "js-worker-search.mjs");

/** The modules a check imports, by the name it imports them under */
const modules = [
  ["src/rul/Ruleset.ts", "engine.mjs"],
  ["src/packBuild.ts", "packbuild.mjs"],
  ["src/exportCore.ts", "exportcore.mjs"],
  ["src/ui/schedule.ts", "schedule.mjs"],
  ["src/ui/timing.ts", "timing.mjs"],
];

/** `js-worker-search` ships as CommonJS whose default export is the class */
const redirectSearch = {
  name: "js-worker-search",
  setup(build) {
    build.onResolve({ filter: /^js-worker-search$/ }, () => ({ path: shim }));
  },
};

/**
 * `node-unrar-js` mixes `require` with top-level await once bundled, which Node
 * refuses to load, so it stays external and is imported at runtime instead.
 */
const nodeInterop = {
  js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
};

export async function build() {
  await Promise.all(modules.map(([entry, outfile]) => esbuild.build({
    entryPoints: [path.join(root, entry)],
    absWorkingDir: root,
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: path.join(gen, outfile),
    external: ["node-unrar-js"],
    plugins: [redirectSearch],
    banner: nodeInterop,
    logLevel: "warning",
  })));
  console.log(`built ${modules.map(([, out]) => out).join(", ")}`);
}

/**
 * Builds once, whoever asks first.
 *
 * Checks run as separate processes but a helper module is loaded before its
 * caller's own code, so each has to be able to ask for the build itself. The
 * runner marks the environment after its own build, which stops every child
 * from repeating it.
 */
let pending;
export function ensureBuilt() {
  if (process.env.XPEDIA_TEST_BUILT)
    return Promise.resolve();
  pending ??= build();
  return pending;
}
