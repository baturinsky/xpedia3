import { useEffect, useId, useMemo, useRef, useState } from "react";
import { rul } from "../rul/Ruleset";
import type { Sprite } from "../rul/Sprite";
import { usePixelRatio, useSpriteImages, spriteScale } from "./components";

/**
 * A unit drawn out of its `spriteSheet`.
 *
 * A unit sheet is not a frame sequence — it is an atlas of body parts, and the
 * game assembles a figure out of several cells. Which cells, and in what order,
 * is decided by the armor's `drawingRoutine`.
 *
 * The ones implemented here are taken from `UnitSprite.cpp` in the OXCE sources
 * so the preview matches the game rather than approximating it:
 *
 * - routine 0 (and its aliases 10, 13, 14, 15) — the ordinary humanoid figure
 *   of legs, torso and two arms, by far the most common;
 * - routine 1 — floaters: arms and torso only, on their own frame numbers, and
 *   a walk cycle squeezed onto five pictures per facing;
 * - routine 2 — tracked and hovering tanks: a 2x2 unit with an optional turret;
 * - routines 3 and 22 — cyberdiscs and helicopters: a 2x2 unit with an animated
 *   propulsion, below the hull for a disc and above it for a rotor;
 * - routine 4 — civilians and animals: one sprite per facing;
 * - routine 5 — sectopods and reapers: four parts of a 2x2 unit;
 * - routine 6 — snakemen: legs, torso and two arms, but on different frames;
 * - routine 8 — silacoids: one blob that pulses, with no facing;
 * - routines 9 and 16 — celatids and biodrones: one picture per step of a
 *   cycle, with no facing;
 * - routines 12, 20 and 21 — hallucinoids, triscenes and xarquids: four tiles
 *   that each carry their own picture;
 * - routine 19 — tentaculats, and the turrets that borrow the routine: one
 *   picture per facing, and a second one for walking.
 *
 * Routines 7, 11 and 17 have a model of their own that is not implemented, so
 * their sheets are still shown as a plain image.
 *
 * The numbers below are frame indices into the sheet, not sizes.
 */

/** Parts of a standing unit, each 8 frames wide: one per facing */
const LARM_STAND = 0;
const RARM_STAND = 8;
const LEGS_STAND = 16;
const LEGS_KNEEL = 24;
const TORSO = 32;

/** Walk cycle: 24 frames per facing, 8 phases each */
const LARM_WALK = 40;
const RARM_WALK = 48;
const LEGS_WALK = 56;
const WALK_STRIDE = 24;
const WALK_PHASES = 8;

/** How the torso bobs up and down while walking */
const YOFF_WALK = [1, 0, -1, 0, 1, 0, -1, 0];
const MUTON_YOFF_WALK = [1, 1, 0, 0, 1, 1, 0, 0];
const AQUATOID_YOFF_WALK = [1, 0, 0, 1, 2, 1, 0, 0];

/** Routine 6 bobs its torso and arms, and leans them into the step */
const SNAKEMAN_YOFF_WALK = [3, 3, 2, 1, 0, 0, 1, 2];
const SNAKEMAN_XOFF_A = [0, 0, 1, 2, 3, 3, 2, 1];
const SNAKEMAN_XOFF_B = [0, 0, -1, -2, -3, -3, -2, -1];

/** How a hovering tank's hull sways, which the gun follows */
const TANK_SWAY_X = [-2, -7, -5, 0, 5, 7, 2, 0];
const TANK_SWAY_Y = [-1, -3, -4, -5, -4, -3, -1, -1];

/** OpenXcom's `DEFAULT_ANIM_SPEED`, in milliseconds per frame */
const ANIM_SPEED = 100;

/**
 * Unit sprites are drawn on a double-width canvas so a weapon fits in the hand,
 * and the body is drawn 16 pixels in (`offXSprite` in the sources). Without the
 * margin the arm holding a weapon is clipped.
 */
const SPRITE_OFFSET = 16;

/**
 * One floor tile, in pixels.
 *
 * A unit of `size` 2 covers four tiles: the tiles are drawn as separate sprites
 * so each can be masked against its own walls, and the pedia joins them back
 * into one picture. `Camera::convertMapToScreen` places a tile at
 * `x·(w/2) − y·(w/2), (x+y)·(w/4)`, which these are the halves and quarters of.
 */
const TILE_W = 32;
const TILE_H = 16;

export type UnitView = {
  /** Sheet in `rul.sprites`, e.g. `PIR_22.PCK` */
  sheet: string;
  /** Armor's `drawingRoutine` */
  routine?: number;
  /** Use the female torso, as the game does for female soldiers */
  female?: boolean;
  /** Armor's `deathFrames`; how long the collapsing animation runs */
  deathFrames?: number;
  /**
   * Armor's `movementType`. A tank that flies draws a second, animated body;
   * see `MovementType` in `MapData.h` (`MT_FLY` is 1).
   */
  movementType?: number;
  /** Armor's turret type, `-1` or absent when it has no turret */
  turret?: number;
  /** Armor's `size`: 2 means the unit covers four tiles and is drawn in parts */
  size?: number;
};

/** Routines `drawRoutine0` also draws, per the routine table in `UnitSprite.cpp` */
const ROUTINE0_ALIASES: { [routine: number]: number } = { 10: 0, 13: 0, 14: 0, 15: 0 };

