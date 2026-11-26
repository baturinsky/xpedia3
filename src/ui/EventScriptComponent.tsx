import type { EventScript } from "../rul/Entry";
import MainTable from "./MainTable";
import {
  LimitsRow,
  MonthRow,
  OddsRow,
  ResearchRows,
  TriggerRows,
  WeightedPick,
  weightBlocks,
} from "./MissionScriptComponent";
import { Tr, Val } from "./Val";

/**
 * An event script: the scheduler that decides whether a random geoscape
 * event happens this month.
 *
 * Like a mission script, the raw table is the most misleading in the pedia:
 * `firstMonth: 0` is not January, `eventWeights` month keys are the month a
 * weight block starts at (the engine takes the latest block whose month has
 * been reached — `RuleEventScript::generate`), and `researchTriggers` is a
 * `true`/`false` map that reads as data rather than as "needs / must not
 * have". This component says what the engine does, reusing the mission
 * script's month, research, world and limits rows, and keeps the pack's own
 * numbers beside the answer.
 */

/**
 * What the script activates.
 *
 * A block applies from its month onwards until the next block replaces it,
 * so each one is headed by its start. A single possible event is named
 * plainly; several are a weighted pick, so they are said to be picked at
 * random with each one's share. One-time events are named by how they
 * differ (random or in order) in the same sentence, rather than in a
 * footnote — the row name's tooltip carries the "once per campaign" rule.
 */
function FiresRow({ entry }: { entry: EventScript }) {
  const blocks = weightBlocks(entry.eventWeights);
  const random = Object.entries(entry?.oneTimeRandomEvents ?? {});
  const sequential = entry?.oneTimeSequentialEvents ?? [];
  if (!blocks.length && !random.length && !sequential.length) return null;
  return (
    <tr>
      <td className="row-name">
        <Tr text="xpediaEventActivates" capital={true} />
      </td>
      <td>
        {blocks.map((block) => {
          // One block from the start is the common case, and a header would
          // say nothing there: the block's month only matters once a later
          // block replaces it.
          const showStart = blocks.length > 1 || block.month > 0;
          return (
            <div key={block.month}>
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
        {random.length > 0 && (
          <div>
            <WeightedPick entries={random} />
          </div>
        )}
        {sequential.length > 0 && (
          <div>
            <Tr text="xpediaEventInOrder" />:{" "}
            {sequential.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <Val of={id} />
              </span>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

/** Event script table: the schedule, with the timing fields spelled out */
export default function EventScriptComponent({ entry }: { entry: EventScript }) {
  return (
    <MainTable
      of={entry}
      title="Event Script"
      sort={{
        // The fields that read as something they are not are replaced by the
        // rows above, in the same order the engine checks them. Excluded here
        // so the raw table does not print them a second time underneath.
        exclude: [
          "id",
          "eventWeights",
          "oneTimeRandomEvents",
          "oneTimeSequentialEvents",
          "firstMonth",
          "lastMonth",
          "executionOdds",
          "researchTriggers",
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
          <FiresRow entry={entry} />
          <ResearchRows entry={entry} />
          <TriggerRows entry={entry} />
          <LimitsRow entry={entry} />
          <OddsRow entry={entry} />
        </>
      }
    />
  );
}
