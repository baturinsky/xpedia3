import * as fflate from "fflate";
import { state } from "./state";
import { readImgData, readRulText } from "./idb";
import { bytesToBase64 } from "./util";
import { gameRelativePath } from "./packSource";
import { mainMod } from "./rul/Ruleset";

/**
 * Exports the currently shown modpack as a standalone reference.
 *
 * Two shapes are produced, as chosen in the export dialog:
 *
 * - a single HTML file: the app bundle, the styles and a gzip-compressed copy of
 *   the processed ruleset are inlined; images are read from the game directory
 *   (`./user/mods/...`) next to the file, so the file itself stays small and no
 *   CORS-restricted `fetch` of local files is needed;
 * - a ZIP: the same HTML file plus the images it references, laid out as the
 *   game expects, for a completely self-contained reference.
 */

/** The export settings chosen in the modal dialog */
export type ExportOptions = {
  /** Language names to keep besides `en-US`, which is always exported */
  languages: string[],
  /** Bundle the images as well, producing a ZIP instead of a single file */
  archive: boolean,
  /** Stage text and 0..1 progress, for the dialog */
  onProgress?: (status: string, progress?: number) => void,
};

export type ExportResult = {
  name: string,
  data: Blob
};

/** The `.inline` suffix marks an exported pack in the modpack list */
export const inlineSuffix = ".inline";

/** Pack name the exported file shows itself under */
export function exportedPackName(pack: string) {
  return pack.replace(/\.(zip|rar)$/i, "") + inlineSuffix;
}

/** Compresses text, preferring the native stream like the pack loader does */
async function gzipText(text: string) {
  let bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream == "undefined")
    return fflate.gzipSync(bytes);
  let stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One inline script or style of a page, ready to be copied verbatim */
type TagCopy = { attrs: string, content: string };

