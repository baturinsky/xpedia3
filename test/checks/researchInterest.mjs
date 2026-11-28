/**
 * Points of interest for the `RESEARCH` page's view switch: shortcut hubs,
 * slot machines, deep chains, cycles, wide lists (see
 * `src/rul/researchInterest.ts`). `Ruleset.researchInterest` keeps only the
 * topics clearing a view's threshold, so each view lists the interesting few.
 */
import { eq, report } from "../helpers/check.mjs";
import { testPack } from "../helpers/packs.mjs";

const lines = ["research:"];

// Wide list + shortcut hub: TARGET lists ten prerequisites, HUB unlocks it.
// SMALL lists nine, SMALLHUB unlocks it — just below the shortcut bar, so
// neither qualifies anywhere.
for (let i = 0; i < 10; i++) lines.push(`  - name: STR_D${i}`);
lines.push(
  "  - name: STR_TARGET",
  "    dependencies: [STR_D0, STR_D1, STR_D2, STR_D3, STR_D4, STR_D5, STR_D6, STR_D7, STR_D8, STR_D9]",
);
lines.push("  - name: STR_HUB", "    unlocks: [STR_TARGET]");
for (let i = 0; i < 9; i++) lines.push(`  - name: STR_E${i}`);
lines.push(
  "  - name: STR_SMALL",
  "    dependencies: [STR_E0, STR_E1, STR_E2, STR_E3, STR_E4, STR_E5, STR_E6, STR_E7, STR_E8]",
);
lines.push("  - name: STR_SMALLHUB", "    unlocks: [STR_SMALL]");

// Slot machines: SOURCE grants ten plain candidates; SOURCE2 grants eight
// plain plus two guarded ones (ten in the union); NEGSOURCE grants nine.
for (let i = 0; i < 10; i++) lines.push(`  - name: STR_F${i}`);
lines.push("  - name: STR_P0", "  - name: STR_P1", "  - name: STR_GUARD");
lines.push(
  "  - name: STR_SOURCE",
  "    getOneFree: [STR_F0, STR_F1, STR_F2, STR_F3, STR_F4, STR_F5, STR_F6, STR_F7, STR_F8, STR_F9]",
  "  - name: STR_SOURCE2",
  "    getOneFree: [STR_F0, STR_F1, STR_F2, STR_F3, STR_F4, STR_F5, STR_F6, STR_F7]",
  "    getOneFreeProtected:",
  "      STR_GUARD: [STR_P0, STR_P1]",
  "  - name: STR_NEGSOURCE",
  "    getOneFree: [STR_F0, STR_F1, STR_F2, STR_F3, STR_F4, STR_F5, STR_F6, STR_F7, STR_F8]",
);

// A 41-topic chain: the last topic sits at depth 40, the one before at 39.
lines.push("  - name: STR_CH0");
for (let i = 1; i <= 40; i++)
  lines.push(`  - name: STR_CH${i}`, `    dependencies: [STR_CH${i - 1}]`);

// A three-topic dependency cycle: none of it can be finished the normal way.
lines.push(
  "  - name: STR_C1",
  "    dependencies: [STR_C2]",
  "  - name: STR_C2",
  "    dependencies: [STR_C3]",
  "  - name: STR_C3",
  "    dependencies: [STR_C1]",
);

// Soft cycles: a cycle with an outside entry is not a hard lock. SOFT is
// entered via an outside unlocker, SOFTFREE via an outside free grant.
lines.push(
  "  - name: STR_SOFT_OUT",
  "    unlocks: [STR_SOFT1]",
  "  - name: STR_SOFT1",
  "    dependencies: [STR_SOFT2]",
  "  - name: STR_SOFT2",
  "    dependencies: [STR_SOFT1]",
  "  - name: STR_SOFTSOURCE",
  "    getOneFree: [STR_SOFTFREE1]",
  "  - name: STR_SOFTFREE1",
  "    dependencies: [STR_SOFTFREE2]",
  "  - name: STR_SOFTFREE2",
  "    dependencies: [STR_SOFTFREE1]",
  "  - name: STR_SOFTPROTGRANTER",
  "    getOneFreeProtected:",
  "      STR_SOFTGUARD: [STR_SOFTPROT1]",
  "  - name: STR_SOFTGUARD",
  "  - name: STR_SOFTPROT1",
  "    dependencies: [STR_SOFTPROT2]",
  "  - name: STR_SOFTPROT2",
  "    dependencies: [STR_SOFTPROT1]",
);

// Dual connections: a topic written in both `dependencies` and (via the
// hub's `unlocks`) `unlockedByAnyOf` is an ANY shortcut, not part of the
// ALL list. WIDE_DUAL lists ten topics including its hub, so its effective
// ALL width is nine — below the wide bar. PARTIAL lists the hub plus one
// more, leaving an effective width of one.
for (let i = 0; i < 9; i++) lines.push(`  - name: STR_W${i}`);
lines.push(
  "  - name: STR_WIDE_DUAL",
  "    dependencies: [STR_W0, STR_W1, STR_W2, STR_W3, STR_W4, STR_W5, STR_W6, STR_W7, STR_W8, STR_DUALHUB]",
  "  - name: STR_DUALHUB",
  "    unlocks: [STR_WIDE_DUAL]",
  "  - name: STR_PARTIAL_KEEP",
  "  - name: STR_PARTIAL_HUB",
  "    unlocks: [STR_PARTIAL]",
  "  - name: STR_PARTIAL",
  "    dependencies: [STR_PARTIAL_HUB, STR_PARTIAL_KEEP]",
);

