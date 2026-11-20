import {
  createContext,
  Fragment,
  type JSX,
  type MouseEventHandler,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { goToLanding } from "../navigation";
import {
  article,
  articleRevision,
  externalStore,
  reveal,
  revealLock,
  type StoreType,
  section,
  state,
  update,
} from "../state";
import { clearHash, xpediaBuildStamp, xpediaVersion } from "../util";

export { isAncestorOf } from "../util";

import "react-data-grid/lib/styles.css";
import "normalize.css";
import "./didactGothic.css";
import "./style.css";
import { warmEstimate } from "../exportPedia";
import { inlineLanguageNames, inlineLanguagePacks, loadLanguagePack } from "../packSource";
import { rul } from "../rul/Ruleset";
import { ArticleComponent } from "./ArticleComponent";
import { AudioDialog } from "./Audio";
import { Divider } from "./components";
import ExportDialog from "./ExportDialog";
import { ArchiveFiles, ConfirmDialog, CurrentAssets, SlowProcessStatus, selectPack } from "./files";
import { Tr, Val } from "./Val";

export const StoreContext = createContext({} as StoreType);

/** Applies UI preferences that live on the document root */
function useDocumentSettings() {
  // No dependency arrays on purpose: `state` is a module value, and `UI`
  // re-renders on every store update, so running after every render is what
  // picks up a preference change. Both writes are idempotent.
  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = state.hugeFont ? "24pt" : "12pt";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  });
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
  const query = "(max-width: 720px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/**
 * The article, held behind a memo key so that updates the article cannot see do
 * not re-render it.
 *
 * `UI` subscribes to the whole store and therefore re-renders on every update,
 * which is what makes a single store so cheap to write against. But some updates
 * reach only the navbar — the theme, a dropdown opening — and the article under
 * `ITEMS` costs about 13 ms and 394 DOM writes to re-render for a change none of
 * its 8,000 nodes can observe. `articleRevision` moves only when an update could
 * have changed the article, so on such an update this element keeps its identity
 * and React skips the whole subtree.
 *
 * The `revision` prop is deliberately unread: it is the memo key, and the article
 * reads the store directly. See `articleBlindFields` in `state.ts` for which
 * fields are allowed to skip.
 */
const ArticlePane = memo(function ArticlePane(_props: { revision: number }) {
  return <ArticleComponent />;
});

function UI() {
  const store = useSyncExternalStore(externalStore.subscribe, externalStore.getSnapshot);
  useDocumentSettings();
  const narrow = useNarrow();

  // A phone has no second column to spare, so the sidebar is not shown at all
  // there. Section pages, search and the article title's left/right links are
  // the navigation instead.
  const canShowSide = hasSidebar() && !narrow;
  const side = state.seeSide && canShowSide;

  return (
    <StoreContext value={store}>
      <div className={`all${side ? "" : " no-side"}${narrow ? " narrow" : ""}`}>
        <NavTop />
        {side && <NavSide />}
        {canShowSide && (
          <button
            type="button"
            className={`side-hide-button${state.seeSide ? "" : " collapsed"}`}
            onClick={() => update({ seeSide: !state.seeSide })}
          >
            {state.seeSide ? "⇤" : "⇥"}
          </button>
        )}
        <div className={`content${onLandingPage() ? " landing-page" : ""}`}>
          <ArticlePane revision={articleRevision} />
        </div>
      </div>
      <div className="tooltip fadein" id="xpediaTooltip">
        Tooltip
      </div>
      {/* The status overlay lives at the root so a drop is visible from any page */}
      <ConfirmDialog />
      <SlowProcessStatus />
      <AudioDialog />
    </StoreContext>
  );
}

/**
 * The export button, and the only place the size estimate is warmed up.
 *
 * It is rendered only in the developer view, so that is exactly when measuring
 * the pack ahead of time costs nothing for the people who never export.
 */
