import { addIfNew, camelToUnderscore, unique } from '../util';
import { Article } from './Article';
import {
  backLink, backLink2, battleTypes, damageTypeIndex, damageTypes, internalBattleTypes, internalDamageTypes,
  killFactions, killStatuses, rul, Service, statsList
} from './Ruleset';

/** Root class for all ruleset entries */
export class Entry {
  id: string = "";
  armors?: string[];
  [id: string]: any;

  constructor(public collection: string) {
  }

  from(raw: any) {
    this.id = raw.id
    raw = JSON.parse(JSON.stringify(raw));
    for (let k in raw)
      this[k] = raw[k];

    if ((rul as any)[this.collection] == null)
      (rul as any)[this.collection] = {};

    (rul as any)[this.collection][this.id] = this;

    this.addToSection(camelToUnderscore(this.collection).toUpperCase());

    return this
  }

  addToSection(section: string) {
    Article.create(this.id, section);
  }

  sortField(field: string, noTitle: any = false) {
    if (field == "id" && !noTitle)
      return this.title;
    return this[field];
  }

  get title() {
    return rul.tr(this.id);
  }

  static reserve(raw: any, collection) {
    let id = raw.id || raw.type || raw.name;
    if (rul[collection][id]) {
      return rul[collection][id];
    } else {
      return new Entry(collection).from(raw);
    }
  }

  get name() {
    return this.id;
  }

  set name(val) {
    if (this.id == null)
      this.id = val;
  }

  get type() {
    return this.id;
  }

  set type(val) {
    this.id = val;
  }

  fillSimpleEntry(raw) {
  }
}

export class SimpleEntry extends Entry {
  constructor(raw, collection){
    super(collection)
    this.from(raw)
  }
}

export class MissionScript extends Entry {
  researchTriggers;
  researchNeeded: string[];
  researchForbidden: string[];
  constructor(raw) {
    super("missionScripts")
    this.from(raw)
    if (this.researchTriggers) {
      this.researchNeeded = Object.keys(this.researchTriggers).filter(k => this.researchTriggers[k]);
      this.researchForbidden = Object.keys(this.researchTriggers).filter(k => !this.researchTriggers[k]);
    }
    if (this.missionWeights) {
      this._missions = unique(Object.values(this.missionWeights).map(m => Object.keys(m)).flat());
    }
  }
}

export class Soldiers extends Entry {
  statCaps: { [id: string]: number }

  constructor(raw: any) {
    super("soldiers")
    this.from(raw)
  }

  sortField(n: string) {
    return this[n] || this.statCaps[n];
  }
}

export class EventEntry extends Entry {

  constructor(raw: any) {
    super("events")
    this.from(raw)
  }

  relatedScripts: string[] = [];
}

export class EventScript extends Entry {
  _relatedEvents: string[];
  _relatedResearch: string[];
  eventWeights;
  oneTimeRandomEvents;
  researchTriggers;
  xcomBaseInCountryTriggers;
  _xcomBaseInCountryTrue = [];
  _xcomBaseInCountryFalse = [];

  constructor(raw: any) {
    super("eventScripts")
    this.from(raw)
    let relatedEvents = new Set<string>([
      ...Object.values(this.eventWeights || []).map(w => Object.keys(w)).flat(),
      ...Object.keys(this.oneTimeRandomEvents || {})
    ]);
    this._relatedEvents = [...relatedEvents];
    this._relatedResearch = [...new Set<string>(Object.keys(this.researchTriggers || {}))];
    if (this.xcomBaseInCountryTriggers) {
      this._xcomBaseInCountryTrue = Object.keys(this.xcomBaseInCountryTriggers).filter(k => this.xcomBaseInCountryTriggers[k] == true)
      this._xcomBaseInCountryFalse = Object.keys(this.xcomBaseInCountryTriggers).filter(k => this.xcomBaseInCountryTriggers[k] == false)
    }
  }
}

function totalSellCost(items: { [key: string]: number } = {}) {
  let c = 0;
  for (let k in items) {
    c += items[k] * (rul.items[k] || rul.crafts[k])?.costSell || 0;
  }
  return c || 0;
}

function totalSize(items: { [key: string]: number } = {}) {
  let c = 0;
  for (let k in items) {
    c += items[k] * (rul.items[k] || rul.crafts[k])?.size || 0;
  }
  return c;
}


