import { Children, Component, createContext, Fragment, JSX, MouseEventHandler, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from 'react-dom/client';
import { article, externalStore, PageName, reveal, revealLock, section, state, update, type StoreType } from "../state";

import 'react-data-grid/lib/styles.css';
import 'normalize.css';
import './didactGothic.css';
import './style.css';
import { SlowProcessStatus, ArchiveFiles, CurrentAssets } from "./files";
import { rul } from "../rul/Ruleset";
import { favicon } from "../imgPlaceholders";
import { Val, Tr } from "./Val";
import { ArticleComponent } from "./ArticleComponent";


export const StoreContext = createContext({} as StoreType);

/** Applies UI preferences that live on the document root */
function useDocumentSettings() {
  useEffect(() => {
    let root = document.documentElement;
    root.style.fontSize = state.hugeFont ? "24pt" : "12pt";
  }, [state.hugeFont]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);
}

/** The sidebar lists the articles of the current section. The front page has
 * no such list, so there is nothing to show (or to toggle) there. */
function hasSidebar() {
  return !!article && section?.id !== "MAIN";
}

function UI() {
  const store = useSyncExternalStore(externalStore.subscribe, externalStore.getSnapshot);
  useDocumentSettings();

  let canShowSide = hasSidebar();
  let side = state.seeSide && canShowSide;

  return (
    <StoreContext value={store}>
      <div className={"all" + (side ? "" : " no-side")}>
        <NavTop />
        {side && <NavSide />}
        {canShowSide &&
          <button className="side-hide-button" style={{ left: state.seeSide ? undefined : "1em" }}
            onClick={() => update({ seeSide: !state.seeSide })}>
            {state.seeSide ? "⇤" : "⇥"}
          </button>
        }
        <div className="content">
          <ArticleComponent />
        </div>
      </div>
      <div className="tooltip fadein" id="xpediaTooltip">Tooltip</div>
      {/* The status overlay lives at the root so a drop is visible from any page */}
      <SlowProcessStatus />
    </StoreContext>
  );
}

export function LandingPage() {
  return <>
    {rul && <SectionsList />}
    {rul && <ModsList />}
    <h4>Modpacks</h4>
    {/*<p className="modpack-hint">
      Drag and drop modpack files in zip or rar format anywhere on this page to add them.
    </p>*/}
    <ArchiveFiles />
    {state.developerMode && <CurrentAssets />}
    {state.imagePreview && <img src={state.imagePreview}></img>}
  </>
}

/** Loaded mods and their versions, see old `App.svelte` */
function ModsList() {
  let mods = (rul?.mods ?? []).map((m: any) => m?.meta).filter(m => m?.id);
  if (mods.length == 0)
    return null;
  return <>
    <h4><Tr text="Mods" /></h4>
    <ul>
      {mods.map((mod: any) =>
        <li key={mod.id}>{mod.name} {mod.version}</li>
      )}
    </ul>
    <h4><Tr text="About XPedia" /></h4>
    <Tr text="STR_ABOUT_XPEDIA" />
  </>;
}


/** Sections that render their entries as a filterable table, see old `Components.ts` */
export const tableSections = [
  "FACILITIES",
  "COMMENDATIONS",
  "CRAFTS",
  "ARMORS",
  "CRAFT_WEAPONS",
  "SOLDIERS",
  "MANUFACTURE",
  "ITEMS",
  "ATTACKS",
  "UFOS",
  "COUNTRIES",
  "UNITS"
];

/** Top-left navigation dropdown: pedia sections and type sections */
function NavDropdown() {
  let visible = state.showDropdown;
  return <div className="navbar-dropdown-container dropdown-button"
    onMouseEnter={() => update({ showDropdown: true })}
    onMouseLeave={() => update({ showDropdown: false })}>
    <button className="navbar-button dropdown-button" onClick={() => update({ showDropdown: !state.showDropdown })}>
      <img src={favicon} alt="XPedia" className="xpedia-icon" />
      <nobr><span className="on-wide"><Val of="XPedia" notip />&nbsp;</span></nobr>
      <span style={{ transform: "scale(1.5,0.75)", display: "inline-block" }}>?</span>
    </button>
    <div className="navbar-dropdown" style={{ visibility: visible ? "visible" : "hidden" }}>
      <div className="flex-horisontal">
        <div className="navbar-auto navbar-list">
          <a href="##MAIN" className="menu-home" style={{ textDecoration: "underline" }}><Tr text="HOME" /></a>
          <div className="menu-spacer" />
          {rul?.sectionsOrder?.map(section =>
            <a key={section.id} href={"##" + section.id}><Tr text={section.id} /></a>
          )}
        </div>
        <div className="navbar-custom navbar-list">
          {rul?.sortedTypeSections()?.map(section =>
            <a key={section.id} href={"##" + section.id}>
              <Tr text={section.id} />
              {tableSections.includes(section.id) && <span className="table-marker">☰</span>}
            </a>
          )}
        </div>
      </div>
    </div>
  </div>;
}

export function NavTop() {
  let title = [rul?.meta?.name, rul?.meta?.version].filter(Boolean).join(" ");

  function selectLanguage(lang: string) {
    if (!rul.selectLang(lang))
      return;
    update({ lang, showLanguagesDropdown: false });
  }
  return <nav className="top">
    <div className="left">
      <NavDropdown />
      <Val of="MAIN">{title || "XPedia"}</Val>
      {section && section.id != "MAIN" && <Val of={section.id} />}
    </div>
    <div className="right">
      <SearchBox />
      <button className="navbar-button" onClick={() => update({ theme: state.theme == "light" ? "dark" : "light" })}>
        {state.theme == "light" ? "◐" : "◑"}
      </button>
      <button className="navbar-button" onClick={() => update({ hugeFont: !state.hugeFont })}>
        <span style={{ fontSize: "150%" }}>A</span><span style={{ fontSize: "75%" }}>A</span>
      </button>
      {rul && rul.langNames?.length > 1 && (
        rul.langNames.length <= 3
          ? rul.langNames.map(lang =>
            <button key={lang} className={"navbar-button" + (lang == state.lang ? " current" : "")}
              onClick={() => selectLanguage(lang)}>
              <nobr><Val of={lang} /></nobr>
            </button>
          )
          : <div className="navbar-dropdown-container select-language"
            onMouseEnter={() => update({ showLanguagesDropdown: true })}
            onMouseLeave={() => update({ showLanguagesDropdown: false })}>
            <button className="navbar-button" onClick={() => update({ showLanguagesDropdown: !state.showLanguagesDropdown })}>
              <big><Val of={state.lang ?? rul.langName ?? ""} /></big>
            </button>
            <div className="navbar-dropdown" style={{ visibility: state.showLanguagesDropdown ? "visible" : "hidden" }}>
              {rul.langNames.map(lang =>
                <div key={lang} className={"clickable" + (lang == state.lang ? " current" : "")}
                  onClick={() => selectLanguage(lang)}>
                  <nobr><Val of={lang} /></nobr>
                </div>
              )}
            </div>
          </div>
      )}
      <button className="navbar-button" title="Alphabetical sort"
        onClick={() => update({ alphabeticalSort: !state.alphabeticalSort })}>
        <span style={state.alphabeticalSort ? undefined : { textDecoration: "line-through" }}>A-Z</span>
      </button>

      <button
        className={"navbar-button" + (state.revealed ? " reveal-lock" : "")}
        title="Hold to reveal language keys"
        onMouseOver={() => reveal(true)}
        onMouseOut={() => reveal(false)}
        onClick={() => revealLock()}
      >
        STR
      </button>

    </div>
  </nav>
}

/** Navbar full text search, mirrors old `App.svelte` */
function SearchBox() {
  let [handle, setHandle] = useState<number>();

  /** Search is driven by the hash so it can be linked and reached with history */
  function search(value: string) {
    update({ searchQuery: value });
    if (handle) clearTimeout(handle);
    setHandle(globalThis.setTimeout(() => {
      setHandle(undefined);
      if (value)
        location.hash = "##SEARCH::" + value;
      else if (article)
        location.hash = "##" + article.id;
      else
        location.hash = "##MAIN";
    }, 400));
  }

  return <div className="navbar-search">
    <input className="input" type="text" id="search-string" value={state.searchQuery ?? ""}
      onChange={e => search(e.target.value)}
      onKeyUp={e => {
        if (e.key == "Enter") search(e.currentTarget.value);
      }}
      placeholder="Search..." />
  </div>;
}


function SectionsList() {
  if (!rul)
    return;
  return <div className="sections-list">
    <div>
      <h4><Tr text="Pedia sections" /></h4>
      <Val of={rul.sectionsOrder} /></div>
    <div>
      <h4><Tr text="Extra sections" /></h4>
      <Val of={rul.typeSectionsOrder} /></div>
  </div>
}

export function NavSide() {
  if (!rul)
    return null;
  let articlesList = section?.articles(state.alphabeticalSort) ?? [];
  return <nav className="sidebar">
    <div className="menu-list">
      {articlesList.map(option =>
        <a key={option.id} href={"##" + option.id}
          className={"side-link" + (article?.id == option.id ? " active-article-option" : "")}>
          <Tr text={option.id} />
        </a>
      )}
    </div>
    <br />
  </nav>
}

export function Clickable(props: { onClick: MouseEventHandler<HTMLDivElement>, className?: string, children: JSX.Element }) {
  return <div onClick={props.onClick} className={"link " + (props.className ?? "")}>{props.children}</div>
}

export function initUI() {
  createRoot(document.body).render(<UI />);;
}

let isTouch = "ontouchstart" in window;

window.addEventListener("pointermove", async (e) => {
  let target = e.target as HTMLElement;
  // Hovering the very left edge (and the top third) opens the main menu, mouse only
  if (!isTouch && e.screenX < 10 && e.screenY < innerHeight / 3) {
    if (!state.showDropdown)
      update({ showDropdown: true });
  } else if (state.showDropdown && !target?.closest?.(".navbar-dropdown-container")) {
    update({ showDropdown: false });
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
