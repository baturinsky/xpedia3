/**
 * The builtin mods in the container the app carries them in.
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
 *
 * This is the one implementation: `vite.config.ts` writes it for the app,
 * `scripts/build-cli.mjs` writes the same bytes for the CLI, and the tests
 * read exactly what a page would see — entries sorted, gzipped at level 9.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/**
 * @param {string} builtinRoot
 * @param {(file: string) => void} [onFile]
 * @returns {string}
 */
export function builtinModsPayload(builtinRoot, onFile) {
  const parts = [];
  const walk = (dir) => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      // Names are stored with forward slashes, as `interpretPath` splits
      // on both but the archive loader already produces this form
      const name = Buffer.from(path.relative(builtinRoot, full).replace(/\\/g, "/"), "utf8");
      const data = fs.readFileSync(full);
      const header = Buffer.alloc(8);
      header.writeUInt32LE(name.length, 0);
      header.writeUInt32LE(data.length, 4);
      parts.push(header, name, data);
      onFile?.(full);
    }
  };
  walk(builtinRoot);
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 }).toString("base64");
}
