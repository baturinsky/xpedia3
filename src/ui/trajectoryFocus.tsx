import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * The zone and the leg a reader is pointing at or has pinned.
 *
 * A flight is drawn in three places on one page — the map, the strip under it,
 * and the flight plan's left column — and pointing at a stop in any of them has
 * to light that stop in the other two, or the pictures are not of the same
 * thing. The state therefore lives above all three, in this context, rather than
 * inside any one of them.
 *
 * Hover and the press are kept apart on purpose: a press that a touch screen
 * makes is followed by the pointer leaving, so a single shared slot would be
 * cleared again immediately and the press would do nothing. `hot*` is the pinned
 * value when there is one and the hovered value otherwise, which is the value
 * every view draws.
 *
 * Zones and legs have a slot each, and are not one slot: a zone is an area and a
 * leg is a move, and a stop belongs to both, so both can be lit at once without
 * saying two different things about one thing.
 */
export type TrajectoryFocus = {
  /** Zone to emphasise, from the pin or else from the pointer */
  hotZone?: number
  /** Zone kept lit by a press, which a touch screen needs instead of hover */
  pinnedZone?: number
  /** Leg to emphasise, from the pin or else from the pointer */
  hotLeg?: number
  /** Leg kept lit by a press */
  pinnedLeg?: number
  /** Called while a stop is pointed at, with nothing when the pointer leaves */
  hoverZone: (zone?: number) => void
  /** Called when a stop is pressed; pressing the same stop again releases it */
  pinZone: (zone: number) => void
  /** Called while a leg's line is pointed at */
  hoverLeg: (leg?: number) => void
  /** Called when a leg's line is pressed; pressing it again releases it */
  pinLeg: (leg: number) => void
  /** Drops every highlight. A different region makes every zone number mean something else. */
  reset: () => void
};

const Context = createContext<TrajectoryFocus | undefined>(undefined);

/** Holds the highlight for one page's flight, and gives it to every view of it */
export function TrajectoryFocusProvider({ children }: { children: ReactNode }) {
  let [hovered, setHovered] = useState<number>();
  let [pinned, setPinned] = useState<number>();
  let [hoveredLeg, setHoveredLeg] = useState<number>();
  let [pinnedLeg, setPinnedLeg] = useState<number>();

  let value = useMemo<TrajectoryFocus>(() => ({
    hotZone: pinned ?? hovered,
    pinnedZone: pinned,
    hotLeg: pinnedLeg ?? hoveredLeg,
    pinnedLeg,
    hoverZone: setHovered,
    pinZone: zone => setPinned(current => current == zone ? undefined : zone),
    hoverLeg: setHoveredLeg,
    pinLeg: leg => setPinnedLeg(current => current == leg ? undefined : leg),
    reset: () => {
      setHovered(undefined);
      setPinned(undefined);
      setHoveredLeg(undefined);
      setPinnedLeg(undefined);
    },
  }), [hovered, pinned, hoveredLeg, pinnedLeg]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * The page's flight highlight, or nothing when the page is not a flight.
 *
 * A caller outside a trajectory page gets `undefined` rather than an error: the
 * table and the map both have to keep drawing when there is no flight to share,
 * they just have no highlight to answer and no switch to offer.
 */
export function useTrajectoryFocus() {
  return useContext(Context);
}
