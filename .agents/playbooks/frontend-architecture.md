# 前端架构 Playbook

> 内部 playbook：由 designer / executor / prompt-repair / review-with-docs 按需加载；不是顶层 Skill，也不参与生命周期选择。

用于结构性前端改动。除非任务明确要求改变产品行为或现有 contract，否则必须保留它们。

## 流程

1. **DISCOVER** — 读架构文档与最小相关测试。选择目标结构前，先检查真实 import 与 runtime entry points。
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

## UI Change Contract

涉及 UI、CSS、响应式布局或前端状态的改动，动手前先回答四个 ownership 问题。ONE RESPONSIBILITY. ONE AUTHORITATIVE OWNER.

**A. DOM Ownership** — 改动前确定：哪个 Vue component 渲染该 DOM；谁管理其生命周期；哪些父组件影响它的布局；哪些子组件共享同一行为。DOM Owner 不一定是 CSS Owner：修改样式前，先分别确认 DOM Owner 与实际 CSS Owner，优先修改现有 CSS Owner；只有存在明确的职责迁移理由时，才将规则转移到组件 Scoped CSS，并同步删除旧规则。

**B. CSS Ownership** — 改动前确定：目标 selector 定义在哪个文件（全局 `src/styles/*.css` vs 组件 scoped CSS）；`src/main.js` 的 CSS import order；specificity；`@media` 条件；`!important`；以及最终 computed style。不得仅凭源码搜索认定某条 CSS 生效——cascade 由这些因素共同决定。对实际视觉问题，以浏览器中的 computed style 和布局几何为证据，而不是源码推断。

**C. State Ownership** — 确定真实状态所有者：是否已有可复用 composable / shared preference / 管理同一行为的组件；是否存在多个 ref / watcher 同步相同状态。优先使用现有状态源，不得为局部 UI 问题创建第二套状态。

**D. Change Ownership** — 优先修改原 owner。不得在其他文件新增覆盖规则，除非有具体证据证明原 owner 不适合承担该行为。确需迁移 owner 时：明确新 owner、删除旧 owner 的对应实现、保持实际行为不变、验证原有消费者。

## Subtractive Coding

修改 UI 时默认按此顺序执行：

1. 找到现有实现；
2. 识别真正的错误；
3. 修复原实现；
4. 删除被替代的旧规则；
5. 复用已有组件和状态；
6. 最后才考虑新增代码。

新增以下任何一项时，必须先回答对应问题并记录在改动说明中：

- 新增 `!important` — 为什么原实现不能直接修改？它覆盖的是哪个现有规则？
- 新增重复 selector / 全局 CSS override / 重复 responsive breakpoint — 为什么不在原 owner 内修改？
- 新增仅用于转发的 wrapper — 为什么现有组件不能直接使用？
- 新增重复状态 — 为什么现有状态源不能复用？
- 新增仅服务单处使用的通用抽象 — 为什么直接实现不够？

这些不是绝对禁止项；没有书面理由时默认走「修改原实现 + 删除被替代代码」。检查标准不是 LOC 下降，而是维护的实现路径是否变多：被新实现取代的旧代码必须删除，不允许新旧并存。