/**
 * The frames that differ between the routines `drawRoutine0` serves.
 *
 * Only the torso, the death sequence and the floating legs move between them;
 * the standing and walking parts are shared. The values are the branches at the
 * top of `drawRoutine0`.
 */
type RoutineFrames = {
  /** First frame of the collapsing sequence */
  die: number;
  /** First frame of the torso, male and female */
  maleTorso: number;
  femaleTorso: number;
  /** First frame of the legs drawn while flying */
  legsFloat: number;
  /** How far the body drops when kneeling (`offYKneel`) */
  kneelY: number;
  /** Vertical bob of the torso while walking */
  yoffWalk: number[];
};

function routineFrames(routine: number): RoutineFrames {
  if (routine <= 10)
    return {
      die: 264, maleTorso: TORSO, femaleTorso: 267, legsFloat: 275, kneelY: 4,
      // A muton carries a wide charge on its back and bobs differently
      yoffWalk: routine == 10 ? MUTON_YOFF_WALK : YOFF_WALK
    };
  if (routine == 13)
    // Aquanauts on land. The sources keep a second table for the underwater
    // `_helmet` layer, which the pedia has no way to tell apart from this one.
    return {
      die: 256, maleTorso: 270, femaleTorso: 262, legsFloat: 294, kneelY: 5,
      // TFTD torsos are stubby, so they sit one pixel lower
      yoffWalk: YOFF_WALK.map(v => v + 1)
    };
  if (routine == 15)
    return {
      die: 256, maleTorso: TORSO, femaleTorso: 262, legsFloat: 294, kneelY: 4,
      yoffWalk: AQUATOID_YOFF_WALK
    };
  // Routine 14, and anything else that ends up on the TFTD table
  return {
    die: 256, maleTorso: TORSO, femaleTorso: 262, legsFloat: 294, kneelY: 4,
    yoffWalk: YOFF_WALK.map(v => v + 1)
  };
}

/** The poses a sheet can be drawn in */
export type UnitPose = "standing" | "walking" | "kneeling" | "floating" | "dying";

/** Poses in the order they are offered, with the label used by the picker */
export const UNIT_POSES: { id: UnitPose, label: string }[] = [
  { id: "standing", label: "Standing" },
  { id: "walking", label: "Walking" },
  { id: "kneeling", label: "Kneeling" },
  { id: "floating", label: "Floating" },
  { id: "dying", label: "Dying" }
];

/**
 * Poses that follow the facing. A collapsing unit is drawn as one frame that
 * already contains the pose, so the game shows it from a single side.
 */
const UNIT_DIRECTIONAL: UnitPose[] = ["standing", "walking", "kneeling", "floating"];

/**
 * Facings, numbered the way the game numbers them: `directionToVector` starts
 * at north and goes clockwise, so 0 is the far side and 4 the near side.
 *
 * The battle map is isometric, so these do not point the way their number
 * suggests on screen: `Camera::convertMapToScreen` maps tile north (0,-1) to the
 * upper right, and the whole ring is turned 45 degrees. North is therefore up
 * and to the right, and it is frame 3 - south - that faces the viewer. The
 * compass in `style.css` places the buttons along the same tilt.
 *
 * `short` is what the compass shows, `title` spells the meaning out.
 */
export const UNIT_DIRECTIONS: { dir: number, short: string, title: string }[] = [
  { dir: 0, short: "N", title: "North — up and to the right" },
  { dir: 1, short: "NE", title: "North-east — to the right" },
  { dir: 2, short: "E", title: "East — down and to the right" },
  { dir: 3, short: "SE", title: "South-east — down, facing the viewer" },
  { dir: 4, short: "S", title: "South — down and to the left" },
  { dir: 5, short: "SW", title: "South-west — to the left" },
  { dir: 6, short: "W", title: "West — up and to the left" },
  { dir: 7, short: "NW", title: "North-west — up, seen from behind" }
];

/** `MT_FLY` in `MapData.h`: the unit hovers rather than walks */
const MT_FLY = 1;

/**
 * Routines that draw a unit as four tiles whatever its `size` says.
 *
 * A tank splits into four tiles because it is two tiles across on the map, but
 * a sectopod or a cyberdisc does the same because its single picture is spread
 * over four cells of the sheet. `size` is not consulted for these.
 */
const FOUR_TILE_ROUTINES = [3, 5, 12, 20, 21, 22];

/**
 * Drawing order depends on the facing: seen from behind the arms go behind the
 * body, from the front in front of it. Taken from the `switch (unitDir)` at the
 * end of `drawRoutine0`; `l`/`r` are the arms, `g` the legs, `t` the torso.
 */
const DRAW_ORDER: { [dir: number]: string[] } = {
  0: ["l", "g", "t", "r"],
  1: ["l", "g", "t", "r"],
  2: ["l", "g", "t", "r"],
  3: ["g", "t", "l", "r"],
  4: ["g", "r", "t", "l"],
  5: ["r", "g", "t", "l"],
  6: ["r", "g", "t", "l"],
  7: ["l", "r", "g", "t"]
};

/**
 * Routine 6 ('snakemen') has its own table: `drawRoutine6` puts the right arm
 * behind the legs when the unit is seen from the south, where routine 0 puts
 * the legs first. Taken from the `switch (unitDir)` at the end of it.
 */
