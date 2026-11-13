import { Fragment } from "react";
import {
  BaseServiceList,
} from "./components";
import { sortFirstLast } from "../rul/Ruleset";
import { Entry } from "../rul/Entry";
import { Val } from "./Val";

export const ResearchComponent = ({ entry }: { entry: Entry }) => {
  const longLists = [
    "unlocks",
    "seeAlso",
    "allowsBuying",
    "freeFrom",
    "dependencies",
    "leadsTo",
    "disables",
    "getOneFree",
    "getOneFreeProtected",
    "requiresBaseFunc",
    "manufacture"
  ];

  const sortedEntries = sortFirstLast(entry, { last: longLists, exclude: ["name"] }).all;

  return (
    <table className="main-table research-table" key="research">
      <thead>
        <tr>
          <td colSpan={2}><Val of={"Research"} /></td>
        </tr>
      </thead>
      <tbody>
        {sortedEntries.map(([key, prop]) => {
          // Handle long lists (colspan=2 sections)
          if (longLists.includes(key) && prop && prop.length > 0) {
            return (
              <Fragment key={key}>
                <tr>
                  <td colSpan={2} className="table-subheader">
                    <Val of={key} />
                  </td>
                </tr>
                <tr>
                  <td colSpan={2} className="centered-text">
                    <Val of={prop} />
                  </td>
                </tr>
              </Fragment>
            );
          }

          // Handle requiresBaseFunc (only when the first branch didn't pick it up)
          if (key === "requiresBaseFunc") {
            return (
              <tr key={key}>
                <td colSpan={2} className="centered-text">
                  <BaseServiceList
                    items={prop}
                    vertical={true}
                  />
                </td>
              </tr>
            );
          }

          // Handle getOneFreeProtected (nested object of lists)
          if (key === "getOneFreeProtected") {
            return (
              <Fragment key={key}>
                <tr>
                  <td colSpan={2} className="table-subheader">
                    <Val of={key} />
                  </td>
                </tr>
                {Object.entries(prop).map(([nestedKey, nestedValue]) => (
                  <tr key={nestedKey}>
                    <td><Val of={nestedKey} />:</td>
                    <td><Val of={nestedValue as any} /></td>
                  </tr>
                ))}
              </Fragment>
            );
          }

          // Default case: simple key-value pair
          return (
            <tr key={key}>
              <td><Val of={key} /></td>
              <td><Val of={prop}/></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

export default ResearchComponent;