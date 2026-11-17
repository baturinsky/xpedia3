/**
 * `Ruleset.missionsIn`: which missions a region can host.
 *
 * The rule has two routes — a script that names regions, and a script that names
 * none falling back to every region with a `regionWeight` — and getting the
 * second one wrong silently makes hundreds of regions claim a mission, so this
 * recomputes both routes from the raw fields and compares.
 *
 * It runs on the builtins, which every checkout has, and on any example pack
 * that happens to be present.
 */
import { eq, ok, report } from "../helpers/check.mjs";
import { examplePack, loadBuiltinPack, loadPack } from "../helpers/packs.mjs";

/**
 * The ids a weighted table names.
 *
 * The engine's tables are sparse maps from a month or difficulty to a set of
 * ids, written `{ 0: {...}, 3: {...} }`. Only the ids matter here, since the page
 * shows who can be chosen rather than how the odds change over time.
 */
function idsIn(weights) {
  let out = new Set();
  let walk = (obj) => {
    if (obj == null || typeof obj != "object")
      return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    for (let [key, value] of Object.entries(obj)) {
      // A numeric key is a month or a difficulty, never an id
      if (!/^\d+$/.test(key))
        out.add(key);
      walk(value);
    }
  };
  walk(weights);
  return out;
}

/** The independent walk of the same rule, region id -> mission ids */
function expectedMissions(rul) {
  let expected = new Map();
  for (let region of Object.values(rul.regions ?? {})) {
    let weighted = region.regionWeight != null && region.regionWeight > 0;
    let missions = new Set();
    for (let script of Object.values(rul.missionScripts ?? {})) {
      let named = idsIn(script.regionWeights);
      // No script-level choice means the strategy's weighted table, so every
      // weighted region is a candidate
      let reaches = named.size ? named.has(region.id) : weighted;
      if (!reaches)
        continue;
      for (let mission of idsIn(script.missionWeights))
        missions.add(mission);
    }
    expected.set(region.id, missions);
  }
  return expected;
}

function check(rul, label) {
  let expected = expectedMissions(rul);
  let regions = Object.keys(rul.regions ?? {});
  let scripts = Object.keys(rul.missionScripts ?? {});
  ok(regions.length > 0 || scripts.length == 0, `${label}: regions present when scripts are`);

  for (let [id, missions] of expected) {
    let got = rul.missionsIn(id);
    // A region can host the same mission through several scripts; the page shows
    // it once, so the two counts are comparable
    eq(got.length, missions.size, `${label}: ${id} mission count`, got.map(e => e.mission).join(","));
    ok(new Set(got.map(e => e.mission)).size == got.length, `${label}: ${id} has no duplicate mission`);
  }

  // How many regions really host each mission, recounted from the same walk
  let hosts = new Map();
  for (let missions of expected.values())
    for (let mission of missions)
      hosts.set(mission, (hosts.get(mission) ?? 0) + 1);

  let wrongCount = 0;
  for (let [id, missions] of expected) {
    for (let entry of rul.missionsIn(id)) {
      let real = hosts.get(entry.mission);
      if (real == null) {
        wrongCount++;
        ok(false, `${label}: ${id} offers ${entry.mission}, which no region hosts`);
        continue;
      }
      if (entry.regionCount != real) {
        wrongCount++;
        if (wrongCount <= 3)
          ok(false, `${label}: ${id} says ${entry.mission} is in ${entry.regionCount} regions, the walk says ${real}`);
      }
    }
  }
  ok(wrongCount == 0, `${label}: every regionCount agrees with the direct walk`);

  // The list is read top-down as "rarest first", which is what makes the first
  // entries the region's speciality
  let unsorted = 0;
  for (let id of expected.keys()) {
    let list = rul.missionsIn(id);
    for (let i = 1; i < list.length; i++)
      if (list[i].regionCount < list[i - 1].regionCount) {
        unsorted++;
        break;
      }
  }
  ok(unsorted == 0, `${label}: every region's list is rarest-first`);

  // A region with no mission must report none rather than throwing
  let empty = [...expected].filter(([, missions]) => !missions.size).map(([id]) => id);
  ok(empty.every(id => rul.missionsIn(id).length == 0), `${label}: an empty region reports no mission`);

  let solo = 0;
  for (let mission of hosts.values())
    if (mission == 1)
      solo++;
  return { regions: regions.length, scripts: scripts.length, missions: hosts.size, solo };
}

let builtin = check(await loadBuiltinPack(), "builtins");

// The real packs are the interesting ones: hundreds of scripts, and almost every
// region reachable through the weighted fallback
let checked = [builtin];
for (let name of ["Dioxine_XPiratez_noimages.rar", "openxcom_xfiles_42.zip"]) {
  let path = examplePack(name);
  if (!path)
    continue;
  checked.push(check(await loadPack(path), name.replace(/\.(zip|rar)$/i, "")));
}

ok(checked.length > 0, "at least the builtins were checked");

report();
