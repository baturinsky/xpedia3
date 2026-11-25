import { Fragment, type ReactNode, useId } from "react";
import type { Entry } from "../rul/Entry";
import { comparator, rul } from "../rul/Ruleset";
import { remembered, rememberSelection, state } from "../state";
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
      sort={{ last: longLists }}
      wide={wide}
      special={special}
      rows={{
        // `dependencies` suppressed when subsumed (see `subsumed` above): a
        // plain row drawn by `MainTable` would otherwise still show it.
        ...(subsumed ? { dependencies: () => null } : {}),
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
 * The `RESEARCH` section page's list: every topic, or just the bottleneck
 * gates.
 *
 * A radio switch heads the page; "All" is the section's own list, delivered
 * as children so its order stays the section's (`<`/`>` agreement). The
 * "Bottlenecks" view lists the stamped major gates (`gatesScore` set by
 * `Ruleset`, see `researchBottlenecks.ts`), ranked by bottleneck score —
 * the cone weight minus the heaviest dependent's — heaviest first, with the
 * score beside each name so the major gates read as a ranking. A pack with
 * no stamped gates shows the switch and an empty list.
 */
export function ResearchRoot({ children }: { children: ReactNode }) {
  // Like the sprite pickers, the choice lives in `state.selection`, so it is
  // remembered between articles and reloads: `remembered` reads what the
  // reader picked (and `rememberSelection` writes) over the store, and the
  // picker falls back to "all" — an absent member, not a stored default.
  // `useId` keeps the radio group name unique to this instance.
  const group = useId();
  const view = remembered(
    ["all", "bottlenecks"],
    (v) => v === state.selection.researchView,
    "all" as const,
  );
  const gates = rul
    ? Object.values(rul.research)
        .filter((t) => t.gatesTopics != null)
        .sort((a, b) => (b.gatesScore ?? 0) - (a.gatesScore ?? 0) || comparator(a.name, b.name))
    : [];
  return (
    <>
      <fieldset className="research-view">
        <label className="research-view-choice">
          <input
            type="radio"
            name={group}
            value="all"
            checked={view === "all"}
            onChange={() => rememberSelection("researchView", "all")}
          />
          <Tr text="allResearch" />
        </label>
        <label className="research-view-choice">
          <input
            type="radio"
            name={group}
            value="bottlenecks"
            checked={view === "bottlenecks"}
            onChange={() => rememberSelection("researchView", "bottlenecks")}
          />
          <Tr text="bottleneckResearch" />
        </label>
      </fieldset>
      {view === "all" ? (
        children
      ) : (
        <PaginatedList items={gates} pageSize={600}>
          {(shown) =>
            shown.map((topic, i) => (
              <Fragment key={topic.name}>
                {i !== 0 && <Divider />}
                <Val of={topic.name} /> ({formatNumber(topic.gatesScore)})
              </Fragment>
            ))
          }
        </PaginatedList>
      )}
    </>
  );
}
