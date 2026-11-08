---
name: review-with-docs
description: >
  唯一 final quality gate：验证 implementation 是否符合 approved/authorized plan、repository reality、canonical docs
  与 acceptance criteria 要求的 runtime evidence；覆盖代码质量、文档同步、AI 死代码、架构/领域 playbook。
  Trigger: Executor 实现完成后、Prompt Repair 修复 reviewer finding 后、merge 前需要 final gate 时。
  只有本 Skill 可以判定 final PASS。周期性 Product QA 是独立 playbook，不是本 Skill 的 gate 或 trigger。
  Code-review engine: Alibaba OpenCodeReview（OCR）delegate mode 负责确定性文件筛选 / 规则解析，推理由主代理完成。
---

# Review With Docs（唯一 final quality gate）

> 生命周期：Executor implementation + targeted validation → **Review With Docs** → PASS 后 Executor 才 commit/push/open PR。
> Review 不是第二个 Designer：它验证 approved/authorized plan + repository reality + canonical docs + runtime evidence，不重新选择 ambition 或擅自 redesign。

## 输入与 main baseline

- 从 Executor 进入 final gate 时，必须接收并复用 Executor 已验证的精确 `<main-ref>`，其值为步骤 3 记录的 `<remote>/main`。
- 从 Prompt Repair 进入时，优先复用该 PR / task 已有的已验证 `<main-ref>`；如果当前上下文没有，则先验证实际承载 upstream/main 的 remote，再记录 `<main-ref> = <remote>/main`。
- standalone review 没有 lifecycle handoff 时，也必须先验证真实 canonical main remote/ref，再记录 `<main-ref>`。
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
Calculated review scope = OCR reviewable task-related files ∪ A3 manually-reviewed task-related docs ∪ equivalent manually-reviewed fallback files
```

最低覆盖检查：

```text
task-related candidate files 非空
AND
calculated review scope == 0
```

成立时必须 fail-closed：

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
- OCR unsupported non-doc file → 需要有证据的等价人工覆盖；无法覆盖时 BLOCKER，不能因其他文件可审就忽略该文件。

不得用 `reviewable_count == 0` 单独判 PASS，也不得用 scope 非零掩盖部分漏审。每个 task-related file 都要有审查结论或等价覆盖证据；skipped 必须说明理由及替代证据，mandatory coverage gap 始终 BLOCKER。

## 三层审查

- **Layer A — Requirement/Plan Auditor**：plan completion、DI、docs、dead code、reuse/SSOT。
- **Layer B — OpenCodeReview Code Auditor**：OCR delegate mode 确定 reviewable scope / rules，主代理逐文件审查。
- **Layer C — Review Reconciler**：去重、验证、重定级、判定 blocker。

## 内部 playbooks

按需加载 `.agents/playbooks/`：`code-quality.md`（代码质量与品味检查）、`fallow.md`、`wotb-sync.md`、`column-sync.md`、`frontend-architecture.md`、`ui-design-review.md`（UI 任务）、`keycloak-upgrade/`、`komodo-server-lifecycle.md`。

它们是 checklist/tool guidance，不拥有 lifecycle actions，也不是顶层 Skill。`product-qa/` 是独立的周期性 production product audit playbook，不属于本 Skill 的审查阶段。

## 流程

> 全程主代理，不 spawn verifier 子代理。OCR delegate mode 是确定性工具链，不是第二个 agent。

1. **Baseline + OCR readiness**：确认 / 接收本轮唯一 `<main-ref>`；先完成 OCR 版本安全检查，再进入任何 candidate repository rules 解析。
2. **Candidate classification**：task-related files + explicit exclusions。
3. **Layer B**：range/workspace preview → 过滤到 task-related scope → rules → 逐文件 audit。
4. **Layer A**：发现真实 plan source，逐条验证 requirement / acceptance criteria。
5. **Supplemental gates**：DI + docs + dead code + reuse/SSOT。
6. **Internal checklists**：code-quality（含品味检查）；前端适用时加 fallow。
7. **Layer C**：reconcile findings，计算 blocker。
8. **Fix → re-review**：可修 BLOCKER/MAJOR 持续修复后只重跑受影响 scope；按 Designer「授权、计划输入与偏差边界」遇到 HARD STOP 才暂停依赖步骤。
9. **Report**：Plan compliance + Findings + Validation + Final。

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

### Version security gate（先于 candidate rules 解析）

`ocr` 在 delegate mode 下会读取 candidate repository 的 `.opencodereview/rule.json`。安全下限是 `1.11.1`（GHSA-wwg6-qfxw-xffj：受影响版本可被 candidate 控制的 rule 文件通过绝对路径 / 越界符号链接读取 review 机器上的 Markdown/text 并送入模型上下文）。

1. 在读取、解析或评估任何 candidate repository OCR rules（含 `.opencodereview/**`）之前，先运行 `ocr --version`。
2. 安装版本必须 `>= 1.11.1`。
3. 缺失或低于下限时，安装 exact pinned `@alibaba-group/open-code-review@1.11.1`；禁止 `latest`、`main` 或 floating range。
4. 已安装版本低于下限时 fail closed：停止 Layer B，不解析 repository rules、不运行 `ocr delegate preview` / `ocr delegate rule`，明确报告版本 blocker；重新安装 pinned secure version 后才能继续。

```bash
ocr --version   # 必须 >= 1.11.1
```

### Delegate mode

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

只有版本 gate 通过后才运行上述 delegate 命令。mixed candidate 两个 preview 都运行并按 path union/dedupe。OCR 返回 scope 后再次应用 task-related classification；exclusion 仍显式记录。

每个 task-related file 必须 `reviewed` 或有具体原因及等价覆盖证据的 `skipped`。range 读 `merge-base(<main-ref>, HEAD)..HEAD` diff，tracked workspace 读 `git diff HEAD -- <path>`，task-related untracked 读全文。

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
| ... | SATISFIED / PARTIAL / MISSING / BLOCKED | 文件:行 / test / runtime evidence |
```

这里的 Status 是 requirement compliance 结果，不是 plan execution step 状态（step 状态只使用 Designer 的 `PENDING / IN_PROGRESS / DONE / BLOCKED`）。

检查 requirement、acceptance criteria、遗漏、partial implementation、scope regression 与关键验证。requirement missing → 即使 OCR no findings 也 BLOCKER。

### A1b. Verification receipt（证据，不是感觉）

A1 的 `SATISFIED / PARTIAL / MISSING / BLOCKED` 是 **plan compliance** 结果；本节 receipt 是**每条 acceptance criterion 的证据状态**。两者不互相替代，也不新增第二份计划。

每条 requirement 映射到实际观察到的 evidence，状态只有四个：

| 状态 | 成立条件 |
|---|---|
| `PROVEN` | 至少一条相关 `PASS`、**没有任何相关 `FAIL`**，且该 criterion 明确要求的每个 evidence / surface 都已覆盖 |
| `FAILED` | 存在能证伪该 criterion 的 `FAIL` evidence；`PASS` 与 `FAIL` 并存时判 `FAILED`，不因部分通过升格 |
| `UNVERIFIED` | 没有证伪性 `FAIL`，但 required evidence / surface 缺失、`NOT_RUN`，或证据不足以覆盖完整 criterion（不得折叠进 `FAILED`） |
| `NOT_APPLICABLE` | 必须写明原因 |

`PROVEN` 判定的是**完整 criterion**，不是某一条 evidence。criterion 要求多个 surface 时逐条核对，任一 required surface 为 `NOT_RUN` 或缺失即整条 `UNVERIFIED`：

```text
criterion: mobile web 正常 AND Android 正常
Evidence:
- [MACHINE] PASS pnpm run typecheck
- [EXTERNAL] Android: NOT_RUN
Status: UNVERIFIED          # 不是 PROVEN：Android surface 未覆盖
```

证据必须区分来源：`MACHINE`（unit / integration test、typecheck、compiler、build、static diagnostics、Git diff、API test）与 `EXTERNAL`（窄屏浏览器渲染、Computer Use、Android 模拟器/真机、Android 生命周期、真实生产端点、外部 IdP 行为、已部署 IaC 行为、GPT Web Review）。机器测试不证明外部行为。

硬规则：

- 没有 evidence 不得写 `PROVEN`；缺证据只能写 `UNVERIFIED`。
- `NOT_RUN` 永远不构成 `PASS`。
- 不得把 `UNVERIFIED` 折叠成 `FAILED`，也不得把 `FAILED` 折叠成 `UNVERIFIED`。
- 缺少 runtime evidence 不能用静态 fallback 替代验收（与 `## OCR failure` 末段一致）。
- 只有相关 evidence 参与判定：与 criterion 无关的 `PASS` 不能补足缺失的 surface，也不能抵消相关的 `FAIL`。
- `wotb_verification_receipt` 的自动汇总只是 advisory：它按传入 evidence 归类，不判断 criterion 的 evidence coverage 是否完整。coverage 不完整时 Review 必须降级为 `UNVERIFIED`，不得因为工具返回「至少一条 PASS」就盖章 `PROVEN`。
- GPT Web Review 在本仓之外：receipt 只记录 `PENDING / DONE / NOT_APPLICABLE`，不调用、不上传、不模拟、不等待。

```text
Requirement R1
Evidence:
- [MACHINE] PASS pnpm test ...
Status: PROVEN

Requirement R3
Required surface: Android real device
Evidence:
- none
Status: UNVERIFIED

External review:
- GPT Web: PENDING
```

可用 `wotb_verification_receipt` 工具做确定性汇总与降级（advisory，无 gate）；不可用时就按本节格式手工产出。

### A2. Java DI gate

存在 Java production 变更或直接受影响 Java DI 接线时执行本节；纯非 Java 任务记录 N/A + 原因。Constructor injection preferred；禁止无理由 field injection。

先确认真实 roots：

```bash
find java -path '*/src/main/java' -type d -print
```

生产源码按 module 位于 `java/*/src/main/java`，不得扫描不存在的单一根目录。

必须实际运行：

```bash
# 两行 field declaration：以 ; 结束，且 ; 之前不含括号
rg -n -U '@Autowired(?:\s*\([^)]*\))?[^\S\r\n]*\r?\n[^\S\r\n]*(?:(?:private|protected|public)\s+)?[^(){}\r\n;]+;' java/*/src/main/java

