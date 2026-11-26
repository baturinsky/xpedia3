import type { MissionScript } from "../rul/Entry";
import MainTable from "./MainTable";
import { calendarMonth, monthWindow, researchGate, runLimit, scriptDelay } from "./schedule";
import { formatDelay, formatMinutes } from "./timing";
import { Percent, Tr, Val } from "./Val";

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

// The rows below are exported for `EventScriptComponent`, which shares the
// month sentence, the research gate, the world triggers and the limits: both
// script kinds are checked by the same engine code in the same terms.

type WeightBlock = { month: number; entries: [string, number][] };

/**
 * A `*Weights` map as a list of monthly blocks, in declared order.
 *
 * Every weighted choice in a script (missions, regions, events) is declared
 * the same way: month -> id -> weight, or one flat map, with the list form
 * some packs use instead. The engine takes the latest block whose month has
 * been reached (`RuleMissionScript::generate`, `RuleEventScript::generate`),
 * so a block's month is where it starts, not when it fires.
 */
export function weightBlocks(raw: unknown): WeightBlock[] {
  if (raw == null || typeof raw !== "object") return [];
  const blocks: WeightBlock[] = [];
  if (Array.isArray(raw)) {
    raw.forEach((weights, i) => {
      if (weights == null || typeof weights !== "object") return;
      const entries = Object.entries(weights as { [id: string]: number });
      if (entries.length) blocks.push({ month: i, entries });
    });
    return blocks;
  }
  for (const [month, weights] of Object.entries(raw as { [month: string]: unknown })) {
    if (weights == null || typeof weights !== "object") continue;
    const entries = Object.entries(weights as { [id: string]: number });
    if (entries.length) blocks.push({ month: Number(month) || 0, entries });
  }
  return blocks.sort((a, b) => a.month - b.month);
}

/**
 * One weighted pick, in words.
 *
 * A single possible outcome is named plainly. Several are a weighted pick,
 * so they are said to be picked at random with each one's share of the
 * total, rather than listing bare weights that only matter relative to
 * each other.
 */
export function WeightedPick({ entries }: { entries: [string, number][] }) {
  const total = entries.reduce((sum, [, w]) => sum + (Number(w) || 0), 0);
  if (entries.length === 1) {
    const [id] = entries[0];
    return <Val of={id} />;
  }
  return (
    <>
      <Tr text="xpediaScriptPickedRandom" />:{" "}
      {entries.map(([id, weight], i) => (
        <span key={id}>
          {i > 0 && ", "}
          <Val of={id} /> (
          {total > 0 ? (
            <Percent value={Math.round(((Number(weight) || 0) / total) * 100)} />
          ) : (
            <Val of={weight} />
          )}
          )
        </span>
      ))}
    </>
  );
}

