import * as fflate from "fflate";
import * as unrar from "node-unrar-js";
import JSYaml from "js-yaml";
import Ruleset, { defaultLanguage, Mod } from "./rul/Ruleset";
import { base64ToArrayBuffer } from "./util";

/**
 * Turning an unpacked modpack archive into the data the pedia runs on.
 *
 * Everything here is free of the browser: no database, no `state`, no DOM. That
 * is what lets the command line exporter read a pack with the very same code the
 * app uses, instead of a second copy of the layout rules that would drift.
 *
 * The browser keeps the parts that *do* need a browser — reporting progress,
 * saving to IndexedDB, choosing the language — in `load.ts`.
 */

const assetExts = ["rul", "nam", "png", "gif"];
const lngExts = ["yml", "html", "txt"];

/**
 * Extensions that are read as raw bytes and never shown directly.
 *
 * `dat` is the X-Com image format: 8-bit pixel dumps and the globe's land
 * polygons. Only the globe is used so far, to draw the world map, but the file
 * has to be unpacked and indexed before it can be found at all.
 */
const dataExts = ["dat"];

type AssetType = "lng" | "rul" | "meta" | "img" | "nam" | "dat";

/** Prefix of the builtin mod directories that exist for a single modpack only */
const xhelperPrefix = "xhelper-";

/**
 * The stock globe file, in the form the resource index keys it.
 *
 * A pack names it in `globe: data:` or relies on it implicitly, and the builtin
 * mods ship a copy, so this is the one resource the world map always needs. It
 * lives here rather than in `worldmap.ts` so that exporters can ask which file
 * must travel without pulling the rendering code in.
 */
export const WORLD_DAT = "geodata/world.dat";

export function splitName(name: string): [string, string | undefined] {
  const extRegexp = /^(.+)\.([0-9a-z\-]+)?$/i;
  let m = name.match(extRegexp);
  return m ? [m[1], m[2]] : [name, ""];
}

/**
 * From the path, figure the type and mod of the file.
 *
 * The archive is normally an OpenXcom install folder, so the mod a file belongs
 * to is decided the same way OpenXcom's `FileMap` decides it: resources are
 * looked up relative to the mod's own folder. Supported layouts:
 *
 * - `mods/<mod>/...`             builtin mods (`builtinMods.zip`)
 * - `<pack>/user/mods/<mod>/...` user mods
 * - `<pack>/standard/<mod>/...`  standard mods, including `xcom1`/`xcom2`
 * - `<pack>/common/...`          resources shared by every mod
 * - `<mod>/...`                  a mod packed on its own
 *
 * `mod` is the full archive prefix of the mod folder, so a sprite path built as
 * `${mod}/${relativePath}` matches the stored asset name.
 */
/** A file's role and mod folder, see `interpretPath` */
export type InterpretedPath = {
  type: AssetType;
  mod: string;
  path: string;
  name?: string;
  ext?: string;
};

export function interpretPath(s: string): InterpretedPath | undefined {
  let parts = s.split(/[/\\]/).filter(p => p != "");
  if (parts.length < 1)
    return;

  let lower = parts.map(p => p.toLowerCase());
  /** How many leading segments make up the mod folder */
  let modLength = 1;

  if (lower[0] == "mods" && parts.length > 1) {
    // Builtin mods are packed without a pack folder in front
    modLength = 2;
  } else {
    let userMods = lower.findIndex((p, i) => p == "user" && lower[i + 1] == "mods");
    let standard = lower.indexOf("standard");
    let common = lower.indexOf("common");
    if (userMods >= 0 && parts.length > userMods + 2)
      modLength = userMods + 3;
    else if (standard >= 0 && parts.length > standard + 1)
      modLength = standard + 2;
    else if (common >= 0 && parts.length > common)
      modLength = common + 1;
  }

  let rel = parts.slice(modLength);
  if (!rel.length)
    return;

  let modParts = parts.slice(0, modLength);
  let mod = modParts.join("/");
  let file = rel[rel.length - 1];
  let dirs = rel.slice(0, -1);
  let [name, rawExt] = splitName(file);
  let ext = (rawExt ?? "").toLowerCase();
  let path = parts.join("/");

  if (file.toLowerCase() == "metadata.yml")
    return { type: "meta", mod, path };

  // OpenXcom loads `<mod>/Language/<lang>.yml` and `<mod>/Ruleset/*.rul`; nested
  // variants such as `Language/OXCE/` are for the engine's own folder layout and
  // are not part of a mod's language set
  if (dirs.length && /^language$/i.test(dirs[dirs.length - 1]) && lngExts.includes(ext))
    return { type: "lng", mod, name, path, ext };

  if (assetExts.includes(ext)) {
    return {
      type: { nam: "nam", rul: "rul", gif: "img", png: "img" }[ext] as AssetType,
      mod, name, path, ext
    }
  }

  // Only the globe's own folder: a pack's fonts and other DAT files are binary
  // and would cost unpacking and storage for nothing
  if (dataExts.includes(ext) && dirs.some(d => /^geodata$/i.test(d)))
    return { type: "dat", mod, name, path, ext };

  return;
}

