---
name: review-with-docs
description: >
  代码变更后审查代码质量 + 文档同步 + AI 死代码清理。在 review-fix 基础上增加文档检查：
  CHANGELOG / DEVELOPER_GUIDE / README / API 文档 / i18n / 代码注释 / current-plan；并清理
  AI 生成的提前性/投机死代码（单实现抽象、从不覆盖的字段/参数、占位空壳等）。
  Trigger: 任何影响界面/导出/数据/构建/API/配置的代码变更完成后；或需要清理
  AI 生成代码中的死代码/过度设计时。
  Code-review engine: 内置 Alibaba OpenCodeReview（OCR）delegate mode 作为通用
  diff/code review 引擎（确定性文件筛选 + 规则解析，推理由主代理 DeepSeek 完成）。
---

# review-with-docs

> **前置条件**：review-fix 6 项代码审查已完成。
> **架构**：三层审查引擎 ——
>   Layer A: Requirement/Plan Auditor（主代理自审，不可交给 diff reviewer）
>   Layer B: OpenCodeReview Code Auditor（OCR delegate mode，通用 diff/code review）
>   Layer C: Review Reconciler（主代理汇总、去重、重定级、判定 blocker）
> **扩展**：本文档同步检查是 review-fix 的补充层，聚焦"改了什么文档就跟什么"；
> 同时负责清理 AI 生成代码中的提前性/投机死代码。

## 流程（全程主代理，禁止 spawn 子代理）

> 硬约束：本技能全程由主代理自审执行，**不 spawn verifier 子代理**；
> OCR 是外部确定性 CLI（delegate mode 不调用 OCR 侧 LLM，推理由主代理完成），
> 属于主代理直接驱动的工具链，不是子代理。

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
Task: Battle replay detail panel improvements.
Critical invariants:
- Detail panel represents current replay state, not final battle results.
- Tankopedia HP is base HP only; actual HP comes from replay parsing.
- Do not infer consumable/equipment HP bonus source.
- Selected marker must remain visible while map is zoomed.
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

### A3. 文档检查清单

> 与现有 review-with-docs 文档检查完全一致（CHANGELOG / DEVELOPER_GUIDE / README /
> API 文档 / i18n / 代码注释 / 配置依赖 / current-plan / versions.json / AI 死代码清理），
> 逐项见文末「文档检查清单（完整）」。

### A4. AI 死代码 / 提前性代码清理

> 定位：review-fix 管"对不对"，code-smell 管"好不好的品味"，本节负责**执行清理**——
> 针对 AI 生成代码常见的"为未来准备却没换来灵活性"的提前性死代码。

- [ ] **识别模式**：单实现接口/工厂/策略/观察者；从不覆盖的字段与参数（含恒为 `null` 的元数据字段）；为"可测试性"引入的抽象层；无引用构造函数/空壳实现；仅测试引用的方法
- [ ] **扫描证明**：全仓 `rg` 零引用（含 `src/test`、`scripts`、`docs`、`deploy`、`frontend/src/locales`、Grafana dashboards）；前端可执行 `cd frontend && npx fallow check dead-code`
- [ ] **三分类**：真死（零引用且非契约/反射）→ 删除并连带专属测试；假死 → 保留并在报告中记录；待定（引用本身可疑）→ 报告人工确认，不删
- [ ] **删除粒度**：先方法/字段，后类/文件；一个主题一个 commit；删除后 `mvn -s settings.xml test` + `npm test` + `npm run build` 全绿
- [ ] **安全边界（绝不能删）**：前端消费的 JSON 字段/DTO/错误码；Flyway 迁移与实体列；Spring bean 装配/Jackson 反序列化/反射引用；Prometheus/Grafana 指标名（dashboards 引用）；i18n keys（三语 locale）；文档承诺的功能；测试夹具仍需要的行为
- [ ] **品味判断**引用 `.agents/skills/code-smell/SKILL.md`（不复制其清单）

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

只有 `Blocker count: 0` 才允许 review-with-docs 判定完成（plan-executer 以此作为开 PR 门槛）。

## 修复 → 重审（循环）

- 按 BLOCKER → MAJOR → MINOR 顺序逐项修复（MINOR 不阻塞合入，可记录为 known issues）
- 修复后重新运行受影响的测试；对修复内容重跑 Layer B（OCR 只审 diff，自动覆盖修复后的变更）
- 循环直到 `Blocker count: 0`；单轮无法闭环的阻塞项停下汇报

## OCR 失败处理（tool failure ≠ no findings）

OCR 是 code-review 引擎，不是 review 本身。区分：

