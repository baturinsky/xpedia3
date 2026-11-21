import { Fragment, type ReactNode, useState } from "react";
import type { MainTableRenderer } from "./MainTable";
import { formatNumber, TipScopeProvider, Tr, Val } from "./Val";
import { asItems, asNumber, isEmpty } from "./value";

/**
 * The `mapBlocks` of one terrain, as a loot summary with the file detail
 * behind a toggle.
 *
 * What a player can ask of a terrain is what loot is on its maps, so the
 * placed `items` of every block are summed into one list (`Name ×total`,
 * with the prime ranges the blocks state, if any), and the `randomizedItems`
 * spawns merge into groups by item list (`one of A, B ×total`). The
 * per-block data — sizes, groups, spawn positions, extended items — is what
 * a reader comparing against the ruleset text needs, and it stays reachable,
 * collapsed, under "File details" rather than spread over a card per block.
 * A field a block does not state is left out, and blocks keep the order the
 * file writes them in.
 */

type MapBlock = { [field: string]: unknown };

/**
 * Fields in the order they are read, rather than the order the pack happened
 * to write them in. `name` is never a field row; anything the engine knows
 * about that is not listed here follows in sorted order, so a field added by
 * a future engine still has somewhere to go.
 *
 * `items` and `randomizedItems` are summed over the whole terrain before
 * they are read, and `fuseTimers` folds into the item lines it primes;
 * `extendedItems` stay a row of their own, next to them. */
const FIELD_ORDER = [
  "width",
  "length",
  "height",
  "groups",
  "revealedFloors",
  "items",
  "fuseTimers",
  "randomizedItems",
  "extendedItems",
  "craftInventoryTile",
];

/** Fields not drawn as a row of the block's own: `randomizedItems` is drawn
 *  under them, `fuseTimers` folded into the `items` rows of the items they
 *  prime. */
const LIST_ROW_FIELDS = ["randomizedItems", "fuseTimers"];

/**
 * The fields one block states, in reading order. `randomizedItems` is left
 * out: it is drawn under the block's fields, not as one of them. A field
 * nothing states gets no row, so a field like `height` that one pack uses
 * and the next does not gets no blank line.
 */
function blockFields(block: MapBlock): string[] {
  const seen = new Set(
    Object.keys(block).filter(
      (field) => field !== "name" && !isEmpty(block[field]) && !LIST_ROW_FIELDS.includes(field),
    ),
  );
  return [
    ...FIELD_ORDER.filter((field) => seen.has(field)),
    ...[...seen].filter((field) => !FIELD_ORDER.includes(field)).sort(),
  ];
}

/** A comma list of `Val`s, for `groups` and `revealedFloors` */
function InlineList({ items, field }: { items: unknown[]; field?: string }): ReactNode {
  return (
    <>
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a position in a parallel list identifies the item for the file reader
        <Fragment key={i}>
          {i > 0 && ", "}
          <Val of={item} field={field} />
        </Fragment>
      ))}
    </>
  );
}

/** A coordinate tuple `[x, y, z]` as the file writes it */
function Tuple({ value }: { value: unknown }): ReactNode {
  return <code>[{asItems(value).map(formatNumber).join(", ")}]</code>;
}

/** The `[x, y, z]` positions one placed item occupies */
function PositionList({ value }: { value: unknown }): ReactNode {
  const positions = asItems(value);
  return (
    <>
      {positions.map((position, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a position is identified by its order among the item's positions
        <Fragment key={i}>
          {i > 0 && ", "}
          <Tuple value={position} />
        </Fragment>
      ))}
    </>
  );
}

/** The item keys of a field keyed by item id */
function entriesOf(value: unknown): [string, unknown][] {
  return typeof value === "object" && value != null
    ? Object.entries(value as { [key: string]: unknown })
    : [];
}

