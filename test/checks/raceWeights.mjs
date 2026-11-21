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

report();
