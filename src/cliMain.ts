import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileTypeFromBuffer } from "file-type";
import Ruleset, { defaultLanguage } from "./rul/Ruleset";
import {
  buildPackData, filterBuiltinMods, gameRelativePath, interpretPath,
  unpackBuiltinMods, unpackRar, unpackZip
} from "./packBuild";
import {
  buildPageHtml, exportedPackName, languageFileName, referencedPaths, zipFiles,
  type AppShell, type ExportFile
} from "./exportCore";
import shellPayload from "xpedia:shell";
import builtinModsPayload from "xpedia:builtin-mods";
import unrarWasmPayload from "xpedia:unrar-wasm";

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
  xpedia-cli <pack.zip|pack.rar> <target> [options]

Arguments:
  <pack>                 Modpack archive (ZIP or RAR)
  <target>               Output directory, or the path of a file to write. A
                         directory gets index.html, plus one file per language
                         when --split is used. A name ending in .html is written
                         as that page; a name ending in .zip is the archive
                         --zip writes.

Options:
  --lang <names>         Languages to include, comma separated and repeatable.
                         Omitting it exports every language the pack has.
                         English is always carried as the fallback, so
                         "--lang en-US" means English only.
  --split                Write one HTML file per language. The primary language
                         gets the plain name; the others get the language
                         inserted before ".html" (index.ru.html).
  --assets               Also write every image as a real file, laid out the way
                         the game expects, so the result runs without the game.
  --zip                  Write a single .zip instead of loose files, like the
                         browser export does.
  --force, -f            Overwrite and delete without asking.
  --quiet, -q            Only report errors.
  --help, -h             Show this help.

The primary language is the first one named by --lang, or English.

Examples:
  xpedia-cli "Dioxine_XPiratez.zip" public/pedia
  xpedia-cli pack.zip site --assets --lang ru,en-US --split
  xpedia-cli pack.rar pedia.zip --zip

The page is the XPedia app compiled into this file, so a new UI build means a new
CLI: rebuild it with \`npm run cli\`.
`;

/** Raised for anything the user can fix: bad arguments, missing files */
class UsageError extends Error { }

/** Parsed command line */
type Options = {
  source: string,
  target: string,
  languages: string[] | undefined,
  split: boolean,
  assets: boolean,
  zip: boolean,
  force: boolean,
  quiet: boolean,
};

function parseArgs(argv: string[]): Options | "help" {
  let positional: string[] = [];
  let languages: string[] | undefined;
  let split = false, assets = false, zip = false, force = false, quiet = false;

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    // A bare `-` is a valid path; anything else starting with `-` is a flag
    if (arg == "--help" || arg == "-h")
      return "help";
    else if (arg == "--split")
      split = true;
    else if (arg == "--assets")
      assets = true;
    else if (arg == "--zip")
      zip = true;
    else if (arg == "--force" || arg == "-f")
      force = true;
    else if (arg == "--quiet" || arg == "-q")
      quiet = true;
    else if (arg == "--lang" || arg.startsWith("--lang=")) {
      // Both `--lang ru,de` and `--lang=ru,de` are accepted, and repeating the
      // flag adds to the list rather than replacing it
      let value = arg == "--lang" ? argv[++i] : arg.substring("--lang=".length);
      if (value == null || value.startsWith("--"))
        throw new UsageError("--lang needs a value, e.g. --lang ru,de");
      languages ??= [];
      for (let name of value.split(","))
        if (name.trim())
          languages.push(name.trim());
    } else if (arg.startsWith("-") && arg != "-")
      throw new UsageError(`Unknown option: ${arg}`);
    else
      positional.push(arg);
  }

  if (positional.length < 2)
    throw new UsageError("A modpack archive and a target are required");
  if (positional.length > 2)
    throw new UsageError(`Unexpected argument: ${positional[2]}`);

  return {
    source: positional[0],
    target: positional[1],
    languages: languages?.length ? languages : undefined,
    split, assets, zip, force, quiet
  };
}

/** Writes to stderr, so `--quiet` can silence progress without hiding failures */
function makeReporter(quiet: boolean) {
  let last = "";
  return {
    info(message: string) { if (!quiet) process.stderr.write(message + "\n"); },
    /** Progress that overwrites itself, so long stages do not scroll */
    progress(message: string) {
      if (quiet)
        return;
      let width = process.stderr.columns ?? 80;
      let line = message.length > width ? message.slice(0, width - 1) + "…" : message;
      process.stderr.write("\r" + line.padEnd(last.length));
      last = line;
    },
    /** Ends the current progress line, if one is open */
    endProgress() {
      if (quiet || !last)
        return;
      process.stderr.write("\n");
      last = "";
    },
    error(message: string) { process.stderr.write(message + "\n"); },
  };
}

