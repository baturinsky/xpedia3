import type { Craft } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import { Img } from "./components";
import MainTable from "./MainTable";
import { Val } from "./Val";

const includeMarkerInSprites = true;

// The sprite frames the engine reads for a craft (Ufopaedia article
// `tip_sprite`): the base image at `sprite + 33`, the icon images at `sprite`
// and `sprite + 11`.
const baseSpriteOffset = 33;
const iconSpriteOffset = 11;
// The globe marker is drawn twice life-size.
const markerScale = 2;

/**
 * A shield recharge: whole hundreds are guaranteed shield points per step,
 * the remainder is the percent chance of one more. `-1` (geoscape only)
 * means instant recharge.
 */
function shieldRechargeText(val: number, period: string): string {
  if (val === -1) return `instant every ${period}`;
  if (val <= 0) return "none";
  const guaranteed = Math.floor(val / 100);
  const chance = val % 100;
  if (guaranteed === 0) return `${chance}% for +1 shield per ${period}`;
  const points = `+${guaranteed} shield${guaranteed === 1 ? "" : "s"} per ${period}`;
  return chance ? `${points} (+${chance}% for +1 more)` : points;
}

/** The disengage speed tier `accel` names (`tip_accel`). */
function accelTier(val: number): string {
  if (val <= 2) return "half speed";
  if (val <= 5) return "normal speed";
  if (val <= 8) return "+50% speed";
  return "double speed";
}

/** Craft table, follows old `Craft.svelte` */
export default function CraftComponent({ entry }: { entry: Craft }) {
  // The globe marker is drawn from its own sheet, which is a plain grid of
  // cells, so it is cropped by `Img` rather than sliced on a canvas
  const markerNum = entry.marker as number;
  const marker = rul.globeMarker(markerNum);

  return (
    <MainTable
      of={entry}
      title="Craft"
      sort={{
        first: ["speedMax", "soldiers", "damageMax", "fuelMax", "armor", "radarRange"],
        // The weapon slots close the table, after the starting-condition
        // lists: their column titles head only the slot rows, not those lists
        last: ["allowedIn", "forbiddenIn", "weaponTypes"],
        // `marker` is already drawn inside the `sprite` images; `allWeaponTypes`
        // is derived from `weaponTypes` (see `Craft` in Entry), so drawing both
        // states one fact twice — the per-slot `weaponTypes` stays
        exclude: [
          "type",
          "battlescapeTerrainData",
          "craftInventoryTile",
          "deployment",
          "marker",
          "allWeaponTypes",
          // Drawn as the first column of the `weaponTypes` table
          "weaponStrings",
        ],
      }}
      rows={{
        // `weaponTypes` pairs with `weaponStrings` per slot (OXCE_Readme:
        // "definition of allowed weapon types in craft" beside "string ID used
        // by geoscape craft status"), so the two draw as one two-column table
        // — the slot name beside the types that fit it — instead of two
        // separate lists. Like Research's guarded lists, the field draws its
        // own rows with no subheader: the two `table-subheader` cells are the
        // column titles. `weaponStrings` is excluded from the field rows.
        weaponTypes: ({ val }) => {
          const slots = val as string[][];
          const names = entry.weaponStrings as string[] | undefined;
          return (
            <>
              <tr>
                <td className="table-subheader">
                  <Val of="weaponStrings" />
                </td>
                <td className="table-subheader">
                  <Val of="weaponTypes" />
                </td>
              </tr>
              {slots.map((slot, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a slot is identified by its position, the order the file writes them
                <tr key={i}>
                  <td>
                    {names?.[i] != null ? (
                      <Val of={rul.tr(names[i])?.replace(">{ALT}{0}", "") ?? ""} />
                    ) : (
                      <>Slot {i + 1}</>
                    )}
                  </td>
                  <td>
                    <Val of={slot} />
                  </td>
                </tr>
              ))}
            </>
          );
        },
      }}
      special={{
        // The rates and recharges state an amount per round; the number alone
        // says neither the amount nor the round, so the value carries its
        // unit (and, for shield recharge, the decoded reading)
        refuelRate: ({ val }) => (
          <>
            <Val of={val} /> <small>fuel per 30 min</small>
          </>
        ),
        repairRate: ({ val }) => (
          <>
            <Val of={val} /> <small>damage per hour</small>
          </>
        ),
        shieldRecharge: ({ val }) => (
          <>
            <Val of={val} /> <small>{shieldRechargeText(val as number, "game second")}</small>
          </>
        ),
        shieldRechargeInGeoscape: ({ val }) => (
          <>
            <Val of={val} /> <small>{shieldRechargeText(val as number, "5 s")}</small>
          </>
        ),
        accel: ({ val }) => (
          <>
            <Val of={val} /> <small>({accelTier(val as number)})</small>
          </>
        ),
        // The base, the icon and the small icon, plus the marker this craft shows
        // on the globe when the pack has a `GlobeMarkers` sheet
        sprite: ({ val }) => (
          <>
            <Val obs="base" of={baseSpriteOffset + (val as number)} />
            <Val obs="icon" of={(val as number) + iconSpriteOffset} />
            <Val obs="icon" of={val} />
            {includeMarkerInSprites && marker && (
              <Img
                src={marker.path}
                frame={marker}
                scale={markerScale}
                alt={`marker ${markerNum}`}
              />
            )}
          </>
        ),
      }}
    />
  );
}