export class Manufacture extends Entry {
  requires: string;
  producedItems: { [key: string]: number };
  requiredItems: { [key: string]: number };
  totalProducedItems: { [key: string]: number };
  requiresBaseFunc: string[];
  randomProducedItems: [number, { [key: string]: number }][];
  chanceSum: number;
  cost: number;

  constructor(raw: any) {
    super("manufacture")
    this.from(raw)

    this.cost = this.cost || 0;

    if (this.category) {
      rul.addCategory(this.category, this.id, rul.manufactureCategories);
    }

    if (this.requires) {
      for (let resName of this.requires) {
        let res = rul.research[resName];
        if (!res) continue;
        if (!res.manufacture) res.manufacture = [];
        res.manufacture.push(this.name);
      }
    }

    if (!this.producedItems) {
      this.producedItems = { [this.id]: 1 };
    }

    if (this.requiredItems) {
      for (let itemName of Object.keys(this.requiredItems)) {
        let item = rul.items[itemName];
        if (!item) continue;
        if (!item.componentOf) item.componentOf = {};
        item.componentOf[this.name] = this.requiredItems[itemName];
      }
    }

    if (this.randomProducedItems) {
      this.chanceSum = 0;
      for (let chance of this.randomProducedItems) this.chanceSum += chance[0];

      this.totalProducedItems = { ...this.producedItems };
      for (let chance of this.randomProducedItems) {
        for (let k in chance[1]) {
          this.totalProducedItems[k] = (this.totalProducedItems[k] || 0) + chance[1][k] * chance[0] / this.chanceSum;
        }
      }
    } else {
      this.totalProducedItems = this.producedItems;
    }

    this.profit = totalSellCost(this.producedItems) - totalSellCost(this.requiredItems) - this.cost;
    if (isNaN(this.profit)) {
      console.log(this.id, totalSellCost(this.producedItems), totalSellCost(this.requiredItems), this.cost);
    }
    this.profitPerHour = this.profit / this.time;
    this.sizeChange = totalSize(this.producedItems) - totalSize(this.requiredItems);

    backLink(this.id, Object.keys(this.totalProducedItems), rul.items, "manufacture")

    Service.add("allowsManufacture", this.name, this.requiresBaseFunc);
  }
}

export class SoldierTransformation extends Entry {
  forbiddenPreviousTransformations: string[];
  blocksTransformations: string[];

  constructor(raw: any) {
    super("soldierTransformation")
    this.from(raw)
  }
}

export class DamageType extends Entry {
  items: string[];
  commendations: string[];

  constructor(raw: any) {
    super("damageTypes")
    this.from(raw)
  }

}

/** A value that differs between stages, shown in a table as `first..last` */
export class ValueRange {
  constructor(public first: any, public last: any) { }
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
  if (n.substring(0, 9) == "recovery.")
    return bonus.recovery?.[n.substring(9)]?.flatOne;
  if (stageInternals.includes(n))
    return undefined;
  // A stat the stage omits is not the same as a stat it sets to zero
  if (bonus.stats && n in bonus.stats)
    return bonus.stats[n];
  return bonus[n];
}

export class Commendation extends Entry {
  soldierBonusTypes?: any[];
  criteria?:any;
  killCriteria?:any[];
  finalBonus: Entry;
  damageTypes: string[] = [];
  battleTypes: string[] = [];
  items: string[] = [];
  kcd: any[] = [];
  killCriteria2 = []

  constructor(raw: any) {
    super("commendations")
    this.from(raw)
    this.finalBonus = this.soldierBonusTypes && rul.soldierBonuses[this.soldierBonusTypes[this.soldierBonusTypes.length - 1]];
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
    let stages = (this.soldierBonusTypes || []).map(id => rul.soldierBonuses[id]).filter(b => b != null);
    if (stages.length == 0)
      return this.finalBonus;
    let meaningful = (b: Entry) =>
      Object.keys(b.stats ?? {}).length > 0 || Object.keys(b.recovery ?? {}).length > 0;
    return [...stages].reverse().find(meaningful) ?? stages[stages.length - 1];
  }

  /** The stage bonuses of this commendation, in the order they are earned */
  get stages(): Entry[] {
    return (this.soldierBonusTypes || []).map(id => rul.soldierBonuses[id]).filter(b => b != null);
  }

