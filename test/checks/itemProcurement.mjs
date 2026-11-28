/**
 * Item procurement backlinks behind the "Procuring methods" subtable: buying
 * is the item's own fields, everything else is a backlink from the granting
 * table. Events grant through five lists in the engine (`RuleEvent`); only
 * the two plain lists were crosslinked, so the three `{item: count}` maps
 * (170 `everyMultiItemList` entries in X-Piratez) were invisible. Research
 * grants come from `spawnedItem`/`spawnedItemList`, which add to stores on
 * completion (`SavedGame.cpp`). Capturing a unit alive yields its `liveAlien`
 * item, defaulting to the item sharing the unit's type (`Unit::afterLoad`).
 * Saving a civilian instead yields its `civilianRecoveryType` item (unless it
 * names a recruit/scientist/engineer transfer), and an item with
 * `recoveryTransformations` turns into its targets on recovery.
 */
import { eq, report } from "../helpers/check.mjs";
import { testPack } from "../helpers/packs.mjs";

const rul = (t) => testPack({ rul: t });

{
  const pack = await rul(
    [
      "items:",
      "  - type: STR_PLAIN",
      "  - type: STR_MULTI",
      "  - type: STR_RANDMULTI",
      "  - type: STR_WEIGHTED",
      "  - type: STR_SPAWNED",
      "  - type: STR_SPAWNED_LIST",
      "  - type: STR_BOTH",
      "research:",
      "  - name: STR_SPAWNER",
      "    spawnedItem: STR_SPAWNED",
      "  - name: STR_SPAWNER_LIST",
      "    spawnedItemList: [STR_SPAWNED_LIST, STR_BOTH]",
      "events:",
      "  - name: STR_EV_PLAIN",
      "    randomItemList: [STR_PLAIN]",
      "  - name: STR_EV_MULTI",
      "    everyMultiItemList:",
      "      STR_MULTI: 5",
      "  - name: STR_EV_RANDMULTI",
      "    randomMultiItemList:",
      "      - STR_RANDMULTI: 2",
      "  - name: STR_EV_WEIGHTED",
      "    weightedItemList:",
      "      STR_WEIGHTED: 10",
    ].join("\n"),
  );

  eq(pack.items.STR_PLAIN?.events, ["STR_EV_PLAIN"], "plain list still backlinks");
  eq(
    pack.items.STR_MULTI?.events,
    ["STR_EV_MULTI"],
    "everyMultiItemList keys backlink onto the item",
  );
  eq(
    pack.items.STR_RANDMULTI?.events,
    ["STR_EV_RANDMULTI"],
    "randomMultiItemList keys backlink onto the item",
  );
  eq(
    pack.items.STR_WEIGHTED?.events,
    ["STR_EV_WEIGHTED"],
    "weightedItemList keys backlink onto the item",
  );
  eq(
    pack.items.STR_SPAWNED?.spawnedBy,
    ["STR_SPAWNER"],
    "singular spawnedItem backlinks the research topic",
  );
  eq(
    pack.items.STR_SPAWNED_LIST?.spawnedBy,
    ["STR_SPAWNER_LIST"],
    "spawnedItemList backlinks the research topic",
  );
  eq(
    pack.items.STR_BOTH?.spawnedBy,
    ["STR_SPAWNER_LIST"],
    "second member of a spawnedItemList backlinks too",
  );
}

{
  const pack = await rul(
    [
      "items:",
      "  - type: STR_CAPTIVE",
      "  - type: STR_TWIN_ITEM",
      "  - type: STR_DISABLED",
      "units:",
      "  - type: STR_CAPTIVE",
      "  - type: STR_TWIN",
      "    liveAlien: STR_TWIN_ITEM",
      "  - type: STR_DISABLED",
      '    liveAlien: ""',
    ].join("\n"),
  );

  eq(
    pack.items.STR_CAPTIVE?.capturedFrom,
    ["STR_CAPTIVE"],
    "a unit with no liveAlien yields the item sharing its type (itself, on the merged article)",
  );
  eq(
    pack.items.STR_TWIN_ITEM?.capturedFrom,
    ["STR_TWIN"],
    "an explicit liveAlien names a differently-typed prisoner item",
  );
  eq(
    pack.items.STR_DISABLED?.capturedFrom,
    undefined,
    'liveAlien: "" explicitly disables the prisoner item',
  );
}

{
  const pack = await rul(
    [
      "items:",
      "  - type: STR_REWARD",
      "  - type: STR_RECRUIT_OR_ITEM",
      "  - type: STR_FAKE",
      "  - type: STR_REAL",
      "soldiers:",
      "  - type: STR_RECRUIT_OR_ITEM",
      "units:",
      "  - type: STR_SAVED",
      "    civilianRecoveryType: STR_REWARD",
      '    liveAlien: ""',
      "  - type: STR_RECRUITED",
      "    civilianRecoveryType: STR_RECRUIT_OR_ITEM",
      '    liveAlien: ""',
      "  - type: STR_ENGINEERED",
      "    civilianRecoveryType: STR_ENGINEER",
      '    liveAlien: ""',
    ].join("\n"),
  );

  eq(
    pack.items.STR_REWARD?.savedFrom,
    ["STR_SAVED"],
    "a civilianRecoveryType naming an item backlinks the saved unit",
  );
  eq(
    pack.items.STR_RECRUIT_OR_ITEM?.savedFrom,
    undefined,
    "a civilianRecoveryType naming a soldier type is a recruit, not an item",
  );
  eq(pack.items.STR_ENGINEER?.savedFrom, undefined, "STR_ENGINEER is a transfer, not an item");

  const pack2 = await rul(
    [
      "items:",
      "  - type: STR_FAKE",
      "    recoveryTransformations:",
      "      STR_REAL: [1]",
      "  - type: STR_REAL",
    ].join("\n"),
  );
  eq(
    pack2.items.STR_REAL?.transformedFrom,
    ["STR_FAKE"],
    "recoveryTransformations keys backlink the source item",
  );
  eq(
    pack2.items.STR_FAKE?.transformedFrom,
    undefined,
    "the source item itself is not its own transform target",
  );
}

report();
