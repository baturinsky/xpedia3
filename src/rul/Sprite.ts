import { loadData } from '../loadOld';
import { obsTables, rul } from './Ruleset';


export class Sprite {
  id: string;
  _path: string;
  modDir: string;

  constructor(raw: { type?: string; typeSingle?: string; dir: string; files?: string[]; ind?: string; fileSingle?: string; }) {
    //if(raw.dir != "Dioxine_XPiratez")      debugger
    this.id = raw.typeSingle ?? raw.type;
    this.modDir = raw.dir;

    if (raw.files) {
      this._path = raw.files[0];
      if (obsTables[this.id]) {
        for (let [k, v] of Object.entries(raw.files)) {
          new Sprite({ dir: this.modDir, type: obsTables[this.id], ind: k, fileSingle: v });
        }
      }
    }
    if (raw.fileSingle) this._path = raw.fileSingle;
    if (raw.ind) {
      rul.obs[this.id][raw.ind] = this;
    } else {
      rul.sprites[this.id] = this;
    }
  }

  get path() {
    return `${this.modDir}/${this._path}`;
    /*let path = this.modDir + this._path;
    if (globalThis["gameDir"] && path[0] == "/") {
      path = globalThis["gameDir"] + path;
    } else if (globalThis["xpediaDir"] && path[0] != "/") {
      path = globalThis["xpediaDir"] + path;
    }
    return path;*/
  }

  async data() {
    let data = loadData(this.path);
    if (data != null)
      return data;

    else
      return this.path;
  }

}
