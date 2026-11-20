import type { MapArea, Region, UfoTrajectory } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import { ORIGIN } from "../worldmap";
import type { Overlay, OverlayPath } from "./WorldMapArticle";

/**
 * Region and trajectory data as the world map draws it.
 *
 * A waypoint is `[zone, altitude, speed]`, and the zone indexes the region's
 * `missionZones`. That indirection is the whole reason this exists: the game
 * picks a random point inside the zone, so a still picture can only show the
 * zone itself, and the path has to be reduced to a line through zone centres.
 */

/**
 * How far a zone reaches in latitude, in degrees.
 *
 * A zone is a set of boxes, and every one of them is a place the game may pick.
 * The only question this answers is whether the zone covers the globe, which is
 * the designation packs use for "a UFO may appear anywhere".
 */
function latSpanOf(boxes: MapArea[]) {
  let min = Infinity,
    max = -Infinity;
  for (const area of boxes) {
    min = Math.min(min, Math.min(Number(area[2]), Number(area[3])));
    max = Math.max(max, Math.max(Number(area[2]), Number(area[3])));
  }
  return max - min;
}

/**
 * A box's area on the globe, in square degrees of longitude times sine of latitude.
 *
 * Used to choose the box of a zone or a region that is worth putting a marker or
 * a title in: the largest one is the most visible part of the area, and — unlike
 * the mean of several boxes — it is somewhere the area really covers.
 *
 * A box whose far edge is behind its near one is read as crossing the
 * antimeridian (`[350, 8, ...]` is eighteen degrees wide, not 342), which is how
 * a region's `areas` state it. A mission zone is not supposed to do that, and the
 * engine logs an error when one does, so the same reading is the honest one there
 * too.
 */
export function boxArea(area: MapArea) {
  let lonLow = Number(area[0]),
    lonHigh = Number(area[1]);
  let latLow = Number(area[2]),
    latHigh = Number(area[3]);
  if (lonHigh < lonLow) lonHigh += 360;
  if (latLow > latHigh) [latLow, latHigh] = [latHigh, latLow];
  // `sin` weights the longitude by how much of the globe a degree of it covers,
  // so a box near the pole is not ranked as if it were a box at the equator
  const sine = Math.sin((latHigh * Math.PI) / 180) - Math.sin((latLow * Math.PI) / 180);
  return (lonHigh - lonLow) * Math.abs(sine);
}

/** The middle of one box, with longitude normalised back into 0..360 when it leaves it */
function boxCenter(area: MapArea) {
  let lon = (Number(area[0]) + Number(area[1])) / 2;
  const lat = (Number(area[2]) + Number(area[3])) / 2;
  // Only fold an out-of-range longitude. Running a value that is already in
  // range through `% 360` twice loses precision in the last bits, which is
  // enough to put the marker a hair outside the box it is meant to sit in.
  if (lon < 0 || lon >= 360) lon = ((lon % 360) + 360) % 360;
  return { lon, lat };
}

/**
 * The middle of the picture, for a stop the pack puts anywhere on the globe.
 *
 * The map is cut a turn away from Greenwich, so the middle column is half a turn
 * from `ORIGIN` rather than longitude 0. Using the projection's own centre keeps
 * the marker in the middle of what is drawn, whichever cut a future change makes.
 */
const anywhereCenter = { lon: ORIGIN + 180, lat: 0, anywhere: true };

/**
 * Where to put a stop's marker, or nothing when no honest answer exists.
 *
 * A zone is a set of boxes, and the game picks one of them at random before
 * picking a point inside it (`RuleRegion::getRandomPoint`). That makes the *mean*
 * of the boxes a bad marker: it is the average of disjoint patches, so it lands
 * in the sea between them, or on the pole. Measured over one pack, 71.5% of such
 * means fell outside every box of their own zone — a pinpoint the UFO can never
 * occupy, which is exactly the precision the ruleset does not have.
 *
 * So the marker is placed at the middle of the zone's **largest** box. That is a
 * place the game really can choose, it is the most visible part of the zone, and
 * the shaded box underneath still shows that the stop is anywhere in there. When
 * every box is a single point the zone is a fixed list of spots, and the one
 * nearest the middle of that list is used so the marker does not depend on the
 * order the pack happened to write them in.
 *
 * A zone that reaches from pole to pole is the "anywhere" zone — the pack's way
 * of saying the game may put this stop anywhere on the globe. It is drawn at the
 * middle of the map instead of being left out: the stop does happen, and a path
 * that silently lost a third of its stops is worse than one that says "no place
 * in particular" at the one spot which means exactly that. The page tells such a
 * marker apart by `anywhere`, since its position is the same for every one of
 * them.
 */
