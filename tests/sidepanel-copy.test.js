import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../sidepanel/index.html", import.meta.url), "utf8");
const workflows = await readFile(new URL("../sidepanel/workflows.js", import.meta.url), "utf8");

test("sidepanel uses the requested short game-style copy", () => {
  for (const text of [
    "重新连接并核对状态，不会刷新游戏页（出错了多刷新一下）",
    "非官方工具 · 为保留游戏体验请谨慎使用",
    "补给队伍状态", "解锁你喜欢的宝可梦（支持定制）", "就决定是你了！",
    "随机孵化，保留惊喜！", "填你想要的数量", "需要走完 100 波孵化时间",
  ]) assert.ok(html.includes(text), text);
  assert.match(html, /<span class="eyebrow">随机孵化<\/span>/);
  assert.ok(workflows.includes("这些内容你已经拥有！"));
  assert.doesNotMatch(html, /随即孵化/);
});

test("short copy keeps quantity semantics and recovery information available", () => {
  assert.match(html, /title="设置最终总数量，不是追加数量；不会抽蛋或消耗抽奖券。"/);
  assert.ok(html.includes("9,007,199,254,740,991"));
  assert.ok(html.includes("当前队伍招式不变，也不会增加糖果或通关次数。"));
  assert.ok(html.includes("官网正式版不能通过菜单导入恢复"));
  assert.ok(html.includes("JSON 不能直接导入游戏"));
  assert.ok(html.includes("保存前会自动留一份本机备份"));
});