/** The app shell the page carries, recovered from the embedded build */
function appShell(): AppShell {
  let html = zlib.gunzipSync(Buffer.from(shellPayload, "base64")).toString("utf8");
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
  let scripts: { attrs: string, content: string }[] = [];
  let scriptRe = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(html))) {
    let attrs = match[1].trim();
    let content = match[2];
    if (/\bsrc=/.test(attrs) || !content.trim())
      continue;
    // An exported page carries its own ruleset; copying that one would nest one
    // pedia inside another
    if (/data-xpedia-export/.test(attrs))
      continue;
    scripts.push({
      // The browser exporter copies attributes off the DOM, which writes a bare
      // attribute as `name=""`; doing the same keeps both exports identical
      attrs: match[1].trim().replace(/(^|\s)([a-zA-Z-]+)(?=\s|$)/g, '$1$2=""'),
      // The dev build points at `bundle.js.map`, which is not part of the export
      content: content.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n")
    });
  }

  let styles: string[] = [];
  let styleRe = /<style([^>]*)>([\s\S]*?)<\/style>/gi;
  while ((match = styleRe.exec(html))) {
    let content = (match[2] ?? "").replace(/\/\*# sourceMappingURL=\S+\*\//g, "");
    if (content)
      styles.push(content);
  }

  if (!scripts.some(s => s.content.length > 50_000))
    throw new Error("The embedded app shell has no application bundle: run `npm run build` and rebuild the CLI");
  return { scripts, styles };
}

/**
 * The languages to export, in the order they were asked for.
 *
 * `--lang` accepts any spelling of a language name; the pack's own spelling is
 * used from here on. An unknown name is a hard error: silently falling back to
 * English would hand back a file that is not what was asked for, and the usual
 * cause is a typo such as `en-us` or `ru-RU`.
 *
 * English is always part of the result: every page carries its strings as the
 * fallback, so `--lang en-US` is how to ask for English alone rather than a way
 * to leave it out.
 */
function resolveLanguages(requested: string[] | undefined, available: string[]) {
  // Omitting `--lang` means every language the pack has, English leading
  if (!requested)
    return [defaultLanguage, ...available.filter(name => name != defaultLanguage)];

  let byLower = new Map(available.map(name => [name.toLowerCase(), name]));
  let unknown = requested.filter(name => !byLower.has(name.toLowerCase()));
  if (unknown.length)
    throw new UsageError(`The pack has no language ${unknown.map(n => JSON.stringify(n)).join(", ")}. ` +
      `Available: ${available.join(", ")}`);

  // The same language twice is one language, and a repeat must not move it
  let names = [...new Set(requested.map(name => byLower.get(name.toLowerCase())!))];
  // English goes last when it was not named, so that the first language the
  // user asked for stays the primary one
  if (!names.includes(defaultLanguage))
    names.push(defaultLanguage);
  return names;
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
  let stat = fs.statSync(target, { throwIfNoEntry: false });
  if (stat?.isDirectory())
    return { directory: true as const };
  if (stat?.isFile()) {
    if (/\.html?$/i.test(target))
      return { directory: false as const, file: target, html: true };
    if (/\.zip$/i.test(target))
      return { directory: false as const, file: target, html: false };
    throw new UsageError(`${target} exists and is not an .html file, a .zip file or a directory`);
  }
  if (/\.html?$/i.test(target))
    return { directory: false as const, file: target, html: true };
  if (/\.zip$/i.test(target))
    return { directory: false as const, file: target, html: false };
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
  let stat = fs.statSync(dir, { throwIfNoEntry: false });
  if (stat && !stat.isDirectory())
    throw new UsageError(`${dir} exists and is not a directory`);
}

/** Reads a pack archive, reporting the stages the way the loader does */
async function readArchive(file: string, report: ReturnType<typeof makeReporter>) {
  let data = fs.readFileSync(file);
  let buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  let type = await fileTypeFromBuffer(buffer).catch(() => undefined);
  if (!type || (type.ext != "zip" && type.ext != "rar"))
    throw new UsageError(`${file} is not a ZIP or RAR archive`);

  report.info(`Reading ${path.basename(file)} (${(data.length / 1e6).toFixed(1)} MB)`);
  let files: { [name: string]: Uint8Array };
  if (type.ext == "rar") {
    let wasm = Buffer.from(unrarWasmPayload, "base64");
    files = await unpackRar(buffer, wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength), {
      onProgress: (done, total, name) =>
        report.progress(`Unpacking ${done}/${total} files${name ? `: ${path.basename(name)}` : ""}`)
    });
  } else
    files = unpackZip(buffer);
  report.endProgress();

  if (!Object.keys(files).length)
    throw new UsageError(`Nothing usable found in ${file}`);

  report.info(`Unpacked ${Object.keys(files).length} files`);
  return files;
}

