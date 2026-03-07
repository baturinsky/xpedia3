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
      base64Loader()
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



function base64Loader() {
  return {
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