/**
 * The builtin mods, read from `src/builtinMods` the way the build compiles them.
 *
 * The app carries them as one gzipped container (`vite.config.ts`, `unpackBuiltinMods`),
 * and a check has to see exactly what a page would see, so the container is
 * assembled with the build's own code (`scripts/builtinMods.mjs`) rather than
 * the tree being walked again.
 */
import { join } from "node:path";
import { builtinModsPayload } from "../../scripts/builtinMods.mjs";
import { ensureBuilt, root } from "../build.mjs";

await ensureBuilt();

const { unpackBuiltinMods, filterBuiltinMods } = await import("../.gen/packbuild.mjs");

/** Every builtin mod, as `path -> data` */
export function builtinFiles() {
  const base = join(root, "src", "builtinMods");
  return unpackBuiltinMods(builtinModsPayload(base));
}

/** The builtins that apply to a pack, by the pack's file name, see `filterBuiltinMods` */
export function builtinFilesFor(packName) {
  return filterBuiltinMods(builtinFiles(), packName);
}
