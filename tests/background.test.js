import assert from "node:assert/strict";
import { test } from "node:test";

const BACKUP_KEY = "roguesave.backups.v1";
const REQUEST_KEY = "roguesave.request-registry.v1";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);

let storageData = {};
let storageSetCalls = 0;
let failStorageSetAt = null;
let pageHandler = async () => ({ ok: false, code: "UNCONFIGURED", message: "test page handler missing" });
let messageListener = null;
let requestSequence = 0;
let activeTabId = 77;
let missingTabIds = new Set();

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: {
      addListener(listener) {
        messageListener = listener;
      },
    },
  },
  sidePanel: {
    async setPanelBehavior() {},
  },
  storage: {
    local: {
      async setAccessLevel() {},
      async get(key) {
        return { [key]: structuredClone(storageData[key]) };
      },
      async set(patch) {
        storageSetCalls += 1;
        if (storageSetCalls === failStorageSetAt) throw new Error("simulated quota failure");
        storageData = { ...storageData, ...structuredClone(patch) };
      },
    },
  },
  tabs: {
    async query() {
      return [{ id: activeTabId, url: "https://pokerogue.net/" }];
    },
    async get(tabId) {
      if (missingTabIds.has(tabId)) throw new Error(`No tab with id: ${tabId}.`);
      return { id: tabId, url: "https://pokerogue.net/", discarded: false };
    },
  },
  scripting: {
    async executeScript(options) {
      return [{ result: await pageHandler(options.args[0]) }];
    },
  },
};

await import("../src/background/service-worker.js");

function resetMocks() {
  storageData = {};
  storageSetCalls = 0;
  failStorageSetAt = null;
  activeTabId = 77;
  missingTabIds = new Set();
  pageHandler = async () => ({ ok: false, code: "UNCONFIGURED", message: "test page handler missing" });
}

function nextClientRequestId() {
  requestSequence += 1;
  return `00000000-0000-4000-8000-${String(requestSequence).padStart(12, "0")}`;
}

function send(message) {
  assert.equal(typeof messageListener, "function");
  return new Promise(resolve => {
    const asynchronous = messageListener(message, {}, resolve);
    assert.equal(asynchronous, true);
  });
}

function inspection({
  runtimeHash = "runtime-before",
  backendHash = HASH_B,
  persistenceInSync = true,
  readOnly = false,
  pageInstanceId = "11111111-1111-4111-8111-111111111111",
  waveIndex = 188,
} = {}) {
  return {
    ok: true,
    adapterVersion: "0.4.4",
    pageInstanceId,
    model: {
      readOnly,
      readOnlyReason: readOnly ? "simulated read-only state" : "",
      persistenceInSync,
      hash: runtimeHash,
      backendHash,
      run: {
        accountIdentity: "101:202",
        slotId: 0,
        displaySlot: 1,
        name: "第一存档",
        seed: "test-seed",
        waveIndex,
        turn: 3,
        mode: "经典模式",
        gameVersion: "1.12.0.10",
        phase: "CommandPhase",
      },
    },
    backup: {
      fullHash: HASH_A,
      editableHash: HASH_C,
      backendHash,
      session: {
        name: "第一存档",
        seed: "test-seed",
        waveIndex,
        gameVersion: "1.12.0.10",
        money: 12345,
        party: [],
        modifiers: [],
      },
    },
  };
}

function mockAccountFlow({ commitResult = null, commitThrows = false } = {}) {
  const system = { trainerId: 101, secretId: 202, voucherCounts: { 0: 2 }, eggs: [] };
  let commits = 0;
  pageHandler = async request => {
    if (request.command === "inspect") return inspection();
    if (request.command === "account-preview") return { ok: true, expectedSystem: system, operations: request.payload.operations,
      diffs: [{ label: "普通券", before: 2, after: 300 }] };
    if (request.command === "account-commit") {
      commits += 1;
      assert.equal(storageData[BACKUP_KEY][0].kind, "account", "backup must exist before account persistence");
      assert.deepEqual(storageData[BACKUP_KEY][0].beforeSystem, system);
      if (commitThrows) throw new Error("page disconnected");
      return commitResult || { ok: true, code: "VERIFIED", status: "verified", adapterVersion: "0.4.4",
        afterSystem: { ...system, voucherCounts: { 0: 300 } }, message: "saved" };
    }
    throw new Error(`unexpected ${request.command}`);
  };
  return { system, commits: () => commits, request: () => ({ type: "ACCOUNT_COMMIT", clientRequestId: nextClientRequestId(),
    expectedSystem: system, operations: [{ type: "setVoucher", key: "0", value: 300 }] }) };
}

test("account saves keep private before/after snapshots in local backup and omit them from results", async () => {
  resetMocks(); const fixture = mockAccountFlow();
  const result = await send(fixture.request());
  assert.equal(result.code, "VERIFIED"); assert.equal(fixture.commits(), 1);
  assert.equal(Object.hasOwn(result, "afterSystem"), false);
  assert.deepEqual(storageData[BACKUP_KEY][0].afterSystem.voucherCounts, { 0: 300 });
  assert.equal(storageData[BACKUP_KEY][0].accountIdentity, "101:202");
});

