import { useState } from "react";
import { rul } from "../rul/Ruleset";
import MainTable from "./MainTable";
import { Img } from "./components";
import { Val } from "./Val";

/** A size x size block of base sprites, follows old `FacilitySprite.svelte` */
function FacilitySprite(props: { size: number, prop: number, bottom?: boolean }) {
  let size = props.size;
  let cells: JSX.Element[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let num = props.prop * 1 + x * size + y;
      cells.push(<Img key={`${x}-${y}`} className="facility sprite" alt="X"
        src={rul.obsSprite("base", num)} style={{ width: 64, height: 64 }} />);
    }
  }

  return <div className="tight" style={{
    columns: size,
    width: 64 * size,
    marginBottom: props.bottom ? -64 * size : 0
  }}>
    {cells}
  </div>;
}

export default function FacilityComponent({ entry }: { entry: any }) {
  let [seeStorageTiles, setSeeStorageTiles] = useState(false);
  let size = entry.size || 1;

  let buildCostItems = ({ val: prop }: { val: any }) =>
    !prop ? null : Object.keys(prop).sort().map((field, i) =>
      <span key={field}>
        {i != 0 && <br />}
        <Val of={field} />: {prop[field].build} / {prop[field].refund}
      </span>
    );

  let storageTiles = ({ val: prop }: { val: any }) =>
    !prop ? null : <div>
      <div>
        <button className="button" onClick={() => setSeeStorageTiles(!seeStorageTiles)}>
          Expand
        </button>
      </div>
      <div>
        {seeStorageTiles &&
          <div style={{ columns: 6 }}>
            <Val of={prop} vertical={true} />
          </div>
        }
      </div>
    </div>;

  let sprites = ({ val: prop }: { val: any }) =>
    prop == null ? null
      : entry.spriteFacility
        ? <>
          <FacilitySprite size={size} prop={prop} bottom={true} />
          <FacilitySprite size={size} prop={entry.spriteFacility} />
        </>
        : <FacilitySprite size={size} prop={prop} />;

  return <MainTable
    entry={entry}
    title="Facility"
    sort={{
      first: ["spriteShape"],
      exclude: ["spriteFacility", "type", "battlescapeTerrainData", "craftInventoryTile", "deployment"]
    }}
    special={{
      buildCostItems,
      storageTiles,
      provideBaseFunc: ({ val }) => <Val of={val} vertical={true} />,
      requiresBaseFunc: ({ val }) => <Val of={val} vertical={true} />,
      forbiddenBaseFunc: ({ val }) => <Val of={val} vertical={true} />,
      spriteShape: sprites,
    }}
  />;
}
