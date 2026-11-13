import { initUI } from './ui/ui';
import { makeDropzone } from './dropzone';
import { clearHash } from './util';
import { article, section, state, update } from './state';
import { initDB, getRul } from './idb';
import { uploadUsersFiles, loadBuiltinOnlyPack } from './load';
import { inlinePack, loadPackRul } from './packSource';
import { rul } from './rul/Ruleset';
import { AnyRef, fromAnyRef } from './ui/components';
import { Section } from './rul/Section';
import { goToLanding } from './navigation';


export function goToArticle(href?: AnyRef) {
  if (!rul)
    return;
  let ref = fromAnyRef(href);
  // The landing page is the bare page, with no hash. `HOME` is its name in
  // links, and `MAIN` is an older name for the same page; both are accepted,
  // but the URL is rewritten to the hash-less form. `null` (or a missing href)
  // means the same thing, so a link to nowhere cannot land on a stale article.
  if (ref == null || ref == "MAIN" || ref == "HOME") {
    goToLanding();
    return;
  }
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

/**
 * Shows the landing page and drops the hash from the address.
 *
 * The behaviour lives in `navigation.ts`, because the navbar needs the same
 * thing and `main.ts` already imports the UI.
 */
export { goToLanding } from './navigation';

function goToHash() {
  let hash = decodeURI(document.location.hash);
  // No hash at all is the landing page, so it is not an error to have none
  if (hash && hash.substring(0, 2) != "##") return;
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
  let loaded: Awaited<ReturnType<typeof getRul>>;
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

  onhashchange = goToHash;
  // A fresh ruleset always lands on the landing page: whatever the URL named
  // belongs to the previous pack, and the same id means something else (or
  // nothing) in this one. This fires on upload, on switching packs and after
  // deleting one.
  addEventListener("xpedia:loaded", () => {
    clearHash();
    goToHash();
  });
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
  // The confirmation window is modal too
  if (state.confirmRequest)
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
          goToLanding()
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