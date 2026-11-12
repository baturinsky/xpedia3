import { Unit } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import ArmorComponent from "./ArmorComponent";
import MainTable from "./MainTable";

export default function UnitComponent({ entry }: { entry: Unit }) {

  return <>
    <MainTable
      key={entry.id}
      of={entry}
      title="Unit"
      sort={{
        first: ["stats", "armor", "canSurrender"],
        last: Object.keys(entry).filter((s) => s.indexOf("ound") != -1),
        exclude: ["type"],
      }}
    />
    {entry.armor && rul.armors[entry.armor] && <ArmorComponent entry={rul.armors[entry.armor]} />}
  </>
}
