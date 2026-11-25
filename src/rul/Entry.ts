import { addIfNew, camelToUnderscore, unique } from "../util";
import { Article } from "./Article";
import {
  backLink,
  backLink2,
  battleTypes,
  damageTypeIndex,
  damageTypes,
  internalBattleTypes,
  internalDamageTypes,
  killFactions,
  killStatuses,
  rul,
  Service,
  statsList,
} from "./Ruleset";

/**
 * A ruleset node exactly as a pack states it.
 *
 * There is no fixed shape to give this: `Entry.from` copies every field off the
 * node onto the entry, and a pack may add fields the pedia knows nothing about
 * without failing to load. The fields the pedia *reads* are declared on the
 * entry class itself and filled in by `from`, so the node only has to be an
 * object with an id; the index signature is what keeps an unknown field legal
 * here rather than an error.
 */
export type RawEntry = { id?: string; [field: string]: unknown };

/**
 * The field a collection names its blocks with, for the collections that do not
 * use `type`.
 *
 * Extracted from `Mod::loadFile` in the engine (`OpenXcomExMore-oxce-plus-more`,
 * `src/Mod/Mod.cpp`), which calls `iterateRules` once per table with the field
 * that names its blocks: `iterateRules("items", "type")`,
 * `iterateRules("research", "name")`, `iterateRules("invs", "id")` and so on.
 * Everything not listed here is named by `type`, which is the engine's default
 * too. Keeping the engine's own list means the pedia files a block where the
 * game does, rather than by a precedence that only happens to agree with it.
 */
const idField: { [collection: string]: "id" | "name" | "type" } = {
  invs: "id",
  ufoTrajectories: "id",
  alienRaces: "id",
  research: "name",
  terrains: "name",
  manufacture: "name",
  manufactureShortcut: "name",
  soldierBonuses: "name",
  soldierTransformation: "name",
  startingBaseSets: "name",
  events: "name",
};

const identityFieldName = /^(uid|id|ident|identifier|key)$/i;

/**
 * Whether a field name ends in a word that means "identity".
 *
 * Only used for a collection the id-field table above does not know, which means
 * a pack or a newer engine named a table's blocks with a field this pedia has
 * never seen.
 *
 * Written as cases rather than one expression because the spellings a ruleset
 * uses are not interchangeable with ordinary words: `objId` and `object_id` both
 * mean identity, while `valid` and `grid` merely end in the same two letters.
 * The difference is a word boundary — a capital, an underscore or the whole
 * name — not the letters themselves.
 */
function namesIdentity(field: string) {
  if (identityFieldName.test(field)) return true;
  // `objId`, `unitID`: a capital `I` marks the start of the word
  if (/[a-z]I[dD]$/.test(field)) return true;
  // `object_id`, `object_ID`: an underscore separates it
  if (/_id$/i.test(field)) return true;
  // `idString`-style prefix, which some engine fields use
  return /^id[A-Z_]/.test(field);
}

/** Fields that never name a block, whatever their spelling */
const neverIdentity = new Set(["delete", "typeSingle", "modDir", "fileSingle", "path", "dir"]);

/**
 * Fields a block's identity was guessed from, keyed by `collection.field`.
 *
 * A guess is a pack the pedia only half understands, so it is remembered rather
 * than silently applied: `unknownIdFields()` reports what was guessed at, which
 * is how a genuinely new naming field in a future ruleset gets noticed instead
 * of quietly filing entries under the wrong name.
 */
const guessedIdFields = new Map<string, string>();

/** The `collection.field` pairs the id was guessed from, e.g. `items.objId` */
export function unknownIdFields(): string[] {
  return [...guessedIdFields.keys()].sort();
}

/**
 * The one field of an unknown collection that plausibly names the block.
 *
 * Returns `undefined` when nothing qualifies or when more than one does, since
 * picking between several candidates would be inventing an identity rather than
 * reading one.
 */
