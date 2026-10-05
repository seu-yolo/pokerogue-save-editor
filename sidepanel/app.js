import {
  BALL_LABELS,
  EDITOR_VERSION,
  ValidationError,
  buildLegendaryEggRequest,
  buildOperations,
  isClientRequestId,
  selectSafetyLockAudit,
} from "../src/shared/core.js";
import { createWorkflows } from "./workflows.js";
import { GAME_ORIGIN } from "../src/shared/game-target.js";

document.querySelector("#tool-version").textContent = `v${EDITOR_VERSION}`;

const LEGACY_SAFETY_LOCK_STORAGE_KEY = "roguesave.sidepanel.safety-lock.v1";
const SAFETY_LOCK_STORAGE_PREFIX = "roguesave.sidepanel.safety-lock.v2.";

function normalizeSafetyLock(value, fallbackLockId = null) {
  const row = value && typeof value === "object" ? value : {};
  const lockId = isClientRequestId(row.lockId)
    ? row.lockId
    : isClientRequestId(fallbackLockId)
      ? fallbackLockId
      : crypto.randomUUID();
  return {
    lockId,
    action: row.action === "undo" ? "undo" : "commit",
    txId: typeof row.txId === "string" && row.txId ? row.txId : null,
    clientRequestId: isClientRequestId(row.clientRequestId) ? row.clientRequestId : null,
    message: typeof row.message === "string" && row.message
      ? row.message
      : "上一次写入的结果尚未确认",
    createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
  };
}

function safetyLockStorageKey(lockId) {
  return `${SAFETY_LOCK_STORAGE_PREFIX}${lockId}`;
}

function persistSafetyLockRecord(lock) {
  try {
    localStorage.setItem(safetyLockStorageKey(lock.lockId), JSON.stringify(lock));
    return true;
  } catch {
    return false;
  }
}

function loadSafetyLocks() {
  const locks = [];
  try {
    const legacySource = localStorage.getItem(LEGACY_SAFETY_LOCK_STORAGE_KEY);
    if (legacySource != null) {
      let legacyValue = null;
      try {
        legacyValue = JSON.parse(legacySource);
      } catch {
        // A corrupted legacy row still becomes a fail-closed recoverable lock.
      }
      const migrated = normalizeSafetyLock(legacyValue);
      if (persistSafetyLockRecord(migrated)) {
        localStorage.removeItem(LEGACY_SAFETY_LOCK_STORAGE_KEY);
      }
      locks.push(migrated);
    }

    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (typeof key === "string" && key.startsWith(SAFETY_LOCK_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const fallbackLockId = key.slice(SAFETY_LOCK_STORAGE_PREFIX.length);
      let value = null;
      try {
        value = JSON.parse(localStorage.getItem(key) || "null");
      } catch {
        // Keep a recoverable fail-closed lock for a corrupted row.
      }
      const lock = normalizeSafetyLock(value, fallbackLockId);
      if (key !== safetyLockStorageKey(lock.lockId)) {
        if (persistSafetyLockRecord(lock)) localStorage.removeItem(key);
      }
      locks.push(lock);
    }
  } catch {
    return locks;
  }
  return [...new Map(locks.map(lock => [lock.lockId, lock])).values()]
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))
      || left.lockId.localeCompare(right.lockId));
}

function loadSafetyLock() {
  return loadSafetyLocks()[0] || null;
}

const state = {
  model: null,
  preview: null,
  backups: [],
  busy: false,
  toastTimer: null,
  safetyLock: loadSafetyLock(),
};

const $ = selector => document.querySelector(selector);

function createElement(tag, options = {}) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text != null) element.textContent = String(options.text);
  if (options.type) element.type = options.type;
  return element;
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || typeof response !== "object") {
    throw new Error("扩展后台没有返回结果");
  }
  return response;
}

function setBusy(busy, text = "处理中…") {
  state.busy = busy;
  $("#busy-text").textContent = text;
  $("#busy-overlay").hidden = !busy;
  updateActionState();
}

function toast(message, kind = "success", duration = 4200) {
  const node = $("#toast");
  clearTimeout(state.toastTimer);
  node.textContent = message;
  node.className = `toast${kind === "success" ? "" : ` ${kind}`}`;
  node.hidden = false;
  state.toastTimer = setTimeout(() => {
    node.hidden = true;
  }, duration);
}

function presentError(error, fallback = "操作失败") {
  const message = error?.message || fallback;
  toast(message, "error", 6500);
  if (error instanceof ValidationError && error.field) {
    const field = document.getElementById(error.field);
    field?.focus();
  }
}

function setConnection(kind, title, message) {
  const chip = $("#connection-chip");
  chip.className = `chip ${kind === "safe" ? "chip-safe" : kind === "warning" ? "chip-warning" : "chip-neutral"}`;
  chip.textContent = kind === "safe"
    ? "已连接"
    : kind === "warning"
      ? state.safetyLock ? "已锁定" : "只读"
      : kind === "loading"
        ? "连接中"
        : "未连接";
  $("#connection-title").textContent = title;
  $("#connection-message").textContent = message;
  $("#connection-card").querySelector(".spinner").hidden = kind !== "loading";
}

function formatNumber(value) {
  return Number(value).toLocaleString("zh-CN");
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
}

