import { FC, Fragment } from "react";
import { rul } from "../rul/Ruleset";
import { Divider, fromAnyRef, Img } from "./components";

/** Polymorphic value view */

export type IconType = "monospace" | "simple" | "none" | null;

export const Val = ({
  of: val = null as any,
  children = null as any,
  /**obs sprite */
  obs = null as string | null,
  /** Maximum depth */
  depth = 3,
  notip = false,
  nobr = 30,
  icon = undefined as IconType | undefined,
  className = undefined as string | undefined,
  table = undefined as boolean | undefined,
  sorted = false,
  vertical = undefined as boolean | undefined,
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
    debugger
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

  // Primitive: number
  if (!isNaN(Number(val))) {
    return (
      <em className="num">
        {Number(val).toLocaleString('ru-RU', { maximumFractionDigits: 4 }).replace(",", ".")}
      </em>
    );
  }

  if (obs) {
    return <Img src={rul.obsSprite(obs, val)} alt={val} />;
  }

  // It should be an entry, passed by direct link or id. Converting it to id
  let id = fromAnyRef(val);

  function tr1(text: string) {
    return <Tr text={text} icon={icon} nobr={nobr} notip={notip} prefix={prefix} postfix={postfix} />
  }

  if (id) {
    if (rul.hasSprite(id)) {
      return <Img src={val} />;
    }

    return <a href={'##' + id} className={rul?.article(id) ? undefined : "dead"} >{tr1(children ?? id)}</a>;
  }

  // Array case
  if (Array.isArray(val) || val instanceof Set || val instanceof Object) {
    return <LinksList items={val} depth={depth - 1} className={className} table={table} sorted={sorted} vertical={vertical} />;
  }

  let text = id ?? val;
  if (typeof text == "string")
    return tr1(text)

  debugger
};

/**Translate text if possible add the emoji icon to it. For internal use by Val only */
function Tr({
  text = undefined as string | undefined,
  icon = undefined as IconType | undefined,
  nobr = 30,
  notip = false,
  prefix = undefined as string | undefined,
  postfix = undefined as string | undefined
}) {
  let iconText = rul.icon(text);

  let valtr = `${prefix ?? ""}${rul.tr(text)}${postfix ?? ""}`;

  let element = (valtr?.length < nobr) ? <span className="nobr">{valtr}</span> : <>{valtr}</>

  if (iconText) {
    if (icon == "monospace")
      element = <><div className='inem'>${icon}</div>{element}</>
    else if (icon == "simple")
      element = <>{icon}{valtr || ""}</>
    else if (icon != "none")
      element = <><div className='comem'>{icon}</div>{element}</>
  }

  if (!notip && ('tip_' + text) in rul.lang) {
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

const LinksList: FC<LinksListProps> = ({
  items: initialItems,
  depth = 2,
  table = undefined,
  className,
  sorted
}) => {

  sorted ??= initialItems?.length > 9;
  className ??= "";

  const sorter = sorted ? alphabeticLocalizedSorter : noSorter;

  let items: any[], isObject = false;

  if (!Array.isArray(initialItems)) {
    isObject = true;
    items = sorted ?
      sorter(Object.keys(initialItems)).map(k => [k, initialItems[k]]) :
      Object.entries(initialItems);
    table ??= true;
  } else if (initialItems instanceof Set) {
    items = [...initialItems]
  } else {
    items = initialItems
  }

  if (sorted && !isObject) {
    items = sorter(items);
  }

  if (table) {
    return (
      <table className={"properties-table " + className}>
        <tbody>
          {items.map((field, i) => (
            <tr key={i}>
              {field.map((v: any, i: number) => <td key={i}><Val of={v} depth={depth - 1} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else {
    return (
      <ol className={"links-list " + className}>
        {items.map((item, i) =>
          <li key={i}>
            <Val of={item} depth={depth - 1} />
          </li>
        )}
      </ol>
    );
  }
};