---
name: review-with-docs
description: >
  唯一 final quality gate：代码质量 / code smell / fallow / 文档同步 / AI 死代码 / 架构与领域 playbook /
  明确适用时的 product QA。审查 executor 的实现与 prompt-repair 的修复，判定 final PASS / zero blocker。
  Trigger: 任何影响界面/导出/数据/构建/API/配置/文档的代码变更完成后；PR reviewer findings 修复后；
  或 merge 前需要 final gate 时。只有本 Skill 可以判定 final pass。
  Code-review engine: 内置 Alibaba OpenCodeReview（OCR）delegate mode 作为通用
  diff/code review 引擎（确定性文件筛选 + 规则解析，推理由主代理 DeepSeek 完成）。
---

# Review With Docs（唯一 final quality gate）

> **生命周期位置**：Executor 实现 + targeted validation → **Review With Docs** → PASS 后 Executor 才 commit/push/open PR。
> **final gate ownership**：只有本 Skill 可以判定 final quality gate / zero blocker。Designer 不 review；
> Executor 不自行判定 review pass；Prompt Repair 不自行判定 final pass。
> **前置**：Executor 已完成实现与 targeted validation；内部 `code-quality.md` 6 项检查按需加载。
> **架构**：三层审查引擎 ——
>   Layer A: Requirement/Plan Auditor（主代理自审，不可交给 diff reviewer）
>   Layer B: OpenCodeReview Code Auditor（OCR delegate mode，通用 diff/code review）
>   Layer C: Review Reconciler（主代理汇总、去重、重定级、判定 blocker）
> **范围**：代码质量、code smell、fallow 诊断、文档同步、AI 生成代码的提前性/投机死代码、架构/领域 playbook 检查；明确适用时加载 product QA。

## 内部 playbooks（本 Skill 专用）

按需加载 `.agents/playbooks/`：

- `code-quality.md` — 6 项代码质量检查
- `code-smell.md` — 过度设计 / 无意义抽象 / 架构复杂化
- `fallow.md` — 前端 dead-code / circular-deps / duplication / complexity
- `wotb-sync.md`、`column-sync.md`、`frontend-architecture.md` — 跨层与前端 ownership 检查
- `keycloak-upgrade/`、`komodo-server-lifecycle.md` — 对应领域变更时
- `product-qa/` — 明确要求真实浏览器黑盒 QA / 易用性验收时

这些是内部 checklist/tool guidance，不是顶层 Skill，也不参与生命周期选择。

## 流程（全程主代理，禁止 spawn 子代理）

> 硬约束：本技能全程由主代理自审执行，**不 spawn verifier 子代理**；
> OCR 是外部确定性 CLI（delegate mode 不调用 OCR 侧 LLM，推理由主代理完成），
> 属于主代理直接驱动的工具链，不是子代理。

0. **Product QA（仅明确适用时）** — 必须在任何源码/diff 审计之前完成黑盒 QA；若当前主代理已读业务源码，不得在同一会话声称满足 product-qa 的黑盒隔离，改为单独 QA pass 或标记该 gate 不适用。
1. **OCR 就绪检查** — 确认 `ocr` CLI 可用（缺失则按固定版本安装），见「OCR 就绪检查」
2. **Layer B — OpenCodeReview Code Audit** — OCR delegate mode 产出审查范围 + 规则，
   主代理逐文件按规则审查 diff，产出结构化 finding
3. **Layer A — Requirement/Plan Auditor** — 主代理按 A0 解析 plan source
   （发现不到计划文件则 fallback 用户显式 requirements / acceptance criteria），
   逐条审计完成度，产出 Plan compliance
4. **Layer A 补充审计** — DI 注入审计 + AI 死代码清理 + 文档自检（按下方检查单，OCR 不覆盖的领域）
5. **Layer C — Reconciler** — 合并 Layer A + Layer B finding，去重、验证、重定级，输出 blocker count
6. **修复 → 重审** — 对 BLOCKER/MAJOR 逐项修复并重审，循环直到零 blocker
7. **出具报告** — Plan compliance + Findings + Validation + Final（Blocker count）

