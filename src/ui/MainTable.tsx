import { ReactNode } from "react";
import { Val } from "./Val";
import { sortFirstLast, SortFirstLastOptions } from "../rul/Ruleset";

export type MainTableRenderer = (props: { key: string, val: any, row: number }) => ReactNode;

interface MainTableProps {
  entry: any;
  sort?: SortFirstLastOptions;
  title: string;
  subtitle?: string;
  /** Fields that use custom renderer for the value only */
  special?: { [field: string]: MainTableRenderer };
  /** Fields that use custom renderer for both the key and rendered value */
  wide?: string[];
}

const MainTable = ({
  entry,
  sort = {},
  title,
  subtitle = "",
  special = {},
  wide = [],
}: MainTableProps) => {
  if (entry == null) {
    return <div>No entry in main table</div>;
  }

  const sorted = sortFirstLast(entry, sort);

  return (
    <table className="main-table">
      <thead>
        <tr>
          <td colSpan={2}>
            <Val of={title} /> <Val of={subtitle} />
          </td>
        </tr>
      </thead>
      <tbody>
        {sorted.all.map(([key, val]: [string, any], row) => {
          // Skip keys starting with underscore
          if (key.charAt(0) === "_") {
            return null;
          }

          // Special field - custom renderer for the value only
          if (key in special) {
            let render = special[key];
            if (typeof render !== "function") {
              console.error(`Special table function for '${key}' is not a function`)
              return null;
            }
            return <tr key={key}>
              <td><Val of={key} capital={true} /></td>
              <td>{render({ key, val, row })}</td>
            </tr>
          }

          // Wide field - rendered on its own full-width row
          if (wide.includes(key)) {
            let render = special[key];
            return <tr key={key}>
              <td colSpan={2}>{typeof render === "function" ? render({ key, val, row }) : <Val of={val} field={key} />}</td>
            </tr>
          }

          // Default fields - only render if prop has value
          if (val != null && !(val.length === 0)) {
            return (
              <tr key={key}>
                <td><Val of={key} capital={true} /></td>
                <td><Val of={val} field={key} /></td>
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
