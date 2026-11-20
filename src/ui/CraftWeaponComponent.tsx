import type { CraftWeapon } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import ItemComponent from "./ItemComponent";
import MainTable from "./MainTable";

/** Craft weapon table, follows old `CraftWeapon.svelte` */
const CraftWeaponComponent = ({ entry }: { entry: CraftWeapon }) => (
  <>
    <MainTable of={entry} title="Weapon" sort={{ exclude: ["type"] }} />
    {entry.launcher && <ItemComponent entry={rul.items[entry.launcher]} />}
  </>
);

export default CraftWeaponComponent;