---

## HTTP Contract Gate

涉及 API、构建或跨层数据 shape 时，Layer A 必须补查：`contracts/http/openapi.yaml` 是否为唯一 wire authority；OpenAPI endpoint/status/schema 是否与实际 Jackson serialization 一致；generated FE types/schema/error registry 是否最新且未手改；是否存在重复手写 transport contract、domain enum 泄漏、required/nullable 漂移或把客户端 fallback code 当服务端 registry；Playback 旧 artifact 是否只在读取边界 normalization；ApiError envelope 与 `204 capability unavailable` 语义是否保持；fixture、Ajv runtime、后端 contract tests 与受影响 UI/parser tests 是否都覆盖。发现 producer violation 时修 producer/mapper，不放宽 FE schema 作为掩盖。

## OCR 就绪检查

- 检查：`ocr --version`（应输出 `open-code-review v1.9.10` 或兼容版本）
- 缺失/不可用时：`npm install -g @alibaba-group/open-code-review@1.9.10`
  （**固定版本**，禁止 `@latest` / `@main`；license Apache-2.0）
- delegate mode **不需要** OCR 侧 LLM 配置（`ocr config` / API key 均不需要），
  推理完全由主代理（DSH DeepSeek）完成 —— 见「执行模式」
- 安装失败 / 命令不可用：按「OCR 失败处理」记录 tool failure，不得假装 OCR 已运行

## Layer B — OpenCodeReview Code Audit（通用 diff/code review）

> OCR 负责确定性工程（文件筛选 / 分组 / 规则匹配 / diff 定位），主代理负责推理。
> 禁止用自然语言重新手搓一套与 OCR 重复的 diff reviewer（§十一 避免重复 Review）。

### B1. 计算审查范围（merge-base，不是 HEAD~1）

```bash
# 分支范围（默认）：feature branch vs 正确 merge-base
ocr delegate preview --from origin/main --to HEAD --format json

# 工作区变更（无分支对比场景）
ocr delegate preview --format json

# 单 commit
ocr delegate preview -c <hash> --format json
```

- 输出包含：`mode`、`merge_base`、`reviewable_files`（path/status/insertions/deletions）、
  `excluded_files`（含 exclude_reason）
- **多 commit 分支**：OCR 自动基于 merge_base 覆盖 feature branch 全部变更，不是只 review HEAD~1
- **无有效 diff**：`reviewable_count == 0` 时按「Case 6 — No meaningful diff」处理，
  但 **Layer A plan audit 仍继续**（无 diff ≠ plan 完成）

### B2. 传入业务背景（compact，不塞整个 plan）

把 review-with-docs 已知的需求背景压成简短 context（当前计划摘要 + 任务目标 +
acceptance criteria + 关键项目 invariant），传给 OCR：

```bash
ocr delegate preview --from origin/main --to HEAD --format json -b "<compact context>"
# 或 -B <context-file.md>（Markdown 文件，优先于 -b）
```

示例（约 10 行，勿复制整个 plan）：

```text
任务：改进战局回放详情面板。
关键不变量：
- 详情面板表示当前回放状态，不是最终战斗结果。
- Tankopedia HP 只是 base HP；实际 HP 来自回放解析。
- 不推断消耗品/装备 HP 加成的来源。
- 地图缩放时选中的标记必须保持可见。
```

### B3. 解析规则

```bash
ocr delegate rule --format json <path1> <path2> ...
```

- 传入 B1 的 reviewable 文件路径；输出按规则内容分组（files sharing the same rule under one group）
- 大变更分批取规则，随审随取；规则文本作为该文件的审查清单

### B4. 逐文件审查（覆盖率强制）

以 B1 的 reviewable_files 为清单，逐项：

1. 取 diff（按 mode）：
   - range: `git diff <merge_base>..<to> -- <path>`
   - workspace tracked: `git diff HEAD -- <path>`；untracked 新文件直接读全文
2. 对照 B3 命中该文件的规则作为审查清单
3. 主代理深度审查（可读全文件、搜索代码库、查相关调用方），逐文件记录：

