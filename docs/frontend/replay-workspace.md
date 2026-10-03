# Replay Workspace（当前实现索引）

本文档只记录前端当前代码的 ownership 与导航边界；回放协议、AI/Playback API 和资产细节仍由各自 canonical 文档维护。

## 当前实现

- `frontend/src/components/ReplayWorkspace.vue` 是 `data`、`ai`、`playback`、`3d`、`shots` 五种能力的统一工作台（3D / 射击仅管理员可见）。
- Workspace 页面本身是 orchestration layer：`PageHeader` 负责页面标题，`ReplayCapabilityTabs.vue` 负责模式切换（数据 · 2D 回放 · 3D 回放* · 射击分析* · AI 复盘，* 仅管理员），`FileUploader.vue` 负责空 / 已选择 / 解析完成三种上传状态（解析完成后折叠为一行，清空需确认，是**唯一**的上传入口），`BattlePicker.vue`（可搜索的场次选择器）在各能力面板上方选择当前场次。它们只接收 Workspace 派生状态并发出显式命令，不复制 session owner。
- 五种能力都在工作台内渲染（各自一个 pane，首进懒挂载、之后切走只隐藏），上层导航（页头 + tab 栏 + 上传区）始终保留：3D 回放 / 射击分析不再有独立页面，`?view=agent-replay` / `?view=agent-shots` 深链与 tab 都解析为这里的 `3d` / `shots` pane，并通过 `props.file` 消费工作台已选回放（自身不再自带文件选择器；无已选回放时显示统一空态 `workspace.playback_empty`，多文件未选场次时由 `blockedReason` 说明）。
- **撤下回放**（清空选择 / 多文件未选场次 / 换成别的场次）时各 pane 必须复位到等待态并释放上一场：3D 走内核 `playbackScene.reset()`（车辆/地图/地形/特效/GLB 模板全量 dispose + HUD 派生字段归零，渲染器与画质档保留），射击清空表格与在途解析（`parseSeq` 作废迟到结果）；两者都清掉本地的「上次文件」记忆，因此**再选同一份回放也会重新加载**，并重新等待解析 + 资产就绪才呈现（3D 的 `hasData` 在 `startPlayback()` 等待运行所需资产之后才置位）。
- **3D 回放是显式两段式**：工作台给出回放后 pane 先进入「待开播」（显示回放名 + 画质档位 + 「开始」），点开始才 `loadData` → 等解析与地图/地形资产 → 才呈现场景。原因：内核在 `startPlayback()` 惰性创建渲染器、首帧按当前画质档定型，画质必须在开播前选定（等价于旧独立页 loader 里的选档步骤）。
- 数据模式（`ReplayPage.vue`）的结果区自上而下是：提示（`Banner`：重复 / 解析失败 / League 不可用 / 未评分场次）→ 工具栏（`SegmentedControl` 汇总 / 单场 · 单场时的 `BattlePicker` · Rating 说明 · 列 · `MenuButton` 导出 ▾：Excel 汇总 / Excel 逐场 / PNG 当前视图）→ 汇总视图顶部的 `SeriesOverview`（两支稳定战队时显示系列赛比分，其后是逐场结果条，点击跳到该场单场视图）→ 表格。
- 玩家表默认只显示 6–8 个核心列（`utils/helpers.js` 的 `*_DEFAULT_VISIBLE`），其余在「列 N/M」面板里；localStorage 可见列与旧默认值完全相同时视为未自定义，迁到新默认值。手机（<768）默认用 `PlayerCardList` 卡片列表（可切回表格，排序与表格共用）；卡片模式下表格仍在 DOM 中隐藏，PNG 导出始终导出表格。
- 玩家详情 `PlayerDetailDrawer`：桌面可拖宽的推开式侧栏，平板固定 360px 推开式侧栏（都写 `--pd-drawer-offset` 让工作台让位），手机全屏 sheet，可左右滑动切换玩家。
- 系列赛比分与场次选项由纯函数 `utils/replaySeries.js` 从 ReplayResult 派生：战队身份只认 League 批次 `teamSummaries` 的 `clan:` teamKey 与 `arenaTeams`；任何一方是 `arenaId:team` 兜底键、或不是恰好两支队伍时不推算比分；无法归属的（未评分）场次如实计数并说明，不计入比分。场次选项显示「第 N 场 · 地图」与「胜方 · 时间」，可按文件名检索。
- `frontend/src/composables/useReplaySession.ts` 是唯一 session state owner，持有 selection、当前 battle、本地分析状态（`analysis: { phase, done, total, failure }`）、结果与 Workspace view state。
- `frontend/src/composables/useLocalReplayAnalysis.ts` 持有本机分析生命周期：Worker 解析（上游 Rust Core WASM）→ 批次计算 → 提交结果；选择变化 / 取消作废在途分析；`exportExcel` 复用最近一次的批次结果在客户端生成 xlsx / zip。服务器没有 parser，失败只显示原因（`ENGINE_UNAVAILABLE` / `NO_VALID_REPLAYS` / `UNKNOWN`），不回退服务端。
- `frontend/src/composables/useReplay.ts` 是 facade/orchestrator，组合 session 与本地分析。
- `BattlePlaybackPanel.vue`（2D）、`AgentReplay3D.vue`（3D）、`AgentShots.vue`（射击）都直接接收工作台给的目标文件（`props.file`/`active`/`blockedReason`）：2D 本机 `parseLocalPlayback` 得到数据与地图概览，3D 本机 `loadPlaybackData` + `playbackScene` 全场渲染，射击本机 `parseAgentShotsFromBytes` 出逐发表格；三者都是懒挂载 chunk。多文件未选场次时统一显示 `workspace.single_replay_required`，没有目标文件时显示 `workspace.playback_empty`。
- `frontend/src/app/viewRegistry.js` 将 `replay`、`ai-review`、`battle-playback`、`agent-replay`、`agent-shots` URL 映射到同一个 `ReplayWorkspace`，由 `initialCapability` 决定初始 tab（`viewRegistry.replayInitialCapability`）；`ViewHost.vue` 用 `KeepAlive` 保留工作台实例。
- `frontend/src/app/router.js` 是历史与深链 owner。页面组件通过注入的 `navigate` 改变 URL，不直接操作浏览器 history。