/** One placed item summed over the whole terrain */
type PlacedItem = {
  id: string;
  count: number;
  positions: unknown[];
  fuseRanges: [unknown, unknown][];
  unprimed: number;
};

/**
 * Every block's placed items summed by id: the total is what a reader wants
 * ("how many of these on the map"), and the fuse ranges the blocks state for
 * it ride along. Copies a block places without priming stay unprimed, and
 * are counted, so "primed" is never claimed for them all when it is not.
 */
function mergedItems(blocks: MapBlock[]): PlacedItem[] {
  const byId = new Map<string, PlacedItem>();
  for (const block of blocks) {
    const timers = new Map(
      entriesOf(block.fuseTimers).map(([item, pair]): [string, unknown[]] => [item, asItems(pair)]),
    );
    for (const [item, positions] of entriesOf(block.items)) {
      const list = asItems(positions);
      let entry = byId.get(item);
      if (entry == null) {
        entry = { id: item, count: 0, positions: [], fuseRanges: [], unprimed: 0 };
        byId.set(item, entry);
      }
      entry.count += list.length;
      entry.positions.push(...list);
      const timer = timers.get(item);
      if (timer != null && timer.length >= 2) {
        const range: [unknown, unknown] = [timer[0], timer[1]];
        if (!entry.fuseRanges.some(([min, max]) => min === range[0] && max === range[1])) {
          entry.fuseRanges.push(range);
        }
      } else {
        entry.unprimed += list.length;
      }
    }
  }
  return [...byId.values()];
}

/**
 * The terrain's placed items. The coordinates are a file-level detail — the
 * site has no way to draw the terrain they belong to — so they stay behind
 * a toggle and only the names (with amounts) read until someone asks.
 */
