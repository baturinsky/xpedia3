/**
 * `src/ui/deploymentRank.ts`: what a deployment rank spawns.
 *
 * A rank is an index into the race's member list, so resolving it means
 * tracing the deployment to its race first — its own `race` field, then the
 * missions whose waves name it — and only then indexing that race's
 * `members` (or `membersRandom`). The fixtures below are the real ones for
 * XPiratez `STR_LOC_JUNKFORT_CHALLENGE`: a deployment with no `race`, one
 * mission, one race, ranks 13 and 16.
 */
import { ensureBuilt } from "../build.mjs";
import { eq, report } from "../helpers/check.mjs";

await ensureBuilt();
const { deploymentRaces, loadoutIsEmpty, rankMembers, rankUnits, setChancesByLevel } = await import(
  "../.gen/deploymentrank.mjs"
);

// XPiratez `STR_BANDIT_TOWN`, verbatim and in order: 0 is the boss,
// 6–7 are the terror units, 13 the humongous raider, 16 the punk.
const banditTown = [
  "STR_BANDIT_BOSS",
  "STR_BANDIT_DUDE",
  "STR_BANDIT_DRIFTER",
  "STR_BANDIT_HIGHWAYMAN",
  "STR_BANDIT_BOY",
  "STR_HUMAN_MALE_3",
  "STR_BLOOD_DOG_TERRORIST",
  "STR_ARMORED_CAR_TERRORIST",
  "STR_HUMAN_HOE",
  "STR_HUMAN_SHARP_GUY",
  "STR_BANDIT_FUSSBALLER",
  "STR_BANDIT_RATMAN_LEADER",
  "STR_BANDIT_HITMAN",
  "STR_RAIDER_HUMONGOUS",
  "STR_DOGG_TERRORIST",
  "STR_APOC_DISCIPLE",
  "STR_BANDIT_PUNK",
  "STR_HIGHWAYMAN_QUAD",
  "STR_BANDIT_RATMAN_STORMRAT",
];

// The Junkfort mission: one wave, naming the deployment, one race at 100%.
const junkfortMission = {
  waves: [
    {
      ufo: "STR_LOC_JUNKFORT_CHALLENGE",
      count: 1,
      trajectory: "CA_SPAWN",
      timer: 9000,
      objective: true,
    },
  ],
  raceWeights: { 0: { STR_BANDIT_TOWN: 100 } },
};

const piratez = {
  alienRaces: { STR_BANDIT_TOWN: { members: banditTown } },
  alienMissions: { STR_LOC_JUNKFORT_CHALLENGE: junkfortMission },
};

const junkfort = { uid: "STR_LOC_JUNKFORT_CHALLENGE" };

// --- the race, traced through the mission ------------------------------------
eq(
  deploymentRaces(junkfort, piratez),
  ["STR_BANDIT_TOWN"],
  "race comes from the mission's raceWeights",
);
eq(
  deploymentRaces({ uid: "STR_LOC_JUNKFORT_CHALLENGE", race: "STR_SECTOID" }, piratez),
  ["STR_SECTOID"],
  "the deployment's own race wins over the mission",
);
eq(deploymentRaces({ uid: "STR_NOWHERE" }, piratez), [], "no route to the deployment, no race");
eq(deploymentRaces(undefined, piratez), [], "no deployment, no race");
eq(deploymentRaces({}, piratez), [], "no id, no race");

// A mission whose weights move between races over the campaign is ambiguous
eq(
  deploymentRaces(junkfort, {
    alienRaces: piratez.alienRaces,
    alienMissions: {
      STR_LOC_JUNKFORT_CHALLENGE: {
        waves: junkfortMission.waves,
        raceWeights: { 0: { STR_BANDIT_TOWN: 100 }, 3: { STR_SECTOID: 100 } },
      },
    },
  }),
  ["STR_BANDIT_TOWN", "STR_SECTOID"],
  "both races when the weights move",
);

// A race that names the deployment as its custom base deploy is a route too
eq(
  deploymentRaces(junkfort, {
    alienRaces: {
      STR_BANDIT_TOWN: { members: banditTown, baseCustomDeploy: "STR_LOC_JUNKFORT_CHALLENGE" },
    },
    alienMissions: {},
  }),
  ["STR_BANDIT_TOWN"],
  "baseCustomDeploy points back at the deployment",
);

