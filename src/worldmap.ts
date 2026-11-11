import { rul } from "./rul/Ruleset";
import { resolveImage } from "./packSource";
import { builtinFile } from "./load";

/**
 * The OpenXcom world map, flattened.
 *
 * The globe is not an image in the ruleset: the game draws it from data. Land is
 * a list of coarse polygons with a texture id, borders are separate polylines,
 * and nations are plain rectangles. This module turns all of that into one flat
 * equirectangular picture, which is the shape a pedia illustration wants.
 *
 * Three things about OpenXcom's coordinates are easy to get wrong:
 *
 * - Longitude runs 0..360 with 0 at Greenwich, so the map has to be cut
 *   somewhere. Cutting at Greenwich would put the seam through Britain and
 *   Africa; `ORIGIN` moves it to the Bering Strait instead.
 * - Latitude is stored with **north negative** (`STR_USA` sits at `-35`), so a
 *   screen row is `90 + lat`, not `90 - lat`.
 * - A vertex at a pole is one point on the sphere but a whole edge of the map,
 *   so it has to be split into two before flattening or the polar caps come out
 *   as wedges.
 */

/** Longitude that lands on the left and right edge of the map, in game degrees */
export const ORIGIN = 190;

/**
 * The stock globe file, in the form the resource index keys it.
 *
 * A pack names it in `globe: data:` or relies on it implicitly, and the builtin
 * mods ship a copy, so this is the one resource the world map always needs.
 */
export const WORLD_DAT = "geodata/world.dat";

/**
 * One `globe: textures: terrain:` row.
 *
 * `area` is `[lonMin, lonMax, latMin, latMax]` and defaults to the whole globe,
 * which is why a pack can list several terrains for one texture and let the
 * position decide. `getRandomTerrain` in the game picks one of these by weight.
 */
export type TerrainCriteria = {
  name: string,
  weight: number,
  lonMin: number,
  lonMax: number,
  latMin: number,
  latMax: number,
};

/** A polygon of land, with the terrain name its texture resolved to */
export type MapPolygon = { texture: number, terrain?: string, points: [number, number][] };

/** A single border or coastline stroke */
export type MapLine = [number, number][];

/** A nation's label anchor */
export type MapLabel = { text: string, lon: number, lat: number };

export type MapRectangle = { lonMin: number, lonMax: number, latMin: number, latMax: number };

export type WorldMap = {
  polygons: MapPolygon[];
  lines: MapLine[];
  countries: { id: string, label?: { lon: number, lat: number }, areas: MapRectangle[] }[];
  /** Terrain criteria per texture id, as the pack's own `globe: textures:` declares them */
  terrains: { [texture: number]: TerrainCriteria[] };
};

/**
 * Reads a `WORLD.DAT` into polygons.
 *
 * Each record is ten little-endian `int16`s: three or four vertex pairs in
 * eighths of a degree, then the texture id. The fourth pair is absent when its
 * longitude is `-1`, so the record length is fixed and only the used part
 * varies.
 */
export function parseWorldDat(bytes: Uint8Array): MapPolygon[] {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let polygons: MapPolygon[] = [];
  for (let offset = 0; offset + 20 <= bytes.byteLength; offset += 20) {
    let value: number[] = [];
    for (let i = 0; i < 10; i++)
      value.push(view.getInt16(offset + i * 2, true));
    let count = value[6] != -1 ? 4 : 3;
    let points: [number, number][] = [];
    for (let i = 0; i < count; i++)
      points.push([value[i * 2] * 0.125, value[i * 2 + 1] * 0.125]);
    polygons.push({ texture: value[8], points });
  }
  return polygons;
}

/** Reads the terrain criteria of each texture id from the ruleset's `globe:` node */
export function readTerrains(): { [texture: number]: TerrainCriteria[] } {
  let globe = rul?.raw?.globe;
  let result: { [texture: number]: TerrainCriteria[] } = {};
  if (!globe)
    return result;
  for (let entry of globe.textures ?? []) {
    if (entry?.id == null || !entry.terrain?.length)
      continue;
    let criteria: TerrainCriteria[] = [];
    for (let raw of entry.terrain) {
      if (!raw?.name)
        continue;
      // `area` is optional and defaults to the whole globe, exactly as
      // `TerrainCriteria` does in the game
      let area = Array.isArray(raw.area) ? raw.area.map(Number) : [];
      criteria.push({
        name: raw.name,
        weight: raw.weight == null ? 1 : Number(raw.weight),
        lonMin: area[0] ?? 0,
        lonMax: area[1] ?? 360,
        latMin: area[2] ?? -90,
        latMax: area[3] ?? 90
      });
    }
    if (criteria.length)
      result[entry.id] = criteria;
  }
  return result;
}

/**
 * The centre longitude of a shape, in 0..360.
 *
 * A plain average is wrong for a shape that straddles 0: its vertices are near
 * both ends of the range, so the mean lands in the middle of the world. Averaging
 * the unit vectors and taking the angle back avoids that, and is what the game's
 * own target positions amount to.
 */
