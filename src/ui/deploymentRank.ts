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

import { sharePercent } from "./value";

/** The slice of a race a rank resolves against */
export type RankRace = {
  members?: unknown;
  membersRandom?: unknown;
  baseCustomDeploy?: unknown;
  baseCustomMission?: unknown;
};

/** The slice of a mission a deployment can be traced back through */
export type RankMission = {
  waves?: unknown;
  raceWeights?: unknown;
  siteType?: unknown;
  spawnUfo?: unknown;
  objective?: unknown;
  spawnZone?: unknown;
};

/** The slice of a terrain a map script can be traced back through */
export type RankTerrain = {
  script?: unknown;
};

/** The slice of a map script a UFO can be traced back through */
export type RankMapScript = {
  commands?: unknown;
};

/** The slice of a UFO that can point at a custom deployment */
export type RankUfo = {
  missionCustomDeploy?: unknown;
  craftCustomDeploy?: unknown;
  raceBonus?: unknown;
  missilePower?: unknown;
};

/** The slice of a globe texture that can roll a site deployment */
export type RankTexture = {
  deployments?: unknown;
};

/** The slice of a region that can host a texture's site */
export type RankRegion = {
  missionZones?: unknown;
  missionWeights?: unknown;
};

/** The slice of a mission script that can select a mission into a region */
export type RankMissionScript = {
  missionWeights?: unknown;
  regionWeights?: unknown;
  raceWeights?: unknown;
  refNode?: unknown;
};

/** The ruleset tables the resolution reads */
export type RankTables = {
  alienRaces?: { [id: string]: RankRace | undefined };
  alienMissions?: { [id: string]: RankMission | undefined };
  alienDeployments?: { [id: string]: RankDeployment | undefined };
  terrains?: { [id: string]: RankTerrain | undefined };
  mapScripts?: { [id: string]: RankMapScript | undefined };
  ufos?: { [id: string]: RankUfo | undefined };
  textures?: { [id: string]: RankTexture | undefined };
  regions?: { [id: string]: RankRegion | undefined };
  missionScripts?: { [id: string]: RankMissionScript | undefined };
};

