# frontend/ — 前端指令（Vue 3 + Vite）

> 仓库级硬约定见 `.agents/AGENTS.md`；环境/命令见 `docs/DEVELOPER_GUIDE.md`。

## 工具链（经 .nvmrc / package.json / CI 核对）

- Node 24（`.nvmrc`）；依赖安装 `npm ci`（CI 与 Dockerfile.frontend 一致）。
- 脚本：`npm run dev`（Vite，端口 5173）/ `npm test`（vitest run）/ `npm run build`（vite build）。提交前必须 `npm test` + `npm run build`。
- 死代码检查：`npx fallow check dead-code`（配置 `.fallowrc.json`；可选依赖误报先核实再处理）。

## 结构与约定

- 入口 `index.html`（工具集主页，单文件 `App.vue`）；`homepage/` = 工具集主页 + 赞助页。
- `src/composables/`（useTheme/useReplay/useColumns/useAuth 等）、`src/utils/`、`src/components/`、`src/styles/`、`src/data/`。
- **i18n**：所有文案在 `src/locales/{zh,en,ru}.json` 三语同步；显示名在 `player_labels`/`agg_labels`；稳定错误码走 `api_errors.*`；禁止硬编码文案。
- **跨站偏好**：主题/语言偏好写 `domain=.wotbtools.com` cookie（`utils/theme.js` 同款写法），localStorage 仅本地开发回退。
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

## AI 复盘前端边界

- SSE：`ReconstructionPage.vue` 用 fetch `ReadableStream` 解析 `/api/replay/analyze`；安全超时 `AI_ANALYZE_TIMEOUT_MS = 1_100_000` 与后端 1100s/nginx 1120s 对齐（改超时必须三层同步）。
- 地图鸟瞰素材唯一权威 `src/data/mapImages.js`；新增地图素材走 `docs/reference/maps.md` 流程。
- 战局回放方向语义：位置流覆盖（`POSITION_REPORTED/POSITION_STALE`）≠ 点亮；方向公式 `turretWorldYawDeg = normalize(hullYawDeg + turretRelativeYawDeg)`（单位度，最短圆弧插值见 `utils/battlePlayback.js`）；不得用 CSS filter 换阵营色、不得伪造朝向。
- **双层坦克标记契约**：复用 `src/assets/tank-icons/tank-marker-{friendly,enemy}-{hull,turret}.png`（512×512 RGBA、共同 pivot 256,256）；hull 按 `hullYawDeg`、turret 按 `turretWorldYawDeg` 整体旋转，炮管不得脱离炮塔；录像者 halo/选中 ring/最后已知淡化/阵亡 ✕ 为独立 overlay。规格见 `docs/assets/battle-replay/*` 与 `frontend/src/assets/tank-icons/README.md`。
