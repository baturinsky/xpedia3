import { loadData } from '../loadOld';
import { rul } from './Ruleset';


/**
 * One sprite definition from `extraSprites`, or one frame of an obs table
 * (`BIGOBS.PCK` and friends).
 *
 * `path` is the full archive path of the image. A ruleset value is relative to
 * the folder of the mod that declared it, so it is resolved through the same
 * resource index OpenXcom builds: the mod's own folder first, then the folders
 * of the other active mods, then the shared `common` folder.
 */
export class Sprite {
  id: string;
  _path: string|undefined;
  /** Mod whose ruleset declared this sprite */
  modDir?: string;

  constructor(raw: {
    type?: string; typeSingle?: string; dir?: string; path?: string;
    files?: { [key: string]: string } | string[];
    ind?: string | number; fileSingle?: string;
  }) {
    this.id = (raw.typeSingle ?? raw.type) as string;
    this.modDir = raw.dir;

    if (raw.path != null) {
      this._path = raw.path;
    } else if (raw.fileSingle) {
      this._path = raw.fileSingle;
    } else if (raw.files) {
      // A sprite set may define many frames; only the first is the pack's own
      // image, the rest are registered separately per index
      this._path = Array.isArray(raw.files)
        ? raw.files[0]
        : raw.files[Object.keys(raw.files)[0]];
    }

    if (!this.id || this._path == null)
      return;

    if (raw.ind != null) {
      let table = rul.obs[this.id] as any;
      if (table)
        table[raw.ind] = this;
    } else {
      rul.sprites[this.id] = this;
    }
  }

  /** Full archive path, matching the name the image was stored under */
  get path() {
    if (this._path == null)
      return undefined;
    let rel = this._path.replace(/^[/\\]+/, "");
    // Resolve to whatever file the ruleset actually provides: an override in a
    // later mod wins, and `common/` fills in artwork the mod itself omits
    let resolved = rul?.resourceMap?.[rel.toLowerCase()];
    if (resolved)
      return resolved;
    return this.modDir ? `${this.modDir}/${rel}` : rel;
  }

  async data() {
    let data = loadData(this.path as string);
    if (data != null)
      return data;

    else
      return this.path;
  }

}