| 字段 | 说明 |
|---|---|
| path | 相对文件路径 |
| content | 审查意见（具体问题描述） |
| start_line / end_line | 新文件行号（可缺省） |
| category | bug / security / performance / maintainability / test / style / documentation / other |
| severity | critical / high / medium / low（OCR 原始定级，**Layer C 会重定级**） |

4. 标记 `reviewed` 或 `skipped`（必须给出具体 skip 原因）

> 覆盖率强制：reviewable_files 每一项必须为 reviewed 或显式 skipped，不得静默遗漏。

## Layer A — Requirement/Plan Auditor（主代理自审，不可交给 diff reviewer）

> **核心原则**："没有实现的代码"通常不会出现在 diff 中 —— OCR 报告 `no findings`
> **绝不代表 plan 完成**。本层保留 review-with-docs 对 plan/document completion 的审计能力。

### A0. Plan Source Discovery（不硬编码路径）

> **禁止假设**计划文件路径固定。`docs/current-plan.md` 只是本仓库既有约定，
> 不是所有环境都成立；先发现，再 fallback。

按以下顺序解析本次 review 的 plan source：

1. **仓库约定位置**：`docs/current-plan.md`（存在且与本次变更相关时使用）
2. **其他常见位置**（约定位置缺失时按序探测）：`docs/plan*.md` / `PLAN.md` /
   `docs/current-plan*.md` / 仓库根 `current-plan.md` / `plan.md`，取内容最完整、
   与本次变更最相关的一份
3. **fallback — 用户显式 requirements**：无任何计划文件时，以用户本次 review 请求中
   显式给出的 requirements / acceptance criteria 为 plan source
4. **仍为空**：明确报告「no plan source found」，不臆造；按 reviewer inference 标记
   待确认项，不静默跳过 Layer A

> 判定「plan 完成/未完成」必须基于实际解析到的 plan source（含 fallback 的显式
> requirements）；找不到文件 ≠ plan 不存在或已完成。

### A1. Plan compliance 审计

输入：

- plan source（A0 解析结果：`docs/current-plan.md` 或探测到的计划文件，
  或 fallback 的用户显式 requirements）
- acceptance criteria（plan source 内或用户请求中）
- repository 当前实现
- tests
- 必要的相关 documentation

逐条检查：

- requirement 是否实现
- acceptance criteria 是否满足
- 是否存在完全遗漏的功能（diff 无对应代码、仓库也无）
- 是否只实现了一部分（PARTIAL）
- 实现行为是否与 requirement 不一致
- requirement 是否有对应代码
- 是否有测试证明关键行为
- 是否发生 scope regression

输出逐项 Plan compliance（每项必须带 evidence）：

```
| Requirement | Status | Evidence |
|---|---|---|
| ... | DONE / PARTIAL / MISSING / BLOCKED | 文件:行 / 命令输出 |
```

requirement 未完成 → **即使 OCR 无 finding 也必须成为 BLOCKER**。

### A2. DI 注入检查单（Spring）

> 硬约定：**禁止 `@Autowired` 字段注入**，除非是唯一可行手段。
> 理由：字段注入破坏不可变性、妨碍单测构造、隐藏依赖图、与规则 13（Java final）/24（Mapper）冲突。

- [ ] **字段注入扫描**：`rg -n "@Autowired\s+private|@Autowired\s+\n\s+private" java/src/main/java`（含 Lombok `@Autowired` 配合 `@RequiredArgsConstructor` 是否绕过）
- [ ] **改造优先级**（按此顺序选可行档）：
  1. **构造器注入**（首选）：`private final XxxService svc;` + 无参/显式构造器；Spring 4.3+ 单构造器免 `@Autowired`；与 `final` 规则协同
  2. **Lombok `@RequiredArgsConstructor`**：配合 `private final` 字段生成构造器，等价构造器注入
  3. **`@Autowired` setter 方法**：仅当需运行时重配 / 测试需注入 mock 而类已被多构造器占满
  4. **`@Autowired` 字段注入**：仅当上述三档均不可行（如循环依赖的临时收口、第三方框架反射装配），保留时必须留 `// ponytail: 唯一手段，原因=xxx` 注释
