import type { CSSProperties } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { MapArea, Region, UfoTrajectory } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import { remembered, rememberSelection, state, update } from "../state";
import { loadWorldMap, type MapRectangle, ORIGIN, type WorldMap } from "../worldmap";
import {
  colorForCountry,
  colorForTerrain,
  readDeclaredColors,
  readDeclaredCountryColors,
} from "./mapColors";
import { arrowAt, HEIGHT, legDash, legWidth, STOP_RADIUS, stopMarker, WIDTH } from "./mapMarks";
import {
  boxArea,
  legColor,
  type PathStop,
  pathShape,
  regionOverlay,
  regionPalette,
  samePlace,
  zoneColor,
} from "./mapOverlay";
import { StopPlate } from "./StopPlate";
import { type TrajectoryFocus, useTrajectoryFocus } from "./trajectoryFocus";
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
 * A boxed-off part of the globe with a name: a nation or a region.
 *
 * Both are the same thing to the picture — a list of boxes the game tests a point
 * against, plus a name to write in the biggest of them — so they are drawn by the
 * same code. `id` is what puts the boxes and the title together in one blink.
 */
export type TitledArea = {
  id: string;
  color: string;
  label?: { x: number; y: number };
  /** Screen quadrilaterals, one per ruleset box */
  areas: [number, number][][];
};

/**
 * One flight path, as globe points in flight order.
 *
 * `stops` carries the leg number of each placed stop, so the picture can number
 * its stops the same way the article's waypoint list does, and says which of them
 * are in an "anywhere" zone: those sit at the middle of the map, because the game
 * may put them anywhere on the globe.
 *
 * `craftKnots` is the top speed the drawing converts a leg's speed percentage
 * into, so a dash can stand for a stated stretch of time.
 */
export type OverlayPath = {
  id: string;
  stops: PathStop[];
  craftKnots?: number;
};

/** Rows keep north up: OpenXcom stores latitude with north negative */
const rowForLat = (lat: number) => ((90 + lat) / 180) * HEIGHT;

/**
 * A game longitude to a column on the visible turn.
 *
 * `ORIGIN` is subtracted so the map is cut at the Bering Strait: cutting at
 * Greenwich would run the seam through Britain and Africa. Shapes are unwrapped
 * before they get here (see `center`), so their longitudes may sit outside
 * 0..360; that is deliberate, and the extra copies at +-WIDTH fill the edge.
 */
const columnForLon = (lon: number) => ((lon - ORIGIN) / 360) * WIDTH;
/**
 * A single longitude to a column on the visible turn.
 *
 * Only used for labels, which are single points and so can simply be wrapped.
 * Polygons go through `center`/`unwrap` instead, because wrapping their vertices
 * independently would tear a shape apart at the seam.
 */
const wrapColumn = (lon: number) => (((((lon - ORIGIN) % 360) + 360) % 360) / 360) * WIDTH;
/**
 * Unwraps a run of longitudes so the shape is continuous.
 *
 * A shape crossing the cut has vertices at both ends of the range, which would
 * otherwise be joined straight across the whole map. Nudging each point by whole
 * turns keeps a seam-crossing shape together; doing it by steps of a whole turn
 * also leaves polar caps alone, since those wrap gradually rather than jumping.
 */
function unwrap(lons: number[]) {
  const out = [lons[0]];
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
  const unwrapped = unwrap(lons);
  const mean = unwrapped.reduce((a, b) => a + b, 0) / unwrapped.length;
  // Put the shape in the turn that the visible window covers, so its own
  // longitudes stay close to `ORIGIN` and the +-WIDTH copies land next to it
  const turns = Math.round((mean - ORIGIN) / 360);
  return unwrapped.map((v) => v - turns * 360);
}

/**
 * Expands a polygon so a vertex sitting on a pole becomes two.
 *
 * The pole is one point on the sphere but a whole edge of the map. Left as one
 * point, a cap polygon is drawn as a wedge running the wrong way round the
 * world; giving it both neighbouring longitudes turns it into the band it is.
 */
