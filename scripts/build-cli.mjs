/**
 * Builds `cli/xpedia-cli.mjs`, one self-contained Node script.
 *
 * The CLI reads a modpack archive itself, so it embeds everything the browser
 * build would otherwise supply at runtime:
 *
 * - the app shell (`build/xpedia.html`, written by `vite build`), gzipped;
 * - the builtin mods, in the container `vite.config.ts` also writes;
 * - the unrar WebAssembly binary;
 * - the engine, the archive readers and `js-yaml`/`fflate`, bundled by esbuild.
 *
 * Run through `npm run cli`, which does `vite build` first: the shell is a build
 * artifact, not a source file, so it has to be current.
 */

import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import { cliPaths, embeddedModules, requireShell } from "./embeddedModules.mjs";
import { versionDefines } from "./version.mjs";

const { root } = cliPaths();
const outFile = path.join(root, "cli", "xpedia-cli.mjs");

requireShell();

await esbuild.build({
  entryPoints: [path.join(root, "src", "cliMain.ts")],
  bundle: true,
  // The script is `.mjs` and runs on Node, but no Node builtin is bundled: they
  // stay imports, so the file works on any supported version
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: outFile,
  plugins: [embeddedModules()],
  // `exportCore.ts` is shared with the page and names the version in the title
  // of an exported pedia, so the CLI has to replace the same constants `vite`
  // does; without them the reference would survive into the bundle and throw.
  // `bump` is off: `npm run cli` builds the page first, and the CLI reports that
  // build's number rather than claiming the next one.
  define: versionDefines(),
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __pathDirname } from 'node:path';",
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __pathDirname(__filename);",
    ].join("\n"),
  },
  legalComments: "none",
  logLevel: "info",
});

const size = fs.statSync(outFile).size;
console.log(`cli/xpedia-cli.mjs: ${(size / 1048576).toFixed(2)} MB`);
