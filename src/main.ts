//@ts-ignore
import wasmRaw from './unrar.wasm?base64'
//@ts-ignore
//import xcom1Raw from './xcom1.rar?base64'

import { initUI } from './ui/ui';
import { makeDropzone } from './dropzone';
import { base64ToArrayBuffer } from './util';
import { article, section, store, update } from './store';
import { saveFile, initDB, queryDB, getRul } from './idb';
import { createDirTree, unpackData, uploadUsersFiles } from './load';
import { rul } from './rul/Ruleset';
import { AnyRef, fromAnyRef } from './ui/components';

export let wasmBinary: ArrayBuffer;

async function loadVanilla(xcom1Raw: string) {
  let xcom1Binary = base64ToArrayBuffer(xcom1Raw);
  let xcom1Files = await unpackData("xcom1.rar", xcom1Binary);
  let tree = createDirTree(xcom1Files);
}

export function goToArticle(href: AnyRef) {
  if (!rul)
    return;
  let ref = fromAnyRef(href);
  let article = rul.article(ref);
  if (article) {
    if (article.sections && !article.sections.includes(store.section)) {
      update({ article, section: article.sections[0] });
    } else {
      update({ article })
    }
    if ("##" + ref != location.hash)
      location.hash = "##" + ref;
  }
}

function goToHash() {
  let hash = decodeURI(document.location.hash) || "##MAIN";
  if (hash.substring(0, 2) != "##") return;
  goToArticle(hash.substring(2));
}

async function init() {
  await initDB();
  if (store.packName) await getRul(store.packName);

  initUI();

  makeDropzone(document.body, uploadUsersFiles)
  wasmBinary = base64ToArrayBuffer(wasmRaw);

  onhashchange = goToHash;
  goToHash()

}

init()

addEventListener("keydown", e => {
  let pageSwitch = {
    "KeyA": -1, "ArrowLeft": -1,
    "KeyD": 1, "ArrowRight": 1,
    "KeyW": "up", "ArrowUp": "up",
    "KeyS": "down", "ArrowDown": "down",
  }[e.code];
  if (pageSwitch) {
    if (pageSwitch == "up") {
      if (section.id == article.id)
        goToArticle("MAIN")
      else
        goToArticle(section)
    } else if (pageSwitch == "down") {
      history.go(-1);
    } else {
      goToArticle(rul.findNearbyArticle(article, pageSwitch as number, section, store.ordered))
    }
  }
})