function formatHash(value) {
  const hash = typeof value === "string" ? value : "";
  return /^[0-9a-f]{64}$/i.test(hash)
    ? `${hash.slice(0, 12)}…${hash.slice(-8)}`
    : "不可用";
}

function formatStatus(status) {
  return ({
    prepared: "准备中",
    verified: "已验证",
    failed: "失败",
    uncertain: "结果待确认",
    "rolled-back": "已撤销",
  })[status] || status || "未知";
}

function statusClass(status) {
  if (status === "verified") return "status-verified";
  if (status === "failed") return "status-failed";
  if (status === "uncertain" || status === "prepared") return "status-uncertain";
  if (status === "rolled-back") return "status-rolled-back";
  return "";
}

function isUncertainResponse(response) {
  const status = String(response?.status || "").toLowerCase();
  const code = String(response?.code || "").toUpperCase();
  return status === "uncertain"
    || code === "UNCERTAIN"
    || code.startsWith("UNCERTAIN_")
    || code.endsWith("_UNCERTAIN");
}

function isVerifiedResponse(response) {
  const status = String(response?.status || "").toLowerCase();
  const code = String(response?.code || "").toUpperCase();
  return response?.ok === true && code === "VERIFIED" && status === "verified";
}

function diagnosticSuffix(response) {
  if (typeof response?.message === "string" && response.message.includes("差异字段：")) {
    return "";
  }
  const fields = Array.isArray(response?.diagnostics?.fields)
    ? response.diagnostics.fields.slice(0, 3)
    : [];
  const paths = fields
    .map(field => typeof field?.path === "string" ? field.path : "")
    .filter(Boolean);
  if (paths.length === 0) return "";
  return `（差异字段：${paths.join("、")}${response.diagnostics?.truncated ? " 等" : ""}）`;
}

function responseError(response, fallback) {
  const error = new Error(`${response?.message || fallback}${diagnosticSuffix(response)}`);
  error.code = response?.code || "UNKNOWN";
  return error;
}

function responseTxId(response) {
  const value = response?.txId || response?.backup?.txId;
  return typeof value === "string" && value ? value : null;
}

function responseClientRequestId(response) {
  const value = response?.clientRequestId || response?.backup?.clientRequestId;
  return isClientRequestId(value) ? value : null;
}

function requireBackendHash() {
  const value = state.model?.backendHash;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error("无法读取当前本地持久化缓存摘要；请手动刷新后重新预览");
  }
  return value;
}

function safetyLockGuidance(lock = state.safetyLock) {
  if (!lock) return "";
  const auditTarget = lock.txId
    ? `请在“备份与审计记录”中找到事务 ${lock.txId} 并导出对应 JSON。`
    : "请在“备份与审计记录”中找到最新的“结果待确认”事务并导出对应 JSON。";
  return `${lock.message || "操作结果尚未确认"}。已禁止继续写入。${auditTarget}`
    + "若要恢复到修改前，只能使用你在写入前已经下载的原生 .prsv；"
    + "现在再导出的 .prsv 只是当前待确认状态，不是修改前备份。手动点击刷新并核对后才会解锁。"
    + "若实时会话与本地缓存仍不一致，需先重新载入 PokéRogue 游戏页。";
}

function persistSafetyLock() {
  if (state.safetyLock) persistSafetyLockRecord(state.safetyLock);
}

function syncWriteAccessUi() {
  const nativeButton = $("#native-backup-button");
  if (state.safetyLock) {
    nativeButton.textContent = "下载当前状态 .prsv";
    nativeButton.title = "结果待确认期间导出的文件不是修改前备份，只用于留存当前状态";
  } else {
    nativeButton.textContent = "下载原生 .prsv";
    nativeButton.removeAttribute("title");
  }

  if (!state.model) {
    updateActionState();
    return;
  }

  const warning = $("#read-only-warning");
  const locked = Boolean(state.safetyLock);
  warning.hidden = !locked && !state.model.readOnly;
  warning.textContent = locked
    ? safetyLockGuidance()
    : state.model.readOnly
      ? `当前仅允许查看和导出：${state.model.readOnlyReason}`
      : "";

  setEditorReadOnly(locked || state.model.readOnly);
  if (locked) {
    setConnection(
      "warning",
      "结果待确认，写入已安全锁定",
      "请导出对应事务 JSON；只有手动刷新并重新读取当前状态后才会解除锁定。",
    );
  } else {
    setConnection(
      state.model.readOnly ? "warning" : "safe",
      state.model.readOnly ? "找到对局了，目前只能查看" : "找到你的对局了",
      `存档 ${state.model.run.displaySlot} · 第 ${state.model.run.waveIndex} 波${state.model.readOnly ? ` · ${state.model.readOnlyReason || "等回到可修改的阶段，再点刷新。"}` : ""}`,
    );
  }
  updateActionState();
}

function engageSafetyLock({ action, response = null, message = "", clientRequestId = null }) {
  const txId = responseTxId(response);
  const responseDetail = typeof response?.message === "string"
    ? `${response.message.split(/[；。]/, 1)[0]}${diagnosticSuffix(response)}`
    : "";
  const lock = {
    lockId: crypto.randomUUID(),
    action: action === "undo" ? "undo" : "commit",
    txId,
    clientRequestId: responseClientRequestId(response)
      || (isClientRequestId(clientRequestId) ? clientRequestId : null),
    message: message || responseDetail || `${action === "undo" ? "撤销" : "写入"}结果尚未确认`,
    createdAt: new Date().toISOString(),
  };
  persistSafetyLockRecord(lock);
  state.safetyLock = loadSafetyLock() || lock;
  invalidatePreview();
  syncWriteAccessUi();
  const history = $("#backup-list")?.closest("details");
  if (history) history.open = true;
  toast(safetyLockGuidance(), "warning", 16000);
}

