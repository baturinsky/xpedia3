import { createContext, type FC, Fragment, type ReactNode, useContext } from "react";
import { ValueRange } from "../rul/Entry";
import { rul } from "../rul/Ruleset";
import { state } from "../state";
import { MusicRef, SoundRef } from "./Audio";
import { type AnyRef, Divider, fromAnyRef, Img } from "./components";

/**
 * The semantic type of the object currently being drawn: a collection name
 * at article level (`items`, `armors`, …), or a nested object's kind inside
 * a special renderer (`mapBlock`, `mapScriptCommand`, …).
 *
 * A tooltip is looked up by field name, but the same name means different
 * things on different objects — `width` is a block's size in battlescape
 * grid units, a deployment's map extent, a sprite's pixels. Carrying the
 * scope as context lets `Tr` pick `tip_<field>__<scope>` where one exists
 * and fall back to `tip_<field>` elsewhere, without threading a prop
 * through every renderer and list. A provider that is given no scope
 * renders no provider at all, so a nested plain node keeps the scope of
 * the article around it instead of losing it.
 */
export const TipScopeContext = createContext<string | undefined>(undefined);

/** Gives every `Val` underneath this scope's naming for its tooltips */
export function TipScopeProvider({
  scope,
  children,
}: {
  scope: string | undefined;
  children: ReactNode;
}): ReactNode {
  if (scope == null) return <>{children}</>;
  return <TipScopeContext.Provider value={scope}>{children}</TipScopeContext.Provider>;
}

/**
 * The `tip_` language key a field's tooltip reads under a scope: the scoped
 * key when the language has one, otherwise the plain field key. The plain
 * key is never absent where a tooltip exists at all, so a scope that names
 * nothing and a language that translates nothing behave as before.
 */
export function tipKeyFor(text: string, scope: string | undefined): string {
  const scoped = scope != null ? `tip_${text}__${scope}` : undefined;
  return scoped != null && rul != null && scoped in rul.lang ? scoped : `tip_${text}`;
}

/** Polymorphic value view */

export type IconType = "monospace" | "simple" | "none" | null;

/** Number as the tables print it: the mod's own locale, dot decimal separator */
export function formatNumber(val: unknown) {
  return Number(val).toLocaleString("ru-RU", { maximumFractionDigits: 4 }).replace(",", ".");
}

/**
 * A chance as the tables print it: a formatted number with its per cent sign.
 *
 * The one path for every percent in the renderers. `Val` formats a number but
 * does not add the sign, so callers that typed `%` themselves ended up with
 * three spellings of the same thing — `<Val/>%`, `<em>{n}%</em>`, and a bare
 * `String` — and one of them skipped locale formatting. A field that *is* a
 * chance (`globalChance`, `*Percentage`) gets the sign from `Val` itself via
 * its field name, so those can go through `Val of={v} field={field}` instead.
 */
export function Percent({ value, field }: { value: unknown; field?: string }) {
  return (
    <>
      <Val of={value} field={field} />%
    </>
  );
}

