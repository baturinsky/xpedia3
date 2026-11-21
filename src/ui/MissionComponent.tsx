import type { UfoTrajectory } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import MainTable, { type MainTableRenderer } from "./MainTable";
import { parseRaceWeights, raceWeightPercent } from "./raceWeights";
import { formatDelay, formatSeconds, waveDelay } from "./timing";
import { Tr, Val } from "./Val";

/**
 * An alien mission: the plan behind a UFO flight.
 *
 * The raw table is nearly unreadable here, because almost nothing in it is a
 * plain value. A wave is a UFO, a count, a path and a delay, and the delay is a
 * number the engine halves and rolls against — so `timer: 9000` means "somewhere
 * between 3 and 9 days" and says nothing at all to a reader who does not know
 * that. This component draws the same data as a wave table with the story
 * spelled out, and keeps the raw numbers visible for anyone who wants them.
 */

/**
 * Names of the engine's `MissionObjective` values, indexed by number.
 *
 * The mission's `objective` decides everything it does after its last wave, so
 * it is the field a reader most needs in words; a bare `3` explains nothing.
 * `0` is both the default and the "just fly around" objective, so a mission
 * that states nothing is a score mission.
 */
const objectives = [
  "xpediaObjective0",
  "xpediaObjective1",
  "xpediaObjective2",
  "xpediaObjective3",
  "xpediaObjective4",
  "xpediaObjective5",
  "xpediaObjective6",
];

/**
 * One wave of an alien mission, straight from the ruleset.
 *
 * A wave is a UFO, a count, a path and the gap before it; the flags below are
 * how the wave carries out the mission once it arrives. All optional, since a
 * pack states only what it needs and the engine fills in the rest.
 */
export type MissionWave = {
  /** A UFO id, or an `alienDeployments` id for a wave that creates a site */
  ufo?: string;
  count?: number;
  /** `ufoTrajectories` id */
  trajectory?: string;
  /** Minutes before this wave arrives, which the engine halves and rolls */
  timer?: number;
  /** This wave carries out the mission's objective */
  objective?: boolean;
  objectiveOnTheLandingSite?: boolean;
  objectiveOnXcomBase?: boolean;
  escort?: boolean;
  hunterKillerPercentage?: number;
  interruptPercentage?: number;
};

/**
 * The wave fields of an alien mission.
 *
 * `waves` is a list of `MissionWave`s. The rest of the entry is whatever the
 * ruleset states, so the index signature keeps the type honest.
 */
export type AlienMission = { waves?: MissionWave[]; [field: string]: unknown };

/** The label for an objective number, or nothing when the pack states none */
export function objectiveName(value: unknown) {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return objectives[n] ?? "xpediaObjectiveUnknown";
}

/**
 * The wait a wave's `timer` really produces, as the wave table prints it.
 *
 * A zero delay is the engine's "next tick", not a very short wait, so it reads
 * as "at once" rather than as a number.
 */
function delayText(timer: unknown) {
  const delay = waveDelay(timer);
  if (!delay) return null;
  return formatDelay(delay) ?? <Tr text="xpediaAtOnce" />;
}

/**
 * How long a UFO stays down at a path's ground waypoint, or nothing when the
 * path never lands. See `UfoTrajectory.landingSeconds`.
 */
export function groundSeconds(path?: UfoTrajectory) {
  return path?.landingSeconds;
}

/**
 * The wave's UFO, which may be a site deployment instead of a flying craft.
 *
 * A wave's `ufo` is not always a UFO: a deployment id means the wave creates a
 * site without any craft, and an id that exists nowhere is the documented way to
 * ask for one built from the region's texture. Both look identical in the raw
 * table, and both are worth saying out loud.
 */
