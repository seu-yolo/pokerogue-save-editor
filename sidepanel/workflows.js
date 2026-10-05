// UI-only workflow controller. Game data and save operations stay behind the
// background/page adapter boundary; no game code is evaluated in this module.
const NATURES = [
  ["勤奋", "无能力变化"], ["孤独", "攻击 ↑ · 防御 ↓"], ["勇敢", "攻击 ↑ · 速度 ↓"], ["固执", "攻击 ↑ · 特攻 ↓"], ["顽皮", "攻击 ↑ · 特防 ↓"],
  ["大胆", "防御 ↑ · 攻击 ↓"], ["坦率", "无能力变化"], ["悠闲", "防御 ↑ · 速度 ↓"], ["淘气", "防御 ↑ · 特攻 ↓"], ["乐天", "防御 ↑ · 特防 ↓"],
  ["胆小", "速度 ↑ · 攻击 ↓"], ["急躁", "速度 ↑ · 防御 ↓"], ["认真", "无能力变化"], ["爽朗", "速度 ↑ · 特攻 ↓"], ["天真", "速度 ↑ · 特防 ↓"],
  ["内敛", "特攻 ↑ · 攻击 ↓"], ["慢吞吞", "特攻 ↑ · 防御 ↓"], ["冷静", "特攻 ↑ · 速度 ↓"], ["害羞", "无能力变化"], ["马虎", "特攻 ↑ · 特防 ↓"],
  ["温和", "特防 ↑ · 攻击 ↓"], ["温顺", "特防 ↑ · 防御 ↓"], ["自大", "特防 ↑ · 速度 ↓"], ["慎重", "特防 ↑ · 特攻 ↓"], ["浮躁", "无能力变化"],
];

