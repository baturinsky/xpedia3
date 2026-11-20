import type { Article } from "./rul/Article";
import type Ruleset from "./rul/Ruleset";
import type { Section } from "./rul/Section";

export type PageName = "files" | "main";
export type Theme = "light" | "dark";
export const dbVersion = 11;

/**
 * The pickers whose choice is remembered between articles and reloads, and the
 * shape each remembered value has.
 *
 * Every one of these is a control where the reader says what they want to look
 * at, not a property of the article: which region a flight is drawn in, which
 * pose and facing an armor sprite is drawn at. The list is deliberately short —
 * a remembered value is a claim about the reader, so it has to be a choice they
 * would be annoyed to make twice.
 */
export type Selections = {
  /** Id of the region chosen on a trajectory map, see `Ruleset.regionsFor` */
  region?: string;
  /**
   * Region pinned on the map of the regions, so its outline stays lit.
   *
   * The same field the trajectory page uses would be wrong: that one says which
   * region a flight is being drawn in, and pressing a region on this map is a
   * much lighter act — it only lights a shape up. Sharing the field would have
   * the next trajectory page open on a region chosen for an unrelated reason.
   */
  regionsMap?: string;
  /** Pose of the armor sprite sheet, see `UnitPose` */
  pose?: string;
  /** Facing of the armor sprite, 0..7 as `UNIT_DIRECTIONS` numbers them */
  direction?: number;
  /** Facing of a tank's gun, which turns on its own */
  turretDirection?: number;
  /** Step held of the sprite animation, 0 meaning "play it" */
  frame?: number;
};

export type SelectionKey = keyof Selections;

export const state = {
  /** File unpacking status */
  slowProcessStatus: "",
  /** True once the status describes a finished load rather than work in progress */
  slowProcessDone: false,
  /** True when the last finished load failed, see `slowProcessDone` */
  slowProcessError: false,
  /** True while the running slow process can be cancelled from the status window */
  slowProcessCancellable: false,
  /** Completed share of the running slow process, 0..1, or undefined if unknown */
  slowProcessProgress: undefined as number | undefined,
  /** Short description of the current stage, e.g. "Unpacking" */
  slowProcessStage: "",
  files: [] as {
    pack: string;
    assets: number;
    ruls: number;
    archive: number;
  }[],
  /**
   * Every pack the app can show: `files` plus the inlined pack of an exported
   * HTML page, if there is one. Derived, see `updateFileStats`.
   */
  packs: [] as {
    pack: string;
    assets: number;
    ruls: number;
    archive: number;
    /** Pack installed before storage buckets, so it never expires */
    legacy?: boolean;
  }[],
  /** The name of the file (modpack) currently watched */
  packName: undefined as string | undefined,
  section: undefined as Section | undefined,
  article: undefined as Article | undefined,
  rul: undefined as Ruleset | undefined,
  assets: new Set<string>(),
  imagePreview: "",
  /**
   * Loaded images: archive path -> a url that paints, or `null` for a path that
   * failed to load. Written in batches by `cacheImage`, see `ui/components.tsx`.
   */
  images: {} as { [id: string]: string | null },
  count: 0,
  fontSize: 10,
  anal: false,
  seeAllArmorVariants: false,

  /* ---- Persisted UI preferences (formerly localStorage.xpediaSettings) ---- */
  /** Show the sidebar with section links */
  seeSide: true,
  /** Use a larger font (old `hugeFont`); actual size is derived in the UI */
  hugeFont: false,
  /** Sort article lists, sidebar and link pages alphabetically instead of rule order */
  alphabeticalSort: false,
  /**
   * Draw the nation titles and their area boxes on the map pages.
   *
   * Off by default on the region and trajectory pages: there the subject is one
   * region's boxes and the path flown through it, and the nation names and
   * contours underneath are orientation at best. The world map page keeps them
   * regardless — showing the nations is what it is for.
   */
  showCountryLabels: false,
  /** Selected language name, see `Ruleset.selectLang` */
  lang: undefined as string | undefined,
  /**
   * Which translations an export carries: language name -> wanted.
   *
   * A language with no entry is on, so a fresh install exports every language a
   * pack has and an existing choice survives a pack the reader has not exported
   * before. Only the languages the dialog actually showed are written, which is
   * what keeps choosing "unselect all" on one pack from silently turning off a
   * language that some other pack is the only one to have.
   */
  exportLanguages: {} as { [lang: string]: boolean },
  /** Theme name, see `Theme` */
  theme: "dark" as Theme,
  /**
   * Which modpack storage UI to show: the simple tile list, or the raw table
   * with the unpacking tools. Only reachable once unlocked, see `devUnlocked`.
   */
  devView: false,
  /**
   * The developer tools are not advertised: typing the keyword into the search
   * box reveals the view switch. Once revealed they stay available, so the
   * button survives reloads like any other preference.
   */
  devUnlocked: false,
  /**
   * Choices the player made explicitly, remembered between articles and reloads.
   *
   * A member of this object is a statement about the reader rather than about
   * the article on screen, so it outlives the article: ask for "kneeling" once
   * and every armor that can kneel opens that way. Nothing is stored when the
   * player has not chosen, so the default of each picker is simply an absent
   * member rather than a value that has to be kept in step with that default.
   */
  selection: {} as Selections,

  /* ---- Transient UI state, not persisted ---- */
  /** Show the `#STR_` language keys instead of translations */
  revealed: false,
  /** Prevent `reveal()` from changing `revealed`, see `revealLock()` */
  revealLock: false,
  /** Top-left navigation dropdown */
  showDropdown: false,
  /** Language dropdown in the top navigation */
  showLanguagesDropdown: false,
  /** Modpack dropdown in the top navigation */
  showPacksDropdown: false,
  /** Query typed into the navbar search box, empty when not searching */
  searchQuery: "",
  /** Full text search results (article ids), undefined while not searching */
  found: undefined as string[] | undefined,
  /** The export dialog on the landing page is open */
  showExportDialog: false,
  /**
   * Question asked before an irreversible action, e.g. deleting a modpack,
   * see `askConfirm` and `ConfirmDialog`
   */
  confirmRequest: undefined as { message: string; action: () => void } | undefined,
};

