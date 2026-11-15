import { rul } from "../rul/Ruleset";
import type { UfoTrajectory } from "../rul/Entry";
import MainTable from "./MainTable";
import { Tr, Val } from "./Val";
import { formatSeconds } from "./timing";

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
 * One zone of a flight, as a place name when the pack gives one.
 *
 * A zone is an index into a region's `missionZones`, and most of those are
 * anonymous boxes that only mean anything against the map. Some are cities, and
 * those do have names worth printing — but a zone belongs to a region and the
 * same index is a different place in the next one, so a name is only shown when
 * every region this path can be flown in agrees on it.
 */
function zoneLabel(trajectory: UfoTrajectory, index: number) {
  let names = new Set<string>();
  for (let region of rul.regionsFor(trajectory)) {
    let zone = region.missionZones?.[index];
    if (!zone)
      continue;
    let named = (zone as any[]).map(area => area?.[5]).filter(name => name);
    if (named.length)
      names.add(String(named[0]));
  }
  return <>
    <Val of={index} />
    {names.size == 1 && <> <span className="trajectory-zone-name"><Val of={[...names][0]} /></span></>}
  </>;
}

/**
 * The legs, one row each.
 *
 * Leg numbers are what the map labels its drawn segments with, so a reader can
 * match a row to the line on the picture. A leg whose start and end are the same
 * zone still counts: the UFO waits there rather than moving, and that is the
 * behaviour the doubling bug produces.
 */
function LegTable({ trajectory }: { trajectory: UfoTrajectory }) {
  let legs = trajectory.legs;
  if (!legs.length)
    return <p className="trajectory-note"><Tr text="xpediaLegTooShort" /></p>;

  return <table className="main-table trajectory-legs">
    <thead>
      <tr className="table-header">
        <td><Tr text="xpediaLeg" /></td>
        <td><Tr text="xpediaLegFrom" /></td>
        <td><Tr text="xpediaLegTo" /></td>
        <td><Tr text="xpediaLegAltitude" /></td>
        <td><Tr text="xpediaLegSpeed" /></td>
        <td />
      </tr>
    </thead>
    <tbody>
      {legs.map(leg => <tr key={leg.index}>
        <td className="mission-wave-number"><Val of={leg.index} /></td>
        <td>{zoneLabel(trajectory, leg.from)}</td>
        <td>
          {zoneLabel(trajectory, leg.to)}
          {leg.from == leg.to && <div className="mission-note"><Tr text="xpediaLegRepeats" /></div>}
        </td>
        <td><Tr text={altitudeName(leg.altitude)} /></td>
        <td><Val of={leg.speed} /></td>
        <td>
          {leg.lands && <span className="mission-delay"><Tr text="xpediaLegLands" /></span>}
          {leg.index == 1 && <div className="mission-note"><Tr text="xpediaLegSpawns" /></div>}
          {leg.index == legs.length && <div className="mission-note"><Tr text="xpediaLegEnds" /></div>}
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
      {lines.map((line, i) => <tr key={i}>
        <td className="mission-wave-number"><Val of={i} /></td>
        <td>{zoneLabel(trajectory, Number(line?.[0]))}</td>
        <td><Tr text={altitudeName(line?.[1])} /></td>
        <td><Val of={line?.[2]} /></td>
      </tr>)}
    </tbody>
  </table>;
}

/** Ufo trajectory article: the legs the engine flies, and the lines it reads */
export default function TrajectoryComponent({ entry }: { entry: UfoTrajectory }) {
  let landing = entry.landingSeconds;
  let groundedStart = Number(entry.waypoints?.[0]?.[1]) === 0;

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
        <tr><td colSpan={2} className="table-subheader"><Val of="xpediaLegs" /></td></tr>
        <tr><td colSpan={2}><LegTable trajectory={entry} /></td></tr>
        <tr><td colSpan={2} className="table-subheader"><Val of="xpediaLines" /></td></tr>
        <tr><td colSpan={2}>
          <LineTable trajectory={entry} />
          <p className="trajectory-note"><Tr text="xpediaLegNote" /></p>
        </td></tr>
      </>,
    }}
  />;
}
