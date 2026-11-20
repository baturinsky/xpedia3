//@ts-expect-error
import SearchApi from "js-worker-search";
import { emptyImg } from "../imgPlaceholders";
import * as util from "../util";
import { addAllIfNew, capital, gameRelativePath, getFlagEmoji } from "../util";
import { Article } from "./Article";
import {
  AlienDeployment,
  Armor,
  type Attack,
  Commendation,
  Craft,
  CraftWeapon,
  DamageType,
  Entry,
  EventEntry,
  EventScript,
  Facility,
  InventorySection,
  Item,
  Manufacture,
  MissionScript,
  Music,
  type RawEntry,
  Region,
  Research,
  SimpleEntry,
  SoldierBonus,
  Soldiers,
  SoldierTransformation,
  StartingConditions,
  stampUid,
  UfoTrajectory,
  Unit,
} from "./Entry";
import { Section } from "./Section";
import { Sprite } from "./Sprite";

export let rul!: Ruleset;
export type SortFirstLastOptions = {
  first?: string[];
  last?: string[];
  exclude?: string[];
  sortBy?: (value: unknown) => string | number;
};
/**
 * One value of a parsed YAML file.
 *
 * A `rul` file is arbitrary nested data (see `loadYaml`): a table is a list of
 * blocks or a map keyed by id, a block is a map of fields, and a field is a
 * scalar, a list or a nested node. The schemas in `vscode-ruleset/schemas`
 * describe each table's fields, but the pedia reads them field by field as it
 * goes, so this recursive shape — rather than one type per table — is what the
 * merged ruleset is stored as.
 */
export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

/** A YAML mapping: a ruleset file, a table, or one entry block */
export type YamlObject = { [key: string]: YamlValue };

/** One parsed `rul` file: its top-level keys are the tables it declares */
export type RulFile = YamlObject;

type StringValue = [string, unknown];
export const defaultLanguage = "en-US";

export const obsTables: { [pck: string]: string } = {
  "BIGOBS.PCK": "big",
  "FLOOROB.PCK": "floor",
  "HANDOB.PCK": "hand",
  "BASEBITS.PCK": "base",
  "INTICON.PCK": "icon",
};

/**
 * A language's strings: the id a string is looked up by, and the string itself.
 *
 * `addToLng` keeps whatever a language file states, so a value can in principle
 * also be a number or an OXCE plural object; every reader in the pedia expects a
 * string, and the two packs checked only use strings.
 */
export type LangMap = { [id: string]: string };

/** Every language of a pack, keyed by language name; `icon` is the emoji map */
export type Langs = { [langName: string]: LangMap };

/** A mod's `metadata.yml`, with the fields the pedia reads named */
export type ModMeta = {
  id?: string;
  master?: string;
  isMaster?: boolean;
  active?: boolean;
  name?: string;
  version?: string;
  author?: string;
  description?: string;
  [key: string]: unknown;
};

export type Mod = {
  lng: Langs;
  meta: ModMeta;
  dir: string;
  /** The parsed `rul` files of the mod, straight from YAML and not yet merged */
  rul: RulFile[];
  /** The shared `common` folder: languages and resources used by every mod */
  common?: boolean;
  /** Files that came from the builtin mods rather than from the uploaded pack */
  builtin?: boolean;
  /**
   * Not one of the pack's own mods, but a base master the game loads underneath
   * one that is.
   *
   * The player can switch `xcom1` off and still keep an active total conversion
   * that names it as its master — the shipped X-Piratez `options.cfg` does
   * exactly that — and the game loads such a master anyway, because the chain
   * expansion in `FileMap::setup` walks from every *enabled* mod up through its
   * masters. These mods are in the ruleset for that reason alone, so the pedia
   * must not present them as part of what the player chose.
   */
  dependency?: boolean;
};

/**
 * The processed ruleset a `Ruleset` is built from: the shape the database
 * stores and an exported page carries.
 */
export type ProcessedRuleset = {
  mods?: Mod[];
  langs?: Langs;
  /** Relative resource path (lowercased) -> full archive path */
  resources?: { [rel: string]: string };
  /**
   * Ids of the mods the player switched off, as the pack's `user/options.cfg`
   * says. Absent when everything is on, which is what a pack that was never
   * played looks like, so the payload keeps its usual shape.
   */
  disabled?: string[];
};

/**
 * The mod an uploaded pack is about: the deepest master, i.e. the one that
 * itself chains to a base master, not the base game it sits on. A pack that is
 * just one mod on its own (no master anywhere) still needs a name: use its own
 * metadata, skipping the builtin mods and `common`, which belong to XPedia
 * rather than to the uploaded pack. If several qualify, the one with the most
 * rules is the one the pack is about.
 *
 * Used for the navbar title and for the exported page's `<title>`, so both
 * agree on the pack's name.
 */
export function mainMod(mods: Mod[]): Mod | undefined {
  const masters = mods.filter((m) => m.meta?.isMaster);
  const chained = masters.filter(
    (m) => m.meta?.master && mods.some((o) => (o.meta?.id ?? o.dir) === m.meta?.master),
  );
  const master = (chained.length ? chained : masters).slice(-1)[0];
  if (master) return master;

  const own = mods
    .filter((m) => !m.common && !/^mods[/\\]/i.test(m.dir) && m.meta?.name)
    .sort((a, b) => (b.rul?.length ?? 0) - (a.rul?.length ?? 0));
  return own[0];
}

/** `[key, value]` pairs for the named fields, in the given order */
function orderedFilteredEntries(item: object, fields?: string[]): StringValue[] {
  if (item == null) return [];
  const record = item as { [key: string]: unknown };
  return fields
    ? fields
        .map((key) => (record[key] != null ? ([key, record[key]] as StringValue) : null))
        .filter((v) => v != null)
    : [];
}

/**
 * Sorts item's keys, putting "first" first, "last" last, excluding "exclude" and using "sortBy" function
 * returns lists of key-value pairs
 * "misc" in return is everything that is not "first" or "last"
 */
export function sortFirstLast(
  item: object,
  options: SortFirstLastOptions = {},
): {
  first: StringValue[];
  misc: StringValue[];
  last: StringValue[];
  exclude: StringValue[];
  all: StringValue[];
} {
  if (item == null) return { all: [], first: [], misc: [], last: [], exclude: [] };

  if (options.exclude) {
    if (options.first) options.first = util.exclude(options.first, options.exclude);
    if (options.last) options.last = util.exclude(options.last, options.exclude);
  }

  const first = orderedFilteredEntries(item, options.first);
  const last = orderedFilteredEntries(item, options.last);
  const exclude = orderedFilteredEntries(item, options.exclude);
  const special = new Set([
    ...(options.first || []),
    ...(options.last || []),
    ...(options.exclude || []),
    "id",
    "list",
    "name",
    "collection",
  ]);
  let misc: StringValue[] = Object.entries(item).filter(([k]) => !special.has(k));
  const sortBy = options.sortBy;
  if (sortBy) {
    misc = misc.sort((a, b) => (sortBy(a[1]) > sortBy(b[1]) ? 1 : -1));
  } else {
    misc = misc.sort((a, b) => comparator(a[0], b[0]));
  }
  const all: StringValue[] = [...first, ...misc, ...last];
  return { first, misc, last, exclude, all };
}

export class Search {
  /**
   * The index defaults to tokenizing on whitespace only, which turns every
   * article id into a single very long token. The engine indexes every
   * substring of a token, so a 30 character id costs 465 entries on its own,
   * and ids were a third of the whole index. Splitting on `_` as well keeps
   * the index a third the size for the same matches.
   *
   * Only `_` is added on purpose: splitting on all punctuation would make a
   * query like `x-com` become `x` AND `com`, which turns 8 precise hits into
   * 662 fuzzy ones.
   */
  articles = new SearchApi({ tokenizePattern: /[\s_]+/ });

  constructor() {
    for (const a of Object.values(rul.articles)) {
      // The fields are looked up by name: `title` and `text` are getters, and a
      // pack may add others
      const fields = a as unknown as { [key: string]: unknown };
      const texts = ["id", "type", "title", "text"]
        .map((key) => String(fields[key]).toLowerCase())
        .join(" ");
      this.articles.indexDocument(a.id, texts);
    }
  }

  async findArticles(query: string) {
    return this.articles.search(query.toLowerCase());
  }
}

export class Service {
  /**
   * The service's lists, added by `Service.add`: `canBuy`, `allowsBuilding` and
   * so on hold the ids of what the service offers.
   */
  /** Service name -> ids of what it offers, see `Service.add`; `id` is the name */
  [list: string]: string[] | string;

