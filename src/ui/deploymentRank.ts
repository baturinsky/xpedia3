/**
 * What an `alienDeployments` rank actually spawns.
 *
 * A rank is not a tech level and not a difficulty: it is an index into the
 * member list of the alien race fighting the battlescape. The engine spells
 * it out in `BattlescapeGenerator::deployAliens` — the spawned unit is
 * `dd.customUnitType` when the row states one, otherwise
 * `race->getMember(dd.alienRank)`, and `AlienRace::getMember` is a plain list
 * lookup (`_members[id]`, or a random pick from `_membersRandom[id]` when
 * the race uses those). Tech level (`alienItemLevels`) is a separate axis
 * entirely: it only picks which of the row's `itemSets` the spawn carries.
 *
 * XPiratez races run to nineteen members, so a bare `16` says nothing to a
 * reader who does not hold the race's list in their head. These helpers
 * resolve the number to the unit id(s) it means, so the deployment table
 * can print the name instead of the index.
 */

/** The slice of a race a rank resolves against */
export type RankRace = {
  members?: unknown;
  membersRandom?: unknown;
  baseCustomDeploy?: unknown;
};

/** The slice of a mission a deployment can be traced back through */
export type RankMission = {
  waves?: unknown;
  raceWeights?: unknown;
};

/** The slice of a terrain a map script can be traced back through */
export type RankTerrain = {
  script?: unknown;
};

/** The slice of a map script a UFO can be traced back through */
export type RankMapScript = {
  commands?: unknown;
};

/** The ruleset tables the resolution reads */
export type RankTables = {
  alienRaces?: { [id: string]: RankRace | undefined };
  alienMissions?: { [id: string]: RankMission | undefined };
  alienDeployments?: { [id: string]: RankDeployment | undefined };
  terrains?: { [id: string]: RankTerrain | undefined };
  mapScripts?: { [id: string]: RankMapScript | undefined };
};

/** A deployment entry, carrying the fields the resolution reads */
export type RankDeployment = {
  uid?: string;
  race?: unknown;
  terrains?: unknown;
  data?: unknown;
};

