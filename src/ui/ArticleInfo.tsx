import { rul } from "../rul/Ruleset";
import { article, section, store } from "../store";
import { Img } from "./components";
import MainTable from "./MainTable";
import ResearchInfo from "./ResearchInfo";
import { LandingPage } from "./ui";
import UnitInfo from "./UnitInfo";
import { Val } from "./Val";

export function ArticleTitle() {
  let [left, right] = [-1, 1].map(delta => rul.findNearbyArticle(article, delta, section, store.ordered));
  return <div className="article-title">
    <div className="left">{left && <Val of={left} prefix={"<"} />}</div>
    <div className="central">{article?.title}</div>
    <div className="sections"><Val of={article.sections} /></div>
    <div className="right">{right && <Val of={right} postfix={">"}/>}</div>
  </div>
}

const renderers = {
  units: UnitInfo,
  //armors: Armor,
  //items: Item,
  battleTypes: {},
  research: ResearchInfo,
  stats: {},
  damageTypes: {},
  countries: {},
  //commendations: Commendation,
  //baseServices: BaseService,
  //facilities: Facility,
  //manufacture: Manufacture,
  //crafts: Craft,
  //craftWeapons: CraftWeapon,
  weaponTypes: {},
  //soldierBonuses: SoldierBonuses,
  soldierTransformation: {},
  soldiers: { sort: { first: ["statCaps"], last: ["armors"] } },
  ufos: { sort: { first: ["modSprite"], last: ["battlescapeTerrainData"] } },
  alienRaces: { title: "Race" },
  alienRanks: { title: "Ranks" },
  alienDeployments: {
    sort: { first: ["startingCondition", "loot"], last: ["data"] },
  },
  missionScripts: {
    sort: { exclude: ["researchNeeded", "researchForbidden"] },
  },
  alienMissions: {},
  //startingConditions: StartingConditions,
  enviroEffects: {},
  terrains: { sort: { last: ["mapBlocks"] } },
  mapScripts: {},
  events: {},
  eventScripts: { title: "Event Script" },
  inventorySections: {},
};

export function ArticleInfo() {
  if(!article)
    return <LandingPage />;

  let id = article?.id ?? "MAIN";

  let main = article && <><ArticleTitle />
    <div className="article-body">
      {(article.text || article.image_id) &&
        <div className="article-text-and-image">
          <Img src={article.image_id} scale={1} />
          <div className="article-text">
            {article.text}
            {article.requires && article.requires.join('') != article.id && <>
              <br />
              <Val of="Research required: " />
              <Val of={article.requires} />
            </>}
          </div>
        </div>
      }
      {Object.entries(renderers).filter(([key]) => {
        return rul[key] ? rul[key][id] : ""
      }
      ).map(([key, ren]) => {
        if (typeof ren == "function") {
          return (ren as Function)({ entry: rul[key][id], text: article?.text })
        } else {
          let { sort, title } = ren as any;
          return <MainTable
            entry={rul[key][id]}
            sort={sort}
            title={title != null ? title : key}
          />
        }
      })}
    </div>
  </>

  
  return <div className="article">
    {main}
    {(section?.id == article?.id && article?.id != "MAIN") &&
      <div className="articles-list">
        <Val of={section?.articles(store.ordered)} vertical={true} />
      </div>
    }
    {(section?.id == "MAIN" || !rul) && <LandingPage />}

  </div>
}
