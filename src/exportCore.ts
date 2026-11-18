import * as fflate from "fflate";
import { bytesToBase64, getFlagEmoji, xpediaVersion } from "./util";
import { mainMod, type LangMap, type Langs, type Mod, type ProcessedRuleset } from "./rul/Ruleset";
import type Ruleset from "./rul/Ruleset";
import { WORLD_DAT, gameRelativePath } from "./packBuild";

/**
 * Building an exported pedia, independent of where its inputs come from.
 *
 * The browser reads the ruleset from IndexedDB, the images from IndexedDB and
 * the app shell from its own page; the command line tool reads all three from an
 * archive and its own bundle. Neither difference belongs here: this module takes
 * them as arguments and decides only what the exported file has to contain.
 */

/** The `.inline` suffix marks an exported pack in the modpack list */
export const inlineSuffix = ".inline";

/** Pack name the exported file shows itself under */
export function exportedPackName(pack: string) {
  return pack.replace(/\.(zip|rar)$/i, "") + inlineSuffix;
}

/** One inline script or style of a page, ready to be copied verbatim */
export type TagCopy = { attrs: string, content: string };

/** Inline scripts and styles of the app, as they must be copied out */
export type AppShell = { scripts: TagCopy[], styles: string[] };

/**
 * What the language selector needs beyond the strings themselves.
 *
 * `packs` is for a split export: the page keeps English and names a script for
 * every other language. `lang` is the language an ordinary export opens in, for
 * when it was asked for in one particular language; a split export leaves it out
 * and always opens in English, which is the only language it really carries.
 */
export type PageLanguage = {
  /** The language this page opens in, when that is not English */
  lang?: string,
  /** Language name -> the script that carries its strings */
  packs?: { [name: string]: string },
};

/** Folder, next to the page, that holds the language packs of a split export */
export const languagePackDir = "xpedia-lang";

/**
 * Where the strings of a language live in a split export.
 *
 * A script rather than JSON: a page opened from `file://` may load scripts but
 * cannot `fetch` its neighbours, so this is what makes a split export work when
 * the file is simply double-clicked.
 */
export function languagePackPath(lang: string) {
  return `${languagePackDir}/${lang}.js`;
}

/**
 * The script that carries one language's strings.
 *
 * Only the strings that differ from English travel, the same trim `prepareRul`
 * applies inside a page, because `Ruleset.selectLang` merges them back over
 * English. The result is a plain object literal, so a translator can open the
 * file and read it.
 */
export function buildLanguagePack(processed: ProcessedRuleset, lang: string) {
  let english = processed.langs?.["en-US"] ?? {};
  let translated = onlyTranslated(english, processed.langs?.[lang] ?? {});
  // JSON is valid JavaScript once the characters that could end the script or
  // a line are escaped; those do occur in translations
  let literal = JSON.stringify(translated)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `// XPedia language pack: ${lang}
// Loaded by the pedia on demand; the page next to this folder lists it.
(window.xpediaLangPacks ||= {})[${JSON.stringify(lang)}] = ${literal};
`;
}

/**
 * Compresses bytes, preferring the native stream like the pack loader does.
 *
 * Both paths produce a valid gzip; the native one is several times faster on a
 * big translation, which matters when the export runs from the page.
 */
