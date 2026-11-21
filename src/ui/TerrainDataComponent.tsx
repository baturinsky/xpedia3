import { Fragment, type ReactNode } from "react";
import type { MainTableRenderer } from "./MainTable";
import { mapBlocks } from "./MapBlockComponent";
import { TipScopeProvider, Val } from "./Val";
import { asItems, isEmpty } from "./value";

/**
 * The `battlescapeTerrainData` of one `ufos` entry: an inline terrain.
 *
 * It is not a reference to a `terrains` entry — the pack states the whole
 * terrain here, so a nested table per field hid its shape behind boxes in
 * boxes (`Map blocks`/`0`/`1`/… and a `Name` the generic table never draws).
 * The name is the headline in its rul spelling, the data sets a comma list,
 * and the blocks reuse the `mapBlocks` summary: the terrain's placed items
 * and random spawns summed over all blocks, with the per-block file detail
 * behind a toggle.
 */

type TerrainData = { [field: string]: unknown };

/**
 * Fields in reading order after the three the renderer draws itself.
 * Anything the engine knows about that is not listed here follows in
 * sorted order, so a field added by a future engine still has somewhere
 * to go.
 */
const OTHER_ORDER = [
  "enviroEffects",
  "civilianTypes",
  "music",
  "depth",
  "ambience",
  "ambientVolume",
  "ambienceRandom",
  "ambienceRandomDelay",
  "script",
  "mapScripts",
];

/** A comma list of data-set names in their rul spelling */
function DataSetList({ value }: { value: unknown }): ReactNode {
  return (
    <>
      {asItems(value).map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a position in a parallel list identifies the item for the file reader
        <Fragment key={i}>
          {i > 0 && ", "}
          <code>{String(item)}</code>
        </Fragment>
      ))}
    </>
  );
}

/** A `[min, max]` pair as the file writes it */
function Pair({ value }: { value: unknown }): ReactNode {
  return <code>[{asItems(value).join(", ")}]</code>;
}

/** One field's value: ranges as tuples, everything else through `Val` */
function FieldValue({ field, value }: { field: string; value: unknown }): ReactNode {
  if (field === "depth" || field === "ambienceRandomDelay") return <Pair value={value} />;
  return <Val of={value} field={field} />;
}

/** The inline terrain's fields other than name, data sets and blocks */
function OtherFields({ terrain }: { terrain: TerrainData }): ReactNode {
  const drawn = new Set(["name", "mapDataSets", "mapBlocks"]);
  const known: [string, unknown][] = [];
  for (const field of OTHER_ORDER) {
    if (field in terrain && !isEmpty(terrain[field])) known.push([field, terrain[field]]);
  }
  const unknown = Object.keys(terrain)
    .filter(
      (field) => !drawn.has(field) && !OTHER_ORDER.includes(field) && !isEmpty(terrain[field]),
    )
    .sort();
  const fields = [...known, ...unknown.map((field): [string, unknown] => [field, terrain[field]])];
  if (fields.length === 0) return null;
  return (
    <dl className="data-fields">
      {fields.map(([field, value]) => (
        <Fragment key={field}>
          <dt>
            <Val of={field} capital={true} />
          </dt>
          <dd>
            <FieldValue field={field} value={value} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function TerrainDataView({ terrain }: { terrain: TerrainData }): ReactNode {
  const name = terrain.name;
  const dataSets = terrain.mapDataSets;
  const blocks = terrain.mapBlocks;
  return (
    <TipScopeProvider scope="terrainData">
      {name != null && name !== "" && <code className="terrain-name">{String(name)}</code>}
      {!isEmpty(dataSets) && (
        <dl className="data-fields">
          <dt>
            <Val of="mapDataSets" capital={true} />
          </dt>
          <dd>
            <DataSetList value={dataSets} />
          </dd>
        </dl>
      )}
      {!isEmpty(blocks) && mapBlocks({ key: "mapBlocks", val: blocks, row: 0 })}
      <OtherFields terrain={terrain} />
    </TipScopeProvider>
  );
}

/** The `battlescapeTerrainData` renderer for `ufos` articles */
export const battlescapeTerrainData: MainTableRenderer = ({ val }) => {
  if (val == null || typeof val !== "object") return <Val of={val} />;
  return <TerrainDataView terrain={val as TerrainData} />;
};