## 稳定边界

- 多文件选择、当前 battle 选择和 capability 切换都由 Workspace facade 协调；session 以 `selectionRevision` 与 `sourceId`（`r{文件序号}`）作为唯一 identity。
- 场次选择器（数据模式在 `ReplayPage` 工具栏、2D 回放在面板上方）只展示选项并调用 Workspace 的 `selectBattle(sourceId)`；权威 `currentBattleId` 仍由 `useReplaySession` 持有。用户 tab 命令先更新 Workspace capability，再通过注入的 `navigate(view)` 写入 URL；外部 URL 只通过 `initialCapability` 初始化/同步 Workspace，避免 router 与 tab watcher 互相回写。
- AI 复盘 tab 与深链直接挂载 AI 面板（`AiReviewWorkspacePane.vue` → `AiReviewPanel.vue`），受登录门控与客户端投影可用性约束；前端已无维护状态卡（提交 `83884790`，`ai_maintenance` 三语 key 无消费者）。切换 capability 不重新分析数据模式的结果。
- AI/Playback 详细接口与回放管线以以下文档为准，不在本索引重复维护：
  - [`docs/architecture/ai-review.md`](../architecture/ai-review.md)
  - [`docs/features/team-ai-review.md`](../features/team-ai-review.md)
  - [`docs/features/battle-playback.md`](../features/battle-playback.md)
  - [`docs/architecture/replay-pipeline.md`](../architecture/replay-pipeline.md)

若上述实现路径或 owner 发生变化，先更新本索引与 [`docs/frontend/architecture.md`](architecture.md)，再更新目录级硬规则。

## 匿名访问

服务器没有 parser：解析、汇总、导出与 2D 回放全部在本机进行，工作台挂载即可用、不等登录、没有登录门禁，也不发出任何回放相关的后端请求。AI 复盘与名人堂等写操作才需要登录。

- Android pending 字节通过固定同源 HTTPS Native resource 读取；header 校验 pending identity，响应不缓存。fetch/blob 失败复用 Replay 错误区与重试，不分析、不 ACK。
- Android pending replay 在工作台挂载后消费；ACK 边界是「本机分析已完成」（`analyze()` 返回 `{ completed: true }`，无论有没有有效场次）；回放引擎装载失败返回 `{ completed: false, reason: 'ENGINE_UNAVAILABLE' }`，Native pending 原样保留可重试（见 [`docs/android/replay-intent.md`](../android/replay-intent.md)）。
