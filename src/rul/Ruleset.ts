//@ts-ignore
import SearchApi from 'js-worker-search';
import { addAllIfNew, capital, getFlagEmoji, gameRelativePath } from '../util';
import * as util from "../util"
import { Section } from './Section';
import { Sprite } from './Sprite';
import { Article } from './Article';
import { EventEntry, Commendation, DamageType, Entry, EventScript, Manufacture, Music, MissionScript, Research, Soldiers, SoldierBonus, SoldierTransformation, AlienDeployment, Armor, Attack, Craft, CraftWeapon, Facility, Item, StartingConditions, Unit, SimpleEntry, Region, UfoTrajectory, InventorySection } from './Entry';
import { emptyImg } from '../imgPlaceholders';

export let rul!: Ruleset;
export type SortFirstLastOptions = { first?: string[], last?: string[], exclude?: string[], sortBy?: Function }
type StringValue = [string, any]
export const defaultLanguage = "en-US"

export const obsTables: { [pck: string]: string } = { "BIGOBS.PCK": "big", "FLOOROB.PCK": "floor", "HANDOB.PCK": "hand", "BASEBITS.PCK": "base", "INTICON.PCK": "icon" };

export type Mod = {
  lng: { [langName: string]: { [id: string]: string } }
  meta: { id?: string, master?: string, isMaster?: boolean, active?: boolean, name?: string, version?: string, [key: string]: any }
  dir: string,
  rul: any[]
  /** The shared `common` folder: languages and resources used by every mod */
  common?: boolean
  /** Files that came from the builtin mods rather than from the uploaded pack */
  builtin?: boolean
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
  let masters = mods.filter(m => m.meta?.isMaster)
  let chained = masters.filter(m =>
    m.meta?.master && mods.some(o => (o.meta?.id ?? o.dir) == m.meta!.master))
  let master = (chained.length ? chained : masters).slice(-1)[0]
  if (master)
    return master;

  let own = mods.filter(m => !m.common && !/^mods[/\\]/i.test(m.dir) && m.meta?.name)
    .sort((a, b) => (b.rul?.length ?? 0) - (a.rul?.length ?? 0))
  return own[0];
}

/** `[key, value]` pairs for the named fields, in the given order */
function orderedFilteredEntries(item: { [key: string]: any }, fields?: string[]): StringValue[] {
  if (item == null)
    return [];
  return fields ? fields.map(key => item[key] != null ? [key, item[key]] as StringValue : null).filter(v => v != null) : [];
}

/**
 * Sorts item's keys, putting "first" first, "last" last, excluding "exclude" and using "sortBy" function
 * returns lists of key-value pairs
 * "misc" in return is everything that is not "first" or "last"
 */