const DRAW_ORDER_6: { [dir: number]: string[] } = {
  0: ["l", "g", "t", "r"],
  1: ["l", "g", "t", "r"],
  2: ["l", "g", "t", "r"],
  3: ["g", "t", "l", "r"],
  4: ["r", "g", "t", "l"],
  5: ["r", "g", "t", "l"],
  6: ["r", "g", "t", "l"],
  7: ["l", "r", "g", "t"]
};

/**
 * A floater has no legs, so its order only covers the two arms and the torso.
 * Taken from the `switch (unitDir)` at the end of `drawRoutine1`.
 */
const DRAW_ORDER_1: { [dir: number]: string[] } = {
  0: ["l", "t", "r"],
  1: ["l", "t", "r"],
  2: ["l", "t", "r"],
  3: ["t", "l", "r"],
  4: ["t", "l", "r"],
  5: ["r", "t", "l"],
  6: ["r", "t", "l"],
  7: ["r", "l", "t"]
};

/** Which drawing routine an armor uses, when the pedia can draw it */
type RoutineKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 12 | 16 | 19 | 20 | 21 | 22;

/**
 * `drawRoutine0` also serves 10, 13, 14 and 15, so they share its model. The
 * rest of the numbering is one routine per picture: 22 is the same function as
 * 3 with the propulsion drawn in front of the hull instead of behind it.
 */
function routineKind(routine?: number): RoutineKind | undefined {
  let n = routine ?? 0;
  if (n == 0 || n in ROUTINE0_ALIASES)
    return 0;
  if ([1, 2, 3, 4, 5, 6, 8, 9, 12, 16, 19, 20, 21, 22].includes(n))
    return n as RoutineKind;
  return undefined;
}

/** How many floor tiles a unit covers, and so how many parts it is drawn from */
function unitTiles(view: UnitView) {
  let kind = routineKind(view.routine);
  // Routines with a two-by-two picture always use all four cells
  if (kind != null && FOUR_TILE_ROUTINES.includes(kind))
    return 2;
  // A tank is only split when it is over two tiles; a one-tile pillbox is not
  if (kind != 2)
    return 1;
  return view.size == 2 ? 2 : 1;
}

/**
 * Where a part of a multi-tile unit sits, relative to the unit's own tile.
 *
 * Part 0 is the back tile, 1 the right, 2 the left and 3 the front, which is
 * `part = dx + dy*2` in `Map::drawUnit`. The screen offsets are the isometric
 * basis from `Camera::convertMapToScreen`.
 */
function partOffset(tile: number) {
  let x = tile & 1;
  let y = tile >> 1;
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) };
}

/** True when this sheet can be composed into a figure */
export function canComposeUnit(sheet?: string, routine?: number) {
  let sprite = sheet ? rul?.sprites[sheet] : undefined;
  if (!sprite?.grid || !sprite.subX || !sprite.subY)
    return false;
  return routine == null || routineKind(+routine) != null;
}

/**
 * Routine 1: floaters.
 *
 * The humanoid figure again, but on its own frame numbers, with the arms
 * swapped between the two sides and no knees or floating legs to speak of. The
 * one real difference is the walk: a floater has only five pictures per facing
 * where a soldier has eight, so the eight steps of the cycle are squeezed onto
 * them by `walkPhase / 1.6`, which lands as 0, 0, 1, 1, 2, 3, 3, 4.
 */
function floaterFrame(view: UnitView, pose: UnitPose, dir: number, phase: number): PoseFrame {
  if (pose == "dying")
    return { parts: { t: { frame: 64 + phase } }, order: ["t"] };

  let order = DRAW_ORDER_1[dir];
  if (pose == "walking")
    return {
      parts: {
        // A floater's arms do not walk: only the torso has a walk sequence
        l: { frame: 8 + dir },
        r: { frame: 0 + dir },
        t: { frame: 24 + 5 * dir + Math.floor(phase / 1.6) }
      },
      order
    };

  return {
    parts: {
      l: { frame: 8 + dir },
      r: { frame: 0 + dir },
      t: { frame: 16 + dir }
    },
    order
  };
}

/**
 * Routine 19: tentaculats, and the turrets and drones that borrow the routine.
 *
 * One picture per facing, and a second set of them for the walk. These units do
 * not move their parts, so the facing is the whole animation.
 */
function tentaculatFrame(pose: UnitPose, dir: number, phase: number): PoseFrame {
  if (pose == "dying")
    return { parts: { t: { frame: 16 + phase } }, order: ["t"] };
  if (pose == "walking")
    return { parts: { t: { frame: 8 + dir } }, order: ["t"] };
  return { parts: { t: { frame: 0 + dir } }, order: ["t"] };
}

/**
 * Routine 20: triscenes. Four tiles, each with five pictures of its own laid
 * out along the row for a facing, and a four-step walk on top of that.
 */
function trisceneFrame(dir: number, phase: number, walking: boolean): PoseFrame {
  let parts: { [part: string]: PosePart } = {};
  let partTiles: { [part: string]: number } = {};
  let order: string[] = [];
  for (let tile = 0; tile < 4; tile++) {
    let name = "p" + tile;
    // `phase` is the walk picture itself, 0-3, so a standing unit holds picture 0
    parts[name] = { frame: tile * 5 + (walking ? phase : 0) + 20 * dir };
    partTiles[name] = tile;
    order.push(name);
  }
  return { parts, order, tiles: partTiles };
}

/**
 * Routine 21: xarquids. Four tiles, each turned through eight facings of four
 * pictures, which animate on their own.
 */