function circularMeanLongitude(lons: number[]) {
  let x = 0, y = 0;
  for (let lon of lons) {
    let rad = lon * Math.PI / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  let deg = Math.atan2(y, x) * 180 / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/**
 * The terrain a texture resolves to at one place on the map.
 *
 * The game picks a random target and asks `getRandomTerrain`, so a texture can
 * be cold forest in one latitude band and jungle in another. A still map has no
 * random target: the band containing this polygon's own centre is used, and
 * among the terrains in that band the heaviest one wins, which is the most
 * representative rather than an arbitrary draw.
 */
export function terrainAt(criteria: TerrainCriteria[] | undefined, lon: number, lat: number) {
  if (!criteria?.length)
    return undefined;
  let candidates = criteria.filter(t =>
    t.weight > 0 &&
    lon >= t.lonMin && lon < t.lonMax &&
    lat >= t.latMin && lat < t.latMax);
  if (!candidates.length)
    candidates = criteria.filter(t => t.weight > 0);
  return [...candidates].sort((a, b) => b.weight - a.weight)[0]?.name;
}

/** Reads the borders from the ruleset's `globe: polylines:` */
export function readPolylines(): MapLine[] {
  let lines: MapLine[] = [];
  for (let raw of rul?.raw?.globe?.polylines ?? []) {
    if (!Array.isArray(raw))
      continue;
    let line: MapLine = [];
    for (let i = 0; i + 1 < raw.length; i += 2)
      line.push([Number(raw[i]), Number(raw[i + 1])]);
    if (line.length > 1)
      lines.push(line);
  }
  return lines;
}

/** Reads the nations, whose areas are plain rectangles rather than borders */
export function readCountries(): WorldMap["countries"] {
  let countries: WorldMap["countries"] = [];
  for (let entry of Object.values(rul?.countries ?? {}) as any[]) {
    if (!entry?.id)
      continue;
    let areas: MapRectangle[] = [];
    for (let area of entry.areas ?? []) {
      if (!Array.isArray(area) || area.length < 4)
        continue;
      let [lonMin, lonMax, latMin, latMax] = area.map(Number);
      areas.push({ lonMin, lonMax, latMin: Math.min(latMin, latMax), latMax: Math.max(latMin, latMax) });
    }
    countries.push({
      id: entry.id,
      label: entry.labelLon != null ? { lon: Number(entry.labelLon), lat: Number(entry.labelLat) } : undefined,
      areas
    });
  }
  return countries;
}

/**
 * Every globe `globe:` node in the pack has already been merged into
 * `rul.raw.globe`, so only the polygon source has to be fetched: the `data:`
 * file the ruleset names, or the stock `WORLD.DAT` when it names none.
 *
 * A pack can also replace the polygons inline with `globe: polygons:`, which
 * OpenXcom prefers over `data:`. Those are `[texture, lon, lat, ...]`.
 */
export async function loadWorldMap(): Promise<WorldMap | undefined> {
  let globe = rul?.raw?.globe;
  if (!globe)
    return;

  let polygons = readInlinePolygons(globe.polygons);
  if (!polygons) {
    // `globe.data` is a path relative to the mod folder, the same form the
    // resource index keys; `WORLD_DAT` is the stock one it usually names
    let bytes = await readDat(globe.data ?? WORLD_DAT);
    if (bytes)
      polygons = parseWorldDat(bytes);
  }

  if (!polygons?.length)
    return;

  let terrains = readTerrains();

  // Resolve each polygon's texture once, at its own centre, so the renderer and
  // the legend agree on what every shape is
  for (let polygon of polygons)
    polygon.terrain = terrainAt(terrains[polygon.texture],
      circularMeanLongitude(polygon.points.map(p => p[0])),
      polygon.points.reduce((a, p) => a + p[1], 0) / polygon.points.length);

  return {
    polygons,
    lines: readPolylines(),
    countries: readCountries(),
    terrains
  };
}

/** The inline replacement form, `[texture, lon, lat, ...]` */
function readInlinePolygons(raw: any): MapPolygon[] | undefined {
  if (!Array.isArray(raw) || !raw.length)
    return;
  let polygons: MapPolygon[] = [];
  for (let entry of raw) {
    if (!Array.isArray(entry) || entry.length < 7)
      continue;
    let points: [number, number][] = [];
    for (let i = 1; i + 1 < entry.length; i += 2)
      points.push([Number(entry[i]), Number(entry[i + 1])]);
    if (points.length >= 3)
      polygons.push({ texture: Number(entry[0]), points });
  }
  return polygons.length ? polygons : undefined;
}

/** The full archive path of a globe DAT file, resolved the way `FileMap` does */
export function findDatPath(rel?: string) {
  if (!rel)
    return;
  let key = rel.replace(/^[/\\]+/, "").toLowerCase();
  return rul?.resourceMap?.[key];
}

/**
 * Bytes of a DAT file, preferring the shown pack over the builtin copy.
 *
 * DATs are stored next to the images, so a pack that ships its own `WORLD.DAT`
 * comes back through the normal image lookup. Packs that ship none fall back to
 * the copy compiled into the builtin mods, which is read straight from the
 * bundle rather than the database: an exported page opened from disk has no
 * database to read it from.
 */
async function readDat(rel: string) {
  let path = findDatPath(rel) ?? rel;
  let resolved = await resolveImage(path);
  if (resolved?.data)
    return resolved.data;

  // An inlined pack has no bytes in storage: its files sit next to the HTML
  // page, so the URL has to be fetched instead. The stock globe usually is not
  // there, which is not a problem, hence no warning.
  if (resolved?.url) {
    try {
      let response = await fetch(resolved.url);
      if (response.ok)
        return new Uint8Array(await response.arrayBuffer());
    } catch (e) {
      console.debug(`Can't read ${resolved.url}`, e);
    }
  }

  // The builtin copy, read straight from the compiled-in payload. Only the
  // stock globe has one; a pack that names a file it does not ship gets no map
  // rather than a different one.
  let builtinPath = findDatPath(rel);
  if (builtinPath && /^mods\//i.test(builtinPath))
    return builtinFile(builtinPath);
  if (rel.replace(/^[/\\]+/, "").toLowerCase() == WORLD_DAT)
    return builtinFile("mods/xpedia/GEODATA/WORLD.DAT");
}
