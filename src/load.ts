import { wasmBinary } from "./main";
import { state, update, slowProcessCancelRequested, resetSlowProcessCancel, autoCloseStatus } from "./state";
import * as unrar from 'node-unrar-js'
import { listDir, delay, readTextFile, inform, warn, base64ToArrayBuffer, asMB } from "./util";
import { fileTypeFromBuffer } from "file-type";
import * as fflate from 'fflate';
import JSYaml from "js-yaml";
import Ruleset, { defaultLanguage, Mod } from "./rul/Ruleset";
import { saveFile, saveImgs, saveRul, saveStats, wipeAssets, eraseArchiveFile, updateFileStats, applySavedLanguage } from "./idb";
import builtinModsPayload from './builtinMods?builtinMods'


const assetExts = ["rul", "nam", "png", "gif"]
const lngExts = ["yml", "html", "txt"]

/**
 * Extensions that are read as raw bytes and never shown directly.
 *
 * `dat` is the X-Com image format: 8-bit pixel dumps and the globe's land
 * polygons. Only the globe is used so far, to draw the world map, but the file
 * has to be unpacked and indexed before it can be found at all.
 */
const dataExts = ["dat"]


type AssetType = "lng" | "rul" | "meta" | "img" | "nam" | "dat"

async function loadBuiltinPack(packname: string, rawPack: string) {
  let binary = base64ToArrayBuffer(rawPack);
  let files = await unpackData(packname, binary);
}

/** Prefix of the builtin mod directories that exist for a single modpack only */
const xhelperPrefix = "xhelper-";

/** Pseudo pack name used to cache assets that come from the builtin mods */
const builtinPackName = "builtin";

/**
 * The builtin mods, compiled in from the plain `src/builtinMods` folder.
 *
 * They used to be a zip, which had to be unpacked and repacked to change a
 * single string. The folder is read at build time by the `builtin-mods` plugin
 * in `vite.config.ts`, which ships it as one gzipped binary container; the
 * format is described there.
 */
