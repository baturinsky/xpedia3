import React, { useEffect, useState } from "react";
import type { BonusMap } from "../rul/Entry";
import { damageTypes, rul, sortFirstLast } from "../rul/Ruleset";
import { state, update } from "../state";
import { Img, RecoveryTable, SpecialBonus, Subheader } from "./components";
import MainTable, { type MainTableRenderer } from "./MainTable";
import { canComposeUnit, UnitSheetPreview } from "./UnitSprite";
import { Val } from "./Val";

interface Entry {
  storeItem?: string;
  type?: string;
  users?: string[];
  stats?: { [stat: string]: number };
  armor?: { [key: string]: number | undefined };
  damageModifier?: number[];
  recovery?: { [stat: string]: { flatOne?: number; flatHundred?: number } };
  dollSprites: () => Promise<Record<string, string[]>>;
  builtInWeapons?: string[];
  drawingRoutine?: number;
  forcedTorso?: number;
  deathFrames?: number;
  movementType?: number;
  size?: number;
  // The table walks an entry's fields by name, so anything else it reads is
  // whatever the ruleset put there
  [key: string]: unknown;
}

/** Three layers of 40×40 pixels per figure, stacked into one doll */
const dollColumns = 6;

/**
 * The label under a doll: the paperdoll's own name when the language table has
 * one, otherwise the raw body id.
 *
 * Packs that draw their paperdolls name each body (`M0: M0 Reyi`), and those
 * names are the only thing that makes the numbered variants distinguishable.
 * The lookup only applies when the language table really has the id as a key:
 * `tr` would otherwise prettify an arbitrary body id (`CivilianMale` becomes
 * `Civilian Male`), which is not a name the pack intended.
 */
const bodyName = (body: string) => (body in rul.lang ? (rul.tr(body) ?? body) : body);

/** The doll of every body the armor was drawn for, with its stats and armor
 *  value columns; the "Show all variants" button belongs to the button block */
