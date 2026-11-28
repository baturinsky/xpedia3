/**
 * Other points of interest in the research tree, for the `RESEARCH` section
 * page's view switch (see `ResearchComponent`). Each metric is a head-count
 * a player can grasp at a glance:
 *
 * - `shortcutValue`: the widest dependency list this topic's `unlocks` skip
 *   — one research replacing a whole grind (e.g. an Academy topic unlocking a
 *   project with 115 prerequisites in X-Piratez).
 * - `freePool`: how many topics this topic may grant for free when completed,
 *   counting both the plain `getOneFree` inventory and the guarded
 *   (`getOneFreeProtected`) candidates that join the pool once their guard is
 *   done — the slot machines.
 * - `depth`: the longest prerequisite chain ending here, in edges — how deep
 *   the grind runs to reach this topic.
 * - `cycleSize`: the size of this topic's hard dependency cycle (strongly
 *   connected component over `dependencies`), or 1. A cycle is hard only
 *   with no entry from outside it — no member is unlocked by a topic
 *   outside the cycle, granted free by one, or a protected-grant candidate
 *   of one — so a soft cycle that a shortcut or grant can enter from
 *   outside does not count: none of the hard cycle's topics can be
 *   finished the normal road at all, which is what makes them interesting.
 * - `depsWidth`: the effective ALL width of `dependencies` — how many topics
 *   must all be done before this one is even available, with topics that also
 *   unlock it (`unlockedByAnyOf`) subtracted. The access rule is (all of
 *   `dependencies`) OR (any of `unlockedByAnyOf`), so a topic written in
 *   both places is an ANY shortcut, not part of the ALL list; counting it
 *   here would read a shortcut list (the 115-topic list on
 *   `STR_ALIEN_ORIGINS`, fully covered by its own shortcuts) as a wide ALL
 *   list. Only this metric subtracts the dual entries — depth, cycles and
 *   shortcut value still follow the raw lists, so chain links written as
 *   both dependency and unlocker stay in the prerequisite graph.
 * - `coneSize`: how many topics this one needs in total — the transitive
 *   `dependencies` cone, not just the direct list or the longest chain.
 * - `unlockCount` / `missionCount` / `manufactureCount` / `buyingCount`:
 *   how many topics, missions, manufacture entries and buyable items this
 *   one opens at once (raw `unlocks`, `unlocksMissions`, `manufacture`
 *   and `allowsBuying` widths).
 * - `cost` / `points`: the topic's own research time and score, kept
 *   separate because packs scale them differently (X-Piratez is
 *   points-heavy, X-Files cost-heavy).
 * - `disablesCount` / `requiresWidth`: how many topics this one disables,
 *   and how long its hard `requires` list is — `requires` is the one ALL
 *   list no shortcut bypasses.
 * - `freeGranters`: how many topics may grant this one free
 *   (`getForFreeFrom`) — the prize side of the slot machines, ranked by
 *   how widely it can be granted.
 * - `isRoot` / `isLeaf`: no prerequisites at all, or nothing depends on
 *   this one in any way (`dependencies`, `unlocks`, `getOneFree`).
 * - `freeOnly` / `unreachable`: reachability on the normal road (ALL
 *   `dependencies`+`requires`, OR any `unlockedByAnyOf`), plus two roads
 *   outside the research tree: a topic an event (`researchList`) or a mission
 *   deployment (`unlockedResearch`, `unlockedResearchOnFailure`,
 *   `unlockedResearchOnDespawn`) grants is finished the moment it fires, and
 *   both are handed in as `granted` (see `Ruleset`). A topic that is
 *   not normally reachable but a normally reachable topic may grant it
 *   free is free-only; one with no other road is unreachable.
 *
 * A topic is worth showing in a view when its metric clears the matching
 * threshold in `INTEREST_THRESHOLDS`. The thresholds are absolute — a
 * shortcut skipping nine prerequisites is a shortcut in every pack — while
 * the counts still go through `Ruleset.researchInterest`, which keeps only
 * topics that qualify for at least one view.
 */

/** The sliver of a research topic the interest pass reads */
export type InterestTopic = {
  name?: string;
  dependencies?: string[];
  requires?: string[];
  unlockedByAnyOf?: string[];
  unlocks?: string[];
  unlocksMissions?: string[];
  manufacture?: string[];
  allowsBuying?: string[];
  disables?: string[];
  requiredTogetherFor?: string[];
  getOneFree?: string[];
  getForFreeFrom?: string[];
  getOneFreeProtected?: { [guard: string]: string[] };
  cost?: number;
  points?: number;
};

