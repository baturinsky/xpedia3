/**
 * Exports each scenery object's voxel shape as a MagicaVoxel `.vox` file.
 *
 * The shape is exact: it is the game's own occupancy test from
 * `TileEngine.cpp` (`getVoxel` / `getTileModel`), not an approximation
 * fitted from sprites. Each MCD record holds 12 loft bytes (one per pair of
 * voxel layers, `MapDataSet.cpp` struct `MCD`, 62 bytes per record);
 * `LOFTEMPS.DAT` is a little-endian `Uint16` stream of 16-row shape
 * masks. Voxel `(x, y, z)` of an object is solid iff
 *
 *   shapes[loft[z / 2] * 16 + y] & (1 << (15 - x))   != 0
 *
 * (the engine mirrors x as `15 - voxel.x % 16`; the export keeps the file's
 * own coordinates, so the model is self-consistent).
 *
 * This is a curiosity tool, not part of the app: XPedia's stored pack data
 * deliberately excludes `TERRAIN/*.MCD` and `TERRAIN/LOFTEMPS.DAT`, so a
 * standalone scanner is the only place this decode lives.
 *
 * Usage: node scripts/export-vox.mjs <input-dir> [options]
 *   --out <dir>       Output directory (default: <input-dir>/vox)
 *   --loftemps <path> Shape table to use for every MCD. Without it the table
 *                     is searched next to each MCD (its own folder, TERRAIN,
 *                     then a sibling GEODATA folder).
 *   --color           Color each voxel from its sprite. Decodes the PCK next
 *                     to each MCD (32x40 frames, `SurfaceSet::loadPck`) and
 *                     samples the frame at the voxel's isometric projection,
 *                     which is how the game draws it: a voxel's mask covers
 *                     96-100% of the sprite's opaque pixels. The frame is the
 *                     record's Frame[0] (all 8 frame slots are one fixed
 *                     isometric view; only doors cycle through them), and the
 *                     object's yOffset raises the sample accordingly.
 *                     Palette indices resolve through --palette.
 *   --palette <path>  Battlescape palette (JASC-PAL text, raw 256x3 or ACT).
 *                     Without it the script searches the input tree for a
 *                     PAL_BATTLESCAPE.pal/.dat/.act and warns if none is
 *                     found (voxels then fall back to height-shaded grays).
 *   --all             Also export objects whose loft bytes are all zero
 *                     (they would render as empty files).
 *   --pack-file       Write one file with a PACK chunk holding every model,
 *                     instead of one file per object.
 *   --limit N         Stop after exporting N models (small test runs).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const RECORD = 62; // sizeof(MCD): Frame[8], LOFT[12], ScanG + fields, .. u62
const FRAME_AT = 0; // offset of Frame[8] inside the record
const LOFT_AT = 8; // offset of LOFT[12] inside the record
const YOFFSET_AT = 49; // P_Level: sprite vertical offset in pixels
const TILETYPE_AT = 53; // Tile_Type inside the record
const GRID = { x: 16, y: 16, z: 24 }; // voxel footprint of one tile part
const LAYERS = 12; // each loft layer covers two z levels
const SPRITE = { w: 32, h: 40 }; // MapDataSet's SurfaceSet(32, 40) frame size

// Isometric projection of the voxel grid into a sprite frame, exactly as
// the engine draws it (`Camera::convertVoxelToScreen`): sx = dx - dy +
// spriteWidth/2, sy = spriteHeight/2 + (dx+dy)/2 - dz, with the object's
// yOffset raising the sample because the sprite is drawn higher by that
// many pixels. The camera's heights come from BLANKS.PCK's frame (48 tall
// in classic XCOM), not from MapDataSet's 40 — measured silhouette IoU
// is 0.89 with height/2 = 24 and 0.65 with 20.
const projX = (x, y) => x - y + 16;
const projY = (x, y, z, yOffset) => Math.trunc((x + y) / 2) + 24 - z + yOffset;

// ---------------------------------------------------------------- parsing --

function parseArgs(argv) {
  const args = {
    input: undefined,
    out: undefined,
    loftemps: undefined,
    color: false,
    palette: undefined,
    all: false,
    packFile: false,
    limit: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.all = true;
    else if (a === "--pack-file") args.packFile = true;
    else if (a === "--color") args.color = true;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--loftemps") args.loftemps = argv[++i];
    else if (a === "--palette") args.palette = argv[++i];
    else if (a === "--limit") {
      args.limit = Number(argv[++i]);
      if (!Number.isInteger(args.limit) || args.limit <= 0)
        throw new Error(`invalid limit ${argv[i]}`);
    } else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
    else if (args.input !== undefined) throw new Error(`unexpected argument ${a}`);
    else args.input = a;
  }
  if (args.input === undefined) {
    throw new Error(
      "usage: node scripts/export-vox.mjs <input-dir> [--out <dir>] [--loftemps <path>] [--color] [--palette <path>] [--all] [--pack-file] [--limit N]",
    );
  }
  return args;
}

/** Little-endian Uint16 rows of a LOFTEMPS.DAT file. */
function loadShapes(file) {
  const data = readFileSync(file);
  if (data.length % 2 !== 0) throw new Error(`${file}: odd byte length, not a LOFTEMPS.DAT`);
  const shapes = new Uint16Array(data.length / 2);
  for (let i = 0; i < shapes.length; i++) shapes[i] = data.readUInt16LE(i * 2);
  return shapes;
}

