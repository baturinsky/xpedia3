/**
 * The marks a flight is drawn with: stop markers and leg lines.
 *
 * They live apart from the map because the map is not the only place a flight is
 * drawn. The strip under it, the legend, and the flight plan table all show the
 * same stops and legs, and a second drawing of them is a second convention: the
 * circle would stop meaning "in the air" the moment one of the four drifted.
 *
 * Everything here is in map units, as the picture is. A caller that draws at a
 * different scale either passes its own `size` or divides by its magnification,
 * which is what `RegionOverlay` does for the map's zoom.
 */

/** The map's own coordinate space, in viewBox units */
export const WIDTH = 2048;
export const HEIGHT = 1024;

/**
 * How far a leg's line is drawn per ten minutes of flying, in map units.
 *
 * The map is 2048 units wide for a full turn of 360 degrees, and a degree is 60
 * nautical miles, so one nautical mile is `WIDTH / 21600` units. A craft's speed
 * is knots, so ten minutes covers a sixth of it.
 *
 * The equator scale is used, which overstates distance at high latitude on an
 * equirectangular drawing. That is a property of the projection rather than of
 * this encoding, and the alternative — correcting per latitude — would make two
 * legs flown at the same speed carry dashes of different length depending on
 * where on the globe they happen to be.
 */
const KNOTS_PER_TEN_MINUTES = WIDTH / 21600 / 6;

/** A leg's dash and gap, in map units, from its speed */
export function legDash(speedPercent?: number, craftKnots?: number) {
  if (speedPercent == null || !craftKnots || craftKnots <= 0) return undefined;
  const knots = (craftKnots * speedPercent) / 100;
  // A dash is ten minutes of flight, but a slow craft would produce a dash too
  // short to see and a fast one a dash longer than the gap between two stops, so
  // the length is kept within a readable band. The band is wide enough that the
  // ordering by speed always survives.
  const dash = Math.min(90, Math.max(5, knots * KNOTS_PER_TEN_MINUTES));
  // The gap scales with the dash so a fast leg does not become a solid line
  return `${dash.toFixed(1)} ${(dash * 0.34).toFixed(1)}`;
}

/**
 * A leg's line width, in map units, from its altitude.
 *
 * Higher is thinner, as the higher a craft flies the less it is on the map at
 * all. The engine's five levels run from ground to very high, and the widths are
 * chosen to reach from clearly present to barely there.
 */
const altitudeWidths = [11, 8.5, 6.5, 4.5, 3];

export function legWidth(altitude?: number) {
  const n = Math.round(Number(altitude));
  return altitudeWidths[Number.isFinite(n) ? Math.min(4, Math.max(0, n)) : 2];
}

/**
 * The radius of a stop marker, in screen units.
 *
 * Markers keep a constant size on screen, so on the map this is divided by the
 * magnification. The leg arrow has to keep clear of it, and the strip under the
 * map draws a marker of its own at this radius, so the number lives in one place.
 */
export const STOP_RADIUS = 14;

/**
 * A stop of a flight: a circle when the UFO is in the air, a square when it is on
 * the ground.
 *
 * Shape carries the one fact about a stop that a player plans around, which is
 * whether the site appears here: a landing is where a mission site can be found,
 * and a UFO merely passing through is not. Shape is used rather than size or
 * fill because the fill already means "which zone", and a crowded picture needs
 * both to be readable at once.
 *
 * The same two shapes are used everywhere a flight is drawn — the map, the strip
 * under it, the legend and the flight plan — so the legend is a picture of the
 * thing it explains rather than a second convention.
 */
export function stopMarker(
  at: { x: number; y: number },
  size: number,
  lands: boolean,
  className: string,
) {
  if (!lands) return <circle className={className} cx={at.x} cy={at.y} r={size} />;
  // A square is sized to cover about the same area as the circle it replaces,
  // so a landing does not look bigger merely for being square
  const half = size * 0.88;
  const pts = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => `${(at.x + sx * half).toFixed(1)},${(at.y + sy * half).toFixed(1)}`);
  return <polygon className={`${className} region-stop-land`} points={pts.join(" ")} />;
}

/**
 * The geometry of one leg's direction arrow.
 *
 * Each leg is its own element, because a leg carries its own altitude and speed,
 * so an SVG `marker` cannot be used: it cannot take the colour of the line that
 * references it in a way that is reliable across browsers. A small filled
 * triangle is drawn directly instead.
 *
 * It sits a fifth of the way back from the end rather than at the midpoint. The
 * direction a reader wants is the direction *into* the stop, and on a long leg
 * the midpoint is far from the thing being asked about.
 *
 * The far end of the leg is covered by the stop marker, which is a fixed size on
 * screen, so the arrow has to stay outside that too: an arrow drawn 3 units from
 * the end of a 26-unit leg is entirely hidden under the marker. `keeps` is the
 * clear space to leave at the end, in map units. A leg with no room left between
 * its two markers gets no arrow at all — there is nothing on screen to put one on,
 * and the stops at either end already say where the leg goes.
 */
export function arrowAt(
  a: { x: number; y: number },
  b: { x: number; y: number },
  scale = 1,
  keeps = 0,
) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return undefined;
  const ux = dx / length,
    uy = dy / length;
  const size = 7 * scale,
    half = 4.2 * scale;
  // Distance from the far end to the tip. Not near the end is preferred; not
  // inside the marker is required.
  const margin = 2 * scale + size;
  const fromEnd = Math.max(length * 0.2, keeps + margin);
  // Even the point of the arrow would be inside a marker, so there is no clear
  // stretch of line to mark. A leg this short is two markers with a sliver
  // between them; an arrow there would only be a smudge on a marker.
  if (fromEnd > length / 2) return undefined;
  const cx = b.x - ux * fromEnd,
    cy = b.y - uy * fromEnd;
  const tip = [cx + ux * size, cy + uy * size];
  const backL = [cx - ux * size * 0.6 - uy * half, cy - uy * size * 0.6 + ux * half];
  const backR = [cx - ux * size * 0.6 + uy * half, cy - uy * size * 0.6 - ux * half];
  return [tip, backL, backR].map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
}
