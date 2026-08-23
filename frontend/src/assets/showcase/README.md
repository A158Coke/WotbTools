# WotBTools Showcase Assets

本目录保存 **presentation-only / showcase-only** 的视觉素材。它们只负责营造 WotBTools V2 的 WoT Blitz 战术分析氛围，不参与任何业务事实、地图坐标、车辆型号、战绩或 AI 证据判断。

## 核心规则

- 每个正式产品页面必须拥有自己的专属背景资产，不再使用一个 `shared utility background` 覆盖多个页面。
- 当前 `*-v2.svg` 是临时可替换展示素材。未来可以逐页替换为真实 WoT Blitz 截图、官方素材或更高质量生成式 WebP。
- 素材不得包含必须可读的文字、Logo、按钮或业务数值；真实 UI 必须由 Vue/CSS 渲染。
- 背景只承担 atmosphere / product identity，不得作为 Replay、Map、Tankopedia、Rating 或 AI Review 的事实来源。
- 普通页面背景必须保持低对比；表格、表单、真实地图、战局重建和操作按钮的可读性优先。
- 如果替换格式或文件名，同步修改 `frontend/src/styles/showcase-backgrounds.css`。

## V2 页面专属资产

| 页面 | 文件 | 视觉主题 | 状态 |
|---|---|---|---|
| Home | `home/hero-v2.svg` | 暖金夕阳战场 + 右侧坦克剪影，左侧留 CTA 空间 | `TEMPORARY_SHOWCASE_ASSET` |
| Replay Parser | `replay/replay-bg-v2.svg` | 冷蓝灰城市废墟 / 战后复盘 | `TEMPORARY_SHOWCASE_ASSET` |
| AI Review / Reconstruction | `reconstruction/reconstruction-bg-v2.svg` | 战术地图、路线、网格、指挥环 | `TEMPORARY_SHOWCASE_ASSET` |
| Hall of Fame | `hof/hof-bg-v2.svg` | 金色荣誉大厅 / 奖章 / podium | `TEMPORARY_SHOWCASE_ASSET` |
| Rating | `rating/rating-bg-v2.svg` | 蓝色竞技数据、雷达图、趋势线 | `TEMPORARY_SHOWCASE_ASSET` |
| Profile | `profile/profile-bg-v2.svg` | 私人装甲车库 / 聚光灯 / 坦克剪影 | `TEMPORARY_SHOWCASE_ASSET` |
| Boost | `boost/boost-bg-v2.svg` | 高山训练场、靶圈、训练车辆 | `TEMPORARY_SHOWCASE_ASSET` |
| Admin Users | `admin/admin-bg-v2.svg` | 低亮度指挥中心 / operations console | `TEMPORARY_SHOWCASE_ASSET` |
| HoF Admin | `hof-admin/hof-admin-bg-v2.svg` | 证据档案、人工审核、批准印记 | `TEMPORARY_SHOWCASE_ASSET` |
| Version / Changelog | `version/updates-bg-v2.svg` | 蓝图、版本时间线、车辆工程线稿 | `TEMPORARY_SHOWCASE_ASSET` |
| Contact | `contact/contact-bg-v2.svg` | 通信塔、无线电波、远程联络 | `TEMPORARY_SHOWCASE_ASSET` |

隐藏的 `PlaybackQaPage` 是 QA / production-component verification 页面，不属于正式产品 Showcase，因此不创建营销背景。

## 旧 V1 素材

`*-v1.*` 暂时保留用于 Git 历史和视觉对比，但 V2 页面不应继续引用它们。待 PR120 最终视觉验收后可以单独清理旧资产。

## 替换流程

1. 只替换目标页面自己的素材，不要顺带影响其他页面。
2. 如果保持同名文件，可不修改页面结构；如果换扩展名，更新 `showcase-backgrounds.css`。
3. 检查 Desktop 1920px、约 834px Tablet、375×812 Mobile 的 crop。
4. 检查 Light / Dark，确保 overlay 后正文、表格和按钮仍清晰。
5. 更新本 README 的状态，例如从 `TEMPORARY_SHOWCASE_ASSET` 改为 `GAME_SCREENSHOT` / `FINAL_ART`。

Last updated: 2026-08-23
