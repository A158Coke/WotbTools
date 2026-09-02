# Frontend UI system（当前实现索引）

本文档是前端 UI 约定的 canonical 入口。具体 token 数值与页面规则以当前 CSS 和 `docs/DEVELOPER_GUIDE.md` 为准；本文件不复制页面级设计稿。

## UI Profile

- `frontend/src/composables/useUiProfile.js` 是 profile 的唯一 reactive owner，持久化 key 为 `wotb-ui-profile`。
- `showcase` 与 `classic` 只改变 Presentation 层；`data-theme` 从 profile 派生。两种 profile 共用组件、业务状态、API、spacing 和 layout。
- 首屏投影在 `frontend/index.html`，运行时 token 与 profile 覆盖分别位于 `frontend/src/styles/tokens.css` 和 `frontend/src/styles/classic-profile.css`。

## Layout and responsive contract

- 应用壳与通用 token：`frontend/src/styles/app-shell.css`、`tokens.css`；Showcase 分层样式：`showcase.css`、`showcase-workspaces.css`、`showcase-pages.css`、`showcase-regressions.css`。
- 复用 `layout-content`、`layout-wide`、`layout-data-workspace`、`layout-full-workspace` 等已有 primitive；宽表优先保持信息密度，横向滚动只能是字段过多时的明确 fallback。
- 当前支持 Desktop `>=1200px`、Tablet `768–1199px`、Mobile `<768px` 三档。窄屏保留任务语义，不能整体缩放页面来规避 overflow。
- Mobile 档断点统一写作 `@media (width < 768px)`（range 语法，无 1px 缝隙/重叠），JS 判断统一 `window.innerWidth < 768`；禁止再引入 `max-width: 767/768px` 或 640/560/520 等新散值（`app-shell.css` 保留一个带注释的 `max-width: 480px` 超窄手机块）。
- Mobile 档交互约定：`input/select/textarea` 字号 ≥16px（防 iOS 聚焦缩放，`app-shell.css` 全局兜底）；主要触控目标 ≥36px（参照 `PlayerRatingRadar` 缩放按钮）；modal 遮罩用固定暗色 scrim（`rgb(0 0 0 / .35|.72)`），禁止用 `color-mix(var(--text-heading))`（showcase 下语义反转成亮纱）。
- `index.html` viewport 已带 `viewport-fit=cover`；topbar、底部 sheet、drawer 预留 `env(safe-area-inset-*)`（当前非 edge-to-edge 解析为 0），新增贴顶/贴底固定元素时同步加 inset。
- 视觉回归至少检查对比度、overflow、sticky、hover/focus、loading/empty/error；页面级验收细节见 [`docs/DEVELOPER_GUIDE.md`](../DEVELOPER_GUIDE.md)。

## Canonical feature references

- Replay / Reconstruction workspace 样式归属：[`docs/frontend/replay-workspace.md`](replay-workspace.md)
- 地图与 Playback 视觉/数据契约：[`docs/features/battle-playback.md`](../features/battle-playback.md)
- tank marker 资产与 overlay 规则：[`frontend/src/assets/tank-icons/README.md`](../../frontend/src/assets/tank-icons/README.md)
- Tier X 车型资产生成与校验：[`docs/assets/tier-x-models/README.md`](../assets/tier-x-models/README.md)
