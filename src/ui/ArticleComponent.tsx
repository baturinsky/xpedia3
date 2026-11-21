import {
  createElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Article } from "../rul/Article";
import type { Entry } from "../rul/Entry";
import {
  battleStats,
  damageTypes,
  internalBattleTypes,
  rul,
  type SortFirstLastOptions,
  statsList,
} from "../rul/Ruleset";
import type { Section } from "../rul/Section";
import { article, section, state, update } from "../state";
import { xpediaBuildStamp, xpediaVersion } from "../util";
import ArmorComponent from "./ArmorComponent";
import CommendationComponent, { SoldierBonusesComponent } from "./CommendationComponent";
import Conditions from "./Conditions";
import CountriesComponent from "./CountryComponent";
import CraftComponent from "./CraftComponent";
import CraftWeaponComponent from "./CraftWeaponComponent";
import { BaseService, Img, LinksPage, type SectionRow, SectionTable } from "./components";
import DeploymentComponent from "./DeploymentDataComponent";
import { environmentalConditions } from "./EnviroConditionsComponent";
import FacilityComponent from "./FacilityComponent";
import ItemComponent from "./ItemComponent";
import MainTable, { asSubTable, type MainTableRenderer } from "./MainTable";
import ManufactureComponent from "./ManufactureComponent";
import { mapBlocks } from "./MapBlockComponent";
import { mapScriptCommands } from "./MapScriptComponent";
import MissionComponent from "./MissionComponent";
import MissionScriptComponent from "./MissionScriptComponent";
import ResearchComponent from "./ResearchComponent";
import StartingConditionsComponent from "./StartingConditionsComponent";
import { battlescapeTerrainData } from "./TerrainDataComponent";
import TrajectoryComponent from "./TrajectoryComponent";
import { TrajectoryFocusProvider } from "./trajectoryFocus";
import UnitComponent from "./UnitComponent";
import { LandingPage, onLandingPage, packTitle, xpediaNamed } from "./ui";
import { Tr, Val } from "./Val";
import {
  RegionMapArticle,
  RegionsMapArticle,
  TrajectoryMapArticle,
  WorldMapArticle,
} from "./WorldMapArticle";

export function ArticleTitle() {
  const [left, right] = [-1, 1].map((delta) =>
    article ? rul.nearbyArticle(article, delta, section, state.alphabeticalSort) : undefined,
  );
  // Old `Article.svelte` filtered out the article's own section from the list
  const sectionIds = article?.sections?.map((s) => s.id).filter((id) => id !== article?.id) ?? [];
  if (onLandingPage()) {
    return (
      <>
        <div className="article-title">
          <div className="central">
            {/* Only XPedia itself carries XPedia's version: a pack's title is the
              pack's name and its own version, and mixing the two numbers in one
              line is ambiguous. See the navbar label for the same rule. */}
            <Tr text={packTitle()} nobr={100} />
            {xpediaNamed() && (
              <span className="xpedia-version" title={xpediaBuildStamp()}>
                {" "}
                {xpediaVersion()}
              </span>
            )}
          </div>
        </div>
        <PackMeta />
      </>
    );
  } else {
    return (
      <div className="article-title">
        <div className="left">{left && <NearbyLink target={left} prefix={"<"} />}</div>
        <div className="central">
          <Tr text={article?.id} nobr={100} />
        </div>
        <div className="sections">{sectionIds.length > 0 && <Val of={sectionIds} />}</div>
        <div className="right">{right && <NearbyLink target={right} postfix={">"} />}</div>
      </div>
    );
  }
}

/**
 * A `<`/`>` link, which has to say which section it lands in.
 *
 * `goToArticle` keeps the section being browsed only while the article belongs
 * to it, and an article often belongs to several. Arriving here by arrow means
 * the reader wants to stay in the list they were reading, so the target section
 * is put in `state` before the hash changes — the click runs ahead of
 * `hashchange`, so `goToArticle` then finds the section already set.
 */
