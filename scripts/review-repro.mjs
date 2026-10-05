// Isolated Node mocks only: no browser, network, real account, or disk writes.
// Run from the project: node scripts/review-repro.mjs
import assert from 'node:assert/strict';
import { pokeroguePageCommand } from '../src/game/page-adapter.js';
import { EDITOR_VERSION } from '../src/shared/core.js';

const fixtureUrl = new URL('../tests/fixtures/assets/index-catalog-review.js', import.meta.url);
const phase = { is: name => name === 'CommandPhase', phaseName: 'CommandPhase' };
let saves = 0;
const gameData = {
  trainerId: 101, secretId: 202, eggs: [], eggPity: [0, 0, 0, 0], unlockPity: [0, 0, 0, 0],
  gameStats: { eggsPulled: 0, legendaryEggsPulled: 0 }, voucherCounts: { 0: 0 },
  dexData: { 1: { seenAttr: 0n, caughtAttr: 0n, natureAttr: 0 } },
  starterData: { 1: { abilityAttr: 0, eggMoves: 0 } },
  getSessionSaveData: () => ({}), getSession: async () => ({}),
  getSystemSaveData() { return { trainerId: this.trainerId, secretId: this.secretId,
    eggs: this.eggs, eggPity: this.eggPity, unlockPity: this.unlockPity,
    gameStats: this.gameStats, voucherCounts: this.voucherCounts,
    dexData: this.dexData, starterData: this.starterData }; },
  async saveSystem() { saves += 1; return true; },
};
const handler = {
  gachaCursor: 1, getGuaranteedEggTierFromPullCount: () => 0,
  pullEggs() {
    const egg = { id: 1, tier: this.getGuaranteedEggTierFromPullCount(),
      hatchWaves: 100, sourceType: this.gachaCursor };
    gameData.eggs.push(egg); // Models Egg({pulled:true})'s documented side effect.
    gameData.gameStats.eggsPulled += 1;
    gameData.gameStats.legendaryEggsPulled += 1;
    return [egg];
  },
};
const scene = { gameData, sessionSlotId: 0, seed: 'synthetic-audit',
  currentBattle: { waveIndex: 62, turn: 1, battleType: 0 },
  game: { config: { gameVersion: '1.12.0.11' } }, input: { enabled: true },
  phaseManager: { getCurrentPhase: () => phase }, getPlayerParty: () => [],
  ui: { handlers: [handler] },
};
globalThis.window = { __prScene: scene };
globalThis.document = { querySelectorAll: () => [{ src: fixtureUrl.href }] };
globalThis.location = { origin: fixtureUrl.origin, href: fixtureUrl.href };
globalThis.fetch = async () => new Response(''); // Module traversal does not hit a network.
const cache = new Map();
globalThis.localStorage = { get length() { return cache.size; }, key: index => [...cache.keys()][index],
  getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value), removeItem: key => cache.delete(key) };

const catalog = await pokeroguePageCommand({ command: 'collection-catalog' });
assert.equal(catalog.ok, true, catalog.message);
console.log('特性表识别:', { expected: '特性1', actual: catalog.species[0].abilities[0].name });

let listener;
let stored = {};
let pageResult;
const hashA = 'a'.repeat(64), hashB = 'b'.repeat(64), hashC = 'c'.repeat(64);
const run = { accountIdentity: '101:202', slotId: 0, seed: scene.seed,
  waveIndex: 62, turn: 1, name: '模拟对局', gameVersion: '1.12.0.11' };
globalThis.chrome = {
  runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} },
    onMessage: { addListener(value) { listener = value; } } },
  sidePanel: { async setPanelBehavior() {} },
  storage: { local: { async setAccessLevel() {},
    async get(key) { return { [key]: structuredClone(stored[key]) }; },
    async set(patch) { stored = { ...stored, ...structuredClone(patch) }; } } },
  tabs: { async query() { return [{ id: 77, url: 'https://pokerogue.net/' }]; } },
  scripting: { async executeScript(options) {
    const request = options.args[0];
    if (request.command === 'inspect') return [{ result: {
      ok: true, adapterVersion: EDITOR_VERSION,
      pageInstanceId: '11111111-1111-4111-8111-111111111111',
      model: { readOnly: false, run, hash: 'audit-runtime', backendHash: hashB },
      backup: { session: { seed: scene.seed, party: [] }, fullHash: hashA, backendHash: hashB, editableHash: hashC },
    } }];
    const result = await pokeroguePageCommand(request);
    if (request.command === 'account-commit') pageResult = result;
    return [{ result }];
  } },
};
await import('../src/background/service-worker.js');
const result = await new Promise(resolve => listener({ type: 'ADD_LEGENDARY_EGGS',
  clientRequestId: '00000000-0000-4000-8000-000000000001', source: 'shiny', count: 1 }, {}, resolve));
console.log('传说蛋实际页面 → 后台:', {
  systemSaveCalls: saves, eggCount: gameData.eggs.length,
  pageStatus: pageResult?.status, pageAdapterVersion: pageResult?.adapterVersion ?? 'missing',
  backgroundStatus: result.status, backgroundOk: result.ok,
});
