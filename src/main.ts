//@ts-ignore
import wasmRaw from './unrar.wasm?base64'

import { initUI } from './ui/ui';
import { makeDropzone } from './dropzone';
import { base64ToArrayBuffer } from './util';
import { article, section, state, update } from './state';
import { saveFile, initDB, queryDB, getRul } from './idb';
import { uploadUsersFiles } from './load';
import { rul } from './rul/Ruleset';
import { AnyRef, fromAnyRef } from './ui/components';
import { Section } from './rul/Section';

export let wasmBinary: ArrayBuffer;


export function goToArticle(href?: AnyRef) {
  if (!rul)
    return;
  let ref = fromAnyRef(href);
  let article = rul.article(ref);
  if (article) {
    if (article.sections && !article.sections.includes(section as Section)) {
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
  if (state.packName) await getRul(state.packName);

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
      if (section) {
        if (section.id == article?.id)
          goToArticle("MAIN")
        else
          goToArticle(section)
      }
    } else if (pageSwitch == "down") {
      history.go(-1);
    } else {
      if(article && section)
        goToArticle(rul.findNearbyArticle(article, pageSwitch as number, section, state.ordered))
    }
  }
})