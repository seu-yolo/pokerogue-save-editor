import {
  EDITOR_VERSION,
  accountSnapshotString,
  backupSummary,
  isClientRequestId,
  pruneBackups,
} from "../shared/core.js";
import { pokeroguePageCommand } from "../game/page-adapter.js";
import { GAME_ORIGIN, GAME_URL_PATTERN } from "../shared/game-target.js";

const BACKUP_STORAGE_KEY = "roguesave.backups.v1";
const REQUEST_REGISTRY_STORAGE_KEY = "roguesave.request-registry.v1";

// Service-worker message handlers can overlap at every await. Acquiring this
// process-wide token synchronously makes the check-and-set atomic, even before
// the active tab or backup store is read.
let activeWriteLock = null;

// All backup reads and load-modify-set writes share one queue. This prevents a
// late audit update from overwriting a backup inserted by another handler.
let backupStorageTail = Promise.resolve();

async function hardenStorage() {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
    // Older Chromium builds do not expose setAccessLevel. This extension has no
    // content script, so its storage still remains outside the page context.
  }
}

async function configureSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // The manifest still exposes the side panel through Chrome's extension UI.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void hardenStorage();
  void configureSidePanel();
});
chrome.runtime.onStartup.addListener(() => {
  void hardenStorage();
  void configureSidePanel();
});
void hardenStorage();
void configureSidePanel();

function failure(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function acquireWriteLock(kind) {
  if (activeWriteLock) return null;
  const lock = {
    id: crypto.randomUUID(),
    kind,
    txId: null,
    clientRequestId: null,
    acquiredAt: Date.now(),
  };
  activeWriteLock = lock;
  return lock;
}

function releaseWriteLock(lock) {
  if (activeWriteLock === lock) activeWriteLock = null;
}

async function activeGameTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length !== 1 || !Number.isInteger(tabs[0].id)) {
    throw new Error("找不到当前活动标签页");
  }
  const tab = tabs[0];
  let url;
  try {
    url = new URL(tab.url || "");
  } catch {
    throw new Error(`请先打开 ${GAME_ORIGIN}/ 并进入一个对局`);
  }
  if (url.origin !== GAME_ORIGIN) {
    throw new Error(`当前标签页不是 ${GAME_ORIGIN}`);
  }
  const gameTabs = (await chrome.tabs.query({ url: [GAME_URL_PATTERN] })).filter(candidate => {
    try { return new URL(candidate.url).origin === GAME_ORIGIN; }
    catch { return false; }
  });
  const gameTabIds = gameTabs
    .map(candidate => candidate?.id)
    .filter(candidateId => Number.isInteger(candidateId));
  if (gameTabIds.length !== 1 || gameTabIds[0] !== tab.id) {
    throw new Error("请只保留一个 PokéRogue 游戏标签页，并让它保持当前活动状态");
  }
  return tab;
}

async function originalTabCanNoLongerRun(tabId) {
  if (!Number.isInteger(tabId)) return false;
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    if (/No tab with id/i.test(String(error?.message || ""))) return true;
    throw error;
  }
  if (!tab || tab.discarded === true) return true;
  // Navigating away is not sufficient: the prior PokéRogue document may be
  // frozen in BFCache and resume if the user navigates back.
  return false;
}

async function runInGame(tabId, request) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: pokeroguePageCommand,
    args: [request],
  });
  if (!Array.isArray(results) || results.length !== 1 || results[0].result == null) {
    throw new Error("游戏页面没有返回修改器结果");
  }
  return results[0].result;
}

function enqueueBackupStorage(operation) {
  const queued = backupStorageTail.then(operation);
  // A failed storage call must reject its caller without poisoning later work.
  backupStorageTail = queued.then(() => undefined, () => undefined);
  return queued;
}

async function readBackupsDirect() {
  const stored = await chrome.storage.local.get(BACKUP_STORAGE_KEY);
  const records = stored[BACKUP_STORAGE_KEY];
  if (records == null) return [];
  if (!Array.isArray(records) || records.some(record => !record || typeof record !== "object" || Array.isArray(record))) {
    throw new Error("本地审计存储结构损坏，已禁止继续写入");
  }
  return records;
}

async function readRequestRegistryDirect() {
  const stored = await chrome.storage.local.get(REQUEST_REGISTRY_STORAGE_KEY);
  const records = stored[REQUEST_REGISTRY_STORAGE_KEY];
  if (records == null) return [];
  if (!Array.isArray(records) || records.some(record => !record || typeof record !== "object" || Array.isArray(record))) {
    throw new Error("客户端请求登记表结构损坏，已禁止继续写入");
  }
  return records;
}

async function requestRegistryState(clientRequestId) {
  return await enqueueBackupStorage(async () => {
    const backups = await readBackupsDirect();
    const receipts = await readRequestRegistryDirect();
    return {
      records: backups.filter(record => record?.clientRequestId === clientRequestId),
      receipt: receipts.find(record => record?.clientRequestId === clientRequestId) || null,
    };
  });
}

async function claimClientRequestId(clientRequestId) {
  return await enqueueBackupStorage(async () => {
    const backups = await readBackupsDirect();
    const matchingRecords = backups.filter(record => record?.clientRequestId === clientRequestId);
    const receipts = await readRequestRegistryDirect();
    const existing = receipts.find(record => record?.clientRequestId === clientRequestId) || null;
    if (existing) return { claimed: false, records: matchingRecords, receipt: existing };

    const receipt = {
      clientRequestId,
      status: matchingRecords.length > 0 ? "accepted-existing-audit" : "accepted",
      createdAt: new Date().toISOString(),
    };
    // Request receipts are never pruned. If this compact replay registry ever
    // reaches the browser quota, the write fails before the game page is called.
    await chrome.storage.local.set({ [REQUEST_REGISTRY_STORAGE_KEY]: [receipt, ...receipts] });
    return { claimed: matchingRecords.length === 0, records: matchingRecords, receipt };
  });
}

async function cancelUnrecordedRequest(clientRequestId) {
  return await enqueueBackupStorage(async () => {
    const backups = await readBackupsDirect();
    const matchingRecords = backups.filter(record => record?.clientRequestId === clientRequestId);
    if (matchingRecords.length > 0) return { records: matchingRecords, receipt: null };

    const receipts = await readRequestRegistryDirect();
    const index = receipts.findIndex(record => record?.clientRequestId === clientRequestId);
    const updatedAt = new Date().toISOString();
    const receipt = index >= 0
      ? { ...receipts[index], status: "retired-without-audit", updatedAt }
      : { clientRequestId, status: "cancelled-before-start", createdAt: updatedAt, updatedAt };
    const next = [...receipts];
    if (index >= 0) next[index] = receipt;
    else next.unshift(receipt);
    await chrome.storage.local.set({ [REQUEST_REGISTRY_STORAGE_KEY]: next });
    return { records: [], receipt };
  });
}