/**
 * Where the shape table lives for one MCD, preferring game layouts:
 * the MCD's own folder, then a sibling TERRAIN or GEODATA folder.
 * Case-insensitive filesystems answer both spellings; Linux users can pass
 * --loftemps instead.
 */
function findLoftemps(mcdDir) {
  const candidates = [
    path.join(mcdDir, "LOFTEMPS.DAT"),
    path.join(mcdDir, "loftemps.dat"),
    path.join(mcdDir, "..", "TERRAIN", "LOFTEMPS.DAT"),
    path.join(mcdDir, "..", "TERRAIN", "loftemps.dat"),
    path.join(mcdDir, "..", "GEODATA", "LOFTEMPS.DAT"),
    path.join(mcdDir, "..", "GEODATA", "loftemps.dat"),
    path.join(mcdDir, "..", "..", "TERRAIN", "LOFTEMPS.DAT"),
    path.join(mcdDir, "..", "..", "GEODATA", "LOFTEMPS.DAT"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

/** One MCD file decoded to per-object voxel lists. */
function decodeMcd(file, shapes) {
  const data = readFileSync(file);
  const count = Math.floor(data.length / RECORD);
  if (data.length % RECORD !== 0) {
    console.warn(`  ${file}: ${data.length % RECORD} trailing byte(s) ignored`);
  }
  const objects = [];
  for (let obj = 0; obj < count; obj++) {
    const at = obj * RECORD;
    const loft = [];
    for (let layer = 0; layer < LAYERS; layer++) loft.push(data[at + LOFT_AT + layer]);
    const voxels = [];
    for (let z = 0; z < GRID.z; z++) {
      const shape = loft[Math.floor(z / 2)];
      if (shape * 16 >= shapes.length) continue; // loft index beyond the table
      for (let y = 0; y < GRID.y; y++) {
        const row = shapes[shape * 16 + y];
        if (row === 0) continue;
        for (let x = 0; x < GRID.x; x++) {
          if (row & (1 << (15 - x))) voxels.push([x, y, z]);
        }
      }
    }
    objects.push({
      index: obj,
      frame: data[at + FRAME_AT],
      yOffset: data[at + YOFFSET_AT],
      tileType: data[at + TILETYPE_AT],
      loft,
      voxels,
    });
  }
  return objects;
}

function findMcds(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.mcd$/i.test(entry)) found.push(full);
    }
  };
  walk(root);
  return found.sort((a, b) => a.localeCompare(b));
}

// -------------------------------------------------------- sprite and color --

/**
 * A dataset's PCK frames, decoded from the TAB count and the RLE stream
 * exactly as `SurfaceSet::loadPck` reads them: a leading count of blank
 * rows, then values until 255, 254 meaning that many transparent pixels.
 * A frame is a Uint8Array of palette indices, 0 transparent.
 */
function decodePck(pckPath, tabPath) {
  const tab = readFileSync(tabPath);
  const off = tab.readUInt32LE(0);
  const count = Math.floor(tab.length / (off !== 0 ? 2 : 4));
  const data = readFileSync(pckPath);
  const frames = [];
  let pos = 0;
  const next = () => data[pos++];
  for (let f = 0; f < count && pos < data.length; f++) {
    const img = new Uint8Array(SPRITE.w * SPRITE.h);
    let cur = next() * SPRITE.w;
    let v;
    while (pos < data.length && (v = next()) !== 255) {
      if (v === 254) {
        const n = next();
        cur = Math.min(img.length, cur + n);
      } else {
        if (cur < img.length) img[cur++] = v;
      }
    }
    frames.push(img);
  }
  return frames;
}

