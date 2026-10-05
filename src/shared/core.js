export const EDITOR_VERSION = "1.0.0";
export const SUPPORTED_GAME_VERSIONS = Object.freeze(["1.12.0.10", "1.12.0.11"]);
// BattleScene.addMoney uses this same cap, including in Endless mode.
export const MAX_MONEY = Number.MAX_SAFE_INTEGER;
export const MAX_BALL_COUNT = 99;
export const MAX_FRIENDSHIP = 255;
export const MAX_ACCOUNT_EGGS = 99;
export const MAX_LEGENDARY_EGGS_PER_ACTION = 10;
export const LEGENDARY_EGG_SOURCE_LABELS = Object.freeze({
  legendary: "传说 UP",
  move: "蛋招式 UP",
  shiny: "闪光 UP",
});
export const BALL_LABELS = Object.freeze({
  "0": "普通球",
  "1": "超级球",
  "2": "高级球",
  "3": "肉鸽球",
  "4": "大师球",
});

export function isClientRequestId(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// Save timestamps and the official one-second play timer are not account edits.
// Keep play time in backups; exclude only these two fields from comparison.
export function accountSnapshotString(snapshot) {
  const comparable = snapshot && typeof snapshot === "object" ? { ...snapshot } : snapshot;
  if (comparable && typeof comparable === "object") {
    delete comparable.timestamp;
    if (comparable.gameStats && typeof comparable.gameStats === "object") {
      comparable.gameStats = { ...comparable.gameStats };
      delete comparable.gameStats.playTime;
    }
  }
  const stringify = value => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stringify).join(",")}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stringify(value[key])}`).join(",")}}`;
  };
  return stringify(comparable);
}

export class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

export function normalizeGameVersion(value) {
  return String(value ?? "").trim().replace(/^v/i, "");
}

export function isSupportedGameVersion(value) {
  return SUPPORTED_GAME_VERSIONS.includes(normalizeGameVersion(value));
}

export function selectSafetyLockAudit(lock, backups, run) {
  const rows = Array.isArray(backups) ? backups : [];
  const unresolved = rows.filter(record => record?.status === "uncertain" && !record?.acknowledgedAt);
  const currentRun = unresolved.filter(record => record.kind === "account"
    ? Boolean(record.accountIdentity) && record.accountIdentity === run?.accountIdentity
    : Number(record.slot) === Number(run?.slotId)
      && String(record.run?.seed ?? "") === String(run?.seed ?? "")
      && String(record.gameVersion ?? "") === String(run?.gameVersion ?? ""));
  if (!lock) return currentRun[0] || null;

  if (isClientRequestId(lock.clientRequestId)) {
    const requestMatches = unresolved.filter(record => record?.clientRequestId === lock.clientRequestId);
    return requestMatches.length === 1 ? requestMatches[0] : null;
  }
  if (!lock.txId && currentRun.length === 1) return currentRun[0];
  return null;
}

export function parseStrictInteger(value, { min, max, label, field }) {
  let parsed;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value.trim())) {
    parsed = Number(value.trim());
  } else {
    throw new ValidationError(`${label}必须是十进制整数`, field);
  }

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(`${label}必须在 ${min}–${max} 之间`, field);
  }
  return parsed;
}

export function buildLegendaryEggRequest(draft, account = {}) {
  const source = String(draft?.source ?? "");
  if (!Object.hasOwn(LEGENDARY_EGG_SOURCE_LABELS, source)) {
    throw new ValidationError("请选择有效的官方扭蛋机来源", "egg-source");
  }
  const count = parseStrictInteger(draft?.count, {
    min: 1,
    max: MAX_LEGENDARY_EGGS_PER_ACTION,
    label: "传说蛋数量",
    field: "egg-count",
  });
  const currentEggCount = parseStrictInteger(account?.eggCount ?? 0, {
    min: 0,
    max: MAX_ACCOUNT_EGGS,
    label: "当前蛋数量",
    field: "egg-count",
  });
  if (currentEggCount + count > MAX_ACCOUNT_EGGS) {
    throw new ValidationError(
      `蛋列表最多保存 ${MAX_ACCOUNT_EGGS} 枚；当前 ${currentEggCount} 枚，最多还能添加 ${MAX_ACCOUNT_EGGS - currentEggCount} 枚`,
      "egg-count",
    );
  }
  return {
    source,
    sourceLabel: LEGENDARY_EGG_SOURCE_LABELS[source],
    count,
    hatchWaves: 100,
  };
}

