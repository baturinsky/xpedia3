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

import { entryKey, rawId, unknownIdFields } from "../.gen/engine.mjs";
import { eq, ok, report } from "../helpers/check.mjs";
import { examplePack, loadBuiltinPack, loadPack, testPack } from "../helpers/packs.mjs";

/**
 * A block may be named by `id`, `type` or `name`, and all three have to file it
 * under that name.
 *
 * This is the shape the example packs cannot check: whether one of them states a
 * `name`-keyed block is up to the pack, so a regression that dropped the alias
 * would only show up as a table shrinking. A tiny pack states all three on
 * purpose, and two blocks each, because the collapse being guarded against filed
 * the second block over the first rather than failing outright.
 */
async function checkAliasIds() {
  const rul = await testPack({
    rul: [
      "research:",
      "  - name: STR_ALIAS_RESEARCH_A",
      "  - name: STR_ALIAS_RESEARCH_B",
      "items:",
      "  - type: STR_ALIAS_ITEM_A",
      "  - type: STR_ALIAS_ITEM_B",
      "terrains:",
      "  - name: STR_ALIAS_TERRAIN_A",
      "  - name: STR_ALIAS_TERRAIN_B",
    ].join("\n"),
  });

  const expected = {
    research: ["STR_ALIAS_RESEARCH_A", "STR_ALIAS_RESEARCH_B"],
    items: ["STR_ALIAS_ITEM_A", "STR_ALIAS_ITEM_B"],
    terrains: ["STR_ALIAS_TERRAIN_A", "STR_ALIAS_TERRAIN_B"],
  };
  for (const [collection, ids] of Object.entries(expected))
    eq(
      Object.keys(rul[collection] ?? {}).sort(),
      [...ids].sort(),
      `a \`name\`/\`type\` block is filed under that name (${collection})`,
    );

  // The alias still answers to the same name it was filed under
  ok(
    rul.research.STR_ALIAS_RESEARCH_A?.uid === "STR_ALIAS_RESEARCH_A",
    "an entry's uid is the name the block stated",
  );
  // ...but it states no `id`, so `id` stays empty rather than echoing the uid.
  // A `name`-keyed block genuinely has no id: copying the uid in would erase the
  // difference between what the file said and what the pedia concluded.
  eq(rul.research.STR_ALIAS_RESEARCH_A?.id, undefined, "a `name`-keyed block keeps having no id");

  // The table's identity column is headed `id` and is always shown, so it must
  // answer with the uid. Reading the as-written `id` there would leave the name
  // column of every `type`/`name`-keyed table blank.
  eq(
    rul.research.STR_ALIAS_RESEARCH_A?.sortField("id", true),
    "STR_ALIAS_RESEARCH_A",
    "the `id` column shows the uid, not the as-written id",
  );
  eq(
    rul.items.STR_ALIAS_ITEM_A?.sortField("id", true),
    "STR_ALIAS_ITEM_A",
    "and does so for a `type`-keyed table too",
  );
}

/**
 * The identity column answers for every entry type, not just the ones that
 * happen to inherit `Entry.sortField`.
 *
 * A subclass that overrides `sortField` has to delegate the fields it does not
 * understand; falling through to `this[n]` looks harmless on the columns it owns
 * and silently drops the identity column, because `id` is the one header that
 * names no field of the entry. Four tables were blank from end to end that way —
 * armors, units, soldiers and commendations — while RESEARCH and ITEMS, which do
 * delegate, were fine. That is exactly the split that let it go unnoticed, so
 * this walks every entry of every pack rather than a chosen sample.
 */
function checkIdentityColumn(rul, label) {
  const blank = [],
    wrong = [];
  for (const [name, table] of Object.entries(rul)) {
    if (
      table == null ||
      typeof table !== "object" ||
      Array.isArray(table) ||
      !Object.keys(table).length
    )
      continue;
    for (const [key, entry] of Object.entries(table)) {
      // Only ruleset entries: `rul` also holds plain maps and lists
      if (entry == null || typeof entry !== "object" || !("collection" in entry)) continue;
      const shown = entry.sortField("id", true);
      if (shown == null || shown === "") blank.push(`${name}/${key}`);
      else if (shown !== entry.uid) wrong.push(`${name}/${key}: column=${shown} uid=${entry.uid}`);
    }
  }
  ok(
    blank.length === 0,
    `${label}: the \`id\` column is filled for every entry of every table`,
    `${blank.length} empty, e.g. ${blank.slice(0, 4).join(", ")}`,
  );
  ok(
    wrong.length === 0,
    `${label}: and it names the entry it is the row of`,
    wrong.slice(0, 4).join(", "),
  );

  // A commendation is the one type whose columns come from its stages, and the
  // identity column must not be read as one of those: a stage bonus has no name
  // to lend. `cellValue` is the path a rendered cell takes, so it is what has to
  // answer rather than `sortField` alone.
  const withStages = Object.values(rul.commendations ?? {}).find(
    (c) => (c.soldierBonusTypes ?? []).length > 1,
  );
  if (withStages) {
    eq(
      withStages.cellValue("id"),
      withStages.uid,
      `${label}: a commendation's identity cell is its uid, not a stage value`,
    );
  }
}

