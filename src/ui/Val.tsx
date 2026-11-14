import { FC, Fragment } from "react";
import { rul } from "../rul/Ruleset";
import { state } from "../state";
import { ValueRange } from "../rul/Entry";
import { Divider, fromAnyRef, Img } from "./components";

/** Polymorphic value view */

export type IconType = "monospace" | "simple" | "none" | null;

/** Number as the tables print it: the mod's own locale, dot decimal separator */
export function formatNumber(val: any) {
  return Number(val).toLocaleString('ru-RU', { maximumFractionDigits: 4 }).replace(",", ".");
}

export const Val = ({
  of: val = null as any,
  children = null as any,
  /**obs sprite */
  obs = null as string | null,
  /** Maximum depth */
  depth = 4,
  notip = false,
  capital = false,
  nobr = 30 as number | boolean,
  icon = undefined as IconType | undefined,
  className = undefined as string | undefined,
  table = undefined as boolean | undefined,
  sorted = false,
  vertical = undefined as boolean | undefined,
  /** Name of the field the value belongs to, needed for a few special fields */
  field = undefined as string | undefined,
  /** Prefix to be inlcuded in text/link */
  prefix = undefined as string | undefined,
  /** Postfix to be inlcuded in text/link */
  postfix = undefined as string | undefined
}) => {

  if (!rul) {
    return val;
  }

  //Too deep
  if (depth === 0) {
    return <span>...</span>;
  }

  // Primitive: nulll
  if (val == null) {
    return <span>‒</span>;
  }

  // Primitive: boolean
  if (val === true || val === false) {
    return (
      <span style={{ color: val ? 'lime' : 'red' }}>
        <Tr text={val.toString()} />
      </span>
    );
  }

  if (obs) {
    return <Img src={rul.obsSprite(obs, val)} alt={val} />;
  }

  // Map markers are cells of the `GlobeMarkers` sheet, see Ruleset.globeMarker.
  // Checked before numbers, markers themselves are numeric indices. A pack
  // without the sheet, or a number past its end, keeps showing the number.
  if (field && ["marker", "markerCrash", "markerLand", "markerIcon"].includes(field)) {
    let marker = rul.globeMarker(val);
    // The sprite is drawn twice the size, as the old globe view did
    if (marker)
      return <Img src={marker.path} frame={marker} scale={2} alt={`marker ${val}`} />;
  }

  // Primitive: number. Empty strings are checked so they don't render as 0
  if (val !== "" && !Array.isArray(val) && !isNaN(Number(val))) {
    return <em className="num">{formatNumber(val)}</em>;
  }
  // A value that changes over a commendation's stages: `first..last`
  if (val instanceof ValueRange) {
    return <span className="value-range">
      <em className="num">{formatNumber(val.first)}</em>
      <span className="value-range-separator">..</span>
      <em className="num">{formatNumber(val.last)}</em>
    </span>;
  }

  // It should be an entry, passed by direct link or id. Converting it to id
  let id = fromAnyRef(val);

  function tr1(text: string) {
    return <Tr text={text} icon={icon} nobr={nobr} notip={notip} capital={capital} prefix={prefix} postfix={postfix} />
  }

  if (id && rul.article(id)) {
    return <a href={'##' + id}>{tr1(children ?? id)}</a>;
  }

  if (id && rul.hasSprite(id)) {
    return <Img src={id} />;
  }

  // Plain text, or a reference that has no article/sprite behind it
  if (typeof val == "string")
    return tr1(val);

  // Array/object case
  if (Array.isArray(val) || val instanceof Set || val instanceof Object) {
    return <LinksList items={val} depth={depth - 1} className={className} table={table} sorted={sorted} vertical={vertical} />;
  }

  return null;
}

/**Translate text if possible add the emoji icon to it. For internal use by Val only */
/** Compares two label strings ignoring markup, case and spacing */
function sameText(a: string, b: string) {
  let norm = (s: string) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) == norm(b);
}

