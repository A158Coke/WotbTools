# WotBTools Showcase Assets

本目录保存 **presentation-only / showcase-only** 的视觉素材。它们只负责营造 WotBTools V2 的 WoT Blitz 战术分析氛围，不参与任何业务事实、地图坐标、车辆型号、战绩或 AI 证据判断。

## 规则

- 当前 `*-v1.*` 都是临时展示素材，可在未来被真实 WoT Blitz 游戏截图、官方素材或人工制作素材替换。
- 页面只引用本目录稳定文件名；未来优先覆盖同名文件，避免改页面结构。
- 素材不得包含必须可读的文字、Logo、按钮或业务数值；真实 UI 文本必须由 Vue/CSS 渲染。
- Hero 建议 >= 1600px 宽，主体偏右，给左侧标题/CTA 留负空间。
- 普通页面背板必须低对比，不能影响表格、表单、地图、Rating 或按钮可读性。
- 任何素材都不能被当作真实战斗重建、地图语义、Tankopedia 或 Replay 证据。

## 当前素材

| 文件 | 用途 | 状态 | 替换要求 |
|---|---|---|---|
| `home/hero-v1.webp` | 首页 Hero | `TEMPORARY_GENERATED_ASSET` | 宽幅战场/坦克、主体偏右、左侧负空间、无内嵌文字 |
| `replay/replay-bg-v1.svg` | Replay Parser | `TEMPORARY_GENERATED_ASSET` | 低对比、不能影响上传区和宽表 |
| `reconstruction/tactical-bg-v1.svg` | AI Review / Reconstruction 外围 | `TEMPORARY_GENERATED_ASSET` | 只做外围氛围，真实 map panel 禁止用它冒充数据 |
| `hof/hof-bg-v1.svg` | 名人堂 / 排行榜 | `TEMPORARY_GENERATED_ASSET` | 暖金竞技感、低噪声 |
| `rating/rating-bg-v1.svg` | Rating / 数据竞技区 | `TEMPORARY_GENERATED_ASSET` | 深色数据感，不干扰数字/雷达图 |
| `profile/profile-bg-v1.svg` | Profile header | `TEMPORARY_GENERATED_ASSET` | 不使用 avatar；坦克轮廓只作装饰 |
| `boost/boost-bg-v1.svg` | 陪练页面 | `TEMPORARY_GENERATED_ASSET` | 战术训练氛围、表单可读性优先 |
| `admin/admin-bg-v1.svg` | Admin Operations Console | `TEMPORARY_GENERATED_ASSET` | 最弱视觉强度，不能抢 CRUD 操作 |
| `shared/utility-bg-v1.svg` | Version / Contact 等工具页 | `TEMPORARY_GENERATED_ASSET` | 文本优先、低对比 |

## 引用位置

所有页面背景统一由 `frontend/src/styles/showcase-backgrounds.css` 管理。

## 替换流程

1. 保持相同文件名直接覆盖，或同步更新 `showcase-backgrounds.css`。
2. 检查 Desktop 1920px、Tablet 834px、Mobile 375px 的 crop。
3. 检查 Light/Dark；背景必须有 overlay，不能直接压在正文下。
4. 更新本 README 的状态与替换说明。

Last updated: 2026-08-23