- [ ] **不可变性**：改造后依赖字段必须为 `final`（除非确实需运行时重配，留 ponytail）
- [ ] **循环依赖**：若引入 `@Autowired` 字段仅为缓解循环依赖，**优先重构**拆循环（提取第三方/接口反转/事件总线），不在本检查单用字段注入掩盖
- [ ] **测试可构造**：改造后单测可直接 `new XxxService(mockDep)` 构造，无需 `@SpringBootTest` / 反射字段注入
- [ ] **首批 vs 增量**：本次变更新增/修改的类强制审计；历史存量字段注入随所在类改动顺手改造，暂不开专项大扫除

### A3. 当前状态文档门禁（强制）

> 文档同步不只检查「有没有改文档」，更要在 AGENTS rule 3 下先分类，再检查当前状态文档是否描述合并后的当前系统。
> 完整检查项见文末「文档检查清单（完整）」。

审查者必须显式回答：**本次改动的每份文档属于 AGENTS rule 3 的哪一类？只有当前状态文档必须描述合并后的当前系统；历史/未来/证据文档按各自 ownership 检查。**

逐项门禁：

- [ ] **先分类**：按 `.agents/AGENTS.md` 规则 3 把本次改动涉及的每份文档归类：当前状态文档 / `HISTORY.md`（产品/业务历史）/ `docs/architecture/TECHNICAL_EVOLUTION.md`（技术历史）/ `docs/ROADMAP.md`（未来方向）/ `docs/research/**`（证据）/ `docs/android/releases/**`（临时版本化发布记录）/ `docs/current-plan.md`（临时计划）。分类不清 → BLOCKER。
- [ ] **当前状态文档**：仅对分类为当前状态文档的文件，逐份按「合并后新维护者第一次阅读」检查；每句话必须对候选 HEAD 作为合并后系统成立，不依赖读者知道 PR 过程（不是要求对当前 main 成立）。`docs/frontend/design-language.md` 不保留未实现的未来目标；未来方向归 ROADMAP。
- [ ] **历史/未来/证据文档**：不要求 `HISTORY.md` / `TECHNICAL_EVOLUTION.md` 的历史内容描述当前 HEAD；但它们仍必须 (a) 不把历史状态冒充当前状态，(b) 不保存 PR/review/implementation diary，(c) 遵守 `HISTORY.md`=产品/业务、`TECHNICAL_EVOLUTION.md`=技术/架构的 ownership。`ROADMAP.md` 只写未来方向；`docs/research/**` 保留证据但不得把退役架构写成当前生产；`docs/android/releases/**` 是临时版本化发布记录；`docs/current-plan.md` 是临时计划。
- [ ] **变更日记泄漏扫描**（字符串是信号，不是自动失败）：`本 PR` / `本次` / `本期` / `Step 0` / `review P1` / `P2` / `审查基线` / 只对某 commit 或 run 成立的 id / 作为发布日记的 `当前候选版本` / `未来 Kx` / `下一阶段` / `以最终实现为准` / `migration completed` / 先旧实现后新实现的对比叙事。
- [ ] **五分类**：每个命中必须判定 A 当前契约（改写为状态描述并保留）、B 产品/业务历史（只进入 `HISTORY.md`）、C 技术历史（只进入 `docs/architecture/TECHNICAL_EVOLUTION.md`）、D 研究证据/来源/实验/被否证假设（保留在 `docs/research/**`，不得被迫搬进 HISTORY 或 TECHNICAL_EVOLUTION）、E 一次性实现/审查/PR 日记（删除；Git 历史足够）。B/C 不得留在 canonical 文档，E 不得搬进历史文档。
- [ ] **无历史堆放**：不得以 `archive/` / `old/` / `historical/` / “Historical” 标签保留过期现状；已完成迁移/验收/审计文档不得仅作为历史存储保留。
- [ ] **research 例外**：`docs/research/**` 可保留实验与证据史，但不得把已退役架构描述成当前生产状态。
- [ ] **Android 发布记录例外**：`docs/android/releases/**` 是临时版本化发布记录，豁免当前状态要求；本阶段不得删除，迁移到 GitHub Release / tag / APK / `version.json` 后由 CI/CD 审计推进。
- [ ] **current-plan 权威**：新增/修改的永久源码/配置/文档不得依赖 `docs/current-plan.md` 作为架构或行为权威（BLOCKER）；已存在的遗留引用登记为整改债务，不因本条在同一提交内追溯失败；已应用 Flyway migration 注释与受 Android release 版本门禁控制的 runtime 文件是明确例外。当仓库中除允许的 planning/execution 工作流与上述两类例外外，`current-plan` 权威引用清零时，此门禁自动转为绝对规则。
- [ ] **存量偏差过渡**：本治理规则首次进入仓库之前已经存在、且未被当前变更触及的 current-state / 历史文档偏差，在对应偏差被实际修复或登记为例外前按整改债务保留；新增或修改的持久文档必须满足本门禁。
- [ ] **中文正文**：本次新增/修改的持久开发者/维护者/运维文档，人类可读正文是否统一使用简体中文？类名、函数/类型名、源路径、API path、HTTP method、环境/配置 key、error code、enum、event 名、schema 字段、命令、外部产品/项目名与上游原文引用可保留规范英文；英文正文 = BLOCKER。
- [ ] **路由而非占有**：`DEVELOPER_GUIDE.md` 指向领域 SSOT，不复制业务规则；`docs/README.md` 只回答「今天该读哪份文档」。

