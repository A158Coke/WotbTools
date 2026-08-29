# frontend/ — 前端指令（Vue 3 + Vite）

> 仓库级硬约定见 `.agents/AGENTS.md`；环境/命令见 `docs/DEVELOPER_GUIDE.md`。

## 工具链（经 .nvmrc / package.json / CI 核对）

- Node 24（`.nvmrc`）；依赖安装 `npm ci`（CI 与 Dockerfile.frontend 一致）。
- 脚本：`npm run dev`（Vite，端口 5173）/ `npm test`（vitest run）/ `npm run build`（vite build）。提交前必须 `npm test` + `npm run build`。
- 死代码检查：`npx fallow check dead-code`（配置 `.fallowrc.json`；可选依赖误报先核实再处理）。

## 结构与约定

- 入口 `index.html`（Vue SPA）；`homepage/` 只保留独立赞助页及其运行时配置，不再维护旧静态主页/个人中心副本。
- `src/composables/`（useReplay/useColumns/useAuth 等）、`src/utils/`、`src/components/`、`src/styles/`、`src/data/`。
- **主题策略（由 UI Profile 派生）**：`data-theme` 不是独立主题偏好，而是由 UI Profile 唯一派生——`showcase`→`dark`、`classic`→`light`（`useUiProfile.themeForProfile`）。`index.html` 首屏内联脚本按 `wotb-ui-profile` 同时设置 `data-ui-profile` 与派生的 `data-theme`。禁止恢复独立 `useTheme`、`utils/theme.js` 或 `wotbtools-theme` cookie/localStorage；禁止第二个主题持久化 key。
- **UI Profile（展示风格，唯一持久化状态）**：用户可经菜单在 `showcase`（沉浸，默认，深色）/ `classic`（真浅色简约）间切换，仅改变 Presentation 层视觉；业务组件/状态/API/结构**不得**按 Profile fork。`html[data-ui-profile]` + `html[data-theme]`（均由 `index.html` 内联脚本/`useUiProfile` 维护）+ `useUiProfile` composable 是唯一状态源（唯一持久化 `wotb-ui-profile`）；Classic 经 `styles/classic-profile.css` 的 `html[data-ui-profile="classic"]` 提供完整浅色语义 token + namespace 覆盖关闭全屏 AI/装饰背景与视觉噪音，不改 spacing/density/layout；禁止 `:key="uiProfile"` 触发组件重建，禁止新建 `classic/`、`showcase/` 双套业务组件，禁止恢复 `useTheme`。
- **i18n**：基础文案在 `src/locales/{zh,en,ru}.json`；按功能追加的文案放 `feature-messages.json`，由 `messages.js` 深合并且不得修改基础 locale 对象。三语必须同步；显示名在 `player_labels`/`agg_labels`；稳定错误码走 `api_errors.*`；禁止在 `main.js` 或组件启动阶段动态 patch locale 对象。
- **跨站偏好**：当前只持久化语言 `wotb-lang` 与 UI 风格 `wotb-ui-profile`（设于 `html[data-ui-profile]`，`data-theme` 由其派生）；没有独立主题偏好状态。
- **versions.json**（`src/data/`）：仅用户可见变更新增条目；`v` 递增不跳号、三语同条目、顶部追加、不改历史条目；纯技术/CI 变更不写。
- 测试文件与组件同目录（`*.test.js`），`// @vitest-environment happy-dom` 按需声明。
- **Tier X 专属车型系统**（`src/vehicle-models/`）：Tankopedia Tier X 100% 覆盖由
  `coverage.test.js` 强制；**正式车型 SVG 由 `scripts/extract-tier-x-model.mjs` 从 BlitzKit
  真实模型确定性生成**（model.glb + models.pb，节点契约/坐标语义见 spec；禁止 AI/人工绘制 geometry、
  禁止 patch SVG path——发现问题修 extractor 重新生成）；仅开发者资产 CLI
  （extractor/baker/`blitzkit-references.mjs`）允许访问 BlitzKit 网络，production/Battle Playback/CI
  均不联网；Details Panel Tier X 车型图由 `blitzkit-references.mjs --emit-portraits` 生成后随站点发布；
  生成正式俯视模型后跑 `node frontend/scripts/validate-vehicle-models.mjs`
  自检（正式资产强制 metadata source.provider=blitzkit）；隐藏 QA 页 `?view=vehicle-models`
  （仅 wotbtools-admin，App.vue 必须保持异步加载——`scripts/check-bundle-separation.mjs` 构建后强制
  主 bundle 不含车型资产）；图层旋转数学统一走 `src/vehicle-models/pivot.js`
  （transform-origin = metadata turretPivot，禁止 translate 平移近似，改旋转数学先改 pivot.test.js）；
  extractor 纯函数改完同步跑 `src/vehicle-models/extractor.test.js`。

## V2 Showcase UI / Layout 硬约束