/** The modpack's own name, which decides the builtin helpers and the page title */
function packNameOf(file: string) {
  return path.basename(file).replace(/\.(zip|rar)$/i, "");
}

/**
 * Builds the ruleset of an archive with the builtin mods underneath it.
 *
 * This is the same merge `unpackData` does when a pack is uploaded, minus the
 * storage: builtin strings go in first, the pack's own files replace them, and
 * the pack's name selects which `xhelper-` mods apply.
 */
async function loadPack(file: string, report: ReturnType<typeof makeReporter>) {
  let packName = packNameOf(file);
  let files = await readArchive(file, report);

  let builtinFiles = filterBuiltinMods(unpackBuiltinMods(builtinModsPayload), packName);

  // A pack that ships its own copy of a builtin path keeps it as its own data
  let packDirs = modDirsOf(files);
  let builtinDirs = new Set([...modDirsOf(builtinFiles)].filter(dir => !packDirs.has(dir)));

  let merged: { [name: string]: Uint8Array } = { ...builtinFiles };
  for (let [name, data] of Object.entries(files))
    merged[name] = data;

  report.info(`Building the ruleset of ${packName}`);
  let built = buildPackData(merged, builtinDirs);
  return { packName, files, builtinFiles, merged, ...built };
}

/** The mod folders a set of archive files belongs to, see `interpretPath` */
function modDirsOf(files: { [name: string]: Uint8Array }) {
  let dirs = new Set<string>();
  for (let name of Object.keys(files)) {
    let mod = interpretPath(name)?.mod;
    if (mod)
      dirs.add(mod);
  }
  return dirs;
}

/** One planned output: where it goes, relative to the target directory */
type Output = { rel: string, data: Uint8Array };

/** Name of the manifest that records what this tool wrote, next to the page */
const manifestName = ".xpedia-export.json";

type Manifest = {
  /** Files written by the last run, relative to the directory that holds this */
  files: string[],
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
    let text = fs.readFileSync(path.join(dir, manifestName), "utf8");
    let data = JSON.parse(text);
    if (Array.isArray(data?.files))
      return { files: data.files.filter((f: any) => typeof f == "string") };
  } catch (e) {
    // A missing or unreadable manifest is not an error: the directory may simply
    // never have been exported into
  }
  return;
}

/** True when the path stays inside `root`, so a manifest cannot escape it */
function insideDirectory(root: string, rel: string) {
  let resolved = path.resolve(root, rel);
  let base = path.resolve(root);
  return resolved == base || resolved.startsWith(base + path.sep);
}

/**
 * What a run would overwrite and what it would remove.
 *
 * Only paths this tool can claim are considered: a file of the manifest that is
 * no longer produced is stale, and a planned file that already exists is an
 * overwrite. Anything else in the directory is left alone.
 */
function conflictingPaths(dir: string, outputs: Output[], manifest: Manifest | undefined) {
  let planned = new Set(outputs.map(o => o.rel));
  let overwrites: string[] = [];
  for (let rel of planned) {
    let full = path.join(dir, rel);
    let stat = fs.statSync(full, { throwIfNoEntry: false });
    if (stat?.isFile())
      overwrites.push(rel);
    else if (stat?.isDirectory())
      throw new UsageError(`${full} is a directory, but the export needs to write a file there`);
  }

  let stale: string[] = [];
  for (let rel of manifest?.files ?? []) {
    if (planned.has(rel))
      continue;
    if (!insideDirectory(dir, rel))
      continue;
    let full = path.join(dir, rel);
    if (fs.statSync(full, { throwIfNoEntry: false })?.isFile())
      stale.push(rel);
  }

  return { overwrites, stale };
}

