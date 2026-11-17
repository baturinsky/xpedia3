/**
 * `src/ui/schedule.ts`: a mission script's timing.
 *
 * Every answer here is a claim about what the engine would do with the fields,
 * so each case is written from the engine's own test rather than from what the
 * function happens to return.
 */
import { eq, report } from "../helpers/check.mjs";
import {
  calendarMonth, monthWindow, researchGate, runLimit, scriptDelay,
} from "../.gen/schedule.mjs";

// --- the months a script can run in ----------------------------------------
eq(monthWindow({}), { first: 0, last: -1, single: false, open: true }, "no fields is never closed");
eq(monthWindow({ firstMonth: 3 }), { first: 3, last: -1, single: false, open: true }, "first only");
// `lastMonth: 0` is the founding run, not January, so it closes at month 0
eq(monthWindow({ lastMonth: 0 }), { first: 0, last: 0, single: true, open: false }, "lastMonth 0 runs once");
eq(monthWindow({ firstMonth: 5, lastMonth: 5 }), { first: 5, last: 5, single: true, open: false }, "same month");
eq(monthWindow({ firstMonth: 2, lastMonth: 9 }), { first: 2, last: 9, single: false, open: false }, "a range");
eq(monthWindow({ firstMonth: 0, lastMonth: 0 }), { first: 0, last: 0, single: true, open: false }, "founding run only");
// The engine compares the fields as numbers, so quoted values arrive as such
eq(monthWindow({ firstMonth: "4", lastMonth: "6" }).first, 4, "a quoted first month");
// A field the pack leaves as text cannot mean a month, so it takes the default
eq(monthWindow({ firstMonth: "soon", lastMonth: "later" }), { first: 0, last: -1, single: false, open: true },
  "unreadable months fall back to the default window");

// --- the wait before the first wave ---------------------------------------
// getDelay() is `startDelay + rand(0, randomDelay)`, inclusive, so both ends count
eq(scriptDelay({}), { min: 0, max: 0, delegates: true }, "no delay delegates to the wave");
eq(scriptDelay({ startDelay: 30 }), { min: 30, max: 30, delegates: false }, "a fixed delay");
eq(scriptDelay({ startDelay: 30, randomDelay: 43500 }), { min: 30, max: 43530, delegates: false },
  "XFiles' usual");
eq(scriptDelay({ randomDelay: 600 }), { min: 0, max: 600, delegates: false }, "random only");
// Explicit zeros still delegate: the field being stated does not make it a wait
eq(scriptDelay({ startDelay: 0, randomDelay: 0 }).delegates, true, "explicit zeros still delegate");
eq(scriptDelay({ startDelay: -50 }), { min: 0, max: 0, delegates: true }, "a negative delay cannot roll back the clock");

// --- how many missions the script may create ------------------------------
eq(runLimit({}), { maxRuns: -1, limited: false }, "no maxRuns is unlimited");
eq(runLimit({ maxRuns: -1 }), { maxRuns: -1, limited: false }, "-1 is unlimited");
eq(runLimit({ maxRuns: 1 }), { maxRuns: 1, limited: true }, "one run");
// Zero runs is a real statement, not "unlimited": it reads as a disabled script
eq(runLimit({ maxRuns: 0 }), { maxRuns: 0, limited: true }, "zero runs is still stated");

// --- a research gate, split by the state it asks for ----------------------
eq(researchGate({}), undefined, "no triggers");
eq(researchGate({ researchTriggers: {} }), undefined, "empty triggers");
eq(researchGate({ researchTriggers: { A: true, B: false } }),
  { needed: ["A"], forbidden: ["B"] }, "split by wanted state");
eq(researchGate({ researchTriggers: { A: false } }), { needed: [], forbidden: ["A"] }, "forbidden only");
eq(researchGate({ researchTriggers: { A: true } }), { needed: ["A"], forbidden: [] }, "needed only");

// --- months as a reader numbers them -------------------------------------
// Month 0 happens before the campaign's first month exists
eq(calendarMonth(0), null, "month 0 is the founding run");
eq(calendarMonth(1), 1, "month 1");
eq(calendarMonth(45), 45, "a late month");

report();