  constructor(public id: string) {
    Article.create(id, "SERVICES");
  }

  static add(prop: string, id: string, entries?: string[]) {
    if (entries) {
      for (const s of entries) {
        if (!(s in rul.baseServices)) rul.baseServices[s] = new Service(s);
        if (!(prop in rul.baseServices[s])) rul.baseServices[s][prop] = [];
        (rul.baseServices[s][prop] as string[]).push(id);
      }
    }
  }
}

export default class Ruleset {
  articles: { [key: string]: Article } = {};
  articlesOrder: Article[] = [];
  sections: { [key: string]: Section } = {};
  sectionsOrder: Section[] = [];
  typeSectionsOrder: Section[] = [];
  sprites: { [key: string]: Sprite } = {};
  /** The merged ruleset blocks, keyed by table and then by entry id */
  raw: { [category: string]: YamlValue } = {};
  search: { [key: string]: Search } = {};
  ourArmors: string[] = [];
  items: { [key: string]: Item } = {};
  categories: { [key: string]: string[] } = {};
  manufactureCategories: { [key: string]: string[] } = {};
  armors: { [key: string]: Armor } = {};
  units: { [key: string]: Unit } = {};
  crafts: { [key: string]: Craft } = {};
  facilities: { [key: string]: Facility } = {};
  enviroEffects: { [key: string]: Entry } = {};
  craftWeapons: { [key: string]: CraftWeapon } = {};
  weaponTypes: { [key: string]: Entry } = {};
  itemTypes: { [key: string]: Entry } = {};
  stats: { [key: string]: Entry } = {};
  battleTypes: { [key: string]: Entry } = {};
  countries: { [key: string]: Entry } = {};
  damageTypes: { [key: string]: DamageType } = {};
  research: { [key: string]: Research } = {};
  soldierBonuses: { [key: string]: Entry } = {};
  commendations: { [key: string]: Commendation } = {};
  soldierTransformation: { [key: string]: SoldierTransformation } = {};
  soldiers: { [key: string]: Soldiers } = {};
  alienDeployments: { [key: string]: AlienDeployment } = {};
  alienRaces: { [key: string]: Entry } = {};
  manufacture: { [key: string]: Manufacture } = {};
  startingConditions: { [key: string]: StartingConditions } = {};
  events: { [key: string]: EventEntry } = {};
  eventScripts: { [key: string]: EventScript } = {};
  missionScripts: { [key: string]: MissionScript } = {};
  alienMissions: { [key: string]: Entry } = {};
  ufos: { [key: string]: Entry } = {};
  regions: { [key: string]: Region } = {};
  ufoTrajectories: { [key: string]: UfoTrajectory } = {};
  /** Cache for `missionsIn`, built on first use: packs take thousands of lookups */
  private _missionReach?: Map<string, Set<string>>;
  terrains: { [key: string]: Entry } = {};
  mapScripts: { [key: string]: Entry } = {};
  obs = { big: [], floor: [], hand: [], base: [], icon: [] } as { [id: string]: Sprite[] };
  /** Relative resource path (lowercased) -> full archive path, see `getFilePath` */
  resourceMap: { [rel: string]: string } = {};
  /**
   * Sound slot -> game-root path, per CAT file.
   *
   * A slot number is only unique within its CAT file, so `55` in BATTLE.CAT and
   * `55` in GEO.CAT are different sounds. Only the slots a mod replaces are
   * known by path; every other sound is still inside the pack's CAT archive,
   * which the pedia does not unpack.
   */
  sounds: { [cat: string]: { [slot: string]: string } } = {};
  /** Music id -> track, see `Music`. A lookup, not a set of articles */
  musics: { [id: string]: Music } = {};
  config: unknown;
  baseServices: { [key: string]: Service } = {};
  redirect: { [key: string]: string } = {};
  attacks: Attack[] = [];

  itemFields = new Set<string>();
  unitFields = new Set<string>();

  /** Metadata of the mod the pack is about, see `mainMod` */
  meta: ModMeta = {};
  lang: LangMap = {};
  langs: Langs = {};
  /** The mods of the loaded pack, in merge order */
  mods: Mod[] = [];
  langName: string | null = null;
  langNames: string[] = [];
  /** Language names already run through `convertLang` */
  convertedLangs: { [langName: string]: boolean } = {};

  constructor(processed?: ProcessedRuleset) {
    rul = this;
    if (processed) this.loadProcessedMods(processed);
  }

  tr(str?: string | null | undefined, props?: { capital?: boolean; icon?: string }) {
    const bigSnakeCase = /^[A-Z0-9_]+$/;
    if (str == null) return null;

    if (str in rul.lang) {
      str = rul.lang[str];
      str = stripPediaMarkup(str);
    } else if (typeof str === "string") {
      if (props?.icon && props?.icon !== "none") str = null;
      else {
        if (str.substr(0, 4) === "STR_") str = str.substr(4);

        if (str.match(bigSnakeCase)) str = str.replace(/_/g, " ");

        str = str.replace(/([a-z])([A-Z])/g, "$1 $2");
        // A derived label has no translation to preserve, so `capital` still
        // normalises it to lower case; a translated one keeps its own capitals
        // such as "TU" and "CQC"
        if (props?.capital) str = str.toLowerCase();
      }
    }

    if (props?.capital) str = capital(str);

    return str;
  }

  addCategory(catName: string, id: string, where?: { [cat: string]: string[] }) {
    if (where == null) where = rul.categories;
    const cat = where[catName] || [];
    if (!cat.includes(id)) cat.push(id);
    where[catName] = cat;
  }

  damageTypeName(type: number) {
    return this.lang[damageTypes[type]];
  }

  /**
   * The file a sound slot names, or `null` when the pack does not replace it.
   *
   * Sound slots live inside a `.CAT` archive that the pedia does not unpack, so
   * only a slot a mod replaces with `extraSounds` has a path at all. The CAT is
   * chosen by the field the slot came from: BATTLE.CAT for battlescape sounds,
   * GEO.CAT for the few geoscape ones.
   */
  sound(id: number, cat = "BATTLE.CAT") {
    return this.sounds[cat]?.[id] ?? null;
  }

  /**
   * The regions a UFO flight path can actually be drawn in.
   *
   * A waypoint's first number indexes the `missionZones` of one region, so the
   * path means nothing without a region to read it against. The engine decides
   * that region at runtime, at the moment `GeoscapeState` launches a mission:
   *
   * - a mission script that names regions (`regionWeights`) dictates one;
   * - otherwise the strategy picks from its own table, which in practice is
   *   every region that declares a `regionWeight`.
   *
   * That is the rule this mirrors, once per script that selects a mission flying
   * this path. Regions that do not have enough zones for the path are dropped,
   * because the game would never draw the path there either.
   */
  regionsFor(trajectory: string | UfoTrajectory) {
    const path = typeof trajectory === "string" ? this.ufoTrajectories?.[trajectory] : trajectory;
    if (!path) return [];

    const chosen = new Set<string>();
    for (const mission of this.missionsFlying(path.uid))
      for (const script of this.scriptsSelecting([mission])) {
        const weights = this.missionScripts?.[script]?.regionWeights;
        const names = regionNamesOf(weights);
        if (names.size) for (const name of names) chosen.add(name);
        // No script-level choice means the engine falls back to the table of
        // weighted regions, so every one of those is a possibility
        else for (const region of this.weightedRegions()) chosen.add(region);
      }

    // A path nothing selects any more is still a real path; fall back to the
    // zones alone rather than showing a page that cannot draw anything
    if (!chosen.size) for (const region of this.weightedRegions()) chosen.add(region);

    return [...chosen]
      .map((id) => this.regions?.[id])
      .filter((region) => path.fits(region))
      .sort((a, b) => a.uid.localeCompare(b.uid));
  }

  /** Regions the strategy may pick a mission in: the ones with a weight */
  weightedRegions() {
    return Object.values(this.regions ?? {})
      .filter((region) => region.regionWeight != null && region.regionWeight > 0)
      .map((region) => region.uid);
  }

  /** Ids of the alien missions whose waves fly this trajectory */
  missionsFlying(trajectory: string) {
    const out: string[] = [];
    for (const mission of Object.values(this.alienMissions ?? {}))
      for (const wave of (mission.waves as { trajectory?: string }[] | undefined) ?? [])
        if (wave?.trajectory === trajectory) {
          out.push(mission.uid);
          break;
        }
    return out;
  }

