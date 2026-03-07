import { Children, Component, createContext, Fragment, MouseEventHandler, useContext, useSyncExternalStore } from "react";
import { createRoot } from 'react-dom/client';
import { article, externalStore, PageName, section, store, update, type StoreType } from "../store";

import 'react-data-grid/lib/styles.css';
import 'normalize.css';
import './didactGothic.css';
import './style.css';
import { SlowProcessStatus, ArchiveFiles, CurrentAssets } from "./files";
import { Divider, Link, LinksList, Tr, Img, Value } from "./components";
import { rul } from "../rul/Ruleset";


export const StoreContext = createContext({} as StoreType);

function UI() {
  const store = useSyncExternalStore(externalStore.subscribe, externalStore.getSnapshot);

  return (
    <StoreContext value={store}>
      <div className="all">
        <NavTop />
        <div className="content">
          <Article />
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

export function ArticleTitle() {
  let [left, right] = [-1, 1].map(delta => rul.findNearbyArticle(article, delta, section, store.ordered));
  return <div className="article-title">
    <div className="left">{left && <>&lt;&nbsp;<Link href={left} /></>}</div>
    <div className="central">{article?.title}</div>
    <div className="sections"><LinksList items={article.sections} /></div>
    <div className="right">{right && <><Link href={right} />&nbsp;&gt;</>}</div>
  </div>
}

export function Article() {
  if (!article)
    return
  return <div className="article">
    <ArticleTitle />
    <div className="article-body">
      <div className="article-text-and-image">
        <Img src={article.image_id} scale={1} />
        {article?.text}
        {article.requires && article.requires.join('') != article.id && <>
          <br />
          <Tr s="Research required:" />
          {article.requires.map(req => <Value val={req} />)}
        </>}
      </div>
    </div>
    {(section?.id == article?.id) &&
      <div className="articles-list">
        <LinksList items={section.articles(store.ordered)} divider={'br'} />
      </div>
    }
    {(section?.id == "MAIN" || !rul) && <LandingPage />}

  </div>
}

export function NavTop() {
  return <nav className="top">
    <div className="left">
      <Link href="MAIN">{rul ? `${rul.meta.name} ${rul.meta.version}` : "Upload"}</Link>
      {section && section.id != "MAIN" && <Link href={section.id} />}
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
      <LinksList items={rul.sectionsOrder} /></div>
    <div>
      <h4>Categories</h4>
      <LinksList items={rul.orderedTypeSections()} /></div>
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

