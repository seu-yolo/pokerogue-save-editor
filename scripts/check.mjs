#!/usr/bin/env node

import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

async function collectJavaScript(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJavaScript(target));
    else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.push(target);
  }
  return files.sort();
}

const files = (await Promise.all(
  ["src", "sidepanel", "scripts", "tests"].map(directory =>
    collectJavaScript(path.join(projectRoot, directory))),
)).flat();

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}

if (!process.exitCode) console.log(`语法检查通过：${files.length} 个 JavaScript 文件。`);
