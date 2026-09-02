# WotBTools Showcase Assets

本目录保存 **presentation-only / showcase-only** 的视觉素材。它们只负责营造 WotBTools V2 的 WoT Blitz 战术分析氛围，不参与任何业务事实、地图坐标、车辆型号、战绩或 AI 证据判断。

## 核心规则

- 每个正式产品页面必须拥有自己的专属背景资产，不再使用一个 shared background 覆盖多个页面。
- **当前 SPA 正式展示层使用高质量 PNG**（`*-v1.png` / `hero-v4.png`）；它们是当前 showcase 的 canonical assets。
- V1/V2/V3 SVG 保留在仓库中作为 fallback / 视觉历史，**不再控制 SPA 正式页面**（正式 CSS 不优先引用它们）；独立静态页可使用专属 SVG 资产。
- 素材只负责氛围和页面识别；背景中的装饰性文字、Logo 或徽标必须来自已获授权的用户提供素材，不能替代真实 UI、按钮、业务数值或可交互状态。
- 背景只承担 atmosphere / product identity，不得作为 Replay、Map、Tankopedia、Rating 或 AI Review 的事实来源。
- 背景必须铺满 Topbar 下方整个 viewport（`position: fixed` 伪元素，见 `showcase-backgrounds.css` 的基础 contract）；不得只存在于 1420/1720/1760px content container 内；不使用 `background-attachment: fixed`。
- 表格、表单、真实地图、战局重建和操作按钮可读性优先；遮罩（light/dark）由 overlay/surface 控制，由 `showcase-backgrounds.css` + `showcase-backgrounds-v3.css` + `showcase-cohesion.css` 实现，不需要为明暗主题准备两套图片。

## 当前正式资产（PNG）映射

> 全部标记为 **REPLACEABLE_GENERATED_SHOWCASE_ASSET**：未来可直接替换同路径文件，无需改代码。替换后按「替换流程」检查三档响应式 crop。

| Page                 | File                                      | Role                                | 替换约束                                                                                                      |
|----------------------|-------------------------------------------|-------------------------------------|---------------------------------------------------------------------------------------------------------------|
| Home — Hero          | `home/hero-v4.png`                        | Hero 横幅背景（全屏 + hero 内背景） | 坦克主体应在画面右侧、左侧留暗色负空间给文案；保持宽幅（约 2.5:1）；背景文字不得替代真实 UI                       |
| Home — Replay 卡片   | `home/card-replay-analysis-v1.png`        | feature card media area（3:2 裁切） | 建议 3:2；主体居中即可，卡片以 object-fit: cover 裁切                                                         |
| Home — HoF 卡片      | `home/card-hall-of-fame-v1.png`           | feature card media area（3:2 裁切） | 同上                                                                                                          |
| Home — Coaching 卡片 | `home/card-coaching-v1.png`               | feature card media area（3:2 裁切） | 同上（训练场主题）                                                                                            |
| Home — Support 卡片  | `home/card-support-v1.png`                | feature card media area（3:2 裁切） | 同上（工坊/支持主题）                                                                                         |
| Replay Parser        | `replay/replay-hero-battlefield-v1.png`   | 全屏背景 + upload 战术表面          | 16:9；暗部为主；背景中的地图/标记仅作氛围，不作为回放事实                                               |
| Hall of Fame         | `hof/hof-hero-hall-v1.png`                | 全屏背景                            | 16:9；金色荣誉大厅主题                                                                                        |
| Rating               | `rating/rating-hero-analysis-v1.png`      | 全屏背景                            | 16:9；图片内即使有生成式 dashboard 元素也只能是低权重氛围，真实 Rating 数据必须覆盖在独立 readable surface 上 |
| Profile              | `profile/profile-hero-camp-v1.png`        | 全屏背景 + profile-hero 表面        | 16:9；不引入 avatar 依赖                                                                                      |
| Boost                | `boost/boost-hero-training-v1.png`        | 全屏背景                            | 16:9；训练场主题                                                                                              |
| Admin Users          | `admin/admin-hero-command-v1.png`         | 全屏背景（强度较弱）                | 16:9；Operations Console 优先，管理效率优先                                                                   |
| HoF Admin            | `hof-admin/hof-admin-hero-command-v1.png` | 全屏背景（强度较弱）                | 16:9；CRUD / review 数据必须保持清晰                                                                          |
| Version / Changelog  | `version/version-hero-workshop-v1.png`    | 全屏背景                            | 16:9；工坊主题                                                                                                |
| Contact              | `contact/contact-hero-radio-v1.png`       | 全屏背景                            | 16:9；通信塔/无线电主题                                                                                       |
| Sponsor              | `../../../public/sponsor-bg.png`          | 独立赞助页背景                      | 用户提供的原创素材；仅作赞助页氛围背景，不承载赞助配置或二维码                                               |

隐藏的 `PlaybackQaPage` 是 QA / production-component verification 页面，不属于正式产品 Showcase，因此不创建营销背景。

## CSS 引用（加载顺序见 `frontend/src/main.js`）

- `showcase-backgrounds.css`：全屏背景基础 contract + V2 SVG fallback。
- `showcase-backgrounds-v3.css`：**当前正式视觉覆盖层**，引用上表 PNG，必须在 V2 文件之后加载。
- `showcase-cohesion.css`：Replay / HoF 等产品 workspace 的统一深色战术表面 + 工具栏布局修正（最后加载）。

## 替换流程

1. 只替换目标页面自己的素材，不要顺带影响其他页面；保持同路径文件名不变。
2. 如果替换为 WebP/JPEG，更新 `showcase-backgrounds-v3.css` 对应 URL（以及 `showcase-cohesion.css` 中的 Replay 引用）。
3. 背景必须是纯视觉素材，不允许把 mockup 中的导航、文字、按钮直接烘焙进背景。
4. 检查 Desktop 1920px、约 834px Tablet、375×812 Mobile 的 `cover` crop。
5. 检查 Light / Dark，确保 overlay 后正文、表格和按钮仍清晰，同时背景仍明显可见。
6. 替换完成后，将本表该行状态保持为 `REPLACEABLE_GENERATED_SHOWCASE_ASSET`（或按实际来源更新标记）。

## 体积注意（performance follow-up）

当前 PNG 单张约 2–2.5MB，全站资产约 35MB（dist 产物）。浏览器只会在对应页面渲染时下载该页背景（CSS background-image 惰性加载），但 Home 页一次会加载 hero + 4 张卡片约 11MB。若后续需要优化体积，优先考虑 WebP/AVIF 编码或服务端尺寸分级，**不要牺牲画面质量**。

Last updated: 2026-09-03
