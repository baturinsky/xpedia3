import { Val } from "./Val";
import { sortFirstLast, SortFirstLastOptions } from "../rul/Ruleset";

interface MainTableProps {
  entry: any;
  sort?: SortFirstLastOptions;
  title: string;
  subtitle?: string;
  /** Fields that use custom renderer for the value */
  special?: any;
  /** Fields that use custom renderer for both the key and rendered value */
  wide?: string[];
  styles?: { [field: string]: string }
  children?: any
}

const MainTable = ({
  entry,
  sort = {},
  title,
  subtitle = "",
  special = [] as any,
  wide = [],
  styles = {},
  children = null
}: MainTableProps) => {
  const sorted =  sortFirstLast(entry, sort);

  if (entry == null) {
    return <div>No entry in main table</div>;
  }

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

          if (key in special) {
            if (!(special[key] instanceof Function)) {
              console.error(`Special table function for '${key}' is not a function`)
              return
            }
            return <tr key={key}>
              <td><Val of={key} /></td>
              <td>{special[key]({ key, val, row })}</td>
            </tr>
          }

          // Wide fields - custom renderer for entire row via named slot
          if (key in wide) {
            return <tr key={key}>
              <td colSpan={2}>{special[key]({ key, val, row })}</td>
            </tr>
          }

          // Default fields - only render if prop has value
          if (val != null && !(val.length === 0)) {
            return (
              <tr key={key}>
                <td><Val of={key} /></td>
                <td><Val of={val} key={key} /></td>
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