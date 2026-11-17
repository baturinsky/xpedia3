import { Entry } from "../rul/Entry";
import MainTable, { MainTableRenderer } from "./MainTable";
import { Val } from "./Val";

/** Fields shown as a subheader with the whole list under it, in the order old
 *  `Research.svelte` showed them */
const longLists = [
  "unlocks",
  "seeAlso",
  "allowsBuying",
  "freeFrom",
  "dependencies",
  "leadsTo",
  "disables",
  "getOneFree",
  "getOneFreeProtected",
  "requiresBaseFunc",
  "manufacture"
];

/** A wide field always draws its subheader, while the research table used to
 *  draw the block only when the entry had a non-empty list in that field */
function hasContent(val: unknown) {
  return val != null && ((val as { length?: number }).length ?? 0) > 0;
}

/** Research table, follows old `Research.svelte` */
export const ResearchComponent = ({ entry }: { entry: Entry }) => {
  // `getOneFreeProtected` maps a group name to the list it protects, so it
  // needs a row per group instead of one block of nested tables
  let groups = entry.getOneFreeProtected;
  let wide = longLists.filter(field =>
    field != "getOneFreeProtected" && hasContent(entry[field]));

  // The research table centred the list that sits under each subheader
  let centred: MainTableRenderer = ({ val }) =>
    <div className="centered-text"><Val of={val} /></div>;
  let special: { [field: string]: MainTableRenderer } = Object.fromEntries(
    wide.map(field => [field, centred]));

  return <MainTable
    of={entry}
    title="Research"
    sort={{ last: longLists, exclude: ["name"] }}
    wide={wide}
    special={special}
    rows={{
      getOneFreeProtected: () => groups == null ? null : <>
        <tr><td colSpan={2} className="table-subheader"><Val of="getOneFreeProtected" /></td></tr>
        {Object.entries(groups).map(([group, list]) =>
          <tr key={group}>
            <td><Val of={group} />:</td>
            <td><Val of={list} /></td>
          </tr>
        )}
      </>
    }}
  />;
};

export default ResearchComponent;
