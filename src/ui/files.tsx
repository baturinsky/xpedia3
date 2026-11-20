import { useEffect, useRef, useState } from "react";
import { DataGrid } from "react-data-grid";
import {
  eraseArchiveFile,
  storageInfo,
  unpackArchiveFile,
  updateFileStats,
  viewAssets,
  wipeAssets,
} from "../idb";
import { loadBuiltinOnlyPack, uploadUsersFiles } from "../load";
import { isPermanentPack, loadPackRul } from "../packSource";
import { examplePacksBase, loadPackFromUrl } from "../packUrl";
import type { ProcessedRuleset } from "../rul/Ruleset";
import {
  acceptConfirm,
  askConfirm,
  cancelConfirm,
  closeStatus,
  requestCancelSlowProcess,
  state,
  update,
} from "../state";
import { asMB } from "../util";
import { CogAnimation, MyTable, viewImage } from "./components";
import { Tr } from "./Val";

/** True while a load, delete or other modal operation is running */
function busy() {
  return !!state.slowProcessStatus && !state.slowProcessDone;
}

/** Total bytes a pack occupies in the database: ruleset, images and any kept archive */
function storedSize(pack: { assets?: number; ruls?: number; archive?: number }) {
  return (pack.assets ?? 0) + (pack.ruls ?? 0) + (pack.archive ?? 0);
}

/**
 * A byte count in the unit that keeps it short. `asMB` is fine for a pack but
 * the quota is measured in gigabytes, where a plain MB figure is unreadable.
 */
