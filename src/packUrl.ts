import { uploadUsersFiles } from "./load";

/**
 * Loading a modpack straight from a URL, for testing.
 *
 * The browser tools can only push 5 MiB into a page, which rules out every real
 * modpack (XFiles is 237 MiB, XPiratez 486 MiB). A URL has no such limit,
 * because the page fetches the bytes itself: whatever serves the archive just
 * has to be reachable from the browser.
 *
 * The bytes are handed to the same `uploadUsersFiles` a real drag-and-drop
 * calls, so a pack loaded this way goes through the ordinary import path — the
 * archive is unpacked, cached and listed exactly as a user's upload would be.
 * That is why this can be trusted for testing: nothing about the loader is
 * bypassed, only the way the file arrives.
 */

/** A name the archive can be stored under, taken from its URL */
export function packNameFromUrl(url: string): string {
  let path = url.split("?")[0].split("#")[0];
  // Archives are unpacked by extension, so the name has to keep one
  let name = decodeURIComponent(path.substring(path.lastIndexOf("/") + 1));
  if (!name)
    throw new Error(`No file name in ${url}`);
  return name;
}

/**
 * Fetches an archive and imports it as if it had been dropped on the page.
 *
 * The `File` is named after the URL so the pack appears under a recognisable
 * name in the list, and so the archive readers can tell a ZIP from a RAR.
 */
export async function loadPackFromUrl(url: string) {
  let name = packNameFromUrl(url);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (e: any) {
    throw new Error(`Could not fetch ${url}: ${e?.message ?? e}`);
  }
  if (!response.ok)
    throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);

  let bytes = await response.arrayBuffer();
  let file = new File([bytes], name);
  // A one-file `FileList` is what the drop handler receives, so the import path
  // is the same one a real upload takes
  let transfer = new DataTransfer();
  transfer.items.add(file);
  await uploadUsersFiles(transfer.files);
}

/**
 * The `?packUrl=` of the current page, if it has one.
 *
 * Read from `location.search` rather than remembered, so the URL keeps working
 * after a reload and can be shared. `?packUrl=` is honoured in every view: it is
 * an explicit instruction from whoever opened the page, not a stray click.
 */
export function packUrlFromLocation(): string | undefined {
  let value = new URLSearchParams(location.search).get("packUrl");
  return value || undefined;
}

/**
 * Loads a pack named by `?packUrl=`, once the app has finished starting up.
 *
 * Called after `init` rather than inside it: the upload opens a modal status
 * window and replaces the ruleset, and doing that before the UI exists would
 * leave the progress unreported.
 */
export async function loadPackFromLocation() {
  let url = packUrlFromLocation();
  if (!url)
    return;
  try {
    await loadPackFromUrl(url);
  } catch (e: any) {
    console.error(`Could not load the modpack at ${url}`, e);
  }
}

/**
 * Where the dev server's middleware serves `misc/modpackExamples`, or `undefined`
 * in a release build.
 *
 * This is only a convenience for the developer view's URL field: the field
 * offers the packs the dev server has on hand, so a large archive can be picked
 * by name instead of typed. A release build has no such route, so the field
 * starts empty and offers no examples rather than advertising a broken address.
 */
export function examplePacksUrl(): string | undefined {
  // `define` replaces this with `""` in a release build, so an empty value means
  // "not served here" rather than "the site root"
  return __XPEDIA_DEV_PACKS__ || undefined;
}

/**
 * Absolute address of the example-pack route, for the picker's option values.
 *
 * The define is a plain path so it survives any `base`, and the page resolves it
 * against its own origin here. Only the developer view needs this: `?packUrl=`
 * may name any address at all, so it is never rewritten.
 */
export function examplePacksBase(): string | undefined {
  let path = examplePacksUrl();
  if (!path)
    return;
  // A relative resolution would drop the dev server's port on a bare page
  return new URL(path, location.href).href;
}
