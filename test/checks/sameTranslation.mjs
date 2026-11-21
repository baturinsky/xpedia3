/**
 * `Ruleset.sameTranslation`: the "also translated as" index.
 *
 * Several internal lines often carry a byte-for-byte identical translation
 * ("The Academy" for more than one id), which makes the shown label
 * ambiguous. `Tr` puts those twins in the label's tooltip, so the index has
 * to group on the exact stored string, keep file order, and leave tooltip
 * definitions out of the label groups entirely.
 */
import { ensureBuilt } from "../build.mjs";
import { eq, report } from "../helpers/check.mjs";
import { testPack } from "../helpers/packs.mjs";

await ensureBuilt();

const rul = await testPack({
  lang: {
    STR_ACADEMY_A: "The Academy",
    STR_ACADEMY_B: "The Academy",
    STR_ACADEMY_C: "The Academy",
    STR_OTHER: "Something else",
    STR_CASE: "the academy",
    STR_SAME_AS_KEY: "STR_SAME_AS_KEY",
    tip_academy: "The Academy",
    tip_other: "Something else",
  },
});

eq(
  rul.sameTranslation("STR_ACADEMY_A"),
  ["STR_ACADEMY_B", "STR_ACADEMY_C"],
  "a shared translation lists its twins without itself, in file order",
);
eq(
  rul.sameTranslation("STR_ACADEMY_B"),
  ["STR_ACADEMY_A", "STR_ACADEMY_C"],
  "a twin twin-list keeps the rest of the group",
);
eq(rul.sameTranslation("STR_OTHER"), undefined, "a lone translation has no twins");
eq(rul.sameTranslation("STR_CASE"), undefined, "case alone does not count as the same text");
eq(
  rul.sameTranslation("STR_SAME_AS_KEY"),
  undefined,
  "a line whose text is its own key has no twins",
);
eq(rul.sameTranslation("STR_UNDECLARED"), undefined, "a key outside the language has no twins");
eq(
  rul.sameTranslation("STR_ACADEMY_A").includes("tip_academy"),
  false,
  "tip keys never appear as twins",
);

report();
