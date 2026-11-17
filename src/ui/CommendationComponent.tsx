import { JSX } from "react";
import { rul } from "../rul/Ruleset";
import type { Commendation, ResolvedDeed } from "../rul/Entry";
import { withoutKeys } from "../util";
import MainTable, { MainTableRenderer } from "./MainTable";
import { RecoveryTable } from "./components";
import { Tr, Val } from "./Val";

/** One line of a kill criteria deed, follows old `deedDescription` in Ruleset.ts */
function deedLink(id?: string) {
  if (id == null)
    return "";
  // Through `Tr`, so a damage type also draws its emoji icon here
  return <a href={"##" + id} className={rul.article(id) ? "" : "dead"}><Tr text={id} /></a>;
}

function deedDescription(deed: ResolvedDeed) {
  let parts: (JSX.Element | string)[] = [
    <Tr key="status" text={deed.status} />,
    // The repeat count, e.g. "3"; `Tr` takes strings
    <Tr key="times" text={String(deed.times)} />,
    deedLink(deed.race),
    deedLink(deed.unit),
    deedLink(deed.faction),
  ];
  if (deed.element || deed.type || deed.item) {
    parts.push(<Tr key="with" text="commendationWith" />, deedLink(deed.item), deedLink(deed.type), deedLink(deed.element));
  }
  return <>{parts.filter(p => p !== "" && p != null).map((p, i) =>
    <span key={i}>{i != 0 && " "}{p}</span>
  )}</>;
}

/**
 * One stage of a commendation, as this component draws it: the stage's soldier
 * bonus fields with its criteria copied in.
 *
 * It is a plain copy rather than the `SoldierBonus` entry, because the criteria
 * live on the commendation and are grafted on per stage.
 */
type StageBonus = { criteria: { [criterion: string]: unknown }, [field: string]: unknown };

/** Bonus table for one commendation stage, follows old `SoldierBonuses.svelte` */
export function SoldierBonusesComponent({ entry, title, subtitle }: { entry: StageBonus, title?: string, subtitle?: string }) {
  return <MainTable
    of={entry}
    title={title ?? "soldierBonuses"}
    subtitle={subtitle}
    special={{
      recovery: ({ val: prop }) => <table className="thin"><tbody><RecoveryTable recovery={prop} /></tbody></table>,
    }}
  />;
}

/** Commendation article, follows old `Commendation.svelte` */
export default function CommendationComponent({ entry }: { entry: Commendation }) {
  // Each stage is the soldier bonus of that stage with the criteria copied in.
  // The list is indexed by stage number, so a stage with nothing to show leaves
  // a hole rather than shifting the later stages down.
  let bonuses: (StageBonus | undefined)[] = [];
  for (let i = 0; i < 10; i++) {
    let bonusName = entry.soldierBonusTypes?.[i];
    let b: StageBonus = { ...(bonusName ? rul.soldierBonuses[bonusName] : undefined), criteria: {} };
    for (let criteria in entry.criteria) {
      b.criteria[criteria] = entry.criteria[criteria][i];
    }
    if (Object.keys(b).length > 0)
      bonuses[i] = b;
  }

  return <>
    <MainTable
      of={entry}
      title="Commendation"
      sort={{
        last: ["items"],
        exclude: ["type", "criteria", "soldierBonusTypes", "battleTypes", "damageTypes", "kcd", "killCriteria"]
      }}
      special={{
        killCriteria2: ({ val: prop }) => prop.length == 0
          ? <Val of="See stage descriptions" />
          : <>{prop.map((deeds: ResolvedDeed[], i: number) =>
            <span key={i}>
              {i != 0 && <> {rul.tr("or")}<br /></>}
              {deeds.map((deed, j) =>
                <span key={j}>
                  {j != 0 && <> {rul.tr("and")} </>}
                  {deedDescription(deed)}
                </span>
              )}
            </span>
          )}</>,
        finalBonus: ({ val: prop }) => <>
          <Val of={withoutKeys(prop, ["stats", "recovery", "id"])} /><br />
          Stats: <Val of={prop?.stats} />
          {prop?.recovery &&
            <>
              <br />Recover per turn:
              <table className="thin"><tbody><RecoveryTable recovery={prop.recovery} /></tbody></table>
            </>
          }
        </>,
      }}
    />
    <div className="no-break-column">
      {bonuses.map((bonus, i) => bonus &&
        <SoldierBonusesComponent key={i} entry={bonus} title="Stage" subtitle={`${i + 1}`} />
      )}
    </div>
  </>;
}
