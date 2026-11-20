import { Fragment, type JSX, type ReactNode } from "react";
import { rul, type SortFirstLastOptions, sortFirstLast } from "../rul/Ruleset";
import { isFlat } from "../util";
import { fromAnyRef } from "./components";
import { Val } from "./Val";

/**
 * Draws one row of a `MainTable`.
 *
 * `val` is whatever the ruleset put under that key: a number, a list of ids, or
 * a whole nested node. A renderer is picked by field name, so it is matched to
 * the value at runtime and cannot be typed by it.
 */
export type MainTableRenderer = (props: { key: string; val: any; row: number }) => ReactNode;

interface MainTableProps {
  /** The node to draw a row per field of; `Entry`, or a plain ruleset node */
  of?: any;
  /** Pre-ordered `[key, value]` rows, rendered instead of sorting `of`. Used
   *  when a caller inserts rows of its own between the fields. */
  pairs?: [string, any][];
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
  /** Fields that use custom renderer for both the key and rendered value */
  wide?: string[];
  /** Fields that render every row they need, subheader included */
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

  if (of != null && Object.keys(of).length === 1 && "0" in of) {
    of = of[0];
  }

  const sorted = pairs != null ? { all: pairs } : sortFirstLast(of, sort);

  const subVal = (key: string | undefined, value: any) => {
    // A field may hold a whole ruleset node rather than a plain value, and some
    // of those are references: `refNode` carries the inherited armour
    // definition but must still be drawn as a link to the node it came from.
    // `Val` already does exactly that, so only a node that is not a reference
    // becomes a table of its own.
    const ref = fromAnyRef(value);
    const isRef = typeof value === "object" && ref != null && rul?.article(ref) != null;
    return value != null && typeof value === "object" && !isFlat(value) && !isRef ? (
      <MainTable of={value} />
    ) : (
      <Val of={value} field={key} collection={of?.collection} />
    );
  };

  return (
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
        {sorted.all.map(([key, value]: [string, any], row) => {
          // A field that draws its own rows, subheader included. Checked first
          // so a caller can name an internal row such as `_details`.
          if (key in rows) {
            const render = rows[key];
            if (typeof render !== "function") {
              console.error(`Row renderer for '${key}' is not a function`);
              return null;
            }
            return <Fragment key={key}>{render({ key, val: value, row })}</Fragment>;
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
              content = <Fragment key={key}>{render({ key, val: value, row })}</Fragment>;
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
                <td>{render({ key, val: value, row })}</td>
              </tr>
            );
          }

          // Default fields - only render if prop has value
          if (value != null && !(value.length === 0)) {
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
  );
};

export default MainTable;