/** Whether a value is a usable id string */
function asId(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The `ufo` of every wave of a mission: a wave may name a deployment
 * directly (the usual case for a location mission such as
 * `STR_LOC_JUNKFORT_CHALLENGE`, whose wave's `ufo` is the deployment id).
 */
function waveUfos(mission: RankMission): string[] {
  if (!Array.isArray(mission.waves)) return [];
  const out: string[] = [];
  for (const wave of mission.waves) {
    if (typeof wave !== "object" || wave == null) continue;
    const ufo = asId((wave as { ufo?: unknown }).ufo);
    if (ufo) out.push(ufo);
  }
  return out;
}

/**
 * Every race a mission can field, across all its monthly `raceWeights`.
 * The engine rolls one of these per mission spawn, so a mission whose
 * weights move between races over the campaign can fight more than one —
 * the caller only resolves when the union across all routes is one race.
 */
function missionRaces(mission: RankMission): string[] {
  const weights = mission.raceWeights;
  if (typeof weights !== "object" || weights == null) return [];
  const out: string[] = [];
  for (const month of Object.values(weights)) {
    if (typeof month !== "object" || month == null) continue;
    for (const race of Object.keys(month)) if (race !== "") out.push(race);
  }
  return out;
}

/** A value as a list of id strings: a lone id counts as a one-item list */
function asIds(value: unknown): string[] {
  const out: string[] = [];
  for (const item of Array.isArray(value) ? value : [value]) {
    const id = asId(item);
    if (id) out.push(id);
  }
  return out;
}

/** A stable rendering of a ruleset node, for comparing two `data` lists */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object" && value != null) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stable((value as { [k: string]: unknown })[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/**
 * The races that lead straight to a deployment, with no hop through another
 * deployment: its own `race` (certain — the engine prefers it over the site
 * race), the mission of the same id (a location mission's site is fought
 * with the deployment of its own type, its waves naming nothing but `dummy`),
 * the missions whose waves name it, and every race whose
 * `baseCustomDeploy` is it.
 */
function directRaces(deployment: RankDeployment, tables: RankTables): string[] {
  const stated = asId(deployment.race);
  if (stated) return [stated];

  const id = asId(deployment.uid);
  if (!id) return [];

  const found = new Set<string>();
  const sameId = tables.alienMissions?.[id];
  if (sameId != null) for (const race of missionRaces(sameId)) found.add(race);
  for (const mission of Object.values(tables.alienMissions ?? {})) {
    if (mission == null) continue;
    if (!waveUfos(mission).includes(id)) continue;
    for (const race of missionRaces(mission)) found.add(race);
  }
  for (const [raceId, race] of Object.entries(tables.alienRaces ?? {})) {
    if (race != null && asId(race.baseCustomDeploy) === id) found.add(raceId);
  }
  return [...found];
}

/**
 * The races behind a vessel deployment, through the map script that places
 * it: an `addUFO` command names the UFO (whose id is the deployment's), the
 * terrain running that script names the fight's terrain, and the location
 * deployment using that terrain is fought by the mission of its own id.
 * The Tiger Tank case, end to end: the `RURAL_TIGER_TANK` script adds
 * `STR_VESSEL_TIGER_TANK_JACK_BOUNTY` onto the `RURAL_TIGER_TANK` terrain,
 * whose deployment is `STR_LOC_TIGER_TANK`, fought by the mission of that
 * name — race `STR_NAZIS`.
 */
function mapScriptRaces(deployment: RankDeployment, tables: RankTables): string[] {
  const id = asId(deployment.uid);
  if (!id) return [];

  const scripts = new Set<string>();
  for (const [scriptId, script] of Object.entries(tables.mapScripts ?? {})) {
    if (script == null || !Array.isArray(script.commands)) continue;
    for (const command of script.commands) {
      if (typeof command !== "object" || command == null) continue;
      if (asId((command as { UFOName?: unknown }).UFOName) === id) scripts.add(scriptId);
    }
  }
  if (scripts.size === 0) return [];

  const terrainIds = new Set<string>();
  for (const [terrainId, terrain] of Object.entries(tables.terrains ?? {})) {
    if (terrain != null && scripts.has(asId(terrain.script) ?? "")) terrainIds.add(terrainId);
  }
  if (terrainIds.size === 0) return [];

  const found = new Set<string>();
  for (const [deploymentId, other] of Object.entries(tables.alienDeployments ?? {})) {
    if (other == null) continue;
    if (!asIds(other.terrains).some((terrainId) => terrainIds.has(terrainId))) continue;
    for (const race of directRaces({ ...other, uid: asId(other.uid) ?? deploymentId }, tables))
      found.add(race);
  }
  return [...found];
}

/**
 * The races of every other deployment carrying the very same `data`: a pack
 * that anchors one spawn table and reuses it (the Tiger Tank's
 * `SECTION_TIGER_TANK_DEPLOYMENT`, shared by the location deployment and
 * both vessel deployments) fights the same race at every one of those
 * triggers, so a variant with no route of its own inherits the race of a
 * variant that has one. Two variants with different races would union to
 * more than one, and the caller would keep the raw number.
 */
function sharedDataRaces(deployment: RankDeployment, tables: RankTables): string[] {
  const id = asId(deployment.uid);
  if (!id || deployment.data == null) return [];
  const own = stable(deployment.data);
  if (own === "[]" || own === "{}") return [];

  const found = new Set<string>();
  for (const [deploymentId, other] of Object.entries(tables.alienDeployments ?? {})) {
    if (other == null || deploymentId === id) continue;
    if (stable(other.data) !== own) continue;
    for (const race of directRaces({ ...other, uid: asId(other.uid) ?? deploymentId }, tables))
      found.add(race);
  }
  return [...found];
}

/**
 * The race a deployment fights as, as far as it can be known statically.
 *
 * The engine decides in `BattlescapeGenerator`: the deployment's own `race`
 * field wins, then the mission site's race (rolled from the mission's
 * `raceWeights` when the mission spawned), then the alien base's race. The
 * last two are per-spawn choices, so statically the best that can be said is
 * the union of the routes that lead to this deployment: the direct routes
 * of `directRaces`, the map script that places its UFO, and the sibling
 * deployments carrying its exact spawn table.
 *
 * An empty list means nothing leads here; a list of one is the race to
 * resolve against; more than one means the rank means different units in
 * different campaigns (a mission rolled at 90/10, or weights that move over
 * months), so the caller lists the candidates of each race — still beside
 * the raw number — rather than guessing one.
 */
export function deploymentRaces(
  deployment: RankDeployment | undefined,
  tables: RankTables,
): string[] {
  if (deployment == null) return [];
  const stated = asId(deployment.race);
  if (stated) return [stated];

  const found = new Set<string>();
  for (const race of [
    ...directRaces(deployment, tables),
    ...mapScriptRaces(deployment, tables),
    ...sharedDataRaces(deployment, tables),
  ])
    found.add(race);
  return [...found];
}

/**
 * The unit id(s) a rank spawns, for one race.
 *
 * Following `AlienRace::getMember`: a non-empty `membersRandom` wins over
 * `members` outright (the lists are parallel, one roll per rank), and a
 * `membersRandom` slot is a roll between its candidates, so every distinct
 * candidate is returned. `undefined` means the rank is out of range for
 * this race (the engine would throw) or the race states no list at all.
 */
export function rankMembers(
  raceId: string,
  rank: number,
  tables: RankTables,
): string[] | undefined {
  const race = tables.alienRaces?.[raceId];
  if (race == null || !Number.isInteger(rank) || rank < 0) return undefined;

  const random = race.membersRandom;
  if (Array.isArray(random) && random.length > 0) {
    const slot = random[rank];
    if (!Array.isArray(slot)) return undefined;
    const candidates: string[] = [];
    for (const candidate of slot) {
      const id = asId(candidate);
      if (id && !candidates.includes(id)) candidates.push(id);
    }
    return candidates.length > 0 ? candidates : undefined;
  }

  const members = race.members;
  if (!Array.isArray(members)) return undefined;
  const id = asId(members[rank]);
  return id ? [id] : undefined;
}

/**
 * The unit id(s) a deployment rank spawns, when they can be known.
 *
 * With one race it is that race's member at the rank. With several races —
 * a mission that fields more than one — it is the union of their members at
 * the rank, duplicates collapsed and in race order, so the card can list
 * `A / B` beside the raw number (the same join `RankTitle` already uses for
 * a `membersRandom` roll) instead of falling back to a bare number. `undefined`
 * is then the honest answer only when no race leads here or no race has a
 * member at that rank — the table then keeps showing the raw number rather
 * than guessing. A row's `customUnitType` override is handled by the caller,
 * since it needs no race at all.
 */
/** One loadout set's chance of being the one a spawn carries, per tech level */

/** The chance of every value in one `alienItemLevels` row landing on each set */
function chancesForRow(row: number[], setCount: number): number[] {
  const counts = new Array<number>(setCount).fill(0);
  for (const value of row) {
    // A value past the last set spawns the last set instead (`BattlescapeGenerator` clamps)
    const set = Math.min(Math.max(value, 0), setCount - 1);
    counts[set] += 1;
  }
  return counts.map((count) => Math.round((count / row.length) * 100));
}

/**
 * The `itemSets[set]` chance for every loadout of a rank, as percentages,
 * counted from the mod's `alienItemLevels` table: one row of percentages
 * per set, one entry per tech level, `chance[set][techLevel]`.
 *
 * The engine rolls a die of 0..9 through `alienItemLevels[techLevel]` — one
 * row per tech level, chosen by months passed — and clamps the result onto
 * the last set when the row asks for more than the row states. A pack with
 * one row (most do) has a single entry per set. `undefined` means the pack
 * states no usable table, so nothing can be counted honestly.
 */
export function setChancesByLevel(
  setCount: number,
  alienItemLevels: unknown,
): number[][] | undefined {
  if (!Number.isInteger(setCount) || setCount < 2 || !Array.isArray(alienItemLevels))
    return undefined;
  const rows = alienItemLevels.filter(
    (row): row is number[] =>
      Array.isArray(row) && row.length > 0 && row.every((value) => Number.isFinite(Number(value))),
  );
  if (rows.length === 0) return undefined;

  const perLevel = rows.map((row) => chancesForRow(row, setCount));
  return Array.from({ length: setCount }, (_, set) => perLevel.map((level) => level[set]));
}

export function rankUnits(
  deployment: RankDeployment | undefined,
  rank: number,
  tables: RankTables,
): string[] | undefined {
  const races = deploymentRaces(deployment, tables);
  if (races.length === 0) return undefined;
  const out: string[] = [];
  for (const race of races) {
    const members = rankMembers(race, rank, tables);
    if (members == null) continue;
    for (const member of members) if (!out.includes(member)) out.push(member);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Whether a rank's `itemSets` / `extraRandomItems` states no items at all.
 *
 * A pack can state the loadout explicitly as five empty sets — XPiratez
 * anchors `&itemSetsEmpty` with `- []` five times and reuses it for undead
 * and other bare-handed ranks, including both rows of
 * `STR_LABYRINTHUS_NOCTIS` — so the field is not absent, it is present and
 * empty on purpose. The caller renders "No items in loadout" for that
 * instead of leaving the tech-level table's items column blank.
 */
export function loadoutIsEmpty(value: unknown): boolean {
  const sets = Array.isArray(value) ? value : [value];
  return sets.every((set) => set == null || set === "" || (Array.isArray(set) && set.length === 0));
}