/**
 * The resolved key and the alias fields have to stay independent of each other.
 *
 * `Entry.type` and `Entry.name` are aliases for `uid`, and copying a block's
 * fields runs those setters. So a block that states *both* `id` and `type` used
 * to have its key stolen by `type` during the copy — the pedia filed it under a
 * name the block never used, and the engine does not. The declared field for a
 * collection wins, as it does in the game.
 *
 * The `invs` table is the extreme case: its `type` is a *number* (the engine's
 * `InventoryType`), so keying it by `type` collapses every hand and the ground
 * into one entry.
 */
async function checkIdFieldWins() {
  const rul = await testPack({
    rul: [
      "research:",
      "  - id: STR_BY_ID",
      "    type: STR_BY_TYPE",
      "items:",
      "  - id: STR_ITEM_BY_ID",
      "    type: STR_ITEM_BY_TYPE",
      "invs:",
      "  - id: STR_HAND",
      "    type: 1",
      "  - id: STR_GROUND",
      "    type: 2",
    ].join("\n"),
  });

  // The field the engine declares for a collection wins over the others, which
  // is `name` for research and `type` for items: a block stating both must land
  // where the game puts it rather than wherever the copy loop last pointed
  ok(rul.research?.STR_BY_ID != null, "a `name` collection takes `id` when no `name` is stated");
  ok(
    rul.items?.STR_ITEM_BY_TYPE != null,
    "a `type` collection is filed under its `type`, not its `id`",
  );

  // Two inventory sections of different kinds must not merge into one entry
  eq(
    Object.keys(rul.inventorySections ?? {}).sort(),
    ["STR_GROUND", "STR_HAND"],
    "inventory sections are keyed by their string id, not their numeric type",
  );
  eq(
    rul.inventorySections.STR_GROUND?.invType,
    2,
    "an inventory section keeps its numeric type as `invType`",
  );
}

/**
 * `rawId` reports the identifier the file writes; `entryKey` resolves the key
 * the pedia files by.
 *
 * The distinction only shows on a pack that mixes spellings, which is exactly
 * the pack where guessing is tempting and wrong: a `{ name: ... }` block in a
 * `type` collection has no id as far as the game is concerned, so a diagnostic
 * that reported a resolved key would describe a pack that is not on disk. The
 * two are checked together because the value of one is only meaningful against
 * the other.
 */
async function checkRawIdVersusKey() {
  // The declared field, read literally
  eq(rawId("items", { type: "STR_T" }), "STR_T", "`rawId` reads the declared `type`");
  eq(rawId("research", { name: "STR_N" }), "STR_N", "`rawId` reads the declared `name`");
  eq(rawId("items", { id: "STR_I" }), undefined, "`rawId` does not fall back to another spelling");

  // The key, resolved
  eq(entryKey("items", { type: "STR_T" }), "STR_T", "`entryKey` resolves a `type` block");
  eq(
    entryKey("items", { id: "STR_I" }),
    "STR_I",
    "`entryKey` still files a `type` collection's `id` block",
  );
  eq(
    entryKey("items", { name: "STR_N" }),
    "STR_N",
    "`entryKey` still files a `type` collection's `name` block",
  );
  eq(entryKey("items", {}), "", "a block that names nothing has no key");

  // The declared field wins wherever the file states it, so the two agree there
  eq(
    entryKey("invs", { id: "STR_HAND", type: 1 }),
    "STR_HAND",
    "`entryKey` prefers the declared field",
  );
  eq(rawId("invs", { id: "STR_HAND", type: 1 }), "STR_HAND", "and `rawId` agrees on it");
}