function splitPoles(points: [number, number][]) {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const [lon, lat] = points[i];
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
 *
 * Without overlays the result depends on nothing but the map, so it is kept: a
 * nation's page crops the same drawing, and projecting two and a half thousand
 * polygons once per nation visited is work that never changes answer. The cache
 * is keyed by the map object itself, so a different pack is a different entry
 * and the old one is collected with it.
 */
const plainProjections = new WeakMap<WorldMap, ReturnType<typeof buildProjection>>();

function projectMap(map: WorldMap, overlays?: Overlay[]) {
  if (overlays?.length) return buildProjection(map, overlays);
  let cached = plainProjections.get(map);
  if (!cached) plainProjections.set(map, (cached = buildProjection(map)));
  return cached;
}

function buildProjection(map: WorldMap, overlays?: Overlay[]) {
  const polygons = map.polygons.map((polygon) => {
    const lons = center(polygon.points.map((p) => p[0]));
    const lats = polygon.points.map((p) => p[1]);
    return {
      terrain: polygon.terrain,
      color: colorForTerrain(polygon.terrain),
      points: splitPoles(lons.map((lon, i) => [lon, lats[i]] as [number, number])).map(
        ([lon, lat]) => [columnForLon(lon), rowForLat(lat)] as [number, number],
      ),
    };
  });

  const lines = map.lines.map((line) => {
    const lons = center(line.map((p) => p[0]));
    return line.map((p, i) => [columnForLon(lons[i]), rowForLat(p[1])] as [number, number]);
  });

  const countries = map.countries.map((country, index) => ({
    id: country.id,
    color: colorForCountry(country.id, index),
    label: country.label
      ? { x: wrapColumn(country.label.lon), y: rowForLat(country.label.lat) }
      : undefined,
    areas: oneTurn(country.areas.map((area) => countryRectangle(area))),
  }));

  return {
    polygons,
    lines,
    countries,
    overlays: (overlays ?? []).map((overlay) => projectOverlay(overlay)),
  };
}

/**
 * A region's boxes and its title, in screen coordinates.
 *
 * A region's `areas` are stated the way a nation's are — a list of
 * `[lon1, lon2, lat1, lat2]` boxes — so the projection is the same one. The title
 * goes in the middle of the largest box rather than at the mean of all of them,
 * for the reason `zoneCenter` gives: the mean of disjoint patches lands in the
 * sea between them. A region that states no `areas` has nothing to draw and is
 * left out; those are the technical regions, which exist only to weight missions
 * and hold zones.
 */
function projectRegions(regions: Region[]): TitledArea[] {
  const drawable = regions.filter((region) =>
    (region.areas ?? []).some((area) => area?.length >= 4),
  );
  // One colour per drawn region rather than `regionColor` per id: these are peers,
  // and hashed hues collide when fourteen of them are on the screen at once
  const palette = regionPalette(drawable.length);
  const areas: TitledArea[] = [];
  for (const [index, region] of drawable.entries()) {
    const boxes = (region.areas ?? []).filter((area) => area?.length >= 4);
    const biggest = boxes.reduce((a, b) => (boxArea(b) > boxArea(a) ? b : a));
    let lonMin = Number(biggest[0]),
      lonMax = Number(biggest[1]);
    // A box may cross the antimeridian, which is written as `lonMax < lonMin`
    if (lonMax < lonMin) lonMax += 360;
    areas.push({
      id: region.uid,
      color: palette[index],
      label: {
        x: wrapColumn((lonMin + lonMax) / 2),
        y: rowForLat((Number(biggest[2]) + Number(biggest[3])) / 2),
      },
      areas: boxes.map((area) => globeBox(area)),
    });
  }
  return areas;
}

/**
 * Titled areas as shapes, with the name written in each one.
 *
 * A title and its boxes are one thing: pointing at either makes the outline
 * blink, which is how a name is tied to the rectangle it sits in. Both are links
 * when the pack has a page for the id, so the picture is also a contents list.
 *
 * `onPick` turns the shapes from links into choices: the map of the regions uses
 * it because a press there has to choose a region and light it up, not leave the
 * page. The press is remembered by the caller as `pinned`, so its blink survives
 * the pointer moving away; a second press on the same region lets it go.
 */
function AreaShapes({
  areas,
  zoom = 1,
  hot,
  pinned,
  onHot = () => {},
  onPick,
}: {
  areas: TitledArea[];
  zoom?: number;
  hot?: string;
  pinned?: string;
  onHot?: (id?: string) => void;
  onPick?: (id: string) => void;
}) {
  const interactive = !onPick;
  // Both are lit at once: the region under the pointer and the one pressed
  // earlier are both answers to "which one am I looking at", and dropping the
  // press because the pointer wandered would unpick what the press was for.
  const lit = (id: string) => id === hot || id === pinned;
  return (
    <>
      {areas.map((area) =>
        area.areas.map((points, i) => (
          <Repeated
            key={area.id + i}
            points={points}
            render={(serialized, shift) => {
              const shape = (
                <polygon
                  className="area-contour"
                  points={serialized}
                  style={{ "--area-color": area.color } as CSSProperties}
                  transform={shift ? `translate(${shift} 0)` : undefined}
                />
              );
              const href = interactive ? pageFor(area.id) : undefined;
              const className = lit(area.id) ? "area-hot" : undefined;
              const handlers = {
                onPointerEnter: () => onHot(area.id),
                onPointerLeave: () => onHot(undefined),
                onClick: onPick && (() => onPick(pinned === area.id ? "" : area.id)),
              };
              return href ? (
                <a key={shift} href={href} className={className} {...handlers}>
                  {shape}
                </a>
              ) : (
                <g key={shift} className={className} {...handlers}>
                  {shape}
                </g>
              );
            }}
          />
        )),
      )}
      {/* Plain text only: an SVG `text` cannot contain HTML, so this cannot go
        through `Tr`, which renders a `<span>`.

        The titles are drawn before the region overlays so the overlay sits on
        top: a name is orientation, while the boxes and paths are the subject of
        the page, and a label crossing a flight line only gets in the way. */}
      {areas.map((area) => {
        const label = area.label;
        if (!label) return null;
        const href = interactive ? pageFor(area.id) : undefined;
        const className = lit(area.id) ? "area-hot" : undefined;
        const handlers = {
          onPointerEnter: () => onHot(area.id),
          onPointerLeave: () => onHot(undefined),
          onClick: onPick && (() => onPick(pinned === area.id ? "" : area.id)),
        };
        const name = rul?.tr(area.id) ?? area.id;
        // The anchor is the middle of the area's largest box, which for an area at
        // the edge of the map leaves half the name drawn off it. Nudging the anchor
        // keeps the whole name in view; the shift is at most half a name, so the
        // title still reads as belonging to the contour it sits in.
        const at = fitLabel(label, name, 18 / zoom);
        const text = (
          // biome-ignore lint/correctness/useJsxKeyInIterable: child of the keyed <a>/<g> below, not an iterable element
          <text
            x={at.x}
            y={at.y}
            textAnchor="middle"
            style={
              {
                "--area-color": area.color,
                // Labels keep their reading size as the map is magnified, so the sizes
                // in viewBox units are divided back out
                fontSize: `${18 / zoom}px`,
                strokeWidth: `${3 / zoom}px`,
              } as CSSProperties
            }
          >
            {name}
          </text>
        );
        return href ? (
          <a key={area.id} href={href} className={className} {...handlers}>
            {text}
          </a>
        ) : (
          <g
            key={area.id}
            className={`area-label${className ? ` ${className}` : ""}`}
            {...handlers}
          >
            {text}
          </g>
        );
      })}
    </>
  );
}

/**
 * A region's boxes and the paths drawn through them, in screen coordinates.
 *
 * `areas` are the region's own outline boxes, the ones `insideRegion` tests a
 * point against, and `zones` are the areas that the waypoints index. Both are
 * plain rectangles from the same projection as the nations. A point zone
 * (`lon1 == lon2`) becomes a dot, which is how the packs mark cities.
 */
function projectOverlay(overlay: Overlay) {
  const boxes = (overlay.areas ?? []).map((area) => globeBox(area));
  const zoneBoxes = (overlay.zones ?? []).map((zone) => zone.map((area) => globeBox(area)));
  return {
    ...overlay,
    boxes,
    zoneBoxes,
    // A zone counts as a dot when every box in it is a single point
    zoneDots: (overlay.zones ?? []).map((zone) => zone.every(isPointArea)),
    paths: overlay.paths ?? [],
  };
}

/** Whether a globe area is a single point rather than a box */
function isPointArea(area: MapArea) {
  return area[0] === area[1] && area[2] === area[3];
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
  const lonMax = area[1] < area[0] ? area[1] + 360 : area[1];
  const lons = center([area[0], lonMax, lonMax, area[0]]);
  const lats = [area[2], area[2], area[3], area[3]];
  return lons.map((lon, i) => [columnForLon(lon), rowForLat(lats[i])] as [number, number]);
}

/** The centre of a box or point, as a globe point */
export function areaCenter(area: MapArea) {
  const lon = (area[0] + area[1]) / 2;
  const lat = (area[2] + area[3]) / 2;
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
  const lonMax = area.lonMax < area.lonMin ? area.lonMax + 360 : area.lonMax;
  const lons = center([area.lonMin, lonMax, lonMax, area.lonMin]);
  const lats = [area.latMin, area.latMin, area.latMax, area.latMax];
  return lons.map((lon, i) => [columnForLon(lon), rowForLat(lats[i])] as [number, number]);
}

/**
 * Brings one nation's boxes into a single turn of the map.
 *
 * `center` chooses a turn for each shape on its own, by rounding its middle
 * toward `ORIGIN`. That is right for a coastline, which is one continuous run of
 * vertices, but a nation is a list of separate boxes and each is rounded by
 * itself. A nation with boxes on both sides of the rounding point — 10°E, since
 * the map is cut at the Bering Strait — ends up with one box a whole world away
 * from the rest. In XFiles, Denmark's three boxes come out at columns 1011 and
 * -1018, so the country is drawn as a band a third of a world wide.
 *
 * The big map hides this, because the +-WIDTH copies it draws either side fill
 * the gap. A picture cropped to the nation does not: the crop is the union of
 * the boxes, so it becomes the whole world, and the nation appears twice in it.
 *
 * The widest box is the anchor, since it is the part of a nation a reader would
 * call the country, and every other box is moved by the whole number of turns
 * that brings it nearest. A nation with territory genuinely far away — France
 * with its Pacific islands, say — keeps the distance, because no turn is a lie
 * that would bring it closer.
 */
function oneTurn(quads: [number, number][][]) {
  if (quads.length < 2) return quads;

  const middle = (quad: [number, number][]) =>
    (Math.min(...quad.map((p) => p[0])) + Math.max(...quad.map((p) => p[0]))) / 2;
  const span = (quad: [number, number][]) =>
    Math.max(...quad.map((p) => p[0])) - Math.min(...quad.map((p) => p[0]));

  const anchor = quads.reduce((a, b) => (span(b) > span(a) ? b : a));
  const at = middle(anchor);
  return quads.map((quad) => {
    const turns = Math.round((at - middle(quad)) / WIDTH);
    return turns ? quad.map(([x, y]) => [x + turns * WIDTH, y] as [number, number]) : quad;
  });
}

/**
 * Moves a title back inside the picture if it would hang over the edge.
 *
 * A region's title goes at the middle of its biggest box, and a box near the
 * antimeridian has its middle near the edge of the map. `textAnchor="middle"`
 * then draws half the name off the canvas, where the clip cuts it. Nudging the
 * anchor by the overflow keeps the whole name readable; the shift is at most half
 * the name's width, which is small enough that the title still reads as belonging
 * to the contour it names.
 *
 * The width is estimated rather than measured, because the picture is projected
 * before anything is laid out and there is no element to measure: 0.55 em per
 * character is close for the font the map uses, and erring wide is the safe
 * direction.
 */
function fitLabel(label: { x: number; y: number }, text: string, fontSize: number) {
  const half = (text.length * fontSize * 0.55) / 2;
  return { x: Math.min(Math.max(label.x, half), WIDTH - half), y: label.y };
}

/**
 * One shape, repeated either side of the map so the seam is filled.
 * Each copy is wrapped in a keyed fragment: the render callback usually returns
 * a bare element, and a bare element in a list has no key of its own, so React
 * cannot tell one copy from another when the map is redrawn. Some callers key
 * their element anyway; the wrapper makes that a caller's choice rather than a
 * requirement, since forgetting it only produced a console warning.
 */
function Repeated(props: {
  points: [number, number][];
  render: (points: string, shift: number) => any;
}) {
  const serialized = props.points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <>
      {[-1, 0, 1].map((shift) => (
        <Fragment key={shift}>{props.render(serialized, shift * WIDTH)}</Fragment>
      ))}
    </>
  );
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
  if (!lons.length) return lons;
  const out = unwrap(lons);
  // Whole turns only: the shape keeps its own length and shape
  const turns = Math.floor((out[0] - ORIGIN) / 360);
  return out.map((v) => v - turns * 360);
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

type Point = { x: number; y: number };
type RawLeg = { a: Point; b: Point };

/** Whether two legs are drawn between the same two spots, in either direction */
function sameTrack(a: RawLeg, b: RawLeg) {
  const near = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
  return (near(a.a, b.a) && near(a.b, b.b)) || (near(a.a, b.b) && near(a.b, b.a));
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
    const group = legs.filter((other) => sameTrack(leg, other));
    const rank = legs.slice(0, i).filter((other) => sameTrack(leg, other)).length;
    const dx = leg.b.x - leg.a.x,
      dy = leg.b.y - leg.a.y;
    const length = Math.hypot(dx, dy);
    // A single leg on its track is already visible, and a leg with no length has
    // no direction to be offset along
    if (group.length < 2 || length < 1) return leg;

    // Centre the spread on zero, so the first leg drawn is not pushed off the track
    const shift = (rank - (group.length - 1) / 2) * LEG_GAP;
    // The perpendicular has to be the same one for every leg on a track, or its
    // side cancels out. A leg flown back along its own track runs the other way,
    // so its perpendicular points the other way too, and a side chosen from the
    // rank would land both legs on the same side of the line — which is exactly
    // the overlap this exists to remove. Taking the direction from the track's
    // endpoints in a fixed order gives one perpendicular for the whole group.
    const forward = leg.a.x < leg.b.x || (leg.a.x === leg.b.x && leg.a.y <= leg.b.y);
    const ux = forward ? dx / length : -dx / length;
    const uy = forward ? dy / length : -dy / length;
    // Right of the canonical direction
    const nx = -uy * shift,
      ny = ux * shift;
    return {
      a: { x: leg.a.x + nx, y: leg.a.y + ny },
      b: { x: leg.b.x + nx, y: leg.b.y + ny },
    };
  });
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
function RegionOverlay({
  overlay,
  zoom = 1,
  hotZone,
  onHotZone,
  onPinZone,
  hotLeg,
  onHotLeg,
  onPinLeg,
}: {
  overlay: ReturnType<typeof projectOverlay>;
  /** Current magnification, so labels can keep a constant on-screen size */
  zoom?: number;
  /**
   * Zone to emphasise, normally because its chip or its marker is being pointed
   * at. A zone is a list of boxes anywhere in the region, so this is the only
   * view that shows the whole area a waypoint may pick from.
   */
  hotZone?: number;
  /** Called while a stop marker is pointed at, so the page can light its zone */
  onHotZone?: (zone?: number) => void;
  /** Called when a stop marker is pressed, which pins its zone on a touch screen */
  onPinZone?: (zone: number) => void;
  /**
   * Leg to emphasise, as the leg number the stop numbers come from.
   *
   * A leg and a zone are different answers and are kept in different slots: a
   * zone says "all of this ground", a leg says "this one move". They can be lit
   * at the same time without contradicting one another, since a stop belongs to
   * both.
   */
  hotLeg?: number;
  /** Called while a leg's line is pointed at */
  onHotLeg?: (leg?: number) => void;
  /** Called when a leg's line is pressed, which pins it on a touch screen */
  onPinLeg?: (leg: number) => void;
}) {
  const color = overlay.color ?? "#ffd24a";
  const style = { "--region-color": color } as any;
  // A zone is coloured by its index, so the same zone is the same colour on
  // every path drawn in this region, and on the zone box itself
  const zoneStyle = (index: number) => ({ "--zone-color": zoneColor(index) }) as any;
  // Stops are numbered only when one flight is drawn: the number is a stop's
  // place in that flight, so with several paths on one picture the numbers of
  // different flights would be indistinguishable. Region pages draw none now, so
  // in practice this is the trajectory page and the answer is always yes.
  const numbered = overlay.paths.length === 1;

  return (
    <g className={`region-overlay${overlay.hot ? " region-hot" : ""}`} style={style}>
      {overlay.boxes.map((box, i) => (
        <Repeated
          key={`a${i}`}
          points={box}
          render={(points, shift) => (
            <polygon
              className="region-area"
              points={points}
              transform={shift ? `translate(${shift} 0)` : undefined}
            />
          )}
        />
      ))}

      {/* Zones that a drawn flight visits are shown in that flight's own zone
        colour, so the box and the stop on it agree; the rest stay in the region
        colour and recede. The highlighted zone is drawn again on top by
        `hotZoneBoxes` below, so its brighter outline is not buried under the
        other boxes of a zone with dozens of them. */}
      {overlay.zoneBoxes.map((zone, i) => {
        const visited = overlay.paths.some((path) => path.stops.some((stop) => stop.zone === i));
        // The highlighted zone is not marked here: `hotZoneBoxes` below draws it
        // again above everything, and marking it in both places would draw it twice
        const className = `region-zone${visited ? " region-zone-visited" : ""}`;
        const extra = visited ? zoneStyle(i) : undefined;
        return zone.map((box, j) =>
          overlay.zoneDots[i] ? (
            <Repeated
              key={`z${i}_${j}`}
              points={box}
              render={(_points, shift) => (
                <circle
                  className={`${className} region-zone-point`}
                  style={extra}
                  cx={box[0][0]}
                  cy={box[0][1]}
                  r={5}
                  transform={shift ? `translate(${shift} 0)` : undefined}
                />
              )}
            />
          ) : (
            <Repeated
              key={`z${i}_${j}`}
              points={box}
              render={(points, shift) => (
                <polygon
                  className={className}
                  style={extra}
                  points={points}
                  transform={shift ? `translate(${shift} 0)` : undefined}
                />
              )}
            />
          ),
        );
      })}

      {/* The highlighted zone, drawn again above the others so its outline is not
        hidden under the many boxes of other zones. This is the answer to "where
        can this waypoint actually be", so it has to be the last thing drawn. */}
      {hotZone != null &&
        (overlay.zoneBoxes[hotZone] ?? []).map((box, j) =>
          overlay.zoneDots[hotZone] ? (
            <Repeated
              key={`hot${j}`}
              points={box}
              render={(_points, shift) => (
                <circle
                  className="region-zone region-zone-hot region-zone-point"
                  style={zoneStyle(hotZone)}
                  cx={box[0][0]}
                  cy={box[0][1]}
                  r={5}
                  transform={shift ? `translate(${shift} 0)` : undefined}
                />
              )}
            />
          ) : (
            <Repeated
              key={`hot${j}`}
              points={box}
              render={(points, shift) => (
                <polygon
                  className="region-zone region-zone-hot"
                  style={zoneStyle(hotZone)}
                  points={points}
                  transform={shift ? `translate(${shift} 0)` : undefined}
                />
              )}
            />
          ),
        )}

      {overlay.paths.map((path) => {
        // One continuous run for the whole flight, so a path crossing the seam is
        // joined the short way round instead of being drawn across the world
        const lons = placeRun(path.stops.map((stop) => stop.point.lon));
        const at = path.stops.map((stop, i) => ({
          x: columnForLon(lons[i]),
          y: rowForLat(stop.point.lat),
        }));

        // Legs between consecutive stops, each with its own altitude and speed.
        // A leg whose two stops are the same place is the craft waiting, not
        // moving: it has no line.
        const legs = at
          .map((point, i) => {
            if (i === 0) return undefined;
            const a = at[i - 1];
            if (Math.abs(a.x - point.x) < 0.01 && Math.abs(a.y - point.y) < 0.01) return undefined;
            const stop = path.stops[i];
            return {
              a,
              b: point,
              zone: stop.zone,
              // The leg's own number, so its colour is its own rather than a repeat
              // of the stop it flies to
              leg: stop.leg,
              width: legWidth(stop.altitude),
              dash: legDash(stop.speed, path.craftKnots),
            };
          })
          .filter((leg) => leg != null);

        // Overlapping legs are drawn apart; see `spreadLegs`
        const spread = spreadLegs(legs);

        // Coincident stops share one marker and one label, so a doubled arrival
        // reads as "2, 3" on one point rather than as two numbers on top of each
        // other. The stops of a landing are on the ground at the same spot, and so
        // are the stops of an "anywhere" zone: every one of them is drawn in the
        // middle of the map, and they are one marker saying "no place in
        // particular" rather than several piled on top of each other.
        const groups: {
          at: { x: number; y: number };
          labels: number[];
          lands: boolean;
          zone: number;
          anywhere: boolean;
        }[] = [];
        at.forEach((point, i) => {
          const stop = path.stops[i];
          const found = groups.find(
            (g) => Math.abs(g.at.x - point.x) < 1 && Math.abs(g.at.y - point.y) < 1,
          );
          if (found) {
            found.labels.push(stop.leg + 1);
            found.lands ||= stop.lands;
            found.anywhere ||= !!stop.anywhere;
          } else
            groups.push({
              at: point,
              labels: [stop.leg + 1],
              lands: stop.lands,
              zone: stop.zone,
              anywhere: !!stop.anywhere,
            });
        });

        return [-1, 0, 1].map((shift) => {
          const offset = shift * WIDTH;
          return (
            <g key={path.id + shift} className="region-path" transform={`translate(${offset} 0)`}>
              {legs.map((leg, i) => {
                // The arrow keeps clear of the stop marker at the far end, which is a
                // fixed size on screen and so a variable size in map units
                const arrow = arrowAt(spread[i].a, spread[i].b, 1 / zoom, STOP_RADIUS / zoom);
                return (
                  <g
                    key={`leg${i}`}
                    style={{ "--leg-color": legColor(leg.leg) } as CSSProperties}
                    className={
                      "region-leg-group" +
                      (onHotLeg ? " region-leg-live" : "") +
                      (hotLeg === leg.leg ? " region-leg-hot" : "")
                    }
                    // A leg answers the same two gestures a stop does: pointing at it
                    // lights the line, and pressing pins it for a screen with no hover.
                    // The pointer target is the line itself plus a wide invisible stroke
                    // beside it (`region-leg-hit`), because a 3-unit line is impossible to
                    // hit on a touch screen.
                    onPointerEnter={onHotLeg && (() => onHotLeg(leg.leg))}
                    onPointerLeave={onHotLeg && (() => onHotLeg(undefined))}
                    onPointerUp={onPinLeg && (() => onPinLeg(leg.leg))}
                  >
                    {/* The pointer target, drawn only where the page can answer the
                  gesture: a region page draws six paths and nothing to say about
                  any of them */}
                    {onHotLeg && (
                      <line
                        className="region-leg-hit"
                        x1={spread[i].a.x}
                        y1={spread[i].a.y}
                        x2={spread[i].b.x}
                        y2={spread[i].b.y}
                      />
                    )}
                    {/* A halo under the line, so the blink can be in screen units while
                  the line's own width stays in map units: the width is how high
                  the craft flies, and a highlight must not overwrite an encoding.
                  Only drawn when hot, since a path can have dozens of legs. */}
                    {hotLeg === leg.leg && (
                      <line
                        className="region-leg-halo"
                        x1={spread[i].a.x}
                        y1={spread[i].a.y}
                        x2={spread[i].b.x}
                        y2={spread[i].b.y}
                      />
                    )}
                    {/* The dash is in map units because it stands for a distance flown;
                  the width is divided back out because it is only a rank, and a
                  rank should not become a slab at high magnification */}
                    <line
                      className="region-leg"
                      x1={spread[i].a.x}
                      y1={spread[i].a.y}
                      x2={spread[i].b.x}
                      y2={spread[i].b.y}
                      strokeWidth={leg.width / zoom}
                      strokeDasharray={leg.dash}
                    />
                    {arrow && <polygon className="region-leg-arrow" points={arrow} />}
                  </g>
                );
              })}
              {groups.map((group, i) => (
                <g
                  key={`stop${i}`}
                  style={zoneStyle(group.zone)}
                  className={
                    "region-stop-group" +
                    (group.anywhere ? " region-stop-anywhere" : "") +
                    (onHotZone ? " region-stop-live" : "") +
                    (hotZone === group.zone ? " region-stop-hot" : "")
                  }
                  // Pointing at a stop lights up every box of its zone, which is the
                  // whole area the waypoint may be anywhere in — the one thing the
                  // marker itself cannot show. Pressing pins it, because a touch screen
                  // has no hover, and the leave that follows a touch press must not
                  // undo the press.
                  onPointerEnter={onHotZone && (() => onHotZone(group.zone))}
                  onPointerLeave={onHotZone && (() => onHotZone(undefined))}
                  onPointerUp={onPinZone && (() => onPinZone(group.zone))}
                >
                  {/* Markers keep a constant on-screen size, like the labels: a stop is
                a place, not a distance, so magnifying the map should not inflate
                it over the zone it sits in. The shape says whether the UFO is on
                the ground here, which is the fact a site appears on. */}
                  {stopMarker(group.at, 14 / zoom, group.lands, "region-stop")}
                  {group.anywhere && (
                    <circle
                      className="region-stop-ring"
                      cx={group.at.x}
                      cy={group.at.y}
                      r={26 / zoom}
                    />
                  )}
                  {numbered && (
                    <text
                      className="region-stop-label"
                      // Above the marker for both shapes: the marker is centred on the
                      // stop either way now, so one offset serves both and the numbers of
                      // a flight line up along the top of it
                      x={group.at.x}
                      y={group.at.y - 24 / zoom}
                      // Divided back out so the number keeps its reading size when the
                      // map is magnified, like the nation labels
                      style={{ fontSize: `${26 / zoom}px`, strokeWidth: `${6 / zoom}px` }}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      {group.labels.join(", ")}
                    </text>
                  )}
                </g>
              ))}
            </g>
          );
        });
      })}
    </g>
  );
}

