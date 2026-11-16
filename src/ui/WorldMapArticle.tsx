import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { loadWorldMap, ORIGIN, type MapRectangle, type WorldMap } from "../worldmap";
import type { MapArea, Region, UfoTrajectory } from "../rul/Entry";
import { MAX_DRAWN_PATHS, drawnLegs, legColor, pathShape, regionOverlay, samePlace, zoneColor, type PathStop } from "./mapOverlay";
import { formatSeconds } from "./timing";
import { colorForCountry, colorForTerrain, readDeclaredColors, readDeclaredCountryColors } from "./mapColors";
import { rul } from "../rul/Ruleset";
import { state, remembered, rememberSelection, update } from "../state";
import { Tr, Val } from "./Val";

/**
 * The pack's world map, drawn flat.
 *
 * OpenXcom shows an orthographic globe, which cannot be drawn as one still
 * picture: how much of the world you see depends on where the globe is turned.
 * An equirectangular projection is used instead, which is the usual shape for a
 * reference map and always shows the whole world.
 *
 * The drawing follows the game's own model: land is the polygon list, borders
 * are the polylines, and nation labels come from the country anchors.
 */

const WIDTH = 2048;
const HEIGHT = 1024;

/**
 * A region drawn over the map: the boxes its sites spawn in, the zones its
 * trajectories bend through, and the paths themselves.
 *
 * The three are separate because they answer different questions and a pack
 * rarely has all of them: `areas` is where a mission site can appear, `zones`
 * is what a waypoint refers to, and `paths` is a flight. A region with no
 * `areas` (most of them) is still worth drawing for its zones, which are the
 * city points the game actually uses.
 */
export type Overlay = {
  id: string;
  color?: string;
  areas?: MapArea[];
  zones?: MapArea[][];
  paths?: OverlayPath[];
  /** Whether this overlay is the one under the pointer */
  hot?: boolean;
};

/**
 * One flight path, as globe points in flight order.
 *
 * `stops` carries the leg number of each placed stop, so the picture can number
 * its stops the same way the article's waypoint list does. `dropped` counts the
 * stops of the trajectory that could not be placed: a stop names a mission zone,
 * and a zone the game treats as "anywhere" has no centre. The line joins the
 * stops that do have a place, and the count lets the page say that some were
 * left out.
 *
 * `craftKnots` is the top speed the drawing converts a leg's speed percentage
 * into, so a dash can stand for a stated stretch of time. `craftSpeeds` keeps the
 * range it came from, because a path flown by several craft has no single speed
 * and the page should say so rather than pretend.
 */
export type OverlayPath = {
  id: string;
  stops: PathStop[];
  dropped?: number;
  craftKnots?: number;
  craftSpeeds?: { min: number, max: number };
};


/** Rows keep north up: OpenXcom stores latitude with north negative */
const rowForLat = (lat: number) => (90 + lat) / 180 * HEIGHT;

/**
 * A game longitude to a column on the visible turn.
 *
 * `ORIGIN` is subtracted so the map is cut at the Bering Strait: cutting at
 * Greenwich would run the seam through Britain and Africa. Shapes are unwrapped
 * before they get here (see `center`), so their longitudes may sit outside
 * 0..360; that is deliberate, and the extra copies at +-WIDTH fill the edge.
 */
const columnForLon = (lon: number) => (lon - ORIGIN) / 360 * WIDTH;
/**
 * A single longitude to a column on the visible turn.
 *
 * Only used for labels, which are single points and so can simply be wrapped.
 * Polygons go through `center`/`unwrap` instead, because wrapping their vertices
 * independently would tear a shape apart at the seam.
 */
const wrapColumn = (lon: number) =>
  (((lon - ORIGIN) % 360) + 360) % 360 / 360 * WIDTH;
/**
 * Unwraps a run of longitudes so the shape is continuous.
 *
 * A shape crossing the cut has vertices at both ends of the range, which would
 * otherwise be joined straight across the whole map. Nudging each point by whole
 * turns keeps a seam-crossing shape together; doing it by steps of a whole turn
 * also leaves polar caps alone, since those wrap gradually rather than jumping.
 */
function unwrap(lons: number[]) {
  let out = [lons[0]];
  for (let i = 1; i < lons.length; i++) {
    let v = lons[i];
    while (v - out[i - 1] > 180) v -= 360;
    while (v - out[i - 1] < -180) v += 360;
    out.push(v);
  }
  return out;
}

/**
 * Moves an unwrapped shape into one reference turn.
 *
 * A shape whose vertices ended up near 360 would be drawn a turn away from where
 * it belongs, and repeating the shape either side of the map could not repair
 * it. Centring avoids that.
 */
function center(lons: number[]) {
  let unwrapped = unwrap(lons);
  let mean = unwrapped.reduce((a, b) => a + b, 0) / unwrapped.length;
  // Put the shape in the turn that the visible window covers, so its own
  // longitudes stay close to `ORIGIN` and the +-WIDTH copies land next to it
  let turns = Math.round((mean - ORIGIN) / 360);
  return unwrapped.map(v => v - turns * 360);
}

/**
 * Expands a polygon so a vertex sitting on a pole becomes two.
 *
 * The pole is one point on the sphere but a whole edge of the map. Left as one
 * point, a cap polygon is drawn as a wedge running the wrong way round the
 * world; giving it both neighbouring longitudes turns it into the band it is.
 */
function splitPoles(points: [number, number][]) {
  let out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    let [lon, lat] = points[i];
    if (Math.abs(lat) < 89.5) {
      out.push([lon, lat]);
      continue;
    }
    out.push([points[(i + points.length - 1) % points.length][0], lat]);
    out.push([points[(i + 1) % points.length][0], lat]);
  }
  return out;
}

/**
 * The map's shapes, in screen coordinates.
 *
 * Every shape is emitted three times, one turn to either side, so a shape that
 * straddles the cut is still complete: the off-canvas copies are clipped away
 * and the parts that fall inside fill in the other edge.
 */
function projectMap(map: WorldMap, overlays?: Overlay[]) {
  let polygons = map.polygons.map(polygon => {
    let lons = center(polygon.points.map(p => p[0]));
    let lats = polygon.points.map(p => p[1]);
    return {
      terrain: polygon.terrain,
      color: colorForTerrain(polygon.terrain),
      points: splitPoles(lons.map((lon, i) => [lon, lats[i]] as [number, number]))
        .map(([lon, lat]) => [columnForLon(lon), rowForLat(lat)] as [number, number])
    };
  });

  let lines = map.lines.map(line => {
    let lons = center(line.map(p => p[0]));
    return line.map((p, i) => [columnForLon(lons[i]), rowForLat(p[1])] as [number, number]);
  });

  let countries = map.countries.map((country, index) => ({
    id: country.id,
    color: colorForCountry(country.id, index),
    label: country.label
      ? { x: wrapColumn(country.label.lon), y: rowForLat(country.label.lat) }
      : undefined,
    areas: country.areas.map(area => countryRectangle(area))
  }));

  return {
    polygons,
    lines,
    countries,
    overlays: (overlays ?? []).map(overlay => projectOverlay(overlay))
  };
}

/**
 * A region's boxes and the paths drawn through them, in screen coordinates.
 *
 * `areas` are mission-site boxes and `zones` are the areas that the waypoints
 * index, so both are plain rectangles from the same projection as the nations.
 * A point zone (`lon1 == lon2`) becomes a dot, which is how the packs mark
 * cities.
 */