export function zoneCenter(
  zone: MapArea[],
): { lon: number; lat: number; anywhere?: boolean } | undefined {
  const boxes = zone.filter((area) => area && area.length >= 4);
  if (!boxes.length) return;
  if (latSpanOf(boxes) >= 170) return anywhereCenter;

  let largest = -1,
    largestArea = -Infinity;
  boxes.forEach((area, i) => {
    const area2 = boxArea(area);
    if (area2 > largestArea) {
      largestArea = area2;
      largest = i;
    }
  });
  // All boxes are single points: the zone names exact spots rather than panels,
  // so pick the one nearest their mean rather than whichever came first
  if (largestArea <= 0) {
    const centres = boxes.map(boxCenter);
    const lat = centres.reduce((sum, c) => sum + c.lat, 0) / centres.length;
    let x = 0,
      y = 0;
    for (const c of centres) {
      const radians = (c.lon * Math.PI) / 180;
      x += Math.cos(radians);
      y += Math.sin(radians);
    }
    const lon = ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
    let best = centres[0],
      bestDistance = Infinity;
    for (const c of centres) {
      let dLon = Math.abs(c.lon - lon);
      if (dLon > 180) dLon = 360 - dLon;
      const distance = Math.hypot(dLon, c.lat - lat);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = c;
      }
    }
    return best;
  }
  return boxCenter(boxes[largest]);
}

/**
 * One stop of a flight: where the UFO is, and how it got there.
 *
 * `leg` is the stop's own index in the trajectory, which is 0 for the spawn
 * point, so the numbers on the picture are the numbers in the article's
 * waypoint list rather than a separate count.
 *
 * A stop also carries the leg that arrives at it, because the picture draws a
 * separate line per leg: the engine lets each leg fly at its own altitude and
 * speed, and the article encodes both in the drawing.
 */
export type PathStop = {
  zone: number;
  point: { lon: number; lat: number };
  leg: number;
  /** Whether the UFO lands when it arrives */
  lands: boolean;
  /** Altitude the arriving leg is flown at, or nothing for the spawn point */
  altitude?: number;
  /** Percentage of the craft's top speed the arriving leg is flown at */
  speed?: number;
  /**
   * Whether the zone is the "anywhere" one, so this marker only means "no place
   * in particular". The point is the same for every such stop, so the picture
   * has to say so rather than let several markers pile up on one another.
   */
  anywhere?: boolean;
};

/**
 * What a trajectory looks like drawn in one region.
 *
 * `missing` counts the stops whose zone index the region does not have at all.
 * Every other stop is placed, including the ones in an "anywhere" zone, which sit
 * at the middle of the map: the flight really does visit them, so a picture that
 * dropped them would be about a different flight.
 */
export type PathShape = {
  stops: PathStop[];
  /** Stops whose zone index the region does not have at all */
  missing: number;
};

/** Whether two stops are the same point on the globe */
export function samePlace(a: PathStop, b: PathStop) {
  return a.point.lon === b.point.lon && a.point.lat === b.point.lat;
}

/**
 * The stops of a path in one region.
 *
 * The stop sequence is `UfoTrajectory.flightStops`, which is the engine's own:
 * the spawn point, then one arrival per leg, with the second line's zone
 * appearing twice because the engine re-targets it. Zone centres are used for
 * the positions, since a zone is a box the game picks a random point in.
 *
 * A stop whose zone index this region does not have is left out: there is no
 * zone to place it in, and the leg numbers the page prints come from the stop
 * itself, so the survivors still carry the right ones. A stop in an "anywhere"
 * zone is not left out — it is placed at the middle of the map, where the marker
 * can say "no place in particular" instead of the picture silently losing it.
 */
export function pathShape(trajectory: UfoTrajectory, region: Region): PathShape {
  const shape: PathShape = { stops: [], missing: 0 };
  // A path the engine refuses to fly has no shape worth drawing; the article
  // says why rather than showing a single dot
  if (!trajectory.legs.length) return shape;

  const zones = region.missionZones ?? [];
  for (const stop of trajectory.flightStops) {
    const zone = zones[stop.zone];
    if (!zone) {
      shape.missing++;
      continue;
    }
    const center = zoneCenter(zone);
    if (!center) {
      shape.missing++;
      continue;
    }
    shape.stops.push({
      zone: stop.zone,
      point: center,
      leg: stop.index,
      lands: stop.lands,
      altitude: stop.arrival?.altitude,
      speed: stop.arrival?.speed,
      anywhere: center.anywhere,
    });
  }
  return shape;
}

/**
 * A trajectory drawn in one region, or nothing when it has no place at all.
 *
 * A path whose every stop is the same zone has no line, but it is not nothing:
 * the UFO really does appear, wait and leave at one spot, and that spot is worth
 * marking. So the test is whether any stop could be placed, not whether any leg
 * could be drawn.
 */
