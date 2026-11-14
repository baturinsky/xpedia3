import { emptyImg } from "./imgPlaceholders";


//For possible app implementations
declare const
  fsData: (path: string) => string
  ;

export function delay(n: number) {
  return new Promise(r => setTimeout(r, n));
}

//export const camelToSnakeCase = str => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

export function camelToUnderscore(key:string) {
  var result = key.replace(/([A-Z])/g, " $1");
  return result.split(' ').join('_').toLowerCase();
}

export function getFlagEmoji(countryCode: string) {
  return countryCode.toUpperCase()
  //return String.fromCodePoint(...[...countryCode.toUpperCase()].map(x=>0x1f1a5+x.charCodeAt()));
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
  if (ind == -1)
    arr.push(item);
}

export function addAllIfNew<T>(arr: T[], items: T[] | T) {
  if (!Array.isArray(items)) {
    addIfNew(arr, items)
    return;
  }
  if (items.length < 3) {
    for (let it of items)
      addIfNew(arr, it)
  } else {
    let set = new Set(arr);
    for (let it of items)
      if (!set.has(it))
        arr.push(it);
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
  if (str == null)
    return;
  // Only the first letter changes: labels legitimately hold capitals after it,
  // such as "TU", "CQC" and "VIP?"
  return str.substr(0, 1).toUpperCase() + str.substr(1)
}
export function cullDoubles<T>(list: T[]) {
  return [...new Set(list)] as T[];
}

export function clamp(min: number, val: number, max: number) {
  return val < min ? min : val > max ? max : val;
}

export function unique(a: any[]) {
  return [...new Set(a)];
}


export function withoutKeys(o: { [key: string]: any }, keys: string[]) {
  let copy = { ...o };
  for (let k of keys) {
    delete copy[k];
  }
  return copy;
}

export function allFieldValuesOf(objects: { [key: string]: any }[], field: string) {
  let s = new Set<any>();

  for (let o of objects) {
    if (o[field] != undefined)
      s.add(o[field]);
  }
  return [...s];
}

export function exclude<T>(a: T[], b: T[]) {
  let s = new Set(b);
  return a.filter(v => !s.has(v))
}

/**
 * True when the value is an array or object holding no nested arrays or objects.
 *
 * Used where a ruleset node has to be shown as a table or a short list: a nested
 * value there would have to be rendered as a link tree instead. `null` counts as
 * a plain value, since it has nothing to nest, but the value itself has to be an
 * array or object to qualify.
 */
export function isFlat(value: any) {
  if (value == null || typeof value != "object")
    return false;
  let children = Array.isArray(value) ? value : Object.values(value);
  return children.every(child => child == null || typeof child != "object");
}

export function base64ToArrayBuffer(base64: string) {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
}

/** Base64 of binary data, chunked so large images don't overflow the call stack */
export function bytesToBase64(data: Uint8Array | number[]) {
  let bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
  let chunk = 0x8000, parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunk) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as any));
  }
  return btoa(parts.join(""));
}

/** Data url for binary image data stored in the database */
export function imageDataToUrl(data: Uint8Array | number[] | undefined | null) {
  return data ? pngDataPrefix + bytesToBase64(data) : emptyImg;
}

/** Formatted number */
export function localeFixed2(n: number, digits = 4) {
  return n && ((~~n) == n ? n : n.toFixed(digits));
}

export function asMB(n: number) {
  return n != null ? `${localeFixed2(n / 1e6, 2)} MB` : "-"
}

export const pngDataPrefix = "data:image/png;base64,"

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
  if (location.hash)
    history.replaceState(history.state, "", location.pathname + location.search);
}

export const last = (list: any[]) => list[list.length - 1];

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

