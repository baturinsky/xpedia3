import * as fflate from "fflate";
import JSYaml from "js-yaml";
import * as unrar from "node-unrar-js";
import Ruleset, {
  defaultLanguage,
  type Langs,
  type Mod,
  type ProcessedRuleset,
} from "./rul/Ruleset";
import { base64ToArrayBuffer, gameRelativePath as utilGameRelativePath } from "./util";

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

/**
 * The `.cfg` files whose contents the pedia reads instead of ignoring.
 *
 * Only `options.cfg` is here, and only because it is where OpenXcom keeps the
 * player's enabled/disabled state for every installed mod: `Options::save`
 * writes `mods: [{ id, active }]` into `user/options.cfg`, and `Options::load`
 * reads it back. `metadata.yml` has no such field — `ModInfo::load` never reads
 * `active` — so a `metadata.yml` is no place to look for it.
 *
 * Every other `.cfg` in a pack is an engine config the pedia has no use for, so
 * the name is matched exactly rather than by extension.
 */
const cfgFileNames = ["options.cfg"];

/**
 * Whether a path is the game's own mod activation list.
 *
 * The test is "the folder holding it is called `user`", which covers every
 * layout at once: a pack root (`XPiratez/user/options.cfg`), and a bare game
 * root (`user/options.cfg`, which is what `--serve` is handed). A copy of the
 * file inside a *mod's* folder is the player's own rather than the pack's, so
 * that spelling is not recognised — there the parent folder is a mod name.
 *
 * Shared by `interpretPath` and `usefulFileName` so the two cannot drift: a
 * file the filter lets through but the reader does not recognise would arrive
 * only to be dropped.
 */
function isModActivationList(parts: string[]) {
  if (parts.length < 2) return false;
  const file = parts[parts.length - 1].toLowerCase();
  const folder = parts[parts.length - 2].toLowerCase();
  return folder == "user" && cfgFileNames.includes(file);
}

type AssetType = "lng" | "rul" | "meta" | "img" | "nam" | "dat" | "cfg";

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
  const extRegexp = /^(.+)\.([0-9a-z-]+)?$/i;
  const m = name.match(extRegexp);
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
  const parts = s.split(/[/\\]/).filter((p) => p != "");
  if (parts.length < 1) return;

  const lower = parts.map((p) => p.toLowerCase());
  /** How many leading segments make up the mod folder */
  let modLength = 1;

  if (lower[0] == "mods" && parts.length > 1) {
    // Builtin mods are packed without a pack folder in front
    modLength = 2;
  } else {
    const userMods = lower.findIndex((p, i) => p == "user" && lower[i + 1] == "mods");
    const standard = lower.indexOf("standard");
    const common = lower.indexOf("common");
    if (userMods >= 0 && parts.length > userMods + 2) modLength = userMods + 3;
    else if (standard >= 0 && parts.length > standard + 1) modLength = standard + 2;
    else if (common >= 0 && parts.length > common) modLength = common + 1;
  }

  const rel = parts.slice(modLength);
  if (!rel.length) return;

  const modParts = parts.slice(0, modLength);
  const mod = modParts.join("/");
  const file = rel[rel.length - 1];
  const dirs = rel.slice(0, -1);
  const [name, rawExt] = splitName(file);
  const ext = (rawExt ?? "").toLowerCase();
  const path = parts.join("/");

  if (file.toLowerCase() == "metadata.yml") return { type: "meta", mod, path };

  // The player's mod activation list, which lives in the game's `user/` folder
  // rather than in any mod. It is checked before the mod-relative rules below
  // because it is matched by its place in the layout, not by its mod.
  if (isModActivationList(parts)) return { type: "cfg", mod, path };

  // OpenXcom loads `<mod>/Language/<lang>.yml` and `<mod>/Ruleset/*.rul`; nested
  // variants such as `Language/OXCE/` are for the engine's own folder layout and
  // are not part of a mod's language set
  if (dirs.length && /^language$/i.test(dirs[dirs.length - 1]) && lngExts.includes(ext))
    return { type: "lng", mod, name, path, ext };

  if (assetExts.includes(ext)) {
    return {
      type: { nam: "nam", rul: "rul", gif: "img", png: "img" }[ext] as AssetType,
      mod,
      name,
      path,
      ext,
    };
  }

  // Only the globe's own folder: a pack's fonts and other DAT files are binary
  // and would cost unpacking and storage for nothing
  if (dataExts.includes(ext) && dirs.some((d) => /^geodata$/i.test(d)))
    return { type: "dat", mod, name, path, ext };

  return;
}

