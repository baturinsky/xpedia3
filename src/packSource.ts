import * as fflate from "fflate";
import * as idb from "./idb";
import type { ProcessedRuleset } from "./rul/Ruleset";
import Ruleset, { defaultLanguage } from "./rul/Ruleset";
import { state, update } from "./state";
import { base64ToArrayBuffer, gameRelativePath } from "./util";

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
  pack: string;
  assets: number;
  ruls: number;
  archive: number;
  /**
   * Pack installed before storage buckets were used, so it sits in the origin's
   * default storage and the browser will never expire it
   */
  legacy?: boolean;
};

export interface PackSource {
  readonly pack: string;
  readonly kind: "database" | "inline";
  /** Inlined packs cannot be deleted or re-unpacked: their data is the HTML file */
  readonly permanent: boolean;
  /**
   * Why the browser cannot bundle this pack's images into an archive itself.
   *
   * Absent for a stored pack: its image bytes are database records, one each, so
   * copying them out costs a read and nothing more.
   *
   * - `"page"`: the pack *is* an exported page, which keeps its images as
   *   ordinary files beside itself. They are already where a page looks for
   *   them, so there is nothing to write.
   * - `"served"`: the pack is a folder served by `xpedia-cli --serve`, which
   *   reads its images out of that folder as the page asks. They are not part of
   *   the page, and the browser never receives them; see `serveExport`.
   */
  readonly imagesUnavailable?: "page" | "served";
  /**
   * Where to ask for an export, for a pack whose images the browser lacks.
   *
   * A served pack has a server behind it that owns the folder, and that server
   * can export it with the same code the command line uses. The page sends the
   * settings and downloads the archive, so choosing "Include images" works
   * instead of silently producing a page without them.
   */
  readonly serveExport?: { url: string };
  /** Row for the modpack list */
  stats(): Promise<PackStat>;
  /** The processed ruleset, exactly what `Ruleset` is built from */
  rulData(): Promise<ProcessedRuleset | undefined>;
  /** Image bytes, for packs whose images live in the database */
  imgData(path: string): Promise<Uint8Array | undefined>;
  /** Image location relative to the page, for packs whose images live outside */
  imgUrl(path: string): string | undefined;
  /**
   * The bytes of a file of the pack, by archive path.
   *
   * The exporters read a pack's raw data files — the globe — and its images
   * through this, so one reader serves a ruleset written to the database and a
   * page that is itself an export. A file that cannot be read resolves to
   * nothing rather than throwing: a sprite may name a file no pack shipped, and
   * an export must not fail over that.
   */
  fileData(path: string): Promise<Uint8Array | undefined>;
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
      const records = (await idb.getStats()) as any[];
      const record = records?.find((r) => r.pack === pack);
      return {
        pack,
        archive: record?.archive ?? 0,
        assets: record?.assets ?? 0,
        ruls: record?.ruls ?? 0,
        legacy: record?.legacy ?? false,
      };
    },
    rulData: () => idb.readRulData(pack),
    imgData: (path) => idb.readImgData(pack, path),
    // A stored pack keeps every image as its own database record, so they can
    // be copied into an archive. `imagesUnavailable` is what says a pack cannot,
    // and this one has nothing to say there.
    fileData: (path) => idb.readImgData(pack, path),
    imgUrl: () => undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Inlined packs                                                       */
/* ------------------------------------------------------------------ */

/** Shape of `window.xpedia`, written by the export */
export type InlinePayload = {
  /** Pack name shown in the modpack list, ending in `.inline` */
  pack?: string;
  /** Base64 of the gzip-compressed processed ruleset */
  rul: string;
  /**
   * The language an unsplit page opens in.
   *
   * Written when the export was asked for in one particular language, so a page
   * made for Russian readers starts in Russian. A split export has no such
   * field: its page carries English only and always starts there.
   */
  lang?: string;
  /**
   * Language name -> the script carrying its strings.
   *
   * Only present when the export was split into language packs. Such a page
   * carries English alone, so every other language is fetched when it is picked
   * for the first time. English is absent: it is always already there.
   */
  packs?: { [name: string]: string };
  /**
   * Ruleset-relative path -> base64 of the gzipped bytes, for the raw data
   * files the pedia reads instead of showing. Absent when there are none.
   */
  data?: { [path: string]: string };
  /**
   * Set by `xpedia-cli --serve`, which writes this page to preview a folder.
   *
   * The page is otherwise exactly what an export produces, so this is the only
   * thing that tells the two apart: a served pack's images stay in the served
   * folder, while an exported page's sit beside the file.
   */
  served?: boolean;
};

function readInlinePayload(): InlinePayload | undefined {
  const payload = (window as any).xpedia;
  if (!payload || typeof payload !== "object" || typeof payload.rul !== "string") return;
  return payload;
}

