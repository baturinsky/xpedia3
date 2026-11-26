import type { StartingConditions } from "../rul/Entry";
import MainTable from "./MainTable";

/** Starting conditions table, follows old `StartingConditions.svelte` */
export default function StartingConditionsComponent({
  entry,
  title = "Starting Conditions",
  subtitle = "",
}: {
  entry: StartingConditions;
  title?: string;
  subtitle?: string;
}) {
  // Old `StartingConditions.svelte` compared against a never-filled copy of the
  // entry, so `forbidden*` was hidden whenever `allowed*` had any entries.
  // The same mutual exclusion holds for item categories: a starting condition
  // states one side or the other, never both.
  const exclude: string[] = [];
  for (const k of ["Craft", "SoldierTypes", "Vehicles", "ItemCategories", "Armors"]) {
    exclude.push(
      ((entry[`allowed${k}`] as string[] | undefined)?.length ?? 0) > 0
        ? `forbidden${k}`
        : `allowed${k}`,
    );
  }

  return (
    <MainTable
      of={entry}
      title={title}
      subtitle={subtitle}
      sort={{
        // The allowed/forbidden pairs as five groups in a fixed order, so a
        // reader meets the one stated side of each topic next to the others
        // rather than finding it by alphabetical accident
        first: [
          "deployments",
          "allowedCraft",
          "forbiddenCraft",
          "allowedSoldierTypes",
          "forbiddenSoldierTypes",
          "allowedVehicles",
          "forbiddenVehicles",
          "allowedItemCategories",
          "forbiddenItemCategories",
          "allowedArmors",
          "forbiddenArmors",
        ],
        exclude,
        last: ["defaultArmor"],
      }}
      wide={["defaultArmor"]}
      special={{
        defaultArmor: (props) => <MainTable of={props.val} />,
      }}
    />
  );
}