  /** Every value the stages grant for column `n`, in stage order */
  private granted(n: string) {
    if (n == "id")
      return [];
    return this.stages.map(s => stageValue(s, n)).filter(v => v != null);
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
    let values = this.granted(n);
    if (values.length < 2)
      return null;
    let first = values[0], last = values[values.length - 1];
    if (first === last || typeof first != "number" || typeof last != "number")
      return null;
    return new ValueRange(first, last);
  }

  /** What a section table cell shows for column `n`, see `range` */
  cellValue(n: string) {
    return this.range(n) ?? this.sortField(n);
  }

  parseKillCriteria() {
    //if(this.id == "STR_MEDAL_SLASHER_NAME") debugger;

    if (this.killCriteria) {
      for (let deeds of this.killCriteria) {
        let group = [];
        for (let deedList of deeds) {
          let deed = { times: deedList[0] } as any;

          for (let [i, k] of Object.entries(deedList[1]) as [string, string][]) {

            let idt = internalDamageTypes.indexOf(k);
            if (idt != -1) {
              deed.element = damageTypes[idt];
              deedList[1][i] = damageTypes[idt];
              this.damageTypes.push(damageTypes[idt]);
              backLink(this.id, [deed.element], rul.damageTypes, "commendations");
              continue;
            }

            let ibt = internalBattleTypes.indexOf(k);
            if (ibt != -1) {
              deed.type = k;
              this.battleTypes.push(k);
              backLink(this.id, [k], rul.battleTypes, "commendations");
            }

            else if (killStatuses.includes(k)) {
              deed.status = k;
            } else if (killFactions.includes(k)) {
              deed.faction = k;
            } else if (rul.alienRaces[k]) {
              deed.race = k
              backLink(this.id, [k], rul.alienRaces, "commendations");
            } else if (rul.units[k]) {
              deed.unit = k
              backLink(this.id, [k], rul.units, "commendations");
            } else if (rul.items[k]) {
              deed.item = k
              backLink(this.id, [k], rul.items, "commendations");
            } else {
              deed[k] = true;
            }
          }

          if (deed.type || deed.element) {
            if (!deed.type) {
              backLink2(this, rul.damageTypes[deed.element].items, rul.items, "commendations", "items");
            } else if (!deed.element) {
              backLink2(this, rul.battleTypes[deed.type]["items"], rul.items, "commendations", "items");
            } else {
              let items = rul.damageTypes[deed.element].items.filter(id => rul.items[id]?.internalBattleType == deed.type)
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

  matchesItem(item: Item) {
    let id = item.id;
    for (let deed of this.kcd) {
      if (deed.item == id)
        return true;
      if (deed.element == null && deed.type == null)
        continue;
      if (deed.element != null && !item.damageTypes?.includes(deed.element))
        continue;
      if (deed.type != null && item.battleType != deed.type)
        continue;
      return true;
    }
    return false;
  }

  sortField(n: string) {
    if (n == null)
      return;
    // A cell can span every stage, but it still sorts by the value a soldier
    // ends up with: the column's value at the last stage that grants it. The
    // last stage *listed* is often an empty placeholder, and reading that would
    // rank a phantom 0 above a real bonus granted earlier.
    let granted = this.granted(n);
    if (granted.length > 0)
      return granted[granted.length - 1];

    // No stage grants the column at all. Stats still read as 0 rather than
    // empty, as they did before ranges existed.
    let fb = this.lastMeaningfulBonus;
    if (fb && n != "id" && !stageInternals.includes(n)) {
      if (statsList.includes(n) || n == "mana")
        return fb["stats"] ? fb["stats"][n] || 0 : 0;
      if (fb.recovery && n.substring(0, 9) == "recovery.") {
        return fb.recovery[n.substring(9)]?.flatOne;
      }
      if (fb[n] != null)
        return fb[n];
    }

    return this[n];
  }
}

export class Research extends Entry {

  getOneFree?: string[];
  unlocks?: string[];
  dependencies?: string[];
  leadsTo?: string[];
  freeFrom?: string[];
  manufacture?: string[];
  requiresBaseFunc?: string[];
  lookup?: string;
  seeAlso?: string[];
  allowsBuying?: string[];
  spawnedItem?: string;

  constructor(raw: any) {
    //if (raw.getOneFree) debugger
    super("research");
    this.from(raw)
    Service.add("allowsResearching", this.name, this.requiresBaseFunc);
  }
}


export class AlienDeployment extends Entry {
  startingCondition?: string;
  data?: any[];
  loot: string[];

  constructor(raw: any) {
    super("alienDeployments");
    this.from(raw)
    let allItems = new Set<string>();
    for (let d of this.data || []) {
      if (Array.isArray(d.itemSets)) {
        let items = d.itemSets.flat() as string[];
        for (let item of items)
          allItems.add(item)
      }
    }
    this.loot = [...allItems];
  }
}

export class CraftWeapon extends Entry {
  weaponType: string;
  requiresBuyBaseFunc?: string[];

  constructor(raw: any) {
    super("craftWeapons");
    this.from(raw)
    Service.add("canBuy", this.type, this.requiresBuyBaseFunc);
    //if(Number.isInteger(this.weaponType))
    this.weaponType = "weaponType" + (this.weaponType || 0)
    Entry.reserve({ id: this.weaponType }, "weaponTypes");
  }

}

export class Craft extends Entry {
  startingConditions: string[];
  weaponTypes: string[][];
  allWeaponTypes: string[];
  sprite: number;

  constructor(raw: any) {
    super("crafts");
    this.from(raw)
    this.allWeaponTypes = this.allWeaponTypes || [];
    if (this.weaponTypes) {
      for (let slot in this.weaponTypes) {
        if (!Array.isArray(this.weaponTypes[slot]))
          this.weaponTypes[slot] = [this.weaponTypes[slot]] as any;
        this.weaponTypes[slot] = this.weaponTypes[slot].map(n => {
          let id = "weaponType" + n;
          Entry.reserve({ id }, "weaponTypes");
          this.allWeaponTypes.push(id);
          return id;
        })
      }
      this.allWeaponTypes = [...new Set(this.allWeaponTypes)];
    }
    //this.sprite = rul.obsSprite("baseSprite", +this.sprite + 33);
  }
}

export class Facility extends Entry {
  aliens?: number;
  prisonType?: number;
  provideBaseFunc?: string[];
  requiresBaseFunc?: string[];
  forbiddenBaseFunc?: string[];
  buildCostItems?: { [key: string]: { [key: string]: number } };

  constructor(raw: any) {
    super("facilities")
    this.from(raw)

    Service.add("providedBy", this.type, this.provideBaseFunc);
    Service.add("allowsBuilding", this.type, this.requiresBaseFunc);
    Service.add("forbidsBuilding", this.type, this.forbiddenBaseFunc);
    if (this.aliens) {
      Service.add("providedBy", this.type, [`prisonType${this.prisonType || 1}`]);
    }
    if (!this.prisonType && this.aliens)
      this.prisonType = 1;
  }

  get kennel() {
    return this.prisonType == 2 ? this.aliens : null;
  }

  get prison() {
    return this.prisonType == 2 ? null : this.aliens;
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

  constructor(raw: any) {
    super("startingConditions")
    this.from(raw)
  }
}

export type Stats = {
  tu: number;
  stamina: number;
  health: number;
  bravery: number;
  reactions: number;
  firing: number;
  throwing: number;
  strength: number;
  psiStrength: number;
  psiSkill: number;
  melee: number;
}

export class Unit extends Entry {
  stats: Stats;
  armor: string;
  race: string;
  builtInWeaponSets: string[][];

  constructor(raw: any) {
    super("units")
    this.from(raw)
    for (let k in { ...raw }) {
      if (typeof raw[k] == "string" || typeof raw[k] == "number") {
        rul.unitFields.add(k);
      }
    }

    let armor = rul.armors[raw.armor];
    if (armor) {
      armor.users = armor.users || [];
      armor.users.push(this.type);
    }
    if (this.builtInWeaponSets) {
      let weapons = new Set(this.builtInWeaponSets.flat());
      for (let w of weapons) {
        let item = rul.items[w];
        if (item) {
          item.heldBy = item.heldBy || new Set<string>();
          item.heldBy.add(this.type)
        }
      }
    }
  }

  sortField(n: string) {
    if (statsList.includes(n))
      return this.stats ? this.stats[n] || 0 : 0;
    return this[n]
  }

}

let defaultRange = { snap: 15, auto: 7, aimed: 200 };

export class Attack {
  possible = false;
  cost?: { time: number; energy: number };
  flatTime = false;
  damage?: number;
  damageBonus?: { [key: string]: number };
  damageType?: number;
  accuracy?: number;
  accuracyMultiplier?: { [key: string]: number };
  alter?: { [key: string]: string };
  shots: number = 1;
  range?: number;
  pellets: number = 1;
  name?: string;
  tuPercent?: number;

  constructor(public item: Item, public mode: string) {
    let capMode = mode.charAt(0).toUpperCase() + mode.substr(1);

    let isDefaultAttack =
      (mode == "ammo" && item.battleType == 2) ||
      (mode == "melee" && item.battleType == 3) ||
      (mode == "psi" && item.battleType == 9) ||
      (mode == "throw" && [4, 5].includes(item.battleType));

    if (mode == "throw" && !isDefaultAttack) 
      return;

    let exists =
      item["accuracy" + capMode] || item["cost" + capMode] || isDefaultAttack;

    if (!exists) 
      return;

    if (mode == "melee" && item.battleType != 3) {
      this.damage = item.meleePower;
      this.damageBonus = item.meleeBonus;
      this.damageType = item.meleeType;
    } else if (!item.compatibleAmmo) {
      this.damage = item.power;
      this.damageBonus = item.damageBonus;
      this.damageType = item.damageType;
    }

    this.pellets = item.shotgunPellets || 1;

    this.shots = mode == "auto" ? item.autoShots || 3 : 1;
    this.name = mode.substr(0, 1).toUpperCase() + mode.substr(1);

    let confId = "conf" + this.name;
    if (confId in item) {
      let conf = item[confId];
      if (conf.name) this.name = rul.str(conf.name);
      if (conf.shots) this.shots = conf.shots;
      delete item[confId];
    }

    if (item[mode + "AttackName"])
      this.name = rul.str(item[mode + "AttackName"]);

    if (mode == "melee") this.alter = item.meleeAlter;

    if (item.battleType == 3 || mode != "melee") 
      this.alter = item.damageAlter;

    if (this.alter && this.alter.ResistType) {
      // `ResistType` may be given as an index or as `STR_DAMAGE_*`; resolve the
      // name first, otherwise `Number()` gives NaN and a bogus damage type
      // entry with an undefined id ends up in the ruleset
      let dType = damageTypeIndex(this.alter.ResistType);
      if (dType == null) {
        console.error(this.item.id + " attack has unknown damage type " + this.alter.ResistType)
      } else {
        this.damageType = dType;
        item.addDamageType(this.damageType);
      }
    }

    if (mode != "ammo") {
      if (
        ((mode == "melee" && item.battleType == 3) || mode != "melee") &&
        item.flatRate
      )
        this.flatTime = item.flatRate;

      if (item["flat" + capMode] && item["flat" + capMode].time)
        this.flatTime = true;

      if (capMode == "Psi") capMode = "Use";

      this.cost = this.cost = item["cost" + capMode] || {
        time: item["tu" + capMode],
        energy: 0,
      };

      this.accuracy = item["accuracy" + capMode] || 100;

      let accuracyMultiplier =
        mode == "throw"
          ? item.throwMultiplier
          : mode == "melee"
            ? item.meleeMultiplier
            : item.accuracyMultiplier;

      if (!accuracyMultiplier) {
        let defaultAccuracyStat =
          mode == "throw" ? "throwing" : mode == "melee" ? "melee" : "firing";
        accuracyMultiplier = {};
        accuracyMultiplier[defaultAccuracyStat] = 1;
      }

      this.accuracyMultiplier = accuracyMultiplier;

      if (this.damageType != null) {
        item.addDamageType(this.damageType);
      }

      for (let k in this.accuracyMultiplier || [])
        backLink(item.id, [k], "stats", "weaponDamage");

    }

    if (mode + "Range" in item) {
      this.alter = Object.assign({}, this.alter || {});
      this.alter.range = item[mode + "Range"];
    }

    for (let k in this.alter) {
      if (k == "damageType" || k == "ResistType")
        this.alter[k] = damageTypes[this.alter[k]];
    }

    this.range =
      item[mode + "Range"] ||
      item[mode.substr(0, 3) + "Range"] ||
      (this.alter && this.alter.range) ||
      defaultRange[mode];

    if (item.maxRange < this.range) {
      this.range = item.maxRange;
    }

    if (this.alter && item.maxRange < +this.alter.range)
      this.alter.range = `${item.maxRange}`;

    this.possible = true;

    if (!this.flatTime && this.cost?.time) {
      this.tuPercent = this.cost.time;
    }

    rul.attacks.push(this);
  }

  sortField(n: string) {

    switch (n) {
      case "internalBattleType":
        return this.item.internalBattleType;

      case "damageType":
        return damageTypes[this.damageType];

      case "item":
        return this.item.id;

      case "id":
        return this.item.id;
    }

    if (this.alter && this.alter[n]) {
      return this.alter[n];
    }

    if (this.damageBonus && this.damageBonus[n]) {
      return this.damageBonus[n];
    }

    if (n?.substring(0, 4) == "acc*" && this.accuracyMultiplier) {
      return this.accuracyMultiplier[n.substring(4)]
    }

    return this[n];
  }
}

export class Armor extends Entry {
  sprite?: string;
  damageModifier?: number[];
  armor: { [key: string]: number } = {};
  users?: string[];
  startingConditions: string[] = [];
  size: number;
  layersDefinition?: { [x: string]: any; };
  layersDefaultPrefix?: string;
  spriteInv?: string;
  storeItem?: string;
  frontArmor?: number;
  sideArmor?: number;
  rearArmor?: number;
  underArmor?: number;
  units?: string[];
  stats?: string[];
  tags?: string[];

  constructor(raw: any) {
    super("armors")
    this.from(raw)
    if (!this.size)
      this.size = 1;

    this.armor = {
      Front: this.frontArmor,
      Side: this.sideArmor,
      Rear: this.rearArmor,
      Under: this.underArmor,
    };

    if (this.storeItem && rul.items[this.storeItem]) {
      let item = rul.items[this.storeItem];
      if (!item.armors) item.armors = [];
      item.armors.push(this.type);
    }

    for (let unit of this.units || []) {
      let s = rul.soldiers[unit];
      if (s) {
        s.armors = s.armors || [];
        s.armors.push(this.type);
      }
    }
  }

  async dollSprites(): Promise<{ [key: string]: string[] }> {
    let ds = {};
    if (this.layersDefinition) {
      let prefix = this.layersDefaultPrefix;
      for (let body in this.layersDefinition) {
        let layersDef = this.layersDefinition[body];
        let layers = [];
        for (let layer in layersDef) {
          let name = layersDef[layer];
          if (name && name.length) {
            let id = prefix + "__" + layer + "__" + name;
            layers.push(await rul.sprite(id));
          }
        }
        ds[body] = layers;
      }
    } else if (this.spriteInv) {
      let name: string = this.spriteInv;
      let l = name?.length;

      if (this.spriteInv + ".SPK" in rul.sprites) {
        ds = {
          0: [await rul.sprites[this.spriteInv + ".SPK"].data()],
        };
      } else {
        for (let s in rul.sprites) {
          if (s.substr(0, l) == name) {
            ds[s.substr(l, s.length - l - 4)] = [await rul.sprite(s)];
          }
        }
      }
    }
    return ds;
  }

  sortField(n: string, v:any) {
    if (statsList.includes(n))
      return this.stats ? this.stats[n] || 0 : 0;
    if (damageTypes.includes(n) && this.damageModifier)
      return (this.damageModifier[damageTypes.indexOf(n)] || 0) * 100;
    if (this.tags && n in this.tags)
      return this.tags[n];

    if (n == "armorUsers") {
      if (v == "enemies")
        return Object.values(this.units || {}).length == 0
      if (v == "allies")
        return Object.values(this.units || {}).length > 0
      if (rul.soldiers[v]) {
        return this.units?.includes(v);
      }
    }

    if (n == "allowedIn") {
      return this.allowedIn?.includes(v);
    }

    return this[n];
  }

}

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
  meleeBonus: any;
  meleeType?: number;
  power?: number;
  damageBonus: any;
  damageType?: number;
  shotgunPellets?: number;
  meleeAlter: any;
  damageAlter: any;
  compatibleAmmo?: string[];
  ammo?: { compatibleAmmo: string[] }[];
  autoShots?: number;
  flatRate?: boolean;
  meleeMultiplier: any;
  throwMultiplier: any;
  accuracyMultiplier: any;
  compatibleWeapons: any;
  liveAlien?: boolean;
  recover?: boolean;
  prisonType?: number;
  maxRange?: number;
  categories?: string[];
  requiresBuy?: string[];
  commendations?: string[];
  heldBy?: Set<string>;
  dropoff = 2;
  damageTypes?: number[]
  psiVision?: number;
  invSize: string;

  get sprite() {
    if (this.bigSprite) {
      return rul.obsSprite("big", +this.bigSprite);
    }
  }

  get internalBattleType() {
    let t = internalBattleTypes[this.battleType || 0]
    return t;
  }

  addDamageType(type: number) {
    // Called from `Attack` with whatever the ruleset wrote as the damage type,
    // so resolve it and ignore unknown values instead of adding an `undefined`
    // id to the damage type section
    let idx = damageTypeIndex(type);
    if (idx == null)
      return;
    this.damageTypes = this.damageTypes || [];
    addIfNew(this.damageTypes, idx);
    backLink(this.id, [damageTypes[idx]], "damageTypes", "items");
  }

  constructor(raw: any) {
    super("items")
    this.from(raw)
    for (let k in { ...raw, ...(raw.damageAlter || {}) }) {
      if (typeof raw[k] == "string" || typeof raw[k] == "number" || raw.damageAlter && raw.damageAlter[k] != null) {
        rul.itemFields.add(k);
      }
    }

    //this.addToSection(this.internalBattleType);

    if (this.damageType)
      this.addDamageType(this.damageType)

    let t = this as any;

    if ("flatThrow" in t) {
      t.flatThrowTime = t.flatThrow.time;
      delete t.flatThrow;
    }

    Service.add("canBuyItem", this.type, this.requiresBuyBaseFunc);

    if (this.categories) {
      for (let cat of this.categories) rul.addCategory(cat, this.type);
    }

    if (this.liveAlien && this.recover && !this.prisonType)
      this.prisonType = 1

    if (this.ammo) {
      this.compatibleAmmo = [...(this.compatibleAmmo || []), ...Object.values(this.ammo).map(a => a.compatibleAmmo).flat()]
    }

    for (let k in this.damageBonus || []) {
      let b = this.damageBonus[k];
      if (b != 0)
        backLink(this.id, [k], "stats", "weaponDamage");
      if (Array.isArray(b)) {
        for (let p in b)
          if (b[p] > 0)
            backLink(this.id, [k], "stats", `weaponDamage${p != '0' ? `<sup>${+p + 1}</sup>` : ""}`);
      }
    }

    for (let k in this.meleeMultiplier || [])
      backLink(this.id, [k], "stats", "meleeAccuracy");

    if (this.damageType != null) {
      let idx = damageTypeIndex(this.damageType);
      if (idx != null)
        backLink(this.id, [damageTypes[idx]], "damageTypes", "items");
    }

    if (this.damageAlter?.ResistType != null) {
      let idx = damageTypeIndex(this.damageAlter.ResistType);
      if (idx != null)
        backLink(this.id, [damageTypes[idx]], "damageTypes", "items");
    }

    this.attacks();

    this.invSize = `${this.invWidth}×${this.invHeight}`;
  }

  attacks() {
    if (!this._attacks) {
      this._attacks = [];
      for (let mode of battleTypes) {
        let attack = new Attack(this, mode);
        if (attack.possible) {
          this._attacks.push(attack);
        }
      }
    }

    if (this.battleType == 2) {
      this._attacks[0].item = this;
      this._attacks[0].mode = "ammo";
    }

    return this._attacks;
  }


  sortField(n: string, v) {
    if (n === "category" && this.categories)
      return this.categories.includes(v) ? v : null;

    if (n === "damageTypes") {
      if (v !== true) {
        let i = damageTypes.indexOf(v)
        return this.damageTypes?.includes(i);
      } else {
        return this.damageTypes?.map(d => damageTypes[d])
      }
    }

    if (n === "damageType" && this.damageTypes) {
      return this.damageTypes.map(n => damageTypes[n])
    }

    if (this.damageAlter && this.damageAlter[n] != null)
      return this.damageAlter[n];

    return super.sortField(n, v);
  }


}