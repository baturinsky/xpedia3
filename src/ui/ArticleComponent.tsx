import { createElement, useEffect } from "react";
import { rul, battleStats, damageTypes, internalBattleTypes, statsList } from "../rul/Ruleset";
import { article, section, state } from "../state";
import ArmorComponent from "./ArmorComponent";
import { BaseService, Img, LinksPage, SectionTable } from "./components";
import CommendationComponent, { SoldierBonuses } from "./CommendationComponent";
import Conditions from "./Conditions";
import CraftComponent from "./CraftComponent";
import CraftWeaponComponent from "./CraftWeaponComponent";
import FacilityComponent from "./FacilityComponent";
import ItemComponent from "./ItemComponent";
import MainTable from "./MainTable";
import ManufactureComponent from "./ManufactureComponent";
import ResearchInfo from "./ResearchInfo";
import StartingConditionsComponent from "./StartingConditionsComponent";
import { LandingPage, packTitle, onLandingPage } from "./ui";
import UnitComponent from "./UnitComponent";
import { Val, Tr } from "./Val";

export function ArticleTitle() {
  let [left, right] = [-1, 1].map(delta => article ? rul.findNearbyArticle(article, delta, section, state.alphabeticalSort) : undefined);
  // Old `Article.svelte` filtered out the article's own section from the list
  let sectionIds = article?.sections?.map(s => s.id).filter(id => id != article?.id) ?? [];
  if (onLandingPage()) {
    return <div className="article-title">
      <div className="central"><Tr text={packTitle()} nobr={100} /></div>
    </div>
  } else {
    return <div className="article-title">
      <div className="left">{left && <Val of={left} prefix={"<"} />}</div>
      <div className="central"><Tr text={article?.id} nobr={100} /></div>
      <div className="sections">{sectionIds.length > 0 && <Val of={sectionIds} />}</div>
      <div className="right">{right && <Val of={right} postfix={">"} />}</div>
    </div>
  }
}

/*Which renderer to use for each article type */
const renderers = {
  units: UnitComponent,
  armors: ArmorComponent,
  battleTypes: {},
  items: ItemComponent,
  research: ResearchInfo,
  stats: {},
  damageTypes: {},
  countries: {},
  commendations: CommendationComponent,
  baseServices: BaseService,
  facilities: FacilityComponent,
  manufacture: ManufactureComponent,
  crafts: CraftComponent,
  craftWeapons: CraftWeaponComponent,
  weaponTypes: {},
  soldierBonuses: SoldierBonuses,
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
  startingConditions: StartingConditionsComponent,
  enviroEffects: {},
  terrains: { sort: { last: ["mapBlocks"] } },
  mapScripts: {},
  events: {},
  eventScripts: { title: "Event Script" },
  inventorySections: {},
};

