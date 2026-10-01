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
- Replay Workspace 的登录门禁、Dataset-only 交接和 AI/Playback 详细接口以以下文档为准，不在本索引重复维护：
  - [`docs/architecture/ai-review.md`](../architecture/ai-review.md)
  - [`docs/features/team-ai-review.md`](../features/team-ai-review.md)
  - [`docs/features/battle-playback.md`](../features/battle-playback.md)
  - [`docs/architecture/replay-pipeline.md`](../architecture/replay-pipeline.md)

若上述实现路径或 owner 发生变化，先更新本索引与 [`docs/frontend/architecture.md`](architecture.md)，再更新目录级硬规则。

## 登录门禁与 Processing 授权

Authentication 是数据解析与战局回放的**真实 UI gate**，不是 mount 时的 side effect。AI 复盘维护页优先显示，不经过登录门禁：

| 状态 | 渲染 |
|---|---|
| auth init 未完成（`idle` / `initializing`） | `data-testid="ws-auth-loading"`（检查登录态） |
| init 失败或 watchdog 超时（`failed`） | `data-testid="ws-auth-failed"` + 重新检查 `data-testid="ws-auth-retry"` / 直接登录 `data-testid="ws-login-recovery"` |
| init 完成且未登录（`unauthenticated`） | `data-testid="ws-auth-required"` + 登录按钮 `data-testid="ws-login"` |
| 已登录 | 完整工作台（FileUploader / Processing 面板 / data·Playback 面板（含场次选择器）/ Export 卡片 / 确认弹窗） |

- header 与 capability tabs 在四种状态都渲染：它们既是导航入口，也是「登录失败/取消后重新发起」的
  重试入口；`setCapability()` 未登录时进入 data/playback 会发起 login，进入 AI 维护页不会发起 login。
- 未登录时 `FileUploader`、`ReplayProcessingPanel`、`ReplayPage`、Playback
  面板、`ReplayTaskCard` 与 `RemoveConfirmModal` 全部不渲染——未登录无法触发上传或解析。
- `useAuth.login(view)` 只对「同一个进行中的 redirect」去重：`loginInFlight` 是短生命周期 ref，在
  `finally` 释放；不存在 component-lifetime 一次性锁，因此取消/失败后 tabs、登录按钮与「账户」页（个人中心）登录入口
  都能重新发起新的 login transaction。
- 未登录进入 data/playback 时显示 `ws-auth-required` 说明卡与登录按钮，不自动发起 login（design-language §10）；点击登录或切换到需要登录的模式时才发起，失败后仍可重试；AI 维护页不发起登录。
- Android pending 字节通过固定同源 HTTPS Native resource 读取；header 校验 pending identity，响应不缓存。fetch/blob 失败复用 Replay 错误区与重试，不启动 Job、不 ACK。
- Android pending replay 只在 `authInitState === 'authenticated' && authenticated` 时消费；未登录或 init 失败期间 Native pending 原样保留
  （见 [`docs/android/replay-intent.md`](../android/replay-intent.md)）。
- **Processing 传输边界**（`src/api/replay.ts`）四条端点全部要求 auth session：`createProcessingJob`
  保留 XHR 上传进度、只追加 `Authorization: Bearer`（绝不手工设置 multipart `Content-Type`，boundary
  仍由浏览器生成），`ensureToken(30)` 失败抛 canonical `AUTH_UNAUTHENTICATED`；`getProcessingJob` /
  `getProcessingJobResult` / `cancelProcessingJob` 同样带 Bearer。这些端点的 401/403 继续走统一
  error contract（`AUTH_UNAUTHENTICATED` / `AUTH_FORBIDDEN`），不新增特殊 auth code。
- **Export 传输边界**：`createExportJob` / `getExportJob` / `cancelExportJob` / `downloadExportJob`
  与 Processing 使用同一 `authHeaders()`（`ensureToken(30)` + Bearer）。download 必须走 authenticated
  fetch（blob → object URL），**不得**使用无法附带 Authorization 的 `<a href>` 裸链。
- **后端授权**：`/api/replay/processing-jobs/**`（POST 创建 / GET 状态 / GET result / DELETE 取消）与
  `/api/replay/export-jobs/**`（创建 / 状态 / 取消 / download）都要求 `wotbtools-user` 或
  `wotbtools-admin`；匿名 401、已登录无角色 403。Export 是 Dataset-only，消费 Processing Job 的
  `ProcessedDataset`，因此必须与 Processing 同级——否则知道 `processingJobId` 就能绕过 result 的认证。
  `/api/preview` 与 legacy `/api/export` 的公开契约保持不变。前端 gate 只是 UX，后端才是 authorization
  authority。
- `startProcessingJob()` 返回 `{ accepted: true, jobId }` 或 `{ accepted: false, reason }`
  （`EMPTY_SELECTION` / `ALREADY_ACTIVE` / `SUPERSEDED` / `ABORTED` / `REQUEST_FAILED`），该结果同时是
  Android pending replay 是否 ACK 的唯一判定依据。
- **Android pending 的 create 幂等**：`startProcessingJob({ operationId })` 会把 pending identity
  作为 multipart 字段 `operationId` 交给后端；同一 subject + 同一 `operationId` 幂等返回同一个 job，
  覆盖「server 已接受但 Native ACK 前进程被杀 → 冷启动重新导入」。普通手工上传不带该字段。