function Items({ items }: { items: PlacedItem[] }): ReactNode {
  const [showCoords, setShowCoords] = useState(false);
  return (
    <>
      <ul className="data-nested">
        {items.map((item) => (
          <li key={item.id}>
            <Val of={item.id} /> ×{item.count}
            {item.fuseRanges.length > 0 && (
              <>
                {" · "}
                <Tr text="xpediaFuse" />{" "}
                {item.fuseRanges
                  .map(([min, max]) => `${formatNumber(min)}–${formatNumber(max)}`)
                  .join(", ")}
                {item.unprimed > 0 && (
                  <>
                    {" ("}
                    <Tr text="xpediaNotAllPrimed" />
                    {")"}
                  </>
                )}
              </>
            )}
            {showCoords && (
              <>
                {": "}
                <PositionList value={item.positions} />
              </>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="details-toggle"
        aria-expanded={showCoords}
        onClick={() => setShowCoords(!showCoords)}
      >
        <Tr text={showCoords ? "xpediaHideCoordinates" : "xpediaShowCoordinates"} />
      </button>
    </>
  );
}

/** Randomised-item fields in reading order; anything else follows */
function randomizedFields(item: MapBlock): [string, unknown][] {
  const known = ["position", "amount", "mixed", "itemList", "fuseTimerMin", "fuseTimerMax"];
  const ordered: [string, unknown][] = [];
  for (const field of known) {
    if (field in item && !isEmpty(item[field])) ordered.push([field, item[field]]);
  }
  const unknown = Object.keys(item)
    .filter((field) => !known.includes(field))
    .sort();
  return [...ordered, ...unknown.map((field): [string, unknown] => [field, item[field]])];
}

/** One normalised spawn: where, how many, and what it may become */
function RandomizedItem({ item }: { item: MapBlock }): ReactNode {
  const fields = randomizedFields(item);
  return (
    <>
      {fields.map(([field, value]) => (
        <Fragment key={field}>
          <dl className="data-fields">
            <dt>
              <Val of={field} capital={true} />
            </dt>
            <dd>
              {field === "position" ? (
                <Tuple value={value} />
              ) : field === "itemList" ? (
                <InlineList items={asItems(value)} field={field} />
              ) : (
                <Val of={value} field={field} />
              )}
            </dd>
          </dl>
        </Fragment>
      ))}
    </>
  );
}

/** `randomizedItems`: the spawns this block may roll */
function RandomizedItems({ value }: { value: unknown }): ReactNode {
  const items = asItems(value).filter(
    (item): item is MapBlock => typeof item === "object" && item != null,
  );
  return (
    <ul className="data-nested mapblock-sets">
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a spawn is identified by its position among its siblings
        <li key={i}>
          <RandomizedItem item={item} />
        </li>
      ))}
    </ul>
  );
}

/** One random-spawn group summed over the whole terrain */
type SpawnGroup = {
  list: unknown[];
  copies: number;
  mixed: boolean;
  fuseRanges: [unknown, unknown][];
};

/**
 * Every block's spawns grouped by item list and `mixed`. Each spawn point
 * rolls one pick from its list for each of its `amount` copies — all copies
 * the same item unless `mixed`, when each re-rolls. The two behaviors never
 * share a group: "random items" for a mixed group can be ten different
 * items, for an unmixed one it cannot.
 */
function spawnGroups(blocks: MapBlock[]): SpawnGroup[] {
  const byKey = new Map<string, SpawnGroup>();
  for (const block of blocks) {
    for (const spawn of asItems(block.randomizedItems)) {
      if (typeof spawn !== "object" || spawn == null) continue;
      const group0 = spawn as MapBlock;
      const list = asItems(group0.itemList);
      if (list.length === 0) continue;
      const mixed = group0.mixed === true;
      const key = `${mixed ? "1" : "0"}\0${list.map(String).join("\0")}`;
      let group = byKey.get(key);
      if (group == null) {
        group = { list, copies: 0, mixed: false, fuseRanges: [] };
        byKey.set(key, group);
      }
      group.copies += asNumber(group0.amount) ?? 1;
      group.mixed = mixed;
      const min = asNumber(group0.fuseTimerMin);
      const max = asNumber(group0.fuseTimerMax);
      if (min != null && min > -1 && max != null && max > -1 && min <= max) {
        const range: [unknown, unknown] = [min, max];
        if (!group.fuseRanges.some(([a, b]) => a === min && b === max)) {
          group.fuseRanges.push(range);
        }
      }
    }
  }
  return [...byKey.values()];
}

/** The spawn groups as one list, count first: "10 random items from: A, B" when each copy re-rolls (`mixed`), "10 copies of the one random item from: A, B" when all copies are the same pick */
function SpawnGroups({ groups }: { groups: SpawnGroup[] }): ReactNode {
  return (
    <ul className="data-nested mapblock-sets">
      {groups.map((group, i) => {
        const key = group.mixed
          ? group.copies === 1
            ? "xpediaRandomItemsOne"
            : "xpediaRandomItems"
          : group.copies === 1
            ? "xpediaRandomCopiesOne"
            : "xpediaRandomCopies";
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a spawn group is identified by its position among its siblings
          <li key={i}>
            {group.copies} <Tr text={key} />: <InlineList items={group.list} field="itemList" />
            {group.fuseRanges.length > 0 && (
              <>
                {" · "}
                <Tr text="xpediaFuse" />{" "}
                {group.fuseRanges
                  .map(([min, max]) => `${formatNumber(min)}–${formatNumber(max)}`)
                  .join(", ")}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** `extendedItems`: placed things the engine only knows by their fields */
function ExtendedItems({ value }: { value: unknown }): ReactNode {
  const items = asItems(value).filter(
    (item): item is MapBlock => typeof item === "object" && item != null,
  );
  const order = ["type", "pos", "fuseTimerMin", "fuseTimerMax", "ammoDef"];
  return (
    <ul className="data-nested">
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: an entry is identified by its position among its siblings
        <li key={i}>
          {item.type != null && typeName(item.type)}
          {order.slice(1).map((field) => {
            const fieldValue = item[field];
            if (isEmpty(fieldValue)) return null;
            return (
              <Fragment key={field}>
                {" "}
                <Val of={field} />:{" "}
                {field === "pos" ? (
                  <Tuple value={fieldValue} />
                ) : (
                  <Val of={fieldValue} field={field} />
                )}
              </Fragment>
            );
          })}
        </li>
      ))}
    </ul>
  );
}

/** The rul spelling of a placed thing's type, matched against the file by eye */
function typeName(type: unknown): ReactNode {
  return <code>{String(type)}</code>;
}

/** One field's value as it reads: coordinates as tuples, references linked */
function FieldValue({ field, value }: { field: string; value: unknown }): ReactNode {
  if (field === "randomizedItems") return <RandomizedItems value={value} />;
  if (field === "extendedItems") return <ExtendedItems value={value} />;
  if (field === "craftInventoryTile") return <Tuple value={value} />;
  if (field === "groups" || field === "revealedFloors") {
    return <InlineList items={asItems(value)} field={field} />;
  }
  return <Val of={value} field={field} />;
}

/** `name` is the column the rows are found by */
function blockName(block: MapBlock): string {
  return String(block.name ?? "");
}

/** The per-block remainder — sizes, groups, extended items and the full
 *  spawns with their positions — under one toggle. A reader comparing
 *  against the ruleset text finds each block's whole shape there. */
function FileDetails({ blocks }: { blocks: MapBlock[] }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="details-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Tr text={open ? "xpediaHideFileDetails" : "xpediaShowFileDetails"} />
      </button>
      {open && (
        <ul className="data-nested mapblock-sets">
          {blocks.map((block, i) => {
            const fields = blockFields(block).filter((field) => field !== "items");
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: a block is identified by its position among its siblings, the order the file writes them
                key={i}
              >
                <code>{blockName(block)}</code>
                {fields.length > 0 && (
                  <dl className="data-fields">
                    {fields.map((field) => (
                      <Fragment key={field}>
                        <dt>
                          <Val of={field} capital={true} />
                        </dt>
                        <dd>
                          <FieldValue field={field} value={block[field]} />
                        </dd>
                      </Fragment>
                    ))}
                  </dl>
                )}
                {!isEmpty(block.randomizedItems) && (
                  <RandomizedItems value={block.randomizedItems} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function MapBlocksView({ blocks }: { blocks: unknown }): ReactNode {
  const list = asItems(blocks).filter((item) => item != null);
  if (list.length === 0) return null;
  const cards = list.map((block) =>
    typeof block === "object" && block != null
      ? (block as MapBlock)
      : ({ name: String(block) } as MapBlock),
  );
  const placed = mergedItems(cards);
  const spawns = spawnGroups(cards);
  return (
    <TipScopeProvider scope="mapBlock">
      {placed.length > 0 && (
        <>
          <span className="mapblock-row-label">
            <Val of="items" capital={true} />
          </span>
          <Items items={placed} />
        </>
      )}
      {spawns.length > 0 && (
        <>
          <span className="mapblock-row-label">
            <Val of="randomizedItems" capital={true} />
          </span>
          <SpawnGroups groups={spawns} />
        </>
      )}
      <FileDetails blocks={cards} />
    </TipScopeProvider>
  );
}

/** The `mapBlocks` renderer for `terrains` articles */
export const mapBlocks: MainTableRenderer = ({ val }) => {
  // The toggles inside are state: keyed on the block names, a different
  // terrain remounts the view, so an open file-details on one article does
  // not leak onto the next terrain the reader opens.
  const blocks = asItems(val).filter((item) => item != null);
  const key = blocks
    .map((block) =>
      typeof block === "object" && block != null ? blockName(block as MapBlock) : String(block),
    )
    .join("\0");
  return <MapBlocksView key={key} blocks={val} />;
};
