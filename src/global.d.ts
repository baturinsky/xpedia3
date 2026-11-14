declare module "*.css"

/**
 * Properties the app hangs on `window` that the DOM lib does not know about.
 */
interface Window {
  /** The loaded ruleset, so it can be inspected from the console */
  rul?: any;
}

/**
 * Files the build compiles in rather than ships beside the page.
 *
 * `base64` is the unrar WebAssembly binary and `builtinMods` is the packed
 * builtin mods folder; both are turned into a single base64 string by a Vite
 * plugin, so the app imports them as ordinary modules.
 */
declare module "*?base64" {
  const data: string;
  export default data;
}

declare module "*?builtinMods" {
  const data: string;
  export default data;
}

/**
 * Payloads `scripts/build-cli.mjs` compiles into the command line tool.
 *
 * The CLI has to be a single file, so the app shell, the builtin mods and the
 * unrar binary are turned into base64 strings at build time and imported like
 * ordinary modules. The browser build has no such modules; nothing in the app
 * imports them.
 */
declare module "xpedia:shell" {
  /** Gzipped `build/xpedia.html`, base64 */
  const data: string;
  export default data;
}

declare module "xpedia:builtin-mods" {
  /** Gzipped builtin mods container, base64 */
  const data: string;
  export default data;
}

declare module "xpedia:unrar-wasm" {
  /** The unrar WebAssembly binary, base64 */
  const data: string;
  export default data;
}
