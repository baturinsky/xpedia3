import { Fragment, type ReactNode, useId } from "react";
import type { Entry, Research } from "../rul/Entry";
import { comparator, rul } from "../rul/Ruleset";
import { INTEREST_THRESHOLDS, type ResearchInterest } from "../rul/researchInterest";
import { remembered, rememberSelection, researchViews, state } from "../state";
import { Divider, PaginatedList } from "./components";
import MainTable, { type MainTableRenderer } from "./MainTable";
import { formatNumber, Tr, Val } from "./Val";

/** Fields shown as a subheader with the whole list under it, in player terms:
 *  first how this topic becomes available — (all of `dependencies`) OR (any of
 *  `unlockedByAnyOf`), plus all of `requires` — then what completing it does
 *  (`unlocks`, who needs it as part of their whole list, `disables`), then the
 *  random free-grant rows last, so they never read as prerequisites */
const longLists = [
  "dependencies",
  "unlockedByAnyOf",
  "requires",
  "unlocks",
  "requiredTogetherFor",
  "disables",
  "seeAlso",
  "allowsBuying",
  "requiresBaseFunc",
  "getForFreeFrom",
  "getOneFree",
  "getOneFreeProtected",
  "manufacture",
];

/** A wide field always draws its subheader, while the research table used to
 *  draw the block only when the entry had a non-empty list in that field */
function hasContent(val: unknown) {
  return val != null && ((val as { length?: number }).length ?? 0) > 0;
}

/** True when the normal road is dead: some `dependencies` member is also a
 *  shortcut (`unlockedByAnyOf`), so finishing the whole list already
 *  finishes the shortcut. The access rule `(all of deps) OR (any shortcut)`
 *  with a shared topic collapses to the shortcut alone — showing the whole
 *  `dependencies` list beside it (e.g. the 115-topic list on
 *  `STR_ALIEN_ORIGINS`, fully covered by its own shortcuts) would read as
 *  homework the player does not have */
function hasShortcutOverlap(entry: Entry): boolean {
  const deps = entry.dependencies as string[] | undefined;
  const shortcuts = entry.unlockedByAnyOf as string[] | undefined;
  if (!Array.isArray(deps) || !Array.isArray(shortcuts)) return false;
  const s = new Set(shortcuts);
  return deps.some((d) => s.has(d));
}

