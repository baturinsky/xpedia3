/**
 * Unit encounter sources behind the "Where encountered" subtable.
 *
 * A unit reaches the battlescape through `alienDeployments` rows — a
 * `customUnitType` names it outright, otherwise its rank resolves through the
 * deployment's race. Missions and UFOs come via the unit's races (`raceWeights`
 * backlinks into race `missions`, waves into UFOs). The in-battle production
 * routes are backlinks: an item's `spawnUnit` (`spawnedBy`), a unit's
 * `spawnUnit` turning it into another unit (`convertedFrom`), a kill by a
 * `zombieUnit` item reanimating the victim (`zombifiedBy`), and a terrain's
 * `civilianTypes` (`terrains`).
 */
import { ensureBuilt } from "../build.mjs";
import { eq, report } from "../helpers/check.mjs";
import { testPack } from "../helpers/packs.mjs";

await ensureBuilt();
const {
  asIdList,
  deploymentsForUnit,
  deploymentsSpawningUnit,
  missionsForUnit,
  racesForUnit,
  ufosForUnit,
} = await import("../.gen/unitencounters.mjs");

eq(asIdList(undefined), [], "an absent field is an empty list");
eq(asIdList("STR_A"), ["STR_A"], "a lone id is a one-item list");
eq(asIdList(["STR_B", "STR_A", "STR_A"]), ["STR_A", "STR_B"], "ids are deduped and sorted");

// A race the unit states outright plus the races whose `members` name it
eq(
  racesForUnit({ race: "STR_R1", memberOf: ["STR_R2", "STR_R1"] }),
  ["STR_R1", "STR_R2"],
  "stated race and memberOf races union",
);
eq(racesForUnit({}), [], "a unit in no race has no races");

// Missions are correct at race level: the race's `missions` backlink already
// lists every mission whose `raceWeights` name the race
{
  const tables = {
    alienRaces: {
      STR_R1: { missions: ["STR_M1", "STR_M2"] },
      STR_R2: { missions: ["STR_M2", "STR_M3"] },
      STR_R3: { missions: [] },
    },
  };
  eq(
    missionsForUnit(["STR_R1", "STR_R2"], tables),
    ["STR_M1", "STR_M2", "STR_M3"],
    "missions union across races",
  );
  eq(missionsForUnit(["STR_R3"], tables), [], "a race in no mission yields no missions");
}

// A wave may name a deployment instead of a UFO, and only real UFOs count
{
  const tables = {
    alienMissions: {
      STR_M1: {
        waves: [{ ufo: "STR_U1" }, { ufo: "STR_D1" }, { ufo: "STR_GONE" }, { ufo: "STR_U1" }],
      },
      STR_M2: { waves: [{ ufo: "STR_U2" }] },
      STR_M3: { waves: [] },
    },
    ufos: { STR_U1: {}, STR_U2: {} },
  };
  eq(ufosForUnit(["STR_M1", "STR_M2"], tables), ["STR_U1", "STR_U2"], "UFOs union across waves");
  eq(ufosForUnit(["STR_M3"], tables), [], "a mission fielding no UFO yields none");
}

// Deployments: rank rows resolve through the stated race, `customUnitType`
// overrides, reinforcements waves count, and `civiliansByType` needs no row
{
  const tables = {
    alienDeployments: {
      STR_D1: {
        race: "STR_R1",
        data: [{ alienRank: 0 }, { alienRank: 1 }, { customUnitType: "STR_C" }],
      },
      STR_D2: { civiliansByType: { STR_CIV: 5 }, data: [] },
      STR_D3: { race: "STR_R1", reinforcements: [{ data: [{ alienRank: 1 }] }] },
    },
    alienRaces: { STR_R1: { members: ["STR_A", "STR_B"] } },
  };
  eq(deploymentsSpawningUnit("STR_A", tables), ["STR_D1"], "rank 0 resolves to the first member");
  eq(
    deploymentsSpawningUnit("STR_B", tables),
    ["STR_D1", "STR_D3"],
    "rank 1 resolves in the main and reinforcements rows",
  );
  eq(deploymentsSpawningUnit("STR_C", tables), ["STR_D1"], "customUnitType wins without a rank");
  eq(
    deploymentsSpawningUnit("STR_CIV", tables),
    ["STR_D2"],
    "civiliansByType spawns without a row",
  );
  eq(deploymentsSpawningUnit("STR_NOBODY", tables), [], "a unit nothing spawns is nowhere");

  eq(
    deploymentsForUnit("STR_B", tables),
    ["STR_D1", "STR_D3"],
    "the indexed lookup agrees with the scan",
  );
  eq(deploymentsForUnit("STR_CIV", tables), ["STR_D2"], "the index carries civilians too");
}

// In-battle production and civilian-terrain backlinks, from a small pack
{
  const pack = await testPack({
    rul: [
      "items:",
      "  - type: STR_NET",
      "    spawnUnit: STR_NET_TARGET",
      "  - type: STR_ZOM",
      "    zombieUnit: STR_ZOM_TARGET",
      "  - type: STR_ZOM_ARMOR",
      "    zombieUnitByArmorMale:",
      "      STR_SOME_ARMOR: STR_ZOM_ARMOR_TARGET",
      "units:",
      "  - type: STR_NET_TARGET",
      "  - type: STR_ZOM_TARGET",
      "  - type: STR_ZOM_ARMOR_TARGET",
      "  - type: STR_CONVERTER",
      "    spawnUnit: STR_CONVERTED",
      "  - type: STR_CONVERTED",
      "  - type: STR_CIV",
      "terrains:",
      "  - type: STR_TERRAIN",
      "    civilianTypes: [STR_CIV]",
      "",
    ].join("\n"),
  });

  eq(pack.units.STR_NET_TARGET?.spawnedBy, ["STR_NET"], "an item's spawnUnit backlinks the unit");
  eq(
    pack.units.STR_CONVERTED?.convertedFrom,
    ["STR_CONVERTER"],
    "a unit's spawnUnit backlinks its conversion target",
  );
  eq(pack.units.STR_ZOM_TARGET?.zombifiedBy, ["STR_ZOM"], "a plain zombieUnit backlinks its unit");
  eq(
    pack.units.STR_ZOM_ARMOR_TARGET?.zombifiedBy,
    ["STR_ZOM_ARMOR"],
    "a per-armor zombieUnit backlinks its unit",
  );
  eq(pack.units.STR_CIV?.terrains, ["STR_TERRAIN"], "a terrain's civilianTypes backlinks the unit");
}

report();