// New special lists: expensive, disablers, requirements, unlock hubs,
// free prizes, free-only, roots/leaves are exercised below.
lines.push("  - name: STR_COSTLY", "    cost: 100");
lines.push("  - name: STR_CHEAP", "    cost: 99");
lines.push("  - name: STR_POINTY", "    points: 500");
lines.push("  - name: STR_LOWPOINTS", "    points: 499");
lines.push("  - name: STR_DISABLER", "    disables: [STR_D0, STR_D1, STR_D2]");
lines.push("  - name: STR_REQMANY", "    requires: [STR_D0]");
lines.push("  - name: STR_UNLOCKHUB", "    unlocks: [STR_F0, STR_F1, STR_F2, STR_F3, STR_F4]");
lines.push("  - name: STR_FREEPRIZE");
for (let i = 0; i < 20; i++)
  lines.push(`  - name: STR_GRANTER${i}`, "    getOneFree: [STR_FREEPRIZE]");
// Free-only: needs the hard cycle C1, but a root granter can grant it free.
lines.push(
  "  - name: STR_FREEONLY",
  "    dependencies: [STR_C1]",
  "  - name: STR_FO_GRANTER",
  "    getOneFree: [STR_FREEONLY]",
  "  - name: STR_PROD",
  "  - name: STR_PRODSINGLE",
  "  - name: STR_MISSIONTOPIC",
  "  - name: STR_BUYHUB",
  "  - name: STR_EVGRANT",
  "    dependencies: [STR_C1]",
  "    unlocks: [STR_F0, STR_F1, STR_F2, STR_F3, STR_F4]",
  "  - name: STR_EVDEP",
  "    dependencies: [STR_EVGRANT]",
  "  - name: STR_DEPLOYGRANT",
  "    dependencies: [STR_C1]",
  "  - name: STR_NOGRANT",
  "    dependencies: [STR_C1]",
);
// A 501-topic chain: the last topic's cone is 500, the one before is 499.
lines.push("  - name: STR_G0");
for (let i = 1; i <= 500; i++)
  lines.push(`  - name: STR_G${i}`, `    dependencies: [STR_G${i - 1}]`);
// Manufacture and mission entries, parsed after research (see Ruleset).
lines.push(
  "manufacture:",
  "  - name: STR_MFG_A",
  "    requires: [STR_PROD]",
  "    time: 1",
  "  - name: STR_MFG_B",
  "    requires: [STR_PROD]",
  "    time: 1",
  "  - name: STR_MFG_C",
  "    requires: [STR_PRODSINGLE]",
  "    time: 1",
  "missionScripts:",
  "  - type: str_test_mission",
  "    researchTriggers:",
  "      STR_MISSIONTOPIC: true",
);
// Shop unlockers: BUYHUB opens three items for purchase. The event and the
// deployment grant two of the cycle-stuck topics (EVGRANT, DEPLOYGRANT);
// NOGRANT stays stuck.
lines.push(
  "items:",
  "  - name: STR_BUY1",
  "    requiresBuy: [STR_BUYHUB]",
  "  - name: STR_BUY2",
  "    requiresBuy: [STR_BUYHUB]",
  "  - name: STR_BUY3",
  "    requiresBuy: [STR_BUYHUB]",
  "events:",
  "  - name: STR_EV_TEST",
  "    researchList: [STR_EVGRANT]",
  "alienDeployments:",
  "  - type: str_test_deployment",
  "    unlockedResearch: STR_DEPLOYGRANT",
);

const rul = await testPack({ rul: lines.join("\n") });
const interest = rul.researchInterest ?? {};

