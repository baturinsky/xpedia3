/**
 * A unit whose armor lives on a separate article borrows that article's
 * sections, so the categories under its title (and the prev/next links they
 * produce) are honest about the armor table embedded on the page. A unit
 * wearing an armor under its own id already shares the article, so nothing
 * changes there; a unit with no armor gains nothing either.
 */
import { ensureBuilt } from "../build.mjs";
import { eq, report } from "../helpers/check.mjs";
import { testPack } from "../helpers/packs.mjs";

await ensureBuilt();

const pack = await testPack({
  rul: [
    "armors:",
    "  - type: STR_A2",
    "  - type: STR_SAME",
    "units:",
    "  - type: STR_U",
    "    armor: STR_A2",
    "  - type: STR_SAME",
    "    armor: STR_SAME",
    "  - type: STR_BARE",
    "items:",
    "  - type: STR_A2",
    "",
  ].join("\n"),
});

const ids = (article) => (article?.sections ?? []).map((s) => s.id).sort();

eq(ids(pack.articles.STR_A2), ["ARMORS", "ITEMS"], "the armor article has its own sections");
eq(
  ids(pack.articles.STR_U),
  ["ARMORS", "ITEMS", "UNITS"],
  "the unit article unions the differently-id armor article's sections",
);
eq(
  pack.sections.ARMORS._articles.some((a) => a.id === "STR_U"),
  true,
  "the borrowed section lists the unit, so its prev/next links reach it",
);
eq(
  ids(pack.articles.STR_SAME),
  ["ARMORS", "UNITS"],
  "a unit wearing an armor under its own id shares the article and gains no duplicates",
);
eq(ids(pack.articles.STR_BARE), ["UNITS"], "a unit with no armor gains no sections");

report();
