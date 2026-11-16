import { useState } from "react";
import { rul } from "../rul/Ruleset";
import type { UfoTrajectory } from "../rul/Entry";
import MainTable from "./MainTable";
import { Tr, Val } from "./Val";
import { formatSeconds } from "./timing";
import { legColor, pathSpeeds, zoneColor } from "./mapOverlay";

/**
 * A UFO flight path: a list of zones, altitudes and speeds.
 *
 * The ruleset form of this is close to unreadable, because a line is not a stop
 * but a destination: `[5, 4, 100]` means "be in zone 5, then fly to zone 0 at
 * very high altitude and full speed". Two further details make the raw table
 * actively misleading — the second line is re-targeted once, so N lines are N
 * legs, and a leg flies at the previous line's altitude rather than its own.
 *
 * This component draws the legs the engine really flies (`UfoTrajectory.legs`),
 * and keeps the declared lines underneath for anyone comparing against a rul
 * file.
 */

/**
 * The engine's `Ufo::ALTITUDE_STRING` values, as this pedia names them.
 *
 * The keys spell the altitude out — `xpediaVeryLow: VL` — rather than being
 * numbered, because a translator has to see *what* is being named: `Altitude1`
 * says nothing about where in the range it sits, and these names are a ladder.
 * The order is the engine's own index, so a value past the end of the list has
 * no name and is printed as the number it is.
 */
const altitudes = [
  "xpediaGround",
  "xpediaVeryLow",
  "xpediaLow",
  "xpediaHigh",
  "xpediaVeryHigh",
];

/** The label for an altitude number, or the number itself when it is not one */
export function altitudeName(value: any) {
  let n = Number(value);
  return altitudes[n] ?? String(value ?? "");
}

/**
 * Where a stop is, as a place when the pack names one.
 *
 * A waypoint's zone is an index into a region's `missionZones`, which is a list
 * of areas on the globe. That index is a position in that list and nothing more:
 * nothing else in the pedia prints it, and the same index means a different place
 * in the next region, so a bare number there told a reader nothing.
 *
 * Two things can be said instead, and only two:
 *
 * - A zone made of named point areas is a set of cities. When every region this
 *   path can be flown in has the same set, the stop is at one of them — say what
 *   they are, and say how many, because the game picks which.
 * - Every other zone is a rectangle (or a group of them) with no name at all, so
 *   there is nothing to print. The colour on the row ties the stop to its boxes
 *   on the map, which is the only place such a zone can be shown.
 *
 * Only a zone that *is* one named place gets that name, and the test is on the
 * whole zone: the older version printed the first city of a 58-city zone and read
 * as if the stop were there, which was simply wrong.
 */
function zonePlace(trajectory: UfoTrajectory, index: number) {
  let regions = rul.regionsFor(trajectory)
    .filter(region => region.missionZones?.[index]);
  if (!regions.length)
    return null;

  let agreed: string[] | undefined;
  for (let region of regions) {
    let zone = region.missionZones![index];
    // An unnamed area makes this a rectangle rather than a set of places, and a
    // rectangle only means something against the map
    let names = (zone as any[]).map(area => area?.[5]).filter(name => name);
    if (names.length != zone.length)
      return null;
    let places = [...new Set(names.map(String))].sort();
    if (!agreed)
      agreed = places;
    // The regions this path can be flown in send it to different cities, so no
    // one of them can be named
    else if (agreed.join("|") != places.join("|"))
      return null;
  }
  if (!agreed?.length)
    return null;

  if (agreed.length == 1)
    return <span className="trajectory-zone-name"><Val of={agreed[0]} /></span>;
  return <span className="trajectory-zone-name">
    <Tr text="xpediaZoneOneOf" />{" "}<Val of={agreed.length} />{" "}<Tr text="xpediaZoneCities" />
  </span>;
}

/**
 * The flight, as a stop, the move away from it, the next stop, and so on.
 *
 * A ruleset lists lines, and a line is a destination, so a plain table of lines
 * cannot show what a UFO *does*: which stop it lands at, where it waits, where it
 * starts. Reading `UfoTrajectory.flightSteps` instead gives the two things a
 * reader wants on alternating rows — the places in order, and the move between
 * each pair — without the same fact appearing twice.
 *
 * The numbers are stop numbers, which are the numbers on the picture and the
 * numbers the zone colour chips use, so a row can be found on the map.
 */