  /** Ids of the mission scripts that can launch one of these missions */
  scriptsSelecting(missions: string[]) {
    const wanted = new Set(missions),
      out: string[] = [];
    for (const script of Object.values(this.missionScripts ?? {}))
      for (const mission of regionNamesOf(script.missionWeights))
        if (wanted.has(mission)) {
          out.push(script.uid);
          break;
        }
    return out;
  }

  /**
   * The flight paths a region's own missions send, in the order the region's
   * missions are listed.
   *
   * The paths are the ones the region's missions actually fly, taken from their
   * waves. That is a different set from `UfoTrajectory.fits`'s: North America in
   * XFiles passes the structural test for forty-two paths and its missions fly
   * sixteen, so a picture drawn from `fits` alone showed lines belonging to no
   * flight there.
   *
   * One filter is still applied, and it is about drawing rather than about truth:
   * a path the region does not have the zones for cannot be placed on its map.
   * XFiles' one-zone event regions (`REGION_SILO_ATTACK` and friends) have their
   * missions name `P1` and `P7`, which visit zones that region does not have; the
   * flight is real, the picture of it is impossible.
   */
  flightsIn(region: string | Region) {
    const target = typeof region === "string" ? this.regions?.[region] : region;
    if (!target) return [];

    const seen = new Set<string>(),
      out: UfoTrajectory[] = [];
    for (const { mission } of this.missionsIn(target))
      for (const wave of (this.alienMissions?.[mission]?.waves as
        | { trajectory?: string; ufo?: string }[]
        | undefined) ?? []) {
        const id = wave?.trajectory;
        const path = id && this.ufoTrajectories?.[id];
        if (!path || seen.has(path.uid) || !path.fits(target)) continue;
        seen.add(path.uid);
        out.push(path);
      }
    return out;
  }

  /**
   * The mission scripts that can launch a mission in `region`.
   *
   * The engine chooses the region and the mission separately, and the region
   * choice has two routes that are worth spelling out:
   *
   * - a script names regions with `regionWeights`;
   * - a script that names none falls back to the strategy's weighted table, which
   *   in practice is every region declaring a `regionWeight`.
   *
   * The second route makes almost every script a candidate for every weighted
   * region — in XFiles a single unnamed script puts its mission in every weighted
   * region at once — so `missionsIn` counts how many regions can host each mission
   * rather than claiming a region has a long list of its own.
   */
  private missionScriptsFor(region: Region) {
    const weighted = region.regionWeight != null && region.regionWeight > 0;
    const out: MissionScript[] = [];
    for (const script of Object.values(this.missionScripts ?? {})) {
      const names = regionNamesOf(script.regionWeights);
      if (names.has(region.uid) || (weighted && !names.size)) out.push(script);
    }
    return out;
  }

  /**
   * The alien missions that can appear in `region`, with how many regions share
   * each one.
   *
   * `regionCount` counts the regions that can host a mission at all, which is what
   * makes the list useful: a mission one region alone can spawn is the reason to
   * read that region's page, while one that half the world can spawn is
   * background. The count is over the whole pack, so a page can say "only here".
   *
   * Every region's reachable missions are needed for the counts, so they are built
   * once per pack rather than per region: a page asks this on every visit, and a
   * pack with a hundred and seventy regions would otherwise walk every script a
   * hundred and seventy times.
   */
  missionsIn(region: string | Region) {
    const target = typeof region === "string" ? this.regions?.[region] : region;
    if (!target) return [];

    const reach = this.missionReach();
    const counts = new Map<string, number>();
    for (const missions of reach.values())
      for (const id of missions) counts.set(id, (counts.get(id) ?? 0) + 1);

    const out: { mission: string; regionCount: number }[] = [];
    for (const id of reach.get(target.uid) ?? [])
      out.push({ mission: id, regionCount: counts.get(id) ?? 1 });
    // Rarest first, so the missions that distinguish the region lead; ties keep
    // a stable, predictable order rather than the pack's own
    return out.sort((a, b) => a.regionCount - b.regionCount || a.mission.localeCompare(b.mission));
  }

  /** Each region's reachable missions, built once per pack, since `missionsIn` sweeps every script */
  private missionReach() {
    if (!this._missionReach) {
      const reach = new Map<string, Set<string>>();
      for (const region of Object.values(this.regions ?? {})) {
        const missions = new Set<string>();
        for (const script of this.missionScriptsFor(region))
          for (const mission of regionNamesOf(script.missionWeights)) missions.add(mission);
        reach.set(region.uid, missions);
      }
      this._missionReach = reach;
    }
    return this._missionReach;
  }

  /** Sprite from one of the obs tables (BIGOBS.PCK etc). Returns the asset path,
   * or the transparent placeholder when this ruleset has no such sprite. */
  obsSprite(type: string, num: number) {
    const path = (this.obs[type] || [])[num]?.path;
    return path || emptyImg;
  }

  convertLang(langName: string) {
    if (this.convertedLangs[langName]) return false;

    let lang = this.langs[langName];

    if (lang == null || lang.ALREADYCONVERTED) return;
    lang.ALREADYCONVERTED = "true";

    if (langName === defaultLanguage)
      lang = {
        ...{
          dependencies: "STR_DEPENDS_ON",
          seeAlso: "STR_ITEM_REQUIRED",
          requiresBaseFunc: "STR_SERVICES_REQUIRED",
          freeFrom: "STR_GET_FOR_FREE_FROM",
          leadsTo: "STR_LEADS_TO",
          unlocks: "STR_UNLOCKS",
          disables: "STR_DISABLES",
          getOneFree: "STR_GIVES_ONE_FOR_FREE",
          manufacture: "STR_REQUIRED_BY",
          randomProducedItems: "STR_RANDOM_PRODUCTION_DISCLAIMER",
          cost: "STR_COST",
        },
        ...lang,
      };

    this.convertedLangs[langName] = true;
    return true;
  }

  /** Calls the respective class constructor for the entry */
  parseType(type: string, klass?: new (raw: RawEntry, collection?: string) => Entry) {
    for (const data of Object.values(this.raw[type] ?? {}) as RawEntry[]) {
      // The constructor registers the entry on `rul`; the value itself is unused
      new (klass || SimpleEntry)(data, type);
    }
  }

  /**
   * Builds the `musics` lookup without giving each track an article.
   *
   * A track has no stats worth a page, and 71 of them would add a section of
   * near-empty articles. It is a lookup table, so it is filled directly.
   */
  parseMusics() {
    this.musics = {};
    for (const [id, raw] of Object.entries(this.raw.musics ?? {}) as [string, YamlValue][]) {
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
      this.musics[id] = new Music(
        id,
        raw as unknown as {
          name?: string;
          catPos?: number | string;
          normalization?: number | string;
        },
      );
    }
  }

  deleteModDirs() {
    for (const tableKind in this.raw)
      if (Array.isArray(this.raw[tableKind]))
        for (const table of this.raw[tableKind] as YamlValue[]) {
          if (table != null && typeof table === "object" && "modDir" in table)
            delete (table as YamlObject).modDir;
        }
  }

  /** Merges every mod's ruleset blocks, keyed by category and then by entry id */
  combineModRuls(mods: Mod[]) {
    const rul: { [category: string]: { [id: string]: YamlValue } } = {};
    for (const mod of mods) {
      for (const file of mod.rul) {
        for (const categoryName in file) {
          rul[categoryName] ||= {};
          const category = rul[categoryName];
          const rawCategory = file[categoryName];
          if (Array.isArray(rawCategory)) {
            for (const data of rawCategory) {
              if (data == null || typeof data !== "object" || Array.isArray(data)) continue;
              const block = data as YamlObject;
              // Stamped here, before the block is merged or filed, so the guess
              // is made once and the merge key, the entry id and the `uid` the
              // block carries are one value
              const id = stampUid(categoryName, block);
              // A block that names nothing cannot be merged into the table: it
              // would land under an empty key and the next such block would
              // overwrite it
              if (!id) continue;
              if (block.delete) {
                delete category[id];
                continue;
              }
              const old = category[id];
              if (!old) {
                category[id] = data;
              } else {
                // A repeat of the same id merges: array data is concatenated,
                // object data is merged field by field
                if (Array.isArray(data)) {
                  category[id] = [...(old as YamlValue[]), ...data];
                } else {
                  category[id] = { ...(old as YamlObject), ...block };
                }
              }
            }
          } else {
            // The object form is keyed by id already, so the key is the uid. Only
            // real entry tables are stamped: `ufopaedia`, `globe` and the other
            // object-form singletons are not table rows and have no addressable
            // identity to carry.
            if (
              categoryName in entryConstructors &&
              rawCategory != null &&
              typeof rawCategory === "object"
            )
              for (const id in rawCategory) {
                const block = (rawCategory as YamlObject)[id];
                if (
                  block != null &&
                  typeof block === "object" &&
                  !Array.isArray(block) &&
                  !(block as YamlObject).uid
                )
                  stampUid(categoryName, Object.assign(block as YamlObject, { uid: id }));
              }
            Object.assign(category, rawCategory as object);
          }
        }
      }
    }
    return rul;
  }

