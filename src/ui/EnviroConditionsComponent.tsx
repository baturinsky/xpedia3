import type { ReactNode } from "react";
import type { MainTableRenderer } from "./MainTable";
import { TipScopeProvider, Val } from "./Val";
import { isEmpty } from "./value";

/**
 * The `environmentalConditions` of one `enviroEffects` entry, as a table.
 *
 * The conditions are keyed by faction (`STR_FRIENDLY`, `STR_HOSTILE`,
 * `STR_NEUTRAL`), one condition per faction, but there are eight field
 * columns and never more than a few factions. One row per faction made a
 * nine-column table that could not fit a narrow screen, so the table is
 * transposed: one row per field, one column per faction. The width now
 * follows the factions (1–3) instead of the fields, and each field reads
 * as a labelled row, the same way the outer table reads.
 */

type Condition = { [field: string]: unknown };

/**
 * Fields in the order they are read: the numbers first, the references
 * last, the `message` text very last. Anything the engine knows about that
 * is not listed here follows in sorted order, just before `message`, so a
 * field added by a future engine still has somewhere to go.
 */
const FIELD_ORDER = [
  "globalChance",
  "chancePerTurn",
  "firstTurn",
  "lastTurn",
  "color",
  "side",
  "bodyPart",
  "weaponOrAmmo",
  "message",
];

/**
 * The table's rows: every field stated anywhere, in reading order. A field
 * nothing states is left out — a row of blanks would only repeat that the
 * pack did not use it.
 */
function rowsOf(conditions: Condition[]): string[] {
  const seen = new Set<string>();
  for (const condition of conditions) {
    for (const field of Object.keys(condition)) {
      if (!isEmpty(condition[field])) seen.add(field);
    }
  }
  const known = FIELD_ORDER.filter((field) => seen.has(field) && field !== "message");
  const unknown = [...seen].filter((field) => !FIELD_ORDER.includes(field)).sort();
  return seen.has("message") ? [...known, ...unknown, "message"] : [...known, ...unknown];
}

function EnviroConditionsView({ conditions }: { conditions: unknown }): ReactNode {
  if (conditions == null || typeof conditions !== "object") return <Val of={conditions} />;
  const entries = Object.entries(conditions as { [faction: string]: unknown }).filter(
    ([, value]) => value != null,
  );
  if (entries.length === 0) return null;
  const rows = entries.map(([, value]) =>
    typeof value === "object" ? (value as Condition) : ({ value } as Condition),
  );
  const fields = rowsOf(rows);
  return (
    <TipScopeProvider scope="environmentalCondition">
      <table className="main-table data-table">
        <thead>
          <tr>
            <th scope="col" />
            {entries.map(([faction]) => (
              <th scope="col" key={faction}>
                <Val of={faction} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field}>
              <th scope="row">
                <Val of={field} capital={true} />
              </th>
              {entries.map(([faction, value]) => {
                const condition =
                  typeof value === "object" && value != null
                    ? (value as Condition)
                    : ({} as Condition);
                return (
                  <td key={faction}>
                    {isEmpty(condition[field]) ? "—" : <Val of={condition[field]} field={field} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </TipScopeProvider>
  );
}

/** The `environmentalConditions` renderer for `enviroEffects` articles */
export const environmentalConditions: MainTableRenderer = ({ val }) => (
  <EnviroConditionsView conditions={val} />
);
