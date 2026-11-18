# Enemy missions, base attacks and UFO flights

A guide to how alien activity is defined in `.rul` files, checked against the
OpenXcom Extended source (`src/Savegame/AlienMission.cpp`,
`src/Geoscape/GeoscapeState.cpp`, `src/Mod/Rule*.cpp`) and the vanilla
`bin/standard/xcom1/*.rul` from this repo's engine copy. Where the engine and
its own comments disagree, the engine wins and the comment is called out.

---

## 1. The mental model

There are **three layers**, and each answers a different question:

| Layer | File | Question it answers |
| --- | --- | --- |
| Mission script | `missionScripts.rul` | *When* is a mission created, *where* does it happen |
| Alien mission | `alienMissions.rul` | *What* the aliens are doing: which UFOs, in what order, with what objective |
| Trajectory + region | `ufoTrajectories.rul`, `regions.rul` | *How* the UFO flies, and *which patch of Earth* it uses |

Supporting files hang off that spine:

```
missionScripts.rul   monthly dice roll: "start a terror mission in Europe"
        │
        ▼
alienMissions.rul    the mission recipe: waves of UFOs + objective
        │                 ├── ufos.rul              stats, terrain, missionScore
        │                 └── alienRaces.rul         raceWeights, retaliation aggression
        ▼
ufoTrajectories.rul  a list of [zone, altitude, speed] legs
        │
        ▼
regions.rul          missionZones: the actual lon/lat boxes a trajectory's zone index
        │            points at, plus the deployment texture for sites
        ▼
globe.rul            textures (negative ids = alienDeployment-based)
        │
        ▼
alienDeployments.rul battlescape: terrain, mapScripts, markers, duration, points
```

Two things are worth holding onto from the start:

- **A mission is a state machine, not a schedule.** It is created once, then
  every 30 game minutes `AlienMission::think()` either counts down or spawns the
  next UFO of the current wave. Nothing re-reads `missionScripts.rul` after the
  mission exists.
- **The script picks the region; the mission picks the zone inside it.** The
  script says "Europe". The mission's `spawnZone` (or the trajectory's own zone
  index) says "zone 3 of Europe", and `regions.rul` says where zone 3 actually
  is.

---

## 2. Layer 1: `missionScripts.rul`, the scheduler

### 2.1 When it runs

`GeoscapeState::determineAlienMissions()` (`GeoscapeState.cpp:3755`) is called:

| Trigger | Where |
| --- | --- |
| Every game month | `time1Month()` (`:2916`) |
| Once at campaign start, when `MonthsPassed == -1` and the first base has a name | `:763` |
| When a geoscape event fires, for **adhoc** scripts only | `GeoscapeEventState.cpp:142` |

At the start of the run it also executes `arcScripts` (higher-level progression),
which is why arc scripts are documented as "run just before mission scripts".

It also snapshots the data the filters need: current month, last month's score,
and the funds the player *will* have this month
(`funds + countryFunding + performanceBonus - baseMaintenance`).

### 2.2 The four filter passes

Scripts are **all** evaluated, in file order, every month. There is no
"pick one" — every script that survives all passes runs.

**Pass 0 — adhoc tag match** (adhoc scripts only)

The firing event's `adhocMissionScriptTags` must overlap the script's own
`adhocMissionScriptTags`, otherwise the script is skipped.

**Pass 1 — time, budget and difficulty**

| Field | Condition |
| --- | --- |
| `firstMonth` | `firstMonth <= monthsPassed` |
| `lastMonth` | `lastMonth >= monthsPassed`, or `-1` for no limit |
| `maxRuns` | `-1`, or `maxRuns > strategy.getMissionsRun(varName)` |
| `minScore` / `maxScore` | last month's rating (not checked in month 0) |
| `minFunds` / `maxFunds` | this month's projected funds (not checked in month 0) |
| `minDifficulty` / `maxDifficulty` | player difficulty, 0..4 |

Note `firstMonth: 0` = the "month -1" start, and `lastMonth: 0` = run once.

**Pass 2 — world state**

All of these are `map<string, bool>`: the value is what you want the world to
look like. Any mismatch kills the script.

| Field | Checks |
| --- | --- |
| `researchTriggers` | `isResearched(topic) == value` |
| `itemTriggers` | item present in **base stores** |
| `facilityTriggers` | facility built in **any** base |
| `baseFunctionTriggers` | base service enabled (e.g. `STR_HYPER_WAVE_DECODER`) |
| `soldierTypeTriggers` | soldier type hired anywhere |
| `xcomBaseInRegionTriggers` | a base located in that region |
| `xcomBaseInCountryTriggers` | a base located in that country |
| `pactCountryTriggers` | country has signed a pact |

Plus the counters, which use the *values* of `missionVarName` / `missionMarkerName`
rather than a boolean:

| Field | Condition |
| --- | --- |
| `counterMin` | `>=` missions run under `missionVarName`, or `>=` `save->getLastId(missionMarkerName)` |
| `counterMax` | `<=` the same, `-1` = no limit |

Which one is used is decided by which name you filled in — `missionVarName`
counts *missions*, `missionMarkerName` reads an *object id counter*.

**Pass 3 — conditionals over labels**

Every script with `label > 0` records its own success or failure, so later
scripts can depend on it. Duplicate labels throw at load-dependent time
("Two or more commands sharing the same label").

The check is (`GeoscapeState.cpp:4171`):

```cpp
auto found = conditions.find(std::abs(condition));
process = (found == conditions.end()                       // never reached
        || (found->second == true  && condition > 0)        // success
        || (found->second == false && condition < 0));      // failure
```

So `[1, -4]` means "label 1 succeeded **and** label 4 did not".

The gotcha: **a script that never ran satisfies every conditional**, positive or
negative, because the label is missing from the map. The engine's own inline
comment claims a `0` in the list "will never resolve to true"; the code actually
lets it pass for the same reason. Don't use `0`.

Vanilla uses this to build a difficulty ladder out of one mechanic:

```yaml
- type: researchRetaliation          # runs once, ever
  label: 1
- type: beginnerRetaliation
  firstMonth: 14
  conditionals: [-1]                 # no retaliation happened yet
  label: 2
- type: experiencedRetaliation
  firstMonth: 13
  minDifficulty: 1
  conditionals: [-1, -2]             # neither 1 nor 2 happened
  label: 3
# ... up to superhumanRetaliation with conditionals: [-1,-2,-3,-4,-5]
```

Each rung is gated by "all previous rungs failed", so exactly one fires.

**Pass 4 — `executionOdds`**

`RNG::percent(executionOdds)`. Note `percent(v)` is `generate(0,99) < v`, so
`100` always runs, `0` never does. This is the knob for "one of these two
scripts this month" — the docs recommend it over mixing mission types.

Surviving scripts go into `availableMissions`, then are processed **in list
order**. `processCommand()` returning `false` (e.g. "no valid spawn area") means
that script fails, and its label records `false`.

### 2.3 Delays: `startDelay` and `randomDelay`

```yaml
startDelay: 150      # minutes before the first wave
randomDelay: 43500   # plus RNG(0, randomDelay) minutes
```