任一项不满足 → **BLOCKER**，修复后重审。

### A4. AI 死代码 / 提前性代码清理

> 定位：内部 `code-quality.md` 管"对不对"，`code-smell.md` 管"好不好的品味"，本节负责**执行清理**——
> 针对 AI 生成代码常见的"为未来准备却没换来灵活性"的提前性死代码。

- [ ] **识别模式**：单实现接口/工厂/策略/观察者；从不覆盖的字段与参数（含恒为 `null` 的元数据字段）；为"可测试性"引入的抽象层；无引用构造函数/空壳实现；仅测试引用的方法
- [ ] **扫描证明**：全仓 `rg` 零引用（含 `src/test`、`scripts`、`docs`、`deploy`、`frontend/src/locales`、Grafana dashboards）；前端可执行 `cd frontend && npx fallow check dead-code`
- [ ] **三分类**：真死（零引用且非契约/反射）→ 删除并连带专属测试；假死 → 保留并在报告中记录；待定（引用本身可疑）→ 报告人工确认，不删
- [ ] **删除粒度**：先方法/字段，后类/文件；一个主题一个 commit；删除后运行 affected regression tests 全绿
       （repository-level full validation 交由 PR CI；仅当删除触及公共 contract / build / test infrastructure 时，
      才按 `.agents/AGENTS.md` 的 Full-test 例外规则跑 full，并先声明 Affected scope / Selected validation / Why）
- [ ] **安全边界（绝不能删）**：前端消费的 JSON 字段/DTO/错误码；Flyway 迁移与实体列；Spring bean 装配/Jackson 反序列化/反射引用；Prometheus/Grafana 指标名（dashboards 引用）；i18n keys（三语 locale）；文档承诺的功能；测试夹具仍需要的行为
- [ ] **品味判断**引用 `.agents/playbooks/code-smell.md`（不复制其清单）

### A5. 新增 abstraction 审查 gate（Reuse / Extend First）

> 按 `.agents/AGENTS.md` 的 Reuse / Extend First contract 执行（规则定义在 AGENTS.md；
> 本 gate 只引用并执行，不复制维护一份完整定义）。

对本次**新增**的 production class / interface / record / DTO / util / service / manager /
resolver / facade / enum / module / file：