async function loadBackups() {
  return await enqueueBackupStorage(() => readBackupsDirect());
}

async function mutateBackups(mutator) {
  return await enqueueBackupStorage(async () => {
    const records = await readBackupsDirect();
    const outcome = await mutator(records) || {};
    if (outcome.changed === false) {
      return { records, value: outcome.value };
    }
    const pruned = pruneBackups(records, { preserveTxIds: outcome.preserveTxIds || [] });
    await chrome.storage.local.set({ [BACKUP_STORAGE_KEY]: pruned });
    return { records: pruned, value: outcome.value };
  });
}

async function addBackup(record, { preserveTxIds = [] } = {}) {
  const requiredTxIds = [...new Set([record.txId, ...preserveTxIds])];
  const result = await mutateBackups(records => {
    records.unshift(record);
    return { changed: true, preserveTxIds: requiredTxIds };
  });
  const stored = result.records.find(item => item.txId === record.txId);
  if (!stored) throw new Error("新事务备份未能保留在审计存储中，已禁止写入");
  if (requiredTxIds.some(txId => !result.records.some(item => item.txId === txId))) {
    throw new Error("事务依赖的原始备份未能保留在审计存储中，已禁止写入");
  }
  return stored;
}

async function updateBackup(txId, patch) {
  const result = await mutateBackups(records => {
    const index = records.findIndex(record => record.txId === txId);
    if (index < 0) return { changed: false, value: null };
    records[index] = {
      ...records[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    return { changed: true, value: records[index], preserveTxIds: [txId] };
  });
  return result.records.find(record => record.txId === txId) || null;
}

async function finalizeUndoBackups(undoTxId, targetTxId, patch, rolledBack) {
  const result = await mutateBackups(records => {
    const undoIndex = records.findIndex(record => record.txId === undoTxId);
    if (undoIndex < 0) {
      throw new Error("撤销审计记录在写入结果返回前丢失");
    }
    const updatedAt = new Date().toISOString();
    records[undoIndex] = { ...records[undoIndex], ...patch, updatedAt };

    if (rolledBack) {
      const targetIndex = records.findIndex(record => record.txId === targetTxId);
      if (targetIndex >= 0) {
        records[targetIndex] = {
          ...records[targetIndex],
          status: "rolled-back",
          rolledBackBy: undoTxId,
          updatedAt,
        };
      }
    }
    return {
      changed: true,
      value: records[undoIndex],
      preserveTxIds: [undoTxId, targetTxId],
    };
  });
  return result.records.find(record => record.txId === undoTxId) || null;
}

async function reconcilePreparedBackups() {
  const now = Date.now();
  const activeTxId = activeWriteLock?.txId || null;
  const result = await mutateBackups(records => {
    let changed = false;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record.status !== "prepared" || record.txId === activeTxId) continue;
      records[index] = {
        ...record,
        status: "uncertain",
        error: record.error || "扩展曾在写入完成前中断；结果需要重新核对",
        recoveryReason: "abandoned-prepared",
        updatedAt: new Date(now).toISOString(),
      };
      changed = true;
    }
    return { changed };
  });
  return result.records;
}

function isUnacknowledgedUncertain(record) {
  return (record?.status === "prepared" || record?.status === "uncertain")
    && !record?.acknowledgedAt;
}

function recordMatchesRunIdentity(record, run) {
  if (record?.kind === "account") return record.origin === GAME_ORIGIN
    && /^\d+:\d+$/.test(record.accountIdentity || "") && record.accountIdentity === run?.accountIdentity;
  return record?.origin === GAME_ORIGIN
    && Number(record.slot) === Number(run?.slotId)
    && String(record.run?.seed ?? "") === String(run?.seed ?? "")
    && String(record.gameVersion ?? "") === String(run?.gameVersion ?? "");
}

function recordMatchesExactState(record, run) {
  if (record?.kind === "account") return recordMatchesRunIdentity(record, run);
  return recordMatchesRunIdentity(record, run)
    && Number(record.run?.waveIndex) === Number(run?.waveIndex);
}

function hasValidUnresolvedIdentity(record) {
  if (record?.kind === "account" && !/^\d+:\d+$/.test(record.accountIdentity || "")) return false;
  return typeof record?.txId === "string"
    && /^[a-zA-Z0-9-]{8,80}$/.test(record.txId)
    && record.origin === GAME_ORIGIN
    && Number.isInteger(record.slot)
    && record.slot >= 0
    && record.slot <= 4
    && typeof record.run?.seed === "string"
    && Number.isSafeInteger(record.run?.waveIndex)
    && record.run.waveIndex > 0
    && typeof record.gameVersion === "string"
    && record.gameVersion.length > 0;
}

async function unresolvedWriteQuarantines(run) {
  const records = await reconcilePreparedBackups();
  if (records.some(record => isUnacknowledgedUncertain(record) && !hasValidUnresolvedIdentity(record))) {
    throw new Error("存在身份字段不完整的未确认审计记录，已禁止继续写入");
  }
  return records.filter(record => isUnacknowledgedUncertain(record) && recordMatchesRunIdentity(record, run));
}

async function unresolvedWriteQuarantine(run) {
  return (await unresolvedWriteQuarantines(run))[0] || null;
}

function existingRequestFailure(clientRequestId, registry) {
  if (["cancelled-before-start", "retired-without-audit"].includes(registry.receipt?.status)) {
    return failure(
      "REQUEST_CANCELLED",
      "该请求已在通信恢复屏障中标记为未开始，已禁止迟到或重复执行",
      { clientRequestId, retryable: false },
    );
  }
  if (registry.records.length > 0) {
    const unique = registry.records.length === 1 ? registry.records[0] : null;
    return failure(
      unique ? "DUPLICATE_REQUEST" : "REQUEST_CONFLICT",
      unique
        ? "该请求已经有审计记录，不能重复执行；请刷新核对原事务"
        : "同一请求编号对应多条审计记录，已安全锁定",
      {
        clientRequestId,
        txId: unique?.txId || null,
        status: "uncertain",
        retryable: false,
      },
    );
  }
  if (registry.receipt) {
    return failure(
      "DUPLICATE_REQUEST",
      "该客户端请求编号已经登记，不能重复执行；请刷新核对原请求",
      {
        clientRequestId,
        txId: null,
        status: "uncertain",
        retryable: false,
      },
    );
  }
  return null;
}