// --- the member at a rank ----------------------------------------------------
eq(rankMembers("STR_BANDIT_TOWN", 0, piratez), ["STR_BANDIT_BOSS"], "rank 0 is the boss");
eq(rankMembers("STR_BANDIT_TOWN", 13, piratez), ["STR_RAIDER_HUMONGOUS"], "Junkfort's rank 13");
eq(rankMembers("STR_BANDIT_TOWN", 16, piratez), ["STR_BANDIT_PUNK"], "Junkfort's rank 16");
eq(rankMembers("STR_BANDIT_TOWN", 18, piratez), ["STR_BANDIT_RATMAN_STORMRAT"], "the last rank");
eq(rankMembers("STR_BANDIT_TOWN", 19, piratez), undefined, "past the end is nothing");
eq(rankMembers("STR_BANDIT_TOWN", -1, piratez), undefined, "a negative rank is nothing");
eq(rankMembers("STR_BANDIT_TOWN", 1.5, piratez), undefined, "a fractional rank is nothing");
eq(rankMembers("STR_NOPE", 0, piratez), undefined, "an unknown race is nothing");

// membersRandom wins over members outright, and a slot rolls between its
// candidates, duplicates collapsed
const zombie = {
  alienRaces: {
    STR_ZOMBIE: {
      members: ["STR_A", "STR_B", "STR_C"],
      membersRandom: [["STR_A"], ["STR_B", "STR_B", "STR_C"]],
    },
  },
  alienMissions: {},
};
eq(rankMembers("STR_ZOMBIE", 0, zombie), ["STR_A"], "a single-candidate roll");
eq(
  rankMembers("STR_ZOMBIE", 1, zombie),
  ["STR_B", "STR_C"],
  "every candidate, duplicates collapsed",
);
eq(rankMembers("STR_ZOMBIE", 2, zombie), undefined, "a rank the roll does not cover is nothing");

// --- the whole resolution -----------------------------------------------------
eq(rankUnits(junkfort, 16, piratez), ["STR_BANDIT_PUNK"], "Junkfort rank 16 is the punk");
eq(
  rankUnits(junkfort, 13, piratez),
  ["STR_RAIDER_HUMONGOUS"],
  "Junkfort rank 13 is the humongous raider",
);
eq(
  rankUnits({ uid: "STR_NOWHERE" }, 0, piratez),
  undefined,
  "an unresolvable deployment keeps the number",
);
eq(
  rankUnits(junkfort, 16, {
    alienRaces: { ...piratez.alienRaces, STR_SECTOID: { members: ["STR_SECTOID_LEADER"] } },
    alienMissions: {
      STR_LOC_JUNKFORT_CHALLENGE: {
        waves: junkfortMission.waves,
        raceWeights: { 0: { STR_BANDIT_TOWN: 50, STR_SECTOID: 50 } },
      },
    },
  }),
  ["STR_BANDIT_PUNK"],
  "a race with no member at the rank is skipped",
);
eq(
  rankUnits(junkfort, 0, {
    alienRaces: {
      STR_BANDIT_TOWN: piratez.alienRaces.STR_BANDIT_TOWN,
      STR_SECTOID: { members: ["STR_SECTOID_COMMANDER"] },
    },
    alienMissions: {
      STR_LOC_JUNKFORT_CHALLENGE: {
        waves: junkfortMission.waves,
        raceWeights: { 0: { STR_BANDIT_TOWN: 50, STR_SECTOID: 50 } },
      },
    },
  }),
  ["STR_BANDIT_BOSS", "STR_SECTOID_COMMANDER"],
  "two races at once list both",
);
eq(rankUnits(junkfort, 99, piratez), undefined, "an out-of-range rank keeps the number");