function projectOverlay(overlay: Overlay) {
  let boxes = (overlay.areas ?? []).map(area => globeBox(area));
  let zoneBoxes = (overlay.zones ?? []).map(zone => zone.map(area => globeBox(area)));
  return {
    ...overlay,
    boxes,
    zoneBoxes,
    // A zone counts as a dot when every box in it is a single point
    zoneDots: (overlay.zones ?? []).map(zone => zone.every(isPointArea)),
    paths: overlay.paths ?? []
  };
}

/** Whether a globe area is a single point rather than a box */
function isPointArea(area: MapArea) {
  return area[0] == area[1] && area[2] == area[3];
}

/**
 * One globe box as a screen rectangle.
 *
 * Unlike a mission zone, a region `area` may cross the prime meridian with
 * `lonMax < lonMin`; adding a turn to the far edge keeps it one box instead of
 * one covering the whole map. Mission zone longitudes never wrap, so the same
 * correction is harmless there.
 */
function globeBox(area: MapArea) {
  let lonMax = area[1] < area[0] ? area[1] + 360 : area[1];
  let lons = center([area[0], lonMax, lonMax, area[0]]);
  let lats = [area[2], area[2], area[3], area[3]];
  return lons.map((lon, i) => [columnForLon(lon), rowForLat(lats[i])] as [number, number]);
}

/** The centre of a box or point, as a globe point */
export function areaCenter(area: MapArea) {
  let lon = (area[0] + area[1]) / 2;
  let lat = (area[2] + area[3]) / 2;
  return { lon, lat };
}

/**
 * One nation's area as a screen rectangle.
 *
 * A nation is a list of axis-aligned boxes, not a border, so it outlines as a
 * plain rectangle. `lonMax < lonMin` means the box crosses the antimeridian:
 * adding a turn to the far edge keeps it one box instead of one covering the
 * whole map.
 */
function countryRectangle(area: MapRectangle) {
  let lonMax = area.lonMax < area.lonMin ? area.lonMax + 360 : area.lonMax;
  let lons = center([area.lonMin, lonMax, lonMax, area.lonMin]);
  let lats = [area.latMin, area.latMin, area.latMax, area.latMax];
  return lons.map((lon, i) => [columnForLon(lon), rowForLat(lats[i])] as [number, number]);
}

/**
 * One shape, repeated either side of the map so the seam is filled.
 *
 * Each copy is wrapped in a keyed fragment: the render callback usually returns
 * a bare element, and a bare element in a list has no key of its own, so React
 * cannot tell one copy from another when the map is redrawn. Some callers key
 * their element anyway; the wrapper makes that a caller's choice rather than a
 * requirement, since forgetting it only produced a console warning.
 */
function Repeated(props: { points: [number, number][], render: (points: string, shift: number) => any }) {
  let serialized = props.points.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return <>{[-1, 0, 1].map(shift =>
    <Fragment key={shift}>{props.render(serialized, shift * WIDTH)}</Fragment>)}</>;
}

/**
 * Places a run of longitudes as one continuous stretch.
 *
 * A flight that crosses the seam where the map is cut has stops at both ends of
 * the longitude range, and drawing them column by column would join the last
 * stop to the first with a line straight across the world. Unwrapping keeps the
 * run continuous, and moving it into the visible turn means the copies either
 * side of the map fill in the other edge.
 */
function placeRun(lons: number[]) {
  if (!lons.length)
    return lons;
  let out = unwrap(lons);
  // Whole turns only: the shape keeps its own length and shape
  let turns = Math.floor((out[0] - ORIGIN) / 360);
  return out.map(v => v - turns * 360);
}

/**
 * The screen geometry of one leg's direction arrow.
 *
 * Each leg is its own element now, because a leg carries its own altitude and
 * speed, so an SVG `marker` cannot be used: it cannot take the colour of the
 * line that references it in a way that is reliable across browsers. A small
 * filled triangle is drawn directly instead.
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
function arrowAt(a: { x: number, y: number }, b: { x: number, y: number },
  scale = 1, keeps = 0) {
  let dx = b.x - a.x, dy = b.y - a.y;
  let length = Math.hypot(dx, dy);
  if (length < 1)
    return undefined;
  let ux = dx / length, uy = dy / length;
  let size = 7 * scale, half = 4.2 * scale;
  // Distance from the far end to the tip. Not near the end is preferred; not
  // inside the marker is required.
  let margin = 2 * scale + size;
  let fromEnd = Math.max(length * 0.2, keeps + margin);
  // Even the point of the arrow would be inside a marker, so there is no clear
  // stretch of line to mark. A leg this short is two markers with a sliver
  // between them; an arrow there would only be a smudge on a marker.
  if (fromEnd > length / 2)
    return undefined;
  let cx = b.x - ux * fromEnd, cy = b.y - uy * fromEnd;
  let tip = [cx + ux * size, cy + uy * size];
  let backL = [cx - ux * size * 0.6 - uy * half, cy - uy * size * 0.6 + ux * half];
  let backR = [cx - ux * size * 0.6 + uy * half, cy - uy * size * 0.6 - ux * half];
  return [tip, backL, backR].map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
}

/**
 * How far apart two legs on the same track are drawn, in map units.
 *
 * A map unit is a distance on the globe, like the dash length, so the gap grows
 * with the picture. 7 units is a little over two pixels at the 2048-unit map
 * width, which is enough to see two lines and to run one's eye along either,
 * without pulling a leg far enough off the track to lose the stops it joins.
 */
const LEG_GAP = 7;

type Point = { x: number, y: number };
type RawLeg = { a: Point, b: Point };

/** Whether two legs are drawn between the same two spots, in either direction */
function sameTrack(a: RawLeg, b: RawLeg) {
  let near = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
  return (near(a.a, b.a) && near(a.b, b.b))
    || (near(a.a, b.b) && near(a.b, b.a));
}

/**
 * Where to draw each of a path's legs so that none hides another.
 *
 * A leg is a straight line between two stops, and two legs of one flight can be
 * drawn between the same two stops. That happens for ordinary reasons: a patrol
 * returns the way it came, a round trip starts and ends in one zone, and the
 * engine re-targets the second line so a zone is often reached twice. Drawn on
 * top of each other, the second leg is invisible, and the picture then says the
 * craft flew one way when it flew two — which is worse than a busy picture,
 * because it is a wrong one.
 *
 * The fix is to separate them along their own perpendicular. The offsets are
 * centred on the track and mirrored about it, so a pair of legs straddles the
 * ground it actually covers rather than sitting to one side of it, and both ends
 * are moved by the same amount, so each line still runs between the two stops
 * (nudged sideways by a couple of pixels) and neither drifts off the marker it
 * belongs to.
 *
 * Only legs sharing a track are moved. Two legs that merely leave one stop in
 * different directions cross at a single point and already read correctly, so
 * bending those would move lines off their stops for no gain.
 */
