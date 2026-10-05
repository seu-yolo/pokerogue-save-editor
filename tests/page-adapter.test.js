import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFile } from "node:fs/promises";

import { pokeroguePageCommand } from "../src/game/page-adapter.js";

const SCENE_CACHE_KEY = "__ROGUESAVE_SCENE_V1__";
const ORIGINAL_FETCH = globalThis.fetch;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakePokemon {
  constructor({ id, name, level, hp, status, friendship, pokerus, pauseEvolutions, ivs, moves }) {
    this.id = id;
    this.nickname = name;
    this.level = level;
    this.species = { speciesId: 100 + id, name };
    this.friendship = friendship;
    this.pokerus = pokerus;
    this.pauseEvolutions = pauseEvolutions;
    this.ivs = ivs.slice();
    this.moveset = moves.map(move => ({ ...move }));
    this.calculateStatsCount = 0;
    this.resetStatusCount = 0;
    this.resetStatusCalls = [];
    this.queuedResetStatusPhases = [];
    this.calculateStats();
    this.hp = hp;
    this.status = clone(status);
    this.updateCount = 0;
  }

  getNameToRender() {
    return this.nickname;
  }

  getMoveset() {
    return this.moveset;
  }

  getMaxHp() {
    return this.stats[0];
  }

  calculateStats() {
    this.calculateStatsCount += 1;
    this.stats = [
      100 + this.ivs[0],
      50 + this.ivs[1],
      50 + this.ivs[2],
      50 + this.ivs[3],
      50 + this.ivs[4],
      50 + this.ivs[5],
    ];
  }

  resetStatus(revive = true, confusion = false, reloadAssets = false, asPhase = true) {
    this.resetStatusCount += 1;
    this.resetStatusCalls.push({ revive, confusion, reloadAssets, asPhase });
    if (!revive && this.status?.effect === 7) return;
    if (asPhase) {
      this.queuedResetStatusPhases.push({ confusion, reloadAssets });
      return;
    }
    this.status = null;
  }

  doSetStatus(effect, sleepTurnsRemaining) {
    this.status = { effect, toxicTurnCount: 0 };
    if (sleepTurnsRemaining != null) this.status.sleepTurnsRemaining = sleepTurnsRemaining;
  }

  updateInfo() {
    this.updateCount += 1;
  }

  toSave() {
    return {
      id: this.id,
      species: this.species.speciesId,
      level: this.level,
      hp: this.hp,
      status: clone(this.status),
      friendship: this.friendship,
      pokerus: this.pokerus,
      pauseEvolutions: this.pauseEvolutions,
      ivs: this.ivs.slice(),
      stats: this.stats.slice(),
      moveset: this.moveset.map(move => ({ ...move })),
    };
  }
}

class SafeModifier {
  constructor(stackCount = 2) {
    this.stackCount = stackCount;
    this.virtualStackCount = 0;
    this.type = { id: "TEST_SAFE", name: "测试安全道具" };
  }

  getMaxStackCount() {
    return 10;
  }
}

class LapsingPersistentModifier {
  constructor(stackCount = 1) {
    this.stackCount = stackCount;
    this.virtualStackCount = 0;
    this.type = { id: "TEST_LAPSING", name: "测试临时道具" };
  }

  getMaxStackCount() {
    return 5;
  }
}

function savedModifier(modifier) {
  return {
    player: true,
    typeId: modifier.type.id,
    ...(modifier.type.testOfficial ? {} : { typePregenArgs: [] }),
    args: typeof modifier.getArgs === "function" ? modifier.getArgs() : [],
    stackCount: modifier.stackCount,
    className: modifier.constructor.name,
  };
}

function makeScene({
  waveIndex = 188,
  gameVersion = "1.12.0.10",
  saveMode = "success",
  includeProtectedModifier = false,
  name = "第一存档",
  phaseName = "CommandPhase",
  modifierOrderMismatch = false,
  refreshMutation = null,
  readbackThrowsAfterSave = false,
  liveReadbackThrowsAfterSave = false,
  fainted = false,
  persistedNormalization = false,
  parserBehavior = "normal",
  parserRewritesModifierStack = false,
  parserConditionallyRewritesScore = false,
  parserConditionallyRewritesModifierStat = false,
  modifierChangesStats = false,
  getSessionMutation = null,
  turnChangesDuringSave = false,
  eggCount = 0,
  systemSaveMode = "success",
} = {}) {
  const party = [
    new FakePokemon({
      id: 11,
      name: "妙蛙种子",
      level: 92,
      hp: fainted ? 0 : 37,
      status: fainted ? { effect: 7, toxicTurnCount: 0 } : { effect: 2, toxicTurnCount: 3 },
      friendship: 84,
      pokerus: false,
      pauseEvolutions: false,
      ivs: [12, 18, 20, 21, 19, 24],
      moves: [
        { moveId: 10, ppUsed: 3, ppUp: 0 },
        { moveId: 20, ppUsed: 1, ppUp: 1 },
      ],
    }),
    new FakePokemon({
      id: 22,
      name: "皮卡丘",
      level: 90,
      hp: 88,
      status: null,
      friendship: 120,
      pokerus: true,
      pauseEvolutions: true,
      ivs: [31, 30, 29, 28, 27, 26],
      moves: [{ moveId: 30, ppUsed: 5, ppUp: 2 }],
    }),
  ];
  const modifiers = [new SafeModifier()];
  if (includeProtectedModifier) modifiers.push(new LapsingPersistentModifier());
  let refreshMutationDone = false;
  const currentPhase = {
    phaseName,
    is: expected => phaseName === expected,
  };

  const scene = {
    sessionSlotId: 0,
    seed: "wave-independent-seed",
    money: 12345,
    score: 6789,
    diagnosticMap: { ASeed9f8e7d6c: 1, 123456: 1, money: 1 },
    pokeballCounts: { 0: 7, 1: 6, 2: 5, 3: 4, 4: 1 },
    currentBattle: { waveIndex, turn: 3, battleType: 0 },
    gameMode: { modeId: 0, isClassic: true },
    game: { config: { gameVersion } },
    input: { enabled: true },
    phaseManager: {
      getCurrentPhase: () => currentPhase,
      hasPhaseOfType: () => false,
    },
    modifiers,
    getPlayerParty: () => party,
    getEnemyParty: () => [{ id: 999 }],
    findModifiers: () => modifiers,
    updateMoneyText() {
      if (refreshMutationDone || !refreshMutation) return;
      refreshMutationDone = true;
      if (refreshMutation === "hp") party[0].hp -= 1;
      if (refreshMutation === "score") scene.score += 1;
      if (refreshMutation === "move") party[0].moveset[0].moveId += 1;
      if (refreshMutation === "normalizable-live-type") {
        party[0].friendship = String(party[0].friendship);
      }
      if (refreshMutation === "many-protected-fields") {
        scene.score += 1;
        scene.pokeballCounts[0] += 1;
        party[0].hp -= 1;
        party[0].friendship += 1;
        party[0].pokerus = !party[0].pokerus;
        party[0].pauseEvolutions = !party[0].pauseEvolutions;
        party[0].ivs[0] += 1;
        party[0].moveset[0].moveId += 1;
        party[0].moveset[0].ppUsed += 1;
        party[1].hp -= 1;
        party[1].friendship += 1;
        party[1].pokerus = !party[1].pokerus;
      }
      if (refreshMutation === "dynamic-diagnostic-keys") {
        scene.diagnosticMap.ASeed9f8e7d6c += 1;
        scene.diagnosticMap[123456] += 1;
        scene.diagnosticMap.money += 1;
      }
    },
    async updateModifiers() {
      if (modifierChangesStats) {
        party[0].stats[1] = 50 + party[0].ivs[1] + (modifiers[0].stackCount === 5 ? 10 : 0);
      }
    },
  };

  let nextEggId = 10_000;
  const eggs = Array.from({ length: eggCount }, (_, index) => ({
    id: index + 1,
    tier: 0,
    hatchWaves: 10,
    sourceType: 0,
  }));
  const eggHandler = {
    gachaCursor: 1,
    getGuaranteedEggTierFromPullCount() { return 0; },
    pullEggs(pullCount) {
      const pulled = [];
      for (let index = 0; index < pullCount; index += 1) {
        const egg = {
          id: nextEggId++,
          tier: this.getGuaranteedEggTierFromPullCount(pullCount),
          hatchWaves: 100,
          sourceType: this.gachaCursor,
          species: 999,
          isShiny: false,
        };
        eggs.push(egg);
        scene.gameData.eggPity[1] += 1;
        scene.gameData.eggPity[2] += 1;
        scene.gameData.eggPity[3] = 0;
        scene.gameData.unlockPity[3] += 1;
        scene.gameData.gameStats.eggsPulled += 1;
        scene.gameData.gameStats.legendaryEggsPulled += 1;
        pulled.push(egg);
      }
      return pulled;
    },
  };
  scene.ui = { handlers: [eggHandler] };

  const serialize = () => ({
    seed: scene.seed,
    playTime: 123456,
    gameMode: scene.gameMode.modeId,
    dailyConfig: null,
    party: party.map(pokemon => pokemon.toSave()),
    enemyParty: [{ id: 999, species: 150, hp: 400 }],
    modifiers: (modifierOrderMismatch ? [...modifiers].reverse() : modifiers).map(savedModifier),
    enemyModifiers: [],
    arena: { biome: 1, weather: null },
    pokeballCounts: { ...scene.pokeballCounts },
    money: scene.money,
    score: scene.score,
    diagnosticMap: { ...scene.diagnosticMap },
    waveIndex: scene.currentBattle.waveIndex,
    battleType: scene.currentBattle.battleType,
    trainer: null,
    gameVersion: scene.game.config.gameVersion,
    timestamp: 123456789,
    challenges: [],
    mysteryEncounterType: null,
    mysteryEncounterSaveData: null,
    playerFaints: 0,
  });

  let parseSessionCalls = 0;
  const normalizePersistedSession = value => {
    const session = typeof value === "string" ? JSON.parse(value) : clone(value);
    if (persistedNormalization) {
      session.arena = {
        terrain: null,
        playerTerasUsed: [],
        tags: [],
        positionalTags: [],
        ...session.arena,
      };
      for (const pokemon of [...(session.party || []), ...(session.enemyParty || [])]) {
        pokemon.metLevel ??= 5;
        pokemon.metBiome ??= -1;
        pokemon.metWave ??= -1;
        pokemon.usedTMs ??= [];
        if (pokemon.status) pokemon.status.toxicTurnCount ??= 0;
      }
    }
    if (parserRewritesModifierStack && session.modifiers?.[0]) {
      session.modifiers[0].stackCount = 1;
    }
    if (parserConditionallyRewritesScore && Number(session.money) === 300000) {
      session.score = 1;
    }
    if (parserConditionallyRewritesModifierStat
      && Number(session.modifiers?.[0]?.stackCount) === 5
      && session.party?.[0]?.stats) {
      session.party[0].stats[1] = 999;
    }
    return session;
  };

  const parseSessionData = dataStr => {
    parseSessionCalls += 1;
    if (parserBehavior === "throw") throw new Error("simulated parser failure");
    if (parserBehavior === "invalid-object") return { parserResult: "not-a-session" };
    return normalizePersistedSession(dataStr);
  };

  let persisted = normalizePersistedSession({ ...clone(serialize()), name });
  let saveCalls = 0;
  let renameCalls = 0;
  let nativeExportCalls = 0;
  let saveCompleted = false;
  let getSessionCalls = 0;
  let postSaveReadCalls = 0;
  let systemSaveCalls = 0;

  scene.gameData = {
    eggs,
    eggPity: [0, 0, 0, 0],
    unlockPity: [0, 0, 0, 0],
    gameStats: { eggsPulled: 0, legendaryEggsPulled: 0 },
    getSessionSaveData: () => {
      if (liveReadbackThrowsAfterSave && saveCompleted) throw new Error("simulated live readback failure");
      return serialize();
    },
    getSession: async slot => {
      getSessionCalls += 1;
      if (readbackThrowsAfterSave && saveCompleted) throw new Error("simulated readback failure");
      const result = slot === 0 ? clone(parseSessionData(JSON.stringify(persisted))) : null;
      if (getSessionMutation === "locked-money" && getSessionCalls === 3) scene.money = 20000;
      if (getSessionMutation === "locked-hp" && getSessionCalls === 3) party[0].hp -= 1;
      if (getSessionMutation === "pre-save-score" && getSessionCalls === 4) scene.score += 1;
      if (saveCompleted) {
        postSaveReadCalls += 1;
        if (getSessionMutation === "post-save-cache-after-first" && postSaveReadCalls === 1) {
          persisted.score += 1;
        }
      }
      return result;
    },
    saveAll: async () => {
      saveCalls += 1;
      if (saveMode === "throw") throw new Error("simulated save failure");
      if (saveMode === "false-before") return false;
      persisted = normalizePersistedSession(serialize());
      if (saveMode === "corrupt-after") persisted.score += 1;
      saveCompleted = true;
      if (turnChangesDuringSave) scene.currentBattle.turn += 1;
      return saveMode !== "false-after";
    },
    saveSystem: async () => {
      systemSaveCalls += 1;
      if (systemSaveMode === "throw") throw new Error("simulated system save failure");
      return systemSaveMode !== "false";
    },
    renameSession: async (slot, nextName) => {
      renameCalls += 1;
      if (saveMode === "rename-throw"
        || (saveMode === "rename-throw-once" && renameCalls === 1)) {
        throw new Error("simulated rename failure");
      }
      if (slot !== 0 || saveMode === "rename-false") return false;
      persisted.name = nextName;
      return true;
    },
    tryExportData: async (type, slot) => {
      nativeExportCalls += 1;
      return (type === 1 && slot === 0) || (type === 0 && slot === undefined);
    },
    parseSessionData,
  };

  return {
    scene,
    party,
    modifiers,
    getPersisted: () => clone(persisted),
    getSaveCalls: () => saveCalls,
    getRenameCalls: () => renameCalls,
    getNativeExportCalls: () => nativeExportCalls,
    getSystemSaveCalls: () => systemSaveCalls,
    eggs,
    eggHandler,
    getParseSessionCalls: () => parseSessionCalls,
    getSessionCalls: () => getSessionCalls,
    mutatePersisted: mutator => { mutator(persisted); },
  };
}