- **Review finding**：代码问题（BLOCKER/MAJOR/MINOR）
- **Tool failure**：OCR executable missing / provider unavailable / timeout / invalid config /
  delegate integration error / parser failure / 输出无法解析

Tool failure 必须：

1. 清楚报告（不伪造 OCR 结果、不当作 no findings）
2. Layer A plan audit **继续执行**（不受 OCR 失败影响）
3. OCR 是本次 review 的 mandatory code-review engine 时，最终**不得假装 blocker=0**
   —— 使用主代理按 review-fix 6 项检查单 + Layer B 规则手工兜底审查 diff，
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

- CHANGELOG / CHANGELOG-PRODUCT / DEVELOPER_GUIDE / README / java/README / map-semanticizer README；
- 前端 i18n（新增列 → `frontend/src/locales/{zh,en,ru}.json` 三语）、导出列（`Columns.java` / `AggregateSheets.java`）、API DTO 与注释；
- 代码注释 / TODO / FIXME；
- 配置依赖文档（`pom.xml` 新依赖注释 / `application.yml` 环境变量注释 / Dockerfile 注释）；
- `docs/current-plan.md`（如存在且与本次变更相关，任务状态需一致）；
- `frontend/src/data/versions.json`（仅用户可见变更新增条目：版本号/日期/tag/三语/顶部追加/与 CHANGELOG-PRODUCT 一致）；
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

| 项目 | review-fix | OCR (Layer B) | Plan (Layer A) | docs |
|------|-----------|--------------|----------------|------|
| 发现问题 | N | N | N | N |
| 已修复 | N | N | N | N |
| BLOCKER | N | N | N | — |
| 字段注入改造 | — | — | [扫描 N / 改造 N / 保留 N] | — |
| 文档同步 | — | — | — | [齐全 / 缺 N 项] |
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
- tests: `mvn -s settings.xml test` → 通过/失败
- frontend: `npm test` / `npm run build` → ...
- OCR: `ocr delegate preview/rule` → reviewable N / reviewed N / skipped N

#### DI 审计清单
1. 字段注入扫描：发现 N 处 `@Autowired private`
2. 已改造为构造器注入 / `@RequiredArgsConstructor`：N 处
3. 唯一手段保留（含 ponytail 注释）：N 处

#### 文档缺失清单
1. CHANGELOG 缺少 [变更描述]
2. locale/zh.json 缺少 key [xxx]
3. DEVELOPER_GUIDE 字段表缺少 [字段名]

#### Final
Blocker count: N   （0 才允许判定完成）
```

## 文档检查清单（完整）

### 1. CHANGELOG
- [ ] 是否记录了本次变更（Added / Changed / Fixed / Removed）
- [ ] 变更描述是否准确（不含实现细节，面向读者）
- [ ] 是否在 `[Unreleased]` 下（未发布版本）

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
- [ ] 新增列 → `Columns.java` / `AggregateSheets.java` 导出标签同步
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
- [ ] plan source（A0 解析结果，仓库约定 `docs/current-plan.md`）中是否有与本变更相关的进行中任务；有则任务状态是否与实际一致（IN PROGRESS → COMPLETED / BLOCKED）
- [ ] 计划的业务目标/范围/验收标准是否与本次变更一致（grill-me / plan-designer 产出的确认单与方案单已落入计划文件；无计划文件时以用户显式 requirements 为准）

### 8. frontend 版本历史 (`frontend/src/data/versions.json`)
> 面向用户的版本历史卡片（首页入口读取）。**仅用户可见变更需新增条目**；纯技术/构建/CI/重构变更不写。

- [ ] 触发条件：本变更对用户端可见（新功能 / 改交互 / 修 bug / 改文案 / 改样式）才新增条目
- [ ] `v`：语义化版本递增（major / minor / patch），绝不跳号、不复用历史号
- [ ] `date`：`YYYY-MM-DD`，落地当天日期，不早于代码改动日
- [ ] `tag`：`add`（新功能）/ `chg`（改交互）/ `fix`（修 bug）/ `del`（删功能）
- [ ] `zh` / `en` / `ru` 三语必同条目同步，含义一致；按各 locale 风格表述，不互相硬译；EN/RU 文案不得出现中文标点或分区中文标签
- [ ] 文案面向用户：不含技术细节、不含 PR 号 / commit hash / 内部模块名
- [ ] 新条目追加到数组**顶部**（最新在前），禁止修改历史条目
- [ ] 同一发版若跨多个变更，合并为一条而非多条（条目 ≠ commit 数；多条逐步追加将造成版本号爆炸）
- [ ] 与产品侧 `CHANGELOG-PRODUCT.md` 描述一致；与技术侧 `CHANGELOG.md` 互补，发版号吻合（同一发版日期 + 同一版本号语义）