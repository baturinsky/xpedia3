import fs from "node:fs";
import path from "node:path";
import { interpretPath } from "./packBuild";

/**
 * Reading a modpack that is a folder rather than an archive.
 *
 * `xpedia-cli` and Xpedia's own loader both speak in `archive path -> bytes`,
 * because that is what an unpacked ZIP or RAR is. A modder, though, works on a
 * folder, and asking them to repack it before every look is exactly the friction
 * `--serve` exists to remove. This module turns a folder into the same shape, so
 * the export reads it with the same code that reads an archive.
 */

/** How a folder lays out its mods, which decides how a file's path is spelled */
export type Layout =
  /** A game root: `user/mods/<mod>/…`, `standard/<mod>/…`, `common/…` */
  | "game"
  /** The folder *is* one mod, so its own name becomes the mod folder */
  | "mod"
  /** A folder of mod folders, each with its own `metadata.yml` */
  | "flat";

/** Directories that are never part of a modpack, whatever their name suggests */
const skippedDirs = new Set([".git", "node_modules"]);

/**
 * Every file in the folder, relative to it, with forward slashes.
 *
 * Sorted so two runs over the same folder agree on which of two spellings of the
 * same path wins.
 */
export function listFiles(root: string) {
  let out: string[] = [];
  let walk = (dir: string, prefix: string) => {
    for (let entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && (entry.name.startsWith(".") || skippedDirs.has(entry.name)))
        continue;
      let rel = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory())
        walk(path.join(dir, entry.name), rel);
      else if (entry.isFile())
        out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}

/**
 * Which of the three layouts the folder is in.
 *
 * The ruleset builder decides a file's mod from its path the way OpenXcom's
 * `FileMap` does, so the paths handed to it have to follow the same convention:
 * a game root already carries the `user/mods` prefix, a single mod folder needs
 * its own name put in front, and a folder of mods needs nothing. Getting this
 * wrong is not cosmetic — a folder mistaken for "flat" would turn its own
 * `Language/` into a mod called `Language`.
 *
 * - A game root is recognised by the folders the engine itself creates.
 * - A single mod is recognised by the folders a mod must have, `metadata.yml`
 *   being optional but `Ruleset`/`Language`/`Resources` being unmistakable.
 * - Anything else is a folder of mods. A pack nested one level deeper, such as
 *   `<pack>/<pack>/user/mods/…`, still resolves: `interpretPath` looks for
 *   `user/mods` and `standard` anywhere in the path, not just at the start.
 */
export function layoutOf(names: string[]): Layout {
  // The folders the engine itself creates are directories at the root, so they
  // are recognised by the first segment of a path rather than by a bare file
  // name — a file called `user` is not the game's `user` folder
  let topDirs = new Set(names
    .filter(n => n.includes("/"))
    .map(n => n.substring(0, n.indexOf("/")).toLowerCase()));
  if (["user", "standard", "common"].some(dir => topDirs.has(dir)))
    return "game";

  let topFiles = new Set(names.filter(n => !n.includes("/")).map(n => n.toLowerCase()));
  let modMarkers = ["ruleset", "language", "resources", "geodata"];
  if (topFiles.has("metadata.yml") || modMarkers.some(dir => topDirs.has(dir)))
    return "mod";

  return "flat";
}

/** The path a folder file is known by while the ruleset is built */
export function archivePath(rel: string, layout: Layout, modRoot: string) {
  return layout == "mod" ? `${modRoot}/${rel}` : rel;
}

/** Extensions whose bytes the ruleset builder actually reads */
export function isText(name: string) {
  let lower = name.toLowerCase();
  let ext = lower.substring(lower.lastIndexOf(".") + 1);
  // `cfg` is here for `user/options.cfg`, the player's mod activation list
  if (ext == "rul" || ext == "yml" || ext == "cfg")
    return true;
  // Article bodies may be `Language/STR_ID.<lang>.html` or `.txt`
  if (ext != "html" && ext != "txt")
    return false;
  let parts = lower.split("/");
  return parts.length > 1 && parts[parts.length - 2] == "language";
}

/**
 * Whether a folder file is raw bytes the page needs, rather than an image it
 * only has to index.
 *
 * This is the same rule `interpretPath` uses to call a file `dat`: only the
 * globe's own folder, so a pack's fonts and other binary DAT files stay
 * unread.
 */
export function isDat(rel: string) {
  return /\.dat$/i.test(rel) && /(^|[/\\])geodata[/\\]/i.test(rel);
}

/**
 * Reads the folder into `archive path -> bytes`.
 *
 * `textOnly` is what `--serve` wants: the page asks the server for each image
 * itself, so a sprite becomes an empty placeholder — the resource map still
 * indexes it, so every path resolves exactly as it would in a real archive,
 * while hundreds of megabytes are never copied for nothing. An export instead
 * needs the bytes, because they are what it writes.
 */
export function readFolderPack(root: string, names: string[], layout: Layout, modRoot: string,
  options: { textOnly?: boolean } = {}) {
  let files: { [name: string]: Uint8Array } = {};
  for (let rel of names) {
    let archive = archivePath(rel, layout, modRoot);
    if (!interpretPath(archive))
      continue;
    let read = !options.textOnly || isText(rel) || isDat(rel);
    files[archive] = read
      ? new Uint8Array(fs.readFileSync(path.join(root, rel)))
      : new Uint8Array(0);
  }
  return files;
}
