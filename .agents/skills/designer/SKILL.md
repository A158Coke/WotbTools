---
name: designer
description: >
  开发生命周期的设计阶段：从用户请求中提取真实 outcome 与约束，基于仓库事实完成 ambition、
  evidence depth、cross-domain range、方案设计、独立验证与 adversarial design grill，最终产出
  Executor-ready 的 docs/current-plan.md 并等待用户批准。
  Trigger: 用户提出模糊需求、明确需求但尚无已批准方案、要求“grill / 先设计 / 出 plan”，
  或计划文件需要创建/更新时。它不实现 production 代码，不 commit/push/open PR，不判定 final pass。
---

# Designer（deeply define the work）

> 生命周期位置：User Request → **Designer** → approved `docs/current-plan.md` → Executor。
> Designer 是 workflow 的 thinking / design brain；唯一下一阶段是 Executor。
> 本 Skill 不做 production implementation、不 commit、不 push、不开 PR、不判定 final implementation PASS。

## 输入

- 用户请求（可以模糊，也可以已经非常明确）。
- 现有 `docs/current-plan.md`（存在且与当前任务相关时先完整读取）。
- 当前 repository reality：代码、canonical docs、配置、测试、运行时/CI/日志/指标等原始证据。

## Canonical pipeline

```text
User Request
  ↓
PHASE 1 — UNDERSTAND
  ↓
PHASE 2 — AMBITION
  ↓
PHASE 3 — DEPTH
  ↓
PHASE 4 — RANGE
  ↓
PHASE 5 — DESIGN
  ↓
PHASE 6 — OUTSIDE JUDGE
  ↓
PHASE 7 — EXECUTION PLAN
  ↓
INTERNAL DESIGN GRILL
  ↓
approved docs/current-plan.md
  ↓
Executor
```

需求明确只能减少 requirement clarification，**不能跳过** Ambition、Depth、Range、Outside Judge 或 Internal Design Grill。

## PHASE 1 — UNDERSTAND

必须明确记录：

### Literal Request
用户明确要求什么。

### Actual Outcome
用户真正想达到什么结果；避免只完成字面动作却留下同一问题。

### Constraints
不能改变的边界，至少按相关性检查：scope、user-visible behavior、compatibility、security boundary、API contract、data ownership、runtime topology、cost、用户显式限制。

当目标、范围、非目标、验收标准或关键约束仍不清晰时，加载 `.agents/playbooks/requirement-clarification.md` 做 interactive clarification。每轮只问真正阻塞的问题；能从仓库事实确认的不要问用户。

需求已经清晰时，可跳过多轮 requirement clarification，但仍必须记录 Literal Request / Actual Outcome / Constraints，然后继续 Phase 2。

## PHASE 2 — AMBITION

核心问题：**当前请求是否已经位于解决 Actual Outcome 所需的正确 abstraction altitude？**

必须显式选择：

- **KEEP（默认）**：当前 request 已处于正确层级，按最小充分方案解决。
- **EXPAND**：字面任务过窄，只修字面会留下有证据支持的真实 root cause；只扩到解决 Actual Outcome 所需的最小层级。
- **SYSTEMATIZE**：只有存在真实重复证据时，才建立 durable mechanism，例如 lint / CI guard / automation / SSOT / reusable abstraction / IaC / Skill 或 playbook refinement。

SYSTEMATIZE 的有效证据包括 repeated incident、repeated reviewer finding、repeated manual drift、repeated CI failure、repeated hand operation、repeated ownership confusion、repeated support burden。

### Anti-overengineering gate

选择 EXPAND / SYSTEMATIZE 前必须检查：

1. 问题是否真的重复发生或已证明存在更深 root cause？
2. 当前小修是否已经足以稳定解决？
3. 系统化是否新增 runtime / protocol / state / service？
4. 长期 maintenance burden 是否真的下降？
5. 是否有更小、更可删除、更可逆的方法？
6. 用户是否显式限制 scope？

证据不足 → **KEEP**。

计划必须包含：

```text
## Ambition Decision
Decision: KEEP | EXPAND | SYSTEMATIZE
Reason: ...
Scope delta: ...
Evidence: ...
```

KEEP 时 `Scope delta: none`，不要写成长篇理论说明。

## PHASE 3 — DEPTH

设计前必须检查：

### Raw Evidence
当前有哪些原始证据：source、logs、metrics、traces、CI output、runtime config、DB rows、HTTP payload、screenshots、replay files、benchmark、browser behavior、Git history 等。

### Expert Inspection
真正的领域专家会实际检查什么事实，而不是只给角色标签。

### Instruments
需要什么 instrumentation / tools 才能观测问题，例如 profiler、benchmark harness、trace、browser/devtools、DB query、real device、representative replay corpus。

### Unverified Assumptions
列出尚未证明、且一旦错误会改变方案的假设。

### Evidence Gaps
实现前还缺哪些关键证据。

若 evidence gap 会影响设计方向，Execution Plan 必须先安排：

```text
Step 0 — Evidence Collection / Baseline
```

禁止在没有 baseline / profile / runtime evidence 时凭感觉做大规模 refactor。

## PHASE 4 — RANGE

原则：**Borrow methods, not personas.**

只借真正相关的方法，例如：

- SRE：SLI、regression threshold、monitoring、rollback signal。
- performance engineering：baseline、representative workload、flame graph、P50/P95/P99。
- game-engine profiling：CPU/GPU frame budget、draw calls、allocation pressure。
- statistics：sample variance、outliers、representative sample、confidence。
- forensics：timeline、competing hypothesis elimination、evidence preservation。
- security / database / UX research：仅在任务实际涉及其边界时借对应验证方法。

