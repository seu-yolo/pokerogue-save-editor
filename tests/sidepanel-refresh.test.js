import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../sidepanel/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../sidepanel/index.html", import.meta.url), "utf8");
function functionSource(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
function fixture({ disconnected = false, rejectAcknowledgement = false, busy = false } = {}) {
  const state = { busy, model: null, preview: {}, safetyLock: { lockId: "existing-lock" } };
  const editor = { hidden: false };
  const events = [];
  const context = vm.createContext({
    state, $: () => editor,
    setBusy: value => { state.busy = value; events.push(["busy", value]); },
    inspect: async () => {
      events.push(["inspect"]);
      if (disconnected) throw new Error("无法连接游戏");
      state.model = { readOnly: false }; editor.hidden = false;
    },
    loadBackups: async () => { events.push(["backups"]); },
    resolveSafetyLockAfterRefresh: async () => {
      events.push(["acknowledge"]);
      if (rejectAcknowledgement) throw new Error("实时会话与缓存不一致");
      return "existing-lock";
    },
    clearSafetyLock: id => { assert.equal(id, "existing-lock"); state.safetyLock = null; return true; },
    syncWriteAccessUi: () => { events.push(["keep-locked"]); },
    setConnection: (...args) => { events.push(["connection", ...args]); },
    presentError: () => {}, updateActionState: () => {}, toast: () => {},
  });
  vm.runInContext(functionSource("refreshAll") + "\n" + functionSource("refreshPocket"), context);
  return { state, editor, events, click: () => vm.runInContext("refreshPocket()", context) };
}

test("pocket refresh remains outside the hidden editor and uses the same guarded recovery", () => {
  assert.ok(html.indexOf('id="pocket-refresh-button"') < html.indexOf('id="editor"'));
  assert.match(html, /aria-label="刷新洛托姆口袋"/);
  assert.match(source, /\$\("#pocket-refresh-button"\)\.disabled = state\.busy;/);
  assert.match(source, /\$\("#pocket-refresh-button"\)\.addEventListener\("click", \(\) => void refreshPocket\(\)\)/);
});

test("refresh connection errors preserve the safety lock and permit another attempt", async () => {
  const f = fixture({ disconnected: true });
  await f.click();
  assert.equal(f.editor.hidden, true);
  assert.equal(f.state.busy, false);
  assert.equal(f.state.safetyLock.lockId, "existing-lock");
  assert.equal(f.events.some(([event]) => event === "acknowledge"), false);
  await f.click();
  assert.equal(f.events.filter(([event]) => event === "inspect").length, 2);
});

test("failed unlock retains the connected editor and export tools without clearing the lock", async () => {
  const f = fixture({ rejectAcknowledgement: true });
  await f.click();
  assert.equal(f.editor.hidden, false);
  assert.ok(f.state.model);
  assert.equal(f.state.preview, null);
  assert.equal(f.state.safetyLock.lockId, "existing-lock");
  assert.equal(f.state.busy, false);
  assert.ok(f.events.some(([event, kind]) => event === "connection" && kind === "warning"));
});

test("refresh unlocks only after acknowledgement and never runs while a save is busy", async () => {
  const f = fixture(); await f.click();
  assert.equal(f.state.safetyLock, null);
  assert.equal(f.events.filter(([event]) => event === "acknowledge").length, 1);
  const busy = fixture({ busy: true }); await busy.click();
  assert.equal(busy.events.length, 0);
  assert.equal(busy.state.safetyLock.lockId, "existing-lock");
});
