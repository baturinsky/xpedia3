import { useContext } from "react";

import { DataGrid } from 'react-data-grid';
import { listArchiveFiles, getStats, wipeAssets, eraseArchiveFile, unpackArchiveFile, viewAssets, getRul } from "../idb";
import { interpretPath } from "../load";
import { CogAnimation, MyTable, useStateAsync, viewImage } from "./components";
import { store, update } from "../store";
import { asMB, localeFixed2 } from "../util";

export function ArchiveFiles() {
  let files = store.files;

  if (!files || !Array.isArray(files))
    debugger

  return <MyTable
    className="file-select"
    rowClass={(row) => {
      let current = row.name == store.packName;
      return current ? "current-file" : "";
    }}
    columns={[
      { key: 'archive', name: 'archive', cellClass: "num-grid", maxWidth: 100 },
      { key: 'name', name: 'name' },
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
              update({slowProcessStatus: null})
            }}>delete</button>
            <button onClick={e => unpackArchiveFile(pack)}>unpack</button>
            <button onClick={e => wipeAssets(pack)}>wipe</button>
            <button onClick={e => viewAssets(pack)}>assets</button>
            <button className={pack == store.packName ? "current-file" : ""} onClick={e => {
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
  return !!store.assets?.size && <div>
    Current Assets
    <DataGrid rowHeight={50}
      className="file-assets"
      onCellClick={e => {
        viewImage(e.row.name)
      }}
      columns={[
        { key: 'name', name: 'name' },
      ]}
      rows={[...store.assets].map(asset => ({ name: asset, maxWidth: 200 }))}
      enableVirtualization={true}
    />
  </div>
}


export function SlowProcessStatus() {
  if (!store.slowProcessStatus)
    return;
  return <div className="full-screen-centered">
    <div className="slow-process-status">
      <CogAnimation size={store.fontSize * 2} /> {store.slowProcessStatus} <CogAnimation size={store.fontSize * 2} />
    </div>
  </div>
}