function NearbyLink(props: {
  target: { article: Article; section: Section };
  prefix?: string;
  postfix?: string;
}) {
  const { article: target, section: targetSection } = props.target;
  return (
    <a
      href={`##${target.id}`}
      aria-label={target.id}
      title={target.id}
      onClick={() => update({ section: targetSection })}
    >
      {props.prefix && <span className="nav-arrow">{props.prefix}</span>}
      <span className="nav-name">
        <Tr text={target.id} />
      </span>
      {props.postfix && <span className="nav-arrow">{props.postfix}</span>}
    </a>
  );
}

/**
 * Author and description of the modpack's main mod, shown under the landing
 * page title. Both come from the same `metadata.yml` the title does, and both
 * are free text written by the mod's author, so they are not translated.
 */
function PackMeta() {
  const author = rul?.meta?.author;
  const description = rul?.meta?.description;
  if (!author && !description) return null;
  return (
    <div className="pack-meta">
      {author && <div className="pack-author">by {author}</div>}
      {description && <div className="pack-description">{description}</div>}
    </div>
  );
}

/*Which renderer to use for each article type */

/**
 * A `MainTable` configuration for a collection's articles: field to renderer,
 * ordering, title. Collections that need no special drawing state an empty one.
 */
interface TableConfig {
  title?: string;
  sort?: SortFirstLastOptions;
  wide?: string[];
  special?: { [field: string]: MainTableRenderer };
  rows?: { [field: string]: MainTableRenderer };
}

/**
 * A component that draws a whole article for one collection.
 *
 * `entry` is untyped here because each collection's component takes its own
 * entry class, and the table is keyed by collection name — the component and the
 * entry it is given are matched at runtime, not by the type.
 */
type ArticleComponentRenderer = (props: { entry: any; text?: string }) => ReactNode;

/**
 * The entry an article draws, looked up in the collection its renderer is keyed
 * by. The collection names are `Ruleset` fields, but the lookup is by string, so
 * it goes through an index signature rather than a key of the class.
 */
function collectionEntry(collection: string, id: string): Entry | undefined {
  const table = (rul as unknown as { [collection: string]: { [id: string]: Entry } })[collection];
  return table?.[id];
}

const renderers: { [collection: string]: ArticleComponentRenderer | TableConfig } = {
  enviroEffects: {
    special: {
      environmentalConditions: environmentalConditions,
    },
  },
  alienMissions: MissionComponent,
  missionScripts: MissionScriptComponent,
  units: UnitComponent,
  armors: ArmorComponent,
  battleTypes: {},
  items: ItemComponent,
  research: ResearchComponent,
  stats: {},
  damageTypes: {},
  countries: CountriesComponent,
  commendations: CommendationComponent,
  baseServices: BaseService,
  facilities: FacilityComponent,
  manufacture: ManufactureComponent,
  crafts: CraftComponent,
  craftWeapons: CraftWeaponComponent,
  weaponTypes: {},
  soldierBonuses: SoldierBonusesComponent,
  soldierTransformation: {},
  soldiers: { sort: { first: ["statCaps"], last: ["armors"] } },
  ufos: {
    sort: { first: ["modSprite"], last: ["battlescapeTerrainData"] },
    special: {
      battlescapeTerrainData: battlescapeTerrainData,
    },
  },
  alienRaces: { title: "Race" },
  alienRanks: { title: "Ranks" },
  alienDeployments: DeploymentComponent,
  startingConditions: StartingConditionsComponent,
  terrains: {
    sort: { last: ["mapBlocks"] },
    special: {
      mapBlocks: mapBlocks,
    },
  },
  mapScripts: {
    special: {
      commands: mapScriptCommands,
    },
  },
  events: {},
  eventScripts: {
    title: "Event Script",
    special: {
      eventWeights: asSubTable,
    },
  },
  inventorySections: {
    title: "INVENTORY_SECTIONS",
    sort: { last: ["invType", "slots", "costs", "items"] },
    // These three draw their own rows, because each has a case where the pack
    // states nothing: `special` renderers always emit a row, which would leave
    // an empty "Slots" line on every hand.
    rows: {
      invType: ({ val }) => {
        // A kind the pack leaves to the game's own ruleset has no number to
        // print, so the row is absent rather than reading "undefined"
        const name = invTypeName(val);
        return name == null ? null : (
          <tr>
            <td className="row-name">
              <Val of="invType" capital={true} />
            </td>
            <td>
              <Val of={name} />
            </td>
          </tr>
        );
      },
      slots: ({ val }) => {
        const slots = val as [number, number][];
        if (!slots?.length) return null;
        const width = Math.max(...slots.map((s) => s[0])) + 1;
        const height = Math.max(...slots.map((s) => s[1])) + 1;
        return (
          <tr>
            <td className="row-name">
              <Val of="slots" capital={true} />
            </td>
            <td>
              {slots.length} <Tr text="xpediaSlotCells" postfix={` (${width} x ${height})`} />
            </td>
          </tr>
        );
      },
      // `costs` maps every other section to the time a move into it takes, which
      // is a table of its own rather than one long row
      costs: ({ val }) =>
        val == null ? null : (
          <>
            <tr>
              <td colSpan={2} className="table-subheader">
                <Val of="costs" />
              </td>
            </tr>
            <tr>
              <td colSpan={2}>
                <MainTable of={val} />
              </td>
            </tr>
          </>
        ),
    },
  },
};

