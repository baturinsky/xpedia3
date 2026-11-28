import React, { Fragment } from "react";
import type { Attack, BonusMap, Item } from "../rul/Entry";
import { damageTypes, internalBattleTypes, rul, sortFirstLast } from "../rul/Ruleset";
import { state, update } from "../state";
import { SoundRef } from "./Audio";
import { AlterList, Img, Nobr, SecondaryTable, SpecialBonus } from "./components";
import MainTable, { type MainTableRenderer } from "./MainTable";
import { Val } from "./Val";

/** Battle type indices (`internalBattleTypes`): the ammo table is drawn
 *  differently, and the one-handed penalty defaults by type. */
const ammoBattleType = internalBattleTypes.indexOf("BT_AMMO");
const meleeBattleType = internalBattleTypes.indexOf("BT_MELEE");
/** One inventory slot is one 32×32 tile, as for the facility grid. */
const inventoryCellSize = 32;

const Damage = ({ attack }: { attack: Attack }) =>
  ("damage" in attack || "damageType" in attack) && (
    <>
      {attack.pellets > 1 && attack.damageBonus ? "(" : ""}
      <em>{attack.damage || 0}</em>
      <small>
        <SpecialBonus plus={true} bonus={attack.damageBonus} />
        {attack.pellets > 1 && attack.damageBonus ? ")" : ""}
      </small>
      {attack.pellets > 1 ? ` ×${attack.pellets}` : ""}
      <br />
      {attack.damageType != null && <Val of={damageTypes[attack.damageType]} />}
    </>
  );

/** Fields shown before the "See details" button, in the order old `Item.svelte`
 *  listed them. Acquisition fields (buy cost, manufacture, event/mission/UFO/
 *  terrain/corpse/salvage backlinks and research-spawned) are not here: they
 *  are consumed by the "Procuring methods" subtable (`_procure`), which is
 *  inserted before the first remaining subtable so it is the first of them. */
const firstFields = [
  "fixedWeapon",
  "builtIn",
  "costSell",
  "tuUse",
  "monthlySalary",
  "monthlyMaintenance",
  "size",
  "isConsumable",
  "medikitTargetSelf",
  "medikitType",
  "stimulant",
  "stunRecovery",
  "costUnprime",
  "blastRadius",
  "requires",
  "categories",
  "armors",
  "compatibleWeapons",
  "liveAlien",
  "recover",
  "energyRecovery",
  "healthRecovery",
  "experienceTrainingMode",
  "prisonType",
  "powerRangeReduction",
  "powerRangeThreshold",
  "commendations",
  "craftWeapons",
  "spawnUnit",
  "componentOf",
];

/** Fields the header or the attacks table already show, or that describe the
 *  ruleset rather than the item. The acquisition backlinks are excluded too:
 *  they exist on the entry for the "Procuring methods" subtable (and for
 *  crosslink consumers in `Ruleset`), but they must not fall through to the
 *  alphabetical "misc" rows under "See details" once they leave
 *  `firstFields`. */
const hiddenFields = [
  "requiresBuy",
  "costBuy",
  "manufacture",
  "spawnedBy",
  "events",
  "loot",
  "ufos",
  "terrains",
  "corpseOf",
  "salvagedFrom",
  "capturedFrom",
  "savedFrom",
  "transformedFrom",
  "sprite",
  "type",
  "compatibleAmmo",
  "_attacks",
  "damageAlter",
  "accuracyMelee",
  "accuracyMultiplier",
  "accuracySnap",
  "costAuto",
  "costMelee",
  "costSnap",
  "damageBonus",
  "damageType",
];

/** Bonuses that replace the plain value rather than adding to it */
const bonusFields = [
  "damageBonus",
  "meleeBonus",
  "accuracyMultiplier",
  "meleeMultiplier",
  "closeQuartersMultiplier",
];

/** Header of the item table: weight, size, shots and battle type */
const ItemHeader = ({ entry }: { entry: Item }) => (
  <>
    {entry.weight ? entry.weight + (rul.tr("kg") ?? "") : ""}&nbsp;
    {entry.invSize}&nbsp;
    {(entry.clipSize ?? 0) > 0 ? (entry.clipSize ?? 0) + (rul.tr("-shot") ?? "") : ""}&nbsp;
    <Val of={entry.internalBattleType} />
    &nbsp;
    <Val of="Item" />
  </>
);