export const Val = ({
  of: val = null as unknown,
  children = null as unknown,
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
  /** Collection of the entry the value belongs to, needed by sound slots, which
   *  are numbered per CAT file and the CAT depends on the entry type */
  collection = undefined as string | undefined,
  /** Prefix to be inlcuded in text/link */
  prefix = undefined as string | undefined,
  /** Postfix to be inlcuded in text/link */
  postfix = undefined as string | undefined,
}) => {
  if (!rul) {
    return val as ReactNode;
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
      <span style={{ color: val ? "lime" : "red" }}>
        <Tr text={val.toString()} />
      </span>
    );
  }

  if (obs) {
    return <Img src={rul.obsSprite(obs, Number(val))} alt={String(val)} />;
  }

  // Map markers are cells of the `GlobeMarkers` sheet, see Ruleset.globeMarker.
  // Checked before numbers, markers themselves are numeric indices. A pack
  // without the sheet, or a number past its end, keeps showing the number.
  if (field && ["marker", "markerCrash", "markerLand", "markerIcon"].includes(field)) {
    const marker = rul.globeMarker(Number(val));
    // The sprite is drawn twice the size, as the old globe view did
    if (marker) return <Img src={marker.path} frame={marker} scale={2} alt={`marker ${val}`} />;
  }

  // Sound slots and music ids are not references: the file behind them is more
  // use than the number, so these are resolved before the number branch. Both
  // fields are checked by name, and both may hold a single value or a list.
  if (field && collection && /Sound$/.test(field))
    return <SoundRef value={val} field={field} collection={collection} />;

  if (field === "music") {
    const ids = (Array.isArray(val) ? val : [val])
      .map((v) => (typeof v === "string" ? v : v?.id))
      .filter((v) => v != null && v !== "");
    if (ids.length)
      return (
        <>
          {ids.map((musicId, i) => (
            <Fragment key={musicId}>
              {i > 0 && <span className="list-divider">&nbsp;· </span>}
              <MusicRef entry={musicId} />
            </Fragment>
          ))}
        </>
      );
  }

  // Primitive: number. Empty strings are checked so they don't render as 0
  if (val !== "" && !Array.isArray(val) && !Number.isNaN(Number(val))) {
    // A chance field is a per cent: the number alone does not say so, and the
    // old renderers each remembered to add the sign (or forgot to, leaving
    // `globalChance` as a bare number). The sign comes from the field name
    // here, so every chance reads the same way wherever it is drawn.
    const suffix =
      field != null && (/(Chance|Percentage)$/.test(field) || field === "executionOdds") ? "%" : "";
    return (
      <>
        <em className="num">{formatNumber(val)}</em>
        {suffix}
      </>
    );
  }
  // A value that changes over a commendation's stages: `first..last`
  if (val instanceof ValueRange) {
    return (
      <span className="value-range">
        <em className="num">{formatNumber(val.first)}</em>
        <span className="value-range-separator">..</span>
        <em className="num">{formatNumber(val.last)}</em>
      </span>
    );
  }

  // It should be an entry, passed by direct link or id. Converting it to id
  const id = fromAnyRef(val as AnyRef);

  function tr1(text: string) {
    return (
      <Tr
        text={text}
        icon={icon}
        nobr={nobr}
        notip={notip}
        capital={capital}
        prefix={prefix}
        postfix={postfix}
      />
    );
  }

  if (id && rul.article(id)) {
    // A reference to the page being read. Two collections can share an id (a
    // craft and its research entry, a terrain and its map script, ...): they are
    // different entries on one article, so the reference is real and stays, but
    // the link would only reload this same page, so it is kept as text. The
    // marker and tooltip say why it is not a link.
    if (state.article && state.article.id === id) {
      const label = (
        <Tr
          text={(children ?? id) as string}
          icon={icon}
          nobr={nobr}
          notip
          capital={capital}
          prefix={prefix}
          postfix={postfix}
        />
      );
      return (
        <span className="self-ref" data-tooltip="tip_selfRef">
          {label}
          <sup className="self-ref-mark">⊙</sup>
        </span>
      );
    }
    return <a href={`##${id}`}>{tr1((children ?? id) as string)}</a>;
  }

  if (id && rul.hasSprite(id)) {
    return <Img src={id} />;
  }

  // Plain text, or a reference that has no article/sprite behind it
  if (typeof val === "string") return tr1(val);

  // Array/object case
  if (Array.isArray(val) || val instanceof Set || val instanceof Object) {
    return (
      <LinksList
        items={val}
        depth={depth - 1}
        className={className}
        table={table}
        sorted={sorted}
        vertical={vertical}
      />
    );
  }

  return null;
};

/**Translate text if possible add the emoji icon to it. For internal use by Val only */
/** Compares two label strings ignoring markup, case and spacing */
function sameText(a: string, b: string) {
  const norm = (s: string) =>
    String(s ?? "")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  return norm(a) === norm(b);
}

export function Tr({
  text = undefined as string | undefined,
  icon = undefined as IconType | undefined,
  nobr = 30 as number | boolean,
  notip = false,
  capital = false,
  prefix = undefined as string | undefined,
  postfix = undefined as string | undefined,
}) {
  const scope = useContext(TipScopeContext);

  if (text == null) return null;

  // Before any mod pack is loaded there is no ruleset to translate through, so
  // fall back to the raw key rather than crashing the whole UI
  if (!rul) {
    const raw = `${prefix ?? ""}${text}${postfix ?? ""}`;
    return <span className="nobr">{raw}</span>;
  }

  // Raw keys are shown when the ruleset is in "revealed" mode
  let valtr = state.revealed ? text : rul.tr(text, { capital });

  if (valtr == null) return null;

  // Icon and label are compared without the prefix/postfix decoration
  let iconText = state.revealed ? null : rul.icon(text);
  // The `icon` language file often repeats the very same label, skip it then
  if (iconText && sameText(iconText, valtr)) iconText = null;

  valtr = `${prefix ?? ""}${valtr}${postfix ?? ""}`;

  let element: ReactNode = valtr;

  if (iconText) {
    if (icon === "monospace")
      element = (
        <>
          <div className="monospace-emoji-icon">{iconText}</div>
          {element}
        </>
      );
    else if (icon === "simple")
      element = (
        <>
          {iconText}
          {element}
        </>
      );
    else if (icon !== "none")
      element = (
        <>
          <div className="emoji-icon">{iconText}</div>
          {element}
        </>
      );
  }

  // The icon and the label are one unit: `Tr` never splits across lines.
  // Old `Ruleset.tr` measured the *translated* string, not the language key: a
  // short key such as `STR_SNAKEMAN_COMMANDER_CORPSE` can translate into a much
  // wider label, and measuring the key would keep that label on one line.
  const plainLabel = String(valtr).replace(/<[^>]*>/g, "");
  element = (
    <span className={nobr === true || plainLabel.length <= (nobr as number) ? "nobr" : ""}>
      {element}
    </span>
  );

  const tipKey = text != null ? tipKeyFor(text, scope) : undefined;
  if (!notip && tipKey != null && tipKey in rul.lang) {
    element = (
      <span data-tooltip={tipKey}>
        {element}
        <sup className="tipmark">?</sup>
      </span>
    );
  }

  return element;
}

