---
name: review-with-docs
description: >
  唯一 final quality gate：验证 implementation 是否符合 approved plan、repository reality、canonical docs
  与必要的 runtime evidence；覆盖代码质量、文档同步、AI 死代码、架构/领域 playbook 与明确适用的 Product QA。
  Trigger: Executor 实现完成后、Prompt Repair 修复 reviewer finding 后、merge 前需要 final gate 时，
  或用户直接请求 exploratory / mobile / usability / full-site black-box QA。只有本 Skill 可以判定 final PASS。
  Code-review engine: Alibaba OpenCodeReview（OCR）delegate mode 负责确定性文件筛选 / 规则解析，推理由主代理完成。
---

# Review With Docs（唯一 final quality gate）

> 生命周期：Executor implementation + targeted validation → **Review With Docs** → PASS 后 Executor 才 commit/push/open PR。
> Review 不是第二个 Designer：它验证 approved plan + repository reality + canonical docs + runtime evidence，不重新选择 ambition 或擅自 redesign。

## 输入与 main baseline

- 从 Executor 进入 final gate 时，必须接收并复用 Executor 已验证的精确 `<main-ref>`，其值为步骤 3 记录的 `<remote>/main`。
- 从 Prompt Repair 进入时，优先复用该 PR / task 已有的已验证 `<main-ref>`；如果当前上下文没有，则先验证实际承载 upstream/main 的 remote，再记录 `<main-ref> = <remote>/main`。
- standalone review / QA 没有 lifecycle handoff 时，也必须先验证真实 canonical main remote/ref，再记录 `<main-ref>`。
- **任何路径都不得默认或硬编码 `origin/main`。** 一旦 `<main-ref>` 已验证，本轮 range、merge-base、compare、OCR committed preview 全程复用同一值。

## Candidate Tree Review Contract

审查对象是当前 task 的完整 candidate tree：

```text
committed range: merge-base(<main-ref>, HEAD)..HEAD
∪ staged current-task changes
∪ unstaged tracked current-task changes
∪ untracked current-task implementation files
```

### Task-related candidate files

先从 committed range、staged、unstaged tracked、untracked implementation files 收集 raw changes，再逐 path 分类。

明确排除：

- unrelated user work；
- unrelated scratch；
- ignored transient output；
- generated non-source transient files；
- 明确属于另一个 task 的 preserved changes。

每个 exclusion 必须记录 `path / category / concrete reason`，禁止静默忽略。

```text
Candidate changes = task-related candidate files 非空
Calculated review scope = OCR reviewable task-related files ∪ A3 manually-reviewed task-related docs
```

只有：

```text
task-related candidate files 非空
AND
calculated review scope == 0
```

才 fail-closed：

```text
Task-related candidate tree contains changes but review scope is empty.
```

不能用裸 `git status --porcelain != empty` 直接判定 candidate changes；unrelated worktree noise 不得卡死当前 review。这只是修正 predicate，不放松 coverage。

必须保留：

- clean committed branch → 覆盖 merge-base..HEAD；
- dirty first implementation / HEAD == main → workspace preview；
- staged / unstaged tracked / task-related untracked → 全覆盖；
- committed + fresh repair → range + workspace deterministic union / dedupe；
- docs-only candidate → OCR unsupported 时 A3 人工审查全部 task-related docs 并计入 scope；
- OCR unsupported non-doc committed file → task-related candidate 非空但 scope=0 时 BLOCKER。

不得用 `reviewable_count == 0` 单独判 PASS。

## 三层审查

- **Layer A — Requirement/Plan Auditor**：plan completion、DI、docs、dead code、reuse/SSOT。
- **Layer B — OpenCodeReview Code Auditor**：OCR delegate mode 确定 reviewable scope / rules，主代理逐文件审查。
- **Layer C — Review Reconciler**：去重、验证、重定级、判定 blocker。

## 内部 playbooks

按需加载 `.agents/playbooks/`：`code-quality.md`、`code-smell.md`、`fallow.md`、`wotb-sync.md`、`column-sync.md`、`frontend-architecture.md`、`keycloak-upgrade/`、`komodo-server-lifecycle.md`、`product-qa/`。

它们是 checklist/tool guidance，不拥有 lifecycle actions，也不是顶层 Skill。

## 流程

> 全程主代理，不 spawn verifier 子代理。OCR delegate mode 是确定性工具链，不是第二个 agent。

