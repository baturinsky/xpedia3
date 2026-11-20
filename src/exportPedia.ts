import * as fflate from "fflate";
import {
  type AppShell,
  base64Length,
  buildAssetFiles,
  buildLanguagePack,
  buildPageHtml,
  collectDataFiles,
  type ExportFile,
  exportedPackName,
  languagePackPath,
  onlyTranslated,
  prepareRul,
  referencedPaths,
  renderPage,
  type TagCopy,
  zipFiles,
} from "./exportCore";
import { readImgSizes } from "./idb";
import { inlineDataFiles, packSource } from "./packSource";
import type { Langs, ProcessedRuleset } from "./rul/Ruleset";
import { state } from "./state";
import { base64ToArrayBuffer } from "./util";

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

export type { ExportFile };
export { exportedPackName };

/** The export settings chosen in the modal dialog */
export type ExportOptions = {
  /** Language names to keep besides `en-US`, which is always exported */
  languages: string[];
  /** Bundle every image the pedia can show, so the game is not needed at all */
  images: boolean;
  /**
   * Keep English in the page and write each other language as a script under
   * `xpedia-lang/`, loaded when the reader picks it.
   */
  split: boolean;
  /**
   * Write one ZIP instead of loose files.
   *
   * This is the container, not the contents: a browser download is a single
   * file, so the dialog sets it whenever the export is more than one file, but
   * what goes *in* is decided by `images` and `split` alone. Asking for language
   * packs must never drag the images along.
   */
  archive: boolean;
  /** Stage text and 0..1 progress, for the dialog */
  onProgress?: (status: string, progress?: number) => void;
};

export type ExportResult = {
  name: string;
  data: Blob;
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
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream == "undefined") return fflate.gzipSync(bytes);
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 65536) controller.enqueue(bytes.slice(i, i + 65536));
      controller.close();
    },
  });
  const stream = source.pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inline scripts and styles of a document, as they must be copied out */