function bindScene(scene) {
  globalThis.window = { [SCENE_CACHE_KEY]: scene };
}

function hpModifierFixture(options = {}) {
  const fixture = makeScene(options);
  fixture.scene.updateModifiers = async () => {
    for (const pokemon of fixture.party) {
      const nextMax = 100 + pokemon.ivs[0] + (fixture.modifiers[0].stackCount - 2) * 10;
      // Mirror the official HP recalculation, including its asymmetric clamp.
      if (pokemon.hp > nextMax) pokemon.hp = nextMax;
      else if (pokemon.hp && nextMax > pokemon.getMaxHp()) pokemon.hp += nextMax - pokemon.getMaxHp();
      pokemon.stats[0] = nextMax;
    }
    if (options.corruptHp) fixture.party[0].hp += 1;
  };
  bindScene(fixture.scene);
  return fixture;
}

async function commitFixture(fixture, operations, txId) {
  const before = await pokeroguePageCommand({ command: "inspect" });
  assert.equal(before.ok, true, before.message);
  const selected = operations(before);
  const result = await pokeroguePageCommand({ command: "commit", payload: {
    txId, expectedHash: before.model.hash, expectedBackendHash: before.model.backendHash, operations: selected,
  } });
  return { before, result, operations: selected };
}

test("HP item increases and decreases save the official coupled HP and undo the exact injury", async () => {
  for (const count of [1, 5]) {
    const fixture = hpModifierFixture();
    if (count === 1) fixture.party[0].hp = 110;
    fixture.mutatePersisted(s => { s.party = fixture.party.map(p => p.toSave()); });
    const original = fixture.party.map(p => p.toSave());
    const { before, result, operations } = await commitFixture(fixture, b => [
      { type: "setModifierStack", fingerprint: b.model.modifiers[0].fingerprint, value: count },
    ], `hp-items-commit-${count}`);
    assert.equal(result.ok, true, result.message);
    assert.equal(fixture.party[0].hp, count === 1 ? 102 : 67);
    const undo = await pokeroguePageCommand({ command: "undo", payload: {
      txId: `hp-items-undo-${count}`, expectedHash: result.afterHash, expectedBackendHash: result.afterBackendHash,
      expectedBeforeFullHash: before.backup.fullHash, beforeSession: before.backup.session, operations,
    } });
    assert.equal(undo.ok, true, undo.message);
    assert.deepEqual(fixture.party.map(p => p.toSave()), original);
  }
});

test("HP item rejection restores damage and stats without persistence or a stuck lock", async () => {
  const fixture = hpModifierFixture({ parserConditionallyRewritesModifierStat: true });
  // Existing fixture rewrites ATK on five stacks; trigger that authorized field.
  const originalRefresh = fixture.scene.updateModifiers;
  fixture.scene.updateModifiers = async () => {
    await originalRefresh();
    fixture.party[0].stats[1] = 50 + fixture.party[0].ivs[1] + (fixture.modifiers[0].stackCount === 5 ? 10 : 0);
  };
  const original = fixture.party.map(p => p.toSave());
  const { result } = await commitFixture(fixture, b => [
    { type: "setModifierStack", fingerprint: b.model.modifiers[0].fingerprint, value: 5 },
  ], "hp-items-rejected-0001");
  assert.equal(result.code, "UNEXPECTED_DIFF", result.message);
  assert.equal(fixture.getSaveCalls(), 0);
  assert.equal(fixture.modifiers[0].stackCount, 2);
  assert.deepEqual(fixture.party.map(p => p.toSave()), original);
  assert.equal((await pokeroguePageCommand({ command: "inspect" })).model.persistenceInSync, true);
});

test("HP item whitelist still rejects a non-official HP change", async () => {
  const fixture = hpModifierFixture({ corruptHp: true });
  const { result } = await commitFixture(fixture, b => [
    { type: "setModifierStack", fingerprint: b.model.modifiers[0].fingerprint, value: 5 },
  ], "hp-items-corrupt-0001");
  assert.equal(result.ok, false);
  assert.match(result.message, /白名单/);
  assert.equal(fixture.getSaveCalls(), 0);
});

test("HP item updates never revive a fainted party member", async () => {
  const fixture = hpModifierFixture({ fainted: true });
  const { result } = await commitFixture(fixture, b => [
    { type: "setModifierStack", fingerprint: b.model.modifiers[0].fingerprint, value: 5 },
  ], "hp-items-fainted-0001");
  assert.equal(result.ok, true, result.message);
  assert.equal(fixture.party[0].hp, 0);
  assert.equal(fixture.party[0].status.effect, 7);
});

test("HP items with healing and max IV obey both operation orders", async () => {
  for (const reverse of [false, true]) {
    const fixture = hpModifierFixture();
    const original = fixture.party.map(p => p.toSave());
    const { before, result, operations } = await commitFixture(fixture, b => {
      const operations = [
        { type: "setModifierStack", fingerprint: b.model.modifiers[0].fingerprint, value: 5 },
        { type: "maxIvs", pokemonId: 11 },
        { type: "healParty", hp: true, status: true, pp: false },
      ];
      return reverse ? operations.reverse() : operations;
    }, `hp-items-mixed-${reverse}`);
    assert.equal(result.ok, true, result.message);
    assert.equal(fixture.party[0].hp, fixture.party[0].getMaxHp());
    const undo = await pokeroguePageCommand({ command: "undo", payload: {
      txId: `hp-items-mixed-undo-${reverse}`, expectedHash: result.afterHash, expectedBackendHash: result.afterBackendHash,
      expectedBeforeFullHash: before.backup.fullHash, beforeSession: before.backup.session, operations,
    } });
    assert.equal(undo.ok, true, undo.message);
    assert.deepEqual(fixture.party.map(p => p.toSave()), original);
  }
});

test("max IV no longer accepts unrelated observed HP as an authorized result", async () => {
  const fixture = makeScene({ refreshMutation: "hp" }); bindScene(fixture.scene);
  const original = fixture.party.map(p => p.toSave());
  const { result } = await commitFixture(fixture, () => [{ type: "maxIvs", pokemonId: 11 }], "iv-hp-corrupt-0001");
  assert.equal(result.code, "UNEXPECTED_DIFF", result.message);
  assert.equal(fixture.getSaveCalls(), 0);
  assert.deepEqual(fixture.party.map(p => p.toSave()), original);
});

test("mixed HP items, healing and IV changes roll back exactly on parser rejection", async () => {
  const fixture = hpModifierFixture({ parserConditionallyRewritesModifierStat: true });
  const original = fixture.party.map(p => p.toSave());
  const { result } = await commitFixture(fixture, b => [
    { type: "setModifierStack", fingerprint: b.model.modifiers[0].fingerprint, value: 5 },
    { type: "maxIvs", pokemonId: 11 },
    { type: "healParty", hp: true, status: true, pp: true },
  ], "hp-mixed-rejection-0001");
  assert.equal(result.code, "UNEXPECTED_DIFF", result.message);
  assert.equal(fixture.getSaveCalls(), 0);
  assert.deepEqual(fixture.party.map(p => p.toSave()), original);
  assert.equal((await pokeroguePageCommand({ command: "inspect" })).model.persistenceInSync, true);
});

test("new held items that affect maximum HP save and can be undone", async () => {
  const fixture = itemFixture();
  fixture.scene.updateModifiers = async () => {
    for (const pokemon of fixture.party) {
      const nextMax = 100 + pokemon.ivs[0] + (fixture.scene.modifiers.length > 1 ? 20 : 0);
      if (pokemon.hp > nextMax) pokemon.hp = nextMax;
      else if (pokemon.hp && nextMax > pokemon.getMaxHp()) pokemon.hp += nextMax - pokemon.getMaxHp();
      pokemon.stats[0] = nextMax;
    }
  };
  const original = fixture.party.map(p => p.toSave());
  const { before, result, operations } = await commitFixture(fixture, () => [
    { type: "addModifier", itemId: "LEFTOVERS", pokemonId: 11, count: 1 },
  ], "hp-new-item-0001");
  assert.equal(result.ok, true, result.message);
  const undo = await pokeroguePageCommand({ command: "undo", payload: {
    txId: "hp-new-item-undo-0001", expectedHash: result.afterHash, expectedBackendHash: result.afterBackendHash,
    expectedBeforeFullHash: before.backup.fullHash, beforeSession: before.backup.session, operations,
  } });
  assert.equal(undo.ok, true, undo.message);
  assert.deepEqual(fixture.party.map(p => p.toSave()), original);
});

function accountFixture({ save = "success" } = {}) {
  const fixture = makeScene();
  bindScene(fixture.scene);
  const cache = new Map([["data_demo", "original-encrypted-cache"], ["unrelated", "keep"]]);
  globalThis.localStorage = {
    get length() { return cache.size; }, key: index => [...cache.keys()][index] ?? null,
    getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, String(value)), removeItem: key => cache.delete(key),
  };
  const gameData = fixture.scene.gameData;
  Object.assign(gameData, {
    trainerId: 101, secretId: 202,
    dexData: {
      1: { seenAttr: 0n, caughtAttr: 0n, seenCount: 0, caughtCount: 0, natureAttr: 0, ivs: [1, 2, 3, 4, 5, 6] },
      2: { seenAttr: 149n, caughtAttr: 149n, seenCount: 7, caughtCount: 4, natureAttr: 2, ivs: [6, 5, 4, 3, 2, 1] },
    },
    starterData: {
      1: { abilityAttr: 0, eggMoves: 0, candyCount: 0, passiveAttr: 0, valueReduction: 0, classicWinCount: 0 },
      2: { abilityAttr: 1, eggMoves: 1, candyCount: 8, passiveAttr: 1, valueReduction: 2, classicWinCount: 3 },
    },
    voucherCounts: { 0: 2, 1: 3, 2: 4, 3: 5 },
    getSystemSaveData() {
      return { trainerId: this.trainerId, secretId: this.secretId, dexData: this.dexData, starterData: this.starterData,
        voucherCounts: this.voucherCounts, eggs: this.eggs, eggPity: this.eggPity, unlockPity: this.unlockPity,
        gameStats: this.gameStats, unlocks: { 1: true }, timestamp: 123456789, gameVersion: "1.12.0.10" };
    },
  });
  let saves = 0;
  gameData.saveSystem = async () => {
    saves += 1; localStorage.setItem("data_demo", "updated-encrypted-cache");
    if (save === "throw") throw new Error("network failure");
    if (save === "turn") fixture.scene.currentBattle.turn += 1;
    if (save === "replace") fixture.scene.gameData = { ...gameData, voucherCounts: { 0: 99 } };
    return save !== "false";
  };
  const species = id => ({ speciesId: id, name: `测试物种${id}`, legendary: id === 1,
    ability1: 1, ability2: 2, abilityHidden: 3,
    forms: [{ formName: "基础" }, { formName: "不可选", isStarterSelectable: false }],
    getFullUnlocksData: () => id === 1 ? 1n | 2n | 4n | 16n | 32n | 64n | 128n | 256n : 1n | 2n | 4n | 16n | 128n,
  });
  window.__ROGUESAVE_GAME_EXPORTS_V1__ = { version: "1.12.0.10", adapterVersion: "1.0.0",
    registry: { getSpecies: species, getAllStarters: () => [1, 2] },
    eggMoves: { 1: [10, 20, 30, 40], 2: [10, 20, 30, 40] },
    moves: Object.fromEntries([10, 20, 30, 40].map(id => [id, { id, power: 100, name: `招式${id}` }])),
    abilities: { 1: { name: "特性一" }, 2: { name: "特性二" }, 3: { name: "隐藏特性" } },
  };
  return { ...fixture, cache, saves: () => saves, snapshot: () => JSON.parse(JSON.stringify(gameData.getSystemSaveData(), (_key, value) => typeof value === "bigint" ? String(value) : value)) };
}