// --- the Tiger Tank: a vessel with no mission of its own ----------------------
// XPiratez `STR_NAZIS`, verbatim: the tank's crew
const nazis = [
  "STR_NAZI_BLACK_KNIGHT",
  "STR_NAZI_LEADER",
  "STR_NAZI_STORMTROOPER",
  "STR_NAZI_SS",
  "STR_NAZI_SOLDIER",
  "STR_NAZI_SOLDIER",
  "STR_NAZI_STORMTROOPER",
  "STR_XTANK_NAZI_CANNON_TERRORIST",
  "STR_ARMORED_CAR_NAZI_TERRORIST",
  "STR_NAZI_SUPERSOLDIER",
  "STR_DOGG_TERRORIST",
  "STR_HANABU_TERRORIST",
  "STR_NAZI_WARPSOLDIER",
  "STR_CYBERDOG_TERRORIST",
  "STR_NAZI_MAGE",
];

// The location mission names no UFO at all (dummy wave); its site is fought
// with the deployment of its own id, and the map script places the vessels
const tigerMission = {
  waves: [{ ufo: "dummy", count: 1, trajectory: "CA_SPAWN", timer: 1000, objective: true }],
  raceWeights: { 0: { STR_NAZIS: 100 } },
};

// The spawn table the three Tiger Tank deployments share by anchor; the
// ranks the page showed as bare numbers, 5, 3 and 1
const tigerData = [
  { alienRank: 5, lowQty: 3, highQty: 6 },
  { alienRank: 3, lowQty: 2, highQty: 4 },
  { alienRank: 1, lowQty: 1, highQty: 1 },
];

const tiger = {
  alienRaces: { STR_NAZIS: { members: nazis } },
  alienMissions: { STR_LOC_TIGER_TANK: tigerMission },
  alienDeployments: {
    STR_LOC_TIGER_TANK: {
      uid: "STR_LOC_TIGER_TANK",
      terrains: ["RURAL_TIGER_TANK"],
      data: tigerData,
    },
    STR_VESSEL_TIGER_TANK: { uid: "STR_VESSEL_TIGER_TANK", data: tigerData },
    STR_VESSEL_TIGER_TANK_JACK_BOUNTY: {
      uid: "STR_VESSEL_TIGER_TANK_JACK_BOUNTY",
      data: tigerData,
    },
  },
  terrains: { RURAL_TIGER_TANK: { script: "RURAL_TIGER_TANK" } },
  mapScripts: {
    RURAL_TIGER_TANK: {
      commands: [
        { type: "addUFO", UFOName: "STR_VESSEL_TIGER_TANK_JACK_BOUNTY", rects: [[3, 3, 1, 1]] },
      ],
    },
  },
};

const vessel = { uid: "STR_VESSEL_TIGER_TANK_JACK_BOUNTY", data: tigerData };

// A location deployment resolves through the mission of its own id, even
// with nothing else (no waves naming it, no terrains, no map script)
eq(
  deploymentRaces({ uid: "STR_LOC_TIGER_TANK" }, tiger),
  ["STR_NAZIS"],
  "the mission of the same id gives the race",
);

// … and the vessel resolves too: the mission route alone reaches it through
// nothing at all, so this is the map script and the shared spawn table
eq(
  deploymentRaces(vessel, tiger),
  ["STR_NAZIS"],
  "the vessel inherits through map script and data",
);
eq(rankUnits(vessel, 5, tiger), ["STR_NAZI_SOLDIER"], "tiger rank 5 is the humanist soldier");
eq(rankUnits(vessel, 3, tiger), ["STR_NAZI_SS"], "tiger rank 3 is the humanist instructor");
eq(rankUnits(vessel, 1, tiger), ["STR_NAZI_LEADER"], "tiger rank 1 is the humanist leader");

// Each new route stands alone: the map script chain needs no shared data,
// and the shared data needs no map script
eq(
  deploymentRaces({ uid: "STR_VESSEL_TIGER_TANK_JACK_BOUNTY", data: [{ alienRank: 5 }] }, tiger),
  ["STR_NAZIS"],
  "the map script chain works with different data",
);
eq(
  deploymentRaces(vessel, {
    alienRaces: tiger.alienRaces,
    alienMissions: tiger.alienMissions,
    alienDeployments: tiger.alienDeployments,
    terrains: {},
    mapScripts: {},
  }),
  ["STR_NAZIS"],
  "the shared spawn table works with no map script",
);
eq(
  deploymentRaces(
    { uid: "STR_VESSEL_TIGER_TANK_JACK_BOUNTY", data: [{ alienRank: 9 }] },
    {
      alienRaces: tiger.alienRaces,
      alienMissions: tiger.alienMissions,
      alienDeployments: tiger.alienDeployments,
      terrains: {},
      mapScripts: {},
    },
  ),
  [],
  "different data and no mission, no race",
);

