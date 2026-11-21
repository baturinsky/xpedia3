import type { Manufacture } from "../rul/Entry";
import MainTable, { asSubTable, type MainTableRenderer } from "./MainTable";
import { Val } from "./Val";

/** Manufacture table, follows old `Manufacture.svelte` */
export default function ManufactureComponent({ entry }: { entry: Manufacture }) {
  // The wide row from old `MainTable.svelte`: a subheader plus the chance table
  const randomProducedItems: MainTableRenderer = ({ val }) =>
    val ? (
      <table className="number-table" style={{ width: "100%", margin: 0 }}>
        <tbody>
          {entry.randomProducedItems?.map((chance, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a pack may list the same chance once, then again to double its weight; the index keeps those entries distinct and the list never reorders
            <tr key={`${i}-${JSON.stringify(chance)}`}>
              <td>{((chance[0] / (entry.chanceSum ?? 0)) * 100).toFixed(2)}%</td>
              <td>
                {Object.keys(chance[1]).length === 0 ? (
                  <Val of="NOTHING" />
                ) : (
                  <Val of={chance[1]} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : null;

  return (
    <MainTable
      of={entry}
      title="Manufacture"
      sort={{ exclude: ["chanceSum", "totalProducedItems"] }}
      wide={entry.randomProducedItems ? ["randomProducedItems"] : []}
      special={{
        randomProducedItems,
        spawnedSoldier: asSubTable,
      }}
    />
  );
}