/**
 * The uid contract: resolved once at merge, then read everywhere.
 *
 * The point of the uid is that the identity question is answered exactly once.
 * If any later stage resolved it again the answer could drift, which is the
 * class of bug this replaced. So this pins both halves: that a stamped block
 * keeps its stamp, and that the fallback for an unseen naming field is silent on
 * real packs and only engages when a pack actually introduces one.
 */
async function checkUid() {
  // A stamp survives the merge, even where the block also states other spellings
  eq(
    entryKey("items", { uid: "STR_STAMPED", type: "STR_T", id: "STR_I" }),
    "STR_STAMPED",
    "a stamped `uid` wins over the fields around it",
  );

  // `uid` is unique only inside its table, so the same name in two tables is two
  // entries; `collection:uid` is what tells them apart. XPiratez and XFiles both
  // reuse one name for an item and the unit that drops it.
  const shared = await testPack({
    rul: [
      "items:",
      "  - type: STR_SHARED_NAME",
      "    costBuy: 10",
      "units:",
      "  - type: STR_SHARED_NAME",
      "    rank: STR_RANK_SOLDIER",
    ].join("\n"),
  });
  const item = shared.items?.STR_SHARED_NAME;
  const unit = shared.units?.STR_SHARED_NAME;
  ok(item != null && unit != null, "one name can name an entry in two tables");
  eq(item?.uid, unit?.uid, "and the two share a uid");
  ok(
    item?.globalId !== unit?.globalId,
    `but their collection:uid differ (${item?.globalId} vs ${unit?.globalId})`,
  );
  eq(item?.globalId, "items:STR_SHARED_NAME", "the composite is `collection:uid`");

  // The fallback stays silent on tables this build knows
  const guessedBefore = unknownIdFields();

  // An unseen collection whose blocks name themselves with an unseen field still
  // gets table rows, and the guess is reported rather than hidden
  const rul = await testPack({
    rul: [
      "aTableTheEngineDoesNotHave:",
      "  - objId: STR_FUTURE_A",
      "    value: 1",
      "  - objId: STR_FUTURE_B",
      "    value: 2",
    ].join("\n"),
  });
  eq(
    Object.keys(rul.raw.aTableTheEngineDoesNotHave ?? {}).sort(),
    ["STR_FUTURE_A", "STR_FUTURE_B"],
    "an unseen naming field still files its blocks",
  );
  eq(
    rul.raw.aTableTheEngineDoesNotHave?.STR_FUTURE_A?.uid,
    "STR_FUTURE_A",
    "and stamps them like any other block",
  );
  ok(
    unknownIdFields().includes("aTableTheEngineDoesNotHave.objId"),
    "the guessed field is reported, not silently applied",
  );

  // A block naming itself with two candidate fields is not guessed at: choosing
  // between them would invent an identity instead of reading one
  const ambiguous = await testPack({
    rul: [
      "anotherUnknownTable:",
      "  - objId: STR_AMBIGUOUS_A",
      "    object_id: STR_AMBIGUOUS_B",
    ].join("\n"),
  });
  eq(
    Object.keys(ambiguous.raw.anotherUnknownTable ?? {}),
    [],
    "two candidate identity fields are not guessed between",
  );

  // Loading those packs must not have added guesses for tables this build knows
  ok(
    guessedBefore.every((f) => unknownIdFields().includes(f)),
    "known collections keep their declared field, never a guess",
  );
}

await checkAliasIds();
await checkIdFieldWins();
await checkRawIdVersusKey();
await checkUid();