// --- the Nazi vessel: a mission rolled 90/10 between two races ---------------
// XPiratez `STR_MISSION_NAZI` ropes 90% `STR_NAZIS` to 10% `STR_ZOMBIE_SMART`,
// and `STR_VESSEL_NAZI`'s only route is through that mission. The union of
// their members at each rank is what the card lists, beside the raw number.
const zombieSmart = [
  "STR_TECHNOCRACY_MEK_LEADER",
  "STR_ZOMBIE_TROOPER_1",
  "STR_ZOMBIE_CARRIE_TERRORIST",
  "STR_ZOMBIE_TROOPER_1",
  "STR_ZOMBIE_TROOPER_1",
  "STR_ZOMBIE_STERILE_TERRORIST",
  "STR_MEGAZOMBIE_TERRORIST",
  "STR_ZOMBIE_SENTINEL",
  "STR_ZOMBIE_GRUBAS_TERRORIST",
  "STR_ZOMBIE_CARRIE_TERRORIST",
  "STR_ZOMBIE_PIMP_TERRORIST",
  "STR_ZOMBIE_SADAKO_TERRORIST",
  "STR_ZOMBIE_STERILE_TERRORIST",
  "STR_ZOMBIE_STERILE_TERRORIST",
  "STR_ZOMBIE_GRUBAS_TERRORIST",
  "STR_ZOMBIE_GRUBAS_TERRORIST",
];
const naziVessel = {
  alienRaces: {
    STR_NAZIS: { members: nazis },
    STR_ZOMBIE_SMART: { members: zombieSmart },
  },
  alienMissions: {
    STR_MISSION_NAZI: {
      waves: [{ ufo: "STR_VESSEL_NAZI", count: 1, trajectory: "PX1", timer: 9000 }],
      raceWeights: { 0: { STR_NAZIS: 90, STR_ZOMBIE_SMART: 10 } },
    },
  },
  alienDeployments: {},
};
eq(
  deploymentRaces({ uid: "STR_VESSEL_NAZI" }, naziVessel),
  ["STR_NAZIS", "STR_ZOMBIE_SMART"],
  "the Nazi mission fields two races",
);
eq(
  rankUnits({ uid: "STR_VESSEL_NAZI" }, 5, naziVessel),
  ["STR_NAZI_SOLDIER", "STR_ZOMBIE_STERILE_TERRORIST"],
  "Nazi rank 5 lists both races",
);
eq(
  rankUnits({ uid: "STR_VESSEL_NAZI" }, 4, naziVessel),
  ["STR_NAZI_SOLDIER", "STR_ZOMBIE_TROOPER_1"],
  "Nazi rank 4 lists both races",
);
eq(
  rankUnits({ uid: "STR_VESSEL_NAZI" }, 1, naziVessel),
  ["STR_NAZI_LEADER", "STR_ZOMBIE_TROOPER_1"],
  "Nazi rank 1 lists both races",
);

// --- the Nazi raid: a custom deploy keyed by race under a UFO -----------------
// XPiratez `STR_ATTACK_NAZI_RAID` is reached only as
// `ufos.STR_VESSEL_PROBE_DISTRESS.raceBonus.STR_NAZIS.missionCustomDeploy` —
// no `race`, no mission, no wave names it. The key of the bonus is the race.
const naziRaid = {
  alienRaces: { STR_NAZIS: { members: nazis } },
  alienMissions: {},
  ufos: {
    STR_VESSEL_PROBE_DISTRESS: {
      raceBonus: {
        STR_NAZIS: { missionCustomDeploy: "STR_ATTACK_NAZI_RAID" },
        STR_BANDIT: { missionCustomDeploy: "STR_ATTACK_BANDIT_RAID" },
      },
    },
  },
};
eq(
  deploymentRaces({ uid: "STR_ATTACK_NAZI_RAID" }, naziRaid),
  ["STR_NAZIS"],
  "raceBonus key is the race",
);
eq(
  rankUnits({ uid: "STR_ATTACK_NAZI_RAID" }, 5, naziRaid),
  ["STR_NAZI_SOLDIER"],
  "raid rank 5 is the soldier",
);
eq(
  rankUnits({ uid: "STR_ATTACK_NAZI_RAID" }, 3, naziRaid),
  ["STR_NAZI_SS"],
  "raid rank 3 is the SS",
);

