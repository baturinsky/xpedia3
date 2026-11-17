/**
 * The pedia is a ring of sections, and `<`/`>` walks it without ever stalling.
 *
 * Three things have to hold, because they are what the reader sees:
 *
 *  - No step lands on an entry that has no page. A block named by `type` or
 *    `name` used to lose that name to a seeded empty id, filing its whole table
 *    under one blank entry: the arrows then linked to a field dump instead of an
 *    article, and RESEARCH held 1 entry instead of thousands.
 *  - Every article is reachable from its own section by walking forward, and the
 *    section the step reports is the one it landed in.
 *  - Stepping off either end of a section lands in the neighbouring one *that
 *    has articles*, and the two ends wrap: the pedia is a ring, not a line.
 *
 * The order is the one the sidebar shows, so both settings are walked. The
 * category order follows the `A-Z` toggle while the pedia's own sections keep the
 * order the pack authored.
 */
import { ok, eq, report } from "../helpers/check.mjs";
import { examplePack, loadBuiltinPack, loadPack } from "../helpers/packs.mjs";

/** Walks every section of a ruleset, counting what the arrows would do */
function survey(rul, label) {
  let problems = [];

  function checkEmptyEntries(alphabetical) {
    let empty = [];
    for (let [name, table] of Object.entries(rul)) {
      // Collections are plain tables on `rul`; anything else is not a ruleset
      // table and must not be read as one
      if (table == null || typeof table != "object" || Array.isArray(table) || !Object.keys(table).length)
        continue;
      if ("" in table)
        empty.push(name);
    }
    ok(empty.length == 0, `${label}: no collection is keyed by the empty id`, empty.join(", "));

    let blank = [];
    for (let s of rul.sectionOrder(alphabetical))
      for (let a of s.articles(alphabetical))
        if (!a.id)
          blank.push(s.id);
    ok(blank.length == 0, `${label}: no section lists an article with no id`, blank.join(", "));
  }

  /**
   * Walks one section end to end in the given direction.
   *
   * Inside the list, every step has to land on the next row and stay in the
   * section. The two ends are checked separately, because they cross into the
   * neighbouring section rather than stopping.
   */
  function walk(section, alphabetical) {
    let list = section.articles(alphabetical);
    if (!list.length)
      return;

    for (let i = 0; i + 1 < list.length; i++) {
      let next = rul.nearbyArticle(list[i], 1, section, alphabetical);
      if (!next || next.article != list[i + 1] || next.section != section) {
        problems.push(`${label} ${section.id}/${alphabetical}: ${list[i].id} -> ${next?.article?.id} of ${next?.section?.id}, expected ${list[i + 1].id}`);
        return;
      }
    }

    // The last article steps into the next section's first, and the first steps
    // back into the previous section's last
    let after = section.adjacentSection(1, alphabetical);
    if (after != section) {
      let lastStep = rul.nearbyArticle(list[list.length - 1], 1, section, alphabetical);
      let afterList = after.articles(alphabetical);
      if (lastStep?.section != after || lastStep.article != afterList[0])
        problems.push(`${label} ${section.id}/${alphabetical}: last -> ${lastStep?.article?.id} of ${lastStep?.section?.id}`);
    }

    let before = section.adjacentSection(-1, alphabetical);
    if (before != section) {
      let firstStep = rul.nearbyArticle(list[0], -1, section, alphabetical);
      let beforeList = before.articles(alphabetical);
      if (firstStep?.section != before || firstStep.article != beforeList[beforeList.length - 1])
        problems.push(`${label} ${section.id}/${alphabetical}: first -> ${firstStep?.article?.id} of ${firstStep?.section?.id}`);
    }
  }

  for (let alphabetical of [false, true]) {
    checkEmptyEntries(alphabetical);
    for (let s of rul.sectionOrder(alphabetical))
      walk(s, alphabetical);
  }

  ok(problems.length == 0, `${label}: every arrow step lands somewhere`, problems.slice(0, 4).join("; "));
  return rul.sectionOrder(false).length;
}

let builtin = await loadBuiltinPack();
survey(builtin, "builtins");

// A category order is only interesting on a pack that has categories, and the
// builtins ship none: they carry the pedia's own pages and no entry tables
let withCategories;
for (let name of ["tftdvanillaplus-dhf2.zip", "Dioxine_XPiratez_noimages.rar", "openxcom_xfiles_42.zip"]) {
  let path = examplePack(name);
  if (!path)
    continue;
  let rul = await loadPack(path);
  survey(rul, name.replace(/\.(zip|rar)$/i, ""));
  withCategories ??= rul;
}

/**
 * The `A-Z` toggle has to change the category order and leave the pedia's own
 * sections alone: the first is what the reader is choosing, the second is the
 * order the pack authored, which groups related pages.
 */
function checkOrder(rul, label) {
  let fixed = rul.typeSectionOrder(false);
  let sorted = rul.typeSectionOrder(true);
  ok(fixed.length > 1, `${label}: the pack declares several categories`);

  // Same comparator as the arrow walk and the sidebar, so this pins the order
  // the reader actually gets rather than a plain `>` over the ids
  let inOrder = sorted.every((s, i) =>
    i == 0 || rul.sortStringsAndNumbers([sorted[i - 1].id, s.id])[0] == sorted[i - 1].id);
  ok(inOrder, `${label}: A-Z puts the categories in alphabetical order`);

  eq(rul.sectionOrder(false).map(s => s.id), [...rul.sectionsOrder, ...fixed].map(s => s.id),
    `${label}: without A-Z every section keeps the pack's order`);
  eq(rul.sectionOrder(true).map(s => s.id), [...rul.sectionsOrder, ...sorted].map(s => s.id),
    `${label}: A-Z reorders the categories only`);
  eq(rul.sectionOrder(true).slice(0, rul.sectionsOrder.length).map(s => s.id), rul.sectionsOrder.map(s => s.id),
    `${label}: the A-Z toggle leaves the pedia's own sections in the pack's order`);
}

if (withCategories)
  checkOrder(withCategories, "example pack");

report();
