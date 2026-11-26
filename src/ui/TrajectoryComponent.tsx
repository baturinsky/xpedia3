import type { CSSProperties } from "react";
import { useState } from "react";
import type { UfoTrajectory } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import MainTable from "./MainTable";
import { legDash, legWidth } from "./mapMarks";
import { legColor, pathSpeeds, zoneColor } from "./mapOverlay";
import { StopPlate } from "./StopPlate";
import { formatSeconds } from "./timing";
import { type TrajectoryFocus, useTrajectoryFocus } from "./trajectoryFocus";
import { Tr, Val } from "./Val";

/**
 * A UFO flight path: a list of zones, altitudes and speeds.
 *
 * The ruleset form is close to unreadable, because a line does not keep one
 * meaning down the list. Numbering from 1: the stops are `z1, z2, z2, z3, … zN`,
 * and leg *m* is flown at line *m*'s altitude and speed — except leg 1, which
 * heads for line 2's zone. So line 1's zone is only ever the spawn point, line
 * 2's is visited twice, and N lines fly N legs.
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
const altitudes = ["xpediaGround", "xpediaVeryLow", "xpediaLow", "xpediaHigh", "xpediaVeryHigh"];

/** The label for an altitude number, or the number itself when it is not one */
export function altitudeName(value: unknown) {
  const n = Number(value);
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
  const regions = rul.regionsFor(trajectory).filter((region) => region.missionZones?.[index]);
  if (!regions.length) return null;

  let agreed: string[] | undefined;
  for (const region of regions) {
    const zone = region.missionZones?.[index];
    if (!zone) continue;
    // An unnamed area makes this a rectangle rather than a set of places, and a
    // rectangle only means something against the map
    const names = zone.map((area) => area?.[5]).filter((name) => name);
    if (names.length !== zone.length) return null;
    const places = [...new Set(names.map(String))].sort();
    if (!agreed) agreed = places;
    // The regions this path can be flown in send it to different cities, so no
    // one of them can be named
    else if (agreed.join("|") !== places.join("|")) return null;
  }
  if (!agreed?.length) return null;

  if (agreed.length === 1)
    return (
      <span className="trajectory-zone-name">
        <Val of={agreed[0]} />
      </span>
    );
  return (
    <span className="trajectory-zone-name">
      <Tr text="xpediaZoneOneOf" /> <Val of={agreed.length} /> <Tr text="xpediaZoneCities" />
    </span>
  );
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
 * The numbers are stop numbers, which are the numbers on the picture, so a row
 * can be found on the map. The table has no header: its two columns are a stop
 * mark and a sentence about it, and "Stop" over the first of them only repeated
 * what the numbers already say. The mark is `StopPlate`, the very element the
 * strip above the map draws, so a stop looks the same in both places.
 */

/** The width of the leg column's drawing, and the viewBox a leg is drawn in */
const MARK_WIDTH = 14;
const MARK_VIEW = 40;

/**
 * One stop of the plan, as the strip above the map draws it: a number inside the
 * shape that says whether the UFO is on the ground.
 *
 * This used to be the map's raw marker with the number printed beside it, which
 * read as two facts in two columns — a coloured blob, then a number. The strip
 * above the map says the same thing in one mark, so the plan says it the same way
 * and the same `StopPlate` draws both.
 */
function PlanStop({
  zone,
  stops,
  lands,
  focus,
}: {
  zone: number;
  /** The stop number, as the map and the strip label it */
  stops: number;
  lands: boolean;
  focus?: TrajectoryFocus;
}) {
  return (
    <StopPlate
      zone={zone}
      number={stops}
      lands={lands}
      focus={focus}
      className="trajectory-plan-plate"
    />
  );
}

/**
 * The move between two stops, as a line drawn exactly as the map draws it, only
 * turned upright.
 *
 * Length is speed and thickness is altitude on both, from the map's own
 * `legDash` and `legWidth`, in the map's own units — so a leg that looks like one
 * long dash on the map is one long dash here too, and a leg flown high is thin in
 * both places. The line is vertical because the table reads downwards: a
 * horizontal line in a table column would be a row rule, not a move.
 *
 * The halo, the wide invisible pointer target and the blink are the map's as
 * well, so pointing at this line lights the same leg on the picture, and pointing
 * at the picture lights it here.
 */
function PlanLeg({
  leg,
  focus,
}: {
  /** The leg, as `planLeg` describes it for this row */
  leg: { index: number; altitude: number; speed: number; dash?: string };
  focus?: TrajectoryFocus;
}) {
  const x = MARK_VIEW / 2;
  return (
    <svg
      className="trajectory-plan-line"
      viewBox={`0 0 ${MARK_VIEW} 100`}
      preserveAspectRatio="xMidYMid meet"
      width={MARK_WIDTH}
      aria-hidden="true"
    >
      <g
        className={
          "region-leg-group" +
          (focus ? " region-leg-live" : "") +
          (focus?.hotLeg === leg.index ? " region-leg-hot" : "")
        }
        style={{ "--leg-color": legColor(leg.index) } as CSSProperties}
        onPointerEnter={focus && (() => focus.hoverLeg(leg.index))}
        onPointerLeave={focus && (() => focus.hoverLeg())}
        onPointerUp={focus && (() => focus.pinLeg(leg.index))}
      >
        {focus && <line className="region-leg-hit" x1={x} y1={0} x2={x} y2={100} />}
        {focus?.hotLeg === leg.index && (
          <line className="region-leg-halo" x1={x} y1={0} x2={x} y2={100} />
        )}
        <line
          className="region-leg"
          x1={x}
          y1={0}
          x2={x}
          y2={100}
          strokeWidth={legWidth(leg.altitude)}
          strokeDasharray={leg.dash}
        />
      </g>
    </svg>
  );
}

function FlightPlan({ trajectory, focus }: { trajectory: UfoTrajectory; focus?: TrajectoryFocus }) {
  const steps = trajectory.flightSteps;
  const legs = trajectory.legs;
  // A path of fewer than two lines is not flown: it is the standard way to have a
  // mission appear on the ground with no UFO at all, so there is no flight to
  // draw and the caller leaves this table out rather than explaining an error
  if (!legs.length) return null;

  // A path can be flown by several craft, and a leg's speed is a percentage of
  // its craft's top speed. The knots are only printable when the craft is known.
  const speeds = pathSpeeds(trajectory);
  // The map draws a leg's dash from one craft speed; the mean is what one line
  // can show when a path is flown by several
  const craftKnots = speeds ? (speeds.min + speeds.max) / 2 : undefined;
  // How long a stay on the ground lasts, in seconds. The engine counts
  // `groundTimer` down five seconds at a time, which is why the field itself is
  // never printed: see `UfoTrajectory.landingSeconds`.
  const landing = trajectory.landingSeconds;
  const last = steps[steps.length - 1];

  return (
    <table className="main-table trajectory-plan region-overlay region-path">
      <tbody>
        {steps.map((step) =>
          step.kind === "stop" ? (
            <tr
              key={`s${step.stop.index}`}
              className="trajectory-plan-stop"
              style={{ "--zone-color": zoneColor(step.stop.zone) } as CSSProperties}
            >
              <td className="trajectory-plan-what">
                {/* The number sits inside the shape, as it does in the strip above
                the map: the shape is whether the UFO is on the ground, the
                number is which stop of the flight this is. The plan lists one row
                per stop, so a place reached twice appears twice, each row
                carrying its own number. */}
                <PlanStop
                  zone={step.stop.zone}
                  stops={step.stop.index + 1}
                  lands={step.stop.lands}
                  focus={focus}
                />
              </td>
              <td>
                {zonePlace(trajectory, step.stop.zone)}
                {/* What the UFO is doing *here* is the one thing a line of a ruleset
                cannot say, so it is spelled out rather than left to a flag. It is
                set at full size because it is the content of the row, not a
                footnote to it; `.mission-note` elsewhere is a supporting remark
                and stays small. */}
                <div className="trajectory-plan-what-happens">
                  {step.stop.index === 0 ? (
                    <Tr text={step.stop.lands ? "xpediaStopSpawnsGrounded" : "xpediaStopSpawns"} />
                  ) : step.stop.lands ? (
                    landing != null ? (
                      // The stay is the landing's own fact, so it is said in the same
                      // breath: "lands here for 13 h" rather than "lands here" and
                      // then a second sentence beginning with the same verb.
                      <>
                        <Tr text="xpediaStopLandsFor" />{" "}
                        <span className="mission-delay">{formatSeconds(landing)}</span>
                      </>
                    ) : (
                      <Tr text="xpediaStopLands" />
                    )
                  ) : step.stop.arrival?.from === step.stop.zone ? (
                    <Tr text="xpediaStopMovesWithin" />
                  ) : (
                    <Tr text="xpediaStopArrives" />
                  )}
                  {/* Reaching the last line destroys the UFO, so that is where the
                  flight ends — on the stop it reaches, not on the leg leaving the
                  one before. */}
                  {step === last && (
                    <div className="mission-note">
                      <Tr text="xpediaLegEnds" />
                    </div>
                  )}
                </div>
              </td>
            </tr>
          ) : (
            <tr
              key={`l${step.leg.index}`}
              className="trajectory-plan-leg"
              style={{ "--leg-color": legColor(step.leg.index) } as CSSProperties}
            >
              {/* A leg carries no number: it is not a place, nothing else on the page
              refers to a leg by number, and the only number that would fit here
              is the stop it is flying to, which the row above already prints.
              Its colour is its own — see `legColor`. */}
              <td className="trajectory-plan-what">
                <PlanLeg
                  leg={{
                    index: step.leg.index,
                    altitude: step.leg.altitude,
                    speed: step.leg.speed,
                    dash: legDash(step.leg.speed, craftKnots),
                  }}
                  focus={focus}
                />
              </td>
              <td>
                <span className="trajectory-plan-flight">
                  <Tr text="xpediaLegFlies" />
                </span>{" "}
                <Tr text={altitudeName(step.leg.altitude)} />
                {", "}
                <Val of={step.leg.speed} />% <Tr text="xpediaLegSpeedOfMax" />
                {speeds && (
                  <>
                    {" "}
                    ≈{" "}
                    <em className="num">
                      {Math.round((speeds.min * step.leg.speed) / 100)}–
                      {Math.round((speeds.max * step.leg.speed) / 100)}
                    </em>{" "}
                    <Tr text="xpediaKnots" />
                  </>
                )}
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

/**
 * The declared `[zone, altitude, speed]` lines, in the ruleset's own order.
 *
 * This table exists for comparing against a rul file, so it prints the fields as
 * the file writes them. It deliberately does not try to label them as flight
 * moves: a line's third field set belongs to the leg leaving it, its altitude
 * lands the UFO one line earlier, and line 1 is a spawn state rather than a
 * destination. `FlightPlan` above is the decoded answer; this is the source text.
 */
function LineTable({ trajectory }: { trajectory: UfoTrajectory }) {
  const lines = trajectory.waypoints ?? [];
  if (!lines.length) return null;
  return (
    <table className="main-table trajectory-lines">
      <thead>
        <tr className="table-header">
          <td>
            <Tr text="xpediaLine" />
          </td>
          <td>
            <Tr text="xpediaLegZone" />
          </td>
          <td>
            <Tr text="xpediaLegAltitude" />
          </td>
          <td>
            <Tr text="xpediaLegSpeed" />
          </td>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, i) => {
          const zone = Number(line?.[0]);
          const place = zonePlace(trajectory, zone);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a line is identified by its number, the position the row prints; lines are ruleset text and can repeat verbatim
            <tr key={i}>
              <td className="mission-wave-number">
                <Val of={i} />
              </td>
              <td>
                {/* This table is the ruleset's own text, so the zone is printed as the
                file writes it, as a number. The place is only a decode of it. */}
                <Val of={zone} />
                {place && <> {place}</>}
              </td>
              <td>
                <Tr text={altitudeName(line?.[1])} />
              </td>
              <td>
                <Val of={line?.[2]} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Ufo trajectory article: the legs the engine flies, and the lines it reads */
export default function TrajectoryComponent({ entry }: { entry: UfoTrajectory }) {
  /**
   * The declared lines are the ruleset's own text rather than the flight it
   * describes: a line is a destination, except line 1, which is where the UFO
   * appears, and the engine re-targets line 2. They are kept, but behind a
   * toggle, because the flight plan above is the answer to "what does this path
   * do" and this is only useful to someone comparing against a rul file.
   */
  const [showLines, setShowLines] = useState(false);
  // The stop and leg highlight is shared with the map, so pointing at a row's
  // marker lights the same stop on the picture and the other way round
  const focus = useTrajectoryFocus();
  // A path of one line is not a flight: it is the pack's way of having a mission
  // appear on the ground with no UFO, so there is nothing to draw and no error to
  // report. The declared lines, if the pack wrote any, are still worth printing.
  const flies = entry.legs.length > 0;
  // No early return: a path of one line is still an article — the
  // `waypoints` rows below render the "no flight" note for it.
  return (
    <div className="trajectory-table">
      <MainTable
        of={entry}
        title="UFO_TRAJECTORIES"
        sort={{ last: ["waypoints"], exclude: ["groundTimer"] }}
        rows={{
          // The flight plan leads, because it is what the page is about; the
          // declared lines and the raw timer fields follow it. Several rows,
          // so `rows` rather than `wide`.
          waypoints: () => (
            <>
              {flies && (
                <tr>
                  <td colSpan={2}>
                    <FlightPlan trajectory={entry} focus={focus} />
                  </td>
                </tr>
              )}
              {!flies && (
                <tr>
                  <td colSpan={2}>
                    <p className="trajectory-note">
                      <Tr text="xpediaNoFlight" />
                    </p>
                  </td>
                </tr>
              )}
              <tr>
                <td colSpan={2}>
                  <button
                    type="button"
                    className="btn-hover-effect btn-hover-effect--effect-1 trajectory-lines-toggle"
                    aria-expanded={showLines}
                    onClick={() => setShowLines(!showLines)}
                  >
                    <Tr text={showLines ? "xpediaLinesHide" : "xpediaLinesShow"} />
                  </button>
                </td>
              </tr>
              {showLines && (
                <>
                  <tr>
                    <td colSpan={2} className="table-subheader">
                      <Val of="xpediaLines" />
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={2}>
                      <LineTable trajectory={entry} />
                      {flies && (
                        <p className="trajectory-note">
                          <Tr text="xpediaLegNote" />
                        </p>
                      )}
                      <p className="trajectory-note">
                        <Tr text="xpediaLinesNote" />
                      </p>
                    </td>
                  </tr>
                </>
              )}
            </>
          ),
        }}
      />
    </div>
  );
}