  parseRuls(mods: Mod[]) {
    this.raw = this.combineModRuls(mods);

    // The world map used to be a generated page under a `WORLD_MAP` category,
    // declared here and in the builtin ruleset. It is now drawn at the bottom of
    // the Countries page, so neither exists any more, and nothing is registered
    // for it. A pack that declares its own `WORLD_MAP` article keeps it: that is
    // the pack's content, and the builtins do not override a modpack.

    // Sounds are read from the mods rather than from `this.raw`: a slot's file
    // path is relative to the mod folder that declares it, and merging the
    // `extraSounds` blocks into one table loses which mod that was.
    //
    // `extraSounds` is an object keyed by CAT file in every pack checked, not
    // an array. This used to test `.length`, which an object does not have, so
    // the whole table was skipped and no sound had a path.
    this.sounds = {};
    for (const mod of mods) {
      for (const file of mod.rul) {
        const extra = file?.extraSounds;
        if (!extra) continue;
        const blocks: YamlObject[] = Array.isArray(extra)
          ? (extra as YamlObject[])
          : Object.entries(extra as YamlObject).map(([type, def]: [string, YamlValue]) => ({
              type,
              ...(def as YamlObject),
            }));
        for (const block of blocks) {
          const cat = typeof block?.type === "string" ? block.type : undefined;
          if (!cat || !block?.files || typeof block.files !== "object") continue;
          for (const [slot, path] of Object.entries(block.files as YamlObject) as [
            string,
            string,
          ][]) {
            if (path == null || path === "") continue;
            // Browsers read forward slashes; a mod folder may contain spaces.
            // The path is stored the way the page must ask for it: relative to
            // the game root, so the pack's own outer folder is not part of it.
            // That is the same rule images follow, see `gameRelativePath`.
            const full = gameRelativePath((mod.dir ? `${mod.dir}/` : "") + String(path));
            const category = cat.toUpperCase();
            if (!this.sounds[category]) this.sounds[category] = {};
            this.sounds[category][slot] = full;
          }
        }
      }
    }

    for (const mod of mods) {
      for (const rul of mod.rul) {
        const extra = rul?.extraSprites;
        if (!extra) continue;
        // Modern rulesets list packs in an array and use `delete` to drop a
        // whole pack; the old object form keyed by type is kept for
        // compatibility with hand-written data
        const entries: YamlObject[] = Array.isArray(extra)
          ? (extra as YamlObject[])
          : Object.entries(extra as YamlObject).map(([type, def]: [string, YamlValue]) => ({
              type,
              ...(def as YamlObject),
            }));

        for (const def of entries) {
          if (def == null || typeof def !== "object") continue;

          if (typeof def.delete === "string") {
            delete this.sprites[def.delete];
            const table = this.obs[obsTables[def.delete]];
            if (table) table.length = 0;
            continue;
          }

          if (typeof def.typeSingle === "string") {
            new Sprite({
              typeSingle: def.typeSingle,
              dir: mod.dir,
              fileSingle: typeof def.fileSingle === "string" ? def.fileSingle : undefined,
              files: def.files as unknown as { [key: string]: string } | string[] | undefined,
            });
            continue;
          }

          if (typeof def.type !== "string") continue;

          const obs = obsTables[def.type];
          if (obs && def.files != null && typeof def.files === "object") {
            // A known obs table (BIGOBS.PCK, BASEBITS.PCK...) is replaced frame
            // by frame; `files` is a sparse index -> image map
            for (const [ind, file] of Object.entries(def.files as YamlObject))
              new Sprite({ type: obs, ind, dir: mod.dir, fileSingle: file as string });
          }

          new Sprite({
            ...(def as unknown as ConstructorParameters<typeof Sprite>[0]),
            dir: mod.dir,
          });
        }
      }
    }

    this.deleteModDirs();

    this.parseArticles(this.raw.ufopaedia);

    for (const [typeName, typeConstructor] of Object.entries(entryConstructors) || []) {
      this.parseType(typeName, typeConstructor);
    }

    // Music is a lookup table, not a set of pages: a track has no stats worth
    // its own article, and 71 of them would add a section of near-empty pages.
    // It is parsed here so `Val` can turn a bare id into a name and a path.
    this.parseMusics();

    /**
     * Item ids a set of alien-deployment blocks can drop: the `items` keys plus
     * whatever the `randomizedItems` groups offer.
     */
    function blockItems(blocks: unknown) {
      if (blocks == null) return [];
      const flat = Object.values(blocks as object).flat() as {
        randomizedItems?: { itemList?: string[] }[];
        items?: { [item: string]: number };
      }[];
      const x = flat.flatMap((b) => b.randomizedItems || []).flatMap((c) => c?.itemList || []);
      const y = flat.flatMap((b) => (b.items ? Object.keys(b.items) : []));
      return [...x, ...y];
    }

    crosslink(this.eventScripts, "_xcomBaseInCountryTrue", "countries", "events");
    crosslink(this.units, "race", "alienRaces", "hasThisRace");
    crosslink(this.units, "rank", "alienRanks", "hasThisRank");
    crosslink(this.alienRaces, "members", "units", "memberOf");
    crosslink(
      this.soldierTransformation,
      "forbiddenPreviousTransformations",
      this.soldierTransformation,
      "blocksTransformations",
    );
    crosslink(this.alienDeployments, "loot", this.items, "loot");
    crosslink(this.alienDeployments, "enviroEffects", this.enviroEffects, "deployments");
    crosslink(this.craftWeapons, "weaponType", this.weaponTypes, "weapons", "weaponTypes");
    crosslink(this.crafts, "allWeaponTypes", this.weaponTypes, "crafts", "weaponTypes");
    crosslink(this.alienDeployments, "startingCondition", this.startingConditions, "deployments");
    crosslink(this.missionScripts, "researchNeeded", this.research, "unlocksMissions");
    crosslink(this.missionScripts, "researchForbidden", this.research, "stopsMissions");
    crosslink(
      this.alienMissions,
      (t) =>
        // `raceWeights` is month -> weighted race ids, see `WeightedOptions`
        // in the game source and `RuleAlienMission.json` in the schemas
        Object.values(
          (t.raceWeights || {}) as { [month: string]: { [race: string]: number } },
        ).flatMap((w) => Object.keys(w)),
      "alienRaces",
      "missions",
    );
    crosslink(
      this.ufos,
      (t) =>
        blockItems((t.battlescapeTerrainData as { mapBlocks?: unknown } | undefined)?.mapBlocks),
      this.items,
      "ufos",
    );
    crosslink(this.terrains, (t) => blockItems(t.mapBlocks), this.items, "terrains");
    crosslink(this.terrains, "civilianTypes", this.units, "terrains");
    crosslink(this.items, "spawnUnit", this.units, "spawnedBy");
    crosslink(this.items, "internalBattleType", "battleTypes", "items");
    crosslink(this.items, "supportedInventorySections", "inventorySections", "items");
    crosslink(this.commendations, "damageTypes", this.damageTypes, "commendations");

    // An enviro effect deals its conditions' damage through the weapon or ammo
    // item: the engine fires that item's own `damageType` at the unit
    // (`Battlescape/NextTurnState.cpp`), so the effect's damage types are
    // exactly what its `weaponOrAmmo` items declare. They are computed once
    // here so the effect carries the forward list and the damage type carries
    // the back list, the same way a commendation's `damageTypes` do.
    for (const t of Object.values(this.enviroEffects)) {
      const conditions = t.environmentalConditions as
        | { [faction: string]: { weaponOrAmmo?: unknown } }
        | undefined;
      if (conditions == null) continue;
      const ids = new Set<string>();
      for (const c of Object.values(conditions)) {
        const weaponId = c?.weaponOrAmmo;
        if (typeof weaponId !== "string") continue;
        const item = this.items[weaponId];
        if (item == null) continue;
        const idx = damageTypeIndex(
          // An item with no stated `damageType` deals high-explosive damage in
          // the engine (`RuleItem.cpp`), so the same default applies here.
          item.damageType ?? 3,
        );
        if (idx != null) ids.add(damageTypes[idx]);
      }
      if (ids.size) t.damageTypes = [...ids];
    }
    crosslink(this.enviroEffects, "damageTypes", this.damageTypes, "enviroEffects");
    crosslink(this.events, "researchList", this.research, "events");
    crosslink(this.armors, "builtInWeapons", this.items, "builtIn");
    crosslink(this.armors, "specialWeapon", this.items, "builtIn");
    crosslink(this.eventScripts, "_relatedEvents", this.events, "relatedScripts");
    crosslink(this.eventScripts, "_relatedResearch", this.research, "relatedScripts");
    crosslink(this.manufacture, "spawnedPersonType", this.soldiers, "manufacture");
    crosslink(this.events, "spawnedPersonType", this.soldiers, "events");
    crosslink(this.missionScripts, "_missions", this.alienMissions, "scripts");
    crosslink(this.alienDeployments, "terrains", this.terrains, "alienDeployments");
    crosslink(this.terrains, "enviroEffects", this.enviroEffects, "terrains");

    // Every commendation stage is a `soldierBonuses` entry, so a bonus page
    // otherwise shows nothing but its own stats
    crosslink(this.commendations, "soldierBonusTypes", this.soldierBonuses, "commendations");
    crosslink(
      this.soldierTransformation,
      "soldierBonusType",
      this.soldierBonuses,
      "transformations",
    );
    crosslink(this.soldierTransformation, "allowedSoldierTypes", this.soldiers, "transformations");

    // `craftWeapons` and `events` are the same article ids as `items`, so these
    // can stay separate from the existing `builtIn` and `loot` lists
    crosslink(this.craftWeapons, (t) => [t.clip, t.launcher].flat(), this.items, "craftWeapons");
    crosslink(this.armors, "corpseBattle", this.items, "corpseOf");
    // `corpseGeo` is the geoscape drop of the corpse, but a dismantled armor
    // (`_UC` in Piratez) lists the parts it yields here instead, so this is not
    // always a corpse and must not share `corpseOf`
    crosslink(this.armors, "corpseGeo", this.items, "salvagedFrom");
    crosslink(this.events, (t) => [t.randomItemList, t.everyItemList].flat(), this.items, "events");

    // A wave's `ufo` may also name a deployment, and `dummy` exists in no table
    // at all; only the real UFOs get a link, the rest would become stub pages
    crosslink(
      this.alienMissions,
      (t) =>
        ((t.waves ?? []) as { ufo?: string }[])
          .map((w) => w?.ufo)
          .filter((id): id is string => !!id && !!this.ufos[id]),
      this.ufos,
      "missions",
    );
    crosslink(this.alienMissions, "interruptResearch", this.research, "stopsMissions");

    crosslink(this.alienDeployments, "customUfo", this.ufos, "deployments");
    crosslink(this.alienDeployments, "unlockedResearch", this.research, "deployments");
    crosslink(this.alienDeployments, "script", this.mapScripts, "deployments");
    crosslink(this.terrains, "script", this.mapScripts, "terrains");

    // The `requires` of a soldier type, craft or transformation is a research
    // entry whose id often equals the entry itself, so the name says what the
    // target is rather than reusing a label that already means something else.
    // A reference to one's own id is kept: the two entries are distinct, and
    // `Val` draws it as plain text rather than a link to the page being read.
    crosslink(this.soldiers, "requires", this.research, "soldierTypes");
    crosslink(this.crafts, "requires", this.research, "craftTypes");
    crosslink(this.facilities, "requires", this.research, "facilityTypes");
    crosslink(this.soldierTransformation, "requires", this.research, "transformations");

    if (rul.attacks?.length > 0) new Section("ATTACKS", true);

    const all: { [option: string]: string[] } = {
      Armors: Object.values(this.armors)
        .filter((a) => a.units)
        .map((a) => a.uid),
      SoldierTypes: Object.keys(rul.soldiers),
      Vehicles: Object.keys(rul.units).filter((k) => rul.items[k]?.battleType === 3),
      Craft: Object.keys(rul.crafts),
    };

    for (const sc of Object.values(this.startingConditions)) {
      if (sc.forbiddenSoldierTypes?.length) {
        const forbiddenSoldierTypes = new Set(sc.forbiddenSoldierTypes);
        sc.allowedSoldierTypes = Object.keys(rul.soldiers).filter(
          (st) => !forbiddenSoldierTypes.has(st),
        );
      }

      sc.allowedSoldierTypes ||= all.SoldierTypes;
      sc.allowedArmors ||= all.Armors;

      if (sc.forbiddenArmors?.length) {
        const forbiddenArmors = new Set(sc.forbiddenArmors);
        sc.allowedArmors = all.Armors.filter((a) => !forbiddenArmors.has(a));
      }

      const armorsAllowedForSoldiers = new Set();
      for (const st of sc.allowedSoldierTypes)
        for (const a of rul.soldiers[st].armors || [rul.soldiers[st].armor] || [])
          armorsAllowedForSoldiers.add(a);

      sc.allowedArmors = sc.allowedArmors.filter((a) => armorsAllowedForSoldiers.has(a));
    }

    for (const option of [
      ["Craft", this.crafts],
      ["SoldierTypes", this.soldiers],
      ["Vehicles", this.units],
      ["Armors", this.armors],
    ] as [string, { [key: string]: Craft | Soldiers | Unit | Armor }][]) {
      for (const sc of Object.values(this.startingConditions)) {
        if (sc[`allowed${option[0]}`])
          sc[`forbidden${option[0]}`] = all[option[0]].filter(
            (e: string) => !(sc[`allowed${option[0]}`] as string[]).includes(e),
          );
      }
      crosslink(this.startingConditions, `allowed${option[0]}`, option[1], "allowedIn");
      crosslink(this.startingConditions, `forbidden${option[0]}`, option[1], "forbiddenIn");
    }

    for (const c of Object.values(this.commendations)) {
      c.parseKillCriteria();
    }

    for (const facility of Object.values(this.facilities)) {
      if (facility.buildCostItems) {
        for (const itemName of Object.keys(facility.buildCostItems)) {
          const item = rul.items[itemName];
          if (!item) continue;
          if (!item.componentOf) item.componentOf = {};
          item.componentOf[facility.type] = facility.buildCostItems[itemName].build;
          if (!item.manufacture) item.manufacture = {};
          item.manufacture[facility.type] = facility.buildCostItems[itemName].refund;
        }
      }
    }

    for (const item of Object.values(this.items)) {
      for (const ammoId of item.compatibleAmmo || []) {
        const ammo = this.items[ammoId];
        if (ammo) {
          ammo.compatibleWeapons = ammo.compatibleWeapons || [];
          ammo.compatibleWeapons.push(item.type);
        }
      }
      for (const rb of item.requiresBuy || []) {
        const r = this.research[rb];
        if (r) {
          r.allowsBuying = [...(r.allowsBuying || []), item.type];
        }
      }
    }

    for (const research of [...Object.values(this.research)]) {
      backLink(research.name, research.dependencies ?? null, rul.research, "leadsTo");
      backLink(research.name, research.getOneFree ?? null, rul.research, "freeFrom");

      if (research.lookup && research.name !== research.lookup && this.research[research.lookup]) {
        const lookup = this.research[research.lookup];
        lookup.seeAlso = lookup.seeAlso || [];
        lookup.seeAlso.push(research.name);
        const lookUpArticle = this.article(research.lookup);
        const article = this.article(research.name);
        if (!rul.lang[article.id]) article._title = lookUpArticle._title;
        article._text = lookUpArticle._text;
        article.image_id = lookUpArticle.image_id;
      }
      if (research.spawnedItem) {
        const item = rul.items[research.spawnedItem];
        // A pack can be a submod of a master it does not ship, so a reference
        // can point at an item only the missing master defines. The recipe is
        // then simply out of scope for this pedia, the same way `crosslink`
        // skips links it cannot resolve.
        if (!item) continue;
        item.spawnedBy = item.spawnedBy || [];
        item.spawnedBy.push(research.name);
      }
    }

    this.ourArmors = Object.values(this.armors)
      .filter((a) => a.units)
      .map((a) => a.type);

    for (const cat of Object.keys(this.categories)) {
      if (this.categories[cat].length) Article.create(cat, "CATEGORIES");
    }

    for (const cat of Object.keys(this.manufactureCategories)) {
      if (this.manufactureCategories[cat].length) Article.create(cat, "MANUFACTURE_CATEGORIES");
    }
  }