/** Settings that used to live in the separate `localStorage.xpediaSettings` entry */
const legacySettingsKey = "xpediaSettings";
const legacyFields = ["hugeFont", "seeSide", "lang", "theme"];

Object.assign(state, load());

// The view switch is now hidden unless the keyword reveals it. A user who had
// already left the developer view on must not be trapped in it with no way back,
// so treat that as already unlocked.
if (state.devView) state.devUnlocked = true;

/** Keys of `state` persisted to localStorage */
export const savedFields = [
  "packName",
  "seeSide",
  "hugeFont",
  "alphabeticalSort",
  "showCountryLabels",
  "lang",
  "exportLanguages",
  "theme",
  "devView",
  "devUnlocked",
  "selection",
] as const;

export type StoreType = typeof state;

/**
 * The option a picker should show: the reader's remembered choice when the page
 * can offer it, otherwise the default.
 *
 * This is the whole rule of remembered selections, stated once. The remembered
 * value is looked up among the options actually on offer, so "it is not available
 * here" is simply a lookup that found nothing — an armor with no kneeling frames,
 * a flight that cannot be flown in the region last looked at. The picker then
 * falls back to its own default, and crucially the memory is not touched: nothing
 * here writes to `state.selection`, so the next armor that can kneel still opens
 * kneeling. Only `rememberSelection` writes, and only on the reader's own
 * gesture.
 *
 * An absent member is not the same as a remembered default. Picking "standing"
 * explicitly is a choice and stays one; a reader who never opened the picker has
 * chosen nothing, so that control's default is still free to change.
 */
export function remembered<T>(
  options: readonly T[],
  matches: (option: T) => boolean,
  fallback: T,
): T {
  return options.find(matches) ?? fallback;
}

/** Records a choice the reader made, for every later picker that can honour it */
export function rememberSelection<K extends SelectionKey>(key: K, value: Selections[K]) {
  update({ selection: { ...state.selection, [key]: value } });
}

/**
 * Reads remembered choices out of stored settings, dropping anything malformed.
 *
 * A stored value is fed straight into a control, so a wrong type would leave that
 * control with nothing lit and no obvious way to recover. Each field is therefore
 * checked against the shape it is supposed to have, and a field that fails is
 * simply forgotten — which is exactly the unset state, so the picker falls back
 * to its default and the reader can choose again.
 */
