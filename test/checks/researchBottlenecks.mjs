/**
 * Bottleneck points of interest: a topic other topics cannot be finished
 * without on the normal road gates them.
 *
 * Availability is conjunctive — ALL `dependencies` must be done — so the
 * score is the transitive dependents (the topic's dependency cone). Only
 * topics that *strictly* need the gate count: a dependent reachable without
 * it — through an "Unlocked by any one of" shortcut, a "May be granted free
 * by" grant (including a guarded one), or a dependent that itself can be
 * reached without it — is not behind it, and neither is anything that only
 * needed that dependent. A bypass source that itself needs the gate keeps
 * the dependent strict. Only majors are stamped: at least three dependents,
 * and a bottleneck score — the cone weight (`cost` + `points`) minus the
 * heaviest strict dependent's — of at least one per cent of the pack's
 * heaviest, so an article only raises the flag where a branch is held, not a
 * single one-off topic. (See `src/rul/researchBottlenecks.ts` for the
 * SCC + bit-set computation and why flow-graph dominance is the wrong
 * metric here.)
 */
import { eq, report } from "../helpers/check.mjs";
import { testPack } from "../helpers/packs.mjs";

const rul = (t) => testPack({ rul: t });

/** A straight chain: every ancestor is in each descendant's cone. */
{
  const chain = await rul(
    [
      "research:",
      "  - name: STR_BN_A",
      "    cost: 1",
      "  - name: STR_BN_B",
      "    cost: 2",
      "    dependencies: [STR_BN_A]",
      "  - name: STR_BN_C",
      "    cost: 3",
      "    points: 4",
      "    dependencies: [STR_BN_B]",
      "  - name: STR_BN_D",
      "    cost: 5",
      "    dependencies: [STR_BN_C]",
      "  - name: STR_BN_E",
      "    cost: 100",
      "    dependencies: [STR_BN_D]",
    ].join("\n"),
  );
  const a = chain.research.STR_BN_A;
  const b = chain.research.STR_BN_B;
  const c = chain.research.STR_BN_C;
  eq(a.gatesTopics, 4, "chain head gates all four descendants");
  eq(a.gatesValue, 114, "chain head weight is cost + points behind it (2 + 3 + 4 + 5 + 100)");
  eq(b.gatesTopics, 3, "chain second gates three");
  eq(c.gatesTopics, undefined, "two dependents is not a major gate: unstamped");
  eq(chain.research.STR_BN_E.gatesTopics, undefined, "leaf gates nothing");
  eq(a.gatesScore, 2, "on a chain a gate scores the next link's own weight (A holds B's 2)");
  eq(b.gatesScore, 7, "B scores C's own weight (3 + 4)");
}

/**
 * A join with three children: BOTH arms are in the dependents' cones (AND
 * semantics). Each arm scores the join's own weight too, since the join is
 * its only dependent and carries the whole cone past it.
 */
{
  const diamond = await rul(
    [
      "research:",
      "  - name: STR_BN_LEFT",
      "  - name: STR_BN_RIGHT",
      "  - name: STR_BN_JOIN",
      "    cost: 5",
      "    dependencies: [STR_BN_LEFT, STR_BN_RIGHT]",
      "  - name: STR_BN_K1",
      "    cost: 1",
      "    dependencies: [STR_BN_JOIN]",
      "  - name: STR_BN_K2",
      "    cost: 1",
      "    dependencies: [STR_BN_JOIN]",
      "  - name: STR_BN_K3",
      "    cost: 1",
      "    dependencies: [STR_BN_JOIN]",
    ].join("\n"),
  );
  eq(
    diamond.research.STR_BN_LEFT.gatesTopics,
    4,
    "left arm gates the join and its three children (all need the join, which needs the left arm)",
  );
  eq(diamond.research.STR_BN_RIGHT.gatesTopics, 4, "right arm gates the same four");
  eq(
    diamond.research.STR_BN_LEFT.gatesValue,
    8,
    "left arm cone weight is the join plus its children (5 + 1 + 1 + 1)",
  );
  eq(diamond.research.STR_BN_LEFT.gatesScore, 5, "left arm scores the join's own weight (8 - 3)");
  eq(diamond.research.STR_BN_JOIN.gatesTopics, 3, "the join gates its three children");
  eq(diamond.research.STR_BN_JOIN.gatesScore, 3, "the join scores its children's combined weight");
  eq(diamond.research.STR_BN_K1.gatesTopics, undefined, "a leaf child gates nothing");
}

