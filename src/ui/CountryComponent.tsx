import type { Entry } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import MainTable from "./MainTable";
import { CountryMapArticle } from "./WorldMapArticle";

/**
 * A nation's page, with its `areas` drawn rather than counted out.
 *
 * The field is a list of `[lonMin, lonMax, latMin, latMax]` boxes, and printed as
 * numbers it says nothing a reader can use: four bare figures per box, three
 * boxes per nation in X-Piratez, and no way to tell one nation from a rectangle.
 * Those same boxes are what the world map draws a nation with, so the row shows
 * that drawing cropped to this nation, and pressing it leads to the Countries
 * page, where the nation can be read against all the others.
 *
 * Only a list of boxes is taken over. A pack that writes something else under
 * `areas` — or a pack with no globe, so nothing to crop — keeps the plain table
 * `MainTable` would have drawn, because the numbers are then still the honest
 * answer and an error message would not be.
 */
const CountriesComponent = ({ entry }: { entry: Entry }) => {
  const areas = entry.areas;
  const draw = rul?.raw?.globe && Array.isArray(areas) && Array.isArray(areas[0]);

  return (
    <MainTable
      of={entry}
      title="Country"
      // `areas` as a subheader block at the end, so the crop gets the same
      // weight as the wide lists elsewhere instead of sitting in a value cell
      sort={{ last: ["areas"] }}
      wide={draw ? ["areas"] : []}
      special={
        draw
          ? {
              areas: () => <CountryMapArticle id={entry.uid} />,
            }
          : undefined
      }
    />
  );
};

export default CountriesComponent;