/** One process that uses the item as a component, as two rows plus a divider */
const ManufactureRows = ({ entry, man }: { entry: Item; man: string }) => {
  const m = rul.manufacture[man];
  return (
    <>
      <tr>
        <td colSpan={3} style={{ textAlign: "left" }}>
          <Val of={man} />
          {m?.requiresBaseFunc && (
            <>
              {" "}
              / <Val of={m?.requiresBaseFunc} />
            </>
          )}
        </td>
      </tr>
      <tr>
        <td style={{ textAlign: "right" }}>
          <Val of={m?.requiredItems || ""} />{" "}
          {m?.cost ? (
            <>
              {" "}
              $<Val of={m?.cost} />
            </>
          ) : (
            ""
          )}
          ⌛
          <em>
            <Val of={m?.time} />
          </em>
        </td>
        <td>➔</td>
        <td style={{ textAlign: "left" }}>
          <Val of={m?.totalProducedItems[entry.uid]} />
          &nbsp;
          <Val of={entry.uid} />
        </td>
      </tr>
      <tr>
        <td colSpan={3}>
          <hr />
        </td>
      </tr>
    </>
  );
};

/** The item's attack modes, with accuracy, cost and damage per mode */
const AttacksTable = ({
  entry,
  attacks,
  hand1bonus,
}: {
  entry: Item;
  attacks: Attack[];
  hand1bonus: React.ReactNode;
}) => (
  <table className="attacks-table">
    <thead>
      <tr>
        {entry.battleType === ammoBattleType ? (
          <td colSpan={3} />
        ) : (
          <>
            <td>
              <Val of="mode" />
            </td>
            <td>
              <Val of="kneelBonus" />: {entry.kneelBonus || 120}%
              <br />
              <Val of="dropoff" />: {entry.dropoff}
              <br />
              {hand1bonus}
            </td>
            <td>
              <Val of="cost" />
            </td>
          </>
        )}
        <td>
          <Val of="damage" />
        </td>
      </tr>
    </thead>
    <tbody>
      {attacks.map((attack) => {
        if (!attack) return "";
        return (
          <React.Fragment key={`${attack.mode}-${attack.item.type}`}>
            <tr>
              {attack?.mode === "ammo" ? (
                <>
                  <td className="item-ammo-img">
                    <Img
                      src={attack.item.sprite}
                      maxWidth={inventoryCellSize * attack.item.invWidth}
                      maxHeight={inventoryCellSize * attack.item.invHeight}
                      zoom={2}
                    />
                  </td>
                  <td colSpan={2}>
                    <Val of={attack.item.type} />
                    <br />
                    <small>
                      {rul.tr("Shots")}: {attack.item.clipSize} {rul.tr("Wgt")}:{" "}
                      {attack.item.weight}
                    </small>
                  </td>
                </>
              ) : (
                <>
                  <td>
                    {rul.str(attack.name ?? "")}
                    {attack.shots === 1 ? "" : `×${attack.shots}`}
                  </td>
                  <td>
                    <em className="big-number">{attack.accuracy}</em>
                    {"%"}
                    {attack.range && (
                      // The range used to be a string assembled for
                      // `dangerouslySetInnerHTML`; as markup it is just an element
                      <span>
                        {" "}
                        up to{" "}
                        <em className={attack.range === entry.maxRange ? "bad" : ""}>
                          {entry.minRange ? `${entry.minRange}-` : ""}
                          {attack.range}
                        </em>{" "}
                        m
                      </span>
                    )}
                    <br />
                    <SpecialBonus bonus={attack.accuracyMultiplier} />
                  </td>
                  <td>
                    <UseCost cost={attack.cost} flatTime={attack.flatTime} />
                    {entry.costPrime && (
                      <div>
                        <Val of="Prime:" />
                        <UseCost cost={entry.costPrime} />
                      </div>
                    )}
                  </td>
                </>
              )}
              <td>
                <Damage attack={attack} />
              </td>
            </tr>

            {attack?.mode === "melee" && entry.meleeAlter && <AlterList items={entry.meleeAlter} />}

            {attack?.mode === "ammo" && attack.alter && <AlterList items={attack.alter} />}
          </React.Fragment>
        );
      })}
      {entry.damageAlter && entry.battleType !== ammoBattleType && (
        <AlterList items={entry.damageAlter} />
      )}
    </tbody>
  </table>
);

