import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_BALL_COUNT,
  MAX_FRIENDSHIP,
  MAX_MONEY,
  ValidationError,
  accountSnapshotString,
  backupSummary,
  buildLegendaryEggRequest,
  buildOperations,
  isClientRequestId,
  pruneBackups,
  selectSafetyLockAudit,
} from "../src/shared/core.js";

test("account comparison ignores only automatic clocks and key order, without changing snapshots", () => {
  const before = { trainerId: 1, timestamp: 10, gameStats: { playTime: 100, eggsPulled: 2 }, eggs: [1, 2] };
  const after = { eggs: [1, 2], gameStats: { eggsPulled: 2, playTime: 105 }, timestamp: 20, trainerId: 1 };
  assert.equal(accountSnapshotString(before), accountSnapshotString(after));
  assert.equal(before.gameStats.playTime, 100);
  assert.equal(after.timestamp, 20);
  for (const changed of [
    { ...after, trainerId: 2 },
    { ...after, gameStats: { ...after.gameStats, eggsPulled: 3 } },
    { ...after, eggs: [2, 1] },
    { ...after, playTime: 7 },
  ]) assert.notEqual(accountSnapshotString(before), accountSnapshotString(changed));
});

test("随机传说蛋请求只接受三台官方机器、1–10 枚且不超过 99 枚", () => {
  for (const source of ["legendary", "move", "shiny"]) {
    const request = buildLegendaryEggRequest({ source, count: "10" }, { eggCount: 89 });
    assert.equal(request.source, source);
    assert.equal(request.count, 10);
    assert.equal(request.hatchWaves, 100);
    assert.equal(Object.hasOwn(request, "species"), false);
  }
  for (const count of [0, 11, -1, 1.5, ""]) {
    expectValidationError(
      () => buildLegendaryEggRequest({ source: "legendary", count }, { eggCount: 0 }),
      "egg-count",
    );
  }
  expectValidationError(
    () => buildLegendaryEggRequest({ source: "invalid", count: 1 }, { eggCount: 0 }),
    "egg-source",
  );
  expectValidationError(
    () => buildLegendaryEggRequest({ source: "shiny", count: 2 }, { eggCount: 98 }),
    "egg-count",
  );
});

function makeModel(waveIndex = 188) {
  return {
    readOnly: false,
    money: 1_000,
    pokeballs: [
      { key: "0", value: 5 },
      { key: "1", value: 4 },
      { key: "2", value: 3 },
      { key: "3", value: 2 },
      { key: "4", value: 1 },
    ],
    party: [
      {
        id: 42,
        name: "测试宝可梦",
        hp: 80,
        maxHp: 100,
        status: null,
        ppUsed: [0, 0, 0, 0],
        friendship: 100,
        pokerus: false,
        pauseEvolutions: false,
        ivs: [10, 11, 12, 13, 14, 15],
      },
    ],
    modifiers: [
      {
        fingerprint: "safe-modifier",
        name: "可编辑道具",
        stackCount: 1,
        maxStackCount: 5,
        editable: true,
      },
    ],
    run: {
      name: "经典模式",
      waveIndex,
    },
    waveIndex,
  };
}

function unchangedDraft(model) {
  return {
    money: String(model.money),
    balls: Object.fromEntries(model.pokeballs.map(ball => [String(ball.key), String(ball.value)])),
    heal: { hp: false, status: false, pp: false },
    party: Object.fromEntries(
      model.party.map(pokemon => [
        String(pokemon.id),
        {
          friendship: String(pokemon.friendship),
          pokerus: pokemon.pokerus,
          pauseEvolutions: pokemon.pauseEvolutions,
          maxIvs: false,
        },
      ]),
    ),
    modifiers: Object.fromEntries(
      model.modifiers.map(modifier => [modifier.fingerprint, String(modifier.stackCount)]),
    ),
    runName: model.run.name,
  };
}

function expectValidationError(fn, field) {
  assert.throws(fn, error => {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.field, field);
    return true;
  });
}

test("无尽模式超过十亿的原有金钱不会阻止其他修改，并可设置官方上限", () => {
  assert.equal(MAX_MONEY, Number.MAX_SAFE_INTEGER);
  const model = makeModel(2000);
  model.money = 3_647_274_539;
  const draft = unchangedDraft(model);
  draft.heal = { hp: true };
  assert.deepEqual(buildOperations(draft, model).operations, [{ type: "healParty", hp: true, status: false, pp: false }]);
  draft.money = "9007199254740991";
  assert.deepEqual(buildOperations(draft, model).operations[0], { type: "setMoney", value: Number.MAX_SAFE_INTEGER });
  draft.money = "9007199254740992";
  expectValidationError(() => buildOperations(draft, model), "money");
});

