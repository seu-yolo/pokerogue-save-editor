// Synthetic values only. Loaded by scripts/ui-preview.mjs, never packaged.
import { EDITOR_VERSION } from "../../src/shared/core.js";
const clone = value => structuredClone(value);
let inspectFailures = new URL(location.href).searchParams.has("connection_error") ? 1 : 0;
const model = {
  readOnly: false, readOnlyReason: "", persistenceInSync: true, hash: "preview-runtime", backendHash: "a".repeat(64),
  run: { slotId: 0, displaySlot: 1, name: "预览对局（模拟数据）", waveIndex: 62, turn: 1, mode: "经典模式", gameVersion: "1.12.0.11", seed: "synthetic-demo", phase: "CommandPhase", accountIdentity: "101:202" },
  money: 24000, pokeballs: [{ key: "0", value: 10 }, { key: "1", value: 5 }, { key: "2", value: 3 }, { key: "3", value: 1 }, { key: "4", value: 0 }],
  party: [{ id: 11, name: "皮卡丘", level: 42, hp: 38, maxHp: 105, friendship: 100, pokerus: false, pauseEvolutions: false, ivs: [10, 20, 30, 15, 18, 22], ppUsed: [2, 4] },
    { id: 22, name: "巨沼怪", level: 43, hp: 62, maxHp: 141, friendship: 110, pokerus: false, pauseEvolutions: false, ivs: [18, 22, 24, 20, 19, 30], ppUsed: [3, 2] }],
  modifiers: [], capabilities: { nativeBackup: true },
  account: { eggCount: 3, maxEggs: 99, canAddLegendaryEggs: true, canEditCollection: true, voucherCounts: { 0: 12, 1: 3, 2: 1, 3: 0 } },
  rareEncounter: { armed: false, supported: true, message: "刷新页面会取消等待。" },
};
if (new URL(location.href).searchParams.has("readonly")) {
  model.readOnly = true; model.readOnlyReason = "模拟：当前游戏版本未验证，只读预览";
  model.account.canEditCollection = false; model.account.canAddLegendaryEggs = false;
}
const species = [[382, "盖欧卡", false], [150, "超梦", false], [25, "皮卡丘", true], [384, "烈空坐", true]].map(([id, name, owned]) => ({
  id, name, owned, legendary: id !== 25, shinies: [0, 1, 2], ownedShinies: owned ? [0] : [],
  forms: [{ index: 0, name: "基础形态", owned }], natures: Array.from({ length: 25 }, (_, index) => ({ index, owned: owned && index === 0 })),
  eggMoves: ["冷冻干燥", "根源波动", "回复封锁", "水蒸气"].map((name, index) => ({ index, name, rare: index === 3, owned: owned && index === 0 })),
  abilities: [{ index: 0, name: "降雨", owned }, { index: 2, name: "隐藏特性（模拟）", owned: false }],
}));
let account = { voucherCounts: clone(model.account.voucherCounts) };
window.chrome = { runtime: { async sendMessage(message) {
  switch (message.type) {
    case "INSPECT":
      if (inspectFailures-- > 0) return { ok: false, message: "模拟连接失败：点击顶部刷新按钮重试，不会操作实际游戏。" };
      return { ok: true, adapterVersion: EDITOR_VERSION, model: clone(model) };
    case "LIST_BACKUPS": return { ok: true, backups: [] };
    case "COLLECTION_CATALOG": return { ok: true, species: clone(species), eggMovesAvailable: true, version: model.run.gameVersion };
    case "ITEM_CATALOG": return { ok: true, items: [
      { id: "SHINY_CHARM", name: "闪耀护符", held: false, description: "提升野生宝可梦的闪光出现概率。（模拟说明）", limits: [{ pokemonId: null, currentStackCount: 2, maxStackCount: 4, virtualStackCount: 0, remaining: 2, modifierFingerprint: null }] },
      { id: "LEFTOVERS", name: "吃剩的东西", held: true, description: "回合结束时回复持有者的 HP。（模拟说明）", limits: model.party.map((pokemon, index) => ({ pokemonId: pokemon.id, currentStackCount: index ? 4 : 0, maxStackCount: 4, virtualStackCount: 0, remaining: index ? 0 : 4, modifierFingerprint: null })) },
    ] };
    case "ACCOUNT_PREVIEW": return { ok: true, expectedSystem: clone(account), operations: clone(message.operations), diffs: message.operations.map(operation => ({ label: operation.type === "unlockStarter" ? `${species.find(row => row.id === operation.speciesId).name} · 永久解锁` : "抽奖券总数量", before: "当前收藏", after: operation.type === "unlockStarter" ? `外观 ${operation.shiny} · 已选性格 ${operation.natures.length} · 蛋招式 ${operation.eggMoves.length}` : operation.value })) };
    case "ACCOUNT_COMMIT":
      for (const operation of message.operations) {
        if (operation.type === "setVoucher") account.voucherCounts[operation.key] = model.account.voucherCounts[operation.key] = operation.value;
        if (operation.type === "unlockStarter") { const row = species.find(row => row.id === operation.speciesId); row.owned = true; for (const field of ["natures", "eggMoves", "abilities"]) for (const index of operation[field]) row[field].find(choice => choice.index === index).owned = true; }
      }
      return { ok: true, code: "VERIFIED", status: "verified", message: "模拟保存成功（未连接实际游戏）" };
    case "COMMIT":
      for (const operation of message.operations) {
        if (operation.type === "setMoney") model.money = operation.value;
        if (operation.type === "healParty") for (const pokemon of model.party) { pokemon.hp = pokemon.maxHp; pokemon.ppUsed = [0, 0]; }
      }
      return { ok: true, code: "VERIFIED", status: "verified", message: "模拟保存成功（未连接实际游戏）" };
    case "ARM_RARE_ENCOUNTER": model.rareEncounter.armed = true; return { ok: true, rareEncounter: clone(model.rareEncounter), message: "模拟：等待下一次遭遇" };
    case "CANCEL_RARE_ENCOUNTER": model.rareEncounter.armed = false; return { ok: true, rareEncounter: clone(model.rareEncounter) };
    case "EXPORT_NATIVE": case "EXPORT_SYSTEM_NATIVE": return { ok: true, message: "模拟预览不导出实际存档" };
    default: return { ok: false, message: "预览没有实现此请求" };
  }
} } };
