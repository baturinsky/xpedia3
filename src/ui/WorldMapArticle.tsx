import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { loadWorldMap, ORIGIN, type MapRectangle, type WorldMap } from "../worldmap";
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
function projectMap(map: WorldMap) {
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

  return { polygons, lines, countries };
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

function MapPicture({ map }: { map: WorldMap }) {
  let projected = useMemo(() => projectMap(map), [map]);
  let svgRef = useRef<SVGSVGElement>(null);
  let [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  let [panning, setPanning] = useState(false);
  // Which nation's title the pointer is over, so its outline can stand out
  let [highlighted, setHighlighted] = useState<string>();
  // Whether the current press has turned into a drag, shared with the click
  // handler that has to ignore the click a drag ends with
  let drag = useRef<{ moved: boolean }>();

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
            through `Tr`, which renders a `<span>` */}
        {projected.countries.map((country, i) => {
          if (!country.label)
            return null;
          let text = <text x={country.label.x} y={country.label.y} textAnchor="middle"
            style={{
              "--country-color": country.color,
              // Labels keep their reading size as the map is magnified, so the
              // sizes in viewBox units are divided back out
              fontSize: `${36 / view.zoom}px`,
              strokeWidth: `${6 / view.zoom}px`
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
