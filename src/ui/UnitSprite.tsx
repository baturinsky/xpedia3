import { useEffect, useId, useMemo, useRef, useState } from "react";
import { rul } from "../rul/Ruleset";
import type { Sprite } from "../rul/Sprite";
import { usePixelRatio, useSpriteImages, spriteScale } from "./components";

/**
 * A unit drawn out of its `spriteSheet`.
 *
 * A unit sheet is not a frame sequence — it is an atlas of body parts, and the
 * game assembles a figure out of several cells. This follows
 * `UnitSprite::drawRoutine0` in the OpenXcom sources, which is by far the most
 * common routine: it is used by the overwhelming majority of armor definitions,
 * and routines 10, 13, 14 and 15 all fall through to it.
 *
 * The numbers below are frame indices into the sheet, not sizes. They are taken
 * from `drawRoutine0` so the preview matches the game rather than approximating
 * it.
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

/** OpenXcom's `DEFAULT_ANIM_SPEED`, in milliseconds per frame */
const ANIM_SPEED = 100;

/**
 * Unit sprites are drawn on a double-width canvas so a weapon fits in the hand,
 * and the body is drawn 16 pixels in (`offXSprite` in the sources). Without the
 * margin the arm holding a weapon is clipped.
 */
const SPRITE_OFFSET = 16;

export type UnitView = {
  /** Sheet in `rul.sprites`, e.g. `PIR_22.PCK` */
  sheet: string;
  /** Armor's `drawingRoutine`; only routine 0 and its aliases are composed */
  routine?: number;
  /** Use the female torso, as the game does for female soldiers */
  female?: boolean;
  /** Armor's `deathFrames`; how long the collapsing animation runs */
  deathFrames?: number;
};

/** Routines `drawRoutine0` also draws, per the routine table in `UnitSprite.cpp` */
const ROUTINE0_ALIASES = [0, 10, 13, 14, 15];

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

/** True when this sheet can be composed into a figure */
export function canComposeUnit(sheet?: string, routine?: number) {
  let sprite = sheet ? rul?.sprites[sheet] : undefined;
  if (!sprite?.grid || !sprite.subX || !sprite.subY)
    return false;
  return routine == null || ROUTINE0_ALIASES.includes(+routine);
}

/** How many frames a pose plays; 1 means it stands still */
function posePhases(pose: UnitPose, view: UnitView) {
  if (pose == "walking")
    return WALK_PHASES;
  // The collapsing sequence stops on its last frame once the unit is down
  if (pose == "dying")
    return Math.max(1, view.deathFrames ?? 3);
  return 1;
}

/**
 * One frame of a pose: which cells to blit and how far from the upright
 * position each of them sits.
 *
 * `phase` is the step within an animated pose and is ignored by the still ones.
 */
function poseFrame(sprite: Sprite, view: UnitView, pose: UnitPose, dir: number, phase: number) {
  let frames = routineFrames(view.routine ?? 0);
  // A short sheet may run out before the female torso: those armors fall back
  // to the male one rather than losing the whole figure
  let female = view.female && !!sprite.frameSource(frames.femaleTorso + dir);
  let torso = (female ? frames.femaleTorso : frames.maleTorso) + dir;

  switch (pose) {
    case "walking":
      return {
        parts: {
          l: LARM_WALK + WALK_STRIDE * dir + phase,
          r: RARM_WALK + WALK_STRIDE * dir + phase,
          g: LEGS_WALK + WALK_STRIDE * dir + phase,
          t: torso
        },
        // Only the torso bobs: the walk arms are drawn at their own height
        offY: { t: frames.yoffWalk[phase] ?? 0 }
      };
    case "kneeling":
      return {
        parts: { l: LARM_STAND + dir, r: RARM_STAND + dir, g: LEGS_KNEEL + dir, t: torso },
        // Everything but the legs drops, or the body would float above them
        offY: { l: frames.kneelY, r: frames.kneelY, t: frames.kneelY }
      };
    case "floating":
      return {
        parts: { l: LARM_STAND + dir, r: RARM_STAND + dir, g: frames.legsFloat + dir, t: torso },
        offY: {}
      };
    case "dying":
      // A collapsing unit is a single frame: the body already contains the pose
      return { parts: { t: frames.die + phase }, offY: {} };
    default:
      return {
        parts: { l: LARM_STAND + dir, r: RARM_STAND + dir, g: LEGS_STAND + dir, t: torso },
        offY: {}
      };
  }
}