async function accountCommit(operations, txId = "account-test-0001") {
  const preview = await pokeroguePageCommand({ command: "account-preview", payload: { operations } });
  assert.equal(preview.ok, true, preview.message);
  const result = await pokeroguePageCommand({ command: "account-commit", payload: { txId, operations, expectedSystem: preview.expectedSystem } });
  return { preview, result };
}

test("account JSON transport preserves nullable starter metadata and rejects real conflicts", async () => {
  const fixture = accountFixture();
  Object.assign(fixture.scene.gameData.starterData[1], { friendship: 0, moveset: null });
  const operations = [{ type: "setVoucher", key: "0", value: 300 }];
  const preview = await pokeroguePageCommand({ command: "account-preview", payload: { operations } });
  assert.equal(preview.ok, true, preview.message);
  assert.deepEqual(JSON.parse(preview.expectedSystemJson).starterData[1], preview.expectedSystem.starterData[1]);
  const incompleteObject = structuredClone(preview.expectedSystem);
  delete incompleteObject.starterData[1].moveset;
  const result = await pokeroguePageCommand({ command: "account-commit", payload: {
    txId: "account-json-0001", operations, expectedSystem: incompleteObject, expectedSystemJson: preview.expectedSystemJson,
  } });
  assert.equal(result.ok, true, result.message);
  assert.equal(JSON.parse(result.afterSystemJson).starterData[1].moveset, null);
  assert.equal(fixture.saves(), 1);

  const next = await pokeroguePageCommand({ command: "account-preview", payload: { operations } });
  fixture.scene.gameData.starterData[1].friendship = 1;
  const stale = await pokeroguePageCommand({ command: "account-commit", payload: {
    txId: "account-json-0002", operations, expectedSystemJson: next.expectedSystemJson,
  } });
  assert.equal(stale.code, "STALE");
  assert.equal(fixture.saves(), 1);
});

test("malformed account JSON is rejected without persistence", async () => {
  const fixture = accountFixture();
  const result = await pokeroguePageCommand({ command: "account-commit", payload: {
    txId: "account-json-invalid", operations: [{ type: "setVoucher", key: "0", value: 300 }], expectedSystemJson: "{",
  } });
  assert.equal(result.ok, false);
  assert.equal(fixture.saves(), 0);
});

class AddedModifier {
  constructor(type, pokemonId = null) { this.type = type; if (pokemonId != null) this.pokemonId = pokemonId; this.stackCount = 1; this.virtualStackCount = 0; }
  getArgs() { return this.pokemonId == null ? [] : [this.pokemonId]; }
  getMaxStackCount() { return 4; }
  match(other) { return other.type.id === this.type.id && other.pokemonId === this.pokemonId; }
}

function itemFixture(options = {}) {
  const fixture = makeScene(options); bindScene(fixture.scene);
  window.__ROGUESAVE_GAME_EXPORTS_V1__ = { version: "1.12.0.10", adapterVersion: "1.0.0", itemLookup: id => ["SHINY_CHARM", "LEFTOVERS"].includes(id) ? () => {
    const type = { id, testOfficial: true, name: id === "SHINY_CHARM" ? "闪耀护符" : "吃剩的东西", getDescription: () => "官方道具说明",
      newModifier: pokemon => new AddedModifier(type, pokemon?.id ?? null) };
    return type;
  } : null };
  return fixture;
}

function makeEncounterPool(overrides = {}) {
  const pool = Object.fromEntries(Array.from({ length: 9 }, (_unused, tier) => [tier, []]));
  pool[0] = [{ speciesId: 100, marker: "common" }];
  for (const [tier, values] of Object.entries(overrides)) pool[tier] = values;
  return pool;
}

function installEncounterFixture(fixture, pokemonPool = makeEncounterPool()) {
  const calls = [];
  fixture.scene.arena = {
    biomeId: 1,
    pokemonPool,
    trainerPool: makeEncounterPool({ 4: [{ speciesId: 904, marker: "trainer-ultra" }] }),
    updatePoolsForTimeOfDay() {},
  };
  const original = function randomSpecies(waveIndex, level, fromArenaPool) {
    calls.push({ waveIndex, level, fromArenaPool });
    return fromArenaPool
      ? this.arena.pokemonPool[0][0]
      : { speciesId: 1, marker: "global" };
  };
  fixture.scene.randomSpecies = original;
  return { calls, original };
}

function assertNoQueuedStatusReset(party) {
  for (const pokemon of party) {
    assert.deepEqual(
      pokemon.queuedResetStatusPhases,
      [],
      `${pokemon.nickname} must not enqueue ResetStatusPhase during an atomic save operation`,
    );
    for (const call of pokemon.resetStatusCalls) {
      assert.deepEqual(
        call,
        { revive: true, confusion: false, reloadAssets: false, asPhase: false },
        `${pokemon.nickname} resetStatus must use the game's explicit synchronous four-argument form`,
      );
    }
  }
}

function assertBoundedRedactedDiagnosticsIfPresent(result) {
  if (!Object.hasOwn(result, "diagnostics") || result.diagnostics == null) return;
  const diagnostics = result.diagnostics;
  assert.equal(typeof diagnostics, "object");
  assert.deepEqual(Object.keys(diagnostics).sort(), ["fields", "mismatchCount", "stage", "truncated"]);
  assert.ok([
    "commit-whitelist",
    "undo-whitelist",
    "rollback-verify",
    "pre-mutation-cas",
    "pre-persist-cas",
    "persist-normalization",
    "persist-verify",
  ].includes(diagnostics.stage));
  assert.ok(Number.isSafeInteger(diagnostics.mismatchCount));
  assert.ok(diagnostics.mismatchCount >= 0);
  assert.equal(typeof diagnostics.truncated, "boolean");
  assert.ok(Array.isArray(diagnostics.fields));
  assert.ok(diagnostics.fields.length <= 8, "diagnostic field list must remain bounded");
  assert.ok(diagnostics.mismatchCount >= diagnostics.fields.length);

  for (const field of diagnostics.fields) {
    assert.deepEqual(Object.keys(field).sort(), ["kind", "path"]);
    assert.equal(typeof field.path, "string");
    assert.ok(field.path.length > 0 && field.path.length <= 160);
    assert.match(field.path, /^[A-Za-z0-9_.\[\]-]+$/);
    assert.ok(["missing", "unexpected", "type", "value", "array-length"].includes(field.kind));
  }

  const serialized = JSON.stringify(diagnostics);
  for (const sensitive of ["wave-independent-seed", "第一存档", "妙蛙种子", "皮卡丘"]) {
    assert.doesNotMatch(serialized, new RegExp(sensitive));
  }
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.location;
  delete globalThis.localStorage;
  globalThis.fetch = ORIGINAL_FETCH;
  delete globalThis.__ROGUESAVE_AUTODISCOVERY_SCENE__;
});

test("collection discovers data behind the running BattleScene without following other dynamic imports", async () => {
  const fixture = accountFixture();
  fixture.scene.constructor = class BattleScene {};
  // Old extension cache must not hide the newly discovered tables.
  delete window.__ROGUESAVE_GAME_EXPORTS_V1__.adapterVersion;
  const entry = new URL("./fixtures/assets/index-catalog.js", import.meta.url);
  globalThis.document = { querySelectorAll: () => [{ src: entry.href }] };
  globalThis.location = { origin: entry.origin, href: entry.href };
  const fetched = [];
  globalThis.fetch = async url => {
    fetched.push(url);
    return new Response(url === entry.href
      ? 'async function startGame(){let{BattleScene:b}=await import(`./battle-scene-catalog.js`); await import("./must-not-run.js");}'
      : await readFile(new URL(url), "utf8"));
  };
  const result = await pokeroguePageCommand({ command: "collection-catalog" });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.eggMovesAvailable, true);
  assert.equal(result.species[0].abilities[0].name, "特性1", "move array must never replace abilities");
  assert.deepEqual(result.species[0].eggMoves.map(row => row.name), ["招式10", "招式20", "招式30", "招式40"]);
  assert.equal(fetched.some(url => url.endsWith("must-not-run.js")), false);
  assert.equal(window.__ROGUESAVE_GAME_EXPORTS_V1__.adapterVersion, "1.0.0");
});

test("collection never imports a BattleScene chunk before that scene is instantiated", async () => {
  accountFixture(); delete window.__ROGUESAVE_GAME_EXPORTS_V1__;
  const entry = new URL("./fixtures/assets/index-catalog.js", import.meta.url);
  globalThis.document = { querySelectorAll: () => [{ src: entry.href }] };
  globalThis.location = { origin: entry.origin, href: entry.href };
  globalThis.fetch = async url => {
    assert.equal(url, entry.href, "must not follow the not-yet-running scene");
    return new Response('async function startGame(){let{BattleScene:b}=await import("./battle-scene-catalog.js");}');
  };
  const result = await pokeroguePageCommand({ command: "collection-catalog" });
  assert.equal(result.ok, false);
  assert.match(result.message, /物种注册表/);
});

test("collection catalog reports legal shiny tiers, starter forms and existing unlocks", async () => {
  accountFixture();
  const result = await pokeroguePageCommand({ command: "collection-catalog" });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.species[0].shinies, [0, 1, 2]);
  assert.deepEqual(result.species[1].shinies, [0]);
  assert.deepEqual(result.species[0].forms.map(row => row.index), [0]);
  assert.equal(result.species[1].owned, true);
  assert.equal(result.species[1].eggMoves[0].owned, true);
  assert.equal(result.species[0].eggMoves[3].name, "招式40");
});

test("permanent starter unlock adds selected red shiny, nature, egg move and hidden ability only", async () => {
  const fixture = accountFixture();
  const before = fixture.snapshot();
  const { preview, result } = await accountCommit([{ type: "unlockStarter", speciesId: 1, shiny: "2", natures: [15], eggMoves: [3], abilities: [2] }]);
  assert.equal(result.ok, true, result.message);
  assert.equal(fixture.saves(), 1);
  assert.equal(fixture.scene.gameData.dexData[1].caughtAttr, 198n);
  assert.equal(fixture.scene.gameData.dexData[1].natureAttr, 1 << 16);
  assert.equal(fixture.scene.gameData.starterData[1].eggMoves, 8);
  assert.equal(fixture.scene.gameData.starterData[1].abilityAttr, 4);
  assert.deepEqual(fixture.snapshot().dexData[2], before.dexData[2]);
  assert.deepEqual(fixture.snapshot().starterData[2], before.starterData[2]);
  assert.deepEqual(fixture.snapshot().gameStats, before.gameStats);
  assert.deepEqual(fixture.snapshot().dexData[1].ivs, before.dexData[1].ivs);
  assert.equal(fixture.snapshot().starterData[1].candyCount, 0);
  assert.equal(preview.expectedSystem.dexData[1].caughtAttr, "0", "preview must not mutate live collection");
  assert.equal(fixture.scene.money, 12345);
});

test("existing collection is additive and a repeated unlock is a no-op", async () => {
  const fixture = accountFixture();
  const operation = { type: "unlockStarter", speciesId: 2, shiny: "0", natures: [3], eggMoves: [2], abilities: [2] };
  const { result } = await accountCommit([operation]);
  assert.equal(result.ok, true, result.message);
  assert.equal(fixture.scene.gameData.dexData[2].caughtAttr, 151n);
  assert.equal(fixture.scene.gameData.dexData[2].natureAttr, 2 | 16);
  assert.equal(fixture.scene.gameData.starterData[2].eggMoves, 1 | 4);
  assert.equal(fixture.scene.gameData.starterData[2].candyCount, 8);
  const second = await accountCommit([operation], "account-test-0002");
  assert.equal(second.result.code, "NO_CHANGES");
  assert.equal(fixture.saves(), 1);
});

test("basic starter unlock supplies valid default nature and ability without adding egg moves", async () => {
  const fixture = accountFixture();
  const { result } = await accountCommit([{ type: "unlockStarter", speciesId: 1 }]);
  assert.equal(result.ok, true, result.message);
  assert.equal(fixture.scene.gameData.dexData[1].caughtAttr, 149n);
  assert.equal(fixture.scene.gameData.dexData[1].caughtCount, 1);
  assert.equal(fixture.scene.gameData.dexData[1].natureAttr, 2);
  assert.equal(fixture.scene.gameData.starterData[1].abilityAttr, 1);
  assert.equal(fixture.scene.gameData.starterData[1].eggMoves, 0);
});

test("invalid permanent unlock options are rejected before saving or changing data", async () => {
  for (const extra of [{ speciesId: 99 }, { speciesId: 2, shiny: "2" }, { formIndex: 1 }, { natures: [25] }, { natures: [3, 3] }, { abilities: [3] }, { eggMoves: [4] }]) {
    const fixture = accountFixture(); const before = fixture.snapshot();
    const response = await pokeroguePageCommand({ command: "account-preview", payload: { operations: [{ type: "unlockStarter", speciesId: 1, ...extra }] } });
    assert.equal(response.ok, false, JSON.stringify(extra));
    assert.equal(fixture.saves(), 0);
    assert.deepEqual(fixture.snapshot(), before);
  }
});

