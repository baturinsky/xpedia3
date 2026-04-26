import { wasmBinary } from "./main";
import { update } from "./store";
import * as unrar from 'node-unrar-js'
import { listDir, delay, readTextFile, inform, warn, base64ToArrayBuffer } from "./util";
import { fileTypeFromBuffer } from "file-type";
import * as fflate from 'fflate';
import JSYaml from "js-yaml";
import Ruleset, { Mod } from "./rul/Ruleset";
import { getStats, packAssets, saveFile, saveImg, saveRul, saveStats, wipeAssets } from "./idb";
//@ts-ignore
import builtinModsArchive from './builtinMods.zip?base64'


const assetName = /.*(\/mods\/|^)([^\/]+)\/(.*\/)([^\/]+)\.(rul|nam|png|gif)/i
const lngName = /.*(\/mods\/|^)([^\/]+)\/(Language.*)\/([^\/]+)\.(yml|html|txt)/i
const metaName = /.*(\/mods\/|^)([^\/]+)\/metadata\.yml/i


type AssetType = "lng" | "rul" | "meta" | "img"

async function loadBuiltinPack(packname: string, rawPack: string) {
  let binary = base64ToArrayBuffer(rawPack);
  let files = await unpackData(packname, binary);
}


/**From the path, figure the type and mod of the file */
export function interpretPath(s: string): {
  type: AssetType;
  mod: string;
  path: string;
  name?: string;
  ext?: string;
} {
  let match: RegExpExecArray;
  //console.log("PTEST", s, rulName.exec(s));
  
  /** for when "mods" is in root dir */
  s = `/${s}`

  if (match = assetName.exec(s)) {
    let ext = match[5].toLowerCase(), mod = match[2];

    return {
      type: { nam: 'nam', rul: 'rul', gif: 'img', png: 'img' }[ext] as AssetType,
      mod, name: match[4], path: mod + "/" + match[3] + match[4] + '.' + match[5],
      ext
    }
  }
  if (match = lngName.exec(s)) {
    let mod = match[2];
    //if(mod == "")
    return { type: "lng", mod, name: match[4], path: mod + "/" + match[3] + "/" + match[4] + '.yml', ext: match[5] }
  }
  if (match = metaName.exec(s)) {
    let mod = match[2];
    return { type: "meta", mod, path: mod + "/" + "metadata.yml" }
  }

}


function usefulFileName(name: string) {
  return name.match(/\.(rul|yml|png|gif|nam)$/)
}

export function createDirTree(files: { [name: string]: any }) {
  let root = {};
  for (let path of Object.keys(files)) {
    let parts = path.split(/[/\\]/);
    let at = root, prev, part;
    for (part of parts) {
      let dir = at[part];
      if (!dir) {
        dir = {}
        at[part] = dir;
      }
      prev = at;
      at = dir;
    }
    prev[part] = files[path]
  }
  return root;
}

export async function unpackZip(name: string, data: ArrayBuffer) {
  let u8 = new Uint8Array(data);
  let files = fflate.unzipSync(u8);
  for (let k of Object.keys(files)) {
    if (!usefulFileName(k)) {
      delete files[k];
    }
  }
  return files;
}

export async function unpackRar(name: string, data: ArrayBuffer) {
  const extractor = await unrar.createExtractorFromData({ wasmBinary, data });

  const list = extractor.getFileList();
  const fileHeaders = [...list.fileHeaders]; // load the file headers

  let rulHeaders = fileHeaders.map(f => f.name).filter(usefulFileName)

  let extracted = extractor.extract({ files: rulHeaders })

  await delay(10);

  let files: unrar.ArcFile<Uint8Array<ArrayBufferLike>>[] = []

  for (let f of extracted.files) {
    files.push(f);
    let name = f.fileHeader.name
    if (files.length % 1000 == 0) {
      await delay(0)
      update({ slowProcessStatus: `Unpacked ${files.length}/${rulHeaders.length} files... ${name ?? 'archive'}` })
    }
  }

  files = files.sort((a, b) => a.fileHeader.name.localeCompare(b.fileHeader.name));

  return Object.fromEntries(files.map(file => [file.fileHeader.name, file.extraction]));
}