test("account JSON transport retains nullable fields across page IPC without exposing private data", async () => {
  resetMocks(); const fixture = mockAccountFlow();
  fixture.system.starterData = { 146: { friendship: 0, moveset: null } };
  const operations = [{ type: "setVoucher", key: "0", value: 300 }];
  const beforeJson = JSON.stringify(fixture.system);
  pageHandler = async request => {
    if (request.command === "inspect") return inspection();
    if (request.command === "account-preview") return { ok: true, expectedSystem: {}, expectedSystemJson: beforeJson, operations,
      diffs: [{ label: "普通券", before: 2, after: 300 }] };
    assert.equal(request.command, "account-commit");
    assert.deepEqual(JSON.parse(request.payload.expectedSystemJson), fixture.system);
    assert.deepEqual(storageData[BACKUP_KEY][0].beforeSystem, fixture.system);
    return { ok: true, code: "VERIFIED", status: "verified", adapterVersion: "0.4.4", afterSystem: {},
      afterSystemJson: JSON.stringify({ ...fixture.system, voucherCounts: { 0: 300 } }), message: "saved" };
  };
  const result = await send({ type: "ACCOUNT_COMMIT", clientRequestId: nextClientRequestId(), operations,
    expectedSystem: {}, expectedSystemJson: beforeJson });
  assert.equal(result.code, "VERIFIED");
  assert.equal(Object.hasOwn(result, "afterSystem"), false);
  assert.equal(Object.hasOwn(result, "afterSystemJson"), false);
  assert.equal(storageData[BACKUP_KEY][0].afterSystem.starterData[146].moveset, null);
});

test("account requests cannot replay even if their visible backup has been pruned", async () => {
  resetMocks(); const fixture = mockAccountFlow(); const request = fixture.request();
  assert.equal((await send(request)).ok, true);
  storageData[BACKUP_KEY] = [];
  const second = await send(request);
  assert.equal(second.ok, false); assert.equal(fixture.commits(), 1);
});

test("account backup quota failure stops before touching the game's account save API", async () => {
  resetMocks(); const fixture = mockAccountFlow(); failStorageSetAt = 2;
  const result = await send(fixture.request());
  assert.equal(result.ok, false); assert.equal(fixture.commits(), 0);
});

test("stale account preview is rejected before creating a backup or saving", async () => {
  resetMocks(); const fixture = mockAccountFlow(); const request = fixture.request(); request.expectedSystem = { ...fixture.system, voucherCounts: { 0: 1 } };
  const result = await send(request);
  assert.equal(result.code, "STALE"); assert.equal(fixture.commits(), 0);
  assert.equal(storageData[BACKUP_KEY]?.length || 0, 0);
});

test("account background accepts elapsed play time and reordered keys, backing up the fresh timer", async () => {
  resetMocks(); const fixture = mockAccountFlow();
  fixture.system.gameStats = { playTime: 105, eggsPulled: 2 };
  const request = fixture.request();
  request.expectedSystem = { eggs: [], gameStats: { eggsPulled: 2, playTime: 100 },
    voucherCounts: { 0: 2 }, secretId: 202, trainerId: 101 };
  const result = await send(request);
  assert.equal(result.code, "VERIFIED"); assert.equal(fixture.commits(), 1);
  assert.equal(storageData[BACKUP_KEY][0].beforeSystem.gameStats.playTime, 105);
});

test("elapsed play time never hides a genuine account statistic change", async () => {
  resetMocks(); const fixture = mockAccountFlow();
  fixture.system.gameStats = { playTime: 105, eggsPulled: 3 };
  const request = fixture.request();
  request.expectedSystem = { ...fixture.system, gameStats: { playTime: 100, eggsPulled: 2 } };
  const result = await send(request);
  assert.equal(result.code, "STALE"); assert.equal(fixture.commits(), 0);
  assert.equal(storageData[BACKUP_KEY]?.length || 0, 0);
});

test("account disconnect or an incomplete save protocol persists uncertainty", async () => {
  for (const options of [{ commitThrows: true }, { commitResult: { ok: true, code: "VERIFIED", status: "verified", afterSystem: {} } }]) {
    resetMocks(); const fixture = mockAccountFlow(options);
    const result = await send(fixture.request());
    assert.equal(result.code, "UNCERTAIN");
    assert.equal(storageData[BACKUP_KEY][0].status, "uncertain");
  }
});

test("uncertain account write blocks new writes for the account after changing waves and slots", async () => {
  resetMocks(); const fixture = mockAccountFlow({ commitThrows: true });
  await send(fixture.request()); let called = false;
  pageHandler = async request => {
    if (request.command === "inspect") { const result = inspection({ waveIndex: 500 }); result.model.run.slotId = 2; return result; }
    called = true; throw new Error("should not execute");
  };
  const result = await send(fixture.request());
  assert.equal(result.code, "SAFETY_LOCKED"); assert.equal(called, false);
});

test("account uncertainty only clears from the same account on a new page after the old tab stops", async () => {
  resetMocks(); const fixture = mockAccountFlow({ commitThrows: true });
  const result = await send(fixture.request());
  pageHandler = async request => request.command === "inspect" ? inspection() : { ok: true, system: fixture.system };
  assert.equal((await send({ type: "ACKNOWLEDGE_UNCERTAIN", txId: result.txId })).code, "RELOAD_REQUIRED");
  activeTabId = 88; missingTabIds.add(77);
  pageHandler = async request => request.command === "inspect" ? inspection({ pageInstanceId: "22222222-2222-4222-8222-222222222222", waveIndex: 500 }) : { ok: true, system: fixture.system };
  const acknowledged = await send({ type: "ACKNOWLEDGE_UNCERTAIN", txId: result.txId });
  assert.equal(acknowledged.ok, true, acknowledged.message);
  assert.ok(storageData[BACKUP_KEY][0].acknowledgedAt);
});

