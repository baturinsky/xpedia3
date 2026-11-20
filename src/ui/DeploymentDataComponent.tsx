import { Fragment, type ReactNode } from "react";
import type { MainTableRenderer } from "./MainTable";
import { TipScopeProvider, Val } from "./Val";

/**
 * The `data` of one `alienDeployments` entry, as a table.
 *
 * One row per alien rank for the numbers — rank, a combined quantity, and
 * the outside share — and one full-width row underneath it per list field
 * (`itemSets`, `extraRandomItems`): the loadouts are the long part, and
 * giving them the whole table width keeps each set to a line or two instead
 * of squeezing them into the last column behind five header-width numeric
 * columns. A field nothing states gets no column, and a list field a row
 * does not state gets no row. `customUnitType` is a single unit, so it
 * stays a column like any other scalar field.
 *
 * The quantity is one cell: the base count by difficulty (`lowQty..medQty..
 * highQty`, equal neighbours collapsed, a missing `medQty` skipped) plus
 * each random bonus that is stated and nonzero as `+🎲0–N` — `dQty` and
 * `extraQty` are independent rolls of 0..N on top of the base, see
 * `BattlescapeGenerator`. Anything the engine knows about that is none of
 * the above follows as a plain column, so a future field still has
 * somewhere to go.
 */

type DeploymentRow = { [field: string]: unknown };

/** The quantity fields the combined cell is built from, easy to hard */
const QUANTITY_FIELDS = ["lowQty", "medQty", "highQty", "dQty", "extraQty"];

/** Fields drawn as full-width rows under the rank row, not as columns */
const LIST_ROW_FIELDS = ["itemSets", "extraRandomItems"];

