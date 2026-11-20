/**
 * `UfoTrajectory.legs`: the flight a path's waypoints actually produce.
 *
 * The quirk being pinned is that a line does not keep one meaning down the list.
 * Line 1 is the spawn state, line 2 is an arrival *and* a departure, and the
 * third field set belongs to the leg leaving that line. N lines therefore fly N
 * legs, and line 2's zone is visited twice. `docs/missions.md` §4.1 and the
 * official ruleset reference both state this, and the reference's own `A..P`
 * example is reproduced here verbatim as the first case.
 *
 * The second half pins the landing rule, which is the easiest thing to get
 * wrong: a ground line makes the UFO land at the *previous* line's zone, and a
 * ground line at the very end lands it one stop before the end.
 */
import { eq, ok, report } from "../helpers/check.mjs";
import { testPack } from "../helpers/packs.mjs";

const rul = await testPack({
  rul:
    [
      "ufoTrajectories:",
      // The reference's example, with its zones as numbers: A=5, D=0, G=1, J=2, M=3.
      // It gives `go A->D at B,C; D->D at E,F; D->G at H,I; G->J at K,L; J->M at N,P`.
      "  - id: REFERENCE",
      "    waypoints:",
      "      - [5, 4, 100]",
      "      - [0, 3, 74]",
      "      - [1, 1, 28]",
      "      - [2, 1, 47]",
      "      - [3, 2, 60]",
      // The documented P0 table from docs/missions.md
      "  - id: P0",
      "    groundTimer: 3000",
      "    waypoints:",
      "      - [5, 4, 100]",
      "      - [0, 3, 74]",
      "      - [0, 1, 28]",
      "      - [1, 1, 47]",
      "      - [5, 2, 100]",
      // A ground line in the middle: lands in line 2's zone, then flies on
      "  - id: LANDS",
      "    waypoints:",
      "      - [0, 4, 100]",
      "      - [1, 2, 70]",
      "      - [2, 0, 40]",
      "      - [0, 4, 100]",
      // A ground *second* line is the odd case: leg 1 is already heading for line
      // 2's zone, so it lands there — in the ground line's own zone, not an earlier
      // one like every later ground line
      "  - id: LANDS_LINE2",
      "    waypoints:",
      "      - [0, 4, 100]",
      "      - [1, 0, 50]",
      "      - [2, 2, 60]",
      // A path that starts on the ground: the UFO waits before it can fly
      "  - id: GROUNDED",
      "    waypoints:",
      "      - [0, 0, 50]",
      "      - [1, 2, 60]",
      "      - [2, 1, 60]",
      // A path with only the spawn on the ground, and nothing else grounded
      "  - id: SPAWN_GROUND_ONLY",
      "    waypoints:",
      "      - [0, 0, 50]",
      "      - [1, 2, 60]",
      // A ground last line lands one stop early, then the UFO flies on to vanish
      "  - id: ENDS_GROUND",
      "    waypoints:",
      "      - [0, 4, 100]",
      "      - [1, 2, 60]",
      "      - [2, 0, 0]",
      // One line is not flyable at all
      "  - id: ONE",
      "    waypoints:",
      "      - [1, 0, 0]",
      // No lines at all is the same as one
      "  - id: NONE",
      "    waypoints: []",
    ].join("\n") + "\n",
});

// --- the reference's own example ---------------------------------------------
// `[from, to, altitude, speed, lands]` per leg. The reference spells out
// A->D, D->D, D->G, G->J, J->M with (B,C), (E,F), (H,I), (K,L), (N,P).
eq(
  rul.ufoTrajectories.REFERENCE.legs.map((l) => [l.from, l.to, l.altitude, l.speed]),
  [
    [5, 0, 4, 100],
    [0, 0, 3, 74],
    [0, 1, 1, 28],
    [1, 2, 1, 47],
    [2, 3, 2, 60],
  ],
  "the ruleset reference's A..P example, leg for leg",
);
// The six waypoints of the reference: A, D, D, G, J, M
eq(
  rul.ufoTrajectories.REFERENCE.stops,
  [5, 0, 0, 1, 2, 3],
  "the reference's six waypoints, with line 2 visited twice",
);

