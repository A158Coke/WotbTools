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
2. **AI 死代码清理** — 按下方方案 8 检查并安全删除 AI 提前性/投机死代码
3. **文档自检** — 按下方检查清单逐项检查文档同步
4. **spawn docs verifier** — `type: verifier`，审查文档是否与代码一致
5. **修复** → **重审** → 循环直到零问题
6. **出具报告** — 包含 review-fix 报告 + AI 死代码清理报告 + 文档审查报告

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

### 8. AI 死代码 / 提前性代码清理
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
STOP_CONDITION: 完成全部 8 项检查（7 项文档 + AI 死代码清理），报告缺失项
OUTPUT:
  VERDICT: 文档齐全 / 有遗漏（列出数量）
  EVIDENCE: 逐项列出（文档:章节 → 缺失内容）
  GAPS: 待确认项
  NEXT: 建议补充的文档位置
```

## 报告模板

```
### Review-With-Docs 审查报告

| 项目 | review-fix | docs |
|------|-----------|------|
| 发现问题 | N | N |
| 已修复 | N | N |
| 文档同步 | — | [齐全 / 缺 N 项] |
| AI 死代码清理 | — | [扫描 N / 删除 N / 保留 N（假死）] |

#### 文档缺失清单
1. CHANGELOG 缺少 [变更描述]
2. locale/zh.json 缺少 key [xxx]
3. DEVELOPER_GUIDE 字段表缺少 [字段名]
```