/** The inlined payload, if this page is an exported pedia */
export function inlinePayload(): InlinePayload | undefined {
  return readInlinePayload();
}

/** The language an unsplit page was exported in, when it was asked for one */
export function inlinePageLanguage() {
  const lang = readInlinePayload()?.lang;
  return typeof lang === "string" && lang ? lang : undefined;
}

/**
 * The language packs of a split export: language name -> script path, relative
 * to the page. Absent for an ordinary export, whose page carries every language.
 */
export function inlineLanguagePacks() {
  const packs = readInlinePayload()?.packs;
  if (!packs || typeof packs !== "object" || !Object.keys(packs).length) return;
  return packs;
}

/**
 * Every language a split page can show: the ones with a pack, plus English,
 * which the page itself carries.
 */
export function inlineLanguageNames() {
  const packs = inlineLanguagePacks();
  if (!packs) return;
  return [defaultLanguage, ...Object.keys(packs)];
}

/**
 * The raw data files a page carries inside itself, as the payload spells them.
 *
 * Exported so a pedia that is itself a page can be exported again: the bytes are
 * already gzipped and base64ed there, and reading them back from the page is the
 * only way to keep them, since an inlined pack has no stored copy and a page
 * opened from `file://` cannot fetch its neighbours. Undefined when the payload
 * carries none, so a caller can fall through to reading them from the pack.
 */
export function inlineDataFiles() {
  const data = readInlinePayload()?.data;
  if (!data || typeof data !== "object" || !Object.keys(data).length) return;
  return data;
}

/** Language packs already loaded or loading, so a second click reuses them */
const langPackLoads = new Map<string, Promise<{ [id: string]: string } | undefined>>();

/**
 * Loads a language pack and returns the strings it carries.
 *
 * The pack is a script rather than JSON because a page opened from `file://`
 * cannot `fetch` its neighbours while it can still run a script next to itself.
 * The strings are only the ones that differ from English, so the caller merges
 * them over English the way `Ruleset.selectLang` does. A failed load resolves
 * to nothing and is not remembered, so a later attempt starts over.
 */
export function loadLanguagePack(lang: string): Promise<{ [id: string]: string } | undefined> {
  const path = inlineLanguagePacks()?.[lang];
  if (!path) return Promise.resolve(undefined);

  const started = langPackLoads.get(lang);
  if (started) return started;

  const load = new Promise<{ [id: string]: string } | undefined>((resolve) => {
    const script = document.createElement("script");
    script.src = path;
    script.onload = () => resolve((window as any).xpediaLangPacks?.[lang]);
    script.onerror = () => resolve(undefined);
    document.head.appendChild(script);
  }).then((strings) => {
    // A pack that did not arrive leaves nothing behind: the tag is dropped so a
    // retry starts clean, and the failure is not remembered, so a later click
    // tries again rather than being stuck on it
    if (!strings) {
      langPackLoads.delete(lang);
      for (const tag of document.querySelectorAll("script[src]"))
        if (tag.getAttribute("src") === path) tag.remove();
    }
    return strings;
  });
  langPackLoads.set(lang, load);
  return load;
}

/** Default name when the payload does not carry one */
const fallbackInlineName = "xpedia.inline";

export { gameRelativePath } from "./util";

let inlineSource: PackSource | undefined;
let inlineChecked = false;
/** Synchronous row for the modpack list; the payload size is known from base64 */
let inlineStat: PackStat | undefined;

function inlineSourceOf(payload: InlinePayload): PackSource {
  if (inlineSource) return inlineSource;

  const pack = payload.pack || fallbackInlineName;
  // Base64 carries 3 bytes per 4 characters, so the compressed size is known
  // without decoding anything. Enough for a storage-size column.
  const gzipSize = Math.floor((payload.rul.length * 3) / 4);
  const stat: PackStat = { pack, archive: 0, assets: 0, ruls: gzipSize };
  inlineStat = stat;

  // Decompress once and share the text: the ruleset is the same every time it
  // is opened. It is parsed per call because `Ruleset` mutates what it is given.
  let gzipData: Uint8Array | undefined;
  let rulTextPromise: Promise<string | undefined> | undefined;

  const gzipBytes = () => {
    gzipData ??= new Uint8Array(base64ToArrayBuffer(payload.rul));
    return gzipData;
  };

  inlineSource = {
    pack,
    kind: "inline",
    permanent: true,
    async stats() {
      return stat;
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
      const text = await rulTextPromise;
      return text ? JSON.parse(text) : undefined;
    },
    // Images are not in the payload, they live in the game folder
    imgData: async () => undefined,
    imgUrl: (path) => `./${gameRelativePath(path)}`,
    // The images are already files beside the page, put there by whatever made
    // it, so there is nothing to bundle: reading them back through the browser
    // would copy hundreds of megabytes only to write the same bytes again. A
    // served folder is further away still — its images never reach the page, so
    // the server behind it has to do the export instead.
    imagesUnavailable: payload.served ? "served" : "page",
    // A served page has a server that owns the folder and can export it. The
    // endpoint is relative to the page, so a pack served on another port or
    // path still finds it.
    serveExport: payload.served ? { url: "./xpedia-export" } : undefined,
    async fileData(path) {
      try {
        const response = await fetch(`./${gameRelativePath(path)}`);
        if (!response.ok) return;
        return new Uint8Array(await response.arrayBuffer());
      } catch {
        return;
      }
    },
  };

  return inlineSource;
}