export function Tr({
  text = undefined as string | undefined,
  icon = undefined as IconType | undefined,
  nobr = 30 as number | boolean,
  notip = false,
  capital = false,
  prefix = undefined as string | undefined,
  postfix = undefined as string | undefined
}) {
  if (text == null)
    return null;

  // Before any mod pack is loaded there is no ruleset to translate through, so
  // fall back to the raw key rather than crashing the whole UI
  if (!rul) {
    let raw = `${prefix ?? ""}${text}${postfix ?? ""}`;
    return <span className="nobr">{raw}</span>;
  }

  // Raw keys are shown when the ruleset is in "revealed" mode
  let valtr = state.revealed ? text : rul.tr(text, { capital });

  if (valtr == null)
    return null;

  // Icon and label are compared without the prefix/postfix decoration
  let iconText = state.revealed ? null : rul.icon(text);
  // The `icon` language file often repeats the very same label, skip it then
  if (iconText && sameText(iconText, valtr))
    iconText = null;

  valtr = `${prefix ?? ""}${valtr}${postfix ?? ""}`;

  let element: any = valtr;

  if (iconText) {
    if (icon == "monospace")
      element = <><div className='monospace-emoji-icon'>{iconText}</div>{element}</>
    else if (icon == "simple")
      element = <>{iconText}{element}</>
    else if (icon != "none")
      element = <><div className='emoji-icon'>{iconText}</div>{element}</>
  }

  // The icon and the label are one unit: `Tr` never splits across lines.
  // Old `Ruleset.tr` measured the *translated* string, not the language key: a
  // short key such as `STR_SNAKEMAN_COMMANDER_CORPSE` can translate into a much
  // wider label, and measuring the key would keep that label on one line.
  let plainLabel = String(valtr).replace(/<[^>]*>/g, "");
  element = <span className={nobr === true || plainLabel.length <= (nobr as number) ? "nobr" : ""}>{element}</span>;

  if (!notip && text && ('tip_' + text) in rul.lang) {
    element = <span data-tooltip={'tip_' + text}>{element}<sup className="tipmark">?</sup></span>;
  }

  return element;
}

interface LinksListProps {
  items: any;
  cols?: number;
  vertical?: boolean;
  numberTable?: boolean;
  depth?: number;
  sorted?: boolean;
  table?: boolean;
  className?: string
}

const alphabeticLocalizedSorter = (a: string[]) => rul.sortStrings(a)
const noSorter = (a: string[]) => a

/** Renders lists and objects of references as links, follows old LinksList.svelte */
const LinksList: FC<LinksListProps> = ({
  items: initialItems,
  cols = 0,
  vertical = false,
  numberTable = false,
  depth = 2,
  table = undefined,
  className = "",
  sorted: initialSorted
}) => {
  if (initialItems == null) {
    return <>{rul.tr("NULL")}</>;
  }
  if (depth === 0) {
    return <span>...</span>;
  }

  let items = initialItems instanceof Set ? [...initialItems] : initialItems;
  let isArray = Array.isArray(items);
  let keys = isArray ? items : Object.keys(items);

  let sorted = initialSorted ?? keys.length > 9;
  if (sorted) {
    keys = isArray ? alphabeticLocalizedSorter(keys) : alphabeticLocalizedSorter(keys);
  } else {
    keys = noSorter(keys);
  }

  if (cols) {
    return <div className={"cols " + className} style={{ columns: cols }}>
      {keys.map((field: any) =>
        <div key={field}><a href={"##" + field} className={rul.article(field) ? undefined : "dead"}>{rul.tr(field)}</a></div>
      )}
    </div>;
  }

  if (numberTable) {
    return <table className={"number-table " + className}>
      <tbody>
        {Object.keys(items).sort().map(field =>
          <tr key={field}>
            <td><Val of={field} /></td>
            <td><em><Val of={items[field]} /></em></td>
          </tr>
        )}
      </tbody>
    </table>;
  }

  // Objects holding further objects need one block per key to stay readable
  if (!isArray && Object.values(items).some(a => typeof a == "object")) {
    return <>
      {keys.map((subfield: any, j: number) =>
        <div key={subfield} className={j > 0 ? "top-border" : undefined}>
          <Val of={subfield} depth={depth - 1} /> :
          <div className="sublist">
            <Val of={items[subfield]} depth={depth - 1} />
          </div>
        </div>
      )}
    </>;
  }

  if (table) {
    return (
      <table className={"properties-table " + className}>
        <tbody>
          {keys.map((field: any) => {
            let cells = isArray ? (Array.isArray(field) ? field : [field]) : [field, items[field]];
            return (
              <tr key={isArray ? String(field) : field}>
                {cells.map((v: any, i: number) => <td key={i}><Val of={v} depth={depth - 1} /></td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  // Object of plain values: show the value, then the key as a reference
  if (!isArray && keys.length > 0 && !table) {
    return <span className={"links-list " + className}>
      {keys.map((field: any, i: number) =>
        <Fragment key={field}>
          {i !== 0 && <Divider vertical={vertical} />}
          <Val of={items[field]} depth={depth - 1} /> <Val of={field} depth={depth - 1} />
        </Fragment>
      )}
    </span>;
  }

  return (
    <span className={"links-list " + className}>
      {keys.map((item: any, i: number) =>
        Array.isArray(item)
          ? <div key={i} className="sublist">
            <LinksList items={item} depth={depth - 1} />
          </div>
          : <Fragment key={i}>
            {i !== 0 && <Divider vertical={vertical} />}
            <Val of={item?.type || item} depth={depth - 1} />
          </Fragment>
      )}
    </span>
  );
};