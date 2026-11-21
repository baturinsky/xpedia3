import {
  type AppShell,
  buildLanguagePack,
  buildPageHtml,
  collectDataFiles,
  type ExportFile,
  languagePackPath,
  referencedPaths,
} from "./exportCore";
import { gameRelativePath } from "./packBuild";
import Ruleset, { defaultLanguage, type ProcessedRuleset } from "./rul/Ruleset";

/**
 * Building an export from a pack's files, shared by the command line and the
 * live server.
 *
 * `xpedia-cli` has two ways to reach this: writing a folder or a ZIP itself, and
 * `--serve` answering an HTTP request from the page it is serving. Both must
 * produce the same bytes, so neither owns the code — this module takes a reader
 * and decides only what the export has to contain.
 *
 * The reader is a callback rather than an archive because the two callers hold
 * their files differently: the exporter has unpacked an archive in memory, while
 * the server has a folder and would rather not read gigabytes of sprites into
 * memory for a page that may never be exported.
 */

/** What the export should carry, after the languages have been resolved */
export type ExportRequest = {
  /** Languages to keep, English included; the first is the page's own */
  languages: string[];
  /** Keep English in the page and write every other language as a script */
  split: boolean;
  /** Write the images the pedia can show, laid out as the game expects */
  images: boolean;
  /**
   * Public URL of the page, ending in `/`, for link previews.
   *
   * Only a page that will live somewhere has one; opening the file locally
   * has none, so the preview tags that need an address stay out.
   */
  url?: string;
};

/** Bytes of one file of the pack by archive path, or nothing when it has none */
export type PackReader = (archivePath: string) => Uint8Array | undefined;

export type ExportPlan = {
  /** Name of the page file inside the export */
  pageName: string;
  outputs: ExportFile[];
  /** How many of the outputs are pages rather than images */
  pages: number;
  /** How many image files were written */
  assets: number;
  /**
   * Total size of the image files, written or merely counted.
   *
   * Filled in both ways so an estimate can price the images without carrying
   * them: a sprite is already compressed, so its bytes survive zipping almost
   * unchanged, and only their total is needed to answer "how big would this be".
   */
  imageBytes: number;
};

/** Where stage reports go; the CLI prints them, the server logs them */
export type ExportReporter = {
  info: (message: string) => void;
  /** Progress that overwrites itself, for long stages */
  progress?: (message: string) => void;
  /** Ends the progress line, if one is open */
  endProgress?: () => void;
};

/**
 * Bytes for the link-preview image: the first article illustration the pack
 * has, else the first image it can show.
 *
 * An illustration is what a preview should be — a full picture, not an
 * inventory icon — and the pack's own order makes the choice stable from
 * one export to the next, so re-exporting does not churn the preview.
 */
function previewImageBytes(
  rul: Ruleset,
  paths: string[],
  readFile: PackReader,
): Uint8Array | undefined {
  const candidates: string[] = [];
  for (const article of Object.values(rul.articles)) {
    const id = article?.image_id;
    if (!id) continue;
    const sprite = rul.sprites[id];
    const path = sprite?.path ?? (/[\\/]/.test(id) ? id : undefined);
    if (path) candidates.push(path);
  }
  candidates.push(...paths);
  for (const path of candidates) {
    const bytes = readFile(path);
    if (bytes?.length) return bytes;
  }
  return undefined;
}

/**
 * Builds everything an export consists of, in memory.
 *
 * The page is built before the ruleset is constructed: doing it the other way
 * round would stamp the language flags onto the shared `langs` map, and those
 * must not travel inside an exported payload — the browser exporter does not
 * add them either.
 */
