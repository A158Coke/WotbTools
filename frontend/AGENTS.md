# frontend/ — 前端指令（Vue 3 + Vite）

> 仓库级硬约定见 `.agents/AGENTS.md`；环境/命令见 `docs/DEVELOPER_GUIDE.md`。

## 工具链（经 .nvmrc / package.json / CI 核对）

- Node 24（`.nvmrc`）；依赖安装 `npm ci`（CI 与 Dockerfile.frontend 一致）。
- 脚本：`npm run dev`（Vite，端口 5173）/ `npm test`（vitest run）/ `npm run build`（vite build）。提交前必须 `npm test` + `npm run build`。
- 死代码检查：`npx fallow check dead-code`（配置 `.fallowrc.json`；可选依赖误报先核实再处理）。

## 结构与约定

- 入口 `index.html`（工具集主页，单文件 `App.vue`）；`extended.html` = Rating V2 独立入口；`homepage/` = 工具集主页 + 赞助页。
- `src/composables/`（useTheme/useReplay/useColumns/useAuth 等）、`src/utils/`、`src/components/`、`src/styles/`、`src/data/`。
- **i18n**：所有文案在 `src/locales/{zh,en,ru}.json` 三语同步；显示名在 `player_labels`/`agg_labels`；稳定错误码走 `api_errors.*`；禁止硬编码文案。
- **跨站偏好**：主题/语言偏好写 `domain=.wotbtools.com` cookie（`utils/theme.js` 同款写法），localStorage 仅本地开发回退。
- **versions.json**（`src/data/`）：仅用户可见变更新增条目；`v` 递增不跳号、三语同条目、顶部追加、不改历史条目；纯技术/CI 变更不写。
- 测试文件与组件同目录（`*.test.js`），`// @vitest-environment happy-dom` 按需声明。

## AI 复盘前端边界

- SSE：`ReconstructionPage.vue` 用 fetch `ReadableStream` 解析 `/api/replay/analyze`；安全超时 `AI_ANALYZE_TIMEOUT_MS = 1_100_000` 与后端 1100s/nginx 1120s 对齐（改超时必须三层同步）。
- 地图鸟瞰素材唯一权威 `src/data/mapImages.js`；新增地图素材走 `docs/map-catalog.md` 流程。
- 战局回放方向语义：位置流覆盖（`POSITION_REPORTED/POSITION_STALE`）≠ 点亮；方向公式 `turretWorldYawDeg = normalize(hullYawDeg + turretRelativeYawDeg)`（单位度，最短圆弧插值见 `utils/battlePlayback.js`）；不得用 CSS filter 换阵营色、不得伪造朝向。
- **双层坦克标记契约**：复用 `src/assets/tank-icons/tank-marker-{friendly,enemy}-{hull,turret}.png`（512×512 RGBA、共同 pivot 256,256）；hull 按 `hullYawDeg`、turret 按 `turretWorldYawDeg` 整体旋转，炮管不得脱离炮塔；录像者 halo/选中 ring/最后已知淡化/阵亡 ✕ 为独立 overlay。规格见 `docs/assets/battle-replay/*` 与 `frontend/src/assets/tank-icons/README.md`。