export function usefulFileName(name: string) {
  // Keep this in step with `interpretPath`, which decides the type of a file
  // afterwards: an extension accepted there but filtered out here would simply
  // never arrive.
  if (/\.(rul|yml|png|gif|nam)$/i.test(name))
    return true;
  // The globe's polygons, see `dat` in `interpretPath`. Matched by folder here
  // because the filter only sees the name, and the folder keeps fonts and other
  // binary DAT files out.
  if (/[\\/]geodata[\\/][^\\/]+\.dat$/i.test(name))
    return true;
  // Article bodies may be `Language/STR_ID.<lang>.html` (or `.txt`) instead of
  // yaml. Restricted to the Language folder so a pack's other HTML is still
  // not decompressed.
  return /[\\/]language[\\/][^\\/]+\.(html|txt)$/i.test(name);
}

/**
 * `path -> data` archive files, each paired with the role and mod folder
 * `interpretPath` gives it. Files the pedia has no use for are dropped.
 */
export function interpretFiles(files: { [name: string]: Uint8Array }) {
  let out: (InterpretedPath & { data: Uint8Array })[] = [];
  for (let [name, data] of Object.entries(files)) {
    let interpreted = interpretPath(name);
    if (interpreted)
      out.push({ ...interpreted, data });
  }
  return out;
}

/** Every lng/rul/meta file in an unpacked archive, decoded to text */
export function decodedYamlFiles(files: { [name: string]: Uint8Array }) {
  return interpretFiles(files)
    .filter(f => ["lng", "rul", "meta"].includes(f.type))
    .map(f => ({ ...f, text: new TextDecoder().decode(f.data) }));
}

export function loadYaml(text: string): any {
  text = text.replace(/!(add|info|remove)/g, '')
  return JSYaml.load(text, {
    json: true,
    onWarning: (e) => {
      console.error(e.message);
    }
  })
}

export function loadModsAndLng(files: { mod: string, path?: string, name?: string, ext?: string, text: string, type: string }[]) {

  let modName: string, mods = {} as { [name: string]: Mod };

  function addToLng(lngName: string, words: { [name: string]: any }) {
    let lng = mods[modName].lng;
    lng[lngName] ??= {}
    // A language file can leave a key with no value at all. Storing that as
    // `null` makes the string resolve to nothing, and for a bare language code
    // it shows up as a blank entry in the language dropdown, so those keys are
    // skipped. Any other value is kept as-is: translations may be numbers, and
    // OXCE plural forms (`STR_DAY: { one: ..., other: ... }`) are objects.
    for (let key in words) {
      let value = words[key];
      if (value == null)
        continue;
      lng[lngName][key] = value;
    }
  }

  for (let f of files) {

    modName = f.mod;

    mods[modName] ??= {
      dir: modName, lng: {}, rul: [], meta: {} as any,
      // `common` is not a mod: it holds resources and language strings shared
      // by all of them, and OpenXcom always loads it next to the active mods
      common: /(^|\/)common$/i.test(modName)
    }

    try {
      if (f.type == "lng") {
        let data = f.ext == "yml" ? loadYaml(f.text) : f.text;

        if (typeof data == "object" && data != null) {
          // A language file normally declares one language at the top level, but
          // some packs repeat the key; every block is read so none is dropped.
          let blocks = data as { [langName: string]: { [name: string]: any } };
          for (let lngName in blocks)
            addToLng(lngName, blocks[lngName])
        } else if (typeof data == "string") {
          // Non-yaml translations are named "STR_ID.<lang>.html"
          let [strName, lngName] = splitName(f.name ?? "");
          if (lngName)
            addToLng(lngName, { [strName]: data })
        }
      }
      if (f.type == "rul") {
        let data = loadYaml(f.text);
        mods[modName].rul.push(data)
      }
      if (f.type == "meta") {
        mods[modName].meta = loadYaml(f.text)
      }
    } catch (e) {
      console.error(`Error while parsing ${f.path}`, e)
    }
  }

  return mods;
}

