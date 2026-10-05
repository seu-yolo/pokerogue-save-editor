# 界面素材

`0.4.1` 的名称是“洛托姆口袋”，界面使用肉鸽菜单式像素风。图片只作装饰，不代表修改后会获得图中的宝可梦或道具。

## 洛托姆像素精灵图

来自 [PokéRogue 素材仓库](https://github.com/pagefaultgames/pokerogue-assets)，取用版本为 Git 提交 `056a1f408f26a3be4fef243f7462cb43608c7928`。

| 本机文件 | 上游文件 | 使用方式 |
| --- | --- | --- |
| `sidepanel/assets/rotom-icon.png` | `images/pokemon/icons/4/479.png` | 头像，40×30 原图 |
| `sidepanel/assets/rotom-sprite-sheet.png` | `images/pokemon/479.png` | 收藏页，通过 CSS 显示第一帧，不修改原 PNG |

精灵图源文件为 261×261；第一帧位于 (0, 0)，尺寸 88×52，未旋转。布局信息来自上游 `images/pokemon/479.json`，本机参考副本在 `docs/assets/rotom-sheet-source.json`。不播放动画，不改变游戏中的洛托姆数据。图片显示使用 `image-rendering: pixelated`。

素材由 PokéRogue 仓库提供；Pokémon 原始角色权利属于其权利方。上游 [README](https://github.com/pagefaultgames/pokerogue-assets/blob/056a1f408f26a3be4fef243f7462cb43608c7928/README.md) 对可许可且适用的素材声明默认 CC-BY-NC-SA-4.0，并通过 REUSE 记录例外；部分原版图标使用 `LicenseRef-FAIR-USE`，其说明明确不主张重新许可原始权利。这里不把仓库公开或默认许可当成角色的独立授权。

保留上游 `CC-BY-NC-SA-4.0.txt` 和 `LicenseRef-FAIR-USE.txt` 于安装包的 `sidepanel/assets/licenses/`。这些文本用于记录上游条款与边界，不表示同一许可可无条件覆盖所有角色素材。公开发布、商用或声明项目许可前，需要单独处理角色与商标权利；不能把这些图统一标成 MIT 或“无版权”。

## 点阵图标

`poke-ball.svg`、`sparkle.svg` 和 `satchel.svg` 是本项目直接绘制的点阵 SVG。路径采用整数坐标和直角台阶，使用 `crispEdges`，不含脚本、外部引用或第三方嵌入图片。

## 肉鸽原生蛋图

2026-10-04 用游戏原生蛋图替换自绘的 `egg.svg`，同时用于扭蛋分页与扭蛋页标题旁的装饰。

- 本机文件：`sidepanel/assets/egg-icons.png`；原 PNG 未修改。
- 来源：[PokéRogue 素材仓库的 images/egg/egg_icons.png](https://github.com/pagefaultgames/pokerogue-assets/blob/909b43612324622608023b3beb2f24f4ef159c1d/images/egg/egg_icons.png)，提交 `909b43612324622608023b3beb2f24f4ef159c1d`，对应本机游戏 `v1.12.0.11` 的素材子模块。
- 上游 `egg_icons.json` 中普通蛋帧 `0`：位置 (0, 0)，尺寸 13×14，未旋转。通过 CSS 裁出该帧，以整数 2 倍／4 倍显示；没有重新绘制、裁剪或生成位图文件。
- 上游根 README 对可许可且适用的素材声明 CC-BY-NC-SA-4.0；已检查根及 `images/REUSE.toml`，此 PNG 没有匹配的例外注释。沿用本页前述第三方权利边界与随包许可文本，不将其统一归入项目代码许可。

普通蛋用于表示扭蛋功能，不表示添加的随机传说蛋会变成普通蛋。

## 中文像素字体

- 项目：[Fusion Pixel Font / 缝合像素字体](https://github.com/TakWolf/fusion-pixel-font)。
- 发行版本：[2026.09.25](https://github.com/TakWolf/fusion-pixel-font/releases/tag/2026.09.25)。
- 文件：`sidepanel/assets/fonts/fusion-pixel-12px-proportional-zh_hans.otf.woff2`，12px 比例模式、简体中文，未修改或裁剪。
- 许可：SIL Open Font License 1.1；完整版权与许可随扩展放在 `sidepanel/assets/fonts/OFL.txt` 和 `sidepanel/assets/fonts/LICENSES/`。

字体仅在扩展页面使用，不安装到系统。加载失败时保留本机中文与等宽字体回退。

## 未采用的生成草稿

非像素洛托姆插画保存在 `docs/assets/rotom-pocket-illustration.png`；原创像素小设备保存在 `docs/assets/pocket-companion-pixel.png`。均由内置 imagegen 工具生成，不进入安装包。最终界面按用户选择使用网上的真实洛托姆像素图，没有生成或编辑它。

原创小设备草稿的完整提示词：

> Generate an original pixel-art mascot for a friendly browser-game utility. The mascot is a tiny orange square electronic companion, like a cheerful pocket radio, with a teal rectangular screen containing two simple dot eyes and a small smile. It has a single short lightning antenna and little square feet, perched on a small blue-green canvas adventure pouch. Make this a wholly original gadget character, not a likeness of any existing fictional character. Authentic classic 16-bit RPG inventory sprite, visibly hand-placed square pixel clusters, logical 48-by-48 grid enlarged with exact nearest-neighbor scaling, only 12 flat colors, one dark outline, crisp stair-step silhouette and absolutely no antialiasing, smooth curves, gradients, 3D, glow or painterly textures. Compact centered whole-body composition, generous transparent padding, true transparent background. The sprite will be displayed at 96 pixels in a narrow UI. No letters, no numbers, no logos, no watermark, no scene background.

## 加载与预览

图片和字体随扩展本地加载，不新增权限，不向外部图片或字体服务发送请求。装饰图片使用空替代文本，按钮保留文字和键盘操作。安装包内的 `sidepanel/assets/CREDITS.txt` 保留简短来源说明。

`docs/assets/ui-collection-v0.4.1.jpg` 是最终像素风界面的本机合成数据预览，不包含真实账号或游戏存档。
