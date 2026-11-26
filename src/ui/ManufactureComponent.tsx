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
      // The recipe first — what it costs, what it needs, what you get — before
      // the alphabetical run of derived numbers (profit, sizeChange, ...).
      // `spawnedSoldier` is `wide` so it gets the same subheader as
      // `randomProducedItems` rather than a bare nested table in a value cell.
      sort={{
        first: ["cost", "time", "requiredItems", "producedItems"],
        exclude: ["chanceSum", "totalProducedItems"],
      }}
      wide={
        entry.randomProducedItems || entry.spawnedSoldier
          ? ["randomProducedItems", "spawnedSoldier"]
          : []
      }
      special={{
        randomProducedItems,
        spawnedSoldier: asSubTable,
      }}
    />
  );
}
