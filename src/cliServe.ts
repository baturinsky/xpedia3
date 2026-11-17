import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  buildPackData, filterBuiltinMods, interpretPath, unpackBuiltinMods, WORLD_DAT
} from "./packBuild";
import { buildPageHtml, type AppShell } from "./exportCore";
import { defaultLanguage } from "./rul/Ruleset";
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

/** How a folder lays out its mods, which decides how a file's path is spelled */
type Layout =
  /** A game root: `user/mods/<mod>/…`, `standard/<mod>/…`, `common/…` */
  | "game"
  /** The folder *is* one mod, so its own name becomes the mod folder */
  | "mod"
  /** A folder of mod folders, each with its own `metadata.yml` */
  | "flat";

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

/** Extensions whose bytes the ruleset builder actually reads */
function isText(name: string) {
  let lower = name.toLowerCase();
  let ext = lower.substring(lower.lastIndexOf(".") + 1);
  if (ext == "rul" || ext == "yml")
    return true;
  // Article bodies may be `Language/STR_ID.<lang>.html` or `.txt`
  if (ext != "html" && ext != "txt")
    return false;
  let parts = lower.split("/");
  return parts.length > 1 && parts[parts.length - 2] == "language";
}

/** Noise a served folder may contain that is never part of a pack */
const skippedDirs = new Set([".git", "node_modules"]);

/**
 * Every file in the folder, relative to it, with forward slashes.
 *
 * Sorted so two runs over the same folder agree on which of two spellings of
 * the same path wins.
 */
function listFiles(root: string) {
  let out: string[] = [];
  let walk = (dir: string, prefix: string) => {
    for (let entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && (entry.name.startsWith(".") || skippedDirs.has(entry.name)))
        continue;
      let rel = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory())
        walk(path.join(dir, entry.name), rel);
      else if (entry.isFile())
        out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}

/**
 * Which of the three layouts the folder is in.
 *
 * The ruleset builder decides a file's mod from its path the way OpenXcom's
 * `FileMap` does, so the paths handed to it have to follow the same convention:
 * a game root already carries the `user/mods` prefix, a single mod folder needs
 * its own name put in front, and a folder of mods needs nothing. Getting this
 * wrong is not cosmetic — a folder mistaken for "flat" would turn its own
 * `Language/` into a mod called `Language`.
 *
 * - A game root is recognised by the folders the engine itself creates.
 * - A single mod is recognised by the folders a mod must have, `metadata.yml`
 *   being optional but `Ruleset`/`Language`/`Resources` being unmistakable.
 * - Anything else is a folder of mods. A pack nested one level deeper, such as
 *   `<pack>/<pack>/user/mods/…`, still resolves: `interpretPath` looks for
 *   `user/mods` and `standard` anywhere in the path, not just at the start.
 */
function layoutOf(names: string[]): Layout {
  let topFiles = new Set(names.filter(n => !n.includes("/")).map(n => n.toLowerCase()));
  if (["user", "standard", "common"].some(dir => topFiles.has(dir)))
    return "game";

  let topDirs = new Set(names
    .filter(n => n.includes("/"))
    .map(n => n.substring(0, n.indexOf("/")).toLowerCase()));
  let modMarkers = ["ruleset", "language", "resources", "geodata"];
  if (topFiles.has("metadata.yml") || modMarkers.some(dir => topDirs.has(dir)))
    return "mod";

  return "flat";
}

/** The path a folder file is known by while the ruleset is built */
function archivePath(rel: string, layout: Layout, modRoot: string) {
  return layout == "mod" ? `${modRoot}/${rel}` : rel;
}

/**
 * Reads the folder into `archive path -> bytes`, skipping image contents.
 *
 * Only text is read. A sprite becomes an empty placeholder: the resource map
 * still indexes it, so every path resolves exactly as it would in a real
 * archive, while the bytes are never needed — the page asks the server for the
 * image itself. Reading them would copy hundreds of megabytes for nothing.
 */
function readFolderPack(root: string, names: string[], layout: Layout, modRoot: string) {
  let files: { [name: string]: Uint8Array } = {};
  for (let rel of names) {
    let archive = archivePath(rel, layout, modRoot);
    if (!interpretPath(archive))
      continue;
    files[archive] = isText(rel)
      ? new Uint8Array(fs.readFileSync(path.join(root, rel)))
      : new Uint8Array(0);
  }
  return files;
}

