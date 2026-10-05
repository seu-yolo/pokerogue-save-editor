import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function runtimeSourceFiles(directory) {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = `${directory}${entry.name}`;
    if (entry.isDirectory()) files.push(...await runtimeSourceFiles(`${relative}/`));
    else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.push(relative);
  }
  return files.sort();
}

const runtimeFiles = [
  ...await runtimeSourceFiles("src/"),
  ...await runtimeSourceFiles("sidepanel/"),
];

test("release version is consistent across the package and runtime adapters", async () => {
  const [manifestSource, packageSource, coreSource, adapterSource, notices] = await Promise.all([
    readFile(new URL("manifest.json", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("src/shared/core.js", root), "utf8"),
    readFile(new URL("src/game/page-adapter.js", root), "utf8"),
    readFile(new URL("THIRD_PARTY_NOTICES.md", root), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const packageJson = JSON.parse(packageSource);
  assert.equal(manifest.version, packageJson.version);
  assert.match(coreSource, new RegExp(`EDITOR_VERSION\\s*=\\s*["']${manifest.version.replaceAll(".", "\\.")}["']`));
  assert.match(adapterSource, new RegExp(`ADAPTER_VERSION\\s*=\\s*["']${manifest.version.replaceAll(".", "\\.")}["']`));
  assert.match(notices, new RegExp(`RogueSave version ${manifest.version.replaceAll(".", "\\.")}`));
});

test("manifest keeps the extension on a minimal PokéRogue-only permission set", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["scripting", "sidePanel", "storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://pokerogue.net/*"]);
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'self'");
  assert.equal(Object.hasOwn(manifest, "content_scripts"), false);
  assert.equal(Object.hasOwn(manifest, "externally_connectable"), false);
});

test("every statically referenced side-panel element exists", async () => {
  const [html, app, workflows] = await Promise.all([
    readFile(new URL("sidepanel/index.html", root), "utf8"),
    readFile(new URL("sidepanel/app.js", root), "utf8"),
    readFile(new URL("sidepanel/workflows.js", root), "utf8"),
  ]);
  const ids = new Set([...(app + workflows).matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map(match => match[1]));
  assert.ok(ids.size > 20);
  for (const id of ids) {
    assert.match(html, new RegExp(`\\bid=["']${id}["']`), `missing #${id}`);
  }
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i);
});

test("extension sources contain no arbitrary-code or HTML injection primitives", async () => {
  for (const relative of runtimeFiles) {
    const source = await readFile(new URL(relative, root), "utf8");
    assert.doesNotMatch(source, /\beval\s*\(/, relative);
    assert.doesNotMatch(source, /\bnew\s+Function\s*\(/, relative);
    assert.doesNotMatch(source, /\.innerHTML\s*=/, relative);
    assert.doesNotMatch(source, /\.outerHTML\s*=/, relative);
  }
});

test("decorative images are bundled locally and have no external SVG dependencies", async () => {
  const html = await readFile(new URL("sidepanel/index.html", root), "utf8");
  const images = [...html.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
  assert.ok(images.length >= 5);
  for (const tag of images) {
    assert.match(tag, /\balt=""/);
    const source = tag.match(/\bsrc="([^"]+)"/)[1];
    assert.match(source, /^assets\/[a-z-]+\.(png|svg)$/);
    const asset = await readFile(new URL(`sidepanel/${source}`, root));
    assert.ok(asset.length > 0, source);
    if (source.endsWith(".svg")) {
      assert.doesNotMatch(asset.toString(), /<script|<foreignObject|\b(?:href|onload|onclick)\s*=|url\(/i);
    } else {
      assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.ok([4, 6].includes(asset[25]) || asset.includes(Buffer.from("tRNS")), "decorative PNG must retain transparency, including indexed sprites");
    }
  }
});

test("runtime code does not hard-code wave 188", async () => {
  const sources = await Promise.all(runtimeFiles.map(relative => readFile(new URL(relative, root), "utf8")));
  assert.doesNotMatch(sources.join("\n"), /\b188\b/);
});

test("gacha uses the official egg atlas with integer-scaled first frame", async () => {
  const [html, css, asset, credits] = await Promise.all([
    readFile(new URL("sidepanel/index.html", root), "utf8"),
    readFile(new URL("sidepanel/styles.css", root), "utf8"),
    readFile(new URL("sidepanel/assets/egg-icons.png", root)),
    readFile(new URL("sidepanel/assets/CREDITS.txt", root), "utf8"),
  ]);
  assert.equal([...html.matchAll(/src="assets\/egg-icons\.png"/g)].length, 2);
  assert.doesNotMatch(html, /assets\/egg\.svg/);
  assert.equal(asset.readUInt32BE(16), 64);
  assert.equal(asset.readUInt32BE(20), 15);
  assert.match(css, /\.egg-icon\s*\{[^}]*width:\s*26px;[^}]*height:\s*28px;[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.egg-icon--large\s*\{[^}]*width:\s*52px;[^}]*height:\s*56px/s);
  assert.match(credits, /images\/egg\/egg_icons\.png/);
});

test("pixel font is local, complete WOFF2, and ships its upstream license notices", async () => {
  const css = await readFile(new URL("sidepanel/styles.css", root), "utf8");
  assert.match(css, /@font-face/);
  assert.match(css, /font-display:\s*swap/);
  assert.doesNotMatch(css, /url\(["']?https?:/);
  const fontReferences = [...css.matchAll(/url\("(assets\/fonts\/[^\"]+\.woff2)"\)/g)];
  assert.equal(fontReferences.length, 1);
  const font = await readFile(new URL(`sidepanel/${fontReferences[0][1]}`, root));
  assert.equal(font.subarray(0, 4).toString(), "wOF2");
  assert.equal(font.readUInt32BE(8), font.length);
  for (const relative of ["OFL.txt", "LICENSES/ark-pixel/OFL.txt", "LICENSES/cubic-11/OFL.txt", "LICENSES/galmuri/LICENSE.txt"]) {
    const license = await readFile(new URL(`sidepanel/assets/fonts/${relative}`, root), "utf8");
    assert.match(license, /SIL OPEN FONT LICENSE/i);
  }
});