function xarquidFrame(dir: number, phase: number): PoseFrame {
  let parts: { [part: string]: PosePart } = {};
  let partTiles: { [part: string]: number } = {};
  let order: string[] = [];
  for (let tile = 0; tile < 4; tile++) {
    let name = "p" + tile;
    parts[name] = { frame: tile * 4 + dir * 16 + phase };
    partTiles[name] = tile;
    order.push(name);
  }
  return { parts, order, tiles: partTiles };
}

/**
 * Routine 12: hallucinoids. Four tiles that each turn through eight pictures
 * of their own, with no facing and no walk.
 */
function fourTileCycleFrame(phase: number): PoseFrame {
  let parts: { [part: string]: PosePart } = {};
  let partTiles: { [part: string]: number } = {};
  let order: string[] = [];
  for (let tile = 0; tile < 4; tile++) {
    let name = "p" + tile;
    parts[name] = { frame: tile * 8 + phase };
    partTiles[name] = tile;
    order.push(name);
  }
  return { parts, order, tiles: partTiles };
}

/**
 * Routine 8, 9 and 16: silacoids, celatids and biodrones.
 *
 * A single picture with no facing at all. The routine is one line - the cycle
 * is picked by the animation frame - so all that differs between them is where
 * their death sequence starts.
 */
function blobFrame(kind: number, pose: UnitPose, phase: number): PoseFrame {
  if (pose == "dying")
    return { parts: { t: { frame: BLOB_DEATH_START[kind] + phase } }, order: ["t"] };
  // A silacoid pulses 0-1-2-3-4-3-2-1 rather than running through the row, and
  // it has five pictures rather than eight
  let step = kind == 8 ? SILACOID_PULSE[phase % 8] : phase % 8;
  return { parts: { t: { frame: step } }, order: ["t"] };
}

/**
 * Routine 3 and 22: cyberdiscs and helicopters.
 *
 * A two-by-two unit with no turret. Unlike a tank it never leaves its stance,
 * so all that moves is the propulsion on the three forward tiles - behind the
 * hull for a disc, which hovers on it, and in front of it for a rotor.
 */
function propellantFrame(kind: number, dir: number, phase: number): PoseFrame {
  let parts: { [part: string]: PosePart } = {};
  let partTiles: { [part: string]: number } = {};
  let order: string[] = [];
  // A helicopter's rotor covers the hull, a disc's plume sits under it
  let rotorAbove = kind == 22;

  for (let tile = 0; tile < 4; tile++) {
    let hull = "b" + tile;
    let plume = "e" + tile;
    let hasPlume = tile > 0;
    if (hasPlume && !rotorAbove) {
      parts[plume] = { frame: 32 + (tile - 1) * 8 + phase };
      partTiles[plume] = tile;
      order.push(plume);
    }
    parts[hull] = { frame: tile * 8 + dir };
    partTiles[hull] = tile;
    order.push(hull);
    if (hasPlume && rotorAbove) {
      parts[plume] = { frame: 32 + (tile - 1) * 8 + phase };
      partTiles[plume] = tile;
      order.push(plume);
    }
  }

  return { parts, order, tiles: partTiles };
}

/** How many frames a pose plays; 1 means it stands still */
function posePhases(pose: UnitPose, view: UnitView) {
  let kind = routineKind(view.routine);
  if (pose == "walking") {
    // A sectopod's and a triscene's walk cycles hold four pictures each, and the
    // game picks one picture per two steps, so there are four to choose from
    if (kind == 5 || kind == 20)
      return 4;
    // A tentaculat has one picture per facing, so its walk has nothing to step
    // through
    if (kind == 19)
      return 1;
    return WALK_PHASES;
  }
  // The collapsing sequence stops on its last frame once the unit is down
  if (pose == "dying")
    return Math.max(1, view.deathFrames ?? 3);
  // A hovering tank's exhaust, a silacoid's pulse and a biodrone's wobble all
  // run while the unit stands still
  if (pose == "standing" && kind != null && STILL_CYCLES[kind]) {
    // Only a tank that flies has an exhaust to animate
    if (kind == 2 && view.movementType != MT_FLY)
      return 1;
    return STILL_CYCLES[kind];
  }
  return 1;
}

/**
 * How many pictures a standing routine cycles through on its own.
 *
 * These are the routines that ignore the facing: the unit is a single picture
 * that shimmers, pulses or turns on the spot, so its "standing" pose animates
 * instead of holding one frame.
 */
const STILL_CYCLES: { [kind: number]: number } = {
  // A hovering tank's exhaust
  2: 8,
  // A cyberdisc's plume and a helicopter's rotor
  3: 8,
  22: 8,
  // A silacoid pulsates through 0-4-0
  8: 8,
  // A celatid and a biodrone shimmer through eight pictures
  9: 8,
  16: 8,
  // A hallucinoid and an xarquid turn on the spot
  12: 8,
  21: 4
};

/**
 * Whether a pose repeats or plays once.
 *
 * A walk cycle, a hovering tank's exhaust, a silacoid's pulse and a biodrone's
 * wobble all run forever; a fall stops on its last frame, which is the body
 * lying down.
 */
function poseLoops(pose: UnitPose, view: UnitView) {
  // A fall plays once and stops on its last frame
  if (pose == "dying")
    return false;
  return pose == "walking" || posePhases(pose, view) > 1;
}