0. **Product QA applicability**：源码/diff audit 前判定。
1. **Baseline + OCR readiness**：确认 / 接收本轮唯一 `<main-ref>`，再检查固定版本 OCR 可用性。
2. **Candidate classification**：task-related files + explicit exclusions。
3. **Layer B**：range/workspace preview → 过滤到 task-related scope → rules → 逐文件 audit。
4. **Layer A**：发现真实 plan source，逐条验证 requirement / acceptance criteria。
5. **Supplemental gates**：DI + docs + dead code + reuse/SSOT。
6. **Internal checklists**：code-quality；代码变更加 code-smell；前端适用时加 fallow。
7. **Layer C**：reconcile findings，计算 blocker。
8. **Fix → re-review**：BLOCKER/MAJOR 修复后只重跑受影响 scope；无法闭环则停止汇报。
9. **Report**：Plan compliance + Findings + Validation + Final。

## Product QA Gate

- standalone exploratory QA 可默认 production；
- final-gate Product QA 必须针对包含 candidate tree 的 local / preview / candidate environment，并记录 candidate 身份；
- production success 不能代替未合并 candidate QA；
- applicable 但 candidate-specific target 不可用 → BLOCKER / coverage limitation，不得伪造 PASS；
- 已读源码导致上下文污染时，适用则执行 fresh isolated QA pass；
- 纯后端 / 文档治理 / 无 UI 用户流程影响且用户未要求浏览器验收 → N/A。

## HTTP Contract Gate

涉及 API / build / cross-layer shape 时检查：

- `contracts/http/openapi.yaml` 唯一 wire authority；
- endpoint/status/required/nullable/enum 与实际 Jackson serialization 一致；
- generated FE transport/schema/error registry 最新且未手改；
- domain enum 显式 mapping；
- 旧 artifact compatibility 只在读取边界；
- ApiError envelope 与 `204 capability unavailable` 语义保持；
- fixture/runtime schema/backend contract tests/affected UI-parser tests 覆盖。

producer violation 修 producer/mapper，不放宽 FE schema 掩盖。

## OCR execution

- `ocr --version` → `open-code-review v1.9.10` 或明确兼容版本；缺失时固定安装 `@alibaba-group/open-code-review@1.9.10`，禁止 latest/main。
- delegate mode 不需要 OCR 侧 LLM key；推理由主代理完成。
- tool failure ≠ no findings；明确报告并人工 fallback，不能伪造 blocker=0。

复用本轮已经 handoff / verified 的 `<main-ref>`：

```bash
git status --porcelain
git merge-base <main-ref> HEAD
ocr delegate preview --from <main-ref> --to HEAD --format json   # committed
ocr delegate preview --format json                               # workspace
ocr delegate rule --format json <task-related-paths...>
```

mixed candidate 两个 preview 都运行并按 path union/dedupe。OCR 返回 scope 后再次应用 task-related classification；exclusion 仍显式记录。

每个 task-related reviewable file 必须 `reviewed` 或有具体原因的 `skipped`。range 读 `merge-base(<main-ref>, HEAD)..HEAD` diff，tracked workspace 读 `git diff HEAD -- <path>`，task-related untracked 读全文。

## Layer A — Plan Auditor

### A0. Plan Source

顺序：

1. `docs/current-plan.md`（存在且相关）；
2. repository 其它明确计划约定；
3. 用户当前显式 requirements / acceptance criteria；
4. 仍无 source → 报告 `no plan source found`，不臆造完成。

`docs/current-plan.md` 是 ephemeral approved execution plan，不是长期 architecture/behavior authority。

### A1. Plan compliance

```text
| Requirement | Status | Evidence |
|---|---|---|
| ... | DONE / PARTIAL / MISSING / BLOCKED | 文件:行 / test / runtime evidence |
```

检查 requirement、acceptance criteria、遗漏、partial implementation、scope regression 与关键验证。requirement missing → 即使 OCR no findings 也 BLOCKER。

### A2. Java DI gate

Constructor injection preferred；禁止无理由 field injection。

先确认真实 roots：

```bash
find java -path '*/src/main/java' -type d -print
```

生产源码按 module 位于 `java/*/src/main/java`，不得扫描不存在的单一根目录。

必须实际运行：

```bash
# 两行
rg -n -U '@Autowired\s*\n\s*(?:private|protected|public)\s+' java/*/src/main/java

# 同行
rg -n '@Autowired\s+(?:private|protected|public)\s+' java/*/src/main/java
```

