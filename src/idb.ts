import { dbVersion, state, update } from "./state";
import { unpackData } from "./load";
import * as fflate from 'fflate';
import Ruleset from "./rul/Ruleset";
import { asMB } from "./util";


export let idb: IDBDatabase;

/**
 * Asks the browser to keep our data when disk space runs low. Without this the
 * storage is "best effort" and a 250 MB+ modpack can be evicted behind our
 * back, leaving `localStorage.packName` pointing at an archive that is gone.
 */
function requestPersistence() {
  navigator.storage?.persist?.().catch(() => { })
}

/**
 * Turns a failed archive write into something a user can act on. The raw error
 * is either a DOMException or `undefined` (some aborts carry no error at all),
 * so the message has to explain the likely cause instead of echoing it.
 */
function archiveWriteError(size: number, error?: DOMException | null) {
  let quota = error?.name == "QuotaExceededError" || error?.name == "DataError";
  if (!quota && error?.name && error.name != "UnknownError")
    return `Could not save the archive: ${error.message || error.name}`;
  return `Could not save the archive: it needs ${asMB(size)} of local storage, ` +
    `which is more than the browser allows (usually about 60% of free disk space)`;
}

export async function updateFileStats() {
  let files = await getStats();
  update({ files })
}

export function initDB() {
  let onDone: Function;
  let promise = new Promise<IDBDatabase>(done => onDone = done)

  let openRequest = indexedDB.open("xpedia3", dbVersion);

  openRequest.onsuccess = function () {
    idb = openRequest.result;
    onDone(idb)
    requestPersistence();
    updateFileStats();
  };

  openRequest.onupgradeneeded = function () {
    let db = openRequest.result;
    if (!db.objectStoreNames.contains("files"))
      db.createObjectStore("files", { keyPath: "name" });

    if (db.objectStoreNames.contains("assets"))
      db.deleteObjectStore("assets");

    let assets = db.createObjectStore("assets", { keyPath: "id", autoIncrement: true });
    assets.createIndex("name", "name", { unique: false });
    assets.createIndex("packKind", ["pack", "kind"], { unique: false });
    assets.createIndex("kind", "kind", { unique: false });
    assets.createIndex("pack", "pack", { unique: false });
    assets.createIndex("packPath", ["pack", "path"], { unique: false });

  };
  return promise;
}

/**
 * Stores an uploaded archive, then unpacks it straight from the bytes we
 * already have in memory.
 *
 * The archive blob exists only for the developer tools: re-unpacking is not an
 * end-user scenario, and the pedia itself never reads it (the ruleset and images
 * live in `assets`). So in the normal mode the bytes are unpacked and dropped,
 * which also keeps the stored size down to what the pedia actually needs.
 *
 * In developer mode the bytes are kept as a `Blob` rather than as an
 * `ArrayBuffer` record because IndexedDB refuses a single serialized value above
 * ~127 MiB (Chrome aborts the transaction with "The serialized keys and/or value
 * are too large") and real modpacks commonly exceed that. A `Blob` is persisted
 * by reference instead of being serialized inline, so it is not subject to that
 * limit.
 */
export async function saveFile(name: string, data: ArrayBuffer) {
  update({ article: undefined, section: undefined })
  if (state.developerMode) {
    try {
      await queryDB(transaction =>
        transaction.objectStore("files").put({ name, blob: new Blob([data]), size: data.byteLength }));
    } catch (e) {
      // A pack that does not fit is a normal outcome, not a bug: report it in
      // plain language instead of letting a bare DOMException reach the status
      throw new Error(archiveWriteError(data.byteLength, e as DOMException));
    }
  }
  await unpackData(name, data);
  updateFileStats()
}

export async function saveRul(pack: string, data: Uint8Array) {
  return await queryDB(transaction => transaction.objectStore("assets").add({ pack, data, kind: "rul" }))
}

/** True when the stored archive bytes are gone, see `getRul` */
export async function hasArchive(name: string) {
  return !!(await readDB(transaction => transaction.objectStore("files").get(name)));
}

export async function getRul(pack: string) {
  let data = await readDB(transaction => transaction.objectStore("assets").index("packKind").get([pack, "rul"]));
  if (!data?.data)
    return
  let unpacked = fflate.decompressSync(data.data)
  let str = new TextDecoder().decode(unpacked);
  let processed = JSON.parse(str);

  let rul = new Ruleset(processed);
  applySavedLanguage(rul);
  update({ rul, packName: pack })

  return str;
}

/** Restores the language chosen by the user, if the loaded ruleset has it */
export function applySavedLanguage(rul: Ruleset) {
  if (state.lang && rul.langs?.[state.lang])
    rul.selectLang(state.lang);
  // Keep the saved preference in sync with whatever language ended up active
  state.lang = rul.langName ?? state.lang;
}

export async function viewAssets(pack: string) {
  let assets = await readDB(transaction => transaction.objectStore("assets").index("pack").getAll(pack));
  update({ assets: new Set(assets.map((a: any) => a.name)), packName: pack });
}

export async function saveStats(pack: string, archiveSize: number, assetsSize: number, rulSize: number) {
  let record = { pack, archive: archiveSize, assets: assetsSize, ruls: rulSize, kind: "stats" }
  return await queryDB(transaction => transaction.objectStore("assets").add(record))
}

