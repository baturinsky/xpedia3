import Ruleset from "./rul/Ruleset";
import { Article } from './rul/Article';
import { Section } from './rul/Section';

export type PageName = "files" | "main";
export type Theme = "light" | "dark";
export const dbVersion = 11;

export let state = {
  /** File unpacking status */
  slowProcessStatus: "",
  files: [] as
    {
      pack: string,
      assets: number,
      ruls: number,
      archive: number
    }[]
  ,
  /** The name of the file (modpack) currently watched */
  packName: undefined as string | undefined,
  section: undefined as Section | undefined,
  article: undefined as Article | undefined,
  rul: undefined as Ruleset | undefined,
  assets: new Set<string>(),
  imagePreview: "",
  images: {} as { [id: string]: any },
  count: 0,
  fontSize: 10,
  ordered: false,
  anal: false,
  seeAllArmorVariants: false,

  /* ---- Persisted UI preferences (formerly localStorage.xpediaSettings) ---- */
  /** Show the sidebar with section links */
  seeSide: true,
  /** Use a larger font (old `hugeFont`); actual size is derived in the UI */
  hugeFont: false,
  /** Sort article lists alphabetically instead of rule order */
  sortArticles: false,
  /** Selected language name, see `Ruleset.selectLang` */
  lang: undefined as string | undefined,
  /** Theme name, see `Theme` */
  theme: "dark" as Theme,
  /** Sort the links page (old `linksPageSorted`) */
  linksPageSorted: false,

  /* ---- Transient UI state, not persisted ---- */
  /** Show the `#STR_` language keys instead of translations */
  revealed: false,
  /** Prevent `reveal()` from changing `revealed`, see `revealLock()` */
  revealLock: false,
  /** Top-left navigation dropdown */
  showDropdown: false,
  /** Language dropdown in the top navigation */
  showLanguagesDropdown: false,
  /** Query typed into the navbar search box, empty when not searching */
  searchQuery: "",
  /** Full text search results (article ids), undefined while not searching */
  found: undefined as string[] | undefined
};

/** Settings that used to live in the separate `localStorage.xpediaSettings` entry */
const legacySettingsKey = "xpediaSettings";
const legacyFields = ["hugeFont", "seeSide", "sortArticles", "lang", "theme", "linksPageSorted"];

Object.assign(state, load());

/** Keys of `state` persisted to localStorage */
export let savedFields = [
  "packName",
  "ordered",
  "seeSide",
  "hugeFont",
  "sortArticles",
  "lang",
  "theme",
  "linksPageSorted",
];

export type StoreType = typeof state

export let article: Article | undefined, section: Section | undefined;

let storeSnapshot: StoreType = state, onUpdate = new Set<Function>();
let savedJson: string | null = null;

function save() {
  // Writing on every update (including image cache fills) is wasteful, so only
  // persist when one of the saved fields actually changed.
  let data: any = {};
  for (let key of savedFields)
    data[key] = (state as any)[key];
  let json = JSON.stringify(data);
  if (json == savedJson)
    return;
  savedJson = json;
  localStorage.xpedia3 = json;
}

function load() {
  let data: any;
  try {
    data = JSON.parse(localStorage.xpedia3 ?? "{}");
  } catch (e) {
    console.warn("Can't parse saved settings", e);
    data = {};
  }
  if (data == null || typeof data != "object")
    data = {};

  // Migrate settings saved by the Svelte version, without overwriting
  // anything the new version has already stored.
  try {
    let legacy = JSON.parse(localStorage[legacySettingsKey] ?? "null");
    if (legacy && typeof legacy == "object") {
      for (let key of legacyFields) {
        if (data[key] === undefined && legacy[key] !== undefined)
          data[key] = legacy[key];
      }
    }
  } catch (e) {
    console.warn("Can't parse legacy settings", e);
  }
  return data;
}

/** Assuming only UI will subscribe */
export const externalStore = {
  subscribe: (callback: () => void) => {
    onUpdate.add(() => {
      callback()
    });
    return () => {
      onUpdate.delete(callback);
    };
  },
  getSnapshot: () => storeSnapshot
}


export function update(a?: Partial<StoreType>) {
  if (a)
    Object.assign(state, a);
  state.count++;
  storeSnapshot = { ...state };
  article = state.article;
  section = state.section;
  save()
  onUpdate.forEach(f => f())
}

/** Toggle/replace the "revealed" (raw language keys) mode */
export function reveal(on?: boolean) {
  if (state.revealLock)
    return;
  let value = on ?? !state.revealed;
  if (value !== state.revealed)
    update({ revealed: value });
}

/** Lock the "revealed" mode on/off, mirrors old `revealLock` store helper */
export function revealLock(on?: boolean) {
  let locked = on ?? !state.revealLock;
  update({ revealLock: locked, revealed: locked });
}
