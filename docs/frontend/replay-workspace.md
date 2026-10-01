# Replay Workspace（当前实现索引）

本文档只记录前端当前代码的 ownership 与导航边界；回放协议、AI/Playback API 和资产细节仍由各自 canonical 文档维护。

## 当前实现

- `frontend/src/components/ReplayWorkspace.vue` 是 `data`、`ai`、`playback` 三种能力的统一工作台。
- Workspace 页面本身是 orchestration layer：`PageHeader` 负责页面标题，`ReplayCapabilityTabs.vue` 负责模式切换（数据 · 2D 回放 · 3D 回放* · 射击分析* · AI 复盘，* 仅管理员；3D / 射击目前导航到各自独立页面），`FileUploader.vue` 负责空 / 已选择 / 解析完成三种上传状态（解析完成后折叠为一行，清空需确认，是唯一的清空入口），`BattlePicker.vue`（可搜索的场次选择器）在 2D 回放面板上方选择当前场次。它们只接收 Workspace 派生状态并发出显式命令，不复制 session owner。
- 数据模式（`ReplayPage.vue`）的结果区自上而下是：提示（`Banner`：重复 / 解析失败 / League 不可用 / 未评分场次）→ 工具栏（`SegmentedControl` 汇总 / 单场 · 单场时的 `BattlePicker` · Rating 说明 · 列 · `MenuButton` 导出 ▾：Excel 汇总 / Excel 逐场 / PNG 当前视图）→ 汇总视图顶部的 `SeriesOverview`（两支稳定战队时显示系列赛比分，其后是逐场结果条，点击跳到该场单场视图）→ 表格。
- 玩家表默认只显示 6–8 个核心列（`utils/helpers.js` 的 `*_DEFAULT_VISIBLE`），其余在「列 N/M」面板里；localStorage 可见列与旧默认值完全相同时视为未自定义，迁到新默认值。手机（<768）默认用 `PlayerCardList` 卡片列表（可切回表格，排序与表格共用）；卡片模式下表格仍在 DOM 中隐藏，PNG 导出始终导出表格。
- 玩家详情 `PlayerDetailDrawer`：桌面可拖宽的推开式侧栏，平板固定 360px 推开式侧栏（都写 `--pd-drawer-offset` 让工作台让位），手机全屏 sheet，可左右滑动切换玩家。
- 系列赛比分与场次选项由纯函数 `utils/replaySeries.js` 从 ReplayResult 派生：战队身份只认 League 批次 `teamSummaries` 的 `clan:` teamKey 与 `arenaTeams`；任何一方是 `arenaId:team` 兜底键、或不是恰好两支队伍时不推算比分；无法归属的（未评分）场次如实计数并说明，不计入比分。场次选项显示「第 N 场 · 地图」与「胜方 · 时间」，可按文件名检索。
- `frontend/src/composables/useReplaySession.ts` 是唯一 session state owner，持有 selection、当前 battle、Processing/Result identity、Export state 与 Workspace view state。
- `frontend/src/composables/useProcessingJob.ts` 持有 Processing Job 的上传、single-flight、轮询、source-ready、取消与 Dataset recovery lifecycle；它只消费 session refs。
- `frontend/src/composables/useReplay.ts` 是 compatibility facade/orchestrator，组合 session、Processing 与 Export，不再持有 Processing lifecycle 闭包。
- `frontend/src/composables/useExportJob.ts` 持有 Export Job 的创建、轮询、取消和下载 lifecycle；它只消费 session 的 READY `processingJobId`。
- `frontend/src/composables/useCapabilityReplay.js` 当前仅为 Playback 持有 capability dataset 状态；AI 复盘维护期间不创建 AI dataset 状态。
- `frontend/src/app/viewRegistry.js` 将 `replay`、`ai-review`、`battle-playback` URL 映射到同一个 `ReplayWorkspace`，由 `initialCapability` 决定初始 tab；`ViewHost.vue` 用 `KeepAlive` 保留工作台实例。
- `frontend/src/app/router.js` 是历史与深链 owner。页面组件通过注入的 `navigate` 改变 URL，不直接操作浏览器 history。

## 稳定边界

