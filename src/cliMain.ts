import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import builtinModsPayload from "xpedia:builtin-mods";
import shellPayload from "xpedia:shell";
import unrarWasmPayload from "xpedia:unrar-wasm";
import { fileTypeFromBuffer } from "file-type";
import { UsageError } from "./cliError";
import { buildExport } from "./cliExport";
import { layoutOf, listFiles, readFolderPack } from "./cliFolder";
import { resolveLanguages } from "./cliLanguages";
import { servePack } from "./cliServe";
import { type AppShell, type ExportFile, exportedPackName, zipFiles } from "./exportCore";
import {
  buildPackData,
  filterBuiltinMods,
  mergeBuiltinFiles,
  unpackBuiltinMods,
  unpackRar,
  unpackZip,
} from "./packBuild";
import { defaultLanguage } from "./rul/Ruleset";

/**
 * Exports an XPedia modpack without a browser.
 *
 * Everything the page needs is embedded in this file at build time, so it never
 * reads `build/xpedia.html` or any other companion file. It does write the same
 * page the browser exporter does, with the same payload, so the two produce
 * interchangeable results.
 */

const helpText = `xpedia-cli - export an XPedia modpack as a standalone reference

Usage:
  xpedia-cli <pack.zip|pack.rar|folder> <target> [options]
  xpedia-cli --serve[=<folder>] [options]

Arguments:
  <pack>                 Modpack archive (ZIP or RAR), or a folder laid out the
                         way --serve reads one: a game root with user/mods, a
                         folder of mod folders, or a single mod folder.
  <target>               Output directory, or the path of a file to write. A
                         directory gets index.html and, with --split, an
                         xpedia-lang/ folder of language scripts. A name ending
                         in .html is written as that page; a name ending in .zip
                         is the archive --zip writes.

Options:
  --serve[=<folder>]     Serve a modpack folder instead of exporting anything,
                         so a mod can be seen live without repacking it. The
                         folder is the current one when none is named. Any of
                         the usual arrangements is understood: a game root with
                         user/mods, a folder of mod folders, or a single mod
                         folder of its own. Mods, images and sounds are read
                         from the folder as the request arrives; reload the page
                         to pick up an edit. Exporting from the served page is
                         handled by this process, so the result carries the
                         images the browser never received. See the HTTP
                         interface below.
  --port <n>             Port for --serve, 9391 by default. The next free port
                         is used when it is taken, and the one chosen is printed.
  --lang <names>         Languages to include, comma separated and repeatable.
                         Omitting it exports every language the pack has.
                         English is always carried as the fallback, so
                         "--lang en-US" means English only.
  --split                Keep English in the page and write every other language
                         as a script under xpedia-lang/, loaded when the reader
                         picks that language. The page stays the size of an
                         English export instead of growing with translations.
  --assets               Also write every image as a real file, laid out the way
                         the game expects, so the result runs without the game.
  --zip                  Write a single .zip instead of loose files, like the
                         browser export does.
  --url <url>            Public URL the exported page will be served from,
                         e.g. https://example.io/xcf/. Used for link
                         previews: the title and description are published
                         as Open Graph tags, and with --assets a preview
                         image beside the page backs og:image. Without it
                         the title and description tags are still written,
                         but no og:url or og:image.
  --no-manifest          Do not write .xpedia-export.json, and remove one left by
                         an earlier run. Stale files are then not cleaned up, so
                         a directory stays exactly as this run left it.
  --force, -f            Overwrite and delete without asking.
  --quiet, -q            Only report errors.
  --help, -h             Show this help.

The primary language is the first one named by --lang, or English. It is the one
an unsplit page opens in; with --split every language but English is a pack.

While --serve is running, the folder can also be exported over HTTP.

HTTP interface:
  GET /xpedia-export      Builds an export of the folder and answers with the
                          .zip, taking the same choices as the flags above:
                          lang, split, images and name, each as a query
                          parameter, with images and split given as 1.
                          Adding estimate=1 replies with the size as JSON
                          instead of the archive.

The served page uses this for its own export button, and it can be called
directly, for example to fetch a size without writing anything out.

Examples:
  xpedia-cli "Dioxine_XPiratez.zip" public/pedia
  xpedia-cli pack.zip site --assets --lang ru,en-US
  xpedia-cli pack.zip site --split --lang ru,de,pl
  xpedia-cli pack.rar pedia.zip --zip
  xpedia-cli "D:/OpenXcom/user/mods/MyMod" site
  xpedia-cli --serve "D:/OpenXcom/user/mods/MyMod"
  xpedia-cli --serve --port 8080

The page is the XPedia app compiled into this file, so a new UI build means a new
CLI: rebuild it with \`npm run cli\`.
`;