  /**
   * Where marker `num` of the `GlobeMarkers` sheet lives, or `undefined` when
   * the pack has no such sheet or not that many markers.
   *
   * The sheet is an ordinary subdivided sprite (`subX`/`subY` cells, left to
   * right then top to bottom), so the cell is worked out by `frameSource` and
   * cropped by `Img`; no canvas or slicing is involved. Marker numbers count the
   * same way in the game, see `Globe::drawMarker`.
   */
  globeMarker(num: number) {
    return this.sprites.GlobeMarkers?.frameSource(num);
  }

  /** Sections that hold generated entries (items, units...) sorted by name */
  sortedTypeSections() {
    return this.sortStringsAndNumbers(this.typeSectionsOrder.map((s) => s.id)).map(
      (id) => this.sections[id],
    );
  }

  /**
   * The categories in the order the menus show them and `<`/`>` walks them.
   *
   * Only this list follows the `A-Z` toggle: the pedia's own sections keep the
   * pack's declared order either way, because that order is authored (it groups
   * related pages) while the categories are just the generated entry tables.
   */
  typeSectionOrder(alphabetical = false) {
    return alphabetical ? this.sortedTypeSections() : this.typeSectionsOrder;
  }

  /**
   * Every section, in the order the menus show it and `<`/`>` walks it.
   *
   * Everything that lists or steps through sections goes through here, so the
   * navbar, the landing page and the arrows cannot disagree about what comes
   * next. See `typeSectionOrder` for what the toggle affects.
   */
  sectionOrder(alphabetical = false) {
    return [...this.sectionsOrder, ...this.typeSectionOrder(alphabetical)];
  }