/**
 * Maps every resource's path relative to its mod folder to the full archive
 * path, following OpenXcom's `FileMap`: mods are indexed from highest to lowest
 * priority, and the first definition of a relative path wins. `common` is
 * indexed last, so it only provides files no mod defines.
 */
export function buildResourceMap(interpreted: { mod: string, path: string, type?: string }[], active: Mod[]) {
  let map: { [rel: string]: string } = {};

  // Highest priority first: the later a mod is activated, the more it wins.
  // `common` is mapped last by OpenXcom, so it only fills in missing files.
  let priority = [...active.filter(m => !m.common).reverse(), ...active.filter(m => m.common)];

  for (let mod of priority) {
    let prefix = mod.dir + "/";
    for (let file of interpreted) {
      if (file.type != "img" && file.type != "nam" && file.type != "dat")
        continue;
      if (!file.path.startsWith(prefix))
        continue;
      let rel = file.path.substring(prefix.length).toLowerCase();
      if (!(rel in map))
        map[rel] = file.path;
    }
  }

  return map;
}

/**
 * The processed ruleset data of an archive, the shape `Ruleset` is built from.
 *
 * `files` must already contain the builtin mods underneath the pack's own, the
 * way `unpackData` merges them: a pack that ships a builtin path keeps its own
 * copy, because its files replace the builtin ones at the same path.
 *
 * `builtinDirs` names the mod folders that came from the builtin mods; when it
 * is given, the pack's own half is also returned separately, because that is
 * the only half the app stores. The stored copy keeps each mod's language files
 * untouched (`preprocessMods` deletes them), so the strings can be merged again
 * on every read.
 */
export function buildPackData(
  files: { [name: string]: Uint8Array },
  builtinDirs?: Set<string>
) {
  let interpretedFiles = interpretFiles(files);
  let mods = loadModsAndLng(decodedYamlFiles(files));

  for (let mod of Object.values(mods))
    if (builtinDirs?.has(mod.dir))
      mod.builtin = true;

  // The language files have to be taken before `preprocessMods`, which folds
  // them into `langs` and deletes the per-mod copy
  let ownMods = builtinDirs
    ? Object.values(mods).filter(mod => !mod.builtin)
    : undefined;

  let processed = Ruleset.preprocessMods(mods);

  // OpenXcom finds a resource by its path relative to the mod folder, so the
  // same relative path often exists in several mods. Build the index it ends
  // up with: later active mods override earlier ones and `common` fills gaps.
  let resources = buildResourceMap(interpretedFiles, processed.mods);

  // The saved index covers the pack's own files only; the builtin part is
  // added back on read, see `mergeBuiltinMods`. Filtering the final merge
  // order keeps exactly the relative order the full index was built with.
  let ownResources = builtinDirs
    ? buildResourceMap(
      interpretedFiles.filter(f => !builtinDirs.has(f.mod)),
      processed.mods.filter(m => !m.builtin))
    : undefined;

  return { processed: { ...processed, resources }, interpretedFiles, ownMods, ownResources };
}

/**
 * Keeps only the builtin mods that apply to `packName`: `xhelper-<name>` mods
 * are helpers for one specific modpack, so they are used only when the pack's
 * file name mentions `<name>` (case-insensitive). Everything else is shared.
 */
export function filterBuiltinMods(files: { [name: string]: Uint8Array }, packName?: string) {
  let pack = (packName ?? "").toLowerCase();
  let result: { [name: string]: Uint8Array } = {};
  for (let name in files) {
    // Builtin mods live under `mods/<mod>/…`; the helper's name is the part
    // after the prefix
    let mod = interpretPath(name)?.mod?.toLowerCase().replace(/^mods[/\\]/, "");
    if (mod?.startsWith(xhelperPrefix) && !pack.includes(mod.substring(xhelperPrefix.length)))
      continue;
    result[name] = files[name];
  }
  return result;
}

