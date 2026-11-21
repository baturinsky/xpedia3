/**
 * `src/ui/raceWeights.ts`: `alienMissions.raceWeights` as the player meets it.
 *
 * The engine rolls the race with probability weight ÷ total in the month
 * bucket that covers `monthsPassed`, so the check counts each race's share
 * as a per cent. Fixtures are the real XPiratez `STR_MISSION_NAZI` 90/10
 * and a two-bucket moving table.
 */
import { ensureBuilt } from "../build.mjs";
import { eq, report } from "../helpers/check.mjs";
import { testPack } from "../helpers/packs.mjs";

await ensureBuilt();
const { parseRaceWeights, raceWeightPercent } = await import("../.gen/raceweights.mjs");

// XPiratez `STR_MISSION_NAZI`: one row, 90/10
const nazi = parseRaceWeights({ 0: { STR_NAZIS: 90, STR_ZOMBIE_SMART: 10 } });
eq(nazi.races, ["STR_NAZIS", "STR_ZOMBIE_SMART"], "Nazi races in order");
eq(nazi.months.length, 1, "Nazi has one month bucket");
eq(nazi.months[0].month, 0, "the bucket starts at month 0 (month 1 to a player)");
eq(nazi.months[0].total, 100, "Nazi weights total");
eq(raceWeightPercent(90, 100), 90, "90 of 100 is 90%");
eq(raceWeightPercent(10, 100), 10, "10 of 100 is 10%");

// Relative, not absolute: 45 next to 10 is not 45%
eq(raceWeightPercent(45, 55), 82, "45 of 55 rounds to 82%");
eq(raceWeightPercent(1, 3), 33, "1 of 3 rounds to 33%");
eq(raceWeightPercent(1, 0), 0, "no total, no chance");
eq(raceWeightPercent(NaN, 100), 0, "a non-numeric weight is no chance");

// A moving table: month 0 holds until month 3, then the second row replaces it
const moving = parseRaceWeights({
  0: { STR_BANDIT_TOWN: 100 },
  3: { STR_SECTOID: 50, STR_BANDIT_TOWN: 50 },
});
eq(moving.races, ["STR_BANDIT_TOWN", "STR_SECTOID"], "races union in first-seen order");
eq(
  moving.months.map((m) => m.month),
  [0, 3],
  "buckets sorted by month",
);
eq(moving.months[1].total, 100, "second row total");

// Empty and junk mean no race, the caller's fallback note
eq(parseRaceWeights({}).months, [], "empty table, no races");
eq(parseRaceWeights({}).races, [], "empty table, no race list");
eq(parseRaceWeights(undefined).months, [], "no table, no races");
eq(parseRaceWeights({ 0: { STR_A: 0, STR_B: -5 } }).months, [], "non-positive weights are dropped");
eq(parseRaceWeights({ x: { STR_A: 10 } }).months, [], "a non-month key is dropped");
eq(parseRaceWeights([["STR_A", 10]]).months, [], "a list is not a table");

// The engine merges each layer's `raceWeights` month by month and race by
// race (`RuleAlienMission::load`), so a later `raceWeights: {}` keeps the
// base table. The ruleset merge used to file the last block's `{}`; the
// replay in `parseRuls` restores the inherited table. Blocks of one file
// merge in file order, so they stand in for successive mod layers here.

// Inherit through `{}`: the second block is the Piratez supply-ship shape
const inherited = await testPack({
  rul: [
    "alienMissions:",
    "  - type: STR_INHERITED_MISSION",
    "    raceWeights:",
    "      0:",
    "        STR_A: 70",
    "        STR_B: 30",
    "      3:",
    "        STR_A: 50",
    "        STR_C: 50",
    "  - type: STR_INHERITED_MISSION",
    "    raceWeights: {}",
    "  - type: STR_NO_WEIGHTS_MISSION",
    "    raceWeights: {}",
    "",
  ].join("\n"),
});
eq(
  inherited.alienMissions.STR_INHERITED_MISSION.raceWeights,
  { 0: { STR_A: 70, STR_B: 30 }, 3: { STR_A: 50, STR_C: 50 } },
  "an empty table inherits the base weights",
);
eq(
  inherited.alienMissions.STR_NO_WEIGHTS_MISSION.raceWeights,
  {},
  "a mission with no weights anywhere stays empty",
);

// A later layer reweights one race, zeroes another away, and adds a month:
// everything the earlier layers stated and the override did not touch stays.
const overridden = await testPack({
  rul: [
    "alienMissions:",
    "  - type: STR_OVERRIDDEN_MISSION",
    "    raceWeights:",
    "      0:",
    "        STR_A: 100",
    "        STR_B: 50",
    "      2:",
    "        STR_A: 10",
    "  - type: STR_OVERRIDDEN_MISSION",
    "    raceWeights:",
    "      0:",
    "        STR_A: 20",
    "        STR_B: 0",
    "      4:",
    "        STR_C: 5",
    "",
  ].join("\n"),
});
eq(
  overridden.alienMissions.STR_OVERRIDDEN_MISSION.raceWeights,
  { 0: { STR_A: 20 }, 2: { STR_A: 10 }, 4: { STR_C: 5 } },
  "later layers merge per race, and weight 0 removes",
);

// A deleted mission starts afresh: the block after the delete owns the table.
const recreated = await testPack({
  rul: [
    "alienMissions:",
    "  - type: STR_RECREATED_MISSION",
    "    raceWeights:",
    "      0:",
    "        STR_A: 100",
    "  - delete: STR_RECREATED_MISSION",
    "  - type: STR_RECREATED_MISSION",
    "    raceWeights:",
    "      0:",
    "        STR_B: 10",
    "",
  ].join("\n"),
});
eq(
  recreated.alienMissions.STR_RECREATED_MISSION.raceWeights,
  { 0: { STR_B: 10 } },
  "a delete clears the inherited table",
);

// Globe textures are parsed off the merged `globe` node: a site mission with
// no `siteType` fights whatever its area's texture rolls, so the pedia keeps
// the texture → deployments map the engine rolls from.
const textured = await testPack({
  rul: [
    "globe:",
    "  textures:",
    "    - id: -47",
    "      deployments:",
    "        STR_LOC_COMMS_TOWER_COLD: 100",
    "    - id: -300",
    "      deployments:",
    "        STR_LOC_SPACE_STATION_1: 20",
    "        STR_LOC_SPACE_STATION_2: 20",
    "    - id: 0",
    "",
  ].join("\n"),
});
eq(
  textured.textures["-47"],
  { deployments: { STR_LOC_COMMS_TOWER_COLD: 100 } },
  "a texture keeps its deployments map",
);
eq(
  textured.textures["-300"],
  { deployments: { STR_LOC_SPACE_STATION_1: 20, STR_LOC_SPACE_STATION_2: 20 } },
  "a multi-deployment texture keeps every entry",
);
eq(textured.textures["0"], {}, "a texture with no deployments stays bare");
eq(
  [...Object.keys(textured.textures)].sort(),
  ["-300", "-47", "0"].sort(),
  "every texture id is kept",
);

report();
