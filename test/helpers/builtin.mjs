/**
 * The builtin mods, read from `src/builtinMods` the way the build compiles them.
 *
 * The app carries them as one gzipped container (`vite.config.ts`, `unpackBuiltinMods`),
 * and a check has to see exactly what a page would see, so the container is
 * assembled here in the same format rather than the tree being walked again.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ensureBuilt, root } from "../build.mjs";

await ensureBuilt();

const { unpackBuiltinMods, filterBuiltinMods } = await import("../.gen/packbuild.mjs");

function container(dir, base) {
  let parts = [];
  let walk = (at) => {
    for (let name of readdirSync(at)) {
      let full = join(at, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      // Keys are archive paths, so the separator is the one a pack would use
      let rel = Buffer.from(full.substring(base.length + 1).replace(/\\/g, "/"), "utf8");
      let data = readFileSync(full);
      let header = Buffer.alloc(8);
      header.writeUInt32LE(rel.length, 0);
      header.writeUInt32LE(data.length, 4);
      parts.push(header, rel, data);
    }
  };
  walk(dir);
  return gzipSync(Buffer.concat(parts)).toString("base64");
}

/** Every builtin mod, as `path -> data` */
export function builtinFiles() {
  let base = join(root, "src", "builtinMods");
  return unpackBuiltinMods(container(base, base));
}

/** The builtins that apply to a pack, by the pack's file name, see `filterBuiltinMods` */
export function builtinFilesFor(packName) {
  return filterBuiltinMods(builtinFiles(), packName);
}
