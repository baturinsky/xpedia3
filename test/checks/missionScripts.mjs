/**
 * Every mission script must produce a schedule section that can be read.
 *
 * The schedule page composes sentences out of `src/ui/schedule.ts`, and a field
 * it misreads prints nonsense rather than throwing: "from month 9 until month 3",
 * "month null", a delay that disagrees with the engine's own `getDelay()`. So
 * each script is put through the same functions the page uses, and the answers
 * are checked against the engine's arithmetic and against each other.
 */

import {
  calendarMonth,
  monthWindow,
  researchGate,
  runLimit,
  scriptDelay,
} from "../.gen/schedule.mjs";
import { ok, report } from "../helpers/check.mjs";
import { examplePack, loadBuiltinPack, loadPack } from "../helpers/packs.mjs";

/**
 * The month shapes the schedule page can draw.
 *
 * Every branch of the month sentence is a separate piece of layout, so a shape
 * no pack produces has never been rendered. The tally is checked after the packs
 * are read, rather than per script, because a single script cannot show it.
 */
const shapes = { anyMonth: 0, fromMonth: 0, inMonth: 0, range: 0, foundingOnly: 0 };

const limits = ["minScore", "maxScore", "minFunds", "maxFunds", "minDifficulty", "maxDifficulty"];

function check(rul, label) {
  const scripts = Object.values(rul.missionScripts ?? {});

  for (const script of scripts) {
    const where = `${label}: ${script.id}`;
    const window = monthWindow(script);

    // The month sentence has to resolve to one of the shapes the page draws
    if (window.open && window.first <= 1) shapes.anyMonth++;
    else if (window.open) shapes.fromMonth++;
    else if (window.single && calendarMonth(window.last) == null) shapes.foundingOnly++;
    else if (window.single) shapes.inMonth++;
    else shapes.range++;

    // A closed window that starts after it ends can never run, and would be
    // printed as "from month 9 until month 3"
    ok(
      window.open || window.first <= window.last,
      `${where}: window ${window.first}..${window.last} is empty`,
    );
    // The page prints months as a reader numbers them, so a negative one is a bug
    ok(
      calendarMonth(window.first) == null || calendarMonth(window.first) >= 1,
      `${where}: first month is printable`,
    );

    // The delay is the engine's `getDelay()`: startDelay + rand(0, randomDelay),
    // inclusive. A result of 0 replaces nothing and defers to the wave's timer.
    // An all-zero delay may delegate, which `schedule.mjs` pins on its own: no
    // real pack states a zero pair, so it cannot be met here.
    if (script.startDelay != null || script.randomDelay != null) {
      const base = Number(script.startDelay ?? 0);
      const extra = Number(script.randomDelay ?? 0);
      const delay = scriptDelay(script);
      ok(delay.min == base, `${where}: delay min ${delay.min} != startDelay ${base}`);
      ok(delay.max == base + extra, `${where}: delay max ${delay.max} != ${base}+${extra}`);
      // `formatDelay` returns null for a zero span, and the page reads that as
      // "at once", so a negative cannot reach it
      ok(delay.min >= 0 && delay.max >= 0, `${where}: delay is not negative`);
    }

    // `maxRuns` makes the page count runs, which needs a `varName` to name them
    if (runLimit(script).limited) {
      ok(!!script.varName, `${where}: maxRuns without varName`);
      ok(Number(script.maxRuns) >= 0, `${where}: maxRuns ${script.maxRuns} is not a count`);
    }

    // A gate split into needed and forbidden must not report the same id twice
    const gate = researchGate(script);
    if (gate) {
      const both = gate.needed.filter((id) => gate.forbidden.includes(id));
      ok(both.length == 0, `${where}: ${both.join(",")} is both needed and forbidden`);
    }

    // A numeric field the page prints must be a number when the pack states one
    for (const field of ["executionOdds", ...limits])
      if (script[field] != null)
        ok(Number.isFinite(Number(script[field])), `${where}: ${field} is not a number`);
  }

  return scripts.length;
}

// The builtins carry no mission script of their own, so on a checkout without
// the example packs there is nothing here to read and nothing to assert.
let total = check(await loadBuiltinPack(), "builtins");
let examples = 0;

for (const name of ["Dioxine_XPiratez_noimages.rar", "openxcom_xfiles_42.zip"]) {
  const path = examplePack(name);
  if (!path) continue;
  const scripts = check(await loadPack(path), name.replace(/\.(zip|rar)$/i, ""));
  ok(scripts > 0, `${name}: has mission scripts to check`);
  total += scripts;
  examples++;
}

if (examples == 0) {
  console.log("  no example pack present, nothing to read");
} else {
  // Every branch of the month sentence must be reached by the packs at hand, or
  // the component has a shape nothing here has ever rendered
  const unrendered = Object.entries(shapes)
    .filter(([, n]) => n == 0)
    .map(([name]) => name);
  ok(unrendered.length == 0, "every month shape is produced by these packs", unrendered.join(", "));
  ok(total > 0, "some mission script was checked");
}

report();