function bindSafetyLockToBackup(backup) {
  if (!state.safetyLock || !backup?.txId) return;
  state.safetyLock = {
    ...state.safetyLock,
    action: backup.kind === "undo" ? "undo" : "commit",
    txId: backup.txId,
    clientRequestId: isClientRequestId(backup.clientRequestId)
      ? backup.clientRequestId
      : state.safetyLock.clientRequestId,
    message: backup.error || state.safetyLock.message || "发现结果待确认事务",
  };
  persistSafetyLock();
  syncWriteAccessUi();
}

function clearSafetyLock(lockId = state.safetyLock?.lockId) {
  if (!isClientRequestId(lockId)) return false;
  try {
    localStorage.removeItem(safetyLockStorageKey(lockId));
  } catch {
    return false;
  }
  state.safetyLock = loadSafetyLock();
  syncWriteAccessUi();
  return true;
}

function invalidatePreview() {
  state.preview = null;
  $("#preview-card").hidden = true;
  $("#preview-list").replaceChildren();
  updateActionState();
}

function updateActionState() {
  const writeLocked = !state.model || state.model.readOnly || Boolean(state.safetyLock);
  $("#preview-button").disabled = state.busy || writeLocked;
  $("#commit-button").disabled = state.busy || writeLocked || !state.preview;

  const undoCandidate = findUndoCandidate();
  $("#undo-button").disabled = state.busy || !undoCandidate || writeLocked;
  $("#native-backup-button").disabled = state.busy || !state.model?.capabilities?.nativeBackup;
  const account = state.model?.account;
  const accountLocked = state.busy || writeLocked || !account?.canAddLegendaryEggs;
  $("#egg-source").disabled = accountLocked;
  $("#egg-count").disabled = accountLocked;
  $("#egg-add-button").disabled = accountLocked;
  $("#system-backup-button").disabled = state.busy || !state.model?.capabilities?.nativeBackup;
  $("#refresh-button").disabled = state.busy;
  $("#pocket-refresh-button").disabled = state.busy;
  const rareEncounter = state.model?.rareEncounter;
  $("#rare-encounter-button").disabled = state.busy
    || !rareEncounter
    || (!rareEncounter.armed && (state.model?.readOnly || !rareEncounter.supported));
  workflows.updateActionState(writeLocked);
}

function setEditorReadOnly(readOnly) {
  for (const control of document.querySelectorAll("#editor-form input, #editor-form button")) {
    control.disabled = readOnly || control.dataset.locked === "true";
  }
}

function renderBalls(model) {
  const grid = $("#balls-grid");
  grid.replaceChildren();
  for (const ball of model.pokeballs) {
    const label = createElement("label", { className: "ball-field" });
    label.append(createElement("span", { text: ball.label || BALL_LABELS[ball.key] || `球 ${ball.key}` }));
    const input = createElement("input", { type: "number" });
    input.id = `ball-${ball.key}`;
    input.inputMode = "numeric";
    input.min = "0";
    input.max = String(ball.max ?? 99);
    input.step = "1";
    input.value = String(ball.value);
    input.dataset.ballKey = String(ball.key);
    label.append(input);
    grid.append(label);
  }
}

function renderParty(model) {
  const list = $("#party-list");
  list.replaceChildren();
  for (const pokemon of model.party) {
    const card = createElement("article", { className: "party-card" });
    const header = createElement("div", { className: "party-header" });
    header.append(createElement("strong", { text: pokemon.name }));
    header.append(createElement("span", {
      className: "party-meta",
      text: `Lv.${pokemon.level} · HP ${pokemon.hp}/${pokemon.maxHp}`,
    }));
    card.append(header);

    const controls = createElement("div", { className: "party-controls" });
    const friendshipLabel = createElement("label", { className: "field" });
    friendshipLabel.append(createElement("span", { text: "亲密度（0–255）" }));
    const friendship = createElement("input", { type: "number" });
    friendship.id = `friendship-${pokemon.id}`;
    friendship.min = "0";
    friendship.max = "255";
    friendship.step = "1";
    friendship.value = String(pokemon.friendship);
    friendship.dataset.pokemonId = String(pokemon.id);
    friendship.dataset.pokemonField = "friendship";
    friendshipLabel.append(friendship);
    controls.append(friendshipLabel);

    for (const [field, labelText, checked] of [
      ["pokerus", "宝可病毒", pokemon.pokerus],
      ["pauseEvolutions", "暂停进化", pokemon.pauseEvolutions],
      ["maxIvs", "六项 IV 设为 31", false],
    ]) {
      const label = createElement("label", { className: "inline-check" });
      const input = createElement("input", { type: "checkbox" });
      input.checked = Boolean(checked);
      input.dataset.pokemonId = String(pokemon.id);
      input.dataset.pokemonField = field;
      label.append(input, createElement("span", { text: labelText }));
      controls.append(label);
    }
    card.append(controls);
    card.append(createElement("div", {
      className: "iv-line",
      text: `当前 IV：${pokemon.ivs.join(" / ")} · PP 已用：${pokemon.ppUsed.join(" / ") || "无技能"}`,
    }));
    list.append(card);
  }
}