export type ResearchInterest = {
  /** Widest dependency list skipped by this topic's `unlocks` */
  shortcutValue: number;
  /** Free-grant inventory size: `getOneFree` plus guarded candidates */
  freePool: number;
  /** Longest prerequisite chain ending here, in edges */
  depth: number;
  /** Size of this topic's hard dependency cycle, or 1 when acyclic/soft */
  cycleSize: number;
  /** Effective ALL width: `dependencies` minus dual `unlockedByAnyOf` entries */
  depsWidth: number;
  /** Transitive prerequisite cone size, excluding this topic */
  coneSize: number;
  /** How many topics this one unlocks at once */
  unlockCount: number;
  /** How many missions this one unlocks */
  missionCount: number;
  /** How many manufacture entries require this one */
  manufactureCount: number;
  /** How many buyable items this one opens */
  buyingCount: number;
  /** Own research time */
  cost: number;
  /** Own score */
  points: number;
  /** How many topics this one disables */
  disablesCount: number;
  /** Raw `requires` list width (never bypassed by shortcuts) */
  requiresWidth: number;
  /** How many topics may grant this one free */
  freeGranters: number;
  /** How many topics depend on this one in any way (for ranking roots) */
  dependents: number;
  /** No prerequisites at all: no `dependencies`, `requires` or shortcuts */
  isRoot: boolean;
  /** Nothing depends on this one: no `requiredTogetherFor`, `unlocks` or free grants */
  isLeaf: boolean;
  /** Not normally reachable, but a normally reachable topic may grant it free */
  freeOnly: boolean;
  /** Reachable neither normally nor via a free grant */
  unreachable: boolean;
};

/** Per-view cut-offs for what is worth showing; see the header */
export const INTEREST_THRESHOLDS = {
  shortcutValue: 10,
  freePool: 10,
  depth: 40,
  depsWidth: 10,
  coneSize: 500,
  unlockCount: 5,
  manufactureCount: 2,
  buyingCount: 3,
  cost: 100,
  points: 500,
  disablesCount: 3,
  freeGranters: 20,
};

/**
 * Scores every topic in `research` with the interest metrics above.
 *
 * `granted` names the topics granted outside the research tree — events'
 * `researchList` and mission deployments' `unlockedResearch*` (see
 * `Ruleset`). A grant finishes the topic no matter what its `dependencies`
 * say, so those topics seed the reachability pass below as if they were
 * roots.
 *
 * Returns a map keyed by topic name, for every topic in the pack — the caller
 * (`Ruleset`) decides which ones qualify for a view.
 */