/**
 * The engine's `InventoryType` names, indexed by value.
 *
 * A section's kind is a number in the ruleset, so the number alone tells the
 * reader nothing. These are the game's own place names rather than the engine
 * constants, because the article is prose, not source code.
 */
const inventoryTypes = ["invSlot", "invHand", "invGround"];

/**
 * Whether the pack states a section's `type` itself.
 *
 * A pack may override only what it cares about and inherit the rest from the
 * game's `standard` ruleset, which the pedia does not read, so a missing `type`
 * must not be turned into the engine's default.
 */
function invTypeName(val: unknown) {
  if (val == null || Number.isNaN(Number(val))) return undefined;
  return inventoryTypes[Number(val)];
}

/** Section articles that list their entries in a filterable table */
function sectionTable() {
  const id = article?.id;
  if (!id || !rul) return null;
  const table = (
    entries: SectionRow[],
    fields: string[],
    extraFields?: string[],
    filters?: { [key: string]: string[] },
  ) => (
    <SectionTable
      key={id}
      aId={id}
      entries={entries}
      fields={fields}
      extraFields={extraFields}
      filters={filters}
    />
  );

  switch (id) {
    case "FACILITIES":
      return table(
        Object.values(rul.facilities),
        ["size", "monthlyCost", "storage", "personnel", "workshops", "prisonType", "aliens"],
        [
          "buildCost",
          "buildTime",
          "manaRecoveryPerDay",
          "sickBayAbsoluteBonus",
          "sickBayRelativeBonus",
          "defense",
          "hitRatio",
        ],
      );
    case "COMMENDATIONS":
      // `mana` is the game's "Freshness" stat and is granted by the same stage
      // bonuses as the rest, so it belongs with them even though it is not in
      // `statsList`
      return table(
        Object.values(rul.commendations),
        [...statsList, "mana", "visibilityAtDark"],
        [
          ...battleStats.map((s) => `recovery.${s}`),
          "description",
          "visibilityAtDay",
          "camouflageAtDark",
          "camouflageAtDay",
          "frontArmor",
          "sideArmor",
          "rearArmor",
          "underArmor",
        ],
      );
    case "CRAFTS":
      return table(Object.values(rul.crafts), [
        "speedMax",
        "soldiers",
        "vehicles",
        "weapons",
        "damageMax",
        "repairRate",
        "costRent",
      ]);
    case "CRAFT_WEAPONS":
      return table(
        Object.values(rul.craftWeapons),
        ["damage", "accuracy", "range", "ammoMax"],
        undefined,
        {
          weaponType: ["any", ...Object.keys(rul.weaponTypes)],
        },
      );
    case "SOLDIERS":
      return table(Object.values(rul.soldiers), [...statsList, "manufacture", "events"]);
    case "UFOS":
      return table(Object.values(rul.ufos), [
        "modSprite",
        "marker",
        "markerCrash",
        "markerLand",
        "speedMax",
        "armor",
        "damageMax",
        "power",
        "huntBehavior",
        "huntMode",
        "hunterKillerPercentage",
        "radarRange",
        "accel",
      ]);
    case "COUNTRIES":
      return table(Object.values(rul.countries), ["fundingBase", "fundingCap", "events"]);
    case "ATTACKS":
      return table(
        rul.attacks,
        ["name", "accuracy", "damage", "damageType", "shots", "range"],
        [
          "ToArmorPre",
          "ToStun",
          "RandomType",
          "ToHealth",
          "ToTile",
          "ResistType",
          "ToWound",
          "SmokeThreshold",
          ...statsList,
          ...statsList.map((v) => `acc*${v}`),
        ],
        {
          internalBattleType: ["any", ...internalBattleTypes],
          damageTypes: ["any", ...damageTypes],
        },
      );
    case "ITEMS":
      return table(
        Object.values(rul.items),
        ["costSell", "costBuy", "size", "weight", "power", "invSize"],
        [...rul.itemFields].sort(),
        {
          internalBattleType: ["any", ...internalBattleTypes],
          damageTypes: ["any", ...damageTypes],
          category: ["any", ...rul.sortStringsAndNumbers(Object.keys(rul.categories))],
          invSize: ["any", "auto"],
        },
      );
    case "MANUFACTURE":
      return table(
        Object.values(rul.manufacture),
        ["cost", "profit", "profitPerHour", "sizeChange", "time"],
        ["requiredItems", "producedItems", "requires", "requiresBaseFunc", "space"],
        {
          category: ["any", ...Object.keys(rul.manufactureCategories)],
        },
      );
    case "ARMORS":
      return table(
        Object.values(rul.armors),
        ["size", "frontArmor", "sideArmor", "rearArmor", "underArmor"],
        [
          ...damageTypes,
          ...statsList,
          "psiVision",
          "visibilityAtDark",
          "visibilityAtDay",
          "camouflageAtDark",
          "camouflageAtDay",
          "heatVision",
          "fearImmune",
          "ARMOR_ENERGY_SHIELD_CAPACITY",
          "ARMOR_ENERGY_SHIELD_PER_TURN",
          "ARMOR_ENERGY_SHIELD_FLASH_COLOR",
          "ARMOR_ENERGY_SHIELD_TYPE",
        ],
        {
          armorUsers: ["any", "allies", "enemies", ...Object.keys(rul.soldiers)],
          size: ["any", "auto"],
          allowedIn: ["any", ...Object.keys(rul.startingConditions)],
        },
      );
    case "UNITS":
      return table(
        Object.values(rul.units),
        ["canSurrender", "sniper", "spotter", "health"],
        [...statsList, ...rul.unitFields].sort(),
      );
  }
  return null;
}