async function acknowledgeUncertainBackups({
  txId,
  tabId,
  inspection,
  allowTabTakeover = false,
}) {
  const acknowledgedAt = new Date().toISOString();
  const outcome = overrides => ({
    count: 0,
    selected: 1,
    runMismatch: 0,
    reloadRequired: 0,
    tabMismatch: 0,
    pageMismatch: 0,
    originalTabId: null,
    ...overrides,
  });
  const result = await mutateBackups(records => {
    const matchingIndexes = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (isUnacknowledgedUncertain(record)
        && record.txId !== activeWriteLock?.txId
        && record.txId === txId) {
        matchingIndexes.push(index);
      }
    }
    if (matchingIndexes.length !== 1) {
      return {
        changed: false,
        value: outcome({ selected: matchingIndexes.length }),
      };
    }

    const index = matchingIndexes[0];
    const record = records[index];
    if (!recordMatchesExactState(record, inspection.model?.run)) {
      return { changed: false, value: outcome({ runMismatch: 1 }) };
    }

    if (!allowTabTakeover && (!Number.isInteger(record.tabId) || record.tabId !== tabId)) {
      return {
        changed: false,
        value: outcome({
          tabMismatch: 1,
          originalTabId: Number.isInteger(record.tabId) ? record.tabId : null,
        }),
      };
    }
    if (!allowTabTakeover
      && (!record.pageInstanceId || record.pageInstanceId !== inspection.pageInstanceId)) {
      return { changed: false, value: outcome({ pageMismatch: 1 }) };
    }
    if (allowTabTakeover
      && (!record.pageInstanceId || record.pageInstanceId === inspection.pageInstanceId)) {
      return { changed: false, value: outcome({ reloadRequired: 1 }) };
    }
    if (record.recoveryReason === "abandoned-prepared" && !allowTabTakeover) {
      return { changed: false, value: outcome({ reloadRequired: 1 }) };
    }
    records[index] = {
      ...record,
      status: record.status === "prepared" ? "uncertain" : record.status,
      error: record.error || "扩展曾在写入完成前中断；结果需要重新核对",
      recoveryReason: record.recoveryReason || "manual-refresh",
      acknowledgedAt,
      updatedAt: acknowledgedAt,
    };
    return {
      changed: true,
      value: outcome({ count: 1 }),
    };
  });
  return result.value || outcome({ selected: 0 });
}

function inspectionHashes(inspection) {
  const fullHash = typeof inspection?.backup?.fullHash === "string"
    ? inspection.backup.fullHash
    : "";
  const editableHash = typeof inspection?.backup?.editableHash === "string"
    ? inspection.backup.editableHash
    : "";
  const backupBackendHash = typeof inspection?.backup?.backendHash === "string"
    ? inspection.backup.backendHash
    : "";
  const modelBackendHash = typeof inspection?.model?.backendHash === "string"
    ? inspection.model.backendHash
    : "";
  if (!fullHash || !editableHash || !backupBackendHash || !modelBackendHash) return null;
  if (backupBackendHash !== modelBackendHash) return null;
  return { fullHash, editableHash, backendHash: backupBackendHash };
}

function createPreparedRecord({
  txId,
  clientRequestId,
  tabId,
  inspection,
  operations,
  kind = "commit",
  targetTxId = null,
}) {
  const run = inspection.model.run;
  const hashes = inspectionHashes(inspection);
  if (!hashes || !inspection.backup?.session
    || !Number.isInteger(tabId)
    || typeof inspection.pageInstanceId !== "string"
    || !/^[0-9a-f-]{36}$/i.test(inspection.pageInstanceId)) {
    throw new Error("页面适配器未返回完整的备份与本地持久化缓存摘要");
  }
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    hashSchemaVersion: 3,
    txId,
    clientRequestId,
    tabId,
    kind,
    targetTxId,
    createdAt,
    updatedAt: createdAt,
    extensionVersion: EDITOR_VERSION,
    gameVersion: run.gameVersion,
    origin: GAME_ORIGIN,
    pageInstanceId: inspection.pageInstanceId,
    slot: run.slotId,
    run: {
      name: run.name,
      seed: run.seed,
      waveIndex: run.waveIndex,
      turn: run.turn,
      mode: run.mode,
    },
    // beforeHash/afterHash remain as the volatile runtime guard used by the UI.
    beforeHash: inspection.model.hash,
    afterHash: null,
    // The full snapshot protects exported backups; the editable projection keeps
    // v1 JSON verification compatible; the backend hash guards persisted state.
    beforeFullHash: hashes.fullHash,
    beforeEditableHash: hashes.editableHash,
    beforeBackendHash: hashes.backendHash,
    afterBackendHash: null,
    beforeSessionHash: hashes.editableHash,
    before: inspection.backup.session,
    operations,
    status: "prepared",
    error: null,
  };
}

const SAFE_FAILED_PAGE_CODES = new Set([
  "INVALID_TX", "BUSY", "READ_ONLY", "STALE", "BACKEND_STALE",
  "APPLY_FAILED", "UNEXPECTED_DIFF", "COMMIT_FAILED",
  "VERSION_MISMATCH", "BACKUP_CORRUPT", "RUN_MISMATCH",
  "UNDO_APPLY_FAILED", "UNDO_FAILED",
]);

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function isVerifiedPageResult(result) {
  return result?.ok === true
    && String(result?.code || "").toUpperCase() === "VERIFIED"
    && String(result?.status || "").toLowerCase() === "verified"
    && result?.adapterVersion === EDITOR_VERSION
    && isSha256(result?.afterHash)
    && isSha256(result?.afterBackendHash)
    && Number.isInteger(result?.slotId)
    && result.slotId >= 0
    && result.slotId <= 4
    && Number.isSafeInteger(result?.waveIndex)
    && result.waveIndex > 0;
}

function isUncertainPageResult(result) {
  const status = String(result?.status || "").toLowerCase();
  const code = String(result?.code || "").toUpperCase();
  return status === "uncertain"
    || code === "UNCERTAIN"
    || code.startsWith("UNCERTAIN_")
    || code.endsWith("_UNCERTAIN");
}

function normalizePageWriteResult(result, action, expectedRun) {
  if (isVerifiedPageResult(result)
    && result.slotId === expectedRun?.slotId
    && result.waveIndex === expectedRun?.waveIndex) return result;
  const isObject = Boolean(result && typeof result === "object" && !Array.isArray(result));
  const status = String(result?.status || "").toLowerCase();
  const code = String(result?.code || "").toUpperCase();
  const message = typeof result?.message === "string" ? result.message.trim() : "";
  const claimsSuccess = result?.ok === true
    || code === "VERIFIED"
    || status === "verified";
  const validUncertain = isObject
    && result.ok === false
    && status === "uncertain"
    && code.length > 0
    && message.length > 0
    && !claimsSuccess;
  if (validUncertain) {
    return { ...result, ok: false, status: "uncertain" };
  }
  const validFailed = isObject
    && result.ok === false
    && (status === "" || status === "failed")
    && code.length > 0
    && message.length > 0
    && !claimsSuccess
    && !isUncertainPageResult(result)
    && result.adapterVersion === EDITOR_VERSION
    && SAFE_FAILED_PAGE_CODES.has(code);
  if (validFailed) return result;
  return failure(
    "UNCERTAIN_PROTOCOL",
    `${action}页面返回了不完整或互相矛盾的结果；无法确认是否已写入，请停止游戏并手动刷新核对`,
    { status: "uncertain" },
  );
}

