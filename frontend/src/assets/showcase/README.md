# WotBTools Showcase Assets

本目录保存 **presentation-only / showcase-only** 的视觉素材。它们只负责营造 WotBTools V2 的 WoT Blitz 战术分析氛围，不参与任何业务事实、地图坐标、车辆型号、战绩或 AI 证据判断。

## 核心规则

- 每个正式产品页面必须拥有自己的专属背景资产，不再使用一个 shared background 覆盖多个页面。
- 当前正式展示层使用 `*-v3.svg`；V3 相比 V2 强化战火、烟尘、废墟、火光和高对比，属于临时可替换 showcase art。
- V2 继续保留为 fallback / 视觉历史，不作为当前首选背景。
- 素材不得包含必须可读的文字、Logo、按钮或业务数值；真实 UI 必须由 Vue/CSS 渲染。
- 背景只承担 atmosphere / product identity，不得作为 Replay、Map、Tankopedia、Rating 或 AI Review 的事实来源。
- 背景必须铺满 Topbar 下方整个 viewport；不得只存在于 1420/1720/1760px content container 内。
- 表格、表单、真实地图、战局重建和操作按钮可读性优先，遮罩由 `showcase-backgrounds.css` + `showcase-backgrounds-v3.css` 控制。

## V3 页面专属资产

| 页面 | 当前文件 | 视觉主题 | 状态 |
|---|---|---|---|
| Home | `home/hero-v3.svg` | 燃烧夕阳战场、烟尘、右侧坦克 | `TEMPORARY_SHOWCASE_ASSET` |
| Replay Parser | `replay/replay-bg-v3.svg` | 冷蓝城市废墟、远景火点、战后复盘 | `TEMPORARY_SHOWCASE_ASSET` |
| AI Review / Reconstruction | `reconstruction/reconstruction-bg-v3.svg` | 热/冷战术路线、战场火点、指挥网格 | `TEMPORARY_SHOWCASE_ASSET` |
| Hall of Fame | `hof/hof-bg-v3.svg` | 金色荣誉大厅、奖章、战火边缘 | `TEMPORARY_SHOWCASE_ASSET` |
| Rating | `rating/rating-bg-v3.svg` | 蓝橙竞技数据场、雷达、多维线路 | `TEMPORARY_SHOWCASE_ASSET` |
| Profile | `profile/profile-bg-v3.svg` | 私人装甲车库、坦克、维修区火光 | `TEMPORARY_SHOWCASE_ASSET` |
| Boost | `boost/boost-bg-v3.svg` | 高山战斗训练场、坦克、边缘火点 | `TEMPORARY_SHOWCASE_ASSET` |
| Admin Users | `admin/admin-bg-v3.svg` | 战时指挥中心、监控墙、外围火光 | `TEMPORARY_SHOWCASE_ASSET` |
| HoF Admin | `hof-admin/hof-admin-bg-v3.svg` | 审核档案、荣誉标识、边缘战火 | `TEMPORARY_SHOWCASE_ASSET` |
| Version / Changelog | `version/updates-bg-v3.svg` | 战斗遥测、版本时间线、战火节点 | `TEMPORARY_SHOWCASE_ASSET` |
| Contact | `contact/contact-bg-v3.svg` | 战地通信塔、无线电波、燃烧周界 | `TEMPORARY_SHOWCASE_ASSET` |

隐藏的 `PlaybackQaPage` 是 QA / production-component verification 页面，不属于正式产品 Showcase，因此不创建营销背景。

## CSS 引用

- `showcase-backgrounds.css`：全屏背景基础 contract + V2 fallback。
- `showcase-backgrounds-v3.css`：当前正式 V3 视觉覆盖层，必须在 V2 文件之后加载。

## 替换流程

1. 只替换目标页面自己的素材，不要顺带影响其他页面。
2. 优先保持当前稳定路径；如果替换为 WebP/JPEG，更新 `showcase-backgrounds-v3.css` 对应 URL。
3. 背景必须是纯视觉素材，不允许把 mockup 中的导航、文字、按钮直接烘焙进背景。
4. 检查 Desktop 1920px、约 834px Tablet、375×812 Mobile 的 `cover` crop。
5. 检查 Light / Dark，确保 overlay 后正文、表格和按钮仍清晰，同时背景仍明显可见。
6. 最终素材确认后，将状态更新为 `GAME_SCREENSHOT` / `FINAL_ART`。

Last updated: 2026-08-23
