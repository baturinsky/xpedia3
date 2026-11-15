import { Fragment, JSX, ReactNode } from "react";
import { Val } from "./Val";
import { rul, sortFirstLast, SortFirstLastOptions } from "../rul/Ruleset";
import { fromAnyRef } from "./components";
import { isFlat } from "../util";

export type MainTableRenderer = (props: { key: string, val: any, row: number }) => ReactNode;

interface MainTableProps {
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
  rows = {}
}: MainTableProps) => {
  if (of == null && pairs == null) {
    return undefined
    //return <div>No entry in main table</div>;
  }

  if (of != null && Object.keys(of).length == 1 && "0" in of) {
    of = of[0];
  }

  const sorted = pairs != null ? { all: pairs } : sortFirstLast(of, sort);

  const subVal = (v: any, field?: string) => {
    // A field may hold a whole ruleset node rather than a plain value, and some
    // of those are references: `refNode` carries the inherited armour
    // definition but must still be drawn as a link to the node it came from.
    // `Val` already does exactly that, so only a node that is not a reference
    // becomes a table of its own.
    let ref = fromAnyRef(v);
    let isRef = typeof v == "object" && ref != null && rul?.article(ref) != null;
    return v != null && typeof v == "object" && !isFlat(v) && !isRef
      ? <MainTable of={v} />
      : <Val of={v} field={field} collection={of?.collection} />;
  }

  return (
    <table className={"main-table"}>
      {(title != undefined || header != null) &&
        <thead>
          <tr>
            <td colSpan={2}>
              {header ?? <><Val of={title} />{subtitle && <> <Val of={subtitle} /></>}</>}
            </td>
          </tr>
        </thead>
      }
      <tbody>
        {before}
        {sorted.all.map(([key, val]: [string, any], row) => {
          // A field that draws its own rows, subheader included. Checked first
          // so a caller can name an internal row such as `_details`.
          if (key in rows) {
            let render = rows[key];
            if (typeof render !== "function") {
              console.error(`Row renderer for '${key}' is not a function`)
              return null;
            }
            return <Fragment key={key}>{render({ key, val, row })}</Fragment>;
          }

          // Skip keys starting with underscore
          if (key.charAt(0) === "_") {
            return null;
          }

          // Wide field - the renderer returns its own table rows, like the
          // `wide` slot of old `MainTable.svelte`. Checked before `special`
          // because a wide field looks its renderer up in the same map.
          if (wide.includes(key)) {
            let render = special[key];
            let content: JSX.Element;
            if (typeof render !== "function") {
              content = subVal(val, key)
            } else {
              content = <Fragment key={key}>{render({ key, val, row })}</Fragment>;
            }
            return <Fragment key={key}>
              <tr><td colSpan={2} className="table-subheader"><Val of={key} /></td></tr>
              <tr><td colSpan={2}>{content}</td></tr>
            </Fragment>
          }

          // Special field - custom renderer for the value only
          if (key in special) {
            let render = special[key];
            if (typeof render !== "function") {
              console.error(`Special table function for '${key}' is not a function`)
              return null;
            }
            return <tr key={key}>
              <td className="row-name"><Val of={key} capital={true} /></td>
              <td>{render({ key, val, row })}</td>
            </tr>
          }

          // Default fields - only render if prop has value
          if (val != null && !(val.length === 0)) {
            return (
              <tr key={key}>
                <td className="row-name"><Val of={key} capital={true} /></td>
                <td>{subVal(val, key)}</td>
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