function pageResultStatus(result) {
  if (isVerifiedPageResult(result)) return "verified";
  if (isUncertainPageResult(result)) return "uncertain";
  return "failed";
}

function auditWarning(error, action) {
  const detail = error?.message || "未知存储错误";
  return `${action}，但本地审计记录更新失败：${detail}`;
}

function appendAuditWarning(result, warning) {
  if (!warning) return result;
  const combined = [result?.auditWarning, warning].filter(Boolean).join("；");
  return { ...result, auditWarning: combined };
}

async function safeAuditUpdate(action, description) {
  try {
    const record = await action();
    if (!record) throw new Error("找不到对应的本地事务记录");
    return { record, warning: null };
  } catch (error) {
    return { record: null, warning: auditWarning(error, description) };
  }
}

function publicInspection(result) {
  if (!result || typeof result !== "object") return result;
  const { pageInstanceId: _privatePageInstanceId, ...publicResult } = result;
  if (!publicResult.backup || typeof publicResult.backup !== "object") return publicResult;
  const { session: _privateSession, ...publicBackup } = publicResult.backup;
  return { ...publicResult, backup: publicBackup };
}

async function inspectActive() {
  const tab = await activeGameTab();
  const result = await runInGame(tab.id, { command: "inspect" });
  return { tab, result };
}

function orphanResolutionExtra({
  clientRequestId = null,
  resolution = "blocked",
  txId = null,
  auditStatus = null,
  safeToClearLocalLock = false,
  retryable = true,
} = {}) {
  return {
    clientRequestId,
    resolution,
    txId,
    auditStatus,
    safeToClearLocalLock,
    retryable,
  };
}

function auditRequiredResolution(record, clientRequestId) {
  return {
    ok: true,
    code: "AUDIT_REQUIRED",
    message: "已找到对应的结果待确认事务；必须绑定事务编号后走精确确认流程",
    ...orphanResolutionExtra({
      clientRequestId: record?.clientRequestId || clientRequestId || null,
      resolution: "audit-required",
      txId: record?.txId || null,
      auditStatus: record?.status || null,
      safeToClearLocalLock: false,
      retryable: false,
    }),
  };
}

function resolutionInspectionProblem(result, clientRequestId) {
  const extra = orphanResolutionExtra({ clientRequestId });
  if (!result?.ok) {
    return failure(
      result?.code || "INSPECT_FAILED",
      result?.message || "无法重新读取当前对局，不能解除本地安全锁",
      extra,
    );
  }
  if (result.model?.readOnly !== false) {
    return failure(
      "READ_ONLY",
      `当前页面仍不可安全写入：${result.model?.readOnlyReason || "请等待游戏状态稳定或重新载入页面"}`,
      extra,
    );
  }
  if (result.model?.persistenceInSync !== true) {
    return failure(
      "RELOAD_REQUIRED",
      "实时会话与本地持久化缓存仍不一致；请先重新载入 PokéRogue 游戏页",
      extra,
    );
  }
  const hashes = inspectionHashes(result);
  const run = result.model?.run;
  if (result.adapterVersion !== EDITOR_VERSION
    || !isClientRequestId(result.pageInstanceId)
    || !isSha256(result.model?.hash)
    || !hashes
    || !isSha256(hashes.fullHash)
    || !isSha256(hashes.editableHash)
    || !isSha256(hashes.backendHash)
    || !Number.isInteger(run?.slotId)
    || run.slotId < 0
    || run.slotId > 4
    || typeof run.seed !== "string"
    || !Number.isSafeInteger(run.waveIndex)
    || run.waveIndex <= 0
    || !Number.isSafeInteger(run.turn)
    || typeof run.gameVersion !== "string"
    || !run.gameVersion
    || typeof run.phase !== "string"
    || !run.phase) {
    return failure(
      "PROTOCOL_MISMATCH",
      "页面缺少稳定核验所需的实例标识或完整摘要，不能解除本地安全锁",
      extra,
    );
  }
  return null;
}

function resolutionInspectionSignature(result) {
  const hashes = inspectionHashes(result);
  const run = result.model.run;
  return JSON.stringify({
    pageInstanceId: result.pageInstanceId,
    runtimeHash: result.model.hash,
    backendHash: hashes.backendHash,
    fullHash: hashes.fullHash,
    editableHash: hashes.editableHash,
    slotId: run.slotId,
    seed: run.seed,
    waveIndex: run.waveIndex,
    turn: run.turn,
    gameVersion: run.gameVersion,
    phase: run.phase,
  });
}

function requestRegistryConflict(clientRequestId, message = "同一客户端请求对应多条审计记录，不能自动恢复") {
  return failure(
    "PROTOCOL_CONFLICT",
    message,
    orphanResolutionExtra({
      clientRequestId,
      resolution: "conflict",
      retryable: false,
    }),
  );
}

function isTerminalAuditRecord(record) {
  if (!record || isUnacknowledgedUncertain(record)) return false;
  return ["verified", "failed", "rolled-back", "uncertain"].includes(record.status);
}