/** One cell of a pose, and where it goes */
type PosePart = {
  frame: number;
  offX?: number;
  offY?: number;
};

/** One frame of a pose: the parts to blit, back to front */
type PoseFrame = {
  parts: { [part: string]: PosePart };
  order: string[];
  /** Tile each part belongs to, for a unit spanning more than one */
  tiles?: { [part: string]: number };
};

/**
 * One frame of a pose: which cells to blit and how far from the upright
 * position each of them sits.
 *
 * `phase` is the step within an animated pose and is ignored by the still ones.
 * `turretDir` is only used by tanks, whose gun turns on its own.
 */
/** A silacoid pulses through 0-4 and back rather than running along the row */
const SILACOID_PULSE = [0, 1, 2, 3, 4, 3, 2, 1];

/**
 * Where the death sequence of each "one picture" routine starts. Routines 8, 9
 * and 16 share one shape, so they share one builder.
 */
const BLOB_DEATH_START: { [kind: number]: number } = { 8: 6, 9: 25, 16: 8 };

function poseFrame(sprite: Sprite, view: UnitView, pose: UnitPose, dir: number, phase: number,
  turretDir = dir): PoseFrame {
  let kind = routineKind(view.routine);
  switch (kind) {
    case 1:
      return floaterFrame(view, pose, dir, phase);
    case 2:
      return tankFrame(view, pose, dir, phase, turretDir);
    case 3:
    case 22:
      return propellantFrame(kind, dir, phase);
    case 4:
      return civilianFrame(view, pose, dir, phase);
    case 5:
      return fourPartFrame(view, pose, dir, phase);
    case 6:
      return snakemanFrame(view, pose, dir, phase);
    case 8:
    case 9:
    case 16:
      return blobFrame(kind, pose, phase);
    case 12:
      return fourTileCycleFrame(phase);
    case 19:
      return tentaculatFrame(pose, dir, phase);
    case 20:
      return trisceneFrame(dir, phase, pose == "walking");
    case 21:
      return xarquidFrame(dir, phase);
    default:
      return humanoidFrame(sprite, view, pose, dir, phase);
  }
}

/**
 * Routine 0: the ordinary humanoid, built from two arms, a pair of legs and a
 * torso, each 8 frames wide with one frame per facing.
 */
function humanoidFrame(sprite: Sprite, view: UnitView, pose: UnitPose, dir: number, phase: number): PoseFrame {
  let frames = routineFrames(view.routine ?? 0);
  // A short sheet may run out before the female torso: those armors fall back
  // to the male one rather than losing the whole figure
  let female = view.female && !!sprite.frameSource(frames.femaleTorso + dir);
  let torso = (female ? frames.femaleTorso : frames.maleTorso) + dir;
  let order = DRAW_ORDER[dir];

  switch (pose) {
    case "walking":
      return {
        parts: {
          l: { frame: LARM_WALK + WALK_STRIDE * dir + phase },
          r: { frame: RARM_WALK + WALK_STRIDE * dir + phase },
          g: { frame: LEGS_WALK + WALK_STRIDE * dir + phase },
          // Only the torso bobs: the walk arms are drawn at their own height
          t: { frame: torso, offY: frames.yoffWalk[phase] ?? 0 }
        },
        order
      };
    case "kneeling":
      return {
        parts: {
          l: { frame: LARM_STAND + dir, offY: frames.kneelY },
          r: { frame: RARM_STAND + dir, offY: frames.kneelY },
          g: { frame: LEGS_KNEEL + dir },
          // Everything but the legs drops, or the body would float above them
          t: { frame: torso, offY: frames.kneelY }
        },
        order
      };
    case "floating":
      return {
        parts: {
          l: { frame: LARM_STAND + dir },
          r: { frame: RARM_STAND + dir },
          g: { frame: frames.legsFloat + dir },
          t: { frame: torso }
        },
        order
      };
    case "dying":
      // A collapsing unit is a single frame: the body already contains the pose
      return { parts: { t: { frame: frames.die + phase } }, order: ["t"] };
    default:
      return {
        parts: {
          l: { frame: LARM_STAND + dir },
          r: { frame: RARM_STAND + dir },
          g: { frame: LEGS_STAND + dir },
          t: { frame: torso }
        },
        order
      };
  }
}

/**
 * Routine 6: snakemen. Legs, torso and arms like routine 0, but the frame
 * numbers differ and the legs are the only part that moves while walking - the
 * torso and arms just bob and shift sideways over them.
 */
function snakemanFrame(view: UnitView, pose: UnitPose, dir: number, phase: number): PoseFrame {
  if (pose == "dying")
    return { parts: { t: { frame: 96 + phase } }, order: ["t"] };

  let order = DRAW_ORDER_6[dir];
  let bob = 0, shift = 0;
  if (pose == "walking") {
    bob = SNAKEMAN_YOFF_WALK[phase] ?? 0;
    // The body leans into the step: right while heading east, left while
    // heading west, and neither straight up nor straight down
    if (dir < 3)
      shift = SNAKEMAN_XOFF_A[phase] ?? 0;
    else if (dir > 3 && dir < 7)
      shift = SNAKEMAN_XOFF_B[phase] ?? 0;
  }

  return {
    parts: {
      l: { frame: 0 + dir, offX: shift, offY: bob },
      r: { frame: 8 + dir, offX: shift, offY: bob },
      g: { frame: pose == "walking" ? 32 + 8 * dir + phase : 16 + dir },
      t: { frame: 24 + dir, offX: shift, offY: bob }
    },
    order
  };
}