/** Research table, follows old `Research.svelte` */
export const ResearchComponent = ({ entry }: { entry: Entry }) => {
  // `getOneFreeProtected` maps a group name to the list it protects, so it
  // needs a row per group instead of one block of nested tables
  const groups = entry.getOneFreeProtected;
  // `dependencies` is dropped when a shortcut subsumes it (see
  // `hasShortcutOverlap`); `requiredTogetherFor` was already pruned for the
  // same reason in `Ruleset`. Both paths are needed: removing it from `wide`
  // alone only demotes it to a plain row (`MainTable` still renders known
  // fields), so `rows` suppresses it entirely
  const subsumed = hasShortcutOverlap(entry);
  const wide = longLists.filter(
    (field) =>
      field !== "getOneFreeProtected" &&
      !(field === "dependencies" && subsumed) &&
      hasContent(entry[field]),
  );

  // The research table centred the list that sits under each subheader
  const centred: MainTableRenderer = ({ val }) => (
    <div className="centered-text">
      <Val of={val} />
    </div>
  );
  const special: { [field: string]: MainTableRenderer } = Object.fromEntries(
    wide.map((field) => [field, centred]),
  );

  return (
    <MainTable
      of={entry}
      title="Research"
      // Cost and the infamy it pays are the topic's own numbers, so they lead
      // the table rather than sitting in the alphabetical run of misc fields;
      // the long lists stay last.
      sort={{ first: ["cost", "points"], last: longLists }}
      wide={wide}
      special={special}
      rows={{
        // `dependencies` suppressed when subsumed (see `subsumed` above): a
        // plain row drawn by `MainTable` would otherwise still show it.
        ...(subsumed ? { dependencies: () => null } : {}),
        // `needItem` and `destroyItem` are one fact, not two rows: the topic
        // needs an item in stores, and whether that item is used up. The item
        // is linked explicitly even when it shares this topic's id — the link
        // lands on this page, where the item's own panel sits — so the reader
        // sees which item is meant. `destroyItem` alone (without `needItem`)
        // does nothing in the engine, so it draws no row of its own.
        needItem: () => {
          if (!entry.needItem) return null;
          const itemId = (entry.neededItem as string | undefined) ?? entry.name;
          return (
            <tr>
              <td className="row-name">
                <Tr text="xpediaResearchUsesItem" capital={true} />
              </td>
              <td>
                <a href={`##${itemId}`}>
                  <Tr text={itemId} notip />
                </a>{" "}
                (
                <Tr
                  text={entry.destroyItem ? "xpediaResearchItemUsedUp" : "xpediaResearchItemKept"}
                />
                )
              </td>
            </tr>
          );
        },
        destroyItem: () => null,
        // `getOneFreeProtected` draws several rows of its own, which `wide`
        // cannot (its content sits inside one cell), so it stays a `rows` field.
        // Instead of a common subheader, each row is titled by its columns:
        // "If researched:" names the guard topic, "May grant one free:" the
        // inventory it opens (the label of `getOneFree`, reused so both
        // blocks word the random grant the same way).
        getOneFreeProtected: () =>
          groups == null ? null : (
            <>
              <tr>
                <td className="table-subheader">
                  <Val of="ifResearched" />
                </td>
                <td className="table-subheader">
                  <Val of="getOneFree" />
                </td>
              </tr>
              {Object.entries(groups).map(([group, list]) => (
                <tr key={group}>
                  <td>
                    <Val of={group} />
                  </td>
                  <td>
                    <Val of={list} />
                  </td>
                </tr>
              ))}
            </>
          ),
      }}
    />
  );
};

export default ResearchComponent;

/**
 * The `RESEARCH` section page's list: every topic, or one of the points of
 * interest — bottleneck gates, shortcut hubs, slot machines, deep chains,
 * cycles, wide lists, total grind, unlock and production hubs, free prizes,
 * free-only, unreachable, expensive topics, roots, leaves, disablers, long
 * `requires` lists (see `researchBottlenecks.ts` and `researchInterest.ts`).
 *
 * A radio switch heads the page, each option carrying how many topics it
 * shows. "All" is the section's own list, delivered as children so its order
 * stays the section's (`<`/`>` agreement). Every other view lists its topics
 * ranked by the metric the view is about — bottleneck score, skipped
 * prerequisites, free-grant pool size, chain depth, cycle size, dependency
 * list width — heaviest first, with the metric beside each name so each view
 * reads as a ranking. A pack with nothing showing in a view shows the switch
 * and an empty list.
 */