async function handleResolveOrphanedRequest(message) {
  const writeLock = acquireWriteLock("resolve-orphaned-request");
  const suppliedId = typeof message?.clientRequestId === "string" ? message.clientRequestId : "";
  const clientRequestId = suppliedId || null;
  if (!writeLock) {
    return failure(
      "IN_FLIGHT",
      "仍有写入或撤销任务正在运行，不能判定本地锁为孤立状态",
      orphanResolutionExtra({ clientRequestId, resolution: "in-flight" }),
    );
  }

  try {
    if (suppliedId && !isClientRequestId(suppliedId)) {
      return failure(
        "INVALID_REQUEST_ID",
        "本地安全锁中的客户端请求编号无效",
        orphanResolutionExtra({ clientRequestId, retryable: false }),
      );
    }
    writeLock.clientRequestId = clientRequestId;

    await reconcilePreparedBackups();
    let registry = clientRequestId
      ? await requestRegistryState(clientRequestId)
      : { records: [], receipt: null };
    if (registry.records.length > 1) return requestRegistryConflict(clientRequestId);
    if (registry.records.length === 1 && isUnacknowledgedUncertain(registry.records[0])) {
      return auditRequiredResolution(registry.records[0], clientRequestId);
    }

    if (clientRequestId && registry.records.length === 0) {
      const cancellation = await cancelUnrecordedRequest(clientRequestId);
      if (cancellation.records.length > 1) return requestRegistryConflict(clientRequestId);
      if (cancellation.records.length === 1) {
        registry = { records: cancellation.records, receipt: null };
        if (isUnacknowledgedUncertain(cancellation.records[0])) {
          return auditRequiredResolution(cancellation.records[0], clientRequestId);
        }
      } else if (!cancellation.receipt) {
        return failure(
          "REQUEST_BARRIER_FAILED",
          "无法持久登记请求取消屏障，已保留本地安全锁",
          orphanResolutionExtra({ clientRequestId }),
        );
      } else {
        registry = { records: [], receipt: cancellation.receipt };
      }
    }

    const { tab, result: firstInspection } = await inspectActive();
    const firstProblem = resolutionInspectionProblem(firstInspection, clientRequestId);
    if (firstProblem) return firstProblem;

    const firstQuarantines = await unresolvedWriteQuarantines(firstInspection.model.run);
    if (firstQuarantines.length > 1) {
      return requestRegistryConflict(clientRequestId, "当前对局存在多条未确认事务，不能自动选择确认目标");
    }
    if (firstQuarantines.length === 1) {
      return auditRequiredResolution(firstQuarantines[0], clientRequestId);
    }

    const secondInspection = await runInGame(tab.id, { command: "inspect" });
    const secondProblem = resolutionInspectionProblem(secondInspection, clientRequestId);
    if (secondProblem) return secondProblem;
    if (resolutionInspectionSignature(firstInspection) !== resolutionInspectionSignature(secondInspection)) {
      return failure(
        "STALE",
        "两次安全核验之间游戏状态发生变化；请停在稳定指令阶段后重试",
        orphanResolutionExtra({ clientRequestId }),
      );
    }

    const secondQuarantines = await unresolvedWriteQuarantines(secondInspection.model.run);
    if (secondQuarantines.length > 1) {
      return requestRegistryConflict(clientRequestId, "当前对局存在多条未确认事务，不能自动选择确认目标");
    }
    if (secondQuarantines.length === 1) {
      return auditRequiredResolution(secondQuarantines[0], clientRequestId);
    }

    if (clientRequestId) {
      registry = await requestRegistryState(clientRequestId);
      if (registry.records.length > 1) return requestRegistryConflict(clientRequestId);
      if (registry.records.length === 1 && isUnacknowledgedUncertain(registry.records[0])) {
        return auditRequiredResolution(registry.records[0], clientRequestId);
      }
      if (registry.records.length === 0 && !registry.receipt) {
        return failure(
          "REGISTRY_STALE",
          "请求取消屏障在核验期间消失，不能解除本地安全锁",
          orphanResolutionExtra({ clientRequestId }),
        );
      }
      if (registry.records.length === 1 && !isTerminalAuditRecord(registry.records[0])) {
        return requestRegistryConflict(clientRequestId, "请求审计状态无法证明已经终结，不能解除本地安全锁");
      }
    }

    const terminalRecord = registry.records[0] || null;
    return {
      ok: true,
      code: "ORPHAN_RESOLVED",
      message: terminalRecord
        ? "请求审计已经终结，且当前实时会话与本地缓存连续核验一致"
        : clientRequestId
          ? "请求已封存并通过连续状态核验"
          : "旧版本本地锁已通过全局写入屏障和连续状态核验",
      ...orphanResolutionExtra({
        clientRequestId,
        resolution: terminalRecord
          ? "terminal"
          : clientRequestId
            ? registry.receipt?.status === "cancelled-before-start"
              ? "not-started-cancelled"
              : "retired-without-audit"
            : "legacy-barrier",
        txId: terminalRecord?.txId || null,
        auditStatus: terminalRecord?.status || null,
        safeToClearLocalLock: true,
        retryable: false,
      }),
    };
  } catch (error) {
    return failure(
      "ORPHAN_RESOLUTION_FAILED",
      error?.message || "本地安全锁恢复检查失败",
      orphanResolutionExtra({ clientRequestId }),
    );
  } finally {
    releaseWriteLock(writeLock);
  }
}

async function handleCommit(message) {
  const writeLock = acquireWriteLock("commit");
  if (!writeLock) return failure("BUSY", "已有保存任务正在进行");

  const txId = crypto.randomUUID();
  writeLock.txId = txId;
  const clientRequestId = typeof message?.clientRequestId === "string" ? message.clientRequestId : "";
  let recordCreated = false;
  try {
    if (!isClientRequestId(clientRequestId)) {
      return failure("INVALID_REQUEST_ID", "缺少有效的客户端请求编号，已禁止写入");
    }
    writeLock.clientRequestId = clientRequestId;
    const requestClaim = await claimClientRequestId(clientRequestId);
    if (!requestClaim.claimed) {
      return existingRequestFailure(clientRequestId, requestClaim)
        || failure("REQUEST_CONFLICT", "客户端请求登记状态异常，已禁止写入");
    }

    const operations = message.operations;
    if (!Array.isArray(operations) || operations.length === 0 || operations.length > 100) {
      return failure("INVALID_OPERATIONS", "修改项目为空或数量异常");
    }
    if (JSON.stringify(operations).length > 200_000) {
      return failure("REQUEST_TOO_LARGE", "修改请求过大");
    }
    const expectedBackendHash = String(message.expectedBackendHash || "");
    if (!expectedBackendHash) {
      return failure("INVALID_EXPECTATION", "缺少本地持久化缓存摘要，请刷新后重新预览");
    }
    const tab = await activeGameTab();
    const inspection = await runInGame(tab.id, { command: "inspect" });
    if (!inspection.ok) return inspection;
    if (inspection.model.readOnly) {
      return failure("READ_ONLY", inspection.model.readOnlyReason || "当前页面只读");
    }
    const quarantine = await unresolvedWriteQuarantine(inspection.model.run);
    if (quarantine) {
      return failure(
        "SAFETY_LOCKED",
        "当前槽位与对局存在尚未通过手动刷新核对的结果不确定事务，已禁止继续写入",
        { txId: quarantine.txId, status: "uncertain" },
      );
    }
    const hashes = inspectionHashes(inspection);
    if (!hashes) {
      return failure("PROTOCOL_MISMATCH", "页面适配器未返回一致的完整/本地缓存摘要，请更新扩展");
    }
    if (inspection.model.hash !== String(message.expectedHash || "")) {
      return failure("STALE", "游戏运行状态已变化，请刷新后重新预览", {
        currentHash: inspection.model.hash,
      });
    }
    if (hashes.backendHash !== expectedBackendHash) {
      return failure("BACKEND_STALE", "本地持久化缓存已变化，请刷新后重新预览，避免覆盖新进度", {
        currentBackendHash: hashes.backendHash,
      });
    }

    const prepared = createPreparedRecord({
      txId,
      clientRequestId,
      tabId: tab.id,
      inspection,
      operations,
    });
    await addBackup(prepared);
    recordCreated = true;

    const pageResult = await runInGame(tab.id, {
      command: "commit",
      payload: {
        txId,
        expectedHash: inspection.model.hash,
        expectedBackendHash: hashes.backendHash,
        operations,
      },
    });
    const result = normalizePageWriteResult(pageResult, "保存", inspection.model.run);

    // From this point onward the page has returned an authoritative outcome.
    // Audit failures may add a warning, but must never replace that outcome.
    const audit = await safeAuditUpdate(
      () => updateBackup(txId, {
        status: pageResultStatus(result),
        afterHash: result.afterHash || null,
        afterBackendHash: result.afterBackendHash || null,
        error: isVerifiedPageResult(result) ? null : result.message || "未知保存错误",
      }),
      "游戏页面已返回保存结果",
    );
    const response = {
      ...result,
      txId,
      clientRequestId,
      backup: audit.record ? backupSummary(audit.record) : null,
    };
    return appendAuditWarning(response, audit.warning);
  } catch (error) {
    let audit = { record: null, warning: null };
    if (recordCreated) {
      audit = await safeAuditUpdate(
        () => updateBackup(txId, {
          status: "uncertain",
          error: error?.message || "扩展与页面通信中断",
        }),
        "写入结果尚未返回",
      );
    }
    const response = failure(
      recordCreated ? "UNCERTAIN" : "COMMIT_FAILED",
      recordCreated
        ? "写入过程中连接中断，结果不确定；备份已保留"
        : error?.message || "无法开始保存",
      {
        txId: recordCreated ? txId : null,
        clientRequestId,
        backup: audit.record ? backupSummary(audit.record) : null,
      },
    );
    return appendAuditWarning(response, audit.warning);
  } finally {
    releaseWriteLock(writeLock);
  }
}