  parseArticles(data: YamlValue) {
    if (data == null || typeof data !== "object") return;
    for (const articleData of Object.values(data)) {
      if (articleData != null && typeof articleData === "object" && !Array.isArray(articleData)) {
        const block = articleData as YamlObject;
        if (!block.id) continue;
        const article = new Article(block as unknown as ConstructorParameters<typeof Article>[0]);
        this.articlesOrder.push(article);
        this.articles[article.id] = article;
      }
    }
  }

  /**
   * The article `<`/`>` goes to from `current`, staying inside `currentSection`.
   *
   * The order is the one the sidebar shows, so stepping through a section reads
   * the same list top to bottom. Running off either end crosses into the
   * neighbouring section *that has articles*: the last article of a section is
   * followed by the next section's first, and its first is preceded by the
   * previous section's last. Both ends wrap, so the pedia is a ring.
   *
   * The section comes back with the article because the caller has to keep
   * browsing *there*: the article it lands on usually belongs to several
   * sections, and guessing from `article.sections[0]` would drop the reader into
   * whichever one happened to be declared first.
   *
   * A section's own page (`current.id == section.id`) is the header above the
   * list rather than a row in it, so it steps to the neighbouring section's page,
   * which is what the old pedia did.
   */
  nearbyArticle(
    current: Article | undefined,
    delta: number,
    currentSection: Section | undefined,
    alphabetical = false,
  ): { article: Article; section: Section } | undefined {
    if (!current) return undefined;
    const section = currentSection ?? current.sections[0];
    if (!section) return undefined;

    if (current.id === section.id) {
      const neighbour = section.adjacentSection(delta, alphabetical);
      // `this` only when no section has an article at all
      if (neighbour === section) return undefined;
      const page = this.article(neighbour.id);
      return page && { article: page, section: neighbour };
    }

    const list = section.articles(alphabetical);
    const index = list.findIndex((a) => a.id === current.id);
    // An article reached through a redirect can sit in a section that does not
    // list it, so there is no row to step from and the page has to stay put
    if (index === -1) return undefined;

    const nextIndex = index + delta;
    if (nextIndex >= 0 && nextIndex < list.length) return { article: list[nextIndex], section };

    // Off an end: step into the next section and take the article at the end of
    // its list that the walk is heading towards
    const neighbour = section.adjacentSection(delta, alphabetical);
    if (neighbour === section) return undefined;
    const neighbourList = neighbour.articles(alphabetical);
    return { article: delta < 0 ? util.last(neighbourList) : neighbourList[0], section: neighbour };
  }

  sortArticlesByName(list: Article[]) {
    return this.sortStringsAndNumbers(list.map((a) => a.id)).map((id) => this.articles[id]);
  }

  str(id: string) {
    return this.lang[id] || id;
  }

  icon(name?: string) {
    if (name == null) return null;
    return this.langs?.icon ? this.langs.icon[name] : null;
  }

  hasSprite(id: string) {
    return this.sprites[id];
  }

  async sprite(id: string | Promise<string>, onlyIfExists = false) {
    if (id instanceof Promise) return id;
    if (id in this.sprites) return this.sprites[id].data();

    return onlyIfExists ? null : id;
  }

  /**Orders mods and merges languages*/
  static preprocessMods(mods: { [modName: string]: Mod }, disabled?: Set<string>) {
    const modOrder = Ruleset.activeMods(Object.values(mods), disabled);

    const langs: { [langName: string]: { [id: string]: string } } = {};

    for (const mod of modOrder) {
      for (const lname in mod.lng) {
        langs[lname] ||= {};
        Object.assign(langs[lname], mod.lng[lname]);
      }
      // The language table has been merged into `langs`, so the per-mod copy is
      // dropped to keep a large pack from holding it twice
      delete (mod as { lng?: Mod["lng"] }).lng;
    }
    for (const lname in langs) {
      // `icon` is not a spoken language: it maps field names to emoji. Folding
      // the English strings into it would make every icon look like an English
      // label, so `Tr` would draw that label next to the translated one.
      if (lname === "icon") continue;
      langs[lname] = { ...langs[defaultLanguage], ...langs[lname] };
    }

    return { mods: modOrder, langs };
  }

