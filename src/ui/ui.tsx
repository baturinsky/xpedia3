import { Children, Component, createContext, Fragment, MouseEventHandler, useContext, useSyncExternalStore } from "react";
import { createRoot } from 'react-dom/client';
import { article, externalStore, PageName, section, store, update, type StoreType } from "../store";

import 'react-data-grid/lib/styles.css';
import 'normalize.css';
import './didactGothic.css';
import './style.css';
import { SlowProcessStatus, ArchiveFiles, CurrentAssets } from "./files";
import { rul } from "../rul/Ruleset";
import { Val } from "./Val";
import { ArticleInfo } from "./ArticleInfo";


export const StoreContext = createContext({} as StoreType);

function UI() {
  const store = useSyncExternalStore(externalStore.subscribe, externalStore.getSnapshot);

  return (
    <StoreContext value={store}>
      <div className="all">
        <NavTop />
        <div className="content">
          <ArticleInfo />
        </div>
      </div>
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
    {store.imagePreview && <img src={store.imagePreview}></img>}
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
      <button onClick={() => update({ ordered: !store.ordered })}>{store.ordered ? "A-Z" : <s>A-Z</s>}</button>
    </div>
  </nav>
}


function SectionsList() {
  if (!rul)
    return;
  return <div className="sections-list">
    <div>
      <h4>Chapters</h4>
      <Val of={rul.sectionsOrder}/></div>
    <div>
      <h4>Categories</h4>
      <Val of={rul.orderedTypeSections()}/></div>
  </div>
}

export function NavSide() {
  return <nav className="side"><SectionsList /></nav>
}

export function Clickable(props: { onClick: MouseEventHandler<HTMLDivElement>, className?: string, children }) {
  return <div onClick={props.onClick} className={"link " + (props.className ?? "")}>{props.children}</div>
}

export function initUI() {
  createRoot(document.body).render(<UI />);;
}

