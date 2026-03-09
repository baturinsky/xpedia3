import { FC, Fragment } from "react";
import { rul } from "../rul/Ruleset";
import { Divider, fromAnyRef, Img } from "./components";

/** Polymorphic value view */



export const Val = ({
  of: val = null,
  children = null,
  /**obs sprite */
  obs = null,
  /** Maximum depth */
  depth = 3,
  notip = false,
  nobr = 30,
  icon = null,
  vertical = false,
  numberTable = false
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

  if (id) {
    if (rul.hasSprite(id)) {
      return <Img src={val} />;
    }

    return <a href={'##' + id} className={rul?.article(id) ? null : "dead"} ><Tr icon={icon} text={children ?? id}></Tr></a>;
  }

  // Array case
  if (Array.isArray(val)) {
    return <LinksList items={val} depth={depth - 1} vertical={vertical} numberTable={numberTable} />;
  }

  // Object case
  if (val instanceof Object) {
    debugger
    //return <LinksList items={val} />;
    return "!!!!!!!can't render object"
  }

  return <Tr text={id ?? val} icon={icon} nobr={nobr} notip={notip} />
};

/**Translate text and possible add the emoji icon to it */
function Tr({ text, icon = null, nobr = 30, notip = false }: { text: string, icon?: string, nobr?: number, notip?: boolean }) {
  let iconText = rul.icon(text);

  let valtr = rul.tr(text);

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
}

const LinksList: FC<LinksListProps> = ({
  items: initialItems,
  cols = 0,
  vertical = false,
  numberTable = false,
  depth = 2,
  sorted
}) => {

  // Handle sorted default
  sorted ??= initialItems?.length > 9;

  // Handle items transformation
  const items = (initialItems instanceof Set) ? [...initialItems] : initialItems;;

  // Create sorter function
  const sorter = sorted ? (a: any[]) => rul.sortStrings(a) : (a: any[]) => a;

  // Columns layout
  if (cols) {
    return (
      <div className="cols" style={{ columns: cols }}>
        {items.map((field: any, i: number) => (
          <div key={i}>
            <Val of={field} />
          </div>
        ))}
      </div>
    );
  }

  // Number table layout
  if (numberTable) {
    return (
      <table className="number-table">
        <tbody>
          {Object.keys(items)
            .sort()
            .map((field, i) => (
              <tr key={i}>
                <td>
                  <Val of={field} />
                </td>
                <td>
                  <em>
                    <Val of={items[field]} />
                  </em>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    );
  }

  // Check for nested objects
  const hasNestedObjects = (Object.values(items) || []).some(
    (a) => typeof a === "object" && !fromAnyRef(a as any)
  );

  if (hasNestedObjects) {
    return (
      <>
        {Object.keys(items).map((subfield, j) => (
          <div key={subfield} className={j > 0 ? "top-border" : ""}>
            {!Array.isArray(items) && (
              <>
                <Val of={subfield} depth={depth - 1} /> :
              </>
            )}
            <div className="sublist">
              <Val of={items[subfield]} depth={depth - 1} />
            </div>
          </div>
        ))}
      </>
    );
  }

  // Items with no length property (object)
  if (items.length == null) {
    return (
      <span className="links-list">
        {sorter(Object.keys(items)).map((field: string, i: number) => (
          <Fragment key={field}>
            {i > 0 && <Divider key={i} cols={cols} />}
            <Val of={items[field]} depth={depth - 1} />&nbsp;
            <Val of={field} depth={depth - 1} />
          </Fragment>
        ))}
      </span>
    );
  }

  // Items with map method (array)
  if (items.map) {
    return (
      <span className="links-list">
        {sorter(items.map((i: any) => i?.type || i)).map((item: any, i: number) => {
          if (Array.isArray(item)) {
            return (
              <div key={i} className="sublist">
                <LinksList items={item} depth={depth - 1} />
              </div>
            );
          }
          return (
            <Fragment key={i}>
              {i > 0 && <Divider key={i} vertical={vertical} cols={cols} />}
              <Val of={item} depth={depth - 1} />
            </Fragment>
          );
        })}
      </span>
    );
  }

  // Debug fallback (console.warn instead of @debug)
  console.warn("Unexpected items structure:", items);
  debugger
  return null;
};