  /**
   * Picks the mods OpenXcom would actually load, in the order it loads them.
   *
   * OpenXcom activates exactly one master mod and then the mods that depend on
   * that master. A master may chain to a "super" master (`master: xcom1`), which
   * is loaded underneath it. Other masters — most importantly `xcom2` next to
   * `xcom1` — stay off, which keeps the TFTD half of a modpack out of the ruleset.
   *
   * XPedia's own builtin mods are exempt from that filter and always load, so a
   * helper does not have to name the pack's master to be included.
   *
   * `active` is read from the pack's `user/options.cfg` by the caller and passed
   * in as `disabled`; it is not a `metadata.yml` field. Only the dynamics of it
   * belong here: a mod the player switched off is dropped, while a base master
   * one of the enabled mods still depends on is kept — see `dependency`.
   *
   * Order is the merge order: later mods override earlier ones.
   */
  static activeMods(all: Mod[], disabled?: Set<string>): Mod[] {
    /** Metadata id, falling back to the folder name like `ModInfo` does */
    const idOf = (mod: Mod) => mod.meta?.id ?? mod.dir.split(/[/\\]/).pop();

    const byId: { [id: string]: Mod } = {};
    for (const mod of all) {
      const id = idOf(mod);
      if (id && !(id in byId)) byId[id] = mod;
    }

    /**
     * True for the mods the player themselves left on.
     *
     * The builtins and `common` count as on: they are not something a pack
     * installs or enables, so a player's list cannot speak about them.
     */
    const chosen = (mod: Mod) => {
      const id = idOf(mod);
      return id === undefined || !disabled?.has(id);
    };

    // The chain of the deepest master the player kept. A pack can ship several
    // masters (`xcom1` next to `xcom2`), and only the one that is switched on
    // decides what the rest of the list belongs to.
    const masters = all.filter((mod) => mod.meta?.isMaster);
    const keptMasters = masters.filter(chosen);
    const activeMaster = keptMasters.length ? deepest(keptMasters) : deepest(masters);

    function depth(mod: Mod, seen = new Set<string>()): number {
      const id = idOf(mod);
      if (!id || seen.has(id)) return 0;
      seen.add(id);
      const parent = mod.meta?.master ? byId[mod.meta.master] : undefined;
      return parent ? depth(parent, seen) + 1 : 0;
    }

    /** Deepest first: a mod chaining to `xcom1` beats `xcom1` */
    function deepest(list: Mod[]) {
      // A total conversion lives in `user/mods`, while `standard` holds the base
      // game masters and optional tweaks; prefer the former
      const userMasters = list.filter((mod) => !/[/\\]standard[/\\]/i.test(mod.dir));
      return (userMasters.length ? userMasters : list).sort((a, b) => depth(b) - depth(a))[0];
    }

    /**
     * The chain from a master down to the base game, in load order.
     *
     * An inactive master in the middle is still loaded, which is what the game
     * does: `FileMap::setup` walks up from every enabled mod through its
     * `master` links without consulting the flag. Those mods are marked as a
     * dependency so the pedia can tell them apart from the player's own choice.
     */
    const chain: Mod[] = [];
    const chainSeen = new Set<string>();
    for (let mod: Mod | undefined = activeMaster; mod; ) {
      const key = idOf(mod) ?? "";
      if (chainSeen.has(key)) break;
      chainSeen.add(key);
      chain.unshift(mod);
      mod = mod.meta?.master ? byId[mod.meta.master] : undefined;
    }
    for (const mod of chain) if (!chosen(mod)) mod.dependency = true;

    const masterId = activeMaster ? idOf(activeMaster) : undefined;

    /** Whether a builtin mod is the per-pack helper rather than XPedia's base */
    const isHelper = (mod: Mod) => /^xhelper-/i.test(mod.dir.split(/[/\\]/).pop() ?? "");

    /** Sorting key: `[group, position within the group]` */
    const order = (mod: Mod): [number, number] => {
      if (mod.common) return [0, 0];
      // Builtin mods belong to XPedia, not to the pack, and exist to fill the
      // gaps in the pack's own text. They therefore go underneath every mod the
      // pack brought, so a string the pack translates always wins. XPedia's
      // shared base goes before the per-pack helper, which then overrides it.
      if (mod.builtin) return [1, isHelper(mod) ? 1 : 0];
      // A pack mod naming a master the pack does not contain cannot be placed by
      // the chain. It is the one the pack is about, or a dependency of it, so it
      // goes after the builtins but still underneath the chain's own order.
      if (mod.meta?.master && !byId[mod.meta.master]) return [2, 0];
      const i = chain.indexOf(mod);
      if (i >= 0) return [3, i];
      return [4, 0];
    };

    const active = all.filter((mod) => {
      if (mod.common || chain.includes(mod)) return true;
      // Builtin mods ship inside XPedia, so they are always loaded: they are not
      // something a pack installs or enables, and their metadata must not have to
      // name the pack's master to survive the filter below. This is also what
      // lets the per-pack helper be declared against XPedia's own base.
      if (mod.builtin) return true;
      if (!mod.meta || Object.keys(mod.meta).length === 0) return true;
      // What the player switched off in the game's own mod list. Only the mods
      // that nothing enabled depends on get this far, so a disabled master is
      // still loaded above through the chain.
      if (!chosen(mod)) return false;
      // A pack can be a single mod packed on its own rather than a whole
      // OpenXcom install: `Final Mod Pack/metadata.yml` declares `master: xcom1`
      // and is not a master itself, because xcom1 ships with the game. With no
      // master inside the pack there is nothing to filter against, and the mod
      // the user uploaded is the one they want to read, so load everything.
      if (!masterId) return true;
      // Dependants of the active master only; this drops xcom2's TFTD mods
      return mod.meta.master === masterId;
    });

    return active.sort((a, b) => {
      const [ga, pa] = order(a),
        [gb, pb] = order(b);
      return ga - gb || pa - pb;
    });
  }

  loadProcessedMods(data: ProcessedRuleset) {
    this.meta = mainMod(data.mods ?? [])?.meta ?? {};
    this.mods = data.mods ?? [];
    this.resourceMap = data.resources ?? {};
    this.langs = data.langs ?? {};
    this.langNames = Object.keys(this.langs)
      // `icon` is an emoji map, and a language whose file produced no strings
      // at all would be a dead, blank entry in the dropdown
      .filter(
        (name) =>
          name !== "icon" && this.langs[name] != null && typeof this.langs[name] === "object",
      )
      .sort((a, b) => langWeight(b) - langWeight(a));

    function langWeight(name: string) {
      // The default language always leads the list, whatever its size
      if (name === defaultLanguage) return Infinity;
      return Object.keys(data.langs?.[name] ?? {}).length;
    }

    // Language buttons are labelled with a country flag
    for (const name of this.langNames) {
      if (!this.langs[defaultLanguage][name]) {
        const country = name.match(/([a-z]+)/i);
        const flag = country?.length ? getFlagEmoji(country[1]) : undefined;
        if (flag) this.langs[defaultLanguage][name] = flag;
      }
    }

    this.parseRuls(data.mods ?? []);
    this.selectLang(defaultLanguage);
  }

  selectLang(name: string) {
    if (!this.langs[name]) {
      console.warn(`No ${name} in this pack, staying on ${this.langName ?? defaultLanguage}`);
      return false;
    }

    this.langName = name;

    if (name === defaultLanguage) {
      this.lang = this.langs[defaultLanguage];
    } else {
      this.convertLang(name);
      this.lang = { ...this.langs[defaultLanguage], ...this.langs[name] };
    }

    if (!this.search[name]) this.search[name] = new Search();

    return true;
  }

  /** Full text search over the current language's article index */
  findArticles(query: string) {
    if (this.langName == null) return undefined;
    const search = this.search[this.langName];
    return search?.findArticles(query);
  }

  bodiesCompare(strs: string[]) {
    for (const i in strs) {
      if (strs[i].length === 2)
        strs[i] = `${strs[i].charAt(0) === "M" ? "A" : "B"}0${strs[i].substr(1)}`;
    }
    return strs[0] > strs[1] ? 1 : -1;
  }

  article(id: string) {
    const redirect = this.redirect[id];
    const a = (redirect && this.articles[redirect]) || this.articles[id];
    return a;
  }

  /** Sort strings by their translated values */
  sortStringsAndNumbers(s: string[]) {
    let tl: [string, string][] = s.map((s) => [s, this.tr(s) ?? s]);
    tl = tl.sort((a, b) => comparator(a[1], b[1]));
    return tl.map((a) => a[0]);
  }
  /*sortIds(s: {id:string}[]) {
    return this.sortStrings(s.map(v=>v.id)).map(v=?);
  }*/
}

/**
 * Collator for every name sort in the pedia.
 *
 * `localeCompare` with an options object constructs a collator on each call, and
 * a section sort makes thousands of them: the 2904-article `RESEARCH` section
 * cost ~90 ms, almost all of it in collator setup rather than comparison. One
 * shared collator with the same options gives an order that is identical to the
 * `localeCompare` call it replaces and costs a fraction of that.
 *
 * `numeric` keeps "Clip 2" before "Clip 10"; `sensitivity: "base"` makes case
 * and accents not decide the order, so a pack's own capitalisation does not
 * scatter its entries.
 */
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function comparator(a: unknown, b: unknown) {
  return nameCollator.compare(String(a ?? ""), String(b ?? ""));
}

/** Main class to figure what to do with data in Ruls */
export const entryConstructors: {
  [collection: string]: new (raw: RawEntry, collection: string) => Entry;
} = {
  items: Item,
  // Before `armors`: an `Armor` pushes itself into `rul.soldiers[unit].armors`
  // for every crew type it lists, so those crew types have to exist by then.
  // This is also the order the old ruleset parsed them in.
  soldiers: Soldiers,
  armors: Armor,
  units: Unit,
  crafts: Craft,
  craftWeapons: CraftWeapon,
  facilities: Facility,
  events: EventEntry,
  eventScripts: EventScript,
  soldierTransformation: SoldierTransformation,
  startingConditions: StartingConditions,
  missionScripts: MissionScript,
  alienDeployments: AlienDeployment,
  research: Research,
  manufacture: Manufacture,
  damageTypes: DamageType,
  // Before `commendations`: a `Commendation` looks up its stages in
  // `rul.soldierBonuses` while it is being constructed, so the bonuses have to
  // exist by then
  soldierBonuses: SoldierBonus,
  commendations: Commendation,

  ufos: SimpleEntry,
  battleTypes: SimpleEntry,
  alienRaces: SimpleEntry,
  countries: SimpleEntry,
  weaponTypes: SimpleEntry,
  enviroEffects: SimpleEntry,
  terrains: SimpleEntry,
  mapScripts: SimpleEntry,
  stats: SimpleEntry,
  alienMissions: SimpleEntry,
  // Regions and trajectories are real pages: a region is what a mission targets
  // and a trajectory is the path its UFOs fly, and both are referenced from
  // fields that render as plain text today
  regions: Region,
  ufoTrajectories: UfoTrajectory,
  // The raw table is called `invs`, so the constructor is registered under that
  // name; the entry itself files into `inventorySections`, which is what items
  // crosslink their `supportedInventorySections` to
  invs: InventorySection,
};

