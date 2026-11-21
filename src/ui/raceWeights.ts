/**
 * `alienMissions.raceWeights` as the player meets it: which race flies the
 * mission, and how often, in each phase of the campaign.
 *
 * The engine stores it as month → race → relative weight, read in
 * `RuleAlienMission::generateRace` (`month = monthsPassed` when the mission
 * is created) and rolled in `WeightedOptions::choose`, where the winner is
 * picked with probability weight ÷ total. A raw `90` therefore means the
 * same as `45` next to a `10` — only the share matters — so the table
 * counts each race's share as a per cent in its month window. Each row
 * holds from its month until the next row starts; months are counted from
 * 1, the way a player counts campaign months. An empty table
 * (`raceWeights: {}`) states no race: the race then comes from the alien
 * base or the mission script that starts the mission.
 */

/** One month slice of `raceWeights`, parsed for the table */
export type RaceMonth = {
  /** Months passed at which this row starts (the ruleset key) */
  month: number;
  weights: Map<string, number>;
  total: number;
};

/** Parse `raceWeights` into sorted month buckets and the union of races */
export function parseRaceWeights(value: unknown): { months: RaceMonth[]; races: string[] } {
  if (typeof value !== "object" || value == null || Array.isArray(value))
    return { months: [], races: [] };
  const months: RaceMonth[] = [];
  const races: string[] = [];
  const entries = Object.entries(value as { [month: string]: unknown }).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  for (const [monthKey, bucket] of entries) {
    const month = Number(monthKey);
    if (!Number.isInteger(month) || typeof bucket !== "object" || bucket == null) continue;
    const weights = new Map<string, number>();
    for (const [race, raw] of Object.entries(bucket as { [race: string]: unknown })) {
      if (race === "") continue;
      const weight = Number(raw);
      if (!Number.isFinite(weight) || weight <= 0) continue;
      weights.set(race, weight);
      if (!races.includes(race)) races.push(race);
    }
    if (weights.size === 0) continue;
    const total = [...weights.values()].reduce((sum, w) => sum + w, 0);
    months.push({ month, weights, total });
  }
  return { months, races };
}

/** A race's share of a month row, as a per cent of the row's total weight */
export function raceWeightPercent(weight: number, total: number): number {
  if (!Number.isFinite(weight) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((weight / total) * 100);
}