interface LinksListProps {
  /**
   * A list or a map of ruleset values, of whatever shape the pack declared: an
   * array, a set, or an object whose keys are the references. The value itself is
   * inspected to decide how to draw it, so it has no type beyond "some JSON node".
   */
  items: unknown;
  cols?: number;
  vertical?: boolean;
  numberTable?: boolean;
  depth?: number;
  sorted?: boolean;
  table?: boolean;
  className?: string;
}

/** Renders lists and objects of references as links, follows old LinksList.svelte */
const LinksList: FC<LinksListProps> = ({
  items: initialItems,
  cols = 0,
  vertical = false,
  numberTable = false,
  depth = 2,
  table = undefined,
  className = "",
  sorted: initialSorted,
}) => {
  if (initialItems == null) {
    return <>{rul.tr("NULL")}</>;
  }
  if (depth === 0) {
    return <span>...</span>;
  }

  const items = initialItems instanceof Set ? [...initialItems] : initialItems;
  const isArray = Array.isArray(items);
  const record = items as { [key: string]: unknown };
  let keys: unknown[] = isArray ? (items as unknown[]) : Object.keys(record);

  // Long lists are sorted unless the caller says otherwise. `keys` holds either
  // the values themselves or an object's keys, and the sorter returns their order
  // as a new list, so it replaces them rather than being called on each use.
  if (initialSorted ?? keys.length > 9) keys = rul.sortStringsAndNumbers(keys as string[]);

  if (cols) {
    return (
      <div className={`cols ${className}`} style={{ columns: cols }}>
        {keys.map((field) => (
          <div key={field as string}>
            {state.article && state.article.id === field ? (
              <span className="self-ref" data-tooltip="tip_selfRef">
                <Tr text={field as string} notip />
                <sup className="self-ref-mark">⊙</sup>
              </span>
            ) : (
              <a
                href={`##${field as string}`}
                className={rul.article(field as string) ? undefined : "dead"}
              >
                <Tr text={field as string} />
              </a>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (numberTable) {
    return (
      <table className={`number-table ${className}`}>
        <tbody>
          {rul.sortStringsAndNumbers(Object.keys(record)).map((field) => (
            <tr key={field}>
              <td>
                <Val of={field} />
              </td>
              <td>
                <em>
                  <Val of={record[field]} />
                </em>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Objects holding further objects need one block per key to stay readable
  if (!isArray && Object.values(record).some((a) => typeof a === "object")) {
    return (
      <>
        {keys.map((subfield, j) => (
          <div key={subfield as string} className={j > 0 ? "top-border" : undefined}>
            <Val of={subfield} depth={depth - 1} /> :
            <div className="sublist">
              <Val of={record[subfield as string]} depth={depth - 1} />
            </div>
          </div>
        ))}
      </>
    );
  }

  if (table) {
    return (
      <table className={`properties-table ${className}`}>
        <tbody>
          {keys.map((field) => {
            const cells = isArray
              ? Array.isArray(field)
                ? field
                : [field]
              : [field, record[field as string]];
            return (
              <tr key={String(field)}>
                {cells.map((v, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the cells are the fixed columns of one table row; their values are display text and can repeat within a row
                  <td key={i}>
                    <Val of={v} depth={depth - 1} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  // Object of plain values: show the value, then the key as a reference
  if (!isArray && keys.length > 0 && !table) {
    return (
      <span className={`links-list ${className}`}>
        {keys.map((field, i) => (
          <Fragment key={field as string}>
            {i !== 0 && <Divider vertical={vertical} />}
            <Val of={field} depth={depth - 1} />{" "}
            <Val of={record[field as string]} field={field as string} depth={depth - 1} />
          </Fragment>
        ))}
      </span>
    );
  }

  return (
    <span className={`links-list ${className}`}>
      {keys.map((item, i) =>
        Array.isArray(item) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a ruleset reference list; items carry no id and the same reference can appear twice
          <div key={i} className="sublist">
            <LinksList items={item} depth={depth - 1} />
          </div>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a ruleset reference list; items carry no id and the same reference can appear twice
          <Fragment key={i}>
            {i !== 0 && <Divider vertical={vertical} />}
            <Val
              of={(item as { type?: unknown } | null | undefined)?.type || item}
              depth={depth - 1}
            />
          </Fragment>
        ),
      )}
    </span>
  );
};