/** A deployment entry, carrying the fields the resolution reads */
export type RankDeployment = {
  uid?: string;
  race?: unknown;
  randomRace?: unknown;
  nextStage?: unknown;
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

/**
 * Every id named in a weighted table, whatever shape the pack wrote it in:
 * month buckets holding id → weight, or a flat id → weight map.
 */
function weightedIds(value: unknown): string[] {
  const out: string[] = [];
  if (typeof value !== "object" || value == null || Array.isArray(value)) return out;
  for (const [key, bucket] of Object.entries(value as { [key: string]: unknown })) {
    if (typeof bucket === "object" && bucket != null && !Array.isArray(bucket)) {
      for (const id of Object.keys(bucket)) if (id !== "") out.push(id);
    } else if (
      typeof bucket === "number" ||
      typeof bucket === "string" ||
      typeof bucket === "boolean"
    ) {
      // A bare value is the weight of a flat id → weight map
      if (key !== "") out.push(key);
    }
  }
  return out;
}

/** A mission script's effective memberships, with `refNode` parents folded in */
type ScriptMembership = {
  missions: Set<string>;
  /** Region weights, or `undefined` when none states any: the engine then picks from every region */
  regions: Set<string> | undefined;
  races: Set<string>;
};

/**
 * Per-ruleset caches: a pack's tables are fixed once loaded, and the texture
 * routes rebuild the same script and texture indexes for every deployment
 * (and for every mission inside them). Keyed by the tables object, so a new
 * pack's tables start empty and a pack's caches drop with it.
 */
const membershipCache = new WeakMap<object, Map<string, ScriptMembership>>();
const scriptsByMissionCache = new WeakMap<object, Map<string, ScriptMembership[]>>();
const textureRacesCache = new WeakMap<object, Map<string, string[]>>();
const ufoRacesCache = new WeakMap<object, Map<string, string[]>>();
const stableCache = new WeakMap<object, string>();

function cachedMembership(scriptId: string, tables: RankTables): ScriptMembership {
  let cache = membershipCache.get(tables as object);
  if (!cache) {
    cache = new Map();
    membershipCache.set(tables as object, cache);
  }
  const known = cache.get(scriptId);
  if (known) return known;
  const membership = scriptMembership(scriptId, tables);
  cache.set(scriptId, membership);
  return membership;
}

function cachedScriptsByMission(tables: RankTables): Map<string, ScriptMembership[]> {
  let cached = scriptsByMissionCache.get(tables as object);
  if (cached) return cached;
  cached = new Map();
  for (const scriptId of Object.keys(tables.missionScripts ?? {})) {
    const membership = cachedMembership(scriptId, tables);
    for (const missionId of membership.missions) {
      const list = cached.get(missionId) ?? [];
      list.push(membership);
      cached.set(missionId, list);
    }
  }
  scriptsByMissionCache.set(tables as object, cached);
  return cached;
}

function cachedTextureRaces(deploymentId: string, tables: RankTables): string[] {
  let cache = textureRacesCache.get(tables as object);
  if (!cache) {
    cache = new Map();
    textureRacesCache.set(tables as object, cache);
  }
  const known = cache.get(deploymentId);
  if (known) return known;
  const races = textureRaces(deploymentId, tables);
  cache.set(deploymentId, races);
  return races;
}

function cachedUfoMissionRaces(ufoId: string, tables: RankTables): string[] {
  let cache = ufoRacesCache.get(tables as object);
  if (!cache) {
    cache = new Map();
    ufoRacesCache.set(tables as object, cache);
  }
  const known = cache.get(ufoId);
  if (known) return known;
  const races = ufoMissionRaces(ufoId, tables);
  cache.set(ufoId, races);
  return races;
}

function cachedStable(value: unknown): string {
  if (typeof value !== "object" || value == null) return stable(value);
  let known = stableCache.get(value);
  if (known == null) {
    known = stable(value);
    stableCache.set(value, known);
  }
  return known;
}

/**
 * A script's memberships, parents first: `RuleMissionScript::load` loads the
 * `refNode` parent before the script's own tables, so every parent the chain
 * names contributes, and the engine's own per-key merge never removes one.
 */
function scriptMembership(
  scriptId: string,
  tables: RankTables,
  seen = new Set<string>(),
): ScriptMembership {
  const out: ScriptMembership = { missions: new Set(), regions: new Set(), races: new Set() };
  if (seen.has(scriptId)) return out;
  seen.add(scriptId);
  const script = tables.missionScripts?.[scriptId];
  if (script == null) return out;
  const parent = asId(script.refNode);
  if (parent) {
    const inherited = scriptMembership(parent, tables, seen);
    for (const mission of inherited.missions) out.missions.add(mission);
    for (const race of inherited.races) out.races.add(race);
    if (inherited.regions) for (const region of inherited.regions) out.regions.add(region);
  }
  for (const mission of weightedIds(script.missionWeights)) out.missions.add(mission);
  for (const race of weightedIds(script.raceWeights)) if (race !== "") out.races.add(race);
  for (const region of weightedIds(script.regionWeights)) out.regions.add(region);
  if (out.regions.size === 0) out.regions = undefined;
  return out;
}

/**
 * The races that reach a deployment through the globe textures.
 *
 * `AlienMission::spawnMissionSite` picks a site deployment three ways: the
 * wave's own (covered by the wave route), the mission's `siteType`, or — when
 * the mission states neither — whatever the area's texture rolls from its
 * `deployments` map. `chooseAlienBaseType` draws the same way for the base
 * objectives. A mission only reaches that fallback with no `siteType` and a
 * matching `spawnZone` (objectives 3/1/2 spawn sites and bases, the others do
 * not), and only where the region's strategy lets it run: a mission script
 * pairing the two, or the region's own `missionWeights`. The race then comes
 * from the script's `raceWeights` when the script rolls one, else from the
 * mission's own table, exactly as `processCommand` decides it.
 */
function textureRaces(deploymentId: string, tables: RankTables): string[] {
  const servedTextures = new Set<string>();
  for (const [textureId, texture] of Object.entries(tables.textures ?? {})) {
    if (texture == null || typeof texture !== "object") continue;
    const deployments = (texture as RankTexture).deployments;
    if (typeof deployments !== "object" || deployments == null || Array.isArray(deployments)) {
      continue;
    }
    if (deploymentId in (deployments as object)) servedTextures.add(textureId);
  }
  if (servedTextures.size === 0) return [];

  // Scripts that can pair each mission with any region, in mission order
  const scriptsByMission = cachedScriptsByMission(tables);

  const found = new Set<string>();
  for (const [regionId, region] of Object.entries(tables.regions ?? {})) {
    if (region == null || typeof region !== "object") continue;
    const zones = (region as RankRegion).missionZones;
    if (!Array.isArray(zones)) continue;
    // Areas with no stated texture default to texture 0, as the engine does
    const zoneTexture = (area: unknown): string | undefined => {
      if (!Array.isArray(area)) return undefined;
      const stated = (area as unknown[])[4];
      return stated == null ? "0" : String(stated);
    };
    const servedZones = new Set<number>();
    zones.forEach((zone, index) => {
      const areas = Array.isArray(zone) ? zone : (zone as { areas?: unknown } | undefined)?.areas;
      if (!Array.isArray(areas)) return;
      for (const area of areas) {
        const texture = zoneTexture(area);
        if (texture != null && servedTextures.has(texture)) servedZones.add(index);
      }
    });
    if (servedZones.size === 0) continue;
    const regionMissions = new Set(weightedIds((region as RankRegion).missionWeights));
    for (const [missionId, mission] of Object.entries(tables.alienMissions ?? {})) {
      if (mission == null || typeof mission !== "object") continue;
      if (asId((mission as RankMission).siteType) != null) continue;
      // A wave naming a deployment overrides the texture roll outright
      // (`spawnMissionSite` takes the wave's deployment first), so the
      // mission builds that one and never rolls a texture's table.
      if (waveUfos(mission).some((id) => tables.alienDeployments?.[id] != null)) continue;
      const objective = Number((mission as RankMission).objective);
      if (objective !== 1 && objective !== 2 && objective !== 3) continue;
      if (!servedZones.has(Number((mission as RankMission).spawnZone))) continue;
      const scripts = scriptsByMission.get(missionId) ?? [];
      const linking = scripts.filter(
        (script) => script.regions == null || script.regions.has(regionId),
      );
      if (linking.length === 0 && !regionMissions.has(missionId)) continue;
      for (const script of linking) {
        // `processCommand` rolls the script's race table when it has one,
        // the mission's own otherwise
        const races = script.races.size > 0 ? [...script.races] : missionRaces(mission);
        for (const race of races) found.add(race);
      }
      if (regionMissions.has(missionId)) for (const race of missionRaces(mission)) found.add(race);
    }
  }
  return [...found];
}

/** One site a mission can build through its area's globe texture */
export type TextureSpawn = {
  id: string;
  /** Share of that texture's roll, as a percentage (`Texture::getRandomDeployment` normalises the weights) */
  percent: number;
};

/**
 * The deployments a mission can spawn through the globe textures, in id order.
 *
 * This is `textureRaces` read forward: the same eligibility (`siteType`
 * unstated, objective 1/2/3, matching `spawnZone`, a script pairing the mission
 * with the region or the region's own `missionWeights`), but the result is the
 * textures' `deployments` entries themselves, each with its share of its
 * texture's roll. A deployment reached from several textures keeps the largest
 * share — the list names what can appear, not a combined chance.
 */
export function textureSpawns(missionId: string, tables: RankTables): TextureSpawn[] {
  const mission = tables.alienMissions?.[missionId];
  if (mission == null || typeof mission !== "object") return [];
  if (asId((mission as RankMission).siteType) != null) return [];
  // A wave naming a deployment overrides the texture roll outright
  // (`spawnMissionSite` takes the wave's deployment first), so the
  // mission builds that one and never rolls a texture's table.
  if (waveUfos(mission).some((id) => tables.alienDeployments?.[id] != null)) return [];
  const objective = Number((mission as RankMission).objective);
  if (objective !== 1 && objective !== 2 && objective !== 3) return [];
  const spawnZone = Number((mission as RankMission).spawnZone);

  const scripts = cachedScriptsByMission(tables).get(missionId) ?? [];

  const found = new Map<string, number>();
  for (const [regionId, region] of Object.entries(tables.regions ?? {})) {
    if (region == null || typeof region !== "object") continue;
    const zones = (region as RankRegion).missionZones;
    if (!Array.isArray(zones)) continue;
    const zone = zones[spawnZone];
    const areas = Array.isArray(zone) ? zone : (zone as { areas?: unknown } | undefined)?.areas;
    if (!Array.isArray(areas)) continue;
    const regionMissions = new Set(weightedIds((region as RankRegion).missionWeights));
    const linking = scripts.filter(
      (script) => script.regions == null || script.regions.has(regionId),
    );
    if (linking.length === 0 && !regionMissions.has(missionId)) continue;
    for (const area of areas) {
      if (!Array.isArray(area)) continue;
      // Areas with no stated texture default to texture 0, as the engine does
      const stated = (area as unknown[])[4];
      const texture = tables.textures?.[stated == null ? "0" : String(stated)];
      const deployments = (texture as RankTexture | undefined)?.deployments;
      if (typeof deployments !== "object" || deployments == null || Array.isArray(deployments))
        continue;
      const entries = Object.entries(deployments as { [id: string]: unknown });
      const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, Number(weight) || 0), 0);
      if (total <= 0) continue;
      for (const [id, weight] of entries) {
        if (id === "" || !(Number(weight) > 0)) continue;
        const percent = sharePercent(Number(weight), total);
        const known = found.get(id);
        if (known == null || percent > known) found.set(id, percent);
      }
    }
  }
  return [...found.entries()]
    .map(([id, percent]) => ({ id, percent }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The missions that can spawn a deployment through the globe textures — the
 * backlink `textureSpawns` reads the other way.
 */
export function missionsSpawningDeployment(deploymentId: string, tables: RankTables): string[] {
  const out: string[] = [];
  for (const missionId of Object.keys(tables.alienMissions ?? {})) {
    if (textureSpawns(missionId, tables).some((spawn) => spawn.id === deploymentId))
      out.push(missionId);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * The race(s) a deployment states outright: `randomRace` when it is
 * non-empty — the engine's `AlienDeployment::getRace` rolls one of them and
 * ignores `race` — otherwise the single `race`.
 */
function statedRaces(deployment: RankDeployment): string[] {
  const random = asIds(deployment.randomRace);
  if (random.length > 0) return random;
  const stated = asId(deployment.race);
  return stated ? [stated] : [];
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
 * The races that reach a deployment through a UFO's custom-deploy fields.
 * `RuleUfoStats.missionCustomDeploy` and `craftCustomDeploy` name a
 * deployment a battlescape uses instead of the usual one — for the mission
 * site a UFO's mission spawns (`AlienMission::spawnMissionSite`), for a
 * crash or ground assault of that UFO, and for the base defence its arrival
 * triggers. Under `raceBonus[race]` the field applies only to that race, so
 * the key is the race. Unconditional (base stats) it applies to whoever
 * fields the UFO, so the race comes from the missions naming that UFO.
 * The engine's default `raceBonus[""]` block is unconditional too.
 *
 * A deployment named `<ufo>_UNDERWATER` is reached the same way: the engine
 * looks it up by that name when a crashed UFO of the base type is fought
 * underwater (`ConfirmLandingState`).
 */
function ufoMissionRaces(ufoId: string, tables: RankTables): string[] {
  const found = new Set<string>();
  for (const mission of Object.values(tables.alienMissions ?? {})) {
    if (mission == null) continue;
    if (!waveUfos(mission).includes(ufoId)) continue;
    for (const race of missionRaces(mission)) found.add(race);
  }
  return [...found];
}

function ufoRaces(deploymentId: string, tables: RankTables): string[] {
  const found = new Set<string>();
  const names = (stats: unknown): boolean => {
    if (typeof stats !== "object" || stats == null) return false;
    const ufo = stats as RankUfo;
    return (
      asId(ufo.missionCustomDeploy) === deploymentId || asId(ufo.craftCustomDeploy) === deploymentId
    );
  };
  for (const [ufoId, ufo] of Object.entries(tables.ufos ?? {})) {
    if (ufo == null) continue;
    // Keyed bonuses name the race directly.
    const bonus = ufo.raceBonus;
    if (typeof bonus === "object" && bonus != null) {
      for (const [raceId, stats] of Object.entries(bonus as { [race: string]: unknown })) {
        if (!names(stats)) continue;
        if (raceId === "") {
          for (const race of cachedUfoMissionRaces(ufoId, tables)) found.add(race);
        } else {
          found.add(raceId);
        }
      }
    }
    // Unconditional base stats (and the `_UNDERWATER` lookup) need the race
    // of whichever mission fields this UFO.
    if (names(ufo) || deploymentId === `${ufoId}_UNDERWATER`) {
      for (const race of cachedUfoMissionRaces(ufoId, tables)) found.add(race);
    }
  }
  return [...found];
}

/**
 * The races that lead straight to a deployment, with no hop through another
 * deployment: its own `race` (or `randomRace`, which the engine prefers and
 * rolls between), the mission of the same id (a location mission's site is fought
 * with the deployment of its own type, its waves naming nothing but `dummy`),
 * the missions whose waves name it, the missions whose `siteType` is it,
 * every race whose `baseCustomDeploy` or `baseCustomMission` is it, the
 * missions whose `spawnUfo` is it (a retaliation or base-invasion mission
 * spawns that UFO), the races behind a UFO that names it as its custom
 * deploy (`raceBonus[race].missionCustomDeploy` / `craftCustomDeploy` under
 * `ufos`, and an unconditional `missionCustomDeploy` / `craftCustomDeploy`
 * on the UFO's base stats, whose race comes from the missions that field
 * that UFO), the missions that can spawn it through their area's globe
 * texture (no `siteType`, matching `spawnZone`, selectable in the region that
 * maps the texture), and the deployment whose `nextStage` it is — a follow-on stage
 * is fought by the same mission site / alien base as the stage before it
 * when it states no race of its own (`BattlescapeGenerator::nextStage`),
 * so it inherits that stage's races, transitively down the chain.
 *
 * This is a reverse index by addressed field, not a list of known
 * deployments: whenever a new pack shows a bare number again, it is almost
 * always one more engine field that names a deployment and a race at once,
 * so the fix is to widen this index to the field, once, rather than to
 * special-case the deployment.
 */
/**
 * The effective `missionCustomDeploy` a UFO of one race carries, by the
 * engine's merge: the race's `raceBonus` block (or the default `""` block
 * when the race has none) wins when it states one, otherwise the base
 * stats stand (`RuleUfoStats::operator+=`).
 */
function effectiveMissionDeploy(ufo: RankUfo, raceId: string): string | undefined {
  const bonus: unknown = ufo.raceBonus;
  const table =
    typeof bonus === "object" && bonus != null ? (bonus as { [race: string]: unknown }) : undefined;
  const block = table?.[raceId] ?? table?.[""];
  const blockDeploy =
    typeof block === "object" && block != null
      ? asId((block as { missionCustomDeploy?: unknown }).missionCustomDeploy)
      : undefined;
  return blockDeploy ?? asId(ufo.missionCustomDeploy);
}

/**
 * The races whose base defence is fought with `STR_BASE_DEFENSE` data.
 *
 * `GeoscapeState::handleBaseDefense` always fights the base defence with
 * mission type `STR_BASE_DEFENSE`, overriding it with the attacking UFO's
 * custom deploy only when that deploy carries `data`
 * (`deployAliens(_alienCustomDeploy && !data.empty ? ... )`). The attacker is
 * the retaliation flight's `spawnUfo` battleship, spawned straight at the
 * base (`AlienMission`: objective 4/6) — waves never attack a base. A
 * missile-power UFO does a missile strike instead of a battle, so it never
 * reaches here. A race falls back to `STR_BASE_DEFENSE` when its effective
 * deploy on the assault UFO is missing or has no `data`; a race with its own
 * deploy (XPiratez `STR_CRACKDOWN_LESSER` etc.) fights that one instead.
 */
function baseDefenseRaces(tables: RankTables): string[] {
  const found = new Set<string>();
  for (const mission of Object.values(tables.alienMissions ?? {})) {
    if (mission == null) continue;
    const objective = Number(mission.objective);
    if (objective !== 4 && objective !== 6) continue;
    const assault = [
      ...new Set([asId(mission.spawnUfo), ...waveUfos(mission)].filter(Boolean) as string[]),
    ];
    // With a stated `spawnUfo` only that battleship flies the assault run;
    // without one each wave's UFO can.
    const ufoIds = asId(mission.spawnUfo) ? [asId(mission.spawnUfo) as string] : assault;
    for (const raceId of missionRaces(mission)) {
      for (const ufoId of ufoIds) {
        const ufo = tables.ufos?.[ufoId];
        if (ufo == null) continue;
        const missile = Number(ufo.missilePower);
        if (missile !== 0 && Number.isFinite(missile)) continue;
        const deploy = effectiveMissionDeploy(ufo, raceId);
        const target = deploy ? tables.alienDeployments?.[deploy] : undefined;
        const targetData = target?.data;
        if (!deploy || !Array.isArray(targetData) || targetData.length === 0) found.add(raceId);
      }
    }
  }
  return [...found];
}

function directRaces(
  deployment: RankDeployment,
  tables: RankTables,
  seen: Set<string> = new Set<string>(),
): string[] {
  const stated = statedRaces(deployment);
  if (stated.length > 0) return stated;

  const id = asId(deployment.uid);
  if (!id || seen.has(id)) return [];
  seen.add(id);

  const found = new Set<string>();
  const sameId = tables.alienMissions?.[id];
  if (sameId != null) for (const race of missionRaces(sameId)) found.add(race);
  for (const mission of Object.values(tables.alienMissions ?? {})) {
    if (mission == null) continue;
    // A mission site is fought with the deployment its `siteType` names,
    // even when no wave says so and the ids differ (`STR_LOC_*` deployments
    // under `STR_MISSION_*` missions). `waves` naming it is the same fact
    // from the other side: a wave creates the site with that deployment.
    // `spawnUfo` names a UFO a retaliation or base-invasion mission spawns:
    // when that UFO is fought, its deployment is the one named by the UFO's
    // own type or custom-deploy fields, and the race is this mission's.
    const namesSite =
      asId(mission.siteType) === id ||
      waveUfos(mission).includes(id) ||
      asId(mission.spawnUfo) === id;
    if (!namesSite) continue;
    for (const race of missionRaces(mission)) found.add(race);
  }
  for (const [raceId, race] of Object.entries(tables.alienRaces ?? {})) {
    if (race == null) continue;
    if (asId(race.baseCustomDeploy) === id || asId(race.baseCustomMission) === id)
      found.add(raceId);
  }
  for (const race of ufoRaces(id, tables)) found.add(race);
  // A site with no stated deployment is fought with whatever its area's
  // globe texture rolls (`textureRaces` walks texture → region → mission).
  for (const race of cachedTextureRaces(id, tables)) found.add(race);
  // A base defence is fought with the `STR_BASE_DEFENSE` deployment unless
  // the attacking retaliation UFO carries its own custom deploy with data —
  // so the surviving races are exactly the fallback set it computes.
  if (id === "STR_BASE_DEFENSE") for (const race of baseDefenseRaces(tables)) found.add(race);
  // A stage whose `nextStage` is this one: the engine advances a mission
  // site's deployment down that chain in place (`nextStage()`), keeping
  // the site's (or base's) race when the successor states none — which is
  // this branch, since a stated race returned above. The predecessor's
  // own routes are followed transitively, so a three-stage chain resolves
  // from its first stage.
  for (const [otherId, other] of Object.entries(tables.alienDeployments ?? {})) {
    if (other == null || asId(other.nextStage) !== id) continue;
    for (const race of directRaces({ ...other, uid: asId(other.uid) ?? otherId }, tables, seen))
      found.add(race);
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
  const own = cachedStable(deployment.data);
  if (own === "[]" || own === "{}") return [];

  const found = new Set<string>();
  for (const [deploymentId, other] of Object.entries(tables.alienDeployments ?? {})) {
    if (other == null || deploymentId === id) continue;
    if (cachedStable(other.data) !== own) continue;
    for (const race of directRaces({ ...other, uid: asId(other.uid) ?? deploymentId }, tables))
      found.add(race);
  }
  return [...found];
}

/**
 * The race a deployment fights as, as far as it can be known statically.
 *
 * The engine decides in `BattlescapeGenerator`: the deployment's own `race`
 * field (or its `randomRace` roll) wins, then the mission site's race
 * (rolled from the mission's `raceWeights` when the mission spawned), then
 * the alien base's race. The
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
  const stated = statedRaces(deployment);
  if (stated.length > 0) return stated;

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
 * `A / B` (the same join `RankTitle` already uses for a `membersRandom`
 * roll) instead of falling back to a bare number. `undefined`
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
  return counts.map((count) => sharePercent(count, row.length));
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

/**
 * Whether counted chances distinguish anything by tech level at all: more
 * than one level column. A pack with a single `alienItemLevels` row has one
 * column and the same chance at every level, so the loadouts carry no
 * "by alien tech level" distinction — the caller labels them plain "Loadouts"
 * while the counted table stays.
 */
export function hasTechLevelDistinction(chancesByLevel: number[][] | undefined): boolean {
  return (chancesByLevel?.[0]?.length ?? 0) > 1;
}

export function rankUnits(
  deployment: RankDeployment | undefined,
  rank: number,
  tables: RankTables,
  onlyRace?: string,
): string[] | undefined {
  const races = deploymentRaces(deployment, tables);
  if (races.length === 0) return undefined;
  // A single race pinned by the reader's picker: the card shows that race's
  // member only, so a ten-race fallback is read one race at a time. A race
  // that does not lead here resolves to nothing, as usual.
  if (onlyRace && !races.includes(onlyRace)) return undefined;
  const pick = onlyRace ? [onlyRace] : races;
  const out: string[] = [];
  for (const race of pick) {
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