async function handleUndo(message) {
  // This synchronous acquisition deliberately precedes every await, including
  // active-tab lookup and backup loading.
  const writeLock = acquireWriteLock("undo");
  if (!writeLock) return failure("BUSY", "已有保存任务正在进行");

  const undoTxId = crypto.randomUUID();
  writeLock.txId = undoTxId;
  const clientRequestId = typeof message?.clientRequestId === "string" ? message.clientRequestId : "";
  let undoRecordCreated = false;
  let target = null;
  try {
    if (!isClientRequestId(clientRequestId)) {
      return failure("INVALID_REQUEST_ID", "缺少有效的客户端请求编号，已禁止撤销");
    }
    writeLock.clientRequestId = clientRequestId;
    const requestClaim = await claimClientRequestId(clientRequestId);
    if (!requestClaim.claimed) {
      return existingRequestFailure(clientRequestId, requestClaim)
        || failure("REQUEST_CONFLICT", "客户端请求登记状态异常，已禁止撤销");
    }

    const expectedBackendHash = String(message.expectedBackendHash || "");
    if (!expectedBackendHash) {
      return failure("INVALID_EXPECTATION", "缺少当前本地持久化缓存摘要，请刷新后重试撤销");
    }
    const records = await loadBackups();
    target = message.txId
      ? records.find(record => record.txId === message.txId)
      : records.find(record => record.status === "verified" && record.kind === "commit");
    if (!target) return failure("NO_BACKUP", "没有可撤销的已验证备份");
    if (target.status !== "verified"
      || !target.afterHash
      || !target.afterBackendHash
      || !target.beforeFullHash
      || !target.before
      || !Array.isArray(target.operations)
      || target.operations.length === 0
      || target.operations.length > 100) {
      return failure("NOT_UNDOABLE", "该备份缺少安全撤销所需的已验证摘要或操作清单");
    }
    if (target.afterBackendHash !== expectedBackendHash) {
      return failure("BACKEND_STALE", "当前本地持久化缓存摘要与该备份不匹配，不能撤销");
    }

    const tab = await activeGameTab();
    const inspection = await runInGame(tab.id, { command: "inspect" });
    if (!inspection.ok) return inspection;
    if (inspection.model.readOnly) {
      return failure("READ_ONLY", inspection.model.readOnlyReason || "当前页面只读");
    }
    const quarantine = await unresolvedWriteQuarantine(inspection.model.run);
    if (quarantine) {
      return failure(
        "SAFETY_LOCKED",
        "当前槽位与对局存在尚未通过手动刷新核对的结果不确定事务，已禁止继续撤销",
        { txId: quarantine.txId, status: "uncertain" },
      );
    }
    const hashes = inspectionHashes(inspection);
    if (!hashes) {
      return failure("PROTOCOL_MISMATCH", "页面适配器未返回一致的完整/本地缓存摘要，请更新扩展");
    }
    if (inspection.model.run.slotId !== target.slot
      || inspection.model.run.seed !== target.run.seed
      || inspection.model.run.waveIndex !== target.run.waveIndex) {
      return failure("RUN_MISMATCH", "当前活动存档与备份不匹配");
    }
    if (inspection.model.hash !== target.afterHash) {
      return failure("STALE", "修改后游戏已继续变化，为防止覆盖新进度，不能一键撤销");
    }
    if (hashes.backendHash !== expectedBackendHash) {
      return failure("BACKEND_STALE", "本地持久化缓存已在修改后继续变化，为防止覆盖新进度，不能撤销", {
        currentBackendHash: hashes.backendHash,
      });
    }

    const undoRecord = createPreparedRecord({
      txId: undoTxId,
      clientRequestId,
      tabId: tab.id,
      inspection,
      operations: [{ type: "undo", targetTxId: target.txId }],
      kind: "undo",
      targetTxId: target.txId,
    });
    await addBackup(undoRecord, { preserveTxIds: [target.txId] });
    undoRecordCreated = true;

    const pageResult = await runInGame(tab.id, {
      command: "undo",
      payload: {
        txId: undoTxId,
        expectedHash: inspection.model.hash,
        expectedBackendHash: hashes.backendHash,
        expectedBeforeFullHash: target.beforeFullHash,
        operations: target.operations,
        beforeSession: target.before,
      },
    });
    const result = normalizePageWriteResult(pageResult, "撤销", inspection.model.run);

    const audit = await safeAuditUpdate(
      () => finalizeUndoBackups(
        undoTxId,
        target.txId,
        {
          status: pageResultStatus(result),
          afterHash: result.afterHash || null,
          afterBackendHash: result.afterBackendHash || null,
          error: isVerifiedPageResult(result) ? null : result.message || "未知撤销错误",
        },
        isVerifiedPageResult(result),
      ),
      "游戏页面已返回撤销结果",
    );
    const response = {
      ...result,
      txId: undoTxId,
      clientRequestId,
      targetTxId: target.txId,
      backup: audit.record ? backupSummary(audit.record) : null,
    };
    return appendAuditWarning(response, audit.warning);
  } catch (error) {
    let audit = { record: null, warning: null };
    if (undoRecordCreated) {
      audit = await safeAuditUpdate(
        () => updateBackup(undoTxId, {
          status: "uncertain",
          error: error?.message || "撤销通信中断",
        }),
        "撤销结果尚未返回",
      );
    }
    const response = failure(
      undoRecordCreated ? "UNCERTAIN" : "UNDO_FAILED",
      undoRecordCreated
        ? "撤销过程中连接中断，结果不确定；备份已保留"
        : error?.message || "无法开始撤销",
      {
        txId: undoRecordCreated ? undoTxId : null,
        clientRequestId,
        targetTxId: target?.txId || null,
        backup: audit.record ? backupSummary(audit.record) : null,
      },
    );
    return appendAuditWarning(response, audit.warning);
  } finally {
    releaseWriteLock(writeLock);
  }
}


