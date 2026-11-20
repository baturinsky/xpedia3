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
  const out = new Set();
  const walk = (obj) => {
    if (obj == null || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    for (const [key, value] of Object.entries(obj)) {
      // A numeric key is a month or a difficulty, never an id
      if (!/^\d+$/.test(key)) out.add(key);
      walk(value);
    }
  };
  walk(weights);
  return out;
}

/** The independent walk of the same rule, region id -> mission ids */
function expectedMissions(rul) {
  const expected = new Map();
  for (const region of Object.values(rul.regions ?? {})) {
    const weighted = region.regionWeight != null && region.regionWeight > 0;
    const missions = new Set();
    for (const script of Object.values(rul.missionScripts ?? {})) {
      const named = idsIn(script.regionWeights);
      // No script-level choice means the strategy's weighted table, so every
      // weighted region is a candidate
      const reaches = named.size ? named.has(region.uid) : weighted;
      if (!reaches) continue;
      for (const mission of idsIn(script.missionWeights)) missions.add(mission);
    }
    expected.set(region.uid, missions);
  }
  return expected;
}

/**
 * `Ruleset.flightsIn`: the paths a region's missions actually fly.
 *
 * The rule this replaces was structural — "the region has enough zones for the
 * path's indices" — and it passed for paths no mission in the pack flies at all,
 * so a region page could show lines belonging to no flight. The three things
 * checked here are what makes the list trustworthy: every path is flown by a
 * mission the region can host, no path is repeated, and the path can be drawn in
 * the region (which is the only reason any is left out).
 */
function checkFlights(rul, label, expected) {
  let bad = 0,
    repeated = 0,
    undrawable = 0,
    untraceable = 0;
  let flights = 0;
  for (const [id, missions] of expected) {
    const region = rul.regions[id];
    // Every path named by a wave of a mission this region hosts
    const flown = new Set();
    for (const mission of missions)
      for (const wave of rul.alienMissions?.[mission]?.waves ?? [])
        if (wave?.trajectory) flown.add(wave.trajectory);

    const got = rul.flightsIn(id);
    flights += got.length;
    const seen = new Set();
    for (const path of got) {
      if (seen.has(path.uid)) {
        repeated++;
        if (repeated <= 3) ok(false, `${label}: ${id} lists ${path.uid} twice`);
      }
      seen.add(path.uid);
      if (!flown.has(path.uid)) {
        untraceable++;
        if (untraceable <= 3)
          ok(false, `${label}: ${id} lists ${path.uid}, which none of its missions flies`);
      }
      // A path that cannot be placed on this region's map is the one legitimate
      // omission, so anything returned has to be drawable
      if (!path.fits(region)) {
        undrawable++;
        if (undrawable <= 3)
          ok(false, `${label}: ${id} lists ${path.uid}, which its zones cannot draw`);
      }
    }

    // Nothing flown and drawable may be dropped: the list is meant to be complete
    for (const traj of flown) {
      const path = rul.ufoTrajectories?.[traj];
      if (path?.fits(region) && !seen.has(traj)) {
        bad++;
        if (bad <= 3)
          ok(false, `${label}: ${id} omits ${traj}, flown by its missions and drawable here`);
      }
    }
  }
  ok(bad === 0, `${label}: every drawable flight a region's missions send is listed`);
  ok(undrawable === 0, `${label}: every listed flight can be drawn in its region`);
  ok(untraceable === 0, `${label}: every listed flight is flown by a mission of that region`);
  ok(repeated === 0, `${label}: no flight is listed twice`);
  return flights;
}

function check(rul, label) {
  const expected = expectedMissions(rul);
  const regions = Object.keys(rul.regions ?? {});
  const scripts = Object.keys(rul.missionScripts ?? {});
  ok(regions.length > 0 || scripts.length === 0, `${label}: regions present when scripts are`);

  for (const [id, missions] of expected) {
    const got = rul.missionsIn(id);
    // A region can host the same mission through several scripts; the page shows
    // it once, so the two counts are comparable
    eq(
      got.length,
      missions.size,
      `${label}: ${id} mission count`,
      got.map((e) => e.mission).join(","),
    );
    ok(
      new Set(got.map((e) => e.mission)).size === got.length,
      `${label}: ${id} has no duplicate mission`,
    );
  }

  // How many regions really host each mission, recounted from the same walk
  const hosts = new Map();
  for (const missions of expected.values())
    for (const mission of missions) hosts.set(mission, (hosts.get(mission) ?? 0) + 1);

  let wrongCount = 0;
  for (const [id] of expected) {
    for (const entry of rul.missionsIn(id)) {
      const real = hosts.get(entry.mission);
      if (real == null) {
        wrongCount++;
        ok(false, `${label}: ${id} offers ${entry.mission}, which no region hosts`);
        continue;
      }
      if (entry.regionCount !== real) {
        wrongCount++;
        if (wrongCount <= 3)
          ok(
            false,
            `${label}: ${id} says ${entry.mission} is in ${entry.regionCount} regions, the walk says ${real}`,
          );
      }
    }
  }
  ok(wrongCount === 0, `${label}: every regionCount agrees with the direct walk`);

  // The list is read top-down as "rarest first", which is what makes the first
  // entries the region's speciality
  let unsorted = 0;
  for (const id of expected.keys()) {
    const list = rul.missionsIn(id);
    for (let i = 1; i < list.length; i++)
      if (list[i].regionCount < list[i - 1].regionCount) {
        unsorted++;
        break;
      }
  }
  ok(unsorted === 0, `${label}: every region's list is rarest-first`);

  // A region with no mission must report none rather than throwing
  const empty = [...expected].filter(([, missions]) => !missions.size).map(([id]) => id);
  ok(
    empty.every((id) => rul.missionsIn(id).length === 0),
    `${label}: an empty region reports no mission`,
  );

  checkFlights(rul, label, expected);

  let solo = 0;
  for (const mission of hosts.values()) if (mission === 1) solo++;
  return { regions: regions.length, scripts: scripts.length, missions: hosts.size, solo };
}

const builtin = check(await loadBuiltinPack(), "builtins");

// The real packs are the interesting ones: hundreds of scripts, and almost every
// region reachable through the weighted fallback
const checked = [builtin];
for (const name of ["Dioxine_XPiratez_noimages.rar", "openxcom_xfiles_42.zip"]) {
  const path = examplePack(name);
  if (!path) continue;
  checked.push(check(await loadPack(path), name.replace(/\.(zip|rar)$/i, "")));
}

ok(checked.length > 0, "at least the builtins were checked");

report();