/** Dependencies on topics the pack does not state count as roots' partners. */
{
  const orphan = await rul(
    [
      "research:",
      "  - name: STR_BN_ORPHAN",
      "    dependencies: [STR_BN_MISSING]",
      "  - name: STR_BN_AFTER1",
      "    dependencies: [STR_BN_ORPHAN]",
      "  - name: STR_BN_AFTER2",
      "    dependencies: [STR_BN_AFTER1]",
      "  - name: STR_BN_AFTER3",
      "    dependencies: [STR_BN_AFTER2]",
    ].join("\n"),
  );
  eq(
    orphan.research.STR_BN_ORPHAN.gatesTopics,
    3,
    "topic with a missing dependency still gates its three descendants",
  );
  eq(orphan.research.STR_BN_ORPHAN.gatesValue, 0, "weightless descendants weigh nothing");
  eq(
    orphan.research.STR_BN_ORPHAN.gatesScore,
    0,
    "but the gate still stamps: the score floor is zero when the pack's heaviest score is zero",
  );
}

/** A dependency cycle is one SCC: members never gate each other. */
{
  const cycle = await rul(
    [
      "research:",
      "  - name: STR_BN_CYC_A",
      "    dependencies: [STR_BN_CYC_B]",
      "  - name: STR_BN_CYC_B",
      "    dependencies: [STR_BN_CYC_A]",
      "  - name: STR_BN_CYC_C",
      "    cost: 4",
      "    dependencies: [STR_BN_CYC_A]",
      "  - name: STR_BN_CYC_D",
      "    cost: 2",
      "    dependencies: [STR_BN_CYC_C]",
      "  - name: STR_BN_CYC_E",
      "    cost: 1",
      "    dependencies: [STR_BN_CYC_D]",
    ].join("\n"),
  );
  eq(
    cycle.research.STR_BN_CYC_A.gatesTopics,
    3,
    "cycle member gates the three topics downstream of the cycle, not its partner",
  );
  eq(cycle.research.STR_BN_CYC_B.gatesTopics, 3, "both members share the downstream score");
  eq(
    cycle.research.STR_BN_CYC_A.gatesValue,
    7,
    "cycle cone weight is everything downstream (4 + 2 + 1)",
  );
  eq(
    cycle.research.STR_BN_CYC_A.gatesScore,
    4,
    "cycle scores what the first downstream link (C, weight 3) does not carry (7 - 3)",
  );
  eq(
    cycle.research.STR_BN_CYC_C.gatesTopics,
    undefined,
    "downstream of the cycle, only two below it: unstamped",
  );
}

/**
 * `unlocks` shortcuts are bypasses: a topic with a shortcut that can be
 * reached without the gate is not behind the gate, and neither is anything
 * that only needed it downstream.
 */
{
  const shortcut = await rul(
    [
      "research:",
      "  - name: STR_BN_GATE",
      "  - name: STR_BN_SHORTCUT",
      "    unlocks: [STR_BN_TARGET]",
      "  - name: STR_BN_TARGET",
      "    cost: 10",
      "    dependencies: [STR_BN_GATE]",
      "  - name: STR_BN_DOWN1",
      "    cost: 1",
      "    dependencies: [STR_BN_TARGET]",
      "  - name: STR_BN_DOWN2",
      "    cost: 1",
      "    dependencies: [STR_BN_DOWN1]",
      "  - name: STR_BN_DOWN3",
      "    cost: 1",
      "    dependencies: [STR_BN_DOWN2]",
    ].join("\n"),
  );
  eq(
    shortcut.research.STR_BN_GATE.gatesTopics,
    undefined,
    "gate is unstamped: its only dependent can be unlocked without it, so nothing is strictly behind it",
  );
  eq(
    shortcut.research.STR_BN_TARGET.gatesTopics,
    3,
    "the shortcut target still gates its three downstream topics",
  );
  eq(
    shortcut.research.STR_BN_TARGET.gatesScore,
    1,
    "target scores the first down's own weight (3 - 2)",
  );
  eq(
    shortcut.research.STR_BN_SHORTCUT.gatesTopics,
    undefined,
    "the shortcut topic gates nothing on the normal road",
  );
}

