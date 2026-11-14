import * as fflate from "fflate";
import { state } from "./state";
import { readImgData, readImgSizes, readRulData } from "./idb";
import { isPermanentPack } from "./packSource";
import {
  base64Length, buildAssetFiles, buildPageHtml, exportedPackName, gzipText,
  onlyTranslated, prepareRul, referencedPaths, renderPage, zipFiles,
  type AppShell, type ExportFile, type TagCopy
} from "./exportCore";

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
 *
 * The page and archive themselves are built by `exportCore.ts`, which the
 * command line exporter shares; this module only supplies the browser's three
 * inputs — the stored ruleset, the stored images and the app's own shell.
 */

export { exportedPackName };
export type { ExportFile };

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

/**
 * Compresses text for the size preview, in pieces.
 *
 * The browser hands a whole blob to the compressor in one go, which blocks the
 * page for a few hundred milliseconds on a big translation. Feeding the same
 * bytes piece by piece produces an identical stream but yields to the page
 * between pieces, so the dialog keeps painting.
 */
async function gzipTextInPieces(text: string) {
  let bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream == "undefined")
    return fflate.gzipSync(bytes);
  let source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 65536)
        controller.enqueue(bytes.slice(i, i + 65536));
      controller.close();
    }
  });
  let stream = source.pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

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
 * (`vite.config.ts` serves `build/xpedia.html` under `/xpedia-built.html`).
 */
