# Replay Workspace（当前实现索引）

本文档只记录前端当前代码的 ownership 与导航边界；回放协议、AI/Playback API 和资产细节仍由各自 canonical 文档维护。

## 当前实现

- `frontend/src/components/ReplayWorkspace.vue` 是 `data`、`ai`、`playback` 三种能力的统一工作台。
- `frontend/src/composables/useReplaySession.js` 是唯一 session state owner，持有 selection、当前 battle、Processing/Result identity、Export state 与 Workspace view state。
- `frontend/src/composables/useProcessingJob.js` 持有 Processing Job 的上传、single-flight、轮询、source-ready、取消与 Dataset recovery lifecycle；它只消费 session refs。
- `frontend/src/composables/useReplay.js` 是 compatibility facade/orchestrator，组合 session、Processing 与 Export，不再持有 Processing lifecycle 闭包。
- `frontend/src/composables/useExportJob.js` 持有 Export Job 的创建、轮询、取消和下载 lifecycle；它只消费 session 的 READY `processingJobId`。
- `frontend/src/composables/useCapabilityReplay.js` 为 AI 与 Playback 各自持有 capability dataset 状态；它们消费 Workspace 的 authoritative dataset，不复制基础 selection，也不互相 handoff 业务状态。
- `frontend/src/app/viewRegistry.js` 将 `replay`、`ai-review`、`battle-playback` URL 映射到同一个 `ReplayWorkspace`，由 `initialCapability` 决定初始 tab；`ViewHost.vue` 用 `KeepAlive` 保留工作台实例。
- `frontend/src/app/router.js` 是历史与深链 owner。页面组件通过注入的 `navigate` 改变 URL，不直接操作浏览器 history。

## 稳定边界

- 多文件选择、当前 battle 选择和 capability 切换都由 Workspace facade 协调；session 以 `selectionRevision`、`sourceId` 与 Processing 状态作为唯一 identity。
- AI 与 Playback 共享 replay/source/processing dataset identity，但各自错误域和 dataset ref 独立；切换 capability 不应重传或重建基础 Processing Job。
- Replay Workspace 的登录门禁、Dataset-only 交接和 AI/Playback 详细接口以以下文档为准，不在本索引重复维护：
  - [`docs/architecture/ai-review.md`](../architecture/ai-review.md)
  - [`docs/features/team-ai-review.md`](../features/team-ai-review.md)
  - [`docs/features/battle-playback.md`](../features/battle-playback.md)
  - [`docs/architecture/replay-pipeline.md`](../architecture/replay-pipeline.md)

若上述实现路径或 owner 发生变化，先更新本索引与 [`docs/frontend/architecture.md`](architecture.md)，再更新目录级硬规则。