test("voucher totals are saved independently without changing collection or current run", async () => {
  const fixture = accountFixture(); const before = fixture.snapshot();
  const { result } = await accountCommit([{ type: "setVoucher", key: "0", value: 300 }, { type: "setVoucher", key: "3", value: 9999 }]);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(fixture.scene.gameData.voucherCounts, { 0: 300, 1: 3, 2: 4, 3: 9999 });
  assert.deepEqual(fixture.snapshot().dexData, before.dexData);
  assert.deepEqual(fixture.snapshot().gameStats, before.gameStats);
  assert.equal(fixture.scene.money, 12345);
});

test("invalid voucher amounts, keys and duplicate operations are rejected", async () => {
  for (const operations of [[{ type: "setVoucher", key: "4", value: 10 }], [{ type: "setVoucher", key: "0", value: -1 }], [{ type: "setVoucher", key: "0", value: 10000 }], [{ type: "setVoucher", key: "0", value: "10" }], [{ type: "setVoucher", key: "0", value: 8 }, { type: "setVoucher", key: "0", value: 9 }]]) {
    const fixture = accountFixture();
    const response = await pokeroguePageCommand({ command: "account-preview", payload: { operations } });
    assert.equal(response.ok, false);
    assert.equal(fixture.saves(), 0);
    assert.equal(fixture.scene.gameData.voucherCounts[0], 2);
  }
});

test("account CAS rejects a stale preview without overwriting subsequent legitimate changes", async () => {
  const fixture = accountFixture(); const operations = [{ type: "setVoucher", key: "0", value: 300 }];
  const preview = await pokeroguePageCommand({ command: "account-preview", payload: { operations } });
  fixture.scene.gameData.voucherCounts[1] = 9;
  const result = await pokeroguePageCommand({ command: "account-commit", payload: { txId: "account-stale-0001", operations, expectedSystem: preview.expectedSystem } });
  assert.equal(result.code, "STALE"); assert.equal(fixture.saves(), 0);
  assert.equal(fixture.scene.gameData.voucherCounts[1], 9);
});

test("collection save tolerates the official timer before and during persistence, retaining elapsed time", async () => {
  const fixture = accountFixture();
  fixture.scene.gameData.gameStats.playTime = 100;
  const operations = [{ type: "unlockStarter", speciesId: 1, shiny: "2", natures: [15], abilities: [2] }];
  const preview = await pokeroguePageCommand({ command: "account-preview", payload: { operations } });
  fixture.scene.gameData.gameStats.playTime += 3;
  const originalSave = fixture.scene.gameData.saveSystem;
  fixture.scene.gameData.saveSystem = async () => {
    await Promise.resolve();
    fixture.scene.gameData.gameStats.playTime += 2;
    return originalSave();
  };
  const result = await pokeroguePageCommand({ command: "account-commit", payload: {
    txId: "account-timer-0001", operations, expectedSystem: preview.expectedSystem,
  } });
  assert.equal(result.code, "VERIFIED", result.message);
  assert.equal(fixture.saves(), 1);
  assert.equal(fixture.scene.gameData.dexData[1].caughtAttr, 198n);
  assert.equal(fixture.scene.gameData.gameStats.playTime, 105);
  assert.equal(result.afterSystem.gameStats.playTime, 105);
  assert.equal(preview.expectedSystem.gameStats.playTime, 100);
});

test("collection timer tolerance still rejects competing collection and statistic edits", async () => {
  for (const change of [
    data => { data.dexData[2].natureAttr = 4; },
    data => { data.starterData[2].abilityAttr = 4; },
    data => { data.gameStats.eggsPulled += 1; },
  ]) {
    const fixture = accountFixture(); fixture.scene.gameData.gameStats.playTime = 100;
    const operations = [{ type: "unlockStarter", speciesId: 1 }];
    const preview = await pokeroguePageCommand({ command: "account-preview", payload: { operations } });
    fixture.scene.gameData.gameStats.playTime += 1; change(fixture.scene.gameData);
    const result = await pokeroguePageCommand({ command: "account-commit", payload: {
      txId: "account-timer-stale", operations, expectedSystem: preview.expectedSystem,
    } });
    assert.equal(result.code, "STALE"); assert.equal(fixture.saves(), 0);
    assert.equal(fixture.scene.gameData.dexData[1].caughtAttr, 0n);
    assert.equal(result.diagnostics.stage, "account-cas");
    assert.equal(result.diagnostics.mismatchCount, 1);
    assert.equal(result.diagnostics.fields.length, 1);
    assert.match(result.diagnostics.fields[0].path, /^account\.(dexData\.field\.natureAttr|starterData\.field\.abilityAttr|gameStats\.eggsPulled)$/);
    assert.deepEqual(Object.keys(result.diagnostics.fields[0]).sort(), ["kind", "path"]);
  }
});

test("account diagnostics reach differences in a large collection without exposing IDs or values", async () => {
  const fixture = accountFixture(); const data = fixture.scene.gameData;
  for (let id = 10; id < 1094; id++) data.dexData[id] = {
    seenAttr: 0n, caughtAttr: 0n, seenCount: 0, caughtCount: 0, natureAttr: 2, ivs: [1, 2, 3, 4, 5, 6],
  };
  const operations = [{ type: "setVoucher", key: "0", value: 300 }];
  const preview = await pokeroguePageCommand({ command: "account-preview", payload: { operations } });
  data.dexData[1093].caughtAttr = 198n;
  const result = await pokeroguePageCommand({ command: "account-commit", payload: {
    txId: "account-large-diagnostics", operations, expectedSystem: preview.expectedSystem,
  } });
  assert.equal(result.code, "STALE"); assert.equal(fixture.saves(), 0);
  assert.equal(result.diagnostics.truncated, false);
  assert.deepEqual(result.diagnostics.fields, [{ path: "account.dexData.field.caughtAttr", kind: "value" }]);
  assert.doesNotMatch(JSON.stringify(result.diagnostics), /1093|198|测试物种|trainerId|secretId/);
});

test("real account changes during an awaited save still produce uncertainty", async () => {
  const fixture = accountFixture(); const originalSave = fixture.scene.gameData.saveSystem;
  fixture.scene.gameData.saveSystem = async () => {
    fixture.scene.gameData.gameStats.playTime = 123;
    fixture.scene.gameData.voucherCounts[1] = 99;
    return originalSave();
  };
  const { result } = await accountCommit([{ type: "unlockStarter", speciesId: 1 }]);
  assert.equal(result.code, "UNCERTAIN"); assert.equal(fixture.saves(), 1);
  assert.equal(fixture.scene.gameData.gameStats.playTime, 123);
  assert.equal(fixture.scene.gameData.voucherCounts[1], 99, "a competing update must never be rolled back");
  assert.equal(fixture.cache.get("data_demo"), "updated-encrypted-cache");
  assert.equal(fixture.scene.input.enabled, true);
});

test("failed account saves restore runtime and encrypted local cache but mark server result uncertain", async () => {
  for (const save of ["false", "throw"]) {
    const fixture = accountFixture({ save }); const before = fixture.snapshot();
    const { result } = await accountCommit([{ type: "unlockStarter", speciesId: 1, shiny: "2" }]);
    assert.equal(result.code, "UNCERTAIN", result.message);
    assert.deepEqual(fixture.snapshot(), before);
    assert.equal(fixture.cache.get("data_demo"), "original-encrypted-cache");
    assert.equal(fixture.cache.get("unrelated"), "keep");
    assert.equal(fixture.scene.input.enabled, true);
  }
});

test("account reinitialization during save is never overwritten by old account rollback", async () => {
  const fixture = accountFixture({ save: "replace" });
  const { result } = await accountCommit([{ type: "setVoucher", key: "0", value: 300 }]);
  assert.equal(result.code, "UNCERTAIN");
  assert.equal(fixture.scene.gameData.voucherCounts[0], 99);
});

test("same-instance official account reinitialization preserves refreshed data and cache", async () => {
  for (const operation of [
    { type: "setVoucher", key: "0", value: 300 },
    { type: "unlockStarter", speciesId: 1, shiny: "2" },
    { type: "addLegendaryEggs", source: "shiny", count: 2 },
  ]) {
    const fixture = accountFixture(); const data = fixture.scene.gameData;
    let saves = 0; let refreshed;
    data.saveSystem = async () => {
      saves++;
      data.starterData = { ...data.starterData, 1: { ...data.starterData[1], candyCount: 27 } };
      data.dexData[1] = { ...data.dexData[1], caughtAttr: 149n, seenAttr: 149n };
      data.eggs = [{ id: 987, tier: 3, hatchWaves: 80 }];
      data.eggPity = [0, 7, 8, 9]; data.unlockPity = [0, 4, 5, 6];
      data.gameStats = { eggsPulled: 50, legendaryEggsPulled: 5 };
      data.voucherCounts[0] = 99;
      fixture.cache.set("data_demo", "refreshed-encrypted-cache");
      refreshed = fixture.snapshot();
      return false;
    };
    const { result } = await accountCommit([operation]);
    assert.equal(result.code, "UNCERTAIN"); assert.equal(result.status, "uncertain");
    assert.equal(fixture.scene.gameData, data, "the official path does not replace GameData");
    assert.deepEqual(fixture.snapshot(), refreshed);
    assert.equal(fixture.cache.get("data_demo"), "refreshed-encrypted-cache");
    assert.equal(fixture.cache.get("unrelated"), "keep");
    assert.equal(fixture.scene.input.enabled, true); assert.equal(saves, 1);
  }
});

test("account phase changes preserve the current state instead of restoring stale data", async () => {
  for (const operation of [{ type: "setVoucher", key: "0", value: 300 },
    { type: "addLegendaryEggs", source: "shiny", count: 2 }]) {
    const fixture = accountFixture({ save: "turn" });
    const { result } = await accountCommit([operation]);
    assert.equal(result.code, "UNCERTAIN");
    assert.equal(fixture.scene.currentBattle.turn, 4);
    assert.equal(fixture.cache.get("data_demo"), "updated-encrypted-cache");
    assert.equal(fixture.scene.input.enabled, true);
  }
});

test("egg saves reject competing in-place account edits without overwriting them", async () => {
  const fixture = accountFixture(); const save = fixture.scene.gameData.saveSystem;
  fixture.scene.gameData.saveSystem = async () => {
    fixture.scene.gameData.voucherCounts[1] = 99;
    return save();
  };
  const { result } = await accountCommit([{ type: "addLegendaryEggs", source: "shiny", count: 1 }]);
  assert.equal(result.code, "UNCERTAIN");
  assert.equal(fixture.scene.gameData.voucherCounts[1], 99);
  assert.equal(fixture.cache.get("data_demo"), "updated-encrypted-cache");
  assert.equal(fixture.scene.input.enabled, true);
});

test("reinitialization to equal values is still detected through replaced containers", async () => {
  const fixture = accountFixture();
  fixture.scene.gameData.saveSystem = async () => {
    fixture.scene.gameData.eggs = fixture.scene.gameData.eggs.slice();
    fixture.cache.set("data_demo", "refreshed-encrypted-cache");
    return false;
  };
  const { result } = await accountCommit([{ type: "setVoucher", key: "0", value: 300 }]);
  assert.equal(result.code, "UNCERTAIN");
  assert.equal(fixture.scene.gameData.voucherCounts[0], 300);
  assert.equal(fixture.cache.get("data_demo"), "refreshed-encrypted-cache");
});

test("successful account egg saves return the version and authoritative JSON required by the background", async () => {
  const fixture = accountFixture();
  const { result } = await accountCommit([{ type: "addLegendaryEggs", source: "shiny", count: 2 }]);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.code, "VERIFIED");
  assert.equal(result.status, "verified");
  assert.equal(result.adapterVersion, "1.0.0");
  assert.deepEqual(JSON.parse(result.afterSystemJson), result.afterSystem);
  assert.equal(result.afterSystem.eggs.length, 2);
  assert.equal(fixture.saves(), 1);
});

test("account egg saves retain unknown contents and restore cache on failed persistence", async () => {
  const fixture = accountFixture({ save: "false" }); const before = fixture.snapshot();
  const { result } = await accountCommit([{ type: "addLegendaryEggs", source: "shiny", count: 2 }]);
  assert.equal(result.code, "UNCERTAIN");
  assert.deepEqual(fixture.snapshot(), before);
  assert.equal(fixture.cache.get("data_demo"), "original-encrypted-cache");
});

test("item catalog uses only supported official factories and identifies held items", async () => {
  itemFixture();
  const result = await pokeroguePageCommand({ command: "item-catalog" });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.items.map(row => [row.id, row.held]), [["SHINY_CHARM", false], ["LEFTOVERS", true]]);
  assert.deepEqual(result.items[0].limits, [{ pokemonId: null, currentStackCount: 0, maxStackCount: 4, virtualStackCount: 0, remaining: 4, modifierFingerprint: null }]);
  assert.deepEqual(result.items[1].limits.map(row => row.pokemonId), [11, 22]);
});