async function handleAccountCommit(message) {
  const lock = acquireWriteLock("account");
  if (!lock) return failure("BUSY", "已有保存任务正在进行");
  const clientRequestId = message.clientRequestId;
  const txId = crypto.randomUUID();
  lock.txId = txId;
  lock.clientRequestId = clientRequestId;
  let created = false;
  try {
    if (!isClientRequestId(clientRequestId)) return failure("INVALID_REQUEST_ID", "缺少客户端请求编号");
    if (message.type === "ADD_LEGENDARY_EGGS") {
      if (!["legendary", "move", "shiny"].includes(message.source)) return failure("INVALID_SOURCE", "请选择有效的官方扭蛋机");
      if (!Number.isSafeInteger(message.count) || message.count < 1 || message.count > 10) return failure("INVALID_COUNT", "一次只能添加 1–10 枚传说蛋");
    }
    const claimed = await claimClientRequestId(clientRequestId);
    if (!claimed.claimed) return existingRequestFailure(clientRequestId, claimed);
    const { tab, result: inspection } = await inspectActive();
    if (!inspection.ok) return inspection;
    if (inspection.model.readOnly) return failure("READ_ONLY", inspection.model.readOnlyReason);
    if (!/^\d+:\d+$/.test(inspection.model.run.accountIdentity || "")) return failure("ACCOUNT_FAILED", "无法识别当前账号，请重新进入游戏");
    const quarantine = await unresolvedWriteQuarantine(inspection.model.run);
    if (quarantine) return failure("SAFETY_LOCKED", "请先核对上一次保存结果", { txId: quarantine.txId, status: "uncertain" });
    if (JSON.stringify(message.operations || []).length > 20000) return failure("REQUEST_TOO_LARGE", "账号请求过大");
    const preview = await runInGame(tab.id, { command: "account-preview", payload: { operations: message.operations } });
    if (!preview.ok) return preview;
    if (!preview.diffs?.length) return failure("NO_CHANGES", "所选内容已拥有，无需修改");
    const beforeSystem = typeof preview.expectedSystemJson === "string" ? JSON.parse(preview.expectedSystemJson) : preview.expectedSystem;
    const expectedSystem = typeof message.expectedSystemJson === "string" ? JSON.parse(message.expectedSystemJson) : message.expectedSystem;
    if (message.type !== "ADD_LEGENDARY_EGGS" && accountSnapshotString(beforeSystem) !== accountSnapshotString(expectedSystem)) return failure("STALE", "账号数据已变化，请重新预览");
    const record = createPreparedRecord({ txId, clientRequestId, tabId: tab.id, inspection,
      operations: message.operations, kind: "account" });
    record.accountIdentity = inspection.model.run.accountIdentity;
    record.beforeSystem = beforeSystem;
    await addBackup(record);
    created = true;
    const result = await runInGame(tab.id, { command: "account-commit", payload: {
      txId, operations: message.operations, expectedSystem: beforeSystem,
      expectedSystemJson: JSON.stringify(beforeSystem),
    } });
    const afterSystem = typeof result?.afterSystemJson === "string" ? JSON.parse(result.afterSystemJson) : result?.afterSystem;
    const verified = result?.ok === true && result.code === "VERIFIED" && result.status === "verified"
      && result.adapterVersion === EDITOR_VERSION && afterSystem;
    const safeFailure = !result?.ok && ["STALE", "BUSY", "NO_CHANGES", "ACCOUNT_FAILED", "INVALID_TX"].includes(result?.code);
    const status = verified ? "verified" : safeFailure ? "failed" : "uncertain";
    const audit = await safeAuditUpdate(() => updateBackup(txId, { status,
      afterSystem: verified ? afterSystem : null, diagnostics: result?.diagnostics || null,
      error: verified ? null : result?.message || "账号结果未确认" }), "账号保存结果已返回");
    const { afterSystem: _privateSystem, afterSystemJson: _privateSystemJson, ...publicResult } = result || {};
    return appendAuditWarning({ ...publicResult, ok: Boolean(verified), status,
      code: status === "uncertain" ? "UNCERTAIN" : result?.code,
      txId, clientRequestId, backup: audit.record ? backupSummary(audit.record) : null }, audit.warning);
  } catch (error) {
    if (created) await safeAuditUpdate(() => updateBackup(txId, { status: "uncertain", error: error.message }), "账号通信中断");
    return failure(created ? "UNCERTAIN" : "ACCOUNT_FAILED", created
      ? "账号保存期间通信中断，请重新载入并核对；修改前备份已保留" : error.message,
    { txId: created ? txId : null, clientRequestId, status: created ? "uncertain" : "failed" });
  } finally { releaseWriteLock(lock); }
}

