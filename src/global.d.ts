declare module "*.css"

/**
 * Constants the build replaces with literals, see `scripts/version.mjs`.
 *
 * They are spliced in by `vite`'s `define` (and the CLI's esbuild `define`), so
 * a `const` here is only for the type checker: reading them at runtime gives the
 * value that was current when the copy was built, never the running machine's.
 */
declare const __XPEDIA_VERSION__: string
/** The build number for a release build; empty on the dev server, see `xpediaVersion` */
declare const __XPEDIA_BUILD__: string
/** `git describe` of the build, empty when the build had no git */
declare const __XPEDIA_STAMP__: string
/**
 * Base URL of the dev server's example-modpack route, empty in a release build.
 *
 * Only the developer view's "load from URL" field uses it, and only as a
 * starting point: the page fetches whatever URL it is given, so this decides
 * nothing about where a pack may come from.
 */
declare const __XPEDIA_DEV_PACKS__: string

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