export function computeResearchInterest(
  research: {
    [name: string]: InterestTopic;
  },
  granted: Iterable<string> = [],
): Map<string, ResearchInterest> {
  const names = Object.keys(research);
  const index = new Map(names.map((name, i) => [name, i]));
  const n = names.length;
  const known = (list: unknown): string[] =>
    Array.isArray(list)
      ? list.filter((x): x is string => typeof x === "string" && index.has(x))
      : [];

  // Dependency edges, topic -> each prerequisite it lists.
  const deps: number[][] = names.map((name) =>
    known(research[name]?.dependencies).map((d) => index.get(d) as number),
  );

  // Depth: memoised longest prerequisite chain, in edges. A cycle back-edge
  // contributes nothing, so topics in a cycle still get a finite depth.
  const depthMemo = new Int32Array(n).fill(-1);
  const depth = (i: number, seen: Set<number>): number => {
    if (depthMemo[i] !== -1) return depthMemo[i];
    if (seen.has(i)) return 0;
    seen.add(i);
    let best = 0;
    for (const d of deps[i]) best = Math.max(best, 1 + depth(d, seen));
    seen.delete(i);
    depthMemo[i] = best;
    return best;
  };

  // Strongly connected components (Tarjan, iterative) for the cycle sizes.
  const comp = new Array<number>(n).fill(-1);
  const order = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  const compSize: number[] = [];
  let counter = 0;
  for (let s = 0; s < n; s++) {
    if (order[s] !== -1) continue;
    const frames: [number, number][] = [[s, 0]];
    while (frames.length) {
      const frame = frames[frames.length - 1];
      const [v, child] = frame;
      if (child === 0) {
        order[v] = low[v] = counter++;
        stack.push(v);
        onStack[v] = true;
      }
      if (child < deps[v].length) {
        frame[1] = child + 1;
        const w = deps[v][child];
        if (w === v) continue;
        if (order[w] === -1) frames.push([w, 0]);
        else if (onStack[w]) low[v] = Math.min(low[v], order[w]);
      } else {
        frames.pop();
        if (frames.length) {
          const parent = frames[frames.length - 1][0];
          low[parent] = Math.min(low[parent], low[v]);
        }
        if (low[v] === order[v]) {
          let w = -1;
          let size = 0;
          do {
            w = stack.pop() as number;
            onStack[w] = false;
            comp[w] = compSize.length;
            size++;
          } while (w !== v);
          compSize.push(size);
        }
      }
    }
  }

  // Hard cycles only (see the header): an SCC with an outside entry — a
  // member unlocked by, granted free by, or a protected-grant candidate of
  // a topic outside the SCC — can be entered from outside, so it is soft
  // and reports 1 like an acyclic topic.
  const compMembers: number[][] = compSize.map(() => []);
  for (let i = 0; i < n; i++) compMembers[comp[i]]?.push(i);
  // Protected granters per candidate: topic -> [granter, guard] pairs.
  const protPairs = new Map<string, [number, number][]>();
  for (const [name, topic] of Object.entries(research)) {
    const prot = topic?.getOneFreeProtected;
    if (prot == null || typeof prot !== "object") continue;
    for (const [guard, list] of Object.entries(prot)) {
      if (!index.has(guard)) continue;
      for (const cand of known(list)) {
        if (!protPairs.has(cand)) protPairs.set(cand, []);
        protPairs.get(cand)?.push([index.get(name) as number, index.get(guard) as number]);
      }
    }
  }
  const hardCycleSize = compSize.map((size, c) => {
    if (size < 2) return 1;
    for (const i of compMembers[c] ?? []) {
      const topic = research[names[i]];
      const outside = (list: unknown) =>
        known(list).some((x) => comp[index.get(x) as number] !== c);
      if (outside(topic?.unlockedByAnyOf) || outside(topic?.getForFreeFrom)) return 1;
      // The guard is not checked for cycle hardness — an outside granter
      // is an entry either way for this view.
      const pairs = protPairs.get(names[i]);
      if (pairs?.some(([g]) => comp[g] !== c)) return 1;
    }
    return size;
  });

  // Transitive prerequisite cones over the SCC DAG, as bit sets (same
  // word-parallel union the bottleneck pass uses): Tarjan pushes sink
  // SCCs first, and a topic's dep comps are sinks-ward of it, so ascending
  // comp order always has every dep comp's cone ready.
  const compCnt = compSize.length;
  const words = Math.max(1, Math.ceil(compCnt / 32));
  const coneBits: Uint32Array[] = [];
  const coneSizeOf: number[] = [];
  for (let c = 0; c < compCnt; c++) {
    const bits = new Uint32Array(words);
    for (const i of compMembers[c] ?? [])
      for (const d of deps[i]) {
        const dc = comp[d];
        if (dc === c) continue;
        const db = coneBits[dc];
        if (db) for (let w = 0; w < words; w++) bits[w] |= db[w];
        bits[Math.floor(dc / 32)] |= 1 << (dc % 32);
      }
    coneBits.push(bits);
    let count = 0;
    for (let w = 0; w < words; w++) {
      let word = bits[w];
      while (word) {
        const bit = word & -word;
        const d = w * 32 + (31 - Math.clz32(bit));
        count += compSize[d] ?? 1;
        word ^= bit;
      }
    }
    coneSizeOf.push(count);
  }

  // Normal-road reachability (see the header): ALL `dependencies`+
  // `requires`, OR any `unlockedByAnyOf`. A counter per topic, drained by
  // reachable prerequisites; an unlocker reaching a topic marks it at once.
  // Topics granted outside the tree (`granted`) start reachable: the grant
  // finishes them whether or not their prerequisites are done.
  const grantedIdx = new Set<number>();
  for (const name of granted) {
    const i = index.get(name);
    if (i != null) grantedIdx.add(i);
  }
  const allPrereqs: number[][] = names.map((name) => [
    ...new Set([...known(research[name]?.dependencies), ...known(research[name]?.requires)]),
  ]);
  const remaining = allPrereqs.map((list) => list.length);
  const dependents: number[][] = Array.from({ length: n }, () => []);
  allPrereqs.forEach((list, i) => {
    for (const p of list.map((x) => index.get(x) as number)) dependents[p]?.push(i);
  });
  const unlockTargets: number[][] = names.map((name) =>
    known(research[name]?.unlocks).map((x) => index.get(x) as number),
  );
  const reachable = new Array<boolean>(n).fill(false);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (remaining[i] === 0 || grantedIdx.has(i)) queue.push(i);
  }
  while (queue.length) {
    const i = queue.pop() as number;
    if (reachable[i]) continue;
    reachable[i] = true;
    for (const d of dependents[i] ?? []) {
      if (reachable[d]) continue;
      if (--remaining[d] === 0) queue.push(d);
    }
    for (const t of unlockTargets[i] ?? []) if (!reachable[t]) queue.push(t);
  }

  const stats = new Map<string, ResearchInterest>();
  for (const [name, topic] of Object.entries(research)) {
    const i = index.get(name) as number;

    let shortcutValue = 0;
    for (const target of known(topic?.unlocks))
      shortcutValue = Math.max(shortcutValue, (research[target]?.dependencies ?? []).length);

    const pool = new Set<string>(known(topic?.getOneFree));
    const prot = topic?.getOneFreeProtected;
    if (prot != null && typeof prot === "object")
      for (const list of Object.values(prot)) for (const cand of known(list)) pool.add(cand);

    // Effective ALL width (see the header): a dependency that also unlocks
    // this topic is an ANY shortcut, not part of the ALL list. Raw lists on
    // purpose — only the dual entries are subtracted, missing references
    // keep counting the way they did before.
    const rawDeps = Array.isArray(topic?.dependencies) ? topic.dependencies : [];
    const shortcuts = new Set(Array.isArray(topic?.unlockedByAnyOf) ? topic.unlockedByAnyOf : []);
    const depsWidth = rawDeps.filter((d) => !shortcuts.has(d)).length;

    stats.set(name, {
      shortcutValue,
      freePool: pool.size,
      depth: depth(i, new Set()),
      cycleSize: hardCycleSize[comp[i]] ?? 1,
      depsWidth,
      coneSize: coneSizeOf[comp[i]] ?? 0,
      unlockCount: known(topic?.unlocks).length,
      missionCount: Array.isArray(topic?.unlocksMissions) ? topic.unlocksMissions.length : 0,
      manufactureCount: Array.isArray(topic?.manufacture) ? topic.manufacture.length : 0,
      buyingCount: Array.isArray(topic?.allowsBuying) ? topic.allowsBuying.length : 0,
      cost: Number(topic?.cost) || 0,
      points: Number(topic?.points) || 0,
      disablesCount: Array.isArray(topic?.disables) ? topic.disables.length : 0,
      requiresWidth: Array.isArray(topic?.requires) ? topic.requires.length : 0,
      freeGranters: known(topic?.getForFreeFrom).length,
      dependents: known(topic?.requiredTogetherFor).length + known(topic?.unlocks).length,
      isRoot:
        known(topic?.dependencies).length === 0 &&
        known(topic?.requires).length === 0 &&
        known(topic?.unlockedByAnyOf).length === 0,
      isLeaf:
        known(topic?.requiredTogetherFor).length === 0 &&
        known(topic?.unlocks).length === 0 &&
        known(topic?.getOneFree).length === 0,
      freeOnly: false,
      unreachable: false,
    });

    // Free-only / unreachable (see the header): not normally reachable, but
    // a normally reachable granter (plain, or granter+guard for protected
    // candidates) may still grant it free.
    if (!reachable[i]) {
      const granted = known(topic?.getForFreeFrom).some((x) => reachable[index.get(x) as number]);
      const protectedGranted = (protPairs.get(name) ?? []).some(
        ([g, guard]) => reachable[g] && reachable[guard],
      );
      const statsFor = stats.get(name);
      if (statsFor) {
        statsFor.freeOnly = granted || protectedGranted;
        statsFor.unreachable = !(granted || protectedGranted);
      }
    }
  }
  return stats;
}
