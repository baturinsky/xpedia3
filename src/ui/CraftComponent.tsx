import type { Craft } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import { Img } from "./components";
import MainTable from "./MainTable";
import { Val } from "./Val";

const includeMarkerInSprites = true;

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
        first: ["speedMax", "soldiers"],
        exclude: ["type", "battlescapeTerrainData", "craftInventoryTile", "deployment"],
      }}
      special={{
        weaponStrings: ({ val }) => (
          <Val of={(val as string[]).map((slot) => rul.tr(slot)?.replace(">{ALT}{0}", "") ?? "")} />
        ),
        // The base, the icon and the small icon, plus the marker this craft shows
        // on the globe when the pack has a `GlobeMarkers` sheet
        sprite: ({ val }) => (
          <>
            <Val obs="base" of={33 + (val as number)} />
            <Val obs="icon" of={(val as number) + 11} />
            <Val obs="icon" of={val} />
            {includeMarkerInSprites && marker && (
              <Img src={marker.path} frame={marker} scale={2} alt={`marker ${markerNum}`} />
            )}
          </>
        ),
      }}
    />
  );
}