function FlightPlan({ trajectory }: { trajectory: UfoTrajectory }) {
  let steps = trajectory.flightSteps;
  let legs = trajectory.legs;
  if (!legs.length)
    return <p className="trajectory-note"><Tr text="xpediaLegTooShort" /></p>;

  // A path can be flown by several craft, and a leg's speed is a percentage of
  // its craft's top speed. The knots are only printable when the craft is known.
  let speeds = pathSpeeds(trajectory);

  return <table className="main-table trajectory-plan">
    <thead>
      <tr className="table-header">
        <td><Tr text="xpediaStop" /></td>
        <td className="trajectory-plan-detail"><Tr text="xpediaPlanDetail" /></td>
      </tr>
    </thead>
    <tbody>
      {steps.map((step, i) => step.kind == "stop"
        ? <tr key={"s" + i} className="trajectory-plan-stop"
          style={{ "--zone-color": zoneColor(step.stop.zone) } as any}>
          <td className="trajectory-plan-what">
            <span className="trajectory-zone-swatch" />
            <span className="trajectory-plan-number"><Val of={step.stop.index + 1} /></span>
          </td>
          <td>
            {zonePlace(trajectory, step.stop.zone)}
            {/* What the UFO is doing *here* is the one thing a line of a ruleset
                cannot say, so it is spelled out rather than left to a flag. It is
                set at full size because it is the content of the row, not a
                footnote to it; `.mission-note` elsewhere is a supporting remark
                and stays small. */}
            <div className="trajectory-plan-what-happens">
              {step.stop.index == 0
                ? <Tr text={step.stop.lands ? "xpediaStopSpawnsGrounded" : "xpediaStopSpawns"} />
                : step.stop.lands
                  ? <Tr text="xpediaStopLands" />
                  : step.stop.arrival?.from == step.stop.zone
                    ? <Tr text="xpediaStopMovesWithin" />
                    : <Tr text="xpediaStopArrives" />}
            </div>
          </td>
        </tr>
        : <tr key={"l" + i} className="trajectory-plan-leg"
          style={{ "--zone-color": legColor(step.leg.index) } as any}>
          {/* A leg carries no number: it is not a place, nothing else on the page
              refers to a leg by number, and the only number that would fit here
              is the stop it is flying to, which the row above already prints.
              Its colour is its own — see `legColor`. */}
          <td className="trajectory-plan-what">
            <span className="trajectory-plan-dashes" />
          </td>
          <td>
            <span className="trajectory-plan-flight"><Tr text="xpediaLegFlies" /></span>{" "}
            <Tr text={altitudeName(step.leg.altitude)} />
            {", "}
            <Val of={step.leg.speed} />%{" "}
            <Tr text="xpediaLegSpeedOfMax" />
            {speeds && <> ≈ <em className="num">
              {Math.round(speeds.min * step.leg.speed / 100)}–{Math.round(speeds.max * step.leg.speed / 100)}
            </em>{" "}<Tr text="xpediaKnots" /></>}
            {step.leg.index == legs.length && <div className="mission-note">
              <Tr text="xpediaLegEnds" />
            </div>}
          </td>
        </tr>)}
    </tbody>
  </table>;
}

/** The declared `[zone, altitude, speed]` lines, in the ruleset's own order */
function LineTable({ trajectory }: { trajectory: UfoTrajectory }) {
  let lines = trajectory.waypoints ?? [];
  if (!lines.length)
    return null;
  return <table className="main-table trajectory-lines">
    <thead>
      <tr className="table-header">
        <td><Tr text="xpediaLine" /></td>
        <td><Tr text="xpediaLegTo" /></td>
        <td><Tr text="xpediaLegAltitude" /></td>
        <td><Tr text="xpediaLegSpeed" /></td>
      </tr>
    </thead>
    <tbody>
      {lines.map((line, i) => {
        let zone = Number(line?.[0]);
        let place = zonePlace(trajectory, zone);
        return <tr key={i}>
          <td className="mission-wave-number"><Val of={i} /></td>
          <td>
            {/* This table is the ruleset's own text, so the zone is printed as the
                file writes it, as a number. The place is only a decode of it. */}
            <Val of={zone} />
            {place && <>{" "}{place}</>}
          </td>
          <td><Tr text={altitudeName(line?.[1])} /></td>
          <td><Val of={line?.[2]} /></td>
        </tr>;
      })}
    </tbody>
  </table>;
}

/** Ufo trajectory article: the legs the engine flies, and the lines it reads */
export default function TrajectoryComponent({ entry }: { entry: UfoTrajectory }) {
  let landing = entry.landingSeconds;
  let groundedStart = Number(entry.waypoints?.[0]?.[1]) === 0;
  // The declared lines are the ruleset's own text rather than the flight it
  // describes: a line is a destination, not a stop, and the engine re-targets
  // one of them, so reading them as a schedule misleads. They are kept, but
  // behind a toggle, because the flight plan above is the answer to "what does
  // this path do" and this is only useful to someone comparing against a rul file.
  let [showLines, setShowLines] = useState(false);

  return <MainTable
    of={entry}
    title="UFO_TRAJECTORIES"
    sort={{ last: ["waypoints"], exclude: ["id"] }}
    rows={{
      // The landing time is the one number on this page a player plans around,
      // and `groundTimer` is not it: the field is ticks of five seconds
      groundTimer: () => <tr>
        <td className="row-name"><Val of="groundTimer" capital={true} /></td>
        <td>
          {landing == null
            ? <Tr text="xpediaLegNeverLands" />
            : <>
              <Tr text="xpediaLegLandsFor" />{" "}
              <span className="mission-delay">{formatSeconds(landing)}</span>
              <div className="mission-raw"><Val of={entry.groundTimer} /></div>
              {groundedStart && <div className="mission-note"><Tr text="xpediaLegSpawnsGrounded" /></div>}
            </>}
        </td>
      </tr>,
      waypoints: () => <>
        <tr><td colSpan={2} className="table-subheader"><Val of="xpediaFlightPlan" /></td></tr>
        <tr><td colSpan={2}><FlightPlan trajectory={entry} /></td></tr>
        <tr><td colSpan={2}>
          <button type="button"
            className="btn-hover-effect btn-hover-effect--effect-1 trajectory-lines-toggle"
            aria-expanded={showLines}
            onClick={() => setShowLines(!showLines)}>
            <Tr text={showLines ? "xpediaLinesHide" : "xpediaLinesShow"} />
          </button>
        </td></tr>
        {showLines && <>
          <tr><td colSpan={2} className="table-subheader"><Val of="xpediaLines" /></td></tr>
          <tr><td colSpan={2}>
            <LineTable trajectory={entry} />
            <p className="trajectory-note"><Tr text="xpediaLegNote" /></p>
            <p className="trajectory-note"><Tr text="xpediaLinesNote" /></p>
          </td></tr>
        </>}
      </>,
    }}
  />;
}