export function trajectoryPath(trajectory: UfoTrajectory, region: Region): OverlayPath | undefined {
  const shape = pathShape(trajectory, region);
  if (!shape.stops.length) return;
  const speeds = pathSpeeds(trajectory);
  return {
    id: trajectory.uid,
    stops: shape.stops,
    // A leg's speed is a percentage of the craft's top speed, and a path may be
    // flown by several craft. The mean is what the drawing can show in one line.
    craftKnots: speeds ? (speeds.min + speeds.max) / 2 : undefined,
  };
}

/**
 * A region's overlay: its outline, its zone boxes, and the given paths.
 *
 * `paths` is passed in rather than derived, because which flights to draw is a
 * presentation choice: a region page wants the flights of its missions, a
 * trajectory page wants just the one.
 *
 * `outline` is that same kind of choice. The region's own `areas` boxes answer
 * "is this point in this region", which is what a region page is about; on a
 * trajectory page they are scenery around a flight that already names its region
 * in the radio list above, so they are left out. The zone boxes stay either way:
 * they are what the waypoints actually index.
 */
export function regionOverlay(
  region: Region,
  paths: UfoTrajectory[] = [],
  { outline = true }: { outline?: boolean } = {},
): Overlay {
  return {
    id: region.uid,
    color: regionColor(region.uid),
    areas: outline ? region.areas : undefined,
    zones: region.missionZones,
    paths: paths
      .map((path) => trajectoryPath(path, region))
      .filter((path): path is OverlayPath => path != null),
  };
}

/**
 * An OKLCH colour as a hex string, converted here rather than left to the browser.
 *
 * OKLCH is the right space to *choose* a colour in: equal steps in lightness look
 * like equal steps, and the angle keeps hues as far apart as they can be. It is
 * the wrong thing to *emit*, because this pedia ships as one self-contained HTML
 * file that people open in whatever browser they have. A browser that does not
 * understand `oklch()` drops the declaration, and the shape involved falls back to
 * black or to the inherited colour — a silent hard failure, where hex always
 * works. So the conversion is done once, here, and the rest of the app only ever
 * sees plain `#rrggbb`.
 *
 * The maths is the standard OKLab definition: OKLCH to OKLab to linear sRGB, then
 * the sRGB transfer function. Out-of-gamut channels are clamped, which is why the
 * callers keep their chroma low.
 */