function asSize(bytes: number) {
  if (bytes < 1e9) return asMB(bytes);
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** Installs the stored ruleset of an already-unpacked pack */
export async function selectPack(pack: string) {
  if (busy() || pack === state.packName) return;
  update({
    slowProcessStatus: `Switching to ${pack}...`,
    slowProcessStage: "",
    slowProcessProgress: undefined,
    slowProcessDone: false,
    slowProcessError: false,
    slowProcessCancellable: false,
  });
  let loaded: ProcessedRuleset | undefined;
  try {
    // The article and the cached images belong to the previous ruleset
    update({ article: undefined, section: undefined, images: {} });
    loaded = await loadPackRul(pack);
  } catch {
    loaded = undefined;
  }
  if (!loaded) {
    update({
      slowProcessDone: true,
      slowProcessError: true,
      slowProcessStatus:
        `Could not open ${pack}: its pedia is missing from the browser storage. ` +
        `Upload the modpack again to rebuild it.`,
    });
    return;
  }
  closeStatus();
  // The old article and section belong to the old pack; the navigation layer
  // takes the page back to HOME, see `main.ts`
  window.dispatchEvent(new CustomEvent("xpedia:loaded"));
}

/**
 * Removes everything stored for a pack. Deleting the active pack falls back to
 * another installed pack, or to the builtin pedia when none is left.
 */
async function deletePack(pack: string) {
  // The inlined pack lives in this HTML file, deleting the database entry for
  // it would only make the file look broken
  if (busy() || isPermanentPack(pack)) return;
  // Deleting is irreversible, so both views ask first, in a window of the
  // pedia's own instead of the browser's unstyleable `confirm()`
  askConfirm(`Delete the pedia generated for ${pack}?`, () => erasePack(pack));
}

/** Deletes a pack's data, after the confirmation window was accepted */
async function erasePack(pack: string) {
  update({
    slowProcessStatus: `Deleting ${pack}...`,
    slowProcessStage: "",
    slowProcessProgress: undefined,
    slowProcessDone: false,
    slowProcessError: false,
    slowProcessCancellable: false,
  });
  try {
    await wipeAssets(pack);
    await eraseArchiveFile(pack);
  } catch (e) {
    update({
      slowProcessDone: true,
      slowProcessError: true,
      slowProcessStatus: `Could not delete ${pack}: ${e?.message ?? e}`,
    });
    return;
  }

  if (state.packName !== pack) {
    closeStatus();
    return;
  }

  // The active pack is gone, so open whatever is left. `state.files` may still
  // contain the deleted pack until the stats refresh comes back, so filter it.
  const next = state.files?.find((f) => f.pack !== pack)?.pack;
  update({ article: undefined, section: undefined, images: {}, packName: undefined });
  const loaded = next ? await loadPackRul(next) : undefined;
  if (!loaded) {
    await loadBuiltinOnlyPack();
    update({
      slowProcessDone: true,
      slowProcessError: false,
      slowProcessStatus: `Deleted ${pack}. No modpacks left, showing the builtin pedia.`,
    });
  } else {
    update({
      slowProcessDone: true,
      slowProcessError: false,
      slowProcessStatus: `Deleted ${pack}. Now showing ${next}.`,
    });
  }
  window.dispatchEvent(new CustomEvent("xpedia:loaded"));
}

/**
 * Unloads the currently shown modpack and falls back to the builtin pedia, as
 * if no modpack had ever been selected. This is a developer tool: it makes the
 * "nothing selected" state reachable without deleting the pack.
 */
async function deselectPack() {
  if (busy() || !state.packName) return;
  const previous = state.packName;
  update({
    slowProcessStatus: `Unloading ${previous}...`,
    slowProcessStage: "",
    slowProcessProgress: undefined,
    slowProcessDone: false,
    slowProcessError: false,
    slowProcessCancellable: false,
  });
  // The cached images and the open article belong to the old pack
  update({ article: undefined, section: undefined, images: {}, packName: undefined });
  try {
    await loadBuiltinOnlyPack();
  } catch (e) {
    update({
      slowProcessDone: true,
      slowProcessError: true,
      slowProcessStatus: `Could not unload ${previous}: ${e?.message ?? e}`,
    });
    return;
  }
  update({
    slowProcessDone: true,
    slowProcessError: false,
    slowProcessStatus: `Unloaded ${previous}. No modpack selected, showing the builtin pedia.`,
  });
  window.dispatchEvent(new CustomEvent("xpedia:loaded"));
}

/**
 * Modpack storage UI. The simple view is what a player needs: uploaded packs,
 * each in its own tile, click to switch, "x" to delete. The developer view
 * keeps the raw table and the unpacking tools used while working on the loader.
 */
export function ArchiveFiles() {
  const packs = state.packs;
  if (!packs) return;
  return (
    <>
      {state.devView ? <ModpackTable /> : <ModpackList />}
      {/* The switch itself stays hidden until the keyword unlocks it, so a
        player never sees the unpacking tools by accident */}
      {state.devUnlocked && (
        <button
          type="button"
          className="modpack-mode-switch"
          title={
            state.devView
              ? "Hide the unpacking tools and show the simple modpack list"
              : "Show storage sizes and unpacking tools"
          }
          onClick={() => update({ devView: !state.devView })}
        >
          {state.devView ? "Simple view" : "Developer view"}
        </button>
      )}
      {state.devView && (
        <button
          type="button"
          className="modpack-deselect"
          disabled={!state.packName}
          title={
            state.packName
              ? "Unload the current modpack and show the builtin pedia"
              : "No modpack is selected"
          }
          onClick={deselectPack}
        >
          deselect
        </button>
      )}
      {state.devView && <UrlPackLoader />}
    </>
  );
}

function ModpackList() {
  const packs = state.packs ?? [];

  return (
    <>
      {packs.length > 0 && <StorageSummary packs={packs} />}
      <div className="modpack-list">
        {packs.map((pack) => {
          const current = pack.pack === state.packName;
          const permanent = isPermanentPack(pack.pack);
          return (
            <div
              key={pack.pack}
              className={`modpack-panel${current ? " current" : ""}${permanent ? " permanent" : ""}`}
              title={current ? "Currently shown" : "Click to show this modpack"}
              onClick={() => selectPack(pack.pack)}
            >
              {/* The inlined pack comes from the HTML file itself, so it has no
              delete button: there is nothing separate to remove */}
              {!permanent && (
                <button
                  type="button"
                  className="modpack-delete"
                  title="Delete this modpack"
                  onClick={(e) => {
                    // The tile itself selects the pack, deleting must not also open it
                    e.stopPropagation();
                    deletePack(pack.pack);
                  }}
                >
                  ×
                </button>
              )}
              <div className="modpack-name">{pack.pack}</div>
              <div className="modpack-size">{permanent ? "inlined" : asMB(storedSize(pack))}</div>
              {current && <div className="modpack-current">currently shown</div>}
            </div>
          );
        })}
        {/* A tile that is not a modpack, sitting where the next one would go: the
          empty space after the last pack says nothing, while a dashed tile in
          the same shape says "another one belongs here". */}
        <UploadTile />
      </div>
    </>
  );
}

/**
 * The phantom tile at the end of the modpack list.
 *
 * It is a `<button>`, not a decorative box: until now the only way to add a pack
 * was `makeDropzone`, which listens for a drop on `<body>`, so a touch device
 * had no way in at all. A click opens the file picker instead, which is the same
 * `FileList` that the drop handler already takes.
 *
 * It also owns the drag feedback. `makeDropzone` marks `<body>` with a `hover`
 * class while a file is dragged over the page, and nothing in the stylesheet
 * used to match that class, so a drag used to give no sign at all that the page
 * would accept it.
 */
function UploadTile() {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // The drop itself is still handled by the page-wide dropzone. This only
  // mirrors which files are being dragged over it.
  useEffect(() => {
    const body = document.body;
    const sync = () => setDragging(body.classList.contains("hover"));
    // `dragleave` fires on every child the cursor crosses, so the class is read
    // back after each event rather than trusted directly
    const events = ["dragenter", "dragover", "dragleave", "drop"];
    for (const e of events) body.addEventListener(e, sync);
    return () => {
      for (const e of events) body.removeEventListener(e, sync);
    };
  }, []);

  // The input is a sibling of the button, not a child: a `<button>` cannot
  // contain another interactive control, and the picker has to stay reachable
  // for a keyboard user even though the tile is what they see and click.
  return (
    <>
      <button
        type="button"
        className={`modpack-panel modpack-add${dragging ? " dragging" : ""}`}
        title="Add a modpack: choose a zip or rar file, or drag one onto the page"
        onClick={() => input.current?.click()}
      >
        <Tr text="STR_ABOUT_UPLOAD" nobr={false} />
      </button>
      {/* Hidden, because the tile is the visible control; the picker only needs to
        exist for the click to open it. The accepted types are a hint for the
        file dialog, which `uploadUsersFiles` still validates. */}
      <input
        ref={input}
        type="file"
        accept=".zip,.rar"
        hidden
        onChange={(e) => {
          const files = e.target.files;
          // The status window is modal, so the picker must not start a second load
          // on top of a running one; `makeDropzone` guards its own path the same way
          if (files?.length && !state.slowProcessStatus && !state.confirmRequest)
            uploadUsersFiles(files);
          // Clearing lets the same file be picked again after a failed load, since
          // an unchanged value fires no `change` event
          e.target.value = "";
        }}
      />
    </>
  );
}

/**
 * One line above the tiles answering "how much is this costing me", which the
 * per-tile sizes cannot: a user with several heavy packs otherwise has to add
 * them up. The estimate is the whole origin, so it includes the tiles plus any
 * archive kept in developer mode.
 */
function StorageSummary({ packs }: { packs: NonNullable<typeof state.packs> }) {
  const [info, setInfo] = useState<{
    usage?: number;
    quota?: number;
    persisted?: boolean;
    retentionDays?: number;
  }>();
  const total = packs.reduce((sum, pack) => sum + storedSize(pack), 0);
  const stored = packs.length;

  // The estimate changes as packs are deleted, which re-renders this component
  // with a new list, so it is re-read then rather than on a timer
  useEffect(() => {
    storageInfo().then(setInfo);
  }, [stored, total]);

  const quota = info?.quota;
  const usage = info?.usage ?? total;
  // Packs from before the bucket have no expiry at all, so a single statement
  // about "unused packs" would be false for them
  const legacy = packs.filter((pack) => pack.legacy).length;

  // Only say packs expire on their own where the browser enforces the expiry:
  // on Firefox and Safari nothing would ever remove them, and promising a
  // deadline that does not exist is worse than saying nothing
  const reasons: string[] = [];
  if (info?.persisted === false) reasons.push("it may be cleared if the disk fills up");
  if (info?.retentionDays && legacy < stored)
    reasons.push(`unused packs are removed after ${info.retentionDays} days`);
  if (legacy)
    reasons.push(
      legacy === 1
        ? "1 pack was installed before this version and is kept until you delete it"
        : `${legacy} packs were installed before this version and are kept until you delete them`,
    );

  return (
    <div className="modpack-storage">
      <span>
        {stored === 1 ? "1 modpack" : `${stored} modpacks`} using <b>{asSize(usage)}</b>
        {quota ? ` of ${asSize(quota)} the browser allows` : ""}
      </span>
      {/* Saying this is the difference between "my packs are safe" and "they may
        vanish", and only the browser knows which. */}
      {reasons.length > 0 && (
        <span
          className="modpack-storage-warning"
          title={reasons.map((r) => `${r[0].toUpperCase() + r.slice(1)}.`).join(" ")}
        >
          storage is not guaranteed
        </span>
      )}
    </div>
  );
}

/**
 * Loads a modpack from a URL, for testing packs too large for the browser tools
 * that push files into a page.
 *
 * Developer view only, because a normal player has the drop target and no reason
 * to fetch an arbitrary address. The same loader is also reachable without this
 * field through `?packUrl=`, which works in either view.
 */
function UrlPackLoader() {
  const [url, setUrl] = useState("");
  const [examples, setExamples] = useState<{ name: string; size: number }[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const base = examplePacksBase();

  // The dev server can list what it serves, so the packs are picked by name
  // rather than typed from memory. A release build has no such route and simply
  // shows an empty field.
  useEffect(() => {
    if (!base) return;
    let live = true;
    fetch(base)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { name: string; size: number }[]) => {
        if (live) setExamples(list);
      })
      .catch(() => {
        /* a missing listing only costs the picker */
      });
    return () => {
      live = false;
    };
  }, [base]);

  async function load() {
    if (!url.trim() || busy()) return;
    setError(undefined);
    try {
      await loadPackFromUrl(url.trim());
    } catch (e) {
      // The import reports its own failures in the status window; this only
      // covers a URL that could not be fetched at all
      setError(e?.message ?? String(e));
    }
  }

  return (
    <div className="modpack-url">
      <label title="Fetch a modpack archive from this address and import it as if it had been dropped on the page">
        load pack from URL
      </label>
      {examples.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) setUrl(e.target.value);
          }}
        >
          <option value="">example packs…</option>
          {examples.map((p) => (
            <option key={p.name} value={base + p.name}>
              {p.name} ({asSize(p.size)})
            </option>
          ))}
        </select>
      )}
      <input
        type="text"
        value={url}
        spellCheck={false}
        placeholder={base ? `${base}mod.zip` : "http://host/mod.zip"}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") load();
        }}
      />
      <button type="button" disabled={!url.trim() || busy()} onClick={load}>
        load
      </button>
      {error && <span className="modpack-url-error">{error}</span>}
    </div>
  );
}

