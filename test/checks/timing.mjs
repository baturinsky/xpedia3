/**
 * `src/ui/timing.ts`: the durations a page prints.
 *
 * These are pure functions with an opinionated output — "3–9 d" rather than
 * "9000" — so the interesting part is the wording at each unit boundary, which
 * is what is pinned here.
 */
import { eq, report } from "../helpers/check.mjs";
import { formatDelay, formatMinutes, formatSeconds, waveDelay } from "../.gen/timing.mjs";

// --- minutes to a readable span ---------------------------------------------
eq(formatMinutes(0), "0 min", "zero");
eq(formatMinutes(59), "59 min", "just under an hour");
eq(formatMinutes(60), "1 h", "one hour");
eq(formatMinutes(90), "1.5 h", "half an hour keeps one decimal");
eq(formatMinutes(1439), "24 h", "just under a day is rounded hours");
eq(formatMinutes(1440), "1 d", "one day");
// Days are whole numbers: a tenth of a day is not a unit anyone reads
eq(formatMinutes(4410), "3 d", "three days");
eq(formatMinutes(12960), "9 d", "nine days");
eq(formatMinutes(-5), "0 min", "a negative span clamps");

// --- seconds, for the stays on the ground -----------------------------------
eq(formatSeconds(0), "0 s", "no wait");
eq(formatSeconds(30), "30 s", "under a minute");
eq(formatSeconds(60), "1 min", "a minute reads as minutes");
eq(formatSeconds(3000), "50 min", "groundTimer ticks are seconds");

// --- a wave's timer, which the engine halves and rolls ----------------------
// `(ticks/2 + rand(0, ticks)) * 30` with `ticks = timer / 30`, so 900 is
// three quarters of an hour to an hour and a half
eq(waveDelay(900), { min: 450, max: 1350 }, "the usual 900");
eq(waveDelay(0), { min: 0, max: 0 }, "no timer");
// The integer division the engine does first is repeated, or a timer that is
// not a multiple of 30 would disagree with the game
eq(waveDelay(20), { min: 0, max: 0 }, "less than one tick is no ticks");
eq(waveDelay(45), { min: 0, max: 30 }, "one tick");
eq(waveDelay("600"), { min: 300, max: 900 }, "a quoted number");
eq(waveDelay(-1), undefined, "a negative timer is not a duration");
eq(waveDelay(undefined), undefined, "a missing timer is not a duration");
eq(waveDelay("soon"), undefined, "text is not a duration");

// --- the printed delay ------------------------------------------------------
eq(formatDelay({ min: 0, max: 0 }), null, "no wait reads as 'at once' by the page");
eq(formatDelay({ min: 30, max: 30 }), "30 min", "a fixed delay is one number");
// Both ends land in hours here, so the unit is printed once
eq(formatDelay({ min: 450, max: 1350 }), "7.5–23 h", "a range inside one unit keeps the unit once");
// Two units are not merged: "12 h–3 d" is clearer than "0.5 d–3 d"
eq(formatDelay({ min: 720, max: 4320 }), "12 h–3 d", "a range across units spells both");

report();