function spreadLegs(legs: RawLeg[]): RawLeg[] {
  return legs.map((leg, i) => {
    // The other legs drawn between these same two spots, counting this one
    let group = legs.filter(other => sameTrack(leg, other));
    let rank = legs.slice(0, i).filter(other => sameTrack(leg, other)).length;
    let dx = leg.b.x - leg.a.x, dy = leg.b.y - leg.a.y;
    let length = Math.hypot(dx, dy);
    // A single leg on its track is already visible, and a leg with no length has
    // no direction to be offset along
    if (group.length < 2 || length < 1)
      return leg;

    // Centre the spread on zero, so the first leg drawn is not pushed off the track
    let shift = (rank - (group.length - 1) / 2) * LEG_GAP;
    // The perpendicular has to be the same one for every leg on a track, or its
    // side cancels out. A leg flown back along its own track runs the other way,
    // so its perpendicular points the other way too, and a side chosen from the
    // rank would land both legs on the same side of the line — which is exactly
    // the overlap this exists to remove. Taking the direction from the track's
    // endpoints in a fixed order gives one perpendicular for the whole group.
    let forward = leg.a.x < leg.b.x
      || (leg.a.x == leg.b.x && leg.a.y <= leg.b.y);
    let ux = forward ? dx / length : -dx / length;
    let uy = forward ? dy / length : -dy / length;
    // Right of the canonical direction
    let nx = -uy * shift, ny = ux * shift;
    return {
      a: { x: leg.a.x + nx, y: leg.a.y + ny },
      b: { x: leg.b.x + nx, y: leg.b.y + ny },
    };
  });
}

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
const KNOTS_PER_TEN_MINUTES = (WIDTH / 21600) / 6;