export function ResearchRoot({ children }: { children: ReactNode }) {
  // Like the sprite pickers, the choice lives in `state.selection`, so it is
  // remembered between articles and reloads: `remembered` reads what the
  // reader picked (and `rememberSelection` writes) over the store, and the
  // picker falls back to "all" — an absent member, not a stored default.
  // `useId` keeps the radio group name unique to this instance.
  const group = useId();
  const view = remembered(researchViews, (v) => v === state.selection.researchView, "all" as const);
  const topics = rul ? Object.values(rul.research) : [];
  const interest = rul?.researchInterest ?? {};
  const byMetric = (list: Research[], metric: (t: Research) => number): Research[] =>
    list.sort((a, b) => metric(b) - metric(a) || comparator(a.name, b.name));
  const statsOf = (t: Research): ResearchInterest | undefined => interest[t.name];
  // The threshold views below all work the same way: keep the topics whose
  // interest stats clear the view's bar, rank them by the view's metric.
  const thresholdView = <Id extends (typeof researchViews)[number]>(
    id: Id,
    labelKey: string,
    descKey: string,
    include: (s: ResearchInterest) => boolean,
    metricOf: (s: ResearchInterest) => number,
  ) => ({
    id,
    labelKey,
    descKey,
    count: topics.filter((t) => {
      const s = statsOf(t);
      return s != null && include(s);
    }).length,
    items: byMetric(
      topics.filter((t) => {
        const s = statsOf(t);
        return s != null && include(s);
      }),
      (t) => metricOf(statsOf(t) as ResearchInterest),
    ),
    metric: (t: Research) => metricOf(statsOf(t) as ResearchInterest),
  });
  const views = [
    {
      id: "all" as const,
      labelKey: "allResearch",
      descKey: "descAllResearch",
      count: topics.length,
      items: [] as Research[],
      metric: (_t: Research) => 0,
    },
    {
      id: "bottlenecks" as const,
      labelKey: "bottleneckResearch",
      descKey: "descBottleneckResearch",
      count: topics.filter((t) => t.gatesTopics != null).length,
      items: byMetric(
        topics.filter((t) => t.gatesTopics != null),
        (t) => t.gatesScore ?? 0,
      ),
      metric: (t: Research) => t.gatesScore ?? 0,
    },
    {
      id: "shortcuts" as const,
      labelKey: "shortcutHubsResearch",
      descKey: "descShortcutHubsResearch",
      count: topics.filter(
        (t) => (statsOf(t)?.shortcutValue ?? 0) >= INTEREST_THRESHOLDS.shortcutValue,
      ).length,
      items: byMetric(
        topics.filter((t) => (statsOf(t)?.shortcutValue ?? 0) >= INTEREST_THRESHOLDS.shortcutValue),
        (t) => statsOf(t)?.shortcutValue ?? 0,
      ),
      metric: (t: Research) => statsOf(t)?.shortcutValue ?? 0,
    },
    {
      id: "free" as const,
      labelKey: "slotMachinesResearch",
      descKey: "descSlotMachinesResearch",
      count: topics.filter((t) => (statsOf(t)?.freePool ?? 0) >= INTEREST_THRESHOLDS.freePool)
        .length,
      items: byMetric(
        topics.filter((t) => (statsOf(t)?.freePool ?? 0) >= INTEREST_THRESHOLDS.freePool),
        (t) => statsOf(t)?.freePool ?? 0,
      ),
      metric: (t: Research) => statsOf(t)?.freePool ?? 0,
    },
    {
      id: "deep" as const,
      labelKey: "deepChainsResearch",
      descKey: "descDeepChainsResearch",
      count: topics.filter((t) => (statsOf(t)?.depth ?? 0) >= INTEREST_THRESHOLDS.depth).length,
      items: byMetric(
        topics.filter((t) => (statsOf(t)?.depth ?? 0) >= INTEREST_THRESHOLDS.depth),
        (t) => statsOf(t)?.depth ?? 0,
      ),
      metric: (t: Research) => statsOf(t)?.depth ?? 0,
    },
    {
      id: "cycles" as const,
      labelKey: "cyclesResearch",
      descKey: "descCyclesResearch",
      count: topics.filter((t) => (statsOf(t)?.cycleSize ?? 1) > 1).length,
      items: byMetric(
        topics.filter((t) => (statsOf(t)?.cycleSize ?? 1) > 1),
        (t) => statsOf(t)?.cycleSize ?? 1,
      ),
      metric: (t: Research) => statsOf(t)?.cycleSize ?? 1,
    },
    {
      id: "wide" as const,
      labelKey: "wideListsResearch",
      descKey: "descWideListsResearch",
      count: topics.filter((t) => (statsOf(t)?.depsWidth ?? 0) >= INTEREST_THRESHOLDS.depsWidth)
        .length,
      items: byMetric(
        topics.filter((t) => (statsOf(t)?.depsWidth ?? 0) >= INTEREST_THRESHOLDS.depsWidth),
        (t) => statsOf(t)?.depsWidth ?? 0,
      ),
      metric: (t: Research) => statsOf(t)?.depsWidth ?? 0,
    },
    thresholdView(
      "grind",
      "grindResearch",
      "descGrindResearch",
      (s) => s.coneSize >= INTEREST_THRESHOLDS.coneSize,
      (s) => s.coneSize,
    ),
    thresholdView(
      "unlockHubs",
      "unlockHubsResearch",
      "descUnlockHubsResearch",
      (s) => s.unlockCount >= INTEREST_THRESHOLDS.unlockCount,
      (s) => s.unlockCount,
    ),
    thresholdView(
      "missions",
      "missionsResearch",
      "descMissionsResearch",
      (s) => s.missionCount >= 1,
      (s) => s.missionCount,
    ),
    thresholdView(
      "production",
      "productionResearch",
      "descProductionResearch",
      (s) => s.manufactureCount >= INTEREST_THRESHOLDS.manufactureCount,
      (s) => s.manufactureCount,
    ),
    thresholdView(
      "buying",
      "buyingResearch",
      "descBuyingResearch",
      (s) => s.buyingCount >= INTEREST_THRESHOLDS.buyingCount,
      (s) => s.buyingCount,
    ),
    thresholdView(
      "freePrizes",
      "freePrizesResearch",
      "descFreePrizesResearch",
      (s) => s.freeGranters >= INTEREST_THRESHOLDS.freeGranters,
      (s) => s.freeGranters,
    ),
    thresholdView(
      "freeOnly",
      "freeOnlyResearch",
      "descFreeOnlyResearch",
      (s) => s.freeOnly,
      (s) => s.freeGranters,
    ),
    thresholdView(
      "unreachable",
      "unreachableResearch",
      "descUnreachableResearch",
      (s) => s.unreachable,
      (s) => s.coneSize,
    ),
    thresholdView(
      "expensiveCost",
      "expensiveCostResearch",
      "descExpensiveCostResearch",
      (s) => s.cost >= INTEREST_THRESHOLDS.cost,
      (s) => s.cost,
    ),
    thresholdView(
      "expensivePoints",
      "expensivePointsResearch",
      "descExpensivePointsResearch",
      (s) => s.points >= INTEREST_THRESHOLDS.points,
      (s) => s.points,
    ),
    thresholdView(
      "roots",
      "rootsResearch",
      "descRootsResearch",
      (s) => s.isRoot,
      (s) => s.dependents,
    ),
    thresholdView(
      "leaves",
      "leavesResearch",
      "descLeavesResearch",
      (s) => s.isLeaf,
      (s) => s.depth,
    ),
    thresholdView(
      "disablers",
      "disablersResearch",
      "descDisablersResearch",
      (s) => s.disablesCount >= INTEREST_THRESHOLDS.disablesCount,
      (s) => s.disablesCount,
    ),
    thresholdView(
      "longRequires",
      "longRequiresResearch",
      "descLongRequiresResearch",
      (s) => s.requiresWidth >= 1,
      (s) => s.requiresWidth,
    ),
  ];
  const current = views.find((v) => v.id === view) ?? views[0];
  return (
    <>
      <fieldset className="research-view">
        {views.map((v) => (
          <label key={v.id} className="research-view-choice">
            <input
              type="radio"
              name={group}
              value={v.id}
              checked={view === v.id}
              onChange={() => rememberSelection("researchView", v.id)}
            />
            <Tr text={v.labelKey} /> ({formatNumber(v.count)})
          </label>
        ))}
      </fieldset>
      <div className="research-view-desc">
        <Tr text={current.descKey} />
      </div>
      {current.id === "all" ? (
        children
      ) : (
        <PaginatedList items={current.items} pageSize={600}>
          {(shown) =>
            shown.map((topic, i) => (
              <Fragment key={topic.name}>
                {i !== 0 && <Divider />}
                <Val of={topic.name} /> ({formatNumber(current.metric(topic))})
              </Fragment>
            ))
          }
        </PaginatedList>
      )}
    </>
  );
}
