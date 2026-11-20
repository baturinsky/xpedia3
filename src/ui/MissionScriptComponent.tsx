import type { MissionScript } from "../rul/Entry";
import MainTable, { type MainTableRenderer } from "./MainTable";
import { calendarMonth, monthWindow, researchGate, runLimit, scriptDelay } from "./schedule";
import { formatDelay, formatMinutes } from "./timing";
import { Tr, Val } from "./Val";

/**
 * A mission script: the scheduler that decides whether an alien mission happens
 * at all this month.
 *
 * The raw table is the most misleading in the pedia, because every timing field
 * is a number that means something else. `firstMonth: 0` is not January and
 * `lastMonth: 0` does not mean the script stops in month 0: it means the game runs
 * it once, at the founding of the first base. `startDelay: 30` with `randomDelay:
 * 43500` is not "half an hour" but "sometime between now and a month from now".
 * This component says what the engine does and keeps the pack's own numbers
 * beside the answer.
 */

/** The month window as a sentence, or nothing when the script never stops */
function MonthRow({ entry }: { entry: MissionScript }) {
  const window = monthWindow(entry);
  const first = calendarMonth(window.first);
  const last = calendarMonth(window.last);

  // A month of nothing but the founding run is a special case: the whole
  // schedule is that single event, so naming a month would be wrong
  if (window.single && last == null)
    return (
      <tr>
        <td className="row-name">
          <Tr text="xpediaScriptMonths" capital={true} />
        </td>
        <td>
          <Tr text="xpediaScriptFoundingOnly" />
          <div className="mission-note">
            <Tr text="xpediaScriptOnce" />
          </div>
        </td>
      </tr>
    );

  // A window open from the campaign's own start is simply "every month", which
  // is more useful than "from month 1 onwards"
  if (window.open && window.first <= 1)
    return (
      <tr>
        <td className="row-name">
          <Tr text="xpediaScriptMonths" capital={true} />
        </td>
        <td>
          <Tr text="xpediaScriptAnyMonth" />
        </td>
      </tr>
    );

  return (
    <tr>
      <td className="row-name">
        <Tr text="xpediaScriptMonths" capital={true} />
      </td>
      <td>
        {window.open ? (
          <>
            <Tr text="xpediaScriptFromMonth" /> <em className="num">{first}</em>{" "}
            <Tr text="xpediaScriptOnwards" />
          </>
        ) : window.single ? (
          <>
            <Tr text="xpediaScriptInMonth" /> <em className="num">{last}</em>
          </>
        ) : // The founding run can be either end of a window, and it is not a month
        // number, so the sentence has to carry it as a phrase rather than as a
        // value: "from the founding of the first base until month 7".
        first == null ? (
          <>
            <Tr text="xpediaScriptUntilMonth" /> <em className="num">{last}</em>{" "}
            <Tr text="xpediaScriptCountingStart" />
          </>
        ) : (
          <>
            <Tr text="xpediaScriptFromMonth" /> <em className="num">{first}</em>{" "}
            {last == null ? (
              <Tr text="xpediaScriptToFounding" />
            ) : (
              <>
                <Tr text="xpediaScriptUntilMonth" /> <em className="num">{last}</em>
              </>
            )}
          </>
        )}
        {window.single && (
          <div className="mission-note">
            <Tr text="xpediaScriptOnce" />
          </div>
        )}
      </td>
    </tr>
  );
}

