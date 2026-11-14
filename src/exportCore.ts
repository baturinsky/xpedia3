import * as fflate from "fflate";
import { bytesToBase64, getFlagEmoji } from "./util";
import { mainMod } from "./rul/Ruleset";
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
 * A page carries one language's strings, but the selector has to offer every
 * language that was exported, each pointing at the file that shows it. English
 * is deliberately absent from `langPages`: it is the fallback every page carries
 * in full, so picking it is a switch inside the current page rather than a
 * navigation.
 */
export type PageLanguage = {
  /** The language this page opens in */
  lang?: string,
  /** Language name -> the file that shows it, for the languages with a file */
  langPages?: { [name: string]: string },
};

/**
 * Compresses text, preferring the native stream like the pack loader does.
 *
 * Both paths produce a valid gzip; the native one is several times faster on a
 * big translation, which matters when the export runs from the page.
 */
export async function gzipText(text: string) {
  let bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream == "undefined")
    return fflate.gzipSync(bytes);
  let stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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
export function onlyTranslated(english: any, lang: any) {
  let translated: { [key: string]: any } = {};
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
export function prepareRul(processed: any, languages: string[], labelLanguages: string[] = []) {
  // `icon` is the emoji label map, not a language the user can pick, and the
  // page is unreadable without it
  let keep = new Set(["en-US", "icon", ...languages]);
  let english = processed.langs?.["en-US"] ?? {};
  let langs: { [name: string]: any } = {};
  for (let name of Object.keys(processed.langs ?? {})) {
    if (!keep.has(name))
      continue;
    // English and the emoji map are the reference the others are merged onto,
    // so they have to stay complete
    langs[name] = name == "en-US" || name == "icon"
      ? processed.langs[name]
      : onlyTranslated(english, processed.langs[name]);
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
 * globe's DAT file is needed to draw the world map.
 */
export function referencedPaths(rul: any) {
  let paths = new Set<string>();
  if (!rul)
    return paths;

  let add = (path?: string) => {
    // `emptyImg` is a placeholder, not a file from the pack
    if (path && !path.startsWith("data:"))
      paths.add(path);
  };

  for (let id of Object.keys(rul.sprites ?? {}))
    add(rul.sprites[id]?.path);
  for (let table of Object.values(rul.obs ?? {}) as any[])
    for (let sprite of table)
      add(sprite?.path);

  // An article illustration is either a sprite id or an asset path
  for (let article of Object.values(rul.articles ?? {}) as any[]) {
    let id = article?.image_id;
    if (!id)
      continue;
    let sprite = rul.sprites?.[id];
    if (sprite)
      add(sprite.path);
    else if (/[\\/]/.test(id))
      add(id);
  }

  // The world map reads the pack's globe data through the resource index. Only
  // the file that index resolves to is needed, not every DAT the pack ships.
  let dat = rul.resourceMap?.[WORLD_DAT]
  if (dat)
    add(dat);

  return paths;
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/** JSON that can sit safely inside a `<script>` element */
function scriptJson(value: any) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * The page text around a ruleset payload.
 *
 * Split out so the size estimate can measure the shell once and then add the
 * payload length, see `prepareEstimate` in `exportPedia.ts`.
 */
export async function renderPage(
  pack: string,
  processed: any,
  rulesetBase64: string,
  shell: AppShell,
  page?: PageLanguage
) {
  let payload: any = {
    pack: exportedPackName(pack),
    rul: rulesetBase64
  };
  // Only written when the page is one of several, so an ordinary export keeps
  // the exact shape it has always had
  if (page?.lang)
    payload.lang = page.lang;
  if (page?.langPages)
    payload.langPages = page.langPages;

  let { scripts, styles } = shell;
  // The page title names the mod the pack is about, the same one the navbar
  // shows, not whichever mod happens to come last in the archive
  let meta = mainMod(processed.mods ?? [])?.meta;
  let title = [meta?.name, meta?.version].filter(Boolean).join(" ") || "XPedia";

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
  processed: any,
  /** Language names to keep besides `en-US`, which is always kept */
  languages: string[],
  shell: AppShell,
  page?: PageLanguage,
};

/** Builds the HTML text of the exported pedia */
export async function buildPageHtml(options: BuildPageOptions) {
  let trimmed = prepareRul(options.processed, options.languages,
    // A split page shows every exported language in its selector, so even the
    // ones it does not carry need their label
    options.page?.langPages ? Object.keys(options.page.langPages) : []);
  let gzipped = await gzipText(JSON.stringify(trimmed));
  return renderPage(options.pack, trimmed, bytesToBase64(gzipped), options.shell, options.page);
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
  html: string,
  rul: any,
  readImage: (path: string) => Promise<Uint8Array | undefined>,
  onProgress?: (done: number, total: number) => void,
}): Promise<ExportFile[]> {
  let files: ExportFile[] = [{ path: `${exportedPackName(options.pack)}.html`, data: new TextEncoder().encode(options.html) }];
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

/**
 * The file a language is written to when the export is split per language.
 *
 * The primary language has no infix, so the site's front door is `index.html`
 * whatever language it shows; every other one gets `index.<lang>.html` beside
 * it. `file` is the name the export was asked for, so a bare `index` and
 * `index.html` both behave.
 */
export function languageFileName(file: string, lang: string, primary: boolean) {
  let dot = file.lastIndexOf(".");
  let base = dot > 0 ? file.substring(0, dot) : file;
  let ext = dot > 0 ? file.substring(dot) : ".html";
  return primary ? base + ext : `${base}.${lang}${ext}`;
}