test("item catalog reads live caps and separate owner stacks including virtual stacks", async () => {
  const fixture = itemFixture();
  const lookup = window.__ROGUESAVE_GAME_EXPORTS_V1__.itemLookup;
  const charm = lookup("SHINY_CHARM")().newModifier(); charm.stackCount = 2; charm.virtualStackCount = 1;
  const held = lookup("LEFTOVERS")().newModifier(fixture.party[0]); held.stackCount = 4;
  fixture.scene.modifiers.push(charm, held);
  const result = await pokeroguePageCommand({ command: "item-catalog" });
  assert.equal(result.ok, true, result.message);
  const limit = result.items[0].limits[0];
  assert.equal(limit.maxStackCount, 4); assert.equal(limit.currentStackCount, 2); assert.equal(limit.virtualStackCount, 1); assert.equal(limit.remaining, 1);
  const inspection = await pokeroguePageCommand({ command: "inspect" });
  assert.equal(limit.modifierFingerprint, inspection.model.modifiers[1].fingerprint);
  assert.deepEqual(result.items[1].limits.map(row => [row.currentStackCount, row.remaining]), [[4, 0], [0, 4]]);
  charm.getMaxStackCount = () => 8;
  const updated = await pokeroguePageCommand({ command: "item-catalog" });
  assert.equal(updated.items[0].limits[0].maxStackCount, 8);
  assert.equal(updated.items[0].limits[0].remaining, 5);
});

test("catalog uses each owner's official cap and save rechecks caps changed after loading", async () => {
  const fixture = itemFixture();
  const lookup = window.__ROGUESAVE_GAME_EXPORTS_V1__.itemLookup;
  let charmCap = 4;
  window.__ROGUESAVE_GAME_EXPORTS_V1__.itemLookup = id => {
    const factory = lookup(id); if (!factory) return null;
    return () => { const type = factory(); const make = type.newModifier;
      type.newModifier = pokemon => { const modifier = make(pokemon);
        modifier.getMaxStackCount = () => id === "SHINY_CHARM" ? charmCap : pokemon.id === 11 ? 2 : 4;
        return modifier; }; return type; };
  };
  const catalog = await pokeroguePageCommand({ command: "item-catalog" });
  assert.deepEqual(catalog.items[1].limits.map(row => row.maxStackCount), [2, 4]);
  assert.equal(catalog.items[0].limits[0].maxStackCount, 4);
  const before = await pokeroguePageCommand({ command: "inspect" });
  charmCap = 1;
  const response = await pokeroguePageCommand({ command: "commit", payload: { txId: "item-cap-changed", expectedHash: before.model.hash,
    expectedBackendHash: before.model.backendHash, operations: [{ type: "addModifier", itemId: "SHINY_CHARM", count: 2 }] } });
  assert.equal(response.ok, false); assert.equal(fixture.getSaveCalls(), 0);
});

test("money above one billion and the official safe-integer cap save and undo exactly", async () => {
  for (const value of [5_000_000_000, Number.MAX_SAFE_INTEGER]) {
    const fixture = makeScene(); bindScene(fixture.scene);
    fixture.scene.money = 3_647_274_539;
    await fixture.scene.gameData.saveAll();
    const before = await pokeroguePageCommand({ command: "inspect" });
    const operations = [{ type: "setMoney", value }];
    const saved = await pokeroguePageCommand({ command: "commit", payload: { txId: "endless-money-save", expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash, operations } });
    assert.equal(saved.ok, true, saved.message);
    assert.equal(fixture.getPersisted().money, value);
    const undone = await pokeroguePageCommand({ command: "undo", payload: { txId: "endless-money-undo", expectedHash: saved.afterHash,
      expectedBackendHash: saved.afterBackendHash, beforeSession: before.backup.session, expectedBeforeFullHash: before.backup.fullHash, targetOperations: operations } });
    assert.equal(undone.ok, true, undone.message);
    assert.equal(fixture.getPersisted().money, 3_647_274_539);
  }
});

test("unsafe money integers are rejected before save", async () => {
  const fixture = makeScene(); bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({ command: "commit", payload: { txId: "invalid-money-save", expectedHash: before.model.hash,
    expectedBackendHash: before.model.backendHash, operations: [{ type: "setMoney", value: Number.MAX_SAFE_INTEGER + 1 }] } });
  assert.equal(result.ok, false);
  assert.equal(fixture.getSaveCalls(), 0);
});

test("new team and held modifiers persist through the existing run transaction and undo exactly", async () => {
  for (const operation of [{ type: "addModifier", itemId: "SHINY_CHARM", count: 2 }, { type: "addModifier", itemId: "LEFTOVERS", pokemonId: 11, count: 1 }]) {
    const fixture = itemFixture();
    const before = await pokeroguePageCommand({ command: "inspect" });
    const result = await pokeroguePageCommand({ command: "commit", payload: { txId: "item-commit-0001", expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash, operations: [operation] } });
    assert.equal(result.ok, true, result.message);
    assert.equal(fixture.getPersisted().modifiers.length, 2);
    assert.equal(fixture.getPersisted().modifiers[1].stackCount, operation.count);
    assert.deepEqual(fixture.getPersisted().modifiers[1].args, operation.pokemonId ? [11] : []);
    const undo = await pokeroguePageCommand({ command: "undo", payload: { txId: "item-undo-0001", expectedHash: result.afterHash,
      expectedBackendHash: result.afterBackendHash, beforeSession: before.backup.session, expectedBeforeFullHash: before.backup.fullHash,
      targetOperations: [operation] } });
    assert.equal(undo.ok, true, undo.message);
    assert.deepEqual(fixture.getPersisted().modifiers, before.backup.session.modifiers);
    assert.equal(fixture.scene.modifiers.length, 1);
  }
});

test("adding an existing item merges its stack and never duplicates the modifier", async () => {
  const fixture = itemFixture();
  const type = window.__ROGUESAVE_GAME_EXPORTS_V1__.itemLookup("SHINY_CHARM")();
  fixture.scene.modifiers.push(type.newModifier());
  await fixture.scene.gameData.saveAll();
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({ command: "commit", payload: { txId: "item-merge-0001", expectedHash: before.model.hash,
    expectedBackendHash: before.model.backendHash, operations: [{ type: "addModifier", itemId: "SHINY_CHARM", count: 2 }] } });
  assert.equal(result.ok, true, result.message);
  assert.equal(fixture.scene.modifiers.length, 2);
  assert.equal(fixture.scene.modifiers[1].stackCount, 3);
});

test("lowering a stack then adding the same item validates the planned total", async () => {
  const fixture = itemFixture();
  const charm = window.__ROGUESAVE_GAME_EXPORTS_V1__.itemLookup("SHINY_CHARM")().newModifier();
  charm.stackCount = 2; fixture.scene.modifiers.push(charm); await fixture.scene.gameData.saveAll();
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({ command: "commit", payload: { txId: "item-edited-merge", expectedHash: before.model.hash,
    expectedBackendHash: before.model.backendHash, operations: [
      { type: "setModifierStack", fingerprint: before.model.modifiers[1].fingerprint, value: 1 },
      { type: "addModifier", itemId: "SHINY_CHARM", count: 3 },
    ] } });
  assert.equal(result.ok, true, result.message); assert.equal(charm.stackCount, 4);
  assert.equal(fixture.getPersisted().modifiers[1].stackCount, 4);
});

test("adding more than 99 layers is supported only when the official live cap permits it", async () => {
  const fixture = itemFixture();
  const lookup = window.__ROGUESAVE_GAME_EXPORTS_V1__.itemLookup;
  window.__ROGUESAVE_GAME_EXPORTS_V1__.itemLookup = id => {
    const factory = lookup(id); if (!factory) return null;
    return () => { const type = factory(); const make = type.newModifier;
      type.newModifier = pokemon => { const modifier = make(pokemon); modifier.getMaxStackCount = () => 200; return modifier; }; return type; };
  };
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({ command: "commit", payload: { txId: "item-large-count", expectedHash: before.model.hash,
    expectedBackendHash: before.model.backendHash, operations: [{ type: "addModifier", itemId: "SHINY_CHARM", count: 150 }] } });
  assert.equal(result.ok, true, result.message); assert.equal(fixture.getPersisted().modifiers[1].stackCount, 150);
});

test("item overflow, missing owners and unsupported item IDs never reach persistence", async () => {
  for (const operation of [{ type: "addModifier", itemId: "SHINY_CHARM", count: 5 }, { type: "addModifier", itemId: "LEFTOVERS", pokemonId: 999, count: 1 }, { type: "addModifier", itemId: "UNKNOWN", count: 1 }]) {
    const fixture = itemFixture(); const before = await pokeroguePageCommand({ command: "inspect" });
    const response = await pokeroguePageCommand({ command: "commit", payload: { txId: "item-invalid-0001", expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash, operations: [operation] } });
    assert.equal(response.ok, false);
    assert.equal(fixture.getSaveCalls(), 0);
    assert.equal(fixture.scene.modifiers.length, 1);
  }
});

test("new item rollback removes the added runtime object when unrelated live state changes", async () => {
  const fixture = itemFixture({ refreshMutation: "score" });
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({ command: "commit", payload: { txId: "item-rollback-0001", expectedHash: before.model.hash,
    expectedBackendHash: before.model.backendHash, operations: [{ type: "addModifier", itemId: "SHINY_CHARM", count: 1 }, { type: "setMoney", value: 300000 }] } });
  assert.equal(result.ok, false);
  assert.equal(fixture.scene.modifiers.length, 1);
  assert.equal(fixture.scene.money, 12345);
  assert.equal(fixture.getSaveCalls(), 0);
});

test("the Pokémon fixture models resetStatus's queued-by-default semantics", () => {
  const fixture = makeScene();
  const pokemon = fixture.party[0];
  const originalStatus = clone(pokemon.status);

  pokemon.resetStatus();
  assert.deepEqual(pokemon.status, originalStatus);
  assert.deepEqual(pokemon.queuedResetStatusPhases, [{ confusion: false, reloadAssets: false }]);

  pokemon.resetStatus(true, false, false, false);
  assert.equal(pokemon.status, null);
});

test("a fresh page discovers the live scene from the current shared module", async () => {
  const fixture = makeScene();
  // The entry is served by the fetch stub; its imported scene fixture is a real file.
  const entryUrl = new URL("./fixtures/assets/index-test.js", import.meta.url);
  globalThis.__ROGUESAVE_AUTODISCOVERY_SCENE__ = fixture.scene;
  globalThis.window = {};
  globalThis.location = new URL("./fixtures/assets/game.html", import.meta.url);
  globalThis.document = {
    querySelectorAll(selector) {
      assert.equal(selector, 'script[type="module"][src]');
      return [{ src: entryUrl.href }];
    },
  };
  globalThis.fetch = async url => {
    assert.equal(url, entryUrl.href);
    return {
      ok: true,
      status: 200,
      text: async () => 'import "./FadeOut-fixture.js";',
    };
  };

  const result = await pokeroguePageCommand({ command: "inspect" });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.model.run.waveIndex, 188);
  assert.equal(globalThis.window[SCENE_CACHE_KEY], fixture.scene);
});

test("inspect dynamically accepts wave 1, 188, and 1000", async () => {
  for (const waveIndex of [1, 188, 1000]) {
    const fixture = makeScene({ waveIndex });
    bindScene(fixture.scene);
    const result = await pokeroguePageCommand({ command: "inspect" });
    assert.equal(result.ok, true);
    assert.equal(result.model.readOnly, false);
    assert.equal(result.model.run.waveIndex, waveIndex);
    assert.equal(result.model.run.displaySlot, 1);
    assert.equal(result.model.run.name, "第一存档");
  }
});

test("current game version 1.12.0.11 is writable", async () => {
  const fixture = makeScene({ gameVersion: "1.12.0.11" });
  bindScene(fixture.scene);
  const result = await pokeroguePageCommand({ command: "inspect" });
  assert.equal(result.ok, true);
  assert.equal(result.model.readOnly, false, result.model.readOnlyReason);
});

test("future game version fails closed in read-only mode", async () => {
  const fixture = makeScene({ gameVersion: "1.12.0.12" });
  bindScene(fixture.scene);
  const result = await pokeroguePageCommand({ command: "inspect" });
  assert.equal(result.ok, true);
  assert.equal(result.model.readOnly, true);
  assert.match(result.model.readOnlyReason, /尚未验证/);
});

test("writes are allowed only during a stable CommandPhase", async () => {
  const fixture = makeScene({ phaseName: "TurnEndPhase" });
  bindScene(fixture.scene);
  const result = await pokeroguePageCommand({ command: "inspect" });
  assert.equal(result.ok, true);
  assert.equal(result.model.readOnly, true);
  assert.match(result.model.readOnlyReason, /TurnEndPhase/);
});

test("writes stay read-only while the command-phase input is disabled", async () => {
  const fixture = makeScene();
  fixture.scene.input.enabled = false;
  bindScene(fixture.scene);
  const result = await pokeroguePageCommand({ command: "inspect" });
  assert.equal(result.ok, true);
  assert.equal(result.model.readOnly, true);
  assert.match(result.model.readOnlyReason, /输入尚未启用/);
});