export function usefulFileName(name: string) {
  // Keep this in step with `interpretPath`, which decides the type of a file
  // afterwards: an extension accepted there but filtered out here would simply
  // never arrive.
  if (/\.(rul|yml|png|gif|nam)$/i.test(name)) return true;
  // The globe's polygons, see `dat` in `interpretPath`. Matched by folder here
  // because the filter only sees the name, and the folder keeps fonts and other
  // binary DAT files out.
  if (/[\\/]geodata[\\/][^\\/]+\.dat$/i.test(name)) return true;
  // Article bodies may be `Language/STR_ID.<lang>.html` (or `.txt`) instead of
  // yaml. Restricted to the Language folder so a pack's other HTML is still
  // not decompressed.
  if (/[\\/]language[\\/][^\\/]+\.(html|txt)$/i.test(name)) return true;
  // The player's mod activation list, see `isModActivationList`. Without this the
  // file is never decompressed, so a pack's enabled/disabled state is invisible.
  return isModActivationList(name.split(/[/\\]/).filter((p) => p != ""));
}

/**
 * `path -> data` archive files, each paired with the role and mod folder
 * `interpretPath` gives it. Files the pedia has no use for are dropped.
 */
export function interpretFiles(files: { [name: string]: Uint8Array }) {
  const out: (InterpretedPath & { data: Uint8Array })[] = [];
  for (const [name, data] of Object.entries(files)) {
    const interpreted = interpretPath(name);
    if (interpreted) out.push({ ...interpreted, data });
  }
  return out;
}

/** Every lng/rul/meta file in an unpacked archive, decoded to text */
export function decodedYamlFiles(files: { [name: string]: Uint8Array }) {
  return interpretFiles(files)
    .filter((f) => ["lng", "rul", "meta"].includes(f.type))
    .map((f) => ({ ...f, text: new TextDecoder().decode(f.data) }));
}

/**
 * The mods the player has switched off, from the pack's `user/options.cfg`.
 *
 * OpenXcom keeps activation in `options.cfg`, not in `metadata.yml`: `Options::save`
 * writes `mods: [{ id, active }]` and `Options::load` reads it back. A mod the
 * list does not mention is left to the default, which is "on", so a pack with no
 * `options.cfg` — every archive that was never played, and the usual case —
 * loads exactly as it would without this function.
 *
 * Ids are `metadata.yml`'s `id`, falling back to the folder name, which is what
 * `Ruleset.activeMods` compares against.
 */
export function disabledMods(files: { [name: string]: Uint8Array }): Set<string> {
  const off = new Set<string>();
  const cfg = Object.values(interpretFiles(files)).find((f) => f.type == "cfg");
  if (!cfg) return off;
  try {
    const data = loadYaml(new TextDecoder().decode(cfg.data));
    for (const entry of data?.mods ?? [])
      if (entry && typeof entry.id == "string" && entry.active === false) off.add(entry.id);
  } catch (e) {
    // A broken options.cfg is not worth failing a whole load over: the mods a
    // player disabled are a preference, and the pedia without it describes the
    // same archive, just with mods the player had switched off
    console.error(`Can't read ${cfg.path}`, e);
  }
  return off;
}

/**
 * Parses one YAML file of a modpack.
 *
 * There is no type to give the result: a `rul` file is arbitrary nested data
 * that the merge in `Ruleset.combineRuls` copies through untouched, and the
 * pedia only ever reads it field by field. Keeping it untyped here is what lets
 * a pack add a table the pedia does not know about without failing to load.
 */
