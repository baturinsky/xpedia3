/**
 * Region coordinates are numbers, not the strings a pack may write them as.
 *
 * The engine parses coordinates with `toDouble`, so a pack may quote them —
 * TFTD writes `missionZones` as `["-.4024658", 9.597534, …]`. The page projects
 * these with plain arithmetic, and a quoted coordinate turns a sum into a string
 * concatenation: the SVG came out as `points="NaN,309.6 NaN,309.6"`, and React
 * logged an error for every affected zone.
 *
 * `Region` converts once on load, so this checks the loaded entry rather than
 * the map: every coordinate of every `areas` and `missionZones` box has to be a
 * finite number, and the optional city id has to stay a string.
 */
import { ok, report } from "../helpers/check.mjs";
import { examplePack, loadBuiltinPack, loadPack } from "../helpers/packs.mjs";

/** Counts the boxes and lists everything wrong with them */
function survey(rul, label) {
  let boxes = 0,
    zones = 0,
    bad = [];

  // A `MapArea` is `[lon1, lon2, lat1, lat2, textureId?, cityId?]`: the leading
  // five are numeric when present, the sixth is a city id
  function checkArea(area, where) {
    boxes++;
    if (!Array.isArray(area)) {
      bad.push(`${where} is not an array: ${JSON.stringify(area)}`);
      return;
    }
    for (let i = 0; i < 5 && i < area.length; i++)
      if (typeof area[i] != "number" || !Number.isFinite(area[i]))
        bad.push(`${where}[${i}] is ${JSON.stringify(area[i])} in ${JSON.stringify(area)}`);
    if (area.length > 5 && typeof area[5] != "string")
      bad.push(`${where}[5] is not a city id: ${JSON.stringify(area)}`);
  }

  for (const region of Object.values(rul.regions ?? {})) {
    for (const [i, area] of (region.areas ?? []).entries())
      checkArea(area, `${region.id} area ${i}`);
    for (const [zi, zone] of (region.missionZones ?? []).entries()) {
      zones++;
      if (!Array.isArray(zone)) {
        bad.push(`${region.id} zone ${zi} is not a list: ${JSON.stringify(zone)}`);
        continue;
      }
      for (const [ai, area] of zone.entries()) checkArea(area, `${region.id} zone ${zi} box ${ai}`);
    }
  }

  ok(bad.length == 0, `${label}: every coordinate is a number`, bad.slice(0, 3).join("; "));
  return { boxes, zones };
}

const checked = [survey(await loadBuiltinPack(), "builtins")];

// The pack that actually quotes a coordinate: TFTD's inline `globe:` ruleset
// writes most of its zone numbers as strings, so it is the case worth having
for (const name of [
  "tftdvanillaplus-dhf2.zip",
  "Dioxine_XPiratez_noimages.rar",
  "openxcom_xfiles_42.zip",
]) {
  const path = examplePack(name);
  if (path) checked.push(survey(await loadPack(path), name.replace(/\.(zip|rar)$/i, "")));
}

ok(
  checked.some((c) => c.zones > 0),
  "at least one pack declares mission zones",
);

report();