function waveUfo(wave: MissionWave) {
  const id = wave?.ufo;
  if (!id) return null;
  if (rul.ufos?.[id]) return <Val of={id} />;
  if (rul.alienDeployments?.[id])
    return (
      <>
        <Val of={id} />
        <div className="mission-note">
          <Tr text="xpediaWaveSite" />
        </div>
      </>
    );
  return (
    <>
      <span className="mission-dangling">
        <Val of={id} />
      </span>
      <div className="mission-note">
        <Tr text="xpediaWaveNoUfo" />
      </div>
    </>
  );
}

/**
 * The flags a wave sets, as short notes under its landing column.
 *
 * These are the fields a player can actually feel: which wave carries out the
 * mission's objective, whether the site follows the craft down, whether the
 * craft hunts, and the chance that shooting it down ends the whole mission.
 */
function waveNotes(wave: MissionWave) {
  const notes: { key: string; text?: string; percent?: number }[] = [];
  if (wave?.objective) notes.push({ key: "objective", text: "xpediaWaveObjective" });
  if (wave?.objectiveOnTheLandingSite)
    notes.push({ key: "landing", text: "xpediaWaveLandingSite" });
  if (wave?.objectiveOnXcomBase) notes.push({ key: "xcomBase", text: "xpediaWaveXcomBase" });
  if (wave?.escort) notes.push({ key: "escort", text: "xpediaWaveEscort" });
  if (Number(wave?.hunterKillerPercentage) > 0)
    notes.push({
      key: "hk",
      text: "xpediaWaveHunter",
      percent: Number(wave.hunterKillerPercentage),
    });
  if (Number(wave?.interruptPercentage) > 0)
    notes.push({
      key: "interrupt",
      text: "xpediaWaveInterrupt",
      percent: Number(wave.interruptPercentage),
    });
  return notes;
}

/**
 * The waves, one row each.
 *
 * A wave's `timer` is the gap *before* it, which is the number a player cares
 * about: the wave table reads as a schedule, so the delay belongs to the row it
 * delays rather than to the mission as a whole. Its headers are ordinary
 * `data-table` headers like the map-block tables — left-aligned
 * `th`, content-width columns — rather than the large centred `table-header`
 * row other tables use for a title.
 */
