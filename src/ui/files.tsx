import { DataGrid } from 'react-data-grid';
import { useEffect } from 'react';
import { wipeAssets, eraseArchiveFile, unpackArchiveFile, viewAssets, updateFileStats } from "../idb";
import { isPermanentPack, loadPackRul } from "../packSource";
import { loadBuiltinOnlyPack } from "../load";
import { CogAnimation, MyTable, viewImage } from "./components";
import { state, update, requestCancelSlowProcess, closeStatus, askConfirm, acceptConfirm, cancelConfirm } from "../state";
import { asMB } from "../util";

/** True while a load, delete or other modal operation is running */
function busy() {
  return !!state.slowProcessStatus && !state.slowProcessDone;
}


/** Total bytes a pack occupies in the database: ruleset, images and any kept archive */
function storedSize(pack: { assets?: number, ruls?: number, archive?: number }) {
  return (pack.assets ?? 0) + (pack.ruls ?? 0) + (pack.archive ?? 0);
}

/** Installs the stored ruleset of an already-unpacked pack */
export async function selectPack(pack: string) {
  if (busy() || pack == state.packName)
    return;
  update({
    slowProcessStatus: `Switching to ${pack}...`,
    slowProcessStage: "", slowProcessProgress: undefined,
    slowProcessDone: false, slowProcessError: false, slowProcessCancellable: false
  });
  let loaded: string | undefined;
  try {
    // The article and the cached images belong to the previous ruleset
    update({ article: undefined, section: undefined, images: {} });
    loaded = await loadPackRul(pack);
  } catch (e) {
    loaded = undefined;
  }
  if (!loaded) {
    update({
      slowProcessDone: true, slowProcessError: true,
      slowProcessStatus: `Could not open ${pack}: its pedia is missing from the browser storage. ` +
        `Upload the modpack again to rebuild it.`
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
  if (busy() || isPermanentPack(pack))
    return;
  // Deleting is irreversible, so both views ask first, in a window of the
  // pedia's own instead of the browser's unstyleable `confirm()`
  askConfirm(`Delete the pedia generated for ${pack}?`, () => erasePack(pack));
}

/** Deletes a pack's data, after the confirmation window was accepted */
async function erasePack(pack: string) {
  update({
    slowProcessStatus: `Deleting ${pack}...`,
    slowProcessStage: "", slowProcessProgress: undefined,
    slowProcessDone: false, slowProcessError: false, slowProcessCancellable: false
  });
  try {
    await wipeAssets(pack);
    await eraseArchiveFile(pack);
  } catch (e:any) {
    update({
      slowProcessDone: true, slowProcessError: true,
      slowProcessStatus: `Could not delete ${pack}: ${e?.message ?? e}`
    });
    return;
  }

  if (state.packName != pack) {
    closeStatus();
    return;
  }

  // The active pack is gone, so open whatever is left. `state.files` may still
  // contain the deleted pack until the stats refresh comes back, so filter it.
  let next = state.files?.find(f => f.pack != pack)?.pack;
  update({ article: undefined, section: undefined, images: {}, packName: undefined });
  let loaded = next ? await loadPackRul(next) : undefined;
  if (!loaded) {
    await loadBuiltinOnlyPack();
    update({
      slowProcessDone: true, slowProcessError: false,
      slowProcessStatus: `Deleted ${pack}. No modpacks left, showing the builtin pedia.`
    });
  } else {
    update({
      slowProcessDone: true, slowProcessError: false,
      slowProcessStatus: `Deleted ${pack}. Now showing ${next}.`
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
  if (busy() || !state.packName)
    return;
  let previous = state.packName;
  update({
    slowProcessStatus: `Unloading ${previous}...`,
    slowProcessStage: "", slowProcessProgress: undefined,
    slowProcessDone: false, slowProcessError: false, slowProcessCancellable: false
  });
  // The cached images and the open article belong to the old pack
  update({ article: undefined, section: undefined, images: {}, packName: undefined });
  try {
    await loadBuiltinOnlyPack();
  } catch (e:any) {
    update({
      slowProcessDone: true, slowProcessError: true,
      slowProcessStatus: `Could not unload ${previous}: ${e?.message ?? e}`
    });
    return;
  }
  update({
    slowProcessDone: true, slowProcessError: false,
    slowProcessStatus: `Unloaded ${previous}. No modpack selected, showing the builtin pedia.`
  });
  window.dispatchEvent(new CustomEvent("xpedia:loaded"));
}

/**
 * Modpack storage UI. The simple view is what a player needs: uploaded packs,
 * each in its own tile, click to switch, "x" to delete. The developer view
 * keeps the raw table and the unpacking tools used while working on the loader.
 */
export function ArchiveFiles() {
  let packs = state.packs;
  if(!packs)
    return
  return <>
    {state.devView ? <ModpackTable /> : <ModpackList />}
    {/* The switch itself stays hidden until the keyword unlocks it, so a
        player never sees the unpacking tools by accident */}
    {state.devUnlocked &&
      <button className="modpack-mode-switch"
        title={state.devView
          ? "Hide the unpacking tools and show the simple modpack list"
          : "Show storage sizes and unpacking tools"}
        onClick={() => update({ devView: !state.devView })}>
        {state.devView ? "Simple view" : "Developer view"}
      </button>
    }
    {state.devView &&
      <button className="modpack-deselect" disabled={!state.packName}
        title={state.packName
          ? "Unload the current modpack and show the builtin pedia"
          : "No modpack is selected"}
        onClick={deselectPack}>
        deselect
      </button>}

  </>;
}

function ModpackList() {
  let packs = state.packs ?? [];
  if (!packs.length)
    return <p className="modpack-empty">No modpacks uploaded yet.</p>;

  return <div className="modpack-list">
    {packs.map(pack => {
      let current = pack.pack == state.packName;
      let permanent = isPermanentPack(pack.pack);
      return <div key={pack.pack}
        className={"modpack-panel" + (current ? " current" : "") + (permanent ? " permanent" : "")}
        title={current ? "Currently shown" : "Click to show this modpack"}
        onClick={() => selectPack(pack.pack)}>
        {/* The inlined pack comes from the HTML file itself, so it has no
            delete button: there is nothing separate to remove */}
        {!permanent && <button className="modpack-delete" title="Delete this modpack"
          onClick={e => {
            // The tile itself selects the pack, deleting must not also open it
            e.stopPropagation();
            deletePack(pack.pack);
          }}>×</button>}
        <div className="modpack-name">{pack.pack}</div>
        <div className="modpack-size">{permanent ? "inlined" : asMB(storedSize(pack))}</div>
        {current && <div className="modpack-current">currently shown</div>}
      </div>;
    })}
  </div>;
}

function ModpackTable() {
  let files = state.packs ?? [];

  return <MyTable
    className="file-select"
    rowClass={(row) => {
      let current = row.name == state.packName;
      return current ? "current-file" : "";
    }}
    columns={[
      { key: 'name', name: 'name' },
      { key: 'archive', name: 'archive', cellClass: "num-grid", maxWidth: 100 },
      { key: 'ruls', name: 'ruls', maxWidth: 100 },
      { key: 'assets', name: 'assets', maxWidth: 100 },
      {
        key: "", name: "tools", minWidth: 150, renderCell: (a) => {
          let pack = a.row.name;
          // The inlined pack only exists as this HTML file, so the database
          // tools have nothing to act on
          if (isPermanentPack(pack))
            return <div>
              <button className={pack == state.packName ? "current-file" : ""}
                onClick={e => selectPack(pack)}>rul</button>
            </div>;
          return <div>
            <button onClick={e => deletePack(pack)}>delete</button>
            <button onClick={e => unpackArchiveFile(pack)}>unpack</button>
            <button onClick={async e => {
              await wipeAssets(pack);
              await updateFileStats();
            }}>wipe assets</button>
            <button onClick={e => viewAssets(pack)}>assets</button>
            <button className={pack == state.packName ? "current-file" : ""}
              onClick={e => selectPack(pack)}>rul</button>
          </div>
        }
      }
    ]}
    rows={files.map(s => {
      return {
        key: s.pack,
        archive: s.archive ? asMB(s.archive) : "inlined",
        name: s.pack,
        ruls: asMB(s?.ruls),
        assets: s.assets ? asMB(s?.assets) : "inlined"
      }
    })} />;
}

export function CurrentAssets() {
  return !!state.assets?.size && <div>
    Current Assets
    <DataGrid rowHeight={50}
      className="file-assets"
      onCellClick={e => {
        viewImage(e.row.name)
      }}
      columns={[
        { key: 'name', name: 'name' },
      ]}
      rows={[...state.assets].map(asset => ({ name: asset, maxWidth: 200 }))}
      enableVirtualization={true}
    />
  </div>
}


/**
 * Modal question before an irreversible action, see `askConfirm`.
 *
 * It is deliberately its own window instead of the browser's `confirm()`: the
 * page is a pedia with its own look, and `confirm()` blocks the whole tab,
 * ignores the theme and cannot be translated or styled.
 */
export function ConfirmDialog() {
  let request = state.confirmRequest;

  // Escape is the normal way out of a modal, and it means Cancel here
  useEffect(() => {
    if (!request)
      return;
    function onKey(e: KeyboardEvent) {
      if (e.key == "Escape") {
        e.preventDefault();
        cancelConfirm();
      }
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [!!request]);

  if (!request)
    return null;

  return <div className="full-screen-centered status-overlay">
    <div className="confirm-dialog" role="alertdialog" aria-modal="true">
      <div className="confirm-message">{request.message}</div>
      <div className="confirm-buttons">
        {/* The safe choice holds the focus: a destructive action must not be
            one stray Enter away */}
        <button className="confirm-ok" onClick={acceptConfirm}>OK</button>
        <button className="confirm-cancel" autoFocus onClick={cancelConfirm}>Cancel</button>
      </div>
    </div>
  </div>;
}


export function SlowProcessStatus() {
  let done = state.slowProcessDone;
  let status = state.slowProcessStatus;
  let cancellable = state.slowProcessCancellable;
  let progress = state.slowProcessProgress;
  let stage = state.slowProcessStage;

  if (!status)
    return;

  let pct = progress == null ? undefined : Math.round(progress * 100);

  // The window is modal: it dims and blocks the page until it is dismissed.
  // Escape/clicking the backdrop are deliberately ignored while work is in
  // progress so that a stray click cannot abort or hide a running load.
  return <div className="full-screen-centered status-overlay">
    <div className={"slow-process-status" + (done ? " done" : "") + (state.slowProcessError ? " error" : "")}
      role="dialog" aria-modal="true">
      {!done && <CogAnimation size={state.fontSize * 2} />}
      <div className="slow-process-body">
        <span className="slow-process-text">{status}</span>
        {!done && stage &&
          <div className="slow-process-bar" role="progressbar"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
            <div className="slow-process-fill" style={{ width: `${pct ?? 0}%` }} />
          </div>}
      </div>
      {!done && <CogAnimation size={state.fontSize * 2} />}
      {!done && cancellable &&
        <button className="slow-process-cancel" title="Cancel loading"
          onClick={requestCancelSlowProcess}>Cancel</button>}
      {done && <button className="slow-process-close" title="Dismiss" onClick={closeStatus}>OK</button>}
    </div>
  </div>
}
