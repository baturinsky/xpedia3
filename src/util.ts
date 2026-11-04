import JSYaml from "js-yaml";

export function inform(...t: string[]) {
  console.log(...t)
}

export function warn(...t: string[]) {
  console.warn(...t)
}


//For possible app implementations
declare const
  fsFile: (path: string) => string,
  fsData: (path: string) => string,
  fsSave: (name: string, data: string) => string,
  fsDir: (path: string, always: boolean) => string[]
  ;

async function fetchAll(files: { [name: string]: string }) {
  return Object.fromEntries(
    await Promise.all(
      Object.keys(files).map(async (path) => [
        path,
        await (await fetch(files[path])).text(),
      ])
    )
  );
}

export async function readTextFile(path: string) {
  let text: string;
  try {
    text = await fetchText(path)
    inform(path);
  } catch (e) {
    console.error(e);
    warn(e);
    return null;
  }
  return text;
}

export async function fetchText(path:string) {
  if (typeof fsFile != "undefined")
    return fsFile(path);
  else
    return (await fetch(path)).text()
}


const dirFilesRegex = /<\s*a[^>]*>(.*?)<\s*\/\s*a>/gi;

export async function listDir(path:string, full = false) {
  if (typeof fsDir != "undefined") {
    let files = fsDir(path, full)
    return files;
  }
  let text = await readTextFile(path);
  let matches: string[], files: string[] = [];
  while (matches = dirFilesRegex.exec(text)) {
    let dir = matches[1];
    if (matches[0].indexOf("href=#") != -1 || dir.indexOf("<") != -1)
      continue;
    if (dir != "../" && dir.substring(0, 4) != "http")
      files.push(full ? path + dir : dir);
  }
  return files;
}


export async function readYaml(path: string) {
  let text = await readTextFile(path);
  if(text == null)
    return null;
  let parsed = parseYaml(text, path);
  return parsed as any;
}

export function parseYaml(file: string, filename: string) {
  try {
    return JSYaml.load(file, {
      json: true,
      filename,
      onWarning: (e) => {
        console.error(e.message);
      }
    });
  } catch (e:any) {
    console.error(e.message);
    warn(e.message);
  }
}


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