async function handleMessage(message) {
  switch (message?.type) {
    case "COLLECTION_CATALOG":
    case "ITEM_CATALOG":
    case "ACCOUNT_PREVIEW": {
      const tab = await activeGameTab();
      return await runInGame(tab.id, { command: ({ COLLECTION_CATALOG: "collection-catalog", ITEM_CATALOG: "item-catalog", ACCOUNT_PREVIEW: "account-preview" })[message.type],
        payload: { operations: message.operations } });
    }
    case "ACCOUNT_COMMIT":
      return await handleAccountCommit(message);
    case "INSPECT": {
      const { result } = await inspectActive();
      return publicInspection(result);
    }
    case "COMMIT":
      return await handleCommit(message);
    case "UNDO":
      return await handleUndo(message);
    case "ADD_LEGENDARY_EGGS":
      return await handleAccountCommit({ ...message, operations: [{ type: "addLegendaryEggs", source: message.source, count: message.count }] });
    case "ARM_RARE_ENCOUNTER": {
      const tab = await activeGameTab();
      return await runInGame(tab.id, { command: "arm-rare-encounter" });
    }
    case "CANCEL_RARE_ENCOUNTER": {
      const tab = await activeGameTab();
      return await runInGame(tab.id, { command: "cancel-rare-encounter" });
    }
    case "EXPORT_NATIVE": {
      const tab = await activeGameTab();
      return await runInGame(tab.id, { command: "export-native" });
    }
    case "EXPORT_SYSTEM_NATIVE": {
      const tab = await activeGameTab();
      return await runInGame(tab.id, { command: "export-system-native" });
    }
    case "LIST_BACKUPS": {
      const records = await reconcilePreparedBackups();
      return { ok: true, backups: records.map(backupSummary) };
    }
    case "RESOLVE_ORPHANED_REQUEST":
      return await handleResolveOrphanedRequest(message);
    case "ACKNOWLEDGE_UNCERTAIN": {
      const writeLock = acquireWriteLock("acknowledge");
      if (!writeLock) return failure("BUSY", "已有保存任务正在进行，暂时不能解除安全锁");
      try {
        const txId = typeof message.txId === "string" ? message.txId : "";
        if (!/^[a-zA-Z0-9-]{8,80}$/.test(txId)) {
          return failure("INVALID_TX", "缺少有效的待确认事务编号，不能解除安全锁", { status: "uncertain" });
        }
        const { tab, result } = await inspectActive();
        if (!result?.ok) return result || failure("INSPECT_FAILED", "无法重新读取当前对局");
        const accountRecord = (await loadBackups()).find(record => record.txId === txId && record.kind === "account");
        if (accountRecord && isUnacknowledgedUncertain(accountRecord)) {
          if (!recordMatchesRunIdentity(accountRecord, result.model.run)) return failure("ACCOUNT_MISMATCH", "当前账号与待确认事务不一致", { status: "uncertain" });
          if (accountRecord.pageInstanceId === result.pageInstanceId || !await originalTabCanNoLongerRun(accountRecord.tabId)) {
            return failure("RELOAD_REQUIRED", "请关闭原游戏标签页，在新标签页进入同一账号与对局后，再刷新核对账号修改", { status: "uncertain" });
          }
          const snapshot = await runInGame(tab.id, { command: "account-snapshot" });
          if (!snapshot.ok) return snapshot;
          if (`${snapshot.system?.trainerId}:${snapshot.system?.secretId}` !== accountRecord.accountIdentity
            || (snapshot.pageInstanceId && snapshot.pageInstanceId !== result.pageInstanceId)) {
            return failure("ACCOUNT_MISMATCH", "核对过程中账号或页面已变化，请重新刷新", { status: "uncertain" });
          }
          await updateBackup(txId, { status: "uncertain", acknowledgedAt: new Date().toISOString(), observedSystem: snapshot.system });
          return { ok: true, code: "ACKNOWLEDGED", message: "已重新载入并核对账号；请检查收藏与券数量" };
        }
        if (result.model?.readOnly === true) {
          return failure(
            "READ_ONLY",
            `当前页面仍不可安全写入：${result.model.readOnlyReason || "请等待游戏状态稳定或重新载入页面"}`,
            { status: "uncertain" },
          );
        }
        if (result.model?.persistenceInSync !== true) {
          return failure(
            "RELOAD_REQUIRED",
            "实时会话与本地持久化缓存仍不一致；请先重新载入 PokéRogue 游戏页，再点击刷新解除安全锁",
            { status: "uncertain" },
          );
        }
        if (!isClientRequestId(result.pageInstanceId)) {
          return failure("PROTOCOL_MISMATCH", "页面缺少重新载入状态标识，不能解除安全锁", { status: "uncertain" });
        }
        let outcome = await acknowledgeUncertainBackups({
          txId,
          tabId: tab.id,
          inspection: result,
        });
        if (outcome.tabMismatch > 0) {
          if (!await originalTabCanNoLongerRun(outcome.originalTabId)) {
            return failure(
              "TAB_MISMATCH",
              "该中断事务属于另一个仍打开的游戏标签页；请回到原标签页并重新载入 PokéRogue 后再刷新",
              { status: "uncertain" },
            );
          }
          const secondInspection = await runInGame(tab.id, { command: "inspect" });
          const firstProblem = resolutionInspectionProblem(result, null);
          const secondProblem = resolutionInspectionProblem(secondInspection, null);
          if (firstProblem || secondProblem) {
            return { ...(firstProblem || secondProblem), status: "uncertain" };
          }
          if (resolutionInspectionSignature(result) !== resolutionInspectionSignature(secondInspection)) {
            return failure(
              "STALE",
              "接管中断事务时游戏状态发生变化；请停在稳定指令阶段后重试",
              { status: "uncertain" },
            );
          }
          outcome = await acknowledgeUncertainBackups({
            txId,
            tabId: tab.id,
            inspection: secondInspection,
            allowTabTakeover: true,
          });
        }
        if (outcome.reloadRequired > 0) {
          return failure(
            "RELOAD_REQUIRED",
            "该事务由后台中断恢复；请关闭原 PokéRogue 标签页，在新标签页重新进入同一对局后再点击刷新",
            { status: "uncertain" },
          );
        }
        if (outcome.pageMismatch > 0) {
          return failure(
            "PAGE_MISMATCH",
            "游戏页面已更换，旧页面仍可能恢复；请关闭原 PokéRogue 标签页，在新标签页重新进入同一对局后再点击刷新",
            { status: "uncertain" },
          );
        }
        if (outcome.runMismatch > 0) {
          return failure(
            "RUN_MISMATCH",
            "当前活动槽位、种子、波数或游戏版本与待确认事务不一致，不能解除其安全锁",
            { status: "uncertain" },
          );
        }
        if (outcome.selected === 0) {
          return failure(
            "TX_NOT_FOUND",
            "找不到该事务的未确认审计记录；必须先走本地锁恢复屏障，不能直接解除",
            { status: "uncertain" },
          );
        }
        if (outcome.count !== 1) {
          return failure(
            "PROTOCOL_CONFLICT",
            "事务确认数量异常，已保留安全锁",
            { status: "uncertain" },
          );
        }
        return { ok: true, acknowledged: 1, txId };
      } finally {
        releaseWriteLock(writeLock);
      }
    }
    case "GET_BACKUP": {
      const records = await loadBackups();
      const record = records.find(item => item.txId === message.txId);
      return record ? { ok: true, record } : failure("NOT_FOUND", "找不到该备份");
    }
    default:
      return failure("UNKNOWN_MESSAGE", "未知扩展消息");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch(error => sendResponse(failure("BACKGROUND_ERROR", error?.message || "扩展后台发生错误")));
  return true;
});
