# 架构与代码定位

## 目录

```text
rotom-pocket/
├── manifest.json                 Chrome 入口、权限与 CSP
├── package.json                  无第三方依赖的开发命令
├── README.md                     安装、使用与故障提示
├── THIRD_PARTY_NOTICES.md         第三方与商标说明
├── src/
│   ├── shared/core.js            共用纯函数与常量
│   ├── background/service-worker.js
│   │                            Chrome API、通信及本地事务记录
│   └── game/page-adapter.js      游戏 MAIN world 的自包含适配器
├── sidepanel/
│   ├── index.html               侧栏结构
│   ├── styles.css               侧栏样式
│   ├── app.js                   局内交互、恢复锁、备份展示
│   └── workflows.js             四页导航、收藏／券／新增道具交互
├── tests/
│   ├── core.test.js             参数校验与备份处理
│   ├── background.test.js       Chrome API 模拟与后台事务
│   ├── page-adapter.test.js     模拟游戏、写入、撤销、蛋与遭遇
│   ├── static.test.js           版本、权限、DOM 与源码检查
│   └── fixtures/assets/         页面模块发现用的合成夹具
├── scripts/
│   ├── check.mjs                递归检查项目 JavaScript 语法
│   ├── package-extension.mjs    扩展目录与 ZIP 打包
│   └── ui-preview.mjs           仅本机的合成数据 UI 预览
└── docs/
    ├── ARCHITECTURE.md           本文
    └── DEVELOPMENT.md            测试、构建与适配维护
```

构建产物统一在本仓库 `dist/`，由 `.gitignore` 排除。个人存档、账号导出和本地游戏不混入源码或测试夹具。

## 运行边界

侧栏 `app.js` 通过 `chrome.runtime.sendMessage` 请求后台。后台确定唯一游戏标签页，通过 `chrome.scripting.executeScript` 将 `pokeroguePageCommand` 注入页面的 MAIN world；适配器读取或修改游戏对象，返回结果，由后台记录事务、侧栏展示结果。

共用 `core.js` 仅供侧栏和后台导入，不直接访问 Chrome API 或游戏对象。

`page-adapter.js` 虽然较长，但导出的函数必须保持自包含：Chrome 序列化的是函数本身，不会把模块导入和外层闭包一起搬到页面。适配器需要的常量与辅助函数保留在 `pokeroguePageCommand` 内。不要为了缩短文件直接抽出运行时依赖；将来确需拆分时，先实现并验证能生成自包含函数的构建方式。

## 按功能找代码

| 修改方向 | 入口 |
| --- | --- |
| 输入范围、请求参数、预览操作 | `shared/core.js` 的 `buildOperations`、`buildLegendaryEggRequest` |
| 本地备份摘要、保留策略 | `shared/core.js` 的 `backupSummary`、`pruneBackups` |
| 活动标签页、页面注入 | `background/service-worker.js` 的 `activeGameTab`、`runInGame` |
| 保存、撤销与结果待确认 | 后台的 `handleCommit`、`handleUndo`、`handleResolveOrphanedRequest` |
| 游戏对象发现、版本和只读原因 | `game/page-adapter.js` 的 `resolveScene`、`getVersion`、`inspectScene` |
| 队伍恢复与资源修改 | 适配器的 `preflightOperations`、`applyOperations` |
| 存档解析、保存回读与回滚 | 适配器的 `buildPersistencePlan`、`persistAndVerify`、`rollbackAndVerify` |
| 随机传说蛋 | 适配器的 `findEggGachaHandler`、`addLegendaryEggs` |
| 永久初始收藏／券 | 适配器的 `gameExports`、`starterRow`、`planAccount`、`commitAccount`；后台 `handleAccountCommit` |
| 新增道具 | 适配器的 `makeItem`、`itemCatalog`、`itemPlan`，复用局内保存与撤销流程 |
| 一次性地形稀有遭遇 | 适配器的 `forceRarestArenaPools`、`armRareEncounter`、`cancelRareEncounter` |
| 侧栏功能、预览、备份展示 | `sidepanel/app.js` 的 `collectDraft`、`renderPreview`、`renderBackups` |
| 收藏和扭蛋页面 | `sidepanel/workflows.js` 的 `selectSpecies`、`previewAccount`、`saveAccount` |

表中源码路径均相对于 `src/`，侧栏路径除外。现有局内保存、回读、回滚和不确定状态保护继续保留。

账号修改复用后台请求去重、写入锁和事务备份，在记录中追加 `kind: account`、`accountIdentity`、`beforeSystem`／`afterSystem`。保存前比较原始账号快照以拒绝陈旧预览，不新增哈希、基线或门禁。官方 `saveSystem()` 可能先写浏览器缓存再请求服务器，所以保存失败后必须保留不确定状态，而不能仅凭本地回滚宣称服务器未写入。账号不确定事务按账号隔离，跨槽位和波数仍有效。

官方枚举和工厂来自游戏入口已静态导入的模块，不打包游戏本体，也不扫描或执行无关动态模块。集合只添加合法初始选项；道具只通过列出的官方工厂构造。账号快照不支持直接导入或一键撤销，用户需要事先下载原生账号 `.prsv`。

## 测试夹具

`tests/fixtures/assets/FadeOut-fixture.js` 只导出测试进程构造的模拟场景。模块发现测试的入口脚本由 `fetch` 桩返回，`index-test.js` 与 `game.html` URL 是合成地址，不需要对应实体文件。不要放入真实账号、真实存档或下载的游戏构建文件。