function readSelection(raw: unknown): Selections {
  const out: Selections = {};
  if (raw == null || typeof raw != "object" || Array.isArray(raw)) return out;
  // A stored blob is plain JSON data with no declared shape, so it is read as a
  // loose record here; each field is then checked against its own type below
  const stored = raw as { [key: string]: unknown };
  for (const key of ["region", "regionsMap", "pose"] as const)
    if (typeof stored[key] == "string" && stored[key]) out[key] = stored[key] as string;
  for (const key of ["direction", "turretDirection", "frame"] as const) {
    const value = stored[key];
    if (typeof value == "number" && Number.isInteger(value) && value >= 0) out[key] = value;
  }
  return out;
}

/**
 * The stored export language choices, keeping only the languages that are off.
 *
 * A missing entry means "on", which is what makes the default all-on without
 * listing every language the reader has ever seen. Dropping the `true` entries
 * keeps the blob from growing by one key per language per pack.
 */
function readExportLanguages(raw: unknown): { [lang: string]: boolean } {
  const out: { [lang: string]: boolean } = {};
  if (raw == null || typeof raw != "object" || Array.isArray(raw)) return out;
  for (const [lang, wanted] of Object.entries(raw as { [key: string]: unknown }))
    if (wanted === false) out[lang] = false;
  return out;
}

/** Set while the user has asked to abort the running slow process */
export let slowProcessCancelRequested = false;
/** Abort the running load/unpack, best effort: long stages check this flag */
export function requestCancelSlowProcess() {
  if (state.slowProcessDone) return;
  slowProcessCancelRequested = true;
  update({ slowProcessStatus: "Cancelling...", slowProcessCancellable: false });
}

export function resetSlowProcessCancel() {
  slowProcessCancelRequested = false;
}

export let article: Article | undefined, section: Section | undefined;

/**
 * The value `getSnapshot` hands out, and the listeners waiting for it to change.
 *
 * `state` is mutated in place and this is a copy of it, refreshed on every
 * `update()`. The copy is what a `useSyncExternalStore` consumer compares: same
 * object means "nothing changed", so it has to be a fresh object per update and
 * never `state` itself — the first render's snapshot is a copy for the same
 * reason as every later one.
 */
let storeSnapshot: StoreType = { ...state };
const onUpdate = new Set<Function>();
let savedJson: string | null = null;

function save() {
  // Writing on every update (including image cache fills) is wasteful, so only
  // persist when one of the saved fields actually changed.
  const data: { [key: string]: unknown } = {};
  for (const key of savedFields) data[key] = state[key];
  const json = JSON.stringify(data);
  if (json == savedJson) return;
  savedJson = json;
  localStorage.xpedia3 = json;
}

/**
 * Stored settings, before they are matched to `state`.
 *
 * The blob is plain JSON written by this module in an older shape each time the
 * fields were renamed, so it is read as a bag of unknown values and then migrated
 * key by key.
 */
type StoredSettings = { [key: string]: unknown };

function load(): StoredSettings {
  let data: StoredSettings;
  try {
    data = JSON.parse(localStorage.xpedia3 ?? "{}");
  } catch (e) {
    console.warn("Can't parse saved settings", e);
    data = {};
  }
  if (data == null || typeof data != "object" || Array.isArray(data)) data = {};

  // The three old sort flags are now one. Turn the new flag on if the user had
  // any of them enabled and has not saved a choice for it yet.
  if (
    data.alphabeticalSort === undefined &&
    (data.ordered || data.sortArticles || data.linksPageSorted)
  )
    data.alphabeticalSort = true;

  // `developerMode` meant "show the developer view" before the view switch got
  // hidden behind a keyword; the field is now `devView`
  if (data.devView === undefined && data.developerMode !== undefined)
    data.devView = data.developerMode;

  // Remembered choices are additive, so a reader upgrading from a build without
  // them has nothing stored and simply gets each control's default. The shape is
  // checked because a stored value is read straight into a control: a number
  // where a string belongs would leave a picker with nothing lit, and nothing
  // here can repair a choice that was meant in an older, different sense.
  data.selection = readSelection(data.selection);

  // Which translations an export carries. Only booleans are meaningful and a
  // stored entry for a language the pack no longer has is harmless, so this is
  // a shape check rather than a repair.
  data.exportLanguages = readExportLanguages(data.exportLanguages);

  // Migrate settings saved by the Svelte version, without overwriting
  // anything the new version has already stored.
  try {
    const legacy: StoredSettings = JSON.parse(localStorage[legacySettingsKey] ?? "null");
    if (legacy && typeof legacy == "object" && !Array.isArray(legacy)) {
      for (const key of legacyFields) {
        if (data[key] === undefined && legacy[key] !== undefined) data[key] = legacy[key];
      }
      if (data.alphabeticalSort === undefined && legacy.sortArticles) data.alphabeticalSort = true;
    }
  } catch (e) {
    console.warn("Can't parse legacy settings", e);
  }
  return data;
}

