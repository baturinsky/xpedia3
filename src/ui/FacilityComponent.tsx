import { useState } from "react";
import { rul } from "../rul/Ruleset";
import MainTable from "./MainTable";
import { Img, spriteScale, usePixelRatio } from "./components";
import { Val } from "./Val";
import { emptyImg } from "../imgPlaceholders";

/**
 * One base tile is 32x32 on screen, but a `BASEBITS.PCK` frame is often a bit
 * taller (32x40 in vanilla and in many mods) and may carry transparent margins.
 * Chunks are therefore drawn at their own resolution on a fixed 32px grid, so a
 * frame that is larger than its cell spills into the neighbouring ones instead
 * of being squashed into a square.
 */
const gridSize = 32;
const gridScale = 2;

/** A size x size block of base sprites, follows old `FacilitySprite.svelte` */
function FacilitySprite(props: { size: number, prop: number, bottom?: boolean }) {
  let size = props.size;
  // Cells are laid out from the same snapped scale the sprites are drawn with,
  // otherwise fractional display scaling would make the tiles drift apart
  let cell = gridSize * spriteScale(gridScale, usePixelRatio());
  let cells: JSX.Element[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // OpenXcom numbers a facility's frames row by row, x first:
      // frame = spriteShape + y * size + x, drawn at (x, y)
      let num = props.prop * 1 + y * size + x;
      let src = rul.obsSprite("base", num);
      let style = { position: "absolute" as const, left: x * cell, top: y * cell };
      // A missing frame would otherwise render as the 1x1 placeholder and
      // collapse to a couple of pixels, leaving a ragged edge
      cells.push(src == emptyImg
        ? <div key={`${x}-${y}`} style={{ ...style, width: cell, height: cell }} />
        : <Img key={`${x}-${y}`} className="facility sprite" alt="X"
          scale={gridScale} src={src} style={style} />);
    }
  }

  return <div className="tight" style={{
    position: "relative",
    width: cell * size,
    height: cell * size,
    marginBottom: props.bottom ? -cell * size : 0
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
    of={entry}
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