/**
 * A bypass source that itself needs the gate keeps the dependent strict:
 * the shortcut cannot be reached without the gate, so every route to the
 * target still runs through it.
 */
{
  const gatedShortcut = await rul(
    [
      "research:",
      "  - name: STR_BN_GATE",
      "  - name: STR_BN_MID",
      "    dependencies: [STR_BN_GATE]",
      "  - name: STR_BN_SHORTCUT",
      "    dependencies: [STR_BN_GATE]",
      "    unlocks: [STR_BN_TARGET]",
      "  - name: STR_BN_TARGET",
      "    cost: 10",
      "    dependencies: [STR_BN_GATE]",
      "  - name: STR_BN_DOWN1",
      "    cost: 1",
      "    dependencies: [STR_BN_TARGET]",
      "  - name: STR_BN_DOWN2",
      "    cost: 1",
      "    dependencies: [STR_BN_DOWN1]",
      "  - name: STR_BN_DOWN3",
      "    cost: 1",
      "    dependencies: [STR_BN_DOWN2]",
    ].join("\n"),
  );
  eq(
    gatedShortcut.research.STR_BN_GATE.gatesTopics,
    6,
    "mid, shortcut, target and its three downs are all strictly behind the gate: the shortcut cannot be reached without it",
  );
  eq(
    gatedShortcut.research.STR_BN_GATE.gatesValue,
    13,
    "gate cone weight is target plus downs (10 + 1 + 1 + 1)",
  );
  eq(
    gatedShortcut.research.STR_BN_GATE.gatesScore,
    10,
    "gate scores the target's own weight (13 - 3)",
  );
  eq(
    gatedShortcut.research.STR_BN_TARGET.gatesTopics,
    3,
    "the shortcut target gates its three normal descendants",
  );
}

/**
 * Free grants are bypasses too: a topic granted free by a reachable granter
 * leaves the cone (and its downstream with it), while a topic with a second
 * dependency path to the gate stays strictly behind it.
 */
{
  const free = await rul(
    [
      "research:",
      "  - name: STR_BN_GATE",
      "  - name: STR_BN_GRANTER",
      "    getOneFree: [STR_BN_TARGET]",
      "  - name: STR_BN_TARGET",
      "    cost: 10",
      "    dependencies: [STR_BN_GATE]",
      "  - name: STR_BN_DOWN",
      "    cost: 100",
      "    dependencies: [STR_BN_TARGET]",
      "  - name: STR_BN_KEEPER",
      "    cost: 7",
      "    dependencies: [STR_BN_TARGET, STR_BN_GATE]",
      "  - name: STR_BN_K1",
      "    cost: 1",
      "    dependencies: [STR_BN_KEEPER]",
      "  - name: STR_BN_K2",
      "    cost: 1",
      "    dependencies: [STR_BN_K1]",
      "  - name: STR_BN_K3",
      "    cost: 1",
      "    dependencies: [STR_BN_K2]",
    ].join("\n"),
  );
  eq(
    free.research.STR_BN_GATE.gatesTopics,
    4,
    "target and its down can be reached without the gate; the keeper and its chain cannot",
  );
  eq(
    free.research.STR_BN_GATE.gatesValue,
    10,
    "gate cone weight is the keeper chain only (7 + 1 + 1 + 1)",
  );
  eq(
    free.research.STR_BN_GATE.gatesScore,
    7,
    "gate scores what the keeper chain's first link (weight 3) does not carry (10 - 3)",
  );
  eq(
    free.research.STR_BN_TARGET.gatesTopics,
    5,
    "target itself still gates its down, the keeper and the keeper chain",
  );
  eq(
    free.research.STR_BN_TARGET.gatesValue,
    110,
    "target cone weight is down plus keeper chain (100 + 7 + 1 + 1 + 1)",
  );
}

