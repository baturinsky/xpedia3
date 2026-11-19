import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  buildPackData, filterBuiltinMods, interpretPath, unpackBuiltinMods
} from "./packBuild";
import {
  archivePath, folderFiles, isDat, isText, layoutOf, listFiles, readFolderPack, type Layout
} from "./cliFolder";
import { buildExport } from "./cliExport";
import { buildAssetFiles, buildPageHtml, collectDataFiles, exportedPackName, zipFiles, type AppShell, type ExportFile } from "./exportCore";
import { defaultLanguage, type ProcessedRuleset } from "./rul/Ruleset";
import { resolveLanguages } from "./cliLanguages";
import { gameRelativePath } from "./util";
import { UsageError } from "./cliError";

/**
 * Serves a modpack folder as a live pedia, so a modder can see the result
 * without repacking the archive and uploading it again.
 *
 * The page is the ordinary exported pedia, exactly what `--zip` writes: the
 * ruleset is embedded in it and the images are not. Those are read from the
 * folder on demand, under the path the game itself would use — which is how an
 * exported page sitting next to a game install already finds them. Reusing that
 * page rather than inventing a second kind means the modpack list shows it as an
 * `.inline` pack that cannot be deleted, and the images resolve through the one
 * code path that knows how to look for them.
 *
 * There is no watcher and no automatic reload on purpose. A reload rebuilds the
 * ruleset from the files as they are at that moment, which is the promise; a
 * watcher would additionally yank the page out from under someone mid-article.
 */

export type ServeOptions = {
  /** Folder to serve as the modpack */
  root: string,
  /** First port to try; the next free one is used when it is taken */
  port: number,
  /** Language names to embed; every language in the folder when omitted */
  languages?: string[],
  /** The app shell, embedded in the CLI at build time */
  shell: AppShell,
  /** The builtin mods, embedded in the CLI at build time */
  builtinModsPayload: string,
  info: (message: string) => void,
};

/**
 * `request path -> file on disk`, for everything the page may ask for.
 *
 * A map of paths rather than of entries: every file the page can ask for is in
 * the folder. The builtin globe used to be the exception — compiled into this
 * script, with no file to point at — but the page now carries it inside itself,
 * so nothing is served from memory any more.
 */
function buildFileIndex(root: string, names: string[], layout: Layout, modRoot: string) {
  let index = new Map<string, string>();
  let register = (key: string, file: string) => {
    let lower = key.replace(/^\/+/, "").toLowerCase();
    if (lower && !index.has(lower))
      index.set(lower, file);
  };
  for (let rel of names) {
    let full = path.join(root, rel);
    let archive = archivePath(rel, layout, modRoot);
    register(gameRelativePath(archive), full);
    register(archive, full);
    register(rel, full);
  }
  return index;
}

/**
 * A cheap signature of everything that decides the page.
 *
 * Names, sizes and modification times of the text files: enough to tell that a
 * reload would produce a different pedia, without reading or parsing anything.
 * Images are deliberately absent — they are served as they are, so changing one
 * needs no rebuild at all. The globe's data is not an image in that sense: the
 * page carries its bytes, so editing it has to rebuild the page.
 */
function fingerprint(root: string, names: string[]) {
  let parts: string[] = [];
  for (let rel of names) {
    if (!isText(rel) && !isDat(rel))
      continue;
    let stat = fs.statSync(path.join(root, rel), { throwIfNoEntry: false });
    parts.push(`${rel}:${stat?.size ?? -1}:${stat?.mtimeMs ?? -1}`);
  }
  return parts.join("\n");
}

/** MIME types the pedia may ask for, and a generic default for the rest */
const contentTypes: { [ext: string]: string } = {
  html: "text/html; charset=utf-8",
  json: "application/json",
  png: "image/png",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  mid: "audio/midi",
  mod: "audio/mod",
};

function contentTypeOf(file: string) {
  let ext = file.substring(file.lastIndexOf(".") + 1).toLowerCase();
  return contentTypes[ext] ?? "application/octet-stream";
}

/**
 * Sends one index entry, answering the byte range a media element may ask for.
 *
 * Ranges matter here: an `<audio>` element seeks by asking for a slice, and a
 * server that answers the whole file to every range request makes scrubbing
 * reload the track from the start.
 */