/** Section articles that list their entries in a filterable table */
function sectionTable() {
  let id = article?.id;
  if (!id || !rul)
    return null;
  let table = (entries: any[], fields: string[], extraFields?: string[], filters?: any) =>
    <SectionTable key={id} aId={id} entries={entries} fields={fields}
      extraFields={extraFields} filters={filters} />;

  switch (id) {
    case "FACILITIES":
      return table(Object.values(rul.facilities), [
        "size", "monthlyCost", "storage", "personnel", "workshops", "prisonType", "aliens"
      ], ["buildCost", "buildTime", "manaRecoveryPerDay", "sickBayAbsoluteBonus",
        "sickBayRelativeBonus", "defense", "hitRatio"]);
    case "COMMENDATIONS":
      return table(Object.values(rul.commendations), [...statsList, "visibilityAtDark"],
        [...battleStats.map(s => "recovery." + s), "description", "visibilityAtDay",
          "camouflageAtDark", "camouflageAtDay", "frontArmor", "sideArmor",
          "rearArmor", "underArmor"]);
    case "CRAFTS":
      return table(Object.values(rul.crafts), [
        "speedMax", "soldiers", "vehicles", "weapons", "damageMax", "repairRate", "costRent"
      ]);
    case "CRAFT_WEAPONS":
      return table(Object.values(rul.craftWeapons), ["damage", "accuracy", "range", "ammoMax"], undefined, {
        weaponType: ["any", ...Object.keys(rul.weaponTypes)]
      });
    case "SOLDIERS":
      return table(Object.values(rul.soldiers), [...statsList, "manufacture", "events"]);
    case "UFOS":
      return table(Object.values(rul.ufos), [
        "modSprite", "marker", "markerCrash", "markerLand", "speedMax", "armor",
        "damageMax", "power", "huntBehavior", "huntMode", "hunterKillerPercentage",
        "radarRange", "accel"
      ]);
    case "COUNTRIES":
      return table(Object.values(rul.countries), ["fundingBase", "fundingCap", "events"]);
    case "ATTACKS":
      return table(rul.attacks, ["name", "accuracy", "damage", "damageType", "shots", "range"], [
        "ToArmorPre", "ToStun", "RandomType", "ToHealth", "ToTile", "ResistType",
        "ToWound", "SmokeThreshold", ...statsList, ...statsList.map(v => "acc*" + v)
      ], {
        internalBattleType: ["any", ...internalBattleTypes],
        damageTypes: ["any", ...damageTypes],
      });
    case "ITEMS":
      return table(Object.values(rul.items),
        ["costSell", "costBuy", "size", "weight", "power", "invSize"],
        [...rul.itemFields].sort(), {
        internalBattleType: ["any", ...internalBattleTypes],
        damageTypes: ["any", ...damageTypes],
        category: ["any", ...rul.sortStrings(Object.keys(rul.categories))],
        invSize: ["any", "auto"],
      });
    case "MANUFACTURE":
      return table(Object.values(rul.manufacture),
        ["cost", "profit", "profitPerHour", "sizeChange", "time"],
        ["requiredItems", "producedItems", "requires", "requiresBaseFunc", "space"], {
        category: ["any", ...Object.keys(rul.manufactureCategories)],
      });
    case "ARMORS":
      return table(Object.values(rul.armors),
        ["size", "frontArmor", "sideArmor", "rearArmor", "underArmor"],
        [...damageTypes, ...statsList, "psiVision", "visibilityAtDark", "visibilityAtDay",
          "camouflageAtDark", "camouflageAtDay", "heatVision", "fearImmune",
          "ARMOR_ENERGY_SHIELD_CAPACITY", "ARMOR_ENERGY_SHIELD_PER_TURN",
          "ARMOR_ENERGY_SHIELD_FLASH_COLOR", "ARMOR_ENERGY_SHIELD_TYPE"], {
        armorUsers: ["any", "allies", "enemies", ...Object.keys(rul.soldiers)],
        size: ["any", "auto"],
        allowedIn: ["any", ...Object.keys(rul.startingConditions)],
      });
    case "UNITS":
      return table(Object.values(rul.units),
        ["canSurrender", "sniper", "spotter", "health"],
        [...statsList, ...rul.unitFields].sort());
  }
  return null;
}

/** Articles whose body is not the generic list of entry tables */
function specialArticleBody() {
  let id = article?.id;
  if (!id)
    return null;

  if (id == "SERVICES")
    return <ServicesTable />;

  if (id == "CONDITIONS")
    return <Conditions conditions={rul.startingConditions[id]} />;

  return null;
}

/** All base services and the facilities that provide them, follows old `BaseServices.svelte` */
function ServicesTable({ query = null as string | null }) {
  let names = rul.sortStrings(Object.keys(rul.baseServices));
  if (!names.length)
    return null;

  return <table className="main-table base-services">
    <thead>
      <tr className="table-header">
        <td><Tr text="Service" /></td>
        <td><Tr text="Facility" /></td>
      </tr>
    </thead>
    <tbody>
      {names.map(name => {
        let items: any = rul.baseServices[name];
        return <tr key={name} className={name == query ? "highlight" : ""}>
          <td><a className="services" href={"##" + name}><Tr text={name} /></a></td>
          <td><Val of={items.providedBy} /></td>
        </tr>;
      })}
    </tbody>
  </table>;
}

/** Full text search results, follows old `App.svelte` */
function SearchResults() {
  let query = state.searchQuery.toLowerCase();
  let found = state.found;
  let matches = (a: string) => (rul.tr(a) ?? "").toLowerCase().includes(query);

  if (!found)
    return <div>Searching "<em>{state.searchQuery}</em>":<br />
      {query.length < 2 ? <i>Query too short</i> : <><Val of="Initializing search engine..." /><br /></>}
    </div>;

  if (found.length == 0)
    return <div>Searching "<em>{state.searchQuery}</em>":<br /><i><Val of="Nothing found" /></i></div>;

  let primary = found.filter(matches).slice(0, 200);
  let secondary = found.filter(a => !matches(a)).slice(0, 200);

  return <div>
    Searching "<em>{state.searchQuery}</em>":<br />
    <LinksPage key={"primary" + query} links={primary} />
    <br />
    <LinksPage key={"secondary" + query} links={secondary} title=" " />
  </div>;
}