test("任意波数会生成完全相同的编辑操作（含 1、188、1000 波）", () => {
  const operationsByWave = [1, 188, 1_000].map(waveIndex => {
    const model = makeModel(waveIndex);
    const draft = unchangedDraft(model);
    draft.money = "300000";
    draft.balls["4"] = "9";
    draft.heal = { hp: true, status: false, pp: false };
    draft.party["42"] = {
      friendship: "255",
      pokerus: true,
      pauseEvolutions: true,
      maxIvs: true,
    };
    draft.modifiers["safe-modifier"] = "5";
    draft.runName = "稳定测试存档";
    return buildOperations(draft, model).operations;
  });

  assert.deepEqual(operationsByWave[1], operationsByWave[0]);
  assert.deepEqual(operationsByWave[2], operationsByWave[0]);
  assert.deepEqual(
    operationsByWave[0].map(operation => operation.type),
    [
      "setMoney",
      "setBallCount",
      "healParty",
      "setFriendship",
      "setPokerus",
      "setPauseEvolutions",
      "maxIvs",
      "setModifierStack",
      "renameRun",
    ],
  );
});

test("金钱接受 0 和上限，并拒绝越界值", () => {
  for (const boundary of [0, MAX_MONEY]) {
    const model = makeModel();
    const draft = unchangedDraft(model);
    draft.money = String(boundary);
    const { operations } = buildOperations(draft, model);
    assert.deepEqual(operations, [{ type: "setMoney", value: boundary }]);
  }

  for (const invalid of [-1, MAX_MONEY + 1]) {
    const model = makeModel();
    const draft = unchangedDraft(model);
    draft.money = invalid;
    expectValidationError(() => buildOperations(draft, model), "money");
  }
});

test("五种精灵球接受 0 和 99，并拒绝越界值", () => {
  for (const boundary of [0, MAX_BALL_COUNT]) {
    const model = makeModel();
    const draft = unchangedDraft(model);
    for (const ball of model.pokeballs) {
      draft.balls[String(ball.key)] = String(boundary);
    }
    const { operations } = buildOperations(draft, model);
    assert.equal(operations.length, 5);
    assert.deepEqual(
      operations,
      model.pokeballs.map(ball => ({ type: "setBallCount", key: String(ball.key), value: boundary })),
    );
  }

  for (const invalid of [-1, MAX_BALL_COUNT + 1]) {
    const model = makeModel();
    const draft = unchangedDraft(model);
    draft.balls["4"] = invalid;
    expectValidationError(() => buildOperations(draft, model), "ball-4");
  }
});

test("亲密度接受 0 和 255，并拒绝越界值", () => {
  for (const boundary of [0, MAX_FRIENDSHIP]) {
    const model = makeModel();
    const draft = unchangedDraft(model);
    draft.party["42"].friendship = String(boundary);
    const { operations } = buildOperations(draft, model);
    assert.deepEqual(operations, [{ type: "setFriendship", pokemonId: 42, value: boundary }]);
  }

  for (const invalid of [-1, MAX_FRIENDSHIP + 1]) {
    const model = makeModel();
    const draft = unchangedDraft(model);
    draft.party["42"].friendship = invalid;
    expectValidationError(() => buildOperations(draft, model), "friendship-42");
  }
});

test("未修改的受保护道具可通过，修改层数则失败关闭", () => {
  const model = makeModel();
  model.modifiers = [
    {
      fingerprint: "protected-modifier",
      name: "受保护道具",
      stackCount: 2,
      maxStackCount: 5,
      editable: false,
    },
  ];

  const unchanged = unchangedDraft(model);
  assert.deepEqual(buildOperations(unchanged, model), { operations: [], diffs: [] });

  const changed = unchangedDraft(model);
  changed.modifiers["protected-modifier"] = "3";
  expectValidationError(() => buildOperations(changed, model), "modifier-protected-modifier");
});

test("请求治疗但所选项目没有恢复需求时不生成 healParty", () => {
  const model = makeModel();
  model.party[0].hp = model.party[0].maxHp;
  model.party[0].status = null;
  model.party[0].ppUsed = [0, 0, 0, 0];

  const draft = unchangedDraft(model);
  draft.heal = { hp: true, status: true, pp: true };
  assert.deepEqual(buildOperations(draft, model), { operations: [], diffs: [] });

  model.party[0].status = { effect: 3 };
  model.party[0].ppUsed = [1, 0, 0, 0];
  const hpOnlyDraft = unchangedDraft(model);
  hpOnlyDraft.heal = { hp: true, status: false, pp: false };
  assert.deepEqual(buildOperations(hpOnlyDraft, model), { operations: [], diffs: [] });
});

