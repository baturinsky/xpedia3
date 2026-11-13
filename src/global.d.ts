declare module "*.css"

/**
 * Properties the app hangs on `window` that the DOM lib does not know about.
 */
interface Window {
  /** The loaded ruleset, so it can be inspected from the console */
  rul?: any;
  /** Data URL of the globe marker sheet, cached across rulesets */
  GlobeMarkers?: string;
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