test("public INSPECT never exposes the full session object to the side panel", async () => {
  resetMocks();
  pageHandler = async request => {
    assert.equal(request.command, "inspect");
    return inspection();
  };
  const result = await send({ type: "INSPECT" });
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.backup, "session"), false);
  assert.equal(result.backup.fullHash, HASH_A);
});

test("account legendary egg requests are validated and forwarded without species data", async () => {
  resetMocks();
  pageHandler = async request => {
    if (request.command === "inspect") return inspection();
    if (request.command === "account-preview") return { ok: true, expectedSystem: { eggs: [] }, diffs: [{ label: "随机传说蛋" }] };
    assert.equal(request.command, "account-commit");
    assert.equal(request.payload.operations[0].source, "shiny");
    assert.equal(request.payload.operations[0].count, 2);
    assert.equal(Object.hasOwn(request.payload.operations[0], "species"), false);
    return {
      ok: true,
      code: "VERIFIED",
      status: "verified",
      adapterVersion: "0.4.4",
      afterSystem: { eggs: [{ id: 1 }, { id: 2 }] },
      message: "saved",
      account: { eggCount: 2, maxEggs: 99, added: 2, source: "shiny", hatchWaves: 100 },
    };
  };
  const result = await send({
    type: "ADD_LEGENDARY_EGGS",
    clientRequestId: nextClientRequestId(),
    source: "shiny",
    count: 2,
  });
  assert.equal(result.ok, true);
  assert.equal(storageData[BACKUP_KEY][0].kind, "account");
  assert.deepEqual(storageData[BACKUP_KEY][0].beforeSystem, { eggs: [] });
  assert.equal(Object.hasOwn(result, "afterSystem"), false);
  assert.doesNotMatch(JSON.stringify(result), /species/);

  const invalid = await send({
    type: "ADD_LEGENDARY_EGGS",
    clientRequestId: nextClientRequestId(),
    source: "unknown",
    count: 1,
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "INVALID_SOURCE");
});

test("one-shot rare encounter arm and cancel commands are forwarded without a species preview", async () => {
  resetMocks();
  const commands = [];
  pageHandler = async request => {
    commands.push(request.command);
    return {
      ok: true,
      code: request.command === "arm-rare-encounter" ? "ARMED" : "CANCELLED",
      rareEncounter: {
        supported: true,
        armed: request.command === "arm-rare-encounter",
        armedAtWave: request.command === "arm-rare-encounter" ? 188 : null,
        message: "status only",
      },
    };
  };

  const armed = await send({ type: "ARM_RARE_ENCOUNTER" });
  const cancelled = await send({ type: "CANCEL_RARE_ENCOUNTER" });
  assert.deepEqual(commands, ["arm-rare-encounter", "cancel-rare-encounter"]);
  assert.equal(armed.rareEncounter.armed, true);
  assert.equal(cancelled.rareEncounter.armed, false);
  assert.doesNotMatch(JSON.stringify([armed, cancelled]), /species/i);
});

test("the global write lock rejects a second transaction before any await", async () => {
  resetMocks();
  let resolvePageCommit;
  let signalCommitStarted;
  const commitStarted = new Promise(resolve => { signalCommitStarted = resolve; });
  const pageCommit = new Promise(resolve => { resolvePageCommit = resolve; });
  pageHandler = async request => {
    if (request.command === "inspect") return inspection();
    if (request.command === "commit") {
      signalCommitStarted();
      return await pageCommit;
    }
    throw new Error(`unexpected page command ${request.command}`);
  };

  const first = send({
    type: "COMMIT",
    clientRequestId: nextClientRequestId(),
    expectedHash: "runtime-before",
    expectedBackendHash: HASH_B,
    operations: [{ type: "setMoney", value: 300000 }],
  });
  await commitStarted;
  const second = await send({
    type: "COMMIT",
    clientRequestId: nextClientRequestId(),
    expectedHash: "runtime-before",
    expectedBackendHash: HASH_B,
    operations: [{ type: "setMoney", value: 400000 }],
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, "BUSY");

  resolvePageCommit({
    ok: true,
    code: "VERIFIED",
    status: "verified",
    message: "saved",
    adapterVersion: "0.4.4",
    slotId: 0,
    waveIndex: 188,
    afterHash: HASH_D,
    afterBackendHash: HASH_C,
  });
  assert.equal((await first).ok, true);
});

test("an audit quota failure cannot overwrite a verified page result", async () => {
  resetMocks();
  pageHandler = async request => request.command === "inspect"
    ? inspection()
    : {
      ok: true,
      code: "VERIFIED",
      status: "verified",
      message: "页面已完整验证",
      adapterVersion: "0.4.4",
      slotId: 0,
      waveIndex: 188,
      afterHash: HASH_D,
      afterBackendHash: HASH_C,
    };
  // First set claims the request ID, second stores the prepared snapshot, and
  // the third tries to finalize it.
  failStorageSetAt = 3;
  const result = await send({
    type: "COMMIT",
    clientRequestId: nextClientRequestId(),
    expectedHash: "runtime-before",
    expectedBackendHash: HASH_B,
    operations: [{ type: "setMoney", value: 300000 }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "verified");
  assert.match(result.auditWarning, /审计记录更新失败/);
  assert.equal(storageData[BACKUP_KEY][0].status, "prepared");
});

test("a contradictory page success response is normalized to uncertain", async () => {
  resetMocks();
  pageHandler = async request => request.command === "inspect"
    ? inspection()
    : {
      ok: true,
      code: "VERIFIED",
      message: "missing verified status",
      adapterVersion: "0.4.4",
      slotId: 0,
      waveIndex: 188,
      afterHash: HASH_D,
      afterBackendHash: HASH_C,
    };

  const result = await send({
    type: "COMMIT",
    clientRequestId: nextClientRequestId(),
    expectedHash: "runtime-before",
    expectedBackendHash: HASH_B,
    operations: [{ type: "setMoney", value: 300000 }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "UNCERTAIN_PROTOCOL");
  assert.equal(result.status, "uncertain");
  assert.equal(storageData[BACKUP_KEY][0].status, "uncertain");
});

test("incomplete or mixed page write results are normalized to uncertain", async () => {
  const invalidResults = [
    [],
    {},
    { ok: false },
    { ok: false, code: "FAILED" },
    { ok: false, code: "FUTURE_FAILURE", status: "failed", message: "unknown", adapterVersion: "0.4.4" },
    { ok: true, code: "VERIFIED", status: "uncertain", message: "mixed signals" },
    {
      ok: true,
      code: "VERIFIED",
      status: "verified",
      message: "missing hashes",
      adapterVersion: "0.4.4",
      slotId: 0,
      waveIndex: 188,
    },
  ];

  for (const invalidResult of invalidResults) {
    resetMocks();
    pageHandler = async request => request.command === "inspect" ? inspection() : invalidResult;
    const result = await send({
      type: "COMMIT",
      clientRequestId: nextClientRequestId(),
      expectedHash: "runtime-before",
      expectedBackendHash: HASH_B,
      operations: [{ type: "setMoney", value: 300000 }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNCERTAIN_PROTOCOL");
    assert.equal(result.status, "uncertain");
    assert.equal(storageData[BACKUP_KEY][0].status, "uncertain");
  }
});

test("undo forwards the original operation list and full backup hash", async () => {
  resetMocks();
  const targetOperations = [{ type: "setMoney", value: 300000 }];
  storageData[BACKUP_KEY] = [{
    schemaVersion: 1,
    txId: "verified-target",
    kind: "commit",
    createdAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:00:01.000Z",
    slot: 0,
    run: { name: "第一存档", seed: "test-seed", waveIndex: 188, turn: 3, mode: "经典模式" },
    gameVersion: "1.12.0.10",
    beforeHash: "runtime-before",
    afterHash: HASH_D,
    beforeFullHash: HASH_A,
    beforeEditableHash: HASH_B,
    beforeBackendHash: HASH_B,
    afterBackendHash: HASH_C,
    before: inspection().backup.session,
    operations: targetOperations,
    status: "verified",
  }];
  let undoPayload = null;
  pageHandler = async request => {
    if (request.command === "inspect") return inspection({ runtimeHash: HASH_D, backendHash: HASH_C });
    if (request.command === "undo") {
      undoPayload = request.payload;
      return {
        ok: true,
        code: "VERIFIED",
        status: "verified",
        message: "undone",
        adapterVersion: "0.4.4",
        slotId: 0,
        waveIndex: 188,
        afterHash: HASH_E,
        afterBackendHash: HASH_B,
      };
    }
    throw new Error(`unexpected page command ${request.command}`);
  };

  const result = await send({
    type: "UNDO",
    clientRequestId: nextClientRequestId(),
    txId: "verified-target",
    expectedBackendHash: HASH_C,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(undoPayload.operations, targetOperations);
  assert.equal(undoPayload.expectedBeforeFullHash, HASH_A);
  assert.equal(storageData[BACKUP_KEY].find(record => record.txId === "verified-target").status, "rolled-back");
});

test("undo keeps its oldest target audit under history pressure before and after an uncertain page result", async () => {
  resetMocks();
  const target = {
    schemaVersion: 1,
    txId: "oldest-undo-target",
    kind: "commit",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:01.000Z",
    slot: 0,
    run: { name: "第一存档", seed: "test-seed", waveIndex: 188, turn: 3, mode: "经典模式" },
    gameVersion: "1.12.0.10",
    beforeHash: "runtime-before",
    afterHash: HASH_D,
    beforeFullHash: HASH_A,
    beforeEditableHash: HASH_B,
    beforeBackendHash: HASH_B,
    afterBackendHash: HASH_C,
    before: inspection().backup.session,
    operations: [{ type: "setMoney", value: 300000 }],
    status: "verified",
  };
  const fillers = Array.from({ length: 19 }, (_, index) => ({
    txId: `newer-terminal-${index}`,
    kind: "commit",
    createdAt: `2026-08-05T${String(index).padStart(2, "0")}:00:00.000Z`,
    updatedAt: `2026-08-05T${String(index).padStart(2, "0")}:00:01.000Z`,
    status: "verified",
  }));
  storageData[BACKUP_KEY] = [target, ...fillers];
  let undoCalls = 0;
  pageHandler = async request => {
    if (request.command === "inspect") return inspection({ runtimeHash: HASH_D, backendHash: HASH_C });
    undoCalls += 1;
    return {
      ok: false,
      code: "UNCERTAIN",
      status: "uncertain",
      message: "simulated uncertain undo",
    };
  };

  const result = await send({
    type: "UNDO",
    clientRequestId: nextClientRequestId(),
    txId: target.txId,
    expectedBackendHash: HASH_C,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "uncertain");
  assert.equal(undoCalls, 1);
  assert.ok(storageData[BACKUP_KEY].some(record => record.txId === target.txId));
  assert.ok(storageData[BACKUP_KEY].some(record => record.kind === "undo" && record.status === "uncertain"));
});

test("a contradictory undo success never marks its target rolled back", async () => {
  resetMocks();
  storageData[BACKUP_KEY] = [{
    schemaVersion: 1,
    txId: "verified-target-protocol",
    kind: "commit",
    createdAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:00:01.000Z",
    slot: 0,
    run: { name: "第一存档", seed: "test-seed", waveIndex: 188, turn: 3, mode: "经典模式" },
    gameVersion: "1.12.0.10",
    beforeHash: "runtime-before",
    afterHash: HASH_D,
    beforeFullHash: HASH_A,
    beforeEditableHash: HASH_B,
    beforeBackendHash: HASH_B,
    afterBackendHash: HASH_C,
    before: inspection().backup.session,
    operations: [{ type: "setMoney", value: 300000 }],
    status: "verified",
  }];
  pageHandler = async request => request.command === "inspect"
    ? inspection({ runtimeHash: HASH_D, backendHash: HASH_C })
    : {
      ok: true,
      code: "VERIFIED",
      message: "missing verified status",
      adapterVersion: "0.4.4",
      slotId: 0,
      waveIndex: 188,
      afterHash: HASH_E,
      afterBackendHash: HASH_B,
    };

  const result = await send({
    type: "UNDO",
    clientRequestId: nextClientRequestId(),
    txId: "verified-target-protocol",
    expectedBackendHash: HASH_C,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "UNCERTAIN_PROTOCOL");
  assert.equal(result.status, "uncertain");
  assert.equal(
    storageData[BACKUP_KEY].find(record => record.txId === "verified-target-protocol").status,
    "verified",
  );
});

test("an abandoned prepared transaction is reconciled to uncertain", async () => {
  resetMocks();
  storageData[BACKUP_KEY] = [{
    schemaVersion: 1,
    txId: "abandoned-tx",
    kind: "commit",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    slot: 0,
    run: { seed: "test-seed", waveIndex: 188 },
    gameVersion: "1.12.0.10",
    status: "prepared",
    operations: [{ type: "setMoney", value: 300000 }],
  }];
  const result = await send({ type: "LIST_BACKUPS" });
  assert.equal(result.ok, true);
  assert.equal(result.backups[0].status, "uncertain");
  assert.match(result.backups[0].error, /中断/);
  assert.equal(storageData[BACKUP_KEY][0].status, "uncertain");
});

test("an unresolved audit record blocks writes until a successful manual refresh acknowledges it", async () => {
  resetMocks();
  storageData[BACKUP_KEY] = [{
    schemaVersion: 1,
    txId: "unresolved-tx",
    kind: "commit",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slot: 0,
    run: { name: "第一存档", seed: "test-seed", waveIndex: 188, turn: 3, mode: "经典模式" },
    gameVersion: "1.12.0.10",
    origin: "https://pokerogue.net",
    tabId: 77,
    pageInstanceId: "11111111-1111-4111-8111-111111111111",
    status: "uncertain",
    operations: [{ type: "setMoney", value: 300000 }],
  }];
  let pageCommitCalls = 0;
  let persistenceInSync = false;
  pageHandler = async request => {
    if (request.command === "inspect") return inspection({ persistenceInSync });
    if (request.command === "commit") {
      pageCommitCalls += 1;
      return {
        ok: true,
        code: "VERIFIED",
        status: "verified",
        message: "saved",
        adapterVersion: "0.4.4",
        slotId: 0,
        waveIndex: 188,
        afterHash: HASH_D,
        afterBackendHash: HASH_C,
      };
    }
    throw new Error(`unexpected page command ${request.command}`);
  };

  const blocked = await send({
    type: "COMMIT",
    clientRequestId: nextClientRequestId(),
    expectedHash: "runtime-before",
    expectedBackendHash: HASH_B,
    operations: [{ type: "setMoney", value: 300000 }],
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "SAFETY_LOCKED");
  assert.equal(blocked.status, "uncertain");
  assert.equal(pageCommitCalls, 0);

  const refusedAcknowledgement = await send({
    type: "ACKNOWLEDGE_UNCERTAIN",
    txId: "unresolved-tx",
  });
  assert.equal(refusedAcknowledgement.ok, false);
  assert.equal(refusedAcknowledgement.code, "RELOAD_REQUIRED");
  assert.equal(storageData[BACKUP_KEY][0].acknowledgedAt, undefined);

  persistenceInSync = true;
  const acknowledged = await send({
    type: "ACKNOWLEDGE_UNCERTAIN",
    txId: "unresolved-tx",
  });
  assert.equal(acknowledged.ok, true);
  assert.equal(acknowledged.acknowledged, 1);
  assert.ok(storageData[BACKUP_KEY][0].acknowledgedAt);

  const committed = await send({
    type: "COMMIT",
    clientRequestId: nextClientRequestId(),
    expectedHash: "runtime-before",
    expectedBackendHash: HASH_B,
    operations: [{ type: "setMoney", value: 300000 }],
  });
  assert.equal(committed.ok, true, committed.message);
  assert.equal(pageCommitCalls, 1);
});

test("acknowledgement is scoped to the exact current run", async () => {
  resetMocks();
  const base = {
    schemaVersion: 1,
    kind: "commit",
    createdAt: "2026-08-06T01:00:00.000Z",
    updatedAt: "2026-08-06T01:00:00.000Z",
    gameVersion: "1.12.0.10",
    origin: "https://pokerogue.net",
    status: "uncertain",
    operations: [{ type: "setMoney", value: 300000 }],
  };
  storageData[BACKUP_KEY] = [
    {
      ...base,
      txId: "current-run-uncertain",
      slot: 0,
      run: { seed: "test-seed", waveIndex: 188 },
      tabId: 77,
      pageInstanceId: "11111111-1111-4111-8111-111111111111",
    },
    {
      ...base,
      txId: "other-run-uncertain",
      slot: 1,
      run: { seed: "other-seed", waveIndex: 99 },
      pageInstanceId: "22222222-2222-4222-8222-222222222222",
    },
  ];
  pageHandler = async request => {
    assert.equal(request.command, "inspect");
    return inspection();
  };

  const result = await send({
    type: "ACKNOWLEDGE_UNCERTAIN",
    txId: "current-run-uncertain",
  });
  assert.equal(result.ok, true);
  assert.equal(result.acknowledged, 1);
  assert.ok(storageData[BACKUP_KEY].find(record => record.txId === "current-run-uncertain").acknowledgedAt);
  assert.equal(storageData[BACKUP_KEY].find(record => record.txId === "other-run-uncertain").acknowledgedAt, undefined);
});

test("an unresolved transaction quarantines the whole run but acknowledgement still requires its exact wave", async () => {
  resetMocks();
  storageData[BACKUP_KEY] = [{
    schemaVersion: 1,
    txId: "cross-wave-uncertain",
    kind: "commit",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slot: 0,
    run: { seed: "test-seed", waveIndex: 188 },
    gameVersion: "1.12.0.10",
    origin: "https://pokerogue.net",
    tabId: 77,
    pageInstanceId: "11111111-1111-4111-8111-111111111111",
    status: "uncertain",
    operations: [{ type: "setMoney", value: 300000 }],
  }];
  let commitCalls = 0;
  pageHandler = async request => {
    if (request.command === "inspect") return inspection({ waveIndex: 189 });
    if (request.command === "commit") commitCalls += 1;
    throw new Error(`unexpected page command ${request.command}`);
  };

  const blocked = await send({
    type: "COMMIT",
    clientRequestId: nextClientRequestId(),
    expectedHash: "runtime-before",
    expectedBackendHash: HASH_B,
    operations: [{ type: "setMoney", value: 400000 }],
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "SAFETY_LOCKED");
  assert.equal(commitCalls, 0);

  const acknowledgement = await send({
    type: "ACKNOWLEDGE_UNCERTAIN",
    txId: "cross-wave-uncertain",
  });
  assert.equal(acknowledgement.ok, false);
  assert.equal(acknowledgement.code, "RUN_MISMATCH");
  assert.equal(storageData[BACKUP_KEY][0].acknowledgedAt, undefined);
});

test("acknowledgement refuses a missing transaction id before inspecting the page", async () => {
  resetMocks();
  let inspectCalls = 0;
  pageHandler = async () => {
    inspectCalls += 1;
    return inspection();
  };

  const result = await send({ type: "ACKNOWLEDGE_UNCERTAIN" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_TX");
  assert.equal(inspectCalls, 0);
});

test("a recovered prepared transaction requires a writable reloaded page before acknowledgement", async () => {
  resetMocks();
  storageData[BACKUP_KEY] = [{
    schemaVersion: 1,
    txId: "recovered-prepared",
    kind: "commit",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slot: 0,
    run: { seed: "test-seed", waveIndex: 188 },
    gameVersion: "1.12.0.10",
    origin: "https://pokerogue.net",
    tabId: 77,
    pageInstanceId: "11111111-1111-4111-8111-111111111111",
    status: "prepared",
    operations: [{ type: "setMoney", value: 300000 }],
  }];
  await send({ type: "LIST_BACKUPS" });
  assert.equal(storageData[BACKUP_KEY][0].recoveryReason, "abandoned-prepared");

  pageHandler = async () => inspection({ readOnly: true });
  const readOnly = await send({ type: "ACKNOWLEDGE_UNCERTAIN", txId: "recovered-prepared" });
  assert.equal(readOnly.ok, false);
  assert.equal(readOnly.code, "READ_ONLY");

  pageHandler = async () => inspection();
  const samePage = await send({ type: "ACKNOWLEDGE_UNCERTAIN", txId: "recovered-prepared" });
  assert.equal(samePage.ok, false);
  assert.equal(samePage.code, "RELOAD_REQUIRED");

  pageHandler = async () => inspection({
    runtimeHash: HASH_D,
    pageInstanceId: "33333333-3333-4333-8333-333333333333",
  });
  const reloaded = await send({ type: "ACKNOWLEDGE_UNCERTAIN", txId: "recovered-prepared" });
  assert.equal(reloaded.ok, false);
  assert.equal(reloaded.code, "PAGE_MISMATCH");

  missingTabIds.add(77);
  activeTabId = 88;
  const reopened = await send({ type: "ACKNOWLEDGE_UNCERTAIN", txId: "recovered-prepared" });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.acknowledged, 1);
  assert.ok(storageData[BACKUP_KEY][0].acknowledgedAt);
});

test("an abandoned write cannot be acknowledged from another still-open game tab", async () => {
  resetMocks();
  storageData[BACKUP_KEY] = [{
    txId: "original-tab-still-open",
    kind: "commit",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slot: 0,
    run: { seed: "test-seed", waveIndex: 188 },
    gameVersion: "1.12.0.10",
    origin: "https://pokerogue.net",
    tabId: 77,
    pageInstanceId: "11111111-1111-4111-8111-111111111111",
    status: "prepared",
    operations: [{ type: "setMoney", value: 300000 }],
  }];
  await send({ type: "LIST_BACKUPS" });
  activeTabId = 88;
  let pageCalls = 0;
  pageHandler = async request => {
    pageCalls += 1;
    assert.equal(request.command, "inspect");
    return inspection({
      runtimeHash: HASH_D,
      pageInstanceId: "22222222-2222-4222-8222-222222222222",
    });
  };

  const result = await send({
    type: "ACKNOWLEDGE_UNCERTAIN",
    txId: "original-tab-still-open",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TAB_MISMATCH");
  assert.equal(pageCalls, 1);
  assert.equal(storageData[BACKUP_KEY][0].acknowledgedAt, undefined);
});

test("a closed original tab permits takeover only after two identical synced inspections", async () => {
  resetMocks();
  storageData[BACKUP_KEY] = [{
    txId: "closed-original-tab",
    kind: "commit",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slot: 0,
    run: { seed: "test-seed", waveIndex: 188 },
    gameVersion: "1.12.0.10",
    origin: "https://pokerogue.net",
    tabId: 77,
    pageInstanceId: "11111111-1111-4111-8111-111111111111",
    status: "prepared",
    operations: [{ type: "setMoney", value: 300000 }],
  }];
  await send({ type: "LIST_BACKUPS" });
  missingTabIds.add(77);
  activeTabId = 88;
  let pageCalls = 0;
  pageHandler = async request => {
    pageCalls += 1;
    assert.equal(request.command, "inspect");
    return inspection({
      runtimeHash: HASH_D,
      pageInstanceId: "22222222-2222-4222-8222-222222222222",
    });
  };

  const result = await send({ type: "ACKNOWLEDGE_UNCERTAIN", txId: "closed-original-tab" });
  assert.equal(result.ok, true);
  assert.equal(result.acknowledged, 1);
  assert.equal(pageCalls, 2);
  assert.ok(storageData[BACKUP_KEY][0].acknowledgedAt);
});

test("an orphaned request is durably cancelled before a delayed copy can reach the page", async () => {
  resetMocks();
  const clientRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let pageCalls = 0;
  pageHandler = async request => {
    pageCalls += 1;
    assert.equal(request.command, "inspect");
    return inspection({ runtimeHash: HASH_D });
  };

  const resolved = await send({ type: "RESOLVE_ORPHANED_REQUEST", clientRequestId });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.safeToClearLocalLock, true);
  assert.equal(resolved.resolution, "not-started-cancelled");
  assert.equal(pageCalls, 2);
  assert.equal(storageData[REQUEST_KEY][0].clientRequestId, clientRequestId);
  assert.equal(storageData[REQUEST_KEY][0].status, "cancelled-before-start");

  const replay = await send({
    type: "COMMIT",
    clientRequestId,
    expectedHash: HASH_D,
    expectedBackendHash: HASH_B,
    operations: [{ type: "setMoney", value: 300000 }],
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, "REQUEST_CANCELLED");
  assert.equal(pageCalls, 2);
});

test("orphan resolution binds an abandoned prepared audit without calling the page", async () => {
  resetMocks();
  const clientRequestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  storageData[REQUEST_KEY] = [{ clientRequestId, status: "accepted", createdAt: new Date().toISOString() }];
  storageData[BACKUP_KEY] = [{
    schemaVersion: 1,
    txId: "prepared-client-request",
    clientRequestId,
    kind: "commit",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slot: 0,
    run: { seed: "test-seed", waveIndex: 188 },
    gameVersion: "1.12.0.10",
    origin: "https://pokerogue.net",
    status: "prepared",
    operations: [{ type: "setMoney", value: 300000 }],
  }];
  let pageCalls = 0;
  pageHandler = async () => {
    pageCalls += 1;
    return inspection({ runtimeHash: HASH_D });
  };

  const result = await send({ type: "RESOLVE_ORPHANED_REQUEST", clientRequestId });
  assert.equal(result.ok, true);
  assert.equal(result.resolution, "audit-required");
  assert.equal(result.safeToClearLocalLock, false);
  assert.equal(result.txId, "prepared-client-request");
  assert.equal(pageCalls, 0);
  assert.equal(storageData[BACKUP_KEY][0].status, "uncertain");
  assert.equal(storageData[BACKUP_KEY][0].recoveryReason, "abandoned-prepared");
});

test("an unmatched request is cancelled before resolver points at an unrelated current-run audit", async () => {
  resetMocks();
  const orphanRequestId = "acacacac-acac-4cac-8cac-acacacacacac";
  const otherRequestId = "bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc";
  storageData[BACKUP_KEY] = [{
    txId: "other-current-run",
    clientRequestId: otherRequestId,
    kind: "commit",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slot: 0,
    run: { seed: "test-seed", waveIndex: 188 },
    gameVersion: "1.12.0.10",
    origin: "https://pokerogue.net",
    status: "uncertain",
    operations: [{ type: "setMoney", value: 300000 }],
  }];
  pageHandler = async request => {
    assert.equal(request.command, "inspect");
    return inspection({ runtimeHash: HASH_D });
  };

  const result = await send({
    type: "RESOLVE_ORPHANED_REQUEST",
    clientRequestId: orphanRequestId,
  });
  assert.equal(result.ok, true);
  assert.equal(result.resolution, "audit-required");
  assert.equal(result.txId, "other-current-run");
  assert.equal(result.clientRequestId, otherRequestId);
  assert.equal(
    storageData[REQUEST_KEY].find(record => record.clientRequestId === orphanRequestId)?.status,
    "cancelled-before-start",
  );
});

test("a terminal audit can clear an orphan lock only after two identical synced inspections", async () => {
  resetMocks();
  const clientRequestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  storageData[REQUEST_KEY] = [{ clientRequestId, status: "accepted", createdAt: new Date().toISOString() }];
  storageData[BACKUP_KEY] = [{
    txId: "terminal-client-request",
    clientRequestId,
    status: "verified",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }];
  let pageCalls = 0;
  pageHandler = async request => {
    pageCalls += 1;
    assert.equal(request.command, "inspect");
    return inspection({ runtimeHash: HASH_D });
  };

  const result = await send({ type: "RESOLVE_ORPHANED_REQUEST", clientRequestId });
  assert.equal(result.ok, true);
  assert.equal(result.resolution, "terminal");
  assert.equal(result.safeToClearLocalLock, true);
  assert.equal(result.txId, "terminal-client-request");
  assert.equal(pageCalls, 2);
});

test("orphan resolution stays locked if the game changes between its two inspections", async () => {
  resetMocks();
  const clientRequestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  let pageCalls = 0;
  pageHandler = async request => {
    assert.equal(request.command, "inspect");
    pageCalls += 1;
    return inspection({ runtimeHash: pageCalls === 1 ? HASH_D : HASH_E });
  };

  const result = await send({ type: "RESOLVE_ORPHANED_REQUEST", clientRequestId });
  assert.equal(result.ok, false);
  assert.equal(result.code, "STALE");
  assert.equal(result.safeToClearLocalLock, false);
  assert.equal(pageCalls, 2);
  assert.equal(storageData[REQUEST_KEY][0].status, "cancelled-before-start");
});

test("request registry storage failure aborts before inspection or page write", async () => {
  resetMocks();
  failStorageSetAt = 1;
  let pageCalls = 0;
  pageHandler = async () => {
    pageCalls += 1;
    return inspection();
  };

  const result = await send({
    type: "COMMIT",
    clientRequestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    expectedHash: "runtime-before",
    expectedBackendHash: HASH_B,
    operations: [{ type: "setMoney", value: 300000 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "COMMIT_FAILED");
  assert.equal(pageCalls, 0);
  assert.equal(storageData[BACKUP_KEY], undefined);
});

test("the replay registry is not truncated after 256 consumed request ids", async () => {
  resetMocks();
  storageData[REQUEST_KEY] = Array.from({ length: 300 }, (_, index) => ({
    clientRequestId: `12345678-1234-4123-8123-${String(index).padStart(12, "0")}`,
    status: "accepted",
    createdAt: new Date().toISOString(),
  }));
  let pageCalls = 0;
  pageHandler = async () => {
    pageCalls += 1;
    return inspection();
  };
  const clientRequestId = "99999999-9999-4999-8999-999999999999";

  const result = await send({
    type: "COMMIT",
    clientRequestId,
    expectedHash: "runtime-before",
    expectedBackendHash: HASH_B,
    operations: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_OPERATIONS");
  assert.equal(pageCalls, 0);
  assert.equal(storageData[REQUEST_KEY].length, 301);
  assert.ok(storageData[REQUEST_KEY].some(record => record.clientRequestId === clientRequestId));
  assert.ok(storageData[REQUEST_KEY].some(record => record.clientRequestId.endsWith("000000000000")));
});

test("a corrupted replay registry fails closed before the game page is inspected", async () => {
  resetMocks();
  storageData[REQUEST_KEY] = { invalid: true };
  let pageCalls = 0;
  pageHandler = async () => {
    pageCalls += 1;
    return inspection();
  };

  const result = await send({
    type: "COMMIT",
    clientRequestId: "abababab-abab-4bab-8bab-abababababab",
    expectedHash: "runtime-before",
    expectedBackendHash: HASH_B,
    operations: [{ type: "setMoney", value: 300000 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "COMMIT_FAILED");
  assert.match(result.message, /登记表结构损坏/);
  assert.equal(pageCalls, 0);
});

test("a consumed client request id cannot replay even after its terminal audit is pruned", async () => {
  resetMocks();
  const clientRequestId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  let pageCalls = 0;
  pageHandler = async request => {
    pageCalls += 1;
    if (request.command === "inspect") return inspection();
    return {
      ok: true,
      code: "VERIFIED",
      status: "verified",
      message: "saved",
      adapterVersion: "0.4.4",
      slotId: 0,
      waveIndex: 188,
      afterHash: HASH_D,
      afterBackendHash: HASH_C,
    };
  };
  const request = {
    type: "COMMIT",
    clientRequestId,
    expectedHash: "runtime-before",
    expectedBackendHash: HASH_B,
    operations: [{ type: "setMoney", value: 300000 }],
  };

  assert.equal((await send(request)).ok, true);
  assert.equal(pageCalls, 2);
  storageData[BACKUP_KEY] = [];
  const replay = await send(request);
  assert.equal(replay.ok, false);
  assert.equal(replay.code, "DUPLICATE_REQUEST");
  assert.equal(pageCalls, 2);
  assert.equal(storageData[REQUEST_KEY].length, 1);
});