- [ ] 是否存在可复用 / 扩展现有实现（repo-wide `rg` 证明，参考 A4 的全仓引用扫描）
- [ ] 是否制造第二个 SSOT（同一业务 switch / rule / validation contract 是否已有另一份）
- [ ] 是否只有单一调用方且无独立 domain boundary（单实现 wrapper / facade 等）
- [ ] 可以删除 / 合并时优先删除 / 合并（删优于增）

不合规的新 abstraction 定级：

- 存在等价现有实现 → **BLOCKER**
- 制造第二 SSOT → **BLOCKER**
- 纯机械 wrapper / speculative abstraction → **MAJOR**；能安全收缩则本轮直接修掉

## Layer C — Review Reconciler（汇总 / 去重 / 重定级 / blocker 判定）

### C1. 输入

- Layer A findings（plan compliance + DI + 文档 + 死代码）
- Layer B OCR findings
- tests / validation 结果
- repository evidence

### C2. Severity 体系（沿用现有语义，不另造一套）

| 级别 | 定义 | 典型来源 |
|---|---|---|
| **BLOCKER** | 必须修复才能合入：正确性 bug、安全问题、数据丢失风险、**requirement 未完成**（即使 OCR 无 finding） | Layer A + Layer B（验证后） |
| **MAJOR** | 应修复：错误处理缺口、并发隐患、API 契约破坏、测试缺口、明显性能问题 | Layer A + Layer B |
| **MINOR** | 可选：风格、可维护性建议、低风险重构 | 主要来自 OCR low / 建议 |

### C3. Reconciler 规则

- **去重 / 合并**：OCR 与主代理重复 finding 合并为一条；同一文件同一问题不重复计
- **验证**：OCR finding 必须经主代理读代码验证后才能升级为 BLOCKER（示例 2）
- **不盲目接受 OCR 严重级别**：基于项目实际影响重新定级；OCR 建议但不符合当前架构 /
  requirement 没要求 / 不影响 correctness → 拒绝或降级，**不 over-engineering**（示例 3）
- **requirement missing 优先**：Layer A 判定的 requirement 未完成 → BLOCKER，
  优先级高于 OCR 的任何 "no findings"（示例 1）

### C4. Source of Truth 顺序（冲突时按此裁决）

1. 用户当前显式 requirement
2. plan source（A0 解析结果；`docs/current-plan.md` 为仓库约定位置，
   无文件时此处即用户显式 requirements）
3. 已确认的 acceptance criteria
4. repository 当前真实 architecture / contract
5. tests 和运行结果
6. OpenCodeReview findings
7. reviewer inference

### C5. Final 输出

```
Blocker count: N
```

只有 `Blocker count: 0` 才允许 review-with-docs 判定完成（executor 以此作为开 PR 门槛）。

## 修复 → 重审（循环）

- 按 BLOCKER → MAJOR → MINOR 顺序逐项修复（MINOR 不阻塞合入，可记录为 known issues）
- 修复后重新运行受影响的测试；对修复内容重跑 Layer B（OCR 只审 diff，自动覆盖修复后的变更）
- 循环直到 `Blocker count: 0`；单轮无法闭环的阻塞项停下汇报

> **Validation 策略**：每个 finding 修复后 → 运行 affected regression tests；审查结束**不自动执行
> repository-level full test**。repository-level full validation 由 PR CI 统一执行（authoritative gate）。
> 不能因为「review-with-docs 完成」本身触发 full test；仅当删除代码 / 修改公共 contract / build 或
> test infrastructure 时，才按 `.agents/AGENTS.md` 的 Full-test 例外规则判断是否跑 full。

## OCR 失败处理（tool failure ≠ no findings）

OCR 是 code-review 引擎，不是 review 本身。区分：

- **Review finding**：代码问题（BLOCKER/MAJOR/MINOR）
- **Tool failure**：OCR executable missing / provider unavailable / timeout / invalid config /
  delegate integration error / parser failure / 输出无法解析

Tool failure 必须：

1. 清楚报告（不伪造 OCR 结果、不当作 no findings）
2. Layer A plan audit **继续执行**（不受 OCR 失败影响）
3. OCR 是本次 review 的 mandatory code-review engine 时，最终**不得假装 blocker=0**
   —— 使用主代理按 `code-quality.md` 6 项检查单 + Layer B 规则手工兜底审查 diff，
   或明确标记 `review incomplete` 并给出相应 blocker

