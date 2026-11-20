/**
 * The helper mod's language files, which are part of the repository.
 *
 * Unlike the example packs these ship with XPedia, so they are the one language
 * data a check can always read. A YAML mistake here is silent — a key defined
 * twice keeps only the last copy, a lost indentation drops the whole block — and
 * it would show up as a missing label in the pedia rather than as an error, so
 * the files are re-parsed from the text and compared with what the build reads.
 */

import { builtinFiles } from "../helpers/builtin.mjs";
import { eq, ok, report } from "../helpers/check.mjs";

const { loadYaml } = await import("../.gen/packbuild.mjs");

/**
 * The files, and what each one is for: they are not uniform.
 *
 * `en-US` and `ru` are the pack's own overrides — the VooDoo labels and the
 * armor paperdoll names that X-Piratez needs and the base strings lack. `pl`,
 * `cs` and `es-ES` are translations of XPedia's own interface only, so they
 * carry the section names and the chrome, and none of the pack vocabulary.
 */
const packOverrides = ["en-US", "ru"];
const interfaceFiles = ["pl", "cs", "es-ES"];

/** The VooDoo and score labels the pack needs from the helper */
const packLabels = [
  "points",
  "psi",
  "psiSkill",
  "psiStrength",
  "psiDefence",
  "psiAttackName",
  "psiRequired",
  "psiLabs",
  "psiWeapon",
  "hitMissSound",
];

/** The interface labels every translation has to provide */
const interfaceLabels = [
  "BootyPedia",
  "ITEMS",
  "CONDITIONS",
  "CATEGORIES",
  "MANUFACTURE",
  "RESEARCH",
  "SERVICES",
  "HOME",
];

/**
 * A key declared in the text, as the parser will name it.
 *
 * Quotes are YAML syntax, not part of the key: `'true':` declares the key `true`,
 * and leaving the quotes on would make it look like a key the parse had lost.
 * Bare `true:` is the same key after parsing, since an object's keys are strings
 * whatever YAML made of them.
 */
function declaredKey(line) {
  // A commented-out key is not declared; `  #and: "i na"` must not count
  if (/^ *#/.test(line)) return undefined;
  const match = /^ {2}(?:'([^']*)'|"([^"]*)"|(\S.*?)):(?:[ \t]|$)/.exec(line);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

const files = builtinFiles();
const decoder = new TextDecoder();
const tables = {};

for (const language of [...packOverrides, ...interfaceFiles]) {
  const raw = files[`mods/xhelper-xpiratez/Language/${language}.yml`];
  if (!ok(raw != null, `${language}: the file is in the builtin mods`)) continue;
  const text = decoder.decode(raw);

  let table;
  try {
    table = loadYaml(text);
  } catch (e) {
    ok(false, `${language}: parses as YAML`, e.message);
    continue;
  }

  // One language block, keyed by the language it translates
  const blocks = Object.keys(table);
  eq(blocks, [language], `${language}: exactly one language block, named after the file`);
  const block = table[blocks[0]] ?? {};
  tables[language] = block;
  ok(Object.keys(block).length > 0, `${language}: the block has keys`);

  // A key written twice keeps only its last copy, silently: read the text to
  // find them, since the parser cannot tell
  const seen = new Set();
  const duplicates = [];
  for (const line of text.split(/\r?\n/)) {
    const key = declaredKey(line);
    if (key == null) continue;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  ok(
    duplicates.length == 0,
    `${language}: no key is defined twice`,
    duplicates.slice(0, 10).join(", "),
  );

  // Indentation is what makes the block a block; a tab is not an indentation
  const tabs = text.split(/\r?\n/).filter((line) => /^\t/.test(line));
  ok(tabs.length == 0, `${language}: no tab-indented line`, String(tabs.length));

  // Every key the text declares is a key the parse actually kept. A quoted key
  // is the parser's own string, so `'true'` and `true` are the same key here.
  const missing = [...seen].filter((key) => !(key in block));
  ok(
    missing.length == 0,
    `${language}: every declared key survived the parse`,
    missing.slice(0, 10).join(", "),
  );

  const labels = packOverrides.includes(language) ? packLabels : interfaceLabels;
  const absent = labels.filter((key) => !(key in block));
  ok(absent.length == 0, `${language}: carries its labels`, absent.join(", "));

  // The paperdoll names are what label the armor variants, so they have to stay
  if (packOverrides.includes(language)) {
    const dolls = Object.keys(block).filter((key) => /^[MF]\d+$/.test(key));
    ok(dolls.length > 0, `${language}: keeps the paperdoll names`, String(dolls.length));
  }
}

// The strings that were removed on purpose must not come back
for (const dead of ["STR_DLC_0", "dlc_id", "zzauthor", "CITIES"])
  ok(!(dead in (tables["en-US"] ?? {})), `en-US: ${dead} stays removed`);

report();
