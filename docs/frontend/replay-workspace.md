# Replay Workspace（当前实现索引）

本文档只记录前端当前代码的 ownership 与导航边界；回放协议、AI/Playback API 和资产细节仍由各自 canonical 文档维护。

## 当前实现

- `frontend/src/components/ReplayWorkspace.vue` 是 `data`、`ai`、`playback` 三种能力的统一工作台。
- Workspace 页面本身是 orchestration layer：`ReplayWorkspaceHeader.vue` 负责标题与清空命令，`ReplayCapabilityTabs.vue` 负责能力 tab 展示与选择事件，`ReplaySourcePanel.vue` 负责批次/当前回放 selector 展示。它们只接收 Workspace 派生状态并发出显式命令，不复制 session owner。
- `frontend/src/composables/useReplaySession.ts` 是唯一 session state owner，持有 selection、当前 battle、Processing/Result identity、Export state 与 Workspace view state。
- `frontend/src/composables/useProcessingJob.ts` 持有 Processing Job 的上传、single-flight、轮询、source-ready、取消与 Dataset recovery lifecycle；它只消费 session refs。
- `frontend/src/composables/useReplay.ts` 是 compatibility facade/orchestrator，组合 session、Processing 与 Export，不再持有 Processing lifecycle 闭包。
- `frontend/src/composables/useExportJob.ts` 持有 Export Job 的创建、轮询、取消和下载 lifecycle；它只消费 session 的 READY `processingJobId`。
- `frontend/src/composables/useCapabilityReplay.js` 为 AI 与 Playback 各自持有 capability dataset 状态；它们消费 Workspace 的 authoritative dataset，不复制基础 selection，也不互相 handoff 业务状态。
- `frontend/src/app/viewRegistry.js` 将 `replay`、`ai-review`、`battle-playback` URL 映射到同一个 `ReplayWorkspace`，由 `initialCapability` 决定初始 tab；`ViewHost.vue` 用 `KeepAlive` 保留工作台实例。
- `frontend/src/app/router.js` 是历史与深链 owner。页面组件通过注入的 `navigate` 改变 URL，不直接操作浏览器 history。

## 稳定边界

- 多文件选择、当前 battle 选择和 capability 切换都由 Workspace facade 协调；session 以 `selectionRevision`、`sourceId` 与 Processing 状态作为唯一 identity。
- Source panel 的 selector 只负责展示 `battleOptions` 和发出 `select-battle`；权威 `currentBattleId` 仍由 `useReplaySession` 持有。用户 tab 命令先更新 Workspace capability，再通过注入的 `navigate(view)` 写入 URL；外部 URL 只通过 `initialCapability` 初始化/同步 Workspace，避免 router 与 tab watcher 互相回写。
- AI 与 Playback 共享 replay/source/processing dataset identity，但各自错误域和 dataset ref 独立；切换 capability 不应重传或重建基础 Processing Job。
- Replay Workspace 的登录门禁、Dataset-only 交接和 AI/Playback 详细接口以以下文档为准，不在本索引重复维护：
  - [`docs/architecture/ai-review.md`](../architecture/ai-review.md)
  - [`docs/features/team-ai-review.md`](../features/team-ai-review.md)
  - [`docs/features/battle-playback.md`](../features/battle-playback.md)
  - [`docs/architecture/replay-pipeline.md`](../architecture/replay-pipeline.md)

若上述实现路径或 owner 发生变化，先更新本索引与 [`docs/frontend/architecture.md`](architecture.md)，再更新目录级硬规则。

## 登录门禁与 Processing 授权

Authentication 是 Replay Workspace 的**真实 UI gate**，不是 mount 时的 side effect：

| 状态 | 渲染 |
|---|---|
| auth init 未完成（`authReady=false`） | `data-testid="ws-auth-loading"`（检查登录态） |
| init 完成且未登录 | `data-testid="ws-auth-required"` + 登录按钮 `data-testid="ws-login"` |
| 已登录 | 完整工作台（Source panel / FileUploader / Processing 面板 / data·AI·Playback 面板 / Export 卡片 / 确认弹窗） |

- header 与 capability tabs 在三种状态都渲染：它们既是导航入口，也是「登录失败/取消后重新发起」的
  重试入口；`setCapability()` 未登录时发起 login，不再静默 return。
- 未登录时 `ReplaySourcePanel`、`FileUploader`、`ReplayProcessingPanel`、`ReplayPage`、AI / Playback
  面板、`ReplayTaskCard` 与 `RemoveConfirmModal` 全部不渲染——未登录无法触发上传或解析。
- `useAuth.login(view)` 只对「同一个进行中的 redirect」去重：`loginInFlight` 是短生命周期 ref，在
  `finally` 释放；不存在 component-lifetime 一次性锁，因此取消/失败后 tabs、登录按钮与 UserMenu
  都能重新发起新的 login transaction。
- 未登录 mount 仍自动发起一次 login（保留既有 UX），失败或取消后停留在 `ws-auth-required` 可重试状态。
- Android pending replay 只在 `authReady && authenticated` 时消费；未登录期间 Native pending 原样保留
  （见 [`docs/android/replay-intent.md`](../android/replay-intent.md)）。
- **Processing 传输边界**（`src/api/replay.ts`）四条端点全部要求 auth session：`createProcessingJob`
  保留 XHR 上传进度、只追加 `Authorization: Bearer`（绝不手工设置 multipart `Content-Type`，boundary
  仍由浏览器生成），`ensureToken(30)` 失败抛 canonical `AUTH_UNAUTHENTICATED`；`getProcessingJob` /
  `getProcessingJobResult` / `cancelProcessingJob` 同样带 Bearer。这些端点的 401/403 继续走统一
  error contract（`AUTH_UNAUTHENTICATED` / `AUTH_FORBIDDEN`），不新增特殊 auth code。
- **后端授权**：`/api/replay/processing-jobs/**`（POST 创建 / GET 状态 / GET result / DELETE 取消）要求
  `wotbtools-user` 或 `wotbtools-admin`；匿名 401、已登录无角色 403。`/api/preview` 与
  `/api/replay/export-jobs/**` 的公开契约保持不变。前端 gate 只是 UX，后端才是 authorization authority。
- `startProcessingJob()` 返回 `{ accepted: true, jobId }` 或 `{ accepted: false, reason }`
  （`EMPTY_SELECTION` / `ALREADY_ACTIVE` / `SUPERSEDED` / `ABORTED` / `REQUEST_FAILED`），该结果同时是
  Android pending replay 是否 ACK 的唯一判定依据。