// An unconditional `missionCustomDeploy` on a UFO's base stats gives no key:
// the race is that of the missions that field the UFO.
eq(
  deploymentRaces(
    { uid: "STR_ATTACK_NAZI_RAID" },
    {
      alienRaces: { STR_NAZIS: { members: nazis } },
      alienMissions: {
        STR_MISSION_NAZI: {
          waves: [{ ufo: "STR_VESSEL_PROBE_DISTRESS", count: 1 }],
          raceWeights: { 0: { STR_NAZIS: 100 } },
        },
      },
      ufos: { STR_VESSEL_PROBE_DISTRESS: { missionCustomDeploy: "STR_ATTACK_NAZI_RAID" } },
    },
  ),
  ["STR_NAZIS"],
  "an unconditional UFO custom deploy takes the missions' race",
);

// --- `siteType` names the site's deployment from the mission side -------------
eq(
  deploymentRaces(
    { uid: "STR_LOC_MEDIUM_SCOUT_VR" },
    {
      alienRaces: { STR_SECTOID: { members: ["STR_SECTOID_COMMANDER"] } },
      alienMissions: {
        STR_MISSION_MEDIUM_SCOUT: {
          siteType: "STR_LOC_MEDIUM_SCOUT_VR",
          raceWeights: { 0: { STR_SECTOID: 100 } },
        },
      },
    },
  ),
  ["STR_SECTOID"],
  "siteType names the site deployment",
);

// --- the retaliation vessel: named only as a mission's `spawnUfo` -------------
// XPiratez `STR_VESSEL_BOARDING_TORPEDO` / `STR_VESSEL_BREAKER`: no wave names
// them; the retaliation mission spells `spawnUfo` and its raceWeights roll the
// race. The craft type is the deployment id, so the race is the mission's.
eq(
  deploymentRaces(
    { uid: "STR_VESSEL_BOARDING_TORPEDO" },
    {
      alienRaces: {
        STR_SECTOID: { members: ["STR_SECTOID_COMMANDER"] },
        STR_FLOATER: { members: ["STR_FLOATER_COMMANDER"] },
      },
      alienMissions: {
        STR_ALIEN_RETALIATION_S: {
          spawnUfo: "STR_VESSEL_BOARDING_TORPEDO",
          raceWeights: { 0: { STR_SECTOID: 50, STR_FLOATER: 50 } },
        },
      },
    },
  ),
  ["STR_SECTOID", "STR_FLOATER"],
  "spawnUfo names the vessel's mission",
);

// --- `randomRace` rolls the race, ignoring `race` -----------------------------
eq(
  deploymentRaces(
    { uid: "STR_ANYWHERE", race: "STR_SECTOID", randomRace: ["STR_FLOATER", "STR_MUTON"] },
    piratez,
  ),
  ["STR_FLOATER", "STR_MUTON"],
  "randomRace is rolled and wins over race",
);
eq(
  rankUnits(
    { uid: "STR_ANYWHERE", race: "STR_SECTOID", randomRace: ["STR_BANDIT_TOWN"] },
    0,
    piratez,
  ),
  ["STR_BANDIT_BOSS"],
  "a one-entry randomRace resolves like a race",
);