/** Articles whose body is not the generic list of entry tables */
function specialArticleBody() {
  const id = article?.id;
  if (!id) return null;

  if (id === "SERVICES") return <ServicesTable />;

  if (id === "CONDITIONS") return <Conditions conditions={rul.startingConditions[id]} />;

  return null;
}

/**
 * True when something in the article body does not fit into a multi-column
 * `column`.
 *
 * Tables, sprite sheets and article illustrations are single unbreakable blocks:
 * when one of them is wider than a column the browser does not shrink it, it
 * spills over the gap into the neighbour column. A table's own `scrollWidth`
 * already reflects anything too wide inside it, so only the body's immediate
 * children need measuring. `.img-clip` is the one place where wider content is
 * deliberate (it crops a paperdoll), so it is ignored.
 */
function overflowsColumn(body: HTMLElement, column: number) {
  const limit = column + 1; // allow for sub-pixel rounding
  return Array.from(body.children).some((el) => {
    if (el.classList.contains("img-clip")) return false;
    const rects = Array.from(el.getClientRects());
    // A box the browser split between two columns has one rect per column and
    // flows correctly, so it must not be mistaken for an overflowing one
    if (rects.length > 1) return false;
    const box = rects[0] ?? el.getBoundingClientRect();
    if (box.width > limit) return true;
    // Text or a sprite too wide for its cell only shows up here
    return (el as HTMLElement).scrollWidth > limit;
  });
}

