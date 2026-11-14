//@ts-ignore
import wasmRaw from './unrar.wasm?base64'
import { state, update, slowProcessCancelRequested, resetSlowProcessCancel, autoCloseStatus } from "./state";
import { delay, base64ToArrayBuffer, asMB } from "./util";
import { fileTypeFromBuffer, type FileTypeResult } from "file-type";
import * as fflate from 'fflate';
import Ruleset from "./rul/Ruleset";
import type { Mod } from "./rul/Ruleset";
import { saveFile, saveImgs, saveRul, saveStats, wipeAssets, eraseArchiveFile, updateFileStats, applySavedLanguage } from "./idb";
import builtinModsPayload from './builtinMods?builtinMods'
import {
  buildPackData, filterBuiltinMods, interpretPath,
  mergeBuiltinMods as mergeBuiltinData, unpackBuiltinMods, unpackRar as unpackRarFiles,
  unpackZip as unpackZipFiles
} from "./packBuild";

/**
 * Loading modpacks into the browser app.
 *
 * Everything about the archive format and the mod layout lives in
 * `packBuild.ts`, which has no browser dependencies and is shared with the
 * command line exporter. This module adds what only the app needs: the status
 * window, the storage writes and the language preference.
 */

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
function unpackBuiltins() {
  return unpackBuiltinMods(builtinModsPayload);
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
  return cachedBuiltinFiles ??= unpackBuiltins();
}

/** The builtin mod files that apply to the given modpack */
async function builtinModFiles(packName?: string) {
  return filterBuiltinMods(unpackBuiltins(), packName);
}

/**
 * Re-applies the builtin mods to a stored pack-only ruleset.
 *
 * See `packBuild.mergeBuiltinMods`; only the builtin selection is the app's
 * business, and it depends on the pack's name.
 */
export async function mergeBuiltinMods(stored: { mods?: Mod[], langs?: any, resources?: any }, packName?: string) {
  return mergeBuiltinData(await builtinModFiles(packName), stored);
}

/**
 * The unrar wasm, decoded on first use.
 *
 * It lives here rather than in `main.ts` because that made `load` import `main`
 * while `main` imports `load`: a cycle that let `init()` run before `idb.ts`
 * had evaluated its own module body, crashing on a `const` that was still in
 * the temporal dead zone. RAR unpacking is the only consumer, so decoding it
 * here also keeps 200 KB of base64 unparsed until a RAR is actually opened.
 */
let wasmCache: ArrayBuffer | undefined;

function unrarWasm() {
  return wasmCache ??= base64ToArrayBuffer(wasmRaw);
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

/** Unpacks either format, reporting progress and honouring the Cancel button */
async function unpackArchive(packName: string, data: ArrayBuffer) {
  throwIfCancelled();

  reportStage("Reading archive", 0, `${packName ?? ""} (${asMB(data.byteLength)})`);
  await nextPaint();

  let fileType = await fileTypeFromBuffer(data).catch(() => undefined as FileTypeResult | undefined);

  let files: { [name: string]: Uint8Array };

  try {
    if (!fileType)
      throw new Error("Unknown file type");
    await beginStage("Unpacking", `${packName ?? "archive"} (${asMB(data.byteLength)})`);
    if (fileType.ext == "rar") {
      files = await unpackRarFiles(data, unrarWasm(), {
        checkCancelled: throwIfCancelled,
        onProgress: async (done, total, name) => {
          await delay(0);
          reportStage("Unpacking", done / (total || 1), `${done}/${total} files: ${name ?? "archive"}`);
        }
      });
    } else {
      files = unpackZipFiles(data);
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
 * Loads only the builtin mods shared by every modpack. This is what the app
 * uses when no modpack is loaded, so there is always a ruleset to browse.
 */
export async function loadBuiltinOnlyPack() {
  let files = await builtinModFiles();
  let { processed, interpretedFiles } = buildPackData(files);
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

    throwIfCancelled();

    reportStage("Building ruleset", 0, `${Object.keys(files).length} files`);
    await nextPaint();

    let { processed, interpretedFiles, ownMods, ownResources } = buildPackData(files, builtinDirs);

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

    // A saved pack holds only its own mods and resources, so a later builtin
    // mods update is picked up without re-uploading the archive. `langs` is
    // deliberately absent: that is how `mergeBuiltinMods` recognizes this
    // format.
    let ownModsJson = JSON.stringify(ownMods);
    let stringifiedRul = `{"mods":${ownModsJson === undefined ? "[]" : ownModsJson},"resources":${JSON.stringify(ownResources ?? {})}}`;

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
  // `slice` gives a fresh array over an `ArrayBuffer`, which is what `Blob`
  // accepts; a `Uint8Array` view may be backed by a shared buffer
  let stream = new Blob([bytes.slice()]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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
