import { emptyImg } from "./imgPlaceholders";

//For possible app implementations
declare const fsData: (path: string) => string;

export function delay(n: number) {
  return new Promise((r) => setTimeout(r, n));
}

//export const camelToSnakeCase = str => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

export function camelToUnderscore(key: string) {
  var result = key.replace(/([A-Z])/g, " $1");
  return result.split(" ").join("_").toLowerCase();
}

export function getFlagEmoji(countryCode: string) {
  return countryCode.toUpperCase();
  //return String.fromCodePoint(...[...countryCode.toUpperCase()].map(x=>0x1f1a5+x.charCodeAt()));
}

/**
 * The tags of the user's browser languages, most preferred first.
 *
 * Empty outside a browser. Callers then fall back to their own default rather
 * than guessing, which keeps this usable from a headless script.
 */
export function browserLanguages(): string[] {
  if (typeof navigator == "undefined") return [];
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  return [...list].filter((tag) => typeof tag == "string" && tag.length > 0);
}

/**
 * The language to open a ruleset in.
 *
 * In order of preference: the one the reader picked before, the one the page
 * itself was exported in, and then whatever the browser asks for. The last one
 * is only a hint — a reader whose browser is German gets the German pedia on a
 * first visit instead of English, without any need for a per-language link.
 *
 * Every candidate has to be in `available`: a saved or detected language the
 * pack does not carry is no use, and returning it would leave the caller with
 * nothing to show.
 */
export function chooseLanguage(available: readonly string[], saved?: string, fallback?: string) {
  if (saved && available.includes(saved)) return saved;
  if (fallback && available.includes(fallback)) return fallback;
  return matchLanguage(available, browserLanguages());
}

/**
 * The entry of `available` that answers one of `preferred` locale tags best.
 *
 * `available` holds language names as the pedia spells them (`ru`, `pt-BR`),
 * `preferred` holds browser tags (`ru-RU`, `pt-BR`, `en`), which may name a
 * region the pack never translated. The tags are tried in order, and for each
 * one an exact match wins over the same language in another region, so a
 * Brazilian browser gets `pt-BR` even though `pt-PT` is there as well. A tag
 * with no region of its own prefers the entry with none; failing that, any entry
 * in that language is better than English, and `available`'s order decides
 * which. Returns nothing when no tag shares a language with the pack.
 */
export function matchLanguage(available: readonly string[], preferred: readonly string[]) {
  const byTag = new Map<string, string>();
  const byPrimary = new Map<string, string[]>();
  for (const name of available) {
    const lower = name.toLowerCase();
    byTag.set(lower, name);
    const primary = lower.split("-")[0];
    const group = byPrimary.get(primary);
    if (group) group.push(name);
    else byPrimary.set(primary, [name]);
  }

  for (const tag of preferred) {
    // Tags in the wild use `_` as well as `-`, e.g. from older browsers
    const lower = tag.toLowerCase().replace(/_/g, "-");
    const exact = byTag.get(lower);
    if (exact) return exact;

    const [primary, ...rest] = lower.split("-");
    const candidates = byPrimary.get(primary);
    if (!candidates?.length) continue;
    // `de-CH` against a pack with only `de` and `de-AT`
    if (rest.length) {
      const region = rest.join("-");
      const sameRegion = candidates.find((c) => c.toLowerCase().endsWith("-" + region));
      if (sameRegion) return sameRegion;
    }
    const bare = candidates.find((c) => !c.includes("-"));
    return bare ?? candidates[0];
  }

  return;
}

export function removeByValue<T>(arr: T[], item: T) {
  const ind = arr.indexOf(item);
  if (ind !== -1) {
    arr.splice(ind, 1);
    return true;
  }
  return false;
}

export function addIfNew<T>(arr: T[], item: T) {
  const ind = arr.indexOf(item);
  if (ind == -1) arr.push(item);
}

export function addAllIfNew<T>(arr: T[], items: T[] | T) {
  if (!Array.isArray(items)) {
    addIfNew(arr, items);
    return;
  }
  if (items.length < 3) {
    for (const it of items) addIfNew(arr, it);
  } else {
    const set = new Set(arr);
    for (const it of items) if (!set.has(it)) arr.push(it);
  }
}

export function isAncestorOf(ancestor: Node | null, descendant: Node | null) {
  let n: Node | null = descendant;
  while (n) {
    if (n === ancestor) {
      return true;
    } else {
      n = n.parentNode;
    }
  }
  return false;
}

export function capital(str: string | null) {
  if (str == null) return;
  // Only the first letter changes: labels legitimately hold capitals after it,
  // such as "TU", "CQC" and "VIP?"
  return str.substr(0, 1).toUpperCase() + str.substr(1);
}
export function cullDoubles<T>(list: T[]) {
  return [...new Set(list)] as T[];
}

export function clamp(min: number, val: number, max: number) {
  return Math.min(Math.max(val, min), max);
}

export function unique<T>(a: T[]) {
  return [...new Set(a)];
}

export function withoutKeys<T extends { [key: string]: any }>(o: T, keys: string[]) {
  const copy = { ...o };
  for (const k of keys) {
    delete copy[k];
  }
  return copy;
}

export function allFieldValuesOf(objects: { [key: string]: any }[], field: string) {
  const s = new Set<unknown>();

  for (const o of objects) {
    if (o[field] != undefined) s.add(o[field]);
  }
  return [...s];
}

export function exclude<T>(a: T[], b: T[]) {
  const s = new Set(b);
  return a.filter((v) => !s.has(v));
}

