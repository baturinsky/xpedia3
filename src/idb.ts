import { dbVersion, state, update } from "./state";
import { unpackData, mergeBuiltinMods } from "./load";
import * as fflate from 'fflate';
import Ruleset from "./rul/Ruleset";
import { asMB } from "./util";
import { inlinePackStats } from "./packSource";


export let idb: IDBDatabase;

/**
 * The bucket the database was opened from, kept alive for the whole page.
 *
 * `bucket.indexedDB` looks like a plain `IDBFactory`, but the connections it
 * opens stay tied to the bucket object that produced them. If that object is
 * garbage collected — which a memory-heavy unpack triggers very quickly — the
 * connections do not error, they simply stop completing transactions, and the
 * upload hangs at the first write. Holding the bucket here is what keeps the
 * factory valid for as long as `idb` is in use.
 */
let packBucket: any;

/**
 * Name of the storage bucket that holds installed modpacks.
 *
 * A bucket rather than the origin's default storage because it is the only
 * place where the *browser* can enforce a lifetime: `expires` survives the tab
 * being closed, the browser restarting and the machine being rebooted, so an
 * uploaded pack that the user has forgotten about is reclaimed without them
 * ever coming back. Data left in the default storage has no such switch — the
 * page would have to be open to clean up after itself.
 *
 * The bucket is not per pack. Expiry is a property of the bucket, and all packs
 * share one `xpedia3` database, so a per-pack bucket would mean one database
 * per pack and moving `readImgData`'s "fall back to the builtin pack" logic
 * across buckets. One bucket also matches how the data is used: switching packs
 * reads several of them at once.
 *
 * `expires` is a *sliding* deadline, not a TTL from upload: it is pushed forward
 * on every visit, so a pack in regular use never expires and a forgotten one
 * does. Note that this is a Chromium feature (Chrome/Edge 122+). Elsewhere
 * `navigator.storageBuckets` is missing, the default storage is used and the
 * data is merely best effort, as it was before.
 *
 * Packs installed before this change are deliberately *not* moved into the
 * bucket: a bucket is a separate `IDBFactory`, so they stay readable in the
 * default storage until the user deletes them, and only packs uploaded from now
 * on get an expiry. Moving them would mean copying up to 150 MB during a page
 * load, which is not worth it to add a deadline to data the user already owns.
 */
const bucketName = "xpedia3";

/** How long an unused modpack survives, see `bucketName` */
const retentionDays = 360;

/** `navigator.storageBuckets` is Chromium-only, so every access is optional */
function storageBuckets(): any {
  return (navigator as any).storageBuckets;
}

/**
 * Describes the storage a pack occupies, for the size line in the pack list.
 *
 * `persisted` answers "can the browser delete this behind our back". It is
 * separate from the bucket expiry on purpose: a bucket that the user has not
 * interacted with enough gets the same best-effort treatment as any other
 * origin, so the UI must not promise durability it does not have.
 *
 * `retentionDays` is present only when the browser actually enforces an expiry
 * (see `bucketName`). Without it the page cannot promise that an unused pack
 * ever goes away on its own, and the UI must not say that it does.
 */
export async function storageInfo() {
  let estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  let persisted = await navigator.storage?.persisted?.().catch(() => undefined);
  let enforced = !!storageBuckets()?.open;
  return {
    usage: estimate?.usage, quota: estimate?.quota, persisted,
    retentionDays: enforced ? retentionDays : undefined
  };
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 3600 * 1000);
}

/**
 * Pushes the pack bucket's deadline forward. Called on load and whenever a pack
 * is installed, so the countdown always starts from the last time the pedia was
 * actually used. A failure here must never break loading: without a working
 * bucket the page still runs on default storage.
 */
