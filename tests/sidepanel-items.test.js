import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../sidepanel/workflows.js", import.meta.url), "utf8");
function functionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\n  }", start) + 4);
}
function element(value = "") {
  return { value, textContent: "", disabled: false, dataset: {}, children: [], listeners: {},
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
    removeAttribute(name) { delete this[name]; }, addEventListener(name, handler) { this.listeners[name] = handler; } };
}
function fixture({ current = 2, max = 4, held = false, virtual = 0, fingerprint = null } = {}) {
  const nodes = Object.fromEntries(["item-select", "item-owner", "item-description", "item-limit", "item-count", "item-queue-button", "item-queue"].map(id => [`#${id}`, element()]));
  nodes["#item-select"].value = "TEST"; nodes["#item-owner"].value = "11"; nodes["#item-count"].value = "1";
  const ui = { items: [{ id: "TEST", name: "测试道具", description: "说明", held, limits: [
    { pokemonId: held ? 11 : null, currentStackCount: current, maxStackCount: max, virtualStackCount: virtual, modifierFingerprint: fingerprint },
    ...(held ? [{ pokemonId: 22, currentStackCount: max, maxStackCount: max, virtualStackCount: 0, modifierFingerprint: null }] : []),
  ] }], pending: [] };
  const state = { model: { readOnly: false, party: [{ id: 11, name: "甲" }, { id: 22, name: "乙" }] }, busy: false, safetyLock: null };
  const modifierInput = element(String(current)); modifierInput.dataset.modifierFingerprint = fingerprint;
  const errors = [];
  const context = vm.createContext({ ui, state, $: id => nodes[id], Number, Math,
    document: { querySelectorAll: () => fingerprint ? [modifierInput] : [] },
    createElement: (_tag, props) => Object.assign(element(), { textContent: props.text || "" }),
    presentError: error => errors.push(error.message), invalidatePreview: () => {},
  });
  vm.runInContext(["itemAvailability", "updateItem", "queueItem", "renderQueue"].map(functionSource).join("\n"), context);
  return { nodes, ui, state, errors, modifierInput, update: () => vm.runInContext("updateItem(true)", context), queue: () => vm.runInContext("queueItem()", context) };
}

test("item UI displays official current/max and subtracts queued additions", () => {
  const f = fixture(); f.update();
  assert.match(f.nodes["#item-limit"].textContent, /当前 2 \/ 上限 4 层.*还能添加 2 层/);
  assert.equal(f.nodes["#item-count"].max, "2");
  f.queue(); assert.equal(f.ui.pending[0].count, 1);
  assert.match(f.nodes["#item-limit"].textContent, /待添加 1 层.*还能添加 1 层/);
  f.queue(); assert.equal(f.ui.pending[0].count, 2);
  assert.match(f.nodes["#item-limit"].textContent, /已达到上限/);
  assert.equal(f.nodes["#item-count"].disabled, true);
  assert.equal(f.nodes["#item-queue-button"].disabled, true);
  f.queue(); assert.equal(f.ui.pending[0].count, 2); assert.equal(f.errors.length, 1);
  f.nodes["#item-queue"].children[0].children[1].listeners.click();
  assert.equal(f.ui.pending.length, 0); assert.equal(f.nodes["#item-count"].max, "2");
  assert.equal(f.nodes["#item-queue-button"].disabled, false);
});

test("owner selection and virtual stacks change the actual available count", () => {
  const f = fixture({ held: true, virtual: 1 }); f.update();
  assert.equal(f.nodes["#item-count"].max, "1");
  f.nodes["#item-owner"].value = "22"; f.update();
  assert.match(f.nodes["#item-limit"].textContent, /当前 4 \/ 上限 4 层.*已达到上限/);
  assert.equal(f.nodes["#item-queue-button"].disabled, true);
  f.nodes["#item-owner"].value = "11"; f.update();
  assert.equal(f.nodes["#item-queue-button"].disabled, false);
});

test("existing stack edits are counted alongside additions without accepting overflow", () => {
  const f = fixture({ fingerprint: "existing-item" });
  f.modifierInput.value = "1"; f.update();
  assert.equal(f.nodes["#item-count"].max, "3");
  assert.match(f.nodes["#item-limit"].textContent, /已改为 1 层/);
  f.nodes["#item-count"].value = "4"; f.queue();
  assert.equal(f.ui.pending.length, 0); assert.match(f.errors[0], /还能添加 3 层/);
  f.modifierInput.value = "5"; f.update();
  assert.equal(f.nodes["#item-queue-button"].disabled, true);
});

test("runtime limits over 99 are supported and locks still disable item writes", () => {
  const f = fixture({ current: 0, max: 200 }); f.update();
  f.nodes["#item-count"].value = "150"; f.queue();
  assert.equal(f.ui.pending[0].count, 150); assert.equal(f.nodes["#item-count"].max, "50");
  for (const flag of ["busy", "safetyLock"]) {
    f.state[flag] = true; f.update();
    assert.equal(f.nodes["#item-count"].disabled, true); assert.equal(f.nodes["#item-queue-button"].disabled, true);
    f.state[flag] = false;
  }
  delete f.ui.items[0].limits; f.update();
  assert.equal(f.nodes["#item-queue-button"].disabled, true);
  assert.match(f.nodes["#item-limit"].textContent, /暂时无法确定/);
});
