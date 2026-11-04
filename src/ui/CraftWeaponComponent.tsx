import React from "react";
import { CraftWeapon } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import ItemComponent from "./ItemComponent";
import { Val } from "./Val";

const CraftWeaponComponent = ({ entry }: { entry: CraftWeapon }) => {
  const filteredEntries = Object.entries(entry)
    .filter(([key]) => !["type"].includes(key))
    .sort((a, b) => (a[0] > b[0] ? 1 : -1));


  return (
    <React.Fragment key={entry.id}>
      <table className="main-table craft-weapon-table">
        <thead>
          <tr className="table-header">
            <td colSpan={2}>Weapon</td>
          </tr>
        </thead>
        <tbody>
          {filteredEntries.map(([key, value]) => (
            <tr key={key}>
              <td className="padding-right">
                <Val of={key} />
              </td>
              <td>
                <Val of={value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entry.launcher && (
        <ItemComponent
          entry={rul.items[entry.launcher]}
          title={`Launcher: ${rul.tr(entry.launcher)}`}
        />
      )}
    </React.Fragment>
  );
};

export default CraftWeaponComponent;