/**
 * Routine 4: civilians and animals. The simplest of the lot - one sprite per
 * facing, and a walk sequence of eight frames behind it.
 */
function civilianFrame(view: UnitView, pose: UnitPose, dir: number, phase: number): PoseFrame {
  if (pose == "dying")
    return { parts: { t: { frame: 72 + phase } }, order: ["t"] };
  if (pose == "walking")
    return { parts: { t: { frame: 8 + 8 * dir + phase } }, order: ["t"] };
  return { parts: { t: { frame: 0 + dir } }, order: ["t"] };
}

/**
 * Routine 5: sectopods and reapers. Four parts of a 2x2 unit, standing still or
 * a four-step walk.
 */
function fourPartFrame(view: UnitView, pose: UnitPose, dir: number, phase: number): PoseFrame {
  let tiles = unitTiles(view);
  let parts: { [part: string]: PosePart } = {};
  let partTiles: { [part: string]: number } = {};
  let order: string[] = [];

  for (let tile = 0; tile < tiles * tiles; tile++) {
    let name = "p" + tile;
    parts[name] = {
      frame: pose == "walking"
        ? 32 + tile * 4 + dir * 16 + phase
        : 0 + tile * 8 + dir
    };
    partTiles[name] = tile;
    order.push(name);
  }

  return { parts, order, tiles: partTiles };
}

/**
 * Routine 2: tanks, tracked or hovering.
 *
 * A hovering tank is drawn from a second half of the sheet, and each of its
 * three forward tiles carries an exhaust plume that cycles on its own. The gun
 * sits on the front tile so it covers the rest of the hull, and it turns
 * independently of the hull.
 */
function tankFrame(view: UnitView, _pose: UnitPose, dir: number, phase: number, turretDir: number): PoseFrame {
  let hover = view.movementType == MT_FLY;
  let turret = view.turret ?? -1;
  let tiles = unitTiles(view);
  let parts: { [part: string]: PosePart } = {};
  let partTiles: { [part: string]: number } = {};
  let order: string[] = [];

  for (let tile = 0; tile < tiles * tiles; tile++) {
    let name = "b" + tile;
    // The plume goes under the hull, so it is blitted first
    if (hover && tile > 0) {
      let plume = "e" + tile;
      parts[plume] = { frame: 104 + (tile - 1) * 8 + phase };
      partTiles[plume] = tile;
      order.push(plume);
    }
    parts[name] = { frame: (hover ? 32 : 0) + tile * 8 + dir };
    partTiles[name] = tile;
    order.push(name);
  }

  // The gun rides on the front tile, and a hovering tank sways, so the gun
  // sways with the hull
  if (turret >= 0 && tiles == 2) {
    parts.gun = {
      frame: 64 + turret * 8 + turretDir,
      offX: hover ? TANK_SWAY_X[dir] : 0,
      offY: (hover ? TANK_SWAY_Y[dir] : 0) - 4
    };
    partTiles.gun = 3;
    order.push("gun");
  }

  return { parts, order, tiles: partTiles };
}

/** The poses each routine can be drawn in, whichever of them the sheet has */
const ROUTINE_POSES: { [kind: number]: UnitPose[] } = {
  0: ["standing", "walking", "kneeling", "floating", "dying"],
  1: ["standing", "walking", "dying"],
  // A tank's body does not change with its footing: only the exhaust moves
  2: ["standing"],
  3: ["standing"],
  4: ["standing", "walking", "dying"],
  5: ["standing", "walking"],
  6: ["standing", "walking", "dying"],
  // A blob has one picture per step of its cycle and no facing; walking it looks
  // exactly as standing still does
  8: ["standing", "dying"],
  9: ["standing", "dying"],
  12: ["standing"],
  16: ["standing", "dying"],
  19: ["standing", "walking", "dying"],
  20: ["standing", "walking"],
  21: ["standing"],
  22: ["standing"]
};

/**
 * Whether a routine's pose follows the facing.
 *
 * The blobs are a single picture that shimmers on the spot, so the facing
 * changes nothing for them and the compass is only in the way.
 */
function poseIsDirectional(pose: UnitPose, view: UnitView) {
  let kind = routineKind(view.routine);
  if (kind == 8 || kind == 9 || kind == 12 || kind == 16)
    return false;
  return UNIT_DIRECTIONAL.includes(pose);
}

/** The poses this sheet actually holds frames for */
export function unitPoses(view: UnitView): UnitPose[] {
  let sprite = rul?.sprites[view.sheet];
  let kind = routineKind(view.routine);
  if (!sprite?.grid || kind == null)
    return [];
  // A turreted tank can be verified for every gun facing, not just its own
  let turretDirs = kind == 2 && (view.turret ?? -1) >= 0 ? 8 : 1;

  return (ROUTINE_POSES[kind] ?? [])
    .filter(id => {
      for (let dir = 0; dir < 8; dir++) {
        for (let phase = 0; phase < posePhases(id, view); phase++) {
          for (let t = 0; t < turretDirs; t++) {
            let frame = poseFrame(sprite, view, id, dir, phase, t);
            for (let part in frame.parts)
              if (!sprite.frameSource(frame.parts[part].frame))
                return false;
          }
        }
      }
      return true;
    });
}

