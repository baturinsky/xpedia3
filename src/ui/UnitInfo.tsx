import { Unit } from "../rul/Entry";
import MainTable from "./MainTable";

export default function UnitInfo({ entry }: { entry: Unit }) {

  return <MainTable
    entry={entry}
    title="Unit"
    sort={{
      first: ["stats", "armor", "canSurrender"],
      last: Object.keys(entry).filter((s) => s.indexOf("ound") != -1),
      exclude: ["type"],
    }}
  />
}