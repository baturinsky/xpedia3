import { Fragment, MouseEventHandler, useEffect, useState } from "react";
import { store, update } from "../store";
import { type Column } from 'react-data-grid';

import { getImg } from "../idb";
import { rul, stripPediaMarkup } from "../rul/Ruleset";

export async function viewImage(path: string) {
  let img = await getImg(path);
  let a = "data:image/png;base64," + btoa(String.fromCharCode(...img.data));
  update({ imagePreview: a })
}

export function Img(props: { src: string, scale?: number, alt?: string, style?}) {
  if (!props.src)
    return
  let sprite = rul.sprites[props.src];
  let path = sprite?.path;
  if (!path)
    return;
  if (!store.images[path]) {
    getImg(path).then(img => {
      update({ images: { ...store.images, [path]: img } })
    });
  }
  let img = store.images[path];
  let dataImage = img ? "data:image/png;base64," + btoa(String.fromCharCode(...img.data)) : emptyImageData;
  return <img className="x-image" src={dataImage} alt={props.alt}
    style={{ zoom: (props.scale ?? 1) / devicePixelRatio, imageRendering: "pixelated", ...props.style ?? {} }}></img>
}

export function useStateAsync<T>(p: Promise<T>, initialValue: T = null) {

  let [getter, setter] = useState(initialValue)

  useEffect(() => {
    p.then(a => {
      setter(a);
    })
  }, [store.count])

  return getter;
}

function adHocColumns(a: Object) {
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

/**Element for the translated text, possibly with icon */
export function Tr(props: { children?, s?: string, icon?: string, capital?: boolean, nobr?: number, notip?: boolean }) {

  let options = { icon: "compact", nobr: 30, ...(props || {}) }

  let id = options.s ?? options.children;

  if (!rul) {
    return id;
  }

  if (id == null)
    return "";

  let icon = rul.icon(id);

  let str = rul.tr(id);

  let element = (str?.length < options?.nobr) ? <span className="nobr">{str}</span> : <>{str}</>

  if (icon) {
    if (options?.icon == "monospace")
      element = <><div className='inem'>${icon}</div>{element}</>
    else if (options?.icon == "simple")
      element = <>{icon}{str || ""}</>
    else if (options?.icon != "none")
      element = <><div className='comem'>{icon}</div>{element}</>
  }

  if (!options?.notip && ('tip_' + id) in rul.lang) {
    element = <span data-tooltip={'tip_' + id}>{element}<sup className="tipmark">?</sup></span>;
  }

  return element;
}

export function MyTable<T extends { key: any }>(props: {
  className?: string,
  style?,
  columns: { key?, name?, cellClass?, renderCell?, maxWidth?, minWidth?}[],
  rows: T[],
  rowClass
}) {
  return <table className={props.className} style={props.style}>
    <thead><tr>{props.columns.map(col => <td key={col.name}>{col.name}</td>)}</tr></thead>
    <tbody>
      {props.rows.map(row => <tr key={row.key} className={props.rowClass ? props.rowClass(row) : ""}>
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

export function fromAnyRef(href: AnyRef) {
  return (href as any)?.type ?? (href as any)?.id ?? href;
}

/** Link to article. May have icon and tooltip */
export function Link({ children, href, icon }: { children?, href: string | { type: string } | { id: string }, icon?: string }) {
  let ref = fromAnyRef(href);
  let hasTip = rul && 'tip_' + href in rul.lang;

  let link = <a href={'##' + ref} className={rul?.article(ref) ? null : "dead"} ><Tr icon={icon}>{children ?? ref}</Tr></a>;

  if (hasTip) {
    link = <span data-tooltip={'tip_' + href}>{link}<sup className="tipmark">?</sup></span>
  }

  return link;
}

export const emptyImageData = `data:image/bmp;base64,Qk0+AAAAAAAAADoAAAAoAAAAAQAAAAEAAAABAAEAAAAAAAAAAADEDgAAxA4AAAEAAAABAAAA/////wAAAAA=`

export const Divider = () => <span className='list-divider'>&nbsp;· </span>;

export function LinksList({ items = null as AnyRef[], divider = null }) {
  divider ??= <Divider />;
  if (divider == "br")
    divider = <br />
  return items.map((el, i) => {
    return <Fragment key={fromAnyRef(el)}>{i > 0 && divider}<Link href={el} /></Fragment>
  })
}

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

/** Polymorphic value view */
export const Value = ({
  val,
  obs = null,
  depth = 2,
  simple = false,
  nobr = 30,
  icon = null,
  key = null,
  capital = false
}) => {

  // Depth 0 case
  if (depth === 0) {
    return <span>...</span>;
  }

  // Null case
  if (val == null) {
    return <span>‒</span>;
  }

  // Observer sprite case
  if (obs) {
    return <Img src={rul.obsSprite(obs, val)} alt={val} style={{ maxWidth: '320px' }} />;
  }

  // Marker cases
  if (["marker", "markerCrash", "markerLand"].includes(key)) {
    if (rul.globeMarkers) {
      return <Img src={rul.globeMarkers[val]} scale={2} />;
    }
    return <span>{val}</span>;
  }

  // Array case
  if (Array.isArray(val)) {
    return <LinksList items={val} />;
  }

  // Object case
  if (val instanceof Object) {
    return <LinksList items={val} />;
  }

  // Boolean case
  if (val === true || val === false) {
    return (
      <span style={{ color: val ? 'lime' : 'red' }}>
        <Tr s={val.toString()} />
      </span>
    );
  }

  // Number case
  if (!isNaN(Number(val))) {
    return (
      <em className="num">
        {Number(val).toLocaleString('ru-RU', { maximumFractionDigits: 4 }).replace(",", ".")}
      </em>
    );
  }

  // Article case
  if (rul.article(val) && !simple) {
    return <Link href={val} icon={icon} />;
  }

  // Sprite case
  if (rul.hasSprite(val)) {
    return <Img src={val} style={{ maxWidth: '320px' }} />;
  }

  // Default case
  return <Tr s={val} nobr={nobr} icon={icon} capital={capital} />;
};