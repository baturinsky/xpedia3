import { store, update } from "./store";
import { unpackData } from "./load";
import * as fflate from 'fflate';
import Ruleset from "./rul/Ruleset";

const dbVersion = 11;
export let idb: IDBDatabase;

export async function updateFileStats() {
  let files = await getStats();
  console.log(files);
  update({files})
}

export function initDB() {
  let onDone;
  let promise = new Promise<IDBDatabase>(done => onDone = done)

  let openRequest = indexedDB.open("xpedia3", dbVersion);

  openRequest.onsuccess = function () {
    idb = openRequest.result;
    onDone(idb)
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

export async function saveFile(name: string, data: ArrayBuffer) {
  update({article:null, section:null})
  await queryDB(transaction => {
    return transaction.objectStore("files").put({ name, data })
  })
  await unpackArchiveFile(name);
  updateFileStats()
}

export async function saveRul(pack: string, data: Uint8Array) {
  return await queryDB(transaction => transaction.objectStore("assets").add({ pack, data, kind: "rul" }))
}

export async function getRul(pack: string) {
  let data = await queryDB(transaction => transaction.objectStore("assets").index("packKind").get([pack, "rul"]));
  if (!data?.data)
    return
  let unpacked = fflate.decompressSync(data.data)
  let str = new TextDecoder().decode(unpacked);
  let processed = JSON.parse(str);

  console.log(processed);
  let rul = new Ruleset(processed);
  update({ rul })

  return str;
}

export async function viewAssets(pack: string) {
  let assets = await queryDB(transaction => transaction.objectStore("assets").index("pack").getAll(pack));
  update({ assets: new Set(assets.map(a => a.name)), packName: pack });
}

export async function saveStats(pack: string, archiveSize: number, assetsSize: number, rulSize: number) {
  let record = { pack, archive: archiveSize, assets: assetsSize, ruls: rulSize, kind: "stats" }
  console.log("SaveStats", record);
  return await queryDB(transaction => transaction.objectStore("assets").add(record))
}

export async function getStats() {
  return await queryDB(transaction => transaction.objectStore("assets").index("kind").getAll("stats"));
}


export async function saveImg(pack: string, mod:string, path: string, data: Uint8Array) {
  return await queryDB(transaction => transaction.objectStore("assets").add({ pack, mod:mod, name: path, data, kind: "img" }))
}

export async function getImg(path: string) {
  return await queryDB(transaction => transaction.objectStore("assets").index("name").get(path))
}


export async function packAssets(pack: string) {
  return await queryDB(transaction => transaction.objectStore("assets").index("pack").getAll(pack))
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
      } else {
        done()
      }
    }
  })
}

export async function queryDBCursor(db: string, index: string, match, cb: (IDBCursorWithValue) => void) {
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

export async function queryDB(action: (t: IDBTransaction) => IDBRequest, dbNames: string | Iterable<string> = ["files", "assets"]) {
  return new Promise<any>((success, error) => {
    let transaction = idb.transaction(dbNames, "readwrite");
    let request = action(transaction);
    request.onerror = e => {
      console.error(e, request);
      error && error();
    }
    request.onsuccess = e => {
      success && success(request.result)
    }
  })
}

export async function listArchiveFiles() {
  let archives = await queryDB(transaction => transaction.objectStore("files").getAll()) as { data: ArrayBuffer, name: string }[];
  let archiveFiles = Object.fromEntries(archives.map(a => [a.name, a.data]));
  return archiveFiles
}

export async function eraseArchiveFile(name: string) {
  await queryDB(transaction => transaction.objectStore("files").delete(name)) as { data: ArrayBuffer, name: string }[];
  await updateFileStats();
}

export async function unpackArchiveFile(name: string) {
  let archives = await listArchiveFiles();
  await unpackData(name, archives[name]);
}
