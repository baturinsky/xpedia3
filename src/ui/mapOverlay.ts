import type { MapArea, Region, UfoTrajectory } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
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
 * How far a zone reaches, in degrees: `[longitude, latitude]`.
 *
 * A zone is a set of boxes, and every one of them is a place the game may pick.
 * So a zone spread over most of the globe does not have a centre in any useful
 * sense: the mean of a polar cap and a patch of the Sahara is a point neither of
 * them contains.
 */
function zoneSpan(zone: MapArea[]): [number, number] {
  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  for (let area of zone) {
    if (!area || area.length < 4)
      continue;
    minLon = Math.min(minLon, Number(area[0]));
    maxLon = Math.max(maxLon, Number(area[1]));
    minLat = Math.min(minLat, Number(area[2]));
    maxLat = Math.max(maxLat, Number(area[3]));
  }
  return [maxLon - minLon, maxLat - minLat];
}

/**
 * The centre of a zone, or nothing when the zone has no meaningful centre.
 *
 * Longitudes are averaged as vectors, since a zone near the seam has boxes at
 * both ends of 0..360 and a plain mean would land it in the middle of the map.
 * A zone that reaches across the world, though — the "a UFO may appear
 * anywhere" zones are exactly that — is refused: a single dot would name a spot
 * the game will never use.
 */
export function zoneCenter(zone: MapArea[]): { lon: number, lat: number } | undefined {
  let boxes = zone.filter(area => area && area.length >= 4);
  if (!boxes.length)
    return;
  let [, latSpan] = zoneSpan(boxes);
  // A polar ring legitimately spans every longitude but only a narrow band of
  // latitude, and its centre is the pole, which is a fair summary of it. A zone
  // reaching from pole to pole, though, is the "a UFO may appear anywhere" zone
  // the packs use for spawning and for single-stop patrols: it has no centre, so
  // a dot would name a spot the game never picks.
  if (latSpan >= 170)
    return;
  let x = 0, y = 0, lat = 0;
  for (let area of boxes) {
    let lon = (Number(area[0]) + Number(area[1])) / 2 * Math.PI / 180;
    x += Math.cos(lon);
    y += Math.sin(lon);
    lat += (Number(area[2]) + Number(area[3])) / 2;
  }
  let deg = Math.atan2(y, x) * 180 / Math.PI;
  return {
    lon: ((deg % 360) + 360) % 360,
    lat: lat / boxes.length
  };
}

/**
 * What a trajectory looks like drawn in one region.
 *
 * `points` is the flight line. `dropped` counts the waypoints that could not be
 * placed, which happens when a waypoint names a zone the game treats as
 * "anywhere": those have no centre, so the line skips them instead of inventing
 * a spot. A page says so rather than showing a path that silently lost stops.
 */
export type PathShape = {
  points: { lon: number, lat: number }[];
  /** Waypoints that name a zone with no meaningful centre */
  dropped: number;
  /** Waypoints whose zone index the region does not have at all */
  missing: number;
};

/** The centres of the zones a path visits, in flight order */
export function pathShape(trajectory: UfoTrajectory, region: Region): PathShape {
  let zones = region.missionZones ?? [];
  let shape: PathShape = { points: [], dropped: 0, missing: 0 };
  for (let waypoint of trajectory.waypoints ?? []) {
    let zone = zones[Number(waypoint?.[0])];
    if (!zone) {
      shape.missing++;
      continue;
    }
    let center = zoneCenter(zone);
    if (!center) {
      shape.dropped++;
      continue;
    }
    shape.points.push(center);
  }
  return shape;
}

/** A trajectory drawn in one region, or nothing when it has no line to draw */
export function trajectoryPath(trajectory: UfoTrajectory, region: Region): OverlayPath | undefined {
  let shape = pathShape(trajectory, region);
  return shape.points.length > 1
    ? { id: trajectory.id, points: shape.points, dropped: shape.dropped }
    : undefined;
}

/**
 * A region's overlay: its site boxes, its zone boxes, and the given paths.
 *
 * `paths` is passed in rather than derived, because which flights to draw is a
 * presentation choice: a region page wants the flights of its missions, a
 * trajectory page wants just the one.
 */
export function regionOverlay(region: Region, paths: UfoTrajectory[] = []): Overlay {
  return {
    id: region.id,
    color: regionColor(region.id),
    areas: region.areas,
    zones: region.missionZones,
    paths: paths
      .map(path => trajectoryPath(path, region))
      .filter((path): path is OverlayPath => path != null)
  };
}

/**
 * How many flights a region page draws at once.
 *
 * A region can host every trajectory in the pack (43 in one Piratez region), and
 * that many overlapping lines is a plate of spaghetti rather than a picture. The
 * list below the map still names all of them.
 */
export const MAX_DRAWN_PATHS = 6;

/** One colour per region, so the overlay reads as a highlight over the land */
export function regionColor(id?: string) {
  if (!id)
    return undefined;
  let hash = 0;
  for (let i = 0; i < id.length; i++)
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  let hue = Math.abs(hash) % 360;
  return `hsl(${hue} 85% 62%)`;
}
