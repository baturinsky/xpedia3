/**
 * A mission script's timing, in the terms a player thinks in.
 *
 * The ruleset states it as bare month indices and two raw minute counts, and
 * each of those means something other than it says:
 *
 * - `firstMonth: 0` is not "month zero": it is the extra run the game makes when
 *   the first base is founded, before month 1 exists. Month indices count from 1
 *   once the campaign starts;
 * - `lastMonth: 0` therefore means "only at that first run", not "January", and
 *   the default `-1` means the script never stops;
 * - `startDelay` and `randomDelay` are one rolled number, `startDelay +
 *   rand(0, randomDelay)` with an inclusive generator, and a non-zero result
 *   *replaces* the mission's own first-wave timer rather than adding to it;
 * - `executionOdds` is rolled once per script per month, so it is the chance of
 *   this script firing in any given eligible month, not of it ever firing.
 *
 * Everything here is a pure function of the script's fields, so the same answers
 * can be checked outside the UI.
 */

/**
 * The mission script fields the timing functions read.
 *
 * A structural type rather than `MissionScript`: these are pure functions of a
 * handful of fields, and stating them here means the answers can still be
 * checked outside the UI, with no entry or ruleset involved. Every field is
 * optional because the ruleset does not require any of them.
 */
export type MissionScriptTiming = {
  firstMonth?: number,
  lastMonth?: number,
  startDelay?: number,
  randomDelay?: number,
  maxRuns?: number,
  researchTriggers?: { [topic: string]: boolean },
};

/**
 * The months a script can run in.
 *
 * `first` and `last` are month indices, with two values that are not numbers of
 * a calendar: `0` is the founding run before month 1, and `last: -1` is no limit.
 * The engine's own test is `firstMonth <= month && (lastMonth >= month ||
 * lastMonth == -1)`.
 */
export type MonthWindow = {
  first: number
  /** -1 when the script never stops */
  last: number
  /** The whole window is one month, so the script can run only once */
  single: boolean
  /** The window is open-ended */
  open: boolean
}

export function monthWindow(entry: MissionScriptTiming): MonthWindow {
  let first = Number(entry?.firstMonth ?? 0);
  let last = entry?.lastMonth == null ? -1 : Number(entry.lastMonth);
  if (!Number.isFinite(first))
    first = 0;
  if (!Number.isFinite(last))
    last = -1;
  return { first, last, single: last >= 0 && first == last, open: last < 0 };
}

/**
 * The wait before the mission's first wave, in minutes.
 *
 * `delegates` is the important flag: with no delay at all the script does not
 * mean "right now", it means "whatever the mission's own first wave says", which
 * is the halved-and-rolled `timer`. The two cases read completely differently and
 * a bare `0` cannot tell them apart.
 */
export type ScriptDelay = {
  min: number
  max: number
  /** No delay stated: the mission's own first-wave timer decides */
  delegates: boolean
}

export function scriptDelay(entry: MissionScriptTiming): ScriptDelay {
  let base = Math.max(0, Number(entry?.startDelay ?? 0) || 0);
  let extra = Math.max(0, Number(entry?.randomDelay ?? 0) || 0);
  return { min: base, max: base + extra, delegates: base == 0 && extra == 0 };
}

/**
 * How many missions the script may create under its `varName`.
 *
 * `-1` is the engine's default and means no limit. This is a different promise
 * from a single-month window: the window is about the calendar, `maxRuns` about
 * the count of missions actually created, and the calendar is the stricter of the
 * two when both are set.
 */
export function runLimit(entry: MissionScriptTiming): { maxRuns: number, limited: boolean } {
  let maxRuns = entry?.maxRuns == null ? -1 : Number(entry.maxRuns);
  if (!Number.isFinite(maxRuns))
    maxRuns = -1;
  return { maxRuns, limited: maxRuns >= 0 };
}

/**
 * A research gate split by what it asks for.
 *
 * `researchTriggers` is a map of topic to wanted state, which is why a bare table
 * of `true`/`false` is nearly unreadable: `STR_COMMANDER_PLUS: true` means the
 * script needs that research, and `STR_MUTANT_SELF_DEFENSE: false` means it must
 * *not* have been made. The engine compares each against `isResearched`.
 */
export type ResearchGate = {
  needed: string[]
  forbidden: string[]
}

export function researchGate(entry: MissionScriptTiming): ResearchGate | undefined {
  let triggers = entry?.researchTriggers;
  if (triggers == null || typeof triggers != "object")
    return undefined;
  let needed: string[] = [];
  let forbidden: string[] = [];
  for (let [topic, wanted] of Object.entries(triggers))
    (wanted ? needed : forbidden).push(topic);
  if (!needed.length && !forbidden.length)
    return undefined;
  return { needed, forbidden };
}

/**
 * A month index as a reader would number it, or `null` for the founding run.
 *
 * Month 0 happens before the campaign's first month exists, so calling it
 * "month 0" would be wrong and calling it "month 1" worse.
 */
export function calendarMonth(index: number): number | null {
  return index == 0 ? null : index;
}
