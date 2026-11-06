import { wasmBinary } from "./main";
import { state, update, slowProcessCancelRequested, resetSlowProcessCancel } from "./state";
import * as unrar from 'node-unrar-js'
import { listDir, delay, readTextFile, inform, warn, base64ToArrayBuffer, asMB } from "./util";
import { fileTypeFromBuffer } from "file-type";
import * as fflate from 'fflate';
import JSYaml from "js-yaml";
import Ruleset, { Mod } from "./rul/Ruleset";
import { saveFile, saveImgs, saveRul, saveStats, wipeAssets, eraseArchiveFile, updateFileStats, applySavedLanguage } from "./idb";
//@ts-ignore
import builtinModsArchive from './builtinMods.zip?base64'


const assetExts = ["rul", "nam", "png", "gif"]
const lngExts = ["yml", "html", "txt"]


type AssetType = "lng" | "rul" | "meta" | "img" | "nam"

async function loadBuiltinPack(packname: string, rawPack: string) {
  let binary = base64ToArrayBuffer(rawPack);
  let files = await unpackData(packname, binary);
}

/** Prefix of the builtin mod directories that exist for a single modpack only */
const xhelperPrefix = "xhelper-";

/** Pseudo pack name used to cache assets that come from the builtin mods */
const builtinPackName = "builtin";

/** Unpacks the embedded builtin mods without touching the status window */
async function unpackBuiltinMods() {
  return unpackZip("builtin", base64ToArrayBuffer(builtinModsArchive));
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
    let mod = interpretPath(name)?.mod?.toLowerCase();
    if (mod?.startsWith(xhelperPrefix) && !pack.includes(mod.substring(xhelperPrefix.length)))
      continue;
    result[name] = files[name];
  }
  return result;
}

/** The builtin mod files that apply to the given modpack */
async function builtinModFiles(packName?: string) {
  return filterBuiltinMods(await unpackBuiltinMods(), packName);
}


/**From the path, figure the type and mod of the file */
export function interpretPath(s: string): {
  type: AssetType;
  mod: string;
  path: string;
  name?: string;
  ext?: string;
} {
  let parts = s.split(/[/\\]/).filter(p => p != "");

  // Mods may be packed either under "mods/<mod>/..." or directly as
  // "<mod>/..." at the archive root
  if (parts[0] == "mods")
    parts.shift();

  if (parts.length < 2)
    return;

  let mod = parts[0];
  let file = parts[parts.length - 1];
  let dirs = parts.slice(1, -1);
  let [name, rawExt] = splitName(file);
  let ext = (rawExt ?? "").toLowerCase();

  if (file.toLowerCase() == "metadata.yml")
    return { type: "meta", mod, path: `${mod}/metadata.yml` };

  if (dirs.some(dir => /^Language$/i.test(dir)) && lngExts.includes(ext))
    return { type: "lng", mod, name, path: parts.join("/"), ext };

  if (assetExts.includes(ext)) {
    return {
      type: { nam: "nam", rul: "rul", gif: "img", png: "img" }[ext] as AssetType,
      mod, name, path: parts.join("/"), ext
    }
  }
}


function usefulFileName(name: string) {
  return name.match(/\.(rul|yml|png|gif|nam)$/)
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
  report: (stage: string, progress: number, detail?: string) => Promise<void>) {

  await report("Reading files", 0, `${Object.keys(files).length} files`);

  let interpretedFiles = Object.entries(files).map(([name, data]) => ({ ...interpretPath(name), data }));

  /**A list of all lng/rul/meta files in the pack, with the full pathes */
  let decodedYamls = interpretedFiles.filter(f => ["lng", "rul", "meta"].includes(f.type))
    .map(f => ({ ...f, text: new TextDecoder().decode(f.data) }))

  await report("Parsing rules", 0, `${decodedYamls.length} files`);

  let mods = loadModsAndLng(decodedYamls);

  await report("Building ruleset", 0, `${Object.keys(mods).length} mod(s)`);

  let processed = Ruleset.preprocessMods(mods);

  await report("Building ruleset", 1, `${Object.keys(mods).length} mod(s)`);

  return { processed, interpretedFiles };
}

/**
 * Loads only the builtin mods shared by every modpack. This is what the app
 * uses when no modpack is loaded, so there is always a ruleset to browse.
 */
export async function loadBuiltinOnlyPack() {
  let files = await builtinModFiles();
  let { processed, interpretedFiles } = await buildRuleset(files, async () => { });

  // Builtin images are not part of any stored archive, so cache them under the
  // "builtin" pack just like a real load would
  let images = interpretedFiles.filter(f => f.type == "img");
  if (images.length) {
    await wipeAssets(builtinPackName);
    await saveImgs(builtinPackName, images.map(img => ({ mod: img.mod, path: img.path, data: img.data })));
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

    files = { ...builtinMods, ...files };

    let { processed, interpretedFiles } = await buildRuleset(files, async (stage, progress, detail) => {
      reportStage(stage, progress, detail);
      await nextPaint();
    });

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

    throwIfCancelled();

    reportStage("Saving ruleset", 0);
    await nextPaint();

    let stringifiedRul = JSON.stringify(processed);

    // Compression is CPU-bound and blocking; the native stream version is
    // several times faster here and produces a gzip payload fflate can read
    let compressedRul = await gzipBytes(new TextEncoder().encode(stringifiedRul));

    reportStage("Saving ruleset", 1);

    await saveStats(packName, data.byteLength, assetsSize, compressedRul.length)
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

  function addToLng(lngName: string, words: { [name: string]: string }) {
    let lng = mods[modName].lng;
    lng[lngName] ??= {}
    Object.assign(lng[lngName], words);
  }

  for (let f of files) {

    modName = f.mod;

    //if(modName != "Dioxine_XPiratez") debugger;

    mods[modName] ??= { dir: modName, lng: {}, rul: [], meta: {} as any }

    try {
      if (f.type == "lng") {
        let data = f.ext == "yml" ? loadYaml(f.text) : f.text;

        if (typeof data == "object" && data != null) {
          let lngName = Object.keys(data)[0]
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

  resetSlowProcessCancel();
}