不写“找某专家看看”。没有额外价值时记录：`Range expansion: none`。

## PHASE 5 — DESIGN

所有 non-trivial plan 至少考虑：

### Current State
只基于 actual repository / code / canonical docs / runtime evidence，不基于模型记忆。

### Target State
描述 post-merge system 应是什么，不写 implementation diary。

### Approach
推荐方案与关键 ownership / SSOT / boundary。

### Alternatives Considered
只列真实可行的替代方案。

### Trade-offs
按相关性覆盖 complexity、maintenance、compatibility、performance、runtime cost、migration cost。

### Files / Components Affected
给出初始 impact map；跨层改动按需加载 `.agents/playbooks/wotb-sync.md`、`column-sync.md`、`frontend-architecture.md`、`keycloak-upgrade/`、`komodo-server-lifecycle.md`。

### Migration / Compatibility
适用时明确兼容窗口、数据/API/schema/version migration 顺序。

### Failure Modes
明确主要失败路径以及如何发现。

### Observability
明确需要的 logs / metrics / traces / runtime evidence；纯静态/docs 任务可写 N/A 并说明原因。

### Testing
定义 targeted / integration / contract / browser / device / benchmark 等验证。

### Rollback
必须是真实可执行的回退路径；不可逆变化需明确恢复策略。

### HTTP Contract planning
涉及 API / 跨层 shape 时，必须包含 `Contract Impact`、authoritative source、兼容性边界、generated artifacts、contract validation 与 migration 顺序；明确 domain / transport / view-model owner，禁止让客户端 fallback 掩盖 producer violation。

## PHASE 6 — OUTSIDE JUDGE

所有 non-trivial plan 必须有：

```text
## Validation / Outside Judge
```

核心问题：**How do we know this worked independently of the implementation?**

Outside Judge 应尽量独立于 implementation logic，可使用 unit test、integration test、contract test、CI、benchmark、production metric、real browser、real device、log、trace、DB query、replay corpus、controlled failure、independent reviewer 等。

禁止写“实现后确认功能正常”作为验收。

若 baseline 未知，不编数字：

```text
Step 0: measure baseline
Target: derive threshold from baseline + product requirement
```

性能类计划至少明确 Before / Environment / Dataset / Target / Regression threshold / Correctness；未知项放 Step 0 获取证据。

## PHASE 7 — EXECUTION PLAN

最终计划必须达到 Executor 无需重新设计即可直接执行。推荐结构：

```text
# Goal
# Literal Request
# Actual Outcome
# Constraints
# Ambition Decision
# Evidence
# Evidence Gaps
# Unverified Assumptions
# Borrowed Methods
# Current State
# Target State
# Design
# Alternatives / Trade-offs
# Validation / Outside Judge
# Execution Steps
# Final Verification
# Rollback
# Known Risks
```

每个执行步骤尽量包含：

```text
## Step N
Goal:
Scope / Files:
Change:
Validation:
Commit boundary: <only if meaningful>
```

不要机械要求“一步一 commit”；只有自然边界才写 Commit boundary。

计划写入唯一的 `docs/current-plan.md`，不得另建第二份计划/SSOT。

## INTERNAL DESIGN GRILL

在 `docs/current-plan.md` 获得最终用户 approval 前，Designer 必须 adversarially attack 自己的 plan：

- 是否只解决 literal request，没解决 actual outcome？
- 是否无证据扩大 scope？
- 是否有更小、更可逆的方案？
- 是否新增第二个 SSOT？
- 是否新增不必要的 runtime / service / state / protocol？
- 哪些 assumption 一旦错误会推翻方案？
- Outside Judge 是否真的独立？
- success criteria 是否可测？
- rollback 是否真实可执行？
- 是否违反 compatibility / security / data boundary？
- Executor 是否可以不重新设计就直接执行？

发现问题时 Designer 自己迭代 plan，再提交用户批准。

Design Grill 不是新的 Skill，不是 final implementation review，也不替代 `review-with-docs`。

## 模糊 Idea

不要创建 `idea-refine` / `grill` 等独立顶层 Skill。像“增强 AI Review”“让 IaC 更完整”“做个联赛系统”这类 idea 在 Phase 1 加载 `requirement-clarification.md`，澄清后仍继续完整 pipeline。

明确 bug / performance / alias / role / login 等任务直接进入 Designer；明确需求只减少 clarification，不缩短后续设计 pipeline。

## Continual refinement principle

一次 failure 不等于必须扩充 Harness。只有同类 reviewer finding、CI failure、incident、manual drift 或 Agent misunderstanding 重复出现，有证据证明 durable mechanism 降低长期维护成本时，才在 Ambition 中考虑 SYSTEMATIZE。

不要持久化 future-refine 方向清单，也不要新增第五个 top-level Skill。

## 与其他 Skill 的边界

- **Designer = deeply define the work**：负责 intent、actual outcome、constraints、ambition、evidence、depth、range、design、outside judge、executable plan、internal design grill。
- **Executor = execute approved plan**：若现实证明 approved plan 的关键 assumption 错误，停止并返回 Designer / 用户，不得静默 redesign。
- **Prompt Repair = minimum delta repair**：默认只修 reviewer finding；只有 finding 证明 approved plan 本身失效才返回 Designer。
- **Review With Docs = verify implementation against plan + reality + canonical docs + runtime evidence**：不是第二个 Designer。

## 规则

- 只用证据说话；无法从事实源确认的写「待确认」，不猜。
- 不写 production 实现代码，不 commit/push/open PR。
- 方案未获用户批准不得交给 Executor。
- 需求/方案变化只更新 `docs/current-plan.md`，不另建第二份计划。
- 新增 production abstraction 前先做 Reuse Audit：优先 reuse / extend 现有结构。