/** The PCK+TAB next to one MCD, or undefined when the pack ships none. */
function findPck(mcdPath) {
  const stem = mcdPath.replace(/\.mcd$/i, "");
  const pck = [stem + ".PCK", stem + ".pck"].find((c) => existsSync(c));
  const tab = [stem + ".TAB", stem + ".tab"].find((c) => existsSync(c));
  return pck && tab ? { pck, tab } : undefined;
}

/** 256 RGB triplets from a JASC-PAL text file or a raw/ACT binary one. */
function loadPalette(file) {
  const text = readFileSync(file, "utf8");
  if (text.startsWith("JASC-PAL")) {
    const rgb = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^\d+\s+\d+\s+\d+/.test(l))
      .map((l) => l.split(/\s+/).slice(0, 3).map(Number));
    if (rgb.length === 0) throw new Error(`${file}: no palette rows parsed`);
    return rgb.slice(0, 256);
  }
  const data = readFileSync(file);
  const raw = data.length >= 772 ? data.subarray(4) : data; // ACT drops its header
  if (raw.length < 768) throw new Error(`${file}: expected 768 or 772 bytes, got ${data.length}`);
  const rgb = [];
  for (let i = 0; i < 256; i++) rgb.push([raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]]);
  return rgb;
}

/** The first PAL_BATTLESCAPE palette near a tree root, or undefined. */
function findPalette(root) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full, depth + 1);
      else if (/^PAL_BATTLESCAPE\.(pal|dat|act)$/i.test(entry)) found.push(full);
    }
  };
  // The palette ships in the game root's Palettes folder (OXCE uses
  // common/Palettes/<format>/...), so search this tree and its parents.
  let dir = root;
  for (let up = 0; up < 4 && dir; up++) {
    for (const sub of [path.join(dir, "Palettes"), path.join(dir, "common", "Palettes")]) {
      if (existsSync(sub)) walk(sub, 0);
    }
    dir = path.dirname(dir);
  }
  return found.sort((a, b) => a.localeCompare(b))[0];
}

/**
 * Per-voxel palette indices for one object, sampled from its sprite frame
 * through the isometric projection. The sprite is three face regions — the
 * top rhombus (faces with normal +Z), the right side (faces with normal
 * +X) and the front side (faces with normal +Y) — so a voxel's color is
 * not sampled at its center but at the face it exposes: a voxel with
 * nothing above it samples its top face (z+1, one pixel higher, inside
 * the rhombus) even if its center would land on the rhombus's 1px side
 * border; top wins over side for corner voxels, since a .vox voxel holds
 * only one color. Side voxels keep center sampling, which already lands
 * inside their own polygon. A voxel whose sampled pixel is transparent
 * (an edge the art doesn't quite reach) inherits the color of the nearest
 * opaque pixel toward the viewer in its screen column, so the model reads
 * as the surface the player sees rather than punching holes.
 * Returns one RGB per voxel, in voxel order.
 */
function colorObject(voxels, frame, yOffset, palette) {
  if (!frame || !palette) return voxels.map((v) => heightGray(v[2]));
  const colors = new Array(voxels.length);
  const occupied = new Set(voxels.map(([x, y, z]) => x + y * GRID.x + z * GRID.x * GRID.y));
  const column = [];
  for (let sx = 0; sx < SPRITE.w; sx++) column.push(new Array(SPRITE.h).fill(-1));
  for (let i = 0; i < frame.length; i++) {
    if (frame[i] !== 0) column[i % SPRITE.w][Math.floor(i / SPRITE.w)] = frame[i];
  }
  for (let i = 0; i < voxels.length; i++) {
    const [x, y, z] = voxels[i];
    const sx = projX(x, y);
    // Empty voxel above => this is a top face; sample its top plane (z+1).
    const topFace = !occupied.has(x + y * GRID.x + (z + 1) * GRID.x * GRID.y);
    const sy = topFace ? projY(x, y, z + 1, yOffset) : projY(x, y, z, yOffset);
    let idx = -1;
    // Bounded searches: a large yOffset can push sy outside the frame.
    const towardViewer = Math.max(0, Math.min(SPRITE.h - 1, sy));
    const away = Math.max(0, Math.min(SPRITE.h - 1, sy));
    for (let row = towardViewer; row < SPRITE.h; row++) {
      const px = column[sx]?.[row] ?? -1;
      if (px > 0) {
        idx = px;
        break;
      }
    }
    if (idx < 0) {
      for (let row = away; row >= 0; row--) {
        const px = column[sx]?.[row] ?? -1;
        if (px > 0) {
          idx = px;
          break;
        }
      }
    }
    colors[i] = idx > 0 && palette[idx] ? palette[idx] : heightGray(z);
  }
  return colors;
}