/** Walks every section of a ruleset, counting what the arrows would do */
function survey(rul, label) {
  const problems = [];

  function checkEmptyEntries(alphabetical) {
    const empty = [];
    const noUid = [];
    const uidMismatch = [];
    const uidVisible = [];
    const duplicateGlobal = [];
    const seenGlobal = new Set();
    for (const [name, table] of Object.entries(rul)) {
      // Collections are plain tables on `rul`; anything else is not a ruleset
      // table and must not be read as one
      if (
        table == null ||
        typeof table !== "object" ||
        Array.isArray(table) ||
        !Object.keys(table).length
      )
        continue;
      if ("" in table) empty.push(name);

      // Every row carries the uid it was merged under, and it is the key it is
      // filed by. `uid` staying out of `Object.keys` keeps it off a raw render.
      // The as-written `id` is deliberately not compared: it is evidence of what
      // the file said, and a `name`- or `type`-keyed block states no id at all.
      for (const [key, entry] of Object.entries(table)) {
        if (entry == null || typeof entry !== "object" || !("collection" in entry)) continue;
        if (!entry.uid) noUid.push(`${name}/${key}`);
        else if (entry.uid !== key) uidMismatch.push(`${name}/${key}: uid=${entry.uid}`);
        if (Object.keys(entry).includes("uid")) uidVisible.push(`${name}/${key}`);

        // `uid` is only unique inside its table, so `collection:uid` is the
        // form that is unique across the pack. That is the whole reason the
        // composite exists, and it has to actually hold.
        if (seenGlobal.has(entry.globalId)) duplicateGlobal.push(entry.globalId);
        seenGlobal.add(entry.globalId);
      }
    }
    ok(empty.length === 0, `${label}: no collection is keyed by the empty id`, empty.join(", "));
    ok(
      noUid.length === 0,
      `${label}: every entry carries the uid it was merged under`,
      noUid.slice(0, 4).join(", "),
    );
    ok(
      uidMismatch.length === 0,
      `${label}: an entry's uid is the key it is filed by`,
      uidMismatch.slice(0, 4).join(", "),
    );
    ok(
      uidVisible.length === 0,
      `${label}: uid does not show up as a rendered row`,
      uidVisible.slice(0, 4).join(", "),
    );
    ok(
      duplicateGlobal.length === 0,
      `${label}: collection:uid is unique across the pack`,
      duplicateGlobal.slice(0, 4).join(", "),
    );

    const blank = [];
    for (const s of rul.sectionOrder(alphabetical))
      for (const a of s.articles(alphabetical)) if (!a.id) blank.push(s.id);
    ok(blank.length === 0, `${label}: no section lists an article with no id`, blank.join(", "));
  }

  /**
   * Walks one section end to end in the given direction.
   *
   * Inside the list, every step has to land on the next row and stay in the
   * section. The two ends are checked separately, because they cross into the
   * neighbouring section rather than stopping.
   */
  function walk(section, alphabetical) {
    const list = section.articles(alphabetical);
    if (!list.length) return;

    for (let i = 0; i + 1 < list.length; i++) {
      const next = rul.nearbyArticle(list[i], 1, section, alphabetical);
      if (!next || next.article !== list[i + 1] || next.section !== section) {
        problems.push(
          `${label} ${section.id}/${alphabetical}: ${list[i].id} -> ${next?.article?.id} of ${next?.section?.id}, expected ${list[i + 1].id}`,
        );
        return;
      }
    }

    // The last article steps into the next section's first, and the first steps
    // back into the previous section's last
    const after = section.adjacentSection(1, alphabetical);
    if (after !== section) {
      const lastStep = rul.nearbyArticle(list[list.length - 1], 1, section, alphabetical);
      const afterList = after.articles(alphabetical);
      if (lastStep?.section !== after || lastStep.article !== afterList[0])
        problems.push(
          `${label} ${section.id}/${alphabetical}: last -> ${lastStep?.article?.id} of ${lastStep?.section?.id}`,
        );
    }

    const before = section.adjacentSection(-1, alphabetical);
    if (before !== section) {
      const firstStep = rul.nearbyArticle(list[0], -1, section, alphabetical);
      const beforeList = before.articles(alphabetical);
      if (firstStep?.section !== before || firstStep.article !== beforeList[beforeList.length - 1])
        problems.push(
          `${label} ${section.id}/${alphabetical}: first -> ${firstStep?.article?.id} of ${firstStep?.section?.id}`,
        );
    }
  }

  for (const alphabetical of [false, true]) {
    checkEmptyEntries(alphabetical);
    for (const s of rul.sectionOrder(alphabetical)) walk(s, alphabetical);
  }

  ok(
    problems.length === 0,
    `${label}: every arrow step lands somewhere`,
    problems.slice(0, 4).join("; "),
  );
  return rul.sectionOrder(false).length;
}

const builtin = await loadBuiltinPack();
survey(builtin, "builtins");
checkIdentityColumn(builtin, "builtins");