const ItemComponent = ({ entry }: { entry: Item }) => {
  const attacks = entry.attacks().slice();
  const ohpen = entry.oneHandedPenalty || entry.battleType === meleeBattleType ? 67 : 50;

  const hand1bonus = entry.twoHanded
    ? entry.blockBothHands
      ? rul.tr("2handOnly")
      : `${rul.tr("1handPenalty")}: ${ohpen}%`
    : "";

  if (entry.compatibleAmmo) {
    for (const ammoId of entry.compatibleAmmo) {
      const ammo = rul.items[ammoId];
      attacks.push(ammo.attacks()[0]);
    }
  }

  // The reader sees the first block of fields, and the rest of the ruleset's
  // properties only after asking for them
  const sorted = sortFirstLast(entry, { first: firstFields, exclude: hiddenFields });
  const hidden = sorted.misc;

  const special: { [field: string]: MainTableRenderer } = {};

  for (const field of bonusFields)
    special[field] = ({ val }) => <SpecialBonus bonus={val as BonusMap} />;

  // Through `Val` so the icon map is applied, like every other damage type on
  // the page. `damageTypeName` returns bare text.
  for (const field of ["damageType", "meleeType"])
    special[field] = ({ val }) => (
      <Val of={damageTypes[Number(val)] ?? rul.damageTypeName(Number(val))} />
    );

  // The stored field is a list of numeric indices; show the types they name,
  // each with its icon, instead of the bare numbers
  special.damageTypes = ({ val }) => (
    <Val
      of={(Array.isArray(val) ? val : [val])
        .map((i: unknown) => damageTypes[Number(i)])
        .filter(Boolean)}
    />
  );

  special.battleType = ({ val }) => {
    const id = internalBattleTypes[val as number];
    return <Val of={id ?? val} />;
  };
  special.prisonType = ({ val }) => <Val of={`prisonType${val}`} />;
  special.experienceTrainingMode = ({ val }) => {
    const id = `experienceTrainingMode${val}`;
    // The name already says what the number means, so the number is kept only
    // for a mode the language has no name for
    return rul.lang[id] != null ? <Val of={id} /> : <Val of={val} />;
  };
  for (const field of ["floorSprite", "handSprite"])
    special[field] = ({ val }) => (
      <>
        <a style={{ verticalAlign: "top" }} href={rul.obsSprite(field, Number(val))}>
          {String(val)}
        </a>
        <Img
          className="item-img sprite"
          alt={String(val)}
          src={rul.obsSprite(field, Number(val))}
        />
      </>
    );

  // A component is used by a list of processes, each of which is a little
  // table of its own, so it needs more than one row
  const rows: { [field: string]: MainTableRenderer } = {};

  // How the item becomes available, in player terms: buying, crafting,
  // research grants, captures, rescues, recovery transforms and the finds. Each row pairs a method with its sources
  // (backlinks from `Ruleset`); usage backlinks (`craftWeapons`,
  // `componentOf`, `spawnUnit`, `builtIn`) describe what the item is used
  // for, not how to get it, so they stay as their own rows below. The
  // framed with the section's `table-subheader` title, then one body row
  // per method (method in the `row-name` column, sources beside it).
  const procurement: { method: string; source: React.ReactNode }[] = [];
  if (entry.costBuy) {
    procurement.push({
      method: "xpediaProcureBuy",
      source: (
        <>
          <Val of={entry.costBuy} />
          {entry.requiresBuy?.length ? (
            <>
              {" "}
              <Val of={entry.requiresBuy} />
            </>
          ) : null}
        </>
      ),
    });
  }
  if (entry.manufacture != null && Object.keys(entry.manufacture).length > 0) {
    const val = entry.manufacture;
    procurement.push({
      method: "xpediaProcureManufacture",
      source: !Array.isArray(val) ? (
        <Val of={val} />
      ) : (
        <table className="item-manufacture">
          <tbody>
            {val.map((man: string) => (
              <ManufactureRows key={man} entry={entry} man={man} />
            ))}
          </tbody>
        </table>
      ),
    });
  }
  const linked = (
    method: string,
    val: unknown,
  ): { method: string; source: React.ReactNode } | null =>
    val != null && Array.isArray(val) && val.length > 0
      ? { method, source: <Val of={val} /> }
      : null;
  for (const row of [
    linked("xpediaProcureResearch", entry.spawnedBy),
    linked("xpediaProcureEvent", entry.events),
    linked("xpediaProcureCapture", entry.capturedFrom),
    linked("xpediaProcureRescue", entry.savedFrom),
    linked("xpediaProcureMission", entry.loot),
    linked("xpediaProcureUfo", entry.ufos),
    linked("xpediaProcureTerrain", entry.terrains),
    linked("xpediaProcureCorpse", entry.corpseOf),
    linked("xpediaProcureSalvage", entry.salvagedFrom),
    linked("xpediaProcureTransform", entry.transformedFrom),
  ])
    if (row) procurement.push(row);

  rows._procure = () =>
    procurement.length === 0 ? null : (
      <>
        <tr>
          <td colSpan={2} className="table-subheader">
            <Val of="xpediaProcureTitle" />
          </td>
        </tr>
        {procurement.map((row) => (
          <tr key={row.method}>
            <td className="row-name">
              <Val of={row.method} capital={true} />
            </td>
            <td>{row.source}</td>
          </tr>
        ))}
      </>
    );

  rows.componentOf = ({ key, val }) => (
    <SecondaryTable text={key}>
      <Val of={val} />
    </SecondaryTable>
  );

  // A sound field holds sound slots, whose file may be a mod resource
  for (const [field] of sorted.all)
    if (field.includes("Sound"))
      rows[field] = ({ val }) => (
        <>
          <SoundRef value={val} field={field} collection={entry.collection} />
        </>
      );

  // The "See details" button splits the fields in two, so the rows are built
  // here: the first block, the button, then the rest once it is expanded. The
  // procuring subtable is inserted before the first remaining subtable
  // (`craftWeapons`/`spawnUnit`/`componentOf`), so it is the first subtable.
  const firstPairs: [string, unknown][] = [...sorted.first];
  if (procurement.length > 0) {
    const subtableKeys = new Set(["craftWeapons", "spawnUnit", "componentOf"]);
    const at = firstPairs.findIndex(([k]) => subtableKeys.has(k));
    if (at === -1) firstPairs.push(["_procure", null]);
    else firstPairs.splice(at, 0, ["_procure", null]);
  }
  const pairs: [string, unknown][] =
    hidden.length === 0
      ? firstPairs
      : [...firstPairs, ["_details", null], ...(state.anal ? hidden : [])];

  const showAttacks =
    !!(entry.sprite && entry.sprite !== "Resources/Blanks/Blank.png") || attacks.length > 0;

  return (
    <MainTable
      key="item"
      of={entry}
      pairs={pairs}
      header={<ItemHeader entry={entry} />}
      special={special}
      // The long reference lists are subheader blocks rather than single
      // long rows: each is one fact with its own heading, as `Research`
      // already does with its lists. Acquisition lists are drawn by the
      // procuring subtable instead (see `_procure`).
      wide={["craftWeapons", "spawnUnit"]}
      rows={{
        ...rows,
        // The button row, which is why `pairs` carries a placeholder key
        _details: () => (
          <tr>
            <td colSpan={2}>
              <button
                type="button"
                className="btn-hover-effect btn-hover-effect--effect-1"
                onClick={() => update({ anal: !state.anal })}
              >
                {state.anal ? "Hide" : "See"} details
              </button>
            </td>
          </tr>
        ),
      }}
      before={
        showAttacks && (
          <tr>
            <td colSpan={2} className="td-attacks-table">
              <div>
                {attacks.length > 0 && (
                  <AttacksTable entry={entry} attacks={attacks} hand1bonus={hand1bonus} />
                )}
              </div>
            </td>
          </tr>
        )
      }
    />
  );
};

export default ItemComponent;

export const UseCost = ({
  cost,
  flatTime,
}: {
  cost?: { time: number; [resource: string]: number };
  flatTime?: boolean;
}) => {
  if (!cost) {
    return null;
  }

  return (
    <>
      <Nobr>
        <em>{cost.time}</em>
        {flatTime ? "" : "%"}
        <small>
          <Val of="TU" />
        </small>
      </Nobr>

      {Object.keys(cost).map((res) => {
        if (res !== "time" && cost[res] !== 0) {
          return (
            <Fragment key={res}>
              <br />
              <Nobr>
                <Val of={cost[res]} />
                <small>
                  <Val of={res} />
                </small>
              </Nobr>
            </Fragment>
          );
        }
        return null;
      })}
    </>
  );
};