**绝对禁止**：`OCR crash → 当作 no findings`。

## 执行模式

- **Preferred — delegate mode + DSH DeepSeek**：`ocr delegate preview/rule` 产出
  确定性审查规格（文件清单 + 规则分组 + merge_base），推理由主代理完成。
  优点：不维护第二套 LLM API 配置、不重复消耗 OCR 独立 model、继续使用 DSH 已配置 DeepSeek。
- 当前 DSH 环境（Windows + pwsh）已实测支持 delegate mode；**禁止**为了凑设计强行模拟。
- 若未来 delegate 不可用，fallback 为 `ocr review`（OCR 自己调用配置的 LLM），
  但必须优先复用现有安全 DeepSeek 配置、不 hardcode API key、不把 key 写入 skill/git、
  不打印 key、不修改 production WotBTools AI key 配置。

## 主代理文档自审指引（不 spawn）

按「文档检查清单」逐项核验，每一项给出：`文档:章节 → 确认通过或缺失内容`。
核查基线：`git diff origin/main...HEAD --stat` 与本次变更文件清单；逐项对照：

- HISTORY（仅长期演进）/ canonical 专题文档 / DEVELOPER_GUIDE / README / java/README / map-semanticizer README；
- 前端 i18n（新增列 → `frontend/src/locales/{zh,en,ru}.json` 三语）、客户端导出表头/标签（`frontend/src/replay-local/export/sheets.ts`）、API DTO 与注释；
- 代码注释 / TODO / FIXME；
- 配置依赖文档（`pom.xml` 新依赖注释 / `application.yml` 环境变量注释 / Dockerfile 注释）；
- `docs/current-plan.md`（如存在且与本次变更相关，任务状态需一致）；
- AI 死代码清理配合（对新增类/方法做全仓零引用扫描，含 `src/test`、`scripts`、`docs`、`deploy`、`frontend/src/locales`、Grafana dashboards）。

输出：

```
  VERDICT: 文档齐全 / 有遗漏（列出数量）
  EVIDENCE: 逐项列出（文档:章节 → 通过或缺失）
  GAPS: 待确认项
  NEXT: 建议补充的文档位置
```

## 报告模板

```
### Review-With-Docs 审查报告

| 项目 | code-quality | OCR (Layer B) | Plan (Layer A) | docs |
|------|-----------|--------------|----------------|------|
| 发现问题 | N | N | N | N |
| 已修复 | N | N | N | N |
| BLOCKER | N | N | N | — |
| 字段注入改造 | — | — | [扫描 N / 改造 N / 保留 N] | — |
| 文档同步 | — | — | — | [齐全 / 缺 N 项] |
| 当前状态门禁 | — | — | — | [PASS / FAIL] |
| AI 死代码清理 | — | — | [扫描 N / 删除 N / 保留 N] | — |

#### Plan compliance
| Requirement | Status | Evidence |
|---|---|---|
| ... | DONE / PARTIAL / MISSING / BLOCKED | 文件:行 |

#### Findings
### BLOCKER B1 — XXX
- Source: `plan-audit` / `open-code-review`
- File: Line:
- Evidence:
- Impact:
- Required fix:

### MAJOR M1 — ...
### MINOR m1 — ...

#### Validation（实际运行的命令，禁止声称未跑的测试通过）
- tests: `mvn -pl <module> -Dtest=<Test> test`（affected regression）→ 通过/失败；
  仅当触犯 Full-test 例外时才列 `mvn -s settings.xml test`
- frontend: `npx vitest run <related-test-files>` / `npm run build`（仅当改动涉及 build 范围）→ ...
- OCR: `ocr delegate preview/rule` → reviewable N / reviewed N / skipped N

#### DI 审计清单
1. 字段注入扫描：发现 N 处 `@Autowired private`
2. 已改造为构造器注入 / `@RequiredArgsConstructor`：N 处
3. 唯一手段保留（含 ponytail 注释）：N 处

#### 文档缺失清单
1. 对应 canonical 文档缺少 [变更描述]
2. locale/zh.json 缺少 key [xxx]
3. DEVELOPER_GUIDE 字段表缺少 [字段名]

#### Final
Blocker count: N   （0 才允许判定完成）
```