/**
 * Pixel size of a composed figure, before any magnification, and where its
 * parts are measured from.
 *
 * A single-tile unit is drawn on a double-width canvas so a weapon fits in the
 * hand. A four-tile unit fans out half a tile each way, and the gun of a
 * hovering tank rides above that.
 */
export function unitLayout(view: UnitView) {
  let sprite = rul?.sprites[view.sheet];
  let w = sprite?.subX ?? TILE_W;
  let h = sprite?.subY ?? 40;
  if (unitTiles(view) == 2) {
    // The four parts fan out half a tile each way, so the unit is one tile wider
    // and one tile taller than a single part; part 0 starts at (16, 0)
    return { w: w + TILE_W, h: h + TILE_H, x: TILE_W / 2, y: 0 };
  }
  return { w: w * 2, h, x: SPRITE_OFFSET, y: 0 };
}

/** Pixel size of a composed figure, before any magnification */
export function unitSpriteSize(view: UnitView) {
  let { w, h } = unitLayout(view);
  return { w, h };
}

/**
 * A composed unit: one pose of one armor, seen from one side.
 *
 * A pose that animates in the game (walking, dying) animates here too, at the
 * game's frame rate. A sheet that has no frames for the pose draws nothing, so
 * callers should pick from `unitPoses` rather than guessing.
 */
export function UnitSprite(props: {
  view: UnitView;
  pose?: UnitPose;
  /** Facing 0..7, as the game numbers them */
  direction?: number;
  /**
   * Hold one step of the pose instead of playing it, 1-based. Left undefined (or
   * 0) the pose animates the way the game plays it; a pose that does not animate
   * looks the same either way.
   */
  frame?: number;
  /** Which way the gun of a turreted tank points; defaults to the hull's way */
  turretDirection?: number;
  /** Magnification, snapped to whole device pixels like every other sprite */
  scale?: number;
  alt?: string;
  className?: string;
}) {
  let sprite = rul?.sprites[props.view.sheet];
  let canvas = useRef<HTMLCanvasElement>(null);
  let pixelRatio = usePixelRatio();

  // A set may be split over several images, and a figure can take parts from
  // more than one of them, so all of them are loaded up front
  let sources = useMemo(() =>
    [...new Set(Object.values(sprite?.frames ?? {}))]
      .map(path => sprite?.resolveFramePath(path))
      .filter((path): path is string => !!path), [props.view.sheet]);
  let { urls, settled } = useSpriteImages(sources);

  let { w: width, h: height } = unitSpriteSize(props.view);
  let scale = spriteScale(props.scale ?? 2, pixelRatio);
  let pose = props.pose ?? "standing";
  let direction = (((props.direction ?? 2) % 8) + 8) % 8;
  let turretDirection = (((props.turretDirection ?? direction) % 8) + 8) % 8;
  let hasRealData = sources.length > 0 && settled && urls.size == sources.length;

  useEffect(() => {
    let element = canvas.current;
    if (!element || !hasRealData || !sprite?.grid)
      return;

    let context = element.getContext("2d");
    if (!context)
      return;

    let cancelled = false;
    let timer: number | undefined;
    let images = new Map<string, HTMLImageElement>();
    let phases = posePhases(pose, props.view);
    // A step chosen by the caller is held; without one the pose plays
    let held = props.frame ? Math.min(Math.max(1, props.frame), phases) - 1 : undefined;
    let frame = held ?? 0;
    let tiles = unitTiles(props.view);
    let layout = unitLayout(props.view);

    // Paint one frame of the pose, or the still pose when it does not animate
    let paint = () => {
      context.clearRect(0, 0, element.width, element.height);
      // Keep the crisp pixel-art look the rest of the pedia has
      context.imageSmoothingEnabled = false;

      let model = poseFrame(sprite, props.view, pose, direction, frame, turretDirection);

      for (let part of model.order) {
        let placed = model.parts[part];
        if (!placed)
          continue;
        let source = sprite.frameSource(placed.frame);
        let image = source ? images.get(source.path) : undefined;
        if (!source || !image)
          continue;
        // One part of a multi-tile unit is shifted onto its own tile, and the
        // whole is centred in the canvas
        let tile = model.tiles?.[part] ?? 0;
        let spot = tiles == 2 ? partOffset(tile) : { x: 0, y: 0 };
        let baseX = tiles == 2 ? layout.x : SPRITE_OFFSET;
        let baseY = tiles == 2 ? layout.y : 0;
        context.drawImage(image, source.x, source.y, source.w, source.h,
          baseX + spot.x + (placed.offX ?? 0), baseY + spot.y + (placed.offY ?? 0),
          source.w, source.h);
      }
    };

    let loaded = 0;
    for (let source of sources) {
      let url = urls.get(source);
      if (!url)
        continue;
      let image = new Image();
      image.onload = () => {
        if (cancelled)
          return;
        images.set(source, image);
        // Start once the whole set is in; before that a part would be missing
        if (++loaded == sources.length) {
          paint();
          if (phases > 1 && held == null)
            timer = window.setInterval(() => {
              frame++;
              // A walk cycle and a hovering tank's exhaust repeat; a fall plays
              // once and holds its last frame
              if (poseLoops(pose, props.view))
                frame %= phases;
              else if (frame >= phases - 1) {
                frame = phases - 1;
                if (timer != null)
                  window.clearInterval(timer);
              }
              paint();
            }, ANIM_SPEED);
        }
      };
      image.src = url;
    }

    return () => {
      cancelled = true;
      if (timer != null)
        window.clearInterval(timer);
    };
  }, [hasRealData, props.view.sheet, props.view.female, props.view.routine, props.view.deathFrames,
    props.view.movementType, props.view.turret, props.view.size,
  pose, direction, turretDirection, props.frame, urls.size]);

  if (!sprite?.grid || !hasRealData)
    return null;

  return <canvas
    ref={canvas}
    className={"unit-sprite" + (props.className ? " " + props.className : "")}
    width={width}
    height={height}
    aria-label={props.alt ?? `${props.view.sheet} ${pose}`}
    style={{ width: width * scale, height: height * scale, imageRendering: "pixelated" }}
  />;
}