function guessIdentityField(raw: RawEntry): string | undefined {
  const candidates = Object.keys(raw ?? {}).filter((field) => {
    if (neverIdentity.has(field)) return false;
    if (!namesIdentity(field)) return false;
    const value = raw[field];
    return typeof value === "string" && value !== "";
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * The identifier exactly as the file writes it.
 *
 * This reads the one field the collection declares and nothing else, so it
 * answers "what did the author call this block" rather than "what is this entry
 * keyed by". The two differ: a pack may put `{ name: ... }` in a `type`
 * collection, which the game does not accept, and `entryKey` then resolves a key
 * the file never states. Anything that reports on the pack — a warning about a
 * block the game would ignore — wants this value, because inventing a key would
 * describe a pack that is not the one on disk.
 *
 * Returns `undefined` when the declared field is absent, which is the honest
 * answer for a block that names itself with a spelling its collection does not
 * read.
 */
export function rawId(collection: string, raw: RawEntry): string | undefined {
  const field = idField[collection] ?? "type";
  const value = raw?.[field];
  return value == null ? undefined : (value as string);
}

/**
 * The key an entry is filed and merged under.
 *
 * This is the pedia's identification value: it is resolved from whichever
 * spelling the block used, so a `{ name: ... }` block in a `type` collection
 * still gets a key.
 *
 * This runs once per block, while the mod rules are merged, and the winner is
 * stamped onto the block as `uid`. Everything after that point reads `uid`
 * instead of resolving again, so the key an entry is merged under, the key it is
 * filed under, and the identity it carries are the same value by construction
 * rather than by three pieces of code agreeing.
 *
 * Order: the field the collection declares (`rawId`), then the common spellings
 * as a tolerance for packs that mix them, then a last-resort guess for a
 * collection this build does not know. `delete` is near the end: a
 * `- delete: STR_X` block has no identity of its own, and the name it carries is
 * the block it removes.
 */
export function entryKey(collection: string, raw: RawEntry): string {
  // Already resolved, e.g. when a block is merged more than once
  const stamped = raw?.uid;
  if (typeof stamped === "string" && stamped !== "") return stamped;

  const written = rawId(collection, raw);
  if (written != null) return written;

  const aliases = ["id", "type", "name", "delete", "typeSingle"];
  for (const field of aliases) {
    const value = raw?.[field];
    if (value != null) return value as string;
  }

  // A collection this build has no rule for: guess from the field names, and
  // record it so `unknownIdFields()` can report what was assumed
  const guessed = guessIdentityField(raw);
  if (guessed != null) {
    guessedIdFields.set(`${collection}.${guessed}`, guessed);
    return raw[guessed] as string;
  }

  // Nothing names this block. An entry without a key is not a table row: the
  // callers drop it rather than filing it under `undefined`
  return "";
}

/**
 * Resolves a block's key and records it on the block as `uid`.
 *
 * Called while the mod rules are merged, before anything reads an id, which is
 * what makes the guess happen once. A block with no key is left unstamped: the
 * caller drops it rather than filing it under `""`.
 */
export function stampUid(collection: string, raw: RawEntry): string {
  const uid = entryKey(collection, raw);
  if (raw != null && typeof raw === "object" && uid !== "") raw.uid = uid;
  return uid;
}

/** Root class for all ruleset entries */
export class Entry {
  /**
   * The identifier the block wrote, left as it was in the file.
   *
   * Only present when the pack actually stated one: a `name`-keyed block has no
   * `id` at all, which is the honest answer rather than a copy of the uid. The
   * uid is the key to file and look up by; this is evidence, not identity.
   *
   * Nothing reads this to answer "which entry is this" any more — `uid` does
   * that. It survives because it is the one remaining record of what the file
   * actually said, which is what a diagnostic or an exporter needs.
   */
  declare id: string;
  /**
   * Armor types that list this entry in their `units`.
   *
   * Declared with `declare` only: the class is compiled with
   * `useDefineForClassFields`, so a plain `armors?: string[]` would emit an own
   * `armors: undefined` field on every entry, and code that walks an entry's own
   * keys (such as `Val` drawing a raw object) would show an empty row for it.
   */
  declare armors?: string[];
  /**
   * Name of the table this entry belongs to.
   *
   * It is not enumerable: `Val` and `MainTable` walk an entry's own keys to draw
   * its rows, so an enumerable `collection` would show up as a row of every
   * entry that is rendered raw, e.g. the "Final bonus" row of a commendation.
   */
  collection!: string;
  /**
   * The identity stamped on the block while the mod rules were merged.
   *
   * Unique **within this entry's table only**, which is the same guarantee the
   * engine gives: `Mod::loadFile` files each table separately, so one name can
   * be a craft weapon and a research project at once. XPiratez has 5083 names
   * that repeat across its tables.
   *
   * Kept as a real field so the entry and the block it came from agree, and so
   * anything holding a raw node can still ask it what it is.
   *
   * This is deliberately *not* the same value as `id`: `id` is what the file
   * wrote, `uid` is what the pedia filed. Where the two differ, the uid is the
   * one to build on.
   *
   * For a value that is unique across the whole pack, use `globalId`.
   */
  declare uid: string;
  [id: string]: unknown;

  constructor(collection: string) {
    Object.defineProperty(this, "collection", {
      value: collection,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    // Same reasoning as `collection`: a row of every entry drawn raw would be
    // noise, and the table's identity column already says what this is
    Object.defineProperty(this, "uid", {
      value: "",
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }

  from(raw: RawEntry) {
    // The uid is the key the block was merged and filed under, resolved once
    // while the mod rules were merged. It is settled before the copy because the
    // copy must not be able to move it: several collections name their blocks
    // `type`, and copying that field runs `set type`.
    const uid = (raw?.uid as string | undefined) ?? entryKey(this.collection, raw);
    raw = JSON.parse(JSON.stringify(raw));
    for (const k in raw) this[k] = raw[k];

    // `id` is left exactly as the file wrote it. It is what the block called
    // itself, which is not always the uid: a `name`-keyed block has no `id` at
    // all, and a block stating both `id` and `type` keeps its own `id` while the
    // entry is filed under `type`. Writing the uid here would overwrite that
    // evidence with the pedia's own conclusion.
    this.uid = uid;

    // A block that names itself with nothing is not a table row. Filing it under
    // `""` is what used to collapse a whole table into one blank entry and
    // create an article with no id to link to, so it is dropped instead.
    if (!uid) return this;

    const tables = rul as unknown as { [collection: string]: { [id: string]: Entry } };
    tables[this.collection] ??= {};

    tables[this.collection][uid] = this;

    this.addToSection(camelToUnderscore(this.collection).toUpperCase());

    return this;
  }

  addToSection(section: string) {
    // Keyed by `uid`, not by the as-written `id`: the article is the page that
    // gathers every table's view of one thing, and a `name`-keyed block has no
    // `id` at all
    Article.create(this.uid, section);
  }

  /**
   * The value a column is sorted by.
   *
   * `filter` is either the value the table's filter selected, or `true` when a
   * column wants its own unfiltered value rather than a yes/no answer.
   *
   * `"id"` is the table's identity column: the header states no such field, it is
   * always shown, and it names the row. It answers with the uid, not with the
   * literal `id` the block wrote, because most blocks state no `id` at all and
   * the column would then be empty.
   */
  sortField(field: string, filter?: string | boolean) {
    if (field === "id" && !filter) return this.title;
    if (field === "id") return this.uid;
    return this[field];
  }

  get title() {
    return rul.tr(this.uid);
  }

  /**
   * The entry's identity across the whole ruleset, as `collection:uid`.
   *
   * `uid` alone is only unique inside its own table: a pack routinely uses one
   * name for several kinds of thing, so `STR_STINGRAY` can be both a craft
   * weapon and a research project, and XPiratez does exactly that. The
   * collection is what makes the pair globally unique, which is the form to use
   * anywhere entries of different tables meet — a cross-collection map key, a
   * log line, or a value shown to the reader.
   */
  get globalId() {
    return `${this.collection}:${this.uid}`;
  }

  static reserve(raw: RawEntry, collection: string) {
    const id = entryKey(collection, raw);
    // Entries are registered on `rul` under their collection name, and the
    // table is created on first use
    const table: { [id: string]: Entry } | undefined = (
      rul as unknown as { [collection: string]: { [id: string]: Entry } }
    )[collection];
    if (table?.[id]) {
      return table[id];
    } else {
      return new Entry(collection).from(raw);
    }
  }

  /**
   * `name` and `type` are the pack's other spellings for the same thing `uid`
   * carries, so they read and write the uid rather than the as-written `id`.
   *
   * The distinction matters because identity code uses these accessors: a
   * backlink, a service index or an armor's user list wants the entry it was
   * filed under, not the literal field the block happened to state.
   */
  get name() {
    return this.uid;
  }

  set name(val) {
    if (this.uid == null) this.uid = val;
  }

  get type() {
    return this.uid;
  }

  set type(val) {
    this.uid = val;
  }
}

export class SimpleEntry extends Entry {
  constructor(raw: RawEntry, collection: string) {
    super(collection);
    this.from(raw);
  }
}

export class MissionScript extends Entry {
  researchTriggers?: { [id: string]: boolean };
  researchNeeded?: string[];
  researchForbidden?: string[];
  /**
   * `missionWeights`, split into monthly chunks: either one map of mission type
   * to weight, or one map per month, which is why the values have to be checked
   * before being read as a map. Not declared here, so `from` fills it in.
   */
  missionWeights?: { [month: string]: number } | { [month: string]: { [mission: string]: number } };
  constructor(raw: RawEntry) {
    super("missionScripts");
    this.from(raw);
    if (this.researchTriggers) {
      const triggers = this.researchTriggers;
      this.researchNeeded = Object.keys(triggers).filter((k) => triggers[k]);
      this.researchForbidden = Object.keys(triggers).filter((k) => !triggers[k]);
    }
    if (this.missionWeights) {
      // A weight may be a bare number rather than a block, so the values are
      // filtered to the blocks before their keys are read
      const weights = Object.values(this.missionWeights).filter(
        (m): m is { [mission: string]: number } => m != null && typeof m === "object",
      );
      this._missions = unique(weights.flatMap((m) => Object.keys(m)));
    }
  }
}

export class Soldiers extends Entry {
  statCaps?: { [id: string]: number };

  constructor(raw: RawEntry) {
    super("soldiers");
    this.from(raw);
  }

  sortField(n: string, v?: string | boolean) {
    // `super` first, so the identity column answers with the uid like every
    // other table's does; a stat this soldier has no cap for still falls back
    return super.sortField(n, v) || this.statCaps?.[n];
  }
}

export class EventEntry extends Entry {
  constructor(raw: RawEntry) {
    super("events");
    this.from(raw);
  }

  relatedScripts: string[] = [];
}

export class EventScript extends Entry {
  _relatedEvents: string[];
  _relatedResearch: string[];
  /**
   * Month -> event id -> weight, as declared by the script: the game's
   * `WeightedOptions` per month (`RuleEventScript.cpp`), with the list form
   * some packs use instead of the map.
   */
  eventWeights?: { [month: string]: { [id: string]: number } } | { [id: string]: number }[];
  oneTimeRandomEvents?: { [id: string]: number };
  researchTriggers?: { [id: string]: boolean };
  xcomBaseInCountryTriggers?: { [country: string]: boolean };
  _xcomBaseInCountryTrue: string[] = [];
  _xcomBaseInCountryFalse: string[] = [];

  constructor(raw: RawEntry) {
    super("eventScripts");
    this.from(raw);
    const relatedEvents = new Set<string>([
      ...Object.values(this.eventWeights || []).flatMap((w) => Object.keys(w)),
      ...Object.keys(this.oneTimeRandomEvents || {}),
    ]);
    this._relatedEvents = [...relatedEvents];
    this._relatedResearch = [...new Set<string>(Object.keys(this.researchTriggers || {}))];
    if (this.xcomBaseInCountryTriggers) {
      const triggers = this.xcomBaseInCountryTriggers;
      this._xcomBaseInCountryTrue = Object.keys(triggers).filter((k) => triggers[k] === true);
      this._xcomBaseInCountryFalse = Object.keys(triggers).filter((k) => triggers[k] === false);
    }
  }
}

function totalSellCost(items: { [key: string]: number } = {}) {
  let c = 0;
  for (const k in items) {
    c += items[k] * Number((rul.items[k] || rul.crafts[k])?.costSell) || 0;
  }
  return c || 0;
}

function totalSize(items: { [key: string]: number } = {}) {
  let c = 0;
  for (const k in items) {
    c += items[k] * Number((rul.items[k] || rul.crafts[k])?.size) || 0;
  }
  return c;
}

export class Manufacture extends Entry {
  requires?: string;
  producedItems?: { [key: string]: number };
  requiredItems?: { [key: string]: number };
  totalProducedItems: { [key: string]: number } = {};
  requiresBaseFunc?: string[];
  randomProducedItems?: [number, { [key: string]: number }][];
  chanceSum?: number;
  cost: number = 0;
  time?: number;
  profit?: number;
  profitPerHour?: number;
  sizeChange?: number;

  constructor(raw: RawEntry) {
    super("manufacture");
    this.from(raw);

    this.cost = this.cost || 0;

    if (this.category) {
      rul.addCategory(this.category as string, this.uid, rul.manufactureCategories);
    }

    if (this.requires) {
      for (const resName of this.requires) {
        const res = rul.research[resName];
        if (!res) continue;
        if (!res.manufacture) res.manufacture = [];
        res.manufacture.push(this.name);
      }
    }

    if (!this.producedItems) {
      this.producedItems = { [this.uid]: 1 };
    }

    if (this.requiredItems) {
      for (const itemName of Object.keys(this.requiredItems)) {
        const item = rul.items[itemName];
        if (!item) continue;
        if (!item.componentOf) item.componentOf = {};
        item.componentOf[this.name] = this.requiredItems[itemName];
      }
    }

    if (this.randomProducedItems) {
      this.chanceSum = 0;
      for (const chance of this.randomProducedItems) this.chanceSum += chance[0];

      this.totalProducedItems = { ...this.producedItems };
      for (const chance of this.randomProducedItems) {
        for (const k in chance[1]) {
          this.totalProducedItems[k] =
            (this.totalProducedItems[k] || 0) + (chance[1][k] * chance[0]) / this.chanceSum;
        }
      }
    } else {
      this.totalProducedItems = this.producedItems;
    }

    // A product with no `costSell` — or a name that resolves to nothing — makes
    // the profit unknowable, and the table would print NaN. The page has no way
    // to say "incomplete", so the number is left as it works out and the entry
    // is named in the console for whoever is fixing the pack.
    this.profit = totalSellCost(this.producedItems) - totalSellCost(this.requiredItems) - this.cost;
    if (Number.isNaN(this.profit))
      console.warn(`${this.uid}: profit is NaN, one of its items has no sell cost`);
    this.profitPerHour = this.profit / Number(this.time);
    this.sizeChange = totalSize(this.producedItems) - totalSize(this.requiredItems);

    backLink(this.uid, Object.keys(this.totalProducedItems), rul.items, "manufacture");

    Service.add("allowsManufacture", this.name, this.requiresBaseFunc);
  }
}

export class SoldierTransformation extends Entry {
  forbiddenPreviousTransformations?: string[];
  blocksTransformations?: string[];

  constructor(raw: RawEntry) {
    super("soldierTransformation");
    this.from(raw);
  }
}

/**
 * A stat change a soldier gets: one stage of a commendation, or the reward of a
 * transformation project.
 *
 * The blocks are keyed by `name` rather than `id`, so `Entry.from` relies on the
 * `name` setter to fill in the id. Commendations look their stages up here by
 * id while they are parsed, so this collection has to be parsed before them.
 *
 * The fields are `declare`d rather than plain class fields: the compiler emits
 * own `undefined` properties for the latter, and `MainTable` draws a `special`
 * row such as "Recovery" even when its value is undefined, so every bonus would
 * grow an empty row it never had. `from` fills in whichever ones the pack sets.
 */
export class SoldierBonus extends Entry {
  declare stats?: { [stat: string]: number };
  declare recovery?: { [stat: string]: { flatOne?: number; flatHundred?: number } };

  constructor(raw: RawEntry) {
    super("soldierBonuses");
    this.from(raw);
  }
}

export class DamageType extends Entry {
  items?: string[];
  commendations?: string[];
  enviroEffects?: string[];

  constructor(raw: RawEntry) {
    super("damageTypes");
    this.from(raw);
  }
}

/**
 * One set of voiced unit responses, listed in `voiceSets:`.
 *
 * Each set names four BATTLE.CAT sound slots (`selectUnit`, `startMoving`,
 * `selectWeapon`, `annoyed`), each of which may hold a list of options, and
 * the unit kinds it applies to. The sound ids themselves are bare CAT
 * indices — no pack ships the CAT's contents — so the restriction lists are
 * the meaningful half of the entry.
 */
export class VoiceSet extends Entry {
  selectUnit?: number | number[];
  startMoving?: number | number[];
  selectWeapon?: number | number[];
  annoyed?: number | number[];
  allowedGenders?: string[];
  allowedSoldierTypes?: string[];
  allowedUnitTypes?: string[];
  allowedArmorTypes?: string[];

  constructor(raw: RawEntry) {
    super("voiceSets");
    this.from(raw);
  }
}

/**
 * One globe area with every number in it actually a number.
 *
 * Packs write coordinates as strings as readily as numbers — TFTD has
 * `["-.4024658", 9.597534, …]`, which the engine accepts because it parses with
 * `toDouble`. Kept as strings they make every sum a concatenation, and the map
 * drew `NaN` where a string met a number, so the conversion happens once here
 * rather than in each projection.
 *
 * Only the five leading fields are numeric: the optional sixth is a city id.
 */
function numberArea(area: MapArea): MapArea {
  const result = area.slice() as MapArea;
  for (let i = 0; i < 5 && i < result.length; i++) result[i] = Number(result[i]);
  return result;
}

/**
 * A geoscape region.
 *
 * A region is mostly a *distribution*, not a place: it declares how likely a
 * mission is to target it (`regionWeight`), the boxes its sites spawn in
 * (`areas`), and the `missionZones` that UFO trajectories bend through. Only the
 * first thing is uniform across a pack — in the packs checked, 15 of 54 regions
 * have areas and most have a single zone — so the page has to cope with a region
 * that has no map data at all.
 *
 * A zone is a list of `[lon1, lon2, lat1, lat2, textureId?, cityId?]`; a single
 * point (a city) is written with `lon1 == lon2`. Zone longitudes do **not**
 * wrap: `lon2` is never below `lon1` and may exceed 360, which is the opposite
 * of `areas`.
 */
export class Region extends Entry {
  declare cost?: number;
  declare regionWeight?: number;
  declare areas?: MapArea[];
  declare missionZones?: MapArea[][];
  /** Texture ids this region's sites can use, from `globe: textures:` */
  declare textures?: number[];
  /** Mission type -> weight, as `missionWeights` states it */
  declare missionWeights?: { [mission: string]: number };
  declare typeString?: string;

  constructor(raw: RawEntry) {
    super("regions");
    this.from(raw);
    // Assigned only when present: an own `undefined` would draw an empty row
    // wherever the entry is rendered raw, the same reason `armors` is `declare`.
    if (this.areas) this.areas = this.areas.map(numberArea);
    if (this.missionZones)
      this.missionZones = this.missionZones.map((zone) => zone.map(numberArea));
  }
}

/**
 * An inventory section: a place a soldier can hold an item.
 *
 * The ruleset calls the numeric kind `type`, but `Entry` already uses `type` as
 * an alias for `id`, so the raw value is kept as `invType` instead: copying it
 * through `from` would otherwise run `set type` and overwrite the id with a
 * digit. `type` here is the engine's `InventoryType`: 0 is a slot grid, 1 is a
 * hand, 2 is the ground. A section also stores where the game draws it (`x`,
 * `y`, in pixels), which cells it offers (`slots`, as `[x, y]`), and the time
 * each move into it costs (`costs`). A hand has no slots: its one cell can hold
 * any item.
 */
export class InventorySection extends Entry {
  declare x?: number;
  declare y?: number;
  /** `InventoryType`: 0 slot grid, 1 hand, 2 ground */
  declare invType?: number;
  /** `[x, y]` cells of a slot grid, empty for a hand or the ground */
  declare slots?: [number, number][];
  /** Time cost of moving into each section, keyed by its id */
  declare costs?: { [section: string]: number };
  declare listOrder?: number;

  constructor(raw: RawEntry) {
    // The raw table is `invs`, and `camelToUnderscore` would make its section
    // `INVS`; the engine calls the collection `inventorySections`, and items
    // already list their allowed places in `supportedInventorySections`, which
    // is crosslinked to that same name.
    super("inventorySections");
    // `type` is taken out of the raw node so `from` cannot copy it over `id`
    // through `Entry`'s `set type`, and kept as `invType` instead.
    //
    // It stays absent when the pack does not state it, rather than falling back
    // to the engine's `INV_SLOT` default: a pack may override only part of a
    // section and leave the rest to the game's own `standard` ruleset, which the
    // pedia does not read. XComFiles does exactly that — its hands have no
    // `type`, `x` or `y` at all, and they are hands because the stock ruleset
    // says so. Printing "INV_SLOT" there would be inventing data.
    const { type, ...rest } = raw ?? {};
    this.from({ ...rest, invType: type == null ? undefined : Number(type) });
  }
}

/**
 * A globe box or point, `[lon1, lon2, lat1, lat2, textureId?, cityId?]` */
export type MapArea = [number, number, number, number, number?, string?];

/**
 * One leg of a flight, as the engine really flies it.
 *
 * `altitude` is the altitude in force *during* the leg, which is the previous
 * line's rather than the destination's — see `UfoTrajectory.legs`.
 */
export type FlightLeg = {
  /** 1-based: leg 1 is the one away from the spawn point */
  index: number;
  /** Zone the leg starts in */
  from: number;
  /** Zone the leg flies to */
  to: number;
  /** The engine's altitude index: 0 ground, 1 very low, 2 low, 3 high, 4 very high */
  altitude: number;
  /** Percentage of the craft's `speedMax` */
  speed: number;
  /** Whether the UFO lands when the leg ends */
  lands: boolean;
};

/**
 * One stop of a flight: the zone the UFO is in, and what brought it there.
 *
 * A stop is not a line of the ruleset. Line 0 is the spawn state and every later
 * line is a *destination*, so the stops are what those lines add up to: the
 * spawn point, then one arrival per leg.
 *
 * Two consecutive stops can name the same zone. The engine re-targets the second
 * line, which sends the craft to a fresh random point in that zone, so it is
 * moving inside the zone rather than resting: the page says so rather than
 * calling it a wait.
 */
export type FlightStop = {
  /** Zone index, into a region's `missionZones` */
  zone: number;
  /** 0-based position in the flight, which is the number a page prints */
  index: number;
  /** The leg that arrived here, or nothing at the spawn point */
  arrival?: FlightLeg;
  /** Whether the UFO is on the ground here, so its cargo can be found */
  lands: boolean;
};

/**
 * One step of a flight: a stop the UFO is at, or a leg it flies between two.
 *
 * This is the shape a page reads a flight in. A table interleaves the two, and a
 * map needs each stop together with the leg that reaches it, so both are served
 * by one alternating list rather than each zipping the raw views itself.
 */
export type FlightStep = { kind: "stop"; stop: FlightStop } | { kind: "leg"; leg: FlightLeg };

/**
 * A UFO flight path, as a list of waypoints.
 *
 * A waypoint is `[zone, altitude, speed]`, and the zone is an index into the
 * `missionZones` of whichever region the mission picked. A trajectory therefore
 * has no place on the globe by itself: the same waypoints describe a different
 * path in every region. That is why the page always draws it against a named
 * region, resolved through the missions that fly it.
 *
 * A line is a **destination**, not a stop: it says which zone to fly to and the
 * altitude and speed to adopt on the way there. Line 0 doubles as the spawn
 * state. The engine also re-targets line 1 on the first arrival (because it
 * advances the index only afterwards), so line 1 is visited twice and N lines
 * make N legs, not N-1. `legs` reproduces that; do not count `waypoints - 1`.
 */
export class UfoTrajectory extends Entry {
  declare groundTimer?: number;
  /**
   * `[zone, altitude, speed]` triples, in flight order.
   *
   * A line does not mean one thing: read `legs` instead, which decodes them.
   * Line 1 is the spawn state and the values for the first segment; line 2 is an
   * arrival *and* a departure, so its zone is visited twice; line 3 onward are
   * plain destinations.
   */
  declare waypoints?: [number, number, number][];

  constructor(raw: RawEntry) {
    super("ufoTrajectories");
    this.from(raw);
  }

  /** The highest zone index the path visits, or -1 when it has no waypoints */
  get maxZone() {
    const zones = this.waypoints ?? [];
    return zones.length ? Math.max(...zones.map((w) => Number(w?.[0]) ?? 0)) : -1;
  }

  /** Whether `region` has zones for every waypoint of this path */
  fits(region?: Region) {
    return !!region && (region.missionZones?.length ?? 0) > this.maxZone;
  }

  /**
   * The legs the engine flies, in order.
   *
   * This is the sane form of the ruleset's lines, and the reason it has to exist
   * is that a line's zone and a line's altitude/speed are read at different
   * moments. Numbering the lines and legs from 1, there are two rules:
   *
   * - the stops are `z1, z2, z2, z3, … zN`: line 1's zone is only ever the spawn
   *   point, every later line's zone is a destination, and line 2's is visited
   *   twice because `ufoReachedWaypoint` advances the index only *after*
   *   re-targeting;
   * - leg *m* is flown at line *m*'s altitude and speed, and heads for line *m*'s
   *   zone — except leg 1, which heads for line 2's zone (`spawnUfo` sets the
   *   destination to index 1 while the altitude and speed are still index 0's).
   *
   * So N lines make N legs. Two consequences are easy to get wrong and are
   * handled here:
   *
   * - a landing leaves the UFO on the ground, and taking off again always
   *   happens at very low altitude (`ufoLifting`), so the leg after a landing is
   *   not flown at the ground line's altitude;
   * - a landing is decided by the altitude of the line *after* the one a leg
   *   flies to, because that is the line whose altitude the UFO adopts on
   *   arrival: leg m lands iff line m+1 is on the ground. Where it lands is
   *   wherever that leg was already heading, so a ground line 2 lands in line 2's
   *   own zone (leg 1 heads there) while a later ground line lands in the zone of
   *   the line before it. A ground line 1 instead means the UFO spawns landed and
   *   waits out `groundTimer` before leaving. A ground *last* line lands nothing
   *   extra — the UFO is destroyed on reaching it — but it does make line N-1's
   *   zone a landing.
   *
   * Fewer than two lines is not flyable: the engine throws "Missing second
   * waypoint!", because the spawn point and the first destination are separate
   * lines. Such a path returns no legs rather than an invented one.
   */
  get legs(): FlightLeg[] {
    const lines = this.waypoints ?? [];
    const n = lines.length;
    if (n < 2) return [];
    const zoneOf = (i: number) => Number(lines[i]?.[0]);
    const altitudeOf = (i: number) => Number(lines[i]?.[1]);
    // A UFO that spawns on the ground stays there for the ground timer before
    // it can fly on, exactly like one that lands later
    let grounded = altitudeOf(0) === 0;
    const out: FlightLeg[] = [];
    let from = zoneOf(0);
    for (let m = 1; m <= n; m++) {
      // Leg 1 is already aimed at line 1; every later leg at the line before it
      const to = m === 1 ? zoneOf(1) : zoneOf(m - 1);
      const lands = m < n && altitudeOf(m) === 0;
      out.push({
        index: m,
        from,
        to,
        altitude: grounded ? 1 : altitudeOf(m - 1),
        speed: Number(lines[m - 1]?.[2] ?? 0),
        lands,
      });
      from = to;
      grounded = lands;
    }
    return out;
  }

  /** The zones the UFO is in, in order: the spawn point, then each leg's arrival */
  get stops(): number[] {
    const legs = this.legs;
    if (!legs.length) return (this.waypoints ?? []).map((w) => Number(w?.[0]));
    return [legs[0].from, ...legs.map((leg) => leg.to)];
  }

  /**
   * The flight as stops, each carrying the leg that arrives at it.
   *
   * `legs` is a list of moves; this is the same flight read as a list of places.
   * A binder, a table and a map all want the second, and none of them should have
   * to re-derive it: a stop's altitude and speed are the arriving leg's, which is
   * exactly the detail that is easy to get wrong.
   */
  get flightStops(): FlightStop[] {
    const legs = this.legs;
    if (!legs.length)
      return (this.waypoints ?? []).map((w, i) => ({
        zone: Number(w?.[0]),
        index: i,
        lands: i === 0 && Number(w?.[1]) === 0,
      }));
    return [legs[0].from, ...legs.map((leg) => leg.to)].map((zone, i) => ({
      zone,
      index: i,
      arrival: legs[i - 1],
      // The spawn point counts only when the craft starts down there
      lands: i === 0 ? Number(this.waypoints?.[0]?.[1]) === 0 : !!legs[i - 1]?.lands,
    }));
  }

  /**
   * The flight as one alternating list: a stop, the leg away from it, the next
   * stop, and so on.
   *
   * A table reads a flight this way — "at 1, then fly there, then at 2" — and so
   * does a map when it wants to label a stop and describe the move before it
   * together. Deriving it once means the two views cannot disagree about which
   * stop a leg belongs to.
   */
  get flightSteps(): FlightStep[] {
    const stops = this.flightStops;
    const legs = this.legs;
    if (!legs.length) return stops.map((stop) => ({ kind: "stop" as const, stop }));
    const out: FlightStep[] = [{ kind: "stop", stop: stops[0] }];
    for (const [i, leg] of legs.entries()) {
      out.push({ kind: "leg", leg });
      out.push({ kind: "stop", stop: stops[i + 1] });
    }
    return out;
  }

  /**
   * How long one stay on the ground lasts, in seconds, or nothing when the path
   * never puts a UFO down.
   *
   * `groundTimer` is counted down five seconds at a time, so it is five times
   * longer than its own help text ("seconds") suggests.
   */
  get landingSeconds(): number | undefined {
    const lands =
      (this.waypoints ?? []).length > 1 &&
      (Number(this.waypoints?.[0]?.[1]) === 0 || this.legs.some((leg) => leg.lands));
    return lands ? Math.max(0, Number(this.groundTimer ?? 0)) * 5 : undefined;
  }
}

/**
 * A music track.
 *
 * A pack never states a track's file: the engine derives it as
 * `SOUND/<name>.<ext>`, where `name` is the optional `name` field or the id
 * when absent (see `RuleMusic::getName`). The extension is decided at runtime
 * by the player's `preferredMusic`, so none can be printed with certainty; the
 * pedia tries the common ones when it attempts playback.
 *
 * Deliberately not an `Entry`: a track has no stats worth an article, and
 * `Entry.from` would create a page for each one.
 */
export class Music {
  id: string = "";
  /** The file name stem the engine builds `SOUND/<name>.<ext>` from */
  fileName: string = "";
  /** `catPos` and `normalization` are only used by CAT-based music */
  catPos?: number;
  normalization?: number;

  constructor(
    id: string,
    raw: { name?: string; catPos?: number | string; normalization?: number | string },
  ) {
    this.id = id;
    const name = raw?.name || id;
    this.fileName = String(name);
    if (raw?.catPos != null) this.catPos = Number(raw.catPos);
    if (raw?.normalization != null) this.normalization = Number(raw.normalization);
  }
}

/**
 * A value that differs between stages, shown in a table as `first..last`.
 *
 * Only produced by `Commendation.range`, which refuses anything that is not a
 * number, so the two ends are numbers.
 */
export class ValueRange {
  constructor(
    public first: number,
    public last: number,
  ) {}
}

/**
 * Keys a stage bonus carries that are not column values: its own id and name
 * (`Entry.name` is just `id` again), the collection it was parsed into, and the
 * two containers whose contents are the actual columns. A column named after
 * one of these must read the commendation, not a stage.
 */
const stageInternals = ["id", "name", "collection", "stats", "recovery"];

/** The value one stage bonus gives for a column, or undefined when it gives none */
function stageValue(bonus: Entry, n: string) {
  if (n.substring(0, 9) === "recovery.")
    return (bonus.recovery as { [stat: string]: BonusMap } | undefined)?.[n.substring(9)]?.flatOne;
  if (stageInternals.includes(n)) return undefined;
  // A stat the stage omits is not the same as a stat it sets to zero
  const stats = bonus.stats as { [stat: string]: unknown } | undefined;
  if (stats && n in stats) return stats[n];
  return bonus[n];
}

/**
 * One deed of a `killCriteria` list, as a pack writes it: how many such kills it
 * takes, and the conditions that describe the kill.
 *
 * The conditions are engine tokens (`STATUS_DEAD`, `FACTION_HOSTILE`, a race or
 * an item id) whose meaning depends on which list they belong to, so they stay
 * strings until `parseKillCriteria` resolves them.
 */
export type KillCriteriaDeed = [times: number, conditions: string[]];

/**
 * A deed after `parseKillCriteria` resolved its conditions: a repeat count plus
 * whichever of the kill's fields the conditions named. A condition that matched
 * no known list is kept as a field of its own, hence the index signature.
 */
export type ResolvedDeed = {
  times: number;
  element?: string;
  type?: string;
  status?: string;
  faction?: string;
  race?: string;
  unit?: string;
  item?: string;
  [field: string]: unknown;
};

export class Commendation extends Entry {
  /** Soldier bonus granted by each stage, in stage order */
  soldierBonusTypes?: string[];
  /** Criterion name -> the value it needs for each of the ten stages */
  criteria?: { [criterion: string]: number[] };
  /** Why a kill counts, as `killCriteria` states it */
  killCriteria?: KillCriteriaDeed[][];
  finalBonus?: Entry;
  damageTypes: string[] = [];
  battleTypes: string[] = [];
  items: string[] = [];
  /** Every resolved deed of every stage, flat */
  kcd: ResolvedDeed[] = [];
  /** `killCriteria` after parsing: one list of resolved deeds per stage */
  killCriteria2: ResolvedDeed[][] = [];

  constructor(raw: RawEntry) {
    super("commendations");
    this.from(raw);
    this.finalBonus =
      this.soldierBonusTypes &&
      rul.soldierBonuses[this.soldierBonusTypes[this.soldierBonusTypes.length - 1]];
  }

  /**
   * The last stage that actually grants something, following `soldierBonusTypes`.
   *
   * A commendation lists one bonus per stage, but the later stages are often
   * empty placeholders while the real reward sits in stage 1 or 10. The section
   * table shows one row per commendation, so it needs a single stage to read the
   * stats from: the last one that has any. Falls back to the last stage listed,
   * so a commendation whose stages are all empty still resolves.
   */
  get lastMeaningfulBonus(): Entry | undefined {
    const stages = (this.soldierBonusTypes || [])
      .map((id) => rul.soldierBonuses[id])
      .filter((b) => b != null);
    if (stages.length === 0) return this.finalBonus;
    const meaningful = (b: Entry) =>
      Object.keys(b.stats ?? {}).length > 0 || Object.keys(b.recovery ?? {}).length > 0;
    return [...stages].reverse().find(meaningful) ?? stages[stages.length - 1];
  }

  /** The stage bonuses of this commendation, in the order they are earned */
  get stages(): Entry[] {
    return (this.soldierBonusTypes || [])
      .map((id) => rul.soldierBonuses[id])
      .filter((b) => b != null);
  }

  /** Every value the stages grant for column `n`, in stage order */
  private granted(n: string) {
    if (n === "id") return [];
    return this.stages.map((s) => stageValue(s, n)).filter((v) => v != null);
  }

  /**
   * The value of column `n` across all stages, when the stages disagree.
   *
   * A reward usually grows with the stage, so a single cell showing only one
   * stage's number hides the fact that it is a ramp: stage 1 grants `health 2`,
   * stage 10 grants `health 20`. The cell then reads `2..20` — from the first
   * stage that grants anything to the last one that does, which also covers
   * ramps that start late or stop early (a bonus whose stages 9 and 10 only
   * grant something else still ramps within the stages that do grant it).
   *
   * Sorting uses `sortField`, i.e. the last value, so the ordering agrees with
   * the right-hand end of the range.
   *
   * Returns null when there is no range to show: one stage only, all stages
   * agreeing, or just one stage granting the column at all. Text is left alone:
   * a range only says something about a number.
   */
  range(n: string): ValueRange | null {
    const values = this.granted(n);
    if (values.length < 2) return null;
    const first = values[0],
      last = values[values.length - 1];
    if (first === last || typeof first !== "number" || typeof last !== "number") return null;
    return new ValueRange(first, last);
  }

  /**
   * What a section table cell shows for column `n`, see `range`.
   *
   * `true` is the "this is being drawn, not sorted" flag, which `Entry` answers
   * for `id` with the uid: the cell is a link to the page, and the translated
   * title it sorts by has no article behind it.
   */
  cellValue(n: string) {
    return this.range(n) ?? this.sortField(n, true);
  }

  parseKillCriteria() {
    if (this.killCriteria) {
      for (const deeds of this.killCriteria) {
        const group: ResolvedDeed[] = [];
        for (const deedList of deeds) {
          const deed: ResolvedDeed = { times: deedList[0] };

          if (deedList[1]) {
            for (let i = 0; i < deedList[1].length; i++) {
              const k = deedList[1][i];

              const idt = internalDamageTypes.indexOf(k);
              if (idt !== -1) {
                deed.element = damageTypes[idt];
                // The condition list is rewritten so the page shows the resolved
                // damage type rather than the engine's internal name
                deedList[1][i] = damageTypes[idt];
                this.damageTypes.push(damageTypes[idt]);
                backLink(this.uid, [deed.element], rul.damageTypes, "commendations");
                continue;
              }

              const ibt = internalBattleTypes.indexOf(k);
              if (ibt !== -1) {
                deed.type = k;
                this.battleTypes.push(k);
                backLink(this.uid, [k], rul.battleTypes, "commendations");
              } else if (killStatuses.includes(k)) {
                deed.status = k;
              } else if (killFactions.includes(k)) {
                deed.faction = k;
              } else if (rul.alienRaces[k]) {
                deed.race = k;
                backLink(this.uid, [k], rul.alienRaces, "commendations");
              } else if (rul.units[k]) {
                deed.unit = k;
                backLink(this.uid, [k], rul.units, "commendations");
              } else if (rul.items[k]) {
                deed.item = k;
                backLink(this.uid, [k], rul.items, "commendations");
              } else {
                deed[k] = true;
              }
            }
          }

          if (deed.type || deed.element) {
            if (!deed.type) {
              backLink2(
                this,
                rul.damageTypes[deed.element ?? ""]?.items ?? [],
                rul.items,
                "commendations",
                "items",
              );
            } else if (!deed.element) {
              backLink2(
                this,
                (rul.battleTypes[deed.type].items as string[] | undefined) ?? [],
                rul.items,
                "commendations",
                "items",
              );
            } else {
              const items = (rul.damageTypes[deed.element ?? ""]?.items ?? []).filter(
                (id) => rul.items[id]?.internalBattleType === deed.type,
              );
              backLink2(this, items, rul.items, "commendations", "items");
            }
          }

          this.kcd.push(deed);
          group.push(deed);
        }
        this.killCriteria2.push(group);
      }
    }
  }

  sortField(n: string, v?: string | boolean) {
    if (n == null) return;
    // A cell can span every stage, but it still sorts by the value a soldier
    // ends up with: the column's value at the last stage that grants it. The
    // last stage *listed* is often an empty placeholder, and reading that would
    // rank a phantom 0 above a real bonus granted earlier.
    const granted = this.granted(n);
    if (granted.length > 0) return granted[granted.length - 1];

    // No stage grants the column at all. Stats still read as 0 rather than
    // empty, as they did before ranges existed.
    const fb = this.lastMeaningfulBonus;
    if (fb && n !== "id" && !stageInternals.includes(n)) {
      const stats = fb.stats as { [stat: string]: unknown } | undefined;
      if (statsList.includes(n) || n === "mana") return stats ? stats[n] || 0 : 0;
      const recovery = fb.recovery as { [stat: string]: BonusMap } | undefined;
      if (recovery && n.substring(0, 9) === "recovery.") {
        return recovery[n.substring(9)]?.flatOne;
      }
      if (fb[n] != null) return fb[n];
    }

    // Not a stage column: the identity column answers with the uid here too, and
    // an ordinary column reads the commendation's own field
    return super.sortField(n, v);
  }
}

export class Research extends Entry {
  getOneFree?: string[];
  unlocks?: string[];
  dependencies?: string[];
  requires?: string[];
  // Backlinks, built by `Ruleset` (see `backLink` calls there). The names carry
  // the access rule: (all of `dependencies`) OR (any of `unlockedByAnyOf`), plus
  // all of `requires`. `requiredTogetherFor` is who needs this one as part of
  // their whole `dependencies` list, `unlockedByAnyOf` is who unlocks this one
  // on their own, and `getForFreeFrom` is who may grant this one randomly.
  requiredTogetherFor?: string[];
  unlockedByAnyOf?: string[];
  getForFreeFrom?: string[];
  // Bottleneck scores (see `researchBottlenecks.ts`): stamped by `Ruleset`
  // when this topic is a major gate — at least three topics sit behind it in
  // their strict dependency cone (topics reachable without it, through a
  // shortcut or a free grant, are not behind it), and it holds at least one
  // per cent of the pack's heaviest bottleneck score. `gatesScore` is the
  // cone weight (`gatesValue`) minus the heaviest strict dependent's, so a
  // split point scores high and a single chain link scores only the next
  // link's own weight.
  gatesTopics?: number;
  gatesValue?: number;
  gatesScore?: number;
  cost?: number;
  points?: number;
  manufacture?: string[];
  requiresBaseFunc?: string[];
  lookup?: string;
  seeAlso?: string[];
  allowsBuying?: string[];
  spawnedItem?: string;

  constructor(raw: RawEntry) {
    super("research");
    this.from(raw);
    Service.add("allowsResearching", this.name, this.requiresBaseFunc);
  }
}

export class AlienDeployment extends Entry {
  startingCondition?: string;
  data?: { itemSets?: unknown }[];
  reinforcements?: unknown;
  loot: string[];
  alertBackground?: string;
  briefing?: { background?: string };

  constructor(raw: RawEntry) {
    super("alienDeployments");
    this.from(raw);
    const allItems = new Set<string>();
    for (const d of this.data || []) {
      if (Array.isArray(d.itemSets)) {
        const items = d.itemSets.flat() as string[];
        for (const item of items) allItems.add(item);
      }
    }
    this.loot = [...allItems];
  }
}

export class CraftWeapon extends Entry {
  weaponType: string = "";
  launcher?: string;
  requiresBuyBaseFunc?: string[];
  /** Alternate UFOpaedia article the game opens for this weapon */
  ufopediaType?: string;

  constructor(raw: RawEntry) {
    super("craftWeapons");
    this.from(raw);
    Service.add("canBuy", this.type, this.requiresBuyBaseFunc);
    //if(Number.isInteger(this.weaponType))
    this.weaponType = `weaponType${this.weaponType || 0}`;
    Entry.reserve({ id: this.weaponType }, "weaponTypes");
  }
}

export class Craft extends Entry {
  startingConditions?: string[];
  weaponTypes?: string[][];
  allWeaponTypes?: string[];
  sprite?: number;
  marker?: number;

  constructor(raw: RawEntry) {
    super("crafts");
    this.from(raw);
    this.allWeaponTypes = this.allWeaponTypes || [];
    if (this.weaponTypes) {
      const weaponTypes = this.weaponTypes as unknown as { [slot: string]: unknown };
      for (const slot in weaponTypes) {
        if (!Array.isArray(weaponTypes[slot])) weaponTypes[slot] = [weaponTypes[slot]];
        weaponTypes[slot] = (weaponTypes[slot] as string[]).map((n) => {
          const id = `weaponType${n}`;
          Entry.reserve({ id }, "weaponTypes");
          this.allWeaponTypes?.push(id);
          return id;
        });
      }
      this.allWeaponTypes = [...new Set(this.allWeaponTypes)];
    }
    //this.sprite = rul.obsSprite("baseSprite", +this.sprite + 33);
  }
}

export class Facility extends Entry {
  aliens?: number;
  prisonType?: number;
  spriteFacility?: number;
  size?: number;
  provideBaseFunc?: string[];
  requiresBaseFunc?: string[];
  forbiddenBaseFunc?: string[];
  buildCostItems?: { [key: string]: { [key: string]: number } };
  /** Alternate UFOpaedia article the game opens for this facility */
  ufopediaType?: string;

  constructor(raw: RawEntry) {
    super("facilities");
    this.from(raw);

    Service.add("providedBy", this.type, this.provideBaseFunc);
    Service.add("allowsBuilding", this.type, this.requiresBaseFunc);
    Service.add("forbidsBuilding", this.type, this.forbiddenBaseFunc);
    if (this.aliens) {
      Service.add("providedBy", this.type, [`prisonType${this.prisonType || 1}`]);
    }
    if (!this.prisonType && this.aliens) this.prisonType = 1;
  }

  get kennel() {
    return this.prisonType === 2 ? this.aliens : null;
  }

  get prison() {
    return this.prisonType === 2 ? null : this.aliens;
  }
}

export class StartingConditions extends Entry {
  allowedCraft?: string[];
  allowedItemCategories?: string[];
  allowedArmors?: string[];
  forbiddenArmors?: string[];
  allowedSoldierTypes?: string[];
  forbiddenSoldierTypes?: string[];
  allowedVehicles?: string[];
  deployments?: string[];

  constructor(raw: RawEntry) {
    super("startingConditions");
    this.from(raw);
  }
}

/**
 * Base stats of a unit or armor.
 *
 * The engine knows these eleven, but a pack may add its own (`mana` in
 * XPiratez), and a partial ruleset may omit some, so this stays indexable
 * rather than a closed record.
 */
export type Stats = {
  [stat: string]: number | undefined;
  tu?: number;
  stamina?: number;
  health?: number;
  bravery?: number;
  reactions?: number;
  firing?: number;
  throwing?: number;
  strength?: number;
  psiStrength?: number;
  psiSkill?: number;
  melee?: number;
};

export class Unit extends Entry {
  stats?: Stats;
  armor?: string;
  race?: string;
  builtInWeaponSets?: string[][];

  constructor(raw: RawEntry) {
    super("units");
    this.from(raw);
    for (const k in { ...raw }) {
      if (typeof raw[k] === "string" || typeof raw[k] === "number") {
        rul.unitFields.add(k);
      }
    }

    const armor = rul.armors[raw.armor as string];
    if (armor) {
      armor.users = armor.users || [];
      armor.users.push(this.type);
    }
    if (this.builtInWeaponSets) {
      const weapons = new Set(this.builtInWeaponSets.flat());
      for (const w of weapons) {
        const item = rul.items[w];
        if (item) {
          item.heldBy = item.heldBy || new Set<string>();
          item.heldBy.add(this.type);
        }
      }
    }
  }

  sortField(n: string, v?: string | boolean) {
    if (statsList.includes(n)) return this.stats ? this.stats[n] || 0 : 0;
    // `super` answers the identity column with the uid, which is the only name a
    // `type`-keyed unit has
    return super.sortField(n, v);
  }
}

const defaultRange: { [mode: string]: number } = { snap: 15, auto: 7, aimed: 200 };

export class Attack {
  /** Columns are read by name, like `Entry`'s index signature */
  [id: string]: unknown;
  possible = false;
  cost?: { time: number; energy: number };
  flatTime = false;
  damage?: number;
  damageBonus?: BonusMap;
  damageType?: number;
  accuracy?: number;
  accuracyMultiplier?: BonusMap;
  alter?: AlterMap;
  shots: number = 1;
  range?: number;
  pellets: number = 1;
  name?: string;
  tuPercent?: number;

  constructor(
    public item: Item,
    public mode: string,
  ) {
    let capMode = mode.charAt(0).toUpperCase() + mode.substr(1);

    const isDefaultAttack =
      (mode === "ammo" && item.battleType === 2) ||
      (mode === "melee" && item.battleType === 3) ||
      (mode === "psi" && item.battleType === 9) ||
      (mode === "throw" && (item.battleType === 4 || item.battleType === 5));

    if (mode === "throw" && !isDefaultAttack) return;

    const exists = item[`accuracy${capMode}`] || item[`cost${capMode}`] || isDefaultAttack;

    if (!exists) return;

    if (mode === "melee" && item.battleType !== 3) {
      this.damage = item.meleePower;
      this.damageBonus = item.meleeBonus;
      this.damageType = item.meleeType;
    } else if (!item.compatibleAmmo) {
      this.damage = item.power;
      this.damageBonus = item.damageBonus;
      this.damageType = item.damageType;
    }

    this.pellets = item.shotgunPellets || 1;

    this.shots = mode === "auto" ? item.autoShots || 3 : 1;
    this.name = mode.substr(0, 1).toUpperCase() + mode.substr(1);

    const confId = `conf${this.name}`;
    if (confId in item) {
      const conf = item[confId] as { name?: string; shots?: number } | undefined;
      if (conf?.name) this.name = rul.str(conf.name);
      if (conf?.shots) this.shots = conf.shots;
      delete item[confId];
    }

    if (item[`${mode}AttackName`]) this.name = rul.str(item[`${mode}AttackName`] as string);

    if (mode === "melee") this.alter = item.meleeAlter;

    if (item.battleType === 3 || mode !== "melee") this.alter = item.damageAlter;

    if (this.alter?.ResistType) {
      // `ResistType` may be given as an index or as `STR_DAMAGE_*`; resolve the
      // name first, otherwise `Number()` gives NaN and a bogus damage type
      // entry with an undefined id ends up in the ruleset
      const dType = damageTypeIndex(this.alter.ResistType);
      if (dType == null) {
        console.error(`${this.item.uid} attack has unknown damage type ${this.alter.ResistType}`);
      } else {
        this.damageType = dType;
        item.addDamageType(this.damageType);
      }
    }

    if (mode !== "ammo") {
      if (((mode === "melee" && item.battleType === 3) || mode !== "melee") && item.flatRate)
        this.flatTime = item.flatRate;

      const flat = item[`flat${capMode}`] as { time?: unknown } | undefined;
      if (flat?.time) this.flatTime = true;

      if (capMode === "Psi") capMode = "Use";

      this.cost = this.cost = (item[`cost${capMode}`] as
        | { time: number; energy: number }
        | undefined) || {
        time: item[`tu${capMode}`] as number,
        energy: 0,
      };

      this.accuracy = (item[`accuracy${capMode}`] as number | undefined) || 100;

      let accuracyMultiplier =
        mode === "throw"
          ? item.throwMultiplier
          : mode === "melee"
            ? item.meleeMultiplier
            : item.accuracyMultiplier;

      if (!accuracyMultiplier) {
        const defaultAccuracyStat =
          mode === "throw" ? "throwing" : mode === "melee" ? "melee" : "firing";
        accuracyMultiplier = {};
        accuracyMultiplier[defaultAccuracyStat] = 1;
      }

      this.accuracyMultiplier = accuracyMultiplier;

      if (this.damageType != null) {
        item.addDamageType(this.damageType);
      }

      for (const k in this.accuracyMultiplier || [])
        backLink(item.uid, [k], "stats", "weaponDamage");
    }

    if (`${mode}Range` in item) {
      this.alter = Object.assign({}, this.alter || {});
      this.alter.range = item[`${mode}Range`];
    }

    // `damageType`/`ResistType` may be an index or an `STR_DAMAGE_*` name; the
    // list shows the resolved name either way, and an unknown value is left
    // alone rather than turned into a bogus type
    for (const k in this.alter) {
      if (k === "damageType" || k === "ResistType") {
        const idx = damageTypeIndex(this.alter[k]);
        if (idx != null) this.alter[k] = damageTypes[idx];
      }
    }

    let range: number =
      (item[`${mode}Range`] as number | undefined) ||
      (item[`${mode.substr(0, 3)}Range`] as number | undefined) ||
      (this.alter?.range as number | undefined) ||
      defaultRange[mode];
    this.range = range;

    if (item.maxRange != null && item.maxRange < range) {
      range = item.maxRange;
      this.range = range;
    }

    if (this.alter && item.maxRange != null && item.maxRange < Number(this.alter.range))
      this.alter.range = `${item.maxRange}`;

    this.possible = true;

    if (!this.flatTime && this.cost?.time) {
      this.tuPercent = this.cost.time;
    }

    rul.attacks.push(this);
  }

  sortField(n: string, _v?: string | boolean) {
    switch (n) {
      case "internalBattleType":
        return this.item.internalBattleType;

      case "damageType":
        return this.damageType != null ? damageTypes[this.damageType] : undefined;

      case "item":
        return this.item.uid;

      // An attack has no identity of its own: it is a row of its item's table,
      // and it names the row by the item it belongs to
      case "id":
        return this.item.uid;
    }

    if (this.alter?.[n]) {
      return this.alter[n];
    }

    if (this.damageBonus?.[n]) {
      return this.damageBonus[n];
    }

    if (n?.substring(0, 4) === "acc*" && this.accuracyMultiplier) {
      return this.accuracyMultiplier[n.substring(4)];
    }

    // Columns are looked up by name, so a column the class does not declare
    // reads as absent rather than an error
    return (this as unknown as { [field: string]: unknown })[n];
  }
}

export class Armor extends Entry {
  sprite?: string;
  damageModifier?: number[];
  armor: { [key: string]: number | undefined } = {};
  users?: string[];
  startingConditions: string[] = [];
  size = 1;
  /** Body name -> layer -> sprite name, see `dollSprites` */
  layersDefinition?: { [body: string]: { [layer: string]: string } };
  layersDefaultPrefix?: string;
  spriteInv?: string;
  storeItem?: string;
  frontArmor?: number;
  sideArmor?: number;
  rearArmor?: number;
  underArmor?: number;
  units?: string[];
  /** Stat modifiers the armor applies, e.g. `{ tu: -10 }` */
  stats?: { [stat: string]: number };
  /** Free-form pack tags (`ARMOR_ENERGY_SHIELD_CAPACITY` and the like) */
  tags?: { [tag: string]: number | string };
  /** Alternate UFOpaedia article the game opens for this armor */
  ufopediaType?: string;

  constructor(raw: RawEntry) {
    super("armors");
    this.from(raw);
    if (!this.size) this.size = 1;

    this.armor = {
      Front: this.frontArmor,
      Side: this.sideArmor,
      Rear: this.rearArmor,
      Under: this.underArmor,
    };

    if (this.storeItem && rul.items[this.storeItem]) {
      const item = rul.items[this.storeItem];
      if (!item.armors) item.armors = [];
      item.armors.push(this.type);
    }

    for (const unit of this.units || []) {
      const s = rul.soldiers[unit];
      if (s) {
        s.armors = s.armors || [];
        s.armors.push(this.type);
      }
    }
  }

  async dollSprites(): Promise<{ [key: string]: string[] }> {
    let ds: { [key: string]: string[] } = {};
    if (this.layersDefinition) {
      const prefix = this.layersDefaultPrefix;
      for (const body in this.layersDefinition) {
        const layersDef = this.layersDefinition[body];
        const layers: string[] = [];
        for (const layer in layersDef) {
          const name = layersDef[layer];
          if (name?.length) {
            const id = `${prefix}__${layer}__${name}`;
            layers.push((await rul.sprite(id)) ?? id);
          }
        }
        ds[body] = layers;
      }
    } else if (this.spriteInv) {
      const name: string = this.spriteInv;

      if (`${this.spriteInv}.SPK` in rul.sprites) {
        ds = {
          "0": [(await rul.sprites[`${this.spriteInv}.SPK`].data()) as string],
        };
      } else {
        // The paperdoll variants of one body are registered as
        // `<spriteInv><body>`, sometimes with an extension and sometimes
        // without: XCom Files declares `inventory_HYBRID_SOLDIER` beside a bare
        // `inventory_HYBRID`, while the same pack's `ASTRAL_WEREWOLFM0.SPK`
        // carries one. The body is whatever sits between the prefix and the
        // extension, if there is one.
        //
        // Only single pictures are paperdolls. A subdivided set is a unit
        // sprite sheet: `spriteInv: ASTRAL_WEREWOLF` beside `spriteSheet:
        // ASTRAL_WEREWOLF.PCK`, or the drone's `DRONE_TASER.PCK`, each of which
        // sits under the same prefix and was counted as a variant, drawn as a
        // whole 512×720 atlas above the real dolls, labelled either blank or by
        // whatever followed the prefix.
        for (const s in rul.sprites) {
          if (!s.startsWith(name) || s === this.spriteSheet) continue;
          const sprite = rul.sprites[s];
          if (sprite.subX || sprite.subY) continue;
          const body = s.substring(name.length).replace(/\.[^./\\]+$/, "");
          ds[body] = [(await rul.sprite(s)) ?? s];
        }
      }
    }
    return ds;
  }

  sortField(n: string, v?: string | boolean) {
    if (statsList.includes(n)) return this.stats ? this.stats[n] || 0 : 0;
    if (damageTypes.includes(n) && this.damageModifier)
      return (this.damageModifier[damageTypes.indexOf(n)] || 0) * 100;
    if (this.tags && n in this.tags) return this.tags[n];

    if (n === "armorUsers") {
      if (v === "enemies") return Object.values(this.units || {}).length === 0;
      if (v === "allies") return Object.values(this.units || {}).length > 0;
      if (typeof v === "string" && rul.soldiers[v]) {
        return this.units?.includes(v);
      }
    }

    if (n === "allowedIn") {
      return (this.allowedIn as string[] | undefined)?.includes(v as string);
    }

    // The identity column is not a field of the armor: `super` answers it with
    // the uid, which is the only name an armor block has
    return super.sortField(n, v);
  }
}

/** A formula term: a weight, or the coefficients of a polynomial in the stat */
export type BonusValue = number | number[];

/**
 * Stat name -> weight, as `damageBonus`, `meleeMultiplier` and friends state it.
 *
 * A plain weight (`{ strength: 1 }`) or a polynomial written as a list of
 * coefficients; `SpecialBonus` draws both, a list as a sum of powers.
 */
export type BonusMap = { [stat: string]: BonusValue };

/**
 * An attack's damage parameters, straight from the ruleset (`damageAlter`,
 * `meleeAlter`): multipliers, armor effectiveness, blast radius and so on.
 *
 * The field names are the engine's and a pack picks which of them it sets, so
 * this stays a plain map; `AlterList` prints whatever it finds.
 */
export type AlterMap = { [field: string]: unknown };

export class Item extends Entry {
  //sprite: string;
  battleType?: number;
  invWidth = 1;
  invHeight = 1;
  _attacks?: Attack[];
  spawnedBy?: string[];
  requiresBuyBaseFunc?: string[];
  manufacture?: { [key: string]: number };
  componentOf?: { [key: string]: number };
  bigSprite?: string;
  meleePower?: number;
  meleeBonus?: BonusMap;
  meleeType?: number;
  power?: number;
  damageBonus?: BonusMap;
  damageType?: number;
  shotgunPellets?: number;
  meleeAlter?: AlterMap;
  damageAlter?: AlterMap;
  compatibleAmmo?: string[];
  ammo?: { compatibleAmmo: string[] }[];
  autoShots?: number;
  flatRate?: boolean;
  meleeMultiplier?: BonusMap;
  throwMultiplier?: BonusMap;
  accuracyMultiplier?: BonusMap;
  compatibleWeapons?: string[];
  liveAlien?: boolean;
  recover?: boolean;
  prisonType?: number;
  maxRange?: number;
  categories?: string[];
  requiresBuy?: string[];
  commendations?: string[];
  heldBy?: Set<string>;
  dropoff = 2;
  damageTypes?: number[];
  psiVision?: number;
  invSize: string;
  weight?: number;
  clipSize?: number;
  kneelBonus?: number;
  turretType?: number;
  costPrime?: { time: number; [resource: string]: number };
  /** Alternate UFOpaedia article the game opens for this item */
  ufopediaType?: string;

  get sprite() {
    if (this.bigSprite) {
      return rul.obsSprite("big", +this.bigSprite);
    }
    return undefined;
  }

  get internalBattleType() {
    const t = internalBattleTypes[this.battleType || 0];
    return t;
  }

  addDamageType(type: number) {
    // Called from `Attack` with whatever the ruleset wrote as the damage type,
    // so resolve it and ignore unknown values instead of adding an `undefined`
    // id to the damage type section
    const idx = damageTypeIndex(type);
    if (idx == null) return;
    this.damageTypes = this.damageTypes || [];
    addIfNew(this.damageTypes, idx);
    backLink(this.uid, [damageTypes[idx]], "damageTypes", "items");
  }

  constructor(raw: RawEntry) {
    super("items");
    this.from(raw);
    for (const k in { ...raw, ...(raw.damageAlter || {}) }) {
      if (
        typeof raw[k] === "string" ||
        typeof raw[k] === "number" ||
        (raw.damageAlter as { [key: string]: unknown } | undefined)?.[k] != null
      ) {
        rul.itemFields.add(k);
      }
    }

    //this.addToSection(this.internalBattleType);

    if (this.damageType) this.addDamageType(this.damageType);

    const t = this as unknown as {
      flatThrow?: { time?: number };
      flatThrowTime?: number;
    };

    if ("flatThrow" in t) {
      t.flatThrowTime = t.flatThrow?.time;
      delete t.flatThrow;
    }

    Service.add("canBuyItem", this.type, this.requiresBuyBaseFunc);

    if (this.categories) {
      for (const cat of this.categories) rul.addCategory(cat, this.type);
    }

    if (this.liveAlien && this.recover && !this.prisonType) this.prisonType = 1;

    if (this.ammo) {
      this.compatibleAmmo = [
        ...(this.compatibleAmmo || []),
        ...Object.values(this.ammo).flatMap((a) => a.compatibleAmmo),
      ];
    }

    for (const k in this.damageBonus ?? {}) {
      const b = this.damageBonus?.[k];
      if (b !== 0) backLink(this.uid, [k], "stats", "weaponDamage");
      if (Array.isArray(b)) {
        for (const p in b)
          if (b[p] > 0)
            backLink(
              this.uid,
              [k],
              "stats",
              `weaponDamage${p !== "0" ? `<sup>${+p + 1}</sup>` : ""}`,
            );
      }
    }

    for (const k in this.meleeMultiplier || []) backLink(this.uid, [k], "stats", "meleeAccuracy");

    if (this.damageType != null) {
      const idx = damageTypeIndex(this.damageType);
      if (idx != null) backLink(this.uid, [damageTypes[idx]], "damageTypes", "items");
    }

    if (this.damageAlter?.ResistType != null) {
      const idx = damageTypeIndex(this.damageAlter.ResistType);
      if (idx != null) backLink(this.uid, [damageTypes[idx]], "damageTypes", "items");
    }

    this.attacks();

    this.invSize = `${this.invWidth}×${this.invHeight}`;
  }

  attacks() {
    if (!this._attacks) {
      this._attacks = [];
      for (const mode of battleTypes) {
        const attack = new Attack(this, mode);
        if (attack.possible) {
          this._attacks.push(attack);
        }
      }
    }

    if (this.battleType === 2) {
      this._attacks[0].item = this;
      this._attacks[0].mode = "ammo";
    }

    return this._attacks;
  }

  sortField(n: string, v?: string | boolean) {
    if (n === "category" && this.categories)
      return this.categories.includes(v as string) ? v : null;

    if (n === "damageTypes") {
      if (v !== true) {
        const i = damageTypes.indexOf(v as string);
        return this.damageTypes?.includes(i);
      } else {
        return this.damageTypes?.map((d) => damageTypes[d]);
      }
    }

    if (n === "damageType" && this.damageTypes) {
      return this.damageTypes.map((n) => damageTypes[n]);
    }

    if (this.damageAlter && this.damageAlter[n] != null) return this.damageAlter[n];

    return super.sortField(n, v);
  }
}
