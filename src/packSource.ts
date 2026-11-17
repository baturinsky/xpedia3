import * as fflate from "fflate";
import { state, update } from "./state";
import * as idb from "./idb";
import Ruleset, { defaultLanguage } from "./rul/Ruleset";
import type { ProcessedRuleset } from "./rul/Ruleset";
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
  rulData(): Promise<ProcessedRuleset | undefined>;
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
  rul: string,
  /**
   * The language an unsplit page opens in.
   *
   * Written when the export was asked for in one particular language, so a page
   * made for Russian readers starts in Russian. A split export has no such
   * field: its page carries English only and always starts there.
   */
  lang?: string,
  /**
   * Language name -> the script carrying its strings.
   *
   * Only present when the export was split into language packs. Such a page
   * carries English alone, so every other language is fetched when it is picked
   * for the first time. English is absent: it is always already there.
   */
  packs?: { [name: string]: string },
};

function readInlinePayload(): InlinePayload | undefined {
  let payload = (window as any).xpedia;
  if (!payload || typeof payload != "object" || typeof payload.rul != "string")
    return;
  return payload;
}

/** The inlined payload, if this page is an exported pedia */
export function inlinePayload(): InlinePayload | undefined {
  return readInlinePayload();
}

/** The language an unsplit page was exported in, when it was asked for one */
export function inlinePageLanguage() {
  let lang = readInlinePayload()?.lang;
  return typeof lang == "string" && lang ? lang : undefined;
}

/**
 * The language packs of a split export: language name -> script path, relative
 * to the page. Absent for an ordinary export, whose page carries every language.
 */
export function inlineLanguagePacks() {
  let packs = readInlinePayload()?.packs;
  if (!packs || typeof packs != "object" || !Object.keys(packs).length)
    return;
  return packs;
}

/**
 * Every language a split page can show: the ones with a pack, plus English,
 * which the page itself carries.
 */
export function inlineLanguageNames() {
  let packs = inlineLanguagePacks();
  if (!packs)
    return;
  return [defaultLanguage, ...Object.keys(packs)];
}

/** Language packs already loaded or loading, so a second click reuses them */
let langPackLoads = new Map<string, Promise<{ [id: string]: string } | undefined>>();

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
  let path = inlineLanguagePacks()?.[lang];
  if (!path)
    return Promise.resolve(undefined);

  let started = langPackLoads.get(lang);
  if (started)
    return started;

  let load = new Promise<{ [id: string]: string } | undefined>(resolve => {
    let script = document.createElement("script");
    script.src = path;
    script.onload = () => resolve((window as any).xpediaLangPacks?.[lang]);
    script.onerror = () => resolve(undefined);
    document.head.appendChild(script);
  }).then(strings => {
    // A pack that did not arrive leaves nothing behind: the tag is dropped so a
    // retry starts clean, and the failure is not remembered, so a later click
    // tries again rather than being stuck on it
    if (!strings) {
      langPackLoads.delete(lang);
      for (let tag of document.querySelectorAll("script[src]"))
        if (tag.getAttribute("src") == path)
          tag.remove();
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
  let pageLang = source.kind == "inline" ? inlinePageLanguage() : undefined;
  // A split page carries English alone and names a script for each other
  // language, so those are candidates the browser's locale can also pick.
  let packs = source.kind == "inline" ? Object.keys(inlineLanguagePacks() ?? {}) : undefined;
  let wanted = idb.applySavedLanguage(rul, pageLang, packs);
  // A language the page cannot show yet has to be fetched; this is what makes a
  // shared split page open in the reader's language instead of in English. A
  // failed load falls back to English, which every page carries.
  let lang = rul.langName ?? undefined;
  if (wanted && !rul.langs[wanted]) {
    let strings = await loadLanguagePack(wanted);
    if (strings)
      rul.langs[wanted] = strings;
    if (rul.selectLang(strings ? wanted : defaultLanguage))
      lang = rul.langName ?? lang;
  }
  update({ rul, packName: pack, lang });
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
