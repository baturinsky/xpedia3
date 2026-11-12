import MainTable from "./MainTable";
import { Val } from "./Val";

/** Starting conditions table, follows old `StartingConditions.svelte` */
export default function StartingConditionsComponent({
  entry, title = "Starting Conditions", subtitle = ""
}: { entry: any, title?: string, subtitle?: string }) {
  // Old `StartingConditions.svelte` compared against a never-filled copy of the
  // entry, so `forbidden*` was hidden whenever `allowed*` had any entries.
  let exclude: string[] = [];
  for (let k of ["Craft", "SoldierTypes", "Vehicles", "Armors"]) {
    exclude.push((entry[`allowed${k}`]?.length ?? 0) > 0 ? `forbidden${k}` : `allowed${k}`);
  }

  return <MainTable
    of={entry}
    title={title}
    subtitle={subtitle}
    sort={{
      first: ["deployments"],
      exclude,
      last: ["allowedArmors", "forbiddenArmors", "defaultArmor"],
    }}
    wide={["defaultArmor"]}
    special={
      {
        "defaultArmor": (props) => <MainTable of={props.val} />
      }
    }
  />;
}