必须证明普通两行与同行 field injection 都能命中，且命令本身不报 multiline error。发现后优先 constructor injection / `@RequiredArgsConstructor` + `final`；唯一可行时才保留并写具体原因。不引入 AST tooling。

### A3. Documentation Gate

分类只包含真实支持的 owner：

- canonical current-state docs；
- `HISTORY.md` — 产品/业务历史；
- `docs/architecture/TECHNICAL_EVOLUTION.md` — 技术/架构/data-flow/authority/identity/production topology 历史；
- `docs/research/**` — research/reverse-engineering/experiment evidence；
- `docs/android/releases/**` — 当前临时 versioned release record；
- `docs/current-plan.md` — ephemeral approved execution plan。

不创建任何 persistent future-wishlist 文档。

current-state 文档发现 future-only prose：

1. 当前 approved task → `docs/current-plan.md`；
2. 明确独立 follow-up → GitHub Issue；
3. 其它 uncommitted/speculative wishlist → 删除，不持久化。

同时检查：

- current-state doc 只描述 candidate 合并后的系统，不保存 PR/review/migration diary；
- HISTORY / TECHNICAL_EVOLUTION 只保存有长期价值的对应历史；
- research evidence 不冒充 current production；
- Android release record 例外保持；
- 永久源码/配置/current-state docs 不把 current-plan 当 authority；
- persistent maintainer/dev/ops prose 使用简体中文，技术 literal 可保留规范英文；
- `docs/README.md` 只索引真实存在的 persistent owners；
- 不建立 archive/old/historical 等过期 current-state 文档堆放。

任一不满足 → BLOCKER。

### A4. AI dead/speculative code

扫描单实现 speculative abstraction、零引用字段/参数/constructor、空壳 wrapper、future-only code。repo-wide `rg` 证明引用；前端适用时 `npx fallow check dead-code`。真死且非 contract/reflection → 删除；假死 → 保留并记录证据；待定 → 报告，不猜。

绝不能误删 wire DTO / Flyway / Spring-Jackson reflection / metrics / i18n / documented contract。

### A5. Reuse / Extend First

新增 production type/file 必须 repo-wide 搜索可复用实现、检查第二 SSOT 与单调用方 mechanical wrapper。等价实现或第二 SSOT → BLOCKER；纯 speculative abstraction → MAJOR，能安全收缩则修复。

## Layer C — Reconciler

- **BLOCKER**：correctness/security/data-loss/requirement missing/mandatory coverage gap；
- **MAJOR**：error handling/concurrency/contract/test gap/明显 performance；
- **MINOR**：低风险维护性/风格。

规则：去重；OCR finding 必须用 repository evidence 验证；不盲从 OCR severity；不因 reviewer suggestion over-engineer；requirement missing 高于 OCR no findings。

Source-of-truth 顺序：用户当前显式 requirement → approved plan → acceptance criteria → repository current architecture/contract → tests/runtime evidence → OCR → reviewer inference。

```text
Blocker count: N
```

只有 N=0 才能 final PASS。

## Repair boundary

- BLOCKER → MAJOR → MINOR；MINOR 可记录 known issue，不扩大 scope；
- 修复后重跑受影响 validation/review；repository-level authoritative validation 交给 PR CI，除 Full-test 例外不重复全量；
- finding 若证明 approved plan 本身失效，返回 Designer，不在 Review 内 redesign。

## OCR failure

executable missing / timeout / parser/provider error 都是 tool failure：明确报告；Layer A 继续；人工 fallback 或 `review incomplete` + blocker；禁止假装 no findings。

## Report

```text
Candidate classification:
- main baseline: <main-ref>
- task-related: ...
- exclusions: path / category / reason

Plan compliance:
| Requirement | Status | Evidence |
|---|---|---|

Findings:
- BLOCKER ...
- MAJOR ...
- MINOR ...

Validation:
- Product QA: candidate target / N/A + reason
- OCR: range/workspace, reviewable N, reviewed N, skipped N
- DI scan: multiline / same-line result
- targeted tests / contract / runtime evidence
- docs manual review: N files

Final:
Blocker count: N
```

## 边界

- Designer = deeply define the work。
- Executor = execute approved plan，并把已验证 `<main-ref>` 交给 final gate。
- Prompt Repair = minimum-delta reviewer finding repair。
- Review With Docs = verify implementation against plan + reality + docs + runtime evidence，并拥有唯一 final PASS authority；复用已验证 baseline，不自行硬编码 remote。

本 Skill 不创建 future-wishlist owner、不重新做 Ambition/Design、不 commit/push/open PR/merge。
