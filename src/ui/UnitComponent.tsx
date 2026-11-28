import type { Unit } from "../rul/Entry";
import { rul, sortFirstLast } from "../rul/Ruleset";
import MainTable, { type MainTableRenderer } from "./MainTable";
import {
  asIdList,
  deploymentsForUnit,
  missionsForUnit,
  racesForUnit,
  ufosForUnit,
} from "./unitEncounters";
import { Val } from "./Val";

/** Fields shown before the encounter subtable, in the order `Unit.svelte` once listed them */
const firstFields = ["stats", "armor", "canSurrender"];

/** Fields the encounter subtable consumes, so they must not fall through to the
 *  alphabetical misc rows under "See details" once they leave `firstFields`.
 *  The backlink fields stay on the entry for render and crosslink consumers. */
const hiddenFields = ["type", "terrains", "spawnedBy", "convertedFrom", "zombifiedBy"];

export default function UnitComponent({ entry }: { entry: Unit }) {
  const soundKeys = Object.keys(entry).filter((s) => s.indexOf("ound") !== -1);
  const sorted = sortFirstLast(entry, {
    first: firstFields,
    last: soundKeys,
    exclude: hiddenFields,
  });

  // Where the unit can be encountered, in player terms: the missions and UFOs
  // of its races, the deployments that spawn it, and the in-battle
  // transformations that produce it. Missions and UFOs come via race
  // membership, so they are correct at race level; deployments resolve the
  // exact rank (`unitEncounters.ts`).
  const asStrings = (value: unknown): string[] => asIdList(value);
  const races = racesForUnit(entry as { race?: unknown; memberOf?: unknown });
  const missions = missionsForUnit(races, rul);
  const ufos = ufosForUnit(missions, rul);
  const deployments = deploymentsForUnit(entry.uid, rul);
  const terrains = asStrings(entry.terrains);
  const spawnedBy = asStrings(entry.spawnedBy);
  const convertedFrom = asStrings(entry.convertedFrom);
  const zombifiedBy = asStrings(entry.zombifiedBy);

  const encounters: { method: string; source: string[] }[] = [];
  const add = (method: string, source: string[]) => {
    if (source.length > 0) encounters.push({ method, source });
  };
  add("xpediaEncounterMission", missions);
  add("xpediaEncounterUfo", ufos);
  add("xpediaEncounterDeployment", deployments);
  add("xpediaEncounterTerrain", terrains);
  add("xpediaEncounterSpawnedBy", spawnedBy);
  add("xpediaEncounterConvertedFrom", convertedFrom);
  add("xpediaEncounterZombie", zombifiedBy);

  const rows: { [field: string]: MainTableRenderer } = {
    _encounter: () =>
      encounters.length === 0 ? null : (
        <>
          <tr>
            <td colSpan={2} className="table-subheader">
              <Val of="xpediaEncounterTitle" />
            </td>
          </tr>
          {encounters.map((row) => (
            <tr key={row.method}>
              <td className="row-name">
                <Val of={row.method} capital={true} />
              </td>
              <td>
                <Val of={row.source} />
              </td>
            </tr>
          ))}
        </>
      ),
  };

  // The encounter subtable closes the table, after every per-unit field
  // (sounds included), as a reference summary.
  const pairs: [string, unknown][] =
    encounters.length === 0 ? [...sorted.all] : [...sorted.all, ["_encounter", null]];

  // The armor table is not embedded here: it arrives as its own body panel
  // (the `armors` renderer after `units` in ArticleComponent), so on a
  // multi-entry page both flow in the two-column body like every panel.
  return <MainTable key={entry.uid} of={entry} pairs={pairs} title="Unit" rows={rows} />;
}
