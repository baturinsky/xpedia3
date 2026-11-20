import { Fragment, type ReactNode } from "react";
import type { MainTableRenderer } from "./MainTable";
import { formatNumber, TipScopeProvider, Val } from "./Val";

/**
 * The `mapBlocks` of one `terrains` entry, as a table.
 *
 * A block list is a pool, not a program: the engine picks from it by size and
 * group, so the order a pack writes it in means nothing. It is still tabular
 * data — `width` and `length` are on every block, `groups` on a third, and
 * the spawn fields on a few percent — so one row per block with one column
 * per field reads better than a card per block repeating the same labels.
 * The one long list, `randomizedItems`, does not get a column: it spills
 * under its block on a full-width row, so each spawn keeps the table's width.
 * A column nothing states does not appear at all, so a field like `height`
 * that one pack uses and the next does not gets no empty column, and rows
 * keep the order the file writes them in.
 */

type MapBlock = { [field: string]: unknown };

/**
 * Fields in the order they are read, rather than the order the pack happened
 * to write them in. `name` is the first column and never a field column;
 * anything the engine knows about that is not listed here follows in sorted
 * order, so a field added by a future engine still has somewhere to go.
 *
 * `randomizedItems` is the one list this table spills under the block it
 * belongs to, the same way `alienDeployments` puts its `itemSets` on a
 * full-width row: a spawn is a small block of its own (position, amount,
 * what it can roll), and as a column it squeezes every spawn into a few
 * dozen pixels. ExtendedItems stay a column next to it.
 */
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

/** Fields drawn as full-width rows under the block's row, not as columns */
const LIST_ROW_FIELDS = ["randomizedItems"];

/** Whether a field is absent or empty — it has nothing to say */
function isEmpty(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** A scalar or a one-value list, as a list — groups and friends take both */
function asItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * The table's columns: every field stated anywhere, in reading order, apart
 * from the list fields that get a full-width row of their own. A field
 * nothing states is left out — a column of blanks would only repeat that the
 * pack did not use it.
 */
function columnsOf(blocks: MapBlock[]): string[] {
  const seen = new Set<string>();
  for (const block of blocks) {
    for (const field of Object.keys(block)) {
      if (field !== "name" && !isEmpty(block[field]) && !LIST_ROW_FIELDS.includes(field))
        seen.add(field);
    }
  }
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

/** `items`: where each item is placed */
function Items({ value }: { value: unknown }): ReactNode {
  return (
    <ul className="data-nested">
      {entriesOf(value).map(([item, positions]) => (
        <li key={item}>
          <Val of={item} />: <PositionList value={positions} />
        </li>
      ))}
    </ul>
  );
}

/** `fuseTimers`: the fuse range per item, `[min, max]` */
function FuseTimers({ value }: { value: unknown }): ReactNode {
  return (
    <ul className="data-nested">
      {entriesOf(value).map(([item, timer]) => (
        <li key={item}>
          <Val of={item} />: <Tuple value={timer} />
        </li>
      ))}
    </ul>
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
  if (field === "items") return <Items value={value} />;
  if (field === "fuseTimers") return <FuseTimers value={value} />;
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

function MapBlocksView({ blocks }: { blocks: unknown }): ReactNode {
  const list = asItems(blocks).filter((item) => item != null);
  if (list.length === 0) return null;
  const rows = list.map((block) =>
    typeof block === "object" && block != null
      ? (block as MapBlock)
      : ({ name: String(block) } as MapBlock),
  );
  const columns = columnsOf(rows);
  const colCount = 1 + columns.length;
  return (
    <TipScopeProvider scope="mapBlock">
      <table className="main-table data-table">
        <thead>
          <tr>
            <th scope="col">
              <Val of="name" capital={true} />
            </th>
            {columns.map((field) => (
              <th scope="col" key={field}>
                <Val of={field} capital={true} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((block, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a block is identified by its position among its siblings, the order the file writes them
            <Fragment key={i}>
              <tr>
                <th scope="row">
                  <code>{blockName(block)}</code>
                </th>
                {columns.map((field) => (
                  <td key={field}>
                    {isEmpty(block[field]) ? null : (
                      <FieldValue field={field} value={block[field]} />
                    )}
                  </td>
                ))}
              </tr>
              {!isEmpty(block.randomizedItems) && (
                <tr>
                  <td colSpan={colCount}>
                    <span className="mapblock-row-label">
                      <Val of="randomizedItems" capital={true} />
                    </span>
                    <RandomizedItems value={block.randomizedItems} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </TipScopeProvider>
  );
}

/** The `mapBlocks` renderer for `terrains` articles */
export const mapBlocks: MainTableRenderer = ({ val }) => <MapBlocksView blocks={val} />;