/**
 * Keeps the two-column article body from spilling into itself.
 *
 * `.article-body` is a real CSS multi-column container, and CSS gives no way to
 * ask "did you fit?". `getComputedStyle().columnCount` reports the specified
 * maximum (`2`), not the number of columns the browser actually made, and the
 * container's own `scrollWidth` does not grow when a child overflows. So the
 * used column count is recomputed from the spec rule (`column-width` is a
 * minimum, `column-count` a maximum) and every child is measured against it.
 *
 * When a child does not fit, the body is switched to a single column. That
 * override is dropped again once the article changes or the body gets
 * noticeably wider or narrower, because only the natural two-column layout can
 * tell us whether content fits. The width comparison deliberately ignores
 * small changes: switching to one column makes the page taller, which can add a
 * scrollbar and narrow the body by ~15px, and reacting to that would flip the
 * layout back and forth forever.
 */
function useColumnFit(ref: RefObject<HTMLDivElement | null>, articleId: string, fontSalt: unknown) {
  const [oneColumn, setOneColumn] = useState(false);
  // The layout the current decision was made for
  const measured = useRef<{ articleId: string; width: number; recheck: number; fontSalt: unknown }>(
    undefined,
  );
  // Bumped when the body's box or an image changes: a sprite decoded, a font
  // arrived, the window was resized
  const [recheck, setRecheck] = useState(0);
  const observer = useRef<ResizeObserver>(undefined);

  // One instance of the article exists at a time, so a single set of document
  // listeners is enough. Images become their real size only after they decode,
  // which need not change the body's own box; `load` does not bubble, but a
  // capturing listener still sees it.
  //
  // A paperdoll page decodes hundreds of images, and measuring the whole body
  // forces a synchronous layout, so a burst is coalesced into one measurement
  // taken once the images have settled. Measuring per image made an article of
  // 400 sprites spend seconds re-laying out the same unchanged body.
  useEffect(() => {
    let timer: number | undefined;
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setRecheck((n) => n + 1), 100);
    };
    document.addEventListener("load", bump, true);
    document.addEventListener("error", bump, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("load", bump, true);
      document.removeEventListener("error", bump, true);
      observer.current?.disconnect();
      observer.current = undefined;
    };
  }, []);

  useLayoutEffect(() => {
    const body = ref.current;
    if (!body) {
      measured.current = undefined;
      return;
    }
    if (window.ResizeObserver) {
      // Re-observing the same element is a no-op, so this also handles the body
      // being replaced while the article stays the same
      observer.current ??= new ResizeObserver(() => setRecheck((n) => n + 1));
      observer.current.observe(body);
    }

    const width = body.clientWidth;
    const last = measured.current;
    const sameArticle = !!last && last.articleId === articleId;
    // Only a real resize counts. A one-column body is taller, which can add a
    // scrollbar and narrow it by ~15px; reacting to that would flip the layout
    // back and forth forever
    const resized = !!last && Math.abs(last.width - width) > 24;
    const fontChanged = !!last && last.fontSalt !== fontSalt;

    if (oneColumn) {
      // Our own override is in charge, and only the natural layout can be
      // judged. Recheck ticks are caused by the override itself, so only an
      // outside change (another article, a resize, a font change) may drop it.
      if (sameArticle && !resized && !fontChanged) return;
      measured.current = undefined;
      setOneColumn(false);
      return;
    }

    if (last && sameArticle && !resized && !fontChanged && last.recheck === recheck) return;
    measured.current = { articleId, width, recheck, fontSalt };

    const style = getComputedStyle(body);
    const gap = parseFloat(style.columnGap) || 0;
    const max = parseInt(style.columnCount, 10) || 0;
    const min = parseFloat(style.columnWidth) || 0;
    if (width <= 0) return;
    // `column-width` is a minimum and `column-count` a maximum
    let used = min > 0 ? Math.max(1, Math.floor((width + gap) / (min + gap))) : max > 0 ? max : 1;
    if (max > 0) used = Math.min(used, max);
    if (used < 2) return;
    const column = (width - gap * (used - 1)) / used;
    if (overflowsColumn(body, column)) setOneColumn(true);
  });

  return oneColumn;
}