// --- `nextStage`: a follow-on stage inherits the stage before it -------------
// XPiratez `STR_LOC_TEC_BASE_*` / `STR_NINJA_BASE_HQ_*`: only the first
// stage of the chain has a route; the successors state no race, so the
// engine keeps the site's race down the chain.
const stageTables = {
  alienRaces: {
    STR_TECHNOCRACY: { members: ["STR_TECH_BOSS"] },
    STR_NINJA: { members: ["STR_NINJA_BOSS"] },
  },
  alienMissions: {
    STR_STAGE_ONE: {
      waves: [{ ufo: "STR_STAGE_ONE" }],
      raceWeights: { 0: { STR_TECHNOCRACY: 100 } },
    },
  },
  alienDeployments: {
    STR_STAGE_ONE: { uid: "STR_STAGE_ONE", nextStage: "STR_STAGE_TWO" },
    STR_STAGE_TWO: { uid: "STR_STAGE_TWO", nextStage: "STR_STAGE_THREE" },
    STR_STAGE_THREE: { uid: "STR_STAGE_THREE" },
    STR_STAGE_STATED: { uid: "STR_STAGE_STATED", race: "STR_NINJA" },
  },
};
eq(
  deploymentRaces({ uid: "STR_STAGE_TWO" }, stageTables),
  ["STR_TECHNOCRACY"],
  "a nextStage successor inherits the predecessor's race",
);
eq(
  deploymentRaces({ uid: "STR_STAGE_THREE" }, stageTables),
  ["STR_TECHNOCRACY"],
  "the chain resolves transitively to the first stage",
);
eq(
  rankUnits({ uid: "STR_STAGE_THREE" }, 0, stageTables),
  ["STR_TECH_BOSS"],
  "a third-stage rank resolves through the chain",
);
eq(
  deploymentRaces({ uid: "STR_STAGE_TWO", race: "STR_NINJA" }, stageTables),
  ["STR_NINJA"],
  "a successor stating its own race keeps it",
);
eq(
  deploymentRaces(
    { uid: "STR_STAGE_TWO" },
    {
      ...stageTables,
      alienDeployments: {
        ...stageTables.alienDeployments,
        STR_STAGE_ONE: { uid: "STR_STAGE_ONE", nextStage: "STR_STAGE_TWO" },
        STR_STAGE_TWO: { uid: "STR_STAGE_TWO", nextStage: "STR_STAGE_ONE" },
        STR_STAGE_THREE: { uid: "STR_STAGE_THREE" },
      },
    },
  ),
  ["STR_TECHNOCRACY"],
  "a nextStage cycle terminates",
);

// --- base defence: fallback races from the retaliation assault -------------
// XPiratez `STR_BASE_DEFENSE`: fought with that data whenever the attacking
// `spawnUfo` battleship carries no custom deploy with data for the mission's
// race. One race has its own deploy, so it does not fall back; a missile UFO
// strikes instead of fighting; a non-retaliation mission never attacks.
const baseTables = {
  alienRaces: {
    STR_SECTOID: { members: ["STR_SECTOID_COMMANDER"] },
    STR_MUTON: { members: ["STR_MUTON_COMMANDER"] },
    STR_BANDIT: { members: ["STR_BANDIT_BOSS"] },
  },
  alienMissions: {
    STR_ALIEN_RETALIATION: {
      objective: 4,
      spawnUfo: "STR_BATTLESHIP",
      raceWeights: { 0: { STR_SECTOID: 50, STR_MUTON: 50 } },
    },
    STR_MISSILE_STRIKE: {
      objective: 4,
      spawnUfo: "STR_MISSILE_BOAT",
      raceWeights: { 0: { STR_BANDIT: 100 } },
    },
    STR_TRANSPORT: {
      objective: 1,
      spawnUfo: "STR_BATTLESHIP",
      raceWeights: { 0: { STR_BANDIT: 100 } },
    },
  },
  alienDeployments: {
    STR_CRACKDOWN: { uid: "STR_CRACKDOWN", data: [{ alienRank: 1 }] },
    STR_EMPTY_DEPLOY: { uid: "STR_EMPTY_DEPLOY", data: [] },
  },
  ufos: {
    STR_BATTLESHIP: {
      raceBonus: { STR_SECTOID: { missionCustomDeploy: "STR_CRACKDOWN" } },
    },
    STR_MISSILE_BOAT: { missilePower: 1 },
  },
};
eq(
  deploymentRaces({ uid: "STR_BASE_DEFENSE", data: [{ alienRank: 0 }] }, baseTables),
  ["STR_MUTON"],
  "only the race with no custom deploy falls back to STR_BASE_DEFENSE",
);
eq(
  deploymentRaces(
    { uid: "STR_BASE_DEFENSE", data: [{ alienRank: 0 }] },
    {
      ...baseTables,
      ufos: {
        STR_BATTLESHIP: { raceBonus: { STR_SECTOID: { missionCustomDeploy: "STR_EMPTY_DEPLOY" } } },
      },
    },
  ),
  ["STR_SECTOID", "STR_MUTON"],
  "a custom deploy without data falls back too",
);
eq(
  deploymentRaces(
    { uid: "STR_BASE_DEFENSE", data: [{ alienRank: 0 }] },
    {
      ...baseTables,
      ufos: { STR_BATTLESHIP: { missionCustomDeploy: "STR_CRACKDOWN" } },
    },
  ),
  [],
  "an unconditional custom deploy removes the fallback",
);
eq(
  rankUnits(
    { uid: "STR_BASE_DEFENSE", data: [{ alienRank: 0 }] },
    0,
    {
      ...baseTables,
      ufos: { STR_BATTLESHIP: {} },
    },
    "STR_MUTON",
  ),
  ["STR_MUTON_COMMANDER"],
  "a pinned race shows that race's member alone",
);
eq(
  rankUnits(
    { uid: "STR_BASE_DEFENSE", data: [{ alienRank: 0 }] },
    0,
    {
      ...baseTables,
      ufos: { STR_BATTLESHIP: {} },
    },
    "STR_BANDIT",
  ),
  undefined,
  "a race that does not lead here keeps the number",
);

