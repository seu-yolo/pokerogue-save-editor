# 文档导航

安装和使用从 [项目 README](../README.md) 开始，版本变化见 [更新记录](../CHANGELOG.md)。

- [架构与代码定位](ARCHITECTURE.md)：查找侧栏、后台、游戏适配和备份处理。
- [使用说明](USAGE.md)：功能范围、道具与收藏操作、错误处理、备份和撤销。
- [开发与维护](DEVELOPMENT.md)：运行测试、打包以及适配游戏更新。
- [离线测试](OFFLINE_TESTING.md)：游戏本体、独立扩展与原生备份的使用边界。
- [素材与许可](ASSETS.md)：像素图片、字体和第三方来源。
- [首发准备](RELEASE_PREPARATION.md)：私有源码上传、公开发布前的待办与验证范围。
- [2026-10-04 审查记录](REVIEW-2026-10-04.md)：当时的发现与验证范围；后续修复以更新记录为准。

`docs/assets/` 只存文档图片及素材来源信息；可执行复现脚本放在 `scripts/`，合成测试数据放在 `tests/fixtures/`。不要把真实账号导出或个人存档加入这些目录。

安装产物在本仓库 `dist/`，旧 ZIP 在 `dist/archive/`，均不提交到 Git。`dist/RogueSave/` 和 `dist/RogueSave-Offline/` 分别供 Chrome 加载官网版和离线版。原开发工作区中的已加载目录不随本仓库整理而移动或删除。