function WaveTable({ waves }: { waves: MissionWave[] }) {
  if (!waves.length) return null;
  return (
    <table className="main-table data-table mission-waves">
      <thead>
        <tr>
          <th scope="col">
            <Tr text="xpediaWave" />
          </th>
          <th scope="col">
            <Tr text="ufo" />
          </th>
          <th scope="col">
            <Tr text="count" />
          </th>
          <th scope="col">
            <Tr text="trajectory" />
          </th>
          <th scope="col">
            <Tr text="timer" />
          </th>
          <th scope="col">
            <Tr text="xpediaWaveGround" />
          </th>
        </tr>
      </thead>
      <tbody>
        {waves.map((wave, i) => {
          const grounded = wave?.trajectory
            ? groundSeconds(rul.ufoTrajectories?.[wave.trajectory])
            : undefined;
          const notes = waveNotes(wave);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a wave is identified by its number, the position the row prints; waves carry no id
            <tr key={i}>
              <td className="mission-wave-number">
                <Val of={i + 1} />
              </td>
              <td>{waveUfo(wave)}</td>
              <td>
                <Val of={wave?.count} />
              </td>
              <td>{wave?.trajectory ? <Val of={wave.trajectory} /> : null}</td>
              <td>
                <span className="mission-delay">{delayText(wave?.timer)}</span>
                {wave?.timer != null && (
                  <div className="mission-raw">
                    <Val of={wave.timer} />
                  </div>
                )}
              </td>
              <td>
                {grounded == null ? (
                  <Tr text="xpediaLegNeverLands" />
                ) : (
                  <>
                    <Tr text="xpediaLegLandsFor" />{" "}
                    <span className="mission-delay">{formatSeconds(grounded)}</span>
                  </>
                )}
                {notes.length > 0 && (
                  <div className="mission-notes">
                    {notes.map((note) => (
                      <div key={note.key} className="mission-note">
                        <Tr text={note.text} />
                        {note.percent != null && (
                          <>
                            {" "}
                            <em className="num">{note.percent}%</em>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RaceWeights({ value }: { value: unknown }) {
  const { months, races } = parseRaceWeights(value);
  if (months.length === 0) {
    return (
      <div className="mission-note">
        <Tr text="xpediaRaceWeightsEmpty" />
      </div>
    );
  }
  return (
    <table className="main-table data-table mission-raceweights">
      <thead>
        <tr>
          <th scope="col">
            <Tr text="xpediaRaceMonth" />
          </th>
          {races.map((race) => (
            <th scope="col" key={race}>
              <Val of={race} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {months.map((row, i) => {
          const next = months[i + 1]?.month;
          const start = row.month + 1;
          const end = next != null ? next : null;
          return (
            <tr key={row.month}>
              <td className="mission-race-month">
                <em className="num">{start}</em>
                {end != null ? (
                  <>
                    {"–"}
                    <em className="num">{end}</em>
                  </>
                ) : (
                  <>
                    {" "}
                    <Tr text="xpediaRaceOnwards" />
                  </>
                )}
              </td>
              {races.map((race) => {
                const weight = row.weights.get(race);
                if (weight == null) return <td key={race}>—</td>;
                const pct = raceWeightPercent(weight, row.total);
                return (
                  <td key={race}>
                    {/* `Val` renders a number without its postfix, so the per
                        cent sign is plain text after it */}
                    <Val of={pct} />%
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const asRaceWeights: MainTableRenderer = ({ val }) => <RaceWeights value={val} />;

/** Alien mission table: the fields, with the waves drawn as a schedule */
export default function MissionComponent({ entry }: { entry: AlienMission }) {
  const waves: MissionWave[] = entry.waves ?? [];

  return (
    <MainTable
      of={entry}
      title="ALIEN_MISSIONS"
      sort={{ last: ["waves"], exclude: ["id"] }}
      special={{ raceWeights: asRaceWeights }}
      rows={{
        objective: ({ val }) => {
          const name = objectiveName(val);
          // A pack that states no objective is running the default score mission,
          // which is worth saying rather than leaving an empty row
          return (
            <tr>
              <td className="row-name">
                <Val of="objective" capital={true} />
              </td>
              <td>
                <Val of={name ?? "xpediaObjective0"} />
                {name && val != null && (
                  <span className="mission-raw">
                    {" "}
                    (<Val of={val} />)
                  </span>
                )}
              </td>
            </tr>
          );
        },
        // `points` is shared with research and manufacture, where the tooltip the
        // shared label carries ("score for completing this project") is right. On
        // a mission it is the score the aliens gain, so the row states that itself
        // rather than borrowing a tooltip that describes something else.
        points: ({ val }) =>
          val == null ? null : (
            <tr>
              <td className="row-name">
                <Tr text="points" capital={true} notip={true} />
              </td>
              <td>
                <Val of={val} />
                <div className="mission-note">
                  <Tr text="xpediaMissionPoints" />
                </div>
              </td>
            </tr>
          ),
        // `spawnZone` is an index into the region's own `missionZones` list:
        // the site or alien base this mission creates goes in that zone's
        // boxes, not anywhere in the whole region. The raw number alone says
        // nothing to a reader — the note says which part of the region it
        // means, and points at the region map where the zones are drawn.
        spawnZone: ({ val }) =>
          val == null ? null : (
            <tr>
              <td className="row-name">
                <Val of="spawnZone" capital={true} />
              </td>
              <td>
                <Val of={val} />
                <div className="mission-note">
                  <Tr text="xpediaSpawnZoneNote" />
                </div>
              </td>
            </tr>
          ),
        waves: () => (
          <>
            <tr>
              <td colSpan={2} className="table-subheader">
                <Val of="waves" />
              </td>
            </tr>
            <tr>
              <td colSpan={2}>
                <WaveTable waves={waves} />
              </td>
            </tr>
          </>
        ),
      }}
    />
  );
}