/**
 * A guarded free grant needs both its granter and its guard: with a reachable
 * guard it bypasses the gate, with a guard behind the gate it does not.
 */
{
  const guardedOpen = await rul(
    [
      "research:",
      "  - name: STR_BN_GATE",
      "  - name: STR_BN_GRANTER",
      "    getOneFreeProtected:",
      "      STR_BN_GUARD: [STR_BN_TARGET]",
      "  - name: STR_BN_GUARD",
      "  - name: STR_BN_TARGET",
      "    cost: 10",
      "    dependencies: [STR_BN_GATE]",
      "  - name: STR_BN_DOWN1",
      "    cost: 1",
      "    dependencies: [STR_BN_TARGET]",
      "  - name: STR_BN_DOWN2",
      "    cost: 1",
      "    dependencies: [STR_BN_DOWN1]",
      "  - name: STR_BN_DOWN3",
      "    cost: 1",
      "    dependencies: [STR_BN_DOWN2]",
    ].join("\n"),
  );
  eq(
    guardedOpen.research.STR_BN_GATE.gatesTopics,
    undefined,
    "guarded grant with a reachable guard bypasses the gate entirely",
  );
  eq(
    guardedOpen.research.STR_BN_TARGET.gatesTopics,
    3,
    "the granted target still gates its three downstream topics",
  );

  const guardedShut = await rul(
    [
      "research:",
      "  - name: STR_BN_GATE",
      "  - name: STR_BN_GRANTER",
      "    getOneFreeProtected:",
      "      STR_BN_GUARD: [STR_BN_TARGET]",
      "  - name: STR_BN_GUARD",
      "    dependencies: [STR_BN_GATE]",
      "  - name: STR_BN_TARGET",
      "    cost: 10",
      "    dependencies: [STR_BN_GATE]",
      "  - name: STR_BN_DOWN1",
      "    cost: 1",
      "    dependencies: [STR_BN_TARGET]",
      "  - name: STR_BN_DOWN2",
      "    cost: 1",
      "    dependencies: [STR_BN_DOWN1]",
      "  - name: STR_BN_DOWN3",
      "    cost: 1",
      "    dependencies: [STR_BN_DOWN2]",
    ].join("\n"),
  );
  eq(
    guardedShut.research.STR_BN_GATE.gatesTopics,
    5,
    "guard behind the gate: the grant cannot fire without it, so guard, target and downs stay strict",
  );
  eq(
    guardedShut.research.STR_BN_GATE.gatesValue,
    13,
    "gate cone weight is target plus downs (10 + 1 + 1 + 1)",
  );
  eq(
    guardedShut.research.STR_BN_GATE.gatesScore,
    10,
    "gate scores the target's own weight (13 - 3)",
  );
}

/**
 * A bypassed heavy branch contributes neither weight nor score: the gate's
 * score subtracts only strict dependents, whose cones are subsets of its own.
 */
{
  const bypassedHeavy = await rul(
    [
      "research:",
      "  - name: STR_BN_GATE",
      "  - name: STR_BN_SHORTCUT",
      "    unlocks: [STR_BN_HEAVY]",
      "  - name: STR_BN_HEAVY",
      "    cost: 1000",
      "    dependencies: [STR_BN_GATE]",
      "  - name: STR_BN_HEAVY1",
      "    cost: 1000",
      "    dependencies: [STR_BN_HEAVY]",
      "  - name: STR_BN_LIGHT",
      "    cost: 10",
      "    dependencies: [STR_BN_GATE]",
      "  - name: STR_BN_LIGHT1",
      "    cost: 5",
      "    dependencies: [STR_BN_LIGHT]",
      "  - name: STR_BN_LIGHT2",
      "    cost: 5",
      "    dependencies: [STR_BN_LIGHT1]",
    ].join("\n"),
  );
  eq(
    bypassedHeavy.research.STR_BN_GATE.gatesTopics,
    3,
    "only the light chain is strictly behind the gate",
  );
  eq(
    bypassedHeavy.research.STR_BN_GATE.gatesValue,
    20,
    "gate cone weight is the light chain only (10 + 5 + 5)",
  );
  eq(
    bypassedHeavy.research.STR_BN_GATE.gatesScore,
    10,
    "gate scores what its strict child (cone 10) does not carry (20 - 10)",
  );
  eq(
    bypassedHeavy.research.STR_BN_HEAVY.gatesTopics,
    undefined,
    "the bypassed heavy branch gates only one topic: unstamped",
  );
}