function ModpackTable() {
  const files = state.packs ?? [];

  return (
    <MyTable
      className="file-select"
      rowClass={(row) => {
        const current = row.name === state.packName;
        return current ? "current-file" : "";
      }}
      columns={[
        { key: "name", name: "name" },
        { key: "archive", name: "archive", cellClass: "num-grid", maxWidth: 100 },
        { key: "ruls", name: "ruls", maxWidth: 100 },
        { key: "assets", name: "assets", maxWidth: 100 },
        {
          key: "",
          name: "tools",
          minWidth: 150,
          renderCell: (a) => {
            const pack = a.row.name;
            // The inlined pack only exists as this HTML file, so the database
            // tools have nothing to act on
            if (isPermanentPack(pack))
              return (
                <div>
                  <button
                    type="button"
                    className={pack === state.packName ? "current-file" : ""}
                    onClick={() => selectPack(pack)}
                  >
                    rul
                  </button>
                </div>
              );
            return (
              <div>
                <button type="button" onClick={() => deletePack(pack)}>
                  delete
                </button>
                <button type="button" onClick={() => unpackArchiveFile(pack)}>
                  unpack
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await wipeAssets(pack);
                    await updateFileStats();
                  }}
                >
                  wipe assets
                </button>
                <button type="button" onClick={() => viewAssets(pack)}>
                  assets
                </button>
                <button
                  type="button"
                  className={pack === state.packName ? "current-file" : ""}
                  onClick={() => selectPack(pack)}
                >
                  rul
                </button>
              </div>
            );
          },
        },
      ]}
      rows={files.map((s) => {
        return {
          key: s.pack,
          archive: s.archive ? asMB(s.archive) : "inlined",
          name: s.pack,
          ruls: asMB(s?.ruls),
          assets: s.assets ? asMB(s?.assets) : "inlined",
        };
      })}
    />
  );
}

