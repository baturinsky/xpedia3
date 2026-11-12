import { rul } from "../rul/Ruleset";
import { withoutKeys } from "../util";
import MainTable from "./MainTable";
import { RecoveryTable } from "./components";
import { Tr, Val } from "./Val";

/** One line of a kill criteria deed, follows old `deedDescription` in Ruleset.ts */
function deedLink(id?: string) {
  if (id == null)
    return "";
  // Through `Tr`, so a damage type also draws its emoji icon here
  return <a href={"##" + id} className={rul.article(id) ? "" : "dead"}><Tr text={id} /></a>;
}

function deedDescription(deed: any) {
  let parts: any[] = [
    rul.tr(deed.status),
    rul.tr(deed.times),
    deedLink(deed.race),
    deedLink(deed.unit),
    deedLink(deed.faction),
  ];
  if (deed.element || deed.type || deed.item) {
    parts.push(rul.tr("commendationWith"), deedLink(deed.item), deedLink(deed.type), deedLink(deed.element));
  }
  return <>{parts.filter(p => p !== "" && p != null).map((p, i) =>
    <span key={i}>{i != 0 && " "}{p}</span>
  )}</>;
}

/** Bonus table for one commendation stage, follows old `SoldierBonuses.svelte` */
export function SoldierBonusesComponent({ of, title, subtitle }: { of: any, title?: string, subtitle?: string }) {  
  return <MainTable
    of={of}
    title={title ?? "soldierBonuses"}
    subtitle={subtitle}
    special={{
      recovery: ({ val: prop }) => <table><tbody><RecoveryTable recovery={prop} /></tbody></table>,
    }}
  />;
}

/** Commendation article, follows old `Commendation.svelte` */
export default function CommendationComponent({ entry }: { entry: any }) {
  // Each stage is the soldier bonus of that stage with the criteria copied in
  let bonuses: any[] = [];
  for (let i = 0; i < 10; i++) {
    let bonusName = entry.soldierBonusTypes ? entry.soldierBonusTypes[i] : null;
    let b: any = { ...(rul.soldierBonuses[bonusName] || {}), criteria: {} };
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
          : <>{prop.map((deeds: any[], i: number) =>
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
              <table><tbody><RecoveryTable recovery={prop.recovery} /></tbody></table>
            </>
          }
        </>,
      }}
    />
    <div className="no-break-column">
      {bonuses.map((bonus, i) =>
        <SoldierBonusesComponent key={i} of={bonus} title="Stage" subtitle={`${i + 1}`} />
      )}
    </div>
  </>;
}