- 多文件选择、当前 battle 选择和 capability 切换都由 Workspace facade 协调；session 以 `selectionRevision`、`sourceId` 与 Processing 状态作为唯一 identity。
- 场次选择器（数据模式在 `ReplayPage` 工具栏、2D 回放在面板上方）只展示选项并调用 Workspace 的 `selectBattle(sourceId)`；权威 `currentBattleId` 仍由 `useReplaySession` 持有。用户 tab 命令先更新 Workspace capability，再通过注入的 `navigate(view)` 写入 URL；外部 URL 只通过 `initialCapability` 初始化/同步 Workspace，避免 router 与 tab watcher 互相回写。
- AI 复盘 tab 与深链显示维护说明卡（`EmptyState`，含跳到数据 / 2D 回放的入口），不挂载 AI 面板、不准备 AI dataset；维护期间不设登录门禁，恢复后需要登录；Playback 仍消费 Workspace 的 authoritative dataset。切换 capability 不应重传或重建基础 Processing Job。
- Replay Workspace 的访问控制、Dataset-only 交接和 AI/Playback 详细接口以以下文档为准，不在本索引重复维护：
  - [`docs/architecture/ai-review.md`](../architecture/ai-review.md)
  - [`docs/features/team-ai-review.md`](../features/team-ai-review.md)
  - [`docs/features/battle-playback.md`](../features/battle-playback.md)
  - [`docs/architecture/replay-pipeline.md`](../architecture/replay-pipeline.md)

若上述实现路径或 owner 发生变化，先更新本索引与 [`docs/frontend/architecture.md`](architecture.md)，再更新目录级硬规则。

## 匿名访问与 Processing 授权

赛果解析（数据模式、导出）与 2D 回放**对匿名开放**（2026-10-01 起）；登录只是可选增强。AI 复盘维护页优先显示：

| 状态 | 渲染 |
|---|---|
| auth init 未完成（`idle` / `initializing`） | `data-testid="ws-auth-loading"`（检查登录态） |
| 其余（已登录 / 未登录 / init 失败） | 完整工作台（FileUploader / Processing 面板 / data·Playback 面板（含场次选择器）/ Export 卡片 / 确认弹窗） |

- 仍等 auth init 落定再展示工作台：避免已登录用户在 Keycloak 初始化完成前以匿名身份建 Job。init 失败也照常放行，不显示登录门禁；`setCapability()` 不再发起 login。
- Android pending 字节通过固定同源 HTTPS Native resource 读取；header 校验 pending identity，响应不缓存。fetch/blob 失败复用 Replay 错误区与重试，不启动 Job、不 ACK。
- Android pending replay 在 auth init 落定（`isReady`）后消费，登录与否都会消费；落定前 Native pending 原样保留
  （见 [`docs/android/replay-intent.md`](../android/replay-intent.md)）。
- **Processing / Export 传输边界**（`src/api/replay.ts`）统一用 `optionalBearer()`（`replay-capabilities.ts`）：
  `ensureToken(30)` 成功时附带 `Authorization: Bearer`，否则匿名请求，不抛 `AUTH_UNAUTHENTICATED`。
  `createProcessingJob` 保留 XHR 上传进度（绝不手工设置 multipart `Content-Type`，boundary 由浏览器生成）。
  download 走 fetch（blob → object URL），以便已登录时附带 Bearer。map-overview / battle-playback-v2 用
  `authedReplayPost(..., { optionalAuth: true })`；AI 端点仍强制登录。
- **后端授权**：`/api/replay/processing-jobs/**`、`/api/replay/export-jobs/**`、`/api/replay/map-overview`、
  `/api/replay/battle-playback-v2` 均 `permitAll`。它们只消费调用方自己上传、以不可猜测 `jobId` 引用的
  `ProcessedDataset`。携带有效 Bearer 时照常解析 subject（idempotency 分域、绑定账号验证）；匿名时 subject 为空，
  只是失去 `operationId` 幂等。滥用防护：nginx 对两个创建端点按 IP 限流（`replay_api` zone）+ 服务端
  `PROCESSING_QUEUE_FULL`。`reconstruct-batch` / `process` 仍要求 `wotbtools-user` / `wotbtools-admin`。
- `startProcessingJob()` 返回 `{ accepted: true, jobId }` 或 `{ accepted: false, reason }`
  （`EMPTY_SELECTION` / `ALREADY_ACTIVE` / `SUPERSEDED` / `ABORTED` / `REQUEST_FAILED`），该结果同时是
  Android pending replay 是否 ACK 的唯一判定依据。
- **Android pending 的 create 幂等**（仅已登录时生效）：`startProcessingJob({ operationId })` 会把 pending identity
  作为 multipart 字段 `operationId` 交给后端；同一 subject + 同一 `operationId` 幂等返回同一个 job，
  覆盖「server 已接受但 Native ACK 前进程被杀 → 冷启动重新导入」。普通手工上传不带该字段。
