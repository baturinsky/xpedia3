//@ts-ignore
import wasmRaw from './unrar.wasm?base64'

import { initUI } from './ui/ui';
import { makeDropzone } from './dropzone';
import { base64ToArrayBuffer } from './util';
import { article, section, state, update } from './state';
import { initDB, getRul } from './idb';
import { uploadUsersFiles, loadBuiltinOnlyPack } from './load';
import { inlinePack, packSource, loadPackRul } from './packSource';
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
      // Same rule as old `App.svelte`: keep the section the user is browsing
      // when the article belongs to it, otherwise fall back to the article's
      // first section. A deep link starts with no section at all, so this is
      // what gives it a sidebar and a highlighted menu entry.
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
  // Any navigation closes the navbar dropdowns, mirrors old `checkHash`
  update({ showDropdown: false, showLanguagesDropdown: false, showPacksDropdown: false });
  let id = hash.substring(2);

  // `##SEARCH::query` shows full text search results instead of an article
  let separator = id.indexOf("::");
  if (separator != -1) {
    let query = id.substring(separator + 2);
    update({ searchQuery: query, found: undefined, article: undefined, section: undefined });
    if (query.length >= 2)
      Promise.resolve(rul?.findArticles(query)).then(found => update({ found }));
    return;
  }

  update({ searchQuery: "" });

  // `##HOME` shows the landing page and clears the current article,
  // as in old `App.svelte` where `HOME` has no article behind it
  if (id == "HOME") {
    update({ article: undefined });
    return;
  }

  goToArticle(id);
}

async function init() {
  await initDB();
  // An exported HTML file carries its pack, so there is nothing to choose and
  // nothing stored in the database to restore: open it straight away
  let inlined = inlinePack();
  if (inlined) {
    try {
      await loadPackRul(inlined.pack);
    } catch (e) {
      console.error("Can't open the inlined pedia", e);
    }
  }
  // With no modpack (or one whose data was lost) fall back to the builtin mods
  // alone, so the pedia still has a ruleset to browse.
  //
  // A stored `packName` can outlive its data: the browser may evict the origin's
  // storage, and the archive is not kept at all outside developer mode. Say so
  // instead of silently pretending no modpack was ever selected.
  //
  // Reading can also fail outright when the page has no storage at all, e.g. an
  // exported file opened from disk in a browser that blocks IndexedDB there.
  let loaded: string | undefined;
  if (!inlined && state.packName) {
    try {
      loaded = await getRul(state.packName);
    } catch (e) {
      console.warn("Can't read the stored modpack", e);
    }
  }
  if (!loaded && !inlined) {
    let missingPack = state.packName;
    if (missingPack) {
      update({
        slowProcessStatus: `${missingPack} is no longer stored. ` +
          `Showing the builtin pedia — upload the modpack again to rebuild it.`,
        slowProcessDone: true, slowProcessError: true, slowProcessCancellable: false
      });
    }
    await loadBuiltinOnlyPack();
  }

  initUI();

  makeDropzone(document.body, uploadUsersFiles)
  wasmBinary = base64ToArrayBuffer(wasmRaw);

  onhashchange = goToHash;
  // `saveFile` clears the current article while loading, so re-resolve the
  // hash after a fresh ruleset is installed to keep the user where they were
  addEventListener("xpedia:loaded", () => goToHash());
  goToHash()

}

init()

/** Elements that consume their own keystrokes: typing in these must not navigate */
function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement))
    return false;
  return target.isContentEditable
    || target.tagName == "INPUT"
    || target.tagName == "TEXTAREA"
    || target.tagName == "SELECT";
}

addEventListener("keydown", e => {
  // The load status window is modal, so navigation must wait for it
  if (state.slowProcessStatus)
    return;
  // The search field (and any other form control) edits text with the same keys
  // that page through the pedia, so it keeps its own keystrokes
  if (isEditable(e.target))
    return;
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
      if (article && section)
        goToArticle(rul.findNearbyArticle(article, pageSwitch as number, section, state.alphabeticalSort))
    }
  }
})