test("an existing ResetStatusPhase makes inspect read-only and blocks commit", async () => {
  const fixture = makeScene();
  fixture.scene.phaseManager.hasPhaseOfType = phaseType => phaseType === "ResetStatusPhase";
  bindScene(fixture.scene);
  const originalMoney = fixture.scene.money;
  const before = await pokeroguePageCommand({ command: "inspect" });

  assert.equal(before.ok, true);
  assert.equal(before.model.readOnly, true);
  assert.match(before.model.readOnlyReason, /待执行的异常状态恢复阶段/);

  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-queued-reset-phase-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "READ_ONLY");
  assert.equal(fixture.scene.money, originalMoney);
  assert.equal(fixture.getSaveCalls(), 0);
});

test("a missing ResetStatusPhase inspection API fails closed", async () => {
  const fixture = makeScene();
  fixture.scene.phaseManager.hasPhaseOfType = undefined;
  bindScene(fixture.scene);
  const result = await pokeroguePageCommand({ command: "inspect" });

  assert.equal(result.ok, true);
  assert.equal(result.model.readOnly, true);
  assert.match(result.model.readOnlyReason, /无法确认异常状态恢复阶段队列为空/);
  assert.equal(fixture.getSaveCalls(), 0);
});

test("a ResetStatusPhase appearing during save prevents a VERIFIED result", async () => {
  const fixture = makeScene();
  let resetPhaseQueued = false;
  fixture.scene.phaseManager.hasPhaseOfType = phaseType => (
    phaseType === "ResetStatusPhase" && resetPhaseQueued
  );
  const saveAll = fixture.scene.gameData.saveAll;
  fixture.scene.gameData.saveAll = async (...args) => {
    const result = await saveAll(...args);
    resetPhaseQueued = true;
    return result;
  };
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  assert.equal(before.model.readOnly, false);

  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-reset-phase-during-save-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "uncertain");
  assert.notEqual(result.code, "VERIFIED");
  assert.equal(fixture.getSaveCalls(), 1);
  assert.equal(fixture.getPersisted().money, 300000);
});

test("commit saves money, balls, healing, and preserves the run name", async () => {
  const fixture = makeScene();
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-commit-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [
        { type: "setMoney", value: 300000 },
        { type: "setBallCount", key: "4", value: 99 },
        { type: "healParty", hp: true, status: true, pp: true },
      ],
    },
  });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.status, "verified");
  assert.equal(fixture.scene.money, 300000);
  assert.equal(fixture.scene.pokeballCounts[4], 99);
  for (const pokemon of fixture.party) {
    assert.equal(pokemon.hp, pokemon.getMaxHp());
    assert.equal(pokemon.status, null);
    assert.ok(pokemon.moveset.every(move => move.ppUsed === 0));
  }
  assert.ok(fixture.party[0].resetStatusCalls.length >= 1);
  assertNoQueuedStatusReset(fixture.party);
  const persisted = fixture.getPersisted();
  assert.equal(persisted.money, 300000);
  assert.equal(persisted.pokeballCounts[4], 99);
  assert.equal(persisted.name, "第一存档");
  assert.equal(persisted.waveIndex, 188);
  assert.equal(persisted.seed, "wave-independent-seed");
  assert.equal(fixture.getSaveCalls(), 1);
  assert.equal(fixture.getRenameCalls(), 1);
});

test("a preview becomes stale after advancing to another wave", async () => {
  const fixture = makeScene({ waveIndex: 188 });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  fixture.scene.currentBattle.waveIndex = 189;
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-stale-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "STALE");
  assert.equal(fixture.scene.money, 12345);
  assert.equal(fixture.getSaveCalls(), 0);
});

test("a false save result stays uncertain because saveAll may already have touched persistence", async () => {
  const fixture = makeScene({ saveMode: "false-before" });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-failed-save-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [
        { type: "setMoney", value: 300000 },
        { type: "healParty", hp: true, status: true, pp: true },
      ],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "uncertain");
  assert.match(result.message, /保存流程已经启动/);
  assert.equal(fixture.scene.money, 300000);
  assert.equal(fixture.party[0].hp, fixture.party[0].getMaxHp());
  assert.equal(fixture.party[0].status, null);
  assert.deepEqual(fixture.party[0].moveset.map(move => move.ppUsed), [0, 0]);
  assert.equal(fixture.getPersisted().money, 12345);
});

test("protected modifier edits are rejected and rolled back", async () => {
  const fixture = makeScene({ includeProtectedModifier: true });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const protectedRow = before.model.modifiers.find(row => !row.editable);
  assert.ok(protectedRow);
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-protected-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setModifierStack", fingerprint: protectedRow.fingerprint, value: 2 }],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "APPLY_FAILED");
  assert.equal(fixture.modifiers[1].stackCount, 1);
  assert.equal(fixture.getSaveCalls(), 0);
});

test("same-length modifier order mismatch disables every ambiguous row", async () => {
  const fixture = makeScene({ includeProtectedModifier: true, modifierOrderMismatch: true });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  assert.ok(before.model.modifiers.every(row => !row.editable));
  assert.ok(before.model.modifiers.some(row => /一一对应/.test(row.readOnlyReason)));
  const row = before.model.modifiers[0];
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-modifier-order-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setModifierStack", fingerprint: row.fingerprint, value: row.stackCount + 1 }],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "APPLY_FAILED");
  assert.equal(fixture.getSaveCalls(), 0);
});

test("a proven runtime modifier mapping can change only its existing stack", async () => {
  const fixture = makeScene();
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const row = before.model.modifiers[0];
  assert.equal(row.editable, true);
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-safe-modifier-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setModifierStack", fingerprint: row.fingerprint, value: 5 }],
    },
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(fixture.modifiers[0].stackCount, 5);
  assert.equal(fixture.getPersisted().modifiers[0].stackCount, 5);
});

test("parser normalization that rewrites the requested modifier stack is rejected before save", async () => {
  const fixture = makeScene({ parserRewritesModifierStack: true });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const row = before.model.modifiers[0];
  const originalRuntimeStack = fixture.modifiers[0].stackCount;
  const originalPersisted = fixture.getPersisted();

  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-parser-rewrites-target-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setModifierStack", fingerprint: row.fingerprint, value: 5 }],
    },
  });

  assert.equal(result.ok, false);
  assert.notEqual(result.code, "VERIFIED");
  assert.equal(fixture.getSaveCalls(), 0);
  assert.equal(fixture.modifiers[0].stackCount, originalRuntimeStack);
  assert.deepEqual(fixture.getPersisted(), originalPersisted);
});

test("persisted full readback uses the game's deterministic session parser", async () => {
  const fixture = makeScene({ persistedNormalization: true });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const callsAfterInspect = fixture.getParseSessionCalls();
  assert.ok(callsAfterInspect >= 1);

  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-persisted-normalization-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.status, "verified");
  assert.ok(fixture.getParseSessionCalls() > callsAfterInspect);
  assert.equal(fixture.getPersisted().money, 300000);
  assert.deepEqual(fixture.getPersisted().arena.playerTerasUsed, []);
  assert.deepEqual(fixture.getPersisted().party[0].usedTMs, []);
});

test("every getSession-backed inspection traverses parseSessionData", async () => {
  const fixture = makeScene();
  bindScene(fixture.scene);
  const callsBefore = fixture.getParseSessionCalls();
  const first = await pokeroguePageCommand({ command: "inspect" });
  const callsAfterFirst = fixture.getParseSessionCalls();
  const second = await pokeroguePageCommand({ command: "inspect" });
  const callsAfterSecond = fixture.getParseSessionCalls();

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.ok(callsAfterFirst > callsBefore);
  assert.ok(callsAfterSecond > callsAfterFirst);
});

test("throwing or structurally invalid session parsers cannot leave inspection writable", async () => {
  for (const parserBehavior of ["throw", "invalid-object"]) {
    const fixture = makeScene({ parserBehavior });
    bindScene(fixture.scene);
    const result = await pokeroguePageCommand({ command: "inspect" });
    const rejected = result.ok === false;
    const readOnly = result.ok === true && result.model?.readOnly === true;
    assert.ok(rejected || readOnly, `${parserBehavior} parser result must be rejected or read-only`);
    assert.ok(fixture.getParseSessionCalls() >= 1);
  }
});

test("persisted normalization never relaxes the strict live-session whitelist", async () => {
  const fixture = makeScene({
    persistedNormalization: true,
    refreshMutation: "normalizable-live-type",
  });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-live-remains-strict-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "uncertain");
  assert.equal(fixture.getSaveCalls(), 0);
  assertBoundedRedactedDiagnosticsIfPresent(result);
});

test("an unrelated HP change during setMoney is detected before save", async () => {
  const fixture = makeScene({ refreshMutation: "hp" });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-concurrent-hp-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "uncertain");
  assertBoundedRedactedDiagnosticsIfPresent(result);
  assert.ok(result.diagnostics?.fields.some(field => field.path === "session.party[0].hp"));
  assert.equal(fixture.getSaveCalls(), 0);
  assert.equal(fixture.scene.money, 12345);
});

test("a non-editable score change is never hidden by the whitelist", async () => {
  const fixture = makeScene({ refreshMutation: "score" });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-protected-diff-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "uncertain");
  assertBoundedRedactedDiagnosticsIfPresent(result);
  assert.ok(result.diagnostics?.fields.some(field => field.path === "session.score"));
  assert.equal(fixture.getSaveCalls(), 0);
});

test("parser normalization cannot conditionally rewrite an unselected protected field", async () => {
  const fixture = makeScene({ parserConditionallyRewritesScore: true });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-parser-protected-transition-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "UNEXPECTED_DIFF");
  assert.match(result.message, /解析器.*白名单之外/);
  assert.equal(result.diagnostics?.stage, "persist-normalization");
  assert.ok(result.diagnostics?.fields.some(field => field.path === "session.score"));
  assert.equal(fixture.scene.money, 12345);
  assert.equal(fixture.scene.score, 6789);
  assert.equal(fixture.getSaveCalls(), 0);
});

test("parser normalization cannot rewrite an authorized modifier stat side effect", async () => {
  const fixture = makeScene({
    modifierChangesStats: true,
    parserConditionallyRewritesModifierStat: true,
  });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const row = before.model.modifiers[0];
  const originalStat = fixture.party[0].stats[1];
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-parser-modifier-stat-transition-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setModifierStack", fingerprint: row.fingerprint, value: 5 }],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "UNEXPECTED_DIFF");
  assert.match(result.message, /解析器.*授权变化字段/);
  assert.equal(fixture.modifiers[0].stackCount, 2);
  assert.equal(fixture.party[0].stats[1], originalStat);
  assert.equal(fixture.getSaveCalls(), 0);
});

test("dynamic object keys are redacted while schema paths remain readable", async () => {
  const fixture = makeScene({ refreshMutation: "dynamic-diagnostic-keys" });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-redacted-dynamic-keys-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "uncertain");
  assertBoundedRedactedDiagnosticsIfPresent(result);
  const exposed = JSON.stringify({ message: result.message, diagnostics: result.diagnostics });
  for (const sensitiveKey of ["ASeed9f8e7d6c", "123456", "diagnosticMap"]) {
    assert.doesNotMatch(exposed, new RegExp(sensitiveKey));
  }
  assert.ok(result.diagnostics?.fields.every(field => field.path.startsWith("session.field")));
  assert.equal(fixture.getSaveCalls(), 0);
});

test("field-level mismatch diagnostics stay bounded and redacted when exposed", async () => {
  const fixture = makeScene({ refreshMutation: "many-protected-fields" });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-bounded-diagnostics-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "uncertain");
  assertBoundedRedactedDiagnosticsIfPresent(result);
  if (result.diagnostics) {
    assert.ok(result.diagnostics.mismatchCount > result.diagnostics.fields.length);
    assert.equal(result.diagnostics.truncated, true);
  }
  assert.equal(fixture.getSaveCalls(), 0);
});

test("the local persistence-cache guard rejects a stale second-tab snapshot", async () => {
  const fixture = makeScene();
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  fixture.mutatePersisted(session => { session.score += 1; });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-backend-stale-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "BACKEND_STALE");
  assert.equal(fixture.getSaveCalls(), 0);
});

test("a target-field change during locked inspection is detected before mutation", async () => {
  for (const mode of ["locked-money", "locked-hp"]) {
    const fixture = makeScene({ getSessionMutation: mode });
    bindScene(fixture.scene);
    const before = await pokeroguePageCommand({ command: "inspect" });
    const result = await pokeroguePageCommand({
      command: "commit",
      payload: {
        txId: `test-locked-inspection-${mode}-0001`,
        expectedHash: before.model.hash,
        expectedBackendHash: before.model.backendHash,
        operations: mode === "locked-money"
          ? [{ type: "setMoney", value: 300000 }]
          : [{ type: "healParty", hp: true, status: false, pp: false }],
      },
    });
    assert.equal(result.ok, false, mode);
    assert.equal(result.code, "STALE", mode);
    assert.equal(fixture.getSaveCalls(), 0, mode);
  }
});