async function touchBucket() {
  let buckets = storageBuckets();
  if (!buckets?.open)
    return;
  try {
    // The same object that `initDB` keeps alive: a second `open()` would be a
    // different handle, and the one the database depends on could be collected
    let bucket = packBucket ?? await buckets.open(bucketName);
    packBucket = bucket;
    await bucket.setExpires?.(daysFromNow(retentionDays));
  } catch (e) {
    console.warn("Could not extend the modpack storage lifetime", e);
  }
}

/**
 * Asks the browser to keep our data when disk space runs low, and reports
 * honestly when it refuses. Persistence is granted at the browser's discretion
 * (Chrome denies it to sites without engagement or an install signal), so a
 * `false` here is normal rather than an error — but it means the data is only
 * best effort and the UI must say so.
 */
async function requestPersistence() {
  try {
    return await navigator.storage?.persist?.() ?? false;
  } catch {
    return false;
  }
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
  // A page without storage has no stats to show, only the inlined pack
  let files = await getStats() ?? [];
  let inline = inlinePackStats();
  update({
    files,
    packs: inline ? [...files.filter(p => p.pack != inline.pack), inline] : files
  })
}

/**
 * Opens the local store. The returned promise always resolves, even when the
 * browser refuses IndexedDB: an exported HTML file carries its own ruleset and
 * reads images from the game folder, so it must still run somewhere storage is
 * blocked (some browsers throw on `file://`, private modes, hardened settings).
 * Uploading a modpack there is not possible, but browsing still is.
 */