/** Whether a field is absent or empty — it has nothing to say */
function isEmpty(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** A scalar or a one-value list, as a list */
function asItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** A stated number, or nothing when the value is absent or not numeric */
function asNumber(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The table's shape: whether the combined quantity and the outside share
 * earn a column, and which other scalar fields do, `customUnitType` first.
 * A field nothing states is left out — a column of blanks would only repeat
 * that the pack did not use it.
 */
function layoutOf(rows: DeploymentRow[]): {
  hasQuantity: boolean;
  hasOutside: boolean;
  otherColumns: string[];
} {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const field of Object.keys(row)) {
      if (
        field !== "alienRank" &&
        field !== "percentageOutsideUfo" &&
        !QUANTITY_FIELDS.includes(field) &&
        !LIST_ROW_FIELDS.includes(field) &&
        !isEmpty(row[field])
      )
        seen.add(field);
    }
  }
  const rest = [...seen].filter((field) => field !== "customUnitType").sort();
  return {
    hasQuantity: rows.some((row) => QUANTITY_FIELDS.some((field) => !isEmpty(row[field]))),
    hasOutside: rows.some((row) => !isEmpty(row.percentageOutsideUfo)),
    otherColumns: seen.has("customUnitType") ? ["customUnitType", ...rest] : rest,
  };
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
    <ul className="data-nested deployment-sets">
      {sets.map((set, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a loadout is identified by its position among its siblings, the order the file writes them
        <li key={i}>
          <ItemSet value={set} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The combined quantity: the base count by difficulty with equal neighbours
 * collapsed (`1..2`, a lone `3` when easy and hard agree — a flat count
 * carries no difficulty icon, since it holds at every difficulty), each
 * stated value marked with its difficulty icon (🟢 easy, 🟡 medium,
 * 🔴 hard) carrying that field's tooltip, then each random bonus that is
 * stated and nonzero as `+🎲0–N` with the die's own tooltip. A missing or
 * zero block takes its punctuation with it, so nothing dangles. `medQty` of
 * 0 counts as missing, the way the engine reads it.
 */
function QuantityCell({ row }: { row: DeploymentRow }): ReactNode {
  const stated: { n: number; icon: string; tip: string }[] = [];
  const low = asNumber(row.lowQty);
  if (low != null) stated.push({ n: low, icon: "🟢", tip: "tip_lowQty" });
  const med = asNumber(row.medQty);
  if (med != null && med > 0) stated.push({ n: med, icon: "🟡", tip: "tip_medQty" });
  const high = asNumber(row.highQty);
  if (high != null) stated.push({ n: high, icon: "🔴", tip: "tip_highQty" });
  // Equal neighbours collapse to one number, keeping the last mark of the
  // run (the hardest difficulty the value holds at); a count stated at every
  // difficulty collapses to a single unmarked number.
  const groups: { n: number; icon: string; tip: string }[] = [];
  for (const entry of stated) {
    const last = groups[groups.length - 1];
    if (last && last.n === entry.n) Object.assign(last, entry);
    else groups.push({ ...entry });
  }
  const flat = stated.length > 1 && groups.length === 1;
  const dice: { n: number; tip: string }[] = [];
  const dQty = asNumber(row.dQty);
  if (dQty != null && dQty > 0) dice.push({ n: dQty, tip: "tip_dQty" });
  const extraQty = asNumber(row.extraQty);
  if (extraQty != null && extraQty > 0) dice.push({ n: extraQty, tip: "tip_extraQty" });
  return (
    <span className="deployment-qty">
      {groups.length > 0 && (
        <em className="num">
          {groups.map((group, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a position in the difficulty order identifies the value for the file reader
            <Fragment key={i}>
              {i > 0 && ".."}
              {!flat && <span data-tooltip={group.tip}>{group.icon}</span>}
              {group.n}
            </Fragment>
          ))}
        </em>
      )}
      {dice.map((die, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: dQty comes before extraQty, the order the file writes them
        <Fragment key={i}>
          {" "}
          <span data-tooltip={die.tip}>
            <em className="num">🎲0–{die.n}</em>
          </span>
        </Fragment>
      ))}
    </span>
  );
}

function DeploymentDataView({ data }: { data: unknown }): ReactNode {
  const list = asItems(data).filter(
    (item): item is DeploymentRow => typeof item === "object" && item != null,
  );
  if (list.length === 0) return null;
  const rows = list;
  const { hasQuantity, hasOutside, otherColumns } = layoutOf(rows);
  const colCount = 1 + (hasQuantity ? 1 : 0) + (hasOutside ? 1 : 0) + otherColumns.length;
  return (
    <TipScopeProvider scope="deploymentData">
      <table className="main-table data-table">
        <thead>
          <tr>
            <th scope="col">
              <Val of="xpediaDeploymentRank" />
            </th>
            {hasQuantity && (
              <th scope="col">
                <Val of="xpediaDeploymentQuantity" />
              </th>
            )}
            {hasOutside && (
              <th scope="col">
                <Val of="xpediaDeploymentOutside" />
              </th>
            )}
            {otherColumns.map((field) => (
              <th scope="col" key={field}>
                <Val of={field} capital={true} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a row is identified by its position among its siblings, the order the file writes them
            <Fragment key={i}>
              <tr>
                <th scope="row">
                  <Val of={row.alienRank ?? i} field="alienRank" />
                </th>
                {hasQuantity && (
                  <td className="deployment-qty-cell">
                    <QuantityCell row={row} />
                  </td>
                )}
                {hasOutside && (
                  <td>
                    {isEmpty(row.percentageOutsideUfo) ? null : (
                      <em className="num">{String(row.percentageOutsideUfo)}%</em>
                    )}
                  </td>
                )}
                {otherColumns.map((field) => (
                  <td key={field}>
                    {isEmpty(row[field]) ? null : <Val of={row[field]} field={field} />}
                  </td>
                ))}
              </tr>
              {!isEmpty(row.itemSets) && (
                <tr>
                  <td colSpan={colCount}>
                    <ItemSets value={row.itemSets} />
                  </td>
                </tr>
              )}
              {!isEmpty(row.extraRandomItems) && (
                <tr>
                  <td colSpan={colCount}>
                    <span className="deployment-row-label">
                      <Val of="extraRandomItems" />
                    </span>
                    <ItemSets value={row.extraRandomItems} />
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

/** The `data` renderer for `alienDeployments` articles */
export const deploymentData: MainTableRenderer = ({ val }) => <DeploymentDataView data={val} />;
