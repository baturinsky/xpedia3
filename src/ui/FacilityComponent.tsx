import { type ReactElement, useState } from "react";
import { emptyImg } from "../imgPlaceholders";
import type { Facility } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import { Img, spriteScale, usePixelRatio } from "./components";
import MainTable, { type MainTableRenderer } from "./MainTable";
import { Val } from "./Val";

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
function FacilitySprite(props: { size: number; prop: number; bottom?: boolean }) {
  const size = props.size;
  // Cells are laid out from the same snapped scale the sprites are drawn with,
  // otherwise fractional display scaling would make the tiles drift apart
  const cell = gridSize * spriteScale(gridScale, usePixelRatio());
  const cells: ReactElement[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // OpenXcom numbers a facility's frames row by row, x first:
      // frame = spriteShape + y * size + x, drawn at (x, y)
      const num = props.prop * 1 + y * size + x;
      const src = rul.obsSprite("base", num);
      const style = { position: "absolute" as const, left: x * cell, top: y * cell };
      // A missing frame would otherwise render as the 1x1 placeholder and
      // collapse to a couple of pixels, leaving a ragged edge
      cells.push(
        src === emptyImg ? (
          <div key={`${x}-${y}`} style={{ ...style, width: cell, height: cell }} />
        ) : (
          <Img
            key={`${x}-${y}`}
            className="facility sprite"
            alt="X"
            scale={gridScale}
            src={src}
            style={style}
          />
        ),
      );
    }
  }

  return (
    <div
      className="tight"
      style={{
        position: "relative",
        width: cell * size,
        height: cell * size,
        marginBottom: props.bottom ? -cell * size : 0,
      }}
    >
      {cells}
    </div>
  );
}

export default function FacilityComponent({ entry }: { entry: Facility }) {
  const [seeStorageTiles, setSeeStorageTiles] = useState(false);
  const size = entry.size || 1;

  // `MainTableRenderer` hands every renderer its value as `any`, so the shape of
  // a ruleset node is the renderer's own business
  const buildCostItems: MainTableRenderer = ({ val: prop }) =>
    !prop
      ? null
      : Object.keys(prop)
          .sort()
          .map((field, i) => (
            <span key={field}>
              {i !== 0 && <br />}
              <Val of={field} />: {prop[field].build} / {prop[field].refund}
            </span>
          ));

  const storageTiles: MainTableRenderer = ({ val: prop }) =>
    !prop ? null : (
      <div>
        <div>
          <button
            type="button"
            className="button"
            onClick={() => setSeeStorageTiles(!seeStorageTiles)}
          >
            Expand
          </button>
        </div>
        <div>
          {seeStorageTiles && (
            <div style={{ columns: 6 }}>
              <Val of={prop} vertical={true} />
            </div>
          )}
        </div>
      </div>
    );

  const sprites: MainTableRenderer = ({ val: prop }) =>
    prop == null ? null : entry.spriteFacility ? (
      <>
        <FacilitySprite size={size} prop={prop} bottom={true} />
        <FacilitySprite size={size} prop={entry.spriteFacility} />
      </>
    ) : (
      <FacilitySprite size={size} prop={prop} />
    );

  return (
    <MainTable
      of={entry}
      title="Facility"
      sort={{
        first: ["spriteShape"],
        exclude: [
          "spriteFacility",
          "type",
          "battlescapeTerrainData",
          "craftInventoryTile",
          "deployment",
        ],
      }}
      special={{
        buildCostItems,
        storageTiles,
        provideBaseFunc: ({ val }) => <Val of={val} vertical={true} />,
        requiresBaseFunc: ({ val }) => <Val of={val} vertical={true} />,
        forbiddenBaseFunc: ({ val }) => <Val of={val} vertical={true} />,
        spriteShape: sprites,
      }}
    />
  );
}
