import { useContext } from "react";

import { DataGrid } from 'react-data-grid';
import { listArchiveFiles, getStats, wipeAssets, eraseArchiveFile, unpackArchiveFile, viewAssets, getRul } from "../idb";
import { interpretPath } from "../load";
import { CogAnimation, MyTable, useStateAsync, viewImage } from "./components";
import { state, update, requestCancelSlowProcess } from "../state";
import { asMB, localeFixed2 } from "../util";

export function ArchiveFiles() {
  let files = state.files;

  if (!files || !Array.isArray(files))
    debugger

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
          return <div>
            <button onClick={async (e) => { 
              update({slowProcessStatus: "Erasing pack data"})
              await wipeAssets(pack); 
              await eraseArchiveFile(pack);
              update({slowProcessStatus: undefined})
            }}>delete</button>
            <button onClick={e => unpackArchiveFile(pack)}>unpack</button>
            <button onClick={e => wipeAssets(pack)}>wipe assets</button>
            <button onClick={e => viewAssets(pack)}>assets</button>
            <button className={pack == state.packName ? "current-file" : ""} onClick={e => {
              update({ packName: pack })
              getRul(pack)
            }}>rul</button>
          </div>
        }
      }
    ]}
    rows={files.map(s => {
      return {
        key: s.pack,
        archive: asMB(s.archive),
        name: s.pack,
        ruls: asMB(s?.ruls),
        assets: asMB(s?.assets)
      }
    })} />

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


export function SlowProcessStatus() {
  let done = state.slowProcessDone;
  let status = state.slowProcessStatus;
  let cancellable = state.slowProcessCancellable;

  function dismiss() {
    update({ slowProcessStatus: "", slowProcessDone: false, slowProcessError: false,
      slowProcessCancellable: false });
  }

  if (!status)
    return;

  // The window is modal: it dims and blocks the page until it is dismissed.
  // Escape/clicking the backdrop are deliberately ignored while work is in
  // progress so that a stray click cannot abort or hide a running load.
  return <div className="full-screen-centered status-overlay">
    <div className={"slow-process-status" + (done ? " done" : "") + (state.slowProcessError ? " error" : "")}
      role="dialog" aria-modal="true">
      {!done && <CogAnimation size={state.fontSize * 2} />}
      <span className="slow-process-text">{status}</span>
      {!done && <CogAnimation size={state.fontSize * 2} />}
      {!done && cancellable &&
        <button className="slow-process-cancel" title="Cancel loading"
          onClick={requestCancelSlowProcess}>Cancel</button>}
      {done && <button className="slow-process-close" title="Dismiss" onClick={dismiss}>OK</button>}
    </div>
  </div>
}