// --- documents/missions.md's P0 table ----------------------------------------
// Identical in shape, with a different zone list
eq(
  rul.ufoTrajectories.P0.legs.map((l) => [l.from, l.to, l.altitude, l.speed]),
  [
    [5, 0, 4, 100],
    [0, 0, 3, 74],
    [0, 0, 1, 28],
    [0, 1, 1, 47],
    [1, 5, 2, 100],
  ],
  "P0, straight from docs/missions.md",
);
eq(rul.ufoTrajectories.P0.stops, [5, 0, 0, 0, 1, 5], "P0 stops repeat line 2's zone");

// --- landings ----------------------------------------------------------------
// Line 3 is the ground line, so the UFO lands at the end of leg 2, which is
// line 2's zone (1) — not at line 3's zone (2).
const lands = rul.ufoTrajectories.LANDS.legs;
eq(
  lands.map((l) => l.lands),
  [false, true, false, false],
  "a ground line lands at the previous line's zone, at the end of the leg before",
);
eq(lands[1].to, 1, "that landing is in line 2's zone, not the ground line's");
// A landing leaves the UFO on the ground, and taking off again is at very low
// altitude, not at the ground line's own 0
eq(
  lands.map((l) => l.altitude),
  [4, 2, 1, 4],
  "the leg after a landing takes off very low",
);

// The spawn line's altitude is the ground, so leg 1 is already "very low"
eq(
  rul.ufoTrajectories.GROUNDED.legs.map((l) => l.altitude),
  [1, 2, 1],
  "a path that spawns on the ground flies leg 1 very low",
);

// A ground *second* line is the odd case: leg 1 is already heading for line 2's
// zone, so the landing is in the ground line's own zone (1), not an earlier one.
// Every later ground line lands in the zone of the line before it, as LANDS shows.
const line2 = rul.ufoTrajectories.LANDS_LINE2.legs;
eq(
  line2.map((l) => l.lands),
  [true, false, false],
  "a ground line 2 lands its own zone, because leg 1 already heads there",
);
eq(line2[0].to, 1, "that landing is in line 2's zone, the ground line's own");
// A spawn on the ground is not a landing of any leg: nothing arrives there
ok(
  rul.ufoTrajectories.SPAWN_GROUND_ONLY.legs.every((l) => !l.lands),
  "a grounded spawn does not make any leg land",
);

// A ground *last* line lands the UFO one stop early: at the end of leg 2, in
// line 2's zone. The final leg still flies to the last line's zone and vanishes.
const endsGround = rul.ufoTrajectories.ENDS_GROUND.legs;
eq(
  endsGround.map((l) => l.lands),
  [false, true, false],
  "a ground last line lands at the next-to-last stop",
);
eq(
  [endsGround[1].to, endsGround[2].to],
  [1, 2],
  "the landing is in line 2's zone; the last leg still departs for line 3's",
);
ok(endsGround[endsGround.length - 1].lands == false, "the final leg cannot land: the UFO vanishes");

eq(rul.ufoTrajectories.ONE.legs, [], "one line is unflyable");
eq(rul.ufoTrajectories.NONE.legs, [], "no lines is unflyable");
// A single stop rather than an invented leg
eq(rul.ufoTrajectories.ONE.stops, [1], "an unflyable path still reports its one zone");

// --- sizing, on a pack built for it -----------------------------------------
const sizes = await testPack({
  rul:
    [
      "ufoTrajectories:",
      "  - id: THREE",
      "    waypoints:",
      "      - [0, 1, 10]",
      "      - [1, 1, 10]",
      "      - [2, 1, 10]",
    ].join("\n") + "\n",
});
eq(sizes.ufoTrajectories.THREE.legs.length, 3, "three lines fly three legs");
eq(sizes.ufoTrajectories.THREE.stops.length, 4, "three lines visit four waypoints");
eq(sizes.ufoTrajectories.THREE.maxZone, 2, "the highest zone is the last line's");

report();