export async function buildExport(options: {
  /** The pack's own name, without an archive extension */
  packName: string;
  processed: ProcessedRuleset;
  readFile: PackReader;
  shell: AppShell;
  request: ExportRequest;
  /** File name of the page inside the export */
  pageName: string;
  /**
   * Count the images rather than keeping their bytes.
   *
   * An estimate needs to know how big they are but never writes them out, and a
   * pack's sprites are hundreds of megabytes: holding them in a list that is
   * thrown away would make quoting a size cost as much as the export.
   */
  weighOnly?: boolean;
  report: ExportReporter;
}): Promise<ExportPlan> {
  const { packName, processed, readFile, shell, request, pageName, weighOnly, report } = options;
  const primary = request.languages[0] ?? defaultLanguage;
  // English travels with every page as the fallback, so it is never left out;
  // a page that *is* English simply needs no second copy of it
  const extra = request.languages.filter((name) => name !== defaultLanguage);

  // A split export is one page carrying English plus a script per other
  // language, so the page name never varies with the languages
  let packs: { [name: string]: string } | undefined;
  if (request.split)
    packs = Object.fromEntries(extra.map((name) => [name, languagePackPath(name)]));

  report.info(`Building ${pageName} (${request.split ? "English" : primary})`);
  // Link previews need absolute URLs, which only a published page has; the
  // preview image travels as its own file beside the page, so the page can
  // name it before its bytes are collected. Only an export that writes
  // images writes it, see below.
  const link = request.url
    ? {
        url: request.url,
        image: request.images ? `${request.url}og-image.png` : undefined,
      }
    : undefined;
  // The raw data files the page has to carry, gathered before the page is built
  // because they go inside it
  const data = await collectDataFiles(
    processed.resources,
    async (archivePath) => readFile(archivePath),
    processed.mods,
  );
  const html = await buildPageHtml({
    pack: packName,
    processed,
    // A split page carries English alone; the other languages travel as packs
    languages: request.split ? [] : extra,
    shell,
    // Only a page that cannot hold every language needs to say how it starts
    page: request.split ? { packs } : primary === defaultLanguage ? undefined : { lang: primary },
    data,
    link,
  });

  const outputs: ExportFile[] = [{ path: pageName, data: new TextEncoder().encode(html) }];
  const pages = 1;

  if (request.split)
    for (const name of extra) {
      const rel = languagePackPath(name);
      report.info(`Building ${rel} (${name})`);
      outputs.push({
        path: rel,
        data: new TextEncoder().encode(buildLanguagePack(processed, name)),
      });
    }

  let assets = 0;
  let imageBytes = 0;
  if (request.images) {
    // Only the images the pedia can show travel, laid out where the game keeps
    // them, so the result works without a game installation.
    //
    // The ruleset is built here, after the page and every language pack are
    // already turned into text: constructing one stamps the language flags onto
    // the shared `langs` map, and a payload written afterwards would carry them.
    // The browser exporter does not add them, so neither may this.
    const rul = new Ruleset(processed);
    const paths = [...referencedPaths(rul)];
    /** Paths already claimed, so a later spelling cannot overwrite the bytes */
    const taken = new Set(outputs.map((o) => o.path));
    for (let i = 0; i < paths.length; i++) {
      const bytes = readFile(paths[i]);
      if (bytes?.length) {
        const rel = gameRelativePath(paths[i]);
        if (!taken.has(rel)) {
          taken.add(rel);
          imageBytes += bytes.length;
          assets++;
          if (!weighOnly) outputs.push({ path: rel, data: bytes });
        }
      }
      if (i % 20 === 0 || i === paths.length - 1)
        report.progress?.(
          `${weighOnly ? "Weighing" : "Collecting"} images ${assets}/${paths.length}`,
        );
    }
    report.endProgress?.();
    report.info(`${weighOnly ? "Weighed" : "Collected"} ${assets} image(s)`);

    // The preview image the page already names: one more file beside it,
    // never weighed the same way, because an estimate need not carry bytes
    if (link?.image && !weighOnly) {
      const bytes = previewImageBytes(rul, paths, readFile);
      if (bytes?.length && !taken.has("og-image.png"))
        outputs.push({ path: "og-image.png", data: bytes });
    }
  }

  return { pageName, outputs, pages, assets, imageBytes };
}