function collectTags(root: ParentNode) {
  const scripts: TagCopy[] = [...root.querySelectorAll("script")]
    .filter((s) => !s.getAttribute("src") && s.textContent?.trim())
    // An exported page carries its own ruleset in a script; copying that one
    // would nest one exported pedia inside another
    .filter((s) => !s.hasAttribute("data-xpedia-export"))
    .map((s) => ({
      attrs: [...s.attributes].map((a) => `${a.name}="${a.value}"`).join(" "),
      // The dev build points at `bundle.js.map`, which is not part of the
      // export: dropping the comment keeps the file fully standalone
      content: s.textContent!.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n"),
    }));
  const styles = [...root.querySelectorAll("style")]
    // Same reason as above: the map is not part of the export
    .map((s) => (s.textContent ?? "").replace(/\/\*# sourceMappingURL=\S+\*\//g, ""))
    .filter(Boolean);
  return { scripts, styles };
}

/**
 * True when the tags carry the whole app. The built single-file page has one
 * huge inline module script; a dev page has only small bootstrap stubs and
 * `src=` references, which cannot be copied into a standalone file.
 */
function isWholeApp(tags: ReturnType<typeof collectTags>) {
  return tags.scripts.some((s) => s.content.length > 50_000);
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
  const own = collectTags(document);
  if (isWholeApp(own)) return own;

  const response = await fetch("/xpedia-built.html").catch((): undefined => undefined);
  const text = response?.ok ? await response.text() : "";
  if (text) {
    const built = collectTags(new DOMParser().parseFromString(text, "text/html"));
    if (isWholeApp(built)) return built;
  }

  throw new Error(
    "The single-file build is not available. " + "Run `npm run build` once, then export again.",
  );
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
  shellBytes: number;
  /**
   * What that shell compresses to, which is what the archive stores.
   *
   * Only measured when the archive format is chosen, because a single-file
   * export never needs it.
   */
  shellGzipBytes?: number;
  /** Compressed ruleset with only the English strings */
  englishBytes: number;
  /**
   * Compressed size each language's own strings add on top of English.
   *
   * Filled in on demand: most exports carry no extra language at all, so
   * compressing all of them up front would be wasted work.
   */
  languageBytes: { [name: string]: number };
  /** Live language maps the on-demand sizes are cut from */
  langs: Langs;
  /**
   * Bytes of the images the archive format would bundle, also measured on demand.
   *
   * Only the images the pedia can actually show travel, not every image the
   * pack stored, which can be several times more.
   */
  imageBytes?: number;
  /** The measured page, kept so the archive size can be taken from it later */
  html: string;
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
  const rul = state.rul;
  if (!rul) return;
  const langs = rul.langs ?? {};
  return {
    mods: rul.mods ?? [],
    // The language maps are already exactly what `prepareRul` expects: `en-US`
    // and `icon` whole, the rest a full copy of English with translations
    // written over it, which `onlyTranslated` trims back down
    langs,
    resources: rul.resourceMap ?? {},
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
let estimateCache: { pack: string; value: Promise<ExportEstimate | undefined> } | undefined;

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
  if (state.packName) void prepareEstimate();
}

/** Everything an estimate needs, measured once per shown pack */
export function prepareEstimate(): Promise<ExportEstimate | undefined> {
  const pack = state.packName;
  if (!pack) return Promise.resolve(undefined);
  if (estimateCache?.pack == pack) return estimateCache.value;
  const value = measureEstimate(pack);
  estimateCache = { pack, value };
  // A failed measurement must not be remembered: the next open tries again
  value.catch(() => {
    if (estimateCache?.pack == pack) estimateCache = undefined;
  });
  return value;
}

/** Lets the page paint between two heavy steps, as the loader does */
function nextPaint() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * What the shell and the English ruleset cost. This is the slow half of a
 * measurement, and the only part every export needs, so it happens first.
 */
async function measureEstimate(pack: string): Promise<ExportEstimate | undefined> {
  const processed = liveRulData();
  if (!processed) return;

  const english = englishOnly(processed);
  // `renderPage` puts the base64 in `"rul":"..."`. Measuring with an empty
  // payload keeps the two quotes, so the shell is everything except the base64
  // characters themselves, which `estimateSize` adds back.
  const html = await renderPage(pack, english, "", await readAppAssets());
  const shellBytes = html.length;
  await nextPaint();

  const englishBytes = (await gzipTextInPieces(JSON.stringify(english))).length;

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
 *
 * The shell is needed by every archive, the images only by those that carry
 * them: `withImages` keeps a split export from measuring sprites it will not
 * write. The two are independent so neither can be skipped by accident — a
 * missing shell would price the page at nothing.
 */
export async function measureArchive(estimate: ExportEstimate, pack: string, withImages = true) {
  if (estimate.shellGzipBytes == null) {
    estimate.shellGzipBytes = (await gzipTextInPieces(estimate.html)).length;
    await nextPaint();
  }
  if (withImages && estimate.imageBytes == null) {
    // The archive carries only the images the pedia can show, so the referenced
    // paths are looked up rather than taking the pack's whole image total, which
    // is usually much larger
    const sizes = await readImgSizes(pack);
    let imageBytes = 0;
    for (const path of referencedPaths(state.rul)) imageBytes += sizes?.get(path) ?? 0;
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
  const english = estimate.langs["en-US"] ?? {};
  for (const name of names) {
    if (name in estimate.languageBytes) continue;
    const own = onlyTranslated(english, estimate.langs[name] ?? {});
    estimate.languageBytes[name] = (await gzipTextInPieces(JSON.stringify(own))).length;
    // A big translation is a few hundred milliseconds of compression, so the
    // page gets a chance to paint the progress line between two of them
    await nextPaint();
  }
}

/** The ruleset as it looks with no language selected */
function englishOnly(processed: ProcessedRuleset) {
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
 * The images are priced only when they are actually going in: `archive` is the
 * container, so a split export without images must not be quoted as if it
 * carried them. Languages are priced as if each were compressed alone, which
 * ignores the compression they could share, so the estimate errs slightly high —
 * the safe direction for a file size.
 */
export function estimateSize(
  estimate: ExportEstimate,
  languages: string[],
  archive: boolean,
  images = false,
) {
  let ruleset = estimate.englishBytes;
  for (const name of languages) ruleset += estimate.languageBytes[name] ?? 0;
  if (archive)
    return (estimate.shellGzipBytes ?? 0) + ruleset + (images ? (estimate.imageBytes ?? 0) : 0);
  return estimate.shellBytes + base64Length(ruleset);
}

/**
 * True while something the chosen format needs has not been measured yet.
 *
 * The image total is only needed when images are going in; a split export
 * without them waits for the shell alone, so ticking "Split" does not sit on a
 * progress line measuring sprites it will never write.
 */
export function estimatePending(
  estimate: ExportEstimate | undefined,
  languages: string[],
  archive: boolean,
  images = false,
) {
  if (!estimate) return true;
  if (languages.some((name) => !(name in estimate.languageBytes))) return true;
  return archive && (estimate.shellGzipBytes == null || (images && estimate.imageBytes == null));
}

/**
 * Has the server behind a served pack build the archive, and returns it.
 *
 * The request is a GET because everything it carries is small: the languages,
 * and two flags. The reply is the zip the command line would have written for
 * the same folder, so the two are interchangeable rather than merely similar.
 *
 * The reply is read as a blob and saved by the same `downloadExport` the
 * browser-built archive uses, so the two paths show the same progress and end in
 * the same file. That holds the archive in memory while it is saved, which is
 * what the page cannot avoid for a download, but the bytes never make a round
 * trip through the ruleset the way a browser export's would.
 */
async function exportThroughServer(
  url: string,
  pack: string,
  options: ExportOptions,
  report: (status: string, progress?: number) => void,
): Promise<ExportResult> {
  // English always travels, and every export writes a page, so the CLI's own
  // defaults decide the rest: no `lang` means every language the folder has
  const query = new URLSearchParams();
  if (options.languages.length) query.set("lang", options.languages.join(","));
  if (options.split) query.set("split", "1");
  if (options.images) query.set("images", "1");

  const endpoint = `${url}?${query}`;
  report(`Asking the server to export ${pack}...`, 0.1);

  let response: Response;
  try {
    response = await fetch(endpoint);
  } catch (e) {
    throw new Error(
      `The server that serves ${pack} is not reachable any more: ` +
        `${e?.message ?? e}. Export the folder with \`xpedia-cli\` instead.`,
    );
  }

  if (!response.ok) {
    // The server sends a plain-text explanation, which is written for a modder
    const detail = await response.text().catch(() => "");
    throw new Error(detail.trim() || `The server refused to export ${pack} (${response.status})`);
  }

  report("Downloading the archive...", 0.7);
  const blob = await response.blob();
  report("Downloaded the archive", 1);

  // The server names the file, so the dialog and the saved file agree
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : `${exportedPackName(pack)}.zip`;
  return { name, data: blob };
}

/**
 * Builds the export. The single-file variant inlines only the ruleset, while the
 * archive also carries every image its articles can show, so it works without
 * the game being installed.
 */
export async function exportPedia(options: ExportOptions): Promise<ExportResult> {
  const pack = state.packName;
  if (!pack) throw new Error("Nothing to export: no modpack is selected");

  const source = packSource(pack);
  const report = options.onProgress ?? (() => {});
  report(`Preparing ${pack}...`, 0);

  // A served pack is a folder with a server behind it, and the browser never
  // received its images. That server can export the folder with the same code
  // the command line uses, so a request for the images is handed back to it
  // rather than producing a pack that silently lacks them. A page without them
  // the browser still builds itself, which keeps the common case instant.
  if (source?.serveExport && options.images)
    return exportThroughServer(source.serveExport.url, pack, options, report);

  const processed = await source?.rulData();
  if (!processed)
    throw new Error(`The ruleset of ${pack} is missing, so there is nothing to export`);

  // The globe a page carries inside itself is read back from the payload: an
  // exported page has no stored copy of it, and a page opened from `file://`
  // cannot fetch its neighbours. `inlineDataFiles` is empty for a database pack,
  // which then reads the file the way every other asset is read.
  const carried = inlineDataFiles() ?? {};

  report("Building the page...", 0.1);
  const name = exportedPackName(pack);
  const pairs = options.split ? options.languages.filter((lang) => lang != "en-US") : [];
  const html = await buildPageHtml({
    pack,
    processed,
    // A split page carries English alone; the others travel beside it
    languages: options.split ? [] : options.languages,
    shell: await readAppAssets(),
    page: options.split
      ? { packs: Object.fromEntries(pairs.map((lang) => [lang, languagePackPath(lang)])) }
      : undefined,
    // The world map's globe travels inside the page: it is far too small to need
    // a file beside it, and a page opened from `file://` cannot read one anyway
    data: await collectDataFiles(
      processed.resources,
      async (archivePath, rel) => {
        const own = carried[rel];
        if (own) return fflate.gunzipSync(new Uint8Array(base64ToArrayBuffer(own)));
        return source?.fileData(archivePath);
      },
      processed.mods,
    ),
  });

  // A single HTML file is only possible when nothing else is asked for; the
  // caller decides that via `archive`, so reaching here means loose files
  if (!options.archive) {
    report(`Exported ${name}.html`);
    return { name: name + ".html", data: new Blob([html], { type: "text/html" }) };
  }

  // The page is written first either way. The images are a separate choice:
  // language packs share the archive with them, but asking for the packs must
  // not pull in hundreds of megabytes of sprites the reader never asked for.
  //
  // A pack whose images are not in the page has none here to bundle: an exported
  // page keeps them as files beside it, and a served folder's were answered above
  // by the server that owns them.
  const bundleImages = options.images && !source?.imagesUnavailable;
  let files: ExportFile[] = [{ path: `${name}.html`, data: new TextEncoder().encode(html) }];
  let images = 0;
  if (bundleImages) {
    // Images go under the paths the game uses, next to the HTML file
    const withImages = await buildAssetFiles({
      pack,
      page: `${name}.html`,
      html,
      rul: state.rul,
      readImage: (path) => source?.fileData(path) ?? Promise.resolve(undefined),
      onProgress: (done, total) =>
        report(`Bundling images... ${done}/${total}`, 0.1 + (0.8 * done) / (total || 1)),
    });
    files = withImages;
    images = files.length - 1;
  }

  // The language packs are tiny next to the images, and they change the page
  // very little, so they are built after it but reported with it
  for (const lang of pairs)
    files.push({
      path: languagePackPath(lang),
      data: new TextEncoder().encode(buildLanguagePack(processed, lang)),
    });

  report("Compressing the archive...", 0.95);
  const zipped = zipFiles(files);
  const contents = [
    images ? `${images} images` : "",
    pairs.length ? `${pairs.length} language packs` : "",
  ]
    .filter(Boolean)
    .join(" and ");
  report(`Exported ${name}.zip` + (contents ? ` with ${contents}` : ""), 1);
  return { name: name + ".zip", data: new Blob([zipped], { type: "application/zip" }) };
}

/** Languages provided by the shown pack, for the dialog checkboxes */
export function exportableLanguages() {
  const names = state.rul?.langNames ?? [];
  return names.filter((name) => name != "en-US" && name != "icon");
}

/** Saves an exported file through a browser download */
export function downloadExport(result: ExportResult) {
  const url = URL.createObjectURL(result.data);
  const element = document.createElement("a");
  element.href = url;
  element.download = result.name;
  element.style.display = "none";
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  // Give the browser a moment to start the download before dropping the blob
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