test("the final live CAS prevents an unauthorized pre-save change from being persisted", async () => {
  const fixture = makeScene({ getSessionMutation: "pre-save-score" });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-pre-save-live-cas-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });

  assert.equal(result.ok, false);
  assert.notEqual(result.code, "VERIFIED");
  assert.equal(fixture.getSaveCalls(), 0);
  assert.equal(fixture.getPersisted().money, 12345);
});

test("save success followed by readback failure is classified uncertain", async () => {
  const fixture = makeScene({ readbackThrowsAfterSave: true });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-readback-failure-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "uncertain");
  assert.equal(fixture.getSaveCalls(), 1);
  assert.equal(fixture.scene.money, 300000);
});

test("a cache mutation hidden behind the first post-save snapshot cannot be VERIFIED", async () => {
  const fixture = makeScene({ getSessionMutation: "post-save-cache-after-first" });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-post-save-terminal-cache-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "uncertain");
  assert.notEqual(result.code, "VERIFIED");
  assert.equal(fixture.getPersisted().score, 6790);
});

test("a turn change during save prevents VERIFIED even when serialized data is unchanged", async () => {
  const fixture = makeScene({ turnChangesDuringSave: true });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-turn-change-during-save-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "uncertain");
  assert.match(result.message, /回合|战斗阶段/);
});

test("post-save live-read, rename, and false-return failures remain uncertain when backend changed", async () => {
  const cases = [
    { label: "live-read", options: { liveReadbackThrowsAfterSave: true } },
    { label: "rename-false", options: { saveMode: "rename-false" } },
    { label: "rename-throw", options: { saveMode: "rename-throw" } },
    { label: "save-false-after", options: { saveMode: "false-after" } },
  ];

  for (const scenario of cases) {
    const fixture = makeScene(scenario.options);
    bindScene(fixture.scene);
    const before = await pokeroguePageCommand({ command: "inspect" });
    const result = await pokeroguePageCommand({
      command: "commit",
      payload: {
        txId: `test-post-save-${scenario.label}-0001`,
        expectedHash: before.model.hash,
        expectedBackendHash: before.model.backendHash,
        operations: [{ type: "setMoney", value: 300000 }],
      },
    });

    assert.equal(result.ok, false, scenario.label);
    assert.equal(result.status, "uncertain", scenario.label);
    assert.notEqual(result.code, "VERIFIED", scenario.label);
    assert.equal(fixture.getSaveCalls(), 1, scenario.label);
    assert.equal(fixture.getPersisted().money, 300000, scenario.label);
  }
});

test("a successful rename retry is accepted only after exact cache and live readback", async () => {
  const fixture = makeScene({ saveMode: "rename-throw-once" });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-rename-retry-success-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.code, "VERIFIED");
  assert.equal(result.status, "verified");
  assert.equal(fixture.getRenameCalls(), 2);
  assert.equal(fixture.getPersisted().money, 300000);
  assert.equal(fixture.getPersisted().name, "第一存档");
});

test("full readback detects corruption outside the editable projection", async () => {
  const fixture = makeScene({ saveMode: "corrupt-after" });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-full-readback-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "uncertain");
  assertBoundedRedactedDiagnosticsIfPresent(result);
  assert.equal(fixture.getPersisted().score, 6790);
});

test("SLEEP with a NIGHTMARE tag fails closed without changing runtime state", async () => {
  const fixture = makeScene();
  fixture.party[0].status = { effect: 4, toxicTurnCount: 0, sleepTurnsRemaining: 2 };
  fixture.party[0].turnData = { pendingStatus: 0 };
  fixture.party[0].summonData = { tags: [{ tagType: "NIGHTMARE", turnCount: 2 }] };
  fixture.mutatePersisted(session => {
    session.party[0].status = clone(fixture.party[0].status);
  });
  bindScene(fixture.scene);
  const originalParty = fixture.party.map(pokemon => pokemon.toSave());
  const originalTags = clone(fixture.party[0].summonData.tags);
  const originalPersisted = fixture.getPersisted();
  const before = await pokeroguePageCommand({ command: "inspect" });

  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-sleep-nightmare-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "healParty", hp: false, status: true, pp: false }],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "APPLY_FAILED");
  assert.match(result.message, /睡眠状态.*(?:梦魇|战斗标签|无法安全逆转)/);
  assert.deepEqual(fixture.party.map(pokemon => pokemon.toSave()), originalParty);
  assert.deepEqual(fixture.party[0].summonData.tags, originalTags);
  assert.equal(fixture.party[0].resetStatusCount, 0);
  assert.deepEqual(fixture.party[0].resetStatusCalls, []);
  assert.deepEqual(fixture.getPersisted(), originalPersisted);
  assert.equal(fixture.getSaveCalls(), 0);
  assert.equal(fixture.scene.input.enabled, true);
  assertNoQueuedStatusReset(fixture.party);
});

test("a status heal fails closed when resetStatus is unavailable", async () => {
  const fixture = makeScene();
  fixture.party[0].resetStatus = undefined;
  bindScene(fixture.scene);
  const originalParty = fixture.party.map(pokemon => pokemon.toSave());
  const originalPersisted = fixture.getPersisted();
  const before = await pokeroguePageCommand({ command: "inspect" });

  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-missing-reset-status-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "healParty", hp: false, status: true, pp: false }],
    },
  });

  assert.equal(result.ok, false);
  assert.ok(["APPLY_FAILED", "UNCERTAIN"].includes(result.code));
  assert.match(result.message, /缺少安全的同步状态恢复能力/);
  assert.deepEqual(fixture.party.map(pokemon => pokemon.toSave()), originalParty);
  assert.deepEqual(fixture.getPersisted(), originalPersisted);
  assert.equal(fixture.getSaveCalls(), 0);
  assert.equal(fixture.scene.input.enabled, true);
  assertNoQueuedStatusReset(fixture.party);
});

test("a later party member missing resetStatus cannot let earlier members mutate first", async () => {
  const fixture = makeScene();
  fixture.party[1].status = { effect: 1, toxicTurnCount: 0 };
  fixture.party[1].resetStatus = undefined;
  fixture.mutatePersisted(session => {
    session.party[1].status = clone(fixture.party[1].status);
  });
  bindScene(fixture.scene);
  const originalParty = fixture.party.map(pokemon => pokemon.toSave());
  const firstResetCount = fixture.party[0].resetStatusCount;
  const before = await pokeroguePageCommand({ command: "inspect" });

  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-later-missing-reset-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "healParty", hp: false, status: true, pp: false }],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /队伍成员 2.*同步状态恢复能力/);
  assert.deepEqual(fixture.party.map(pokemon => pokemon.toSave()), originalParty);
  assert.equal(fixture.party[0].resetStatusCount, firstResetCount);
  assert.deepEqual(fixture.party[0].resetStatusCalls, []);
  assert.equal(fixture.getSaveCalls(), 0);
});

test("healing HP revives a fainted Pokémon without leaving FAINT status", async () => {
  const fixture = makeScene({ fainted: true });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-faint-heal-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "healParty", hp: true, status: false, pp: false }],
    },
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(fixture.party[0].hp, fixture.party[0].getMaxHp());
  assert.equal(fixture.party[0].status, null);
  assert.ok(fixture.party[0].resetStatusCalls.length >= 1);
  assertNoQueuedStatusReset(fixture.party);
});

test("failed faint-status reconstruction rolls back both coupled fields exactly", async () => {
  const cases = [
    { label: "hp-only", operation: { type: "healParty", hp: true, status: false, pp: false } },
    { label: "status-only", operation: { type: "healParty", hp: false, status: true, pp: false } },
  ];
  for (const scenario of cases) {
    const fixture = makeScene({ fainted: true });
    bindScene(fixture.scene);
    const before = await pokeroguePageCommand({ command: "inspect" });
    const commit = await pokeroguePageCommand({
      command: "commit",
      payload: {
        txId: `test-faint-partial-commit-${scenario.label}-0001`,
        expectedHash: before.model.hash,
        expectedBackendHash: before.model.backendHash,
        operations: [scenario.operation],
      },
    });
    assert.equal(commit.ok, true, `${scenario.label}: ${commit.message}`);
    const runtimeBeforeUndo = fixture.party.map(pokemon => pokemon.toSave());
    const persistedBeforeUndo = fixture.getPersisted();
    fixture.party[0].doSetStatus = function partialSetStatus(effect) {
      this.status = { effect, toxicTurnCount: 99, unexpectedInternalField: 1 };
    };

    const undo = await pokeroguePageCommand({
      command: "undo",
      payload: {
        txId: `test-faint-partial-undo-${scenario.label}-0001`,
        expectedHash: commit.afterHash,
        expectedBackendHash: commit.afterBackendHash,
        beforeSession: before.backup.session,
        expectedBeforeFullHash: before.backup.fullHash,
        operations: [scenario.operation],
      },
    });

    assert.equal(undo.ok, false, scenario.label);
    assert.equal(undo.code, "UNDO_APPLY_FAILED", scenario.label);
    assert.deepEqual(fixture.party.map(pokemon => pokemon.toSave()), runtimeBeforeUndo, scenario.label);
    assert.deepEqual(fixture.getPersisted(), persistedBeforeUndo, scenario.label);
    assert.equal(fixture.getSaveCalls(), 1, scenario.label);
  }
});

test("healing commit and undo restore the original status without queued phases", async () => {
  const fixture = makeScene();
  bindScene(fixture.scene);
  const originalParty = fixture.party.map(pokemon => ({
    hp: pokemon.hp,
    status: clone(pokemon.status),
    ppUsed: pokemon.moveset.map(move => move.ppUsed),
  }));
  const operations = [{ type: "healParty", hp: true, status: true, pp: true }];
  const before = await pokeroguePageCommand({ command: "inspect" });

  const commit = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-heal-before-undo-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations,
    },
  });
  assert.equal(commit.ok, true, commit.message);
  assert.equal(commit.status, "verified");
  assert.ok(fixture.party.every(pokemon => pokemon.status === null));
  assert.ok(fixture.party[0].resetStatusCalls.length >= 1);
  assertNoQueuedStatusReset(fixture.party);

  const undo = await pokeroguePageCommand({
    command: "undo",
    payload: {
      txId: "test-heal-undo-0001",
      expectedHash: commit.afterHash,
      expectedBackendHash: commit.afterBackendHash,
      beforeSession: before.backup.session,
      expectedBeforeFullHash: before.backup.fullHash,
      operations,
    },
  });
  assert.equal(undo.ok, true, undo.message);
  assert.equal(undo.status, "verified");
  fixture.party.forEach((pokemon, index) => {
    assert.equal(pokemon.hp, originalParty[index].hp);
    assert.deepEqual(pokemon.status, originalParty[index].status);
    assert.deepEqual(pokemon.moveset.map(move => move.ppUsed), originalParty[index].ppUsed);
  });
  assert.deepEqual(
    fixture.getPersisted().party.map(pokemon => pokemon.status),
    originalParty.map(pokemon => pokemon.status),
  );
  assert.ok(fixture.party[0].resetStatusCalls.length >= 1);
  assertNoQueuedStatusReset(fixture.party);
});

test("undo fails closed and rolls back exactly when a non-empty status cannot be restored", async () => {
  const fixture = makeScene();
  bindScene(fixture.scene);
  const operations = [{ type: "healParty", hp: true, status: true, pp: true }];
  const before = await pokeroguePageCommand({ command: "inspect" });
  const commit = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-missing-do-set-commit-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations,
    },
  });
  assert.equal(commit.ok, true, commit.message);

  const afterCommitParty = fixture.party.map(pokemon => pokemon.toSave());
  const afterCommitPersisted = fixture.getPersisted();
  fixture.party[0].doSetStatus = undefined;

  const undo = await pokeroguePageCommand({
    command: "undo",
    payload: {
      txId: "test-missing-do-set-undo-0001",
      expectedHash: commit.afterHash,
      expectedBackendHash: commit.afterBackendHash,
      beforeSession: before.backup.session,
      expectedBeforeFullHash: before.backup.fullHash,
      operations,
    },
  });

  assert.equal(undo.ok, false);
  assert.equal(undo.code, "UNDO_APPLY_FAILED");
  assert.match(undo.message, /缺少.*异常状态恢复能力/);
  assert.deepEqual(fixture.party.map(pokemon => pokemon.toSave()), afterCommitParty);
  assert.deepEqual(fixture.getPersisted(), afterCommitPersisted);
  assert.equal(fixture.getSaveCalls(), 1);
  assert.equal(fixture.getRenameCalls(), 1);
  assert.equal(fixture.scene.input.enabled, true);
  assertNoQueuedStatusReset(fixture.party);
});