export function sanitizeRunName(value, originalName) {
  const name = String(value ?? "").trim();
  if (name === String(originalName ?? "")) {
    return null;
  }
  if (!name) {
    throw new ValidationError("对局名称不能为空；不想改名时请保留原名称", "runName");
  }
  if ([...name].length > 40) {
    throw new ValidationError("对局名称最多 40 个字符", "runName");
  }
  return name;
}

function sameNumberArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function buildOperations(draft, model) {
  if (!model || model.readOnly) {
    throw new ValidationError(model?.readOnlyReason || "当前页面处于只读模式");
  }

  const operations = [];
  const diffs = [];

  const money = parseStrictInteger(draft.money, {
    min: 0,
    max: MAX_MONEY,
    label: "金钱",
    field: "money",
  });
  if (money !== model.money) {
    operations.push({ type: "setMoney", value: money });
    diffs.push({ label: "金钱", before: model.money, after: money });
  }

  for (const ball of model.pokeballs) {
    const key = String(ball.key);
    const value = parseStrictInteger(draft.balls?.[key], {
      min: 0,
      max: MAX_BALL_COUNT,
      label: BALL_LABELS[key] || `精灵球 ${key}`,
      field: `ball-${key}`,
    });
    if (value !== ball.value) {
      operations.push({ type: "setBallCount", key, value });
      diffs.push({ label: BALL_LABELS[key] || `精灵球 ${key}`, before: ball.value, after: value });
    }
  }

  const heal = {
    hp: Boolean(draft.heal?.hp),
    status: Boolean(draft.heal?.status),
    pp: Boolean(draft.heal?.pp),
  };
  const needsHeal = model.party.some(pokemon =>
    (heal.hp && pokemon.hp !== pokemon.maxHp)
    || (heal.status && pokemon.status != null)
    || (heal.pp && pokemon.ppUsed.some(value => value !== 0))
  );
  if ((heal.hp || heal.status || heal.pp) && needsHeal) {
    operations.push({ type: "healParty", ...heal });
    const parts = [heal.hp && "HP", heal.status && "异常状态", heal.pp && "PP"].filter(Boolean);
    diffs.push({ label: "队伍恢复", before: "当前状态", after: parts.join("、") });
  }

  const partyDraft = draft.party || {};
  for (const pokemon of model.party) {
    const values = partyDraft[String(pokemon.id)] || {};
    const friendship = parseStrictInteger(values.friendship ?? pokemon.friendship, {
      min: 0,
      max: MAX_FRIENDSHIP,
      label: `${pokemon.name} 的亲密度`,
      field: `friendship-${pokemon.id}`,
    });
    if (friendship !== pokemon.friendship) {
      operations.push({ type: "setFriendship", pokemonId: pokemon.id, value: friendship });
      diffs.push({ label: `${pokemon.name} · 亲密度`, before: pokemon.friendship, after: friendship });
    }

    const pokerus = Boolean(values.pokerus);
    if (pokerus !== pokemon.pokerus) {
      operations.push({ type: "setPokerus", pokemonId: pokemon.id, value: pokerus });
      diffs.push({ label: `${pokemon.name} · 宝可病毒`, before: pokemon.pokerus ? "有" : "无", after: pokerus ? "有" : "无" });
    }

    const pauseEvolutions = Boolean(values.pauseEvolutions);
    if (pauseEvolutions !== pokemon.pauseEvolutions) {
      operations.push({ type: "setPauseEvolutions", pokemonId: pokemon.id, value: pauseEvolutions });
      diffs.push({
        label: `${pokemon.name} · 暂停进化`,
        before: pokemon.pauseEvolutions ? "是" : "否",
        after: pauseEvolutions ? "是" : "否",
      });
    }

    if (Boolean(values.maxIvs) && !sameNumberArray(pokemon.ivs, [31, 31, 31, 31, 31, 31])) {
      operations.push({ type: "maxIvs", pokemonId: pokemon.id });
      diffs.push({ label: `${pokemon.name} · 个体值`, before: pokemon.ivs.join("/"), after: "31/31/31/31/31/31" });
    }
  }

  const modifierDraft = draft.modifiers || {};
  for (const modifier of model.modifiers) {
    const rawValue = modifierDraft[modifier.fingerprint] ?? modifier.stackCount;
    const value = parseStrictInteger(rawValue, {
      min: 1,
      max: modifier.maxStackCount,
      label: `${modifier.name} 的层数`,
      field: `modifier-${modifier.fingerprint}`,
    });
    if (value !== modifier.stackCount) {
      if (!modifier.editable) {
        throw new ValidationError(`${modifier.name} 属于受保护道具，不能修改`, `modifier-${modifier.fingerprint}`);
      }
      operations.push({ type: "setModifierStack", fingerprint: modifier.fingerprint, value });
      diffs.push({ label: `${modifier.name} · 层数`, before: modifier.stackCount, after: value });
    }
  }

  const runName = sanitizeRunName(draft.runName, model.run.name);
  if (runName != null) {
    operations.push({ type: "renameRun", value: runName });
    diffs.push({ label: "对局名称", before: model.run.name || "（无）", after: runName });
  }

  return { operations, diffs };
}