- 全站视觉目标是 **WoT Blitz Tactical Analytics / Operations Console**：深石墨表面 + amber/gold 主强调色 + 高数据密度；不要退化成普通白色 SaaS Dashboard，也不要为了“游戏感”牺牲表格与工具效率。
- 现有 WotBTools Logo 是唯一品牌 Logo；普通用户页不引入 avatar。Profile identity 只使用用户名/游戏账号信息。
- 视觉素材优先级：真实 WoT Blitz 截图 / 项目地图素材 / BlitzKit 资产 > 可替换的 showcase AI 背景。AI 生成背景只允许作为 presentation atmosphere，不得作为地图事实、坦克数据、车型 geometry 或战局证据；资产必须独立文件，方便未来直接替换。
- 全局 Showcase 样式按职责分层：`styles/showcase.css`（shell/tokens/layout）、`showcase-workspaces.css`（Replay/Reconstruction）、`showcase-pages.css`（其余页面）。禁止继续把页面私有视觉规则无边界塞进 `App.vue`。
- **禁止新增任意随机 `max-width`**。优先使用既有 layout primitive：
  - content：约 1420px，Profile/普通内容；
  - wide：约 1720px，HoF/Rating/排行；
  - data-workspace：约 1760px，Replay/大型数据表/Admin；
  - full-workspace：100%，战局重建/地图/战术画布。
- Replay Parser 是最高频工具：Desktop 必须尽可能使用可用宽度，Table 保持高 information density；不要把玩家行改成大型 Card。允许 sticky header / sticky 关键列 / 横向滚动，横滚是字段过多的 fallback，而不是窄 container 的副作用。
- **Replay Workspace 语义**：上传区的「解析预览 / 战局回放 / AI 复盘」是三个一级能力。单文件可直接进入 AI/Playback；多文件必须显式选择目标 replay，禁止 fallback 第一场。解析后的 Aggregate/Summary 本身不代表具体 battle，因此结果 toolbar 的 Battle-level action 仍只在具体 battle tab 出现。
- Reconstruction/Map/Strategy 类型页面按 workspace 设计：地图/画布吃最大空间，Inspector/Timeline/Toolbar 围绕画布布局；禁止再套 1100–1200px 居中页面。
- Admin 使用同一 Design System，但视觉定位是 Operations Console；高风险删除动作不能与“查看”同权重长期红色高亮。
- **响应式必须同时覆盖三档**，不能先做 Desktop 后用 scale 缩小：
  - Desktop `>=1200px`：完整导航、高数据密度、完整 workspace；
  - 11 英寸级 Tablet `768–1199px`：保留主要工具和导航语义，侧栏/操作栏可收缩或横滚；不要把 tablet 当 phone；
  - Mobile `<768px`（以 iPhone 11 级约 375×812 为基准）：核心任务优先，复杂表格允许关键列 + 横滚/展开，Inspector 改 bottom sheet/单列；不得整体 `transform: scale()`。
- 每个页面修改完成必须人工检查至少 1920px Desktop、约 834px Tablet、约 375px Mobile，并检查暗色下的 contrast、overflow、sticky、hover/focus、loading/empty/error。

## AI 复盘前端边界

- SSE：AI 复盘由 `ReplayPage` Workspace 内的 `AiReviewPanel.vue` 发起——先拿到 authoritative Dataset 引用（`processingJobId` + `sourceId`），经 JSON POST `/api/replay/analyze` 后以 fetch `ReadableStream` 解析 SSE（call1/evidence/call2/autopsy 阶段事件 + call2_token 主复盘增量）；`BattlePlaybackPanel.vue` 读 `map-overview.json` 经过 `/api/replay/map-overview`（JSON）。安全超时 `AI_ANALYZE_TIMEOUT_MS = 1_100_000` 与后端 1100s/nginx 1120s 对齐（改超时必须三层同步）。AI/Playback 共用同一 Processing Dataset，绝不回退 multipart 重新上传/重新 full-process。
- 地图鸟瞰素材唯一权威 `src/data/mapImages.js`；新增地图素材走 `docs/reference/maps.md` 流程。
- 战局回放方向语义：位置流覆盖（`POSITION_REPORTED/POSITION_STALE`）≠ 点亮；方向公式 `turretWorldYawDeg = normalize(hullYawDeg + turretRelativeYawDeg)`（单位度，最短圆弧插值见 `utils/battlePlayback.js`）；不得用 CSS filter 换阵营色、不得伪造朝向。
- **双层坦克标记契约**：复用 `src/assets/tank-icons/tank-marker-{friendly,enemy}-{hull,turret}.png`（512×512 RGBA、共同 pivot 256,256）；hull 按 `hullYawDeg`、turret 按 `turretWorldYawDeg` 整体旋转，炮管不得脱离炮塔；录像者 halo/选中 ring/最后已知淡化/阵亡 ✕ 为独立 overlay。规格见 `docs/assets/battle-replay/*` 与 `frontend/src/assets/tank-icons/README.md`。