/** The poses this sheet actually holds frames for */
export function unitPoses(view: UnitView): UnitPose[] {
  let sprite = rul?.sprites[view.sheet];
  if (!sprite?.grid)
    return [];
  return UNIT_POSES
    .filter(({ id }) => {
      for (let dir = 0; dir < 8; dir++) {
        for (let phase = 0; phase < posePhases(id, view); phase++) {
          let frame = poseFrame(sprite, view, id, dir, phase);
          for (let part in frame.parts)
            if (!sprite.frameSource(frame.parts[part]))
              return false;
        }
      }
      return true;
    })
    .map(pose => pose.id);
}

/** Pixel size of a composed figure, before any magnification */
export function unitSpriteSize(view: UnitView) {
  let sprite = rul?.sprites[view.sheet];
  // Double width, like the game: the body is drawn with room beside it for a
  // weapon in the hand
  return { w: (sprite?.subX ?? 32) * 2, h: sprite?.subY ?? 40 };
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

    // Paint one frame of the pose, or the still pose when it does not animate
    let paint = () => {
      context.clearRect(0, 0, element.width, element.height);
      // Keep the crisp pixel-art look the rest of the pedia has
      context.imageSmoothingEnabled = false;

      let model = poseFrame(sprite, props.view, pose, direction, frame);
      // A collapsing figure is one frame whose parts are already placed; any
      // other pose uses the facing's blit order
      let order = pose == "dying" ? ["t"] : DRAW_ORDER[direction];

      for (let part of order) {
        let number = model.parts[part];
        if (number == null)
          continue;
        let source = sprite.frameSource(number);
        let image = source ? images.get(source.path) : undefined;
        if (!source || !image)
          continue;
        // Only the horizontal offset is applied: unit sprites are double width
        // with the body in the right half, while the vertical offsets are the
        // parts' own small ones and may be negative
        context.drawImage(image, source.x, source.y, source.w, source.h,
          SPRITE_OFFSET, model.offY[part] ?? 0, source.w, source.h);
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
              // A walk cycle repeats; a fall plays once and holds its last frame
              if (pose == "walking")
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
  pose, direction, props.frame, urls.size]);

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
    [props.view.sheet, props.view.routine, props.view.female, props.view.deathFrames]);
  let [pose, setPose] = useState<UnitPose>("standing");
  let [direction, setDirection] = useState(2);
  // 0 means "play it"; anything else holds that step of the pose
  let [frame, setFrame] = useState(0);
  let pixelRatio = usePixelRatio();
  // One picker can appear on many articles, so the radio group needs a name that
  // is unique to this instance
  let group = useId();

  if (!poses.length)
    return null;

  // A short sheet can lack a pose - it may have no floating legs, for instance -
  // so a stale selection falls back to one that exists rather than drawing
  // nothing
  let shown = poses.includes(pose) ? pose : poses[0];
  let { w, h } = unitSpriteSize(props.view);
  let scale = spriteScale(props.scale ?? 3, pixelRatio);

  let phases = posePhases(shown, props.view);
  let holdsFrames = phases > 1;
  let directional = UNIT_DIRECTIONAL.includes(shown);
  // A pose change can leave the selection past the end of the new pose
  let heldFrame = holdsFrames ? Math.min(frame, phases) : 0;

  return <div className="unit-picker">
    <div className="unit-picker-preview">
      <UnitSprite view={props.view} pose={shown} direction={direction}
        frame={heldFrame} scale={props.scale ?? 3} />
    </div>
    <div className="unit-picker-controls">
      <label>
        <span>Animation</span>
        <select value={shown} onChange={e => setPose(e.target.value as UnitPose)}>
          {UNIT_POSES.filter(p => poses.includes(p.id)).map(p =>
            <option key={p.id} value={p.id}>{p.label}</option>
          )}
        </select>
      </label>

      <div className={"unit-directions" + (directional ? "" : " disabled")}
        title={directional ? undefined : "This pose is drawn from one side only"}>
        <span className="unit-label">Direction</span>
        {/* A collapsing unit is a single frame that already contains the pose,
            so the game draws it facing one way only */}
        <div className="unit-compass">
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

      <label className={"unit-frame" + (holdsFrames ? "" : " disabled")}>
        <span>Frame</span>
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

      <span className="unit-picker-size">{[w, h].join(" × ")} px</span>
    </div>
  </div>;
}
