/**
 * The raw data files an exported page carries inside itself.
 *
 * The world map cannot fetch them: a page opened from `file://` has no URL that
 * reaches its neighbours, so a globe left beside the page is simply not there
 * when it matters, and the map silently draws the stock world instead of the
 * pack's. These assertions pin the two halves of the fix — that the payload says
 * which files to carry, and that the bytes it carries are the pack's own.
 */
import "./../helpers/page.mjs";
import { ensureBuilt } from "../build.mjs";
import { builtinFilesFor } from "../helpers/builtin.mjs";
import { eq, ok, report } from "../helpers/check.mjs";
import { examplePack, fileReader, loadPack } from "../helpers/packs.mjs";

await ensureBuilt();
const { collectDataFiles, dataPaths } = await import("../.gen/exportcore.mjs");

/** The stock globe, for telling "the pack's own" from "the builtin fallback" */
function stockGlobe() {
  const files = builtinFilesFor("xpedia");
  const key = Object.keys(files).find((name) => /geodata\/world\.dat$/i.test(name));
  return key ? files[key] : undefined;
}

// The stock globe is always on the list: it is what a pack that ships none
// resolves against, and the builtin copy cannot be fetched from disk either
{
  const paths = dataPaths([]);
  ok(
    paths.includes("geodata/world.dat"),
    "the stock globe is always carried",
    JSON.stringify(paths),
  );
}

// A pack naming another globe has both spellings carried, so whichever the
// drawing code asks for is present
{
  const mods = [{ rul: [{ globe: { data: "GEODATA/CUSTOM.DAT" } }] }];
  const paths = dataPaths(mods);
  ok(
    paths.includes("geodata/world.dat"),
    "custom globe keeps the stock spelling",
    JSON.stringify(paths),
  );
  ok(paths.includes("geodata/custom.dat"), "custom globe is carried too", JSON.stringify(paths));

  // The last mod to set it wins, as the ruleset's own merge decides
  const later = [
    { rul: [{ globe: { data: "GEODATA/A.DAT" } }] },
    { rul: [{ globe: { data: "GEODATA/B.DAT" } }] },
  ];
  ok(
    dataPaths(later).includes("geodata/b.dat"),
    "the last globe wins",
    JSON.stringify(dataPaths(later)),
  );
}

// A pack that ships no globe yields nothing: the builtin copy already covers it
{
  const files = await collectDataFiles({}, async () => undefined);
  eq(files, {}, "a pack with no globe carries no data");
}

// The bytes are gzipped, base64ed, and come back as what went in
{
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252]);
  const files = await collectDataFiles(
    { "geodata/world.dat": "XComFiles/GEODATA/WORLD.DAT" },
    async () => bytes,
  );
  const encoded = files["geodata/world.dat"];
  ok(typeof encoded == "string" && encoded.length > 0, "the globe is carried");
  const { gunzipSync } = await import("node:zlib");
  const decoded = gunzipSync(Buffer.from(encoded, "base64"));
  eq([...decoded], [...bytes], "the bytes survive the round trip");
}

// A real pack: the carried globe must be the one that pack ships, not the stock
{
  const path = examplePack("openxcom_xfiles_42.zip");
  if (!path) {
    console.log("  (no openxcom_xfiles_42.zip, skipping the real-pack case)");
  } else {
    const rul = await loadPack(path);
    const stock = stockGlobe();
    const archive = rul.resourceMap["geodata/world.dat"];
    ok(!!archive, "xfiles resolves a globe");

    const data = await collectDataFiles(rul.resourceMap, fileReader(rul.packFiles), rul.mods);
    ok("geodata/world.dat" in data, "xfiles carries its globe");

    const { gunzipSync } = await import("node:zlib");
    const carried = gunzipSync(Buffer.from(data["geodata/world.dat"], "base64"));
    ok(!!stock, "there is a stock globe to compare against");
    ok(
      Buffer.compare(carried, Buffer.from(stock)) != 0,
      "xfiles carries its own globe rather than the stock one",
    );
  }
}

report();