export async function gzipBytes(bytes: Uint8Array) {
  if (typeof CompressionStream == "undefined")
    return fflate.gzipSync(bytes);
  let stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Compresses text, see `gzipBytes` */
export async function gzipText(text: string) {
  return gzipBytes(new TextEncoder().encode(text));
}

/**
 * The strings of `lang` that English does not already provide identically.
 *
 * A language map in a processed ruleset is a full copy of the English map with
 * the translations written over it (`preprocessMods` does
 * `{ ...langs["en-US"], ...langs[name] }`), so everything untranslated is
 * repeated once per language. `Ruleset.selectLang` merges the two back together
 * when the language is picked, which makes the copies unnecessary in a file.
 *
 * Values are compared with `!==`, so a string is only dropped when it is
 * literally the same one; anything else (numbers, OXCE plural objects) stays.
 */
export function onlyTranslated(english: LangMap, lang: LangMap) {
  let translated: LangMap = {};
  for (let key of Object.keys(lang))
    if (english[key] !== lang[key])
      translated[key] = lang[key];
  return translated;
}

/**
 * Trims the processed ruleset to the languages the user picked. The ruleset is
 * stored exactly as the app runs it, so this only touches `langs`; everything
 * else (articles, entries, sprites) is already in its final form.
 *
 * `labelLanguages` names languages that need a label but whose strings are not
 * in this file, which only happens in a split export: the selector offers every
 * exported language, while the page carries just one of them.
 */
export function prepareRul(processed: ProcessedRuleset, languages: string[], labelLanguages: string[] = []) {
  // `icon` is the emoji label map, not a language the user can pick, and the
  // page is unreadable without it
  let keep = new Set(["en-US", "icon", ...languages]);
  let source: Langs = processed.langs ?? {};
  let english = source["en-US"] ?? {};
  let langs: Langs = {};
  for (let name of Object.keys(source)) {
    if (!keep.has(name))
      continue;
    // English and the emoji map are the reference the others are merged onto,
    // so they have to stay complete
    langs[name] = name == "en-US" || name == "icon"
      ? source[name]
      : onlyTranslated(english, source[name]);
  }

  // A language gets its flag label from `Ruleset.loadProcessedMods`, which only
  // sees the languages the file carries. A split page carries one, so the labels
  // of the whole selection are written here instead; without them the selector
  // would fall back to the bare language code.
  let missing = labelLanguages.filter(name => langs["en-US"] && !langs["en-US"][name]);
  if (missing.length) {
    langs["en-US"] = { ...langs["en-US"] };
    for (let name of missing)
      langs["en-US"][name] = getFlagEmoji(name.match(/([a-z]+)/i)?.[1] ?? name);
  }

  return { ...processed, langs };
}

/**
 * Image paths the pedia can show, so only those files are needed in an archive.
 *
 * Sprites cover items, facilities, armor layers and article illustrations;
 * obs tables are the indexed sprite sheets (`BIGOBS.PCK` and friends); the
 * globe's DAT is *not* here: it travels inside the page, see `collectDataFiles`.
 */
export function referencedPaths(rul: Ruleset | undefined) {
  let paths = new Set<string>();
  if (!rul)
    return paths;

  let add = (path?: string) => {
    // `emptyImg` is a placeholder, not a file from the pack
    if (path && !path.startsWith("data:"))
      paths.add(path);
  };

  for (let sprite of Object.values(rul.sprites))
    add(sprite?.path);
  for (let table of Object.values(rul.obs))
    for (let sprite of table)
      add(sprite?.path);

  // An article illustration is either a sprite id or an asset path
  for (let article of Object.values(rul.articles)) {
    let id = article?.image_id;
    if (!id)
      continue;
    let sprite = rul.sprites[id];
    if (sprite)
      add(sprite.path);
    else if (/[\\/]/.test(id))
      add(id);
  }

  // The world map's globe data is deliberately *not* here: it is not a file the
  // reader's game folder is guaranteed to have, and a page opened from `file://`
  // cannot fetch it at all. It travels inside the page, see `dataPaths`.

  return paths;
}

/**
 * Data files the pedia reads as bytes rather than shows as pictures.
 *
 * These are the ruleset's `geodata:` inputs — the polygons and coastline the
 * world map is drawn from. They cannot be left for the reader to fetch, the way
 * images are: a page opened from `file://` cannot fetch its neighbours at all,
 * so the map would silently fall back to the stock globe and a pack that ships
 * its own would draw the wrong world. They are also small enough to carry —
 * `WORLD.DAT` is 18 KB, 9 KB gzipped — against images that are megabytes each.
 *
 * The spellings are the ruleset-relative ones, `geodata/world.dat`, so the
 * payload is keyed by what the code that wants the file already asks for, and
 * never by where the file happened to sit in the archive.
 *
 * `globe: data:` lets a pack name a file other than the stock globe, and the
 * last mod to set it wins, exactly as `combineModRuls` merges the block. Both
 * spellings are carried when they differ: the stock one is what the code asks
 * for by default, the named one is what such a pack actually means.
 */
export function dataPaths(mods: Mod[] = []): string[] {
  let paths: string[] = [];
  let named: string | undefined;
  for (let mod of mods)
    for (let file of mod.rul ?? [])
      if (file?.globe && typeof file.globe.data == "string")
        named = file.globe.data;
  // The stock globe is always carried: it is what the reader falls back to when
  // the pack names none, and the builtin copy is not a file they can fetch
  paths.push(WORLD_DAT);
  if (named) {
    let key = named.replace(/^[/\\]+/, "").toLowerCase();
    if (!paths.includes(key))
      paths.push(key);
  }
  return paths;
}

/**
 * The data files of a pack, as `ruleset-relative path -> base64 of its gzipped bytes`.
 *
 * Takes the resource map rather than a `Ruleset`: building one stamps flag
 * labels onto the shared language table, and a page's payload must not carry
 * those. The map is all this needs anyway.
 *
 * Only the paths that actually resolve are returned. A pack that ships no
 * `WORLD.DAT` is normal — it means "use the stock globe", which the builtin copy
 * already provides — so a miss is not an error.
 */
export async function collectDataFiles(
  resources: { [rel: string]: string } | undefined,
  read: (archivePath: string) => Promise<Uint8Array | undefined>,
  mods: Mod[] = [],
) {
  let files: { [path: string]: string } = {};
  for (let rel of dataPaths(mods)) {
    let archivePath = resources?.[rel];
    if (!archivePath)
      continue;
    let bytes = await read(archivePath);
    if (!bytes?.length)
      continue;
    // Gzipped then base64ed: this is a JSON payload, so raw binary would have
    // to be escaped into a larger form than the compression saves
    files[rel] = bytesToBase64(await gzipBytes(bytes));
  }
  return files;
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/** JSON that can sit safely inside a `<script>` element */
function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * The payload an exported page carries in `window.xpedia`.
 *
 * `packSource.ts` reads the same shape back on load; the type lives here because
 * this module writes it and the CLI builds pages without a browser.
 */
export type PagePayload = {
  /** Pack name shown in the modpack list, ending in `.inline` */
  pack: string,
  /** Base64 of the gzip-compressed processed ruleset */
  rul: string,
  /** The language the page opens in, when that is not English */
  lang?: string,
  /** Language name -> script carrying its strings, for a split export */
  packs?: { [name: string]: string },
  /**
   * Ruleset-relative path -> base64 of the gzipped bytes, for the raw data
   * files the pedia reads rather than shows. See `dataPaths`.
   *
   * Absent when the pack has none, so an ordinary export keeps its old shape.
   */
  data?: { [path: string]: string },
};

/**
 * The page text around a ruleset payload.
 *
 * Split out so the size estimate can measure the shell once and then add the
 * payload length, see `prepareEstimate` in `exportPedia.ts`.
 */
export async function renderPage(
  pack: string,
  processed: ProcessedRuleset,
  rulesetBase64: string,
  shell: AppShell,
  page?: PageLanguage,
  data?: { [path: string]: string }
) {
  let payload: PagePayload = {
    pack: exportedPackName(pack),
    rul: rulesetBase64
  };
  // Only written when the page starts in one language and holds the others, so
  // an English export of an unsplit pack keeps the shape it has always had
  if (page?.lang)
    payload.lang = page.lang;
  // Only written when the other languages live in scripts beside the page
  if (page?.packs && Object.keys(page.packs).length)
    payload.packs = page.packs;
  // Only written when the pack actually has data files, which most do not
  if (data && Object.keys(data).length)
    payload.data = data;

  let { scripts, styles } = shell;
  // The page title names the mod the pack is about, the same one the navbar
  // shows, not whichever mod happens to come last in the archive. When there is
  // no such name the page is XPedia's own, so it carries XPedia's version, and
  // that version is the one this build was exported with rather than whatever
  // the reader's copy later became.
  let meta = mainMod(processed.mods ?? [])?.meta;
  let packName = [meta?.name, meta?.version].filter(Boolean).join(" ");
  let title = packName || `XPedia ${xpediaVersion()}`;

  // The payload must exist before the app starts. Module scripts run after
  // parsing, so a plain script above them is always safe.
  return `<!DOCTYPE html>
<html>

<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Offline reference for an OpenXCom modpack" />
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="data:;base64,iVBORwOKGO=" />
  ${styles.map(css => `<style>${css}</style>`).join("\n  ")}
  <script data-xpedia-export>window.xpedia = ${scriptJson(payload)};</script>
  ${scripts.map(js => `<script ${js.attrs}>${js.content}</script>`).join("\n  ")}
</head>

<body>

</body>

</html>`;
}

export type BuildPageOptions = {
  pack: string,
  processed: ProcessedRuleset,
  /** Language names to keep besides `en-US`, which is always kept */
  languages: string[],
  shell: AppShell,
  page?: PageLanguage,
  /** Data files to carry inside the page, see `collectDataFiles` */
  data?: { [path: string]: string },
};

/** Builds the HTML text of the exported pedia */
export async function buildPageHtml(options: BuildPageOptions) {
  let trimmed = prepareRul(options.processed, options.languages,
    // A page with language packs offers every language in its selector, so even
    // the ones whose strings live elsewhere need their flag label
    options.page?.packs ? Object.keys(options.page.packs) : []);
  let gzipped = await gzipText(JSON.stringify(trimmed));
  return renderPage(options.pack, trimmed, bytesToBase64(gzipped), options.shell,
    options.page, options.data);
}

/** Base64 is 4 characters per 3 bytes, rounded up to a whole group */
export function base64Length(bytes: number) {
  return Math.ceil(bytes / 3) * 4;
}

/** One file of an export: its path relative to the target, and its bytes */
export type ExportFile = { path: string, data: Uint8Array };

/**
 * The files a self-contained export consists of: the page, then every image it
 * can show under the path the game uses.
 *
 * `readImage` is given an archive path and may return nothing: a sprite can name
 * a file the pack never shipped, and an export must not fail over that.
 */
export async function buildAssetFiles(options: {
  pack: string,
  /** Where the page goes inside the export */
  page: string,
  html: string,
  rul: Ruleset | undefined,
  readImage: (path: string) => Promise<Uint8Array | undefined>,
  onProgress?: (done: number, total: number) => void,
}): Promise<ExportFile[]> {
  let files: ExportFile[] = [{ path: options.page, data: new TextEncoder().encode(options.html) }];
  /** Paths already claimed, so a later spelling cannot overwrite the bytes */
  let taken = new Set(files.map(f => f.path));

  let paths = [...referencedPaths(options.rul)];
  for (let i = 0; i < paths.length; i++) {
    let path = paths[i];
    let data = await options.readImage(path);
    if (data) {
      // Two archive paths can map to the same game file (`common/...` is
      // shared), so a later spelling must not overwrite the bytes already there
      let target = gameRelativePath(path);
      if (!taken.has(target)) {
        taken.add(target);
        files.push({ path: target, data });
      }
    }
    // One update per few images keeps a progress line responsive on big packs
    if (i % 25 == 0 || i == paths.length - 1)
      options.onProgress?.(i + 1, paths.length);
  }
  return files;
}

/** Packs the files into a single zip, the shape the browser export produces */
export function zipFiles(files: ExportFile[]) {
  let entries: { [path: string]: Uint8Array } = {};
  for (let file of files)
    entries[file.path] = file.data;
  return fflate.zipSync(entries, { level: 6 });
}
