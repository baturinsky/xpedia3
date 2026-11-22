/**
 * Builds `cli/xpedia-cli-sea.exe`, the same CLI as a single executable that
 * runs without Node installed (Node's SEA: Single Executable Applications).
 *
 * The steps: bundle the CLI to a single CommonJS file, compact it into a
 * Node SEA blob, copy the running `node` binary, and inject the blob with
 * `postject`. The result carries the Node runtime (~85 MB) next to the ~1.6 MB
 * of CLI — see `npm run cli:exe` (Bun) for the same idea at a larger size.
 *
 * The blob can only run on the same Node major that generated it, so SEA is
 * always built from the `node` on PATH, never a cross version.
 *
 * Run through `npm run cli:sea`, which builds the app shell first: the shell
 * is a build artifact, not a source file.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import { cliPaths, embeddedModules, requireShell } from "./embeddedModules.mjs";
import { versionDefines } from "./version.mjs";

const { root } = cliPaths();
requireShell();

const seaDir = path.join(root, "build", "sea");
const bundleFile = path.join(seaDir, "cli.cjs");
const configFile = path.join(seaDir, "sea-config.json");
const blobFile = path.join(seaDir, "sea-prep.blob");
const outFile = path.join(root, "cli", "xpedia-cli-sea.exe");

fs.mkdirSync(seaDir, { recursive: true });

// CommonJS, because a SEA blob is a single script and the ESM banner in
// `build-cli.mjs` has no meaning there; minified, because nobody reads the
// code in the blob. `define` matches the `.mjs` build: without it the version
// constants would survive into the bundle and throw.
await esbuild.build({
  entryPoints: [path.join(root, "src", "cliMain.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  minify: true,
  outfile: bundleFile,
  plugins: [embeddedModules()],
  define: versionDefines(),
  legalComments: "none",
  logLevel: "info",
});

fs.writeFileSync(
  configFile,
  JSON.stringify({
    main: bundleFile,
    output: blobFile,
    disableExperimentalSEAWarning: true,
  }),
);

// The blob is version-locked to the Node that made it, so build it with the
// same binary that will carry it
execFileSync(process.execPath, ["--experimental-sea-config", configFile], { stdio: "inherit" });

// A copy of Node with the blob injected. postject runs through the `node` on
// PATH rather than its `.cmd` launcher, so this works on Windows without a
// shell.
fs.copyFileSync(process.execPath, outFile);
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "postject", "dist", "cli.js"),
    outFile,
    "NODE_SEA_BLOB",
    blobFile,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ],
  { stdio: "inherit" },
);

const size = fs.statSync(outFile).size;
console.log(`cli/xpedia-cli-sea.exe: ${(size / 1048576).toFixed(1)} MB`);
