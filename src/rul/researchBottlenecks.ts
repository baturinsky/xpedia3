/**
 * Major bottlenecks in the research tree: topics that other topics cannot be
 * finished without, on the normal road.
 *
 * Availability on the normal road is conjunctive — a topic becomes available
 * when **all** of its `dependencies` are done (plus all of `requires`), so
 * every transitive prerequisite is individually necessary. The bottleneck
 * score of a topic is therefore its transitive dependents (topics whose
 * dependency cone contains it), counted and weighed — but only the ones that
 * *strictly* need it. A dependent that can be reached without the gate is
 * not behind it: through an "Unlocked by any one of" shortcut, through a
 * "May be granted free by" grant (including a guarded one, whose granter
 * and guard must both be reachable), through a topic granted outside
 * the research tree — an event's `researchList` or a deployment's
 * `unlockedResearch*`, handed in as `granted` (see `Ruleset`) — or
 * through another dependent that itself can be reached without the gate. A bypass source that cannot be
 * reached without the gate keeps the dependent strict, because every route
 * to it still runs through the gate. The strict cone is what is counted:
 *
 * - `dominated`: how many other topics sit behind it in its dependency cone.
 * - `weight`: summed `cost` + `points` over those topics, so a late gate
 *   behind a few elite topics (e.g. `STR_SCHOOLING_3`: 62 topics, weight
 *   6780) can compete with an early hub behind thousands of cheap shadows.
 * - `score`: the "bottleneck-ness" proper — the cone `weight` minus the
 *   heaviest *dependent's* cone weight, i.e. the mass this topic holds that
 *   no single child below it holds. Cone weights are monotone (a child never
 *   weighs more than its parent), so the heaviest dependent is always a
 *   direct one. A split point scores high; a link whose only dependent
 *   carries the whole cone scores just the next link's own weight; an early
 *   hub scores little because one child holds almost everything. This is
 *   what the major gate threshold and the pedia's Bottlenecks list rank by.
 *
 * (This is *not* graph dominance in the flow-graph sense: an OR-road "every
 * path passes through X" misses AND-necessity entirely — a topic required as
 * one of many `dependencies` does not dominate its dependents in that sense,
 * yet finishing them without it is impossible on the normal road.)
 *
 * Reachable sets are bit sets over the SCC-condensed dependency DAG: one
 * word-parallel union per edge, so the pass costs about 8 ms on a 4,600-topic
 * pack. Topics in a dependency cycle share a component and are never counted
 * as gating each other — a cycle cannot be finished the normal way at all.
 * The strict cone subtracts, per gate, the topics reachable without it
 * (see above); that check propagates both normal prerequisites (counter per
 * topic) and bypass options (counter per option), so a bypassed topic takes
 * everything that only needed it with it, while a topic with a second
 * dependency path to the gate stays.
 */

/** The sliver of a research topic the bottleneck pass reads */
export type BottleneckTopic = {
  name?: string;
  dependencies?: string[];
  requires?: string[];
  unlockedByAnyOf?: string[];
  getForFreeFrom?: string[];
  getOneFreeProtected?: { [guard: string]: string[] };
  cost?: number;
  points?: number;
};

export type BottleneckStats = {
  /** How many other topics sit behind it in their strict dependency cone */
  dominated: number;
  /** Summed `cost` + `points` over those topics */
  weight: number;
  /**
   * Bottleneck-ness: the cone `weight` minus the heaviest dependent's cone
   * weight — the mass held here that no single child below it holds.
   */
  score: number;
};

/**
 * Scores every topic in `research` by how many topics strictly depend on it,
 * transitively, through `dependencies` — minus the ones reachable without it
 * (see the header).
 *
 * `granted` names the topics granted outside the research tree (see
 * `Ruleset`): the grant finishes them without the gate, so they are
 * acquirable roots like prerequisite-less topics.
 *
 * Returns a map keyed by topic name; topics with no dependents get no entry,
 * so the caller can decide which majors are worth stamping.
 */