function ExportButton() {
  // An empty dependency array: the pack is read at call time, and a changed
  // pack always comes with `xpedia:loaded`, which this same effect listens to.
  useEffect(() => {
    warmEstimate();
    // Re-uploading a pack replaces its ruleset without changing its name, so the
    // measurement dropped by `xpedia:loaded` has to be retaken here
    addEventListener("xpedia:loaded", warmEstimate);
    return () => removeEventListener("xpedia:loaded", warmEstimate);
  }, []);
  return (
    <button
      type="button"
      className="export-button"
      onClick={() => update({ showExportDialog: true })}
    >
      <Tr text="Export" />
    </button>
  );
}

export function LandingPage() {
  return (
    <>
      {state.packName && rul && (
        <>
          <ModsList />
          <ExportButton />
          <SectionsList />
        </>
      )}

      {/*<p className="modpack-hint">
      Drag and drop modpack files in zip or rar format anywhere on this page to add them.
    </p>*/}

      <div className="pedia-intro">
        <Tr text="STR_ABOUT_XPEDIA" />
      </div>
      <ArchiveFiles />
      {state.devView && <CurrentAssets />}
      {state.imagePreview && <img src={state.imagePreview} alt="Sprite preview"></img>}
      <ExportDialog />
    </>
  );
}

/** Loaded mods and their versions, see old `App.svelte` */
function ModsList() {
  // A mod is named by its metadata; `common` and other metadata-less folders are
  // not mods the user installed, so they are not listed
  const mods = (rul?.mods ?? []).filter((mod) => mod?.meta?.id || mod?.meta?.name);
  if (mods.length === 0) return null;
  // A builtin mod is XPedia's own: it loads with every pack, so it is dimmed to
  // show that it is not part of the uploaded modpack
  return (
    <div className="mods-list">
      {mods.map((mod, i) => (
        <Fragment key={mod.dir ?? mod.meta.id}>
          {i !== 0 && <Divider />}
          <span
            className={mod.builtin ? "builtin-mod" : undefined}
            title={mod.builtin ? "Included with XPedia, not part of this modpack" : undefined}
          >
            <Val of={[mod.meta.name, mod.meta.version].filter(Boolean).join(" ")} />
          </span>
        </Fragment>
      ))}
    </div>
  );
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
  "UNITS",
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
    if (e.pointerType === "mouse") updateFn();
  };
}

/**
 * A navbar dropdown button does one of two things, depending on the device:
 * with a mouse it navigates (the list is already open on hover), while a tap
 * opens or closes the list, closing the other navbar lists as it does.
 */
function dropdownButtonClick(
  open: "showDropdown" | "showPacksDropdown" | "showLanguagesDropdown",
  goTo?: string,
) {
  if (isTouchInput()) {
    const next = !state[open];
    update({
      showDropdown: false,
      showPacksDropdown: false,
      showLanguagesDropdown: false,
      [open]: next,
    });
    return;
  }
  if (!goTo) {
    // A list with no page of its own (the language picker) keeps the plain
    // toggle for a mouse; hover has usually opened it already, this closes it
    update({ [open]: !state[open] });
    return;
  }
  update({ showDropdown: false, showPacksDropdown: false, showLanguagesDropdown: false });
  // The landing page has no hash, so it cannot be reached by assigning one
  if (goTo === "##HOME") {
    goToLanding();
    return;
  }
  if (location.hash !== goTo) location.hash = goTo;
}

window.addEventListener(
  "pointerdown",
  (e) => {
    touchInteraction = e.pointerType !== "mouse";
    if (!touchInteraction) return;
    // A tap anywhere outside an open list dismisses it. The buttons themselves
    // are inside a container, so their own tap reaches the toggle below instead.
    const target = e.target as HTMLElement;
    if (
      (state.showDropdown || state.showPacksDropdown || state.showLanguagesDropdown) &&
      !target?.closest?.(".navbar-dropdown-container")
    )
      update({ showDropdown: false, showPacksDropdown: false, showLanguagesDropdown: false });
  },
  true,
);

/**
 * Whether the landing title is XPedia's own name rather than a pack's.
 *
 * A pack's title is its name and its own version, so XPedia's version is only
 * added when there is no pack title to add it to. This mirrors `packTitle` on
 * purpose: a selected archive whose ruleset is missing still names the archive,
 * and that is not XPedia naming itself.
 */