/** The delay before the first wave, and what a delay of zero really means */
function DelayRow({ entry }: { entry: MissionScript }) {
  const delay = scriptDelay(entry);
  if (entry?.startDelay == null && entry?.randomDelay == null) return null;

  const text = delay.delegates ? (
    <Tr text="xpediaScriptNoDelay" />
  ) : (
    <span className="mission-delay">
      {formatDelay({ min: delay.min, max: delay.max }) ?? formatMinutes(delay.min)}
    </span>
  );

  // A fixed delay and a rolled one are different promises: only the rolled one
  // can land anywhere in a range, so only it gets the "rolled from this range"
  // wording
  const note = delay.delegates
    ? "xpediaScriptNoDelayNote"
    : delay.min === delay.max
      ? "xpediaScriptFixedDelayNote"
      : "xpediaScriptDelayNote";

  return (
    <tr>
      <td className="row-name">
        <Tr text="xpediaScriptDelay" capital={true} />
      </td>
      <td>
        {text}
        <div className="mission-note">
          <Tr text={note} />
        </div>
        {(entry?.startDelay != null || Number(entry?.randomDelay) > 0) && (
          <div className="mission-raw">
            <Val of={entry.startDelay ?? 0} />{" "}
            {Number(entry?.randomDelay) > 0 && (
              <>
                + <Val of={entry.randomDelay} />
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

/** How often the script is even offered the chance to run */
function OddsRow({ entry }: { entry: MissionScript }) {
  if (entry?.executionOdds == null || Number(entry.executionOdds) === 100) return null;
  return (
    <tr>
      <td className="row-name">
        <Tr text="xpediaScriptOdds" capital={true} />
      </td>
      <td>
        <em className="num">{Number(entry.executionOdds)}%</em>
        <div className="mission-note">
          <Tr text="xpediaScriptOddsNote" />
        </div>
      </td>
    </tr>
  );
}

/** The run cap, which counts created missions rather than months */
function RunsRow({ entry }: { entry: MissionScript }) {
  const limit = runLimit(entry);
  if (!limit.limited) return null;
  return (
    <tr>
      <td className="row-name">
        <Tr text="maxRuns" capital={true} />
      </td>
      <td>
        <Val of={limit.maxRuns} />
        <div className="mission-note">
          <Tr text="xpediaScriptMaxRuns" />
        </div>
      </td>
    </tr>
  );
}

/**
 * The research gate.
 *
 * A topic that must *not* be researched is as much a condition as one that must
 * be, and it is the half a reader is most likely to miss, so the two are listed
 * separately rather than merged into one list of ids.
 */
function ResearchRow({ entry }: { entry: MissionScript }) {
  const gate = researchGate(entry);
  if (!gate) return null;
  return (
    <tr>
      <td className="row-name">
        <Tr text="researchTriggers" capital={true} />
      </td>
      <td>
        {gate.needed.length > 0 && (
          <div>
            <Tr text="xpediaScriptNeeds" />{" "}
            {gate.needed.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <Val of={id} />
              </span>
            ))}
          </div>
        )}
        {gate.forbidden.length > 0 && (
          <div>
            <Tr text="xpediaScriptWithout" />{" "}
            {gate.forbidden.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <Val of={id} />
              </span>
            ))}
          </div>
        )}
        <div className="mission-note">
          <Tr text="xpediaScriptResearchNote" />
        </div>
      </td>
    </tr>
  );
}

/**
 * The other world-state gates, as one row.
 *
 * These are all `map<string, bool>` in the ruleset and all mean "the world must
 * look like this", so their wording belongs together: a pack that lists three of
 * them would otherwise produce three near-identical notes.
 */
function TriggerRows({ entry }: { entry: MissionScript }) {
  const groups: { key: string; field: string }[] = [
    { key: "xpediaScriptItems", field: "itemTriggers" },
    { key: "xpediaScriptFacilities", field: "facilityTriggers" },
    { key: "xpediaScriptBaseFunctions", field: "baseFunctionTriggers" },
    { key: "xpediaScriptSoldierTypes", field: "soldierTypeTriggers" },
    { key: "xpediaScriptBaseRegions", field: "xcomBaseInRegionTriggers" },
    { key: "xpediaScriptBaseCountries", field: "xcomBaseInCountryTriggers" },
    { key: "xpediaScriptPactCountries", field: "pactCountryTriggers" },
  ];
  const rows = groups.filter((group) => {
    const found = entry?.[group.field];
    return found != null && typeof found === "object" && Object.keys(found).length > 0;
  });
  if (!rows.length) return null;
  return (
    <tr>
      <td className="row-name">
        <Tr text="xpediaScriptWorld" capital={true} />
      </td>
      <td>
        {rows.map((group) => {
          const wanted = entry[group.field];
          return (
            <div key={group.field}>
              <Tr text={group.key} />{" "}
              {Object.entries(wanted as { [id: string]: unknown }).map(([id, value], i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <Val of={id} />
                  {value === false && (
                    <>
                      {" "}
                      (<Tr text="xpediaScriptAbsent" />)
                    </>
                  )}
                </span>
              ))}
            </div>
          );
        })}
        <div className="mission-note">
          <Tr text="xpediaScriptWorldNote" />
        </div>
      </td>
    </tr>
  );
}

/** The score, funds and difficulty windows the script is limited by */
function LimitsRow({ entry }: { entry: MissionScript }) {
  const parts: { key: string; field: string; format: (v: unknown) => unknown }[] = [
    { key: "xpediaScriptMinScore", field: "minScore", format: (v) => v },
    { key: "xpediaScriptMaxScore", field: "maxScore", format: (v) => v },
    { key: "xpediaScriptMinFunds", field: "minFunds", format: (v) => v },
    { key: "xpediaScriptMaxFunds", field: "maxFunds", format: (v) => v },
    { key: "xpediaScriptMinDifficulty", field: "minDifficulty", format: (v) => v },
    { key: "xpediaScriptMaxDifficulty", field: "maxDifficulty", format: (v) => v },
  ];
  // The engine's defaults cover every score, every budget and every difficulty,
  // so only a stated limit is worth a line
  const stated = parts.filter((part) => entry?.[part.field] != null);
  if (!stated.length) return null;
  return (
    <tr>
      <td className="row-name">
        <Tr text="xpediaScriptLimits" capital={true} />
      </td>
      <td>
        {stated.map((part) => (
          <div key={part.field}>
            <Tr text={part.key} /> <Val of={part.format(entry[part.field])} />
          </div>
        ))}
        <div className="mission-note">
          <Tr text="xpediaScriptLimitsNote" />
        </div>
      </td>
    </tr>
  );
}

/**
 * The mission table row: `useTable` decides whether a mission this script creates
 * is struck off the region's table until every region has been drained.
 */
function TableRow({ entry }: { entry: MissionScript }) {
  if (entry?.useTable !== false) return null;
  return (
    <tr>
      {/* The pack's own label already ends in a question mark, so the tooltip
        marker would double it; the note below says the same thing. */}
      <td className="row-name">
        <Tr text="useTable" notip={true} />
      </td>
      <td>
        <Tr text="no" />
        <div className="mission-note">
          <Tr text="xpediaScriptNoTable" />
        </div>
      </td>
    </tr>
  );
}

/** A nested table, for the weights this article shows as their own block */
const asSubTable: MainTableRenderer = ({ val }) => <MainTable of={val} />;

/** Mission script table: the schedule, with the timing fields spelled out */
export default function MissionScriptComponent({ entry }: { entry: MissionScript }) {
  return (
    <MainTable
      of={entry}
      title="MISSION_SCRIPTS"
      sort={{ exclude: ["id", "researchNeeded", "researchForbidden"] }}
      special={{ missionWeights: asSubTable, regionWeights: asSubTable }}
      rows={{
        // The fields that read as something they are not are replaced by the rows
        // above, in the same order the engine checks them. Listed here so the raw
        // table does not print them a second time underneath.
        startDelay: () => null,
        randomDelay: () => null,
        firstMonth: () => null,
        lastMonth: () => null,
        executionOdds: () => null,
        maxRuns: () => null,
        researchTriggers: () => null,
        useTable: () => null,
        // Every one of these is folded into the "Also requires" row
        itemTriggers: () => null,
        facilityTriggers: () => null,
        baseFunctionTriggers: () => null,
        soldierTypeTriggers: () => null,
        xcomBaseInRegionTriggers: () => null,
        xcomBaseInCountryTriggers: () => null,
        pactCountryTriggers: () => null,
        // And these into "Only while"
        minScore: () => null,
        maxScore: () => null,
        minFunds: () => null,
        maxFunds: () => null,
        minDifficulty: () => null,
        maxDifficulty: () => null,
      }}
      before={
        <>
          <tr>
            <td colSpan={2} className="table-subheader">
              <Tr text="xpediaScriptSchedule" />
            </td>
          </tr>
          <MonthRow entry={entry} />
          <DelayRow entry={entry} />
          <OddsRow entry={entry} />
          <RunsRow entry={entry} />
          <ResearchRow entry={entry} />
          <TriggerRows entry={entry} />
          <LimitsRow entry={entry} />
          <TableRow entry={entry} />
        </>
      }
    />
  );
}