export function backupSummary(record) {
  return {
    txId: record.txId,
    clientRequestId: record.clientRequestId || null,
    kind: record.kind || "commit",
    accountIdentity: record.accountIdentity || null,
    targetTxId: record.targetTxId || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt || record.createdAt,
    slot: record.slot,
    run: record.run,
    gameVersion: record.gameVersion,
    status: record.status,
    operationCount: record.operations?.length ?? 0,
    beforeHash: record.beforeHash,
    afterHash: record.afterHash,
    beforeFullHash: record.beforeFullHash || null,
    beforeEditableHash: record.beforeEditableHash || null,
    beforeBackendHash: record.beforeBackendHash || null,
    afterBackendHash: record.afterBackendHash || null,
    rolledBackBy: record.rolledBackBy || null,
    error: record.error || null,
    auditWarning: record.auditWarning || null,
    acknowledgedAt: record.acknowledgedAt || null,
  };
}

export function pruneBackups(
  records,
  { maxRecords = 20, maxBytes = 7_500_000, preserveTxIds = [] } = {},
) {
  const sorted = [...records].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const preserved = new Set(preserveTxIds.filter(value => typeof value === "string" && value));
  const isSafetyCritical = record => (
    (record?.status === "prepared" || record?.status === "uncertain")
    && !record?.acknowledgedAt
  ) || preserved.has(record?.txId);
  const mandatory = sorted.filter(isSafetyCritical);
  const optional = sorted.filter(record => !isSafetyCritical(record));
  const kept = [];
  let bytes = 2;

  // Never prune an unresolved transaction: doing so would silently remove the
  // persistent write quarantine for that run. If critical rows alone exceed
  // the soft budget, the storage write is allowed to fail closed instead.
  for (const record of mandatory) {
    const encoded = JSON.stringify(record);
    kept.push(record);
    bytes += new TextEncoder().encode(encoded).byteLength + 1;
  }

  for (const record of optional) {
    if (kept.length >= maxRecords) {
      break;
    }
    const encoded = JSON.stringify(record);
    const recordBytes = new TextEncoder().encode(encoded).byteLength + 1;
    if (kept.length > 0 && bytes + recordBytes > maxBytes) {
      continue;
    }
    kept.push(record);
    bytes += recordBytes;
  }
  return kept.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