/**
 * The unit sheet of an armor, with a picker for the pose and the facing.
 *
 * This is the interactive version shown on the armor article: the same sheet can
 * look completely different depending on which parts the game blits, so being
 * able to ask for "kneeling, facing west" is the point of it.
 */
export function UnitSheetPreview(props: { view: UnitView, scale?: number }) {
  let poses = useMemo(() => unitPoses(props.view),
    [props.view.sheet, props.view.routine, props.view.female, props.view.deathFrames,
      props.view.movementType, props.view.turret, props.view.size]);
  let [pose, setPose] = useState<UnitPose>("standing");
  let [direction, setDirection] = useState(2);
  // A gun that turns on its own starts out following the hull
  let [turretDirection, setTurretDirection] = useState(2);
  // 0 means "play it"; anything else holds that step of the pose
  let [frame, setFrame] = useState(0);
  // One picker can appear on many articles, so each radio group needs a name
  // that is unique to this instance
  let group = useId();
  let poseGroup = useId();
  let turretGroup = useId();

  if (!poses.length)
    return null;

  // A short sheet can lack a pose - it may have no floating legs, for instance -
  // so a stale selection falls back to one that exists rather than drawing
  // nothing
  let shown = poses.includes(pose) ? pose : poses[0];
  let { w, h } = unitSpriteSize(props.view);

  let phases = posePhases(shown, props.view);
  let holdsFrames = phases > 1;
  let directional = poseIsDirectional(shown, props.view);
  // A pose change can leave the selection past the end of the new pose
  let heldFrame = holdsFrames ? Math.min(frame, phases) : 0;
  // Only a turreted tank draws its gun separately, and only when it is drawn
  // as four tiles - which is where the game puts the gun
  let hasTurret = routineKind(props.view.routine) == 2 && (props.view.turret ?? -1) >= 0
    && unitTiles(props.view) == 2;

  return <div className="unit-picker">
    <div className="unit-picker-controls">
      <div className="unit-picker-row">
        <div className="unit-poses" role="radiogroup">
          {/* The poses read as a short column beside the compass, so the two
              choices sit side by side instead of stacking into a long list */}
          {UNIT_POSES.filter(p => poses.includes(p.id)).map(p =>
            <label key={p.id} className="unit-pose">
              <input type="radio" name={poseGroup} value={p.id}
                checked={shown == p.id}
                onChange={() => setPose(p.id)} />
              <span>{p.label}</span>
            </label>
          )}
        </div>

        <div className={"unit-directions" + (directional ? "" : " disabled")}
          title={directional ? undefined : "This pose is drawn from one side only"}>
          {/* A collapsing unit is a single frame that already contains the pose,
              so the game draws it facing one way only */}
          <div className="unit-compass">
            {!hasTurret ? null : <span className="unit-compass-centre">hull</span>}
            {UNIT_DIRECTIONS.map(d =>
              <label key={d.dir} className={"unit-dir unit-dir-" + d.dir} title={d.title}>
                <input type="radio" name={group} value={d.dir}
                  checked={direction == d.dir} disabled={!directional}
                  onChange={() => setDirection(d.dir)} />
                <span>{d.short}</span>
              </label>
            )}
          </div>
        </div>

        {hasTurret ? <div className="unit-directions">
          {/* The gun turns on its own, so it gets its own ring */}
          <div className="unit-compass">
            <span className="unit-compass-centre">gun</span>
            {UNIT_DIRECTIONS.map(d =>
              <label key={d.dir} className={"unit-dir unit-dir-" + d.dir} title={d.title}>
                <input type="radio" name={turretGroup} value={d.dir}
                  checked={turretDirection == d.dir}
                  onChange={() => setTurretDirection(d.dir)} />
                <span>{d.short}</span>
              </label>
            )}
          </div>
        </div> : null}
      </div>

      <label className={"unit-frame" + (holdsFrames ? "" : " disabled")}>
        <input type="range" min={0} max={phases} step={1}
          value={heldFrame} disabled={!holdsFrames}
          title={holdsFrames
            ? (heldFrame ? `Holding step ${heldFrame} of ${phases}` : "Playing the animation")
            : "This pose has a single frame"}
          onChange={e => setFrame(+e.target.value)} />
        <span className="unit-frame-value">
          {!holdsFrames ? "1 / 1" : heldFrame ? `${heldFrame} / ${phases}` : `play · ${phases}`}
        </span>
      </label>
    </div>

    <div className="unit-picker-preview">
      <UnitSprite view={props.view} pose={shown} direction={direction}
        turretDirection={turretDirection} frame={heldFrame} scale={props.scale ?? 3} />
      <span className="unit-picker-size">{[w, h].join(" × ")} px</span>
    </div>

  </div>;
}
