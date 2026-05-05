import React, { useState, useEffect, useMemo } from 'react';
import {
  rul,
  sortFirstLast,
  damageTypes,
  internalBattleTypes,
} from "../rul/Ruleset";
import { Val } from "./Val";
import SpecialBonus from "./SpecialBonus";
import CanvasImage from "./CanvasImage";
import AlterList from "./AlterList";
import UseCost from "./UseCost";
import SecondaryTable from "./SecondaryTable";
import { Attack, Entry } from '../rul/Entry';

const Damage = ({ attack }: { attack: Attack }) => {
  ("damage" in attack || "damageType" in attack) && (
    <>
      {attack.pellets > 1 && attack.damageBonus ? "(" : ""}
      <em>{attack.damage || 0}</em>
      <small>
        <SpecialBonus plus={true} bonus={attack.damageBonus} />
        {attack.pellets > 1 && attack.damageBonus ? ")" : ""}
      </small>
      {attack.pellets > 1 ? " ×" + attack.pellets : ""}
      <br />
      {attack.damageType != null && (
        <Val of={damageTypes[attack.damageType]} />
      )}
    </>
  )
}

const ItemComponent = ({ entry }: { entry: Entry }) => {
  const [anal, setAnal] = useState(false);
  const [attacks, setAttacks] = useState([]);
  const [sorted, setSorted] = useState({ first: [], misc: [] });
  const [hand1bonus, setHand1bonus] = useState("");

  const soundsFrom = (sounds: any) => {
    if (!sounds) return [];
    if (!sounds.length) sounds = [sounds];
    return sounds.map((s: number) => rul.sounds[s]).filter((s: any) => s);
  };

  useEffect(() => {
    console.log(entry); // clog equivalent
    const attacksList = entry.attacks().slice();
    const ohpen = entry.oneHandedPenalty || entry.battleType == 3 ? 67 : 50;

    setHand1bonus(entry.twoHanded
      ? entry.blockBothHands
        ? rul.tr("2handOnly")
        : `${rul.tr("1handPenalty")} ${ohpen}%`
      : "");

    if (entry.compatibleAmmo) {
      for (let ammoId of entry.compatibleAmmo) {
        let ammo = rul.items[ammoId];
        let ammoAttack = ammo.attacks()[0];
        attacksList.push(ammoAttack);
      }
    }

    setAttacks(attacksList);

    const sortedData = sortFirstLast(entry, {
      first: [
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
        "spawnUnit",
        "manufacture",
        "componentOf",
      ],
      exclude: [
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
      ],
    });
    setSorted(sortedData);
  }, [entry]);

  const renderTableRows = useMemo(() => {
    const items = anal ? [...sorted.first, ["anal"], ...sorted.misc] : [...sorted.first, ["anal"]];

    return items.map(([key, prop]) => {
      if (key == "anal") {
        if (sorted.misc.length > 0) {
          return (
            <tr key="anal-button">
              <td colSpan="2">
                <button
                  className="btn-hover-effect btn-hover-effect--effect-1"
                  onClick={() => setAnal(!anal)}
                >
                  {anal ? "Hide" : "See"} details
                </button>
              </td>
            </tr>
          );
        }
        return null;
      }

      if (key == "manufacture") {
        return (
          <SecondaryTable key={key} text={key}>
            <table className="item-manufacture">
              {prop.map((man, i) => {
                const m = rul.manufacture[man];
                return (
                  <React.Fragment key={i}>
                    <tr>
                      <td colSpan="3" style={{ textAlign: "left" }}>
                        <Val of={man} />
                        {m?.requiresBaseFunc && (
                          <>
                            / <Val of={m?.requiresBaseFunc} />
                          </>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: "right" }}>
                        <Val of={m?.requiredItems || ""} />
                        {m?.cost && <>$<Val of={m?.cost} /></>}
                        ⌛<em><Val of={m?.time} /></em>
                      </td>
                      <td>➔</td>
                      <td style={{ textAlign: "left" }}>
                        <Val of={m?.totalProducedItems[entry.id]} />&nbsp;
                        <Val of={entry.id} />
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </table>
          </SecondaryTable>
        );
      }

      if (key == "componentOf") {
        return (
          <SecondaryTable key={key} text={key}>
            <Val of={prop} />
          </SecondaryTable>
        );
      }

      return (
        <tr key={key}>
          <td><Val of={key} capital={true} /></td>
          <td className="item-right-column">
            {["damageBonus", "meleeBonus", "accuracyMultiplier", "meleeMultiplier", "closeQuartersMultiplier"].includes(key) && (
              <SpecialBonus bonus={prop} />
            )}
            {["damageType", "meleeType"].includes(key) && (
              rul.damageTypeName(prop)
            )}
            {key == "battleType" && (
              `${prop}: ${rul.tr(internalBattleTypes[prop])}`
            )}
            {key.includes("Sound") && (
              soundsFrom(prop).map((sound, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <br />}
                  <audio controls src={sound}>Audio tag not working</audio>
                </React.Fragment>
              ))
            )}
            {["floorSprite", "handSprite"].includes(key) && (
              <>
                <a style={{ verticalAlign: "top" }} href={rul.obsSprite(key, prop)}>
                  {prop}
                </a>
                <img
                  className="item-img sprite"
                  alt={prop}
                  src={rul.obsSprite(key, prop)}
                />
              </>
            )}
            {key == "prisonType" && (
              <Val of={"prisonType" + prop} />
            )}
            {key == "experienceTrainingMode" && (
              <>
                <Val of={prop} />: <Val of={"experienceTrainingMode" + prop} />
              </>
            )}
            {key == "costBuy" && (
              <>
                <Val of={prop} /> <Val of={entry.requiresBuy || ""} />
              </>
            )}
            {!["damageBonus", "meleeBonus", "accuracyMultiplier", "meleeMultiplier", "closeQuartersMultiplier", "damageType", "meleeType", "battleType", "floorSprite", "handSprite", "prisonType", "experienceTrainingMode", "costBuy"].some(k =>
              key === k || (key.includes("Sound") && k.includes("Sound"))
            ) && (
                <Val of={prop} />
              )}
          </td>
        </tr>
      );
    });
  }, [anal, sorted, entry]);

  return (
    <table className="main-table">
      <thead>
        <tr>
          <td colSpan="2">
            {entry.weight ? entry.weight + rul.tr("kg") : ""}
            {entry.invSize}
            {entry.clipSize > 0 ? entry.clipSize + rul.tr("-shot") : ""}
            <Val of={entry.internalBattleType} />
            <Val of="Item" />
          </td>
        </tr>
      </thead>

      {(entry.sprite && entry.sprite != "Resources/Blanks/Blank.png") || attacks.length > 0 && (
        <tr>
          <td colSpan="2" className="td-attacks-table">
            <div>
              {attacks.length > 0 && (
                <table className="attacks-table">
                  <thead>
                    <tr>
                      {entry.battleType == 2 ? (
                        <td colSpan="3" />
                      ) : (
                        <>
                          <td><Val of="mode" /></td>
                          <td>
                            <Val of="accuracy" />
                            <Val of="kneeling" />
                            {entry.kneelBonus || 120}% -{entry.dropoff}/<Val of="accPerTile" />
                            <span dangerouslySetInnerHTML={{ __html: hand1bonus }} />
                          </td>
                          <td><Val of="cost" /></td>
                        </>
                      )}
                      <td><Val of="damage" /></td>
                    </tr>
                  </thead>
                  <tbody>
                    {attacks.map((attack, idx) => (
                      <React.Fragment key={idx}>
                        <tr>
                          {attack.mode == "ammo" ? (
                            <>
                              <td className="item-ammo-img">
                                <CanvasImage
                                  src={attack.item.sprite}
                                  maxWidth={32 * attack.item.invWidth}
                                  maxHeight={32 * attack.item.invHeight}
                                  zoom="2"
                                />
                              </td>
                              <td colSpan="2">
                                <Val of={attack.item.type} />
                                <br />
                                <small>
                                  {rul.tr("Shots")}: {attack.item.clipSize}
                                  {rul.tr("Wgt")}: {attack.item.weight}
                                </small>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>
                                {rul.str(attack.name)}{attack.shots == 1 ? "" : "×" + attack.shots}
                              </td>
                              <td>
                                <em className="big-number">{attack.accuracy}</em>{"%"}
                                {attack.range && (
                                  <span dangerouslySetInnerHTML={{
                                    __html: rul
                                      .str("up to !N! m")
                                      .replace(
                                        "!N!",
                                        `<em class="${attack.range == entry.maxRange ? "bad" : ""
                                        }">${entry.minRange ? entry.minRange + "-" : ""}${attack.range
                                        }</em>`
                                      )
                                  }} />
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

                        {attack.mode == "melee" && entry.meleeAlter && (
                          <AlterList items={entry.meleeAlter} />
                        )}

                        {attack.mode == "ammo" && attack.alter && (
                          <AlterList items={attack.alter} />
                        )}
                      </React.Fragment>
                    ))}
                    {entry.damageAlter && entry.battleType != 2 && (
                      <AlterList items={entry.damageAlter} />
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}

      {renderTableRows}
    </table>
  );
};

export default ItemComponent;