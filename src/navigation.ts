import { update } from "./state";
import { clearHash } from "./util";

/**
 * Shows the landing page and makes the address bar match it.
 *
 * The landing page has no hash of its own: it is the bare page. Coming from an
 * article or a search pushes a history entry, so Back returns where the user
 * came from. `##HOME` (or the older `##MAIN`) is not a place of its own but a
 * link onto the landing page, so it is replaced instead: that keeps a page
 * opened on `##HOME` from gaining a history entry for a page it was already on.
 *
 * The search results are a *state*, not an article: `ArticleComponent` shows
 * them whenever `searchQuery` is set, ahead of any article. Clearing the hash
 * therefore is not enough — `##SEARCH::...` is reached through `goToHash`, which
 * also clears `searchQuery`, but `clearHash` uses `replaceState` and fires no
 * `hashchange`, so leaving search this way has to clear it here as well.
 *
 * This lives outside `main.ts` because the navbar needs it too, and `main.ts`
 * already imports the UI: sharing it here avoids a cycle.
 */
export function goToLanding() {
  update({ article: undefined, section: undefined, searchQuery: "", found: undefined });
  if (!location.hash)
    return;
  if (location.hash == "##HOME" || location.hash == "##MAIN")
    clearHash();
  else
    history.pushState(history.state, "", location.pathname + location.search);
}
