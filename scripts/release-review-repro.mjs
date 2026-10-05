import assert from 'node:assert/strict';
import { pokeroguePageCommand } from '../src/game/page-adapter.js';

// Synthetic-only reproduction of GameData.reinitializeSaveData loading a new
// system snapshot into the same GameData instance after a stale-session error.
function fixture() {
  const cache = new Map([['data_demo', 'before-cache']]);
  const data = {
    trainerId: 101, secretId: 202, eggs: [], eggPity: [0, 0, 0, 0], unlockPity: [0, 0, 0, 0],
    voucherCounts: { 0: 0, 1: 0, 2: 0, 3: 0 }, gameStats: { eggsPulled: 0, legendaryEggsPulled: 0 },
    dexData: {}, starterData: {}, getSessionSaveData: () => ({}), getSession: async () => ({}),
    getSystemSaveData() { return { trainerId: this.trainerId, secretId: this.secretId,
      eggs: this.eggs, eggPity: this.eggPity, unlockPity: this.unlockPity,
      voucherCounts: this.voucherCounts, gameStats: this.gameStats, dexData: this.dexData, starterData: this.starterData }; },
    async saveSystem() {
      // This is a refreshed server snapshot, not the editor's tentative state.
      this.eggs = [{ id: 999, tier: 3, hatchWaves: 80 }];
      this.eggPity = [0, 7, 8, 9]; this.unlockPity = [0, 4, 5, 6];
      this.gameStats = { eggsPulled: 50, legendaryEggsPulled: 5 };
      this.voucherCounts[0] = 99;
      cache.set('data_demo', 'refreshed-cache');
      return false;
    },
  };
  const handler = {
    gachaCursor: 1, getGuaranteedEggTierFromPullCount: () => 0,
    pullEggs() {
      const egg = { id: 1, tier: this.getGuaranteedEggTierFromPullCount(), hatchWaves: 100, sourceType: this.gachaCursor };
      data.eggs.push(egg); data.gameStats.eggsPulled++; data.gameStats.legendaryEggsPulled++;
      return [egg];
    },
  };
  const phase = { is: name => name === 'CommandPhase', phaseName: 'CommandPhase' };
  const scene = { gameData: data, sessionSlotId: 0, seed: 'synthetic-release-audit',
    currentBattle: { waveIndex: 62, turn: 1, battleType: 0 },
    game: { config: { gameVersion: '1.12.0.11' } }, input: { enabled: true },
    phaseManager: { getCurrentPhase: () => phase }, getPlayerParty: () => [], ui: { handlers: [handler] } };
  globalThis.window = { __prScene: scene };
  globalThis.localStorage = { get length() { return cache.size; }, key: i => [...cache.keys()][i],
    getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value), removeItem: key => cache.delete(key) };
  return { data, cache };
}

for (const operation of [{ type: 'setVoucher', key: '0', value: 300 }, { type: 'addLegendaryEggs', source: 'shiny', count: 1 }]) {
  const { data, cache } = fixture();
  const preview = await pokeroguePageCommand({ command: 'account-preview', payload: { operations: [operation] } });
  assert.equal(preview.ok, true, preview.message);
  const result = await pokeroguePageCommand({ command: 'account-commit', payload: {
    txId: `release-audit-${operation.type}`, operations: [operation], expectedSystemJson: preview.expectedSystemJson } });
  console.log(JSON.stringify({ operation: operation.type, result: result.code,
    freshVoucherPreserved: data.voucherCounts[0] === 99,
    freshEggPreserved: data.eggs.length === 1 && data.eggs[0].id === 999,
    freshStatsPreserved: data.gameStats.eggsPulled === 50,
    freshPityPreserved: data.eggPity[1] === 7,
    freshCachePreserved: cache.get('data_demo') === 'refreshed-cache' }));
  assert.equal(result.code, 'UNCERTAIN');
  assert.equal(data.voucherCounts[0], 99);
  assert.equal(data.eggs[0].id, 999);
  assert.equal(data.gameStats.eggsPulled, 50);
  assert.equal(data.eggPity[1], 7);
  assert.equal(cache.get('data_demo'), 'refreshed-cache');
}
