/**
 * The little a check needs to report a failure, and to fail the run.
 *
 * A check is a plain script that exits non-zero when something is wrong, which
 * is what `npm test` reads. Saying `FAIL` and carrying on is only useful while
 * writing one, so the count is turned into the exit code at the end, and the
 * failures are summarised where they are easy to find.
 */
let failures = 0;
let total = 0;

/** Whether `actual` and `expected` print the same, naming the case when they do not */
export function eq(actual, expected, what) {
  total++;
  const a = JSON.stringify(actual),
    e = JSON.stringify(expected);
  if (a === e) return true;
  failures++;
  console.log(`  FAIL ${what}: ${a} != ${e}`);
  return false;
}

/** The same, for a bare condition */
export function ok(condition, what, detail) {
  total++;
  if (condition) return true;
  failures++;
  console.log(`  FAIL ${what}${detail == null ? "" : ": " + detail}`);
  return false;
}

/** Prints the tally and sets the exit code, at the end of a check */
export function report() {
  if (!failures) {
    console.log(`  ${total} assertion(s) passed`);
    return;
  }
  console.log(`\n${failures} of ${total} assertion(s) failed`);
  process.exitCode = 1;
}
