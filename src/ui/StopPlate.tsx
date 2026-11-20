import type { CSSProperties } from "react";
import { rul } from "../rul/Ruleset";
import { zoneColor } from "./mapOverlay";
import type { TrajectoryFocus } from "./trajectoryFocus";
import { Val } from "./Val";

/**
 * A stop, drawn the way the reader meets it everywhere: a number inside a shape.
 *
 * The shape is the fact, not the decoration. A circle is a stop in the air and a
 * square is a landing, which is the same distinction the map's markers make, so
 * a square in the strip or in a flight-plan row can be found on the picture by
 * shape alone. The number is the stop's place in the flight, which is the number
 * the picture prints on its marker, so "stop 3" names one thing on the whole page.
 *
 * It is a button rather than a picture because pointing at a stop lights its zone
 * on the map and pressing it keeps that highlight, and a touch screen has no
 * hover to do the first with. Every drawing of a stop is therefore this same
 * element: the strip above the map, and the left column of the flight plan, which
 * is why they cannot drift into two conventions.
 */
export function StopPlate({
  zone,
  number,
  lands,
  focus,
  className,
}: {
  /** The mission zone the stop is in, which picks its colour */
  zone: number;
  /** The stop's place in the flight, as the map prints it */
  number: number;
  /** Whether the UFO is on the ground here, which makes the shape a square */
  lands: boolean;
  focus?: TrajectoryFocus;
  /** A class of the caller's, for the size the place it is drawn in needs */
  className?: string;
}) {
  return (
    <button
      type="button"
      className={
        "trajectory-flight-stop" +
        (lands ? " trajectory-flight-land" : "") +
        (focus?.hotZone == zone ? " trajectory-flight-hot" : "") +
        (className ? " " + className : "")
      }
      style={{ "--zone-color": zoneColor(zone) } as CSSProperties}
      aria-pressed={focus?.pinnedZone == zone}
      // The face of the button is a number in a shape, which says nothing on its
      // own to a screen reader, so the stop is named in words as well
      aria-label={`${rul.tr("xpediaStopNumber")} ${number}`}
      // Pointing at a stop lights up every box of its zone — the whole area it may
      // be anywhere in — and pressing pins it, because a touch screen has no hover
      // and the leave that follows a press would undo it.
      onPointerEnter={focus && (() => focus.hoverZone(zone))}
      onPointerLeave={focus && (() => focus.hoverZone())}
      onClick={focus && (() => focus.pinZone(zone))}
    >
      <span className="trajectory-flight-number">
        <Val of={number} />
      </span>
    </button>
  );
}
