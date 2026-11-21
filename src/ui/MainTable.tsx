import { Fragment, type JSX, type ReactNode } from "react";
import { rul, type SortFirstLastOptions, sortFirstLast } from "../rul/Ruleset";
import { isFlat } from "../util";
import { type AnyRef, fromAnyRef } from "./components";
import { TipScopeProvider, Val } from "./Val";
import { isEmpty } from "./value";

/**
 * Draws one row of a `MainTable`.
 *
 * `val` is whatever the ruleset put under that key: a number, a list of ids, or
 * a whole nested node. A renderer is picked by field name, so it is matched to
 * the value at runtime and cannot be typed by it. `field` and `collection` ride
 * along so a custom renderer can pass them to `Val` the way the default row
 * does — tooltips and sound handling key off them.
 */
export type MainTableRenderer = (props: {
  key: string;
  val: unknown;
  row: number;
  field?: string;
  collection?: string;
}) => ReactNode;

/**
 * A nested node as its own table, or nothing when it states nothing.
 *
 * The conditional is the point: an empty `briefing` or weights block is no
 * table at all, not an empty boxed one. `MainTable` itself draws nothing for
 * an absent node, and this does the same for an empty object.
 */
export const asSubTable: MainTableRenderer = ({ val }) => {
  if (isEmpty(val)) return null;
  if (typeof val === "object" && Object.keys(val as object).length === 0) return null;
  return <MainTable of={val} />;
};

interface MainTableProps {
  /** The node to draw a row per field of; `Entry`, or a plain ruleset node */
  of?: unknown;
  /** Pre-ordered `[key, value]` rows, rendered instead of sorting `of`. Used
   *  when a caller inserts rows of its own between the fields. */
  pairs?: [string, unknown][];
  sort?: SortFirstLastOptions;
  title?: string;
  subtitle?: string;
  /** Replaces the default title text, for a header built from several parts */
  header?: ReactNode;
  /** Rows drawn before any field, such as a picture or a nested table */
  before?: ReactNode;
  /** Rows drawn after every field */
  after?: ReactNode;
  /** Fields that use custom renderer for the value only */
  special?: { [field: string]: MainTableRenderer };
  /** Fields drawn as a subheader with the whole block under it. The renderer
   *  returns the block's content; the subheader is the table's. This is the
   *  canonical path for "subheader + block" — `rows` hand-rolling the same
   *  markup is reserved for fields that draw several rows of their own, or
   *  that must suppress the subheader when the value is empty. */
  wide?: string[];
  /** Fields that render every row they need, subheader included. Use only
   *  when `wide` cannot: several rows, or no subheader for an empty value. */
  rows?: { [field: string]: MainTableRenderer };
}

const MainTable = ({
  of,
  pairs,
  sort = {},
  title,
  subtitle = "",
  header,
  before,
  after,
  special = {},
  wide = [],
  rows = {},
}: MainTableProps) => {
  if (of == null && pairs == null) {
    return undefined;
    //return <div>No entry in main table</div>;
  }

  if (of != null && typeof of === "object" && Object.keys(of).length === 1 && "0" in of) {
    of = (of as { [key: string]: unknown })[0];
  }

  const sorted = pairs != null ? { all: pairs } : sortFirstLast(of as object, sort);

  // The entry's collection names the scope: nested plain nodes have no
  // collection of their own and keep this one (the provider passes through
  // when it is given none), while a special renderer may replace it with
  // the kind of object it draws.
  const scope = (of as { collection?: string } | undefined)?.collection;

  const subVal = (key: string | undefined, value: unknown) => {
    // A field may hold a whole ruleset node rather than a plain value, and some
    // of those are references: `refNode` carries the inherited armour
    // definition but must still be drawn as a link to the node it came from.
    // `Val` already does exactly that, so only a node that is not a reference
    // becomes a table of its own.
    const ref = fromAnyRef(value as AnyRef);
    const isRef = typeof value === "object" && ref != null && rul?.article(ref) != null;
    return value != null && typeof value === "object" && !isFlat(value) && !isRef ? (
      <MainTable of={value} />
    ) : (
      <Val
        of={value}
        field={key}
        collection={(of as { collection?: string } | undefined)?.collection}
      />
    );
  };

  return (
    <TipScopeProvider scope={scope}>
      <table className={"main-table"}>
        {(title !== undefined || header != null) && (
          <thead>
            <tr>
              <td colSpan={2}>
                {header ?? (
                  <>
                    <Val of={title} />
                    {subtitle && (
                      <>
                        {" "}
                        <Val of={subtitle} />
                      </>
                    )}
                  </>
                )}
              </td>
            </tr>
          </thead>
        )}
        <tbody>
          {before}
          {sorted.all.map(([key, value]: [string, unknown], row) => {
            const extra = { key, val: value, row, field: key, collection: scope };
            // A field that draws its own rows, subheader included. Checked first
            // so a caller can name an internal row such as `_details`.
            if (key in rows) {
              const render = rows[key];
              if (typeof render !== "function") {
                console.error(`Row renderer for '${key}' is not a function`);
                return null;
              }
              return <Fragment key={key}>{render(extra)}</Fragment>;
            }

            // Skip keys starting with underscore
            if (key.charAt(0) === "_") {
              return null;
            }

            // Wide field - the renderer returns its own table rows, like the
            // `wide` slot of old `MainTable.svelte`. Checked before `special`
            // because a wide field looks its renderer up in the same map.
            if (wide.includes(key)) {
              const render = special[key];
              let content: JSX.Element;
              if (typeof render !== "function") {
                content = subVal(key, value);
              } else {
                content = <Fragment key={key}>{render(extra)}</Fragment>;
              }
              return (
                <Fragment key={key}>
                  <tr>
                    <td colSpan={2} className="table-subheader">
                      <Val of={key} />
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={2}>{content}</td>
                  </tr>
                </Fragment>
              );
            }

            // Special field - custom renderer for the value only
            if (key in special) {
              const render = special[key];
              if (typeof render !== "function") {
                console.error(`Special table function for '${key}' is not a function`);
                return null;
              }
              return (
                <tr key={key}>
                  <td className="row-name">
                    <Val of={key} capital={true} />
                  </td>
                  <td>{render(extra)}</td>
                </tr>
              );
            }

            // Default fields - only render if prop has value
            if (!isEmpty(value)) {
              return (
                <tr key={key}>
                  <td className="row-name">
                    <Val of={key} capital={true} />
                  </td>
                  <td>{subVal(key, value)}</td>
                </tr>
              );
            }

            return null;
          })}
          {after}
        </tbody>
      </table>
    </TipScopeProvider>
  );
};

export default MainTable;
