import { rul } from "../rul/Ruleset";
import MainTable from "./MainTable";
import { Val } from "./Val";

/** Craft table, follows old `Craft.svelte` */
export default function CraftComponent({ entry }: { entry: any }) {
  return <MainTable
    entry={entry}
    title="Craft"
    sort={{
      first: ["speedMax", "soldiers"],
      exclude: ["type", "battlescapeTerrainData", "craftInventoryTile", "deployment"]
    }}
    special={{
      weaponStrings: ({ val }) =>
        <Val of={val.map((slot: string) => rul.tr(slot)?.replace(">{ALT}{0}", "") ?? "")} />,
      sprite: ({ val }) => <>
        <Val obs="base" of={33 + val} />
        <Val obs="icon" of={val + 11} />
        <Val obs="icon" of={val} />
      </>,
    }}
  />;
}
