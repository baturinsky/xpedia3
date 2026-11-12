import { asSubTable } from "./ArticleComponent";
import MainTable from "./MainTable";
import { Val } from "./Val";

/** Manufacture table, follows old `Manufacture.svelte` */
export default function ManufactureComponent({ entry }: { entry: any }) {
  // The wide row from old `MainTable.svelte`: a subheader plus the chance table
  let randomProducedItems = ({ val }: { val: any }) => val ? <>
    <table className="number-table" style={{ width: "100%", margin: 0 }}>
      <tbody>
        {entry.randomProducedItems.map((chance: [number, any], i: number) =>
          <tr key={i}>
            <td>{((chance[0] / entry.chanceSum) * 100).toFixed(2)}%</td>
            <td>
              {Object.keys(chance[1]).length == 0
                ? <Val of="NOTHING" />
                : <Val of={chance[1]} />}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </> : null;

  return <MainTable
    of={entry}
    title="Manufacture"
    sort={{ exclude: ["chanceSum", "totalProducedItems"] }}
    wide={entry.randomProducedItems ? ["randomProducedItems"] : []}
    special={{ 
      randomProducedItems,
      spawnedSoldier: asSubTable
    }}
  />;
}