export function loadYaml(text: string): any {
  text = text.replace(/!(add|info|remove)/g, "");
  return JSYaml.load(text, {
    json: true,
    onWarning: (e) => {
      console.error(e.message);
    },
  });
}

export function loadModsAndLng(
  files: { mod: string; path?: string; name?: string; ext?: string; text: string; type: string }[],
) {
  let modName: string,
    mods = {} as { [name: string]: Mod };

  function addToLng(lngName: string, words: { [name: string]: unknown }) {
    const lng = mods[modName].lng;
    lng[lngName] ??= {};
    // A language file can leave a key with no value at all. Storing that as
    // `null` makes the string resolve to nothing, and for a bare language code
    // it shows up as a blank entry in the language dropdown, so those keys are
    // skipped. Any other value is kept as-is: a translation may be a number, and
    // OXCE plural forms (`STR_DAY: { one: ..., other: ... }`) are objects.
    // `LangMap` calls them all strings because that is what every reader does
    // with them — `Ruleset.tr` substitutes the value for the id and treats it as
    // text — so the store is typed loosely and the cast is here.
    for (const key in words) {
      const value = words[key];
      if (value == null) continue;
      lng[lngName][key] = value as string;
    }
  }

  for (const f of files) {
    modName = f.mod;

    mods[modName] ??= {
      dir: modName,
      lng: {},
      rul: [],
      meta: {},
      // `common` is not a mod: it holds resources and language strings shared
      // by all of them, and OpenXcom always loads it next to the active mods
      common: /(^|\/)common$/i.test(modName),
    };

    try {
      if (f.type == "lng") {
        const data = f.ext == "yml" ? loadYaml(f.text) : f.text;

        if (typeof data == "object" && data != null) {
          // A language file normally declares one language at the top level, but
          // some packs repeat the key; every block is read so none is dropped.
          const blocks = data as Langs;
          for (const lngName in blocks) addToLng(lngName, blocks[lngName]);
        } else if (typeof data == "string") {
          // Non-yaml translations are named "STR_ID.<lang>.html"
          const [strName, lngName] = splitName(f.name ?? "");
          if (lngName) addToLng(lngName, { [strName]: data });
        }
      }
      if (f.type == "rul") {
        const data = loadYaml(f.text);
        mods[modName].rul.push(data);
      }
      if (f.type == "meta") {
        mods[modName].meta = loadYaml(f.text);
      }
    } catch (e) {
      console.error(`Error while parsing ${f.path}`, e);
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
export function buildResourceMap(
  interpreted: { mod: string; path: string; type?: string }[],
  active: Mod[],
) {
  const map: { [rel: string]: string } = {};

  // Highest priority first: the later a mod is activated, the more it wins.
  // `common` is mapped last by OpenXcom, so it only fills in missing files.
  const priority = [
    ...active.filter((m) => !m.common).reverse(),
    ...active.filter((m) => m.common),
  ];

  for (const mod of priority) {
    const prefix = mod.dir + "/";
    for (const file of interpreted) {
      if (file.type != "img" && file.type != "nam" && file.type != "dat") continue;
      if (!file.path.startsWith(prefix)) continue;
      const rel = file.path.substring(prefix.length).toLowerCase();
      if (!(rel in map)) map[rel] = file.path;
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
  builtinDirs?: Set<string>,
  /**
   * Whether to also return the pack's own half, the form the database stores.
   *
   * The copy of every mod's parsed ruleset is not free — a total conversion
   * carries the whole ruleset per mod — so a caller that only wants to render
   * the pedia, such as the live server, can say no. `builtinDirs` alone cannot
   * express that: it is also what marks the builtin mods, and those have to be
   * marked whether or not anything is stored.
   */
  storeOwn = true,
) {
  const interpretedFiles = interpretFiles(files);
  const mods = loadModsAndLng(decodedYamlFiles(files));
  // Which of them the player switched off, from the pack's own `user/options.cfg`
  const disabled = disabledMods(files);

  for (const mod of Object.values(mods)) if (builtinDirs?.has(mod.dir)) mod.builtin = true;

  // The pack's own half, as it must be *stored*: with its language files.
  // `preprocessMods` folds those into the merged table and then deletes the
  // per-mod copy, and it deletes it on the very same objects, so this has to be
  // a deep copy taken first. A reference here would arrive at the database
  // already stripped, and a stored pack would then lose every string it
  // translated — including another language's name for itself.
  const ownMods =
    builtinDirs && storeOwn
      ? JSON.parse(JSON.stringify(Object.values(mods).filter((mod) => !mod.builtin)))
      : undefined;

  const processed = Ruleset.preprocessMods(mods, disabled);

  // OpenXcom finds a resource by its path relative to the mod folder, so the
  // same relative path often exists in several mods. Build the index it ends
  // up with: later active mods override earlier ones and `common` fills gaps.
  const resources = buildResourceMap(interpretedFiles, processed.mods);

  // The saved index covers the pack's own files only; the builtin part is
  // added back on read, see `mergeBuiltinMods`. Filtering the final merge
  // order keeps exactly the relative order the full index was built with.
  const ownResources =
    builtinDirs && storeOwn
      ? buildResourceMap(
          interpretedFiles.filter((f) => !builtinDirs.has(f.mod)),
          processed.mods.filter((m) => !m.builtin),
        )
      : undefined;

  return {
    processed: {
      ...processed,
      resources,
      // The activation state has to survive storage: a saved pack keeps only its
      // own mods, so without this a pack the player had switched mods off in
      // would come back with everything on the next time it is opened
      ...(disabled.size ? { disabled: [...disabled] } : {}),
    },
    interpretedFiles,
    ownMods,
    ownResources,
  };
}

/**
 * Keeps only the builtin mods that apply to `packName`: `xhelper-<name>` mods
 * are helpers for one specific modpack, so they are used only when the pack's
 * file name mentions `<name>` (case-insensitive). Everything else is shared.
 */
export function filterBuiltinMods(files: { [name: string]: Uint8Array }, packName?: string) {
  const pack = (packName ?? "").toLowerCase();
  const result: { [name: string]: Uint8Array } = {};
  for (const name in files) {
    // Builtin mods live under `mods/<mod>/…`; the helper's name is the part
    // after the prefix
    const mod = interpretPath(name)
      ?.mod?.toLowerCase()
      .replace(/^mods[/\\]/, "");
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
  const compressed = new Uint8Array(base64ToArrayBuffer(base64));
  const data = fflate.gunzipSync(compressed);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const files: { [name: string]: Uint8Array } = {};
  for (let at = 0; at < data.length; ) {
    const nameLength = view.getUint32(at, true);
    const dataLength = view.getUint32(at + 4, true);
    at += 8;
    const name = new TextDecoder().decode(data.subarray(at, at + nameLength));
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
  for (const mod of Ruleset.activeMods(Object.values(mods))) {
    const icon = mod.lng?.icon;
    if (icon) result = { ...result, ...icon };
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
  stored: ProcessedRuleset,
): ProcessedRuleset {
  const builtinParsed = loadModsAndLng(decodedYamlFiles(builtinFiles));

  // Old payloads already carry the merged language maps and cannot be split
  // back into "builtin" and "pack" without the archive, so they load as-is.
  // Their `icon` map, however, was merged with the English strings by an older
  // build, which replaced every emoji with an English label. Those copies are
  // dropped and the real map is restored from the builtin mods.
  if (stored.langs) {
    const english = stored.langs[defaultLanguage] ?? {};
    const storedIcons = stored.langs.icon ?? {};
    let icons: { [name: string]: string } = {};
    for (const name in storedIcons)
      if (!(name in english) || storedIcons[name] !== english[name])
        icons[name] = storedIcons[name];
    const builtin = builtinIcons(builtinParsed);
    // The pack's own entries win over the builtin ones, as they do in the
    // normal load order
    if (builtin) icons = { ...builtin, ...icons };
    if (Object.keys(icons).length) stored.langs = { ...stored.langs, icon: icons };
    else delete stored.langs.icon;
    // A payload from an older build has no per-mod flag either; its builtin
    // mods are recognised by the folder they came from
    const builtinDirs = new Set(Object.keys(builtinParsed));
    for (const mod of stored.mods ?? []) if (builtinDirs.has(mod.dir)) mod.builtin = true;
    return stored;
  }

  const mods: { [dir: string]: Mod } = {};

  // These mods belong to XPedia rather than to the uploaded pack, and the front
  // page says so by dimming them. The flag cannot be stored with the pack: only
  // its own mods are saved, so it is set again here on every read.
  for (const dir in builtinParsed) mods[dir] = { ...builtinParsed[dir], builtin: true };

  // A pack that ships its own `mods/<name>` folder was saved with that folder
  // as the pack's own data, because at upload time its files replaced the
  // builtin ones of the same path. Its saved copy is therefore complete, and
  // replacing the builtin mod here matches what the upload produced.
  for (const mod of stored.mods ?? []) mods[mod.dir] = mod;

  // Same order the save used, so asset overrides land on the same files. The
  // flag is set here because `builtinParsed` comes straight from the parser,
  // which knows the folders but not that they ship inside XPedia.
  const builtinActive = Ruleset.activeMods(
    Object.values(builtinParsed).map((mod) => ({ ...mod, builtin: true })),
  );
  const builtinInterpreted = interpretFiles(builtinFiles);

  // The player's own enabled/disabled list is stored with the pack, so the mods
  // they switched off stay off on every read rather than only on the upload
  const processed = Ruleset.preprocessMods(
    mods,
    stored.disabled?.length ? new Set(stored.disabled) : undefined,
  );

  // Assets shipped with the builtin mods are indexed again here, underneath
  // the pack's own entries, for the same reason the language strings are
  return {
    ...processed,
    resources: {
      ...buildResourceMap(builtinInterpreted, builtinActive),
      ...(stored.resources ?? {}),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Archives                                                            */
/* ------------------------------------------------------------------ */

export function unpackZip(data: ArrayBuffer): { [name: string]: Uint8Array } {
  const u8 = new Uint8Array(data);
  // Filter before inflating: large packs are mostly sounds and maps that would
  // otherwise be decompressed only to be dropped immediately afterwards
  return fflate.unzipSync(u8, { filter: (f) => !!usefulFileName(f.name) });
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
    onProgress?: (done: number, total: number, name?: string) => void | Promise<void>;
    checkCancelled?: () => void;
  } = {},
): Promise<{ [name: string]: Uint8Array }> {
  const extractor = await unrar.createExtractorFromData({ wasmBinary, data });

  const list = extractor.getFileList();
  const fileHeaders = [...list.fileHeaders]; // load the file headers

  const rulHeaders = fileHeaders.map((f) => f.name).filter(usefulFileName);

  const extracted = extractor.extract({ files: rulHeaders });

  let files: unrar.ArcFile<Uint8Array<ArrayBufferLike>>[] = [];

  for (const f of extracted.files) {
    options.checkCancelled?.();
    files.push(f);
    if (files.length % 100 == 0)
      await options.onProgress?.(files.length, rulHeaders.length, f.fileHeader.name);
  }

  files = files.sort((a, b) => a.fileHeader.name.localeCompare(b.fileHeader.name));

  const out: { [name: string]: Uint8Array } = {};
  for (const file of files) {
    if (file.extraction) out[file.fileHeader.name] = file.extraction;
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
 * This mirrors the layout rules in `interpretPath`. The implementation is in
 * `util` so the ruleset can share it without importing this module.
 */
export const gameRelativePath = utilGameRelativePath;
