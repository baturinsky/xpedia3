/**
 * Where a unit can be encountered, on demand.
 *
 * A unit reaches the battlescape through `alienDeployments` data rows — a
 * `customUnitType` names it outright, otherwise its rank resolves through
 * the deployment's race (`deploymentRank.ts`). Resolving every deployment
 * costs seconds in a big pack, so the reverse index is built the first time
 * a unit page asks for it and kept for the pack's lifetime, not at pack
 * load. `civiliansByType` deployments spawn the unit as a civilian and
 * carry no data row, so they are read straight off the deployment.
 */
import { deploymentRaces, rankMembers } from "./deploymentRank";
import { asNumber } from "./value";

type Row = { [field: string]: unknown };
type Tables = {
  alienDeployments?: { [id: string]: Row | undefined };
};

/** Data rows of a deployment, including every reinforcements wave's rows */
function dataRows(deployment: Row): Row[] {
  const rows: Row[] = [];
  if (Array.isArray(deployment.data))
    for (const row of deployment.data)
      if (typeof row === "object" && row != null) rows.push(row as Row);
  if (Array.isArray(deployment.reinforcements))
    for (const wave of deployment.reinforcements) {
      if (typeof wave !== "object" || wave == null) continue;
      const data = (wave as Row).data;
      if (Array.isArray(data))
        for (const row of data) if (typeof row === "object" && row != null) rows.push(row as Row);
    }
  return rows;
}

/**
 * Every deployment that spawns `unitId`, in id order: the rank resolution
 * of `deploymentRank.ts` read backwards, plus `civiliansByType` keys.
 */
export function deploymentsSpawningUnit(unitId: string, tables: Tables): string[] {
  const out = new Set<string>();
  for (const [deploymentId, deployment] of Object.entries(tables.alienDeployments ?? {})) {
    if (deployment == null) continue;
    const civilians = deployment.civiliansByType;
    if (typeof civilians === "object" && civilians != null && !Array.isArray(civilians)) {
      if (unitId in (civilians as object)) out.add(deploymentId);
    }
    const rows = dataRows(deployment);
    if (rows.length === 0) continue;
    if (rows.some((row) => row.customUnitType === unitId)) {
      out.add(deploymentId);
      continue;
    }
    const races = deploymentRaces(deployment, tables);
    if (races.length === 0) continue;
    for (const row of rows) {
      if (typeof row.customUnitType === "string" && row.customUnitType !== "") continue;
      const rank = asNumber(row.alienRank) ?? 0;
      for (const race of races) {
        const members = rankMembers(race, rank, tables);
        if (members?.includes(unitId)) {
          out.add(deploymentId);
          break;
        }
      }
      if (out.has(deploymentId)) break;
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

const cache = new WeakMap<object, Map<string, string[]>>();

/**
 * `deploymentsSpawningUnit` for the pack, built once and reused: a reader
 * paging through units pays the scan on the first unit page only.
 */
export function deploymentsForUnit(unitId: string, tables: Tables): string[] {
  let index = cache.get(tables as object);
  if (!index) {
    index = new Map();
    for (const deploymentId of Object.keys(tables.alienDeployments ?? {})) {
      const deployment = tables.alienDeployments?.[deploymentId];
      if (deployment == null) continue;
      const units = new Set<string>();
      const civilians = deployment.civiliansByType;
      if (typeof civilians === "object" && civilians != null && !Array.isArray(civilians))
        for (const id of Object.keys(civilians as object)) units.add(id);
      const rows = dataRows(deployment);
      if (rows.length > 0) {
        const races = deploymentRaces(deployment, tables);
        for (const row of rows) {
          if (typeof row.customUnitType === "string" && row.customUnitType !== "") {
            units.add(row.customUnitType);
            continue;
          }
          if (races.length === 0) continue;
          const rank = asNumber(row.alienRank) ?? 0;
          for (const race of races)
            for (const member of rankMembers(race, rank, tables) ?? []) units.add(member);
        }
      }
      for (const unit of units) {
        const list = index.get(unit) ?? [];
        list.push(deploymentId);
        index.set(unit, list);
      }
    }
    for (const list of index.values()) list.sort((a, b) => a.localeCompare(b));
    cache.set(tables as object, index);
  }
  return index.get(unitId) ?? [];
}

/** A field as a list of id strings: a lone id counts as a one-item list */
export function asIdList(value: unknown): string[] {
  const out: string[] = [];
  for (const item of Array.isArray(value) ? value : [value]) {
    if (typeof item === "string" && item !== "") out.push(item);
  }
  return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}

/** The races a unit belongs to: its stated `race` plus `memberOf` backlinks */
export function racesForUnit(entry: { race?: unknown; memberOf?: unknown }): string[] {
  return asIdList([...asIdList(entry.race), ...asIdList(entry.memberOf)]);
}

type MissionTables = {
  alienRaces?: { [id: string]: Row | undefined };
};

/**
 * Every mission that fields one of the unit's races, in id order. The race's
 * `missions` backlink (`alienMissions` `raceWeights` → races) is the engine's
 * own race table for the mission, so this is correct at race level — a mission
 * is listed even when this unit's exact rank never spawns in it.
 */
export function missionsForUnit(races: string[], tables: MissionTables): string[] {
  const found = new Set<string>();
  for (const race of races) {
    const missions = tables.alienRaces?.[race]?.missions;
    for (const mission of asIdList(missions)) found.add(mission);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

type UfoTables = {
  alienMissions?: { [id: string]: Row | undefined };
  ufos?: { [id: string]: unknown | undefined };
};

/**
 * Every UFO a mission fields across its waves, in id order, restricted to
 * entries that are actually UFOs (a wave's `ufo` may name a deployment
 * instead, and the pack may name an entry in no table at all).
 */
export function ufosForUnit(missions: string[], tables: UfoTables): string[] {
  const found = new Set<string>();
  for (const missionId of missions) {
    const waves = tables.alienMissions?.[missionId]?.waves;
    if (!Array.isArray(waves)) continue;
    for (const wave of waves) {
      if (typeof wave !== "object" || wave == null) continue;
      const ufo = (wave as { ufo?: unknown }).ufo;
      if (typeof ufo === "string" && ufo !== "" && tables.ufos?.[ufo] != null) found.add(ufo);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}