/**
 * Extensions the engine will look for next to a music track, from the order it
 * tries them in (`Mod.cpp`, `exts[]`). The player's `preferredMusic` decides
 * which one is used, and it is not in the ruleset, so playback has to try them
 * in turn rather than name a single file.
 */
export const audioExtensions = [".ogg", ".flac", ".mp3", ".mod", ".wav", ".mid"];

/** The CAT file a sound field's slot indexes into, from the ruleset reference */
export const soundCatOf: { [field: string]: string } = {
  hitSound: "BATTLE.CAT",
  fireSound: "BATTLE.CAT",
  placeSound: "GEO.CAT",
  alertSound: "GEO.CAT",
  selectBaseSound: "GEO.CAT",
  selectSound: "GEO.CAT",
  startDogfightSound: "GEO.CAT",
  takeoffSound: "GEO.CAT",
};

/**
 * The CAT a sound field reads from, given the collection the entry is in.
 *
 * `hitSound` and `fireSound` are the awkward ones: the same name means a
 * battlescape sound on an item and a geoscape sound on a facility or a UFO.
 */
export function soundCat(field: string, collection?: string) {
  if (
    (field === "hitSound" || field === "fireSound") &&
    (collection === "facilities" || collection === "ufos")
  )
    return "GEO.CAT";
  return soundCatOf[field] ?? "BATTLE.CAT";
}

/**
 * The ids inside a weighted table.
 *
 * The engine's weighted lists are sparse maps from a month (or difficulty) to a
 * set of ids, written as `{ 0: {...}, 3: {...} }`; the modern array form is also
 * accepted. Only the ids matter here, since the pedia shows who can be chosen
 * rather than how the odds evolve over time.
 */
export function regionNamesOf(weights: unknown) {
  const out = new Set<string>();
  if (weights == null || typeof weights !== "object") return out;
  for (const block of Array.isArray(weights) ? weights : Object.values(weights))
    if (block && typeof block === "object" && !Array.isArray(block))
      for (const id of Object.keys(block)) out.add(id);
  return out;
}

export const statsList = [
  "tu",
  "stamina",
  "health",
  "bravery",
  "reactions",
  "firing",
  "throwing",
  "strength",
  "psiStrength",
  "psiSkill",
  "melee",
];

export const damageTypes = [
  "STR_DAMAGE_NONE",
  "STR_DAMAGE_ARMOR_PIERCING",
  "STR_DAMAGE_INCENDIARY",
  "STR_DAMAGE_HIGH_EXPLOSIVE",
  "STR_DAMAGE_LASER_BEAM",
  "STR_DAMAGE_PLASMA_BEAM",
  "STR_DAMAGE_STUN",
  "STR_DAMAGE_MELEE",
  "STR_DAMAGE_ACID",
  "STR_DAMAGE_SMOKE",
  "STR_DAMAGE_10",
  "STR_DAMAGE_11",
  "STR_DAMAGE_12",
  "STR_DAMAGE_13",
  "STR_DAMAGE_14",
  "STR_DAMAGE_15",
  "STR_DAMAGE_16",
  "STR_DAMAGE_17",
  "STR_DAMAGE_18",
  "STR_DAMAGE_19",
  "STR_DAMAGE_20",
  "STR_DAMAGE_21",
  "STR_DAMAGE_22",
  "STR_MANA",
];

export const internalDamageTypes = [
  "DT_NONE",
  "DT_AP",
  "DT_IN",
  "DT_HE",
  "DT_LASER",
  "DT_PLASMA",
  "DT_STUN",
  "DT_MELEE",
  "DT_ACID",
  "DT_SMOKE",
  "DT_10",
  "DT_11",
  "DT_12",
  "DT_13",
  "DT_14",
  "DT_15",
  "DT_16",
  "DT_17",
  "DT_18",
  "DT_19",
];

/**
 * Resolves a damage type to its index in `damageTypes`.
 *
 * Mods write it either as an index (`3`) or as a name (`STR_DAMAGE_ARMOR_PIERCING`,
 * `DT_AP`). Returns null for anything that does not name a known damage type, so
 * callers do not create a bogus entry with an `undefined` id.
 */
export function damageTypeIndex(value: unknown): number | null {
  if (value == null) return null;

  if (typeof value === "string") {
    let idx = damageTypes.indexOf(value);
    if (idx !== -1) return idx;
    idx = internalDamageTypes.indexOf(value);
    if (idx !== -1 && idx < damageTypes.length) return idx;
    // A numeric string is still an index
    if (!/^\d+$/.test(value.trim())) return null;
  }

  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n >= damageTypes.length) return null;
  return n;
}

export const killStatuses = [
  "STATUS_DEAD",
  "STATUS_UNCONSCIOUS",
  "STATUS_PANICKED",
  "STATUS_TURNING",
];
export const killFactions = ["FACTION_HOSTILE", "FACTION_NEUTRAL", "FACTION_PLAYER"];

export const battleTypes = [
  "ammo",
  "melee",
  "snap",
  "aimed",
  "auto",
  "throw",
  "psi",
  "panic",
  "mindControl",
  "use",
];

export const internalBattleTypes = [
  "BT_NONE",
  "BT_FIREARM",
  "BT_AMMO",
  "BT_MELEE",
  "BT_GRENADE",
  "BT_PROXIMITYGRENADE",
  "BT_MEDIKIT",
  "BT_SCANNER",
  "BT_MINDPROBE",
  "BT_PSIAMP",
  "BT_FLARE",
  "BT_CORPSE",
];

export const battleStats = ["time", "energy", "morale", "health", "stun", "mana"];

export { entryKey, rawId, stampUid, unknownIdFields } from "./Entry";

export function backLink2(
  entry: Entry,
  list: string[] | { [key: string]: unknown },
  to: { [id: string]: Entry } | string,
  field: string,
  field2: string,
) {
  backLink(entry.uid, list, to, field);
  addAllIfNew<unknown>(entry[field2] as unknown[], list);
}

export function backLink(
  id: string,
  list: unknown,
  to: { [id: string]: Entry } | string,
  field: string,
  collection?: string,
) {
  if (typeof to === "string") {
    collection = to;
    // Tables are registered on `rul` under their collection name, so the lookup
    // and the fallback both have to use it rather than the overwritten `to`
    const tables = rul as unknown as { [collection: string]: { [id: string]: Entry } };
    to = tables[collection];
    if (!to) to = tables[collection] = {};
  }
  if (list == null) return;
  if (typeof list === "object" && !Array.isArray(list)) {
    for (const key of Object.keys(list)) {
      let back = to[key];
      if (back == null && collection != null) {
        back = to[key] = new (entryConstructors[collection] || SimpleEntry)(
          { id: key },
          collection,
        );
      }
      if (back == null) continue;
      addFields(back, field, { [key]: (list as { [key: string]: unknown })[key] });
    }
  } else {
    if (!Array.isArray(list)) list = [list];

    for (const key of list as string[]) {
      // A missing key used to create an entry with an `undefined` id, which
      // then showed up as a blank article in a section
      if (key == null || key === "") continue;
      let back = to[key];
      if (back == null && collection != null)
        back = to[key] = new Entry(collection).from({ id: key });
      if (back == null) continue;
      addFields(back, field, [id]);
    }
  }
}

function addFields(entry: Entry, field: string, list: string[] | { [key: string]: unknown }) {
  if (entry == null || field == null || list == null) return;
  if (Array.isArray(list)) {
    entry[field] = entry[field] || [];
    for (const id of list) {
      const values = entry[field] as string[];
      if (values.indexOf(id) === -1) values.push(id);
    }
  } else {
    entry[field] = { ...(entry[field] || {}), ...list };
  }
}

/** Adds back links */
function crosslink(
  collection1: { [id: string]: Entry },
  prop1: string | ((v: Entry) => unknown),
  // A collection is either the table itself or the name of one on `rul`, which
  // `backLink` looks up; the named form is how the base-game tables are reached
  collection2: { [id: string]: Entry } | string,
  prop2: string,
  prefix?: string,
) {
  const f = typeof prop1 === "function" ? prop1 : (t: Entry) => t[prop1];
  for (const t of [...Object.values(collection1)] as Entry[]) {
    backLink(t.uid, f(t), collection2, prop2, prefix);
  }
}

export function stripPediaMarkup(t: string) {
  if (t != null && t.indexOf("{") !== -1) {
    t = t.replace(/\{NEWLINE\}/g, "\n");
    t = t.replace(/^\s+/g, "");
    t = t.replace(/\{[^}]+\}/g, " ");
  }
  return t;
}
