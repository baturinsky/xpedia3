import React, { useState, useEffect, useMemo } from 'react';
import { rul, sortFirstLast, damageTypes } from "../rul/Ruleset";
import { SpecialBonus, RecoveryTable, Subheader } from "./components";
import { Val } from './Val';
import { emptyImg } from '../imgPlaceholders';
import { state, update } from '../state';

interface Entry {
  storeItem?: string;
  type?: string;
  users?: string[];
  stats?: any;
  armor?: any;
  damageModifier?: any;
  recovery?: any;
  dollSprites: () => Promise<Record<string, string[]>>;
  [key: string]: any;
}

interface ArmorEntryProps {
  entry: Entry;
}

const ArmorComponent: React.FC<ArmorEntryProps> = ({ entry }) => {
  const dollColumns = 6;

  const imageNotFound = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    img.onerror = null;
    console.warn(img.src + " not found");
    img.src = emptyImg;
  };

  const seeAlso: string[] = [];
  if (
    "storeItem" in entry &&
    entry.storeItem !== "STR_NONE" &&
    entry.storeItem !== entry.type &&
    entry.storeItem
  ) {
    seeAlso.push(entry.storeItem);
  }
  if ("users" in entry) {
    for (const item of entry.users?.filter(
      (s) =>
        s.substr(0, 8) !== "INV_NULL" &&
        s !== entry.type &&
        "##" + s !== window.location.hash &&
        s !== entry.type
    ) || []) {
      seeAlso.push(item);
    }
  }

  const renderArmorContent = async () => {
    try {
      const sprites = await entry.dollSprites();
      if (!sprites) return null;

      const bodies = Object.keys(sprites).sort((a, b) =>
        rul.bodiesCompare([a, b])
      );

      const shouldShowAll = state.seeAllArmorVariants;

      return (
        <>
          {Object.keys(sprites).length > 1 && (
            <p>
              <button
                className="btn-hover-effect btn-hover-effect--effect-1"
                onClick={() => update({ seeAllArmorVariants: !state.seeAllArmorVariants })}
              >
                {state.seeAllArmorVariants ? "Hide" : "See"} all variants
              </button>
            </p>
          )}

          {bodies.map((body, i) => {
            if (!shouldShowAll && i !== 0) return null;
            return (
              <div
                key={body}
                className="armor"
                style={{
                  left: `${(i % dollColumns) * 80}px`,
                  top: `${Math.floor(i / dollColumns) * 120}px`,
                }}
              >
                {shouldShowAll && (
                  <div className="armor-variant">{body}</div>
                )}
                {sprites[body].map((url, j) => (
                  <img
                    key={`${body}-${j}`}
                    src={url}
                    alt={body}
                    onError={imageNotFound}
                    className="armor-layer"
                  />
                ))}
              </div>
            );
          })}
          <div
            style={{
              minHeight: shouldShowAll
                ? `${(Math.floor(Object.keys(sprites).length / dollColumns) + 1) * 120}px`
                : "120px",
              marginLeft: "175px",
            }}
          >
            {!shouldShowAll && (
              <div className="flex-horisontal" style={{ maxWidth: "95vw" }}>
                {["stats", "armor"].map((prop) => {
                  if (!entry[prop]) return null;
                  return (
                    <div key={prop} className="armor-column">
                      <header>
                        <Val of={prop} />
                      </header>
                      {sortFirstLast(entry[prop]).all.map(([key, val]: [string, any], i) => (
                        <React.Fragment key={i}>
                          <div>
                            <Val of={key} icon="monospace" />
                          </div>
                          <div>
                            {prop === "recovery" ? (
                              Object.keys(val).map((subfield, j) => (
                                <React.Fragment key={j}>
                                  {j !== 0 && <br />}
                                  <Val of={subfield} />:
                                  <em>
                                    <Val of={val[subfield]} />
                                  </em>
                                </React.Fragment>
                              ))
                            ) : (
                              <em>
                                <Val of={val} />
                              </em>
                            )}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      );
    } catch (error) {
      console.error("Error loading sprites:", error);
      return null;
    }
  };

  const [spritesContent, setSpritesContent] = useState<React.ReactNode | null>(null);

  useEffect(() => {
    renderArmorContent().then(setSpritesContent);
  }, [entry, state.seeAllArmorVariants]);

  const sortedEntries = useMemo(() => {
    return sortFirstLast(entry, {
      exclude: [
        "recovery",
        "type",
        "layersDefinition",
        "spriteFaceColor",
        "spriteHairColor",
        "spriteUtileColor",
        "spriteFaceGroup",
        "spriteHairGroup",
        "spriteUtileGroup",
        "customArmorPreviewIndex",
        "dollSprites",
        "layersDefaultPrefix",
        "frontArmor",
        "sideArmor",
        "rearArmor",
        "underArmor",
        "spriteInv",
        "armor",
        "damageModifier",
        "stats",
      ],
      first: ["builtInWeapons", "size"],
    }).all;
  }, [entry]);

  return (
    <table className="main-table">
      <thead>
        <tr>
          <td colSpan={2}>
            <Val of="Armor" />
            {seeAlso.length > 0 && (
              <span style={{ color: "white" }}>- see also </span>
            )}
            <Val of={seeAlso} />
          </td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colSpan={2}>
            <div className="armors">
              {spritesContent}
            </div>
          </td>
        </tr>
        <tr>
          <td colSpan={2}>
            <div className="flex-horisontal" style={{ maxWidth: "95vw" }}>
              <div className="armor-column armor-column-resists">
                <header>
                  <Val of={"damageModifier"} />
                </header>
                {sortFirstLast(entry.damageModifier).all.map(([key, val]: [string, any], i) => {
                  return <React.Fragment key={i}>
                    <div>
                      <Val of={damageTypes[Number(key)]} icon="monospace" />
                    </div>
                    <div>
                      <em>
                        <span
                          style={{
                            fontWeight: "bold",
                            color: `hsl(${~~(val * 70)}, 100%, 50%)`,
                          }}
                        >
                          {~~(val * 100)}
                        </span>
                      </em>
                    </div>
                  </React.Fragment>
                })}
              </div>
            </div>
          </td>
        </tr>

        {sortedEntries.map(([key, prop]: [string, any], index) => {
          console.log(key,prop);
          return <tr key={index}>
            <td>
              <Val of={key} />
            </td>
            <td>
              {key === "damageModifier" ? (
                <table className="number-table">
                  <tbody>
                    {prop.map((res: number, i: number) => (
                      <tr key={i}>
                        <td width="50%" className="number-table1">
                          {rul.damageTypeName(i)}
                        </td>
                        <td width="50%" className="number-table2">
                          {Math.round(res * 100)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : ["corpseBattle"].includes(key) ? (
                <Val of={prop[0]} />
              ) : key === "spriteSheet" ? (
                <Val of={prop} />
              ) : ["psiDefence", "meleeDodge"].includes(key) ? (
                <SpecialBonus bonus={prop} />
              ) : ["builtInWeapons", "users", "units"].includes(key) ? (
                <Val of={prop?.filter((s: string) => s.substr(0, 8) !== "INV_NULL")} />
              ) : (
                <Val of={prop} />
              )}
            </td>
          </tr>
        })}
        <Subheader text="recovery" />
        <tr>
          <td colSpan={2}>
            <RecoveryTable recovery={entry.recovery} />
          </td>
        </tr>
      </tbody>
    </table>
  );
};

export default ArmorComponent;