/** A leg's dash and gap, in map units, from its speed */
function legDash(speedPercent?: number, craftKnots?: number) {
  if (speedPercent == null || !craftKnots || craftKnots <= 0)
    return undefined;
  let knots = craftKnots * speedPercent / 100;
  // A dash is ten minutes of flight, but a slow craft would produce a dash too
  // short to see and a fast one a dash longer than the gap between two stops, so
  // the length is kept within a readable band. The band is wide enough that the
  // ordering by speed always survives.
  let dash = Math.min(90, Math.max(5, knots * KNOTS_PER_TEN_MINUTES));
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

function legWidth(altitude?: number) {
  let n = Math.round(Number(altitude));
  return altitudeWidths[isFinite(n) ? Math.min(4, Math.max(0, n)) : 2];
}

/**
 * The radius of a stop marker, in screen units.
 *
 * Markers keep a constant size on screen, so on the map this is divided by the
 * magnification. The leg arrow has to keep clear of it, and the strip under the
 * map draws a marker of its own at this radius, so the number lives in one place.
 */
const STOP_RADIUS = 14;

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
 * The same two shapes are used by the map and by the strip under it, so the
 * legend is a picture of the thing it explains rather than a second convention.
 */
function stopMarker(at: { x: number, y: number }, size: number, lands: boolean, className: string) {
  if (!lands)
    return <circle className={className} cx={at.x} cy={at.y} r={size} />;
  // A square is sized to cover about the same area as the circle it replaces,
  // so a landing does not look bigger merely for being square
  let half = size * 0.88;
  let pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    .map(([sx, sy]) => `${(at.x + sx * half).toFixed(1)},${(at.y + sy * half).toFixed(1)}`);
  return <polygon className={className + " region-stop-land"} points={pts.join(" ")} />;
}

/**
 * A region's map data: its boxes, its zone boxes, and any paths drawn in it.
 *
 * A waypoint names a zone, and the game picks a random point inside that zone,
 * so a zone is the only thing on this picture that can honestly be pointed at.
 * Each zone therefore gets its own colour, and the stops that sit in it get the
 * same one: "stop 1 is anywhere in the red box" is a sentence the picture can
 * now support. The line between two stops carries two facts a colour cannot:
 * its dash length is how far the craft gets in ten minutes, and its thickness is
 * how high it flies.
 */
function RegionOverlay({ overlay, zoom = 1, hotZone, onHotZone, onPinZone, hotLeg, onHotLeg, onPinLeg }: {
  overlay: ReturnType<typeof projectOverlay>
  /** Current magnification, so labels can keep a constant on-screen size */
  zoom?: number
  /**
   * Zone to emphasise, normally because its chip or its marker is being pointed
   * at. A zone is a list of boxes anywhere in the region, so this is the only
   * view that shows the whole area a waypoint may pick from.
   */
  hotZone?: number
  /** Called while a stop marker is pointed at, so the page can light its zone */
  onHotZone?: (zone?: number) => void
  /** Called when a stop marker is pressed, which pins its zone on a touch screen */
  onPinZone?: (zone: number) => void
  /**
   * Leg to emphasise, as the leg number the stop numbers come from.
   *
   * A leg and a zone are different answers and are kept in different slots: a
   * zone says "all of this ground", a leg says "this one move". They can be lit
   * at the same time without contradicting one another, since a stop belongs to
   * both.
   */
  hotLeg?: number
  /** Called while a leg's line is pointed at */
  onHotLeg?: (leg?: number) => void
  /** Called when a leg's line is pressed, which pins it on a touch screen */
  onPinLeg?: (leg: number) => void
}) {
  let color = overlay.color ?? "#ffd24a";
  let style = { "--region-color": color } as any;
  // A zone is coloured by its index, so the same zone is the same colour on
  // every path drawn in this region, and on the zone box itself
  let zoneStyle = (index: number) => ({ "--zone-color": zoneColor(index) } as any);
  // Stops are numbered only when one flight is drawn: a region page shows up to
  // six overlapping paths, and six sets of numbers on one picture is noise
  let numbered = overlay.paths.length == 1;

  return <g className={"region-overlay" + (overlay.hot ? " region-hot" : "")} style={style}>

    {overlay.boxes.map((box, i) => <Repeated key={"a" + i} points={box}
      render={(points, shift) => <polygon className="region-area" points={points}
        transform={shift ? `translate(${shift} 0)` : undefined} />} />)}

    {/* Zones that a drawn flight visits are shown in that flight's own zone
        colour, so the box and the stop on it agree; the rest stay in the region
        colour and recede. The highlighted zone is drawn again on top by
        `hotZoneBoxes` below, so its brighter outline is not buried under the
        other boxes of a zone with dozens of them. */}
    {overlay.zoneBoxes.map((zone, i) => {
      let visited = overlay.paths.some(path => path.stops.some(stop => stop.zone == i));
      // The highlighted zone is not marked here: `hotZoneBoxes` below draws it
      // again above everything, and marking it in both places would draw it twice
      let className = "region-zone" + (visited ? " region-zone-visited" : "");
      let extra = visited ? zoneStyle(i) : undefined;
      return zone.map((box, j) => overlay.zoneDots[i]
        ? <Repeated key={"z" + i + "_" + j} points={box}
          render={(points, shift) => <circle className={className + " region-zone-point"}
            style={extra} cx={box[0][0]} cy={box[0][1]} r={5}
            transform={shift ? `translate(${shift} 0)` : undefined} />} />
        : <Repeated key={"z" + i + "_" + j} points={box}
          render={(points, shift) => <polygon className={className} style={extra} points={points}
            transform={shift ? `translate(${shift} 0)` : undefined} />} />);
    })}

    {/* The highlighted zone, drawn again above the others so its outline is not
        hidden under the many boxes of other zones. This is the answer to "where
        can this waypoint actually be", so it has to be the last thing drawn. */}
    {hotZone != null && (overlay.zoneBoxes[hotZone] ?? []).map((box, j) =>
      overlay.zoneDots[hotZone]
        ? <Repeated key={"hot" + j} points={box}
          render={(points, shift) => <circle className="region-zone region-zone-hot region-zone-point"
            style={zoneStyle(hotZone)} cx={box[0][0]} cy={box[0][1]} r={5}
            transform={shift ? `translate(${shift} 0)` : undefined} />} />
        : <Repeated key={"hot" + j} points={box}
          render={(points, shift) => <polygon className="region-zone region-zone-hot"
            style={zoneStyle(hotZone)} points={points}
            transform={shift ? `translate(${shift} 0)` : undefined} />} />)}

    {overlay.paths.map(path => {
      // One continuous run for the whole flight, so a path crossing the seam is
      // joined the short way round instead of being drawn across the world
      let lons = placeRun(path.stops.map(stop => stop.point.lon));
      let at = path.stops.map((stop, i) => ({ x: columnForLon(lons[i]), y: rowForLat(stop.point.lat) }));

      // Legs between consecutive stops, each with its own altitude and speed.
      // A leg whose two stops are the same place is the craft waiting, not
      // moving: it has no line.
      let legs = at.map((point, i) => {
        if (i == 0)
          return undefined;
        let a = at[i - 1];
        if (Math.abs(a.x - point.x) < 0.01 && Math.abs(a.y - point.y) < 0.01)
          return undefined;
        let stop = path.stops[i];
        return {
          a, b: point,
          zone: stop.zone,
          // The leg's own number, so its colour is its own rather than a repeat
          // of the stop it flies to
          leg: stop.leg,
          width: legWidth(stop.altitude),
          dash: legDash(stop.speed, path.craftKnots),
        };
      }).filter(leg => leg != null);

      // Overlapping legs are drawn apart; see `spreadLegs`
      let spread = spreadLegs(legs);

      // Coincident stops share one marker and one label, so a doubled arrival
      // reads as "2, 3" on one point rather than as two numbers on top of each
      // other. The stops of a landing are on the ground at the same spot.
      let groups: { at: { x: number, y: number }, labels: number[], lands: boolean, zone: number }[] = [];
      at.forEach((point, i) => {
        let stop = path.stops[i];
        let found = groups.find(g =>
          Math.abs(g.at.x - point.x) < 1 && Math.abs(g.at.y - point.y) < 1);
        if (found) {
          found.labels.push(stop.leg + 1);
          found.lands ||= stop.lands;
        }
        else
          groups.push({ at: point, labels: [stop.leg + 1], lands: stop.lands, zone: stop.zone });
      });

      return [-1, 0, 1].map(shift => {
        let offset = shift * WIDTH;
        return <g key={path.id + shift} className="region-path"
          transform={`translate(${offset} 0)`}>
          {legs.map((leg, i) => {
            // The arrow keeps clear of the stop marker at the far end, which is a
            // fixed size on screen and so a variable size in map units
            let arrow = arrowAt(spread[i].a, spread[i].b, 1 / zoom, STOP_RADIUS / zoom);
            return <g key={"leg" + i}
              style={{ "--leg-color": legColor(leg.leg) } as any}
              className={"region-leg-group"
                + (onHotLeg ? " region-leg-live" : "")
                + (hotLeg == leg.leg ? " region-leg-hot" : "")}
              // A leg answers the same two gestures a stop does: pointing at it
              // lights the line, and pressing pins it for a screen with no hover.
              // The pointer target is the line itself plus a wide invisible stroke
              // beside it (`region-leg-hit`), because a 3-unit line is impossible to
              // hit on a touch screen.
              onPointerEnter={onHotLeg && (() => onHotLeg(leg.leg))}
              onPointerLeave={onHotLeg && (() => onHotLeg(undefined))}
              onPointerUp={onPinLeg && (() => onPinLeg(leg.leg))}>
              {/* The pointer target, drawn only where the page can answer the
                  gesture: a region page draws six paths and nothing to say about
                  any of them */}
              {onHotLeg && <line className="region-leg-hit"
                x1={spread[i].a.x} y1={spread[i].a.y}
                x2={spread[i].b.x} y2={spread[i].b.y} />}
              {/* A halo under the line, so the blink can be in screen units while
                  the line's own width stays in map units: the width is how high
                  the craft flies, and a highlight must not overwrite an encoding.
                  Only drawn when hot, since a path can have dozens of legs. */}
              {hotLeg == leg.leg && <line className="region-leg-halo"
                x1={spread[i].a.x} y1={spread[i].a.y}
                x2={spread[i].b.x} y2={spread[i].b.y} />}
              {/* The dash is in map units because it stands for a distance flown;
                  the width is divided back out because it is only a rank, and a
                  rank should not become a slab at high magnification */}
              <line className="region-leg" x1={spread[i].a.x} y1={spread[i].a.y}
                x2={spread[i].b.x} y2={spread[i].b.y}
                strokeWidth={leg.width / zoom} strokeDasharray={leg.dash} />
              {arrow && <polygon className="region-leg-arrow" points={arrow} />}
            </g>;
          })}
          {groups.map((group, i) => <g key={"stop" + i} style={zoneStyle(group.zone)}
            className={"region-stop-group"
              + (onHotZone ? " region-stop-live" : "")
              + (hotZone == group.zone ? " region-stop-hot" : "")}
            // Pointing at a stop lights up every box of its zone, which is the
            // whole area the waypoint may be anywhere in — the one thing the
            // marker itself cannot show. Pressing pins it, because a touch screen
            // has no hover, and the leave that follows a touch press must not
            // undo the press.
            onPointerEnter={onHotZone && (() => onHotZone(group.zone))}
            onPointerLeave={onHotZone && (() => onHotZone(undefined))}
            onPointerUp={onPinZone && (() => onPinZone(group.zone))}>
            {/* Markers keep a constant on-screen size, like the labels: a stop is
                a place, not a distance, so magnifying the map should not inflate
                it over the zone it sits in. The shape says whether the UFO is on
                the ground here, which is the fact a site appears on. */}
            {stopMarker(group.at, 14 / zoom, group.lands, "region-stop")}
            {numbered && <text className="region-stop-label"
              // Above the marker for both shapes: the marker is centred on the
              // stop either way now, so one offset serves both and the numbers of
              // a flight line up along the top of it
              x={group.at.x} y={group.at.y - 24 / zoom}
              // Divided back out so the number keeps its reading size when the
              // map is magnified, like the nation labels
              style={{ fontSize: `${26 / zoom}px`, strokeWidth: `${6 / zoom}px` }}
              textAnchor="middle" dominantBaseline="central">
              {group.labels.join(", ")}
            </text>}
          </g>)}
        </g>;
      });
    })}
  </g>;
}

/**
 * The address of a page, or nothing when the pack has no such article.
 *
 * A terrain name in `globe: textures:` is a terrain id the pack may or may not
 * give a page of its own, so the picture only becomes a link when following it
 * would actually land somewhere.
 */
function pageFor(id?: string) {
  if (!id || !rul?.article(id))
    return;
  return "##" + id;
}

const MAX_ZOOM = 12;

/**
 * How many regions may share a mission and still count as its specialty.
 *
 * The cut has to sit above one, because a mission flown by two neighbours is
 * still characteristic of both, and well below "half the world". Three keeps the
 * list short enough to read in every pack checked: on XFiles it leaves the
 * handful of regional cult and ocean missions, on X-Piratez the handful of
 * faction missions, and skips the background every weighted region shares.
 */
const DISTINCT_REGION_COUNT = 3;

/** A zoomed-and-panned view of the map, in viewBox units */
type View = { zoom: number, x: number, y: number };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Keeps the view over the map.
 *
 * The picture repeats one turn to either side, so the edges are never empty,
 * but letting the view wander would still leave the map off screen. Panning is
 * therefore limited to the span the magnification added.
 */
function clampView(view: View): View {
  let maxX = WIDTH * (1 - view.zoom);
  let maxY = HEIGHT * (1 - view.zoom);
  return {
    zoom: view.zoom,
    x: clamp(view.x, maxX, 0),
    y: clamp(view.y, maxY, 0)
  };
}

/** A pointer position in the picture's own coordinates */
function pointInMap(svg: SVGSVGElement, clientX: number, clientY: number) {
  let matrix = svg.getScreenCTM();
  if (!matrix)
    return { x: 0, y: 0 };
  let point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  let local = point.matrixTransform(matrix.inverse());
  return { x: local.x, y: local.y };
}

/**
 * The picture itself: land, borders, nations, and whatever overlays the page
 * puts on top.
 *
 * `showCountries` decides whether the nation titles and their area boxes are
 * drawn. The world map page wants them — telling the nations apart is what it
 * shows — while a region or trajectory page has its own subject on the same
 * picture, and the nation names and rectangles crowd it without adding much.
 */
function MapPicture({ map, overlays, showCountries = true, hotZone, onHotZone, onPinZone, hotLeg, onHotLeg, onPinLeg }:
  { map: WorldMap, overlays?: Overlay[], showCountries?: boolean, hotZone?: number,
    onHotZone?: (zone?: number) => void, onPinZone?: (zone: number) => void,
    hotLeg?: number, onHotLeg?: (leg?: number) => void, onPinLeg?: (leg: number) => void }) {
  let projected = useMemo(() => projectMap(map, overlays), [map, overlays]);
  let svgRef = useRef<SVGSVGElement>(null);
  let [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  let [panning, setPanning] = useState(false);
  // Which nation's title the pointer is over, so its outline can stand out
  let [highlighted, setHighlighted] = useState<string>();
  // Whether the current press has turned into a drag, shared with the click
  // handler that has to ignore the click a drag ends with
  let drag = useRef<{ moved: boolean }>(undefined);

  // A new pack means a new picture, so the old magnification is meaningless
  useEffect(() => setView({ zoom: 1, x: 0, y: 0 }), [map]);

  // The wheel listener has to be native and non-passive: React's `onWheel` is
  // passive, so `preventDefault` there would not stop the page from scrolling
  useEffect(() => {
    let svg = svgRef.current;
    if (!svg)
      return;
    function onWheel(e: WheelEvent) {
      // At normal size the map has nothing to zoom out to, so the page keeps
      // scrolling; only an actual zoom swallows the wheel
      if (view.zoom == 1 && e.deltaY > 0)
        return;
      e.preventDefault();
      setView(current => {
        let zoom = clamp(current.zoom * Math.exp(-e.deltaY / 500), 1, MAX_ZOOM);
        // Keep the point under the cursor still: everything else moves towards
        // or away from it by the same factor
        let factor = zoom / current.zoom;
        let point = pointInMap(svg!, e.clientX, e.clientY);
        return clampView({
          zoom,
          x: point.x + (current.x - point.x) * factor,
          y: point.y + (current.y - point.y) * factor
        });
      });
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [view.zoom]);

  /**
   * Drags the map with either button.
   *
   * Middle button is only ever a pan, so it is swallowed outright. The left
   * button is the normal way to follow a link, so a press there becomes a pan
   * only once the view actually moves: at normal size the map cannot move, and
   * a press-and-release is left to the browser as a plain click.
   *
   * Pointer capture keeps the drag working when the cursor leaves the picture,
   * which is the normal case at high magnification. The base view is captured
   * on press so the pan does not accumulate rounding drift.
   */
  function startPan(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button != 0 && e.button != 1)
      return;
    let svg = svgRef.current;
    if (!svg)
      return;
    // A middle click must not also start the browser's autoscroll
    if (e.button == 1)
      e.preventDefault();
    let start = pointInMap(svg, e.clientX, e.clientY);
    let base = view;
    let moved = { moved: false };
    drag.current = moved;

    function move(moveEvent: PointerEvent) {
      let now = pointInMap(svg!, moveEvent.clientX, moveEvent.clientY);
      let next = clampView({
        zoom: base.zoom,
        x: base.x + now.x - start.x,
        y: base.y + now.y - start.y
      });
      // Nothing moved, so this is still a potential click
      if (!moved.moved && next.x == base.x && next.y == base.y)
        return;
      moved.moved = true;
      setPanning(true);
      setView(next);
    }
    function end() {
      svg!.removeEventListener("pointermove", move);
      svg!.removeEventListener("pointerup", end);
      svg!.removeEventListener("pointercancel", end);
      try { svg!.releasePointerCapture(e.pointerId); } catch { }
      setPanning(false);
    }
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    // Not every browser allows capturing a synthetic pointer, and the drag still
    // works without it
    try { svg.setPointerCapture(e.pointerId); } catch { }
  }

  return <svg ref={svgRef}
    className={"world-map" + (panning ? " panning" : "") + (view.zoom > 1 ? " zoomed" : "")}
    viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label="World map"
    onPointerDown={startPan}
    // A pan that ends over a link must not also follow it, so the click the
    // browser synthesises after the drag is dropped
    onClickCapture={e => {
      let wasDragged = drag.current?.moved;
      if (drag.current)
        drag.current.moved = false;
      if (!wasDragged)
        return;
      e.preventDefault();
      e.stopPropagation();
    }}
    // Middle-click is the pan gesture here, so it must not also start the
    // browser's autoscroll or open a link in a new tab
    onMouseDown={e => { if (e.button == 1) e.preventDefault(); }}
    onAuxClick={e => { if (e.button == 1) e.preventDefault(); }}
    onDoubleClick={() => setView({ zoom: 1, x: 0, y: 0 })}>
    <defs>
      <clipPath id="world-map-clip"><rect width={WIDTH} height={HEIGHT} /></clipPath>
    </defs>
    <rect width={WIDTH} height={HEIGHT} fill="#0d2f52" />
    <g clipPath="url(#world-map-clip)">
      <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
        {projected.polygons.map((polygon, i) => <Repeated key={i} points={polygon.points}
          render={(points, shift) => {
            // Every shape of one terrain links to the same page, so clicking a
            // region is the same as clicking its legend entry
            let shape = <polygon points={points} fill={polygon.color}
              transform={shift ? `translate(${shift} 0)` : undefined} />;
            let href = pageFor(polygon.terrain);
            return href
              ? <a key={shift} href={href}><title>{rul?.tr(polygon.terrain) ?? polygon.terrain}</title>{shape}</a>
              : <Fragment key={shift}>{shape}</Fragment>;
          }} />)}
        {projected.lines.map((line, i) => <Repeated key={i} points={line}
          render={(points, shift) => <polyline points={points} fill="none"
            transform={shift ? `translate(${shift} 0)` : undefined} />} />)}
        {/* A nation is a list of boxes rather than a border, so its outline is a
            rectangle per area. The colour is also used for its label, which is
            how the game tells two nations apart on a plain map. */}
        {showCountries && projected.countries.map(country => country.areas.map((area, i) => <Repeated key={country.id + i} points={area}
          render={(points, shift) => {
            let shape = <polygon className="country-contour" points={points}
              style={{ "--country-color": country.color } as any}
              transform={shift ? `translate(${shift} 0)` : undefined} />;
            let href = pageFor(country.id);
            let hot = highlighted == country.id;
            return href
              ? <a key={shift} href={href} className={hot ? "country-hot" : undefined}>{shape}</a>
              : <Fragment key={shift}>{shape}</Fragment>;
          }} />))}
        {/* Plain text only: an SVG `text` cannot contain HTML, so this cannot go
            through `Tr`, which renders a `<span>`.

            The labels are drawn before the region overlays so the overlay sits on
            top: a name is orientation, while the boxes and paths are the subject
            of the page, and a label crossing a flight line only gets in the way. */}
        {showCountries && projected.countries.map((country, i) => {
          if (!country.label)
            return null;
          let text = <text x={country.label.x} y={country.label.y} textAnchor="middle"
            style={{
              "--country-color": country.color,
              // Labels keep their reading size as the map is magnified, so the
              // sizes in viewBox units are divided back out
              fontSize: `${18 / view.zoom}px`,
              strokeWidth: `${3 / view.zoom}px`
            } as any}>
            {rul?.tr(country.id) ?? country.id}
          </text>;
          let href = pageFor(country.id);
          let hot = highlighted == country.id;
          // Pointing at a title makes that nation's outline blink, which is how
          // a name is tied to the box it sits in
          let handlers = {
            onPointerEnter: () => setHighlighted(country.id),
            onPointerLeave: () => setHighlighted(current => current == country.id ? undefined : current)
          };
          return href
            ? <a key={i} href={href} className={hot ? "country-hot" : undefined}
              {...handlers}>{text}</a>
            : <g key={i} className={"country-label" + (hot ? " country-hot" : "")} {...handlers}>{text}</g>;
        })}
        {/* Region overlays go above the nation labels: the boxes and the paths are
            what the page is about, and the labels are only orientation */}
        {projected.overlays.map(overlay =>
          <RegionOverlay key={overlay.id} overlay={overlay} zoom={view.zoom}
            hotZone={hotZone} onHotZone={onHotZone}
            // A pan that ends over a marker must not also pin its zone, so the
            // press is dropped once the press has turned into a drag
            onPinZone={onPinZone && (zone => { if (!drag.current?.moved) onPinZone(zone); })}
            hotLeg={hotLeg} onHotLeg={onHotLeg}
            onPinLeg={onPinLeg && (leg => { if (!drag.current?.moved) onPinLeg(leg); })} />)}
      </g>
    </g>
  </svg>;
}

/** Lists the terrains actually used, with the colour each was given */
function MapLegend({ map }: { map: WorldMap }) {
  let used = useMemo(() => {
    let counts = new Map<string, number>();
    for (let polygon of map.polygons) {
      let key = polygon.terrain ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [map]);

  if (!used.length)
    return null;

  return <div className="world-map-legend">
    <div className="world-map-legend-title"><Tr text="xpediaMapLegend" /></div>
    <ul>
      {used.map(([name, count]) => {
        let label = <><Tr text={name || "xpediaMapUnknownLand"} /></>;
        let href = pageFor(name);
        return <li key={name}>
          <span className="world-map-swatch" style={{ background: colorForTerrain(name) }} />
          {href ? <a href={href}>{label}</a> : label}
          <span className="world-map-count">{count}</span>
        </li>;
      })}
    </ul>
  </div>;
}

/**
 * The map article.
 *
 * Building the picture means reading a DAT file out of the database, so it is
 * loaded on demand rather than with the ruleset.
 */
export function WorldMapArticle() {
  let [map, setMap] = useState<WorldMap>();
  let [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    readDeclaredColors();
    readDeclaredCountryColors();
    loadWorldMap().then(found => {
      if (cancelled)
        return;
      if (found) {
        setMap(found);
        setStatus("ready");
      } else {
        setStatus("missing");
      }
    }).catch(e => {
      console.warn("Can't load the world map", e);
      if (!cancelled)
        setStatus("missing");
    });
    return () => { cancelled = true; };
  }, []);

  if (status == "loading")
    return <div className="world-map-status"><Tr text="xpediaMapLoading" /></div>;

  if (status == "missing" || !map)
    return <div className="world-map-status"><Tr text="xpediaMapMissing" /></div>;

  return <div className="world-map-block">
    <MapPicture map={map} />
    <MapLegend map={map} />
    {/* Land colour is chosen from the terrain name, not read from the game, so
        saying so keeps the illustration from looking like a screenshot */}
    <p className="world-map-note"><Tr text="xpediaMapNote" /></p>
  </div>;
}

/** Loads the world map once, for the pages that draw on top of it */
function useWorldMap() {
  let [map, setMap] = useState<WorldMap>();
  let [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    readDeclaredColors();
    readDeclaredCountryColors();
    loadWorldMap().then(found => {
      if (cancelled)
        return;
      setMap(found);
      setStatus(found ? "ready" : "missing");
    }).catch(e => {
      console.warn("Can't load the world map", e);
      if (!cancelled)
        setStatus("missing");
    });
    return () => { cancelled = true; };
  }, []);

  return { map, status };
}

/**
 * Whether to draw the nation titles and area boxes on the map below.
 *
 * They are orientation rather than subject on a region or trajectory page, and
 * two dozen nation names plus their rectangles compete with the handful of
 * boxes and the one flight line the page is actually about. Off by default, so
 * the map leads with its own subject; the box brings the names back for anyone
 * who wants to know which nation a box falls in.
 *
 * The choice is remembered across pages (`showCountryLabels`), because it is a
 * reading preference rather than a property of one article.
 */
function CountryLabelsToggle() {
  let shown = state.showCountryLabels;
  return <label className="world-map-toggle">
    <input type="checkbox" checked={shown}
      onChange={() => update({ showCountryLabels: !shown })} />
    <Tr text="xpediaShowCountryLabels" />
  </label>;
}

/** The message shown instead of a picture when the pack has no geoscape data */
function NoMap() {
  return <div className="world-map-status"><Tr text="xpediaMapMissing" /></div>;
}

/**
 * A region drawn on the world map, with the flights its missions send through it.
 *
 * Many regions have no `areas` at all: they exist to weight missions, and are
 * marked on the map only by their zone points. Drawing something is still much
 * more use than drawing nothing, so the zones are shown either way and the
 * missing site boxes are simply absent.
 */
export function RegionMapArticle({ region }: { region: Region }) {
  let { map, status } = useWorldMap();
  let [highlight, setHighlight] = useState<string>();
  let [showAll, setShowAll] = useState(false);

  let paths = useMemo(() => rul.trajectoriesFor(region).slice(0, MAX_DRAWN_PATHS), [region]);
  let overlays = useMemo(() => [regionOverlay(region, paths)], [region, paths]);
  // The list names every flight the region's missions send, and a flight whose
  // every stop names an "anywhere" zone has no place to mark, so say which ones
  // the map leaves out rather than leaving a gap in the picture unexplained
  let shapes = useMemo(() => new Map(paths.map(path => [path.id, pathShape(path, region)])), [paths, region]);
  let undrawn = paths.filter(path => shapes.get(path.id)!.stops.length == 0);

  // A region can host hundreds of missions and most of them are background: in
  // XFiles every weighted region is a candidate for any script that names no
  // region. The missions worth leading with are the ones few regions share,
  // because those are what the region is *for*; the rest are listed behind a
  // toggle rather than dropped, since "no, not here" is also an answer a reader
  // wants from this page.
  let missions = useMemo(() => rul.missionsIn(region), [region]);
  let allRegions = Object.keys(rul.regions ?? {}).length;
  let distinctive = missions.filter(m => m.regionCount <= DISTINCT_REGION_COUNT);
  let shown = showAll ? missions : distinctive;
  let hidden = missions.length - shown.length;

  if (status == "loading")
    return <div className="world-map-status"><Tr text="xpediaMapLoading" /></div>;
  if (status == "missing" || !map)
    return <NoMap />;

  return <div className="world-map-block">
    <MapPicture map={map} overlays={overlays} showCountries={state.showCountryLabels} />
    <CountryLabelsToggle />
    <p className="world-map-note"><Tr text="xpediaRegionMapNote" /></p>
    {paths.length > 0 && <div className="region-paths">
      <div className="world-map-legend-title"><Tr text="xpediaTrajectories" /></div>
      <ul>
        {paths.map(path => <li key={path.id} onPointerEnter={() => setHighlight(path.id)}
          onPointerLeave={() => setHighlight(current => current == path.id ? undefined : current)}>
          <a href={pageFor(path.id) ?? undefined}>{path.id}</a>
          <span className="world-map-count">{(path.waypoints ?? []).length}</span>
          {undrawn.includes(path) && <span className="world-map-unplaced-mark">
            <Tr text="xpediaPathUnplaced" />
          </span>}
        </li>)}
      </ul>
      {highlight && <div className="region-paths-hot">{highlight}</div>}
    </div>}

    {missions.length > 0
      ? <div className="region-missions">
        <div className="world-map-legend-title"><Tr text="xpediaRegionMissions" /></div>
        {shown.length > 0 && <ul>
          {shown.map(entry => <li key={entry.mission}>
            <a href={pageFor(entry.mission) ?? undefined}>{entry.mission}</a>
            {/* The count is the whole point of the list: "only here" reads very
                differently from "one of a hundred and seventy regions" */}
            <span className="region-mission-count">
              {entry.regionCount == 1
                ? <Tr text="xpediaRegionOnlyHere" />
                : <><Tr text="xpediaRegionAlsoIn" /> <Val of={entry.regionCount} />{" "}
                  <Tr text="xpediaRegionOfRegions" /></>}
            </span>
          </li>)}
        </ul>}
        {hidden > 0 && <button className="region-missions-more" onClick={() => setShowAll(true)}>
          <Tr text="xpediaRegionMissionsMore" /> <Val of={hidden} />
        </button>}
        <p className="world-map-note">
          <Tr text="xpediaRegionMissionsNote" />
          {" "}<Val of={allRegions} />{" "}
          <Tr text={allRegions == 1 ? "xpediaRegionCountOne" : "xpediaRegionCount"} />
        </p>
      </div>
      : <p className="world-map-note"><Tr text="xpediaRegionNoMissions" /></p>}
  </div>;
}

/**
 * What the line drawing means: dash length is speed, thickness is altitude.
 *
 * Both are properties of a leg rather than of a stop, so they cannot be read off
 * the zone colours and need saying once in words. The sample lines are drawn
 * with the same functions the map uses, so the legend cannot drift away from the
 * picture it explains — including the fact that both are measured in map units.
 */
function TrajectoryLegend({ path }: { path?: OverlayPath }) {
  let speeds = path?.craftSpeeds;
  // A speed percentage means nothing on its own: it is a fraction of the craft's
  // top speed, so the knots are only known when a craft is known
  let knots = path?.craftKnots;
  // The samples live in the map's own units, so a dash here is the same length
  // of time as a dash there. 320 units is a little over a tenth of the map.
  return <div className="trajectory-legend">
    <div className="trajectory-legend-item">
      <span className="trajectory-legend-sample">
        <svg viewBox="0 0 320 90" aria-hidden="true">
          <line x1="0" y1="22" x2="320" y2="22" className="region-leg"
            strokeWidth={legWidth(2)} strokeDasharray={legDash(100, 5000)} />
          <line x1="0" y1="40" x2="320" y2="40" className="region-leg"
            strokeWidth={legWidth(2)} strokeDasharray={legDash(25, 5000)} />
        </svg>
      </span>
      <span><Tr text="xpediaTrajectoryDash" /></span>
    </div>
    <div className="trajectory-legend-item">
      <span className="trajectory-legend-sample">
        <svg viewBox="0 0 320 90" aria-hidden="true">
          <line x1="0" y1="22" x2="320" y2="22" className="region-leg" strokeWidth={legWidth(4)} />
          <line x1="0" y1="40" x2="320" y2="40" className="region-leg" strokeWidth={legWidth(0)} />
        </svg>
      </span>
      <span><Tr text="xpediaTrajectoryThickness" /></span>
    </div>
    <div className="trajectory-legend-item">
      <span className="trajectory-legend-sample">
        <svg viewBox="0 0 320 90" aria-hidden="true">
          {stopMarker({ x: 140, y: 30 }, 22, true, "region-stop")}
          {stopMarker({ x: 220, y: 30 }, 22, false, "region-stop")}
        </svg>
      </span>
      <span><Tr text="xpediaTrajectoryMarkers" /></span>
    </div>
    {knots != null && speeds && <p className="trajectory-legend-note">
      {speeds.min == speeds.max
        ? <><Tr text="xpediaTrajectoryCraftSpeed" /> <span className="mission-delay">
          {Math.round(speeds.min)}</span>.</>
        : <><Tr text="xpediaTrajectoryCraftSpeeds" /> <span className="mission-delay">
          {Math.round(speeds.min)}–{Math.round(speeds.max)}</span>.</>}
    </p>}
  </div>;
}

/**
 * The flight as a strip: every stop in order, joined by the leg that flies there.
 *
 * This replaces a row of colour chips that listed the zones sorted by number. That
 * row answered "which zones exist", which is not the question a reader has; it also
 * printed the numbers as text, so it looked like prose about zones rather than like
 * the picture above it. Laid out as a sequence it answers both questions at once —
 * the fill is the zone, the number is the stop, and the connector is the move between
 * them, carrying the leg's own colour the way the line on the map does.
 *
 * Shape is read off this strip as well: see `stopMarker`, which draws both.
 *
 * Two consecutive stops at one place have no connector, because the craft did not
 * move: the engine re-targets the second line, so the same zone is often reached
 * twice in a row. The map joins such stops into one marker carrying both numbers,
 * which is the same fact said the other way round.
 *
 * The connectors are controls too, not decoration. Pointing at the line on the map
 * lights its sample here and vice versa, which is the only way to tell two lines of
 * one flight apart when they cross: their colours differ, but a reader needs to be
 * able to ask "which one is this".
 */
function FlightStrip({ stops, hotZone, pinned, hotLeg, pinnedLeg, onHover, onPin, onHoverLeg, onPinLeg }: {
  stops: PathStop[]
  hotZone?: number
  pinned?: number
  hotLeg?: number
  pinnedLeg?: number
  onHover?: (zone?: number) => void
  onPin?: (zone: number) => void
  onHoverLeg?: (leg?: number) => void
  onPinLeg?: (leg: number) => void
}) {
  let strip = useRef<HTMLDivElement>(null);

  // Pointing at a line on the map has to bring its sample into view, or the answer
  // "this is leg 60" is written off the right edge on a long flight. `nearest` is
  // the right mode: it scrolls only when the target is actually outside, so a
  // short flight's strip does not jump about, and it never moves the page itself.
  useEffect(() => {
    if (hotLeg == null)
      return;
    let box = strip.current?.querySelector(".trajectory-flight-leg-hot");
    box?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [hotLeg]);

  return <div className="trajectory-flight" ref={strip}>
    {stops.map((stop, i) => {
      // A leg is drawn before the stop it arrives at, and the first stop is the
      // spawn point, which nothing arrives at
      let arrives = i > 0 && !samePlace(stops[i - 1], stop);
      return <Fragment key={i}>
        {arrives && <button type="button"
          className={"trajectory-flight-leg"
            + (hotLeg == stop.leg ? " trajectory-flight-leg-hot" : "")}
          style={{ "--leg-color": legColor(stop.leg) } as any}
          aria-pressed={pinnedLeg == stop.leg}
          // Named by the stop it reaches, because that is the number the stop list
          // and the picture use: the move into stop 3 is "the leg to stop 3", and a
          // separate count of legs would be a number nothing else on the page has.
          aria-label={`${rul.tr("xpediaLegToStop")} ${stop.leg + 1}`}
          onPointerEnter={onHoverLeg && (() => onHoverLeg(stop.leg))}
          onPointerLeave={onHoverLeg && (() => onHoverLeg())}
          // The press pins the leg for a touch screen, where the leave that
          // follows a press would otherwise undo it
          onClick={onPinLeg && (() => onPinLeg(stop.leg))} />}
        <button type="button"
          className={"trajectory-flight-stop"
            + (stop.lands ? " trajectory-flight-land" : "")
            + (hotZone == stop.zone ? " trajectory-flight-hot" : "")}
          style={{ "--zone-color": zoneColor(stop.zone) } as any}
          aria-pressed={pinned == stop.zone}
          // The face of the button is a number in a shape, which says nothing on
          // its own to a screen reader, so the stop is named in words as well
          aria-label={`${rul.tr("xpediaStop")} ${stop.leg + 1}`}
          // Pointing at a stop lights up every box of its zone — the whole area it
          // may be anywhere in — and pressing pins it, because a touch screen has
          // no hover and the leave that follows a press would undo it.
          onPointerEnter={onHover && (() => onHover(stop.zone))}
          onPointerLeave={onHover && (() => onHover())}
          onClick={onPin && (() => onPin(stop.zone))}>
          <span className="trajectory-flight-number"><Val of={stop.leg + 1} /></span>
        </button>
      </Fragment>;
    })}
  </div>;
}

/**
 * One flight path, drawn in a region it can actually fly in.
 *
 * The path is a set of zone indices, so it has no place of its own: a region has
 * to be named, and the regions shown are the ones the missions that fly this
 * path can pick, per `Ruleset.regionsFor`. When several qualify they are all
 * offered, because the pack itself does not say which one a given flight uses.
 */
export function TrajectoryMapArticle({ trajectory }: { trajectory: UfoTrajectory }) {
  let { map, status } = useWorldMap();

  let regions = useMemo(() => rul.regionsFor(trajectory), [trajectory]);
  // The region is a reading choice rather than a property of the flight: whoever
  // looked at a flight over one region will want the same region on the next
  // path. `remembered` is the whole rule — use the remembered region when this
  // flight can be flown in it, the first region offered otherwise, and never
  // write the memory back, so a flight with a narrow choice of regions does not
  // erase the broader choice made on another one.
  let region = remembered(regions, r => r.id == state.selection.region, regions[0]);

  let overlays = useMemo(() =>
    region ? [regionOverlay(region, [trajectory])] : [], [region, trajectory]);
  // A zone the game treats as "anywhere" has no place to point at, so the line
  // skips it. Saying how many were skipped is better than a path that quietly
  // lost stops, and it explains an empty map for a path like `P9`, whose every
  // waypoint is such a zone.
  let shape = useMemo(() => region ? pathShape(trajectory, region) : undefined, [region, trajectory]);
  let landing = trajectory.landingSeconds;
  // Which zone is being pointed at, and which one was pressed to keep it. Both
  // views — the markers and the strip — share the result, so pointing at "2, 3,
  // 4" lights up the whole area those stops may be anywhere in, and pointing at
  // a marker lights up the stop in the strip that names it.
  //
  // Hover and the press are kept apart on purpose: a press that a touch screen
  // makes is followed by the pointer leaving, so a single shared slot would be
  // cleared again immediately and the press would do nothing.
  let [hovered, setHovered] = useState<number>();
  let [pinned, setPinned] = useState<number>();
  let hotZone = pinned ?? hovered;
  // The same pair of slots for legs, kept separate from the zone ones: a zone is
  // an area and a leg is a move, and a stop belongs to both, so both can be lit at
  // once without saying two different things about one thing.
  let [hoveredLeg, setHoveredLeg] = useState<number>();
  let [pinnedLeg, setPinnedLeg] = useState<number>();
  let hotLeg = pinnedLeg ?? hoveredLeg;
  let pinLeg = (leg: number) => setPinnedLeg(current => current == leg ? undefined : leg);
  // A radio choice changes the region, and a zone number means something else
  // there, so the highlight must not survive the switch
  useEffect(() => {
    setHovered(undefined);
    setPinned(undefined);
    setHoveredLeg(undefined);
    setPinnedLeg(undefined);
  }, [region]);

  if (status == "loading")
    return <div className="world-map-status"><Tr text="xpediaMapLoading" /></div>;
  if (status == "missing" || !map)
    return <NoMap />;

  // A path with no region to read its zones against cannot be drawn at all; the
  // article still lists its waypoints, so say why the picture is missing
  if (!region)
    return <div className="world-map-status"><Tr text="xpediaTrajectoryNoRegion" /></div>;

  return <div className="world-map-block">
    <MapPicture map={map} overlays={overlays} showCountries={state.showCountryLabels}
      hotZone={hotZone} onHotZone={setHovered}
      onPinZone={zone => setPinned(current => current == zone ? undefined : zone)}
      hotLeg={hotLeg} onHotLeg={setHoveredLeg} onPinLeg={pinLeg} />
    <CountryLabelsToggle />
    {/* A path flown by dozens of regions is usually the same flight in each, so
        the choice reads better as a short radio list than as a dropdown that
        hides how many there are */}
    <fieldset className="trajectory-region">
      <legend><Tr text="xpediaTrajectoryRegion" /></legend>
      {regions.map(r => <label key={r.id} className="trajectory-region-choice">
        <input type="radio" name="trajectory-region" value={r.id}
          checked={r.id == region.id}
          onChange={() => rememberSelection("region", r.id)} />
        {rul.tr(r.id)}
      </label>)}
      <span className="trajectory-region-count">
        {regions.length} <Tr text={regions.length == 1 ? "xpediaTrajectoryRegionOne" : "xpediaTrajectoryRegions"} />
      </span>
    </fieldset>
    {/* The flight in order, with the move between each pair of stops drawn in the
        leg's own colour. Pointing at a stop lights up every box of its zone, and
        pressing it pins that highlight; pointing at a leg's line lights that leg
        on the map, and the same works the other way round. */}
    {shape && shape.stops.length > 0 && <FlightStrip stops={shape.stops}
      hotZone={hotZone} pinned={pinned}
      hotLeg={hotLeg} pinnedLeg={pinnedLeg}
      onHover={setHovered}
      onPin={zone => setPinned(current => current == zone ? undefined : zone)}
      onHoverLeg={setHoveredLeg}
      onPinLeg={pinLeg} />}
    {shape && shape.stops.length > 0 && <p className="world-map-note">
      <Tr text="xpediaTrajectoryLegLabels" />
      {landing != null && <>{" "}<Tr text="xpediaTrajectoryLandsFor" />{" "}
        <span className="mission-delay">{formatSeconds(landing)}</span>.</>}
    </p>}
    <TrajectoryLegend path={overlays[0]?.paths?.[0]} />
    {/* A stop the game fills with a random point anywhere in the world has no
        place to mark, so the picture is missing something and says so. A path
        that stays in one zone still draws that zone's marker, so it is not
        "nothing to draw" any more. */}
    {shape && shape.dropped > 0 && <p className="world-map-unplaced">
      <span className="world-map-count">{shape.dropped}</span>{" "}
      <Tr text="xpediaTrajectoryAnywhere" />
    </p>}
    {shape && shape.stops.length > 0 && drawnLegs(shape) == 0 && <p className="world-map-unplaced">
      <Tr text="xpediaTrajectoryOneZone" />
    </p>}
    <p className="world-map-note"><Tr text="xpediaTrajectoryMapNote" /></p>
  </div>;
}

