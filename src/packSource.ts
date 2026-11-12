import * as fflate from "fflate";
import { state, update } from "./state";
import * as idb from "./idb";
import Ruleset from "./rul/Ruleset";
import { base64ToArrayBuffer } from "./util";

/**
 * Where a modpack's data comes from.
 *
 * A normal modpack was uploaded and unpacked into the database: the processed
 * ruleset is a gzip blob in `assets`, and every image is a record there too.
 *
 * An *inlined* modpack lives inside an exported HTML file: the ruleset is a
 * base64 gzip blob in `window.xpedia`, and the images are not stored at all.
 * They are read from the game installation next to the HTML file, e.g.
 * `./user/mods/<mod>/Resources/...`, which avoids both a huge HTML file and the
 * CORS restrictions that come with `fetch`ing local files from a page.
 *
 * Everything that reads pack data should go through this module, so the rest of
 * the app does not have to care which of the two it is looking at.
 */

export type PackStat = {
  pack: string,
  assets: number,
  ruls: number,
  archive: number,
  /**
   * Pack installed before storage buckets were used, so it sits in the origin's
   * default storage and the browser will never expire it
   */
  legacy?: boolean
};

export interface PackSource {
  readonly pack: string;
  readonly kind: "database" | "inline";
  /** Inlined packs cannot be deleted or re-unpacked: their data is the HTML file */
  readonly permanent: boolean;
  /** Row for the modpack list */
  stats(): Promise<PackStat>;
  /** The processed ruleset, exactly what `Ruleset` is built from */
  rulData(): Promise<any>;
  /** Image bytes, for packs whose images live in the database */
  imgData(path: string): Promise<Uint8Array | undefined>;
  /** Image location relative to the page, for packs whose images live outside */
  imgUrl(path: string): string | undefined;
}

/* ------------------------------------------------------------------ */
/* Database-backed packs                                               */
/* ------------------------------------------------------------------ */

function databaseSource(pack: string): PackSource {
  return {
    pack,
    kind: "database",
    permanent: false,
    async stats() {
      let records = await idb.getStats() as any[];
      let record = records?.find(r => r.pack == pack);
      return {
        pack,
        archive: record?.archive ?? 0,
        assets: record?.assets ?? 0,
        ruls: record?.ruls ?? 0,
        legacy: record?.legacy ?? false
      };
    },
    rulData: () => idb.readRulData(pack),
    imgData: path => idb.readImgData(pack, path),
    imgUrl: () => undefined
  };
}

/* ------------------------------------------------------------------ */
/* Inlined packs                                                       */
/* ------------------------------------------------------------------ */

/** Shape of `window.xpedia`, written by the export */
export type InlinePayload = {
  /** Pack name shown in the modpack list, ending in `.inline` */
  pack?: string,
  /** Base64 of the gzip-compressed processed ruleset */
  rul: string
};

function readInlinePayload(): InlinePayload | undefined {
  let payload = (window as any).xpedia;
  if (!payload || typeof payload != "object" || typeof payload.rul != "string")
    return;
  return payload;
}

/** Default name when the payload does not carry one */
const fallbackInlineName = "xpedia.inline";

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

let inlineSource: PackSource | undefined;
let inlineChecked = false;
/** Synchronous row for the modpack list; the payload size is known from base64 */
let inlineStat: PackStat | undefined;

function inlineSourceOf(payload: InlinePayload): PackSource {
  if (inlineSource)
    return inlineSource;

  let pack = payload.pack || fallbackInlineName;
  // Base64 carries 3 bytes per 4 characters, so the compressed size is known
  // without decoding anything. Enough for a storage-size column.
  let gzipSize = Math.floor(payload.rul.length * 3 / 4);
  inlineStat = { pack, archive: 0, assets: 0, ruls: gzipSize };

  // Decompress once and share the text: the ruleset is the same every time it
  // is opened. It is parsed per call because `Ruleset` mutates what it is given.
  let gzipData: Uint8Array | undefined;
  let rulTextPromise: Promise<string | undefined> | undefined;

  let gzipBytes = () => {
    gzipData ??= new Uint8Array(base64ToArrayBuffer(payload.rul));
    return gzipData;
  };

  inlineSource = {
    pack,
    kind: "inline",
    permanent: true,
    async stats() {
      return inlineStat!;
    },
    async rulData() {
      rulTextPromise ??= (async () => {
        try {
          return new TextDecoder().decode(fflate.decompressSync(gzipBytes()));
        } catch (e) {
          console.error("Can't read the inlined ruleset", e);
          return undefined;
        }
      })();
      let text = await rulTextPromise;
      return text ? JSON.parse(text) : undefined;
    },
    // Images are not in the payload, they live in the game folder
    imgData: async () => undefined,
    imgUrl: path => "./" + gameRelativePath(path)
  };

  return inlineSource;
}

/** The inlined pack of an exported HTML file, if this page has one */
export function inlinePack(): PackSource | undefined {
  if (!inlineChecked) {
    inlineChecked = true;
    let payload = readInlinePayload();
    if (payload)
      inlineSourceOf(payload);
  }
  return inlineSource;
}

/* ------------------------------------------------------------------ */
/* Shared entry points                                                 */
/* ------------------------------------------------------------------ */

/** Synchronous pack list of the database plus the inlined pack, see `updateFileStats` */
export function inlinePackStats(): PackStat | undefined {
  inlinePack();
  return inlineStat;
}

/** The source for a pack name, whether it lives in the database or inlined */
export function packSource(pack?: string): PackSource | undefined {
  if (!pack)
    return;
  let inline = inlinePack();
  if (inline && inline.pack == pack)
    return inline;
  return databaseSource(pack);
}

/** True when the pack is part of the page itself and must not be deleted */
export function isPermanentPack(pack?: string) {
  return !!packSource(pack)?.permanent;
}

/**
 * Every installed pack: the database ones plus the inlined one. Synchronous so
 * it can be used straight from render code; `state.files` is refreshed when the
 * database changes.
 */
export function allPackStats(): PackStat[] {
  let db = state.files ?? [];
  let inline = inlinePack();
  if (!inline)
    return db;
  // The database can never contain the inlined pack, but guard anyway in case
  // an export named its pack like an uploaded archive
  return [...db.filter(p => p.pack != inline.pack), inlineStat!];
}

/** Loads a pack's ruleset into the app, from whichever source owns it */
export async function loadPackRul(pack: string) {
  let source = packSource(pack);
  if (!source)
    return;

  let processed = await source.rulData();
  if (!processed)
    return;

  let rul = new Ruleset(processed);
  idb.applySavedLanguage(rul);
  update({ rul, packName: pack });
  return processed;
}

/** Image bytes or URL for the currently shown pack */
export async function resolveImage(path: string): Promise<{ data?: Uint8Array, url?: string } | undefined> {
  let source = packSource(state.packName);

  // Inlined packs point at the game folder instead of carrying bytes
  let url = source?.imgUrl(path);
  if (url)
    return { url };

  let record = await idb.getImg(path);
  if (record?.data)
    return { data: record.data };
}
