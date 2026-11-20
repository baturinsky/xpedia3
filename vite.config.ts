import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import react from "@vitejs/plugin-react";
import type { PluginContext } from "rollup";
import { defineConfig, type UserConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import topLevelAwait from "vite-plugin-top-level-await";
import { devBuildNumber as nextDevBuildNumber, versionDefines } from "./scripts/version.mjs";

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      viteSingleFile({ removeViteModuleLoader: true }),
      topLevelAwait(),
      react({}),
      base64Loader(),
      builtinModsFolder(),
      examplePacks(),
      outputName(),
      builtPage(),
      devBuildNumber(),
    ],
    base: "",
    root: `src`,
    publicDir: `../public`,
    define: {
      DEBUG: mode === "development",
      // The version and the build number are frozen into the bundle, so a copy
      // of the page prints its own numbers rather than reading them from the
      // machine it happens to run on. The dev server is the exception: it has no
      // bundle to freeze one into, and injects a number into each page instead,
      // so its constants must stay empty for that tag to be used.
      ...versionDefines({ bump: mode !== "development", dev: mode === "development" }),
    },
    build: {
      assetsInlineLimit: 1000000,
      sourcemap: true,
      minify: mode === "min",
      cssMinify: mode === "min",
      outDir: `../build`,
      emptyOutDir: true,
      rollupOptions: {
        output: { entryFileNames: "bundle.js" },
      },
    },
  } as UserConfig;
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
      for (const [key, asset] of Object.entries<any>(bundle)) {
        if (asset.fileName !== "index.html") continue;
        asset.fileName = "xpedia.html";
        delete bundle[key];
        bundle["xpedia.html"] = asset;
      }
    },
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
      const number = nextDevBuildNumber();
      return {
        html,
        tags: [
          {
            tag: "meta",
            attrs: { name: "xpedia-build", content: String(number) },
            injectTo: "head-prepend" as const,
          },
        ],
      };
    },
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
        const file = `${__dirname}/build/xpedia.html`;
        if (!fs.existsSync(file)) {
          res.statusCode = 404;
          res.end("Run `npm run build` first");
          return;
        }
        res.setHeader("Content-Type", "text/html");
        res.end(fs.readFileSync(file));
      });
    },
  };
}

function base64Loader() {
  return {
    name: "base64-loader",
    transform(_: any, id: string) {
      const [path, query] = id.split("?");
      if (query !== "base64") return null;

      const data = fs.readFileSync(path);
      const base64 = data.toString("base64");

      return `export default '${base64}';`;
    },
  };
}

/**
 * Serves `misc/modpackExamples` for the developer view's "load from URL" field.
 *
 * A real modpack is far too large for the browser tools that push files into a
 * page (5 MiB), so testing a full pack means the page fetching the archive
 * itself. This route makes that possible from the dev server, replacing the
 * separate `cors-server.js` that had to be started by hand.
 *
 * Only the *dev server* gets this: a release build serves nothing but its own
 * page, and `__XPEDIA_DEV_PACKS__` is empty there, so the field starts blank.
 *
 * The examples are read straight from disk on each request rather than being
 * bundled, so dropping a new archive into the folder needs no restart.
 */
