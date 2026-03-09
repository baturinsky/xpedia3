import { Val } from "./Val";
import { sortFirstLast, SortFirstLastOptions, rul } from "../rul/Ruleset";
import { Children, cloneElement, isValidElement, useMemo } from "react";

interface MainTableProps {
  entry: any;
  sort?: SortFirstLastOptions;
  title: string;
  subtitle?: string;
  /** Fields that use custom renderer for the value */
  special?: string[];
  /** Fields that use custom renderer for both the key and rendered value */
  wide?: string[];
  children?
}

const MainTable: React.FC<MainTableProps> = ({ 
  entry, 
  sort = {}, 
  title, 
  subtitle = "", 
  special = [], 
  wide = [],
  children = null 
}) => {
  const sorted = useMemo(() => {
    return sortFirstLast(entry, sort);
  }, [entry, sort]);

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
        {sorted.all.map(([key, prop]: [string, any]) => {
          // Skip keys starting with underscore
          if (key.charAt(0) === "_") {
            return null;
          }

          /*
          // Special fields - custom renderer for value via children
          if (special.includes(key)) {
            return (
              <tr key={key}>
                <td><Value val={key} capital={true} /></td>
                <td>
                  {Children.map(children, child => {
                    if (isValidElement(child)) {
                      return cloneElement(child, { key, prop });
                    }
                    return child;
                  })}
                </td>
              </tr>
            );
          }

          // Wide fields - custom renderer for entire row via named slot
          if (wide.includes(key)) {
            const wideSlot = Children.toArray(children).find(
              child => isValidElement(child) && child.props.slot === "wide"
            );
            return wideSlot || null;
          }*/

          // Default fields - only render if prop has value
          if (prop != null && !(prop.length === 0)) {
            return (
              <tr key={key}>
                <td><Val of={key} /></td>
                <td><Val of={prop} key={key} /></td>
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