export function createWorkflows(api) {
  const { state, send, setBusy, createElement, presentError, responseError, toast,
    isUncertainResponse, isVerifiedResponse, engageSafetyLock, loadBackups,
    refreshAll, invalidatePreview } = api;
  const $ = selector => document.querySelector(selector);
  const ui = { tab: "run", catalog: null, selected: null, preview: null, items: [], pending: [] };

  function closePreview() {
    ui.preview = null;
    $("#account-preview").hidden = true;
  }

  function switchPage(tab) {
    ui.tab = tab;
    for (const panel of document.querySelectorAll("[data-view]")) panel.hidden = panel.dataset.view !== tab;
    for (const button of document.querySelectorAll("[data-tab]")) {
      const selected = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1;
    }
    $(".sticky-actions").hidden = tab !== "run";
    $("#preview-card").hidden = tab !== "run" || !state.preview;
    closePreview();
    if (tab === "collection" && state.model && !ui.catalog) void loadCollection();
  }

  function renderVouchers(model) {
    const list = $("#voucher-list"); list.replaceChildren();
    const labels = ["普通券", "高级券", "豪华券", "金券"];
    for (const [key, value] of Object.entries(model.account?.voucherCounts || {})) {
      if (!/^[0-3]$/.test(key)) continue;
      const label = createElement("label", { className: "field" });
      label.append(createElement("span", { text: labels[Number(key)] }));
      const input = createElement("input", { type: "number" });
      input.min = "0"; input.max = "9999"; input.step = "1"; input.value = String(value); input.dataset.voucherKey = key;
      label.append(input); list.append(label);
    }
    if (!list.children.length) list.append(createElement("p", { className: "section-note", text: "当前页面没有可编辑的抽奖券记录。" }));
  }

  async function loadCollection() {
    if (!state.model || state.busy) return;
    try {
      setBusy(true, "正在加载图鉴…");
      const response = await send({ type: "COLLECTION_CATALOG" });
      if (!response.ok) throw responseError(response, "无法读取图鉴");
      ui.catalog = response;
      $("#collection-status").textContent = `${response.species.length} 只初始宝可梦 · 游戏 ${response.version}${response.eggMovesAvailable ? "" : " · 蛋招式数据暂不可用"}`;
      renderResults();
    } catch (error) { $("#collection-status").textContent = error.message; presentError(error); }
    finally { setBusy(false); }
  }

  function renderResults() {
    const list = $("#species-results"); list.replaceChildren();
    const query = $("#species-search").value.trim().toLowerCase();
    const filter = $("#species-filter").value;
    const matches = (ui.catalog?.species || []).filter(row => (!query || row.name.toLowerCase().includes(query) || String(row.id).includes(query))
      && (filter === "all" || filter === "owned" && row.owned || filter === "missing" && !row.owned || filter === "legendary" && row.legendary));
    for (const row of matches.slice(0, 40)) {
      const button = createElement("button", { className: "species-result", type: "button" });
      button.setAttribute("aria-pressed", String(ui.selected?.id === row.id));
      button.append(createElement("small", { text: `#${row.id}` }), createElement("strong", { text: row.name }),
        createElement("span", { className: `chip ${row.owned ? "chip-safe" : "chip-neutral"}`, text: row.owned ? "已解锁" : "未解锁" }));
      button.addEventListener("click", () => selectSpecies(row)); list.append(button);
    }
    if (ui.catalog && !matches.length) list.append(createElement("p", { className: "section-note", text: "没找到，换个名称或编号试试。" }));
    if (matches.length > 40) list.append(createElement("p", { className: "section-note", text: `显示前 40 只，共 ${matches.length} 只。输入名称或编号可缩小范围。` }));
  }

  function choices(target, rows, field, title) {
    const list = $(target); list.replaceChildren();
    for (const row of rows) {
      const label = createElement("label", { className: "choice" });
      const input = createElement("input", { type: "checkbox" });
      input.dataset.unlockField = field; input.value = String(row.index);
      input.checked = row.owned; input.disabled = row.owned; input.dataset.locked = String(row.owned);
      const text = createElement("span");
      text.append(createElement("strong", { text: title(row) }), createElement("small", {
        text: row.owned ? `已解锁${field === "natures" ? ` · ${NATURES[row.index][1]}` : ""}`
          : row.rare ? "稀有蛋招式" : field === "natures" ? NATURES[row.index][1] : "勾选后解锁",
      }));
      label.append(input, text); list.append(label);
    }
    if (!rows.length) list.append(createElement("p", { className: "section-note", text: "当前版本没有可用数据。" }));
  }

  function selectSpecies(row) {
    closePreview(); ui.selected = row;
    $("#collection-form").hidden = false;
    $("#species-title").textContent = row.name;
    $("#species-owned").textContent = row.owned ? "补充解锁" : "新收藏";
    $("#species-owned").className = `chip ${row.owned ? "chip-safe" : "chip-neutral"}`;
    const shiny = $("#starter-shiny"); shiny.value = "keep";
    for (const option of shiny.options) option.disabled = /^[0-2]$/.test(option.value) && !row.shinies.includes(Number(option.value));
    const forms = $("#starter-form"); forms.replaceChildren();
    for (const form of row.forms) {
      const option = createElement("option", { text: `${form.name}${form.owned ? " · 已拥有" : ""}` }); option.value = String(form.index); forms.append(option);
    }
    choices("#starter-natures", row.natures, "natures", value => NATURES[value.index][0]);
    choices("#starter-egg-moves", row.eggMoves, "eggMoves", value => value.name);
    choices("#starter-abilities", row.abilities, "abilities", value => `${value.name}${value.index === 2 ? " · 隐藏特性" : ""}`);
    renderResults(); api.updateActionState();
    $("#collection-form").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  async function previewAccount(operations) {
    try {
      if (state.safetyLock || !state.model || state.model.readOnly) throw new Error("当前不可写入，请先刷新确认游戏状态");
      setBusy(true, "正在生成预览…");
      const response = await send({ type: "ACCOUNT_PREVIEW", operations });
      if (!response.ok) throw responseError(response, "账号预览失败");
      if (!response.diffs.length) { toast("这些内容你已经拥有！", "warning"); return; }
      ui.preview = response;
      const list = $("#account-preview-list"); list.replaceChildren();
      for (const diff of response.diffs) {
        const row = createElement("div", { className: "diff-row" });
        const natureName = value => String(value).replace(/性格 #(\d+)/g, (_match, index) => NATURES[Number(index) - 1]?.[0] || index);
        row.append(createElement("span", { text: natureName(diff.label) }), createElement("strong", { text: `${natureName(diff.before)} → ${natureName(diff.after)}` })); list.append(row);
      }
      $("#account-preview").hidden = false;
    } catch (error) { closePreview(); presentError(error); }
    finally { setBusy(false); if (ui.preview) $("#account-commit-button").focus(); }
  }

  async function saveAccount() {
    const preview = ui.preview;
    if (!preview || state.safetyLock) return;
    const clientRequestId = crypto.randomUUID();
    try {
      setBusy(true, "正在备份并保存账号修改…");
      let response;
      try { response = await send({ type: "ACCOUNT_COMMIT", clientRequestId, operations: preview.operations,
        expectedSystem: preview.expectedSystem, expectedSystemJson: preview.expectedSystemJson }); }
      catch (error) { engageSafetyLock({ action: "commit", clientRequestId, message: `账号保存通信中断：${error.message}` }); closePreview(); await loadBackups().catch(() => {}); return; }
      closePreview();
      if (isUncertainResponse(response)) { engageSafetyLock({ action: "commit", response, clientRequestId }); await loadBackups(); return; }
      if (!isVerifiedResponse(response)) throw responseError(response, "账号保存失败");
      toast(response.auditWarning ? `${response.message}；${response.auditWarning}` : response.message,
        response.auditWarning ? "warning" : "success", response.auditWarning ? 9000 : 6500);
      ui.catalog = null; ui.selected = null; $("#collection-form").hidden = true;
      await refreshAll({ quiet: true });
    } catch (error) { presentError(error); }
    finally { setBusy(false); if (ui.tab === "collection" && !state.safetyLock) void loadCollection(); }
  }

  async function loadItems() {
    if (!state.model || state.busy) return;
    try {
      setBusy(true, "正在加载道具…");
      const response = await send({ type: "ITEM_CATALOG" });
      if (!response.ok) throw responseError(response, "道具读取失败");
      ui.items = response.items; renderItems();
      if (!response.items.length) throw new Error("当前版本未识别到可添加道具");
    } catch (error) { $("#item-description").textContent = error.message; presentError(error); }
    finally { setBusy(false); }
  }

  function renderItems() {
    const select = $("#item-select"); const previous = select.value;
    const query = $("#item-search").value.trim().toLowerCase(); select.replaceChildren();
    for (const item of ui.items.filter(item => `${item.name} ${item.id}`.toLowerCase().includes(query))) {
      const option = createElement("option", { text: item.name }); option.value = item.id; select.append(option);
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    select.disabled = !select.options.length || state.model?.readOnly; updateItem(true);
  }

  function itemAvailability(item) {
    const pokemonId = item?.held ? Number($("#item-owner").value) : null;
    const limit = item?.limits?.find(row => row.pokemonId === pokemonId);
    if (!limit || ![limit.currentStackCount, limit.maxStackCount, limit.virtualStackCount].every(Number.isSafeInteger)) return null;
    const input = limit.modifierFingerprint == null ? null : [...document.querySelectorAll("[data-modifier-fingerprint]")]
      .find(control => control.dataset.modifierFingerprint === limit.modifierFingerprint);
    const current = input ? Number(input.value) : limit.currentStackCount;
    const queued = ui.pending.find(row => row.itemId === item.id && row.pokemonId === pokemonId)?.count || 0;
    if (!Number.isSafeInteger(current) || current < (input ? 1 : 0) || current > limit.maxStackCount - limit.virtualStackCount) return null;
    return { ...limit, pokemonId, current, queued, remaining: Math.max(0, limit.maxStackCount - limit.virtualStackCount - current - queued) };
  }

  function updateItem(resetCount = false) {
    const item = ui.items.find(row => row.id === $("#item-select").value);
    const limit = itemAvailability(item);
    const locked = !state.model || state.model.readOnly || Boolean(state.safetyLock) || state.busy;
    $("#item-description").textContent = item?.description || "选择道具，加入本次修改。保存时会检查层数上限。";
    $("#item-limit").textContent = !item ? "加载列表后，会显示游戏里的实际层数上限。" : !limit
      ? "暂时无法确定可添加数量。请检查现有道具层数，或重新加载列表。"
      : `当前 ${limit.currentStackCount} / 上限 ${limit.maxStackCount} 层${limit.current !== limit.currentStackCount ? ` · 已改为 ${limit.current} 层` : ""}${limit.virtualStackCount ? ` · 临时 ${limit.virtualStackCount} 层` : ""}${limit.queued ? ` · 待添加 ${limit.queued} 层` : ""} · ${limit.remaining ? `还能添加 ${limit.remaining} 层` : "已达到上限"}`;
    const count = $("#item-count");
    if (limit) count.max = String(limit.remaining);
    else count.removeAttribute("max");
    count.disabled = locked || !limit?.remaining;
    if (resetCount && limit?.remaining && (!Number.isSafeInteger(Number(count.value)) || Number(count.value) < 1 || Number(count.value) > limit.remaining)) count.value = "1";
    const validCount = Number.isSafeInteger(Number(count.value)) && Number(count.value) >= 1 && Number(count.value) <= (limit?.remaining || 0);
    $("#item-owner").disabled = !item?.held || locked;
    $("#item-queue-button").disabled = locked || !validCount;
  }

  function queueItem() {
    try {
      const item = ui.items.find(row => row.id === $("#item-select").value);
      if (!item || state.busy || state.safetyLock || state.model?.readOnly) throw new Error("请选择可添加的道具");
      const limit = itemAvailability(item);
      if (!limit) throw new Error("请重新加载道具列表，再检查现有层数");
      if (!limit.remaining) throw new Error("这个道具已经达到游戏上限了");
      const count = Number($("#item-count").value);
      if (!Number.isSafeInteger(count) || count < 1 || count > limit.remaining) throw new Error(`这次还能添加 ${limit.remaining} 层，请输入 1–${limit.remaining}`);
      const { pokemonId } = limit;
      const existing = ui.pending.find(row => row.itemId === item.id && row.pokemonId === pokemonId);
      if (existing) existing.count += count;
      else ui.pending.push({ type: "addModifier", itemId: item.id, pokemonId, count });
      renderQueue(); invalidatePreview();
    } catch (error) { presentError(error); }
  }

  function renderQueue() {
    const list = $("#item-queue"); list.replaceChildren();
    for (const [index, operation] of ui.pending.entries()) {
      const row = createElement("div", { className: "queue-row" });
      row.append(createElement("span", { text: `${ui.items.find(item => item.id === operation.itemId)?.name || operation.itemId} × ${operation.count}${operation.pokemonId ? ` · ${state.model.party.find(member => member.id === operation.pokemonId)?.name || "队伍成员"}` : ""}` }));
      const remove = createElement("button", { className: "mini-button", type: "button", text: "移除" });
      remove.addEventListener("click", () => { ui.pending.splice(index, 1); renderQueue(); invalidatePreview(); }); row.append(remove); list.append(row);
    }
    updateItem(true);
  }

  function updateActionState(writeLocked) {
    for (const control of document.querySelectorAll("#collection-form input, #collection-form select, #collection-form button, #voucher-form input, #voucher-form button")) {
      control.disabled = state.busy || writeLocked || !state.model?.account?.canEditCollection || control.dataset.locked === "true";
    }
    for (const button of document.querySelectorAll("[data-tab]")) button.disabled = state.busy;
    $("#account-commit-button").disabled = state.busy || writeLocked || !ui.preview;
    $("#account-cancel-button").disabled = state.busy;
    $("#collection-load-button").disabled = state.busy || !state.model;
    $("#item-load-button").disabled = state.busy || writeLocked;
    updateItem();
  }

  function renderModel(model) {
    ui.pending = []; closePreview(); renderQueue(); renderVouchers(model);
    ui.items = []; renderItems();
    ui.catalog = null; ui.selected = null; $("#collection-form").hidden = true; $("#species-results").replaceChildren();
    const owners = $("#item-owner"); owners.replaceChildren();
    for (const pokemon of model.party) { const option = createElement("option", { text: pokemon.name }); option.value = String(pokemon.id); owners.append(option); }
  }

  function appendPending(result) {
    for (const operation of ui.pending) {
      result.operations.push({ ...operation });
      const owner = operation.pokemonId == null ? "" : ` · ${state.model.party.find(member => member.id === operation.pokemonId)?.name || "队伍成员"}`;
      result.diffs.push({ label: ui.items.find(item => item.id === operation.itemId)?.name || operation.itemId, before: "当前道具", after: `增加 ${operation.count} 层${owner}` });
    }
  }

  function init() {
    // Keep each tab's complete content inside its accessible tab panel.
    $("#view-gacha").append($(".egg-card"));
    $("#view-backup").append($(".history-card"));
    $("#editor-form").append($(".encounter-card"));
    $("#tab-run").setAttribute("aria-controls", "editor-form");
    for (const nested of document.querySelectorAll(".egg-card, .history-card, .encounter-card")) { nested.removeAttribute("data-view"); nested.hidden = false; }
    for (const button of document.querySelectorAll("[data-tab]")) {
      button.addEventListener("click", () => switchPage(button.dataset.tab));
      button.addEventListener("keydown", event => {
        const tabs = [...document.querySelectorAll("[data-tab]")]; const index = tabs.indexOf(button);
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (next != null) { event.preventDefault(); tabs[next].focus(); switchPage(tabs[next].dataset.tab); }
      });
    }
    $("#collection-load-button").addEventListener("click", () => void loadCollection());
    $("#species-search").addEventListener("input", renderResults); $("#species-filter").addEventListener("change", renderResults);
    $("#collection-form").addEventListener("change", closePreview);
    $("#collection-form").addEventListener("submit", event => {
      event.preventDefault(); if (!ui.selected) return;
      const operation = { type: "unlockStarter", speciesId: ui.selected.id, shiny: $("#starter-shiny").value, formIndex: Number($("#starter-form").value) };
      for (const field of ["natures", "eggMoves", "abilities"]) operation[field] = [...document.querySelectorAll(`[data-unlock-field="${field}"]:checked:not(:disabled)`)].map(input => Number(input.value));
      void previewAccount([operation]);
    });
    $("#voucher-form").addEventListener("input", closePreview);
    $("#voucher-form").addEventListener("submit", event => {
      event.preventDefault();
      const inputs = [...document.querySelectorAll("[data-voucher-key]")];
      if (inputs.some(input => !/^\d+$/.test(input.value))) { toast("抽奖券数量请输入非负整数", "warning"); return; }
      const operations = inputs.map(input => ({ type: "setVoucher", key: input.dataset.voucherKey, value: Number(input.value) }));
      void previewAccount(operations);
    });
    $("#account-commit-button").addEventListener("click", () => void saveAccount());
    $("#account-cancel-button").addEventListener("click", closePreview);
    document.addEventListener("keydown", event => { if (event.key === "Escape" && !state.busy) closePreview(); });
    $("#item-load-button").addEventListener("click", () => void loadItems()); $("#item-search").addEventListener("input", renderItems);
    $("#item-select").addEventListener("change", () => updateItem(true));
    $("#item-owner").addEventListener("change", () => updateItem(true));
    $("#item-count").addEventListener("input", () => updateItem());
    $("#editor-form").addEventListener("input", event => { if (event.target.dataset.modifierFingerprint) updateItem(); });
    $("#item-queue-button").addEventListener("click", queueItem);
    switchPage("run");
  }
  return { init, renderModel, updateActionState, appendPending, refreshCollection: () => ui.tab === "collection" && !ui.catalog ? loadCollection() : Promise.resolve() };
}