export function ArticleComponent() {
  // Old `Article.svelte` set the document title from `<svelte:head>`. This must
  // run before any early return so the hook order stays stable.
  useEffect(() => {
    document.title = rul ? (rul.tr(article?.id || "XPedia", { icon: "simple" }) ?? "XPedia") : "XPedia";
  }, [article?.id]);

  // Full text search results replace the article view
  if (state.searchQuery)
    return <SearchResults />;

  if (!article)
    return <LandingPage />;

  let id = article?.id ?? "MAIN";
  let table = sectionTable();
  let item = rul?.items?.[id];

  // A section page is the article whose id matches its own section; it lists
  // that section's articles below its own pedia text
  let isSectionPage = !table && section?.id == article?.id && article?.id != "MAIN";

  // Old Article.svelte showed the item's inventory sprite next to the text,
  // unless the item is a craft weapon
  let itemImage = item?.sprite && article?.text && item.battleType != 2 ? item : null;

  let articleText = article?.text && <div className="main-table main-text">
    {itemImage &&
      <div className="article-text-image">
        <Img src={itemImage.sprite} scale={2}
          maxWidth={32 * (itemImage.invWidth ?? 1)}
          maxHeight={32 * (itemImage.invHeight ?? 1)} />
      </div>
    }
    <div>
      {/* Article bodies are authored as HTML: the built-in articles and many
          mods use `<p>`, `<b>` and links, so they must not be escaped. This
          matches old `Article.svelte`, which used `{@html article.text}`.
          A block container is needed because such bodies contain blocks. */}
      <div dangerouslySetInnerHTML={{ __html: article.text }} />
      {article.requires && article.requires.join('') != article.id && <>
        <br />
        <Val of="Research required: " />
        <Val of={article.requires} />
      </>}
    </div>
  </div>;

  // The section page's own illustration belongs with its text, above the list
  let sectionImage = isSectionPage && article?.image_id
    && !(article.id in (rul.units ?? {}))
    && <div className="main-table main-text article-section-image">
      <Img src={article.image_id} scale={2} />
    </div>;

  let main = article && <><ArticleTitle />
    {/* Old `Article.svelte` put all of these above `.main-flex`, so wide
        tables get the full page width instead of a single column */}
    {table}
    {article.section == "CATEGORIES" && article.id != "CATEGORIES" &&
      <LinksPage links={rul.categories[article.id]} />}
    {article.section == "MANUFACTURE_CATEGORIES" && article.id != "MANUFACTURE_CATEGORIES" &&
      <LinksPage links={rul.manufactureCategories[article.id]} />}
    {/* Section pages put their own pedia text and illustration first, then the
        list of the articles in the section */}
    {isSectionPage && articleText}
    {isSectionPage && sectionImage}
    {isSectionPage &&
      <div className="articles-list">
        <LinksPage key={article.id} links={section.articles(state.alphabeticalSort).map(a => a.id)} />
      </div>
    }
    {!isSectionPage && articleText}
    <div className={"article-body"}>
      {!table && specialArticleBody()}
      {!table && Object.entries(renderers).filter(([key]) => {
        return (rul as any)[key] ? (rul as any)[key][id] : ""
      }
      ).map(([key, ren]) => {
        if (typeof ren == "function") {
          // Render as an element so hooks inside the renderer work
          return createElement(ren as any, { key, entry: (rul as any)[key][id], text: article?.text });
        } else {
          let { sort, title } = ren as any;
          return <MainTable
            key={key}
            entry={(rul as any)[key][id]}
            sort={sort}
            title={title != null ? title : key}
          />
        }
      })}
      {/* Old Article.svelte skipped this one for units, they show an armor sprite instead */}
      {!isSectionPage && !(article.id in (rul.units ?? {})) && article.image_id &&
        <Img src={article.image_id} scale={2} />}
    </div>
  </>;


  return <div className={"article"}>
    {main}
    {(onLandingPage() || !rul) && <LandingPage />}

  </div>
}