/** All base services and the facilities that provide them, follows old `BaseServices.svelte` */
function ServicesTable({ query = null as string | null }) {
  const names = rul.sortStringsAndNumbers(Object.keys(rul.baseServices));
  if (!names.length) return null;

  return (
    <table className="main-table base-services">
      <thead>
        <tr className="table-header">
          <td>
            <Tr text="Service" />
          </td>
          <td>
            <Tr text="Facility" />
          </td>
        </tr>
      </thead>
      <tbody>
        {names.map((name) => {
          const items = rul.baseServices[name];
          return (
            <tr key={name} className={name === query ? "highlight" : ""}>
              <td>
                <a className="services" href={`##${name}`}>
                  <Tr text={name} />
                </a>
              </td>
              <td>
                <Val of={items.providedBy} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Full text search results, follows old `App.svelte` */
function SearchResults() {
  const query = state.searchQuery.toLowerCase();
  const found = state.found;
  const matches = (a: string) => (rul.tr(a) ?? "").toLowerCase().includes(query);

  const searchingFor = (
    <>
      <Tr text="Searching for" /> "<em>{state.searchQuery}</em>"
    </>
  );

  if (!found)
    return (
      <div>
        {" "}
        {searchingFor}
        <br />
        {query.length < 2 ? (
          <i>Query too short</i>
        ) : (
          <>
            <Val of="Initializing search engine..." />
            <br />
          </>
        )}
      </div>
    );

  if (found.length === 0)
    return (
      <div>
        {searchingFor}
        <br />
        <i>
          <Val of="Nothing found" />
        </i>
      </div>
    );

  const primary = found.filter(matches).slice(0, 200);
  const secondary = found.filter((a) => !matches(a)).slice(0, 200);

  return (
    <div>
      Searching "<em>{state.searchQuery}</em>":
      <br />
      <LinksPage key={`primary${query}`} links={primary} title="In Title" />
      <br />
      <LinksPage key={`secondary${query}`} links={secondary} title="In Body" />
    </div>
  );
}

export function ArticleComponent() {
  const bodyRef = useRef<HTMLDivElement>(null);
  // Old `Article.svelte` set the document title from `<svelte:head>`. This must
  // run before any early return so the hook order stays stable.
  // No dependency array on purpose: `article` and `rul` are module values, not
  // reactive ones, so a listed dependency would never be compared — but the
  // component re-renders whenever the store changes, so running after every
  // render is what picks up a new article, and setting the title is idempotent.
  useEffect(() => {
    // The tab title names the article, and falls back to XPedia on the landing
    // page. The version belongs to that fallback only: an article's own name
    // is already the pack's, and a pack's articles are not XPedia's version.
    const name = rul ? (rul.tr(article?.id || "XPedia", { icon: "simple" }) ?? "XPedia") : "XPedia";
    document.title = article?.id ? name : `${name} ${xpediaVersion()}`;
  });
  const oneColumn = useColumnFit(bodyRef, article?.id ?? "", state.hugeFont);

  // Full text search results replace the article view
  if (state.searchQuery) return <SearchResults />;

  if (!article)
    return (
      <div className="article">
        <ArticleTitle />
        <LandingPage />
      </div>
    );

  const id = article.id;
  const table = sectionTable();
  const item = rul?.items?.[id];

  // A flight path is described by its own table of stops and the picture of
  // where it happens. Both are wide, so both belong above the two-column body,
  // and the table comes first: it is the answer to "what does this path do",
  // which is what the page is asked, and the map is where it does it.
  //
  // Keyed by the collection rather than by `article.section`, because a page can
  // be reachable from more than one section and only its first would match.
  const trajectory = !table ? rul.ufoTrajectories?.[article.id] : undefined;

  // A section page is the article whose id matches its own section; it lists
  // that section's articles below its own pedia text
  const isSectionPage = !table && section?.id === article.id;

  // Old Article.svelte showed the item's inventory sprite next to the text,
  // unless the item is a craft weapon
  const itemImage = item?.sprite && article?.text && item.battleType !== 2 ? item : null;

  const articleText = article?.text && (
    <div className="main-table main-text">
      {itemImage && (
        <div className="article-text-image">
          <Img
            src={itemImage.sprite}
            scale={2}
            maxWidth={32 * (itemImage.invWidth ?? 1)}
            maxHeight={32 * (itemImage.invHeight ?? 1)}
          />
        </div>
      )}
      <div>
        {/* Article bodies are authored as HTML: the built-in articles and many
          mods use `<p>`, `<b>` and links, so they must not be escaped. This
          matches old `Article.svelte`, which used `{@html article.text}`.
          A block container is needed because such bodies contain blocks. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: article bodies are authored HTML (parity with old `{@html}`), trusted modpack data */}
        <div dangerouslySetInnerHTML={{ __html: article.text }} />
        {article.requires && article.requires.join("") !== article.id && (
          <>
            <br />
            <Val of="Research required: " />
            <Val of={article.requires} />
          </>
        )}
      </div>
    </div>
  );

  // The section page's own illustration belongs with its text, above the list
  const sectionImage = isSectionPage && article?.image_id && !(article.id in (rul.units ?? {})) && (
    <div className="main-table main-text article-section-image">
      <Img src={article.image_id} scale={2} />
    </div>
  );

  // The entries the body draws. Listed here rather than at the point of drawing
  // because the maps below have to know whether the page carries anything else.
  const bodyPanels = !table
    ? Object.entries(renderers).filter(([key]) => collectionEntry(key, id) != null)
    : [];

  // A region is drawn the way it is on its own page: as a picture of the place.
  //
  // Which page is a region's is decided by the collection, not by
  // `article.section`: that getter is the *first* section the article was filed
  // under, and a page can be reached from more than one. `entryConstructors`
  // parses the entry tables before `regions`, so a uid that names both kinds
  // files the region under the section its other kind named first, and reading
  // the section alone would drop the map without saying so.
  //
  // `REGIONS` itself is the section's own page, which leads with the picture of
  // all regions (`RegionsMapArticle`) instead.
  const region = !table && article.id !== "REGIONS" ? rul.regions?.[article.id] : undefined;

  // One placement decision for every map on the page. A page that is nothing
  // but a map keeps it where it has always been: beside the text (or above the
  // columns for a region). A page that also draws entry panels puts the map
  // after them, full width — the panels are what the page is asked about.
  // Old `Article.svelte` put the map above the columns, because it is a wide
  // picture; on a wide screen there is room to set it beside the page instead,
  // and below that the stylesheet stacks it at the bottom.
  //
  // Region and flight are looked up by collection, not `article.section`: that
  // getter is the first section the article was filed under, and a uid naming
  // both kinds files the region under the section its other kind named first.
  // `REGIONS` itself leads with `RegionsMapArticle` instead, so it has no
  // region map of its own.
  const hasPanels = bodyPanels.length > 0;
  const regionMap = region ? (
    <RegionMapArticle key={`${article.id}-region-map`} region={region} />
  ) : null;
  const flightMap = trajectory ? (
    <TrajectoryMapArticle key={`${article.id}-map`} trajectory={trajectory} />
  ) : null;
  // The Countries map sits beside the page. Gated on the id alone rather than
  // `article.section`, for the reason above, and left out when the pack has no
  // `globe:` node rather than reporting a missing feature.
  const countriesMap = article.id === "COUNTRIES" && rul?.raw.globe ? <WorldMapArticle /> : null;
  // A flight block holds the region picker and stop list as well as the map,
  // so the whole of it moves: splitting it would leave the choices in one
  // place and the picture they are choosing for in another. Alone on its page
  // it sits beside the text; otherwise it follows the page's own blocks.
  const flightOnSide = flightMap != null && !hasPanels && region == null;

  const topMap = !hasPanels ? regionMap : null;
  const sideMap = flightOnSide ? flightMap : countriesMap;
  const laterMaps = [hasPanels ? regionMap : null, flightOnSide ? null : flightMap];

  // A trajectory page puts the map on the side sooner than the Countries page:
  // its article column is a narrow flight table, so there is room beside it well
  // before a full country table and two columns of text would leave any.
  const mainClass = `article-main${sideMap ? " has-side-map" : ""}${flightOnSide ? " narrow-side-map" : ""}`;

  const main = article && (
    <>
      <ArticleTitle />
      <div className={mainClass}>
        <div className="article-flow">
          {/* Old `Article.svelte` put all of these above `.main-flex`, so wide
            tables get the full page width instead of a single column */}
          {table}
          {/* The map of the regions heads the REGIONS page: it is the picture the
            section is named for, drawn the way the nations are drawn on the
            Countries page. The section's own list stays below it, because most
            regions state no `areas` and so cannot appear on a map at all — and
            because the pedia is readable with the sidebar hidden, where that
            list is the only way to reach those pages. */}
          {article.id === "REGIONS" && <RegionsMapArticle />}
          {/* A region's map heads its page (`topMap`); when the page also
            draws entry panels it follows them instead, see `laterMaps`. */}
          {topMap}
          {/* The waypoints a flight visits, as a table. The picture of where it
            happens is in the side column, see `sideMap`. */}
          {trajectory && <TrajectoryComponent key={article.id} entry={trajectory} />}
          {article.section === "CATEGORIES" && article.id !== "CATEGORIES" && (
            <LinksPage links={rul.categories[article.id]} />
          )}
          {article.section === "MANUFACTURE_CATEGORIES" &&
            article.id !== "MANUFACTURE_CATEGORIES" && (
              <LinksPage links={rul.manufactureCategories[article.id]} />
            )}
          {/* Section pages put their own pedia text and illustration first, then
            the list of the articles in the section */}
          {isSectionPage && articleText}
          {isSectionPage && sectionImage}
          {isSectionPage && (
            <div className="articles-list">
              {/* The section's own order, so the list and `<`/`>` agree. It is
                already sorted by `articles()`, which caches it per language. */}
              <LinksPage
                key={article.id}
                preSorted
                links={section?.articles(state.alphabeticalSort).map((a) => a.id) ?? []}
              />
            </div>
          )}
          {!isSectionPage && articleText}
          <div
            className={"article-body"}
            ref={bodyRef}
            // Set only when the two-column layout did not fit, see `useColumnFit`
            style={oneColumn ? { columns: 1 } : undefined}
          >
            {!table && specialArticleBody()}
            {bodyPanels.map(([key, ren]) => {
              if (typeof ren === "function") {
                // Render as an element so hooks inside the renderer work
                // biome-ignore lint/correctness/useJsxKeyInIterable: `key` is in the createElement config object
                return createElement(ren, {
                  key,
                  entry: collectionEntry(key, id),
                  text: article?.text,
                });
              } else {
                const { title } = ren;
                return (
                  <MainTable
                    {...ren}
                    key={key}
                    of={collectionEntry(key, id)}
                    title={title != null ? title : key}
                  />
                );
              }
            })}
            {/* Old Article.svelte skipped this one for units, they show an armor sprite instead */}
            {!isSectionPage && !(article.id in (rul.units ?? {})) && article.image_id && (
              <Img src={article.image_id} scale={1.5} />
            )}
          </div>
        </div>
        {/* Beside the article when the screen is wide, below it otherwise. The
          order in the DOM is the reading order as a single column: the map
          follows everything it illustrates. */}
        {sideMap}
        {/* The page's own maps, after its own blocks: see `laterMaps` */}
        {laterMaps}
      </div>
    </>
  );

  // A trajectory page draws the same flight twice — as the plan and as the map —
  // and pointing at a stop in either has to light it in the other. The provider
  // has to sit above both, and the map may be the article column's flex sibling
  // rather than one of its children, so it wraps the whole row either way.
  //
  // Keyed by the article, because a pinned stop is a zone number and a zone
  // number means something else on the next path. Without the key the highlight
  // would survive the step to the next trajectory and point at nothing.
  return (
    <div className={"article"}>
      {trajectory ? (
        <TrajectoryFocusProvider key={`${article.id}-flight`}>{main}</TrajectoryFocusProvider>
      ) : (
        main
      )}
    </div>
  );
}
