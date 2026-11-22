/**
 * The `voiceSets:` collection and the `ufopediaType` article override.
 *
 * Each exists for reference completeness: no example pack uses either, so a
 * synthetic pack states them the way the wiki's ruleset reference defines
 * them. A voice set parses like every other collection, with its section
 * created from the entries themselves; `ufopediaType` lands on the four
 * entity kinds the game reads it from (items, armors, facilities, craft
 * weapons).
 */
import { ensureBuilt } from "../build.mjs";
import { eq, ok, report } from "../helpers/check.mjs";
import { testPack } from "../helpers/packs.mjs";

await ensureBuilt();

const pack = await testPack({
  rul: [
    "voiceSets:",
    "  - type: STR_TEST_VOICE",
    "    selectUnit: 561",
    "    startMoving:",
    "      - 556",
    "      - 557",
    "    selectWeapon: [541, 542]",
    "    annoyed: 566",
    "    allowedGenders:",
    "      - Male",
    "    allowedSoldierTypes:",
    "      - STR_SOLDIER",
    "    allowedUnitTypes:",
    "      - STR_SECTOID",
    "    allowedArmorTypes:",
    "      - STR_GUARD_ARMOR",
    "items:",
    "  - type: STR_TEST_ITEM",
    "    ufopediaType: STR_TEST_ITEM_ARTICLE",
    "armors:",
    "  - type: STR_TEST_ARMOR",
    "    ufopediaType: STR_TEST_ARMOR_ARTICLE",
    "facilities:",
    "  - type: STR_TEST_FACILITY",
    "    ufopediaType: STR_TEST_FACILITY_ARTICLE",
    "craftWeapons:",
    "  - type: STR_TEST_CRAFT_WEAPON",
    "    weaponType: 0",
    "    ufopediaType: STR_TEST_CRAFT_WEAPON_ARTICLE",
    "",
  ].join("\n"),
});

// The collection parses into typed entries with their fields intact
eq(Object.keys(pack.voiceSets), ["STR_TEST_VOICE"], "one voice set parsed");
const voice = pack.voiceSets.STR_TEST_VOICE;
eq(voice.selectUnit, 561, "a single sound id is kept");
eq(voice.startMoving, [556, 557], "a list of sound ids is kept");
eq(voice.selectWeapon, [541, 542], "a flow list of sound ids is kept");
eq(voice.annoyed, 566, "annoyed is kept");
eq(voice.allowedGenders, ["Male"], "allowed genders are kept");
eq(voice.allowedSoldierTypes, ["STR_SOLDIER"], "allowed soldier types are kept");
eq(voice.allowedUnitTypes, ["STR_SECTOID"], "allowed unit types are kept");
eq(voice.allowedArmorTypes, ["STR_GUARD_ARMOR"], "allowed armor types are kept");

// Every entry is an article in its own section, named after the collection
const section = pack.sections.VOICE_SETS;
ok(section != null, "VOICE_SETS section exists");
eq(
  section?.articles().map((a) => a.id),
  ["STR_TEST_VOICE"],
  "the voice set article is listed",
);
ok(pack.articles.STR_TEST_VOICE.sections.includes(section), "the article belongs to the section");

// The article override lands on all four kinds the game defines it on
eq(pack.items.STR_TEST_ITEM.ufopediaType, "STR_TEST_ITEM_ARTICLE", "item ufopediaType");
eq(pack.armors.STR_TEST_ARMOR.ufopediaType, "STR_TEST_ARMOR_ARTICLE", "armor ufopediaType");
eq(
  pack.facilities.STR_TEST_FACILITY.ufopediaType,
  "STR_TEST_FACILITY_ARTICLE",
  "facility ufopediaType",
);
eq(
  pack.craftWeapons.STR_TEST_CRAFT_WEAPON.ufopediaType,
  "STR_TEST_CRAFT_WEAPON_ARTICLE",
  "craft weapon ufopediaType",
);

report();