`getDelay()` returns `startDelay + RNG(0, randomDelay)` (0 if both are 0). It is
passed to `AlienMission::start(..., delay)`. Vanilla's own field comment describes
`startDelay` as *"number of minutes to delay the start of the mission (rounded
down to the nearest 30, 0 to use the wave timer from the mission itself)"*.

**Important:** a non-zero delay *bypasses* the wave-0 timer randomisation
entirely — the countdown is set to exactly that many minutes. With a delay of 0,
the normal `timer` rolling applies (see 3.3). The engine decrements countdowns
in 30-minute steps, so the actual spawn lands on the next half-hour tick after
the delay expires.

XFiles leans hard on this: `startDelay: 30` + `randomDelay: 43500` on essentially
every scripted mission (783 of its 799 scripts) = "sometime in the next month"
(43500 ≈ 30 days).

### 2.4 Mission, race and region selection

`processCommand()` (`:4457`) has three routes.

**Route A — mission-site commands** (`getSiteType()` true)

`Mod.cpp` sets this flag automatically: if *every* mission in the script's
`missionWeights` has `objective: 3`, the script is a site script. Mixing site
and non-site missions in one script throws ("cannot mix terror/non-terror
missions in a single command").

The site path:

1. Pick a mission from `missionWeights` (month-chunked weighted table).
2. Build `validAreas` = every `(region, areaIndex)` pair that
   - does not already have an identical mission running *in that region*
     (`same mission type + same region` is pruned), and
   - for **point areas** (cities), passes
     `strategy.validMissionLocation(varName, region, index)` — the
     `avoidRepeats` history, and
   - for **rectangular areas**, is accepted only if
     `area.texture < 0 || mission has siteType || the wave spawns a deployment
     directly`. A plain rectangle with a positive texture and no `siteType` is
     not a valid target.
3. If nothing is valid, try the next mission in `missionWeights` (wrapping), and
   give up after trying all of them.
4. Pick a region: `regionWeights` if present, else uniformly among **all**
   regions in the ruleset (deliberately uniform, "regardless of the number of
   cities"). If `targetBaseOdds` rolled true, the region list is first pruned to
   regions containing an XCOM base.
5. Pick one of that region's valid areas.
6. `strategy.addMissionLocation(varName, region, area, avoidRepeats)` — the
   city becomes off-limits for the next `avoidRepeats` runs of this `varName`.
7. The chosen area index is stored on the mission as `missionSiteZoneArea`, so
   the mission spawns its site on exactly that city.

**Route B — `targetBaseOdds`**

`RNG::percent(targetBaseOdds)` → the region is drawn from regions that contain
an XCOM base. If `missionWeights` exists, the mission is picked there too and
regions already running that mission are skipped.

**Route C — everything else**

- region from `regionWeights`, else `strategy.chooseRandomRegion()` (the
  classic weighted table built from `regions.rul`'s `regionWeight`), and
- mission from `missionWeights`, else `strategy.chooseRandomMission(region)`
  (the table built from `regions.rul`'s `missionWeights`).

Then race: `raceWeights` on the script if present, else
`alienMissions.rul`'s own `raceWeights` via `generateRace(month)`.

Finally:

```cpp
mission->setRegion(targetRegion, *mod);       // honouring region missionRegion
mission->setMissionSiteZoneArea(targetAreaNumber);
mission->start(*game, *globe, command->getDelay());
```

### 2.5 The classic table: `useTable`, `varName`, `maxRuns`, `avoidRepeats`

`AlienStrategy` (saved inside the savegame) holds one weighted mission table per
region, seeded from `regions.rul`. With `useTable: true` (the default), creating
a mission **removes that mission from that region's table**
(`strategy.removeMission`). The table is only rebuilt when *every* region has
been drained — so in practice a mission appearing once per region is gone for
the rest of the campaign.

That is why modern mods write `useTable: false` on scripted missions: they want
`executionOdds` and `conditionals` to be the only limit, not a depleting table.

`varName` is the key for the two counters:

| Field | Effect |
| --- | --- |
| `maxRuns: N` | at most N missions created under this `varName` |
| `avoidRepeats: N` | remember the last N `(region, area)` pairs, don't reuse them |

Both require `varName`, enforced at load:
*"no varName provided for a script with maxRuns or repeatAvoidance."*
`addMissionRun()` increments once per **created mission**; `avoidRepeats` only
applies to point areas in site scripts.

---

## 3. Layer 2: `alienMissions.rul`, the plan

### 3.1 Mission fields

| Field | Meaning |
| --- | --- |
| `points` | score credited to aliens when the mission delivers its payload |
| `objective` | 0..6, see section 5 — **this is the single most important field** |
| `waves` | required; the UFO sequence |
| `spawnUfo` | UFO used for the final retaliation run, overriding the wave's UFO |
| `spawnZone` | which `missionZones` index of the region to use for sites/bases |
| `siteType` | alienDeployment for sites/bases; falls back to the area's texture |
| `raceWeights` | month-chunked weighted race table (merged with parent mods) |
| `missionWeights` | `{month: weight}` for *this* mission — how likely the game is to pick it when it needs a retaliation mission (default weight 1) |
| `retaliationOdds` | % chance a shoot-down of this mission triggers retaliation; `-1` = formula |
| `endlessInfiltration` | `true` (default): infiltration loops forever |
| `skipScoutingPhase` | retaliation only: skip the detection phase and attack the first base in the region straight away |
| `multiUfoRetaliation` | keep the mission alive after the first base defense |
| `multiUfoRetaliationExtra` | ...and keep spawning UFOs (implies `multiUfoRetaliation`) |
| `ignoreBaseDefenses` | skip base defenses, go straight to the battlescape |
| `instaHyper` | show UFO info in base defense even if undetected |
| `despawnEvenIfTargeted` | site expires even while an XCOM craft is en route |
| `respawnUfoAfterSiteDespawn` | the landed UFO comes back when the site expires |
| `interruptResearch` | researching this topic interrupts the mission immediately |
| `showAlienBase` | reveal a freshly spawned alien base (objectives 1 and 2) |
| `operationType` | 0..6, Earth-based operations (section 7) |
| `operationSpawnZone` / `operationBaseType` | where/what base to build for the operation |
| `targetBaseOdds` / `regionWeights` | only used for missions generated by an alien base (section 6) |

### 3.2 Wave fields

| Field | Meaning |
| --- | --- |
| `ufo` | UFO type — **or an alienDeployment id**, for site missions that create a site without a UFO |
| `count` | UFOs in this wave, spawned one at a time |
| `trajectory` | trajectory id |
| `timer` | minutes before this wave's UFOs arrive (see 3.3) |
| `objective` | this wave carries out the mission objective |
| `objectiveOnTheLandingSite` | land at a random spot in the area, spawn the site exactly there |
| `objectiveOnXcomBase` | put the mission site on an XCOM base instead |
| `hunterKillerPercentage` | `-1` inherit from `ufos.rul`, 0..100 override |
| `huntMode` / `huntBehavior` | `-1` inherit, `2` = roll randomly at spawn |
| `escort` | this UFO (if a hunter-killer) escorts a non-HK UFO of the same mission |
| `interruptPercentage` | % chance that downing this UFO's craft ends the whole mission (see 3.4) |
| `respawnUfoAfterSiteDespawn` etc. | mission-level, see 3.1 |

Preferred defaults worth knowing: `hunterKillerPercentage: -1`,
`huntMode: -1`, `huntBehavior: -1`, `interruptPercentage: 0`, `escort: false`,
`objective*: false`.

### 3.3 Timing — the real formula

`AlienMission::start()` (`AlienMission.cpp:725`):

```cpp
size_t spawnTimer = _rule.getWave(0).spawnTimer / 30;        // integer minutes/30
_spawnCountdown = (spawnTimer / 2 + RNG::generate(0, spawnTimer)) * 30;
```

So wave 0 arrives after **0.5× to 1.5× the stated `timer`**, quantised to
30 minutes, with a slight downward bias from the integer division. A `timer` of
9000 means 4500..13500 minutes (3–9 days).

`think()` runs every 30 game minutes:

```cpp
if (_spawnCountdown > 30) { _spawnCountdown -= 30; return; }
```

The header comment in `RuleAlienMission.h` saying `/4` and `3*/4` is **stale**.

Every later wave uses the same formula, based on *its own* `timer`
(`AlienMission.cpp:396`). Consequences:

- `timer: 0` means "immediately". The code literally calls `think()` again, so a
  chain of `timer: 0` waves spawns several UFOs in a single tick.
- If a `startDelay` was supplied by the mission script, wave 0 uses that exact
  value instead (`start()`'s `initialCount` branch), and the first wave's
  `timer` is ignored.
- **Shooting a UFO down delays the next wave** by
  `30 * (RNG(0,400) + 48)` minutes ≈ 1.0–9.3 days (`ufoShotDown()`), on top of
  the countdown already running. Retreating works.

### 3.4 When a mission ends

`isOver()` (`AlienMission.cpp:152`):

```cpp
if (_interrupted && !_liveUfos)                     return true;
if (objective == OBJECTIVE_INFILTRATION && endlessInfiltration) return false;
if (_nextWave == waveCount && !_liveUfos)           return true;
```

`_liveUfos` is incremented in `setMissionInfo()` (called for every UFO the mission
creates) and decremented in `~Ufo()`, so a mission lingers until its last UFO is
destroyed or expires. `_interrupted` is set by the following, all verified:

| Trigger | Code |
| --- | --- |
| `interruptPercentage` rolled when a UFO of that wave crashes or is destroyed | `Ufo::setDamage` (`Ufo.cpp:472`) |
| `interruptResearch` topic researched | `GeoscapeState.cpp:2758`, `SavedGame.cpp:3349` |
| instant retaliation with no base in the region | `AlienMission::spawnUfo` (`:566`) |
| instant retaliation whose assault ship was destroyed by base defences | `BaseDefenseState.cpp:470` |
| `operationType` 1 / 4 with no base available | `AlienMission::start` (`:773`) |
| the alien base an operation mission is attached to is destroyed | `SavedGame::clearLinksForAlienBase` |

A mission interrupted this way does **not** stop instantly: `isOver()` requires
`_liveUfos == 0`, so already-flying UFOs are cleaned up first.

Nothing else stops a mission early — destroying every UFO merely delays the next
wave.

---

## 4. Layer 3: trajectories and regions

### 4.1 Reading a trajectory

```yaml
- id: P0
  groundTimer: 3000
  waypoints:
    - [5, 4, 100]
    - [0, 3, 74]
    - [0, 1, 28]
    - [1, 1, 47]
    - [5, 2, 100]
```

Each waypoint is `[zone, altitude, speed]`:

- **zone** = an index into the *mission region's* `missionZones` list
- **altitude** = 0 ground, 1 very low, 2 low, 3 high, 4 very high
  (`Ufo::ALTITUDE_STRING`)
- **speed** = percentage of the UFO's `speedMax`

The operational reading, straight from the code and the official reference's own
`[A,B,C] … [M,N,P]` example. The whole thing collapses to two rules if the lines
are numbered from 1:

1. **the stop sequence is `z1, z2, z2, z3, …, zN`** — line 1's zone is the spawn
   point, and every later line's zone is a destination, with line 2's visited
   twice;
2. **leg *m* is flown at line *m*'s altitude and speed.**

So a line's zone and its altitude/speed are read at different moments, and line 1
is the asymmetric one: its zone is only ever *where the UFO appears* (never
anywhere it arrives), yet its altitude and speed are what leg 1 is flown at. The
reference's example is exactly this table:

| Leg | Flight | Altitude / speed |
| --- | --- | --- |
| 1 | A → D | B, C (line 1's) |
| 2 | D → D | E, F (line 2's) |
| 3 | D → G | H, I (line 3's) |
| 4 | G → J | K, L (line 4's) |
| 5 | J → M | N, P (line 5's) |

`ufoReachedWaypoint` advances the trajectory index only *after* re-targeting, so
line 2's zone is targeted twice: once at spawn and again on the first arrival.
That is the reference's "the second line, where zone D is targeted AGAIN, this
happens automatically/internally and always on the second line."

**N lines therefore produce N legs of flight**, not N−1, and N+1 waypoints: the
extra waypoint is the duplicated line 2. Vanilla `P0` (five lines, values shown
are those in force *during* each leg):

| Leg | Flight | Altitude / speed |
| --- | --- | --- |
| 1 | spawn in zone 5 → zone 0 | very high, 100% (line 1's) |
| 2 | zone 0 → zone 0 again | high, 74% (line 2's) |
| 3 | zone 0 → zone 0 | very low, 28% (line 3's) |
| 4 | zone 0 → zone 1 | very low, 47% (line 4's) |
| 5 | zone 1 → zone 5, then the UFO vanishes | low, 100% (line 5's) |

Five legs from five lines, and zone 0 is visited three times. A one-line
trajectory throws *"Missing second waypoint!"*, so two lines is the minimum:
"appear here, go there once". Because line 2 is visited twice, you effectively
get "line 1's values there, line 2's values back".

Arriving at the **last** line ends the trajectory: the UFO is marked destroyed
and disappears (this is why vanilla `P0`'s final line returns it to zone 5, "back
to space"). A trajectory with no landing anywhere just flies and vanishes.

This doubling is the main practical trap: a trajectory that looks like a
there-and-back trip actually loiters once at the far end. A "go there and come
home" trajectory needs **three** lines — the destination, a repeat of it, then
home. (Vanilla's `P9` gets away with two lines only because supply missions
override the destination to the alien base; see §5 `5`.)

### 4.2 Landing

A line with **altitude 0** (`STR_GROUND`) makes the leg *before* it land — leg
*m−1*, for a ground line *m*. Where it lands is where that leg was already
heading, so it is line *m*'s zone for a ground line 2 (leg 1 heads there) and
line *m−1*'s zone for every later ground line. The ground line's own zone is
therefore where a landing happens only for line 2, and the general rule is to
read the landing off the leg, not off the line.

Line 1 is the other exception: there is no leg before it, so its ground altitude
means the UFO **spawns landed** and waits out `groundTimer` before taking off.
Either way it takes off at very low altitude (`ufoLifting` sets `STR_VERY_LOW`),
not at the ground line's 0.

So a ground line at the very end lands the UFO at the next-to-last stop, and then
the final leg still flies on to the last line's zone and vanishes there. Landings
are easy to misplace because of this: read the `legs` table, not the line numbers.

The stay itself is `groundTimer * 5` **seconds** (`ufo.setSecondsRemaining(...)`;
the timer ticks down 5 seconds at a time). So vanilla `groundTimer: 3000` is
15 000 s ≈ **4 h 10 m**, `P9`'s 2000 is ≈ 2 h 45 m, and the retaliation assault
run's 1000 is ≈ 1 h 23 m. The wave's `timer` has nothing to do with this.

`getWaypoint()` tries to keep landings on solid ground: it switches to
`getLandPoint()` — a point that is `globe.insideLand()` and inside the region,
retried up to 100 times — whenever the trajectory has a ground line coming up.
Cities are exempt (a UFO may land on a city point), and `fakeWaterLandingChance`
on the UFO opts into landing on fake underwater textures instead. After 100
failed tries it force-lands with a log warning; if the forced spot is real water
the UFO is not allowed to land at all, gets a 5-second timer, and takes off again.

Note how few vanilla trajectories actually land. `P0` is five lines of pure
flight and never touches the ground; the landing ones are `P1` (`[0, 0, 20]`),
`P4` and `P5`. `P8` is the eight-line reconnaissance patrol: it tours zones
1, 2, 3, 4, 0, 2 at very low altitude, never descending to the ground, then
climbs back out. `P9` is the two-line supply hop, and its second line *is* a
landing.

### 4.3 Regions: `areas` vs `missionZones`

A region has two separate rectangle lists, and mixing them up is the classic
mistake:

| List | Format | Used for |
| --- | --- | --- |
| `areas` | `[lon1, lon2, lat1, lat2]` in degrees | activity graphs, base cost, "is this point in the region" |
| `missionZones` | a list of zones, each a list of areas | UFO waypoints, mission sites, alien bases |

`missionZones` entries take two extra positional values:

```yaml
missionZones:
  -
    - [286.125, 286.125, -40.75, -40.75, -1, STR_NEW_YORK]   # city: texture, name
    - [230, 260, -65, -55]                                    # plain box
```

- An area is a **point** (city) when `lonMin == lonMax && latMin == latMax`.
  Only point areas get a city name and `avoidRepeats` protection.
- `texture` = a `globe.rul` texture id. **Negative ids are deployments**: they
  make `spawnMissionSite()` pick `texture->getRandomDeployment()`. Positive ids
  are terrains, used for UFO crash/landing sites, not for mission sites.
- `name` = optional city string shown on the globe.

**Prime meridian rule:** in `missionZones`, `lon2` must be `>= lon1`, so a box
crossing 0° is written `[350, 368, ...]` (i.e. 8° + 360). `areas` has no such
rule and may be written with `lon2 < lon1`. `insideRegion()` handles both, but
`getRandomPoint()` needs the `>=` form to pick a sane longitude.

A zone whose boxes reach from pole to pole (X-Piratez writes
`[[1, 1, -89, -89, -300], [1, 1, 89, 89, -300]]` for its orbital regions) is
the pack's way of saying "anywhere": the game picks a box and then a point in
it, so no single spot on the globe describes where the UFO will be. The pedia
draws such a stop in the middle of the map, ringed, rather than dropping it —
the flight really does visit it.

`missionRegion` substitutes another region when the mission is placed here —
used by vanilla for the Arctic/Antarctica, which have no land to spawn on.

Region selection uses `regionWeight` (the classic `AlienStrategy` table), so
`regionWeight: 0` plus a `missionWeights` entry is how "this mission only, that
region" missions are built in XFiles.

**Where the two lists are drawn.** The region page draws both: `areas` solid,
`missionZones` dashed. The trajectory page draws only the zones — `areas` is the
region's answer to "is this point in me" (base price, activity credit, a landing
staying inside its region), and the trajectory page already names its region in
the radio list, so those boxes were scenery laid over the stops. The switch is
`REGION_OUTLINE` in `TrajectoryMapArticle`; `regionOverlay` takes it as
`{ outline }` and the region page leaves it at its default. Two caveats if it is
ever turned back on: the trajectory page has no note describing `areas` (the
region page's `xpediaRegionMapNote` does), and tftd's land regions have no
`areas` at all, so it would only show up for ocean regions and for XFiles /
X-Piratez.

**Neither list is ever a flight.** The region page draws no path, no stop and no
arrow: a trajectory is a list of zone *indices*, so it can only be pictured
against one region chosen to read those indices against, which is what the
trajectory page's own radio list is for. That page draws exactly one flight, and
it is the only place a flight is drawn.

The reason the region page used to draw some is worth keeping, because the
tempting version of it is wrong. It selected paths with `UfoTrajectory.fits`,
which only asks whether the region has enough `missionZones` for the path's
indices. In XFiles, North America passes that for 42 paths while its missions fly
16 — and the first six alphabetically are `B0`–`B4`, which no mission in the pack
flies at all. Six arbitrary lines drawn over a region, labelled as its traffic.

`Ruleset.flightsIn(region)` is the honest question: walk `missionsIn(region)` to
each mission's waves and take the trajectory each names. Two filters apply and
both are about the picture rather than the truth: the path must exist (tftd's
mission waves name `P0`, `P1`, `P7`, `P8`, `P10`, none of which that pack
defines), and the region must have the zones it needs (XFiles' one-zone event
regions are flown by `P1`/`P7`, which visit zones they do not have). What
survives is listed under the map as links to the pages that draw them.

**The REGIONS section page draws the `areas` of every region at once.** It is the
one picture where the regions are the subject rather than the backdrop, so it
shows each region's own boxes with its name in the largest of them — the nations'
drawing with a different layer on it. Only the regions that state `areas` can
appear, which in the packs checked is a minority: 15 of 54 in XFiles, 15 of 173
in X-Piratez, 15 of 22 in tftd. The section's list therefore stays on the page
below the map, and so does a short legend of the regions that *are* drawn, because
a press on a shape selects it (for picking one region out of the overlapping
boxes) instead of following its page.

The colours on that map come from `regionPalette`, not `regionColor`: these are
peers shown together, and hashing ids into hues put South America and Southern
Africa 0.3 ΔE apart. Spreading the hues evenly over the count gives 6.7 ΔE at
fifteen regions.

**The land is painted, not linked.** A terrain polygon used to be an anchor to
that terrain's page — on XFiles' full-size map that is 2679 anchors inside the
picture, every one of them a tab stop before the reader reaches the rest of the
page, which made a keyboard walk through the whole map to get anywhere. The
polygons are plain shapes with a `title` tooltip now; the legend under each map
names the same terrains in the same colours and is the way in to those pages.
Measured on XFiles, dropping the anchors took the map's own construction from
18.7 ms to 8.3 ms, so the screen-reader argument was not the only one.

**The globe travels inside the page.** `WORLD.DAT` is not in the ruleset, so an
exported page used to leave it beside itself as a loose file and read it back
with `fetch` — which a page opened from `file://` cannot do at all. XFiles
therefore drew the *stock* coastline while claiming to be XFiles. The bytes are
now gzipped into the payload as `window.xpedia.data["geodata/world.dat"]`
(11.8 KB of base64 against a 10 MB page), and the loose file is gone from
`--assets` exports.

That channel is deliberately general, since the globe will not be the only raw
input: `dataPaths(mods)` in `exportCore.ts` decides which files go in,
`collectDataFiles` reads and compresses them, and `inlineDataFile` in
`packSource.ts` answers by path. Adding another non-ruleset, non-image file
means naming it in `dataPaths` — the writer and the reader both walk that list.
`readDat` still tries the older sources for a database pack and for an export
made before this change, so no page in the wild breaks.

---

## 5. Objectives 0–6

The objective decides what happens when the wave marked `objective: true`
finishes, and how the mission is scored. Everything else is the same machinery.

### `0` — score (default)

Just flies. Nothing special. The mission's `points` are credited at every
take-off (`ufoLifting`), on top of `ufos.rul`'s `missionScore` per half-hour while
airborne (doubled while landed).

### `1` — infiltration

After the last wave, pick a country inside the mission region that
`canBeInfiltrated()`, place an alien base there (in `spawnZone`, or next to the
country label if `buildInfiltrationBaseCloseToTheCountry` is on) and sign a pact
with it. `addScore` deliberately does nothing for this objective: the payoff is
political, not activity. Instead the mission's `points` become the **pact score**
applied at month end, taken from a randomly chosen `OBJECTIVE_INFILTRATION`
mission (`MonthlyReportState.cpp:445` → `getRandomMission`), not necessarily the
one that just ran. With `endlessInfiltration: true` (the default) `_nextWave`
resets to 0 and the whole sequence repeats forever.

`showAlienBase: true` reveals the new base immediately.

### `2` — alien base

After the last wave, spawn an alien base somewhere in the mission's
`spawnZone`, then award `points` (`spawnAlienBase` calls `addScore`). Deployment
selection is `siteType` → area texture → hardcoded `STR_ALIEN_BASE_ASSAULT`.

If instead a *wave* has `objectiveOnTheLandingSite: true` and the UFO lands in
the objective's `spawnZone`, the base is built exactly where it landed. Vanilla
`STR_ALIEN_BASE` uses `spawnZone: 4` and `siteType: STR_ALIEN_BASE_ASSAULT`.

### `3` — mission site (terror, cult sites, artifact sites...)

Three sub-styles exist, spelled out in a helpful comment block at
`GeoscapeState.cpp:4519`:

1. **No UFOs, deployment in the wave** — `ufo:` names an alienDeployment (not a
   UFO) with a non-empty `markerName`. The site is created directly when the
   wave fires; the `ufo` never exists.
2. **No UFOs, deployment from `siteType` or texture** — `ufo: dummy` (any
   non-existent id). The site is created at once.
3. **With a UFO** — the wave has `objective: true`, the UFO flies and lands at a
   waypoint whose zone equals the mission's `spawnZone`; it is then replaced by
   the mission site.

Site placement:

| Config | Landing point | Site position |
| --- | --- | --- |
| default (point area) | the city itself | the city |
| rectangle, `objectiveOnTheLandingSite: false` | top-left corner of the area | random inside the area |
| rectangle, `objectiveOnTheLandingSite: true` | random land point in the area | exactly the landing point |
| `objectiveOnXcomBase: true` | — | on a random XCOM base in the region (skipped if none) |

The site's deployment comes from `missionOveride` → the mission's `siteType` →
`texture->getRandomDeployment()`. Its lifetime is
`RNG(durationMin, durationMax) * 3600` seconds from `alienDeployments.rul`
(vanilla terror site: `duration: [4, 10]` = 4–10 days).

Sites bleed score: on every 30-minute tick `processMissionSite` adds the
deployment's `points` to the site's region and country. The tick that *expires*
the site adds `despawnPenalty` instead. Vanilla terror sites declare only
`despawnPenalty: 1000`, so the whole cost lands on the tick it times out.

`respawnUfoAfterSiteDespawn: true` parks the landed UFO at `IGNORE_ME` and
resumes it (`ufoLifting`) when the site expires, so a chain of sites can share
one UFO.

### `4` — retaliation

The scouting/attack mission. See section 8 for the full flow. In short: its
waves fly around, and any wave spawn that happens while an XCOM base in the
region is marked as a retaliation target becomes a battleship on
`__RETALIATION_ASSAULT_RUN` aimed at that base, regardless of which UFO the wave
declared.

`spawnUfo` names the assault ship. `skipScoutingPhase: true` removes the need for
detection: instead of asking which bases are marked, the mission attacks the
**first XCOM base found in the region**. Bases are not marked by this flag — it
just bypasses the marking requirement entirely.

### `5` — supply

Only exists to visit alien bases. Requires the mission to be attached to a base
(`_base != null`); otherwise the objective wave returns no UFO at all. The
objective wave lands **on the base** regardless of its trajectory's zone
(`spawnUfo` special case). Vanilla `STR_ALIEN_SUPPLY` is one wave,
`raceWeights: {}` — the race comes from the alien base.

### `6` — instant retaliation

Spawns a single assault ship directly at an XCOM base's coordinates (no
scouting, no detection needed) and ends. If there is no base in the region, the
mission is interrupted immediately. Used for "you did something, here is the
consequence now".

---

## 6. Alien base resupply

Every game day, `time1Day()` runs `GenerateSupplyMission` over all alien bases
(`GeoscapeState.cpp:2351`):

1. `base->getDeployment()->chooseGenMissionType()` picks a mission from the
   deployment's `genMission` weights (vanilla `STR_ALIEN_BASE_ASSAULT` has
   `genMission: {STR_ALIEN_SUPPLY: 100}`).
2. Roll `genMissionFreq` (vanilla `6`, i.e. 6%) and check
   `getGenMissionCount() < genMissionLimit`.
3. Region: `targetBaseOdds` → a region with an XCOM base;
   else the mission's `regionWeights`; else the base's own region.
4. Race: the base's race, unless `genMissionRaceFromAlienBase: false` and the
   mission has `raceWeights`.
5. `mission->setAlienBase(base)` then `start()`.

Because `_base` is set, the supply ship starts and finishes at the base, which
is why `operationType` is not needed for this.

The same `targetBaseOdds` / `regionWeights` pair on a mission is only consulted
on this path — it is ignored when the mission script creates the mission.

---

## 7. Earth-based operations (`operationType`)

Normally a mission's UFOs come from space (zone 5, the top of a trajectory). An
operation instead flies out of an alien base:

| Value | Base used |
| --- | --- |
| `0` `AMOT_SPACE` | none, spawn from the trajectory |
| `1` `AMOT_REGION_EXISTING_BASE` | must exist in the mission region, else the mission is interrupted |
| `2` `AMOT_REGION_NEW_BASE` | always build one in `operationSpawnZone` |
| `3` `AMOT_REGION_NEW_BASE_IF_NECESSARY` | existing one in the region, else build |
| `4` `AMOT_EARTH_EXISTING_BASE` | any existing base on Earth, else interrupted |
| `5` `AMOT_EARTH_NEW_BASE_IF_NECESSARY` | any existing base, else build |
| `6` `AMOT_EXISTING_BASE_HUNT_MISSION` | a base reacting to your craft (see below) |

Resolution happens in `AlienMission::start()` (`:735`): collect candidates
(region-filtered for 1/3), pick one at random, else `_interrupted = true` for
types 1 and 4, else build a new base from `operationBaseType` inside
`operationSpawnZone`.

Effects on the UFOs themselves:

- spawn position is the operation base instead of the trajectory's zone 0;
- the **last** waypoint is forced to the operation base, so the UFO returns home
  (`getWaypoint()`, comment: *"if the operation base is destroyed in the
  meantime, remaining live UFOs will follow the original trajectory... therefore
  it is important to have a valid last trajectory waypoint"*);
- if the base is destroyed, `clearLinksForAlienBase()` interrupts the mission.

### Hunt missions (type 6)

`GeoscapeState::baseHunting()` (`:1738`), every 10 minutes:

- for each alien base, if `minutesSinceLastHuntMissionGeneration >= huntMissionMaxFrequency`;
- for each flying, non-undetectable XCOM craft within
  `Nautical(baseDetectionRange)`;
- roll `baseDetectionChance` → `deployment->generateHuntMission(month)` from
  `huntMissionWeights`;
- create the mission with `operationType: 6`, attach the base, `start()` it (so
  the first wave gets the normal 0.5–1.5× timer), then call `think()` once so the
  countdown begins ticking without waiting for the next 30-minute sweep;

Note the "start immediately" comment in the source is about kicking the countdown,
not about spawning: `think()` still has to tick the wave timer down.

XFiles uses this for cult cars and helicopters that chase your transport:

```yaml
- type: STR_CULT_MANOR_CAR_INTERCEPTION
  operationType: 6
  waves:
    - ufo: STR_CULTIST_CAR
      count: 3
      trajectory: P_HUNT_GROUND
      timer: 0
      hunterKillerPercentage: 100
      huntMode: 2
      huntBehavior: 1
```

---

## 8. Base attacks, end to end

This is the part that is hardest to see from the ruleset, because it is spread
over five files.

### Step 1 — you shoot something down

`DogfightState.cpp:1776`. On a successful interception:

```cpp
mission->ufoShotDown(*ufo);                 // delays the next wave
int retaliationOdds = mission->getRules().getRetaliationOdds();
if (retaliationOdds == -1)
    retaliationOdds = 100 - (4 * (24 - difficultyCoefficient) - race->retaliationAggression());
// optional override: difficultyCoefficientOverrides.retaliationTriggerOdds[difficulty]
//                   + race->retaliationAggression()
if (monthsPassed < DIFFICULTY_BASED_RETAL_DELAY[difficulty]) retaliationOdds = 0;
```

So `retaliationOdds` on the mission beats everything; otherwise the formula
scales with difficulty and the race's `retaliationAggression` (higher aggression
= more retaliation). `DIFFICULTY_BASED_RETAL_DELAY` is a global table, all zeros
in vanilla — mods use it as a grace period.

### Step 2 — which region

```cpp
int odds = 50 - 6 * difficultyCoefficient;   // 50% at beginner, 26% at superhuman
// override: 100 - difficultyCoefficientOverrides.retaliationBaseRegionOdds[difficulty]
if (RNG::percent(odds)) targetRegion = ufo->getMission()->getRegion();
else                    targetRegion = region of the interceptor's base;
```

So the retaliation usually lands on the region the UFO was working in, not
necessarily where you shot it down.

### Step 3 — which mission

```cpp
if (!save->findAlienMission(targetRegion, OBJECTIVE_RETALIATION, race))
{
    // reuse the race's retaliationMissionWeights, else any OBJECTIVE_RETALIATION mission
    newMission->start(*game, *globe, rule->getWave(0).spawnTimer);  // fixed delay
}
```

If a retaliation mission already exists in that region, **nothing new is
created** — you get more UFOs from the existing campaign. Note the fixed
`getWave(0).spawnTimer` seed: the scouting phase starts on a predictable timer.
Also note the mission picked is not necessarily the one you annoyed (XFiles
weight tables put `STR_ALIEN_TERROR` in `retaliationMissionWeights`, so a
shoot-down can end in a terror mission).

### Step 4 — the aliens have to find you

A base is only a legal target once `Base::getRetaliationTarget()` is true.
That flag is set in `time10Minutes()` by `DetectXCOMBase` (`:1532`):

```cpp
if (ufo->getTrajectoryPoint() <= 1) return false;                  // just spawned
if (trajectory zone == 5) return false;                            // in space
if (objective != OBJECTIVE_RETALIATION && !aggressiveRetaliation)
    return false;                                                  // only retaliation UFOs scout
if (trajectory id == __RETALIATION_ASSAULT_RUN) return false;      // the attack run itself
if (ufo->isCrashed() || status == IGNORE_ME) return false;
if (base.getDistance(ufo) >= Nautical(ufo->getCraftStats().sightRange)) return false;
return RNG::percent(base.getDetectionChance());
```

`getDetectionChance()` comes from the base's completed facilities (radar etc.).
Two modes then apply (`:1599`):

- default: at most one base per region is remembered (last one found wins);
- `aggressiveRetaliation: true`: every base with a witness UFO is marked.

This is why "retaliation can be avoided" is only partly true: it is a roll, per
10-minute tick, per checking UFO, and a big base with good radar is a beacon.

### Step 5 — the next wave becomes a battleship

Back in `AlienMission::spawnUfo()` (`:507`), the check comes **before** the
normal wave handling:

```cpp
if (objective == OBJECTIVE_RETALIATION || objective == OBJECTIVE_INSTANT_RETALIATION)
{
    // skipScoutingPhase: first base in region, else the normal "which marked base" pick
    Base* xcombase = skipScoutingPhase ? firstBaseInRegion : selectXcomBase(...);
    if (xcombase) {
        const RuleUfo& ship = spawnUfo.empty() ? *ufoRule : *mod.getUfo(spawnUfo);
        // built on the __RETALIATION_ASSAULT_RUN trajectory, with the base
        // coordinates as its destination from the very first tick
        return ufo;
    }
    if (objective == OBJECTIVE_INSTANT_RETALIATION) { _interrupted = true; return 0; }
}
```

Spawn position is the XCOM base for instant retaliation, the operation base for
an `operationType` mission, otherwise a point in the wave's trajectory zone 0.
The destination is set to the base immediately, so the ship flies straight in.

Two consequences modders trip over:

1. **Every** wave spawned while a base is marked turns into the assault ship,
   not just the last one. Vanilla's scouts only survive as scouts because none
   of your bases has been found yet when they launch.
2. `spawnUfo` overrides only the model; the trajectory and destination are
   hardcoded. `__RETALIATION_ASSAULT_RUN` is defined in vanilla
   `ufoTrajectories.rul` but the id is also a constant in the engine:

```yaml
- id: __RETALIATION_ASSAULT_RUN
  groundTimer: 1000
  waypoints:
    - [5, 4, 100]   # this should always be 5, 4, 100
    - [5, 0, 100]   # only the 0 altitude matters
```

### Step 6 — arrival

`ufoReachedWaypoint()` sees the assault trajectory, ignores the waypoint's zone,
and sets the destination to the base at the UFO's coordinates. Then in
`time5Seconds()`, `dynamic_cast<Base*>(ufo->getDestination())` matches
(`:1091`):

```cpp
mission->setWaveCountdown(30 * (RNG::generate(0, 400) + 48));   // next attack: 1-9.3 days
base->setupDefenses(mission);        // records the mission for retaliation only
if (!base->getDefenses()->empty() && !mission->getRules().ignoreBaseDefenses())
    popup(new BaseDefenseState(base, ufo, this, instaHyper));
else
    handleBaseDefense(base, ufo);
```

- `setupDefenses()` also snapshots the base's defence facilities, its based
  craft and their vehicles for the battlescape, and stores
  `setRetaliationMission(am)` for `OBJECTIVE_RETALIATION` only (not instant).
- `BaseDefenseState` is the "base defenses firing" screen; if you win or skip
  it, the battlescape follows. `instaHyper` (from either the UFO or the mission)
  shows UFO details even if undetected.
- `handleBaseDefense()` = no defences (or `ignoreBaseDefenses`): straight to
  `STR_BASE_DEFENSE` battlescape via `BriefingState`, or, if the base has no
  soldiers/vehicles at all, `BaseDestroyedState` — "please garrison your bases".

### Step 7 — outcomes

The "aliens give up" roll happens in `BaseDefenseState::btnOkClick()`
(`GeoscapeState`/`BaseDefenseState.cpp:455`), and only when the assault ship was
actually destroyed by the base's defences:

```cpp
if (_ufo->getStatus() != Ufo::DESTROYED)
    _state->handleBaseDefense(_base, _ufo);   // defences lost: battlescape next
else {
    _base->cleanupDefenses(true);
    if (instant retaliation)  mission->setInterrupted(true);
    if (OBJECTIVE_RETALIATION && RNG::percent(getChanceToStopRetaliation())) {
        _base->setRetaliationTarget(false);              // unmark the base
        if (am->getRules().isMultiUfoRetaliation())
            am->setMultiUfoRetaliationInProgress(true);  // keep the campaign
        else
            save->deleteRetaliationMission(am, _base);   // delete mission + live UFOs
    }
}
```

So:

- **Assault ship destroyed by base defences** → the base is unmarked, then
  `chanceToStopRetaliation` decides whether the campaign ends there.
- **Defences failed** → the battlescape (`STR_BASE_DEFENSE`) follows; the give-up
  roll comes later, through `DebriefingState`, which does the same thing for
  `multiUfoRetaliation` missions.
- **Base lost** → `BaseDestroyedState`, the base is gone.
- **Instant retaliation** is a single ship: it is always interrupted once its
  assault is resolved, whatever the outcome.

Multi-UFO retaliation semantics, precisely:

| Flags | Behaviour |
| --- | --- |
| both false | the first successful assault ends the mission |
| `multiUfoRetaliation: true` | mission kept; `think()` becomes a no-op once `_multiUfoRetaliationInProgress` is set, so no more spawns but live UFOs finish |
| `multiUfoRetaliationExtra: true` | as above but keeps spawning, so repeated assaults |

With `multiUfoRetaliation`, `selectXcomBase()` also considers *all* marked bases
instead of stopping at the first, which is what makes a multi-wave attack
campaign actually hurt.

---

## 9. Scoring, in one place

| Source | When | Where |
| --- | --- | --- |
| `alienMissions.points` | at every landed→takeoff (`ufoLifting`), except `OBJECTIVE_BASE` and infiltration | `AlienMission.cpp:1051` |
| `alienMissions.points` | when a UFO lands and becomes a mission site, and when an alien base spawns | `:898`, `:1171` |
| `alienMissions.points` | infiltration is the exception: `addScore` returns immediately, so no activity is added at all | `addScore` (`:1130`) |
| the infiltration mission's `points` | as **pact score** at month end, from a *randomly picked* `OBJECTIVE_INFILTRATION` mission (not necessarily the one running) | `MonthlyReportState.cpp:445` |
| `ufos.missionScore` | every 30 min per live UFO, ×2 while landed | `GeoscapeState.cpp:2017` |
| `alienDeployments.points` | every 30 min while a mission site exists | `:1872` |
| `alienDeployments.despawnPenalty` | on the tick that expires an unused site | `:1872` |
| `alienDeployments.points` | per day per alien base | `:2796` |

All of these feed region/country **alien activity**, which drives funding and
(through pacts) infiltration. `interruptPercentage` and `interruptResearch` are
the two ways to stop the bleeding from the player's side.

---

## 10. Recipes

### Add a plain UFO mission (abductions, research...)

1. `alienMissions.rul`: new `type`, `points`, `raceWeights`, `waves` with
   trajectories that exist.
2. Either add it to a region's `missionWeights` in `regions.rul` (classic), or
   write a `missionScripts.rul` entry with `missionWeights` + `useTable: false`.
3. Nothing else. `objective: 0` is the default.

### Add a terror-site mission

1. New mission with `objective: 3`, `spawnZone: 3`, and a final wave with
   `objective: true` (optionally `objectiveOnTheLandingSite: true` for
   rectangles).
2. Make sure zone 3 of every candidate region contains valid site areas
   (point cities, or rectangles with a negative `texture`).
3. `siteType:` pointing at an alienDeployment, or a negative texture id in the
   region area.
4. Mission script with `missionWeights` (all site missions — no mixing),
   `useTable: false`, `executionOdds`, and optionally `varName` +
   `avoidRepeats: 12` so the same city isn't hit twice in a row.

### Add an alien base builder

```yaml
- type: MY_ALIEN_BASE
  points: 50
  objective: 2
  spawnZone: 4
  siteType: STR_ALIEN_BASE_ASSAULT
  raceWeights: {...}
  waves: [...]
```

`showAlienBase: true` if the player should see it right away.

### Add a base attack campaign

```yaml
- type: MY_RETALIATION
  objective: 4
  spawnUfo: STR_BATTLESHIP
  retaliationOdds: 60
  skipScoutingPhase: false
  waves:
    - { ufo: STR_SMALL_SCOUT, count: 2, trajectory: P8, timer: 3000 }
    - { ufo: STR_MEDIUM_SCOUT, count: 3, trajectory: P8, timer: 3000 }
```

plus either a mission script with `targetBaseOdds: 100` + `useTable: false`, or
a `retaliationMissionWeights` entry on the race so shoot-downs pick it.

### Make something fly out of an alien base

`operationType: 1` (or 3/5), `operationSpawnZone`, and normal waves. The last
waypoint is forced back to the base.

### Launch a mission from an event

Put it in `adhocScripts:` instead of `missionScripts:`, tag it with
`adhocMissionScriptTags`, and tag the event the same way.

---

## 11. Pitfalls (all verified)

1. **`missionZones` prime meridian**: `lon2 >= lon1`. Write `[350, 368]`, not
   `[350, 8]`. `areas` may use either form.
2. **Zone indices must exist everywhere.** `getWaypoint` throws
   *"mission tried to find a waypoint in zone N but this region only has zones
   valid up to M"*. Every region that can host a mission must have the
   trajectory's zone indices and the mission's `spawnZone`.
3. **`spawnZone` out of range** throws *"Cannot spawn mission site, invalid
   spawn zone! Command: ..., mission: ..."* at mission creation time.
4. **Don't mix site and non-site missions** in one script's `missionWeights` —
   throws at ruleset load.
5. **Don't put terror missions in `regions.rul` `missionWeights`** — the classic
   table cannot place them properly.
6. **A rectangle with a non-negative texture and no `siteType` is never a valid
   site target**, so a site script can silently "fail to run this month".
7. **`timer` is not exact.** It is 0.5–1.5× and only moves in 30-minute steps.
   Don't build story pacing on ±1 hour.
8. **A non-zero `startDelay` cancels wave-0 randomisation.** If you want a
   random first appearance, use `startDelay: 0` + `randomDelay`.
9. **`useTable` defaults to `true`**, which quietly deletes the mission from the
   region's table for the rest of the campaign. Scripted missions almost always
   want `false`.
10. **Conditionals on a script that never ran always pass.** Use "did it
    succeed" logic (`researchRetaliation` → `label: 1` → `conditionals: [-1]`),
    not "did it fail".
11. **`groundTimer` is in 5-second units.** It is *not* minutes and not seconds:
    the landing lasts `groundTimer * 5` seconds, so `groundTimer: 3000` ≈ 4 h.
    Wanting 6 hours means ~4320.
12. **Supply missions need a base.** A `STR_ALIEN_SUPPLY` mission started from a
    script without a base silently spawns nothing on its objective wave.
13. **`spawnUfo` does not change the trajectory** for retaliation; the assault
    run is hardcoded.
14. **`operationType: 1` / `4` with no base available interrupts the mission**, so
    the script appears to "work" while nothing ever spawns.
15. **A base only becomes a retaliation target after a UFO detects it**, and
    `skipScoutingPhase` is the only way around that requirement (it attacks the
    first base in the region instead).

---

## 12. Working examples

### Vanilla `xcom1`

| File | Worth looking at |
| --- | --- |
| `missionScripts.rul` | `gameStart` (`lastMonth: 0`, `targetBaseOdds: 100`, `startDelay: 120`), the `beginner…superhumanRetaliation` ladder, `conditionals` usage |
| `alienMissions.rul` | one mission per objective: `STR_ALIEN_RESEARCH` (0), `STR_ALIEN_INFILTRATION` (1), `STR_ALIEN_BASE` (2), `STR_ALIEN_TERROR` (3), `STR_ALIEN_RETALIATION` (4), `STR_ALIEN_SUPPLY` (5) |
| `ufoTrajectories.rul` | `P0` (five-line pure-flight loop, no landing), `P1`/`P4`/`P5` (the ones with a ground line), `P8` (eight-line scouting patrol), `P9` (two-line supply hop straight down), `__RETALIATION_ASSAULT_RUN` |
| `regions.rul` | the 12 land regions each define 6 zones: 0–2 = UFO traffic rectangles, 3 = city point areas (terror sites), 4 = plain rectangles (alien bases), 5 = a loose worldwide scatter used for spawn/exit aloft. The 3 ocean regions define no `missionZones` at all and just forward to a land region via `missionRegion` |

### XFiles (`misc/modpackExamples/openxcom_xfiles_42`)

The best real-world reference in this repo. In
`XComFiles/Ruleset/missionScripts_XCOMFILES.rul`:

- the file opens by `delete:`-ing ten vanilla scripts, then defines **799** of its
  own over ~11 800 lines;
- heavy use of `executionOdds` + `conditionals` as a state machine
  (`earlyResearch` → `afterYearResearch` with `maxRuns: 1`);
- `startDelay: 30` + `randomDelay: 43500` on 783 of them, to spread scripted
  missions across the month;
- `regionWeights` anchors reused across scripts (`&BlackLotusCityRegions`).

In `alienMissions_XCOMFILES.rul` (**368** missions):

| Tally | Count |
| --- | --- |
| `objective: 3` (mission site) | 293 |
| `objective: 2` (alien base) | 21 |
| `objective: 4` (retaliation) | 16 |
| `objective: 5` (supply) | 4 |
| `objective: 1` (infiltration) | 1 |
| `objective: 6` (instant retaliation) | 1 |
| `objective: 0` (score only) | 0 |
| `operationType: 1` | 13 |
| `operationType: 6` | 12 |
| `operationType: 4` | 7 |

Also worth grepping for in that file: `objectiveOnTheLandingSite` ×20,
`respawnUfoAfterSiteDespawn` ×19, `interruptPercentage` ×32, `spawnUfo` ×17,
`retaliationOdds` ×33, `escort: true` ×5.

`STR_ALIEN_FLYBY` is the "make the sky busy" pattern: a pure `objective: 0`
mission with lots of small waves. `operationType: 6` is used pervasively for
cult car/helicopter hunt missions that chase your transport.

XPiratez (`Dioxine_XPiratez_o2.1`) is the useful opposite: it keeps vanilla's
mission set almost unchanged and instead reskins `alienMissions.rul` and pushes
all the variety into `waves` and `ufoTrajectories`. `piratez-mini` /
`Dioxine_XPiratez_noimages` are the same rules with assets stripped, so they are
cheap to diff.

---

## 13. Where in the source

| What | File:line |
| --- | --- |
| Monthly scheduler, filters, labels, `executionOdds` | `Geoscape/GeoscapeState.cpp:3755–4219` |
| Site / base / random region+mission selection | `Geoscape/GeoscapeState.cpp:4457–4859` |
| The three site-spawning styles (comment block) | `Geoscape/GeoscapeState.cpp:4519–4560` |
| Retaliation roll on shoot-down | `Geoscape/DogfightState.cpp:1776–1844` |
| Base detection (`DetectXCOMBase`) | `Geoscape/GeoscapeState.cpp:1516–1545`, `1599–1631` |
| Base assault arrival, defenses vs battlescape | `Geoscape/GeoscapeState.cpp:1091–1107`, `3675` |
| Supply missions from alien bases | `Geoscape/GeoscapeState.cpp:2334–2417`, called at `2810` |
| Hunt missions from alien bases | `Geoscape/GeoscapeState.cpp:1738–1820` |
| Mission sites expiring / scoring | `Geoscape/GeoscapeState.cpp:1821–1897` |
| Wave timing (`think`) | `Savegame/AlienMission.cpp:170–413` |
| `spawnUfo` (incl. retaliation / supply branches) | `Savegame/AlienMission.cpp:468–718` |
| `start` (operation base resolution) | `Savegame/AlienMission.cpp:719–842` |
| `ufoReachedWaypoint`, landing, site spawn | `Savegame/AlienMission.cpp:843–1009`, `1432–1497` |
| `getWaypoint`, `getLandPoint`, `getLandPointForMissionSite` | `Savegame/AlienMission.cpp:1248–1422` |
| Mission over / interruption | `Savegame/AlienMission.cpp:152–168`, `1010–1037` |
| `interruptPercentage` on damage | `Savegame/Ufo.cpp:441–481` |
| Field definitions and defaults | `Mod/RuleAlienMission.h`, `Mod/RuleAlienMission.cpp` |
| Script field definitions and defaults | `Mod/RuleMissionScript.h/.cpp` |
| Trajectory parsing, altitude names | `Mod/UfoTrajectory.h/.cpp`, `Savegame/Ufo.cpp:41–47` |
| `missionZones` / `areas` parsing | `Mod/RuleRegion.cpp:52–117`, `246–262` |
| Site-type auto-detection, delete/mixing errors | `Mod/Mod.cpp:2806–2828` |