// A category order is only interesting on a pack that has categories, and the
// builtins ship none: they carry the pedia's own pages and no entry tables
let withCategories;
const packs = [];
for (const name of [
  "tftdvanillaplus-dhf2.zip",
  "Dioxine_XPiratez_noimages.rar",
  "openxcom_xfiles_42.zip",
]) {
  const path = examplePack(name);
  if (!path) continue;
  const rul = await loadPack(path);
  survey(rul, name.replace(/\.(zip|rar)$/i, ""));
  checkIdentityColumn(rul, name.replace(/\.(zip|rar)$/i, ""));
  packs.push({ rul, label: name.replace(/\.(zip|rar)$/i, "") });
  withCategories ??= rul;
}

/**
 * The `A-Z` toggle has to change the category order and leave the pedia's own
 * sections alone: the first is what the reader is choosing, the second is the
 * order the pack authored, which groups related pages.
 */
function checkOrder(rul, label) {
  const fixed = rul.typeSectionOrder(false);
  const sorted = rul.typeSectionOrder(true);
  ok(fixed.length > 1, `${label}: the pack declares several categories`);

  // Same comparator as the arrow walk and the sidebar, so this pins the order
  // the reader actually gets rather than a plain `>` over the ids
  const inOrder = sorted.every(
    (s, i) =>
      i === 0 || rul.sortStringsAndNumbers([sorted[i - 1].id, s.id])[0] === sorted[i - 1].id,
  );
  ok(inOrder, `${label}: A-Z puts the categories in alphabetical order`);

  eq(
    rul.sectionOrder(false).map((s) => s.id),
    [...rul.sectionsOrder, ...fixed].map((s) => s.id),
    `${label}: without A-Z every section keeps the pack's order`,
  );
  eq(
    rul.sectionOrder(true).map((s) => s.id),
    [...rul.sectionsOrder, ...sorted].map((s) => s.id),
    `${label}: A-Z reorders the categories only`,
  );
  eq(
    rul
      .sectionOrder(true)
      .slice(0, rul.sectionsOrder.length)
      .map((s) => s.id),
    rul.sectionsOrder.map((s) => s.id),
    `${label}: the A-Z toggle leaves the pedia's own sections in the pack's order`,
  );
}

if (withCategories) checkOrder(withCategories, "example pack");

/**
 * The world map is a block at the bottom of the Countries page, not a page.
 *
 * It used to be a `WORLD_MAP` category: the builtin ruleset declared the article
 * and `Ruleset.parseRuls` made the section. Both had to go when the map moved,
 * and this is what would notice either coming back — a stray article would show
 * up in the sidebar and in the arrow walk of a pack that never authored it.
 *
 * A pack with no `globe:` node still has a Countries table, so the table page
 * must survive the move; only the map below it is conditional.
 */
function checkWorldMapIsNotAPage(rul, label) {
  ok(!rul.sections?.WORLD_MAP, `${label}: the world map has no section of its own`);
  ok(!rul.articles?.WORLD_MAP, `${label}: the world map has no article of its own`);

  const stray = Object.keys(rul.sections ?? {}).filter((id) => /WORLD.?MAP/i.test(id));
  eq(stray, [], `${label}: no section is named after the world map`);

  // The Countries page is the pack's own, so it is there whether or not the map
  // can be drawn
  if (rul.countries && Object.keys(rul.countries).length)
    ok(rul.sections?.COUNTRIES, `${label}: the Countries table page is still a section`);
}

checkWorldMapIsNotAPage(builtin, "builtins");
for (const { rul, label } of packs) checkWorldMapIsNotAPage(rul, label);

/**
 * The REGIONS section's page is a page, and it has to stay one.
 *
 * The map of the regions was added to it rather than swapped in for its list: a
 * region that states no `areas` cannot be drawn anywhere, so the list is the only
 * route to its page when the sidebar is hidden — and that is how most regions in
 * the example packs are built (39 of 54 in XFiles, 158 of 173 in X-Piratez).
 *
 * A section page is the article whose id matches its section. That is easy to
 * lose by giving the section a different id or filing the map's own page over it,
 * and neither would fail any other check.
 */
function checkRegionsPageIsASectionPage(rul, label) {
  const page = rul.sections?.REGIONS && rul.article("REGIONS");
  if (!page) return;
  eq(page.id, "REGIONS", `${label}: the REGIONS article is the section's own page`);
  ok(
    page.sections.some((s) => s.id === "REGIONS"),
    `${label}: the REGIONS article is filed under the REGIONS section`,
  );
}

checkRegionsPageIsASectionPage(builtin, "builtins");
for (const { rul, label } of packs) checkRegionsPageIsASectionPage(rul, label);

report();
