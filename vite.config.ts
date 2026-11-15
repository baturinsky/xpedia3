import fs from "fs"
import zlib from "zlib"
import { defineConfig, UserConfig } from 'vite';
import topLevelAwait from "vite-plugin-top-level-await";
import react from '@vitejs/plugin-react'
import { viteSingleFile } from "vite-plugin-singlefile"
import { versionDefines, devBuildNumber as nextDevBuildNumber } from "./scripts/version.mjs"

export default defineConfig(({ command, mode, isSsrBuild, isPreview }) => {
  return {

    plugins: [
      viteSingleFile({ removeViteModuleLoader: true }),
      topLevelAwait(),
      react({}),
      base64Loader(),
      builtinModsFolder(),
      outputName(),
      builtPage(),
      devBuildNumber()
    ],
    base: '',
    root: `src`,
    publicDir: `../public`,
    define: {
      DEBUG: mode == 'development',
      // The version and the build number are frozen into the bundle, so a copy
      // of the page prints its own numbers rather than reading them from the
      // machine it happens to run on. The dev server is the exception: it has no
      // bundle to freeze one into, and injects a number into each page instead,
      // so its constants must stay empty for that tag to be used.
      ...versionDefines({ bump: mode != 'development', dev: mode == 'development' })
    },
    build: {
      assetsInlineLimit: 1000000,
      sourcemap: true,
      minify: mode == "min" ? true : false,
      cssMinify: mode == "min",
      outDir: `../build`,
      emptyOutDir: true,
      rollupOptions: {
        output: { entryFileNames: "bundle.js" }
      }
    }
  } as UserConfig

});



/**
 * Writes the built pedia as `xpedia.html` rather than `index.html`.
 *
 * Vite names the output after the source page (`src/index.html`), and that name
 * has to stay: it is what the dev server serves at `/`. The published pedia,
 * though, is one file people keep and open by name, so the build renames it.
 * It is a rename rather than `rollupOptions.input` because the dev entry and
 * the built entry would otherwise need separate source files.
 *
 * The rename happens on the emitted asset, not on disk afterwards, so the
 * build's own report names the file the build actually produced.
 */
function outputName() {
  return {
    name: "output-name",
    apply: "build" as const,
    // After `vite-plugin-singlefile`, which builds the page in its own
    // `generateBundle`; renaming earlier would have it re-emit `index.html`
    enforce: "post" as const,
    generateBundle(_: any, bundle: any) {
      for (let [key, asset] of Object.entries<any>(bundle)) {
        if (asset.fileName != "index.html")
          continue;
        asset.fileName = "xpedia.html";
        delete bundle[key];
        bundle["xpedia.html"] = asset;
      }
    }
  };
}

/**
 * Injects a fresh build number into the dev server's page.
 *
 * `define` cannot do this: it is evaluated once, when the config loads, so every
 * page the server ever serves would carry the number it started with. The dev
 * server does not serve a bundle from disk, it serves `index.html` and lets the
 * browser pull modules, so the page itself is the place a per-request number can
 * go.
 *
 * The number is written into a `<meta>` tag that the app reads once at startup.
 * A reload therefore claims a number, and two tabs or two machines can be
 * ordered by it. Numbers are spent on reloads that changed nothing, which leaves
 * gaps; the point is only that a higher number means later code.
 *
 * Production is untouched: the build bakes the number in through `define`, and
 * this plugin only applies when serving.
 */
function devBuildNumber() {
  return {
    name: "dev-build-number",
    apply: "serve" as const,
    transformIndexHtml(html: string) {
      let number = nextDevBuildNumber();
      return {
        html,
        tags: [{
          tag: "meta",
          attrs: { name: "xpedia-build", content: String(number) },
          injectTo: "head-prepend" as const,
        }],
      };
    }
  };
}

/**
 * Serves the last production build during development.
 *
 * The export needs the whole app as one inline bundle, which only the build
 * produces (`vite-plugin-singlefile`). Without this, export could only be tested
 * from the build output, and the dev page would export a shell that cannot run.
 */
function builtPage() {
  return {
    name: "built-page",
    apply: "serve" as const,
    configureServer(server: any) {
      server.middlewares.use("/xpedia-built.html", (_req: any, res: any) => {
        let file = `${__dirname}/build/xpedia.html`;
        if (!fs.existsSync(file)) {
          res.statusCode = 404;
          res.end("Run `npm run build` first");
          return;
        }
        res.setHeader("Content-Type", "text/html");
        res.end(fs.readFileSync(file));
      });
    }
  };
}

function base64Loader() {  return {
    name: "base64-loader",
      transform(_: any, id: string) {
      const [path, query] = id.split("?");
      if (query != "base64") return null;

      const data = fs.readFileSync(path);
      const base64 = data.toString("base64");

      return `export default '${base64}';`;
    },
  };
}

/**
 * The builtin mods, compiled in from the plain `src/builtinMods` folder.
 *
 * They are authored as ordinary files, so editing a string in a language file
 * needs no repacking, but they are shipped compressed: these language files
 * repeat themselves from one language to the next, and plain text in the
 * bundle would cost roughly a third more than the old `builtinMods.zip` did.
 *
 * The container is a flat binary list of `[name length][data length][name]
 * [data]`, all lengths little-endian, gzipped as a whole. Per-file base64
 * inside JSON was tried first and compresses much worse, because base64 turns
 * every three bytes into four that no longer share their neighbours' structure.
 */
function builtinModsFolder() {
  let virtualId = "\0builtin-mods";

  return {
    name: "builtin-mods",

    resolveId(id: string) {
      if (id.endsWith("?builtinMods"))
        return virtualId;
    },

    load(id: string) {
      if (id != virtualId)
        return null;

      let root = `${__dirname}/src/builtinMods`;
      let parts: Buffer[] = [];
      let walk = (dir: string) => {
        for (let entry of fs.readdirSync(dir, { withFileTypes: true })) {
          let full = `${dir}/${entry.name}`;
          if (entry.isDirectory())
            walk(full);
          else {
            // Names are stored with forward slashes, as `interpretPath` splits
            // on both but the archive loader already produces this form
            let name = Buffer.from(full.substring(root.length + 1).replace(/\\/g, "/"), "utf8");
            let data = fs.readFileSync(full);
            let header = Buffer.alloc(8);
            header.writeUInt32LE(name.length, 0);
            header.writeUInt32LE(data.length, 4);
            parts.push(header, name, data);
            // A change to a file has to rebuild this module, not serve a stale copy
            this.addWatchFile(full);
          }
        }
      };
      walk(root);

      let gzipped = zlib.gzipSync(Buffer.concat(parts), { level: 9 });
      return `export default '${gzipped.toString("base64")}';`;
    },

    // A language file has no module of its own to update, so a change to one
    // reloads the page instead of leaving the old strings on screen. Nothing
    // imports these files directly, so the watcher has to be told about the
    // folder: otherwise the first edit after starting the server is missed.
    configureServer(server: any) {
      let root = `${__dirname}/src/builtinMods`;
      server.watcher.add(root);
      server.watcher.on("change", (file: string) => {
        if (file.replace(/\\/g, "/").includes("/src/builtinMods/"))
          server.ws.send({ type: "full-reload" });
      });
    }
  };
}