export function CurrentAssets() {
  return (
    !!state.assets?.size && (
      <div>
        Current Assets
        <DataGrid
          rowHeight={50}
          className="file-assets"
          onCellClick={(e) => {
            viewImage(e.row.name);
          }}
          columns={[{ key: "name", name: "name" }]}
          rows={[...state.assets].map((asset) => ({ name: asset, maxWidth: 200 }))}
          enableVirtualization={true}
        />
      </div>
    )
  );
}

/**
 * Modal question before an irreversible action, see `askConfirm`.
 *
 * It is deliberately its own window instead of the browser's `confirm()`: the
 * page is a pedia with its own look, and `confirm()` blocks the whole tab,
 * ignores the theme and cannot be translated or styled.
 */
export function ConfirmDialog() {
  const request = state.confirmRequest;

  // Escape is the normal way out of a modal, and it means Cancel here
  useEffect(() => {
    if (!request) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelConfirm();
      }
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [!!request]);

  if (!request) return null;

  return (
    <div className="full-screen-centered status-overlay">
      <div className="confirm-dialog" role="alertdialog" aria-modal="true">
        <div className="confirm-message">{request.message}</div>
        <div className="confirm-buttons">
          {/* The safe choice holds the focus: a destructive action must not be
            one stray Enter away */}
          <button type="button" className="confirm-ok" onClick={acceptConfirm}>
            OK
          </button>
          <button type="button" className="confirm-cancel" autoFocus onClick={cancelConfirm}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function SlowProcessStatus() {
  const done = state.slowProcessDone;
  const status = state.slowProcessStatus;
  const cancellable = state.slowProcessCancellable;
  const progress = state.slowProcessProgress;
  const stage = state.slowProcessStage;

  if (!status) return;

  const pct = progress == null ? undefined : Math.round(progress * 100);

  // The window is modal: it dims and blocks the page until it is dismissed.
  // Escape/clicking the backdrop are deliberately ignored while work is in
  // progress so that a stray click cannot abort or hide a running load.
  return (
    <div className="full-screen-centered status-overlay">
      <div
        className={`slow-process-status${done ? " done" : ""}${state.slowProcessError ? " error" : ""}`}
        role="dialog"
        aria-modal="true"
      >
        {!done && <CogAnimation size={state.fontSize * 2} />}
        <div className="slow-process-body">
          <span className="slow-process-text">{status}</span>
          {!done && stage && (
            <div
              className="slow-process-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct ?? 0}
            >
              <div className="slow-process-fill" style={{ width: `${pct ?? 0}%` }} />
            </div>
          )}
        </div>
        {!done && <CogAnimation size={state.fontSize * 2} />}
        {!done && cancellable && (
          <button
            type="button"
            className="slow-process-cancel"
            title="Cancel loading"
            onClick={requestCancelSlowProcess}
          >
            Cancel
          </button>
        )}
        {done && (
          <button
            type="button"
            className="slow-process-close"
            title="Dismiss"
            onClick={closeStatus}
          >
            OK
          </button>
        )}
      </div>
    </div>
  );
}