/** Inline scripts and styles of a document, as they must be copied out */
function collectTags(root: ParentNode) {
  let scripts: TagCopy[] = [...root.querySelectorAll("script")]
    .filter(s => !s.getAttribute("src") && s.textContent?.trim())
    // An exported page carries its own ruleset in a script; copying that one
    // would nest one exported pedia inside another
    .filter(s => !s.hasAttribute("data-xpedia-export"))
    .map(s => ({
      attrs: [...s.attributes].map(a => `${a.name}="${a.value}"`).join(" "),
      // The dev build points at `bundle.js.map`, which is not part of the
      // export: dropping the comment keeps the file fully standalone
      content: s.textContent!.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n")
    }));
  let styles = [...root.querySelectorAll("style")]
    // Same reason as above: the map is not part of the export
    .map(s => (s.textContent ?? "").replace(/\/\*# sourceMappingURL=\S+\*\//g, ""))
    .filter(Boolean);
  return { scripts, styles };
}

/**
 * True when the tags carry the whole app. The built single-file page has one
 * huge inline module script; a dev page has only small bootstrap stubs and
 * `src=` references, which cannot be copied into a standalone file.
 */
function isWholeApp(tags: ReturnType<typeof collectTags>) {
  return tags.scripts.some(s => s.content.length > 50_000);
}

/**
 * The app bundle and styles to inline into the exported page.
 *
 * Normally the app already *is* the built single-file page, so its own inline
 * `<script>` and `<style>` are copied as they are. Under `vite dev` they are
 * linked rather than inline, so the last `npm run build` output is read instead
 * (`vite.config.ts` serves `build/index.html` under `/xpedia-built.html`).
 */
async function readAppAssets() {
  let own = collectTags(document);
  if (isWholeApp(own))
    return own;

  let response = await fetch("/xpedia-built.html").catch(() => undefined);
  let text = response?.ok ? await response.text() : "";
  if (text) {
    let built = collectTags(new DOMParser().parseFromString(text, "text/html"));
    if (isWholeApp(built))
      return built;
  }

  throw new Error("The single-file build is not available. " +
    "Run `npm run build` once, then export again.");
}

/**
 * Trims the processed ruleset to the languages the user picked. The ruleset is
 * stored exactly as the app runs it, so this only touches `langs`; everything
 * else (articles, entries, sprites) is already in its final form.
 */
function prepareRul(processed: any, languages: string[]) {
  let keep = new Set(["en-US", ...languages]);
  let langs: { [name: string]: any } = {};
  for (let name of Object.keys(processed.langs ?? {}))
    if (keep.has(name))
      langs[name] = processed.langs[name];
  return { ...processed, langs };
}

/**
 * Image paths the pedia can show, so only those files are needed in an archive.
 *
 * Sprites cover items, facilities, armor layers and article illustrations;
 * obs tables are the indexed sprite sheets (`BIGOBS.PCK` and friends).
 */
function referencedPaths() {
  let paths = new Set<string>();
  let rul = state.rul;
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

  return paths;
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/** JSON that can sit safely inside a `<script>` element */
function scriptJson(value: any) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Builds the HTML text of the exported pedia */
async function buildHtml(pack: string, processed: any, languages: string[]) {
  let trimmed = prepareRul(processed, languages);
  let gzipped = await gzipText(JSON.stringify(trimmed));
  let payload = {
    pack: exportedPackName(pack),
    rul: bytesToBase64(gzipped)
  };

  let { scripts, styles } = await readAppAssets();
  // The page title names the mod the pack is about, the same one the navbar
  // shows, not whichever mod happens to come last in the archive
  let meta = mainMod(trimmed.mods ?? [])?.meta;
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

/**
 * Builds the export. The single-file variant inlines only the ruleset, while the
 * archive also carries every image its articles can show, so it works without
 * the game being installed.
 */
export async function exportPedia(options: ExportOptions): Promise<ExportResult> {
  let pack = state.packName;
  if (!pack)
    throw new Error("Nothing to export: no modpack is selected");

  let report = options.onProgress ?? (() => { });
  report(`Preparing ${pack}...`, 0);

  let text = await readRulText(pack);
  if (!text)
    throw new Error(`The stored ruleset of ${pack} is missing, so there is nothing to export`);
  let processed = JSON.parse(text);

  report("Building the page...", 0.1);
  let html = await buildHtml(pack, processed, options.languages);
  let name = exportedPackName(pack);

  if (!options.archive) {
    report(`Exported ${name}.html`);
    return { name: name + ".html", data: new Blob([html], { type: "text/html" }) };
  }

  // The images go under the paths the game uses, next to the HTML file
  let files: { [path: string]: Uint8Array } = {};
  files[`${name}.html`] = new TextEncoder().encode(html);

  let paths = [...referencedPaths()];
  let images = 0;
  for (let i = 0; i < paths.length; i++) {
    let path = paths[i];
    let data = await readImgData(pack, path);
    if (data) {
      // Two archive paths can map to the same game file (`common/...` is
      // shared), so a later spelling must not overwrite the bytes already there
      let target = gameRelativePath(path);
      if (!files[target]) {
        files[target] = data;
        images++;
      }
    }
    // One update per few images keeps the dialog responsive on big packs
    if (i % 25 == 0 || i == paths.length - 1)
      report(`Bundling images... ${i + 1}/${paths.length}`,
        0.1 + 0.8 * (i + 1) / (paths.length || 1));
  }

  report("Compressing the archive...", 0.95);
  let zipped = fflate.zipSync(files, { level: 6 });
  report(`Exported ${name}.zip with ${images} images`, 1);
  return { name: name + ".zip", data: new Blob([zipped], { type: "application/zip" }) };
}

/** Languages provided by the shown pack, for the dialog checkboxes */
export function exportableLanguages() {
  let names = state.rul?.langNames ?? [];
  return names.filter(name => name != "en-US" && name != "icon");
}

/** Saves an exported file through a browser download */
export function downloadExport(result: ExportResult) {
  let url = URL.createObjectURL(result.data);
  let element = document.createElement("a");
  element.href = url;
  element.download = result.name;
  element.style.display = "none";
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  // Give the browser a moment to start the download before dropping the blob
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
