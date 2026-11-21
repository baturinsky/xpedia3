import { Fragment, type ReactNode, useId, useState } from "react";
import type { AlienDeployment } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import {
  deploymentRaces,
  loadoutIsEmpty,
  type RankDeployment,
  rankUnits,
  setChancesByLevel,
} from "./deploymentRank";
import MainTable, { asSubTable } from "./MainTable";
import { Percent, TipScopeProvider, Tr, Val } from "./Val";
import { asItems, asNumber, isEmpty } from "./value";

/**
 * The `data` of one `alienDeployments` entry, as cards.
 *
 * One card per alien rank: the unit that rank spawns as its title, a prose
 * summary of how many of them appear ("3 at easy, 6 at hard, +0–3 random,
 * 50% outside the UFO"), and the rank's loadouts underneath. The loadouts
 * are labelled by what they turn on: `itemSets` are alternatives the alien
 * tech level picks between (weakest first, drawn as a table of sets against
 * tech levels when the mod's `alienItemLevels` table can be counted), not
 * difficulty tiers and not things one alien carries together. Cards rather
 * than a table, because the loadouts are the long part and a table's
 * full-width item rows orphan them from the rank they belong to — a reader
 * scrolling a long deployment lost which rank a list of weapons belonged
 * to. A card keeps its title, its numbers and its loadouts in one place.
 *
 * A rank is an index into the alien race's member list, so the title prints
 * the member the index resolves to (see `deploymentRank.ts`), with the rank
 * itself kept beside it the way `MissionComponent` keeps an objective's raw
 * number beside its name. `customUnitType` overrides the lookup in the
 * engine, so when a row states one it is the title itself. When the missions
 * field more than one race, the title lists each race's member at that rank
 * (`A / B`); only when no race leads here, or none has a member at the rank,
 * does the title fall back to the raw number.
 *
 * The quantity in the summary is the base count by difficulty
 * (`lowQty..medQty..highQty`, equal neighbours collapsed, a missing
 * `medQty` skipped) plus each random bonus that is stated and nonzero —
 * `dQty` and `extraQty` are independent rolls of 0..N on top of the base,
 * see `BattlescapeGenerator`. Anything the engine knows about that is none
 * of the above follows as a small definition list, so a future field still
 * has somewhere to go.
 */

type DeploymentRow = { [field: string]: unknown };

/** The quantity fields the summary is built from, easy to hard */
const QUANTITY_FIELDS = ["lowQty", "medQty", "highQty", "dQty", "extraQty"];

/** Fields drawn as lists under the summary, not as fields */
const LIST_ROW_FIELDS = ["itemSets", "extraRandomItems"];

/**
 * The other scalar fields a card states as a small definition list.
 * `customUnitType` is not among them: the engine spawns it instead of the
 * rank's member, so the title already prints it. A field nothing states is
 * left out — a line of blanks would only repeat that the pack did not use
 * it.
 */
function otherFieldsOf(rows: DeploymentRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const field of Object.keys(row)) {
      if (
        field !== "alienRank" &&
        field !== "customUnitType" &&
        field !== "percentageOutsideUfo" &&
        !QUANTITY_FIELDS.includes(field) &&
        !LIST_ROW_FIELDS.includes(field) &&
        !isEmpty(row[field])
      )
        seen.add(field);
    }
  }
  return [...seen].sort();
}

/** A comma list of item references, linked */
function ItemList({ items }: { items: unknown[] }): ReactNode {
  return (
    <>
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a position in a parallel list identifies the item for the file reader
        <Fragment key={i}>
          {i > 0 && ", "}
          <Val of={item} />
        </Fragment>
      ))}
    </>
  );
}

/** One loadout set: its items as a comma list */
function ItemSet({ value }: { value: unknown }): ReactNode {
  if (Array.isArray(value)) return <ItemList items={value} />;
  return <Val of={value} />;
}

/**
 * `itemSets`/`extraRandomItems`: the loadouts, one per line.
 * With `chancesByLevel` — the share of spawns counted from the mod's
 * `alienItemLevels` table — the loadouts become a table: the tech levels as
 * the first columns, the items as the last, one row per set (weakest first),
 * so a reader sees each set's chance at every level instead of counting the
 * table themselves. A mod with a single row (most have one) has a single
 * level column and no header to number it by. `extraRandomItems` never gets
 * one: each of its lines is one random pick, not an alternative, so it stays
 * a list.
 */
