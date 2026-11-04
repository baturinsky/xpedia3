import { CSSProperties, Fragment, JSX, MouseEventHandler, useEffect, useMemo, useState } from "react";
import { state, update } from "../state";
import { type Column } from 'react-data-grid';

import { getImg } from "../idb";
import { rul } from "../rul/Ruleset";
import { Val } from "./Val";
import React from "react";
import ItemComponent from "./ItemComponent";
import { CraftWeapon } from "../rul/Entry";

export async function viewImage(path: string) {
  let img = await getImg(path);
  let a = "data:image/png;base64," + btoa(String.fromCharCode(...img.data));
  update({ imagePreview: a })
}

export function Img(props: { src?: string, scale?: number, alt?: string, style?: any, maxWidth?: number, maxHeight?: number, zoom?: number }) {
  if (!props.src)
    return
  let sprite = rul.sprites[props.src];
  let path = sprite?.path;
  if (!path)
    return;
  if (!state.images[path]) {
    getImg(path).then(img => {
      update({ images: { ...state.images, [path]: img } })
    });
  }
  let img = state.images[path];
  let dataImage = img ? "data:image/png;base64," + btoa(String.fromCharCode(...img.data)) : emptyImageData;
  return <img className="x-image" src={dataImage} alt={props.alt}
    style={{ zoom: (props.scale ?? 1) / devicePixelRatio, imageRendering: "pixelated", ...props.style ?? {} }}></img>
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

export function fromAnyRef(href?: AnyRef) {
  return (href as any)?.type ?? (href as any)?.id ?? (rul.articles[href as string] ? href : null);
}

export const emptyImageData = `data:image/bmp;base64,Qk0+AAAAAAAAADoAAAAoAAAAAQAAAAEAAAABAAEAAAAAAAAAAADEDgAAxA4AAAEAAAABAAAA/////wAAAAA=`

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

    {Object.entries(entry).sort((a, b) => (a[0] == "providedBy" ? -10 : 10) + (a[0] > b[0] ? 1 : -1)).map(prop =>
    (!['id'].includes(prop[0]) &&
      <tr><td><Val of={prop[0]} /></td>
        <td><Val of={prop[1]} /></td></tr>
    ))}

  </table>

}

export function BaseServiceList({ items = null as string[] | null, vertical = false }) {
  if (!items)
    return "";
  return items.map((item, i) => <>
    {i == 0 ? "" : (vertical ? "</br > " : ", ")}
    <Val of={item} />
  </>)
}

export function Nobr(props: any) {
  return <span className="nobr">{props.children}</span>
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
                <Divider />
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

    let flat = [];
    for (let type of Object.keys(bonus)) {
      if (bonus[type].length) {

        for (let power = 0; power < bonus[type].length; power++) {
          let b = bonus[type][power];
          if (b !== 0) {
            power = power * 1 + 1;
            flat.push([
              <>
                <a href="##${type}">${rul.tr(type, { icon: "compact" })}</a>
                {power === 1 ? "" : <sup>{power}</sup>}
              </>,
              b, type
            ]);
          }
        }
      } else {
        if (bonus[type] !== 0) flat.push([<a href="##${type}">{rul.tr(type, { icon: "compact" })}</a>, bonus[type], type]);
      }
    }
    flat = flat.sort((a, b) => (a[0] === "flatHundred" || a[0] === "flatOne" || a[0] < b[0] ? -1 : 1));
    return flat;
  }, [bonus]);

  return (
    <>
      {flat.length > 0 && plus && "+"}
      {flat.map((b, i) => (
        <React.Fragment key={i}>
          {i !== 0 && " +"}
          {b[2] === "flatHundred" ? (
            b[1] * 100
          ) : b[2] === "flatOne" ? (
            b[1]
          ) : (
            <Nobr>
              {b[0]}
              {b[1] !== 1 && <em>${b[1]}</em>}
            </Nobr>
          )}
        </React.Fragment>
      ))}
    </>
  );
};

