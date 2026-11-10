import fs from "fs"
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

