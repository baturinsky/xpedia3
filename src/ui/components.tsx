import React, {
  type CSSProperties,
  type JSX,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { emptyImg } from "../imgPlaceholders";
import { resolveImage } from "../packSource";
import type { AlterMap, BonusMap } from "../rul/Entry";
import { rul, sortFirstLast } from "../rul/Ruleset";
import { state, update } from "../state";
import { allFieldValuesOf, imageDataToUrl } from "../util";
import { Tr, Val } from "./Val";

export async function viewImage(path: string) {
  const img = await resolveImage(path);
  if (!img) return;
  update({ imagePreview: img.url ?? imageDataToUrl(img.data) });
}

/**
 * Sprite urls waiting to be recorded, and whether a flush is already queued.
 *
 * Images arrive in bursts — a paperdoll page asks for hundreds at once — and
 * every `update()` notifies the whole store, re-rendering the page. Recording
 * them one by one made that a render per image. Buffering for a tick turns a
 * burst into a single update, which is also when the browser paints anyway.
 */
let pendingImages: { [path: string]: string | null } | undefined;
let imageFlushQueued = false;
/** The pack the buffered urls belong to, so a switch cannot mix them up */
let pendingPack: string | undefined;

/** Image lookups already running, so a burst reads each path only once */
const imageLookups = new Map<
  string,
  { pack?: string; promise: Promise<{ data?: Uint8Array; url?: string } | undefined> }
>();

/**
 * `resolveImage` for a path that a whole page may ask for many times.
 *
 * One paperdoll reuses the same artwork across its bodies (X-Piratez's worst
 * armor lists 770 layers but only 410 distinct images), and the components all
 * mount before the first answer arrives, so without this each duplicate would
 * be a separate trip to the database.
 *
 * A switch to another modpack makes every waiting lookup worthless — the path
 * would answer with the previous pack's bytes — so they are started again. The
 * pack a lookup was started for travels with it, see `cacheImage`.
 */
function lookupImage(path: string): {
  pack?: string;
  promise: Promise<{ data?: Uint8Array; url?: string } | undefined>;
} {
  const pack = state.packName;
  const running = imageLookups.get(path);
  if (running && running.pack === pack) return running;
  const lookup = { pack, promise: resolveImage(path) };
  imageLookups.set(path, lookup);
  // Kept only while in flight: a missing image is cached as `null` separately,
  // and a real one is in `state.images`, so a later mount has no reason to ask
  const done = () => {
    if (imageLookups.get(path) === lookup) imageLookups.delete(path);
  };
  lookup.promise.then(done, done);
  return lookup;
}

/** Records a loaded (or missing) sprite, flushing the whole burst at once */
function cacheImage(path: string, value: string | null, pack?: string) {
  // A lookup that was already running when the pack changed answers with the
  // previous pack's bytes, so its result is dropped rather than buffered
  if ((pack ?? state.packName) !== state.packName) return;
  // Urls buffered for another pack must not land in this one's cache
  if (pendingPack != null && pendingPack !== state.packName) {
    pendingImages = undefined;
    imageFlushQueued = false;
  }
  pendingPack = state.packName;
  (pendingImages ??= {})[path] = value;
  if (imageFlushQueued) return;
  imageFlushQueued = true;
  setTimeout(() => {
    const batch = pendingImages;
    pendingImages = undefined;
    imageFlushQueued = false;
    if (batch) update({ images: { ...state.images, ...batch } });
  }, 0);
}

/** A sprite may be passed by its ruleset id, an asset path or a ready data url */
function spritePath(src?: string) {
  if (!src) return undefined;
  if (src.startsWith("data:")) return src;
  return rul?.sprites[src]?.path ?? (/[\\/]/.test(src) ? src : undefined);
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
  if (!(factor > 1) || !(ratio > 0)) return factor;
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
  for (const notify of ratioSubscribers) notify();
}

function subscribePixelRatio(notify: () => void) {
  ratioSubscribers.add(notify);
  if (!ratioQuery) listenForRatioChange();
  return () => {
    ratioSubscribers.delete(notify);
    if (!ratioSubscribers.size && ratioQuery) {
      ratioQuery.removeEventListener("change", ratioChanged);
      ratioQuery = undefined;
    }
  };
}

/**
 * Several sprites at once, for a component that rasterises more than one image
 * (a unit figure is assembled from cells of a sheet, and a set may be spread
 * over more than one image). Loads through the same cache as `Img`.
 */
export function useSpriteImages(paths: string[]) {
  const images = state.images;
  const key = paths.join("\n");
  const [broken, setBroken] = useState<string[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the content of `paths`, listed because a fresh array identity must not restart the loading.
  useEffect(() => {
    let cancelled = false;
    const fails: string[] = [];
    for (const path of paths) {
      if (!path || path.startsWith("data:") || Object.hasOwn(state.images, path)) continue;
      const lookup = lookupImage(path);
      lookup.promise
        .then((img) => {
          if (cancelled) return;
          const value = img ? (img.url ?? (img.data ? imageDataToUrl(img.data) : null)) : null;
          cacheImage(path, value, lookup.pack);
        })
        .catch((e) => {
          if (cancelled) return;
          console.warn("Can't load image", path, e);
          fails.push(path);
          cacheImage(path, null, lookup.pack);
        });
    }
    // Recorded after the loop so one failed image does not stop the others
    if (fails.length) setBroken(fails);
    return () => {
      cancelled = true;
    };
  }, [key]);

  /** path -> a url that will actually paint; paths still loading are absent */
  const urls = new Map<string, string>();
  let settled = true;
  for (const path of paths) {
    const value = path.startsWith("data:") ? path : images[path];
    if (value) urls.set(path, value);
    else if (!Object.hasOwn(images, path) && !broken.includes(path)) settled = false;
  }
  return { urls, settled };
}

/**
 * An image for `src`, either from the database, from the inlined pack's game
 * folder, or a transparent placeholder when it does not exist.
 */
export function Img(props: {
  src?: string;
  scale?: number;
  alt?: string;
  style?: CSSProperties;
  maxWidth?: number;
  maxHeight?: number;
  zoom?: number;
  className?: string;
  /**
   * Crop one cell of a sprite sheet, in source pixels, as `Sprite.frameSource`
   * describes it. The cell becomes the image's size and the sheet is shifted
   * behind it, so a single frame needs no canvas.
   */
  frame?: { x: number; y: number; w: number; h: number };
}) {
  const path = spritePath(props.src);
  const images = state.images;
  const [natural, setNatural] = useState<{ path: string; w: number; h: number }>();
  // Images that can't be decoded fall back to the transparent placeholder, like
  // old `Img.svelte`/`SmartImage` did. It is tracked per path so that switching
  // articles retries instead of keeping the failure forever.
  const [brokenPath, setBrokenPath] = useState<string>();
  const pixelRatio = usePixelRatio();

  // Load the sprite once. `null` is stored for missing images so that a missing
  // sprite doesn't trigger a lookup on every render. The entry is either a data
  // url (from the database) or a url relative to the page (inlined pack).
  // Data urls (e.g. map markers) are used as they are.
  useEffect(() => {
    if (!path || path.startsWith("data:") || Object.hasOwn(state.images, path)) return;
    let cancelled = false;
    const lookup = lookupImage(path);
    lookup.promise
      .then((img) => {
        if (cancelled) return;
        const value = img ? (img.url ?? (img.data ? imageDataToUrl(img.data) : null)) : null;
        cacheImage(path, value, lookup.pack);
      })
      .catch((e) => {
        console.warn("Can't load image", path, e);
        if (!cancelled) cacheImage(path, null, lookup.pack);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) return null;

  const img = images[path];
  const broken = brokenPath === path;
  const hasRealData = !broken && (path.startsWith("data:") || !!img);
  // `hasRealData` already requires a non-empty `img`, so the fallback is only a
  // type guard; nothing renders it
  const dataImage = (hasRealData ? (path.startsWith("data:") ? path : img) : emptyImg) ?? emptyImg;
  // Old CanvasImage measured the loaded bitmap and scaled it by `zoom`
  const baseFactor = props.zoom ?? props.scale ?? 1;
  const factor = spriteScale(baseFactor, pixelRatio);
  const size = natural?.path === path ? natural : undefined;
  const frame = props.frame;
  const element = (
    <img
      className={`x-image${props.className ? ` ${props.className}` : ""}`}
      src={dataImage}
      alt={props.alt ?? props.src}
      onLoad={(e) => {
        // The transparent placeholder is a 1x1 png; measuring it would pin every
        // image to 1x1 until it is remounted.
        if (!hasRealData) return;
        const t = e.currentTarget;
        if (
          t.naturalWidth &&
          t.naturalHeight &&
          (t.naturalWidth !== size?.w || t.naturalHeight !== size?.h)
        )
          setNatural({ path, w: t.naturalWidth, h: t.naturalHeight });
      }}
      onError={() => {
        if (!broken) {
          console.warn("Can't decode image", path);
          setBrokenPath(path);
        }
      }}
      style={
        frame
          ? {
              // The sheet is laid out at its natural size in the clip box, shifted so
              // that the cell's corner is at the box's corner, then magnified about it
              position: "absolute",
              left: -frame.x * factor,
              top: -frame.y * factor,
              imageRendering: "pixelated",
              transform: `scale(${factor})`,
              transformOrigin: "0 0",
              maxWidth: "none",
              maxHeight: "none",
              ...(props.style ?? {}),
            }
          : {
              imageRendering: "pixelated",
              width: size ? size.w * factor : undefined,
              height: size ? size.h * factor : undefined,
              ...(props.style ?? {}),
            }
      }
    />
  );

  // One cell of a sprite sheet: a box the size of the cell clips the rest away.
  // The cell is measured in source pixels, so the box follows the magnification.
  if (frame)
    return (
      <div
        className="img-clip"
        style={{
          width: frame.w * factor,
          height: frame.h * factor,
          position: "relative",
        }}
      >
        {element}
      </div>
    );

  if (props.maxWidth == null && props.maxHeight == null) return element;

  // The clip box is sized in unscaled sprite pixels, while the sprite itself is
  // drawn `factor` times larger. Snapping the factor can make the sprite a bit
  // bigger than before, so the box is scaled by the same amount to keep exactly
  // the same part of the picture visible.
  const clipScale = baseFactor ? factor / baseFactor : 1;
  const box = (v?: number) =>
    v == null ? undefined : Math.round(v * clipScale * pixelRatio) / pixelRatio;
  return (
    <div
      className="img-clip"
      style={{ maxWidth: box(props.maxWidth), maxHeight: box(props.maxHeight) }}
    >
      {element}
    </div>
  );
}

export function useStateAsync<T>(p: Promise<T>, initialValue?: T) {
  const [getter, setter] = useState(initialValue);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `state.count` is the store tick this hook re-reads on; `p.then` is a stable method reference.
  useEffect(() => {
    p.then((a) => {
      setter(a);
    });
  }, [state.count]);

  return getter;
}

/** One row of `MyTable`: the store key plus whatever the columns read */
export type MyTableRow = { key: string; [field: string]: unknown };

export function MyTable<T extends MyTableRow>(props: {
  className?: string;
  style?: CSSProperties;
  columns: {
    key: string;
    name?: string;
    cellClass?: string;
    renderCell?: (data: { row: T; column: any }) => ReactNode;
    maxWidth?: number;
    minWidth?: number;
  }[];
  rows: T[];
  rowClass?: (row: T) => string;
}) {
  return (
    <table className={props.className} style={props.style}>
      <thead>
        <tr>
          {props.columns.map((col) => (
            <td key={col.name}>{col.name}</td>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row) => (
          <tr key={row.key} className={props.rowClass ? props.rowClass(row) : ""}>
            {props.columns.map((column) => (
              <td key={column.key}>
                {column.renderCell
                  ? column.renderCell({ row, column })
                  : (row[column.key] as ReactNode)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type AnyRef = string | { type: string } | { id: string };

/** Normalizes a reference to the id it points to, if any */
export function fromAnyRef(href?: AnyRef) {
  if (href == null) return null;
  if (typeof href === "object") {
    const type = "type" in href ? href.type : undefined;
    const id = "id" in href ? href.id : undefined;
    return type ?? id ?? null;
  }
  return href === "" ? null : href;
}

export const Divider = (props: { vertical?: boolean }) =>
  props.vertical ? <br /> : <span className="list-divider">&nbsp;· </span>;

export const CogAnimation = (props: { size?: number }) => {
  const size = props.size ?? 100;
  return (
    <svg style={{ width: `${size}px`, height: `${size}px` }}>
      <g transform={`scale(${size / 100}) translate(50 50)`} id="g4">
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
  );
};

export function BaseService({ entry }: { entry: { [id: string]: AnyRef[] } }) {
  return (
    <table className="main-table base-service-table">
      <tbody>
        {Object.entries(entry)
          .sort((a, b) => (a[0] === "providedBy" ? -10 : 10) + (a[0] > b[0] ? 1 : -1))
          .map(
            (prop) =>
              !["id"].includes(prop[0]) && (
                <tr key={prop[0]}>
                  <td>
                    <Val of={prop[0]} capital={true} />
                  </td>
                  <td>
                    <Val of={prop[1]} />
                  </td>
                </tr>
              ),
          )}
      </tbody>
    </table>
  );
}

export function BaseServiceList({ items = null as string[] | null, vertical = false }) {
  if (!items?.length) return null;
  return (
    <>
      {items.map((item, i) => (
        <React.Fragment key={item}>
          {i === 0 ? "" : vertical ? <br /> : ", "}
          <Val of={item} />
        </React.Fragment>
      ))}
    </>
  );
}

export function Nobr(props: { children?: ReactNode }) {
  return <span className="nobr">{props.children}</span>;
}

/** Small-caps subheading row, follows old `Subheader.svelte` */
export function Subheader(props: { text: string }) {
  return (
    <tr>
      <td colSpan={2} className="table-subheader">
        <Val of={props.text} />
      </td>
    </tr>
  );
}

/** Rows of `SpecialBonus` values, follows old `RecoveryTable.svelte` */
export function RecoveryTable(props: { recovery?: { [stat: string]: BonusMap } }) {
  if (!props?.recovery) return null;

  return (
    <>
      {sortFirstLast(props.recovery).all.map(([field, bonus]) => (
        <tr key={field}>
          <td>
            <Val of={field} />
          </td>
          <td>
            <SpecialBonus bonus={bonus} />
          </td>
        </tr>
      ))}
    </>
  );
}

export function SecondaryTable(props: { text: string; children: JSX.Element }) {
  return (
    <>
      <tr>
        <td colSpan={2} className="table-subheader">
          <Val of={props.text} />
        </td>
      </tr>
      <tr>
        <td colSpan={2} className="secondary-table-td">
          {props.children}
        </td>
      </tr>
    </>
  );
}

export function AlterList(props: { items: AlterMap }) {
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
                    {rul.lang && `tip_${field}` in rul.lang && <sup className="tipmark">?</sup>}:
                  </span>

                  <Val of={props.items[field]} />

                  {rul.lang?.[`${field}_${props.items[field]}`] || ""}
                </Nobr>
              </React.Fragment>
            ))}
        </small>
      </td>
    </tr>
  );
}

/** One printed term: stat, weight, the kind of term, and its power when it is a polynomial coefficient */
type BonusTerm = [type: string, value: number, kind: string, power?: number];

export const SpecialBonus = ({ bonus, plus = false }: { bonus?: BonusMap; plus?: boolean }) => {
  const flat = useMemo(() => {
    if (!bonus) return [];

    let flat: BonusTerm[] = [];
    for (const type of Object.keys(bonus)) {
      const value = bonus[type];
      // A polynomial is a list of coefficients, printed as a sum of powers; a
      // plain weight is one term
      if (Array.isArray(value)) {
        for (let power = 0; power < value.length; power++) {
          const b = value[power];
          if (b !== 0) {
            flat.push([type, b, type, power + 1]);
          }
        }
      } else {
        if (value !== 0) flat.push([type, value, type]);
      }
    }
    flat = flat.sort((a, b) =>
      a[0] === "flatHundred" || a[0] === "flatOne" || a[0] < b[0] ? -1 : 1,
    );
    return flat;
  }, [bonus]);

  return (
    <>
      {flat.length > 0 && plus && "+"}
      {flat.map((b, i) => {
        const [type, value, kind, power = 1] = b;
        return (
          <span className="num" key={i}>
            {i !== 0 && " +"}
            {kind === "flatHundred" ? (
              value * 100
            ) : kind === "flatOne" ? (
              value
            ) : (
              <Nobr>
                <a href={`##${type}`}>{rul.tr(type, { icon: "compact" })}</a>
                {power === 1 ? "" : <sup>{power}</sup>}
                {value !== 1 && <em>×{value}</em>}
              </Nobr>
            )}
          </span>
        );
      })}
    </>
  );
};

/** Splits long lists into pages, following old PaginatedList.svelte */
export function PaginatedList<T>(props: {
  items: T[] | Set<T>;
  pageSize?: number;
  onePageMax?: number;
  /** Extra class on the wrapper; a table needs a block wrapper to scroll */
  className?: string;
  children: (items: T[]) => ReactNode;
}) {
  const items = props.items instanceof Set ? [...props.items] : (props.items ?? []);
  const pageSize = props.pageSize ?? 40;
  const onePageMax = props.onePageMax ?? 200;
  const pages = items.length <= onePageMax ? 1 : Math.ceil(items.length / pageSize);
  const [page, setPage] = useState(1);

  if (page > pages) setPage(1);

  const shown =
    items.length <= onePageMax ? items : items.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
      {pages > 1 && (
        <div className="dark-pagination-nav">
          {Array.from({ length: pages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 2)
            .map((p, i, shownPages) => (
              <React.Fragment key={p}>
                {i > 0 && shownPages[i - 1] !== p - 1 && <span> … </span>}
                <button
                  type="button"
                  className={`pagination-button${p === page ? " current" : ""}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              </React.Fragment>
            ))}
        </div>
      )}
      <span className={`links-list ${props.className ?? ""}`}>{props.children(shown)}</span>
    </>
  );
}

/**
 * Reveals a long list a batch at a time as it is scrolled to the end, instead
 * of splitting it into pages.
 *
 * A section table can hold thousands of rows (`##ITEMS` has over four thousand)
 * and every row renders its own cells, so building the whole table on each sort
 * or filter would block the page. The first batch is drawn immediately and the
 * next one is added once the end of the list comes into view: the page keeps
 * scrolling normally, no inner scroll box is involved, and what has been
 * revealed stays in the document for printing, searching and the browser's own
 * find.
 *
 * The end of the list is watched with a `scroll` listener in the capture phase
 * rather than an `IntersectionObserver`: the pedia scrolls inside `.content`,
 * not the window, and a capture listener sees the scroll of whichever ancestor
 * actually scrolls without having to guess it. `scroll` does not bubble, so
 * capturing is what makes one document-level listener enough.
 */
export function IncrementalList<T>(props: {
  items: T[];
  /** Rows drawn at once, and the number shown before the first scroll */
  batchSize?: number;
  /**
   * Restarts the list when it changes. A new sort order or filter is a
   * different list, so it must not inherit how far the old one was scrolled.
   */
  resetKey?: unknown;
  /** Extra class on the wrapper; a table needs a block wrapper to scroll */
  className?: string;
  children: (items: T[]) => ReactNode;
}) {
  const items = props.items ?? [];
  const batchSize = props.batchSize ?? 100;
  const [count, setCount] = useState(batchSize);
  const sentinel = useRef<HTMLSpanElement>(null);

  // Derived from the prop rather than synced in an effect: the list must be cut
  // back to the first batch on the same render the sort changes, or the browser
  // briefly lays out the old number of rows
  const lastResetKey = useRef(props.resetKey);
  if (lastResetKey.current !== props.resetKey) {
    lastResetKey.current = props.resetKey;
    setCount(batchSize);
  }

  const more = items.length > count;

  // Printing wants the whole list on paper, not just what has been scrolled to
  useEffect(() => {
    const all = () => setCount(items.length);
    addEventListener("beforeprint", all);
    return () => removeEventListener("beforeprint", all);
  }, [items.length]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `count` is the trigger, so a grown batch is checked again even when `more` stays true.
  useEffect(() => {
    if (!more) return;
    const atEnd = (e?: Event) => {
      // A scroll far from the end of the scroller cannot have revealed the
      // marker, and saying so from the scroll position alone avoids measuring
      // a huge table on every wheel tick
      const scroller = e?.target instanceof Element ? e.target : null;
      if (scroller && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 200)
        return;
      const box = sentinel.current?.getBoundingClientRect();
      // The margin starts the next batch slightly before its marker is on
      // screen, so the list does not visibly stall while rows are appended
      if (box && box.top <= innerHeight + 200) setCount((c) => c + batchSize);
    };
    // `more` and `count` changes re-run this, which checks again: a batch that
    // still leaves the marker in view (a short list, a tall window) keeps adding
    // until it is out of view
    atEnd();
    document.addEventListener("scroll", atEnd, true);
    addEventListener("resize", atEnd);
    return () => {
      document.removeEventListener("scroll", atEnd, true);
      removeEventListener("resize", atEnd);
    };
  }, [more, count, batchSize]);

  return (
    <span className={`links-list ${props.className ?? ""}`}>
      {props.children(items.slice(0, count))}
      {/* Zero height and empty, so it neither adds a line nor widens the
          shrink-to-fit wrapper around a wide table */}
      {more && <span className="incremental-sentinel" ref={sentinel} aria-hidden="true"></span>}
    </span>
  );
}

/** A page that is just a list of links, e.g. a section's article list */
export function LinksPage(props: {
  links?: AnyRef[];
  cols?: number | false;
  /** Heading of the page, a language key drawn through `Val` */
  title?: unknown;
  /**
   * The links are already in the order `<`/`>` navigation walks, so they must
   * not be sorted again. A section page passes its cached list; sorting it a
   * second time cost a full `localeCompare` pass over 2904 entries on every
   * render of `RESEARCH`.
   */
  preSorted?: boolean;
}) {
  const links = props.links ?? [];
  if (!links.length) return null;

  // Sorting is controlled by the single `A-Z` button in the top navbar.
  //
  // The order has to match the one `<`/`>` navigation walks, or the list shows
  // names in one sequence while the arrows step through them in another (they
  // did: 34 of 57 sections disagreed, because this sorted on a plain `>` while
  // navigation used the numeric, accent-insensitive `comparator`). A category's
  // link list still needs sorting, so it goes through the same
  // `sortStringsAndNumbers` the navigator uses.
  let items = links;
  if (state.alphabeticalSort && !props.preSorted) {
    const ids = links.map((link) => fromAnyRef(link) ?? "");
    const sortedIds = rul.sortStringsAndNumbers(ids);
    // Rebuild the caller's refs in the new order, keeping the original entry for
    // each id so a link keeps whatever form the caller passed in. A list can
    // repeat an id, so entries are consumed rather than looked up twice.
    const byId = new Map<string, AnyRef[]>();
    links.forEach((link, i) => {
      const id = ids[i];
      const list = byId.get(id);
      if (list) list.push(link);
      else byId.set(id, [link]);
    });
    items = sortedIds.map((id) => {
      const shifted = byId.get(id)?.shift();
      if (shifted === undefined) throw new Error(`LinksPage: no link left for ${id}`);
      return shifted;
    });
  }

  return (
    <>
      {props.title != null && (
        <div className="links-page-header">
          <Val of={props.title} />
        </div>
      )}
      {props.cols ? (
        <div className="links-page">
          <div className="cols" style={{ columns: props.cols }}>
            <ol>
              {items.map((option, i) => (
                <li key={i}>
                  <Val of={option} />
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <PaginatedList items={items} pageSize={600}>
          {(shown) =>
            shown.map((item, i) => (
              <React.Fragment key={i}>
                {i !== 0 && <Divider />}
                <Val of={item} />
              </React.Fragment>
            ))
          }
        </PaginatedList>
      )}
    </>
  );
}

/**
 * A row of `SectionTable`: an entry, or an attack, which are sorted and filtered
 * through the same `sortField` protocol.
 */
export type SectionRow = {
  sortField(field: string, filter?: string | boolean): unknown;
  /** A commendation's value as a stage range, see `Entry.range` */
  cellValue?(field: string): unknown;
  /** Columns are read by name, whichever the ruleset declared */
  [field: string]: any;
};

export interface SectionTableProps {
  /** Id of the article that shows this table, used to persist column layout */
  aId?: string;
  entries: SectionRow[];
  fields: string[];
  extraFields?: string[];
  /** Field name -> options the reader can pick; `"auto"` is filled in from the rows */
  filters?: { [key: string]: string[] };
}

/** Table of entries with selectable/sortable columns, follows old SectionTable.svelte */
export function SectionTable(props: SectionTableProps) {
  const entries = props.entries ?? [];
  const storageKey = `xpediaColumnOrder${props.aId ?? ""}`;
  const fields = [...(props.fields ?? [])];
  const extraFields = (props.extraFields ?? []).filter((f) => !fields.includes(f));

  // The layout is stored as plain JSON written by this component itself, so it
  // is read back as a bag of unknown values and checked as each one is used
  let saved: { [key: string]: unknown } = {};
  try {
    saved = JSON.parse(localStorage[storageKey] ?? "null") ?? {};
  } catch {
    saved = {};
  }

  const allFields = (saved.allFields as string[] | undefined) ?? ["id", ...fields];
  const [shownFields, setShownFields] = useState<string[]>(allFields);
  const [filtersSelected, setFiltersSelected] = useState<{ [key: string]: string }>(
    (saved.filtersSelected as { [key: string]: string } | undefined) ?? {},
  );
  const [sortField, setSortField] = useState<string | undefined>(
    saved.sortField as string | undefined,
  );
  const [sortDescending, setSortDescending] = useState<boolean>(
    (saved.sortDescending as boolean | undefined) ?? false,
  );
  const [filterId, setFilterId] = useState("");

  // "auto" filter options are filled in from the entries themselves
  const filters: { [key: string]: string[] } = {};
  for (const [key, options] of Object.entries(props.filters ?? {})) {
    filters[key] = [...options];
    const autoAt = filters[key].indexOf("auto");
    if (autoAt !== -1) {
      // The values are printed as options and compared with the selection, so a
      // number from the ruleset (an inventory size) is used as its text
      const values = allFieldValuesOf(entries, key)
        .map((v) => String(v))
        .sort();
      if (values.length > 0) filters[key].splice(autoAt, 1, ...values);
    }
  }

  useEffect(() => {
    localStorage[storageKey] = JSON.stringify({
      allFields: shownFields,
      filtersSelected,
      sortField,
      sortDescending,
    });
  }, [storageKey, shownFields, filtersSelected, sortField, sortDescending]);

  let sorted = [...entries];
  for (const k in filtersSelected) {
    if (filtersSelected[k] != null)
      sorted = sorted.filter((a) => {
        if (filtersSelected[k] === "any") return true;
        const v = a.sortField(k, filtersSelected[k]);
        return (
          v === true ||
          v === filtersSelected[k] ||
          (Array.isArray(v) && v.includes(filtersSelected[k]))
        );
      });
  }
  if (filterId.length > 0)
    sorted = sorted.filter((a) => String(a.sortField("id")).toLowerCase().match(filterId));

  if (sortField) {
    const nullValue = sortDescending ? Number.MIN_VALUE : Number.MAX_VALUE;
    sorted = sorted.sort((a, b) =>
      (a.sortField(sortField) ?? nullValue) > (b.sortField(sortField) ?? nullValue) ===
      sortDescending
        ? -1
        : 1,
    );
  }

  function sortBy(field: string) {
    if (field !== sortField) {
      setSortField(field);
      setSortDescending(field !== "id");
    } else {
      setSortDescending(!sortDescending);
    }
  }

  function toggleField(field: string) {
    setShownFields(
      shownFields.includes(field)
        ? shownFields.filter((f) => f !== field)
        : [...shownFields, field],
    );
  }

  const extraAll = [...fields, ...extraFields];

  // "id" is not one of the listed columns, but it is always shown: it names the
  // row, and the buttons below only act on the columns the user can see
  function showAll() {
    setShownFields(["id", ...extraAll]);
  }
  function showNone() {
    setShownFields(["id"]);
  }
  // The layout a table has before anything is saved
  function showDefault() {
    setShownFields(["id", ...fields]);
  }

  return (
    <>
      <div className="extra-fields">
        <span className="column-buttons">
          <button type="button" onClick={showAll}>
            <Val of="xpediaColumnsAll" />
          </button>
          <button type="button" onClick={showNone}>
            <Val of="xpediaColumnsNone" />
          </button>
          <button type="button" onClick={showDefault}>
            <Val of="xpediaColumnsDefault" />
          </button>
        </span>
        {extraAll.map((field) => {
          const shown = shownFields.includes(field);
          // A field whose name has its own article is rendered by `Val` as a link,
          // and clicking it must keep navigating there. The checkbox is then the
          // only way to toggle without leaving the table, which is also why it is
          // drawn at all: it says what the list does. Fields without an article
          // have no link to follow, so their names still toggle on click.
          const isLink = !!rul.article(field);
          return (
            <React.Fragment key={field}>
              <Divider />
              <span className={`extra-field ${shown ? "on" : "off"}`}>
                <input
                  type="checkbox"
                  checked={shown}
                  aria-label={rul.tr(field) ?? undefined}
                  onChange={() => toggleField(field)}
                />
                <span
                  className={isLink ? "extra-field-name" : "extra-field-name clickable"}
                  onClick={isLink ? undefined : () => toggleField(field)}
                >
                  <Val of={field} />
                </span>
              </span>
            </React.Fragment>
          );
        })}
      </div>
      <div className="table-filters">
        {Object.entries(filters).map(([filter, options]) => (
          <React.Fragment key={filter}>
            <Val of={filter} />:
            <select
              value={filtersSelected[filter] ?? ""}
              onChange={(e) => setFiltersSelected({ ...filtersSelected, [filter]: e.target.value })}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {rul.tr(option)}
                </option>
              ))}
            </select>
          </React.Fragment>
        ))}
        <input
          value={filterId}
          onChange={(e) => setFilterId(e.target.value)}
          type="text"
          placeholder={rul.tr("Filter...") ?? ""}
        />
      </div>
      <IncrementalList
        items={sorted}
        className="table-list"
        // A batch is bounded by the number of cells it builds, not just by rows:
        // with every column shown a single row is over a hundred cells, and a
        // hundred such rows would block the page for seconds. Fewer rows per batch
        // keeps each append short and costs nothing while there are few columns.
        batchSize={Math.max(4, Math.min(100, Math.round(600 / Math.max(1, shownFields.length))))}
        // Sorting or filtering changes which rows there are, so the list starts
        // over from its first batch. So does the number of columns: revealing a
        // long list and then showing every column at once would otherwise have to
        // rebuild all of those rows at once, which is exactly the stall the batch
        // exists to avoid. Reordering the same columns keeps the reveal, since it
        // does not change how much there is to draw.
        resetKey={JSON.stringify([
          filtersSelected,
          filterId,
          sortField,
          sortDescending,
          shownFields.length,
        ])}
      >
        {(visibleRows) => (
          <table className="section-table">
            <thead>
              <tr>
                {shownFields.map((field) => (
                  <td
                    key={field}
                    id={`thead ${field}`}
                    draggable="true"
                    onDragStart={(e) => e.dataTransfer.setData("field", field)}
                    onDrop={(e) =>
                      moveField(shownFields, field, e.dataTransfer.getData("field"), setShownFields)
                    }
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onClick={() => sortBy(field)}
                  >
                    {/* Keeps the label centred whether or not an arrow shows, the
                      same placeholder the old `SectionTable` used */}
                    <span className="sort-order-arrow invisible">&#9660;</span>
                    <Tr text={field} />
                    <span className="sort-order-arrow">
                      {sortField !== field ? (
                        <span className="invisible">&#9660;</span>
                      ) : sortDescending ? (
                        "▼"
                      ) : (
                        "▲"
                      )}
                    </span>
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((entry, i) => (
                <tr key={String(entry.sortField("id", true) ?? i)}>
                  {shownFields.map((field) => (
                    <td key={field} className={`st-${field}`}>
                      <Val
                        of={entry.cellValue?.(field) ?? entry.sortField(field, true)}
                        nobr={20}
                        field={field}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </IncrementalList>
    </>
  );
}

/** Moves a column so that it appears right after another one */
function moveField(
  shownFields: string[],
  after: string,
  field: string,
  setShownFields: (v: string[]) => void,
) {
  const fi = shownFields.indexOf(field);
  if (fi === -1) return;
  const next = shownFields.filter((f) => f !== field);
  let ai = next.indexOf(after);
  if (ai === -1) ai = 0;
  else ai++;
  next.splice(ai, 0, field);
  setShownFields(next);
}
