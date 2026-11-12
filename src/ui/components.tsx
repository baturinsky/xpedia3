import { CSSProperties, Fragment, JSX, MouseEventHandler, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { state, update } from "../state";
import { type Column } from 'react-data-grid';

import { resolveImage } from "../packSource";
import { rul, sortFirstLast } from "../rul/Ruleset";
import { Val } from "./Val";
import React from "react";
import ItemComponent from "./ItemComponent";
import { CraftWeapon } from "../rul/Entry";
import { imageDataToUrl, allFieldValuesOf } from "../util";
import { emptyImg } from "../imgPlaceholders";

export async function viewImage(path: string) {
  let img = await resolveImage(path);
  if (!img)
    return;
  update({ imagePreview: img.url ?? imageDataToUrl(img.data) })
}

/** A sprite may be passed by its ruleset id, an asset path or a ready data url */
function spritePath(src?: string) {
  if (!src)
    return undefined;
  if (src.startsWith("data:"))
    return src;
  return rul.sprites[src]?.path ?? (/[\\/]/.test(src) ? src : undefined);
}

/**
 * CSS length factor for a sprite.
 *
 * Pixel art must cover a whole number of device pixels per source pixel. With a
 * fractional factor — a 2x sprite on a 125% Windows display covers 2.5 device
 * pixels — nearest-neighbour scaling gives some pixels 3 device pixels and
 * their neighbours 2, which shows up as uneven, wobbly edges. Rounding the
 * magnification to whole device pixels keeps every pixel square.
 *
 * A factor of 1 is left alone: it is the sprite's natural size, and rounding it
 * would resize (and resample) plain 1:1 artwork such as paperdolls.
 */
export function spriteScale(factor: number, ratio = window.devicePixelRatio || 1) {
  if (!(factor > 1) || !(ratio > 0))
    return factor;
  return Math.max(1, Math.round(factor * ratio)) / ratio;
}

/**
 * The current device pixel ratio, kept up to date when the browser zoom or the
 * monitor scale changes. `spriteScale` needs it, and so does any layout that is
 * built from sprite sizes, so both read the same value.
 *
 * A single `resolution` media query is shared by every image: `Img` renders for
 * every icon in a table, and one listener per instance would be wasteful.
 */
export function usePixelRatio() {
  // `window.devicePixelRatio` is read live: it changes without a `resolution`
  // media query event in some environments (device emulation, for example)
  return useSyncExternalStore(subscribePixelRatio, () => window.devicePixelRatio || 1);
}

let ratioQuery: MediaQueryList | undefined;
const ratioSubscribers = new Set<() => void>();

/** Starts listening for the next ratio change; the old query can never match again */
function listenForRatioChange() {
  if (ratioQuery) {
    ratioQuery.removeEventListener("change", ratioChanged);
    ratioQuery = undefined;
  }
  if (window.matchMedia) {
    ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    ratioQuery.addEventListener("change", ratioChanged);
  }
}

function ratioChanged() {
  listenForRatioChange();
  for (let notify of ratioSubscribers)
    notify();
}

function subscribePixelRatio(notify: () => void) {
  ratioSubscribers.add(notify);
  if (!ratioQuery)
    listenForRatioChange();
  return () => {
    ratioSubscribers.delete(notify);
    if (!ratioSubscribers.size && ratioQuery) {
      ratioQuery.removeEventListener("change", ratioChanged);
      ratioQuery = undefined;
    }
  };
}

/**
 * An image for `src`, either from the database, from the inlined pack's game
 * folder, or a transparent placeholder when it does not exist.
 */
export function Img(props: {
  src?: string, scale?: number, alt?: string, style?: CSSProperties,
  maxWidth?: number, maxHeight?: number, zoom?: number, className?: string
}) {  
  let path = spritePath(props.src);
  let images = state.images;
  let [natural, setNatural] = useState<{ path: string, w: number, h: number }>();
  // Images that can't be decoded fall back to the transparent placeholder, like
  // old `Img.svelte`/`SmartImage` did. It is tracked per path so that switching
  // articles retries instead of keeping the failure forever.
  let [brokenPath, setBrokenPath] = useState<string>();
  let pixelRatio = usePixelRatio();

  // Load the sprite once. `null` is stored for missing images so that a missing
  // sprite doesn't trigger a lookup on every render. The entry is either a data
  // url (from the database) or a url relative to the page (inlined pack).
  // Data urls (e.g. map markers) are used as they are.
  useEffect(() => {
    if (!path || path.startsWith("data:") || Object.prototype.hasOwnProperty.call(state.images, path))
      return;
    let cancelled = false;
    resolveImage(path).then(img => {
      if (cancelled)
        return;
      let value = img ? (img.url ?? (img.data ? imageDataToUrl(img.data) : null)) : null;
      update({ images: { ...state.images, [path!]: value } })
    }).catch(e => {
      console.warn("Can't load image", path, e);
      if (!cancelled)
        update({ images: { ...state.images, [path!]: null } })
    });
    return () => { cancelled = true; };
  }, [path]);

  if (!path)
    return null;

  let img = images[path];
  let broken = brokenPath === path;
  let hasRealData = !broken && (path.startsWith("data:") || !!img);
  let dataImage = hasRealData ? (path.startsWith("data:") ? path : img) : emptyImg;
  // Old CanvasImage measured the loaded bitmap and scaled it by `zoom`
  let baseFactor = props.zoom ?? props.scale ?? 1;
  let factor = spriteScale(baseFactor, pixelRatio);
  let size = natural?.path === path ? natural : undefined;
  let element = <img className={"x-image" + (props.className ? " " + props.className : "")} src={dataImage} alt={props.alt ?? props.src}
    onLoad={e => {
      // The transparent placeholder is a 1x1 png; measuring it would pin every
      // image to 1x1 until it is remounted.
      if (!hasRealData)
        return;
      let t = e.currentTarget;
      if (t.naturalWidth && t.naturalHeight && (t.naturalWidth != size?.w || t.naturalHeight != size?.h))
        setNatural({ path: path!, w: t.naturalWidth, h: t.naturalHeight });
    }}
    onError={() => {
      if (!broken) {
        console.warn("Can't decode image", path);
        setBrokenPath(path!);
      }
    }}
    style={{
      imageRendering: "pixelated",
      width: size ? size.w * factor : undefined,
      height: size ? size.h * factor : undefined,
      ...props.style ?? {}
    }} />;

  if (props.maxWidth == null && props.maxHeight == null)
    return element;

  // The clip box is sized in unscaled sprite pixels, while the sprite itself is
  // drawn `factor` times larger. Snapping the factor can make the sprite a bit
  // bigger than before, so the box is scaled by the same amount to keep exactly
  // the same part of the picture visible.
  let clipScale = baseFactor ? factor / baseFactor : 1;
  let box = (v?: number) => v == null ? undefined : Math.round(v * clipScale * pixelRatio) / pixelRatio;
  return <div className="img-clip" style={{ maxWidth: box(props.maxWidth), maxHeight: box(props.maxHeight) }}>
    {element}
  </div>;
}

export function useStateAsync<T>(p: Promise<T>, initialValue?: T) {

  let [getter, setter] = useState(initialValue)

  useEffect(() => {
    p.then(a => {
      setter(a);
    })
  }, [state.count])

  return getter;
}

function adHocColumns(a: any[]) {
  return Object.keys(a[0]).map(key => ({ key, name: key }))
}

interface FilesRow {
  name: string;
  size: number;
}

const columnsSizeName: readonly Column<FilesRow>[] = [
  { key: 'size', name: 'size', cellClass: "num-grid", maxWidth: 200 },
  { key: 'name', name: 'name' },
];

export function MyTable<T extends { key: any }>(props: {
  className?: string,
  style?: CSSProperties,
  columns: {
    key: string, name?: string, cellClass?: string,
    renderCell?: (data: { row: T, column: any }) => any, maxWidth?: number, minWidth?: number
  }[],
  rows: T[],
  rowClass?: (row: T) => string
}) {
  return <table className={props.className} style={props.style}>
    <thead><tr>{props.columns.map(col => <td key={col.name}>{col.name}</td>)}</tr></thead>
    <tbody>
      {props.rows.map((row: any) => <tr key={row.key} className={props.rowClass ? props.rowClass(row) : ""}>
        {props.columns.map(column =>
          <td key={column.key}>{
            column.renderCell ? column.renderCell({ row, column }) : row[column.key]
          }</td>
        )}
      </tr>)}
    </tbody>
  </table>
}

export type AnyRef = string | { type: string } | { id: string };

/** Normalizes a reference to the id it points to, if any */
export function fromAnyRef(href?: AnyRef) {
  if (href == null)
    return null;
  if (typeof href == "object")
    return (href as any).type ?? (href as any).id ?? null;
  return href === "" ? null : href;
}

export const Divider = (props: { vertical?: boolean }) =>
  props.vertical ? <br /> : <span className='list-divider'>&nbsp;· </span>;


export const CogAnimation = (props: { size?: number }) => {
  let size = props.size ?? 100;
  return <svg style={{ width: `${size}px`, height: `${size}px` }}>
    <g
      transform={`scale(${size / 100}) translate(50 50)`}
      id="g4"
    >
      <g id="g6" style={{ fill: `#64ccbc`, fillOpacity: 1 }}>
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="0;360"
          keyTimes="0;1"
          dur="3s"
          repeatCount="indefinite"
        />
        <path
          d="M37.43995192304605 -6.5 L47.43995192304605 -6.5 L47.43995192304605 6.5 L37.43995192304605 6.5 A38 38 0 0 1 35.67394948182593 13.090810836924174 L35.67394948182593 13.090810836924174 L44.33420351967032 18.090810836924174 L37.83420351967032 29.34914108612188 L29.17394948182593 24.34914108612188 A38 38 0 0 1 24.34914108612188 29.17394948182593 L24.34914108612188 29.17394948182593 L29.34914108612188 37.83420351967032 L18.090810836924184 44.33420351967032 L13.090810836924183 35.67394948182593 A38 38 0 0 1 6.5 37.43995192304605 L6.5 37.43995192304605 L6.500000000000001 47.43995192304605 L-6.499999999999995 47.43995192304606 L-6.499999999999996 37.43995192304606 A38 38 0 0 1 -13.09081083692417 35.67394948182593 L-13.09081083692417 35.67394948182593 L-18.09081083692417 44.33420351967032 L-29.34914108612187 37.834203519670325 L-24.349141086121872 29.173949481825936 A38 38 0 0 1 -29.17394948182592 24.34914108612189 L-29.17394948182592 24.34914108612189 L-37.83420351967031 29.349141086121893 L-44.33420351967031 18.0908108369242 L-35.67394948182592 13.090810836924193 A38 38 0 0 1 -37.43995192304605 6.5000000000000036 L-37.43995192304605 6.5000000000000036 L-47.43995192304605 6.500000000000004 L-47.43995192304606 -6.499999999999993 L-37.43995192304606 -6.499999999999994 A38 38 0 0 1 -35.67394948182593 -13.090810836924167 L-35.67394948182593 -13.090810836924167 L-44.33420351967032 -18.090810836924163 L-37.834203519670325 -29.34914108612187 L-29.173949481825936 -24.34914108612187 A38 38 0 0 1 -24.349141086121893 -29.17394948182592 L-24.349141086121893 -29.17394948182592 L-29.349141086121897 -37.834203519670304 L-18.0908108369242 -44.334203519670304 L-13.090810836924195 -35.67394948182592 A38 38 0 0 1 -6.500000000000005 -37.43995192304605 L-6.500000000000005 -37.43995192304605 L-6.500000000000007 -47.43995192304605 L6.49999999999999 -47.43995192304606 L6.499999999999992 -37.43995192304606 A38 38 0 0 1 13.090810836924149 -35.67394948182594 L13.090810836924149 -35.67394948182594 L18.090810836924142 -44.33420351967033 L29.349141086121847 -37.83420351967034 L24.349141086121854 -29.17394948182595 A38 38 0 0 1 29.17394948182592 -24.349141086121893 L29.17394948182592 -24.349141086121893 L37.834203519670304 -29.349141086121897 L44.334203519670304 -18.0908108369242 L35.67394948182592 -13.090810836924197 A38 38 0 0 1 37.43995192304605 -6.500000000000007 M0 -20A20 20 0 1 0 0 20 A20 20 0 1 0 0 -20"
          id="path8"
          style={{ fill: `var(--lighter)`, fillOpacity: 1 }}
        />
      </g>
    </g>
  </svg>
}

export function BaseService({ entry }: { entry: { [id: string]: AnyRef[] } }) {
  return <table className="main-table base-service-table">
    <tbody>
      {Object.entries(entry).sort((a, b) => (a[0] == "providedBy" ? -10 : 10) + (a[0] > b[0] ? 1 : -1)).map(prop =>
      (!['id'].includes(prop[0]) &&
        <tr key={prop[0]}><td><Val of={prop[0]} capital={true} /></td>
          <td><Val of={prop[1]} /></td></tr>
      ))}
    </tbody>
  </table>

}

export function BaseServiceList({ items = null as string[] | null, vertical = false }) {
  if (!items || !items.length)
    return null;
  return <>
    {items.map((item, i) => <React.Fragment key={item}>
      {i == 0 ? "" : (vertical ? <br /> : ", ")}
      <Val of={item} />
    </React.Fragment>)}
  </>
}

export function Nobr(props: any) {
  return <span className="nobr">{props.children}</span>
}


/** Small-caps subheading row, follows old `Subheader.svelte` */
export function Subheader(props: { text: string }) {
  return <tr>
    <td colSpan={2} className="table-subheader">
      <Val of={props.text} />
    </td>
  </tr>
}

/** Rows of `SpecialBonus` values, follows old `RecoveryTable.svelte` */
export function RecoveryTable(props: { recovery: any }) {
  if (!props?.recovery)
    return null;

  return <>{sortFirstLast(props.recovery).all.map(([field, bonus]) =>
    <tr key={field}>
      <td><Val of={field} /></td>
      <td><SpecialBonus bonus={bonus} /></td>
    </tr>
  )}</>;
}


export function SecondaryTable(props: { text: string, children: JSX.Element }) {
  return <>
    <tr>
      <td colSpan={2} className="table-subheader">
        <Val of={props.text} />
      </td></tr
    >
    <tr>
      <td colSpan={2} className="secondary-table-td">
        {props.children}
      </td>
    </tr>
  </>
}


export function AlterList(props: { items: { [id: string]: string } }) {
  return (
    <tr>
      <td colSpan={4} className="attacks-alter">
        <small>
          {Object.keys(props.items)
            .sort()
            .map((field, i) => (
              <React.Fragment key={field}>
                {i !== 0 && <Divider />}
                &nbsp;
                <Nobr>
                  <span data-tooltip={`tip_${field}`}>
                    <Val of={field} />
                    {rul.lang && `tip_${field}` in rul.lang && (
                      <sup className="tipmark">?</sup>
                    )}
                    :
                  </span>

                  <Val of={props.items[field]} />

                  {rul.lang && rul.lang[`${field}_${props.items[field]}`] || ""}
                </Nobr>
              </React.Fragment>
            ))}
        </small>
      </td>
    </tr>
  );
};


export const SpecialBonus = ({ bonus, plus = false }: { bonus: any, plus?: boolean }) => {
  const flat = useMemo(() => {
    if (!bonus) return [];

    let flat: [string, number, string][] = [];
    for (let type of Object.keys(bonus)) {
      if (bonus[type].length) {

        for (let power = 0; power < bonus[type].length; power++) {
          let b = bonus[type][power];
          if (b !== 0) {
            flat.push([type, b, type, power + 1] as any);
          }
        }
      } else {
        if (bonus[type] !== 0) flat.push([type, bonus[type], type]);
      }
    }
    flat = flat.sort((a, b) => (a[0] === "flatHundred" || a[0] === "flatOne" || a[0] < b[0] ? -1 : 1));
    return flat;
  }, [bonus]);

  return (
    <>
      {flat.length > 0 && plus && "+"}
      {flat.map((b, i) => {
        let [type, value, kind, power = 1] = b as any;
        return (
          <React.Fragment key={i}>
            {i !== 0 && " +"}
            {kind === "flatHundred" ? (
              value * 100
            ) : kind === "flatOne" ? (
              value
            ) : (
              <Nobr>
                <a href={"##" + type}>{rul.tr(type, { icon: "compact" })}</a>
                {power === 1 ? "" : <sup>{power}</sup>}
                {value !== 1 && <em>×{value}</em>}
              </Nobr>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};


/** Splits long lists into pages, following old PaginatedList.svelte */
export function PaginatedList(props: {
  items: any[],
  pageSize?: number,
  onePageMax?: number,
  /** Extra class on the wrapper; a table needs a block wrapper to scroll */
  className?: string,
  children: (items: any[]) => any
}) {
  let items = props.items instanceof Set ? [...props.items] : props.items ?? [];
  let pageSize = props.pageSize ?? 40;
  let onePageMax = props.onePageMax ?? 200;
  let pages = items.length <= onePageMax ? 1 : Math.ceil(items.length / pageSize);
  let [page, setPage] = useState(1);

  if (page > pages)
    setPage(1);

  let shown = items.length <= onePageMax
    ? items
    : items.slice((page - 1) * pageSize, page * pageSize);

  return <>
    {pages > 1 &&
      <div className="dark-pagination-nav">
        {Array.from({ length: pages }, (_, i) => i + 1)
          .filter(p => p == 1 || p == pages || Math.abs(p - page) <= 2)
          .map((p, i, shownPages) =>
            <React.Fragment key={p}>
              {i > 0 && shownPages[i - 1] != p - 1 && <span> … </span>}
              <button className={"pagination-button" + (p == page ? " current" : "")}
                onClick={() => setPage(p)}>{p}</button>
            </React.Fragment>
          )}
      </div>
    }
    <span className={"links-list " + (props.className ?? "")}>
      {props.children(shown)}
    </span>
  </>;
}

/** A page that is just a list of links, e.g. a section's article list */
export function LinksPage(props: {
  links?: AnyRef[],
  cols?: number | false,
  title?: any,
}) {
  let links = props.links ?? [];
  if (!links.length)
    return null;

  // Sorting is controlled by the single `A-Z` button in the top navbar
  let items = state.alphabeticalSort
    ? [...links].sort((a, b) => rul.tr(fromAnyRef(a) ?? "") > rul.tr(fromAnyRef(b) ?? "") ? 1 : -1)
    : links;

  return <>
    {props.title != null && <div className="links-page-header"><Val of={props.title} /></div>}
    {props.cols
      ? <div className="links-page">
        <div className="cols" style={{ columns: props.cols }}>
          <ol>
            {items.map((option, i) => <li key={i}><Val of={option} /></li>)}
          </ol>
        </div>
      </div>
      : <PaginatedList items={items} pageSize={600}>
        {shown => shown.map((item, i) =>
          <React.Fragment key={i}>
            {i !== 0 && <Divider />}
            <Val of={item} />
          </React.Fragment>
        )}
      </PaginatedList>
    }
  </>;
}

export interface SectionTableProps {
  /** Id of the article that shows this table, used to persist column layout */
  aId?: string,
  entries: any[],
  fields: string[],
  extraFields?: string[],
  filters?: { [key: string]: any[] },
}

/** Table of entries with selectable/sortable columns, follows old SectionTable.svelte */
export function SectionTable(props: SectionTableProps) {
  let entries = props.entries ?? [];
  let storageKey = "xpediaColumnOrder" + (props.aId ?? "");
  let fields = [...(props.fields ?? [])];
  let extraFields = (props.extraFields ?? []).filter(f => !fields.includes(f));

  let saved: any = {};
  try {
    saved = JSON.parse(localStorage[storageKey] ?? "null") ?? {};
  } catch { saved = {}; }

  let allFields: string[] = saved.allFields ?? ["id", ...fields];
  let [shownFields, setShownFields] = useState<string[]>(allFields);
  let [filtersSelected, setFiltersSelected] = useState<{ [key: string]: string }>(saved.filtersSelected ?? {});
  let [sortField, setSortField] = useState<string | undefined>(saved.sortField);
  let [sortDescending, setSortDescending] = useState<boolean>(saved.sortDescending ?? false);
  let [filterId, setFilterId] = useState("");

  // "auto" filter options are filled in from the entries themselves
  let filters: { [key: string]: string[] } = {};
  for (let [key, options] of Object.entries(props.filters ?? {})) {
    filters[key] = [...options];
    let autoAt = filters[key].indexOf("auto");
    if (autoAt != -1) {
      let values = allFieldValuesOf(entries, key);
      if (values.length > 0)
        filters[key].splice(autoAt, 1, ...values.sort());
    }
  }

  useEffect(() => {
    localStorage[storageKey] = JSON.stringify({ allFields: shownFields, filtersSelected, sortField, sortDescending });
  }, [shownFields, filtersSelected, sortField, sortDescending]);

  let sorted = [...entries];
  for (let k in filtersSelected) {
    if (filtersSelected[k] != null)
      sorted = sorted.filter(a => {
        if (filtersSelected[k] == "any") return true;
        let v = a.sortField(k, filtersSelected[k]);
        return v === true || v == filtersSelected[k] || (Array.isArray(v) && v.includes(filtersSelected[k]));
      });
  }
  if (filterId.length > 0)
    sorted = sorted.filter(a => String(a.sortField("id")).toLowerCase().match(filterId));

  if (sortField) {
    let nullValue = sortDescending ? Number.MIN_VALUE : Number.MAX_VALUE;
    sorted = sorted.sort((a, b) =>
      (a.sortField(sortField) ?? nullValue) > (b.sortField(sortField) ?? nullValue) == sortDescending ? -1 : 1);
  }

  function sortBy(field: string) {
    if (field != sortField) {
      setSortField(field);
      setSortDescending(field != "id");
    } else {
      setSortDescending(!sortDescending);
    }
  }

  function toggleField(field: string) {
    setShownFields(shownFields.includes(field)
      ? shownFields.filter(f => f != field)
      : [...shownFields, field]);
  }

  let extraAll = [...fields, ...extraFields];

  return <>
    <div className="extra-fields">
      {extraAll.map((field, i) =>
        <React.Fragment key={field}>
          {i !== 0 && <Divider />}
          <span className={"clickable " + (shownFields.includes(field) ? "on" : "off")}
            onClick={() => toggleField(field)}><Val of={field} /></span>
        </React.Fragment>
      )}
    </div>
    <div className="table-filters">
      {Object.entries(filters).map(([filter, options]) =>
        <React.Fragment key={filter}>
          <Val of={filter} />:
          <select value={filtersSelected[filter] ?? ""}
            onChange={e => setFiltersSelected({ ...filtersSelected, [filter]: e.target.value })}>
            {options.map(option =>
              <option key={option} value={option}>{rul.tr(option)}</option>
            )}
          </select>
        </React.Fragment>
      )}
      <input value={filterId} onChange={e => setFilterId(e.target.value)}
        type="text" placeholder={rul.tr("Filter...")} />
    </div>
    <PaginatedList items={sorted} pageSize={40} onePageMax={200} className="table-list">
      {paginatedItems =>
        <table className="section-table">
          <thead>
            <tr>
              {shownFields.map(field =>
                <td key={field} id={"thead " + field}
                  draggable="true"
                  onDragStart={e => e.dataTransfer.setData("field", field)}
                  onDrop={e => moveField(shownFields, field, e.dataTransfer.getData("field"), setShownFields)}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move" }}
                  onClick={() => sortBy(field)}>
                  <span className="sort-order-arrow">&#9660;</span>
                  <Val of={field} />
                  <span className="sort-order-arrow">
                    {sortField != field ? <span className="invisible">&#9660;</span> : sortDescending ? "▼" : "▲"}
                  </span>
                </td>
              )}
            </tr>
          </thead>
          <tbody>
            {paginatedItems.map((entry: any, i: number) =>
              <tr key={entry.id ?? i}>
                {shownFields.map(field =>
                  <td key={field} className={"st-" + field}>
                    <Val of={entry.sortField(field, true)} nobr={20} field={field} />
                  </td>
                )}
              </tr>
            )}
          </tbody>
        </table>
      }
    </PaginatedList>
  </>;
}

/** Moves a column so that it appears right after another one */
function moveField(shownFields: string[], after: string, field: string, setShownFields: (v: string[]) => void) {
  let fi = shownFields.indexOf(field);
  if (fi == -1) return;
  let next = shownFields.filter(f => f != field);
  let ai = next.indexOf(after);
  if (ai == -1) ai = 0;
  else ai++;
  next.splice(ai, 0, field);
  setShownFields(next);
}

export function SubTable(props: { of: Object, switchColumns?: boolean }) {
  const subVal = (v: any) => (v instanceof Object || Array.isArray(v)) ? <SubTable of={v} /> : <Val of={v} />
  return <table className="sub-table">
    <tbody>
      {
        Array.isArray(props.of) ? (
          props.of.map((entry, i) => <tr key={i}>
            <td>
              {subVal(entry)}
            </td>
          </tr>)
        ) :
          Object.entries(props.of).map((entry: [any, any], i: number) => {
            if (props.switchColumns)
              entry = entry.reverse() as [any, any];
            return <tr key={i}>
              <td><Val of={entry[0]} /></td>
              <td>
                {subVal(entry[1])}
              </td>
            </tr>
          }
          )}
    </tbody>
  </table>
}