/**
 * What a request path answers with: a file in the folder, or bytes that live in
 * this process.
 *
 * Only the builtin globe takes the second form. It is not on disk — it is
 * compiled into this script — yet the page fetches it by URL like any other
 * image, so it has to be answerable without a temporary copy that a hard kill
 * would leave behind.
 */
type IndexEntry =
  | { file: string }
  | { bytes: Uint8Array, type: string };

/** `request path -> file on disk`, for everything the page may ask for. */
function buildFileIndex(root: string, names: string[], layout: Layout, modRoot: string) {
  let index = new Map<string, IndexEntry>();
  let register = (key: string, file: string) => {
    let lower = key.replace(/^\/+/, "").toLowerCase();
    if (lower && !index.has(lower))
      index.set(lower, { file });
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
 * A cheap signature of everything that decides the ruleset.
 *
 * Names, sizes and modification times of the text files: enough to tell that a
 * reload would produce a different pedia, without reading or parsing anything.
 * Images are deliberately absent — they are served as they are, so changing one
 * needs no rebuild at all.
 */
function fingerprint(root: string, names: string[]) {
  let parts: string[] = [];
  for (let rel of names) {
    if (!isText(rel))
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
function sendFile(res: http.ServerResponse, entry: IndexEntry, req: http.IncomingMessage) {
  let data: Uint8Array | undefined;
  let size: number;
  let type: string;

  if ("bytes" in entry) {
    data = entry.bytes;
    size = entry.bytes.length;
    type = entry.type;
  } else {
    let stat = fs.statSync(entry.file, { throwIfNoEntry: false });
    if (!stat?.isFile()) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    size = stat.size;
    type = contentTypeOf(entry.file);
  }

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
    if (data) {
      res.end(data.subarray(start, end + 1));
      return;
    }
    fs.createReadStream((entry as { file: string }).file, { start, end }).pipe(res);
    return;
  }

  res.setHeader("Content-Length", String(size));
  if (req.method == "HEAD") {
    res.end();
    return;
  }
  if (data) {
    res.end(data);
    return;
  }
  fs.createReadStream((entry as { file: string }).file).pipe(res);
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
type Built = { html: string, index: Map<string, IndexEntry> };

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
  /**
   * Where the ruleset found the globe, and the bytes to answer it with when the
   * pack ships none.
   *
   * A pack that carries no `WORLD.DAT` still draws a globe: the ruleset falls
   * back to the copy compiled into the builtin mods, which has no file in the
   * folder to serve. The key is settled on the first build and reused, because
   * every request after that may take the cached page and has to answer its
   * globe request too.
   */
  let globeKey: string | undefined;
  let globeBytes: Uint8Array | undefined;
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

    // The globe is not always a file in the folder, so the index is completed
    // here rather than in the build below: a cached page still asks for it
    if (globeKey && globeBytes && !index.has(globeKey))
      index.set(globeKey, { bytes: globeBytes, type: "application/octet-stream" });

    let stamp = fingerprint(root, names);
    if (cached?.fingerprint == stamp)
      return { html: cached.built.html, index };

    let files = readFolderPack(root, names, layout, modRoot);

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
    });

    // The globe must be reachable, and a pack that ships none borrows the one in
    // the builtin mods, which is not a file in the folder. It is served under
    // the path the ruleset resolved it to, straight from the bytes in this
    // script.
    let dat = processed.resources?.[WORLD_DAT];
    if (dat && !index.has(dat.toLowerCase())) {
      let fallback = builtin["mods/xpedia/GEODATA/WORLD.DAT"];
      if (fallback) {
        globeKey = dat.toLowerCase();
        globeBytes = fallback;
        index.set(globeKey, { bytes: fallback, type: "application/octet-stream" });
      }
    }

    cached = { fingerprint: stamp, built: { html, index } };
    return { html, index };
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

  // Built once before the port opens, so the address is announced only after it
  // can answer with a real pedia rather than a 500
  await build();

  let server = http.createServer((req, res) => {
    let url = decodeURIComponent(String(req.url ?? "/").split("?")[0]);
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
        let entry = index.get(url.replace(/^\/+/, "").toLowerCase());
        if (!entry) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        sendFile(res, entry, req);
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