export function xpediaNamed() {
  return !rul?.meta?.name && !state.packName;
}

export function packTitle() {
  const title = rul?.meta?.name
    ? [rul?.meta?.name, rul?.meta?.version].filter(Boolean).join(" ")
    : (state.packName ?? rul?.tr?.("XPedia") ?? "XPedia");
  return title;
}

/** Top-left navigation dropdown: pedia sections and type sections */
function NavDropdown() {
  const visible = state.showDropdown;
  const current = section?.id;

  return (
    <div
      className="navbar-dropdown-container dropdown-button"
      onPointerEnter={hoverOpens(() => update({ showDropdown: true }))}
      onPointerLeave={hoverOpens(() => update({ showDropdown: false }))}
    >
      <button
        type="button"
        className="navbar-button dropdown-button"
        title="Sections"
        onClick={() => dropdownButtonClick("showDropdown", current ? `##${current}` : "##HOME")}
      >
        {/*<img src={favicon} alt="XPedia" className="xpedia-icon" />*/}
        {/* The version is added only where XPedia itself is named: a loaded pack
          replaces this label with its own name and version, and appending
          XPedia's there would say two versions in one place. It stays visible
          on the navbar so a bug report has a copy to quote. It sits in its own
          element so it can be dimmed and sized apart from the label. */}
        <Tr text={(onLandingPage() ? undefined : section?.id) ?? "XPedia"} notip />
        {(!section?.id || onLandingPage()) && (
          <span className="xpedia-version" title={xpediaBuildStamp()}>
            {" "}
            {xpediaVersion()}
          </span>
        )}
      </button>
      <div className="navbar-dropdown" style={{ visibility: visible ? "visible" : "hidden" }}>
        <div className="flex-horisontal">
          <div className="navbar-auto navbar-list">
            {/* The landing page's own address has no hash, so this is not a link:
              a bare-path `href` would reload the whole page when it is already
              the current URL */}
            {/* biome-ignore lint/a11y/useValidAnchor: HOME has no hash to point at, so a button would lose the link styling and keyboard behaviour the other menu items share; the click is prevented and handled here instead */}
            <a
              href="#"
              className={`menu-home${onLandingPage() ? " active-section" : ""}`}
              style={{ textDecoration: "underline" }}
              onClick={(e) => {
                e.preventDefault();
                goToLanding();
              }}
            >
              <Tr text="HOME" />
            </a>
            <div className="menu-spacer" />
            {rul?.sectionsOrder?.map((s) => (
              <a
                key={s.id}
                href={`##${s.id}`}
                className={s.id === current ? "active-section" : undefined}
              >
                <Tr text={s.id} />
              </a>
            ))}
          </div>
          <div className="navbar-custom navbar-list">
            {rul?.typeSectionOrder(state.alphabeticalSort)?.map((s) => (
              <a
                key={s.id}
                href={`##${s.id}`}
                className={s.id === current ? "active-section" : undefined}
              >
                <Tr text={s.id} />
                {tableSections.includes(s.id) && <span className="table-marker">☰</span>}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function NavTop() {
  // A split export keeps English in the page and names a script for every other
  // language. An export that is not split has no such list, and every language
  // it carries can be switched to in place.
  const languagePacks = inlineLanguagePacks();
  const languages = inlineLanguageNames() ?? rul?.langNames ?? [];

  const currentLanguage = state.lang ?? rul?.langName ?? "";

  function selectLanguage(lang: string) {
    if (lang === currentLanguage) return;
    // A language whose strings are in a pack is fetched first; on failure the
    // current language stays, rather than switching to one with no strings
    if (languagePacks?.[lang]) {
      loadLanguagePack(lang).then((strings) => {
        if (!strings) return;
        // The pack holds only what differs from English, and `selectLang` merges
        // it over English the same way it does for a language inside the page
        rul.langs[lang] = strings;
        if (rul.selectLang(lang)) update({ lang, showLanguagesDropdown: false });
      });
      return;
    }
    if (!rul.selectLang(lang)) return;
    update({ lang, showLanguagesDropdown: false });
  }
  return (
    <nav className="top">
      <div className="left">
        <NavDropdown />
      </div>
      <div className="right">
        <SearchBox />
        <button
          type="button"
          className="navbar-button"
          onClick={() => update({ theme: state.theme === "light" ? "dark" : "light" })}
        >
          {state.theme === "light" ? "◐" : "◑"}
        </button>
        <button
          type="button"
          className="navbar-button"
          onClick={() => update({ hugeFont: !state.hugeFont })}
        >
          <span style={{ fontSize: "150%" }}>A</span>
          <span style={{ fontSize: "75%" }}>A</span>
        </button>
        {languages.length > 1 &&
          (languages.length <= 3 ? (
            languages.map((lang) => (
              <button
                type="button"
                key={lang}
                className={`navbar-button${lang === currentLanguage ? " current" : ""}`}
                onClick={() => selectLanguage(lang)}
              >
                <Val of={lang} nobr />
              </button>
            ))
          ) : (
            <div
              className="navbar-dropdown-container select-language"
              onPointerEnter={hoverOpens(() => update({ showLanguagesDropdown: true }))}
              onPointerLeave={hoverOpens(() => update({ showLanguagesDropdown: false }))}
            >
              <button
                type="button"
                className="navbar-button"
                onClick={() => dropdownButtonClick("showLanguagesDropdown")}
              >
                <big>
                  <Val of={currentLanguage} />
                </big>
              </button>
              <div
                className="navbar-dropdown"
                style={{ visibility: state.showLanguagesDropdown ? "visible" : "hidden" }}
              >
                {languages.map((lang) => (
                  <button
                    type="button"
                    key={lang}
                    className={`clickable${lang === currentLanguage ? " current" : ""}`}
                    onClick={() => selectLanguage(lang)}
                  >
                    <Val of={lang} nobr />
                  </button>
                ))}
              </div>
            </div>
          ))}
        <button
          type="button"
          className="navbar-button"
          title="Alphabetical sort"
          onClick={() => update({ alphabeticalSort: !state.alphabeticalSort })}
        >
          <span style={state.alphabeticalSort ? undefined : { textDecoration: "line-through" }}>
            A-Z
          </span>
        </button>

        <button
          type="button"
          className={`navbar-button${state.revealed ? " reveal-lock" : ""}`}
          title="Hold to reveal language keys"
          onMouseOver={() => reveal(true)}
          onMouseOut={() => reveal(false)}
          onFocus={() => reveal(true)}
          onBlur={() => reveal(false)}
          onClick={() => revealLock()}
        >
          STR
        </button>

        <PackDropdown />
      </div>
    </nav>
  );
}

/**
 * Top-right modpack picker: the same idea as the section menu, but it lists the
 * modpacks installed in the browser instead of pedia sections.
 */
function PackDropdown() {
  const visible = state.showPacksDropdown;
  const packs = state.packs ?? [];
  // The label names the selected archive, so it stays distinct from the pedia
  // title in the top-left menu, which shows the mod's own name instead.
  const label = packTitle();

  return (
    <div
      className="navbar-dropdown-container select-packs"
      onPointerEnter={hoverOpens(() => update({ showPacksDropdown: true }))}
      onPointerLeave={hoverOpens(() => update({ showPacksDropdown: false }))}
    >
      <button
        type="button"
        className="navbar-button"
        title="Modpacks"
        onClick={() => dropdownButtonClick("showPacksDropdown", "##HOME")}
      >
        <span className="on-wide">{label}&nbsp;</span>
        <span>▾</span>
      </button>
      <div className="navbar-dropdown" style={{ visibility: visible ? "visible" : "hidden" }}>
        {packs.length === 0 ? (
          <div className="packs-empty">No modpacks uploaded yet</div>
        ) : (
          packs.map((pack) => (
            <button
              type="button"
              key={pack.pack}
              className={`clickable${pack.pack === state.packName ? " current" : ""}`}
              title={pack.pack === state.packName ? "Currently shown" : "Show this modpack"}
              onClick={() => {
                update({ showPacksDropdown: false });
                selectPack(pack.pack);
              }}
            >
              {pack.pack}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Typing this into the navbar search box reveals the developer tools. It is not
 * a search term, so it must never reach the search results.
 */
const devModeKeyword = "devmode";

/** Navbar full text search, mirrors old `App.svelte` */
function SearchBox() {
  const [handle, setHandle] = useState<ReturnType<typeof setTimeout>>();

  /** Search is driven by the hash so it can be linked and reached with history */
  function search(value: string) {
    // A hidden keyword unlocks the developer tools instead of searching for it
    if (value.trim().toLowerCase() === devModeKeyword) {
      if (handle) clearTimeout(handle);
      setHandle(undefined);
      update({ searchQuery: "", devView: true, devUnlocked: true });
      if (article) location.hash = `##${article.id}`;
      else clearHash();
      return;
    }
    update({ searchQuery: value });
    if (handle) clearTimeout(handle);
    setHandle(
      globalThis.setTimeout(() => {
        setHandle(undefined);
        if (value) location.hash = `##SEARCH::${value}`;
        else if (article) location.hash = `##${article.id}`;
        // No hash is how the landing page is addressed; assigning "" would
        // append a bare "#" and fire a second navigation
        else clearHash();
      }, 400),
    );
  }

  return (
    <div className="navbar-search">
      <input
        className="input"
        type="text"
        id="search-string"
        value={state.searchQuery ?? ""}
        onChange={(e) => search(e.target.value)}
        onKeyUp={(e) => {
          if (e.key === "Enter") search(e.currentTarget.value);
        }}
        placeholder="Search..."
      />
    </div>
  );
}

function SectionsList() {
  if (!rul) return;
  // The pedia's own sections keep the pack's order (it is authored, and groups
  // related pages); only the categories follow the `A-Z` toggle. Both lists
  // come from the same helpers the `<`/`>` arrows walk (`Ruleset.sectionOrder`
  // and friends), so a category cannot be listed in one order and stepped
  // through in another.
  return (
    <div className="sections-list">
      <div>
        <h4>
          <Tr text="Pedia sections" />
        </h4>
        <Val of={rul.sectionsOrder} />
      </div>
      <div>
        <h4>
          <Tr text="Categories" />
        </h4>
        <Val of={rul.typeSectionOrder(state.alphabeticalSort)} />
      </div>
    </div>
  );
}

export function NavSide() {
  // The hooks sit above the early return: an early `if (!rul) return null`
  // first would call them only once a pack has loaded, which is a
  // conditional-hooks violation. The refs they read exist either way.
  // The sidebar scrolls as a whole (see `.sidebar` in the stylesheet), so its
  // `scrollTop` is what has to move; `.menu-list` is only the column of links
  const list = useRef<HTMLElement>(null);
  const current = useRef<HTMLAnchorElement>(null);

  // Keep the current article's link in sight, so arriving by a link, a search or
  // the `<`/`>` buttons also tells the reader where in the section they landed.
  //
  // Only the sidebar's own `scrollTop` is touched, never the page's: this must not
  // fight with the article body being scrolled or restored. `useLayoutEffect`
  // rather than `useEffect` because the sidebar is painted with the scroll
  // already applied, instead of showing the top of the list for a frame and then
  // jumping.
  //
  // A link that is already visible is deliberately left alone. Re-centring on
  // every render would undo the reader's own scroll the moment anything else on
  // the page changed, and moving a link that can already be seen is not an
  // improvement.
  const reveal = useCallback(() => {
    const box = list.current,
      link = current.current;
    if (!box || !link) return;
    const boxRect = box.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    if (linkRect.top >= boxRect.top && linkRect.bottom <= boxRect.bottom) return;
    // A band in the middle rather than the bare edges: the link lands with its
    // neighbours visible around it, which is what makes it easy to find. Capped
    // at six rows so a short sidebar does not get a band taller than itself.
    const margin = Math.min(boxRect.height / 3, linkRect.height * 6);
    if (linkRect.top < boxRect.top + margin) box.scrollTop -= boxRect.top + margin - linkRect.top;
    else box.scrollTop += linkRect.bottom - (boxRect.bottom - margin);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the listed values are the only triggers on purpose; running on every render would re-centre the list after the reader scrolled it away, see `reveal` above.
  useLayoutEffect(reveal, [
    reveal,
    article?.id,
    state.seeSide,
    state.alphabeticalSort,
    rul?.langName,
  ]);

  if (!rul) return null;
  const articlesList = section?.articles(state.alphabeticalSort) ?? [];

  return (
    <nav className="sidebar" ref={list}>
      <div className="menu-list">
        {articlesList.map((option) => {
          const here = article?.id === option.id;
          return (
            <a
              key={option.id}
              href={`##${option.id}`}
              ref={here ? current : undefined}
              // The mark also has to be audible: a background tint says nothing to a
              // screen reader, `aria-current` says which page this is
              aria-current={here ? "page" : undefined}
              // Pressing the entry for the page already being read changes nothing,
              // so it is used for the one thing it can usefully do: bring the entry
              // back into view after the reader has scrolled the list away. This is
              // the only way to re-centre on purpose, rather than having the list
              // snap back under the reader whenever something unrelated re-renders.
              onClick={here ? reveal : undefined}
              className={`side-link${here ? " active-article-option" : ""}`}
            >
              <Tr text={option.id} />
            </a>
          );
        })}
      </div>
      <br />
    </nav>
  );
}

export function Clickable(props: {
  onClick: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  children: JSX.Element;
}) {
  return (
    <button type="button" onClick={props.onClick} className={`link ${props.className ?? ""}`}>
      {props.children}
    </button>
  );
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
  const container = document.body as HTMLElement & { [rootKey]?: Root };
  if (!container[rootKey]) container[rootKey] = createRoot(container);
  container[rootKey]?.render(<UI />);
}

window.addEventListener("pointermove", async (e) => {
  const target = e.target as HTMLElement;
  // Only a mouse hovers; a touch pointer must not open or close menus this way
  if (e.pointerType === "mouse") {
    // Hovering the very left edge (and the top third) opens the main menu
    if (e.screenX < 10 && e.screenY < innerHeight / 3) {
      if (!state.showDropdown) update({ showDropdown: true });
    } else if (state.showDropdown && !target?.closest?.(".navbar-dropdown-container")) {
      update({ showDropdown: false });
    }
  }

  const tooltip = document.getElementById("xpediaTooltip");
  if (tooltip) {
    let el = e.target as HTMLElement;
    while (el && !el.dataset?.tooltip) el = el.parentNode as HTMLElement;

    if (el?.dataset?.tooltip) {
      const id = el.dataset.tooltip;
      const rect = el.getBoundingClientRect();
      toggleTooltip(id in rul.lang && !e.shiftKey ? rul.lang[id] : id.substring(4));

      tooltip.style.left = `${Math.max(200, rect.left + rect.width / 2)}px`;
      // Normally the tip opens below the element it explains; near the bottom
      // of the screen it is put above the element instead, so it stays visible.
      let top = rect.top > 100 ? rect.top + 40 : rect.top + 120;
      if (top + tooltip.offsetHeight > innerHeight) top = rect.top - tooltip.offsetHeight;
      tooltip.style.top = `${Math.max(100, top)}px`;
    } else {
      toggleTooltip(undefined);
    }
  }
});

function toggleTooltip(text: string | undefined) {
  const tooltip = document.getElementById("xpediaTooltip");
  if (!tooltip) {
    return;
  }
  tooltip.innerHTML = text ?? "";
  const classes = tooltip.classList;
  if (text) {
    classes.add("visible");
  } else {
    classes.remove("visible");
  }
}

export function onLandingPage() {
  // The search results set `article` to undefined too, but they are a page of
  // their own: they must not take the landing page's layout class, nor mark
  // HOME as the current page.
  return article === undefined && !state.searchQuery;
}
