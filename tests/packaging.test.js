import assert from "node:assert/strict";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const project = new URL("../", import.meta.url);
async function workspace(t, { standalone = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "roguesave-pack-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = standalone ? path.join(root, "rotom-pocket") : path.join(root, "projects", "roguesave");
  await mkdir(path.join(target, "scripts"), { recursive: true });
  for (const entry of ["manifest.json", "package.json", "src", "sidepanel", "LICENSE", "THIRD_PARTY_NOTICES.md", "scripts/package-extension.mjs"]) {
    await cp(new URL(entry, project), path.join(target, entry), { recursive: true });
  }
  const manifest = JSON.parse(await readFile(path.join(target, "manifest.json"), "utf8"));
  const dist = path.join(target, "dist"); await mkdir(dist);
  return { root, target, dist, version: manifest.version, pack: args => exec(process.execPath, [path.join(target, "scripts/package-extension.mjs"), ...args]) };
}

test("standalone clones build only inside their own repository and include third-party notices", async t => {
  const f = await workspace(t, { standalone: true });
  await f.pack([]); await f.pack(["--offline"]);
  await assert.rejects(lstat(path.join(f.root, "dist")), { code: "ENOENT" });
  for (const prefix of ["RogueSave", "RogueSave-Offline"]) {
    const notices = await readFile(path.join(f.dist, prefix, "THIRD_PARTY_NOTICES.md"), "utf8");
    assert.match(notices, /Third-Party Notices/);
    assert.match(notices, /MIT license applies to the original code/);
    assert.match(await readFile(path.join(f.dist, prefix, "LICENSE"), "utf8"), /MIT License/);
    const archive = await readFile(path.join(f.dist, `${prefix}-v${f.version}.zip`));
    assert.ok(archive.includes(Buffer.from("THIRD_PARTY_NOTICES.md")));
    assert.ok(archive.includes(Buffer.from("LICENSE")));
  }
});

test("packaging archives older official/offline ZIPs and keeps both current builds and loaded legacy folders", async t => {
  const f = await workspace(t);
  await writeFile(path.join(f.dist, "RogueSave-v0.0.1.zip"), "old official package");
  await writeFile(path.join(f.dist, "RogueSave-Offline-v0.0.1.zip"), "old offline package");
  const legacy = path.join(f.dist, "RogueSave-v0.0.1"); await mkdir(legacy);
  await writeFile(path.join(legacy, "installed-path.txt"), "keep loaded path");
  await f.pack([]); await f.pack(["--offline"]);
  assert.equal(await readFile(path.join(f.dist, "archive/RogueSave-v0.0.1.zip"), "utf8"), "old official package");
  assert.equal(await readFile(path.join(f.dist, "archive/RogueSave-Offline-v0.0.1.zip"), "utf8"), "old offline package");
  assert.equal(await readFile(path.join(legacy, "installed-path.txt"), "utf8"), "keep loaded path");
  for (const prefix of ["RogueSave", "RogueSave-Offline"]) {
    const archive = await readFile(path.join(f.dist, `${prefix}-v${f.version}.zip`));
    assert.equal(archive.readUInt32LE(0), 0x04034b50);
    assert.equal(JSON.parse(await readFile(path.join(f.dist, prefix, "manifest.json"), "utf8")).version, f.version);
  }
});

test("archive name collisions never overwrite or delete either historical package", async t => {
  const f = await workspace(t);
  const name = "RogueSave-v0.0.1.zip";
  await mkdir(path.join(f.dist, "archive"));
  await writeFile(path.join(f.dist, name), "original package");
  await writeFile(path.join(f.dist, "archive", name), "existing archive");
  await assert.rejects(f.pack([]));
  assert.equal(await readFile(path.join(f.dist, name), "utf8"), "original package");
  assert.equal(await readFile(path.join(f.dist, "archive", name), "utf8"), "existing archive");
});