export async function initDB() {
  let settled = false;

  /** No database: show only what the page itself provides */
  function withoutDB(error?: any) {
    if (settled)
      return;
    settled = true;
    console.warn("IndexedDB is not available, running without stored modpacks", error);
    let inline = inlinePackStats();
    update({ files: [], packs: inline ? [inline] : [] });
  }

  // The pack database lives in a bucket when the browser supports them, so the
  // browser can reclaim an unused pack on its own (see `bucketName`). Falling
  // back to the origin's default storage keeps Firefox and Safari working
  // exactly as before.
  let factory: IDBFactory = indexedDB;
  let buckets = storageBuckets();
  if (buckets?.open) {
    try {
      let bucket = await buckets.open(bucketName);
      // Kept in a module variable on purpose: see `packBucket`
      packBucket = bucket;
      factory = bucket.indexedDB;
      // Opening a bucket keeps its stored expiry; renewing it is a separate
      // step, so a browser that refuses to move the deadline still has a
      // working bucket rather than none
      await touchBucket();
    } catch (e) {
      console.warn("Could not open the modpack storage bucket, using default storage", e);
      factory = indexedDB;
    }
  }

  let openRequest: IDBOpenDBRequest;
  try {
    // Note that `file://` is *not* excluded: Chrome does keep an IndexedDB there,
    // which is what lets a modpack be imported on an exported page. Only skip it
    // when the browser actually refuses.
    openRequest = factory.open("xpedia3", dbVersion);
  } catch (e) {
    withoutDB(e);
    return;
  }

  // The caller has to wait for the database: `init` reads a stored ruleset right
  // after this, and an unopened `idb` would silently look like "nothing stored",
  // dropping the user onto the builtin pedia as if the pack had been lost
  let opened: () => void = () => { };
  let openedPromise = new Promise<void>(done => opened = done);

  // Belt and braces: some browsers report a request that never settles instead
  // of throwing, which would leave `init` waiting forever and the page blank
  let giveUp = setTimeout(() => { withoutDB("IndexedDB did not respond"); opened(); }, 3000);

  openRequest.onerror = () => {
    clearTimeout(giveUp);
    withoutDB(openRequest.error);
    opened();
  };

  openRequest.onsuccess = function () {
    clearTimeout(giveUp);
    // A database that shows up after the grace period is still good: adopt it,
    // so storage starts working even though the first page load went without.
    idb = openRequest.result;
    if (settled) {
      opened();
      return;
    }
    settled = true;
    // Persistence is requested, not required: a refusal is the normal answer for
    // a site the user has not installed, and the pack list reports the result
    // straight from the browser rather than from state
    requestPersistence();
    updateFileStats();
    opened();
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
  await openedPromise;
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
  // Uploading is the one thing that needs storage: say so plainly instead of
  // letting a later `undefined` transaction surface as a vague error
  if (!idb)
    throw new Error("this page cannot store modpacks because the browser has " +
      "blocked local storage for it");
  if (state.devView) {
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
  // Installing is the moment the pack's storage is definitely in use, so the
  // deadline is renewed here as well as on page load
  await touchBucket();
  updateFileStats()
}

export async function saveRul(pack: string, data: Uint8Array) {
  return await queryDB(transaction => transaction.objectStore("assets").add({ pack, data, kind: "rul" }))
}

/** True when the stored archive bytes are gone, see `getRul` */
export async function hasArchive(name: string) {
  return !!(await readBoth(transaction => transaction.objectStore("files").get(name)));
}

/**
 * The stored processed ruleset of a pack.
 *
 * A saved pack only holds its own mods; the builtin strings XPedia provides are
 * merged back in here, so an updated `builtinMods.zip` applies to every pack
 * already installed.
 */
export async function readRulData(pack: string) {
  let data = await readBoth<any>(transaction => transaction.objectStore("assets").index("packKind").get([pack, "rul"]));
  if (!data?.data)
    return
  let unpacked = fflate.decompressSync(data.data)
  let stored = JSON.parse(new TextDecoder().decode(unpacked));
  return await mergeBuiltinMods(stored, pack);
}

export async function getRul(pack: string) {
  let processed = await readRulData(pack);
  if (!processed)
    return;

  let rul = new Ruleset(processed);
  applySavedLanguage(rul);
  update({ rul, packName: pack })

  return processed;
}

/** Restores the language chosen by the user, if the loaded ruleset has it */
export function applySavedLanguage(rul: Ruleset) {
  if (state.lang && rul.langs?.[state.lang])
    rul.selectLang(state.lang);
  // Keep the saved preference in sync with whatever language ended up active
  state.lang = rul.langName ?? state.lang;
}

export async function viewAssets(pack: string) {
  let assets = await readBoth<any[]>(transaction => transaction.objectStore("assets").index("pack").getAll(pack)) ?? [];
  update({ assets: new Set(assets.map((a: any) => a.name)), packName: pack });
}

export async function saveStats(pack: string, archiveSize: number, assetsSize: number, rulSize: number) {
  let record = { pack, archive: archiveSize, assets: assetsSize, ruls: rulSize, kind: "stats" }
  return await queryDB(transaction => transaction.objectStore("assets").add(record))
}

/**
 * Stored byte size of each image of a pack, by path.
 *
 * Used to price the images an export archive would carry. Reading the records
 * rather than counting `saveStats` totals is what makes that possible: the
 * archive only takes the images the pedia can show, which is often a fraction of
 * everything the pack stored.
 */
export async function readImgSizes(pack: string) {
  let records = await readBoth<any[]>(transaction =>
    transaction.objectStore("assets").index("pack").getAll(pack));
  if (!records)
    return;
  let sizes = new Map<string, number>();
  for (let record of records)
    if (record.kind == "img" && record.name)
      sizes.set(record.name, record.data?.byteLength ?? record.data?.length ?? 0);
  return sizes;
}

/**
 * Every installed pack's stats, from both the bucket and pre-bucket storage.
 *
 * Records from the old database are marked `legacy`, because the pack list has
 * to be honest about lifetimes: the 360-day expiry is a property of the bucket,
 * and a pack left in default storage has no deadline at all.
 */
export async function getStats() {
  let bucket = await readDB(transaction => transaction.objectStore("assets").index("kind").getAll("stats")) as any[] ?? [];
  let db = await legacy();
  let old = db ? await runQuery(db, transaction => transaction.objectStore("assets").index("kind").getAll("stats"), "readonly", ["files", "assets"]) as any[] ?? [] : [];
  // A pack can only be in one place, but if both ever hold one the bucket wins
  let seen = new Set(bucket.map(record => record.pack));
  return [...bucket, ...old.filter(record => !seen.has(record.pack)).map(record => ({ ...record, legacy: true }))];
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
  return await readPick(transaction => transaction.objectStore("assets").index("name").getAll(path), records =>
    records.find(r => r.kind == "img" && r.pack == state.packName)
    ?? records.find(r => r.kind == "img" && r.pack == "builtin")
    ?? records.find(r => r.kind == "img"));
}

/** Image bytes of one pack, by full archive path */
export async function readImgData(pack: string, path: string) {
  return await readPick(transaction =>
    transaction.objectStore("assets").index("name").getAll(path), records =>
      records.find(r => r.kind == "img" && r.pack == pack)?.data
      // Builtin images are cached under their own pseudo pack and shared by all
      ?? records.find(r => r.kind == "img" && r.pack == "builtin")?.data);
}


export async function packAssets(pack: string) {
  return await readBoth<any[]>(transaction => transaction.objectStore("assets").index("pack").getAll(pack))
}


/** Deletes every `assets` record of a pack from one database */
function wipeFrom(db: IDBDatabase, pack: string) {
  return new Promise<void>(done => {
    let transaction = db.transaction("assets", "readwrite");
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
    transaction.onerror = () => done();
    transaction.onabort = () => done();
  })
}

/**
 * Removes a pack's assets. Both databases are wiped: a pack installed before
 * the bucket existed lives in the old one, and leaving that copy behind would
 * make a deleted pack reappear on the next load.
 */
export async function wipeAssets(pack: string) {
  // Without a database there is nothing stored to wipe; returning a resolved
  // promise keeps every caller working (see `initDB`)
  if (!idb)
    return;
  await wipeFrom(idb, pack);
  let db = await legacy();
  if (db)
    await wipeFrom(db, pack);
}

export async function queryDBCursor(db: string, index: string, match: any, cb: (v: IDBCursorWithValue) => void) {
  if (!idb)
    return;
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

/**
 * Transaction runner shared by the bucket database and the pre-bucket one.
 *
 * Resolves on commit rather than on the request: a request can succeed and the
 * transaction still abort afterwards (quota, per-value size limit), which used
 * to leave the caller waiting forever.
 */
function runQuery(
  db: IDBDatabase,
  action: (t: IDBTransaction) => IDBRequest,
  mode: IDBTransactionMode,
  dbNames: string | Iterable<string>,
) {
  return new Promise<any>((success, error) => {
    let transaction = db.transaction(dbNames, mode);
    let request = action(transaction);
    let result: any;
    request.onerror = e => {
      console.error(e, request);
      error?.(request.error);
    }
    request.onsuccess = () => {
      result = request.result;
    }
    transaction.oncomplete = () => success && success(result);
    transaction.onabort = () => {
      console.error("Transaction aborted", transaction.error);
      error?.(transaction.error);
    }
  })
}

export async function queryDB(
  action: (t: IDBTransaction) => IDBRequest,
  mode = "readwrite" as IDBTransactionMode,
  dbNames: string | Iterable<string> = ["files", "assets"],
) {
  // An exported page opened from disk may have no storage at all, see `initDB`
  if (!idb)
    throw new Error("This browser does not allow storing modpacks for this page");
  return runQuery(idb, action, mode, dbNames);
}

/**
 * The database packs were installed into before storage buckets were used.
 *
 * A bucket is a separate `IDBFactory`, so those packs are invisible to the
 * bucket database. They are read from here rather than moved: a pack is only
 * worth copying when it is used, and the old data keeps working untouched.
 *
 * Opening without a version would *create* an empty database where none exists,
 * so the name is checked first — which is also why this is worth memoising.
 *
 * The *promise* is memoised, not the result: several reads start at once
 * (`updateFileStats` and the stored pack's ruleset), and a cache filled in after
 * an `await` would let the second caller see "no old database" before the first
 * had even opened it, hiding every pre-bucket pack for the rest of the session.
 */
let legacyPromise: Promise<IDBDatabase | null> | undefined;

function legacy(): Promise<IDBDatabase | null> {
  return legacyPromise ??= openLegacy();
}

async function openLegacy(): Promise<IDBDatabase | null> {
  // Without a bucket there is no second database to look in: both names would
  // resolve to the same place and every read would come back doubled
  if (!packBucket)
    return null;
  try {
    let known = await indexedDB.databases?.();
    if (!known?.some(db => db.name == "xpedia3"))
      return null;
    return await new Promise<IDBDatabase>((ok, fail) => {
      let request = indexedDB.open("xpedia3");
      request.onsuccess = () => ok(request.result);
      request.onerror = () => fail(request.error);
    });
  } catch (e) {
    // An unreadable old database costs those packs, not the page
    console.warn("Could not open the modpack storage used before the bucket", e);
    return null;
  }
}

/** True when a read found nothing, whether it returned `undefined` or `[]` */
function empty(result: any) {
  return result == undefined || (Array.isArray(result) && !result.length);
}

/**
 * Reads from the bucket, falling back to the pre-bucket database only when the
 * bucket has nothing. Used for per-pack lookups, where a pack lives in one
 * place at a time, so the two results are alternatives rather than a union.
 */
async function readBoth<T>(action: (t: IDBTransaction) => IDBRequest): Promise<T | undefined> {
  if (!idb)
    return undefined;
  let current = await readDB(action);
  if (!empty(current))
    return current;
  let db = await legacy();
  if (!db)
    return current;
  return runQuery(db, action, "readonly", ["files", "assets"]);
}

/**
 * The first record `pick` accepts, preferring the bucket and consulting the
 * pre-bucket database only when the bucket has nothing usable.
 *
 * Image lookups are the hot path — every sprite on an article — so they must
 * not pay for a second database unless the bucket really cannot answer.
 */
async function readPick<T>(action: (t: IDBTransaction) => IDBRequest,
  pick: (records: any[]) => T | undefined): Promise<T | undefined> {
  let found = pick(await readDB(action) as any[] ?? []);
  if (found != undefined)
    return found;
  let db = await legacy();
  if (!db)
    return found;
  return pick(await runQuery(db, action, "readonly", ["files", "assets"]) ?? []);
}

export async function readDB(action: (t: IDBTransaction) => IDBRequest) {
  // Reading without a database is simply "nothing stored", not an error
  if (!idb)
    return undefined;
  return runQuery(idb, action, "readonly", ["files", "assets"])
}


/**
 * Stored archives, from both databases.
 *
 * The archive is a developer-mode convenience, but a pack installed before the
 * bucket existed can still be re-unpacked from its old copy.
 */
export async function listArchiveFiles() {
  let db = await legacy();
  let current = await readDB(transaction => transaction.objectStore("files").getAll()) as any[] ?? [];
  let old = db ? await runQuery(db, transaction => transaction.objectStore("files").getAll(), "readonly", ["files", "assets"]) as any[] ?? [] : [];
  let archiveFiles: { [name: string]: ArrayBuffer } = {};

  // The bucket is listed first and assignment keeps the first value, so its
  // copy of a name wins over the same name in the old database
  for (let record of [...current, ...old]) {
    if (record.name in archiveFiles)
      continue;
    // Legacy records store the bytes inline as `data`, new ones as a `blob`
    if (record.blob)
      archiveFiles[record.name] = await record.blob.arrayBuffer();
    else if (record.data)
      archiveFiles[record.name] = record.data;
  }

  return archiveFiles
}

export async function eraseArchiveFile(name: string) {
  // Nothing to erase when the page has no storage (see `initDB`)
  if (!idb)
    return;
  await queryDB(transaction => transaction.objectStore("files").delete(name));
  let db = await legacy();
  if (db)
    await runQuery(db, transaction => transaction.objectStore("files").delete(name), "readwrite", ["files"]);
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