/**
 * True when the value is an array or object holding no nested arrays or objects.
 *
 * Used where a ruleset node has to be shown as a table or a short list: a nested
 * value there would have to be rendered as a link tree instead. `null` counts as
 * a plain value, since it has nothing to nest, but the value itself has to be an
 * array or object to qualify.
 */
export function isFlat(value: unknown) {
  if (value == null || typeof value != "object") return false;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.every((child) => child == null || typeof child != "object");
}

export function base64ToArrayBuffer(base64: string) {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
}

/** Base64 of binary data, chunked so large images don't overflow the call stack */
export function bytesToBase64(data: Uint8Array | number[]) {
  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const chunk = 0x8000,
    parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunk) {
    // `apply` takes any array-like, and a typed array is one; the DOM lib's
    // signature only admits `number[]`
    parts.push(
      String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]),
    );
  }
  return btoa(parts.join(""));
}

/** Data url for binary image data stored in the database */
export function imageDataToUrl(data: Uint8Array | number[] | undefined | null) {
  return data ? pngDataPrefix + bytesToBase64(data) : emptyImg;
}

/** Formatted number */
export function localeFixed2(n: number, digits = 4) {
  return n && (~~n == n ? n : n.toFixed(digits));
}

export function asMB(n: number) {
  return n != null ? `${localeFixed2(n / 1e6, 2)} MB` : "-";
}

export const pngDataPrefix = "data:image/png;base64,";

/**
 * The version and build number XPedia prints, such as `3.0.0-alpha.6 #42`.
 *
 * The version comes from `package.json` and names a release. The number after
 * `#` counts builds and tells one build or dev instance from another, which is
 * what a bug report needs: "alpha 6" alone may be months of code.
 *
 * A release bakes the number in at build time. The dev server cannot, because
 * `define` is evaluated once when the config loads; it writes a fresh number into
 * a `<meta>` tag on each page instead, see `devBuildNumber` in `vite.config.ts`.
 * Numbers spent by reloads leave gaps, which is expected: only their order
 * matters.
 *
 * Nothing here reads the running machine, so an exported page reports the version
 * it was exported with, not whatever the CLI later became.
 */
export function xpediaVersion(): string {
  const build = __XPEDIA_BUILD__ || injectedBuildNumber();
  return build ? `${__XPEDIA_VERSION__} #${build}` : __XPEDIA_VERSION__;
}

/**
 * The build number the dev server wrote into the page, if any.
 *
 * A production page has no such tag: its number came from `define` instead. The
 * tag is read rather than the DOM stored, because the value is fixed for the
 * lifetime of the page.
 */
let injectedNumber: string | undefined;
function injectedBuildNumber(): string {
  if (injectedNumber === undefined) {
    const meta =
      typeof document == "undefined"
        ? undefined
        : document.querySelector('meta[name="xpedia-build"]');
    injectedNumber = meta?.getAttribute("content") ?? "";
  }
  return injectedNumber;
}

/**
 * `git describe` of the build, for a tooltip.
 *
 * The printed version has to stay short enough for a navbar, which leaves out the
 * commit. Keeping the whole stamp here means a user can still be asked for it,
 * and it is what turns a build number back into sources: two machines counting
 * independently both reach #42 from different code.
 */
export function xpediaBuildStamp(): string {
  return __XPEDIA_STAMP__;
}

/**
 * Maps an archive path to the path the same file has under the game directory.
 *
 * The archive stores files under the pack's own root folder, while the game
 * looks for them relative to its installation:
 *
 * - `<pack>/user/mods/<mod>/...` → `user/mods/<mod>/...`
 * - `<pack>/standard/<mod>/...`  → `standard/<mod>/...`
 * - `<pack>/common/...`          → `common/...`
 * - `<mod>/...` packed on its own → `user/mods/<mod>/...`
 *
 * This mirrors the layout rules in `interpretPath`.
 *
 * It lives here rather than next to its callers because both the export code
 * and the ruleset need it, and the ruleset must not import the pack builder.
 */
export function gameRelativePath(path: string): string {
  const parts = path.split(/[/\\]/).filter((p) => p != "");
  const lower = parts.map((p) => p.toLowerCase());

  for (let i = 0; i < parts.length; i++) {
    if (lower[i] == "user" && lower[i + 1] == "mods") return parts.slice(i).join("/");
    if (lower[i] == "standard" || lower[i] == "common" || lower[i] == "mods")
      return parts.slice(i).join("/");
  }

  // No recognised install folder: a mod that was packed on its own belongs
  // under `user/mods` when extracted next to the game
  return "user/mods/" + parts.join("/");
}

/**
 * Replaces the URL with one that has no hash, without adding a history entry.
 *
 * The landing page has no hash of its own: it is the bare page. Assigning `""`
 * to `location.hash` looks like it should do this, but it appends a bare `"#"`
 * and fires a second `hashchange`, which would navigate again. `replaceState`
 * changes the address without firing anything, so the caller decides what
 * happens next.
 */
export function clearHash() {
  if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
}

/** The last element of a list, `undefined` when it is empty */
export const last = <T>(list: T[]) => list[list.length - 1];

/**
 * Image bytes for a sprite, when the host application provides them.
 *
 * An embedded build can define `fsData` to hand the pedia real files; in the
 * browser it is undefined, so the path itself is returned and the caller loads
 * it over the network instead.
 */
export async function loadData(path: string) {
  if (typeof fsData != "undefined") {
    return fsData(path);
  } else {
    return path;
  }
}