/**
 * The builtin mods, decoded from the container the build produces.
 *
 * The format is a flat binary list of `[name length][data length][name][data]`,
 * all lengths little-endian, gzipped as a whole; `vite.config.ts` writes it for
 * the app, and `scripts/build-cli.mjs` writes the same bytes for the CLI.
 */
export function unpackBuiltinMods(base64: string) {
  let compressed = new Uint8Array(base64ToArrayBuffer(base64));
  let data = fflate.gunzipSync(compressed);
  let view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let files: { [name: string]: Uint8Array } = {};
  for (let at = 0; at < data.length;) {
    let nameLength = view.getUint32(at, true);
    let dataLength = view.getUint32(at + 4, true);
    at += 8;
    let name = new TextDecoder().decode(data.subarray(at, at + nameLength));
    at += nameLength;
    files[name] = data.slice(at, at + dataLength);
    at += dataLength;
  }
  return files;
}

/**
 * The emoji icon map, merged from the mods that ship one.
 *
 * `icon` is a pseudo-language: it maps field and entry names to emoji rather
 * than translating anything. It must never be folded into the English strings,
 * see `Ruleset.preprocessMods`.
 */
function builtinIcons(mods: { [dir: string]: Mod }) {
  let result: { [name: string]: string } | undefined;
  for (let mod of Ruleset.activeMods(Object.values(mods))) {
    let icon = mod.lng?.icon;
    if (icon)
      result = { ...result, ...icon };
  }
  return result;
}

/**
 * Re-applies the builtin mods to a stored pack-only ruleset.
 *
 * New saves keep only the uploaded pack's own mods and language files; the
 * strings XPedia itself provides are added here on every read, so an updated
 * builtin mod takes effect for every installed pack without re-uploading
 * anything. A payload written by an older build has no per-mod `lng` but a
 * fully merged `langs` map, so it cannot be rebuilt; it is returned as stored,
 * except for its `icon` map, which is repaired (see below).
 *
 * Builtin mods go in first: `activeMods` keeps insertion order within a group,
 * and the builtin strings have to stay underneath the pack's own translations.
 */
export function mergeBuiltinMods(
  builtinFiles: { [name: string]: Uint8Array },
  stored: { mods?: Mod[], langs?: any, resources?: any }) {

  let builtinParsed = loadModsAndLng(decodedYamlFiles(builtinFiles));

  // Old payloads already carry the merged language maps and cannot be split
  // back into "builtin" and "pack" without the archive, so they load as-is.
  // Their `icon` map, however, was merged with the English strings by an older
  // build, which replaced every emoji with an English label. Those copies are
  // dropped and the real map is restored from the builtin mods.
  if (stored.langs) {
    let english = stored.langs[defaultLanguage] ?? {};
    let storedIcons = stored.langs.icon ?? {};
    let icons: { [name: string]: string } = {};
    for (let name in storedIcons)
      if (!(name in english) || storedIcons[name] !== english[name])
        icons[name] = storedIcons[name];
    let builtin = builtinIcons(builtinParsed);
    // The pack's own entries win over the builtin ones, as they do in the
    // normal load order
    if (builtin)
      icons = { ...builtin, ...icons };
    if (Object.keys(icons).length)
      stored.langs = { ...stored.langs, icon: icons };
    else
      delete stored.langs.icon;
    // A payload from an older build has no per-mod flag either; its builtin
    // mods are recognised by the folder they came from
    let builtinDirs = new Set(Object.keys(builtinParsed));
    for (let mod of stored.mods ?? [])
      if (builtinDirs.has(mod.dir))
        mod.builtin = true;
    return stored;
  }

  let mods: { [dir: string]: Mod } = {};

  // These mods belong to XPedia rather than to the uploaded pack, and the front
  // page says so by dimming them. The flag cannot be stored with the pack: only
  // its own mods are saved, so it is set again here on every read.
  for (let dir in builtinParsed)
    mods[dir] = { ...builtinParsed[dir], builtin: true };

  // A pack that ships its own `mods/<name>` folder was saved with that folder
  // as the pack's own data, because at upload time its files replaced the
  // builtin ones of the same path. Its saved copy is therefore complete, and
  // replacing the builtin mod here matches what the upload produced.
  for (let mod of stored.mods ?? [])
    mods[mod.dir] = mod;

  // Same order the save used, so asset overrides land on the same files
  let builtinActive = Ruleset.activeMods(Object.values(builtinParsed));
  let builtinInterpreted = interpretFiles(builtinFiles);

  let processed = Ruleset.preprocessMods(mods);

  // Assets shipped with the builtin mods are indexed again here, underneath
  // the pack's own entries, for the same reason the language strings are
  return {
    ...processed,
    resources: {
      ...buildResourceMap(builtinInterpreted, builtinActive),
      ...(stored.resources ?? {})
    }
  };
}

