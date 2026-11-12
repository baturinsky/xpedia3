import { rul } from "../rul/Ruleset";

/**
 * Colours for the world map's land.
 *
 * OpenXcom has no land colours at all: real land is textured, each polygon
 * sampling a 32x32 tile from `TEXTURE.DAT`, and the ruleset only carries the
 * ocean's palette index and the label colours. A flat illustration therefore has
 * to choose its own colours. Two sources are used, in this order:
 *
 * 1. `xpedia: mapColors:` in any active ruleset, so a mod can state exactly what
 *    its biomes look like.
 * 2. A keyword match on the terrain name, for everything not declared.
 *
 * The fallback matters more than it sounds: X-Piratez alone declares 67 distinct
 * terrain names, so an explicit list can never be complete, and a mod inventing
 * its own biomes has to keep working without anyone touching this file.
 */

/** The colours a mod can set, and what they mean */
const declared: { [name: string]: string } = {};

/**
 * Terrain name fragments and the colour they imply. Matched in order, so
 * `FORESTSWAMP_SNOW` reads as snow and `PLAINS_TUNDRA` as tundra, not as plains.
 * Keys are upper case and compared against the upper-cased terrain name.
 */
const keywordColors: [string, string][] = [
  // Cold and polar come first: a name like `FORESTSNOW` is cold forest, and the
  // colder reading is the one that matches how the game looks
  ["SNOW", "#e8eef2"],
  ["POLAR", "#e8eef2"],
  ["TUNDRA", "#cfd8d4"],
  ["ICE", "#dfeaf0"],
  ["GLACIER", "#e8eef2"],

  // Water and seabed: TFTD's terrain sets are almost all underwater
  ["SEABED", "#2a5a72"],
  ["CORAL", "#2e6f74"],
  ["ATLAN", "#2a5a72"],
  ["UNDERWATER", "#2a5a72"],

  // Volcanic
  ["VOLC", "#5a3030"],
  ["LAVA", "#6b2b26"],
  ["MAGMA", "#6b2b26"],
  ["NUKE", "#6b6357"],

  // Settled ground
  ["URBAN", "#8a8378"],
  ["INDUSTRIAL", "#7d7a72"],
  ["SLUM", "#847d70"],
  ["CITY", "#8a8378"],
  ["COMMERCIAL", "#8a8378"],
  ["RURAL", "#7e8a58"],
  ["FARM", "#7e8a58"],
  ["VILLAGE", "#7e8a58"],
  ["WEST", "#9a8a6a"],

  // Sand
  ["DESERT", "#c8a86a"],
  ["SANDY", "#c8a86a"],
  ["SAND", "#c8a86a"],
  ["DUST", "#bda878"],
  ["STEPPE", "#b0a06a"],
  ["SAVANNA", "#a8a05a"],

  // Rock and high ground
  ["MOUNT", "#8a7a63"],
  ["ROCK", "#8a7a63"],
  ["ERODED", "#8a7a63"],
  ["DEAD", "#7a7466"],
  ["CRATER", "#7a7466"],
  ["WASTE", "#8f8467"],

  // Green
  ["JUNGLE", "#1f5c2a"],
  ["FOREST", "#2f6b33"],
  ["SWAMP", "#3f6040"],
  ["MARSH", "#3f6040"],
  ["PLAINS", "#7a8a4a"],
  ["PRAIRIE", "#7a8a4a"],
  ["GRASS", "#6f8a45"],
  ["CULTA", "#7a8a4a"],
  ["ARBOREAL", "#3a6b38"],
];

/** Land whose terrain the pack names nothing for, or names unrecognisably */
export const unknownLandColor = "#5a6b4f";

/**
 * Contour colours for nations, in list order.
 *
 * The game draws a nation's area as nothing at all and only labels it, so there
 * is no colour to copy from the ruleset (`globe: countryColor:` is a single
 * palette index shared by every label). Distinct hues are used instead, so
 * neighbouring nations read apart; a mod can still override any of them.
 */
const countryPalette = [
  "#e8b04a", "#6fb3e0", "#d4736f", "#8fc46a", "#c58fd8", "#54c4b0",
  "#e08f4a", "#7a90e0", "#c4c45e", "#5fbf8f", "#d87fb0", "#9a8f7a",
];

/** `xpedia: countryColors:` declarations, keyed by upper-cased nation id */
const declaredCountryColors: { [id: string]: string } = {};

/** Reads the `xpedia: countryColors:` any active ruleset declares */
export function readDeclaredCountryColors() {
  for (let key in declaredCountryColors)
    delete declaredCountryColors[key];

  for (let mod of rul?.mods ?? []) {
    for (let file of mod.rul ?? []) {
      let block = file?.xpedia;
      let entries = Array.isArray(block) ? block : block ? [block] : [];
      for (let entry of entries) {
        let table = entry?.countryColors;
        if (!table || typeof table != "object")
          continue;
        for (let [id, color] of Object.entries(table))
          if (id && typeof color == "string")
            declaredCountryColors[id.toUpperCase()] = color;
      }
    }
  }
}

/** The contour colour of one nation, also used for its label */
export function colorForCountry(id: string, index: number) {
  return declaredCountryColors[id.toUpperCase()] ?? countryPalette[index % countryPalette.length];
}

/** Reads the `xpedia: mapColors:` any active ruleset declares */
export function readDeclaredColors() {
  for (let key in declared)
    delete declared[key];

  // Read from every mod rather than the merged ruleset, because `combineModRuls`
  // replaces a whole `mapColors:` table: a mod that declares one biome would
  // otherwise wipe the builtin table instead of adding to it. Mods are in merge
  // order, so the last declaration of a name wins.
  for (let mod of rul?.mods ?? []) {
    for (let file of mod.rul ?? []) {
      let block = file?.xpedia;
      let entries = Array.isArray(block) ? block : block ? [block] : [];
      for (let entry of entries)
        addDeclared(entry?.mapColors);
    }
  }
}

function addDeclared(table: any) {
  if (!table || typeof table != "object")
    return;
  for (let [name, color] of Object.entries(table))
    if (name && typeof color == "string")
      declared[name.toUpperCase()] = color;
}

/**
 * The colour of one terrain name.
 *
 * A name the pack declares wins, then an exact keyword match, then the first
 * keyword the name contains.
 */
export function colorForTerrain(name?: string) {
  if (!name)
    return unknownLandColor;
  let upper = name.toUpperCase();
  if (declared[upper])
    return declared[upper];
  for (let [keyword, color] of keywordColors)
    if (upper.includes(keyword))
      return color;
  return unknownLandColor;
}