/** A short list for a message, so a thousand images do not print a thousand lines */
function summarize(paths: string[]) {
  let shown = paths.slice(0, 5).map(p => `  ${p}`);
  if (paths.length > shown.length)
    shown.push(`  ... and ${paths.length - shown.length} more`);
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
async function confirmChanges(
  kind: "overwrite" | "delete",
  paths: string[],
  options: Options
) {
  if (!paths.length)
    return;

  let what = kind == "overwrite"
    ? `${paths.length} file(s) would be overwritten:`
    : `${paths.length} stale file(s) from a previous export would be removed:`;

  if (options.force)
    return;

  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new UsageError(`${what}\n${summarize(paths)}\n` +
      `Refusing to continue without a terminal to confirm in. Re-run with --force.`);

  process.stderr.write(`${what}\n${summarize(paths)}\nContinue? [y/N] `);
  let answer = await readLine();
  process.stderr.write("\n");
  if (!/^y(es)?$/i.test(answer.trim()))
    throw new UsageError("Nothing was written.");
}

/** One line from the terminal, or an empty string at end of input */
function readLine() {
  return new Promise<string>(resolve => {
    let onData = (chunk: Buffer | string) => {
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
  for (let output of outputs) {
    let full = path.join(dir, output.rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, output.data);
  }
}

/** Removes the files a previous run left behind that this one does not produce */
function removeStale(dir: string, stale: string[]) {
  // Each removal also prunes the folders it leaves empty, up to the target
  // directory itself: an asset tree that is no longer exported would otherwise
  // stay behind as a skeleton of empty folders
  for (let rel of stale) {
    let full = path.join(dir, rel);
    fs.unlinkSync(full);
    removeEmptyAbove(path.dirname(full), dir);
  }
}

/** Deletes `dir` and its ancestors while they are empty, stopping at `stopAt` */
function removeEmptyAbove(dir: string, stopAt: string) {
  let base = path.resolve(stopAt);
  let current = path.resolve(dir);
  while (current != base && current.startsWith(base + path.sep)) {
    try {
      // Throws when not empty, or when it is already gone
      fs.rmdirSync(current);
    } catch (e) {
      return;
    }
    current = path.dirname(current);
  }
}

/** Writes the manifest, so the next run knows what this one produced */
function writeManifest(dir: string, outputs: Output[]) {
  let manifest: Manifest = { files: outputs.map(o => o.rel).sort() };
  fs.writeFileSync(path.join(dir, manifestName), JSON.stringify(manifest, null, 2) + "\n");
}

/**
 * The `.html` name a target file or directory resolves to.
 *
 * A directory gets `index.html`; a file keeps its own name, so `site/pedia.html`
 * writes exactly that file.
 */
function htmlBaseName(target: { directory: boolean, file?: string }) {
  return target.directory ? "index.html" : path.basename(target.file!);
}

/** The directory an export writes into, and the page name the target resolves to */
function resolveTarget(target: string) {
  let kind = targetKind(target);
  return {
    kind,
    dir: kind.directory ? target : path.dirname(kind.file) || ".",
    baseName: htmlBaseName(kind),
  };
}

async function main(argv: string[]) {
  let parsed = parseArgs(argv);
  if (parsed == "help") {
    process.stdout.write(helpText);
    return 0;
  }
  let options = parsed;
  let report = makeReporter(options.quiet);

  if (!fs.statSync(options.source, { throwIfNoEntry: false })?.isFile())
    throw new UsageError(`No such archive: ${options.source}`);

  let pack = await loadPack(options.source, report);
  let available = pack.processed.langs ? Object.keys(pack.processed.langs).filter(n => n != "icon") : [];
  let languages = resolveLanguages(options.languages, available);

  // The primary language gets the plain file name; it is the first one asked for
  let primary = languages[0];
  // English travels with every page as the fallback, so it is never left out;
  // a page that *is* English simply needs no second copy of it
  let extra = languages.filter(name => name != defaultLanguage);

  let shell = appShell();

  let target = resolveTarget(options.target);

  // `--zip` and `--split` both decide whether the target is one file or a
  // folder, so a target that contradicts them is caught before anything is read
  if (options.zip && target.kind.directory === false && target.kind.html)
    throw new UsageError(`${options.target} is an .html file; pass a directory or a .zip path for --zip`);
  if (!options.zip && target.kind.directory === false && !target.kind.html)
    throw new UsageError(`${options.target} is a .zip file; it needs --zip, or pass a directory`);

  // The directory is only created once something is actually written, so a run
  // the user refuses leaves no trace
  checkDirectory(target.dir);

  // A page inside an archive is `index.html` so unzipping onto a website works,
  // unless the target named an `.html` file, which is then kept as asked. A
  // `.zip` target names the archive itself, not the page in it.
  let baseName = options.zip
    ? (target.kind.directory === false && target.kind.html ? path.basename(target.kind.file) : "index.html")
    : target.baseName;

  // Which file each language is written to. A split export gives every language
  // its own page; a single one is written to the target itself.
  let splitNames = new Map<string, string>();
  if (options.split) {
    for (let name of languages)
      splitNames.set(name, languageFileName(baseName, name, name == primary));
  } else
    splitNames.set(primary, baseName);

  // The selector of a split export has to know every file, including English's
  // own page: that is what makes picking a language a navigation rather than a
  // switch inside a document that does not carry its strings.
  let langPages: { [name: string]: string } | undefined;
  if (options.split)
    langPages = Object.fromEntries(splitNames);

  report.info(`Pack: ${pack.packName}`);
  report.info(`Languages: ${languages.join(", ")}` +
    (options.split ? " (one file per language)" : ""));

  let outputs: Output[] = [];
  /** How many of the outputs are pages rather than images */
  let pages = 0;

  if (options.split) {
    for (let [name, file] of splitNames) {
      report.info(`Building ${file} (${name})`);
      let html = await buildPageHtml({
        pack: pack.packName,
        processed: pack.processed,
        // A page carries its own language plus English, which `prepareRul` keeps
        languages: name == defaultLanguage ? [] : [name],
        shell,
        page: { lang: name, langPages }
      });
      // The primary language's page is the site's front door, so it gets no infix
      outputs.push({ rel: file, data: new TextEncoder().encode(html) });
      pages++;
    }
  } else {
    let file = splitNames.get(primary)!;
    report.info(`Building ${file} (${primary})`);
    let html = await buildPageHtml({
      pack: pack.packName,
      processed: pack.processed,
      languages: extra,
      shell,
      // A single page can switch language in place where it carries one, so it
      // only needs a language when the reader cannot pick it there
      page: primary == defaultLanguage ? undefined : { lang: primary }
    });
    outputs.push({ rel: file, data: new TextEncoder().encode(html) });
    pages++;
  }

  /** How many image files were collected, for the closing summary */
  let assets = 0;

  if (options.assets) {
    // Only the images the pedia can show travel, laid out where the game keeps
    // them, so the result works without a game installation
    let byPath = new Map<string, Uint8Array>();
    for (let file of pack.interpretedFiles)
      if (file.type == "img" || file.type == "dat")
        byPath.set(file.path, file.data);

    // The ruleset is built here, after the pages, because constructing one adds
    // the language flags to the shared `langs` map — data the exported payload
    // must not carry, since the browser exporter does not add it either
    let rul = new Ruleset(pack.processed);
    let paths = [...referencedPaths(rul)];
    let taken = new Set(outputs.map(o => o.rel));
    for (let i = 0; i < paths.length; i++) {
      let data = byPath.get(paths[i]);
      if (data && data.length) {
        let rel = gameRelativePath(paths[i]);
        if (!taken.has(rel)) {
          taken.add(rel);
          outputs.push({ rel, data });
          assets++;
        }
      }
      if (i % 20 == 0 || i == paths.length - 1)
        report.progress(`Collecting images ${assets}/${paths.length}`);
    }
    report.endProgress();
    report.info(`Collected ${assets} image(s)`);
  }

  if (options.zip) {
    // A `.zip` target names the archive; a directory one is named the way the
    // browser export names it, after the pack
    let name = target.kind.directory === false
      ? target.kind.file
      : path.join(target.dir, `${exportedPackName(pack.packName)}.zip`);

    await confirmChanges("overwrite", fs.statSync(name, { throwIfNoEntry: false })?.isFile() ? [name] : [], options);

    report.info(`Compressing ${outputs.length} file(s)`);
    let zipped = zipFiles(outputs.map(o => ({ path: o.rel, data: o.data }) as ExportFile));
    fs.mkdirSync(path.dirname(name), { recursive: true });
    fs.writeFileSync(name, zipped);
    report.info(`Wrote ${name} (${(zipped.length / 1e6).toFixed(2)} MB)`);
    return 0;
  }

  let manifest = readManifest(target.dir);
  let conflicts = conflictingPaths(target.dir, outputs, manifest);
  await confirmChanges("overwrite", conflicts.overwrites, options);
  await confirmChanges("delete", conflicts.stale, options);

  report.info(`Writing ${outputs.length} file(s) to ${target.dir}`);
  writeOutputs(target.dir, outputs);
  removeStale(target.dir, conflicts.stale);
  writeManifest(target.dir, outputs);

  report.info(`Exported ${pages} page(s)` +
    (options.split ? ` (${languages.join(", ")})` : "") +
    (assets ? ` and ${assets} asset file(s)` : ""));
  return 0;
}

main(process.argv.slice(2))
  .then(code => { process.exitCode = code; })
  .catch(error => {
    if (error instanceof UsageError) {
      process.stderr.write(error.message + "\n");
      process.exitCode = 1;
      return;
    }
    // A stack is only useful for a bug in this tool, so it is shown as-is
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