/* ------------------------------------------------------------------ */
/* Archives                                                            */
/* ------------------------------------------------------------------ */

export function unpackZip(data: ArrayBuffer): { [name: string]: Uint8Array } {
  let u8 = new Uint8Array(data);
  // Filter before inflating: large packs are mostly sounds and maps that would
  // otherwise be decompressed only to be dropped immediately afterwards
  return fflate.unzipSync(u8, { filter: f => !!usefulFileName(f.name) });
}

/**
 * Unpacks a RAR, given the unrar WebAssembly binary.
 *
 * The wasm is passed in rather than imported: the app compiles it into its
 * bundle as base64, the CLI reads the same file at build time, and neither
 * wants this module to know where it came from.
 *
 * `checkCancelled` may throw to abort: the browser loader uses it to unwind its
 * status window. `onProgress` may return a promise, which is awaited so the page
 * gets a chance to paint between batches.
 */
export async function unpackRar(
  data: ArrayBuffer,
  wasmBinary: ArrayBuffer,
  options: {
    onProgress?: (done: number, total: number, name?: string) => void | Promise<void>,
    checkCancelled?: () => void
  } = {}
): Promise<{ [name: string]: Uint8Array }> {

  const extractor = await unrar.createExtractorFromData({ wasmBinary, data });

  const list = extractor.getFileList();
  const fileHeaders = [...list.fileHeaders]; // load the file headers

  let rulHeaders = fileHeaders.map(f => f.name).filter(usefulFileName)

  let extracted = extractor.extract({ files: rulHeaders })

  let files: unrar.ArcFile<Uint8Array<ArrayBufferLike>>[] = []

  for (let f of extracted.files) {
    options.checkCancelled?.();
    files.push(f);
    if (files.length % 100 == 0)
      await options.onProgress?.(files.length, rulHeaders.length, f.fileHeader.name);
  }

  files = files.sort((a, b) => a.fileHeader.name.localeCompare(b.fileHeader.name));

  let out: { [name: string]: Uint8Array } = {};
  for (let file of files) {
    if (file.extraction)
      out[file.fileHeader.name] = file.extraction;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Install layout                                                      */
/* ------------------------------------------------------------------ */

/**
 * Maps an archive path to the path the same file has under the game directory.
 *
 * The archive stores files under the pack's own root folder, while the game
 * looks for them relative to its installation:
 *
 * - `<pack>/user/mods/<mod>/...` → `user/mods/<mod>/...`
 * - `<pack>/standard/<mod>/...`  → `standard/<mod>/...`
 * - `<pack>/common/...`          → `common/...`
 * - `<mod>/...` packed on its own → `user/mods/<mod>/...`
 *
 * This mirrors the layout rules in `interpretPath`.
 */
export function gameRelativePath(path: string): string {
  let parts = path.split(/[/\\]/).filter(p => p != "");
  let lower = parts.map(p => p.toLowerCase());

  for (let i = 0; i < parts.length; i++) {
    if (lower[i] == "user" && lower[i + 1] == "mods")
      return parts.slice(i).join("/");
    if (lower[i] == "standard" || lower[i] == "common" || lower[i] == "mods")
      return parts.slice(i).join("/");
  }

  // No recognised install folder: a mod that was packed on its own belongs
  // under `user/mods` when extracted next to the game
  return "user/mods/" + parts.join("/");
}