## 文档检查清单（完整）

### 1. Canonical documentation
- [ ] 变更对应的 canonical 文档（`docs/README.md` 索引指向的专题文档）是否同步
- [ ] 变更描述是否准确（不含实现细节，面向读者）
- [ ] SSOT 划分与 `.agents/AGENTS.md` 规则 3 一致：当前状态 → README / DEVELOPER_GUIDE / 专题文档 / runbook；产品与业务演进 → `HISTORY.md`；技术/架构演进 → `docs/architecture/TECHNICAL_EVOLUTION.md`；未来方向 → `docs/ROADMAP.md`
- [ ] 文档只描述合并后的当前系统状态，不是本次改动的日记（详见 A3 gate）

### 2. DEVELOPER_GUIDE
- [ ] 新增字段/API 是否更新字段表
- [ ] 解析逻辑变更是否更新回放格式说明
- [ ] 架构变动是否更新核心类表
- [ ] 构建/部署流程变更是否同步

### 3. README / java/README
- [ ] 功能增删是否同步功能列表
- [ ] 版本号/状态标识是否正确
- [ ] 新增模块是否在目录结构中体现

### 4. API 文档 / i18n
- [ ] 新增列 → `frontend/src/locales/{zh,en,ru}.json` 三语同步
- [ ] 新增列 → `frontend/src/replay-local/export/sheets.ts` 导出表头/标签同步（`PLAYER_PRESENTATION` / `SUMMARY_PRESENTATION` / `DIMENSION_TITLES`）
- [ ] API 端点变更 → 对应 DTO 和文档注释更新

### 5. 代码注释
- [ ] 新增类/方法是否有 Javadoc / JSDoc
- [ ] 复杂逻辑是否有解释性注释
- [ ] 过期注释是否已清理或更新
- [ ] TODO/FIXME 是否已处理或跟踪

### 6. 配置/依赖文档
- [ ] `pom.xml` 新增依赖是否有注释说明用途
- [ ] 环境变量变更是否同步到 `application.yml` 注释
- [ ] Docker 构建变更是否同步到相关 Dockerfile 注释

### 7. plan source（计划文件同步，按 A0 发现）
> `docs/current-plan.md` 是临时任务状态，不是当前系统契约；canonical 文档/源码/配置不得引用它作为架构或行为权威。

- [ ] plan source（A0 解析结果，仓库约定 `docs/current-plan.md`）中是否有与本变更相关的进行中任务；有则任务状态是否与实际一致（IN PROGRESS → COMPLETED / BLOCKED）
- [ ] 计划的业务目标/范围/验收标准是否与本次变更一致（designer 产出的确认单与方案单已落入计划文件；无计划文件时以用户显式 requirements 为准）

### 8. HISTORY.md / TECHNICAL_EVOLUTION.md（长期历史）
> 判据见 `.agents/AGENTS.md` 规则 3；站点 History 页（`?view=history`）在构建期以 `?raw` 读取 `HISTORY.md`。

- [ ] 产品/业务决策与用户能力演进写入 `HISTORY.md`；架构、数据流、authority、拓扑、身份模型与已退役技术方案写入 `docs/architecture/TECHNICAL_EVOLUTION.md`
- [ ] 只记录具有长期产品/业务或技术演进意义的变化；纯版本号、逐提交细节、实现过程、review 轮次**不写**
- [ ] 追加到对应时间线的正确位置，不重写既有历史结论
- [ ] 面向读者表述：不含 PR 号 / commit hash / 内部实现模块名
- [ ] 措辞变动不引入与 README / DEVELOPER_GUIDE / ROADMAP 冲突的现状描述
- [ ] 同一事实不同时写入两份历史：产品理由进 HISTORY，技术理由进 TECHNICAL_EVOLUTION