/** Parsed command line */
type Options = {
  source: string;
  target: string;
  languages: string[] | undefined;
  split: boolean;
  assets: boolean;
  zip: boolean;
  /** Public URL of the page for link previews, ending in `/` */
  url: string | undefined;
  force: boolean;
  quiet: boolean;
  manifest: boolean;
  /** Folder to serve, empty when the current directory is meant */
  serve: string | undefined;
  port: number;
};

/** The port `--serve` starts at, one that is easy to remember and unlikely taken */
const defaultPort = 9391;

function parseArgs(argv: string[]): Options | "help" {
  const positional: string[] = [];
  let languages: string[] | undefined;
  let split = false,
    assets = false,
    zip = false,
    force = false,
    quiet = false;
  let manifest = true;
  let serve: string | undefined;
  let port: number | undefined;
  let url: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // A bare `-` is a valid path; anything else starting with `-` is a flag
    if (arg === "--help" || arg === "-h") return "help";
    else if (arg === "--split") split = true;
    else if (arg === "--assets") assets = true;
    else if (arg === "--zip") zip = true;
    else if (arg === "--no-manifest" || arg === "--nomanifest") manifest = false;
    else if (arg === "--force" || arg === "-f") force = true;
    else if (arg === "--quiet" || arg === "-q") quiet = true;
    else if (arg === "--serve" || arg.startsWith("--serve=")) {
      // Both `--serve folder` and `--serve=folder` are accepted. A bare
      // `--serve` serves the current directory, and a following argument is not
      // taken as the folder: `--serve pack.zip out` would otherwise silently
      // treat the archive as a folder.
      const value = arg === "--serve" ? undefined : arg.substring("--serve=".length);
      serve = value ?? "";
    } else if (arg === "--port" || arg.startsWith("--port=")) {
      const value = arg === "--port" ? argv[++i] : arg.substring("--port=".length);
      if (value == null || value.startsWith("--"))
        throw new UsageError("--port needs a number, e.g. --port 8080");
      port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new UsageError(
          `--port needs a whole number between 1 and 65535, not ${JSON.stringify(value)}`,
        );
    } else if (arg === "--lang" || arg.startsWith("--lang=")) {
      // Both `--lang ru,de` and `--lang=ru,de` are accepted, and repeating the
      // flag adds to the list rather than replacing it
      const value = arg === "--lang" ? argv[++i] : arg.substring("--lang=".length);
      if (value == null || value.startsWith("--"))
        throw new UsageError("--lang needs a value, e.g. --lang ru,de");
      languages ??= [];
      for (const name of value.split(",")) if (name.trim()) languages.push(name.trim());
    } else if (arg === "--url" || arg.startsWith("--url=")) {
      // Both `--url https://example.io/xcf/` and `--url=https://...` are accepted
      const value = arg === "--url" ? argv[++i] : arg.substring("--url=".length);
      if (value == null || value.startsWith("--"))
        throw new UsageError("--url needs a URL, e.g. --url https://example.io/xcf/");
      if (!/^https?:\/\//i.test(value))
        throw new UsageError(
          `--url needs an http(s) URL, not ${JSON.stringify(value)}: a link preview can only point at a public address`,
        );
      // The page lives at this folder's address, so the preview image is
      // named by appending to it; a missing trailing slash would make that
      // append land next to the page instead of inside it
      url = value.endsWith("/") ? value : `${value}/`;
    } else if (arg.startsWith("-") && arg !== "-") throw new UsageError(`Unknown option: ${arg}`);
    else positional.push(arg);
  }

  if (serve !== undefined) {
    if (url != null) throw new UsageError("--url only applies to exporting");
    // The folder is normally named by `--serve=`, but a single positional is
    // also read as one so `xpedia-cli --serve D:/mods/MyMod` works
    let folder = serve;
    if (!folder) {
      if (positional.length === 1) folder = positional[0];
      else if (positional.length > 1)
        throw new UsageError(`--serve takes one folder, not ${positional.length} arguments`);
    }
    return {
      source: "",
      target: "",
      languages,
      split,
      assets,
      zip,
      url,
      force,
      quiet,
      manifest,
      serve: folder,
      port: port ?? defaultPort,
    };
  }

  if (port != null) throw new UsageError("--port only applies to --serve");

  if (positional.length < 2) throw new UsageError("A modpack archive and a target are required");
  if (positional.length > 2) throw new UsageError(`Unexpected argument: ${positional[2]}`);

  return {
    source: positional[0],
    target: positional[1],
    languages: languages?.length ? languages : undefined,
    split,
    assets,
    zip,
    url,
    force,
    quiet,
    manifest,
    serve: undefined,
    port: defaultPort,
  };
}