async function readAppAssets(): Promise<AppShell> {
  let own = collectTags(document);
  if (isWholeApp(own))
    return own;

  let response = await fetch("/xpedia-built.html").catch((): undefined => undefined);
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
 * What the export size preview needs to answer quickly, see `estimateSize`.
 *
 * Measuring from scratch means gzipping the whole ruleset, which takes about a
 * second on a big pack: far too slow for every checkbox click. So the parts that
 * do not depend on the selection are measured once when the dialog opens, and a
 * later estimate is a sum rather than a compression.
 */
export type ExportEstimate = {
  /** HTML around the ruleset payload, measured with an empty payload */
  shellBytes: number,
  /**
   * What that shell compresses to, which is what the archive stores.
   *
   * Only measured when the archive format is chosen, because a single-file
   * export never needs it.
   */
  shellGzipBytes?: number,
  /** Compressed ruleset with only the English strings */
  englishBytes: number,
  /**
   * Compressed size each language's own strings add on top of English.
   *
   * Filled in on demand: most exports carry no extra language at all, so
   * compressing all of them up front would be wasted work.
   */
  languageBytes: { [name: string]: number },
  /** Live language maps the on-demand sizes are cut from */
  langs: { [name: string]: any },
  /**
   * Bytes of the images the archive format would bundle, also measured on demand.
   *
   * Only the images the pedia can actually show travel, not every image the
   * pack stored, which can be several times more.
   */
  imageBytes?: number,
  /** The measured page, kept so the archive size can be taken from it later */
  html: string
};

/**
 * The processed ruleset of the pack currently in memory.
 *
 * This is the same shape `readRulData` returns, assembled from the live
 * `Ruleset` instead of the database. The export itself re-reads the stored copy,
 * because it must not hand out anything the app is still using, but a size
 * preview only needs the sizes, and re-reading a big pack costs more than all
 * the compression put together.
 */
function liveRulData() {
  let rul = state.rul;
  if (!rul)
    return;
  let langs = rul.langs ?? {};
  return {
    mods: rul.mods ?? [],
    // The language maps are already exactly what `prepareRul` expects: `en-US`
    // and `icon` whole, the rest a full copy of English with translations
    // written over it, which `onlyTranslated` trims back down
    langs,
    resources: rul.resourceMap ?? {}
  };
}

/**
 * Measurements already taken, so reopening the export dialog is instant.
 *
 * A module-level cache rather than component state: the dialog unmounts when it
 * closes, and measuring a big pack again would block the page for a second each
 * time. `xpedia:loaded` drops it, because that fires when the shown pack changes
 * or is re-uploaded.
 */
let estimateCache: { pack: string, value: Promise<ExportEstimate | undefined> } | undefined;

addEventListener("xpedia:loaded", () => {
  estimateCache = undefined;
});

/**
 * Measures the shown pack ahead of time, so the export dialog opens with its
 * size already known. Called when the export button appears, which only happens
 * in the developer view: for everyone else this would be CPU spent on a window
 * they cannot even open.
 */
export function warmEstimate() {
  if (state.packName && !isPermanentPack(state.packName))
    void prepareEstimate();
}

/** Everything an estimate needs, measured once per shown pack */
export function prepareEstimate(): Promise<ExportEstimate | undefined> {
  let pack = state.packName;
  if (!pack)
    return Promise.resolve(undefined);
  if (estimateCache?.pack == pack)
    return estimateCache.value;
  let value = measureEstimate(pack);
  estimateCache = { pack, value };
  // A failed measurement must not be remembered: the next open tries again
  value.catch(() => { if (estimateCache?.pack == pack) estimateCache = undefined; });
  return value;
}

/** Lets the page paint between two heavy steps, as the loader does */
function nextPaint() {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

/**
 * What the shell and the English ruleset cost. This is the slow half of a
 * measurement, and the only part every export needs, so it happens first.
 */
async function measureEstimate(pack: string): Promise<ExportEstimate | undefined> {
  let processed = liveRulData();
  if (!processed)
    return;

  let english = englishOnly(processed);
  // `renderPage` puts the base64 in `"rul":"..."`. Measuring with an empty
  // payload keeps the two quotes, so the shell is everything except the base64
  // characters themselves, which `estimateSize` adds back.
  let html = await renderPage(pack, english, "", await readAppAssets());
  let shellBytes = html.length;
  await nextPaint();

  let englishBytes = (await gzipTextInPieces(JSON.stringify(english))).length;

  // The archive details are only needed by that format, so they wait until it
  // is actually chosen
  return { shellBytes, englishBytes, languageBytes: {}, langs: processed.langs, html };
}

/**
 * Measures the parts only the archive format needs: how much the page itself
 * compresses to, and the size of the images it would bundle.
 *
 * The archive stores the page deflated. Its payload is base64 of a gzip stream,
 * and deflating base64 gets those same bytes back, so the archive comes out as
 * the page's own compression plus the compressed ruleset plus the images.
 */
export async function measureArchive(estimate: ExportEstimate, pack: string) {
  if (estimate.shellGzipBytes == null) {
    estimate.shellGzipBytes = (await gzipTextInPieces(estimate.html)).length;
    await nextPaint();
  }
  if (estimate.imageBytes == null) {
    // The archive carries only the images the pedia can show, so the referenced
    // paths are collected and looked up rather than taking the pack's whole
    // image total, which is usually much larger
    let sizes = await readImgSizes(pack);
    let imageBytes = 0;
    for (let path of referencedPaths(state.rul))
      imageBytes += sizes?.get(path) ?? 0;
    estimate.imageBytes = imageBytes;
  }
}

/**
 * Measures the sizes of the given languages, skipping the ones already known.
 *
 * Each language is its own gzip of its own strings, which takes a few tens of
 * milliseconds, so this is cheap enough to run when a checkbox is ticked.
 */
export async function measureLanguages(estimate: ExportEstimate, names: string[]) {
  let english = estimate.langs["en-US"] ?? {};
  for (let name of names) {
    if (name in estimate.languageBytes)
      continue;
    let own = onlyTranslated(english, estimate.langs[name] ?? {});
    estimate.languageBytes[name] = (await gzipTextInPieces(JSON.stringify(own))).length;
    // A big translation is a few hundred milliseconds of compression, so the
    // page gets a chance to paint the progress line between two of them
    await nextPaint();
  }
}

/** The ruleset as it looks with no language selected */
function englishOnly(processed: any) {
  return prepareRul(processed, []);
}

/**
 * Approximate size of the file the current selection would produce.
 *
 * The single HTML file is the shell plus the base64 payload; images are read
 * from the game folder next to it, so they cost the file nothing.
 *
 * The archive instead contains that page deflated. Its payload is base64 of a
 * gzip stream, and deflating base64 gets those same bytes back, so the archive
 * is the measured shell compression plus the compressed ruleset plus whatever
 * images the pedia can show.
 *
 * Languages are priced as if each were compressed alone, which ignores the
 * compression they could share, so the estimate errs slightly high — the safe
 * direction for a file size.
 */
export function estimateSize(estimate: ExportEstimate, languages: string[], archive: boolean) {
  let ruleset = estimate.englishBytes;
  for (let name of languages)
    ruleset += estimate.languageBytes[name] ?? 0;
  if (archive)
    return (estimate.shellGzipBytes ?? 0) + ruleset + (estimate.imageBytes ?? 0);
  return estimate.shellBytes + base64Length(ruleset);
}

/** True while something the chosen format needs has not been measured yet */
export function estimatePending(estimate: ExportEstimate | undefined, languages: string[], archive: boolean) {
  if (!estimate)
    return true;
  if (languages.some(name => !(name in estimate.languageBytes)))
    return true;
  return archive && (estimate.shellGzipBytes == null || estimate.imageBytes == null);
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

  let processed = await readRulData(pack);
  if (!processed)
    throw new Error(`The stored ruleset of ${pack} is missing, so there is nothing to export`);

  report("Building the page...", 0.1);
  let html = await buildPageHtml({
    pack, processed, languages: options.languages, shell: await readAppAssets()
  });
  let name = exportedPackName(pack);

  if (!options.archive) {
    report(`Exported ${name}.html`);
    return { name: name + ".html", data: new Blob([html], { type: "text/html" }) };
  }

  // The images go under the paths the game uses, next to the HTML file
  let files: ExportFile[] = await buildAssetFiles({
    pack, html, rul: state.rul,
    readImage: path => readImgData(pack, path),
    onProgress: (done, total) => report(`Bundling images... ${done}/${total}`,
      0.1 + 0.8 * done / (total || 1))
  });

  report("Compressing the archive...", 0.95);
  let zipped = zipFiles(files);
  let images = files.length - 1;
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