function oklchToHex(light: number, chroma: number, hue: number) {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  const l = (light + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (light - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (light - 0.0894841775 * a - 1.291485548 * b) ** 3;

  // Linear sRGB
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  // The sRGB transfer function, then 8 bits
  const encode = (value: number) => {
    const clamped = Math.min(1, Math.max(0, value));
    const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  };
  const hex = [red, green, blue]
    .map((channel) => encode(channel).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

/**
 * One colour per region, so the overlay reads as a highlight over the land.
 *
 * The region colour sits under everything on the page, so it is kept light and
 * only mildly saturated: it has to be readable against the sea it is drawn on and
 * not compete with the zones on top of it.
 */
export function regionColor(id?: string) {
  if (!id) return undefined;
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return oklchToHex(0.8, 0.13, hue);
}

/**
 * Colours for a set of regions drawn side by side, one per region.
 *
 * `regionColor` is about one region at a time: it hashes the id into a hue, which
 * is all a single overlay over the land needs. A picture *of* the regions is a
 * different problem, because every one of them is a peer of every other. Hashed
 * hues collide there — measured on the XFiles regions, South America and Southern
 * Africa came out 0.3 ΔE apart, which is to say the same colour.
 *
 * So the hues are spread evenly instead. The count is known up front, so
 * `i * 360 / count` is as far apart as that many of them can be made, and
 * alternating lightness with chroma moving the other way separates the pairs that
 * end up adjacent on the wheel (the same reasoning as `zoneColor`). Measured worst
 * pair: 6.7 ΔE at fifteen regions, 7.2 at twenty-two, 10 ΔE at twelve.
 *
 * The colours are assigned by position, not by identity, so they can shift when a
 * pack is swapped. That is deliberate: the picture is read as one drawing, and the
 * names written in each contour are what identify it. Past about forty regions
 * even spreading runs out of room — 3.2 ΔE at forty — but a pack that size has
 * more contours than the eye can follow anyway.
 */
export function regionPalette(count: number): string[] {
  const palette: string[] = [];
  for (let i = 0; i < count; i++) {
    const dark = i % 2 === 1;
    palette.push(
      oklchToHex(dark ? 0.64 : 0.76, dark ? 0.16 : 0.17, ((i * 360) / Math.max(count, 2)) % 360),
    );
  }
  return palette;
}

/**
 * Colours for the zones of a flight.
 *
 * A waypoint names a zone and the game picks a random point inside it, so a zone
 * is the only thing on a trajectory map that can honestly be pointed at. Giving
 * each one a colour is what lets the picture say "stop 1 is anywhere in the red
 * box, stop 2 anywhere in the blue one", which a single-colour line cannot.
 *
 * The hue walks the wheel by the golden angle, so consecutive zones are as far
 * apart as geometry allows, with no palette size to run out of.
 *
 * Lightness and chroma step on a second, independent cycle. Hue alone is not
 * enough: on a path of six zones the golden angle has wrapped most of the way
 * round, so zones 1 and 6 sit 32° apart in hue, and two bright colours that close
 * differ by only ~13 ΔE in OKLab — the pair a reader is most likely to confuse.
 * Alternating lightness fixes that pair (measured: 13.5 ΔE at the worst pair up to
 * eight zones, against 4.4 before), and moving chroma the opposite way keeps the
 * darker variant from being a dim copy of the lighter one.
 *
 * The values are chosen in OKLCH, which is perceptually uniform, and emitted as
 * hex so no browser has to understand the newer syntax — see `oklchToHex`.
 */
export function zoneColor(index: number) {
  const hue = (index * 137.508) % 360;
  const dark = index % 2 === 1;
  // Measured over the first eight indices, this pair keeps the closest two zones
  // 17 ΔE apart in OKLab, against 4.4 for a fixed lightness: 13.4 for the worst
  // pair of a four-zone path. The dark step is kept at 0.60 rather than lower so
  // it still reads against the navy sea it is usually drawn on.
  return oklchToHex(dark ? 0.6 : 0.78, dark ? 0.18 : 0.14, hue);
}

/**
 * The zones a flight visits, in the order it first reaches them.
 *
 * A zone is often visited more than once (the engine re-targets the second line,
 * and a patrol returns the way it came), so this is the distinct list: colour is
 * a property of the place, not of the stop.
 */
export function visitedZones(stops: PathStop[]) {
  const out: number[] = [];
  for (const stop of stops) if (!out.includes(stop.zone)) out.push(stop.zone);
  return out;
}

/**
 * One colour per flight leg, so a leg can be picked out by its own colour.
 *
 * Zones are coloured by place and the stop rows carry that colour, which left a
 * leg with nothing of its own to say: colouring a leg by its destination only
 * repeated the stop above it. A leg is a move, not a place, so it gets its own
 * series, indexed by leg number.
 *
 * The series walks the wheel by the golden angle like the zone palette, but the
 * whole of it is turned by 120°, and it uses a different pair of lightnesses. Both
 * matter: the two palettes appear on the same page, and a leg that happened to
 * match a zone box would suggest a relation that is not there. Measured in OKLab,
 * the closest leg colour to any of the six zone colours a path can show is 9 ΔE at
 * this offset; the unturned series collided at 0.9.
 *
 * Within the series, alternating lightness is what keeps the close pairs apart, as
 * it does for zones: leg 1 and leg 6 of a six-leg path sit 32° apart in hue, and at
 * one lightness they merge. Measured worst pair: 17.6 ΔE over eight legs. Past
 * about ten legs a path is a patrol scribble where the dashes and the stops carry
 * the meaning and colour is a rank, not an identity.
 */
export function legColor(index: number) {
  const hue = (index * 137.508 + 120) % 360;
  const dark = index % 2 === 1;
  return oklchToHex(dark ? 0.56 : 0.76, dark ? 0.18 : 0.16, hue);
}

/**
 * The top speeds of the crafts that can fly a path, in knots, or nothing when
 * the pack offers none.
 *
 * A leg's speed is a percentage of the craft's `speedMax`, and one path is
 * usually flown by several craft with different top speeds (X-Piratez flies `P4`
 * with twelve). Turning a percentage into a distance therefore needs a craft,
 * and the honest summary of "several" is either the shared value or a range.
 */
export function pathSpeeds(trajectory: UfoTrajectory): { min: number; max: number } | undefined {
  const values: number[] = [];
  for (const mission of rul.missionsFlying(trajectory.uid))
    for (const wave of rul.alienMissions?.[mission]?.waves ?? []) {
      if (wave?.trajectory !== trajectory.uid) continue;
      const speed = Number(rul.ufos?.[wave?.ufo]?.speedMax);
      // A `speedMax` of 0 is a craft that does not move, and packs do carry
      // nonsense values here, so only a positive number is a speed
      if (Number.isFinite(speed) && speed > 0 && speed < 100000) values.push(speed);
    }
  if (!values.length) return;
  return { min: Math.min(...values), max: Math.max(...values) };
}
