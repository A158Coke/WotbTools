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
> Review 不是第二个 Designer：它验证 approved plan + repository reality + canonical docs + runtime evidence，
> 不重新选择 ambition 或擅自 redesign。

## Candidate Tree Review Contract（scope owner）

审查对象不是单一 `HEAD` commit，而是当前 task 的完整 candidate tree：

```text
committed range: merge-base(<main-ref>, HEAD)..HEAD
∪ staged current-task changes
∪ unstaged tracked current-task changes
∪ untracked current-task implementation files
```

### 1. 先构造 Task-related candidate files

原始来源：

- committed range 中属于当前 task 的 changes；
- staged current-task changes；
- unstaged current-task changes；
- untracked current-task source / config / test / doc files。

明确排除：

- unrelated user work；
- unrelated scratch；
- ignored transient output；
- generated non-source transient files；
- 明确属于另一个 task 的 preserved changes。

每一个 exclusion 都必须记录：`path / category / concrete reason`，禁止静默忽略。

### 2. Candidate changes predicate

```text
Candidate changes = task-related candidate files 非空
```

**不能**用裸 `git status --porcelain != empty` 直接判定 candidate changes；无关 worktree noise 不得卡死当前 review。

### 3. Calculated review scope

```text
Calculated review scope
= OCR reviewable task-related files
∪ A3 manually-reviewed task-related docs
```

只有同时满足：

```text
task-related candidate files 非空
AND
calculated review scope == 0
```

才 fail-closed：

```text
Task-related candidate tree contains changes but review scope is empty.
```

这只是修正 predicate，不放松 coverage。

### 4. 必须保留的 candidate 能力

- **clean committed branch**：覆盖 merge-base..HEAD。
- **dirty first implementation**：HEAD 仍等于 main 时必须用 workspace preview，不能误判 no diff。
- **staged / unstaged tracked / task-related untracked**：全部可进入 candidate。
- **committed + fresh repair mixed**：range + workspace scope deterministic union / dedupe。
- **docs-only candidate**：OCR 可标记 `.md` 为 `unsupported_ext`；A3 必须人工审查全部 task-related changed docs，并把它们计入 scope。
- **OCR unsupported non-doc committed file**：task-related candidate 非空但 OCR scope=0 且 A3 docs=0 → BLOCKER。
- **unrelated scratch**：显式 exclusion 后不进入 candidate predicate。

不得用 `reviewable_count == 0` 单独判定 PASS。

## 三层审查引擎

- **Layer A — Requirement/Plan Auditor**：检查 plan completion、DI、docs、死代码、reuse/SSOT。
- **Layer B — OpenCodeReview Code Auditor**：OCR delegate mode 确定 reviewable scope 与规则，主代理逐文件审查。
- **Layer C — Review Reconciler**：去重、验证、重定级，判定 blocker。

## 内部 playbooks

按需加载 `.agents/playbooks/`：

- `code-quality.md` — 代码质量检查；
- `code-smell.md` — overengineering / abstraction smell；
- `fallow.md` — 前端 dead-code / circular-deps / duplication / complexity；
- `wotb-sync.md`、`column-sync.md`、`frontend-architecture.md` — 跨层与前端 ownership；
- `keycloak-upgrade/`、`komodo-server-lifecycle.md` — 对应领域；
- `product-qa/` — 真实浏览器黑盒 QA / 易用性验收。

这些是内部 checklist/tool guidance，不拥有 lifecycle actions，也不是顶层 Skill。

## 流程（全程主代理）

> 不 spawn verifier 子代理。OCR delegate mode 是主代理直接驱动的确定性工具链，不是第二个 agent。

0. **Product QA applicability**：在任何源码/diff 审计前判定。
1. **OCR readiness**：确认固定版本 OCR 可用。
2. **Candidate classification**：构造 task-related candidate files + explicit exclusions。
3. **Layer B OCR audit**：range / workspace preview，过滤到 task-related scope，逐文件审查。
4. **Layer A Plan audit**：解析真实 plan source，逐条验证 requirement / acceptance criteria。
5. **Layer A supplemental gates**：DI + docs + AI dead code + reuse/SSOT。
6. **Internal checklists**：正常路径运行 code-quality；代码变更同时运行 code-smell；前端适用时运行 fallow。
7. **Layer C Reconciler**：汇总 finding，验证严重级别，计算 blocker。
8. **Fix → re-review**：BLOCKER / MAJOR 修复后重审，直到零 blocker 或出现无法闭环的真实阻塞。
9. **Report**：Plan compliance + Findings + Validation + Final。

## Product QA Gate

- standalone exploratory QA 可默认 production。
- final-gate Product QA 必须针对包含当前 candidate tree 的 local / preview / candidate environment，并记录 candidate 身份依据。
- production success **不能**代替未合并 candidate QA。
- applicable 但 candidate-specific target 不可用 → BLOCKER / coverage limitation，不得伪造 PASS。
- 若已读源码导致黑盒上下文污染，适用时执行 fresh isolated QA pass；不能因此改成 N/A。
- 纯后端 / 文档治理 / 无 UI 用户流程影响且用户未要求浏览器验收 → N/A。