eq(
  interest.STR_HUB?.shortcutValue,
  10,
  "hub skipping a ten-topic list qualifies as a shortcut hub",
);
eq(interest.STR_TARGET?.depsWidth, 10, "target lists ten prerequisites: wide list view");
eq(
  interest.STR_SMALLHUB?.shortcutValue,
  9,
  "hub skipping nine prerequisites is below the shortcut bar (kept as a root)",
);
eq(interest.STR_SMALL?.isLeaf, true, "a topic nothing depends on is a leaf (kept whole)");
eq(interest.STR_SOURCE?.freePool, 10, "ten plain free-grant candidates qualify as a slot machine");
eq(interest.STR_SOURCE2?.freePool, 10, "guarded candidates join the pool: eight plus two is ten");
eq(
  interest.STR_NEGSOURCE?.isRoot,
  true,
  "nine free-grant candidates is below the slot-machine bar (kept as a root)",
);
eq(interest.STR_CH40?.depth, 40, "end of a 41-topic chain sits at depth 40");
eq(interest.STR_CH39, undefined, "one short of depth 40 is below the deep-chain bar");
eq(interest.STR_C1?.cycleSize, 3, "cycle member reports its cycle size");
eq(interest.STR_C2?.cycleSize, 3, "every member of the cycle qualifies");
eq(interest.STR_C3?.cycleSize, 3, "every member of the cycle qualifies");
eq(interest.STR_SOFT1, undefined, "cycle with an outside unlocker is soft, not a hard lock");
eq(interest.STR_SOFT2, undefined, "soft cycle: every member is excluded, not just the entry");
eq(
  interest.STR_SOFTFREE1?.freeOnly,
  true,
  "cycle with an outside free grant is soft, but now free-only",
);
eq(interest.STR_SOFTFREE2?.unreachable, true, "soft free cycle: the other member is unreachable");
eq(
  interest.STR_SOFTPROT1?.freeOnly,
  true,
  "cycle with an outside protected granter is soft, now free-only",
);
eq(
  interest.STR_SOFTPROT2?.unreachable,
  true,
  "soft protected cycle: the other member is unreachable",
);
eq(interest.STR_C1?.unreachable, true, "hard cycle member is unreachable on the normal road");
eq(interest.STR_D0?.isRoot, true, "a plain root is kept whole in the roots view");
eq(
  interest.STR_WIDE_DUAL?.depsWidth,
  9,
  "dual connection: ten written prerequisites minus the hub is nine, below the wide bar",
);
eq(
  interest.STR_DUALHUB?.shortcutValue,
  10,
  "hub of a dual target still skips the ten-topic written list",
);
eq(
  rul.research.STR_PARTIAL?.dependencies,
  ["STR_PARTIAL_HUB", "STR_PARTIAL_KEEP"],
  "dual connection: the raw ALL list is kept for the other metrics",
);
eq(
  rul.research.STR_PARTIAL?.unlockedByAnyOf,
  ["STR_PARTIAL_HUB"],
  "dual connection: the hub stays as the explicit ANY shortcut",
);
eq(
  rul.research.STR_PARTIAL_HUB?.requiredTogetherFor,
  [],
  "dual connection: the hub no longer needs the target researched together",
);
eq(
  rul.research.STR_PARTIAL_KEEP?.requiredTogetherFor,
  [],
  "subsumed target: no prerequisite keeps a together-backlink to it",
);
eq(interest.STR_G500?.coneSize, 500, "end of a 501-topic chain needs 500 topics in total");
eq(interest.STR_G499?.coneSize, 499, "one short of the grind bar");
eq(interest.STR_UNLOCKHUB?.unlockCount, 5, "unlocking five topics qualifies as an unlock hub");
eq(
  interest.STR_PROD?.manufactureCount,
  2,
  "gating two manufacture entries qualifies as production hub",
);
eq(interest.STR_PRODSINGLE?.manufactureCount, 1, "gating one manufacture entry is below the bar");
eq(
  interest.STR_MISSIONTOPIC?.missionCount,
  1,
  "triggering a mission qualifies as mission unlocker",
);
eq(
  interest.STR_BUYHUB?.buyingCount,
  3,
  "opening three items for purchase qualifies as shop unlocker",
);
eq(interest.STR_COSTLY?.cost, 100, "cost 100 qualifies as expensive by cost");
eq(interest.STR_CHEAP?.cost, 99, "cost 99 is below the expensive-by-cost bar");
eq(interest.STR_POINTY?.points, 500, "points 500 qualifies as expensive by points");
eq(interest.STR_LOWPOINTS?.points, 499, "points 499 is below the expensive-by-points bar");
eq(interest.STR_DISABLER?.disablesCount, 3, "disabling three topics qualifies as disabler");
eq(interest.STR_REQMANY?.requiresWidth, 1, "a 'requires' entry qualifies for long requirements");
eq(interest.STR_FREEPRIZE?.freeGranters, 20, "twenty granters qualify as a free prize");
eq(interest.STR_FREEONLY?.freeOnly, true, "unreachable normally but granted free is free-only");
eq(interest.STR_FREEONLY?.unreachable, false, "free-only is not unreachable");
eq(
  interest.STR_EVGRANT?.unreachable,
  false,
  "an event grant finishes the topic: it is not unreachable",
);
eq(interest.STR_EVGRANT?.freeOnly, false, "an event grant is its own road, not a free grant");
eq(
  interest.STR_EVDEP?.unreachable,
  false,
  "a dependent of an event-granted topic becomes reachable",
);
eq(
  interest.STR_DEPLOYGRANT?.unreachable,
  false,
  "a deployment grant finishes the topic: it is not unreachable",
);
eq(
  interest.STR_NOGRANT?.unreachable,
  true,
  "stuck behind the hard cycle with no grant anywhere: still unreachable",
);
eq(
  rul.research.STR_EVGRANT?.events,
  ["STR_EV_TEST"],
  "the granting event backlinks onto the topic",
);
eq(
  rul.research.STR_DEPLOYGRANT?.deployments,
  ["str_test_deployment"],
  "the granting deployment backlinks onto the topic",
);

report();
