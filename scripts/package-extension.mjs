#!/usr/bin/env node

import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DIST_ROOT = path.join(PROJECT_ROOT, "dist");
const OFFLINE_BUILD = process.argv.includes("--offline");
const OUTPUT_NAME = OFFLINE_BUILD ? "RogueSave-Offline" : "RogueSave";
const EXTENSION_ROOT = path.join(DIST_ROOT, OUTPUT_NAME);
const PACKAGE_ENTRIES = Object.freeze(["manifest.json", "src", "sidepanel", "LICENSE", "THIRD_PARTY_NOTICES.md"]);
const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db"]);
const RELEASE_ARCHIVE_PATTERN = /^RogueSave(?:-Offline)?-v\d+(?:\.\d+){0,3}\.zip$/;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

function relativeDisplay(target) {
  return path.relative(PROJECT_ROOT, target).split(path.sep).join("/");
}

function assertStrictChild(parent, target, label) {
  const relative = path.relative(parent, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} 不在允许的构建目录内：${target}`);
  }
}

async function readJson(filePath, label) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`无法读取 ${label}：${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} 不是有效 JSON：${error.message}`);
  }
}

async function archiveOldReleaseArchives(currentVersion) {
  const entries = await readdir(DIST_ROOT, { withFileTypes: true });
  const archiveRoot = path.join(DIST_ROOT, "archive");
  const archived = [];
  await mkdir(archiveRoot, { recursive: true });
  if ((await lstat(archiveRoot)).isSymbolicLink()) throw new Error("拒绝使用符号链接形式的归档目录");
  for (const entry of entries) {
    if (!RELEASE_ARCHIVE_PATTERN.test(entry.name)
      || entry.name === `RogueSave-v${currentVersion}.zip`
      || entry.name === `RogueSave-Offline-v${currentVersion}.zip`) continue;
    const target = path.join(DIST_ROOT, entry.name);
    assertStrictChild(DIST_ROOT, target, "旧版 ZIP");
    if (entry.isSymbolicLink()) {
      throw new Error(`拒绝归档符号链接形式的旧版 ZIP：${relativeDisplay(target)}`);
    }
    if (!entry.isFile()) {
      throw new Error(`旧版 ZIP 路径不是普通文件：${relativeDisplay(target)}`);
    }
    const destination = path.join(archiveRoot, entry.name);
    // Never overwrite an existing historical package. A naming collision keeps
    // both files intact for the user to resolve.
    await copyFile(target, destination, constants.COPYFILE_EXCL);
    await rm(target);
    archived.push(entry.name);
  }
  return archived.sort((left, right) => left.localeCompare(right, "en"));
}

function validateVersion(manifest, packageJson) {
  if (manifest.manifest_version !== 3) {
    throw new Error("仅支持打包 Manifest V3 扩展");
  }
  if (typeof manifest.version !== "string" || !/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) {
    throw new Error("manifest.json 中的 version 格式无效");
  }
  if (manifest.version !== packageJson.version) {
    throw new Error(`版本不一致：manifest=${manifest.version}，package=${packageJson.version}`);
  }
}

async function copyTree(source, destination) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    throw new Error(`拒绝打包符号链接：${relativeDisplay(source)}`);
  }
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = (await readdir(source, { withFileTypes: true }))
      .filter(entry => !IGNORED_NAMES.has(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      await copyTree(path.join(source, entry.name), path.join(destination, entry.name));
    }
    return;
  }
  if (!info.isFile()) {
    throw new Error(`拒绝打包非普通文件：${relativeDisplay(source)}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function listFiles(root, current = root) {
  const entries = (await readdir(current, { withFileTypes: true }))
    .filter(entry => !IGNORED_NAMES.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`构建目录中出现符号链接：${relativeDisplay(absolute)}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, absolute));
    } else if (entry.isFile()) {
      files.push({
        absolute,
        relative: path.relative(root, absolute).split(path.sep).join("/"),
      });
    } else {
      throw new Error(`构建目录中出现非普通文件：${relativeDisplay(absolute)}`);
    }
  }
  return files;
}

function collectManifestReferences(manifest) {
  const references = new Set();
  const add = value => {
    if (typeof value === "string" && value.trim()) references.add(value.trim());
  };
  const addIcons = icons => {
    if (typeof icons === "string") add(icons);
    else if (icons && typeof icons === "object") Object.values(icons).forEach(add);
  };

  add(manifest.background?.service_worker);
  add(manifest.action?.default_popup);
  addIcons(manifest.action?.default_icon);
  add(manifest.side_panel?.default_path);
  add(manifest.options_page);
  add(manifest.options_ui?.page);
  add(manifest.devtools_page);
  addIcons(manifest.icons);
  for (const contentScript of manifest.content_scripts || []) {
    (contentScript.js || []).forEach(add);
    (contentScript.css || []).forEach(add);
  }
  for (const resourceGroup of manifest.web_accessible_resources || []) {
    (resourceGroup.resources || []).forEach(add);
  }
  return [...references].sort();
}

function validatePackagePaths(files) {
  for (const file of files) {
    const parts = file.relative.split("/");
    if (!file.relative || file.relative.startsWith("/") || parts.includes("..") || parts.includes("")) {
      throw new Error(`归档路径无效：${file.relative}`);
    }
    if (Buffer.byteLength(file.relative, "utf8") > MAX_UINT16) {
      throw new Error(`归档路径过长：${file.relative}`);
    }
  }
}

function wildcardToRegExp(pattern) {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}

function verifyManifestReferences(manifest, files) {
  const packaged = new Set(files.map(file => file.relative));
  for (const rawReference of collectManifestReferences(manifest)) {
    const reference = rawReference.replaceAll("\\", "/");
    if (reference.startsWith("/") || reference.split("/").includes("..")) {
      throw new Error(`manifest 引用了不安全路径：${rawReference}`);
    }
    if (/[*?]/.test(reference)) {
      const matcher = wildcardToRegExp(reference);
      if (![...packaged].some(file => matcher.test(file))) {
        throw new Error(`manifest 通配路径没有匹配文件：${rawReference}`);
      }
    } else if (!packaged.has(reference)) {
      throw new Error(`manifest 引用的文件未进入构建目录：${rawReference}`);
    }
  }
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function buildZip(files) {
  if (files.length > MAX_UINT16) {
    throw new Error(`ZIP 文件数量超过上限：${files.length}`);
  }

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const utf8Flag = 0x0800;
  const dosTime = 0;
  const dosDate = (1 << 5) | 1; // 1980-01-01, deterministic output.

  for (const file of files) {
    const fileName = Buffer.from(file.relative, "utf8");
    const data = await readFile(file.absolute);
    if (data.length > MAX_UINT32 || localOffset > MAX_UINT32) {
      throw new Error(`文件或 ZIP 偏移超过 ZIP32 上限：${file.relative}`);
    }
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(utf8Flag, 6);
    localHeader.writeUInt16LE(0, 8); // Stored, no compression.
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, fileName, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4); // ZIP 2.0, created on Unix.
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(utf8Flag, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, fileName);

    localOffset += localHeader.length + fileName.length + data.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  if (localOffset > MAX_UINT32 || centralSize > MAX_UINT32 || localOffset + centralSize > MAX_UINT32) {
    throw new Error("构建内容超过 ZIP32 大小上限");
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

async function main() {
  const manifest = await readJson(path.join(PROJECT_ROOT, "manifest.json"), "manifest.json");
  const packageJson = await readJson(path.join(PROJECT_ROOT, "package.json"), "package.json");
  validateVersion(manifest, packageJson);
  if (OFFLINE_BUILD) {
    manifest.name = "洛托姆口袋 · 离线测试";
    manifest.short_name = "洛托姆口袋（离线）";
    manifest.description = "仅连接本机 127.0.0.1:8000 的 PokéRogue 离线测试环境，不访问官网账号。";
    // Chrome match patterns ignore ports; the background independently checks
    // the exact origin including :8000 before any injection or data operation.
    manifest.host_permissions = ["http://127.0.0.1/*"];
    manifest.action.default_title = "打开洛托姆口袋（离线测试）";
  }

  const archivePath = path.join(DIST_ROOT, `${OUTPUT_NAME}-v${manifest.version}.zip`);
  const temporaryArchivePath = `${archivePath}.tmp`;
  assertStrictChild(DIST_ROOT, EXTENSION_ROOT, "扩展输出目录");
  assertStrictChild(DIST_ROOT, archivePath, "ZIP 输出文件");
  assertStrictChild(DIST_ROOT, temporaryArchivePath, "ZIP 临时文件");

  await mkdir(DIST_ROOT, { recursive: true });
  await rm(temporaryArchivePath, { force: true });
  await rm(EXTENSION_ROOT, { recursive: true, force: true });
  await mkdir(EXTENSION_ROOT, { recursive: true });

  for (const entry of PACKAGE_ENTRIES) {
    await copyTree(path.join(PROJECT_ROOT, entry), path.join(EXTENSION_ROOT, entry));
  }
  if (OFFLINE_BUILD) {
    await writeFile(path.join(EXTENSION_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(EXTENSION_ROOT, "src/shared/game-target.js"),
      'export const GAME_ORIGIN = "http://127.0.0.1:8000";\nexport const GAME_URL_PATTERN = "http://127.0.0.1/*";\n');
    const htmlPath = path.join(EXTENSION_ROOT, "sidepanel/index.html");
    const html = await readFile(htmlPath, "utf8");
    await writeFile(htmlPath, html.replace("<body>", '<body><aside class="section-note" style="text-align:center">离线测试 · 仅连接 127.0.0.1:8000 · 不访问官网账号</aside>'));
  }

  const files = await listFiles(EXTENSION_ROOT);
  if (files.length === 0) throw new Error("扩展构建目录为空");
  validatePackagePaths(files);
  verifyManifestReferences(manifest, files);

  const archive = await buildZip(files);
  await writeFile(temporaryArchivePath, archive, { flag: "wx" });
  // Keep the previous release archive until the replacement has been built in
  // full. If copying or ZIP creation fails, users still retain the last package.
  await rm(archivePath, { force: true });
  await rename(temporaryArchivePath, archivePath);
  const archivedArchives = await archiveOldReleaseArchives(manifest.version);
  const archiveSha256 = createHash("sha256").update(archive).digest("hex");

  const sourceBytes = (await Promise.all(files.map(file => lstat(file.absolute))))
    .reduce((total, info) => total + info.size, 0);
  console.log(`${OUTPUT_NAME} v${manifest.version} 打包完成`);
  console.log(`目录：${relativeDisplay(EXTENSION_ROOT)}`);
  console.log(`归档：${relativeDisplay(archivePath)}`);
  if (archivedArchives.length > 0) {
    console.log(`旧版 ZIP 已保留到 dist/archive/：${archivedArchives.join("、")}`);
  }
  console.log(`SHA-256：${archiveSha256}`);
  console.log(`文件：${files.length} 个，源码 ${sourceBytes} 字节，ZIP ${archive.length} 字节`);
}

main().catch(error => {
  console.error(`打包失败：${error?.message || error}`);
  process.exitCode = 1;
});
