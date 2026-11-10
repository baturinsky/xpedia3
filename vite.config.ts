import fs from "fs"
import zlib from "zlib"
import { defineConfig, UserConfig } from 'vite';
import topLevelAwait from "vite-plugin-top-level-await";
import react from '@vitejs/plugin-react'
import { viteSingleFile } from "vite-plugin-singlefile"

export default defineConfig(({ command, mode, isSsrBuild, isPreview }) => {
  return {

    plugins: [
      viteSingleFile({ removeViteModuleLoader: true }),
      topLevelAwait(),
      react({}),
      base64Loader(),
      builtinModsFolder(),
      builtPage()
    ],
    base: '',
    root: `src`,
    publicDir: `../public`,
    define: {
      DEBUG: mode == 'development'
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
        let file = `${__dirname}/build/index.html`;
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