function examplePacks() {
  /** URL prefix the page uses, see `examplePacksUrl` in `src/packUrl.ts` */
  const prefix = "/example-packs/";

  return {
    name: "example-packs",

    // The address is only meaningful where the middleware exists, so the dev
    // server publishes it and every other build says "no such route": a release
    // build serves nothing but its own page, and its field starts blank
    config(config: UserConfig, env: { command: string }) {
      const define = config.define ?? {};
      define.__XPEDIA_DEV_PACKS__ = JSON.stringify(env.command === "serve" ? prefix : "");
      return { define };
    },

    configureServer(server: any) {
      const root = `${__dirname}/misc/modpackExamples`;
      server.middlewares.use(prefix, (req: any, res: any, next: any) => {
        const name = decodeURIComponent(String(req.url ?? "").split("?")[0]).replace(/^\/+/, "");

        // The examples are not part of the repository, so a fresh clone has no
        // folder to list. That is not an error: the developer view simply has
        // nothing to offer, and the file name can still be typed by hand once
        // the folder is filled.
        const present = fs.existsSync(root);

        // The bare prefix lists what is available, so the developer view can
        // offer the packs by name instead of making the file name be typed from
        // memory. Archives only: the folder also holds extracted copies.
        if (!name) {
          const listing = !present
            ? []
            : (fs.readdirSync(root, { withFileTypes: true }) as any[])
                .filter((entry) => entry.isFile() && /\.(zip|rar)$/i.test(entry.name))
                .map((entry) => ({
                  name: entry.name,
                  size: fs.statSync(path.join(root, entry.name)).size,
                }))
                .sort((a, b) => a.name.localeCompare(b.name));
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(listing));
          return;
        }

        if (!present) return next();

        // `misc/modpackExamples` is outside the dev server's root, so this route
        // is the only way to reach it — but it still must not serve anything
        // else on disk, hence the containment check
        const file = path.resolve(root, name);
        if (!file.startsWith(path.resolve(root) + path.sep)) return next();
        const stat = fs.statSync(file, { throwIfNoEntry: false });
        if (!stat?.isFile()) return next();
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", stat.size);
        // The page is served from the same origin, so no CORS header is needed;
        // `no-store` keeps a rebuilt archive from being served from cache
        res.setHeader("Cache-Control", "no-store");
        fs.createReadStream(file).pipe(res);
      });
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
  const virtualId = "\0builtin-mods";

  return {
    name: "builtin-mods",

    resolveId(id: string) {
      if (id.endsWith("?builtinMods")) return virtualId;
    },

    load(this: PluginContext, id: string) {
      if (id !== virtualId) return null;

      const root = `${__dirname}/src/builtinMods`;
      const parts: Buffer[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = `${dir}/${entry.name}`;
          if (entry.isDirectory()) walk(full);
          else {
            // Names are stored with forward slashes, as `interpretPath` splits
            // on both but the archive loader already produces this form
            const name = Buffer.from(full.substring(root.length + 1).replace(/\\/g, "/"), "utf8");
            const data = fs.readFileSync(full);
            const header = Buffer.alloc(8);
            header.writeUInt32LE(name.length, 0);
            header.writeUInt32LE(data.length, 4);
            parts.push(header, name, data);
            // A change to a file has to rebuild this module, not serve a stale copy
            this.addWatchFile(full);
          }
        }
      };
      walk(root);

      const gzipped = zlib.gzipSync(Buffer.concat(parts), { level: 9 });
      return `export default '${gzipped.toString("base64")}';`;
    },

    // A language file has no module of its own to update, so a change to one
    // reloads the page instead of leaving the old strings on screen. Nothing
    // imports these files directly, so the watcher has to be told about the
    // folder: otherwise the first edit after starting the server is missed.
    //
    // `addWatchFile` above only re-runs this module for a file that the last
    // build already walked. A file added afterwards is therefore never picked
    // up, and neither is a parent folder the watcher did not know about — a
    // brand new `Ruleset/Xpedia.rul` was silently left out of the container
    // until the dev server restarted. Watching the folder itself covers both,
    // so the container is rebuilt and the page reloaded.
    configureServer(server: any) {
      const root = `${__dirname}/src/builtinMods`;
      server.watcher.add(root);
      server.watcher.on("add", (file: string) => {
        if (!file.replace(/\\/g, "/").includes("/src/builtinMods/")) return;
        const module = server.moduleGraph.getModuleById(virtualId);
        if (module) server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: "full-reload" });
      });
      server.watcher.on("change", (file: string) => {
        if (file.replace(/\\/g, "/").includes("/src/builtinMods/"))
          server.ws.send({ type: "full-reload" });
      });
    },
  };
}
