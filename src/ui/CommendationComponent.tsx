import type { JSX } from "react";
import type { BonusMap, Commendation, ResolvedDeed } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import { withoutKeys } from "../util";
import { RecoveryTable } from "./components";
import MainTable from "./MainTable";
import { Tr, Val } from "./Val";

/** One line of a kill criteria deed, follows old `deedDescription` in Ruleset.ts */
function deedLink(id?: string) {
  if (id == null) return "";
  // Through `Tr`, so a damage type also draws its emoji icon here
  return (
    <a href={`##${id}`} className={rul.article(id) ? "" : "dead"}>
      <Tr text={id} />
    </a>
  );
}

function deedDescription(deed: ResolvedDeed) {
  // Each part is named by the field it prints: the name is its key, so the
  // list needs no positional index
  const parts: { id: string; node: JSX.Element | string }[] = [
    { id: "status", node: <Tr text={deed.status} /> },
    // The repeat count, e.g. "3"; `Tr` takes strings
    { id: "times", node: <Tr text={String(deed.times)} /> },
    { id: "race", node: deedLink(deed.race) },
    { id: "unit", node: deedLink(deed.unit) },
    { id: "faction", node: deedLink(deed.faction) },
  ];
  if (deed.element || deed.type || deed.item) {
    parts.push(
      { id: "with", node: <Tr text="commendationWith" /> },
      { id: "item", node: deedLink(deed.item) },
      { id: "type", node: deedLink(deed.type) },
      { id: "element", node: deedLink(deed.element) },
    );
  }
  return (
    <>
      {parts
        .filter((p) => p.node !== "" && p.node != null)
        .map(({ id, node }, i) => (
          <span key={id}>
            {i !== 0 && " "}
            {node}
          </span>
        ))}
    </>
  );
}

/**
 * One stage of a commendation, as this component draws it: the stage's soldier
 * bonus fields with its criteria copied in.
 *
 * It is a plain copy rather than the `SoldierBonus` entry, because the criteria
 * live on the commendation and are grafted on per stage.
 */
type StageBonus = { criteria: { [criterion: string]: unknown }; [field: string]: unknown };

/** Bonus table for one commendation stage, follows old `SoldierBonuses.svelte` */
export function SoldierBonusesComponent({
  entry,
  title,
  subtitle,
}: {
  entry: StageBonus;
  title?: string;
  subtitle?: string;
}) {
  return (
    <MainTable
      of={entry}
      title={title ?? "soldierBonuses"}
      subtitle={subtitle}
      special={{
        recovery: ({ val: prop }) => (
          <table className="thin">
            <tbody>
              <RecoveryTable recovery={prop as { [stat: string]: BonusMap }} />
            </tbody>
          </table>
        ),
      }}
    />
  );
}

/** Commendation article, follows old `Commendation.svelte` */
export default function CommendationComponent({ entry }: { entry: Commendation }) {
  // Each stage is the soldier bonus of that stage with the criteria copied in.
  // The list is indexed by stage number, so a stage with nothing to show leaves
  // a hole rather than shifting the later stages down.
  const bonuses: (StageBonus | undefined)[] = [];
  for (let i = 0; i < 10; i++) {
    const bonusName = entry.soldierBonusTypes?.[i];
    const b: StageBonus = {
      ...(bonusName ? rul.soldierBonuses[bonusName] : undefined),
      criteria: {},
    };
    for (const criteria in entry.criteria) {
      b.criteria[criteria] = entry.criteria[criteria][i];
    }
    if (Object.keys(b).length > 0) bonuses[i] = b;
  }

  return (
    <>
      <MainTable
        of={entry}
        title="Commendation"
        sort={{
          last: ["items"],
          exclude: [
            "type",
            "criteria",
            "soldierBonusTypes",
            "battleTypes",
            "damageTypes",
            "kcd",
            "killCriteria",
          ],
        }}
        special={{
          killCriteria2: ({ val: prop }) => {
            const groups = prop as ResolvedDeed[][];
            return groups.length === 0 ? (
              <Val of="See stage descriptions" />
            ) : (
              groups.map((deeds: ResolvedDeed[], i: number) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: one group per stage, so the index is the stage number; groups carry no id and identical groups can repeat across stages
                <span key={i}>
                  {i !== 0 && (
                    <>
                      {" "}
                      {rul.tr("or")}
                      <br />
                    </>
                  )}
                  {deeds.map((deed, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the same deed can be listed twice within one stage group; the index keeps those entries distinct and the list never reorders
                    <span key={`${j}-${JSON.stringify(deed)}`}>
                      {j !== 0 && <> {rul.tr("and")} </>}
                      {deedDescription(deed)}
                    </span>
                  ))}
                </span>
              ))
            );
          },
          finalBonus: ({ val: prop }) => {
            const bonus = prop as {
              stats?: unknown;
              recovery?: { [stat: string]: BonusMap };
            } | null;
            return (
              <>
                <Val of={withoutKeys(prop as object, ["stats", "recovery", "id"])} />
                <br />
                Stats: <Val of={bonus?.stats} />
                {bonus?.recovery && (
                  <>
                    <br />
                    Recover per turn:
                    <table className="thin">
                      <tbody>
                        <RecoveryTable recovery={bonus.recovery} />
                      </tbody>
                    </table>
                  </>
                )}
              </>
            );
          },
        }}
      />
      <div className="no-break-column">
        {bonuses.map(
          (bonus, i) =>
            bonus && (
              // biome-ignore lint/suspicious/noArrayIndexKey: the index is the stage number, and holes are kept so later stages do not shift down
              <SoldierBonusesComponent key={i} entry={bonus} title="Stage" subtitle={`${i + 1}`} />
            ),
        )}
      </div>
    </>
  );
}
