import { loadData } from '../util';
import { rul } from './Ruleset';


/**
 * `files` may be an array (frame order) or an index -> path map. Normalised to
 * the map form so a set of images is walked the same way either way.
 */
function frameMap(files?: { [key: string]: string } | string[]) {
  if (!files)
    return undefined;
  let pairs = Array.isArray(files)
    ? files.map((path, i) => [i, path] as [number, string])
    : Object.entries(files).map(([i, path]) => [+i, path] as [number, string]);
  return Object.fromEntries(pairs.filter(([, path]) => path != null));
}


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

  /**
   * How the sheet is cut into frames, straight from `ExtraSprites.h`.
   *
   * A subdivided set is one image holding a grid of `width/subX` by
   * `height/subY` cells, filled left to right then top to bottom. Unit sheets
   * are not a frame sequence in that grid: each cell is a body part, and the
   * game composes a figure from several of them (see `ui/UnitSprite.tsx`).
   *
   * `singleImage` sets ignore the subdivision and are a single picture.
   */
  subX?: number;
  subY?: number;
  width?: number;
  height?: number;
  singleImage?: boolean;

  /**
   * Start frame -> image path, as declared under `files`.
   *
   * A set may be spread over several images: each one is subdivided the same
   * way and its frames are assigned from its own start frame upwards.
   */
  frames?: { [frame: number]: string };

  constructor(raw: {
    type?: string; typeSingle?: string; dir?: string; path?: string;
    files?: { [key: string]: string } | string[];
    ind?: string | number; fileSingle?: string;
    subX?: number; subY?: number; width?: number; height?: number;
    singleImage?: boolean;
  }) {
    this.id = (raw.typeSingle ?? raw.type) as string;
    this.modDir = raw.dir;
    this.subX = raw.subX;
    this.subY = raw.subY;
    this.width = raw.width;
    this.height = raw.height;
    this.singleImage = raw.singleImage;
    this.frames = frameMap(raw.files);

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

  /** Columns and rows of cells in this sheet, when it is subdivided */
  get grid() {
    if (this.singleImage || !this.subX || !this.subY || !this.width || !this.height)
      return undefined;
    return { cols: Math.floor(this.width / this.subX), rows: Math.floor(this.height / this.subY) };
  }

  /**
   * Turns a ruleset image path into the archive path the file is stored under.
   *
   * Same lookup as `path`: a file supplied by a later mod wins, and `common/`
   * fills in artwork the mod itself omits.
   */
  resolveFramePath(path: string) {
    let rel = path.replace(/^[/\\]+/, "");
    let resolved = rul?.resourceMap?.[rel.toLowerCase()];
    if (resolved)
      return resolved;
    return this.modDir ? `${this.modDir}/${rel}` : rel;
  }

  /**
   * Where frame `frame` lives: the image that holds it and the cell rectangle
   * inside that image, in source pixels.
   *
   * A set can be split across images, each starting at its own index, so the
   * right image is the one with the greatest start frame that is not above the
   * requested frame; the cell then counts up from that start.
   */
  frameSource(frame: number) {
    let grid = this.grid;
    let frames = this.frames;
    if (!grid || !frames)
      return undefined;

    let starts = Object.keys(frames).map(Number).filter(start => start <= frame).sort((a, b) => a - b);
    let start = starts[starts.length - 1];
    if (start == null)
      return undefined;

    let path = frames[start];
    if (path == null)
      return undefined;

    let offset = frame - start;
    if (offset >= grid.cols * grid.rows)
      return undefined;

    return {
      path: this.resolveFramePath(path),
      x: (offset % grid.cols) * this.subX!,
      y: Math.floor(offset / grid.cols) * this.subY!,
      w: this.subX!,
      h: this.subY!,
      cols: grid.cols
    };
  }

}