export function singular(s: string) {
  return s.replace(/(e?s)$/, "");
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


export function isAncestorOf(ancestor, descendant) {
  let n = descendant;
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
  return str.substr(0, 1).toUpperCase() + str.substr(1).toLowerCase()
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


export function withoutKeys(o: Object, keys: string[]) {
  o = { ...o };
  for (let k of keys) {
    delete o[k];
  }
  return o;
}

export function allFieldValuesOf(objects: Object[], field: string) {
  let s = new Set();

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

export function loadImage(path: string) {
  return new Promise<HTMLImageElement>((done, fail) => {
    const image = new Image();
    image.src = path;
    image.onload = () => {
      done(image);
    };
  })
}

export function createCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext('2d');
  canvas.width = w;
  canvas.height = h;
  return [canvas, ctx]
}


export function imageToCanvas(image: HTMLImageElement) {
  let [canvas, context] = createCanvas(image.width, image.height);
  context.drawImage(image, 0, 0);
  return canvas;
}

export const getBase64StringFromDataURL = (dataURL) =>
  dataURL.replace('data:', '').replace(/^.+,/, '');


export function canvasToBase64(canvas: HTMLCanvasElement) {
  const dataURL = canvas.toDataURL();
  const base64 = getBase64StringFromDataURL(dataURL);
  return base64;
}

export async function pathToDataUrl(path: string) {
  let blob = await (await fetch(path)).blob();
  var reader = new FileReader();
  reader.readAsDataURL(blob);
  return new Promise<string>(done => {
    reader.onloadend = function () {
      done(reader.result as string);
    }
  })
}

export function splitCanvas(canvas: HTMLCanvasElement) {
  let height = canvas.height;
  let partsNum = canvas.width / canvas.height;
  let parts: HTMLCanvasElement[] = [];
  for (let i = 0; i < partsNum; i++) {
    let [part, ctx] = createCanvas(height, height);
    ctx.drawImage(canvas, i * height, 0, height, height, 0, 0, height, height)
    parts.push(part)
  }
  return parts;
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
export function localeFixed2(n, digits = 4) {
  return n && ((~~n) == n ? n : n.toFixed(digits));
}

export function asMB(n: number) {
  return n != null ? `${localeFixed2(n / 1e6, 2)} MB` : "-"
}

export const pngDataPrefix = "data:image/png;base64,"

export const emptyImg = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAYdEVYdFNvZnR3YXJlAHBhaW50Lm5ldCA0LjEuNv1OCegAAAANSURBVBhXY/j//z8DAAj8Av6IXwbgAAAAAElFTkSuQmCC";
export const favicon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAMAUExURQAAAAMDAwMJCAgICAoKCg0NDQoTEQoTEgsUEg0XFQ0aGR4eHg0tKxMlIhUoJhgoKQ4zLw42LxUyLxcyLw45Mw45NRY0MBowMB81NxI9ORM/OBg+Ox8+OiEzMiE0NCA9PC89OjU2Nj09PRZDPRRFPR9BPBxEPSxCPxdEQRlFQhNLQhVKQxRMRBdPRR1MRh5ORx5VTiRKRCRKRihNSShOSDhHRDJIRTVLSDdOSjtKSD5KSiJVTClXTShVTzdTTSlXUCpWUSpXUCNbVCddVS9aUitfVyxcVz1SUDBYUiNhWStmXipuYThmYzdoYDdqYzl1az13bzV7ckVJSEBWUUNXU0hVVUBZV0JcWE9dXU5jW0pgXkZkYE1kYU1kYEZsZFBjYVBjYklwak51bUJ9dF91c1d4clt5dFp6dVt7dl55dF98eGBoaGZoaGhvbW1tbWdwb2J1b2Vyc2J6eWZ5eGN/e2h5eD2CeUGBd2aBfUiMgkOQg02Sh0qViU+ViUabi02Yjl6UjVabjVKfkWKFgGGLhX+AgH+KiWOakmick0ypm1WgklGhlFKpnFKrnlGwn1OvoFauoVWzpFaypVmwpFe8rlu5qW6xpmG8q2u5q265rX+2q1rBs17Jt1vLvF/NvVzPvGTDtmDHtmDIt2LIt2fJt2bLtmLGuGHHumXFuWbFumjHuW7FumHJuGHJuGPIuGDKuWPLuWPJu2DKumDKu2PKumLLumPLumPLu2XJuWXLuWXLu2TKumHNuWHNumDNu2PMu2TMu2XNu2HJvGPLvWLLvGPLvmXJvWXKvWbKvWfIvmHNvWHMvGHMvWLNvWLMvWPMvWPNvmfPvWnIumrJu2/Iu2jJvW7Lv2vMvWjOvGjNv2vNvm/MvW/Mv3LOv27QvmbPwG/RwnDSwnXSwX/Sx3rWyoePjYiMi4mSkJSXl5qfn6KlpIbDu4LEuYrIvYHSxIPTx4LUx47UyYrVzYPZyonYy5re08zMzMvQz9Hb2drf39rg39rh4N7k5ODj4uvs7AAAAOGYdbwAAAEAdFJOU////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wBT9wclAAAACXBIWXMAAA7DAAAOwwHHb6hkAAACCElEQVQ4T2P4TwCQpCA3pSIrPaMkPhvKBwOEAqvUt1/u3rp86fqjaXFQIRBAKGh4d2PnruPnzp08fnijClQMCOAKmj9snbf3zJnz5/fsurppiQRUFElBx61t+85DwZ6F0lBRJAVvNqzZD5U/f2qzF1QUpiAvL8jOxMPe3t7R0dHGwdbFRCYvLw8sA1XAyvD3lSIDEHAZqoIohp/c36BmwyilP79ZgBJG5ycBScZfzP9gdsPpl63fgVJHzh/hZWDIefEDJg5X8IwjmJOd/dKx8+d3sLNxhjBBhREK/ieuX75r8/lz589fmLd9QZ04VBRJwf8Z83dfOA9UcfzsugmuUDEgQCiIvrQRHAi7N0ytDoWKAQFCwX/r5ScO7jx6+viUGiGoCAggKfivu2zextNrJtaKQflggKzgv3zlhN56N4QDQQBZQYH5f36+/P+lMVA+GMAVRCS0fG4EMeK/fvANMwOLgQBMgdXrDw9X6IOZPmsu3qt6CmYCAUxBW7KzzsH9nhb/i9tvNIn6QZSCALIb1FZfmO70aWm5HJQPBsgK/qt3rrx/vAzKgQJkBc+T7vRPXn9FA8qFALiCkszCWXe6BP9rzt3nH5UZDhVFKEj4eO/JTW8FIMuk+9TDnT0QUSCAmyBlEDg7AMRwn9mnq8wDFgMBJDfISQqCaS0RUzANAciOxAoIKPj/HwDL5k4xG94BrQAAAABJRU5ErkJggg=="

export const last = (list: any[]) => list[list.length - 1];