function ItemSets({
  value,
  chancesByLevel,
}: {
  value: unknown;
  chancesByLevel?: number[][];
}): ReactNode {
  const sets = asItems(value);
  const levelCount = chancesByLevel?.[0]?.length ?? 0;
  if (chancesByLevel && chancesByLevel.length === sets.length && levelCount > 0) {
    return (
      // A loadout table is a chance table: it fills the card with the
      // per-cents centred under their level numbers, like the raceWeights
      // table, while the last column is the items list.
      <table className="main-table data-table data-table-wide-last deployment-levels">
        {/* One level needs no number to its column */}
        {levelCount > 1 && (
          <thead>
            <tr>
              {Array.from({ length: levelCount }, (_, level) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a tech level is identified by its position in the mod's table, which is the order it applies
                <th scope="col" key={level}>
                  {level + 1}
                </th>
              ))}
              <th scope="col">
                <Tr text="itemSets" />
              </th>
            </tr>
          </thead>
        )}
        <tbody>
          {sets.map((set, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a loadout is identified by its position among its siblings, the order the file writes them
            <tr key={i}>
              {chancesByLevel[i].map((chance, level) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a tech level is identified by its position in the mod's table, which is the order it applies
                <td key={level}>
                  <Percent value={chance} />
                </td>
              ))}
              <td>
                <ItemSet value={set} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <ul className="data-nested deployment-sets">
      {sets.map((set, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a loadout is identified by its position among its siblings, the order the file writes them
        <li key={i}>
          <ItemSet value={set} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The summary line: how many of the card's unit appear.
 *
 * The base count by difficulty with equal neighbours collapsed (a flat
 * count carries no difficulty word, since it holds at every difficulty),
 * each stated value marked with its difficulty in words ("3 at easy,
 * 6 at hard") and carrying that field's tooltip, then each random bonus
 * that is stated and nonzero as "+0–N random" with its own tooltip. The
 * outside share closes the line ("50% outside the UFO"). A missing or
 * zero block takes its punctuation with it, so nothing dangles, and a row
 * with nothing at all to say gets no line. `medQty` of 0 counts as
 * missing, the way the engine reads it. Every fragment is a number followed
 * by its words, which is also the order the Russian reads, so the parts
 * join with a plain comma in both languages.
 */
function Summary({ row }: { row: DeploymentRow }): ReactNode {
  const stated: { n: number; word: string; tip: string }[] = [];
  const low = asNumber(row.lowQty);
  if (low != null) stated.push({ n: low, word: "xpediaAtEasy", tip: "tip_lowQty" });
  const med = asNumber(row.medQty);
  if (med != null && med > 0) stated.push({ n: med, word: "xpediaAtMedium", tip: "tip_medQty" });
  const high = asNumber(row.highQty);
  if (high != null) stated.push({ n: high, word: "xpediaAtHard", tip: "tip_highQty" });
  // Equal neighbours collapse to one number, keeping the last mark of the
  // run (the hardest difficulty the value holds at); a count stated at every
  // difficulty collapses to a single unmarked number.
  const groups: { n: number; word: string; tip: string }[] = [];
  for (const entry of stated) {
    const last = groups[groups.length - 1];
    if (last && last.n === entry.n) Object.assign(last, entry);
    else groups.push({ ...entry });
  }
  const flat = stated.length > 1 && groups.length === 1;
  const dice: { n: number; tip: string }[] = [];
  const dQty = asNumber(row.dQty);
  if (dQty != null && dQty > 0) dice.push({ n: dQty, tip: "tip_dQty" });
  const extraQty = asNumber(row.extraQty);
  if (extraQty != null && extraQty > 0) dice.push({ n: extraQty, tip: "tip_extraQty" });

  const parts: ReactNode[] = groups.map((group, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: a position in the difficulty order identifies the value for the file reader
    <span key={i} className="nobr" data-tooltip={group.tip}>
      <Val of={group.n} />
      {!flat && (
        <>
          {" "}
          <Tr text={group.word} />
        </>
      )}
      <sup className="tipmark">?</sup>
    </span>
  ));
  for (const die of dice) {
    parts.push(
      <span className="nobr" data-tooltip={die.tip}>
        +0–
        <Val of={die.n} /> <Tr text="xpediaRandomQty" />
        <sup className="tipmark">?</sup>
      </span>,
    );
  }
  if (!isEmpty(row.percentageOutsideUfo)) {
    parts.push(
      <span className="nobr">
        <Percent value={row.percentageOutsideUfo} /> <Tr text="xpediaOutsideUfo" />
      </span>,
    );
  }
  if (parts.length === 0) return null;
  return (
    <p className="deployment-summary">
      {parts.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts follow the order the summary builds them in
        <Fragment key={i}>
          {i > 0 && ", "}
          {part}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * The card's title: the unit the rank spawns, with the rank kept beside it.
 *
 * `customUnitType` wins outright in the engine, so it needs no race at all;
 * otherwise the rank resolves through the deployment's race (see
 * `deploymentRank.ts`). A `membersRandom` slot rolls between its candidates
 * on every spawn, so all of them are listed, joined by ` / ` — and the same
 * join lists the members of two or more races when the deployment's missions
 * field more than one. When nothing resolves — no known race, or a rank past
 * every member list — the raw number stands, which is all that can honestly
 * be said.
 */
function RankTitle({
  row,
  index,
  deployment,
  race,
}: {
  row: DeploymentRow;
  index: number;
  deployment: RankDeployment | undefined;
  race?: string;
}): ReactNode {
  const rank = asNumber(row.alienRank) ?? index;
  const custom =
    typeof row.customUnitType === "string" && row.customUnitType !== ""
      ? row.customUnitType
      : undefined;
  const units = custom ? [custom] : rankUnits(deployment, rank, rul ?? {}, race);
  if (!units || units.length === 0) return <Val of={row.alienRank ?? index} field="alienRank" />;
  return (
    <>
      {units.map((unit, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a candidate is identified by its position in its rank's roll
        <Fragment key={i}>
          {i > 0 && " / "}
          <Val of={unit} />
        </Fragment>
      ))}
      <span className="mission-raw"> ({rank})</span>
    </>
  );
}

function DeploymentDataView({
  data,
  deployment,
}: {
  data: unknown;
  deployment: RankDeployment | undefined;
}): ReactNode {
  // Hooks first: an article with no rows still renders nothing, but the
  // picker state must stay mounted in the same order either way. `useId`
  // makes the radio name unique to this instance, so several pickers on one
  // page never trade their selection.
  const group = useId();
  const [race, setRace] = useState<string | undefined>(undefined);
  const list = asItems(data).filter(
    (item): item is DeploymentRow => typeof item === "object" && item != null,
  );
  if (list.length === 0) return null;
  // By rank, not by file order: the engine spawns each row in turn with a
  // random node of its rank, so the order a pack writes its rows in carries
  // no meaning — and ascending rank reads like the race's member list
  // (commander first, terrorists last). The sort is stable, so rows of one
  // rank keep the order the file writes them in.
  // `origIndex` survives the sort: a row with no stated rank falls back to
  // its position in the file, not to its position among the cards.
  const rows = list
    .map((row, origIndex) => ({ row, origIndex }))
    .sort(
      (a, b) =>
        (asNumber(a.row.alienRank) ?? a.origIndex) - (asNumber(b.row.alienRank) ?? b.origIndex) ||
        a.origIndex - b.origIndex,
    );
  const otherFields = otherFieldsOf(rows.map(({ row }) => row));
  const races = deploymentRaces(deployment, rul ?? {});
  // Joining three or more candidates in every title is unreadable; the reader
  // picks one race and the titles show that race alone. Two stay joined.
  const picker = races.length > 2;
  const shown = race && races.includes(race) ? race : race == null && picker ? races[0] : race;
  return (
    <TipScopeProvider scope="deploymentData">
      {picker && (
        <fieldset className="deployment-race">
          <legend>
            <Tr text="xpediaDeploymentRace" />
          </legend>
          {races.map((id) => (
            <label key={id} className="deployment-race-choice">
              <input
                type="radio"
                name={group}
                value={id}
                checked={shown === id}
                onChange={() => setRace(id)}
              />
              <Val of={id} />
            </label>
          ))}
        </fieldset>
      )}
      <div className="deployment-cards">
        {rows.map(({ row, origIndex }) => {
          // A rank can state its loadout explicitly as empty sets — XPiratez
          // anchors `&itemSetsEmpty` with five empty sets and reuses it for
          // bare-handed ranks, including both rows of `STR_LABYRINTHUS_NOCTIS`.
          // That is a stated absence, not a missing field, so it is worth
          // saying rather than drawing a tech-level table of blank rows.
          const itemSetsPresent = !isEmpty(row.itemSets);
          const extraPresent = !isEmpty(row.extraRandomItems);
          const itemSetsEmpty = itemSetsPresent && loadoutIsEmpty(row.itemSets);
          const extraEmpty = extraPresent && loadoutIsEmpty(row.extraRandomItems);
          // The note replaces both loadout blocks when every stated
          // loadout is empty; if any loadout does carry items, that block
          // renders as usual and the empty field just stays out.
          const showsNoItems =
            (itemSetsEmpty || extraEmpty) &&
            (!itemSetsPresent || itemSetsEmpty) &&
            (!extraPresent || extraEmpty);
          // The "by alien tech level" label is only honest when the levels
          // were actually counted: with several sets but no usable
          // `alienItemLevels` table the sets just list, and the label drops
          // the "by alien tech level". A single set is a single loadout.
          const setCount = asItems(row.itemSets).length;
          const chances =
            itemSetsPresent && !itemSetsEmpty
              ? setChancesByLevel(setCount, rul?.alienItemLevels)
              : undefined;
          return (
            <section className="deployment-card" key={origIndex}>
              <h3 className="deployment-card-title">
                <RankTitle row={row} index={origIndex} deployment={deployment} race={shown} />
              </h3>
              <Summary row={row} />
              {otherFields
                .filter((field) => !isEmpty(row[field]))
                .map((field) => (
                  <dl className="data-fields" key={field}>
                    <dt>
                      <Val of={field} capital={true} />
                    </dt>
                    <dd>
                      <Val of={row[field]} field={field} />
                    </dd>
                  </dl>
                ))}
              {showsNoItems && (
                <p className="mission-note">
                  <Tr text="xpediaNoLoadoutItems" />
                </p>
              )}
              {itemSetsPresent && !itemSetsEmpty && (
                <>
                  <span className="deployment-row-label">
                    <Tr
                      text={
                        setCount > 1
                          ? chances
                            ? "xpediaLoadoutsByTechLevel"
                            : "xpediaLoadouts"
                          : "xpediaLoadoutByTechLevel"
                      }
                    />
                  </span>
                  <ItemSets value={row.itemSets} chancesByLevel={chances} />
                </>
              )}
              {extraPresent && !extraEmpty && (
                <>
                  <span className="deployment-row-label">
                    <Val of="extraRandomItems" />
                  </span>
                  <ItemSets value={row.extraRandomItems} />
                </>
              )}
            </section>
          );
        })}
      </div>
    </TipScopeProvider>
  );
}

/**
 * An `alienDeployments` article: the entry's fields, with `data` drawn as
 * the rank cards above. A component rather than a table config, because the
 * cards need the deployment itself — its `race`, and the missions that lead
 * to it — to resolve each rank to the unit it spawns.
 */
export default function DeploymentComponent({ entry }: { entry: AlienDeployment }) {
  return (
    <MainTable
      of={entry}
      title="alienDeployments"
      sort={{ first: ["startingCondition", "loot"], last: ["data", "alertBackground", "briefing"] }}
      special={{
        // Keyed on the deployment: the picker is per-article state, and the
        // app keeps the same component position while navigating.
        data: ({ val }) => (
          <DeploymentDataView data={val} deployment={entry} key={entry.uid ?? ""} />
        ),
        briefing: asSubTable,
      }}
    />
  );
}