/** The pre-color shade by height, reused as the fallback for unpainted voxels. */
function heightGray(z) {
  const gray = Math.round(48 + (z / (GRID.z - 1)) * 176);
  return [gray, gray, gray];
}

// ------------------------------------------------------------------- vox --

function chunk(id, content, children) {
  const header = Buffer.alloc(12);
  header.write(id, 0, 4, "ascii");
  header.writeUInt32LE(content.length, 4);
  header.writeUInt32LE(children.length, 8);
  return Buffer.concat([header, content, children]);
}

/** One model: SIZE (16x16x24) + XYZI voxels + RGBA palette. */
function modelChunk(voxels, colors) {
  const size = Buffer.alloc(12);
  size.writeUInt32LE(GRID.x, 0);
  size.writeUInt32LE(GRID.y, 4);
  size.writeUInt32LE(GRID.z, 8);

  // The model's own palette: the distinct colors in first-use order, with
  // any overflow snapped to the nearest entry already chosen.
  const key = (c) => c.join(",");
  const palette = [];
  const indexOf = new Map();
  const snappedOf = new Map();
  const pick = (color) => {
    const k = key(color);
    if (indexOf.has(k)) return indexOf.get(k);
    if (snappedOf.has(k)) return snappedOf.get(k);
    if (palette.length < 255) {
      indexOf.set(k, palette.length);
      palette.push(color);
      return palette.length - 1;
    }
    let best = 0;
    let bestDist = Infinity;
    palette.forEach((c, i) => {
      const d = (c[0] - color[0]) ** 2 + (c[1] - color[1]) ** 2 + (c[2] - color[2]) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    snappedOf.set(k, best);
    return best;
  };

  const xyzi = Buffer.alloc(4 + voxels.length * 4);
  xyzi.writeUInt32LE(voxels.length, 0);
  for (let i = 0; i < voxels.length; i++) {
    const [x, y, z] = voxels[i];
    const at = 4 + i * 4;
    xyzi[at] = x;
    xyzi[at + 1] = y;
    xyzi[at + 2] = z;
    xyzi[at + 3] = 1 + pick(colors[i]);
  }

  const rgba = Buffer.alloc(1024);
  palette.forEach((c, i) => {
    rgba[(1 + i) * 4] = c[0];
    rgba[(1 + i) * 4 + 1] = c[1];
    rgba[(1 + i) * 4 + 2] = c[2];
    rgba[(1 + i) * 4 + 3] = 255;
  });
  // entry 0 stays unused; other unused entries stay black and opaque

  return Buffer.concat([
    chunk("SIZE", size, Buffer.alloc(0)),
    chunk("XYZI", xyzi, Buffer.alloc(0)),
    chunk("RGBA", rgba, Buffer.alloc(0)),
  ]);
}

function countBuf(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

/**
 * A whole `.vox` file. With more than one model (only `--pack-file` does
 * that) the models travel as children of a PACK chunk, per the format;
 * otherwise the single model's SIZE/XYZI/RGBA chunks are MAIN's children.
 */
function writeVoxFile(models, pack) {
  const header = Buffer.alloc(8);
  header.write("VOX ", 0, 4, "ascii");
  header.writeUInt32LE(150, 4);
  const modelsBuf = Buffer.concat(models.map((m) => modelChunk(m.voxels, m.colors)));
  const children = pack
    ? Buffer.concat([chunk("PACK", countBuf(models.length), modelsBuf)])
    : modelsBuf;
  return Buffer.concat([header, chunk("MAIN", Buffer.alloc(0), children)]);
}

// ------------------------------------------------------------------ main --

const args = parseArgs(process.argv.slice(2));
const rootDir = path.resolve(args.input);
if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
  throw new Error(`not a directory: ${args.input}`);
}

const outDir = args.out === undefined ? path.join(rootDir, "vox") : path.resolve(args.out);
mkdirSync(outDir, { recursive: true });

const mcds = findMcds(rootDir);
if (mcds.length === 0) throw new Error(`no .MCD files under ${rootDir}`);

const explicitShapes =
  args.loftemps === undefined ? undefined : loadShapes(path.resolve(args.loftemps));
const explicitPalette =
  args.palette === undefined ? undefined : loadPalette(path.resolve(args.palette));
let paletteWarned = false;
let explicitPaletteCache;
let paletteSearched = false;
const paletteFor = (root) => {
  if (!args.color) return undefined;
  if (explicitPalette) return explicitPalette;
  if (!paletteSearched) {
    paletteSearched = true;
    explicitPaletteCache = findPalette(root);
    if (explicitPaletteCache === undefined && !paletteWarned) {
      paletteWarned = true;
      console.warn(
        `  no PAL_BATTLESCAPE found from ${root}; voxels fall back to height grays (or pass --palette)`,
      );
    }
  }
  if (explicitPaletteCache === undefined) return undefined;
  if (!shapesCache.has(explicitPaletteCache))
    shapesCache.set(explicitPaletteCache, loadPalette(explicitPaletteCache));
  return shapesCache.get(explicitPaletteCache);
};

const frameCache = new Map();
const pckFor = (mcdPath) => {
  if (!args.color) return undefined;
  const found = findPck(mcdPath);
  if (found === undefined) return undefined;
  if (!frameCache.has(found.pck)) frameCache.set(found.pck, decodePck(found.pck, found.tab));
  return frameCache.get(found.pck);
};
const shapesCache = new Map();
const shapesFor = (mcdDir) => {
  if (explicitShapes) return explicitShapes;
  const file = findLoftemps(mcdDir);
  if (file === undefined) {
    throw new Error(`no LOFTEMPS.DAT found for ${mcdDir}; pass --loftemps <path>`);
  }
  if (!shapesCache.has(file)) shapesCache.set(file, loadShapes(file));
  return shapesCache.get(file);
};

let exported = 0;
let skipped = 0;
let totalVoxels = 0;
const usedNames = new Set();
const packModels = [];

const uniqueName = (base) => {
  let name = base;
  let n = 2;
  while (usedNames.has(name)) name = `${base.replace(/\.vox$/, "")} (${n++}).vox`;
  usedNames.add(name);
  return name;
};

for (const mcd of mcds) {
  if (args.limit !== undefined && exported >= args.limit) break;
  const dataset = path.basename(mcd).replace(/\.mcd$/i, "");
  const shapes = shapesFor(path.dirname(mcd));
  const objects = decodeMcd(mcd, shapes);
  const frames = args.color ? pckFor(mcd) : undefined;
  const palette = args.color ? paletteFor(rootDir) : undefined;
  for (const obj of objects) {
    if (args.limit !== undefined && exported >= args.limit) break;
    if (obj.voxels.length === 0 && !args.all) {
      skipped++;
      continue;
    }
    const colors = args.color
      ? colorObject(obj.voxels, frames?.[obj.frame] ?? frames?.[0], obj.yOffset, palette)
      : obj.voxels.map((v) => heightGray(v[2]));
    const model = { voxels: obj.voxels, colors };
    if (args.packFile) {
      packModels.push(model);
    } else {
      const name = uniqueName(`${dataset}_${obj.index}_t${obj.tileType}.vox`);
      writeFileSync(path.join(outDir, name), writeVoxFile([model], false));
    }
    exported++;
    totalVoxels += obj.voxels.length;
  }
  const withVoxels = objects.filter((o) => o.voxels.length > 0).length;
  console.log(`${dataset}: ${objects.length} object(s), ${withVoxels} with voxels`);
}

if (args.packFile) {
  const name = uniqueName(`${path.basename(rootDir)}.vox`);
  writeFileSync(path.join(outDir, name), writeVoxFile(packModels, true));
  console.log(`PACK file: ${name} with ${packModels.length} model(s)`);
}

console.log(
  `exported ${exported} model(s), skipped ${skipped} empty, ${totalVoxels} voxels total -> ${outDir}`,
);