/** Writes to stderr, so `--quiet` can silence progress without hiding failures */
function makeReporter(quiet: boolean) {
  let last = "";
  return {
    info(message: string) {
      if (!quiet) process.stderr.write(`${message}\n`);
    },
    /** Progress that overwrites itself, so long stages do not scroll */
    progress(message: string) {
      if (quiet) return;
      const width = process.stderr.columns ?? 80;
      const line = message.length > width ? `${message.slice(0, width - 1)}…` : message;
      process.stderr.write(`\r${line.padEnd(last.length)}`);
      last = line;
    },
    /** Ends the current progress line, if one is open */
    endProgress() {
      if (quiet || !last) return;
      process.stderr.write("\n");
      last = "";
    },
    error(message: string) {
      process.stderr.write(`${message}\n`);
    },
  };
}

/** The app shell the page carries, recovered from the embedded build */
function appShell(): AppShell {
  const html = zlib.gunzipSync(Buffer.from(shellPayload, "base64")).toString("utf8");
  return extractShell(html);
}

/**
 * Finds the inline `<script>` and `<style>` of the built page.
 *
 * This mirrors what the browser exporter copies out of its own document: the
 * built single-file page has one huge inline module script and the app's styles
 * inline, and nothing else that matters.
 */
function extractShell(html: string): AppShell {
  const scripts: { attrs: string; content: string }[] = [];
  const scriptRe = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while (true) {
    match = scriptRe.exec(html);
    if (match === null) break;
    const attrs = match[1].trim();
    const content = match[2];
    if (/\bsrc=/.test(attrs) || !content.trim()) continue;
    // An exported page carries its own ruleset; copying that one would nest one
    // pedia inside another
    if (/data-xpedia-export/.test(attrs)) continue;
    scripts.push({
      // The browser exporter copies attributes off the DOM, which writes a bare
      // attribute as `name=""`; doing the same keeps both exports identical
      attrs: match[1].trim().replace(/(^|\s)([a-zA-Z-]+)(?=\s|$)/g, '$1$2=""'),
      // The dev build points at `bundle.js.map`, which is not part of the export
      content: content.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n"),
    });
  }

  const styles: string[] = [];
  const styleRe = /<style([^>]*)>([\s\S]*?)<\/style>/gi;
  while (true) {
    match = styleRe.exec(html);
    if (match === null) break;
    const content = (match[2] ?? "").replace(/\/\*# sourceMappingURL=\S+\*\//g, "");
    if (content) styles.push(content);
  }

  if (!scripts.some((s) => s.content.length > 50_000))
    throw new Error(
      "The embedded app shell has no application bundle: run `npm run build` and rebuild the CLI",
    );
  return { scripts, styles };
}

/**
 * Decides whether the target is a directory or a file, and what kind of file.
 *
 * An existing directory is a directory, and so is a name that ends in neither
 * `.html` nor `.zip`: creating a directory is the useful default, and it never
 * destroys what is already there. An existing other file is an error, because
 * writing over it would be a surprise.
 */
function targetKind(target: string) {
  const stat = fs.statSync(target, { throwIfNoEntry: false });
  if (stat?.isDirectory()) return { directory: true as const };
  if (stat?.isFile()) {
    if (/\.html?$/i.test(target)) return { directory: false as const, file: target, html: true };
    if (/\.zip$/i.test(target)) return { directory: false as const, file: target, html: false };
    throw new UsageError(`${target} exists and is not an .html file, a .zip file or a directory`);
  }
  if (/\.html?$/i.test(target)) return { directory: false as const, file: target, html: true };
  if (/\.zip$/i.test(target)) return { directory: false as const, file: target, html: false };
  return { directory: true as const };
}

/**
 * Checks that the output directory can be used, without creating it.
 *
 * Creating it here would leave an empty directory behind if the user then
 * refuses the overwrite, so the writers create it instead, recursively, which
 * also lets `site/pedia` work when `site` does not exist yet.
 */
function checkDirectory(dir: string) {
  const stat = fs.statSync(dir, { throwIfNoEntry: false });
  if (stat && !stat.isDirectory()) throw new UsageError(`${dir} exists and is not a directory`);
}

/** Reads a pack archive, reporting the stages the way the loader does */
async function readArchive(file: string, report: ReturnType<typeof makeReporter>) {
  const data = fs.readFileSync(file);
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const type = await fileTypeFromBuffer(buffer).catch(() => undefined);
  if (!type || (type.ext !== "zip" && type.ext !== "rar"))
    throw new UsageError(`${file} is not a ZIP or RAR archive`);

  report.info(`Reading ${path.basename(file)} (${(data.length / 1e6).toFixed(1)} MB)`);
  let files: { [name: string]: Uint8Array };
  if (type.ext === "rar") {
    const wasm = Buffer.from(unrarWasmPayload, "base64");
    files = await unpackRar(
      buffer,
      wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
      {
        onProgress: (done, total, name) =>
          report.progress(
            `Unpacking ${done}/${total} files${name ? `: ${path.basename(name)}` : ""}`,
          ),
      },
    );
  } else files = unpackZip(buffer);
  report.endProgress();

  if (!Object.keys(files).length) throw new UsageError(`Nothing usable found in ${file}`);

  report.info(`Unpacked ${Object.keys(files).length} files`);
  return files;
}

/**
 * Reads a folder as if it were an archive, which is what `--serve` already does
 * for a live preview: a modder works on a folder and should not have to repack
 * it just to see the pedia it produces.
 *
 * The layout rules live in `cliFolder.ts`, shared with `--serve`, so a folder
 * exports exactly what it would have served. The image bytes are read here
 * rather than skipped, because an export writes them.
 */
function readFolder(dir: string, report: ReturnType<typeof makeReporter>) {
  const names = listFiles(dir);
  const layout = layoutOf(names);
  const files = readFolderPack(dir, names, layout, path.basename(path.resolve(dir)));

  if (!Object.keys(files).length) throw new UsageError(`Nothing usable found in ${dir}`);

  report.info(
    `Read ${Object.keys(files).length} files from ${layout} folder layout ` +
      `${path.basename(path.resolve(dir))}`,
  );
  return files;
}

/** The modpack's own name, which decides the builtin helpers and the page title */
function packNameOf(file: string) {
  return path.basename(path.normalize(file)).replace(/\.(zip|rar)$/i, "");
}

/**
 * Builds the ruleset of an archive with the builtin mods underneath it.
 *
 * This is the same merge `unpackData` does when a pack is uploaded, minus the
 * storage: builtin strings go in first, the pack's own files replace them, and
 * the pack's name selects which `xhelper-` mods apply.
 */
async function loadPack(file: string, report: ReturnType<typeof makeReporter>) {
  const packName = packNameOf(file);
  const files = fs.statSync(file, { throwIfNoEntry: false })?.isDirectory()
    ? readFolder(file, report)
    : await readArchive(file, report);

  const builtinFiles = filterBuiltinMods(unpackBuiltinMods(builtinModsPayload), packName);

  const { merged, builtinDirs } = mergeBuiltinFiles(files, builtinFiles);

  report.info(`Building the ruleset of ${packName}`);
  const built = buildPackData(merged, builtinDirs);
  return { packName, files, builtinFiles, merged, ...built };
}

/** One planned output: where it goes, relative to the target directory */
type Output = { rel: string; data: Uint8Array };

/** Name of the manifest that records what this tool wrote, next to the page */
const manifestName = ".xpedia-export.json";

type Manifest = {
  /** Files written by the last run, relative to the directory that holds this */
  files: string[];
};

/**
 * Reads the manifest of a directory, if a previous export left one.
 *
 * The manifest is what makes stale cleanup safe: without it, "delete what the
 * new export does not produce" cannot tell this tool's leftovers from the
 * user's own `favicon.ico` or `.htaccess`.
 */
function readManifest(dir: string): Manifest | undefined {
  try {
    const text = fs.readFileSync(path.join(dir, manifestName), "utf8");
    const data = JSON.parse(text);
    if (Array.isArray(data?.files))
      return { files: data.files.filter((f: unknown): f is string => typeof f === "string") };
  } catch {
    // A missing or unreadable manifest is not an error: the directory may simply
    // never have been exported into
  }
  return;
}

/** True when the path stays inside `root`, so a manifest cannot escape it */
function insideDirectory(root: string, rel: string) {
  const resolved = path.resolve(root, rel);
  const base = path.resolve(root);
  return resolved === base || resolved.startsWith(base + path.sep);
}

/**
 * What a run would overwrite and what it would remove.
 *
 * Only paths this tool can claim are considered: a file of the manifest that is
 * no longer produced is stale, and a planned file that already exists is an
 * overwrite. Anything else in the directory is left alone.
 */
function conflictingPaths(dir: string, outputs: Output[], manifest: Manifest | undefined) {
  const planned = new Set(outputs.map((o) => o.rel));
  const overwrites: string[] = [];
  for (const rel of planned) {
    const full = path.join(dir, rel);
    const stat = fs.statSync(full, { throwIfNoEntry: false });
    if (stat?.isFile()) overwrites.push(rel);
    else if (stat?.isDirectory())
      throw new UsageError(`${full} is a directory, but the export needs to write a file there`);
  }

  const stale: string[] = [];
  for (const rel of manifest?.files ?? []) {
    if (planned.has(rel)) continue;
    if (!insideDirectory(dir, rel)) continue;
    const full = path.join(dir, rel);
    if (fs.statSync(full, { throwIfNoEntry: false })?.isFile()) stale.push(rel);
  }

  return { overwrites, stale };
}

/** A short list for a message, so a thousand images do not print a thousand lines */
function summarize(paths: string[]) {
  const shown = paths.slice(0, 5).map((p) => `  ${p}`);
  if (paths.length > shown.length) shown.push(`  ... and ${paths.length - shown.length} more`);
  return shown.join("\n");
}

/**
 * Asks before overwriting or deleting anything.
 *
 * One question covers the whole run: listing every image of a big pack would be
 * noise, and the answer is the same for all of them. Without a terminal there is
 * nobody to ask, so the run stops instead of guessing — silently overwriting is
 * exactly what this check exists to prevent.
 */
async function confirmChanges(kind: "overwrite" | "delete", paths: string[], options: Options) {
  if (!paths.length) return;

  const what =
    kind === "overwrite"
      ? `${paths.length} file(s) would be overwritten:`
      : `${paths.length} stale file(s) from a previous export would be removed:`;

  if (options.force) return;

  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new UsageError(
      `${what}\n${summarize(paths)}\n` +
        `Refusing to continue without a terminal to confirm in. Re-run with --force.`,
    );

  process.stderr.write(`${what}\n${summarize(paths)}\nContinue? [y/N] `);
  const answer = await readLine();
  process.stderr.write("\n");
  if (!/^y(es)?$/i.test(answer.trim())) throw new UsageError("Nothing was written.");
}

/** One line from the terminal, or an empty string at end of input */
function readLine() {
  return new Promise<string>((resolve) => {
    const onData = (chunk: Buffer | string) => {
      process.stdin.pause();
      process.stdin.off("data", onData);
      resolve(String(chunk).split(/\r?\n/)[0]);
    };
    process.stdin.resume();
    process.stdin.once("data", onData);
  });
}

/** Writes every planned file, creating directories as needed */
function writeOutputs(dir: string, outputs: Output[]) {
  for (const output of outputs) {
    const full = path.join(dir, output.rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, output.data);
  }
}

/** Removes the files a previous run left behind that this one does not produce */
function removeStale(dir: string, stale: string[]) {
  // Each removal also prunes the folders it leaves empty, up to the target
  // directory itself: an asset tree that is no longer exported would otherwise
  // stay behind as a skeleton of empty folders
  for (const rel of stale) {
    const full = path.join(dir, rel);
    fs.unlinkSync(full);
    removeEmptyAbove(path.dirname(full), dir);
  }
}

/** Deletes `dir` and its ancestors while they are empty, stopping at `stopAt` */
function removeEmptyAbove(dir: string, stopAt: string) {
  const base = path.resolve(stopAt);
  let current = path.resolve(dir);
  while (current !== base && current.startsWith(base + path.sep)) {
    try {
      // Throws when not empty, or when it is already gone
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/** Writes the manifest, so the next run knows what this one produced */
function writeManifest(dir: string, outputs: Output[]) {
  const manifest: Manifest = { files: outputs.map((o) => o.rel).sort() };
  fs.writeFileSync(path.join(dir, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Drops a manifest left by an earlier run, so `--no-manifest` leaves none */
function removeManifest(dir: string) {
  const file = path.join(dir, manifestName);
  if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) fs.unlinkSync(file);
}

/**
 * The `.html` name a target file or directory resolves to.
 *
 * A directory gets `index.html`; a file keeps its own name, so `site/pedia.html`
 * writes exactly that file.
 */
function htmlBaseName(target: ReturnType<typeof targetKind>) {
  return target.directory ? "index.html" : path.basename(target.file);
}

/** The directory an export writes into, and the page name the target resolves to */
function resolveTarget(target: string) {
  const kind = targetKind(target);
  return {
    kind,
    dir: kind.directory ? target : path.dirname(kind.file) || ".",
    baseName: htmlBaseName(kind),
  };
}

async function main(argv: string[]) {
  const parsed = parseArgs(argv);
  if (parsed === "help") {
    process.stdout.write(helpText);
    return 0;
  }
  const options = parsed;
  const report = makeReporter(options.quiet);

  // Serving replaces the whole export: there is nothing to read, unpack or
  // write, so it branches off before any of that starts
  if (options.serve !== undefined)
    return servePack({
      root: options.serve || ".",
      port: options.port,
      languages: options.languages,
      shell: appShell(),
      builtinModsPayload,
      info: (message) => report.info(message),
    });

  // A folder is exported the way `--serve` reads one, so a modder can look at
  // the result without repacking anything first
  if (!fs.statSync(options.source, { throwIfNoEntry: false }))
    throw new UsageError(`No such archive or folder: ${options.source}`);

  const pack = await loadPack(options.source, report);
  const available = pack.processed.langs
    ? Object.keys(pack.processed.langs).filter((n) => n !== "icon")
    : [];
  const languages = resolveLanguages(options.languages, available);

  // English travels with every page as the fallback, so it is never left out;
  // a page that *is* English simply needs no second copy of it
  const extra = languages.filter((name) => name !== defaultLanguage);

  const shell = appShell();

  const target = resolveTarget(options.target);

  // `--zip` and `--split` both decide whether the target is one file or a
  // folder, so a target that contradicts them is caught before anything is read
  if (options.zip && target.kind.directory === false && target.kind.html)
    throw new UsageError(
      `${options.target} is an .html file; pass a directory or a .zip path for --zip`,
    );
  if (!options.zip && target.kind.directory === false && !target.kind.html)
    throw new UsageError(`${options.target} is a .zip file; it needs --zip, or pass a directory`);

  // The directory is only created once something is actually written, so a run
  // the user refuses leaves no trace
  checkDirectory(target.dir);

  // A page inside an archive is `index.html` so unzipping onto a website works,
  // unless the target named an `.html` file, which is then kept as asked. A
  // `.zip` target names the archive itself, not the page in it.
  const pageName = options.zip
    ? target.kind.directory === false && target.kind.html
      ? path.basename(target.kind.file)
      : "index.html"
    : target.baseName;

  // A split export is one page carrying English plus a script per other
  // language, so the page name never varies with the languages: every one of
  // them, English included, lives in `languagePackPath`
  report.info(`Pack: ${pack.packName}`);
  report.info(
    `Languages: ${languages.join(", ")}` +
      (options.split ? " (English page, one language pack per other language)" : ""),
  );

  // The archive's own copy is the only one available here: the ruleset names the
  // globe and the images, and both are files of the pack
  const byPath = new Map<string, Uint8Array>();
  for (const file of pack.interpretedFiles)
    if (file.type === "img" || file.type === "dat") byPath.set(file.path, file.data);

  const plan = await buildExport({
    packName: pack.packName,
    processed: pack.processed,
    readFile: (archivePath) => byPath.get(archivePath),
    shell,
    request: { languages, split: options.split, images: options.assets, url: options.url },
    pageName,
    report,
  });
  const outputs: Output[] = plan.outputs.map((f) => ({ rel: f.path, data: f.data }));
  const pages = plan.pages;
  const assets = plan.assets;

  if (options.zip) {
    // A `.zip` target names the archive; a directory one is named the way the
    // browser export names it, after the pack
    const name =
      target.kind.directory === false
        ? target.kind.file
        : path.join(target.dir, `${exportedPackName(pack.packName)}.zip`);

    await confirmChanges(
      "overwrite",
      fs.statSync(name, { throwIfNoEntry: false })?.isFile() ? [name] : [],
      options,
    );

    report.info(`Compressing ${outputs.length} file(s)`);
    const zipped = zipFiles(outputs.map((o) => ({ path: o.rel, data: o.data }) as ExportFile));
    fs.mkdirSync(path.dirname(name), { recursive: true });
    fs.writeFileSync(name, zipped);
    report.info(`Wrote ${name} (${(zipped.length / 1e6).toFixed(2)} MB)`);
    return 0;
  }

  const manifest = readManifest(target.dir);
  // `--no-manifest` turns the directory into a plain folder of files: nothing is
  // recorded, and an older record is dropped rather than left to describe a
  // directory it no longer matches. Without it, stale files also go.
  const conflicts = options.manifest
    ? conflictingPaths(target.dir, outputs, manifest)
    : {
        overwrites: conflictingPaths(target.dir, outputs, undefined).overwrites,
        stale: [] as string[],
      };
  await confirmChanges("overwrite", conflicts.overwrites, options);
  await confirmChanges("delete", conflicts.stale, options);

  report.info(`Writing ${outputs.length} file(s) to ${target.dir}`);
  writeOutputs(target.dir, outputs);
  removeStale(target.dir, conflicts.stale);
  if (options.manifest) writeManifest(target.dir, outputs);
  else removeManifest(target.dir);

  report.info(
    `Exported ${pages} page(s)` +
      (options.split ? ` and ${extra.length} language pack(s)` : "") +
      (assets ? ` and ${assets} asset file(s)` : ""),
  );
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    // A stack is only useful for a bug in this tool, so it is shown as-is
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
