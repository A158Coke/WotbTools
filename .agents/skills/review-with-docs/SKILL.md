---
name: review-with-docs
description: >
  代码变更后审查代码质量 + 文档同步 + AI 死代码清理。在 review-fix 基础上增加文档检查：
  CHANGELOG / DEVELOPER_GUIDE / README / API 文档 / i18n / 代码注释 / current-plan；并清理
  AI 生成的提前性/投机死代码（单实现抽象、从不覆盖的字段/参数、占位空壳等）。
  Trigger: 任何影响界面/导出/数据/构建/API/配置的代码变更完成后；或需要清理
  AI 生成代码中的死代码/过度设计时。
---

# review-with-docs

> **前置条件**：review-fix 6 项代码审查已完成。
> **扩展**：本文档同步检查是 review-fix 的补充层，聚焦"改了什么文档就跟什么"；
> 同时负责清理 AI 生成代码中的提前性/投机死代码。

## 流程

1. **完成 review-fix** — 先走 `.agents/skills/review-fix/SKILL.md` 的 6 项代码审查
2. **DI 注入审计** — 按下方 DI 注入检查单审计 Spring 注入方式，违规改造
3. **AI 死代码清理** — 按下方方案检查并安全删除 AI 提前性/投机死代码
4. **文档自检** — 按下方检查清单逐项检查文档同步
5. **spawn docs verifier** — `type: verifier`，审查文档是否与代码一致
6. **修复** → **重审** → 循环直到零问题
7. **出具报告** — 包含 review-fix 报告 + DI 注入审计报告 + AI 死代码清理报告 + 文档审查报告

## DI 注入检查单（Spring）

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

## 文档检查清单

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

### 7. current-plan（计划文件同步）
- [ ] `docs/current-plan.md` 中是否有与本变更相关的进行中任务；有则任务状态是否与实际一致（IN PROGRESS → COMPLETED / BLOCKED）
- [ ] 计划的业务目标/范围/验收标准是否与本次变更一致（grill-me / grill-with-docs 产出的确认单与方案单已落入计划文件）

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

### 9. AI 死代码 / 提前性代码清理
> 定位：review-fix 管"对不对"，code-smell 管"好不好的品味"，本节负责**执行清理**——
> 针对 AI 生成代码常见的"为未来准备却没换来灵活性"的提前性死代码。

- [ ] **识别模式**：单实现接口/工厂/策略/观察者；从不覆盖的字段与参数（含恒为 `null` 的元数据字段）；为"可测试性"引入的抽象层；无引用构造函数/空壳实现；仅测试引用的方法
- [ ] **扫描证明**：全仓 `rg` 零引用（含 `src/test`、`scripts`、`docs`、`deploy`、`frontend/src/locales`、Grafana dashboards）；前端可执行 `cd frontend && npx fallow check dead-code`
- [ ] **三分类**：真死（零引用且非契约/反射）→ 删除并连带专属测试；假死 → 保留并在报告中记录；待定（引用本身可疑）→ 报告人工确认，不删
- [ ] **删除粒度**：先方法/字段，后类/文件；一个主题一个 commit；删除后 `mvn -s settings.xml test` + `npm test` + `npm run build` 全绿
- [ ] **安全边界（绝不能删）**：前端消费的 JSON 字段/DTO/错误码；Flyway 迁移与实体列；Spring bean 装配/Jackson 反序列化/反射引用；Prometheus/Grafana 指标名（dashboards 引用）；i18n keys（三语 locale）；文档承诺的功能；测试夹具仍需要的行为
- [ ] **品味判断**引用 `.agents/skills/code-smell/SKILL.md`（不复制其清单）

## 文档 verifier brief 模板

```
QUESTION: 审查以下代码变更对应的文档是否全部同步
SCOPE: [变更文件列表 + 对应文档路径]
ALREADY_KNOWN: [已自审并更新的文档]
EFFORT: medium
STOP_CONDITION: 完成全部 10 项检查（DI 注入审计 + 8 项文档 + AI 死代码清理），报告缺失项
OUTPUT:
  VERDICT: 文档齐全 / 有遗漏（列出数量）
  EVIDENCE: 逐项列出（文档:章节 → 缺失内容）
  GAPS: 待确认项
  NEXT: 建议补充的文档位置
```

## 报告模板

```
### Review-With-Docs 审查报告

| 项目 | review-fix | DI 审计 | docs |
|------|-----------|--------|------|
| 发现问题 | N | N | N |
| 已修复 | N | N | N |
| 字段注入改造 | — | [扫描 N / 改造 N / 保留 N（唯一手段）] | — |
| 文档同步 | — | — | [齐全 / 缺 N 项] |
| AI 死代码清理 | — | — | [扫描 N / 删除 N / 保留 N（假死）] |

#### DI 审计清单
1. 字段注入扫描：发现 N 处 `@Autowired private`
2. 已改造为构造器注入 / `@RequiredArgsConstructor`：N 处
3. 唯一手段保留（含 ponytail 注释）：N 处

#### 文档缺失清单
1. CHANGELOG 缺少 [变更描述]
2. locale/zh.json 缺少 key [xxx]
3. DEVELOPER_GUIDE 字段表缺少 [字段名]
```
