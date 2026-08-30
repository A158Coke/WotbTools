# frontend/ — 前端硬规则（Vue 3 + Vite）

仓库级规则见 [`.agents/AGENTS.md`](../.agents/AGENTS.md)，命令与架构背景见
[`docs/DEVELOPER_GUIDE.md`](../docs/DEVELOPER_GUIDE.md)。本文件只保留执行约束；产品事实、接口细节和资产规范以文末 canonical docs 为准。

## Toolchain / Fast Feedback

- 使用 `.nvmrc` 规定的 Node 24；依赖安装使用 `npm ci`。
- 常用命令：`npm run dev`、`npm test`（Vitest）、`npm run build`（Vite）。
- 先跑与改动直接相关的测试：`npx vitest run <related-test-files>`；多文件 feature 再跑对应 feature suite。
- 不因小改动重复跑全量测试或 build。路由、依赖、Vite、动态 import、资产管线或生产编译改动才在本地扩大验证；repository full validation 由 PR CI 负责。

## Architecture boundaries

- 需要路由、页面/组件归属、composable 状态、API 边界或跨 feature import 时，必须先读取
  [`.agents/skills/frontend-architecture/SKILL.md`](../.agents/skills/frontend-architecture/SKILL.md)，并以
  [`docs/frontend/architecture.md`](../docs/frontend/architecture.md) 为当前实现事实。
- 依赖方向为 `app → features → shared`。现有 flat `components/`、`composables/`、`utils/` 是当前代码布局；不得为了“对齐架构”创建空壳目录或虚构尚未实现的迁移。
- 每个业务状态只有一个权威 owner；其他组件只通过 props、事件、provide/inject 或 computed 消费，不复制并行状态。`watch()` 只用于真实副作用或生命周期桥接。

## Vue component / API boundary

- Vue 组件负责渲染、交互编排和局部视图状态；可复用业务规则放在 composable 或纯函数模块，并由测试覆盖。
- API 请求集中在已有 API/util 边界；组件不得重造鉴权、上传、错误解析或 dataset identity 逻辑。
- 后端 API 保持稳定英文 key/data 契约；用户文案、显示名和错误本地化留在 locale/display 层。
- 路由历史、深链和 Back/Forward 由 Vue Router 所有；组件不得手写 `history.pushState`、`replaceState` 或 `popstate`。

## UI Profile invariant

- `showcase` / `classic` 是 Presentation Profile，共用同一套业务组件、状态、API 和结构。
- `wotb-ui-profile` 是唯一持久化 profile；`data-theme` 只能由 profile 派生，不得恢复独立 theme state、存储 key 或 `useTheme`。
- 切换 profile 不得通过 `:key` 重建组件，也不得创建 `classic/` 与 `showcase/` 两套业务实现。
- 主题 token、Profile 投影和例外覆盖见 [`docs/frontend/ui-system.md`](../docs/frontend/ui-system.md)。

## Responsive hard constraints

- 保留既有 layout primitives；不得用任意新的 `max-width` 或整体 `transform: scale()` 掩盖布局问题。
- 同时验证三档：Desktop `>=1200px`、Tablet `768–1199px`、Mobile `<768px`。Tablet 不是缩小版 phone；复杂表格可用关键列 + 横向滚动，Inspector 在窄屏使用单列/面板布局。
- 页面变更检查 overflow、sticky、hover/focus、loading/empty/error，以及 Classic/Showcase 下的对比度。

## Testing rules

- 测试与组件/模块同目录，命名 `*.test.js`；按需声明 `happy-dom` 环境。
- 回归测试必须锁定真实 invariant（状态 owner、路由契约、API boundary、Profile 或响应式约束），不能只断言函数被调用。
- 修改架构边界时覆盖受影响的深链、历史导航、认证目的地或共享状态；修改 build/dependency 时运行 `npm run build`。
- 变更后执行 review-fix；影响界面、构建或文档时再执行 review-with-docs。

## Forbidden patterns

- 不得在组件内恢复手写路由历史、跨 feature 私有 import，或让 `shared/` 依赖 `features/`。
- 不得为同一业务状态建立第二个 owner、隐式 watcher 同步副本，或按 Profile fork 业务流程。
- 不得把 endpoint/timeout、回放方向数学、tank marker 像素契约、Tier X 生成流程、Replay Workspace 产品 contract 或页面级 Showcase 设计长期堆回本文件。
- 不得在没有真实代码与 canonical 文档依据时补写尚未实现的结构或产品行为。

## Canonical docs

- 当前应用壳、路由与依赖边界：[`docs/frontend/architecture.md`](../docs/frontend/architecture.md)
- Replay Workspace 当前实现索引：[`docs/frontend/replay-workspace.md`](../docs/frontend/replay-workspace.md)
- UI token、Profile 与响应式索引：[`docs/frontend/ui-system.md`](../docs/frontend/ui-system.md)
- 回放协议与解析事实：[`docs/research/replay/protocol.md`](../docs/research/replay/protocol.md)、[`docs/reference/replay-data.md`](../docs/reference/replay-data.md)
- AI / Playback 产品与接口契约：[`docs/architecture/ai-review.md`](../docs/architecture/ai-review.md)、[`docs/features/team-ai-review.md`](../docs/features/team-ai-review.md)、[`docs/features/battle-playback.md`](../docs/features/battle-playback.md)
- 地图素材：[`docs/reference/maps.md`](../docs/reference/maps.md)
- tank marker 资产：[`docs/assets/battle-replay/`](../docs/assets/battle-replay/)、[`src/assets/tank-icons/README.md`](src/assets/tank-icons/README.md)
- Tier X 车型资产：[`docs/assets/tier-x-models/README.md`](../docs/assets/tier-x-models/README.md)