function renderModifiers(model) {
  const list = $("#modifier-list");
  list.replaceChildren();
  $("#modifier-count").textContent = `${model.modifiers.length} 项`;
  if (model.modifiers.length === 0) {
    list.append(createElement("p", { className: "section-note", text: "当前对局没有可显示的玩家道具。" }));
    return;
  }

  for (const modifier of model.modifiers) {
    const row = createElement("article", { className: `modifier-row${modifier.editable ? "" : " readonly"}` });
    const info = createElement("div");
    const header = createElement("div", { className: "modifier-header" });
    header.append(createElement("strong", { text: modifier.name }));
    header.append(createElement("span", {
      className: "modifier-meta",
      text: modifier.ownerName ? `持有者：${modifier.ownerName}` : "全局道具",
    }));
    info.append(header);
    info.append(createElement("div", {
      className: "modifier-meta",
      text: `${modifier.className} · 上限 ${modifier.maxStackCount}`,
    }));
    if (!modifier.editable) {
      info.append(createElement("div", { className: "locked-note", text: `已锁定：${modifier.readOnlyReason}` }));
    }

    const input = createElement("input", { type: "number" });
    input.id = `modifier-${modifier.fingerprint}`;
    input.min = "1";
    input.max = String(modifier.maxStackCount);
    input.step = "1";
    input.value = String(modifier.stackCount);
    input.dataset.modifierFingerprint = modifier.fingerprint;
    input.dataset.locked = modifier.editable ? "false" : "true";
    input.disabled = !modifier.editable;
    row.append(info, input);
    list.append(row);
  }
}

function renderModel(model) {
  state.model = model;
  state.preview = null;
  $("#editor").hidden = false;
  $("#run-title").textContent = `${model.run.name || "未命名对局"} · 槽位 ${model.run.displaySlot}`;
  $("#run-wave").textContent = String(model.run.waveIndex);
  $("#run-mode").textContent = model.run.mode;
  $("#run-version").textContent = model.run.gameVersion || "未知";
  $("#run-turn").textContent = String(model.run.turn);
  $("#run-seed").textContent = model.run.seed ? `种子（只读）：${model.run.seed}` : "种子：未读取";
  $("#run-name").value = model.run.name;
  $("#money").value = String(model.money);
  $("#heal-hp").checked = false;
  $("#heal-status").checked = false;
  $("#heal-pp").checked = false;
  $("#preview-card").hidden = true;

  const account = model.account || {};
  $("#egg-count-chip").textContent = `${Number(account.eggCount ?? 0)} / ${Number(account.maxEggs ?? 99)}`;
  const accountWarning = $("#egg-read-only-warning");
  accountWarning.hidden = Boolean(account.canAddLegendaryEggs);
  accountWarning.textContent = account.readOnlyReason || "当前账号蛋数据不可修改";

  const rareEncounter = model.rareEncounter || {};
  const rareChip = $("#rare-encounter-chip");
  rareChip.textContent = rareEncounter.armed ? "等待中" : "未启用";
  rareChip.className = `chip ${rareEncounter.armed ? "chip-safe" : "chip-neutral"}`;
  $("#rare-encounter-note").textContent = rareEncounter.message || "当前状态不可用";
  $("#rare-encounter-button").textContent = rareEncounter.armed
    ? "取消等待"
    : "等待下一次极稀有遭遇";

  renderBalls(model);
  renderParty(model);
  renderModifiers(model);
  workflows.renderModel(model);
  syncWriteAccessUi();
}

function collectDraft() {
  const balls = {};
  for (const input of document.querySelectorAll("[data-ball-key]")) {
    balls[input.dataset.ballKey] = input.value;
  }
  const party = {};
  for (const pokemon of state.model.party) {
    party[String(pokemon.id)] = {};
  }
  for (const input of document.querySelectorAll("[data-pokemon-field]")) {
    const values = party[input.dataset.pokemonId] ||= {};
    values[input.dataset.pokemonField] = input.type === "checkbox" ? input.checked : input.value;
  }
  const modifiers = {};
  for (const input of document.querySelectorAll("[data-modifier-fingerprint]")) {
    modifiers[input.dataset.modifierFingerprint] = input.value;
  }
  return {
    runName: $("#run-name").value,
    money: $("#money").value,
    balls,
    heal: {
      hp: $("#heal-hp").checked,
      status: $("#heal-status").checked,
      pp: $("#heal-pp").checked,
    },
    party,
    modifiers,
  };
}

