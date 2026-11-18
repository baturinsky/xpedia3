/**
 * Loads a modpack the way the app does, with no browser.
 *
 * `buildPackData` does the real work — recognising each file's role, merging the
 * mods, folding the language files — so a check exercises the shipping path
 * rather than a second implementation of it that could drift.
 */
import "./page.mjs";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { ensureBuilt, root } from "../build.mjs";
import { builtinFilesFor } from "./builtin.mjs";

await ensureBuilt();

const { buildPackData, unpackZip, unpackRar, interpretPath } =
  await import("../.gen/packbuild.mjs");
const { default: Ruleset } = await import("../.gen/engine.mjs");

/** `node-unrar-js` wants the wasm binary rather than importing it itself */
function unrarWasm() {
  let raw = readFileSync(join(root, "node_modules", "node-unrar-js", "dist", "js", "unrar.wasm"));
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/** A folder of mod files, as `path -> data`, the way an archive would unpack */
function readFolder(dir) {
  let files = {};
  let walk = (at) => {
    for (let name of readdirSync(at)) {
      let full = join(at, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      files[full.substring(dir.length + 1).split(sep).join("/")] = new Uint8Array(readFileSync(full));
    }
  };
  walk(dir);
  return files;
}

/** Builds a `Ruleset` from unpacked files, marking the ones that came from the builtins */
function rulesetOf(files, builtinDirs) {
  return buildPackData(files, builtinDirs, false).processed;
}

/**
 * The builtin mods on their own, as the pack they are.
 *
 * This is the one pack every checkout has, so the checks that need a ruleset to
 * read use it and pass in a fresh clone with no downloaded modpacks.
 */
export async function loadBuiltinPack() {
  let files = builtinFilesFor("xpedia");
  let dirs = new Set(Object.keys(files).map(name => interpretPath(name)?.mod).filter(Boolean));
  return new Ruleset(rulesetOf(files, dirs));
}

/**
 * An example pack, or nothing when the checkout does not have it.
 *
 * `misc/` is gitignored: the example modpacks are hundreds of megabytes and are
 * not part of the repository, so a check that wants a real pack has to be able
 * to say "not here" and pass. A check that needs one of these also runs against
 * the builtins, which every checkout does have, so the interesting logic is
 * still exercised without them.
 */
export function examplePack(name) {
  let path = join(root, "misc", "modpackExamples", name);
  return existsSync(path) ? path : undefined;
}

/**
 * A pack from an archive or a folder, with the builtin mods merged underneath it.
 *
 * `.zip` and `.rar` are both accepted, as is a directory of already-unpacked
 * files, which is what the CLI serves.
 */
export async function loadPack(path) {
  let own = /\.zip$/i.test(path) ? unpackZip(toArrayBuffer(readFileSync(path)))
    : /\.rar$/i.test(path) ? await unpackRar(toArrayBuffer(readFileSync(path)), unrarWasm(), {})
      : readFolder(path);

  let packName = path.replace(/^.*[\\/]/, "").replace(/\.(zip|rar)$/i, "");
  let builtin = builtinFilesFor(packName);

  // A path the pack brings itself replaces the builtin one at the same path
  let modDirs = (files) => new Set(Object.keys(files).map(n => interpretPath(n)?.mod).filter(Boolean));
  let packDirs = modDirs(own);
  let builtinDirs = new Set([...modDirs(builtin)].filter(dir => !packDirs.has(dir)));

  // The unpacked files are kept on the ruleset so a check can read a file out of
  // the pack with the same bytes an exporter would: the exporters hand
  // `collectDataFiles` a reader over exactly this map
  let files = { ...builtin, ...own };
  let rul = new Ruleset(rulesetOf(files, builtinDirs));
  rul.packFiles = files;
  return rul;
}

/**
 * A reader over an unpacked pack, in the shape `collectDataFiles` wants.
 *
 * The exporters each have their own source of bytes — an archive here, a folder
 * in the served case, the database in the browser — but they all read one file
 * at a time by archive path, which is all this has to do too.
 */
export function fileReader(files) {
  return async path => files[path];
}

/**
 * A small pack written inline, for a check that needs one particular shape of
 * data and cannot rely on a downloaded modpack having it.
 *
 * `rul` is the mod's single ruleset file and `lang` its English strings. The
 * base-game master is always present: a mod naming a master the pack does not
 * contain takes a different load path, which would not be what a check of the
 * ruleset itself means to exercise.
 */
export async function testPack({ name = "Test Pack", lang = {}, rul = "" } = {}) {
  let files = {
    "standard/xcom1/metadata.yml": "name: X-COM\nid: xcom1\nisMaster: true\nversion: 1\n",
    "user/mods/Test/metadata.yml": `name: ${name}\nid: testpack\nisMaster: true\nmaster: xcom1\n`,
    "user/mods/Test/Ruleset/test.rul": rul,
    "user/mods/Test/Language/en-US.yml":
      "en-US:\n" + Object.entries(lang).map(([key, text]) => `  ${key}: ${text}\n`).join(""),
  };
  let enc = new TextEncoder();
  let data = {};
  for (let [path, text] of Object.entries(files))
    data[path] = enc.encode(text);
  return new Ruleset(rulesetOf(data, new Set()));
}