## HTTP Contract Gate

涉及 API、构建或跨层 data shape 时，必须检查：

- `contracts/http/openapi.yaml` 是否仍是唯一 wire authority；
- endpoint / status / required / nullable / enum 与实际 Jackson serialization 是否一致；
- generated FE transport / schema / error registry 是否最新且未手改；
- domain enum 是否显式映射；
- 旧 artifact compatibility 是否只位于读取边界；
- ApiError envelope 与 `204 capability unavailable` 语义是否保持；
- fixture / runtime schema / backend contract tests / affected UI-parser tests 是否覆盖。

producer violation 修 producer / mapper，不通过放宽 FE schema 掩盖。

## OCR readiness 与执行

- 检查：`ocr --version`，期望 `open-code-review v1.9.10` 或明确兼容版本。
- 缺失时：`npm install -g @alibaba-group/open-code-review@1.9.10`；禁止 `@latest` / `@main`。
- delegate mode 不需要 OCR 侧 LLM API key；推理由当前主代理完成。
- OCR tool failure ≠ no findings；必须明确报告并执行人工 fallback，不能伪造 blocker=0。

### B1. candidate preview

先确认 repository 的真实 main baseline ref，记为 `<main-ref>`，然后：

```bash
git status --porcelain

# clean committed candidate
ocr delegate preview --from <main-ref> --to HEAD --format json

# dirty/staged/unstaged/untracked candidate
ocr delegate preview --format json

# mixed candidate：两者都运行，按 path union/dedupe
```

对 OCR 返回的 `reviewable_files` 再按上方 task-related classification 过滤；被排除的 path 仍必须写入 exclusion table 与理由。

### B2. compact context

把当前 plan 摘要、任务目标、acceptance criteria 与关键 invariant 压成简短 context：

```bash
ocr delegate preview --from <main-ref> --to HEAD --format json -b "<compact context>"
# 或 -B <context-file.md>
```

不要把整个 plan 复制给 OCR。

### B3. rule resolution

```bash
ocr delegate rule --format json <path1> <path2> ...
```

以 task-related reviewable files 为清单解析规则。

### B4. coverage

每个 task-related reviewable file 必须标记 `reviewed` 或 `skipped`；skip 必须有具体理由。

- range file：读 `<merge_base>..<to>` diff；
- workspace tracked：读 `git diff HEAD -- <path>`；
- task-related untracked：读全文。

## Layer A — Requirement / Plan Auditor

### A0. Plan Source Discovery

按顺序：

1. `docs/current-plan.md`（存在且与当前 task 相关）；
2. repository 的其它明确计划约定；
3. 用户当前显式 requirements / acceptance criteria；
4. 仍无 plan source → 明确报告 `no plan source found`，不臆造完成状态。

`docs/current-plan.md` 是 WotBTools 的 ephemeral approved execution plan，不是长期架构/行为 authority。

### A1. Plan compliance

逐项输出：

```text
| Requirement | Status | Evidence |
|---|---|---|
| ... | DONE / PARTIAL / MISSING / BLOCKED | 文件:行 / test / runtime evidence |
```

必须检查 requirement、acceptance criteria、遗漏功能、partial implementation、scope regression 与关键测试证明。
requirement 未完成 → 即使 OCR `no findings` 也为 BLOCKER。

### A2. Java DI gate

硬约定：constructor injection preferred；禁止无理由 `@Autowired` field injection。

先确认真实 Java module roots：

```bash
find java -path '*/src/main/java' -type d -print
```

当前 repository 的生产源码位于 `java/*/src/main/java`，不得扫描不存在的 `java/src/main/java`。

必须实际运行两种 scan：

```bash
# 普通两行 field injection
rg -n -U '@Autowired\s*\n\s*(?:private|protected|public)\s+' java/*/src/main/java

# 同一行 field injection
rg -n '@Autowired\s+(?:private|protected|public)\s+' java/*/src/main/java
```

验证要求：

- `@Autowired` 换行后 `private XxxService svc;` 能命中；
- `@Autowired private XxxService svc;` 能命中；
- 命令本身不报 multiline literal error；
- 发现 field injection 时优先改 constructor injection / `@RequiredArgsConstructor` + `final`；只有唯一可行时才允许保留并写具体原因。

本 gate 不引入 AST tooling。

### A3. Documentation Gate

先给每份 task-related changed doc 分类：

- canonical current-state docs；
- `HISTORY.md` — 产品 / 业务历史；
- `docs/architecture/TECHNICAL_EVOLUTION.md` — 技术 / 架构 / data-flow / authority / identity / production topology 历史；
- `docs/research/**` — research / reverse-engineering / experiment evidence；
- `docs/android/releases/**` — 当前临时 versioned release record 例外；
- `docs/current-plan.md` — ephemeral approved execution plan。

**ROADMAP 不是 documentation class / owner。Review With Docs 不创建 roadmap。**

current-state 文档发现 future-only prose 时：

