/**
 * Small value helpers the nested-table renderers all share.
 *
 * They used to be defined verbatim in each renderer (`isEmpty` alone had four
 * copies), so the definition could drift while the meaning never could: a
 * missing field, an empty string and an empty list are all "nothing to say".
 * One definition here keeps them from drifting again.
 */

/** Whether a field is absent or empty — it has nothing to say */
export function isEmpty(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** A scalar or a one-value list, as a list */
export function asItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** A stated number, or nothing when the value is absent or not numeric */
export function asNumber(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/**
 * One part's share of a whole, as a per cent rounded to a whole number.
 *
 * Both chance tables count this way — `raceWeights` per month row, loadouts
 * per tech level — so the rounding lives here rather than once per caller.
 * An invalid whole counts as zero rather than `NaN`, since the tables call
 * this on values pulled out of a ruleset node.
 */
export function sharePercent(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((part / total) * 100);
}