# 同行 field declaration
rg -n '@Autowired(?:\s*\([^)]*\))?\s+(?:(?:private|protected|public)\s+)?[^(){}\r\n;]+;' java/*/src/main/java
```

命中必须结束于 `;`，且 `;` 之前不含 `(` / `)`：`@Autowired` 标注的 constructor / method declaration 因此不命中。访问修饰符可有可无，因此 `private` / `protected` / `public` 与 package-private field 都命中（不得靠删除 `public` 或只匹配显式修饰符规避）。`(?:\s*\([^)]*\))?` 覆盖 `@Autowired(required = false)` 写法。

本 gate 是行邻接的文本搜索，不是符号解析：注解与字段声明之间夹了其它注解或注释、或字段带初始化器时不覆盖，需要时人工补查，不得据零命中断言「无 field injection」；注释或字符串里出现同样文本也会误报，命中一律人工确认。

必须证明普通两行与同行 field injection 都能命中，且命令本身不报 multiline error。发现后优先显式 constructor injection + `final` 字段（不引入 Lombok）；唯一可行时才保留并写具体原因。不引入 AST tooling。

### A3. Documentation Gate

先做 changed behavior → canonical owner 的同步映射。candidate 改变下列任一行为时，对应 canonical 文档必须在同一 candidate tree 内同步；只审查已存在的文档不足以通过本门禁：

| Changed behavior | 必须同步的 canonical owner |
|---|---|
| 用户可见界面 / 交互 / 导航 / i18n | 对应 `docs/frontend/**` 或专题文档 |
| 导出 / 数据列 / 数据来源 | `docs/DEVELOPER_GUIDE.md`、对应数据/导出专题文档 |
| 构建 / 部署 / 运维 / 配置 | `docs/DEVELOPER_GUIDE.md`、`docs/operations/**` |
| HTTP/API wire contract | `contracts/http/openapi.yaml` 及其 canonical 说明 |
| 认证 / 身份 / 权限 | 对应 auth / Keycloak 文档 |
| Android runtime / 发布契约 | `docs/android/**`，版本门槛归 `docs/android/release-process.md` |
| 仓库工作流 / lifecycle / Skill | `.agents/skills/**`、`.agents/playbooks/**` |

映射结果为「无需更新」时必须给出具体理由；遗漏对应 canonical owner → BLOCKER。

文档分层、例外边界、future-only 处理与存量偏差过渡的唯一正文在 `docs/README.md`「文档分层与权威归属」；语言规范、current-plan 门禁与 archive 禁令的 BLOCKER 正文以该节与 `scripts/ci/check-repository-hygiene.sh` 为准。本 gate 按二者逐项复核 candidate，任一不满足 → BLOCKER，不在此复制第二套清单。

### A4. AI dead/speculative code

扫描单实现 speculative abstraction、零引用字段/参数/constructor、空壳 wrapper、future-only code。repo-wide `rg` 证明引用；前端适用时 `pnpm exec fallow check dead-code`。真死且非 contract/reflection → 删除；假死 → 保留并记录证据；待定 → 报告，不猜。

绝不能误删 wire DTO / Flyway / Spring-Jackson reflection / metrics / i18n / documented contract。

### A5. Reuse / Extend First

新增 production type/file 必须 repo-wide 搜索可复用实现、检查第二 SSOT 与单调用方 mechanical wrapper。等价实现或第二 SSOT → BLOCKER；纯 speculative abstraction → MAJOR，能安全收缩则修复。

## Layer C — Reconciler

- **BLOCKER**：correctness/security/data-loss/requirement missing/mandatory coverage gap；
- **MAJOR**：error handling/concurrency/contract/test gap/明显 performance；
- **MINOR**：低风险维护性/风格。

规则：去重；OCR finding 必须用 repository evidence 验证；不盲从 OCR severity；不因 reviewer suggestion over-engineer；requirement missing 高于 OCR no findings。

Source-of-truth 顺序：用户当前显式 requirement → approved/authorized plan → acceptance criteria → repository current architecture/contract → tests/runtime evidence → OCR → reviewer inference。

```text
Blocker count: N
```

只有 N=0 且无未解决 MAJOR、无 mandatory coverage gap 才能 final PASS；MINOR 可报告，不要求“零所有问题”。

## Repair boundary

- BLOCKER → MAJOR → MINOR；MINOR 可记录 known issue，不扩大 scope；
- 修复后重跑受影响 validation/review；repository-level authoritative validation 交给 PR CI，除 Full-test 例外不重复全量；
- finding 按 Designer「授权、计划输入与偏差边界」证明设计实质失效才返回 Designer；实现细节纠正继续修复，不在 Review 内 redesign。

## OCR failure

executable missing / timeout / parser/provider error 都是 tool failure：明确报告并尝试安全恢复；Layer A 继续。人工 fallback 仅在能独立列全 candidate paths、取得完整 diff/文件和适用规则、完成逐文件审查及必需验证时等价；报告工具失败、覆盖方法和证据，禁止假装 OCR 成功或 no findings。不能维持同等覆盖则 `review incomplete` + blocker，不得 PASS。

版本安全门禁始终先于 candidate OCR rules 解析；低于安全下限时先修复到安全版本，不以 fallback 为由运行不安全 OCR 或解析未获安全保障的 candidate rules。缺少必要 runtime evidence 不能用静态 fallback 或“未验证”替代验收。

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
- runtime evidence: acceptance criteria 要求的 browser / device / runtime response / benchmark 结果，或 N/A + 具体理由
- verification receipt: `PROVEN / FAILED / UNVERIFIED / NOT_APPLICABLE` 计数、未验证 acceptance criteria 清单、`MACHINE` / `EXTERNAL` 证据分布、GPT Web 状态
- OCR: version, range/workspace, reviewable N, reviewed N, skipped N
- DI scan: multiline / same-line result
- targeted tests / contract evidence
- docs behavior→owner mapping + manual review: N files

Final:
Blocker count: N
```

## 边界

- Designer = deeply define the work。
- Executor = execute approved/authorized plan，并把已验证 `<main-ref>` 交给 final gate。
- Prompt Repair = minimum-delta reviewer finding repair。
- Review With Docs = verify implementation against plan + reality + docs + acceptance criteria 明确要求的 runtime evidence，并拥有唯一 final PASS authority；复用已验证 baseline，不自行硬编码 remote。
- Product QA = 独立、周期性或用户显式触发的 production product audit；不拥有 final implementation PASS，也不属于本 Skill 的 gate。

本 Skill 验证 implementation，而不是做周期性产品体验审计。它不创建 future-wishlist owner、不重新做 Ambition/Design、不 commit/push/open PR/merge。