function sendFile(res: http.ServerResponse, file: string, req: http.IncomingMessage) {
  let stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  let size = stat.size;
  let type = contentTypeOf(file);

  // A reload must show the files as they are, so nothing is cached
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", type);
  res.setHeader("Accept-Ranges", "bytes");

  let match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (match) {
    let start = match[1] ? Number(match[1]) : 0;
    // An open-ended range means "to the end", which is what a player asks for
    let end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    if (req.method == "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.setHeader("Content-Length", String(size));
  if (req.method == "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

/** Binds the first free port at or after `start` */
function listen(server: http.Server, start: number, tries = 25) {
  return new Promise<number>((resolve, reject) => {
    let attempt = (port: number, left: number) => {
      let onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        // Only a taken port is worth trying past; anything else is a real error
        if (error.code == "EADDRINUSE" && left > 0) {
          attempt(port + 1, left - 1);
          return;
        }
        reject(error);
      };
      let onListening = () => {
        server.off("error", onError);
        resolve(port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      // Loopback only: this previews a folder for the person sitting at the
      // machine, and a modpack is not something to publish on a network by
      // accident
      server.listen(port, "127.0.0.1");
    };
    attempt(start, tries);
  });
}

/** The page and the file index, rebuilt together so they always describe one state */
type Built = {
  html: string,
  index: Map<string, string>,
  /**
   * The ruleset and file layout the page was built from.
   *
   * Kept so an export answers from exactly the same state the page shows: a
   * request that exported a fresh walk would be a different pack from the one
   * the reader is looking at whenever a file changed between the two.
   */
  source: { processed: ProcessedRuleset, names: string[], layout: Layout, reader: (path: string) => Uint8Array | undefined },
};

/**
 * The folder's files by archive path, read only when an export asks for bytes.
 *
 * The served page never needs the sprite bytes — the browser fetches them — so
 * the ruleset is built from placeholders. An export does need them, and reading
 * a file on demand keeps a 300 MB pack from being held in memory for a page that
 * may never be exported.
 */
function makeFileReader(files: { [name: string]: Uint8Array },
  builtin: { [name: string]: Uint8Array },
  root: string, names: string[], layout: Layout, modRoot: string) {
  let byPath = folderFiles(root, names, layout, modRoot);
  return (archivePath: string) => {
    // The text files the page was built from are already in memory; only the
    // placeholders have to be replaced with the bytes on disk
    let known = files[archivePath];
    if (known?.length)
      return known;
    // A pack that ships no globe borrows the builtin one, exactly as the served
    // page does: it is compiled into this script, not a file in the folder
    let fallback = builtin[archivePath];
    if (fallback?.length)
      return fallback;
    let file = byPath.get(archivePath);
    if (!file)
      return;
    try {
      return new Uint8Array(fs.readFileSync(file));
    } catch (e) {
      return;
    }
  };
}

/**
 * Rebuilds the page from the folder.
 *
 * The expensive half — parsing and merging the ruleset, then gzipping and
 * embedding it — is skipped while nothing that decides it has changed, so a
 * reload after an image edit is instant while a reload after a `.rul` edit is
 * correct. The file index is cheap and is rebuilt every time, which is what
 * makes a sprite added since the last build appear straight away.
 */
function makeBuilder(options: ServeOptions) {
  let root = path.resolve(options.root);
  let modRoot = path.basename(root);
  let builtin = filterBuiltinMods(unpackBuiltinMods(options.builtinModsPayload), modRoot);
  let cached: { fingerprint: string, built: Built } | undefined;
  return async function build(refresh = true): Promise<Built> {
    // A sprite request does not re-list the folder. The page request that
    // preceded it already did, and a pack has tens of thousands of files: walking
    // them for every sprite would cost far more than serving the sprite itself.
    // Reloading the page is what is promised to pick up a change, so the page is
    // the one request that does the walk.
    if (!refresh && cached)
      return cached.built;

    let names = listFiles(root);
    let layout = layoutOf(names);
    let index = buildFileIndex(root, names, layout, modRoot);

    let stamp = fingerprint(root, names);
    if (cached?.fingerprint == stamp)
      return { ...cached.built, index };

    let files = readFolderPack(root, names, layout, modRoot, { textOnly: true });

    // A pack that ships its own copy of a builtin path keeps it as its own data,
    // exactly as `unpackData` and the archive export decide it
    let packDirs = new Set<string>();
    for (let name of Object.keys(files)) {
      let mod = interpretPath(name)?.mod;
      if (mod)
        packDirs.add(mod);
    }
    let builtinDirs = new Set<string>();
    for (let name of Object.keys(builtin)) {
      let mod = interpretPath(name)?.mod;
      if (mod && !packDirs.has(mod))
        builtinDirs.add(mod);
    }

    let merged: { [name: string]: Uint8Array } = { ...builtin };
    for (let [name, data] of Object.entries(files))
      merged[name] = data;

    // Nothing is stored, so the pack's own half is not asked for
    let { processed } = buildPackData(merged, builtinDirs, false);

    let available = processed.langs
      ? Object.keys(processed.langs).filter(name => name != "icon")
      : [];
    // Omitting `--lang` means every language the pack has, the same default the
    // export uses. English is always carried, so it is never one of the extras.
    let wanted = resolveLanguages(options.languages, available);
    let extra = wanted.filter(name => name != defaultLanguage);

    let articles = Object.keys(processed.langs?.["en-US"] ?? {}).length;
    options.info(`Building the page: ${articles} strings, ${available.length} languages`);

    let html = await buildPageHtml({
      pack: `${modRoot}.zip`,
      processed,
      languages: extra,
      shell: options.shell,
      // Marks the page as a preview of this folder rather than an export of it,
      // which is what tells the export dialog its images cannot be bundled:
      // they are read from the folder as the page asks, never carried by it
      served: true,
      // The globe travels inside the page, so serving it as a URL is not only
      // unnecessary but wrong: a pack that ships none has no file in the folder
      data: await collectDataFiles(processed.resources, async archivePath => {
        let own = files[archivePath];
        if (own?.length)
          return own;
        // A pack that ships no globe borrows the builtin one, which is compiled
        // into this script rather than being a file in the folder
        return builtin["mods/xpedia/GEODATA/WORLD.DAT"];
      }, processed.mods)
    });

    cached = {
      fingerprint: stamp,
      built: {
        html, index,
        source: { processed, names, layout, reader: makeFileReader(files, builtin, root, names, layout, modRoot) }
      }
    };
    return cached.built;
  };
}

/**
 * Answers the page's export request with a finished archive.
 *
 * `xpedia-cli` already knows how to turn this folder into a pack; the browser
 * does not, because a served page never receives the sprite bytes. Rather than
 * teach the page to fetch hundreds of megabytes and re-zip them, the page asks
 * the server that already has the folder, and the server runs the same code the
 * command line does. The reply is the archive the CLI would have written, so the
 * two ways of exporting one folder cannot disagree.
 *
 * Query parameters, all optional except the languages:
 * - `lang`  comma separated language names; omitted means every language
 * - `split` `1` to keep English in the page and script every other language
 * - `images` `1` to write the sprites the pedia can show
 * - `estimate` `1` to answer with the size as JSON instead of the archive
 * - `name`  base name of the archive, so the dialog and the file agree
 */
function makeExportHandler(options: ServeOptions) {
  let root = path.resolve(options.root);
  let modRoot = path.basename(root);

  /** Everything an export of this folder consists of, from one request */
  async function buildPlan(url: URL, built: Built, weighOnly = false) {
    let wanted = url.searchParams.get("lang");
    let requested = wanted ? wanted.split(",").map(name => name.trim()).filter(Boolean) : undefined;
    let split = url.searchParams.get("split") == "1";
    let images = url.searchParams.get("images") == "1";

    let { processed, reader } = built.source;
    let available = processed.langs ? Object.keys(processed.langs).filter(n => n != "icon") : [];
    let languages = resolveLanguages(requested, available);

    let plan = await buildExport({
      packName: modRoot,
      processed,
      readFile: reader,
      shell: options.shell,
      request: { languages, split, images },
      pageName: "index.html",
      weighOnly,
      report: { info: message => options.info(message) },
    });
    return { plan, languages, split, images };
  }

  /**
   * The size the archive would have, without building it.
   *
   * Images are already compressed files, so their bytes survive zipping almost
   * unchanged, while the page and the language packs deflate to about half.
   * Measuring the small part exactly and counting the rest is what makes this
   * cheap enough to answer whenever the dialog's checkboxes change; deflating a
   * 300 MB pack just to quote its size would take longer than the export.
   */
  async function estimate(url: URL, built: Built) {
    let { plan } = await buildPlan(url, built, true);
    let bytes = plan.imageBytes + (plan.outputs.length ? zipFiles(plan.outputs).length : 0);
    return { bytes, files: plan.outputs.length + plan.assets, assets: plan.assets };
  }

  return async function exportPack(url: URL, built: Built) {
    let baseName = (url.searchParams.get("name") ?? "").replace(/[\\/:*?"<>|]/g, "").trim();
    if (url.searchParams.get("estimate") == "1")
      return { json: await estimate(url, built) };

    let started = Date.now();
    let { plan, languages, split, images } = await buildPlan(url, built);
    options.info(`Exporting ${modRoot}: ${languages.join(", ")}` +
      `${split ? ", split" : ""}${images ? ", with images" : ""}`);

    let zipped = zipFiles(plan.outputs);
    let name = (baseName || exportedPackName(modRoot)) + ".zip";
    options.info(`Exported ${plan.outputs.length} file(s), ` +
      `${(zipped.length / 1e6).toFixed(2)} MB in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return { name, data: zipped };
  };
}

/**
 * Serves the folder until the process is interrupted.
 *
 * Only the loopback interface is bound: this previews a folder for the person
 * sitting at the machine, and a modpack is not something to publish on a
 * network by accident.
 */
export async function servePack(options: ServeOptions) {
  let root = path.resolve(options.root);
  let stat = fs.statSync(root, { throwIfNoEntry: false });
  if (!stat)
    throw new UsageError(`No such folder: ${options.root}`);
  if (!stat.isDirectory())
    throw new UsageError(`${options.root} is not a folder`);

  let build = makeBuilder(options);
  let exportPack = makeExportHandler(options);

  // Built once before the port opens, so the address is announced only after it
  // can answer with a real pedia rather than a 500
  await build();

  /**
   * Runs the export and sends the archive, or an error the dialog can show.
   *
   * The work is heavy — building a ruleset, gzipping, and for images reading
   * hundreds of files — so failures are reported as text rather than a bare 500:
   * the reader is the modder who wrote the ruleset, and the message is usually
   * the answer.
   */
  function handleExport(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    if (req.method != "GET" && req.method != "HEAD") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      res.end("Use GET");
      return;
    }
    // Rebuilding picks up an edit since the page was loaded, and the export must
    // describe the folder as it is now rather than as the open page has it
    build()
      .then(built => exportPack(url, built))
      .then(result => {
        res.setHeader("Cache-Control", "no-store");
        if ("json" in result) {
          let body = JSON.stringify(result.json);
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Content-Length", String(Buffer.byteLength(body)));
          res.end(req.method == "HEAD" ? undefined : body);
          return;
        }
        let { name, data } = result;
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Length", String(data.length));
        // `filename*` keeps a pack with non-ASCII in its name readable
        res.setHeader("Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
        if (req.method == "HEAD") {
          res.end();
          return;
        }
        res.end(Buffer.from(data));
      })
      .catch(e => {
        let message = e instanceof UsageError ? e.message : `${e?.message ?? e}`;
        options.info(`Export failed: ${message}`);
        res.statusCode = e instanceof UsageError ? 400 : 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(message + "\n");
      });
  }

  let server = http.createServer((req, res) => {
    let parsed = new URL(String(req.url ?? "/"), "http://localhost");
    let url = decodeURIComponent(parsed.pathname);
    // The export is a GET because the page cannot send a body it does not have:
    // the settings are small enough to be query parameters, and the reply is a
    // plain file a browser can download
    if (url == "/xpedia-export") {
      handleExport(req, res, parsed);
      return;
    }
    if (url == "/" || url == "/index.html") {
      // Rebuilt per request: a reload has to see the files as they are now
      build()
        .then(({ html }) => {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(html);
        })
        .catch(e => {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(`Can't build the pedia: ${e?.message ?? e}\n`);
        });
      return;
    }

    build(false)
      .then(({ index }) => {
        let file = index.get(url.replace(/^\/+/, "").toLowerCase());
        if (!file) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        sendFile(res, file, req);
      })
      .catch(() => {
        res.statusCode = 500;
        res.end("Can't read the folder");
      });
  });

  let port = await listen(server, options.port);
  process.stdout.write(`Serving ${root}\nhttp://localhost:${port}/\n`);
  if (port != options.port)
    process.stdout.write(`(port ${options.port} was taken, so ${port} was used)\n`);

  // Serving is the whole job, so the command ends when the server does
  await new Promise<void>(resolve => {
    let stop = () => {
      server.close(() => resolve());
      // An idle keep-alive connection would otherwise hold the process open
      setTimeout(() => resolve(), 500).unref();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}