/**
 * A split point scores the branches it holds that no single child holds,
 * while a lone link in front of one heavy topic scores that topic's whole
 * weight but still is not a major gate (one dependent).
 */
{
  const split = await rul(
    [
      "research:",
      "  - name: STR_BN_SPLIT",
      "  - name: STR_BN_BRANCH_A",
      "    cost: 10",
      "    dependencies: [STR_BN_SPLIT]",
      "  - name: STR_BN_BRANCH_A1",
      "    cost: 30",
      "    dependencies: [STR_BN_BRANCH_A]",
      "  - name: STR_BN_BRANCH_B",
      "    cost: 5",
      "    dependencies: [STR_BN_SPLIT]",
      "  - name: STR_BN_BRANCH_B1",
      "    cost: 5",
      "    dependencies: [STR_BN_BRANCH_B]",
      "  - name: STR_BN_LONE",
      "  - name: STR_BN_HEAVY_LEAF",
      "    cost: 100",
      "    dependencies: [STR_BN_LONE]",
    ].join("\n"),
  );
  eq(split.research.STR_BN_SPLIT.gatesTopics, 4, "split point gates both branches and their tails");
  eq(
    split.research.STR_BN_SPLIT.gatesValue,
    50,
    "split cone weight is both branches together (10 + 30 + 5 + 5)",
  );
  eq(
    split.research.STR_BN_SPLIT.gatesScore,
    20,
    "split scores what the heavier branch (cone 30) does not carry (50 - 30)",
  );
  eq(
    split.research.STR_BN_LONE.gatesTopics,
    undefined,
    "one dependent is not a major gate, even behind the heaviest score in the pack",
  );
}

/**
 * The one-per-cent floor: a gate scoring under one per cent of the pack's
 * heaviest bottleneck score stays unstamped even though it clears the count
 * bar — a "gate" holding weightless topics scores zero.
 */
{
  const floor = await rul(
    [
      "research:",
      "  - name: STR_BN_HEAVY_GATE",
      "    cost: 1000000",
      "  - name: STR_BN_HEAVY_1",
      "    cost: 1000000",
      "    dependencies: [STR_BN_HEAVY_GATE]",
      "  - name: STR_BN_HEAVY_2",
      "    cost: 1000000",
      "    dependencies: [STR_BN_HEAVY_GATE]",
      "  - name: STR_BN_HEAVY_3",
      "    cost: 1000000",
      "    dependencies: [STR_BN_HEAVY_GATE]",
      "  - name: STR_BN_LIGHT_GATE",
      "  - name: STR_BN_LIGHT_1",
      "    dependencies: [STR_BN_LIGHT_GATE]",
      "  - name: STR_BN_LIGHT_2",
      "    dependencies: [STR_BN_LIGHT_GATE]",
      "  - name: STR_BN_LIGHT_3",
      "    dependencies: [STR_BN_LIGHT_GATE]",
    ].join("\n"),
  );
  eq(floor.research.STR_BN_HEAVY_GATE.gatesTopics, 3, "the heaviest gate is stamped");
  eq(
    floor.research.STR_BN_HEAVY_GATE.gatesScore,
    3000000,
    "heaviest gate scores its dependents' combined weight (leaf weights are zero)",
  );
  eq(
    floor.research.STR_BN_LIGHT_GATE.gatesTopics,
    undefined,
    "three dependents behind a scoreless gate is under one per cent of the heaviest score: unstamped",
  );
}

/**
 * A single elite dependent is not a major gate either — the count bar holds
 * even when the score is enormous.
 */
{
  const elite = await rul(
    [
      "research:",
      "  - name: STR_BN_PREQ",
      "  - name: STR_BN_ELITE",
      "    cost: 2000000",
      "    dependencies: [STR_BN_PREQ]",
    ].join("\n"),
  );
  eq(
    elite.research.STR_BN_PREQ.gatesTopics,
    undefined,
    "one dependent, however valuable, is not a major gate",
  );
}

report();
