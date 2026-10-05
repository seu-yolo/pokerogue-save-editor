#!/usr/bin/env node
// Local, synthetic UI preview. This server does not connect to PokéRogue.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const allowed = new Set(["sidepanel/index.html", "sidepanel/styles.css", "sidepanel/app.js", "sidepanel/workflows.js", "src/shared/core.js", "src/shared/game-target.js", "tests/fixtures/ui-preview.js"]);
for (const name of ["rotom-icon.png", "rotom-sprite-sheet.png", "poke-ball.svg", "sparkle.svg", "egg-icons.png", "satchel.svg", "fonts/fusion-pixel-12px-proportional-zh_hans.otf.woff2"]) allowed.add(`sidepanel/assets/${name}`);
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/") { response.writeHead(302, { Location: "/sidepanel/index.html" }); response.end(); return; }
    const relative = pathname === "/" ? "sidepanel/index.html" : pathname.slice(1);
    if (!allowed.has(relative)) { response.writeHead(404); response.end("Not found"); return; }
    const assetType = relative.endsWith(".png") ? "image/png" : relative.endsWith(".svg") ? "image/svg+xml" : relative.endsWith(".woff2") ? "font/woff2" : null;
    let source = await readFile(path.join(root, relative), assetType ? undefined : "utf8");
    if (relative.endsWith(".html")) source = source.replace("<head>", '<head><script type="module" src="/tests/fixtures/ui-preview.js"></script>')
      .replace("<body>", '<body><aside class="demo-banner">界面预览 · 模拟数据 · 未连接游戏</aside>');
    response.writeHead(200, { "Content-Type": assetType || (relative.endsWith(".html") ? "text/html; charset=utf-8" : relative.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8"), "Cache-Control": "no-store" });
    response.end(source);
  } catch { response.writeHead(500); response.end("Preview read error"); }
});
server.listen(4178, "127.0.0.1", () => process.stdout.write("Synthetic RogueSave UI: http://127.0.0.1:4178/sidepanel/index.html\nNo real game or account is connected.\n"));