function renderPreview(preview) {
  const list = $("#preview-list");
  list.replaceChildren();
  for (const diff of preview.diffs) {
    const row = createElement("div", { className: "diff-row" });
    row.append(createElement("span", { text: diff.label }));
    const values = createElement("div", { className: "diff-values" });
    const before = createElement("del", { text: String(diff.before) });
    const after = createElement("ins", { text: `→ ${String(diff.after)}` });
    values.append(before, after);
    row.append(values);
    list.append(row);
  }
  $("#preview-count").textContent = `${preview.operations.length} 项`;
  $("#preview-card").hidden = false;
  $("#preview-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function backupMatchesCurrentState(backup) {
  if (!state.model) return false;
  return backup.slot === state.model.run.slotId
    && backup.run?.seed === state.model.run.seed
    && backup.run?.waveIndex === state.model.run.waveIndex
    && typeof backup.afterHash === "string"
    && backup.afterHash === state.model.hash
    && typeof backup.afterBackendHash === "string"
    && backup.afterBackendHash === state.model.backendHash;
}

function isUndoableCurrentBackup(backup) {
  return backup.kind === "commit"
    && backup.status === "verified"
    && !backup.rolledBackBy
    && typeof backup.beforeFullHash === "string"
    && /^[0-9a-f]{64}$/i.test(backup.beforeFullHash)
    && backupMatchesCurrentState(backup);
}

function findUndoCandidate() {
  return state.backups.find(isUndoableCurrentBackup) || null;
}

function downloadJson(record) {
  const blob = new Blob([`${JSON.stringify(record, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = String(record.createdAt || new Date().toISOString()).replace(/[:.]/g, "-");
  link.href = url;
  link.download = `roguesave-slot${Number(record.slot) + 1}-${record.kind || "backup"}-${timestamp}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportBackup(txId) {
  try {
    setBusy(true, "正在读取备份…");
    const response = await send({ type: "GET_BACKUP", txId });
    if (!response.ok) throw new Error(response.message);
    downloadJson(response.record);
    toast("备份 JSON 已导出");
  } catch (error) {
    presentError(error, "备份导出失败");
  } finally {
    setBusy(false);
  }
}

async function undoBackup(txId) {
  if (state.safetyLock) {
    toast("写入结果待确认，必须先手动刷新后才能再次撤销", "warning", 6500);
    return;
  }
  let expectedBackendHash;
  try {
    expectedBackendHash = requireBackendHash();
  } catch (error) {
    presentError(error, "无法校验撤销基线");
    return;
  }
  if (!window.confirm("仅当游戏仍停留在修改后的同一状态时才能撤销。确认继续？")) return;
  const clientRequestId = crypto.randomUUID();
  try {
    setBusy(true, "正在校验并撤销…");
    let response;
    try {
      response = await send({ type: "UNDO", txId, expectedBackendHash, clientRequestId });
    } catch (error) {
      engageSafetyLock({
        action: "undo",
        clientRequestId,
        message: `撤销请求发出后通信中断，无法确认是否执行：${error?.message || "未知通信错误"}`,
      });
      await loadBackups().catch(() => {});
      return;
    }
    if (isUncertainResponse(response)) {
      engageSafetyLock({ action: "undo", response, clientRequestId });
      await loadBackups().catch(() => {});
      return;
    }
    if (!isVerifiedResponse(response)) throw responseError(response, "撤销失败");
    toast(
      response.auditWarning
        ? `${response.message || "已安全撤销"}；${response.auditWarning}`
        : response.message || "已安全撤销",
      response.auditWarning ? "warning" : "success",
      response.auditWarning ? 9000 : 4200,
    );
    await refreshAll({ quiet: true });
  } catch (error) {
    presentError(error, "撤销失败");
  } finally {
    setBusy(false);
  }
}

function renderBackups(backups) {
  state.backups = backups;
  $("#backup-count").textContent = `${backups.length} 份`;
  const list = $("#backup-list");
  list.replaceChildren();
  if (backups.length === 0) {
    list.append(createElement("p", { className: "section-note", text: "尚无修改记录。首次提交前会自动创建。" }));
    updateActionState();
    return;
  }

  for (const backup of backups) {
    const row = createElement("article", { className: "backup-row" });
    const header = createElement("div", { className: "backup-header" });
    header.append(createElement("strong", {
      text: backup.kind === "account" ? "账号收藏与资源修改" : `${backup.kind === "undo" ? "撤销" : "修改"} · 槽位 ${Number(backup.slot) + 1} · 第 ${backup.run?.waveIndex ?? "?"} 波`,
    }));
    header.append(createElement("span", {
      className: statusClass(backup.status),
      text: formatStatus(backup.status),
    }));
    row.append(header);
    row.append(createElement("div", {
      className: "backup-meta",
      text: `${formatDate(backup.createdAt)} · ${Number(backup.operationCount ?? 0)} 项 · 游戏 ${backup.gameVersion || "未知"}`
        + (backup.updatedAt && backup.updatedAt !== backup.createdAt ? ` · 更新 ${formatDate(backup.updatedAt)}` : ""),
    }));
    const integrity = [];
    if (backup.beforeFullHash) integrity.push(`完整快照 SHA-256 ${formatHash(backup.beforeFullHash)}`);
    if (backup.beforeBackendHash) integrity.push(`缓存前 ${formatHash(backup.beforeBackendHash)}`);
    if (backup.afterBackendHash) integrity.push(`缓存后 ${formatHash(backup.afterBackendHash)}`);
    if (backup.beforeEditableHash) integrity.push(`编辑域 ${formatHash(backup.beforeEditableHash)}`);
    if (integrity.length > 0) {
      row.append(createElement("div", { className: "backup-meta mono", text: integrity.join(" · ") }));
    }
    if (backup.error) {
      row.append(createElement("div", { className: "locked-note", text: backup.error }));
    }
    if (backup.auditWarning && backup.auditWarning !== backup.error) {
      row.append(createElement("div", { className: "locked-note", text: `审计警告：${backup.auditWarning}` }));
    }

    const actions = createElement("div", { className: "backup-actions" });
    const isLockedTransaction = state.safetyLock?.txId === backup.txId;
    const exportButton = createElement("button", {
      className: "mini-button",
      type: "button",
      text: isLockedTransaction ? "导出对应 JSON" : "导出 JSON",
    });
    exportButton.addEventListener("click", () => void exportBackup(backup.txId));
    actions.append(exportButton);
    const canUndo = Boolean(
      state.model
      && !state.model.readOnly
      && !state.safetyLock
      && isUndoableCurrentBackup(backup)
    );
    if (backup.kind === "commit") {
      const undoButton = createElement("button", { className: "mini-button", type: "button", text: "撤销此项" });
      undoButton.disabled = !canUndo;
      undoButton.title = canUndo ? "恢复到这次修改之前" : "当前游戏状态与该记录不完全一致";
      undoButton.addEventListener("click", () => void undoBackup(backup.txId));
      actions.append(undoButton);
    }
    row.append(actions);
    list.append(row);
  }
  updateActionState();
}

async function loadBackups() {
  const response = await send({ type: "LIST_BACKUPS" });
  if (!response.ok) throw new Error(response.message);
  const backups = Array.isArray(response.backups) ? response.backups : [];
  // LIST_BACKUPS converts every non-active prepared record to uncertain.
  // A remaining prepared row is the transaction that is still legitimately
  // running in another panel, so it must not create a persistent false lock.
  const candidate = selectSafetyLockAudit(state.safetyLock, backups, state.model?.run);
  if (!state.safetyLock && candidate) {
    engageSafetyLock({
      action: candidate.kind === "undo" ? "undo" : "commit",
      response: {
        txId: candidate.txId,
        clientRequestId: candidate.clientRequestId,
        message: candidate.error || "发现尚未通过手动刷新核对的结果不确定事务",
      },
    });
  } else if (candidate && candidate.txId !== state.safetyLock?.txId) {
    bindSafetyLockToBackup(candidate);
  }
  renderBackups(backups);
}

async function inspect() {
  setConnection("loading", "找找你的对局…", "正在读取当前存档，稍等一下。 ");
  const response = await send({ type: "INSPECT" });
  if (!response.ok) throw new Error(response.message);
  renderModel(response.model);
}

async function resolveSafetyLockAfterRefresh(lock) {
  if (!lock || !isClientRequestId(lock.lockId)) return null;
  if (lock.txId) {
    const acknowledgement = await send({
      type: "ACKNOWLEDGE_UNCERTAIN",
      txId: lock.txId,
    });
    if (acknowledgement?.ok) return lock.lockId;
    if (acknowledgement?.code !== "TX_NOT_FOUND") {
      throw responseError(acknowledgement, "无法确认安全锁解除状态");
    }
  }

  const resolution = await send({
    type: "RESOLVE_ORPHANED_REQUEST",
    clientRequestId: lock.clientRequestId,
  });
  if (!resolution?.ok) {
    throw responseError(resolution, "无法恢复通信中断留下的安全锁");
  }
  if (resolution.safeToClearLocalLock === true && resolution.code === "ORPHAN_RESOLVED") return lock.lockId;
  if (resolution.resolution !== "audit-required" || !resolution.txId) {
    throw new Error("后台未能证明本地安全锁可以解除");
  }

  const boundLock = {
    ...lock,
    txId: resolution.txId,
    clientRequestId: isClientRequestId(resolution.clientRequestId)
      ? resolution.clientRequestId
      : lock.clientRequestId,
    message: resolution.message || lock.message,
  };
  if (!persistSafetyLockRecord(boundLock)) {
    throw new Error("无法保存中断事务的恢复状态，已保留安全锁");
  }
  state.safetyLock = loadSafetyLock();
  syncWriteAccessUi();
  const acknowledgement = await send({
    type: "ACKNOWLEDGE_UNCERTAIN",
    txId: boundLock.txId,
  });
  if (!acknowledgement?.ok) {
    throw responseError(acknowledgement, "无法确认安全锁解除状态");
  }
  return lock.lockId;
}

async function refreshAll({ quiet = false, unlockSafety = false } = {}) {
  const lockToResolve = unlockSafety && state.safetyLock
    ? { ...state.safetyLock }
    : null;
  if (!quiet) setBusy(true, "正在读取当前对局…");
  let inspected = false;
  try {
    await inspect();
    inspected = true;
    await loadBackups();
    if (lockToResolve) {
      const resolvedLockId = await resolveSafetyLockAfterRefresh(lockToResolve);
      if (!resolvedLockId || !clearSafetyLock(resolvedLockId)) {
        throw new Error("事务已核对，但本地安全锁未能删除；请再次刷新");
      }
      await inspect();
      await loadBackups();
      toast(
        state.safetyLock
          ? "已核对一个事务，但当前对局仍有其他待确认记录，请再次刷新"
          : "已刷新并恢复，可以继续使用",
        "warning",
        7000,
      );
    }
  } catch (error) {
    state.preview = null;
    if (inspected && lockToResolve && state.model) {
      // Connection succeeded; acknowledgement failed. Keep the backup/export
      // tools visible and the existing lock intact so recovery can be retried.
      syncWriteAccessUi();
      setConnection("warning", "已连接，暂时还不能解除锁定", error.message);
    } else {
      state.model = null;
      $("#editor").hidden = true;
      setConnection("error", "无法连接当前活动对局", error?.message || "请打开 PokéRogue 并进入对局后重试。 ");
    }
    if (!quiet) presentError(error, "连接游戏失败");
  } finally {
    if (!quiet) setBusy(false);
    updateActionState();
  }
}

async function refreshPocket() {
  if (state.busy) return;
  await refreshAll({ unlockSafety: true });
}

async function previewChanges() {
  try {
    if (!state.model) throw new Error("请先连接当前游戏");
    if (state.safetyLock) throw new Error("写入结果待确认；请先手动刷新并核对当前状态");
    const result = buildOperations(collectDraft(), state.model);
    workflows.appendPending(result);
    if (result.operations.length === 0) {
      invalidatePreview();
      toast("设置未变，无需保存。", "warning");
      return;
    }
    state.preview = {
      expectedHash: state.model.hash,
      expectedBackendHash: requireBackendHash(),
      operations: result.operations,
      diffs: result.diffs,
    };
    renderPreview(state.preview);
    updateActionState();
  } catch (error) {
    invalidatePreview();
    presentError(error, "无法生成预览");
  }
}

async function commitChanges() {
  if (state.safetyLock) {
    toast("写入结果待确认，必须先手动刷新后才能再次写入", "warning", 6500);
    return;
  }
  if (!state.preview) return;
  const clientRequestId = crypto.randomUUID();
  try {
    setBusy(true, "正在备份和保存，再核对一下结果…");
    let response;
    try {
      response = await send({
        type: "COMMIT",
        expectedHash: state.preview.expectedHash,
        expectedBackendHash: state.preview.expectedBackendHash,
        operations: state.preview.operations,
        clientRequestId,
      });
    } catch (error) {
      engageSafetyLock({
        action: "commit",
        clientRequestId,
        message: `写入请求发出后通信中断，无法确认是否执行：${error?.message || "未知通信错误"}`,
      });
      await loadBackups().catch(() => {});
      return;
    }
    if (isUncertainResponse(response)) {
      engageSafetyLock({ action: "commit", response, clientRequestId });
      await loadBackups().catch(() => {});
      return;
    }
    if (!isVerifiedResponse(response)) throw responseError(response, "写入失败");
    toast(
      response.auditWarning
        ? `${response.message || "修改已保存并验证"}；${response.auditWarning}`
        : response.message || "修改已保存并验证",
      response.auditWarning ? "warning" : "success",
      response.auditWarning ? 9000 : 4200,
    );
    await refreshAll({ quiet: true });
  } catch (error) {
    presentError(error, "写入失败");
    await loadBackups().catch(() => {});
  } finally {
    setBusy(false);
  }
}

async function exportNative() {
  const currentStateOnly = Boolean(state.safetyLock);
  if (currentStateOnly && !window.confirm(
    "写入结果尚未确认。现在导出的 .prsv 只代表当前待确认状态，不是修改前备份。是否仍要导出用于留存？",
  )) return;
  try {
    setBusy(true, "正在准备游戏原生备份…");
    const response = await send({ type: "EXPORT_NATIVE" });
    if (!response.ok) throw new Error(response.message);
    toast(
      currentStateOnly
        ? "已导出当前待确认状态 .prsv；它不是修改前备份"
        : response.message || "原生备份下载已触发",
      currentStateOnly ? "warning" : "success",
      currentStateOnly ? 8000 : 4200,
    );
  } catch (error) {
    presentError(error, "原生备份导出失败");
  } finally {
    setBusy(false);
  }
}

async function exportSystemNative() {
  try {
    setBusy(true, "正在准备账号备份…");
    const response = await send({ type: "EXPORT_SYSTEM_NATIVE" });
    if (!response.ok) throw responseError(response, "账号备份导出失败");
    toast(response.message || "账号系统备份下载已触发");
  } catch (error) {
    presentError(error, "账号备份导出失败");
  } finally {
    setBusy(false);
  }
}

async function addLegendaryEggs() {
  const clientRequestId = crypto.randomUUID();
  try {
    if (!state.model) throw new Error("请先连接当前游戏");
    if (state.safetyLock) throw new Error("请先刷新并解除当前写入安全锁");
    const request = buildLegendaryEggRequest({
      source: $("#egg-source").value,
      count: $("#egg-count").value,
    }, state.model.account);
    if (!window.confirm(
      `将添加 ${request.count} 枚随机传说蛋\n来源：${request.sourceLabel}\n孵化：官方 100 波\n\n修改器不会显示蛋内物种。继续吗？`,
    )) return;

    setBusy(true, "正在让游戏生成随机蛋并保存…");
    let response;
    try {
      response = await send({ type: "ADD_LEGENDARY_EGGS", clientRequestId,
        source: request.source, count: request.count });
    } catch (error) {
      engageSafetyLock({ action: "commit", clientRequestId, message: `添加蛋的保存通信中断：${error.message}` });
      await loadBackups().catch(() => {});
      return;
    }
    if (isUncertainResponse(response)) {
      engageSafetyLock({ action: "commit", response, clientRequestId });
      await loadBackups().catch(() => {});
      return;
    }
    if (!isVerifiedResponse(response)) throw responseError(response, "添加传说蛋失败");
    if (response.account && state.model.account) {
      state.model.account = { ...state.model.account, ...response.account };
      $("#egg-count-chip").textContent = `${state.model.account.eggCount} / ${state.model.account.maxEggs}`;
    }
    toast(response.auditWarning ? `${response.message}；${response.auditWarning}` : response.message || "随机传说蛋已添加并保存",
      response.auditWarning ? "warning" : "success", response.auditWarning ? 9000 : 6500);
    await refreshAll({ quiet: true });
  } catch (error) {
    presentError(error, "添加传说蛋失败");
  } finally {
    setBusy(false);
  }
}

async function toggleRareEncounter() {
  try {
    if (!state.model) throw new Error("请先连接当前游戏");
    const cancelling = state.model.rareEncounter?.armed === true;
    setBusy(true, cancelling ? "正在取消等待…" : "正在设置下一次野生遭遇…");
    const response = await send({
      type: cancelling ? "CANCEL_RARE_ENCOUNTER" : "ARM_RARE_ENCOUNTER",
    });
    if (!response?.ok) throw responseError(response, cancelling ? "取消失败" : "启用失败");
    if (response.rareEncounter) state.model.rareEncounter = response.rareEncounter;
    toast(response.message || (cancelling ? "已取消等待" : "已等待下一次野生遭遇"));
    await refreshAll({ quiet: true });
  } catch (error) {
    presentError(error, "一次性遭遇设置失败");
  } finally {
    setBusy(false);
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalFullSession(session) {
  const copy = plain(session);
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) {
    throw new Error("存档快照结构无效");
  }
  delete copy.timestamp;
  delete copy.playTime;
  copy.name = String(copy.name ?? "");
  return copy;
}

async function hash(value) {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyBackupFile(file) {
  try {
    if (!file) return;
    if (file.size > 8_000_000) throw new Error("备份文件超过 8 MB，已拒绝读取");
    const record = JSON.parse(await file.text());
    if (record?.schemaVersion !== 1 || record?.origin !== GAME_ORIGIN) {
      throw new Error("不是 RogueSave v1 备份文件");
    }
    if (!record.before || typeof record.beforeFullHash !== "string") {
      throw new Error("备份缺少修改前完整快照或 beforeFullHash；旧版编辑字段摘要不能用于完整性校验");
    }
    if (!/^[0-9a-f]{64}$/i.test(record.beforeFullHash)) {
      throw new Error("beforeFullHash 不是有效的 SHA-256 摘要");
    }
    const actual = await hash(canonicalFullSession(record.before));
    if (actual !== record.beforeFullHash.toLowerCase()) {
      throw new Error("完整性校验失败：备份内容可能已损坏或被改动");
    }
    if (record.kind === "account") {
      if (!record.beforeSystem || typeof record.beforeSystem !== "object") throw new Error("账号备份缺少 beforeSystem 快照");
      toast("对局快照校验通过；账号快照已找到，但此校验不覆盖账号快照。JSON 不能直接导入游戏，请使用原生账号 .prsv 恢复。", "warning", 9000);
    } else toast(`完整快照 SHA-256 有效：槽位 ${Number(record.slot) + 1}，第 ${record.run?.waveIndex ?? "?"} 波，状态“${formatStatus(record.status)}”`);
  } catch (error) {
    presentError(error, "备份验证失败");
  } finally {
    $("#backup-file").value = "";
  }
}

$("#editor-form").addEventListener("input", invalidatePreview);
$("#editor-form").addEventListener("change", invalidatePreview);
$("#editor-form").addEventListener("submit", event => {
  event.preventDefault();
  void previewChanges();
});
$("#refresh-button").addEventListener("click", () => void refreshPocket());
$("#pocket-refresh-button").addEventListener("click", () => void refreshPocket());
$("#preview-button").addEventListener("click", () => void previewChanges());
$("#commit-button").addEventListener("click", () => void commitChanges());
$("#native-backup-button").addEventListener("click", () => void exportNative());
$("#system-backup-button").addEventListener("click", () => void exportSystemNative());
$("#egg-add-button").addEventListener("click", () => void addLegendaryEggs());
$("#rare-encounter-button").addEventListener("click", () => void toggleRareEncounter());
$("#undo-button").addEventListener("click", () => {
  const candidate = findUndoCandidate();
  if (candidate) void undoBackup(candidate.txId);
});
$("#balls-max").addEventListener("click", () => {
  for (const input of document.querySelectorAll("[data-ball-key]")) input.value = "99";
  invalidatePreview();
});
$("#heal-all").addEventListener("click", () => {
  for (const id of ["heal-hp", "heal-status", "heal-pp"]) $("#" + id).checked = true;
  invalidatePreview();
});
$("#backup-file").addEventListener("change", event => void verifyBackupFile(event.target.files?.[0]));

window.addEventListener("storage", event => {
  if (event.storageArea !== localStorage
    || (event.key !== LEGACY_SAFETY_LOCK_STORAGE_KEY
      && !String(event.key || "").startsWith(SAFETY_LOCK_STORAGE_PREFIX))) return;
  state.safetyLock = loadSafetyLock();
  invalidatePreview();
  syncWriteAccessUi();
  if (!state.busy) void refreshAll({ quiet: true });
});

const workflows = createWorkflows({ state, send, setBusy, createElement, presentError, responseError, toast,
  isUncertainResponse, isVerifiedResponse, engageSafetyLock, loadBackups, refreshAll,
  invalidatePreview, updateActionState });
workflows.init();
void refreshAll().then(() => workflows.refreshCollection());
