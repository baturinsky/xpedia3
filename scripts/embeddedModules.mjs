/**
 * The `xpedia:` payload modules the CLI embeds instead of reading files.
 *
 * Shared by the two CLI builders: `build-cli.mjs` (the `.mjs` script, run with
 * Node) and `build-cli-sea.mjs` (the single-executable build), so both carry
 * the same shell, builtin mods and unrar wasm.
 *
 * - `xpedia:shell`, `xpedia:builtin-mods` and `xpedia:unrar-wasm` are data
 *   modules: a base64 string as the default export;
 * - `xpedia:load` answers `./load` instead: the browser loader would drag the
 *   whole app in, and the CLI only needs `builtinFile` for the globe data;
 * - `xpedia:search` answers `js-worker-search`: the CLI never searches.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { builtinModsPayload as buildBuiltinModsPayload } from "./builtinMods.mjs";

const root = path.resolve(import.meta.dirname, "..");

export function cliPaths() {
  return {
    root,
    shellFile: path.join(root, "build", "xpedia.html"),
    builtinRoot: path.join(root, "src", "builtinMods"),
    wasmFile: path.join(root, "src", "unrar.wasm"),
  };
}

/** The files both builders need, or the reason an early run fails */
export function requireShell() {
  const { shellFile, wasmFile } = cliPaths();
  if (!fs.existsSync(shellFile))
    throw new Error(`The built app shell is missing: ${shellFile}\nRun \`npm run build\` first.`);
  if (!fs.existsSync(wasmFile)) throw new Error(`The unrar binary is missing: ${wasmFile}`);
}

export function embeddedModules() {
  const { builtinRoot, shellFile, wasmFile } = cliPaths();
  // The builtin mods in the same container `vite.config.ts` produces, which
  // is also the format `unpackBuiltinMods` already reads.
  const builtinModsPayload = buildBuiltinModsPayload(builtinRoot);
  // The shell, gzipped: the page is mostly the minified React bundle, which
  // deflates to roughly half its size, and the CLI carries it in every copy.
  const shellPayload = zlib.gzipSync(fs.readFileSync(shellFile), { level: 9 }).toString("base64");
  const payloads = {
    "xpedia:shell": shellPayload,
    "xpedia:builtin-mods": builtinModsPayload,
    "xpedia:unrar-wasm": fs.readFileSync(wasmFile).toString("base64"),
  };
  return {
    name: "xpedia-embedded",
    setup(build) {
      build.onResolve({ filter: /^xpedia:/ }, (args) => ({ path: args.path, namespace: "xpedia" }));
      build.onLoad({ filter: /.*/, namespace: "xpedia" }, (args) =>
        // Only the data modules; `xpedia:load` and `xpedia:search` have their own
        // loader below and must not be shadowed by this one
        args.path in payloads
          ? { contents: `export default ${JSON.stringify(payloads[args.path])};`, loader: "js" }
          : undefined,
      );
      // `load.ts` is the browser loader and would drag the whole app in. The CLI
      // only needs `builtinFile` for the globe data, so this one import is
      // answered here instead, from the same embedded payload.
      build.onResolve({ filter: /^\.\/load$/ }, () => ({
        path: "xpedia:load",
        namespace: "xpedia",
      }));
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
        loader: "js",
      }));
      // Search needs a Web Worker; the CLI never searches
      build.onResolve({ filter: /^js-worker-search$/ }, () => ({
        path: "xpedia:search",
        namespace: "xpedia",
      }));
      build.onLoad({ filter: /^xpedia:search$/, namespace: "xpedia" }, () => ({
        contents: `
          export default class SearchStub {
            indexDocument() {}
            search() { return []; }
          }
        `,
        loader: "js",
      }));
    },
  };
}
