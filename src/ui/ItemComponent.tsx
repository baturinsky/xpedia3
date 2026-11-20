import React from "react";
import type { Attack, Item } from "../rul/Entry";
import { damageTypes, internalBattleTypes, rul, sortFirstLast } from "../rul/Ruleset";
import { state, update } from "../state";
import { SoundRef } from "./Audio";
import { AlterList, Img, Nobr, SecondaryTable, SpecialBonus } from "./components";
import MainTable, { type MainTableRenderer } from "./MainTable";
import { Val } from "./Val";

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
 *  listed them */
const firstFields = [
  "fixedWeapon",
  "builtIn",
  "costBuy",
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
  "loot",
  "ufos",
  "terrains",
  "corpseOf",
  "salvagedFrom",
  "craftWeapons",
  "events",
  "spawnUnit",
  "manufacture",
  "componentOf",
];

/** Fields the header or the attacks table already show, or that describe the
 *  ruleset rather than the item */
const hiddenFields = [
  "requiresBuy",
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
    {entry.weight ? entry.weight + rul.tr("kg") : ""}&nbsp;
    {entry.invSize}&nbsp;
    {entry.clipSize > 0 ? entry.clipSize + rul.tr("-shot") : ""}&nbsp;
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
        {entry.battleType === 2 ? (
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
      {attacks.map((attack, idx) => {
        if (!attack) return "";
        return (
          <React.Fragment key={idx}>
            <tr>
              {attack?.mode === "ammo" ? (
                <>
                  <td className="item-ammo-img">
                    <Img
                      src={attack.item.sprite}
                      maxWidth={32 * attack.item.invWidth}
                      maxHeight={32 * attack.item.invHeight}
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
      {entry.damageAlter && entry.battleType !== 2 && <AlterList items={entry.damageAlter} />}
    </tbody>
  </table>
);

const ItemComponent = ({ entry }: { entry: Item }) => {
  const attacks = entry.attacks().slice();
  const ohpen = entry.oneHandedPenalty || entry.battleType === 3 ? 67 : 50;

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

  for (const field of bonusFields) special[field] = ({ val }) => <SpecialBonus bonus={val} />;

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

  special.battleType = ({ val }) => `${val}: ${rul.tr(internalBattleTypes[val])}`;
  special.prisonType = ({ val }) => <Val of={`prisonType${val}`} />;
  special.experienceTrainingMode = ({ val }) => (
    <>
      <Val of={val} />: <Val of={`experienceTrainingMode${val}`} />
    </>
  );
  special.costBuy = ({ val }) => (
    <>
      <Val of={val} /> <Val of={entry.requiresBuy || ""} />
    </>
  );

  for (const field of ["floorSprite", "handSprite"])
    special[field] = ({ val }) => (
      <>
        <a style={{ verticalAlign: "top" }} href={rul.obsSprite(field, val)}>
          {val}
        </a>
        <Img className="item-img sprite" alt={String(val)} src={rul.obsSprite(field, val)} />
      </>
    );

  // A component is used by a list of processes, each of which is a little
  // table of its own, so it needs more than one row
  const rows: { [field: string]: MainTableRenderer } = {};

  // Old `Item.svelte` drew both of these under a subheader of their own
  rows.manufacture = ({ key, val }) => (
    <SecondaryTable text={key}>
      {!Array.isArray(val) ? (
        <Val of={val} />
      ) : (
        <table className="item-manufacture">
          <tbody>
            {val.map((man: string, i: number) => (
              <ManufactureRows key={i} entry={entry} man={man} />
            ))}
          </tbody>
        </table>
      )}
    </SecondaryTable>
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
  // here: the first block, the button, then the rest once it is expanded
  const pairs: [string, any][] =
    hidden.length === 0
      ? sorted.first
      : [...sorted.first, ["_details", null], ...(state.anal ? hidden : [])];

  const showAttacks =
    !!(entry.sprite && entry.sprite !== "Resources/Blanks/Blank.png") || attacks.length > 0;

  return (
    <MainTable
      key="item"
      of={entry}
      pairs={pairs}
      header={<ItemHeader entry={entry} />}
      special={special}
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
            <>
              <br key={res} />
              <Nobr key={`${res}-value`}>
                <Val of={cost[res]} />
                <small>
                  <Val of={res} />
                </small>
              </Nobr>
            </>
          );
        }
        return null;
      })}
    </>
  );
};
