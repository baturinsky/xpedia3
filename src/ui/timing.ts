/**
 * Durations as this pedia prints them.
 *
 * The ruleset stores times in several different units, and almost none of them
 * are the unit they are named after: a wave `timer` is minutes that the engine
 * halves and rolls against, a `groundTimer` is five-second ticks. Everything
 * here exists so a page can say "3–9 d" instead of "9000", and so several pages
 * say it the same way.
 */

function round(value: number) {
  return Number(value.toFixed(value < 10 ? 1 : 0));
}

/**
 * A span of minutes as the game's clock would say it.
 *
 * Mission delays run from "at once" to several months, so one unit cannot cover
 * them: minutes are useful for a wave that lands almost immediately, hours for a
 * landing, days for the usual weeks-long gaps. Days are whole numbers because a
 * tenth of a day is not a unit anyone reads: `9000` is "3–9 days", not
 * "3.1–9.4 days". Values past a year stay in days, because "1.4 years" is not how
 * a campaign is measured.
 */
export function formatMinutes(minutes: number): string {
  let mins = Math.max(0, Math.round(minutes));
  if (mins < 60)
    return `${mins} min`;
  let hours = mins / 60;
  if (hours < 24)
    return `${round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}

/** A span of seconds, for the stays on the ground that are not in minutes */
export function formatSeconds(seconds: number): string {
  let secs = Math.max(0, Math.round(seconds));
  return secs < 60 ? `${secs} s` : formatMinutes(secs / 60);
}

/**
 * The wait a wave's `timer` really produces, in minutes.
 *
 * `AlienMission::start` and `think` turn the declared minutes into half-hour
 * ticks and roll `(ticks/2 + rand(0, ticks)) * 30`, so the stated number is the
 * *upper half* of the real spread rather than a delay you can plan around. The
 * integer division the engine does first is repeated here so the range matches
 * the game for a timer that is not a multiple of 30.
 */
export function waveDelay(timer: unknown): { min: number, max: number } | undefined {
  let declared = Number(timer);
  if (!Number.isFinite(declared) || declared < 0)
    return undefined;
  let ticks = Math.floor(declared / 30);
  return {
    min: Math.floor(ticks / 2) * 30,
    max: (Math.floor(ticks / 2) + ticks) * 30,
  };
}

/**
 * `3–9 d`, or one number when the engine would not vary it.
 *
 * `null` means "not a duration at all": the only way that happens is a zero
 * delay, which the engine treats as the next tick rather than as a very short
 * wait, so the article says "at once" instead.
 */
export function formatDelay(delay: { min: number, max: number }): string | null {
  if (delay.max <= 0)
    return null;
  if (delay.max == delay.min)
    return formatMinutes(delay.min);
  // A range reads better with one unit than two: "0–30 min", not "0 min–30 min".
  // Units are only shared when both ends land in the same one, because "12 h–3 d"
  // is clearer than "0.5 d–3 d".
  let [lo, hi] = [formatMinutes(delay.min), formatMinutes(delay.max)];
  let unitOf = (text: string) => text.split(" ").pop();
  if (unitOf(lo) == unitOf(hi))
    return `${lo.replace(/\s*\D+$/, "")}–${hi}`;
  return `${lo}–${hi}`;
}