/**
 * The address of a page, or nothing when the pack has no such article.
 *
 * A terrain name in `globe: textures:` is a terrain id the pack may or may not
 * give a page of its own, so the picture only becomes a link when following it
 * would actually land somewhere.
 */
function pageFor(id?: string) {
  if (!id || !rul?.article(id)) return;
  return `##${id}`;
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
type View = { zoom: number; x: number; y: number };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Keeps the view over the map.
 *
 * The picture repeats one turn to either side, so the edges are never empty,
 * but letting the view wander would still leave the map off screen. Panning is
 * therefore limited to the span the magnification added.
 */
function clampView(view: View): View {
  const maxX = WIDTH * (1 - view.zoom);
  const maxY = HEIGHT * (1 - view.zoom);
  return {
    zoom: view.zoom,
    x: clamp(view.x, maxX, 0),
    y: clamp(view.y, maxY, 0),
  };
}

/** A pointer position in the picture's own coordinates */
function pointInMap(svg: SVGSVGElement, clientX: number, clientY: number) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const local = point.matrixTransform(matrix.inverse());
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
 *
 * `regions` swaps the subject from the nations to the regions: the boxes and
 * titles drawn are then the pack's regions, and `hotRegion`/`onPickRegion` make
 * them a chooser rather than links. That is the picture the REGIONS page leads
 * with, and the nations are left off it — two sets of contours at once read as a
 * tangle rather than as two layers.
 */
function MapPicture({
  map,
  overlays,
  showCountries = true,
  regions,
  hotZone,
  onHotZone,
  onPinZone,
  hotRegion,
  pinnedRegion,
  onHotRegion,
  onPickRegion,
  hotLeg,
  onHotLeg,
  onPinLeg,
}: {
  map: WorldMap;
  overlays?: Overlay[];
  showCountries?: boolean;
  regions?: TitledArea[];
  hotZone?: number;
  onHotZone?: (zone?: number) => void;
  onPinZone?: (zone: number) => void;
  hotRegion?: string;
  pinnedRegion?: string;
  onHotRegion?: (id?: string) => void;
  onPickRegion?: (id: string) => void;
  hotLeg?: number;
  onHotLeg?: (leg?: number) => void;
  onPinLeg?: (leg: number) => void;
}) {
  const projected = useMemo(() => projectMap(map, overlays), [map, overlays]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  // Which nation's title the pointer is over, so its outline can stand out
  const [highlighted, setHighlighted] = useState<string>();
  // Whether the current press has turned into a drag, shared with the click
  // handler that has to ignore the click a drag ends with
  const drag = useRef<{ moved: boolean }>(undefined);

  // A new map means a new picture, so the old magnification is meaningless.
  // An empty dependency array: the view starts at the default, and it cannot
  // be changed while the map has not loaded, since the picture only renders
  // once the map is known.
  useEffect(() => setView({ zoom: 1, x: 0, y: 0 }), []);

  // The wheel listener has to be native and non-passive: React's `onWheel` is
  // passive, so `preventDefault` there would not stop the page from scrolling
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      const el = svgRef.current;
      if (!el) return;
      // At normal size the map has nothing to zoom out to, so the page keeps
      // scrolling; only an actual zoom swallows the wheel
      if (view.zoom === 1 && e.deltaY > 0) return;
      e.preventDefault();
      setView((current) => {
        const zoom = clamp(current.zoom * Math.exp(-e.deltaY / 500), 1, MAX_ZOOM);
        // Keep the point under the cursor still: everything else moves towards
        // or away from it by the same factor
        const factor = zoom / current.zoom;
        const point = pointInMap(el, e.clientX, e.clientY);
        return clampView({
          zoom,
          x: point.x + (current.x - point.x) * factor,
          y: point.y + (current.y - point.y) * factor,
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
    if (e.button !== 0 && e.button !== 1) return;
    const svg = svgRef.current;
    if (!svg) return;
    // A middle click must not also start the browser's autoscroll
    if (e.button === 1) e.preventDefault();
    const start = pointInMap(svg, e.clientX, e.clientY);
    const base = view;
    const moved = { moved: false };
    drag.current = moved;

    function move(moveEvent: PointerEvent) {
      const el = svgRef.current;
      if (!el) return;
      const now = pointInMap(el, moveEvent.clientX, moveEvent.clientY);
      const next = clampView({
        zoom: base.zoom,
        x: base.x + now.x - start.x,
        y: base.y + now.y - start.y,
      });
      // Nothing moved, so this is still a potential click
      if (!moved.moved && next.x === base.x && next.y === base.y) return;
      moved.moved = true;
      setPanning(true);
      setView(next);
    }
    function end() {
      svg?.removeEventListener("pointermove", move);
      svg?.removeEventListener("pointerup", end);
      svg?.removeEventListener("pointercancel", end);
      try {
        svg?.releasePointerCapture(e.pointerId);
      } catch {}
      setPanning(false);
    }
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    // Not every browser allows capturing a synthetic pointer, and the drag still
    // works without it
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {}
  }

  return (
    <svg
      ref={svgRef}
      className={`world-map${panning ? " panning" : ""}${view.zoom > 1 ? " zoomed" : ""}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="group"
      aria-label="World map"
      onPointerDown={startPan}
      // A pan that ends over a link must not also follow it, so the click the
      // browser synthesises after the drag is dropped
      onClickCapture={(e) => {
        const wasDragged = drag.current?.moved;
        if (drag.current) drag.current.moved = false;
        if (!wasDragged) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      // Middle-click is the pan gesture here, so it must not also start the
      // browser's autoscroll or open a link in a new tab
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onDoubleClick={() => setView({ zoom: 1, x: 0, y: 0 })}
    >
      <defs>
        <clipPath id="world-map-clip">
          <rect width={WIDTH} height={HEIGHT} />
        </clipPath>
      </defs>
      <rect width={WIDTH} height={HEIGHT} fill="#0d2f52" />
      <g clipPath="url(#world-map-clip)">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {projected.polygons.map((polygon, i) => (
            <Repeated
              key={i}
              points={polygon.points}
              render={(points, shift) => {
                // A polygon is a plain shape, not a link. Every shape of one terrain
                // used to be an anchor to that terrain's page, which on a full-size
                // map is over two and a half thousand tab stops before the reader
                // reaches anything else on the page — a keyboard could not get past
                // the picture. The legend below is the way in to the terrain pages,
                // and it names the same terrain with the same colour.
                //
                // The tooltip stays: it is the only thing that says which terrain a
                // shape is, and a `title` is neither focusable nor clickable, so it
                // costs no tab stop.
                return (
                  <Fragment key={shift}>
                    {polygon.terrain && (
                      <title>{rul?.tr(polygon.terrain) ?? polygon.terrain}</title>
                    )}
                    <polygon
                      points={points}
                      fill={polygon.color}
                      transform={shift ? `translate(${shift} 0)` : undefined}
                    />
                  </Fragment>
                );
              }}
            />
          ))}
          {projected.lines.map((line, i) => (
            <Repeated
              key={i}
              points={line}
              render={(points, shift) => (
                <polyline
                  points={points}
                  fill="none"
                  transform={shift ? `translate(${shift} 0)` : undefined}
                />
              )}
            />
          ))}
          {/* A nation is a list of boxes rather than a border, so its outline is a
            rectangle per area. The colour is also used for its label, which is
            how the game tells two nations apart on a plain map. A page about the
            regions draws the regions instead: same picture, other subject, and
            two sets of contours at once would just be a tangle. */}
          {regions ? (
            <AreaShapes
              areas={regions}
              zoom={view.zoom}
              pinned={pinnedRegion}
              hot={hotRegion}
              onHot={onHotRegion}
              onPick={onPickRegion}
            />
          ) : (
            showCountries && (
              <AreaShapes
                areas={projected.countries}
                zoom={view.zoom}
                hot={highlighted}
                onHot={setHighlighted}
              />
            )
          )}
          {/* Region overlays go above the titles: the boxes and the paths are
            what the page is about, and the labels are only orientation */}
          {projected.overlays.map((overlay) => (
            <RegionOverlay
              key={overlay.id}
              overlay={overlay}
              zoom={view.zoom}
              hotZone={hotZone}
              onHotZone={onHotZone}
              // A pan that ends over a marker must not also pin its zone, so the
              // press is dropped once the press has turned into a drag
              onPinZone={
                onPinZone &&
                ((zone) => {
                  if (!drag.current?.moved) onPinZone(zone);
                })
              }
              hotLeg={hotLeg}
              onHotLeg={onHotLeg}
              onPinLeg={
                onPinLeg &&
                ((leg) => {
                  if (!drag.current?.moved) onPinLeg(leg);
                })
              }
            />
          ))}
        </g>
      </g>
    </svg>
  );
}

/** Lists the terrains actually used, with the colour each was given */
function MapLegend({ map }: { map: WorldMap }) {
  const used = useMemo(() => {
    const counts = new Map<string, number>();
    for (const polygon of map.polygons) {
      const key = polygon.terrain ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [map]);

  if (!used.length) return null;

  return (
    <div className="world-map-legend">
      <div className="world-map-legend-title">
        <Tr text="xpediaMapLegend" />
      </div>
      <ul>
        {used.map(([name, count]) => {
          const label = (
            <>
              <Tr text={name || "xpediaMapUnknownLand"} />
            </>
          );
          const href = pageFor(name);
          return (
            <li key={name}>
              <span className="world-map-swatch" style={{ background: colorForTerrain(name) }} />
              {href ? <a href={href}>{label}</a> : label}
              <span className="world-map-count">{count}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Loads the world map once, for any page that draws one.
 *
 * The picture means reading a DAT file out of the database and building the
 * polygons from it, which is not free, so it is loaded on demand rather than
 * with the ruleset. Both the map article and the region and trajectory pages
 * draw the same picture, so they share this one loader.
 */
function useWorldMap() {
  const [map, setMap] = useState<WorldMap>();
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    // The territory colours are declared by the pack, so they have to be read
    // before the first polygon is coloured
    readDeclaredColors();
    readDeclaredCountryColors();
    loadWorldMap()
      .then((found) => {
        if (cancelled) return;
        setMap(found);
        setStatus(found ? "ready" : "missing");
      })
      .catch((e) => {
        console.warn("Can't load the world map", e);
        if (!cancelled) setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { map, status };
}

/**
 * The map article.
 *
 * It used to be a page of its own with its own title and pedia text; it now
 * closes the Countries page, below that page's table. The heading is kept so the
 * picture is still labelled where it stands, since the page's own title names
 * the countries rather than the map.
 */
export function WorldMapArticle() {
  const { map, status } = useWorldMap();

  if (status === "loading")
    return (
      <div className="world-map-status">
        <Tr text="xpediaMapLoading" />
      </div>
    );

  if (status === "missing" || !map)
    return (
      <div className="world-map-status">
        <Tr text="xpediaMapMissing" />
      </div>
    );

  return (
    <div className="world-map-block">
      <div className="world-map-title">
        <Tr text="xpediaWorldMap" />
      </div>
      <MapPicture map={map} />
      <MapLegend map={map} />
      {/* Land colour is chosen from the terrain name, not read from the game, so
        saying so keeps the illustration from looking like a screenshot */}
      <p className="world-map-note">
        <Tr text="xpediaMapNote" />
      </p>
    </div>
  );
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
  const shown = state.showCountryLabels;
  return (
    <label className="world-map-toggle">
      <input
        type="checkbox"
        checked={shown}
        onChange={() => update({ showCountryLabels: !shown })}
      />
      <Tr text="xpediaShowCountryLabels" />
    </label>
  );
}

/** The message shown instead of a picture when the pack has no geoscape data */
function NoMap() {
  return (
    <div className="world-map-status">
      <Tr text="xpediaMapMissing" />
    </div>
  );
}

/**
 * The map of the regions, at the head of the REGIONS section page.
 *
 * It is the picture the section is named for: every region that states `areas`
 * — the boxes the game tests "is this point in that region" against — drawn as
 * its own contour with its name inside it. The drawing is the nations' drawing
 * with a different subject, so the regions read the same way the nations do on
 * the Countries page, down to the title blinking the outline it names.
 *
 * It is not a replacement for the section's list. Most regions in the packs
 * checked state no `areas` at all — 39 of 54 in XFiles, 158 of 173 in X-Piratez —
 * because they exist only to weight missions and hold zones, so a map of the
 * areas alone would hide most of the pedia's region pages. The list stays, and
 * the map is a second way in.
 *
 * Pressing a region here does not follow its page: the press chooses the region
 * and pins its outline lit, so one region can be made out among the boxes that
 * overlap it. Following it is what the title link under the map, and the list
 * below, are for.
 */
export function RegionsMapArticle() {
  const { map, status } = useWorldMap();
  // The region under the pointer, which blinks while it is there
  const [hovered, setHovered] = useState<string>();
  // The region the reader pressed last, which keeps blinking after the pointer
  // has moved off. It is a remembered choice, so it survives leaving the page.
  const chosen = state.selection.regionsMap;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `rul` is a module value, listed only as the trigger.
  const regions = useMemo(() => projectRegions(Object.values(rul.regions ?? {})), [rul]);
  const pick = (id: string) => {
    setHovered(undefined);
    // `""` is "let the pinned region go", which `AreaShapes` sends when the
    // region already lit is pressed a second time
    rememberSelection("regionsMap", id || undefined);
  };

  if (status === "loading")
    return (
      <div className="world-map-status">
        <Tr text="xpediaMapLoading" />
      </div>
    );
  if (status === "missing" || !map) return <NoMap />;

  if (!regions.length)
    return (
      <p className="world-map-note">
        <Tr text="xpediaRegionsMapNone" />
      </p>
    );

  const missing = Object.keys(rul.regions ?? {}).length - regions.length;

  return (
    <div className="world-map-block regions-map">
      <MapPicture
        map={map}
        regions={regions}
        hotRegion={hovered}
        pinnedRegion={chosen}
        onHotRegion={setHovered}
        onPickRegion={pick}
      />
      {/* Every region the picture draws, as a link. The boxes are not links on this
        page — a press chooses rather than follows — so this list is what makes
        the drawn regions reachable without going through the section list below,
        which mixes them with the technical regions that are not on the map. */}
      <div className="world-map-legend">
        <div className="world-map-legend-title">
          <Tr text="xpediaRegionsMapLegend" />
        </div>
        <ul>
          {regions.map((area) => (
            <li key={area.id}>
              <span className="world-map-swatch" style={{ background: area.color }} />
              <a href={pageFor(area.id) ?? undefined}>{rul.tr(area.id)}</a>
            </li>
          ))}
        </ul>
      </div>
      {/* The regions with no `areas` are not on the picture and never can be: they
        have no place. Naming the count here is what keeps the map from reading as
        "these are all the regions there are". */}
      {missing > 0 && (
        <p className="world-map-note">
          <Tr text="xpediaRegionsMapNote" /> <Val of={missing} />{" "}
          <Tr text="xpediaRegionsMapNoAreas" />
        </p>
      )}
    </div>
  );
}

/**
 * The country minimap's floor, in map units.
 *
 * A window is never smaller than this, so a nation of one small box is not blown
 * up to fill the panel on its own: at 300 units the whole 2048-unit map is about
 * seven panels wide, which is enough context to see which coast is which.
 */
const MIN_WINDOW = 300;

/**
 * The part of the map a country's boxes occupy, with room around them.
 *
 * Cropped rather than showing the whole world: in the picture under a nation's
 * table the nation is the subject, and at full width it would be a few pixels.
 * The land and the borders around it stay in the window, so the crop still says
 * where in the world the place is.
 *
 * The window is kept between 0.9:1 and 2:1: a country that is mostly a long
 * strip — Chile, Norway — would otherwise produce a sliver with nothing but sea
 * above and below it.
 */
function countryWindow(areas: [number, number][][]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const box of areas)
    for (const [x, y] of box) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  if (!Number.isFinite(minX)) return;

  // Room around the boxes, proportional to them so a continent and an island
  // both keep the same reading distance
  const pad = Math.max(maxX - minX, maxY - minY) * 0.12 + 12;
  let x = minX - pad,
    y = minY - pad;
  let width = maxX - minX + pad * 2,
    height = maxY - minY + pad * 2;

  if (width / height > 2) {
    const want = width / 2;
    y -= (want - height) / 2;
    height = want;
  } else if (width / height < 0.9) {
    const want = height * 0.9;
    x -= (want - width) / 2;
    width = want;
  }

  if (width < MIN_WINDOW) {
    const scale = MIN_WINDOW / width;
    x -= (width * scale - width) / 2;
    y -= (height * scale - height) / 2;
    width *= scale;
    height *= scale;
  }

  return { x, y, width, height };
}

/**
 * A nation's boxes as the only subject of a small map.
 *
 * This is the Countries page's picture cropped to one nation, with none of that
 * page's machinery: no zoom, no pan, no hover, no labels. The whole block is a
 * single link back to the Countries page, which is where the nation can be read
 * against all the others — so the press has to mean one thing everywhere in the
 * picture rather than depending on where in it the pointer landed.
 *
 * It is drawn from `projectMap` like the big map, so the coastline, the borders
 * and the nation's own colour are the same drawing rather than a second one that
 * could drift.
 */
export function CountryMapArticle({ id }: { id: string }) {
  const { map, status } = useWorldMap();
  const projected = useMemo(() => map && projectMap(map), [map]);
  const country = projected?.countries.find((c) => c.id === id);

  if (status === "loading")
    return (
      <div className="world-map-status">
        <Tr text="xpediaMapLoading" />
      </div>
    );
  // A pack with a globe but no readable DAT still has a table, so the row is
  // filled with the reason the picture is absent rather than left blank
  if (status === "missing" || !projected || !country)
    return (
      <div className="world-map-status">
        <Tr text="xpediaMapMissing" />
      </div>
    );

  const window = countryWindow(country.areas);
  // A nation with no boxes has no place on the globe at all, which some packs
  // state for the technical ones
  if (!window) return null;

  const viewBox = `${window.x} ${window.y} ${window.width} ${window.height}`;
  // The Countries page is where a nation is read against the others; a pack
  // that states countries but no table page has none to follow
  const href = rul?.article("COUNTRIES") ? "##COUNTRIES" : undefined;

  const picture = (
    <svg
      className="world-map world-map-mini"
      viewBox={viewBox}
      // The picture's own shape, in the viewBox's units: the CSS keeps an SVG
      // square unless it is told otherwise, and a crop of Norway must not become
      // one
      style={{ aspectRatio: `${window.width} / ${window.height}` } as CSSProperties}
      role="img"
      aria-label={rul?.tr(id) ?? id}
    >
      {/* The name is in the panel above already, so it is a tooltip and a label
        rather than something written on the picture */}
      <title>{rul?.tr(id) ?? id}</title>
      {projected.polygons.map((polygon, i) => (
        <Repeated
          key={i}
          points={polygon.points}
          render={(points, shift) => (
            <polygon
              points={points}
              fill={polygon.color}
              transform={shift ? `translate(${shift} 0)` : undefined}
            />
          )}
        />
      ))}
      {projected.lines.map((line, i) => (
        <Repeated
          key={i}
          points={line}
          render={(points, shift) => (
            <polyline
              points={points}
              fill="none"
              transform={shift ? `translate(${shift} 0)` : undefined}
            />
          )}
        />
      ))}
      {country.areas.map((box, i) => (
        <Repeated
          key={`a${i}`}
          points={box}
          render={(points, shift) => (
            <polygon
              className="area-contour"
              points={points}
              style={{ "--area-color": country.color } as CSSProperties}
              transform={shift ? `translate(${shift} 0)` : undefined}
            />
          )}
        />
      ))}
    </svg>
  );

  if (!href) return <div className="world-map-mini-block">{picture}</div>;

  // The picture is the link. It wraps the whole block rather than each box
  // because a nation's boxes are one place: a press has to mean the same thing
  // wherever on the map it lands.
  return (
    <div className="world-map-mini-block">
      <a href={href} className="world-map-mini-link">
        {picture}
      </a>
    </div>
  );
}

/**
 * A region drawn on the world map, with the flight paths its missions use.
 *
 * Only what is true of the region itself is drawn: its outline (`areas`) and its
 * mission zones. Flights are *not* drawn here, and the reason is worth stating
 * because a picture of them looks plausible and is not.
 *
 * A trajectory is a list of zone indices, so it can only be drawn against a
 * region with enough zones for those indices to mean something. That test —
 * `UfoTrajectory.fits` — is structural and says nothing about whether any mission
 * flies the path there. In XFiles (XCF) forty-two paths pass it for North America
 * while the region's missions fly sixteen different ones, none of them among the
 * ones a picture would pick: `B0`-`B4` are alphabetically first, fit, and are
 * flown by no mission in the pack at all. A map with room for six of forty-two
 * was therefore drawing arbitrary lines and calling them this region's traffic.
 *
 * The paths are listed instead, as links to the pages that draw them, and those
 * pages draw one flight each over a region the reader picks there.
 */
export function RegionMapArticle({ region }: { region: Region }) {
  const { map, status } = useWorldMap();
  const [showAll, setShowAll] = useState(false);

  const overlays = useMemo(() => [regionOverlay(region)], [region]);
  // The flights the region's own missions send, rather than every path whose
  // zone indices happen to fit. See the comment above.
  const paths = useMemo(() => rul.flightsIn(region), [region]);

  // A region can host hundreds of missions and most of them are background: in
  // XFiles every weighted region is a candidate for any script that names no
  // region. The missions worth leading with are the ones few regions share,
  // because those are what the region is *for*; the rest are listed behind a
  // toggle rather than dropped, since "no, not here" is also an answer a reader
  // wants from this page.
  const missions = useMemo(() => rul.missionsIn(region), [region]);
  const allRegions = Object.keys(rul.regions ?? {}).length;
  const distinctive = missions.filter((m) => m.regionCount <= DISTINCT_REGION_COUNT);
  const shown = showAll ? missions : distinctive;
  const hidden = missions.length - shown.length;

  if (status === "loading")
    return (
      <div className="world-map-status">
        <Tr text="xpediaMapLoading" />
      </div>
    );
  if (status === "missing" || !map) return <NoMap />;

  return (
    <div className="world-map-block">
      <MapPicture map={map} overlays={overlays} showCountries={state.showCountryLabels} />
      <CountryLabelsToggle />
      <p className="world-map-note">
        <Tr text="xpediaRegionMapNote" />
      </p>
      {paths.length > 0 && (
        <div className="region-paths">
          <div className="world-map-legend-title">
            <Tr text="xpediaTrajectories" />
          </div>
          {/* A list of links rather than a picture: each path has its own page, and
          that page draws it where it can be drawn. The count beside a path is its
          number of waypoints, which is the one thing about a flight that can be
          said without choosing a region to read its zones against. */}
          <ul>
            {paths.map((path) => (
              <li key={path.uid}>
                <a href={pageFor(path.uid) ?? undefined}>{path.uid}</a>
                <span className="world-map-count">{(path.waypoints ?? []).length}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {missions.length > 0 ? (
        <div className="region-missions">
          <div className="world-map-legend-title">
            <Tr text="xpediaRegionMissions" />
          </div>
          {shown.length > 0 && (
            <ul>
              {shown.map((entry) => (
                <li key={entry.mission}>
                  <a href={pageFor(entry.mission) ?? undefined}>{entry.mission}</a>
                  {/* The count is the whole point of the list: "only here" reads very
                differently from "one of a hundred and seventy regions" */}
                  <span className="region-mission-count">
                    {entry.regionCount === 1 ? (
                      <Tr text="xpediaRegionOnlyHere" />
                    ) : (
                      <>
                        <Tr text="xpediaRegionAlsoIn" /> <Val of={entry.regionCount} />{" "}
                        <Tr text="xpediaRegionOfRegions" />
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {hidden > 0 && (
            <button type="button" className="region-missions-more" onClick={() => setShowAll(true)}>
              <Tr text="xpediaRegionMissionsMore" /> <Val of={hidden} />
            </button>
          )}
          <p className="world-map-note">
            <Tr text="xpediaRegionMissionsNote" /> <Val of={allRegions} />{" "}
            <Tr text={allRegions === 1 ? "xpediaRegionCountOne" : "xpediaRegionCount"} />
          </p>
        </div>
      ) : (
        <p className="world-map-note">
          <Tr text="xpediaRegionNoMissions" />
        </p>
      )}
    </div>
  );
}

/**
 * What the line drawing means: dash length is speed, thickness is altitude.
 *
 * Both are properties of a leg rather than of a stop, so they cannot be read off
 * the zone colours and need saying once in words. The sample lines are drawn
 * with the same functions the map uses, so the legend cannot drift away from the
 * picture it explains — including the fact that both are measured in map units.
 *
 * The samples are the map's own scale — a dash here is the same ten minutes of
 * flying it is on the map — so the picture is a slice of the drawing rather than
 * an icon of it. It is only 40 units wide, though: wide enough to show two dash
 * lengths side by side, narrow enough not to push the sentence it explains off
 * the row.
 */
function TrajectoryLegend() {
  return (
    <div className="trajectory-legend">
      <div className="trajectory-legend-item">
        <span className="trajectory-legend-sample">
          <svg viewBox="0 0 100 60" aria-hidden="true">
            <line
              x1="0"
              y1="15"
              x2="100"
              y2="15"
              className="region-leg"
              strokeWidth={legWidth(2)}
              strokeDasharray={legDash(100, 5000)}
            />
            <line
              x1="0"
              y1="34"
              x2="100"
              y2="34"
              className="region-leg"
              strokeWidth={legWidth(2)}
              strokeDasharray={legDash(25, 5000)}
            />
          </svg>
        </span>
        <span>
          <Tr text="xpediaTrajectoryDash" />
        </span>
      </div>
      <div className="trajectory-legend-item">
        <span className="trajectory-legend-sample">
          <svg viewBox="0 0 100 60" aria-hidden="true">
            <line
              x1="0"
              y1="15"
              x2="100"
              y2="15"
              className="region-leg"
              strokeWidth={legWidth(4)}
            />
            <line
              x1="0"
              y1="34"
              x2="100"
              y2="34"
              className="region-leg"
              strokeWidth={legWidth(0)}
            />
          </svg>
        </span>
        <span>
          <Tr text="xpediaTrajectoryThickness" />
        </span>
      </div>
      <div className="trajectory-legend-item">
        <span className="trajectory-legend-sample">
          <svg viewBox="0 0 100 60" aria-hidden="true">
            {stopMarker({ x: 32, y: 30 }, 16, true, "region-stop")}
            {stopMarker({ x: 68, y: 30 }, 16, false, "region-stop")}
          </svg>
        </span>
        <span>
          <Tr text="xpediaTrajectoryMarkers" />
        </span>
      </div>
      <div className="trajectory-legend-item">
        <span className="trajectory-legend-sample">
          <svg viewBox="0 0 100 60" aria-hidden="true">
            {/* The same two shapes the map draws for such a stop, at the same
              relative size: the ring is the whole of what the marker says */}
            <circle className="region-stop" cx={50} cy={30} r={12} />
            <circle className="trajectory-legend-ring" cx={50} cy={30} r={21} />
          </svg>
        </span>
        <span>
          <Tr text="xpediaTrajectoryAnywhereMark" />
        </span>
      </div>
    </div>
  );
}

/**
 * The alien missions that send a UFO along this path.
 *
 * A trajectory is only ever reached through a mission: nothing in the game flies
 * a path for its own sake, so the missions are the answer to "where does this
 * flight come from, and what does it carry". They are also the reason the page's
 * region list is what it is — a path's regions are the regions its missions can
 * pick — so naming them here explains the picker above.
 *
 * The list is every mission with a wave on this trajectory, which is what
 * `Ruleset.missionsFlying` counts. It can be long on a pack that spawns many
 * ground missions from one path (XFiles flies 230-odd missions on `CA_SPAWN`), so
 * it reads as a plain list of links that wraps, rather than as a table.
 *
 * An empty list is not an error: a pack may keep a path for a script that names
 * it directly, so the block says so rather than disappearing.
 */
function TrajectoryMissions({ trajectory }: { trajectory: UfoTrajectory }) {
  const missions = useMemo(() => rul.missionsFlying(trajectory.uid), [trajectory]);

  return (
    <div className="trajectory-missions">
      <div className="world-map-legend-title">
        <Tr text="xpediaTrajectoryMissions" />
      </div>
      {missions.length ? (
        <ul>
          {missions.map((id) => (
            <li key={id}>
              <a href={pageFor(id) ?? undefined}>{rul.tr(id)}</a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="world-map-note">
          <Tr text="xpediaTrajectoryNoMissions" />
        </p>
      )}
    </div>
  );
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
function FlightStrip({ stops, focus }: { stops: PathStop[]; focus?: TrajectoryFocus }) {
  const strip = useRef<HTMLDivElement>(null);

  // Pointing at a line on the map has to bring its sample into view, or the answer
  // "this is leg 60" is written off the right edge on a long flight. `nearest` is
  // the right mode: it scrolls only when the target is actually outside, so a
  // short flight's strip does not jump about, and it never moves the page itself.
  const hotLeg = focus?.hotLeg;
  useEffect(() => {
    if (hotLeg == null) return;
    const box = strip.current?.querySelector(".trajectory-flight-leg-hot");
    box?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [hotLeg]);

  return (
    <div className="trajectory-flight" ref={strip}>
      {stops.map((stop, i) => {
        // A leg is drawn before the stop it arrives at, and the first stop is the
        // spawn point, which nothing arrives at
        const arrives = i > 0 && !samePlace(stops[i - 1], stop);
        return (
          <Fragment key={i}>
            {arrives && (
              <button
                type="button"
                className={`trajectory-flight-leg${hotLeg === stop.leg ? " trajectory-flight-leg-hot" : ""}`}
                style={{ "--leg-color": legColor(stop.leg) } as CSSProperties}
                aria-pressed={focus?.pinnedLeg === stop.leg}
                // Named by the stop it reaches, because that is the number the stop list
                // and the picture use: the move into stop 3 is "the leg to stop 3", and a
                // separate count of legs would be a number nothing else on the page has.
                aria-label={`${rul.tr("xpediaLegToStop")} ${stop.leg + 1}`}
                onPointerEnter={focus && (() => focus.hoverLeg(stop.leg))}
                onPointerLeave={focus && (() => focus.hoverLeg())}
                // The press pins the leg for a touch screen, where the leave that
                // follows a press would otherwise undo it
                onClick={focus && (() => focus.pinLeg(stop.leg))}
              />
            )}
            <StopPlate zone={stop.zone} number={stop.leg + 1} lands={stop.lands} focus={focus} />
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * One flight path, drawn in a region it can actually fly in.
 *
 * The path is a set of zone indices, so it has no place of its own: a region has
 * to be named, and the regions shown are the ones the missions that fly this
 * path can pick, per `Ruleset.regionsFor`. When several qualify they are all
 * offered, because the pack itself does not say which one a given flight uses.
 *
 * The order is what a reader needs first: which region the picture is of, then
 * the flight itself as a list of stops, then the picture of where it happens, and
 * last what its lines mean.
 */
export function TrajectoryMapArticle({ trajectory }: { trajectory: UfoTrajectory }) {
  const focus = useTrajectoryFocus();
  const { map, status } = useWorldMap();

  const regions = useMemo(() => rul.regionsFor(trajectory), [trajectory]);
  // The region is a reading choice rather than a property of the flight: whoever
  // looked at a flight over one region will want the same region on the next
  // path. `remembered` is the whole rule — use the remembered region when this
  // flight can be flown in it, the first region offered otherwise, and never
  // write the memory back, so a flight with a narrow choice of regions does not
  // erase the broader choice made on another one.
  const region = remembered(regions, (r) => r.uid === state.selection.region, regions[0]);

  // The region's own outline (`areas`) is not drawn here. It answers "is this
  // point in this region", which the region page is about and this one is not:
  // the flight already names its region in the radio list above, so the boxes
  // were scenery laid over the zones and stops the page is actually showing.
  // Nothing is lost by it either — most regions in the shipped packs have one
  // box or none, and tftd's land regions have none at all.
  //
  // Set true to draw it again; `regionOverlay` takes the same switch and the
  // legend needs nothing new, since it never described those boxes.
  const REGION_OUTLINE = false;
  const overlays = useMemo(
    () => (region ? [regionOverlay(region, [trajectory], { outline: REGION_OUTLINE })] : []),
    [region, trajectory],
  );
  const shape = useMemo(
    () => (region ? pathShape(trajectory, region) : undefined),
    [region, trajectory],
  );
  // A radio choice changes the region, and a zone number means something else
  // there, so the highlight must not survive the switch
  // biome-ignore lint/correctness/useExhaustiveDependencies: `region` is the trigger; `reset` is a new function on every highlight change, so depending on it would reset on hover.
  useEffect(() => {
    focus?.reset();
  }, [region]);

  if (status === "loading")
    return (
      <div className="world-map-status">
        <Tr text="xpediaMapLoading" />
      </div>
    );
  if (status === "missing" || !map) return <NoMap />;

  // A path with no region to read its zones against cannot be drawn at all; the
  // article still lists its waypoints, so say why the picture is missing
  if (!region)
    return (
      <div className="world-map-status">
        <Tr text="xpediaTrajectoryNoRegion" />
      </div>
    );

  return (
    <div className="world-map-block">
      {/* A path flown by dozens of regions is usually the same flight in each, so
        the choice reads better as a short radio list than as a dropdown that
        hides how many there are */}
      <fieldset className="trajectory-region">
        <legend>
          <Tr text="xpediaChooseRegion" />
        </legend>
        {regions.map((r) => (
          <label key={r.uid} className="trajectory-region-choice">
            <input
              type="radio"
              name="trajectory-region"
              value={r.uid}
              checked={r.uid === region.uid}
              onChange={() => rememberSelection("region", r.uid)}
            />
            {rul.tr(r.uid)}
          </label>
        ))}
      </fieldset>
      {/* The flight in order, with the move between each pair of stops drawn in the
        leg's own colour. Pointing at a stop lights up every box of its zone, and
        pressing it pins that highlight; pointing at a leg's line lights that leg
        on the map, and the same works the other way round. It comes above the map
        because it says what the flight does, in order, before the picture shows
        where it happens. The asterisk carries the reading of it down to the
        footnotes, so the explanation does not take the place the flight itself
        should have. */}
      {shape && shape.stops.length > 0 && (
        <div className="trajectory-flight-foot">
          <FlightStrip stops={shape.stops} focus={focus} />
          <span className="trajectory-footnote-mark" aria-hidden="true">
            *
          </span>
        </div>
      )}
      <MapPicture
        map={map}
        overlays={overlays}
        showCountries={state.showCountryLabels}
        hotZone={focus?.hotZone}
        onHotZone={focus?.hoverZone}
        onPinZone={focus?.pinZone}
        hotLeg={focus?.hotLeg}
        onHotLeg={focus?.hoverLeg}
        onPinLeg={focus?.pinLeg}
      />
      <CountryLabelsToggle />
      <TrajectoryLegend />
      {/* The notes read as footnotes: small, after everything they explain, and the
        first one is the asterisk on the strip rather than a paragraph standing
        between the flight and its picture. */}
      <div className="trajectory-notes">
        {shape && shape.stops.length > 0 && (
          <p className="world-map-note">
            <span className="trajectory-footnote-mark">*</span>{" "}
            <Tr text="xpediaTrajectoryLegLabels" />
          </p>
        )}
        <p className="world-map-note">
          <Tr text="xpediaTrajectoryMapNote" />
        </p>
      </div>
      {/* Last, because it is the answer to "where does this flight come from":
        the missions that send a UFO along it. A path nobody flies any more is
        still a path a pack may be keeping for an event or a script, so an empty
        list is not an error and says so rather than leaving the block blank. */}
      <TrajectoryMissions trajectory={trajectory} />
    </div>
  );
}
