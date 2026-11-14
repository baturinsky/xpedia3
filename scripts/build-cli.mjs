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
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const shellFile = path.join(root, "build", "xpedia.html");
const builtinRoot = path.join(root, "src", "builtinMods");
const wasmFile = path.join(root, "src", "unrar.wasm");
const outFile = path.join(root, "cli", "xpedia-cli.mjs");

function require(file, what) {
  if (!fs.existsSync(file))
    throw new Error(`${what} is missing: ${file}\nRun \`npm run build\` first.`);
}

require(shellFile, "The built app shell");
require(wasmFile, "The unrar binary");

/**
 * The builtin mods in the same container `vite.config.ts` produces.
 *
 * A flat binary list of `[name length][data length][name][data]`, all lengths
 * little-endian, gzipped as a whole: it compresses far better than base64 inside
 * JSON, and it is the exact format `unpackBuiltinMods` already reads.
 */
function builtinModsPayload() {
  let parts = [];
  let walk = dir => {
    for (let entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      let full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      let name = Buffer.from(path.relative(builtinRoot, full).replace(/\\/g, "/"), "utf8");
      let data = fs.readFileSync(full);
      let header = Buffer.alloc(8);
      header.writeUInt32LE(name.length, 0);
      header.writeUInt32LE(data.length, 4);
      parts.push(header, name, data);
    }
  };
  walk(builtinRoot);
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 }).toString("base64");
}

/**
 * The shell, gzipped and base64 encoded.
 *
 * Gzipping is worth it here: the page is mostly the minified React bundle, which
 * deflates to roughly half its size, and the CLI carries it in every copy.
 */
function shellPayload() {
  let html = fs.readFileSync(shellFile);
  return zlib.gzipSync(html, { level: 9 }).toString("base64");
}

/** A module the CLI imports instead of a file: its payload, as an ESM default */
function embeddedModules() {
  let payloads = {
    "xpedia:shell": shellPayload(),
    "xpedia:builtin-mods": builtinModsPayload(),
    "xpedia:unrar-wasm": fs.readFileSync(wasmFile).toString("base64"),
  };
  return {
    name: "xpedia-embedded",
    setup(build) {
      build.onResolve({ filter: /^xpedia:/ }, args => ({ path: args.path, namespace: "xpedia" }));
      build.onLoad({ filter: /.*/, namespace: "xpedia" }, args =>
        // Only the data modules; `xpedia:load` and `xpedia:search` have their own
        // loader below and must not be shadowed by this one
        args.path in payloads
          ? { contents: `export default ${JSON.stringify(payloads[args.path])};`, loader: "js" }
          : undefined);
      // `load.ts` is the browser loader and would drag the whole app in. The CLI
      // only needs `builtinFile` for the globe data, so this one import is
      // answered here instead, from the same embedded payload.
      build.onResolve({ filter: /^\.\/load$/ }, () => ({ path: "xpedia:load", namespace: "xpedia" }));
      build.onLoad({ filter: /^xpedia:load$/, namespace: "xpedia" }, () => ({
        contents: `
          import { unpackBuiltinMods } from ${JSON.stringify(path.join(root, "src", "packBuild.ts").replace(/\\/g, "/"))};
          import payload from "xpedia:builtin-mods";
          let cached;
          function files() { return cached ??= unpackBuiltinMods(payload); }
          export function builtinFile(wanted) {
            let key = wanted.replace(/\\\\/g, "/").toLowerCase();
            for (let [name, data] of Object.entries(files()))
              if (name.toLowerCase() == key)
                return data;
          }
        `,
        loader: "js"
      }));
      // Search needs a Web Worker; the CLI never searches
      build.onResolve({ filter: /^js-worker-search$/ }, () => ({ path: "xpedia:search", namespace: "xpedia" }));
      build.onLoad({ filter: /^xpedia:search$/, namespace: "xpedia" }, () => ({
        contents: `
          export default class SearchStub {
            indexDocument() {}
            search() { return []; }
          }
        `,
        loader: "js"
      }));
    }
  };
}

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
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __pathDirname } from 'node:path';",
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __pathDirname(__filename);",
    ].join("\n")
  },
  legalComments: "none",
  logLevel: "info",
});

let size = fs.statSync(outFile).size;
console.log(`cli/xpedia-cli.mjs: ${(size / 1048576).toFixed(2)} MB`);