async function unpackArchive(packName: string, data: ArrayBuffer) {
  update({ slowProcessStatus: `Unpacking archive ${packName ?? ''}..., ${data.byteLength} bytes` })

  let fileType = await fileTypeFromBuffer(data);

  let files: { [name: string]: Uint8Array };

  try {
    if (fileType.ext == "rar") {
      files = await unpackRar(packName, data)
    } else {
      files = await unpackZip(packName, data)
    }
  } catch (e) {
    console.error(e);
    alert("Failed to unpack. Only upload RAR or ZIP files.")
    update({ slowProcessStatus: null })
    return {}
  }

  update({ slowProcessStatus: `Unpacked ${Object.keys(files).length} files in ${packName ?? 'archive'}` })

  return files;

}

export async function unpackData(packName: string, data: ArrayBuffer) {

  let builtinMods = await unpackArchive("builtin", base64ToArrayBuffer(builtinModsArchive));

  let files = await unpackArchive(packName, data);

  files = { ...builtinMods, ...files };

  let interpretedFiles = Object.entries(files).map(([name, data]) => ({ ...interpretPath(name), data }));

  /**A list of all lng/rul/meta files in the pack, with the full pathes */
  let decodedYamls = interpretedFiles.filter(f => ["lng", "rul", "meta"].includes(f.type))
    .map(f => ({ ...f, text: new TextDecoder().decode(f.data) }))

  let mods = loadModsAndLng(decodedYamls);

  let processed = Ruleset.preprocessMods(mods)

  wipeAssets(packName);

  let images = interpretedFiles.filter(f => f.type == "img");

  let assetsSize = 0;

  console.log(`saving ${images.length} assets`);

  for (let img of images) {
    saveImg(packName, img.mod, img.path, img.data);
    assetsSize += img.data.byteLength;
  }

  let stringifiedRul = JSON.stringify(processed);

  let compressedRul = fflate.compressSync(new TextEncoder().encode(stringifiedRul))

  await saveStats(packName, data.byteLength, assetsSize, compressedRul.length)
  await saveRul(packName, compressedRul)

  console.log("saved assets");

  let rul = new Ruleset(processed);

  update({ rul, slowProcessStatus: null })

  return files
}

const extRegexp = /^(.+)\.([0-9a-z\-]+)?$/i;

function splitName(name) {
  let m = name.match(extRegexp);
  return m ? [m[1], m[2]] : [name, ""];
}

function loadYaml(text: string) {
  text = text.replace(/!(add|info|remove)/g, '')
  return JSYaml.load(text, {
    json: true,
    skipInvalid: true,
    onWarning: (e) => {
      console.error(e.message);
    }
  })
}

function loadModsAndLng(files: { mod: string, path?: string, name?: string, ext?: string, text: string, type: string }[]) {

  let modName: string, mods = {} as { [name: string]: Mod };

  function addToLng(lngName: string, words: { [name: string]: string }) {
    let lng = mods[modName].lng;
    lng[lngName] ??= {}
    Object.assign(lng[lngName], words);
  }

  for (let f of files) {

    modName = f.mod;

    //if(modName != "Dioxine_XPiratez") debugger;

    mods[modName] ??= { dir: modName, lng: {}, rul: [], meta: {} as any }

    try {
      if (f.type == "lng") {
        let data = f.ext == "yml" ? loadYaml(f.text) : f.text;

        if (typeof data == "object") {
          let lngName = Object.keys(data)[0]
          addToLng(lngName, data[lngName])
        } else {
          if (f.ext != "yml") {
            let [strName, lngName] = splitName(f.name);
            addToLng(lngName, { [strName]: data[lngName] })
          }
        }
      }
      if (f.type == "rul") {
        let data = loadYaml(f.text);
        mods[modName].rul.push(data)
      }
      if (f.type == "meta") {
        mods[modName].meta = loadYaml(f.text)
      }
    } catch (e) {
      console.error(`Erroe while parsing ${f.path}`, e)
    }
  }

  return mods;
}

export async function uploadUsersFiles(fileList: FileList) {
  const files = Array.from(fileList);
  update({ slowProcessStatus: "Uploading" })

  if (files.length > 0) {
    for (const file of files) {
      let data = await file.arrayBuffer();
      saveFile(file.name, data);
    }
  }
}
