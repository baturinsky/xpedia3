import { Fragment, JSX, ReactNode } from "react";
import { Val } from "./Val";
import { sortFirstLast, SortFirstLastOptions } from "../rul/Ruleset";
import { isFlat } from "../util";

export type MainTableRenderer = (props: { key: string, val: any, row: number }) => ReactNode;

interface MainTableProps {
  of: any;
  sort?: SortFirstLastOptions;
  title?: string;
  subtitle?: string;
  /** Fields that use custom renderer for the value only */
  special?: { [field: string]: MainTableRenderer };
  /** Fields that use custom renderer for both the key and rendered value */
  wide?: string[];
}

const MainTable = ({
  of,
  sort = {},
  title,
  subtitle = "",
  special = {},
  wide = []
}: MainTableProps) => {
  if (of == null) {
    return undefined
    //return <div>No entry in main table</div>;
  }

  const sorted = sortFirstLast(of, sort);
  let mainTable = title != undefined;

  const subVal = (v: any) => (v!= null && typeof v == "object" && !isFlat(v)) ? <MainTable of={v} /> : <Val of={v} />

  return (
    <table className={"main-table"}>
      {title != undefined &&
        <thead>
          <tr>
            <td colSpan={2}>
              <Val of={title} /> <Val of={subtitle} />
            </td>
          </tr>
        </thead>
      }
      <tbody>
        {sorted.all.map(([key, val]: [string, any], row) => {
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
              content = subVal(val)
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
                <td>{subVal(val)}</td>
              </tr>
            );
          }

          return null;
        })}
      </tbody>
    </table>
  );
};

export default MainTable;
