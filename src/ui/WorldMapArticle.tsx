import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { loadWorldMap, ORIGIN, type MapRectangle, type WorldMap } from "../worldmap";
import type { MapArea, Region, UfoTrajectory } from "../rul/Entry";
import { MAX_DRAWN_PATHS, drawnLegs, pathShape, regionOverlay, type PathStop } from "./mapOverlay";
import { formatSeconds } from "./timing";
import { colorForCountry, colorForTerrain, readDeclaredColors, readDeclaredCountryColors } from "./mapColors";
import { rul } from "../rul/Ruleset";
import { Tr } from "./Val";

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
 * its stops the same way the leg table does. `dropped` counts the stops of the
 * trajectory that could not be placed: a stop names a mission zone, and a zone
 * the game treats as "anywhere" has no centre. The line joins the stops that do
 * have a place, and the count lets the page say that some were left out.
 */
export type OverlayPath = {
  id: string;
  stops: PathStop[];
  dropped?: number;
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

/** The screen position of a globe point */
export const pointFor = (lon: number, lat: number) =>
  ({ x: wrapColumn(lon), y: rowForLat(lat) });

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

/** One shape, repeated either side of the map so the seam is filled */
function Repeated(props: { points: [number, number][], render: (points: string, shift: number) => any }) {
  let serialized = props.points.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return <>{[-1, 0, 1].map(shift => props.render(serialized, shift * WIDTH))}</>;
}

/**
 * A region's map data: its boxes, its zone boxes, and any paths drawn in it.
 *
 * A flight path is a polyline through zone centres with a dot at each stop,
 * because the stops *are* zones: the game picks a random point inside the zone,
 * so the centre is the honest answer for a still picture. Arrows mark the
 * direction, since a path read backwards describes a different flight, and every
 * drawn segment is numbered with the leg it stands for — which is how the picture
 * and the article's leg table are read together. A stop where the UFO lands gets
 * a ring, because that is where its cargo can be found on the ground.
 */
function RegionOverlay({ overlay }: { overlay: ReturnType<typeof projectOverlay> }) {
  let color = overlay.color ?? "#ffd24a";
  let style = { "--region-color": color } as any;
  // A marker cannot pick up the colour of the line that uses it: its contents
  // inherit down the document tree from where the `marker` itself is declared,
  // not from the shape referencing it. So each overlay carries its own arrow,
  // declared inside the group that sets `--region-color`.
  let arrow = "region-arrow-" + overlay.id.replace(/[^\w-]/g, "_");
  let arrowHref = `url(#${arrow})`;

  return <g className={"region-overlay" + (overlay.hot ? " region-hot" : "")} style={style}>
    <marker id={arrow} viewBox="0 0 10 10" refX="8" refY="5"
      markerWidth="7" markerHeight="7" orient="auto-start-reverse"
      markerUnits="userSpaceOnUse">
      <path className="region-arrowhead" d="M 0 0 L 10 5 L 0 10 z" />
    </marker>

    {overlay.boxes.map((box, i) => <Repeated key={"a" + i} points={box}
      render={(points, shift) => <polygon className="region-area" points={points}
        transform={shift ? `translate(${shift} 0)` : undefined} />} />)}

    {overlay.zoneBoxes.map((zone, i) => zone.map((box, j) => overlay.zoneDots[i]
      ? <Repeated key={"z" + i + "_" + j} points={box}
        render={(points, shift) => <circle className="region-zone-point"
          cx={box[0][0]} cy={box[0][1]} r={5}
          transform={shift ? `translate(${shift} 0)` : undefined} />} />
      : <Repeated key={"z" + i + "_" + j} points={box}
        render={(points, shift) => <polygon className="region-zone" points={points}
          transform={shift ? `translate(${shift} 0)` : undefined} />} />))}

    {overlay.paths.map(path => {
      // Each path is drawn three times like every other shape, so a flight that
      // crosses the seam stays in one piece
      let at = path.stops.map(stop => pointFor(stop.point.lon, stop.point.lat));
      let serialized = at.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      // The numbers a reader sees are the leg numbers of the leg table, so the
      // drawn line and the table can be read together. A leg between two stops
      // in the same zone is the UFO waiting rather than moving: it has no line of
      // its own, so it is not labelled either, and the table says "waits".
      //
      // Only a single flight is labelled. A region page draws every path its
      // missions use, and six overlapping lines with numbers on each are
      // unreadable rather than informative.
      let labelled: { x: number, y: number, text: string }[] = [];
      if (overlay.paths.length == 1)
        for (let i = 1; i < at.length; i++) {
          let [a, b] = [at[i - 1], at[i]];
          if (a.x == b.x && a.y == b.y)
            continue;
          let length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          // Nudge the label off the stroke, in the direction perpendicular to it
          let off = 14;
          // A stop that could not be placed collapses several legs into one
          // stroke, which is then labelled with the range it stands for
          let [first, last] = [path.stops[i - 1].leg + 1, path.stops[i].leg];
          labelled.push({
            x: (a.x + b.x) / 2 - (b.y - a.y) / length * off,
            y: (a.y + b.y) / 2 + (b.x - a.x) / length * off,
            text: first == last ? String(first) : `${first}–${last}`,
          });
        }
      return [-1, 0, 1].map(shift => {
        return <g key={path.id + shift} className="region-path"
          transform={shift ? `translate(${shift} 0)` : undefined}>
          {/* A marker so the line is a proper arrow per segment, not one
              direction for the whole flight */}
          <polyline points={serialized} markerMid={arrowHref} />
          {labelled.map((label, i) => <text key={"leg" + i} className="region-leg-label"
            x={label.x} y={label.y} textAnchor="middle" dominantBaseline="central">
            {label.text}
          </text>)}
          {/* The stops are marks, not labels: their numbers are on the stretches
              between them, and a loiter would otherwise stack two numbers on one
              dot. A ring marks the stop where the UFO lands. */}
          {path.stops.map((stop, i) => <circle key={i}
            className={stop.lands ? "region-waypoint region-waypoint-land" : "region-waypoint"}
            cx={at[i].x} cy={at[i].y} r={9} />)}
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

function MapPicture({ map, overlays }: { map: WorldMap, overlays?: Overlay[] }) {
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
        {projected.countries.map(country => country.areas.map((area, i) => <Repeated key={country.id + i} points={area}
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
        {projected.countries.map((country, i) => {
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
        {projected.overlays.map(overlay => <RegionOverlay key={overlay.id} overlay={overlay} />)}
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

  let paths = useMemo(() => rul.trajectoriesFor(region).slice(0, MAX_DRAWN_PATHS), [region]);
  let overlays = useMemo(() => [regionOverlay(region, paths)], [region, paths]);
  // The list names every flight the region's missions send, and a flight whose
  // waypoints all name "anywhere" zones has no line to draw, so say which ones
  // the map leaves out rather than leaving a gap in the picture unexplained
  let shapes = useMemo(() => new Map(paths.map(path => [path.id, pathShape(path, region)])), [paths, region]);
  let undrawn = paths.filter(path => drawnLegs(shapes.get(path.id)!) == 0);

  if (status == "loading")
    return <div className="world-map-status"><Tr text="xpediaMapLoading" /></div>;
  if (status == "missing" || !map)
    return <NoMap />;

  return <div className="world-map-block">
    <MapPicture map={map} overlays={overlays} />
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
  let [chosen, setChosen] = useState<string>(regions[0]?.id ?? "");
  let region = regions.find(r => r.id == chosen) ?? regions[0];

  let overlays = useMemo(() =>
    region ? [regionOverlay(region, [trajectory])] : [], [region, trajectory]);
  // A zone the game treats as "anywhere" has no place to point at, so the line
  // skips it. Saying how many were skipped is better than a path that quietly
  // lost stops, and it explains an empty map for a path like `P9`, whose every
  // waypoint is such a zone.
  let shape = useMemo(() => region ? pathShape(trajectory, region) : undefined, [region, trajectory]);
  let landing = trajectory.landingSeconds;

  if (status == "loading")
    return <div className="world-map-status"><Tr text="xpediaMapLoading" /></div>;
  if (status == "missing" || !map)
    return <NoMap />;

  // A path with no region to read its zones against cannot be drawn at all; the
  // article still lists its waypoints, so say why the picture is missing
  if (!region)
    return <div className="world-map-status"><Tr text="xpediaTrajectoryNoRegion" /></div>;

  return <div className="world-map-block">
    <MapPicture map={map} overlays={overlays} />
    <div className="trajectory-region">
      <label>
        <Tr text="xpediaTrajectoryRegion" />{" "}
        <select value={region.id} onChange={e => setChosen(e.target.value)}>
          {regions.map(r => <option key={r.id} value={r.id}>{rul.tr(r.id)}</option>)}
        </select>
      </label>
      <span className="trajectory-region-count">
        {regions.length} <Tr text={regions.length == 1 ? "xpediaTrajectoryRegionOne" : "xpediaTrajectoryRegions"} />
      </span>
    </div>
    {/* The numbers on the picture are leg numbers, so say so and say what they
        are not: they are not stops of a list of waypoints */}
    {shape && shape.stops.length > 0 && <p className="world-map-note">
      <Tr text="xpediaTrajectoryLegLabels" />
      {landing != null && <>{" "}<Tr text="xpediaTrajectoryLandsFor" />{" "}
        <span className="mission-delay">{formatSeconds(landing)}</span>.</>}
    </p>}
    {shape && (drawnLegs(shape) == 0 || shape.dropped > 0) && <p className="world-map-unplaced">
      {drawnLegs(shape) == 0
        ? <Tr text="xpediaTrajectoryAnywhereOnly" />
        : <>
          <span className="world-map-count">{shape.dropped}</span>{" "}
          <Tr text="xpediaTrajectoryAnywhere" />
        </>}
    </p>}
    <p className="world-map-note"><Tr text="xpediaTrajectoryMapNote" /></p>
  </div>;
}

