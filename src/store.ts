import Ruleset from "./rul/Ruleset";
import { Article } from './rul/Article';
import { Section } from './rul/Section';

export type PageName = "files" | "main";

export let store = {
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
  packName: null as string,
  section: null as Section,
  article: null as Article,
  rul: null as Ruleset,
  assets: new Set<string>(),
  imagePreview: "",
  images: {} as { [id: string]: any },
  count: 0,
  fontSize: 10,
  ordered: false
};

Object.assign(store, load());

export let savedFields = ["packName", "ordered"];

export type StoreType = typeof store

export let article: Article, section: Section;

let storeSnapshot: StoreType = store, onUpdate = new Set<Function>();

function save() {
  localStorage.xpedia3 = JSON.stringify(Object.fromEntries(savedFields.map(k => [k, store[k]])))
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
      console.log(article.title, section.title);
    });
    return () => {
      onUpdate.delete(callback);
    };
  },
  getSnapshot: () => storeSnapshot
}


export function update(a?: Partial<StoreType>) {
  if (a)
    Object.assign(store, a);
  store.count++;
  storeSnapshot = { ...store };
  article = store.article;
  section = store.section;
  save()
  onUpdate.forEach(f => f())
}

