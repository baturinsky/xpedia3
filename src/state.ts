import Ruleset from "./rul/Ruleset";
import { Article } from './rul/Article';
import { Section } from './rul/Section';

export type PageName = "files" | "main";
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
  seeAllArmorVariants: false
};

Object.assign(state, load());

export let savedFields = ["packName", "ordered"];

export type StoreType = typeof state

export let article: Article | undefined, section: Section | undefined;

let storeSnapshot: StoreType = state, onUpdate = new Set<Function>();

function save() {
  localStorage.xpedia3 = JSON.stringify(Object.fromEntries(savedFields.map(k => [k, (state as any)[k]])))
}

function load() {
  let data = localStorage.xpedia3 ?? "{}";
  return JSON.parse(data)
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

