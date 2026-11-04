import { Children, Component, createContext, Fragment, JSX, MouseEventHandler, useContext, useSyncExternalStore } from "react";
import { createRoot } from 'react-dom/client';
import { article, externalStore, PageName, section, state, update, type StoreType } from "../state";

import 'react-data-grid/lib/styles.css';
import 'normalize.css';
import './didactGothic.css';
import './style.css';
import { SlowProcessStatus, ArchiveFiles, CurrentAssets } from "./files";
import { rul } from "../rul/Ruleset";
import { Val } from "./Val";
import { ArticleComponent } from "./ArticleComponent";


export const StoreContext = createContext({} as StoreType);

function UI() {
  const store = useSyncExternalStore(externalStore.subscribe, externalStore.getSnapshot);

  return (
    <StoreContext value={store}>
      <div className="all">
        <NavTop />
        <div className="content">
          <ArticleComponent />
        </div>
      </div>
      <div className="tooltip fadein" id="xpediaTooltip">Tooltip</div>
    </StoreContext>
  );
}

export function LandingPage() {
  return <>
    <SectionsList />
    <h4>Modpacks</h4>
    Drag and drop modpack files in zip or rar format here to upload !
    <ArchiveFiles />
    <CurrentAssets />
    {state.imagePreview && <img src={state.imagePreview}></img>}
    <SlowProcessStatus />
  </>
}


export function NavTop() {
  return <nav className="top">
    <div className="left">
      <Val of="MAIN">{rul ? `${rul.meta.name} ${rul.meta.version}` : "Upload"}</Val>
      {section && section.id != "MAIN" && <Val of={section.id} />}
    </div>
    <div className="right">
      <button onClick={() => update({ ordered: !state.ordered })}>{state.ordered ? "A-Z" : <s>A-Z</s>}</button>
    </div>
  </nav>
}


function SectionsList() {
  if (!rul)
    return;
  return <div className="sections-list">
    <div>
      <h4>Chapters</h4>
      <Val of={rul.sectionsOrder} /></div>
    <div>
      <h4>Categories</h4>
      <Val of={rul.orderedTypeSections()} /></div>
  </div>
}

export function NavSide() {
  return <nav className="side"><SectionsList /></nav>
}

export function Clickable(props: { onClick: MouseEventHandler<HTMLDivElement>, className?: string, children: JSX.Element }) {
  return <div onClick={props.onClick} className={"link " + (props.className ?? "")}>{props.children}</div>
}

export function initUI() {
  createRoot(document.body).render(<UI />);;
}

let isTouch = "ontouchstart" in window;

let showDropdown = false;
let showLanguagesDropdown = false;
let tooltip: HTMLElement | undefined;
let navbarDropDown: HTMLElement | undefined;

window.addEventListener("pointermove", async (e) => {
  if (e.screenX < 10 && e.screenY < innerHeight / 3) {
    dropdown(true);
  } else {
    if (e.target && !isAncestorOf(navbarDropDown, e.target as Node)) {
      dropdown(false);
    }
  }

  let tooltip = document.getElementById("xpediaTooltip")
  if (tooltip) {
    let el = e.target as HTMLElement;
    while (el && !el.dataset?.tooltip)
      el = el.parentNode as HTMLElement;

    if (el && el.dataset?.tooltip) {
      let id = el.dataset.tooltip;
      let rect = el.getBoundingClientRect();
      toggleTooltip(
        id in rul.lang && !e.shiftKey ? rul.lang[id] : id.substring(4)
      );

      let tipRect = el.getBoundingClientRect();
      tooltip.style.left = Math.max(200, rect.left + rect.width / 2) + "px";
      tooltip.style.top = Math.max(100, rect.top > 100 ? rect.top + 40 : rect.top + 120) + "px";

    } else {
      toggleTooltip(undefined);
    }
  }
});

function toggleTooltip(text: string | undefined) {
  let tooltip = document.getElementById("xpediaTooltip")
  if (!tooltip) {
    return;
  }
  tooltip.innerHTML = text ?? "";
  let classes = tooltip.classList;
  if (text) {
    classes.add("visible");
  } else {
    classes.remove("visible");
  }
}

function dropdown(val?: any) {
  if (val === null) {
    showDropdown = !showDropdown;
  } else {
    if (!isTouch) showDropdown = val;
  }
}

export function isAncestorOf(ancestor?: Node | null, descendant?: Node | null) {
  if (!ancestor || !descendant)
    return false;
  let n: Node | null = descendant;
  while (n) {
    if (n === ancestor) {
      return true;
    } else {
      n = n.parentNode;
    }
  }
  return false;
}