function unpackBuiltinMods() {
  let compressed = new Uint8Array(base64ToArrayBuffer(builtinModsPayload));
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
 * A file that came with the builtin mods, by archive path.
 *
 * The globe data has to be available for every pack, and reading it from the
 * compiled-in folder makes that work whether or not the builtin assets were
 * cached in the database: an exported page opened from disk has no database to
 * read them from.
 */
export function builtinFile(path: string) {
  let wanted = path.replace(/\\/g, "/").toLowerCase();
  for (let [name, data] of Object.entries(builtinFiles()))
    if (name.toLowerCase() == wanted)
      return data;
}

/** The unpacked builtin folder, kept because gunzipping it is not free */
let cachedBuiltinFiles: { [name: string]: Uint8Array } | undefined;

function builtinFiles() {
  return cachedBuiltinFiles ??= unpackBuiltinMods();
}

/**
 * Keeps only the builtin mods that apply to `packName`: `xhelper-<name>` mods
 * are helpers for one specific modpack, so they are used only when the pack's
 * file name mentions `<name>` (case-insensitive). Everything else is shared.
 */
function filterBuiltinMods(files: { [name: string]: Uint8Array }, packName?: string) {
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

/** The builtin mod files that apply to the given modpack */
async function builtinModFiles(packName?: string) {
  return filterBuiltinMods(unpackBuiltinMods(), packName);
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
 * strings XPedia itself provides are added here on every read, so a new
 * `builtinMods.zip` takes effect for every installed pack without re-uploading
 * anything. A payload written by an older build has no per-mod `lng` but a
 * fully merged `langs` map, so it cannot be rebuilt; it is returned as stored,
 * except for its `icon` map, which is repaired (see below).
 *
 * Builtin mods go in first: `activeMods` keeps insertion order within a group,
 * and the builtin strings have to stay underneath the pack's own translations.
 */
export async function mergeBuiltinMods(stored: { mods?: Mod[], langs?: any, resources?: any }, packName?: string) {
  let builtinFiles = await builtinModFiles(packName);
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
  let builtinInterpreted = Object.entries(builtinFiles)
    .map(([name, data]) => ({ ...interpretPath(name), data }));

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

/** Every lng/rul/meta file in an unpacked archive, decoded to text */
function decodedYamlFiles(files: { [name: string]: Uint8Array }) {
  return Object.entries(files)
    .map(([name, data]) => ({ ...interpretPath(name), data }))
    .filter(f => ["lng", "rul", "meta"].includes(f.type))
    .map(f => ({ ...f, text: new TextDecoder().decode(f.data) }));
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
export function interpretPath(s: string): {
  type: AssetType;
  mod: string;
  path: string;
  name?: string;
  ext?: string;
} {
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


function usefulFileName(name: string) {
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

export function createDirTree(files: { [name: string]: any }) {
  let root = {};
  for (let path of Object.keys(files)) {
    let parts = path.split(/[/\\]/);
    let at = root, prev, part;
    for (part of parts) {
      let dir = at[part];
      if (!dir) {
        dir = {}
        at[part] = dir;
      }
      prev = at;
      at = dir;
    }
    prev[part] = files[path]
  }
  return root;
}

export async function unpackZip(name: string, data: ArrayBuffer) {
  let u8 = new Uint8Array(data);
  // Filter before inflating: large packs are mostly sounds and maps that would
  // otherwise be decompressed only to be dropped immediately afterwards
  let files = fflate.unzipSync(u8, { filter: f => !!usefulFileName(f.name) });
  return files;
}

export async function unpackRar(name: string, data: ArrayBuffer) {
  const extractor = await unrar.createExtractorFromData({ wasmBinary, data });

  const list = extractor.getFileList();
  const fileHeaders = [...list.fileHeaders]; // load the file headers

  let rulHeaders = fileHeaders.map(f => f.name).filter(usefulFileName)

  let extracted = extractor.extract({ files: rulHeaders })

  await delay(10);

  let files: unrar.ArcFile<Uint8Array<ArrayBufferLike>>[] = []

  for (let f of extracted.files) {
    throwIfCancelled();
    files.push(f);
    let name = f.fileHeader.name
    if (files.length % 100 == 0) {
      await delay(0)
      reportStage("Unpacking", files.length / (rulHeaders.length || 1),
        `${files.length}/${rulHeaders.length} files: ${name ?? "archive"}`)
    }
  }

  files = files.sort((a, b) => a.fileHeader.name.localeCompare(b.fileHeader.name));

  return Object.fromEntries(files.map(file => [file.fileHeader.name, file.extraction]));
}

/** Message shown when the user aborts a load from the status window */
function cancelledMessage(packName?: string) {
  return `Cancelled loading ${packName ?? "pack"}`;
}

/** Thrown through the load pipeline once the user cancels, unwinds every stage */
class LoadCancelled extends Error {
  constructor() {
    super("Load cancelled");
  }
}

/** Aborts the current load if the Cancel button was pressed */
function throwIfCancelled() {
  if (slowProcessCancelRequested)
    throw new LoadCancelled();
}

/**
 * Reports a named loading stage. `progress` is the share of that stage that is
 * done, 0..1; the status window turns it into a bar and a percentage so a long
 * load visibly keeps moving instead of looking frozen.
 */
function reportStage(stage: string, progress: number, detail?: string) {
  let pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  update({
    slowProcessStage: stage,
    slowProcessProgress: progress,
    slowProcessStatus: detail ? `${stage}: ${detail} (${pct}%)` : `${stage}... ${pct}%`
  });
}

/**
 * Gives the browser a chance to paint the status window. Without this the whole
 * pipeline runs in one task and the user only ever sees the first message.
 */
function nextPaint() {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

/** Reports a stage and lets it become visible before the work continues */
async function beginStage(stage: string, detail?: string) {
  reportStage(stage, 0, detail);
  await nextPaint();
}

async function unpackArchive(packName: string, data: ArrayBuffer) {
  throwIfCancelled();

  reportStage("Reading archive", 0, `${packName ?? ""} (${asMB(data.byteLength)})`);
  await nextPaint();

  let fileType = await fileTypeFromBuffer(data).catch(() => undefined);

  let files: { [name: string]: Uint8Array };

  try {
    if (!fileType)
      throw new Error("Unknown file type");
    await beginStage("Unpacking", `${packName ?? "archive"} (${asMB(data.byteLength)})`);
    if (fileType.ext == "rar") {
      files = await unpackRar(packName, data)
    } else {
      files = await unpackZip(packName, data)
    }
    reportStage("Unpacking", 1, `${Object.keys(files).length} files from ${packName ?? "archive"}`);
  } catch (e) {
    // Cancellation is not a format error, let it unwind to `unpackData`
    if (e instanceof LoadCancelled)
      throw e;
    console.error(e);
    update({
      slowProcessStatus: `Could not unpack ${packName}: only RAR and ZIP archives are supported`,
      slowProcessDone: true, slowProcessError: true, slowProcessProgress: undefined
    })
    return null
  }

  throwIfCancelled();

  return files;

}

/** Builds the processed ruleset data from unpacked archive files */
async function buildRuleset(files: { [name: string]: Uint8Array },
  report: (stage: string, progress: number, detail?: string) => Promise<void>,
  builtinDirs?: Set<string>) {

  await report("Reading files", 0, `${Object.keys(files).length} files`);

  let interpretedFiles = Object.entries(files).map(([name, data]) => ({ ...interpretPath(name), data }));

  /**A list of all lng/rul/meta files in the pack, with the full pathes */
  let decodedYamls = decodedYamlFiles(files);

  await report("Parsing rules", 0, `${decodedYamls.length} files`);

  let mods = loadModsAndLng(decodedYamls);

  for (let mod of Object.values(mods))
    if (builtinDirs?.has(mod.dir))
      mod.builtin = true;

  // Only the uploaded pack's own mods are stored, with their language files
  // still inside each mod. `preprocessMods` deletes `lng` from every mod after
  // merging the strings, so the JSON has to be taken first.
  let ownModsJson = builtinDirs
    ? JSON.stringify(Object.values(mods).filter(mod => !mod.builtin))
    : undefined;

  await report("Building ruleset", 0, `${Object.keys(mods).length} mod(s)`);

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

  await report("Building ruleset", 1, `${Object.keys(mods).length} mod(s)`);

  return { processed: { ...processed, resources }, interpretedFiles, ownModsJson, ownResources };
}

/** The mod folders a set of archive files belongs to, see `interpretPath` */
function modDirs(files: { [name: string]: Uint8Array }) {
  let dirs = new Set<string>();
  for (let name of Object.keys(files)) {
    let mod = interpretPath(name)?.mod;
    if (mod)
      dirs.add(mod);
  }
  return dirs;
}

/**
 * Maps every resource's path relative to its mod folder to the full archive
 * path, following OpenXcom's `FileMap`: mods are indexed from highest to lowest
 * priority, and the first definition of a relative path wins. `common` is
 * indexed last, so it only provides files no mod defines.
 */
function buildResourceMap(interpreted: { mod: string, path: string, type?: string }[], active: Mod[]) {  let map: { [rel: string]: string } = {};

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
 * Loads only the builtin mods shared by every modpack. This is what the app
 * uses when no modpack is loaded, so there is always a ruleset to browse.
 */
export async function loadBuiltinOnlyPack() {
  let files = await builtinModFiles();
  let { processed, interpretedFiles } = await buildRuleset(files, async () => { });

  // Builtin images and globe data are not part of any stored archive, so they
  // are cached under the "builtin" pack just like a real load would. A page
  // without storage (an exported file opened from disk) still browses fine, just
  // without them.
  let images = interpretedFiles.filter(f => f.type == "img");
  let dataFiles = interpretedFiles.filter(f => f.type == "dat");
  try {
    if (images.length || dataFiles.length) {
      await wipeAssets(builtinPackName);
      if (images.length)
        await saveImgs(builtinPackName, images.map(img => ({ mod: img.mod, path: img.path, data: img.data })));
      if (dataFiles.length)
        await saveImgs(builtinPackName, dataFiles.map(f => ({ mod: f.mod, path: f.path, data: f.data })));
    }
  } catch (e) {
    console.warn("Can't cache builtin images", e);
  }

  let rul = new Ruleset(processed);
  applySavedLanguage(rul);
  update({ rul, packName: undefined });
  return rul;
}

export async function unpackData(packName: string, data: ArrayBuffer) {

  try {
    let builtinMods = await builtinModFiles(packName);

    let files = await unpackArchive(packName, data);

    // The error state is already set by `unpackArchive`
    if (!files)
      return;

    if (!Object.keys(files).length) {
      update({ slowProcessStatus: `Nothing usable found in ${packName}`,
        slowProcessDone: true, slowProcessError: true, slowProcessProgress: undefined })
      return;
    }

    // A pack that ships its own copy of a builtin mod path keeps it as its own
    // data, so those files are not mistaken for the builtin contribution
    let packDirs = modDirs(files);
    let builtinDirs = new Set([...modDirs(builtinMods)].filter(dir => !packDirs.has(dir)));

    files = { ...builtinMods, ...files };

    let { processed, interpretedFiles, ownModsJson, ownResources } = await buildRuleset(files, async (stage, progress, detail) => {
      reportStage(stage, progress, detail);
      await nextPaint();
    }, builtinDirs);

    throwIfCancelled();

    let images = interpretedFiles.filter(f => f.type == "img");
    let assetsSize = images.reduce((sum, img) => sum + img.data.byteLength, 0);

    await beginStage("Saving images", `${images.length} images`);

    await wipeAssets(packName);

    throwIfCancelled();

    // Batched writes are much faster than one transaction per image, and the
    // progress callback keeps the window alive during the slowest stage
    await saveImgs(packName, images.map(img => ({ mod: img.mod, path: img.path, data: img.data })),
      async done => {
        throwIfCancelled();
        reportStage("Saving images", done / (images.length || 1), `${done}/${images.length}`);
        await nextPaint();
      });

    // The globe's DAT files are stored like images, so the map can be drawn
    // without the archive having to be unpacked again
    let dataFiles = interpretedFiles.filter(f => f.type == "dat");
    if (dataFiles.length)
      await saveImgs(packName, dataFiles.map(f => ({ mod: f.mod, path: f.path, data: f.data })));

    throwIfCancelled();

    reportStage("Saving ruleset", 0);
    await nextPaint();

    // A saved pack holds only its own mods and resources, so a later
    // `builtinMods.zip` is picked up without re-uploading the archive.
    // `langs` is deliberately absent: that is how `mergeBuiltinMods`
    // recognizes this format.
    let stringifiedRul = `{"mods":${ownModsJson},"resources":${JSON.stringify(ownResources)}}`;

    // Compression is CPU-bound and blocking; the native stream version is
    // several times faster here and produces a gzip payload fflate can read
    let compressedRul = await gzipBytes(new TextEncoder().encode(stringifiedRul));

    reportStage("Saving ruleset", 1);

    // The archive is only kept in developer mode, so it only takes storage
    // there; in the normal mode the pedia consists of the images and ruleset
    await saveStats(packName, state.devView ? data.byteLength : 0, assetsSize, compressedRul.length)
    await saveRul(packName, compressedRul)

    let rul = new Ruleset(processed);
    applySavedLanguage(rul);

    let names = Object.values(rul.mods ?? {})
      .map((m: any) => [m.meta?.name, m.meta?.version].filter(Boolean).join(" "))
      .filter(Boolean);

    update({
      rul, packName,
      slowProcessDone: true, slowProcessError: false, slowProcessProgress: undefined,
      slowProcessStatus: `Loaded ${packName}: ${Object.keys(rul.articles).length} articles, ` +
        `${Object.keys(rul.items ?? {}).length} items, ${rul.langNames?.length ?? 0} languages` +
        (names.length ? ` — ${names.join(", ")}` : "")
    });

    // The URL still names the article the user was reading, so let the
    // navigation layer resolve it against the freshly loaded ruleset instead
    // of stranding the user on the landing page
    window.dispatchEvent(new CustomEvent("xpedia:loaded"));

    return files
  } catch (e) {
    // Cancellation has to reach `uploadUsersFiles`, which owns the archive
    // record and can remove it; only report real failures here
    if (e instanceof LoadCancelled)
      throw e;
    console.error(e);
    update({ slowProcessDone: true, slowProcessError: true, slowProcessProgress: undefined,
      slowProcessStatus: `Failed to load ${packName}: ${e?.message ?? e}` })
    throw e;
  }
}

/** Compresses bytes as gzip, preferring the native stream when available */
async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream == "undefined")
    return fflate.compressSync(bytes);
  let stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const extRegexp = /^(.+)\.([0-9a-z\-]+)?$/i;

function splitName(name) {
  let m = name.match(extRegexp);
  return m ? [m[1], m[2]] : [name, ""];
}

function loadYaml(text: string) {
  text = text.replace(/!(add|info|remove)/g, '')
  return JSYaml.load(text, {
    json: true,
    skipInvalid: true,
    onWarning: (e) => {
      console.error(e.message);
    }
  })
}

function loadModsAndLng(files: { mod: string, path?: string, name?: string, ext?: string, text: string, type: string }[]) {

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

    //if(modName != "Dioxine_XPiratez") debugger;

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
          for (let lngName in data)
            addToLng(lngName, data[lngName])
        } else if (typeof data == "string") {
          // Non-yaml translations are named "STR_ID.<lang>.html"
          let [strName, lngName] = splitName(f.name);
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
      console.error(`Erroe while parsing ${f.path}`, e)
    }
  }

  return mods;
}

export async function uploadUsersFiles(fileList: FileList) {
  const files = Array.from(fileList);
  if (!files.length)
    return;

  resetSlowProcessCancel();
  update({
    slowProcessStatus: `Uploading ${files.length} file(s)...`,
    slowProcessStage: "Uploading", slowProcessProgress: 0,
    slowProcessDone: false, slowProcessError: false, slowProcessCancellable: true
  })

  /** Removes the half-installed pack so it can't be opened later */
  async function abandon(pack: string, reason: string) {
    console.warn(`Cancelling ${pack}: ${reason}`);
    resetSlowProcessCancel();
    try {
      await wipeAssets(pack);
      await eraseArchiveFile(pack);
    } catch (e) {
      console.error("Could not clean up the cancelled pack", e);
    }
    updateFileStats();
    update({
      slowProcessDone: true, slowProcessError: true, slowProcessCancellable: false,
      slowProcessProgress: undefined,
      slowProcessStatus: `${reason}. Nothing was installed.`
    });
  }

  for (const file of files) {
    try {
      throwIfCancelled();
      reportStage("Reading archive", 0, `${file.name} (${asMB(file.size)})`);
      let data = await file.arrayBuffer();
      await saveFile(file.name, data);
    } catch (e) {
      await abandon(file.name, e instanceof LoadCancelled
        ? cancelledMessage(file.name)
        : `Could not load ${file.name}: ${e?.message ?? e}`);
      return;
    }
    // The archive is already stored at this point, so a late cancel must
    // still remove it — unless the load had in fact already succeeded
    if (slowProcessCancelRequested && !state.slowProcessDone) {
      await abandon(file.name, cancelledMessage(file.name));
      return;
    }
    resetSlowProcessCancel();
  }

  // Every successful path ends in a "Loaded ..." status from `unpackData`
  if (slowProcessCancelRequested && !state.slowProcessDone) {
    let last = files[files.length - 1];
    await abandon(last.name, cancelledMessage(last.name));
  } else if (!state.slowProcessDone) {
    update({ slowProcessDone: true, slowProcessCancellable: false });
  }

  // The upload is over, so its window closes on its own instead of waiting for
  // a click. Failures keep theirs: the message says what went wrong.
  if (state.slowProcessDone && !state.slowProcessError)
    autoCloseStatus();

  resetSlowProcessCancel();
}
