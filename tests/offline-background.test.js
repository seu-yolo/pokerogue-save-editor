import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

// Exercise the same background with the target module used by the offline
// package, without installing an extension or touching any actual game data.
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "roguesave-offline-test-"));
await cp(new URL("../src/", import.meta.url), path.join(fixtureRoot, "src"), { recursive: true });
await writeFile(path.join(fixtureRoot, "package.json"), '{"type":"module"}\n');
await writeFile(path.join(fixtureRoot, "src/shared/game-target.js"),
  'export const GAME_ORIGIN = "http://127.0.0.1:8000";\nexport const GAME_URL_PATTERN = "http://127.0.0.1/*";\n');
after(() => rm(fixtureRoot, { recursive: true, force: true }));

let listener;
let activeUrl = "http://127.0.0.1:8000/";
let otherTabs = [];
let injections = 0;
globalThis.chrome = {
  runtime: {
    onInstalled: { addListener() {} }, onStartup: { addListener() {} },
    onMessage: { addListener(value) { listener = value; } },
  },
  sidePanel: { async setPanelBehavior() {} },
  storage: { local: { async setAccessLevel() {} } },
  tabs: {
    async query(options) {
      const active = { id: 1, url: activeUrl };
      return options.active ? [active] : [active, ...otherTabs];
    },
  },
  scripting: {
    async executeScript(options) {
      injections += 1;
      assert.equal(options.target.tabId, 1);
      assert.equal(options.args[0].command, "inspect");
      return [{ result: { ok: true, code: "LOCAL_TEST" } }];
    },
  },
};
await import(pathToFileURL(path.join(fixtureRoot, "src/background/service-worker.js")));
function inspect(url, tabs = []) {
  activeUrl = url;
  otherTabs = tabs;
  injections = 0;
  return new Promise(resolve => listener({ type: "INSPECT" }, {}, resolve));
}

test("offline background accepts only the exact loopback game origin", async () => {
  assert.equal((await inspect("http://127.0.0.1:8000/")).ok, true);
  assert.equal(injections, 1);
  for (const url of ["https://pokerogue.net/", "http://127.0.0.1:4178/", "http://127.0.0.1:8001/",
    "http://localhost:8000/", "http://127.0.0.1.evil.example:8000/", "http://192.168.1.2:8000/"]) {
    assert.equal((await inspect(url)).ok, false, url);
    assert.equal(injections, 0, url);
  }
});

test("other loopback services do not count as duplicate games", async () => {
  const result = await inspect("http://127.0.0.1:8000/", [{ id: 2, url: "http://127.0.0.1:4178/" }]);
  assert.equal(result.ok, true);
  assert.equal(injections, 1);
});

test("multiple offline game tabs still reject injection", async () => {
  const result = await inspect("http://127.0.0.1:8000/", [{ id: 2, url: "http://127.0.0.1:8000/" }]);
  assert.equal(result.ok, false);
  assert.equal(injections, 0);
});
