import fs from "fs"
import { defineConfig, UserConfig } from 'vite';
import topLevelAwait from "vite-plugin-top-level-await";
import react from '@vitejs/plugin-react'
import { viteSingleFile } from "vite-plugin-singlefile"

export default defineConfig(({ command, mode, isSsrBuild, isPreview }) => {
  return {
      minify: mode == "min" ? 'terser' : false,
      terserOptions: mode == "min" ? hardTerse : {},
      cssMinify: mode == "min",

    plugins: [
      viteSingleFile({ removeViteModuleLoader: true }),
      topLevelAwait(),
      react({}),
      base64Loader(),
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
      minify: false,
      outDir: `../dist`,
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
 * from `dist`, and the dev page would export a shell that cannot run.
 */
function builtPage() {
  return {
    name: "built-page",
    apply: "serve" as const,
    configureServer(server: any) {
      server.middlewares.use("/xpedia-built.html", (_req: any, res: any) => {
        let file = `${__dirname}/dist/index.html`;
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

const hardTerse = {

  compress: {
    // Enforce maximum compression iterations
    passes: 3,

    // General dangerous compressions
    unsafe_arrows: true,
    //unsafe_comps: true,
    unsafe_Function: true,
    unsafe_math: true,
    unsafe_symbols: true,
    unsafe_methods: true,
    unsafe_proto: true,
    unsafe_regexp: true,

    // Clean up code for size
    drop_console: true,
    drop_debugger: true,
    dead_code: true,
  },
  mangle: {
    // Mangle variables at the highest scope level
    toplevel: true,

    // Force-mangle property names on objects/classes
    properties: false && {
      // If you use standard DOM APIs (like Canvas ctx.fillStyle), 
      // set builtins: false to prevent Terser from mangling native browser traits.
      builtins: false,

      // Mangle everything except strings enclosed in quotes (helps prevent breaking keys)
      keep_quoted: 'strict',

      undeclared: true,

      reserved: ["C", "DEFS", "TIP", "biomesByNames", "races", "biomes"]
    }
  },
  format: {
    // Remove all comments from final output
    comments: false,
  },
  // Target modern JS to avoid ES5 bloat wrapper code
  ecma: 2024,
}