const ArmorPreview = ({ entry }: { entry: Entry }) => {
  // Only the sprite *data* belongs in state. The markup has to be rebuilt on
  // every render: `Img` starts with the transparent placeholder and swaps in the
  // real bitmap once it arrives from the database, so freezing the elements
  // would leave the dolls permanently empty.
  const [sprites, setSprites] = useState<Record<string, string[]> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSprites(null);
    entry
      .dollSprites()
      .then((s) => {
        if (!cancelled) setSprites(s ?? null);
      })
      .catch((error) => {
        console.error("Error loading sprites:", error);
        if (!cancelled) setSprites(null);
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  if (!sprites) return null;

  const bodies = Object.keys(sprites).sort((a, b) => rul.bodiesCompare([a, b]));
  const shouldShowAll = state.seeAllArmorVariants;

  return (
    <>
      {bodies.length > 1 && (
        <p>
          <button
            type="button"
            className="btn-hover-effect btn-hover-effect--effect-1"
            onClick={() => update({ seeAllArmorVariants: !state.seeAllArmorVariants })}
          >
            {shouldShowAll ? "Hide all variants" : `Show all ${bodies.length} variants`}
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
            {shouldShowAll && <div className="armor-variant">{bodyName(body)}</div>}
            {sprites[body].map((url) => (
              <Img key={`${body}-${url}`} src={url} alt={body} className="armor-layer" />
            ))}
          </div>
        );
      })}

      {/* The stats sit to the right of the first figure, which the absolutely
        positioned dolls leave room for */}
      <div
        style={{
          minHeight: shouldShowAll
            ? `${(Math.floor(bodies.length / dollColumns) + 1) * 120}px`
            : "120px",
          marginLeft: "175px",
        }}
      >
        {!shouldShowAll && (
          <div className="flex-horisontal" style={{ maxWidth: "95vw" }}>
            {["stats", "armor"].map((prop) =>
              !entry[prop] ? null : (
                <div key={prop} className="armor-column">
                  <header>
                    <Val of={prop} />
                  </header>
                  {sortFirstLast(entry[prop]).all.map(([key, val]) => (
                    <React.Fragment key={key}>
                      <div>
                        <Val of={key} icon="monospace" />
                      </div>
                      <div>
                        <em>
                          <Val of={val} />
                        </em>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </>
  );
};

/** Damage modifiers as a grid of coloured percentages, one cell per type */
const ResistGrid = ({ modifiers = [] }: { modifiers?: number[] }) => (
  <div className="flex-horisontal" style={{ maxWidth: "95vw" }}>
    <div className="armor-column armor-column-resists">
      <header>
        <Val of="damageModifier" />
      </header>
      {sortFirstLast(modifiers).all.map(([key, val]) => (
        <React.Fragment key={key}>
          <div>
            <Val of={damageTypes[Number(key)]} icon="monospace" />
          </div>
          <div>
            <em>
              <span
                style={{
                  fontWeight: "bold",
                  color: `hsl(${~~(Number(val) * 70)}, 100%, 50%)`,
                }}
              >
                {~~(Number(val) * 100)}
              </span>
            </em>
          </div>
        </React.Fragment>
      ))}
    </div>
  </div>
);

const ArmorComponent = ({ entry }: { entry: Entry }) => {
  // Old `Armor.svelte` linked the item the armor is stored as, then its users,
  // minus the armor itself and any user that has no inventory sprite
  const seeAlso: string[] = [];
  if (entry.storeItem && entry.storeItem !== "STR_NONE" && entry.storeItem !== entry.type)
    seeAlso.push(entry.storeItem);
  for (const user of entry.users ?? [])
    if (
      user.substr(0, 8) !== "INV_NULL" &&
      user !== entry.type &&
      `##${user}` !== window.location.hash
    )
      seeAlso.push(user);

  // A tank's gun is a separate sprite chosen by the turret type of the weapon
  // it is built around; `-1` means it has none
  const turret = (entry.builtInWeapons ?? []).reduce((found: number, weapon: string) => {
    if (found >= 0) return found;
    const type = rul?.items?.[weapon]?.turretType as number | undefined;
    return type != null && type >= 0 ? type : -1;
  }, -1);

  // `damageModifier` is drawn by `ResistGrid` above and therefore excluded from
  // the table's own rows, so a renderer for it here would never be reached
  const special: { [field: string]: MainTableRenderer } = {
    // A per-terrain table rather than a single value
    moveCost: ({ val }) => <MainTable of={val} />,
    // The ruleset stores a one-element list here
    corpseBattle: ({ val }) => <Val of={Array.isArray(val) ? val[0] : val} />,
    psiDefence: ({ val }) => <SpecialBonus bonus={val as BonusMap} />,
    meleeDodge: ({ val }) => <SpecialBonus bonus={val as BonusMap} />,
    // Placeholder ids for a unit that has no inventory sprite yet
    builtInWeapons: ({ val }) => (
      <Val of={(val as string[] | undefined)?.filter((s) => s.substr(0, 8) !== "INV_NULL")} />
    ),
    users: ({ val }) => (
      <Val of={(val as string[] | undefined)?.filter((s) => s.substr(0, 8) !== "INV_NULL")} />
    ),
    units: ({ val }) => (
      <Val of={(val as string[] | undefined)?.filter((s) => s.substr(0, 8) !== "INV_NULL")} />
    ),
  };

  // A unit sheet is an atlas of body parts, not a picture: draw the figure the
  // game would assemble from it. Sheets of any other kind are still a single
  // image, shown as before. Both need the whole width of the table.
  const rows: { [field: string]: MainTableRenderer } = {
    spriteSheet: ({ key, val }) => {
      const composable = canComposeUnit(val as string, entry.drawingRoutine);
      return (
        <tr>
          <td colSpan={2}>
            <Val of={key} />
            {composable ? (
              <div className="unit-sheet">
                <UnitSheetPreview
                  view={{
                    sheet: val as string,
                    routine: entry.drawingRoutine,
                    female: entry.forcedTorso === 2,
                    deathFrames: entry.deathFrames,
                    movementType: entry.movementType,
                    size: entry.size,
                    turret,
                  }}
                />
              </div>
            ) : (
              <div className="sprite-sheet-image">
                <Val of={val} />
              </div>
            )}
          </td>
        </tr>
      );
    },
  };

  return (
    <MainTable
      of={entry}
      header={
        <>
          <Val of="Armor" />
          {seeAlso.length > 0 && <span style={{ color: "white" }}>- see also </span>}
          <Val of={seeAlso} />
        </>
      }
      sort={{
        first: ["builtInWeapons", "size"],
        last: ["spriteSheet"],
        // Drawn by the preview block above, or by the recovery block below
        exclude: [
          "recovery",
          "type",
          "armor",
          "stats",
          "damageModifier",
          "dollSprites",
          "layersDefinition",
          "layersDefaultPrefix",
          "spriteInv",
          "frontArmor",
          "sideArmor",
          "rearArmor",
          "underArmor",
          "spriteFaceColor",
          "spriteHairColor",
          "spriteUtileColor",
          "spriteFaceGroup",
          "spriteHairGroup",
          "spriteUtileGroup",
          "customArmorPreviewIndex",
        ],
      }}
      before={
        <>
          <tr>
            <td colSpan={2}>
              <div className="armors">
                <ArmorPreview entry={entry} />
              </div>
            </td>
          </tr>
          {/* Old `Armor.svelte` drew this block even when the armor has no
          modifiers, so the heading still tells the reader there are none */}
          <tr>
            <td colSpan={2}>
              <ResistGrid modifiers={entry.damageModifier} />
            </td>
          </tr>
        </>
      }
      special={special}
      rows={rows}
      after={
        <>
          <Subheader text="recovery" />
          {/* `RecoveryTable` emits whole `<tr>` rows, so it sits directly in the
          `<tbody>` rather than inside a `<td>` */}
          <RecoveryTable recovery={entry.recovery} />
        </>
      }
    />
  );
};

export default ArmorComponent;
