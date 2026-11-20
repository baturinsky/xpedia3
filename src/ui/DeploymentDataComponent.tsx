import { Fragment, type ReactNode } from "react";
import type { MainTableRenderer } from "./MainTable";
import { TipScopeProvider, Val } from "./Val";

/**
 * The `data` of one `alienDeployments` entry, as a table.
 *
 * A `data` list is one row per alien rank: the quantities are on every row,
 * `customUnitType` on a few, and the `itemSets` — the loadouts the rank
 * comes equipped with — are the long part. An indexed nested table hid the
 * rows behind `0`, `1`, … and repeated every field name per row, so one
 * row per rank with one column per field reads the same way the
 * `mapBlocks` table does. `itemSets` is last so it takes the remaining
 * width; a column nothing states does not appear at all.
 */

type DeploymentRow = { [field: string]: unknown };

/**
 * Fields in the order they are read. `alienRank` is the row header and
 * never a field column; `itemSets` is last and takes the remaining width;
 * anything the engine knows about that is not listed here follows in
 * sorted order, just before `itemSets`, so a field added by a future
 * engine still has somewhere to go.
 */
const FIELD_ORDER = [
  "lowQty",
  "medQty",
  "highQty",
  "dQty",
  "extraQty",
  "percentageOutsideUfo",
  "customUnitType",
  "extraRandomItems",
];

/** Whether a field is absent or empty — it has nothing to say */
function isEmpty(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** A scalar or a one-value list, as a list */
function asItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * The table's columns: every field stated anywhere, in reading order, with
 * `itemSets` last. A field nothing states is left out — a column of blanks
 * would only repeat that the pack did not use it.
 */
function columnsOf(rows: DeploymentRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const field of Object.keys(row)) {
      if (field !== "alienRank" && field !== "itemSets" && !isEmpty(row[field])) seen.add(field);
    }
  }
  const rest = [
    ...FIELD_ORDER.filter((field) => seen.has(field)),
    ...[...seen].filter((field) => !FIELD_ORDER.includes(field)).sort(),
  ];
  const hasItemSets = rows.some((row) => !isEmpty(row.itemSets));
  return hasItemSets ? [...rest, "itemSets"] : rest;
}

/** A comma list of item references, linked */
function ItemList({ items }: { items: unknown[] }): ReactNode {
  return (
    <>
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a position in a parallel list identifies the item for the file reader
        <Fragment key={i}>
          {i > 0 && ", "}
          <Val of={item} />
        </Fragment>
      ))}
    </>
  );
}

/** One loadout set: its items as a comma list */
function ItemSet({ value }: { value: unknown }): ReactNode {
  if (Array.isArray(value)) return <ItemList items={value} />;
  return <Val of={value} />;
}

/** `itemSets`/`extraRandomItems`: the loadouts, one per line */
function ItemSets({ value }: { value: unknown }): ReactNode {
  const sets = asItems(value);
  return (
    <ul className="data-nested">
      {sets.map((set, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a loadout is identified by its position among its siblings, the order the file writes them
        <li key={i}>
          <ItemSet value={set} />
        </li>
      ))}
    </ul>
  );
}

/** One field's value as it reads: loadouts nested, references linked */
function FieldValue({ field, value }: { field: string; value: unknown }): ReactNode {
  if (field === "itemSets" || field === "extraRandomItems") return <ItemSets value={value} />;
  return <Val of={value} field={field} />;
}

function DeploymentDataView({ data }: { data: unknown }): ReactNode {
  const list = asItems(data).filter(
    (item): item is DeploymentRow => typeof item === "object" && item != null,
  );
  if (list.length === 0) return null;
  const rows = list;
  const columns = columnsOf(rows);
  return (
    <TipScopeProvider scope="deploymentData">
      <table className="main-table data-table">
        <thead>
          <tr>
            <th scope="col">
              <Val of="alienRank" capital={true} />
            </th>
            {columns.map((field) => (
              <th scope="col" key={field}>
                <Val of={field} capital={true} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a row is identified by its position among its siblings, the order the file writes them
            <tr key={i}>
              <th scope="row">
                <Val of={row.alienRank ?? i} field="alienRank" />
              </th>
              {columns.map((field) => (
                <td key={field}>
                  {isEmpty(row[field]) ? null : <FieldValue field={field} value={row[field]} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TipScopeProvider>
  );
}

/** The `data` renderer for `alienDeployments` articles */
export const deploymentData: MainTableRenderer = ({ val }) => <DeploymentDataView data={val} />;
