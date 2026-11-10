import { Children, Component, createContext, Fragment, JSX, MouseEventHandler, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot, Root } from 'react-dom/client';
import { article, externalStore, PageName, reveal, revealLock, section, state, update, type StoreType } from "../state";

import 'react-data-grid/lib/styles.css';
import 'normalize.css';
import './didactGothic.css';
import './style.css';
import { SlowProcessStatus, ArchiveFiles, CurrentAssets, selectPack, ConfirmDialog } from "./files";
import ExportDialog from "./ExportDialog";
import { rul } from "../rul/Ruleset";
import { favicon } from "../imgPlaceholders";
import { Val, Tr } from "./Val";
import { Divider } from "./components";
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
  return !!article && !onLandingPage();
}

/**
 * True on a narrow screen, where the 15rem sidebar would leave almost nothing
 * for the article and there is no room for a second column at all.
 */
function useNarrow() {
  let query = "(max-width: 720px)";
  let [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    let mq = window.matchMedia?.(query);
    if (!mq)
      return;
    let onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

function UI() {
  const store = useSyncExternalStore(externalStore.subscribe, externalStore.getSnapshot);
  useDocumentSettings();
  let narrow = useNarrow();

  // A phone has no second column to spare, so the sidebar is not shown at all
  // there. Section pages, search and the article title's left/right links are
  // the navigation instead.
  let canShowSide = hasSidebar() && !narrow;
  let side = state.seeSide && canShowSide;

  return (
    <StoreContext value={store}>
      <div className={"all" + (side ? "" : " no-side") + (narrow ? " narrow" : "")}>
        <NavTop />
        {side && <NavSide />}
        {canShowSide &&
          <button className={"side-hide-button" + (state.seeSide ? "" : " collapsed")}
            onClick={() => update({ seeSide: !state.seeSide })}>
            {state.seeSide ? "⇤" : "⇥"}
          </button>
        }
        <div className={"content" + (onLandingPage() ? " landing-page" : "")}>
          <ArticleComponent />
        </div>
      </div>
      <div className="tooltip fadein" id="xpediaTooltip">Tooltip</div>
      {/* The status overlay lives at the root so a drop is visible from any page */}
      <ConfirmDialog />
      <SlowProcessStatus />
    </StoreContext>
  );
}

export function LandingPage() {
  
  return <>
    {state.packName && <>
      
      {rul && <>
        <ModsList />
        <button className="export-button" onClick={() => update({ showExportDialog: true })}><Tr text="Export" /></button>
        <SectionsList />
      </>
      }
    </>}

    {/*<p className="modpack-hint">
      Drag and drop modpack files in zip or rar format anywhere on this page to add them.
    </p>*/}

    <div className="pedia-intro">
      <Tr text="STR_ABOUT_XPEDIA" />
    </div>
    <ArchiveFiles />
    {state.devView && <CurrentAssets />}
    {state.imagePreview && <img src={state.imagePreview}></img>}
    <ExportDialog />
  </>
}

/** Loaded mods and their versions, see old `App.svelte` */
function ModsList() {
  // A mod is named by its metadata; `common` and other metadata-less folders are
  // not mods the user installed, so they are not listed
  let mods = (rul?.mods ?? []).filter((mod: any) => mod?.meta?.id || mod?.meta?.name);
  if (mods.length == 0)
    return null;
  // A builtin mod is XPedia's own: it loads with every pack, so it is dimmed to
  // show that it is not part of the uploaded modpack
  return <div className="mods-list">
    {mods.map((mod: any, i: number) =>
      <Fragment key={mod.dir ?? mod.meta.id}>
        {i !== 0 && <Divider />}
        <span className={mod.builtin ? "builtin-mod" : undefined}
          title={mod.builtin ? "Included with XPedia, not part of this modpack" : undefined}>
          <Val of={[mod.meta.name, mod.meta.version].filter(Boolean).join(" ")} />
        </span>
      </Fragment>
    )}
  </div>;
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

/**
 * True when the last pointer interaction came from a touch screen or a pen.
 *
 * Mouse and touch want different things from a dropdown button: with a mouse the
 * list is already open on hover, so a click on the button is free to mean "go to
 * this page". A touch screen has no hover, so a tap has to be the thing that
 * opens and closes the list.
 */
let touchInteraction = false;

function isTouchInput() {
  return touchInteraction;
}

/** Hover only exists for a mouse; a tap must not behave like hovering */
function hoverOpens(updateFn: () => void) {
  return (e: { pointerType?: string }) => {
    if (e.pointerType == "mouse")
      updateFn();
  };
}

/**
 * A navbar dropdown button does one of two things, depending on the device:
 * with a mouse it navigates (the list is already open on hover), while a tap
 * opens or closes the list, closing the other navbar lists as it does.
 */
function dropdownButtonClick(
  open: "showDropdown" | "showPacksDropdown" | "showLanguagesDropdown",
  goTo?: string
) {
  if (isTouchInput()) {
    let next = !state[open];
    update({ showDropdown: false, showPacksDropdown: false, showLanguagesDropdown: false, [open]: next });
    return;
  }
  if (!goTo) {
    // A list with no page of its own (the language picker) keeps the plain
    // toggle for a mouse; hover has usually opened it already, this closes it
    update({ [open]: !state[open] });
    return;
  }
  update({ showDropdown: false, showPacksDropdown: false, showLanguagesDropdown: false });
  if (location.hash != goTo)
    location.hash = goTo;
}

window.addEventListener("pointerdown", e => {
  touchInteraction = e.pointerType != "mouse";
  if (!touchInteraction)
    return;
  // A tap anywhere outside an open list dismisses it. The buttons themselves
  // are inside a container, so their own tap reaches the toggle below instead.
  let target = e.target as HTMLElement;
  if ((state.showDropdown || state.showPacksDropdown || state.showLanguagesDropdown)
    && !target?.closest?.(".navbar-dropdown-container"))
    update({ showDropdown: false, showPacksDropdown: false, showLanguagesDropdown: false });
}, true);

export function packTitle() {
  let title = rul?.meta?.name
    ? [rul?.meta?.name, rul?.meta?.version].filter(Boolean).join(" ")
    : state.packName ?? rul?.tr?.("XPedia") ?? "XPedia";
  return title
}

/** Top-left navigation dropdown: pedia sections and type sections */
function NavDropdown() {
  let visible = state.showDropdown;
  // The front page counts as its own section, so `##MAIN` highlights too
  let current = section?.id ?? "MAIN";

  return <div className="navbar-dropdown-container dropdown-button"
    onPointerEnter={hoverOpens(() => update({ showDropdown: true }))}
    onPointerLeave={hoverOpens(() => update({ showDropdown: false }))}>
    <button className="navbar-button dropdown-button"
      title="Sections"
      onClick={() => dropdownButtonClick("showDropdown", "##" + current)}>
      {/*<img src={favicon} alt="XPedia" className="xpedia-icon" />*/}
      <Tr text={(onLandingPage() ? undefined : section?.id) ?? "XPedia"} notip />
    </button>
    <div className="navbar-dropdown" style={{ visibility: visible ? "visible" : "hidden" }}>
      <div className="flex-horisontal">
        <div className="navbar-auto navbar-list">
          <a href="##MAIN" className={"menu-home" + (onLandingPage() ? " active-section" : "")}
            style={{ textDecoration: "underline" }}><Tr text="HOME" /></a>
          <div className="menu-spacer" />
          {rul?.sectionsOrder?.map(s =>
            <a key={s.id} href={"##" + s.id}
              className={s.id == current && s.id != "MAIN" ? "active-section" : undefined}><Tr text={s.id} /></a>
          )}
        </div>
        <div className="navbar-custom navbar-list">
          {rul?.sortedTypeSections()?.filter(s => s.id != "MAIN").map(s =>
            <a key={s.id} href={"##" + s.id}
              className={s.id == current ? "active-section" : undefined}>
              <Tr text={s.id} />
              {tableSections.includes(s.id) && <span className="table-marker">☰</span>}
            </a>
          )}
        </div>
      </div>
    </div>
  </div>;
}

export function NavTop() {

  function selectLanguage(lang: string) {
    if (!rul.selectLang(lang))
      return;
    update({ lang, showLanguagesDropdown: false });
  }
  return <nav className="top">
    <div className="left">
      <NavDropdown />
      {/*<Val of="MAIN">{title || "XPedia"}</Val>
      {section && section.id != "MAIN" && <Val of={section.id} />}*/}
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
              <Val of={lang} nobr />
            </button>
          )
          : <div className="navbar-dropdown-container select-language"
            onPointerEnter={hoverOpens(() => update({ showLanguagesDropdown: true }))}
            onPointerLeave={hoverOpens(() => update({ showLanguagesDropdown: false }))}>
            <button className="navbar-button" onClick={() => dropdownButtonClick("showLanguagesDropdown")}>
              <big><Val of={state.lang ?? rul.langName ?? ""} /></big>
            </button>
            <div className="navbar-dropdown" style={{ visibility: state.showLanguagesDropdown ? "visible" : "hidden" }}>
              {rul.langNames.map(lang =>
                <div key={lang} className={"clickable" + (lang == state.lang ? " current" : "")}
                  onClick={() => selectLanguage(lang)}>
                  <Val of={lang} nobr />
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

      <PackDropdown />
    </div>
  </nav>
}

/**
 * Top-right modpack picker: the same idea as the section menu, but it lists the
 * modpacks installed in the browser instead of pedia sections.
 */
function PackDropdown() {
  let visible = state.showPacksDropdown;
  let packs = state.packs ?? [];
  // The label names the selected archive, so it stays distinct from the pedia
  // title in the top-left menu, which shows the mod's own name instead.
  let label = packTitle();

  return <div className="navbar-dropdown-container select-packs"
    onPointerEnter={hoverOpens(() => update({ showPacksDropdown: true }))}
    onPointerLeave={hoverOpens(() => update({ showPacksDropdown: false }))}>
    <button className="navbar-button"
      title="Modpacks"
      onClick={() => dropdownButtonClick("showPacksDropdown", "##MAIN")}>
      <span className="on-wide">{label}&nbsp;</span>
      <span>▾</span>
    </button>
    <div className="navbar-dropdown" style={{ visibility: visible ? "visible" : "hidden" }}>
      {packs.length == 0
        ? <div className="packs-empty">No modpacks uploaded yet</div>
        : packs.map(pack =>
          <div key={pack.pack}
            className={"clickable" + (pack.pack == state.packName ? " current" : "")}
            title={pack.pack == state.packName ? "Currently shown" : "Show this modpack"}
            onClick={() => {
              update({ showPacksDropdown: false });
              selectPack(pack.pack);
            }}>
            {pack.pack}
          </div>
        )}
    </div>
  </div>;
}

/**
 * Typing this into the navbar search box reveals the developer tools. It is not
 * a search term, so it must never reach the search results.
 */
const devModeKeyword = "devmode";

/** Navbar full text search, mirrors old `App.svelte` */
function SearchBox() {
  let [handle, setHandle] = useState<number>();

  /** Search is driven by the hash so it can be linked and reached with history */
  function search(value: string) {
    // A hidden keyword unlocks the developer tools instead of searching for it
    if (value.trim().toLowerCase() == devModeKeyword) {
      if (handle) clearTimeout(handle);
      setHandle(undefined);
      update({ searchQuery: "", devView: true, devUnlocked: true });
      if (article)
        location.hash = "##" + article.id;
      else
        location.hash = "##MAIN";
      return;
    }
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
      <h4><Tr text="Categories" /></h4>
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

/**
 * The React root mounted on `document.body`.
 *
 * It is stored on the container rather than in this module: `createRoot` warns
 * when a container is mounted twice, and the UI module can end up evaluated
 * more than once (a reassembled bundle, a second copy of the script, a dev
 * reload). The module-local variable is not shared in that case, but the DOM
 * node is.
 */
const rootKey = "__xpediaRoot";

export function initUI() {
  let container = document.body as HTMLElement & { [rootKey]?: Root };
  if (!container[rootKey])
    container[rootKey] = createRoot(container);
  container[rootKey]!.render(<UI />);
}

window.addEventListener("pointermove", async (e) => {
  let target = e.target as HTMLElement;
  // Only a mouse hovers; a touch pointer must not open or close menus this way
  if (e.pointerType == "mouse") {
    // Hovering the very left edge (and the top third) opens the main menu
    if (e.screenX < 10 && e.screenY < innerHeight / 3) {
      if (!state.showDropdown)
        update({ showDropdown: true });
    } else if (state.showDropdown && !target?.closest?.(".navbar-dropdown-container")) {
      update({ showDropdown: false });
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

      tooltip.style.left = Math.max(200, rect.left + rect.width / 2) + "px";
      // Normally the tip opens below the element it explains; near the bottom
      // of the screen it is put above the element instead, so it stays visible.
      let top = rect.top > 100 ? rect.top + 40 : rect.top + 120;
      if (top + tooltip.offsetHeight > innerHeight)
        top = rect.top - tooltip.offsetHeight;
      tooltip.style.top = Math.max(100, top) + "px";

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


export function onLandingPage() {
  return section == undefined || section?.id == "MAIN"
}