export function computeResearchBottlenecks(
  research: {
    [name: string]: BottleneckTopic;
  },
  granted: Iterable<string> = [],
): Map<string, BottleneckStats> {
  const names = Object.keys(research);
  const index = new Map(names.map((name, i) => [name, i]));
  const n = names.length;
  const grantedIdx = new Set<number>();
  for (const name of granted) {
    const i = index.get(name);
    if (i != null) grantedIdx.add(i);
  }
  const weightOf = new Array<number>(n).fill(0);

  // Edges run prerequisite -> dependent, the direction of availability.
  const succ: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (const [name, topic] of Object.entries(research)) {
    const i = index.get(name) as number;
    weightOf[i] = (Number(topic.cost) || 0) + (Number(topic.points) || 0);
    const deps = Array.isArray(topic.dependencies) ? topic.dependencies : [];
    for (const dep of deps) {
      const j = index.get(String(dep));
      if (j == null || j === i) continue;
      succ[j].add(i);
    }
  }

  // Strongly connected components (Tarjan, iterative) collapse dependency
  // cycles, leaving a DAG to propagate reachable sets over.
  const comp = new Array<number>(n).fill(-1);
  const order = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  let counter = 0;
  let compCnt = 0;
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
      const targets = [...succ[v]];
      if (child < targets.length) {
        frame[1] = child + 1;
        const w = targets[child];
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
          do {
            w = stack.pop() as number;
            onStack[w] = false;
            comp[w] = compCnt;
          } while (w !== v);
          compCnt++;
        }
      }
    }
  }

  const compSucc: Set<number>[] = Array.from({ length: compCnt }, () => new Set());
  for (let u = 0; u < n; u++)
    for (const v of succ[u]) if (comp[u] !== comp[v]) compSucc[comp[u]].add(comp[v]);

  // Postorder of the component DAG: successors finish before predecessors, so
  // a single forward sweep accumulates every component's reachable set.
  const topo: number[] = [];
  const visiting = new Array<boolean>(compCnt).fill(false);
  for (let s = 0; s < compCnt; s++) {
    if (visiting[s]) continue;
    const frames: [number, number][] = [[s, 0]];
    while (frames.length) {
      const frame = frames[frames.length - 1];
      const [c, child] = frame;
      const targets = [...compSucc[c]];
      if (child === 0) visiting[c] = true;
      if (child < targets.length) {
        frame[1] = child + 1;
        const w = targets[child];
        if (!visiting[w]) frames.push([w, 0]);
      } else {
        topo.push(c);
        frames.pop();
      }
    }
  }

  // Reachable sets are over original topics: a component's set is the union
  // of its successors' sets plus the member topics of those successors.
  // Successors are processed first (postorder), so one sweep suffices.
  const words = (n + 31) >>> 5;
  const compMembers: number[][] = Array.from({ length: compCnt }, () => []);
  for (let i = 0; i < n; i++) compMembers[comp[i]].push(i);
  const reach: Uint32Array[] = Array.from({ length: compCnt }, () => new Uint32Array(words));
  for (const c of topo) {
    const mine = reach[c];
    for (const d of compSucc[c]) {
      const row = reach[d];
      for (let w = 0; w < words; w++) mine[w] |= row[w];
      for (const m of compMembers[d]) mine[m >>> 5] |= 1 << (m & 31);
    }
  }

  // Dependency cone size per component: an upper bound on the strict cone,
  // and a cheap skip for topics that cannot gate anything.
  const compDepCount = new Int32Array(compCnt);
  for (let c = 0; c < compCnt; c++) {
    const row = reach[c];
    let count = 0;
    for (let w = 0; w < words; w++) {
      let bits = row[w];
      while (bits !== 0) {
        bits ^= bits & -bits;
        count++;
      }
    }
    compDepCount[c] = count;
  }

  // Normal prerequisites (`dependencies` + `requires`) for the avoidance
  // check: a topic is reachable without the gate when every one of them is.
  const normalCountBase = new Int32Array(n);
  const normalDependents: number[][] = Array.from({ length: n }, () => []);
  for (const [name, topic] of Object.entries(research)) {
    const i = index.get(name) as number;
    const prereqs = new Set<number>();
    for (const field of [topic.dependencies, topic.requires]) {
      if (!Array.isArray(field)) continue;
      for (const dep of field) {
        const j = index.get(String(dep));
        if (j != null && j !== i) prereqs.add(j);
      }
    }
    normalCountBase[i] = prereqs.size;
    for (const p of prereqs) normalDependents[p].push(i);
  }

  // Bypass options: one entry per alternative route to a topic, with the
  // topics that route needs. A shortcut unlock needs its unlocker; a free
  // grant needs its granter; a guarded free grant needs granter and guard.
  // Whether an option fires depends on those topics being reachable without
  // the gate, which is exactly the propagation below.
  const optionTarget: number[] = [];
  const optionPrereqs: number[][] = [];
  const seenOption = new Set<string>();
  const addOption = (target: number, prereqs: number[]) => {
    const unique = [...new Set(prereqs)].sort((a, b) => a - b);
    if (unique.length === 0) return;
    const key = `${target}|${unique.join(",")}`;
    if (seenOption.has(key)) return;
    seenOption.add(key);
    optionTarget.push(target);
    optionPrereqs.push(unique);
  };
  for (const [name, topic] of Object.entries(research)) {
    const i = index.get(name) as number;
    for (const list of [topic.unlockedByAnyOf, topic.getForFreeFrom]) {
      if (!Array.isArray(list)) continue;
      for (const src of list) {
        const j = index.get(String(src));
        if (j != null && j !== i) addOption(i, [j]);
      }
    }
  }
  for (const [name, topic] of Object.entries(research)) {
    const f = index.get(name) as number;
    const prot = topic.getOneFreeProtected;
    if (prot == null || typeof prot !== "object") continue;
    for (const [guardName, candidates] of Object.entries(prot)) {
      const g = index.get(guardName);
      if (g == null || !Array.isArray(candidates)) continue;
      for (const cand of candidates) {
        const d = index.get(String(cand));
        if (d == null || d === f || d === g) continue;
        addOption(d, [f, g]);
      }
    }
  }
  const optionCountBase = new Int32Array(optionPrereqs.map((p) => p.length));
  const optionUsers: number[][] = Array.from({ length: n }, () => []);
  for (let oi = 0; oi < optionPrereqs.length; oi++)
    for (const p of optionPrereqs[oi]) optionUsers[p].push(oi);

  // Topics reachable without `gate`, as a fixed point: roots first, then
  // every topic whose normal prerequisites are all reachable, and every
  // topic with a bypass option whose topics are all reachable. The gate
  // itself is never added, so anything whose only routes run through it
  // stays unreachable — precisely the strict cone's complement.
  function reachableWithout(gate: number) {
    const acquirable = new Uint8Array(n);
    const remNormal = new Int32Array(normalCountBase);
    const remOption = new Int32Array(optionCountBase);
    const queue: number[] = [];
    let head = 0;
    const add = (t: number) => {
      if (t !== gate && !acquirable[t]) {
        acquirable[t] = 1;
        queue.push(t);
      }
    };
    for (let i = 0; i < n; i++) if (remNormal[i] === 0 || grantedIdx.has(i)) add(i);
    while (head < queue.length) {
      const p = queue[head++];
      for (const d of normalDependents[p]) if (!acquirable[d] && --remNormal[d] === 0) add(d);
      for (const oi of optionUsers[p])
        if (remOption[oi] > 0 && --remOption[oi] === 0) add(optionTarget[oi]);
    }
    return acquirable;
  }

  const strictComputed = new Array<boolean>(n).fill(false);
  const strictDominated = new Int32Array(n);
  const strictWeight = new Float64Array(n);
  const strictRows: (Uint32Array | null)[] = new Array(n).fill(null);

  /** Strict cone of `gate`: its dependency cone minus what it can reach alone. */
  function strict(gate: number) {
    if (strictComputed[gate]) return;
    strictComputed[gate] = true;
    const acquirable = reachableWithout(gate);
    const depRow = reach[comp[gate]];
    const row = new Uint32Array(words);
    let dominated = 0;
    let weight = 0;
    for (let w = 0; w < words; w++) {
      let bits = depRow[w];
      while (bits !== 0) {
        const lowBit = bits & -bits;
        const u = w * 32 + (31 - Math.clz32(lowBit));
        bits ^= lowBit;
        if (u >= n || acquirable[u]) continue;
        row[w] |= 1 << (u & 31);
        dominated++;
        weight += weightOf[u];
      }
    }
    strictDominated[gate] = dominated;
    strictWeight[gate] = weight;
    strictRows[gate] = row;
  }

  // Exclusive score per topic: strict cone weight minus the heaviest strict
  // cone among direct dependents that are still strict. A strict dependent's
  // strict cone is a subset of the gate's (every route to the grandchild runs
  // through the child, and every route to the child runs through the gate),
  // while a bypassed dependent's cone is disjoint from the gate's — so only
  // strict dependents are subtracted, and the score never goes negative.
  for (let i = 0; i < n; i++) if (compDepCount[comp[i]] > 0) strict(i);

  const stats = new Map<string, BottleneckStats>();
  for (let i = 0; i < n; i++) {
    if (compDepCount[comp[i]] === 0) continue;
    const dominated = strictDominated[i];
    if (dominated === 0) continue;
    let heaviestChild = 0;
    const row = strictRows[i] as Uint32Array;
    for (const child of succ[i]) {
      if (comp[child] === comp[i]) continue;
      if (!(row[child >>> 5] & (1 << (child & 31)))) continue;
      heaviestChild = Math.max(heaviestChild, strictWeight[child]);
    }
    stats.set(names[i], {
      dominated,
      weight: strictWeight[i],
      score: strictWeight[i] - heaviestChild,
    });
  }
  return stats;
}