export async function getStats() {
  return await readDB(transaction => transaction.objectStore("assets").index("kind").getAll("stats"));
}


export async function saveImg(pack: string, mod: string, path: string, data: Uint8Array) {
  return await queryDB(transaction => transaction.objectStore("assets").add({ pack, mod: mod, name: path, data, kind: "img" }))
}

/**
 * Saves many images in batched transactions. One transaction per image is
 * correct but slow (an extra commit per record), so images are grouped.
 */
export async function saveImgs(pack: string, images: { mod: string, path: string, data: Uint8Array }[],
  onProgress?: (done: number) => void | Promise<void>) {
  let batchSize = 200;
  for (let start = 0; start < images.length; start += batchSize) {
    let batch = images.slice(start, start + batchSize);
    await queryDB(transaction => {
      let store = transaction.objectStore("assets");
      for (let img of batch)
        store.add({ pack, mod: img.mod, name: img.path, data: img.data, kind: "img" });
      return store.count();
    });
    await onProgress?.(Math.min(images.length, start + batchSize));
  }
}

/**
 * Looks up an image for the currently shown pack. Images are stored per pack,
 * so a plain `name` lookup could return the same path from another modpack
 * (pack switches keep all packs installed). Builtin images live under the
 * `builtin` pack, which every pack inherits.
 */
export async function getImg(path: string) {
  let records = await readDB(transaction => transaction.objectStore("assets").index("name").getAll(path)) as any[];
  if (!records?.length)
    return;
  return records.find(r => r.kind == "img" && r.pack == state.packName)
    ?? records.find(r => r.kind == "img" && r.pack == "builtin")
    ?? records.find(r => r.kind == "img");
}


export async function packAssets(pack: string) {
  return await readDB(transaction => transaction.objectStore("assets").index("pack").getAll(pack))
}


export function wipeAssets(pack: string) {
  return new Promise<void>(done => {
    let transaction = idb.transaction("assets", "readwrite");
    let os = transaction.objectStore("assets")
    let query = os.index("pack").openCursor(IDBKeyRange.only(pack))
    query.onsuccess = () => {
      let cursor = query.result;
      if (cursor) {
        os.delete(cursor.primaryKey)
        cursor.continue()
      }
      // Resolve on commit: callers read the stats right afterwards, and a
      // cursor can reach its end while the transaction is still uncommitted
    }
    transaction.oncomplete = () => done();
  })
}

export async function queryDBCursor(db: string, index: string, match: any, cb: (v: IDBCursorWithValue) => void) {
  return new Promise<void>((success, error) => {
    let transaction = idb.transaction(db, "readwrite");
    let os = transaction.objectStore(db)
    let request = os.index(index).openCursor(IDBKeyRange.only(match))
    request.onsuccess = () => {
      let cursor = request.result;
      if (cursor) {
        cb(cursor)
        cursor.continue()
      } else {
        success()
      }
    }
    request.onerror = e => {
      console.error(e, request);
      error && error();
    }
  })

}

export async function queryDB(
  action: (t: IDBTransaction) => IDBRequest,
  mode = "readwrite" as IDBTransactionMode,
  dbNames: string | Iterable<string> = ["files", "assets"],
) {
  return new Promise<any>((success, error) => {
    let transaction = idb.transaction(dbNames, mode);
    let request = action(transaction);
    let result: any;
    request.onerror = e => {
      console.error(e, request);
      error?.(request.error);
    }
    request.onsuccess = () => {
      result = request.result;
    }
    // Resolve on commit, not on the request: a request can succeed and the
    // transaction still abort afterwards (quota, per-value size limit), which
    // used to leave the caller waiting forever
    transaction.oncomplete = () => success && success(result);
    transaction.onabort = () => {
      console.error("Transaction aborted", transaction.error);
      error?.(transaction.error);
    }
  })
}

export async function readDB(action: (t: IDBTransaction) => IDBRequest) {
  return queryDB(action, "readonly")
}


export async function listArchiveFiles() {
  let archives = await queryDB(transaction => transaction.objectStore("files").getAll()) as any[];
  let archiveFiles: { [name: string]: ArrayBuffer } = {};

  for (let record of archives) {
    // Legacy records store the bytes inline as `data`, new ones as a `blob`
    if (record.blob)
      archiveFiles[record.name] = await record.blob.arrayBuffer();
    else if (record.data)
      archiveFiles[record.name] = record.data;
  }

  return archiveFiles
}

export async function eraseArchiveFile(name: string) {
  await queryDB(transaction => transaction.objectStore("files").delete(name));
  await updateFileStats();
}

export async function unpackArchiveFile(name: string) {
  let archives = await listArchiveFiles();
  // The archive can be gone while its unpacked ruleset and images survive, e.g.
  // when the browser evicts the largest value first under storage pressure
  if (!archives[name]) {
    update({
      slowProcessStatus: `The archive for ${name} is no longer stored, so it cannot be re-unpacked. ` +
        `Its pedia is still usable; upload the archive again if you need to rebuild it.`,
      slowProcessDone: true, slowProcessError: true, slowProcessProgress: undefined
    });
    return;
  }
  await unpackData(name, archives[name]);
}