// XPiratez states one row, so every spawn lands on the same odds
const pirateTable = [[0, 0, 0, 1, 1, 1, 2, 2, 3, 4]];
eq(
  setChancesByLevel(5, pirateTable),
  [[30], [30], [20], [10], [10]],
  "a single-row table counts to a fixed chance per set",
);

// Vanilla's first and last rows are two separate columns
const vanillaTable = [
  [0, 0, 0, 0, 0, 0, 0, 1, 1, 2],
  [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
];
eq(
  setChancesByLevel(3, vanillaTable),
  [
    [70, 0],
    [20, 0],
    [10, 100],
  ],
  "a moving table gives a chance per set per level",
);

// A value past the last set clamps onto it
eq(
  setChancesByLevel(2, [[0, 5, 6, 7, 8, 9, 9, 9, 9, 9]]),
  [[10], [90]],
  "values above the last set fold onto it",
);

eq(setChancesByLevel(5, undefined), undefined, "no table, no chances");
eq(setChancesByLevel(5, []), undefined, "an empty table, no chances");
eq(setChancesByLevel(1, pirateTable), undefined, "one set has no choice to count");

// --- a loadout stated as empty sets means a bare-handed spawn ------------
// XPiratez `STR_LABYRINTHUS_NOCTIS`: both rows carry `itemSets:
// *itemSetsEmpty`, five empty sets, so the card says "No items in loadout"
// instead of a tech-level table of blank rows.
const itemSetsEmpty = [[], [], [], [], []];
eq(loadoutIsEmpty(itemSetsEmpty), true, "five empty sets are an empty loadout");
eq(loadoutIsEmpty([]), true, "a lone empty list is an empty loadout");
eq(loadoutIsEmpty([null, []]), true, "missing and empty sets are an empty loadout");
eq(
  loadoutIsEmpty([[], ["STR_PIR_HEAVY_PLASMA"]]),
  false,
  "one set with items is not an empty loadout",
);
eq(
  loadoutIsEmpty([["STR_PIR_HEAVY_PLASMA"], ["STR_PIR_STUN_BOMB"]]),
  false,
  "full sets are not an empty loadout",
);
eq(loadoutIsEmpty(undefined), true, "no field at all is an empty loadout");
eq(loadoutIsEmpty("STR_PIR_HEAVY_PLASMA"), false, "a lone item is not an empty loadout");

report();