/** Assuming only UI will subscribe */
export const externalStore = {
  subscribe: (callback: () => void) => {
    // The wrapper is what is remembered, so the same value is removed again:
    // deleting the bare `callback` would delete nothing, and every unmount would
    // leave one more listener behind
    const listener = () => {
      callback();
    };
    onUpdate.add(listener);
    return () => {
      onUpdate.delete(listener);
    };
  },
  getSnapshot: () => storeSnapshot,
};

/**
 * Fields the article never reads, so changing one cannot change what it draws.
 *
 * `UI` re-renders on every update because it subscribes to the whole store, and
 * that is the price of one global store being cheap to write against. The article
 * subtree is the expensive half of that render, so it is memoised on
 * `articleRevision`, which `update()` bumps only when an update could have reached
 * it. An update is skippable exactly when every field it sets is listed here:
 * nothing under `ArticleComponent` reads these, so the article's output cannot
 * depend on them and React may keep the subtree it already has.
 *
 * The test is "does the article read it", not "is it visual" — the two do not
 * coincide. `theme` qualifies because the stylesheet colours the article, not
 * React, so nothing in the component tree reads the field; the dropdown flags and
 * `seeSide` qualify because they are navbar-only. `devView` and `imagePreview` do
 * not, because the landing page reads both.
 *
 * Listing a field the article *does* read would leave a stale page, so the rule
 * is inverted on purpose: an unlisted field re-renders. Adding a field later costs
 * a render at worst, never a bug.
 */
const articleBlindFields = new Set<string>([
  "theme",
  "seeSide",
  "showDropdown",
  "showPacksDropdown",
  "showLanguagesDropdown",
]);

/**
 * Bumped whenever an update can have changed what the article shows.
 *
 * The memo key of the article subtree in `UI`; see `articleBlindFields`.
 */
export let articleRevision = 0;

export function update(a?: Partial<StoreType>) {
  // Read before the assignment, so the test sees what the caller actually asked
  // for rather than the merged state
  const changed = a ? Object.keys(a) : undefined;
  if (a) Object.assign(state, a);
  state.count++;
  storeSnapshot = { ...state };
  article = state.article;
  section = state.section;
  // A change the article cannot see leaves it exactly as it was, so its element
  // keeps its identity and React skips that subtree altogether
  if (!changed || !changed.every((key) => articleBlindFields.has(key))) articleRevision++;
  save();
  onUpdate.forEach((f) => {
    f();
  });
}

/** Toggle/replace the "revealed" (raw language keys) mode */
export function reveal(on?: boolean) {
  if (state.revealLock) return;
  const value = on ?? !state.revealed;
  if (value !== state.revealed) update({ revealed: value });
}

/** Lock the "revealed" mode on/off, mirrors old `revealLock` store helper */
export function revealLock(on?: boolean) {
  const locked = on ?? !state.revealLock;
  update({ revealLock: locked, revealed: locked });
}

/** Dismisses the load status window without reporting anything */
export function closeStatus() {
  update({
    slowProcessStatus: "",
    slowProcessStage: "",
    slowProcessProgress: undefined,
    slowProcessDone: false,
    slowProcessError: false,
    slowProcessCancellable: false,
  });
}

/**
 * Asks for confirmation before an irreversible action. The question is modal;
 * `action` runs only when the user picks OK, see `ConfirmDialog`.
 */
export function askConfirm(message: string, action: () => void) {
  update({ confirmRequest: { message, action } });
}

/** Closes the confirmation window without running its action */
export function cancelConfirm() {
  if (state.confirmRequest) update({ confirmRequest: undefined });
}

/** Runs the confirmed action and closes the window */
export function acceptConfirm() {
  const request = state.confirmRequest;
  update({ confirmRequest: undefined });
  request?.action();
}

/**
 * Closes the status window a moment after a finished operation, so a load that
 * succeeded does not need a click to get out of the way. A failure keeps its
 * window: the message is the report of what went wrong.
 */
export function autoCloseStatus(delay = 1000) {
  const expected = state.slowProcessStatus;
  setTimeout(() => {
    if (state.slowProcessStatus === expected && state.slowProcessDone && !state.slowProcessError)
      closeStatus();
  }, delay);
}