export function sortFirstLast(item: { [key: string]: any }, options: SortFirstLastOptions = {}): { first: StringValue[], misc: StringValue[], last: StringValue[], exclude: StringValue[], all: StringValue[] } {
  if (item == null)
    return { all: [], first: [], misc: [], last: [], exclude: [] };

  if (options.exclude) {
    if (options.first)
      options.first = util.exclude(options.first, options.exclude);
    if (options.last)
      options.last = util.exclude(options.last, options.exclude);
  }

  let first = orderedFilteredEntries(item, options.first);
  let last = orderedFilteredEntries(item, options.last);
  let exclude = orderedFilteredEntries(item, options.exclude);
  let special = new Set([...(options.first || []), ...(options.last || []), ...(options.exclude || []), "id", "list", "name", "collection"]);
  let misc: StringValue[] = Object.entries(item).filter(([k, v]) => !special.has(k));
  let sortBy = options.sortBy;
  if (sortBy) {
    misc = misc.sort((a, b) => sortBy(a[1]) > sortBy(b[1]) ? 1 : -1)
  } else {
    misc = misc.sort((a, b) => comparator(a[0], b[0]))
  }
  let all: StringValue[] = [...first, ...misc, ...last]
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
    for (let a of Object.values(rul.articles)) {
      // The fields are looked up by name: `title` and `text` are getters, and a
      // pack may add others
      let fields = a as { [key: string]: any };
      let texts = ["id", "type", "title", "text"].map(key => `${fields[key]}`.toLowerCase()).join(" ");
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
  [list: string]: any;

  constructor(public id: string) {
    Article.create(id, "SERVICES");
  }

  static add(prop: string, id: string, entries?: string[]) {
    if (entries) {
      for (let s of entries) {
        if (!(s in rul.baseServices)) rul.baseServices[s] = new Service(s);
        if (!(prop in rul.baseServices[s])) rul.baseServices[s][prop] = [];
        rul.baseServices[s][prop].push(id);
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
  raw: any = {};
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
  obs = { big: [], floor: [], hand: [], base: [], icon: [] } as {[id:string]:any[]};
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
  config: any;
  baseServices: { [key: string]: Service } = {};
  redirect: { [key: string]: string } = {};
  attacks: Attack[] = [];

  itemFields = new Set<string>();
  unitFields = new Set<string>();

  meta: any
  lang: { [key: string]: string } = {};
  langs: { [key: string]: { [key: string]: string } } = {};
  /** The mods of the loaded pack, in merge order */
  mods: Mod[] = [];
  langName: string | null = null;
  langNames: string[] = [];
  /** Language names already run through `convertLang` */
  convertedLangs: { [langName: string]: boolean } = {};

  constructor(processed?: {
    mods?: Mod[],
    langs?: any
  }) {
    rul = this;
    if (processed)
      this.loadProcessedMods(processed);
  }

  tr(str?: string | null | undefined, props?: { capital?: boolean, icon?:string}) {
    const bigSnakeCase = /^[A-Z0-9_]+$/;
    if (str == null)
      return null;

    //if(str == "STR_ELECTRO_FLARE")      debugger

    if (str in rul.lang) {
      str = rul.lang[str]
      str = stripPediaMarkup(str);
    } else if (typeof str == "string") {
      if (props?.icon && props?.icon != "none")
        str = null;
      else {
        if (str.substr(0, 4) == "STR_")
          str = str.substr(4);

        if (str.match(bigSnakeCase))
          str = str.replace(/_/g, " ");

        str = str.replace(/([a-z])([A-Z])/g, "$1 $2");
        // A derived label has no translation to preserve, so `capital` still
        // normalises it to lower case; a translated one keeps its own capitals
        // such as "TU" and "CQC"
        if (props?.capital)
          str = str.toLowerCase();
      }
    }


    if (props?.capital)
      str = capital(str);

    return str;
  }

  addCategory(catName: string, id: string, where?: { [cat: string]: string[] }) {
    if (where == null)
      where = rul.categories;
    let cat = where[catName] || [];
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
    let path = typeof trajectory == "string" ? this.ufoTrajectories?.[trajectory] : trajectory;
    if (!path)
      return [];

    let chosen = new Set<string>();
    for (let mission of this.missionsFlying(path.id))
      for (let script of this.scriptsSelecting([mission])) {
        let weights = this.missionScripts?.[script]?.regionWeights;
        let names = regionNamesOf(weights);
        if (names.size)
          for (let name of names) chosen.add(name);
        else
          // No script-level choice means the engine falls back to the table of
          // weighted regions, so every one of those is a possibility
          for (let region of this.weightedRegions()) chosen.add(region);
      }

    // A path nothing selects any more is still a real path; fall back to the
    // zones alone rather than showing a page that cannot draw anything
    if (!chosen.size)
      for (let region of this.weightedRegions()) chosen.add(region);

    return [...chosen]
      .map(id => this.regions?.[id])
      .filter(region => path.fits(region))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Regions the strategy may pick a mission in: the ones with a weight */
  weightedRegions() {
    return Object.values(this.regions ?? {})
      .filter(region => region.regionWeight != null && region.regionWeight > 0)
      .map(region => region.id);
  }

  /** Ids of the alien missions whose waves fly this trajectory */
  missionsFlying(trajectory: string) {
    let out: string[] = [];
    for (let mission of Object.values(this.alienMissions ?? {}) as any[])
      for (let wave of mission.waves ?? [])
        if (wave?.trajectory == trajectory) {
          out.push(mission.id);
          break;
        }
    return out;
  }

  /** Ids of the mission scripts that can launch one of these missions */
  scriptsSelecting(missions: string[]) {
    let wanted = new Set(missions), out: string[] = [];
    for (let script of Object.values(this.missionScripts ?? {}) as any[])
      for (let mission of regionNamesOf(script.missionWeights))
        if (wanted.has(mission)) {
          out.push(script.id);
          break;
        }
    return out;
  }

  /** The trajectories whose paths a region could draw */
  trajectoriesFor(region: string | Region) {
    let target = typeof region == "string" ? this.regions?.[region] : region;
    if (!target)
      return [];
    return Object.values(this.ufoTrajectories ?? {})
      .filter(path => path.fits(target))
      .sort((a, b) => a.id.localeCompare(b.id));
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
    let weighted = region.regionWeight != null && region.regionWeight > 0;
    let out: MissionScript[] = [];
    for (let script of Object.values(this.missionScripts ?? {})) {
      let names = regionNamesOf(script.regionWeights);
      if (names.has(region.id) || (weighted && !names.size))
        out.push(script);
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
    let target = typeof region == "string" ? this.regions?.[region] : region;
    if (!target)
      return [];

    let reach = this.missionReach();
    let counts = new Map<string, number>();
    for (let missions of reach.values())
      for (let id of missions)
        counts.set(id, (counts.get(id) ?? 0) + 1);

    let out: { mission: string, regionCount: number }[] = [];
    for (let id of reach.get(target.id) ?? [])
      out.push({ mission: id, regionCount: counts.get(id) ?? 1 });
    // Rarest first, so the missions that distinguish the region lead; ties keep
    // a stable, predictable order rather than the pack's own
    return out.sort((a, b) => a.regionCount - b.regionCount || a.mission.localeCompare(b.mission));
  }

  /** Each region's reachable missions, built once per pack, since `missionsIn` sweeps every script */
  private missionReach() {
    if (!this._missionReach) {
      let reach = new Map<string, Set<string>>();
      for (let region of Object.values(this.regions ?? {})) {
        let missions = new Set<string>();
        for (let script of this.missionScriptsFor(region))
          for (let mission of regionNamesOf(script.missionWeights))
            missions.add(mission);
        reach.set(region.id, missions);
      }
      this._missionReach = reach;
    }
    return this._missionReach;
  }

  /** Sprite from one of the obs tables (BIGOBS.PCK etc). Returns the asset path,
   * or the transparent placeholder when this ruleset has no such sprite. */
  obsSprite(type: string, num: number) {
    let path = (this.obs[type] || [])[num]?.path;
    return path || emptyImg;
  }

  combineRuls(ruls: any[], reversed = false) {
    for (let file of reversed ? ruls.reverse() : ruls) {
      if (file == null)
        continue;
      for (let key in file) {
        let table = file[key];

        let modDir = file.file.modDir;
        if (Array.isArray(table))
          for (let entry of table) {
            if (typeof entry == "object" && !Array.isArray(entry))
              entry.modDir = modDir;
          }

        if (key.substr(0, 4) == "lang") {
          Object.assign(this.lang, table);
        }
        if (!(key in this.raw)) {
          this.raw[key] = table;
        } else {
          let old = this.raw[key];
          let adding = table;

          if (old.concat) {
            this.raw[key] = old.concat(adding);
          } else {
            if (Array.isArray(adding))
              for (let k of adding) {
                if (k in old && typeof old[k] == "object")
                  Object.assign(old[k], adding[k]);
                else
                  old[k] = adding[k];
              }
          }
        }
      }
    }
  }

  mergeRuls(reversed = false) {

    for (let categoryName in this.raw) {
      // `merged` holds the ruleset blocks themselves, keyed by their id
      let merged = {} as { [id: string]: any };
      let deleted = {} as { [id: string]: boolean };

      if (categoryName == "extraSprites")
        continue;

      let category = this.raw[categoryName];
      if (!Array.isArray(category)) {
        continue;
      }

      for (let data of category) {
        let id =
          data.type || data.id || data.name || data.delete || data.typeSingle;

        if (!id || deleted[id]) continue;

        if ("delete" in data) {
          if (reversed) deleted[id] = true;
          else delete merged[id];
          continue;
        }

        if (id && id in merged) {
          if (reversed) {
            for (let k in data) {
              if (!(k in merged[id])) merged[id][k] = data[k];
            }
          } else {
            if (data.files) {
              let files = { ...merged[id].files, ...data.files }
              Object.assign(merged[id], data);
              merged[id].files = files;
            } else {
              if (Array.isArray(data)) {
                debugger;
                merged[id] = merged[id].concat(data);
              } else
                Object.assign(merged[id], data);
            }
          }
        } else {
          merged[id] = data;
        }
      }

      this.raw[categoryName] = Object.values(merged);
    }
  }

  convertLang(langName: string) {
    if (this.convertedLangs[langName])
      return false;

    let lang = this.langs[langName];

    if (lang == null || lang.ALREADYCONVERTED)
      return;
    lang.ALREADYCONVERTED = "true";

    if (langName == defaultLanguage)
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
        }, ...lang
      };

    this.convertedLangs[langName] = true;
    return true;
  }

  /** Calls the respective class constructor for the entry */
  parseType(type: string, klass?: new (raw: any, collection?: string) => Entry) {
    for (let data of Object.values(this.raw[type] ?? {}) as any[]) {
      // The constructor registers the entry on `rul`; the value itself is unused
      new (klass || SimpleEntry)(data, type)
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
    for (let [id, raw] of Object.entries(this.raw.musics ?? {}) as [string, any][]) {
      if (raw == null || typeof raw != "object")
        continue;
      this.musics[id] = new Music(id, raw);
    }
  }

  deleteModDirs() {
    for (let tableKind in this.raw)
      if (Array.isArray(this.raw[tableKind]))
        for (let table of this.raw[tableKind]) {
          if ("modDir" in table)
            delete table.modDir;
        }
  }

  /** Merges every mod's ruleset blocks, keyed by category and then by entry id */
  combineModRuls(mods: Mod[]) {
    let rul: { [category: string]: { [id: string]: any } } = {}
    for (let mod of mods) {
      for (let file of mod.rul) {
        for (let categoryName in file) {
          rul[categoryName] ||= {};
          let category = rul[categoryName];
          let rawCategory = file[categoryName];
          if (Array.isArray(rawCategory)) {
            for (let data of rawCategory) {
              let id = categoryId(categoryName, data);
              if (data.delete) {
                delete category[id];
                continue
              }
              let old = category[id];
              if (!old) {
                category[id] = data;
              } else {
                // A repeat of the same id merges: array data is concatenated,
                // object data is merged field by field
                if (Array.isArray(data)) {
                  category[id] = [...old, ...data];
                } else {
                  category[id] = { ...old, ...data }
                };
              }
            }
          } else {
            Object.assign(category, rawCategory);
          }
        }
      }
    }
    return rul
  }

  parseRuls(mods: Mod[]) {

    /*let reversed = false;
    this.combineRuls(data, reversed);
    this.mergeRuls(reversed);*/

    this.raw = this.combineModRuls(mods);

    // The world map is a generated page rather than a pack's own article, so it
    // is registered as a Category like the entry tables below. This has to
    // happen before the articles are parsed: the builtin ruleset gives the map
    // article `section: WORLD_MAP`, and a Section created on the fly by
    // `Article.addToSection` would land in the pedia sections list instead.
    //
    // A pack with no `globe:` node has no map to draw, so neither the page nor
    // its article exists, and the entry is dropped rather than left dangling.
    if (this.raw.globe)
      new Section("WORLD_MAP", true);
    else {
      delete this.raw.ufopaedia?.WORLD_MAP;
      delete this.raw.ufopaedia?.XPEDIA_WORLD_MAP;
    }

    // Sounds are read from the mods rather than from `this.raw`: a slot's file
    // path is relative to the mod folder that declares it, and merging the
    // `extraSounds` blocks into one table loses which mod that was.
    //
    // `extraSounds` is an object keyed by CAT file in every pack checked, not
    // an array. This used to test `.length`, which an object does not have, so
    // the whole table was skipped and no sound had a path.
    this.sounds = {}
    for (let mod of mods) {
      for (let file of mod.rul) {
        let extra = file?.extraSounds;
        if (!extra)
          continue;
        let blocks = Array.isArray(extra)
          ? extra
          : Object.entries(extra).map(([type, def]: [string, any]) => ({ type, ...def }));
        for (let block of blocks) {
          let cat = block?.type;
          if (!cat || !block?.files)
            continue;
          for (let [slot, path] of Object.entries(block.files) as [string, string][]) {
            if (path == null || path === "")
              continue;
            // Browsers read forward slashes; a mod folder may contain spaces.
            // The path is stored the way the page must ask for it: relative to
            // the game root, so the pack's own outer folder is not part of it.
            // That is the same rule images follow, see `gameRelativePath`.
            let full = gameRelativePath((mod.dir ? mod.dir + "/" : "") + String(path));
            (this.sounds[cat.toUpperCase()] ||= {})[slot] = full;
          }
        }
      }
    }


    for (let mod of mods) {
      for (let rul of mod.rul) {
        let extra = rul?.extraSprites;
        if (!extra)
          continue;
        // Modern rulesets list packs in an array and use `delete` to drop a
        // whole pack; the old object form keyed by type is kept for
        // compatibility with hand-written data
        let entries = Array.isArray(extra)
          ? extra
          : Object.entries(extra).map(([type, def]: [string, any]) => ({ type, ...def }));

        for (let def of entries) {
          if (def == null || typeof def != "object")
            continue;

          if (def.delete) {
            delete this.sprites[def.delete];
            let table = this.obs[obsTables[def.delete]];
            if (table)
              table.length = 0;
            continue;
          }

          if (def.typeSingle) {
            new Sprite({ typeSingle: def.typeSingle, dir: mod.dir, fileSingle: def.fileSingle, files: def.files });
            continue;
          }

          if (!def.type)
            continue;

          let obs = obsTables[def.type];
          if (obs && def.files) {
            // A known obs table (BIGOBS.PCK, BASEBITS.PCK...) is replaced frame
            // by frame; `files` is a sparse index -> image map
            for (let [ind, file] of Object.entries(def.files))
              new Sprite({ type: obs, ind, dir: mod.dir, fileSingle: file as string });
          }

          new Sprite({ ...def, dir: mod.dir });
        }
      }
    }

    this.deleteModDirs();

    this.parseArticles(this.raw.ufopaedia);

    for (let [typeName, typeConstructor] of Object.entries(entryConstructors) || []) {
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
    function blockItems(blocks: any) {
      if (blocks == null)
        return [];
      blocks = Object.values(blocks || []);
      if (blocks == null)
        return [];
      blocks = blocks.flat();
      let x = blocks.map((b: any) => b.randomizedItems || []).flat()
        .map((c: any) => c?.itemList || []).flat();
      let y = blocks.map((b: any) => b.items ? Object.keys(b.items) : []).flat();
      return [...x, ...y];
    }


    crosslink(this.eventScripts, "_xcomBaseInCountryTrue", "countries", "events");
    crosslink(this.units, "race", "alienRaces", "hasThisRace");
    crosslink(this.units, "rank", "alienRanks", "hasThisRank");
    crosslink(this.alienRaces, "members", "units", "memberOf");
    crosslink(this.soldierTransformation, "forbiddenPreviousTransformations", this.soldierTransformation, "blocksTransformations");
    crosslink(this.alienDeployments, "loot", this.items, "loot");
    crosslink(this.alienDeployments, "enviroEffects", this.enviroEffects, "deployments");
    crosslink(this.craftWeapons, "weaponType", this.weaponTypes, "weapons", "weaponTypes");
    crosslink(this.crafts, "allWeaponTypes", this.weaponTypes, "crafts", "weaponTypes");
    crosslink(this.alienDeployments, "startingCondition", this.startingConditions, "deployments");
    crosslink(this.missionScripts, "researchNeeded", this.research, "unlocksMissions");
    crosslink(this.missionScripts, "researchForbidden", this.research, "stopsMissions");
    crosslink(this.alienMissions, t => Object.values((t.raceWeights || {}) as { [key: string]: any }).map(w => Object.keys(w)).flat(), "alienRaces", "missions");
    crosslink(this.ufos, t => blockItems(t.battlescapeTerrainData?.mapBlocks), this.items, "ufos");
    crosslink(this.terrains, t => blockItems(t.mapBlocks), this.items, "terrains");
    crosslink(this.terrains, "civilianTypes", this.units, "terrains");
    crosslink(this.items, "spawnUnit", this.units, "spawnedBy");
    crosslink(this.items, "internalBattleType", "battleTypes", "items");
    crosslink(this.items, "supportedInventorySections", "inventorySections", "items");
    crosslink(this.commendations, "damageTypes", this.damageTypes, "commendations");
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
    crosslink(this.soldierTransformation, "soldierBonusType", this.soldierBonuses, "transformations");
    crosslink(this.soldierTransformation, "allowedSoldierTypes", this.soldiers, "transformations");

    // `craftWeapons` and `events` are the same article ids as `items`, so these
    // can stay separate from the existing `builtIn` and `loot` lists
    crosslink(this.craftWeapons, t => [t.clip, t.launcher].flat(), this.items, "craftWeapons");
    crosslink(this.armors, "corpseBattle", this.items, "corpseOf");
    // `corpseGeo` is the geoscape drop of the corpse, but a dismantled armor
    // (`_UC` in Piratez) lists the parts it yields here instead, so this is not
    // always a corpse and must not share `corpseOf`
    crosslink(this.armors, "corpseGeo", this.items, "salvagedFrom");
    crosslink(this.events, t => [t.randomItemList, t.everyItemList].flat(), this.items, "events");

    // A wave's `ufo` may also name a deployment, and `dummy` exists in no table
    // at all; only the real UFOs get a link, the rest would become stub pages
    crosslink(this.alienMissions, t => (t.waves ?? []).map((w: any) => w?.ufo)
      .filter((id: any) => id && this.ufos[id]), this.ufos, "missions");
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

    if(rul.attacks?.length > 0)
      new Section("ATTACKS", true);

    let all: { [option: string]: string[] } = {
      Armors: Object.values(this.armors).filter(a => a.units).map(a => a.id),
      SoldierTypes: Object.keys(rul.soldiers),
      Vehicles: Object.keys(rul.units).filter(k => rul.items[k]?.battleType == 3),
      Craft: Object.keys(rul.crafts)
    }

    for (let sc of Object.values(this.startingConditions)) {
      if (sc.forbiddenSoldierTypes?.length) {
        let forbiddenSoldierTypes = new Set(sc.forbiddenSoldierTypes);
        sc.allowedSoldierTypes = Object.keys(rul.soldiers).filter(st => !forbiddenSoldierTypes.has(st));
      }

      sc.allowedSoldierTypes ||= all.SoldierTypes;
      sc.allowedArmors ||= all.Armors;

      if (sc.forbiddenArmors?.length) {
        let forbiddenArmors = new Set(sc.forbiddenArmors);
        sc.allowedArmors = all.Armors.filter(a => !forbiddenArmors.has(a));
      }

      let armorsAllowedForSoldiers = new Set();
      for (let st of sc.allowedSoldierTypes)
        for (let a of (rul.soldiers[st].armors || [rul.soldiers[st].armor] || []))
          armorsAllowedForSoldiers.add(a)

      sc.allowedArmors = sc.allowedArmors.filter(a => armorsAllowedForSoldiers.has(a));
    }

    for (let option of [
      ["Craft", this.crafts],
      ["SoldierTypes", this.soldiers],
      ["Vehicles", this.units],
      ["Armors", this.armors],
    ] as [string, { [key: string]: Craft | Soldiers | Unit | Armor }][]
    ) {
      for (let sc of Object.values(this.startingConditions)) {
        if (sc[`allowed${option[0]}`])
          sc[`forbidden${option[0]}`] = all[option[0]].filter((e: string) => !sc[`allowed${option[0]}`].includes(e))
      }
      crosslink(this.startingConditions, `allowed${option[0]}`, option[1], "allowedIn");
      crosslink(this.startingConditions, `forbidden${option[0]}`, option[1], "forbiddenIn");
    }

    for (let c of Object.values(this.commendations)) {
      c.parseKillCriteria();
    }

    for (let facility of Object.values(this.facilities)) {
      if (facility.buildCostItems) {
        for (let itemName of Object.keys(facility.buildCostItems)) {
          let item = rul.items[itemName];
          if (!item) continue;
          if (!item.componentOf) item.componentOf = {};
          item.componentOf[facility.type] =
            facility.buildCostItems[itemName].build;
          if (!item.manufacture) item.manufacture = {};
          item.manufacture[facility.type] =
            facility.buildCostItems[itemName].refund;
        }
      }
    }

    for (let item of Object.values(this.items)) {

      for (let ammoId of item.compatibleAmmo || []) {
        let ammo = this.items[ammoId];
        if (ammo) {
          ammo.compatibleWeapons = ammo.compatibleWeapons || [];
          ammo.compatibleWeapons.push(item.type);
        }
      }
      for (let rb of item.requiresBuy || []) {
        let r = this.research[rb];
        if (r) {
          r.allowsBuying = [...(r.allowsBuying || []), item.type];
        }
      }

    }

    for (let research of [...Object.values(this.research)]) {
      backLink(research.name, research.dependencies ?? null, rul.research, "leadsTo");
      backLink(research.name, research.getOneFree ?? null, rul.research, "freeFrom");

      if (
        research.lookup &&
        research.name != research.lookup &&
        this.research[research.lookup]
      ) {
        let lookup = this.research[research.lookup];
        lookup.seeAlso = lookup.seeAlso || [];
        lookup.seeAlso.push(research.name);
        let lookUpArticle = this.article(research.lookup);
        let article = this.article(research.name);
        if (!rul.lang[article.id]) article._title = lookUpArticle._title;
        article._text = lookUpArticle._text;
        article.image_id = lookUpArticle.image_id;
      }
      if (research.spawnedItem) {
        let item = rul.items[research.spawnedItem];
        // A pack can be a submod of a master it does not ship, so a reference
        // can point at an item only the missing master defines. The recipe is
        // then simply out of scope for this pedia, the same way `crosslink`
        // skips links it cannot resolve.
        if (!item)
          continue;
        item.spawnedBy = item.spawnedBy || [];
        item.spawnedBy.push(research.name);
      }
    }

    this.ourArmors = Object.values(this.armors)
      .filter((a) => a.units)
      .map((a) => a.type);

    for (let cat of Object.keys(this.categories)) {
      if (this.categories[cat].length)
        Article.create(cat, "CATEGORIES");
    }

    for (let cat of Object.keys(this.manufactureCategories)) {
      if (this.manufactureCategories[cat].length)
        Article.create(cat, "MANUFACTURE_CATEGORIES");
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
    return this.sprites["GlobeMarkers"]?.frameSource(num);
  }

  /** Sections that hold generated entries (items, units...) sorted by name */
  sortedTypeSections() {
    return this.sortStringsAndNumbers(this.typeSectionsOrder.map(s => s.id)).map(id => this.sections[id]);
  }

  parseArticles(data: Object) {
    if (!data)
      return;
    for (let articleData of Object.values(data)) {
      if (articleData.id) {
        let article = new Article(articleData);
        this.articlesOrder.push(article);
        this.articles[article.id] = article;
      }
    }
  }

  /** Returns an article nearby in the same section */
  findNearbyArticle(current: Article | undefined, delta: number, currentSection: Section | undefined, alphabetical = false) {
    if (!current) return undefined;
    if (!currentSection)
      currentSection = current.sections[0];
    if (current.id == currentSection.id) {
      return currentSection.nearbySection(delta);
    }
    let list = currentSection ? currentSection.articles(alphabetical) : this.articlesOrder;
    let index = list.findIndex((a) => a.id == current.id);
    if (index != undefined) {
      let nextIndex = index + delta;
      let nextArticle = list[nextIndex];
      if (nextIndex == -1) {
        nextArticle = currentSection.nearbySection(-1).lastArticle(alphabetical);
      } else if (nextIndex == list.length) {
        nextArticle = currentSection.nearbySection(1).firstArticle(alphabetical);
      }
      return nextArticle;
    }
  }

  sortArticlesByName(list: Article[]) {
    return this.sortStringsAndNumbers(list.map(a => a.id)).map(id => this.articles[id]);
  }

  str(id: string) {
    return this.lang[id] || id;
  }

  icon(name?: string) {
    if (name == null)
      return null;
    return this.langs?.icon ? this.langs.icon[name] : null;
  }

  hasSprite(id: string) {
    return this.sprites[id];
  }

  async sprite(id: string | Promise<any>, onlyIfExists = false) {
    if (id instanceof Promise)
      return id;
    if (id in this.sprites)
      return this.sprites[id].data();

    return onlyIfExists ? null : id;
  }

  loadMods(mods: { [modName: string]: Mod }) {
    this.loadProcessedMods(Ruleset.preprocessMods(mods))
  }

  /**Orders mods and merges languages*/
  static preprocessMods(mods: { [modName: string]: Mod }) {
    let modOrder = Ruleset.activeMods(Object.values(mods));

    let langs: { [langName: string]: { [id: string]: string } } = {}

    for (let mod of modOrder) {
      for (let lname in mod.lng) {
        langs[lname] ||= {}
        Object.assign(langs[lname], mod.lng[lname])
      }
      // The language table has been merged into `langs`, so the per-mod copy is
      // dropped to keep a large pack from holding it twice
      delete (mod as { lng?: Mod["lng"] }).lng;
    }
    for (let lname in langs) {
      // `icon` is not a spoken language: it maps field names to emoji. Folding
      // the English strings into it would make every icon look like an English
      // label, so `Tr` would draw that label next to the translated one.
      if (lname == "icon")
        continue;
      langs[lname] = { ...langs[defaultLanguage], ...langs[lname] }
    }

    return { mods: modOrder, langs }
  }

  /**
   * Picks the mods OpenXcom would actually load, in the order it loads them.
   *
   * OpenXcom activates exactly one master mod and then the mods that depend on
   * that master, plus standalone mods and mods explicitly marked active. A
   * master may chain to a "super" master (`master: xcom1`), which is loaded
   * underneath it. Other masters — most importantly `xcom2` next to `xcom1` —
   * stay off, which keeps the TFTD half of a modpack out of the ruleset.
   *
   * Order is the merge order: later mods override earlier ones.
   */
  static activeMods(all: Mod[]): Mod[] {
    /** Metadata id, falling back to the folder name like `ModInfo` does */
    let idOf = (mod: Mod) => mod.meta?.id ?? mod.dir.split(/[/\\]/).pop();

    let byId: { [id: string]: Mod } = {};
    for (let mod of all) {
      let id = idOf(mod);
      if (id && !(id in byId))
        byId[id] = mod;
    }

    /** Resolvable masters, deepest first: mods chaining to xcom1 beat xcom1 */
    let masters = all.filter(mod => mod.meta?.isMaster);

    let depth = (mod: Mod, seen = new Set<string>()): number => {
      let id = idOf(mod);
      if (!id || seen.has(id)) return 0;
      seen.add(id);
      let parent = mod.meta?.master ? byId[mod.meta.master] : undefined;
      return parent ? depth(parent, seen) + 1 : 0;
    };

    // A total conversion lives in `user/mods`, while `standard` holds the base
    // game masters and optional tweaks; prefer the former as the active master
    let userMasters = masters.filter(mod => !/[/\\]standard[/\\]/i.test(mod.dir));
    let activeMaster = (userMasters.length ? userMasters : masters)
      .sort((a, b) => depth(b) - depth(a))[0];

    let chain: Mod[] = [];
    let seen = new Set<string>();
    for (let mod: Mod | undefined = activeMaster; mod && !seen.has(idOf(mod)!);) {
      seen.add(idOf(mod)!);
      chain.unshift(mod);
      mod = mod.meta?.master ? byId[mod.meta.master] : undefined;
    }

    let masterId = activeMaster ? idOf(activeMaster) : undefined;

    /** Sorting key: `[group, position within the group]` */
    let order = (mod: Mod): [number, number] => {
      if (mod.common)
        return [0, 0];
      let i = chain.indexOf(mod);
      if (i >= 0)
        return [2, i];
      // Mods for a master that is not part of the pack, e.g. XPedia's own base
      // strings declared against the pseudo master `xpedia`, go first so every
      // real translation can override them
      if (mod.meta?.master && !byId[mod.meta.master])
        return [1, 0];
      if (mod.meta?.active === true)
        return [4, 0];
      return [3, 0];
    };

    let active = all.filter(mod => {
      if (mod.common || chain.includes(mod))
        return true;
      if (!mod.meta || Object.keys(mod.meta).length == 0)
        return true;
      if (mod.meta.active === true)
        return true;
      // A pack can be a single mod packed on its own rather than a whole
      // OpenXcom install: `Final Mod Pack/metadata.yml` declares `master: xcom1`
      // and is not a master itself, because xcom1 ships with the game. With no
      // master inside the pack there is nothing to filter against, and the mod
      // the user uploaded is the one they want to read, so load everything.
      if (!masterId)
        return true;
      // Dependants of the active master only; this drops xcom2's TFTD mods
      return mod.meta.master == masterId;
    });

    return active.sort((a, b) => {
      let [ga, pa] = order(a), [gb, pb] = order(b);
      return ga - gb || pa - pb;
    });
  }

  loadProcessedMods(data: { mods?: Mod[], langs?: any, resources?: { [rel: string]: string } }) {
    this.meta = mainMod(data.mods ?? [])?.meta ?? {}
    this.mods = data.mods ?? [];
    this.resourceMap = data.resources ?? {};
    this.langs = data.langs ?? {};
    this.langNames = Object.keys(this.langs)
      // `icon` is an emoji map, and a language whose file produced no strings
      // at all would be a dead, blank entry in the dropdown
      .filter(name => name != "icon" && this.langs[name] != null && typeof this.langs[name] == "object")
      .sort((a, b) => langWeight(b) - langWeight(a));

    function langWeight(name: string) {
      // The default language always leads the list, whatever its size
      if (name == defaultLanguage)
        return Infinity;
      return Object.keys(data.langs?.[name] ?? {}).length;
    }

    // Language buttons are labelled with a country flag, see old `loadOld`
    for (let name of this.langNames) {
      if (!this.langs[defaultLanguage][name]) {
        let country = name.match(/([a-z]+)/i);
        let flag = country?.length ? getFlagEmoji(country[1]) : undefined;
        if (flag)
          this.langs[defaultLanguage][name] = flag;
      }
    }

    this.parseRuls(data.mods ?? []);
    this.selectLang(defaultLanguage);
  }

  /** replaced with loadProcessedMods */
  loadOld({ ruls, langs, mods }: {
    ruls: any[],
    langs: { [key: string]: { [key: string]: string } },
    mods: Mod[]
  }) {
    this.mods = mods;
    this.langs = langs;
    let langWeight = Object.fromEntries(Object.keys(langs).map(n => [n, n == defaultLanguage ? 1e6 : Object.keys(langs[n]).length]));
    this.langNames = Object.keys(langs).sort((a, b) => langWeight[b] - langWeight[a]);
    if (this.langs.icon)
      this.langNames.splice(this.langNames.indexOf("icon"));

    for (let name of this.langNames) {
      if (!this.langs[defaultLanguage][name]) {
        let country = name.match(/([a-z]+)/i);
        if (country?.length) {
          let flag = getFlagEmoji(country[1]);
          if (flag)
            this.langs[defaultLanguage][name] = flag;
        }
      }
    }

    this.parseRuls(ruls);
    this.convertLang(defaultLanguage);
    let l = Object.keys(this.langs);
    if (l.length == 3) {
      let other = l.find(n => n != defaultLanguage && n != "icon");
      if (other)
        this.selectLang(other);
    } else {
      this.selectLang(defaultLanguage)
    }
  }

  selectLang(name: string) {
    if (!this.langs[name]) {
      console.log("no language", name);
      return false;
    }

    this.langName = name

    if (name == defaultLanguage) {
      this.lang = this.langs[defaultLanguage];
    } else {
      this.convertLang(name)
      this.lang = { ...this.langs[defaultLanguage], ...this.langs[name] };
    }

    if (!this.search[name])
      this.search[name] = new Search();

    return true;
  }

  /** Full text search over the current language's article index */
  findArticles(query: string) {
    if (this.langName == null)
      return undefined;
    let search = this.search[this.langName];
    return search?.findArticles(query);
  }

  linksByType(type: string) {
    switch (type) {
      case "CONDITIONS":
        return Object.keys(this.startingConditions).map(
          (a) => "CONDITIONS_" + a
        );
    }
    return [];
  }

  bodiesCompare(strs: string[]) {
    for (let i in strs) {
      if (strs[i].length == 2)
        strs[i] =
          (strs[i].charAt(0) == "M" ? "A" : "B") + "0" + strs[i].substr(1);
    }
    return strs[0] > strs[1] ? 1 : -1;
  }

  article(id: string) {
    let redirect = this.redirect[id];
    let a = (redirect && this.articles[redirect]) || this.articles[id];
    return a;
  }

  /** Sort strings by their translated values */
  sortStringsAndNumbers(s: string[]) {
    let tl: [string, string][] = s.map(s => [s, this.tr(s) ?? s])
    tl = tl.sort((a, b) => comparator(a[1], b[1]))
    return tl.map(a => a[0]);
  }

  /** Compare strings by their translated values */
  compareStrings(a: string, b: string) {
    let [tra, trb] = [this.tr(a) ?? a, this.tr(b) ?? b]
    return tra > trb ? -1 : tra < trb ? 1 : 0;
  }

  /*sortIds(s: {id:string}[]) {
    return this.sortStrings(s.map(v=>v.id)).map(v=?);
  }*/

}

export function comparator(a:any, b:any){
  return (a??"").localeCompare(b, undefined, { numeric: true, sensitivity: "base" })  
}


/** Main class to figure what to do with data in Ruls */
export const entryConstructors: {
  [collection: string]: new (raw: any, collection: string) => Entry
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
}

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
  if ((field == "hitSound" || field == "fireSound") &&
    (collection == "facilities" || collection == "ufos"))
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
export function regionNamesOf(weights: any) {
  let out = new Set<string>();
  if (weights == null || typeof weights != "object")
    return out;
  for (let block of Array.isArray(weights) ? weights : Object.values(weights))
    if (block && typeof block == "object" && !Array.isArray(block))
      for (let id of Object.keys(block))
        out.add(id);
  return out;
}

export const statsList = ["tu", "stamina", "health", "bravery", "reactions", "firing", "throwing", "strength", "psiStrength", "psiSkill", "melee"];

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
  "DT_NONE", "DT_AP", "DT_IN", "DT_HE", "DT_LASER", "DT_PLASMA", "DT_STUN", "DT_MELEE", "DT_ACID", "DT_SMOKE",
  "DT_10", "DT_11", "DT_12", "DT_13", "DT_14", "DT_15", "DT_16", "DT_17", "DT_18", "DT_19"
];

/**
 * Resolves a damage type to its index in `damageTypes`.
 *
 * Mods write it either as an index (`3`) or as a name (`STR_DAMAGE_ARMOR_PIERCING`,
 * `DT_AP`). Returns null for anything that does not name a known damage type, so
 * callers do not create a bogus entry with an `undefined` id.
 */
export function damageTypeIndex(value: any): number | null {
  if (value == null)
    return null;

  if (typeof value === "string") {
    let idx = damageTypes.indexOf(value);
    if (idx != -1)
      return idx;
    idx = internalDamageTypes.indexOf(value);
    if (idx != -1 && idx < damageTypes.length)
      return idx;
    // A numeric string is still an index
    if (!/^\d+$/.test(value.trim()))
      return null;
  }

  let n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n >= damageTypes.length)
    return null;
  return n;
}

export const killStatuses = ["STATUS_DEAD", "STATUS_UNCONSCIOUS", "STATUS_PANICKED", "STATUS_TURNING"];
export const killFactions = ["FACTION_HOSTILE", "FACTION_NEUTRAL", "FACTION_PLAYER"]

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
]

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
]

export const battleStats = ["time", "energy", "morale", "health", "stun", "mana"]


/**
 * The name that identifies one entry of a ruleset table.
 *
 * The format uses `type` for the id in most tables (a `ufos:` entry is
 * `{ type: STR_UFO }`) and `id` in others, so both are tried. `type` comes
 * first, which is the order the game itself reads them in.
 *
 * `invs` is the exception: an inventory section has a string `id` and a
 * *numeric* `type` (the engine's `InventoryType`, 0/1/2), so keying it by
 * `type` would collapse every section of the same kind into one entry. There the
 * two fields mean different things, and `id` is the name.
 */
export function categoryId(category: string, data: any) {
  if (category == "invs")
    return data.id || data.type || data.name || data.delete || data.typeSingle;
  return data.type || data.id || data.name || data.delete || data.typeSingle;
}

export function backLink2(entry: Entry, list: string[] | { [key: string]: any }, to: any, field: string, field2: string) {
  backLink(entry.id, list, to, field);
  addAllIfNew(entry[field2], list as any);
}

export function backLink(id: string, list: string[] | { [key: string]: any } | null, to: any, field: string, collection?: string) {
  if (typeof to === "string") {
    collection = to;
    // Tables are registered on `rul` under their collection name, so the lookup
    // and the fallback both have to use it rather than the overwritten `to`
    to = (rul as any)[collection];
    if (!to)
      to = (rul as any)[collection] = {};
  }
  if (list == null) return;
  if (typeof list == "object" && !Array.isArray(list)) {
    for (let key of Object.keys(list)) {
      let back = to[key];
      if (back == null && collection != null) {
        back = to[key] = new (entryConstructors[collection] || SimpleEntry)({ id: key }, collection)
      }
      if (back == null)
        continue;
      addFields(back, field, { [key]: list[key] })
    }

  } else {
    if (!Array.isArray(list))
      list = [list]

    for (let key of list as any[]) {
      // A missing key used to create an entry with an `undefined` id, which
      // then showed up as a blank article in a section
      if (key == null || key === "")
        continue;
      let back = to[key];
      if (back == null && collection != null)
        back = to[key] = new Entry(collection).from({ id: key })
      if (back == null)
        continue;
      addFields(back, field, [id])
    }
  }
}

function addFields(entry: Entry, field: string, list: string[] | { [key: string]: any }) {
  if (entry == null || field == null || list == null)
    return;
  if (Array.isArray(list)) {
    entry[field] = entry[field] || [];
    for (let id of list) {
      if (entry[field].indexOf(id) == -1)
        entry[field].push(id);
    }
  } else {
    entry[field] = { ...entry[field] || {}, ...list };
  }
}

/** Adds back links */
function crosslink(
  collection1: { [id: string]: any },
  prop1: string | ((v: { [id: string]: any }) => any),
  // A collection is either the table itself or the name of one on `rul`, which
  // `backLink` looks up; the named form is how the base-game tables are reached
  collection2: { [id: string]: any } | string,
  prop2: string,
  prefix?: string) {
  let f = typeof prop1 === "function" ? prop1 : (t: any) => t[prop1];
  for (let t of [...Object.values(collection1)] as { id: string }[]) {
    backLink(t.id, f(t), collection2, prop2, prefix);
  }
}


export function stripPediaMarkup(t: string) {
  if (t != null && t.indexOf("{") != -1) {
    t = t.replace(/\{NEWLINE\}/g, "\n")
    t = t.replace(/^\s+/g, "")
    t = t.replace(/\{[^}]+\}/g, " ")
  }
  return t;
}