1. 属于当前 approved task → `docs/current-plan.md`；
2. 已经是明确、独立、可执行的 follow-up → GitHub Issue；
3. 其它 uncommitted / speculative wishlist → 删除，不持久化。

Persistent repository docs 不承担 future wishlist。

其它强制检查：

- current-state doc 每句话应描述 candidate 合并后的当前系统，而不是 PR / review / migration diary；
- `HISTORY.md` 与 `TECHNICAL_EVOLUTION.md` 只保留有长期价值的对应历史，不冒充当前状态；
- `docs/research/**` 可保留证据史，但不得把退役架构写成当前生产；
- `docs/android/releases/**` 保留临时发布记录例外；
- 新增/修改的永久源码、配置、文档不得依赖 `docs/current-plan.md` 作为架构/行为 authority；
- persistent maintainer/dev/ops prose 使用简体中文，技术 literal / command / identifier / upstream quote 可保持规范英文；
- `docs/README.md` 只索引真实存在的 current persistent docs 与历史/evidence owner，不索引 future wishlist；
- 禁止 archive/old/historical 等过期 current-state 文档堆放。

任一不满足 → BLOCKER。

### A4. AI dead code / speculative code

识别并验证：单实现 speculative interface/factory/strategy、零引用字段/参数/constructor、空壳 wrapper、future-only abstraction。

- repo-wide `rg` 证明引用情况；前端适用时 `npx fallow check dead-code`；
- 真死且非 contract/reflection → 删除；
- 假死 → 保留并记录证据；
- 待定 → 报告，不凭感觉删除；
- 绝不能误删 wire DTO / Flyway / Spring-Jackson reflection / metrics / i18n / documented contract。

### A5. Reuse / Extend First

对新增 production type/file：

- repo-wide 搜索可复用实现；
- 检查是否制造第二个 SSOT；
- 检查是否只是单调用方 mechanical wrapper / speculative abstraction；
- 能安全删除/合并时优先删除/合并。

等价实现或第二 SSOT → BLOCKER；纯 speculative abstraction → MAJOR，能安全收缩则本轮修复。

## Layer C — Reconciler

Severity：

- **BLOCKER**：correctness / security / data-loss / requirement missing / mandatory coverage gap；
- **MAJOR**：错误处理、并发、contract、测试缺口、明显性能问题；
- **MINOR**：低风险维护性 / 风格建议。

规则：

- 去重相同 finding；
- OCR finding 必须用 repository evidence 验证后再定级；
- 不盲从 OCR severity，不为 reviewer suggestion 过度设计；
- requirement missing 优先级高于 OCR `no findings`。

Source of truth 冲突顺序：

1. 用户当前显式 requirement；
2. approved plan source；
3. acceptance criteria；
4. repository current architecture / contract；
5. tests / runtime evidence；
6. OCR findings；
7. reviewer inference。

Final：

```text
Blocker count: N
```

只有 `N = 0` 才能判 final PASS。

## Fix → Re-review

- 按 BLOCKER → MAJOR → MINOR 处理；MINOR 可作为 known issue，不必扩大 scope；
- 修复后只重跑受影响 validation 与 review scope；
- repository-level authoritative validation 由 PR CI 负责，除 `.agents/AGENTS.md` 的 Full-test 例外外不重复跑全量；
- 若 finding 证明 approved plan 本身失效，停止 repair 并返回 Designer，而不是在 Review 内 redesign。

## OCR failure

OCR executable missing / timeout / parser error / provider error 都是 tool failure，不是 no findings。

必须：

1. 明确报告 tool failure；
2. Layer A 继续；
3. 用主代理 + `code-quality.md` / Layer B coverage contract 做人工 fallback，或标记 `review incomplete` + blocker；
4. 禁止伪造 blocker=0。

## 报告模板

```text
### Review-With-Docs

Candidate classification:
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

## 文档检查清单

- [ ] canonical current-state doc 已同步且只描述 post-merge current system；
- [ ] `docs/README.md` 索引只指向真实存在且支持的 persistent docs；
- [ ] 产品/业务历史只归 `HISTORY.md`；
- [ ] 技术/架构历史只归 `docs/architecture/TECHNICAL_EVOLUTION.md`；
- [ ] research evidence 保留证据边界；
- [ ] Android release record 例外保持；
- [ ] future-only prose 已按 current-plan / GitHub Issue / delete 三分法处理；
- [ ] 不存在 ROADMAP owner / reference；
- [ ] `docs/current-plan.md` 不被 production/current-state 内容当 authority；
- [ ] API / locale / export / DTO / docs 同步；
- [ ] comments / TODO / config docs 未漂移；
- [ ] HISTORY 与 TECHNICAL_EVOLUTION 不记录逐 commit / PR / review diary。

## 边界

- Designer = deeply define the work。
- Executor = execute approved plan。
- Prompt Repair = minimum delta reviewer finding repair。
- Review With Docs = verify implementation against plan + reality + docs + runtime evidence，并拥有唯一 final PASS authority。

本 Skill 不创建 roadmap、不重新做 Ambition/Design、不 commit/push/open PR/merge。
