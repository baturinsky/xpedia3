/**
 * `${...}` placeholders in an article body.
 *
 * A pack writes `${STR_SOMETHING}` in `article.text` to splice a translated
 * string in, and `${xpediaVersion}` for the printed version. Two things have to
 * hold or the About page breaks in a way nothing else would catch:
 *
 * - a real id expands, and the `${...}` form is *not* the game's `{...}` markup,
 *   so it survives the stripper;
 * - an id that is not a string — a pack mistyping `${NEWLINE}` for `{NEWLINE}` —
 *   is left exactly as the `$`-less token, so the stripper handles it as before.
 */
import { eq, ok, report } from "../helpers/check.mjs";
import { loadBuiltinPack } from "../helpers/packs.mjs";

let rul = await loadBuiltinPack();

// `Article.text` is a getter over the entry's `text` id, so a probe body is put
// into the language table and an article pointed at it. The constructor is
// reached through a real article, which is the only way to get the class.
let Article = Object.getPrototypeOf(rul.articles["STR_ABOUT_XPEDIA"]).constructor;
let probes = 0;

function bodyOf(text) {
  let id = "STR_PROBE_" + (++probes);
  rul.lang[id] = text;
  return String(new Article({ id: "STR_PROBE_ARTICLE_" + probes, section: "SERVICES", text: id }).text);
}

// --- a real id expands --------------------------------------------------------
eq(bodyOf("A ${STR_ABOUT_XPEDIA} B"), "A About XPedia B", "a real string id expands");
eq(bodyOf("x ${ xpediaVersion } y"), "x 0-test y", "spaces inside the braces are allowed");
eq(bodyOf("v ${xpediaVersion}"), "v 0-test", "${xpediaVersion} is the printed version");

// --- an unknown id keeps the old behaviour -----------------------------------
// The whole point of the `$`: it must come out exactly as the `$`-less token
// does, so a pack's `${NEWLINE}` typo still becomes a line break
for (let token of ["NEWLINE", "ALT", "STR_NOT_A_REAL_KEY"]) {
  eq(bodyOf(`a \${${token}} b`), bodyOf(`a {${token}} b`), `unknown \${${token}} matches {${token}}`);
}

// --- nothing is left unexpanded in the real page -----------------------------
let about = String(rul.articles["STR_ABOUT_XPEDIA"].text);
ok(about.length > 0, "the About article has a body");
ok(!about.includes("${"), "no placeholder survives in the About body");
ok(about.includes("0-test"), "the About body carries the version");
// Its markup is stripped like every other body: no raw `{...}` token is left
ok(!/\{(NEWLINE|ALT)\}/.test(about), "markup tokens are stripped from the About body");

report();