/** The inlined pack of an exported HTML file, if this page has one */
export function inlinePack(): PackSource | undefined {
  if (!inlineChecked) {
    inlineChecked = true;
    const payload = readInlinePayload();
    if (payload) inlineSourceOf(payload);
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
  if (!pack) return;
  const inline = inlinePack();
  if (inline && inline.pack === pack) return inline;
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
  const db = state.files ?? [];
  const inline = inlinePack();
  if (!inline) return db;
  // The database can never contain the inlined pack, but guard anyway in case
  // an export named its pack like an uploaded archive
  return [...db.filter((p) => p.pack !== inline.pack), ...(inlineStat ? [inlineStat] : [])];
}

/** Loads a pack's ruleset into the app, from whichever source owns it */
export async function loadPackRul(pack: string) {
  const source = packSource(pack);
  if (!source) return;

  const processed = await source.rulData();
  if (!processed) return;

  const rul = new Ruleset(processed);
  const pageLang = source.kind === "inline" ? inlinePageLanguage() : undefined;
  // A split page carries English alone and names a script for each other
  // language, so those are candidates the browser's locale can also pick.
  const packs = source.kind === "inline" ? Object.keys(inlineLanguagePacks() ?? {}) : undefined;
  const wanted = idb.applySavedLanguage(rul, pageLang, packs);
  // A language the page cannot show yet has to be fetched; this is what makes a
  // shared split page open in the reader's language instead of in English. A
  // failed load falls back to English, which every page carries.
  let lang = rul.langName ?? undefined;
  if (wanted && !rul.langs[wanted]) {
    const strings = await loadLanguagePack(wanted);
    if (strings) rul.langs[wanted] = strings;
    if (rul.selectLang(strings ? wanted : defaultLanguage)) lang = rul.langName ?? lang;
  }
  update({ rul, packName: pack, lang });
  return processed;
}

/** Image bytes or URL for the currently shown pack */
export async function resolveImage(
  path: string,
): Promise<{ data?: Uint8Array; url?: string } | undefined> {
  const source = packSource(state.packName);

  // Inlined packs point at the game folder instead of carrying bytes
  const url = source?.imgUrl(path);
  if (url) return { url };

  const record = await idb.getImg(path);
  if (record?.data) return { data: record.data };
}

/** Data files already decoded, keyed by the path the payload spells them with */
const dataLoads = new Map<string, Promise<Uint8Array | undefined>>();

/**
 * Bytes of a raw data file of the shown pack — the globe's `WORLD.DAT` so far.
 *
 * An exported page carries these inside itself rather than beside itself, so
 * this reads the payload and never the disk: a page opened from `file://` cannot
 * `fetch` its neighbours at all, which used to make the map quietly fall back to
 * the stock globe. `path` is the ruleset-relative spelling the rest of the code
 * asks with, `geodata/world.dat`, which is also how the export keys it.
 *
 * A database pack has no such payload; its bytes live with the images and are
 * found through `resolveImage`.
 */
export function inlineDataFile(path: string): Promise<Uint8Array | undefined> {
  const payload = readInlinePayload();
  if (!payload) return Promise.resolve(undefined);

  const encoded = payload.data?.[path.replace(/\\/g, "/").toLowerCase()];
  if (!encoded) return Promise.resolve(undefined);

  const started = dataLoads.get(path);
  if (started) return started;

  // Decoding is deferred to the first ask: the map is one page of many, and a
  // reader who never opens it should not pay for the gunzip
  const load = (async () => {
    try {
      const gzipped = new Uint8Array(base64ToArrayBuffer(encoded));
      return fflate.gunzipSync(gzipped);
    } catch (e) {
      console.error(`Can't read the inlined ${path}`, e);
      // Not remembered, so a retry does not stay broken
      dataLoads.delete(path);
      return undefined;
    }
  })();
  dataLoads.set(path, load);
  return load;
}