/** The month window as a sentence, or nothing when the script never stops */
export function MonthRow({ entry }: { entry: MissionScript }) {
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
        // value: "from the founding of the first base through month 7". Both
        // ends are inclusive: the engine tests `firstMonth <= month <=
        // lastMonth`, so "until" would leave the last month in doubt.
        first == null ? (
          <>
            <Tr text="xpediaScriptFromFounding" /> <em className="num">{last}</em>
          </>
        ) : last == null ? (
          // The window ends at the founding run itself, so it can only ever
          // be that run — and only a window starting there can include it.
          <>
            <Tr text="xpediaScriptFromMonth" /> <em className="num">{first}</em>{" "}
            <Tr text="xpediaScriptToFounding" />
          </>
        ) : (
          <>
            <Tr text="xpediaScriptMonthsRange" /> <em className="num">{first}</em>-
            <em className="num">{last}</em> <Tr text="xpediaScriptInclusive" />
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

/** The delay before the first wave, named by which of the three ways it is set */
function DelayRow({ entry }: { entry: MissionScript }) {
  const delay = scriptDelay(entry);
  if (entry?.startDelay == null && entry?.randomDelay == null) return null;

  const duration = formatDelay({ min: delay.min, max: delay.max }) ?? formatMinutes(delay.min);
  const text = delay.delegates ? (
    <Tr text="xpediaScriptDelayMissionTimer" />
  ) : (
    <>
      <Tr text={delay.min === delay.max ? "xpediaScriptDelayFixed" : "xpediaScriptDelayRolled"} />:{" "}
      <span className="mission-delay">{duration}</span>
    </>
  );

  return (
    <tr>
      <td className="row-name">
        <Tr text="xpediaScriptDelay" capital={true} />
      </td>
      <td>{text}</td>
    </tr>
  );
}

/** How often the script is even offered the chance to run */
export function OddsRow({ entry }: { entry: MissionScript }) {
  if (entry?.executionOdds == null || Number(entry.executionOdds) === 100) return null;
  return (
    <tr>
      <td className="row-name">
        <Tr text="xpediaScriptChanceToActivate" capital={true} />
      </td>
      <td>
        <Percent value={entry.executionOdds} />
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
 * The research gate, as two rows.
 *
 * A topic that must *not* be researched is as much a condition as one that
 * must be, so the two are separate rows — "Requires research" and "Blocked
 * by research" — rather than one list of ids passing as instructions.
 */
export function ResearchRows({ entry }: { entry: MissionScript }) {
  const gate = researchGate(entry);
  if (!gate) return null;
  return (
    <>
      {gate.needed.length > 0 && (
        <tr>
          <td className="row-name">
            <Tr text="xpediaScriptRequiresResearch" capital={true} />
          </td>
          <td>
            {gate.needed.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <Val of={id} />
              </span>
            ))}
          </td>
        </tr>
      )}
      {gate.forbidden.length > 0 && (
        <tr>
          <td className="row-name">
            <Tr text="xpediaScriptBlockedByResearch" capital={true} />
          </td>
          <td>
            {gate.forbidden.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <Val of={id} />
              </span>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The other world-state gates, as one row.
 *
 * These are all `map<string, bool>` in the ruleset and all mean "the world must
 * look like this", so their wording belongs together: a pack that lists three of
 * them would otherwise produce three near-identical notes.
 */
export function TriggerRows({ entry }: { entry: MissionScript }) {
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
        {rows.map((group, gi) => {
          const wanted = entry[group.field];
          return (
            <div key={group.field}>
              {gi > 0 && (
                <>
                  <Tr text="xpediaScriptAnd" />{" "}
                </>
              )}
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
      </td>
    </tr>
  );
}

/** The score, funds and difficulty windows the script is limited by */
export function LimitsRow({ entry }: { entry: MissionScript }) {
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
  // The first-month exception lives in the row name's tooltip, not as a
  // footnote under every limits row.
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
      </td>
    </tr>
  );
}

/**
 * The mission table row: `useTable` decides whether a mission this script creates
 * is struck off the region's table until every region has been drained. Only
 * the "no" case is drawn: yes is the engine default. What each answer does
 * lives in the row name's tooltip, not in a footnote under the value.
 */
function TableRow({ entry }: { entry: MissionScript }) {
  if (entry?.useTable !== false) return null;
  return (
    <tr>
      <td className="row-name">
        <Tr text="xpediaScriptUseTable" capital={true} />
      </td>
      <td>
        <Tr text="no" />
      </td>
    </tr>
  );
}

/**
 * What a weighted choice does: the missions (or regions, or races) this
 * script spawns, over the monthly blocks.
 *
 * A block applies from its month onwards until the next block replaces it,
 * so each one is headed by its start — except one block from the start,
 * where the header would say nothing. The row name is the plain thing being
 * chosen ("Mission", "Region", "Race"), not the field name: the weights are
 * the mechanism, and the pick plus its shares are already in the cell.
 */
function WeightsRow({
  entry,
  field,
  label,
}: {
  entry: MissionScript;
  field: string;
  label: string;
}) {
  const blocks = weightBlocks(entry[field]);
  if (!blocks.length) return null;
  return (
    <tr>
      <td className="row-name">
        <Tr text={label} capital={true} />
      </td>
      <td>
        {blocks.map((block) => {
          const showStart = blocks.length > 1 || block.month > 0;
          return (
            <div key={`${field}-${block.month}`}>
              {showStart && (
                <div>
                  {block.month === 0 ? (
                    <Tr text="xpediaEventFromFounding" />
                  ) : (
                    <>
                      <Tr text="xpediaEventFromMonth" /> <em className="num">{block.month}</em>
                    </>
                  )}
                  :
                </div>
              )}
              <div>
                <WeightedPick entries={block.entries} />
              </div>
            </div>
          );
        })}
      </td>
    </tr>
  );
}

/** Mission script table: the schedule, with the timing fields spelled out */
export default function MissionScriptComponent({ entry }: { entry: MissionScript }) {
  // The "Mission triggered" sub-block is drawn only when the script actually
  // says something about the mission it triggers: its first wave, what it
  // spawns, how many it may create, or whether it is struck off the table.
  const hasTriggered =
    entry?.startDelay != null ||
    entry?.randomDelay != null ||
    weightBlocks(entry?.missionWeights).length > 0 ||
    weightBlocks(entry?.regionWeights).length > 0 ||
    weightBlocks(entry?.raceWeights).length > 0 ||
    runLimit(entry).limited ||
    entry?.useTable === false;
  return (
    <MainTable
      of={entry}
      title="MISSION_SCRIPTS"
      sort={{
        // The fields that read as something they are not are replaced by the rows
        // above, in the same order the engine checks them. Excluded here so the
        // raw table does not print them a second time underneath.
        exclude: [
          "id",
          "researchNeeded",
          "researchForbidden",
          "startDelay",
          "randomDelay",
          "firstMonth",
          "lastMonth",
          "executionOdds",
          "maxRuns",
          "missionWeights",
          "regionWeights",
          "raceWeights",
          "researchTriggers",
          "useTable",
          "itemTriggers",
          "facilityTriggers",
          "baseFunctionTriggers",
          "soldierTypeTriggers",
          "xcomBaseInRegionTriggers",
          "xcomBaseInCountryTriggers",
          "pactCountryTriggers",
          "minScore",
          "maxScore",
          "minFunds",
          "maxFunds",
          "minDifficulty",
          "maxDifficulty",
        ],
      }}
      before={
        <>
          <MonthRow entry={entry} />
          <OddsRow entry={entry} />
          <ResearchRows entry={entry} />
          <TriggerRows entry={entry} />
          <LimitsRow entry={entry} />
          {hasTriggered && (
            <tr>
              <td colSpan={2} className="table-subheader">
                <Tr text="xpediaScriptMissionTriggered" />
              </td>
            </tr>
          )}
          <DelayRow entry={entry} />
          <WeightsRow entry={entry} field="missionWeights" label="xpediaScriptMission" />
          <WeightsRow entry={entry} field="regionWeights" label="xpediaScriptRegion" />
          <WeightsRow entry={entry} field="raceWeights" label="xpediaScriptRace" />
          <RunsRow entry={entry} />
          <TableRow entry={entry} />
        </>
      }
    />
  );
}