test("backupSummary 只保留摘要字段并计算操作数", () => {
  const summary = backupSummary({
    txId: "tx-1",
    kind: "commit",
    createdAt: "2026-08-05T10:00:00.000Z",
    slot: 0,
    run: { name: "经典模式", waveIndex: 188 },
    gameVersion: "1.12.0.10",
    status: "committed",
    operations: [{ type: "setMoney" }, { type: "healParty" }],
    beforeHash: "before",
    afterHash: "after",
    beforeData: "不应进入摘要",
    afterData: "不应进入摘要",
  });

  assert.equal(summary.operationCount, 2);
  assert.equal(Object.hasOwn(summary, "beforeData"), false);
  assert.equal(Object.hasOwn(summary, "afterData"), false);
});

test("备份按时间倒序和条数上限裁剪，且不修改输入数组", () => {
  const records = [
    { txId: "old", createdAt: "2026-08-05T08:00:00.000Z" },
    { txId: "new", createdAt: "2026-08-05T10:00:00.000Z" },
    { txId: "middle", createdAt: "2026-08-05T09:00:00.000Z" },
  ];
  const originalOrder = records.map(record => record.txId);

  const kept = pruneBackups(records, { maxRecords: 2, maxBytes: 1_000_000 });
  assert.deepEqual(kept.map(record => record.txId), ["new", "middle"]);
  assert.deepEqual(records.map(record => record.txId), originalOrder);
});

test("备份按 UTF-8 字节预算跳过过大记录，并继续保留后续可容纳记录", () => {
  const newest = { txId: "new", createdAt: "2026-08-05T10:00:00.000Z", payload: "新" };
  const oversized = {
    txId: "large",
    createdAt: "2026-08-05T09:00:00.000Z",
    payload: "大".repeat(200),
  };
  const oldest = { txId: "old", createdAt: "2026-08-05T08:00:00.000Z", payload: "旧" };
  const encodedBytes = record => new TextEncoder().encode(JSON.stringify(record)).byteLength + 1;
  const maxBytes = 2 + encodedBytes(newest) + encodedBytes(oldest);

  const kept = pruneBackups([oldest, oversized, newest], { maxRecords: 10, maxBytes });
  assert.deepEqual(kept.map(record => record.txId), ["new", "old"]);
});

test("未确认事务不会被 20 条更新记录或字节预算裁掉", () => {
  const uncertain = {
    txId: "must-keep",
    createdAt: "2026-08-01T00:00:00.000Z",
    status: "uncertain",
    payload: "保".repeat(300),
  };
  const newer = Array.from({ length: 25 }, (_, index) => ({
    txId: `terminal-${index}`,
    createdAt: `2026-08-05T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    status: "verified",
    payload: "新".repeat(10),
  }));

  const kept = pruneBackups([uncertain, ...newer], { maxRecords: 20, maxBytes: 200 });
  assert.ok(kept.some(record => record.txId === "must-keep"));
  assert.ok(kept.length <= 20);
});

test("刚完成的事务可被调用方固定保留，即使已有大量未确认记录", () => {
  const pending = Array.from({ length: 20 }, (_, index) => ({
    txId: `pending-${index}`,
    createdAt: `2026-08-04T${String(index).padStart(2, "0")}:00:00.000Z`,
    status: "uncertain",
  }));
  const finalized = {
    txId: "just-finalized",
    createdAt: "2026-08-06T00:00:00.000Z",
    status: "verified",
  };
  const kept = pruneBackups([finalized, ...pending], {
    maxRecords: 20,
    maxBytes: 1_000_000,
    preserveTxIds: [finalized.txId],
  });
  assert.equal(kept.length, 21);
  assert.ok(kept.some(record => record.txId === finalized.txId));
  assert.equal(kept.filter(record => record.status === "uncertain").length, 20);
});

test("通信异常锁会按 clientRequestId 精确绑定审计，旧锁只在唯一候选时绑定", () => {
  const clientRequestId = "11111111-1111-4111-8111-111111111111";
  assert.equal(isClientRequestId(clientRequestId), true);
  const run = { slotId: 0, seed: "same-run", gameVersion: "1.12.0.10" };
  const backups = [
    {
      txId: "matching-request",
      clientRequestId,
      status: "uncertain",
      slot: 1,
      run: { seed: "other-run" },
      gameVersion: "1.12.0.10",
    },
    {
      txId: "current-run",
      status: "uncertain",
      slot: 0,
      run: { seed: "same-run" },
      gameVersion: "1.12.0.10",
    },
  ];

  assert.equal(
    selectSafetyLockAudit({ clientRequestId, txId: null }, backups, run)?.txId,
    "matching-request",
  );
  assert.equal(
    selectSafetyLockAudit(
      { clientRequestId: "22222222-2222-4222-8222-222222222222", txId: null },
      backups,
      run,
    ),
    null,
  );
  assert.equal(selectSafetyLockAudit({ txId: null }, backups, run)?.txId, "current-run");
  assert.equal(selectSafetyLockAudit(null, backups, run)?.txId, "current-run");

  const duplicateCurrent = [...backups, { ...backups[1], txId: "current-run-2" }];
  assert.equal(selectSafetyLockAudit({ txId: null }, duplicateCurrent, run), null);
});