test("undo never clears a current non-empty status before proving doSetStatus exists", async () => {
  const fixture = makeScene();
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  fixture.party[0].status = { effect: 5, toxicTurnCount: 0, freezeTurnsRemaining: 2 };
  fixture.party[0].doSetStatus = undefined;
  fixture.mutatePersisted(session => {
    session.party[0].status = clone(fixture.party[0].status);
  });
  const current = await pokeroguePageCommand({ command: "inspect" });
  const currentParty = fixture.party.map(pokemon => pokemon.toSave());
  const currentPersisted = fixture.getPersisted();
  const resetCount = fixture.party[0].resetStatusCount;

  const undo = await pokeroguePageCommand({
    command: "undo",
    payload: {
      txId: "test-nonempty-missing-do-set-0001",
      expectedHash: current.model.hash,
      expectedBackendHash: current.model.backendHash,
      beforeSession: before.backup.session,
      expectedBeforeFullHash: before.backup.fullHash,
      operations: [{ type: "healParty", hp: false, status: true, pp: false }],
    },
  });

  assert.equal(undo.ok, false);
  assert.match(undo.message, /缺少.*异常状态恢复能力/);
  assert.deepEqual(fixture.party.map(pokemon => pokemon.toSave()), currentParty);
  assert.deepEqual(fixture.getPersisted(), currentPersisted);
  assert.equal(fixture.party[0].resetStatusCount, resetCount);
  assert.deepEqual(fixture.party[0].resetStatusCalls, []);
  assert.equal(fixture.getSaveCalls(), 0);
  assert.equal(fixture.scene.input.enabled, true);
});

test("max IV never revives a fainted Pokémon implicitly", async () => {
  const fixture = makeScene({ fainted: true });
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const result = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-faint-ivs-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "maxIvs", pokemonId: 11 }],
    },
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(fixture.party[0].hp, 0);
  assert.deepEqual(fixture.party[0].status, { effect: 7, toxicTurnCount: 0 });
});

test("the same transaction id is idempotent", async () => {
  const fixture = makeScene();
  bindScene(fixture.scene);
  const before = await pokeroguePageCommand({ command: "inspect" });
  const request = {
    command: "commit",
    payload: {
      txId: "test-idempotent-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  };
  const first = await pokeroguePageCommand(request);
  const second = await pokeroguePageCommand(request);
  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
  assert.equal(fixture.getSaveCalls(), 1);
});

test("verified changes can be undone only from the exact after state", async () => {
  const fixture = makeScene();
  bindScene(fixture.scene);
  const pokemonMethodCounts = fixture.party.map(pokemon => ({
    calculateStats: pokemon.calculateStatsCount,
    resetStatus: pokemon.resetStatusCount,
    updateInfo: pokemon.updateCount,
  }));
  const before = await pokeroguePageCommand({ command: "inspect" });
  const commit = await pokeroguePageCommand({
    command: "commit",
    payload: {
      txId: "test-before-undo-0001",
      expectedHash: before.model.hash,
      expectedBackendHash: before.model.backendHash,
      operations: [{ type: "setMoney", value: 300000 }],
    },
  });
  assert.equal(commit.ok, true);

  const undo = await pokeroguePageCommand({
    command: "undo",
    payload: {
      txId: "test-undo-0001",
      expectedHash: commit.afterHash,
      expectedBackendHash: commit.afterBackendHash,
      beforeSession: before.backup.session,
      expectedBeforeFullHash: before.backup.fullHash,
      targetOperations: [{ type: "setMoney", value: 300000 }],
    },
  });
  assert.equal(undo.ok, true, undo.message);
  assert.equal(fixture.scene.money, 12345);
  assert.equal(fixture.getPersisted().money, 12345);
  assert.equal(fixture.getPersisted().name, "第一存档");
  assert.deepEqual(
    fixture.party.map(pokemon => ({
      calculateStats: pokemon.calculateStatsCount,
      resetStatus: pokemon.resetStatusCount,
      updateInfo: pokemon.updateCount,
    })),
    pokemonMethodCounts,
    "money-only commit/undo must not touch any Pokémon methods",
  );
});

test("native export delegates to the game's session exporter", async () => {
  const fixture = makeScene();
  bindScene(fixture.scene);
  const result = await pokeroguePageCommand({ command: "export-native" });
  assert.equal(result.ok, true);
  assert.equal(fixture.getNativeExportCalls(), 1);
});

test("inspection exposes only the account egg count and capability", async () => {
  const fixture = makeScene({ eggCount: 4 });
  bindScene(fixture.scene);
  const result = await pokeroguePageCommand({ command: "inspect" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.model.account, {
    voucherCounts: {},
    canEditCollection: false,
    eggCount: 4,
    maxEggs: 99,
    canAddLegendaryEggs: true,
    readOnlyReason: "",
  });
  assert.doesNotMatch(JSON.stringify(result.model.account), /species|999/);
});

test("random legendary eggs use the official machine source and keep contents private", async () => {
  const sourceTypes = { move: 0, legendary: 1, shiny: 2 };
  for (const [source, sourceType] of Object.entries(sourceTypes)) {
    const fixture = makeScene();
    bindScene(fixture.scene);
    const result = await pokeroguePageCommand({
      command: "add-legendary-eggs",
      payload: { txId: `test-eggs-${source}-0001`, source, count: 2 },
    });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.code, "VERIFIED");
    assert.equal(fixture.eggs.length, 2);
    assert.ok(fixture.eggs.every(egg => egg.tier === 3));
    assert.ok(fixture.eggs.every(egg => egg.hatchWaves === 100));
    assert.ok(fixture.eggs.every(egg => egg.sourceType === sourceType));
    assert.equal(fixture.getSystemSaveCalls(), 1);
    assert.equal(fixture.scene.gameData.gameStats.eggsPulled, 2);
    assert.equal(fixture.scene.gameData.gameStats.legendaryEggsPulled, 2);
    assert.doesNotMatch(JSON.stringify(result), /species|999|isShiny/);
    delete globalThis.window;
  }
});

test("the 99 egg limit rejects before generating or saving", async () => {
  const fixture = makeScene({ eggCount: 99 });
  bindScene(fixture.scene);
  const result = await pokeroguePageCommand({
    command: "add-legendary-eggs",
    payload: { txId: "test-eggs-limit-0001", source: "legendary", count: 1 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "EGG_LIMIT");
  assert.equal(fixture.eggs.length, 99);
  assert.equal(fixture.getSystemSaveCalls(), 0);
});

test("a rejected system save restores eggs, pity and pull statistics", async () => {
  const fixture = makeScene({ eggCount: 2, systemSaveMode: "false" });
  bindScene(fixture.scene);
  const beforePity = fixture.scene.gameData.eggPity.slice();
  const beforeUnlockPity = fixture.scene.gameData.unlockPity.slice();
  const result = await pokeroguePageCommand({
    command: "add-legendary-eggs",
    payload: { txId: "test-eggs-rollback-0001", source: "shiny", count: 3 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNCERTAIN");
  assert.equal(result.status, "uncertain");
  assert.equal(fixture.eggs.length, 2);
  assert.deepEqual(fixture.scene.gameData.eggPity, beforePity);
  assert.deepEqual(fixture.scene.gameData.unlockPity, beforeUnlockPity);
  assert.equal(fixture.scene.gameData.gameStats.eggsPulled, 0);
  assert.equal(fixture.scene.gameData.gameStats.legendaryEggsPulled, 0);
});

test("system export delegates to the game's account exporter", async () => {
  const fixture = makeScene();
  bindScene(fixture.scene);
  const result = await pokeroguePageCommand({ command: "export-system-native" });
  assert.equal(result.ok, true);
  assert.equal(fixture.getNativeExportCalls(), 1);
});

test("one-shot rare encounter waits through the current and trainer waves, then affects only the first wild", async () => {
  const fixture = makeScene({ waveIndex: 188 });
  const pool = makeEncounterPool({
    2: [{ speciesId: 202, marker: "rare" }],
    3: [{ speciesId: 303, marker: "super-rare" }],
    4: [{ speciesId: 404, marker: "ultra-rare-secret" }],
  });
  const encounter = installEncounterFixture(fixture, pool);
  bindScene(fixture.scene);

  const armed = await pokeroguePageCommand({ command: "arm-rare-encounter" });
  assert.equal(armed.ok, true, armed.message);
  assert.equal(armed.rareEncounter.armed, true);
  assert.doesNotMatch(JSON.stringify(armed.rareEncounter), /404|ultra-rare-secret|species/i);

  const current = fixture.scene.randomSpecies(188, 90, true);
  assert.equal(current.marker, "common");
  assert.equal((await pokeroguePageCommand({ command: "inspect" })).model.rareEncounter.armed, true);

  fixture.scene.currentBattle = { waveIndex: 189, turn: 1, battleType: 1 };
  const trainerLikeCall = fixture.scene.randomSpecies(189, 91, true);
  assert.equal(trainerLikeCall.marker, "common");
  assert.equal((await pokeroguePageCommand({ command: "inspect" })).model.rareEncounter.armed, true);

  fixture.scene.currentBattle = { waveIndex: 190, turn: 1, battleType: 0 };
  const firstWild = fixture.scene.randomSpecies(190, 92, true);
  const secondWild = fixture.scene.randomSpecies(190, 92, true);
  assert.equal(firstWild.marker, "ultra-rare-secret");
  assert.equal(secondWild.marker, "common");
  assert.equal(fixture.scene.randomSpecies, encounter.original);
  assert.equal((await pokeroguePageCommand({ command: "inspect" })).model.rareEncounter.armed, false);
});

test("one-shot rare encounter falls back ULTRA_RARE to SUPER_RARE to RARE", async () => {
  for (const [pool, expected] of [
    [makeEncounterPool({ 2: [{ marker: "rare" }], 3: [{ marker: "super" }], 4: [{ marker: "ultra" }] }), "ultra"],
    [makeEncounterPool({ 2: [{ marker: "rare" }], 3: [{ marker: "super" }] }), "super"],
    [makeEncounterPool({ 2: [{ marker: "rare" }] }), "rare"],
  ]) {
    const fixture = makeScene({ waveIndex: 20 });
    installEncounterFixture(fixture, pool);
    bindScene(fixture.scene);
    const armed = await pokeroguePageCommand({ command: "arm-rare-encounter" });
    assert.equal(armed.ok, true);
    fixture.scene.currentBattle = { waveIndex: 21, turn: 1, battleType: 0 };
    assert.equal(fixture.scene.randomSpecies(21, 15, true).marker, expected);
  }
});

test("one-shot rare encounter reads the arena that exists after a biome transition", async () => {
  const fixture = makeScene({ waveIndex: 30 });
  installEncounterFixture(fixture, makeEncounterPool({ 4: [{ marker: "biome-a" }] }));
  bindScene(fixture.scene);
  assert.equal((await pokeroguePageCommand({ command: "arm-rare-encounter" })).ok, true);

  const biomeB = makeEncounterPool({ 4: [{ marker: "biome-b" }] });
  fixture.scene.arena = {
    biomeId: 2,
    pokemonPool: biomeB,
    trainerPool: makeEncounterPool(),
    updatePoolsForTimeOfDay() {},
  };
  fixture.scene.currentBattle = { waveIndex: 31, turn: 1, battleType: 0 };
  assert.equal(fixture.scene.randomSpecies(31, 20, true).marker, "biome-b");
});

test("minified arena pool discovery changes the Pokémon pool without touching the trainer pool", async () => {
  const fixture = makeScene({ waveIndex: 35 });
  const pokemonPool = makeEncounterPool({ 4: [{ marker: "minified-ultra" }] });
  const trainerPool = makeEncounterPool({ 4: [{ marker: "trainer-value" }] });
  fixture.scene.arena = {
    a: pokemonPool,
    b: trainerPool,
    updatePoolsForTimeOfDay() {},
    randomSpecies() { return this.a[0][0]; },
  };
  fixture.scene.randomSpecies = function randomSpecies(_waveIndex, _level, fromArenaPool) {
    return fromArenaPool ? this.arena.randomSpecies() : { marker: "global" };
  };
  bindScene(fixture.scene);
  assert.equal((await pokeroguePageCommand({ command: "arm-rare-encounter" })).ok, true);
  fixture.scene.currentBattle = { waveIndex: 36, turn: 1, battleType: 0 };
  assert.equal(fixture.scene.randomSpecies(36, 20, true).marker, "minified-ultra");
  assert.equal(trainerPool[0][0].marker, "common");
  assert.equal(trainerPool[4][0].marker, "trainer-value");
});

test("cancelling a one-shot rare encounter restores the official selector and is idempotent", async () => {
  const fixture = makeScene({ waveIndex: 40 });
  const encounter = installEncounterFixture(
    fixture,
    makeEncounterPool({ 4: [{ marker: "should-not-be-used" }] }),
  );
  bindScene(fixture.scene);
  assert.equal((await pokeroguePageCommand({ command: "arm-rare-encounter" })).ok, true);
  const cancelled = await pokeroguePageCommand({ command: "cancel-rare-encounter" });
  assert.equal(cancelled.code, "CANCELLED");
  assert.equal(fixture.scene.randomSpecies, encounter.original);
  fixture.scene.currentBattle = { waveIndex: 41, turn: 1, battleType: 0 };
  assert.equal(fixture.scene.randomSpecies(41, 20, true).marker, "common");
  assert.equal((await pokeroguePageCommand({ command: "cancel-rare-encounter" })).code, "ALREADY_IDLE");
});
