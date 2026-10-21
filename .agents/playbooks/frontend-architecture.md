# 前端架构 Playbook

> 内部 playbook：由 designer / executor / prompt-repair / review-with-docs 按需加载；不是顶层 Skill，也不参与生命周期选择。

用于结构性前端改动。除非任务明确要求改变产品行为或现有 contract，否则必须保留它们。

## 流程

1. **DISCOVER** — 读适用的 `AGENTS.md`、架构文档与最小相关测试。选择目标结构前，先检查真实 import 与 runtime entry points。
2. **TRACE** — 沿每个改动涉及的 state、route、API call 与 user transition 找到权威 owner。相关时必须覆盖 deep-link、Back/Forward、auth 与 async completion 路径。
3. **OWNERSHIP** — 每个 business state 只能有一个 owner。优先用 derived `computed`，不要用 watcher 同步多个 ref；watcher 只用于 side effect 或 lifecycle bridge。
4. **BOUNDARY** — 依赖方向保持 `app → features → shared`。feature 间只能通过小而显式的 public contract 交互；`shared/` 必须 feature-neutral。跨 app/feature injection contract 使用 `shared/` 中的 typed `InjectionKey<T>`，禁止 magic-string service locator。直接 parent-child 依赖通常应使用显式 props/emits，而不是隐藏 injection。
5. **HTTP BOUNDARY** — 组件只负责 rendering 与 lifecycle，不负责 endpoint/auth/error parsing。Replay capability transport 归 `src/api/`；不要在 panel 内重复 bearer refresh、`apiFetch`、endpoint string 或 runtime wire validation。
6. **VUE SMELL CHECK** — 检查 God SFC/composable、template 内的 domain calculation、重复 API/auth/download 代码，以及把不相关职责塞进一个 giant fixture 的测试。
7. **IMPLEMENT / REVIEW** — 做最小且自洽的抽取。不要为了满足结构图创建空目录、abstraction wrapper、global store 或 framework migration。
8. **VERIFY** — 对改动后的 responsibility boundary 跑 targeted tests。Source guard 只能约束 dependency/API ownership；真实 layout/cascade 行为变化需要 browser-level verification。当前 Playback browser gate 验证 PC/tablet/mobile geometry 与 form isolation，但它不能替代真实设备 coarse-pointer 或 Fullscreen API 验证。routing、dependencies 或 bundles 变化时，运行要求的 build validation。
9. **REPORT** — 说明 authoritative owner、保留的 contract、改动文件、验证，以及任何有意的临时 bridge 及其移除条件。

## 硬约束

- Vue Router 拥有 browser navigation、deep links、redirects 与 Back/Forward。不要在组件里重新引入手动 `popstate` 或 history synchronization。
- 保持 `wotb-ui-profile` 是唯一 presentation-profile persistence key。UI profile 不得 fork business state 或 components。
- Replay protocol facts 保持权威。不要为了简化架构改动而发明缺失的 battle facts，或重建 upload/processing flow。
- Feature components 使用 feature API 或显式 injected/public contract；通用 HTTP 行为归 shared infrastructure。
- `AiReviewPanel.vue` / `BattlePlaybackPanel.vue` 不得拥有 raw transport。`src/api/replay-capabilities.ts` 只是 `/api/ai/**` callers 共享的 Bearer/transport helper（`ReplayAuthSession` / `optionalBearer` / `authedReplayPost`）；AI wire assembly 位于 `src/api/ai-review.ts`。
