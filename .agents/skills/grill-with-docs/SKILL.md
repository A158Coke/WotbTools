---
name: grill-with-docs
description: >
  代码变更后审查代码质量 + 文档同步。在 grill-fix 基础上增加文档检查：
  CHANGELOG / DEVELOPER_GUIDE / README / API 文档 / i18n / 代码注释。
  Trigger: 任何影响界面/导出/数据/构建/API/配置的代码变更完成后。
---

# grill-with-docs

> **前置条件**：grill-fix 6 项代码审查已完成。
> **扩展**：本文档同步检查是 grill-fix 的补充层，聚焦"改了什么文档就跟什么"。

## 流程

1. **完成 grill-fix** — 先走 `.agents/skills/grill-fix/SKILL.md` 的 6 项代码审查
2. **文档自查** — 按下方检查单逐项检查文档同步
3. **spawn docs verifier** — `type: verifier`，审查文档是否与代码一致
4. **修复** → **重审** → 循环直到零问题
5. **出具报告** — 包含 grill-fix 报告 + 文档审查报告

## 文档检查单

### 1. CHANGELOG
- [ ] 是否记录了本次变更（Added / Changed / Fixed / Removed）
- [ ] 变更描述是否准确（不含实现细节，面向用户）
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

## 文档 verifier brief 模板

```
QUESTION: 审查以下代码变更对应的文档是否全部同步
SCOPE: [变更文件列表 + 对应文档路径]
ALREADY_KNOWN: [已自查并更新的文档]
EFFORT: medium
STOP_CONDITION: 完成全部 6 项文档检查，报告缺失项
OUTPUT:
  VERDICT: 文档齐全 / 有遗漏（列出数量）
  EVIDENCE: 逐项列出（文档:章节 → 缺失内容）
  GAPS: 待确认项
  NEXT: 建议补充的文档位置
```

## 报告模板

```
### Grill-With-Docs 审查报告

| 项目 | grill-fix | docs |
|------|-----------|------|
| 发现问题 | N | N |
| 已修复 | N | N |
| 文档同步 | — | [齐全 / 缺 N 项] |

#### 文档缺失清单
1. CHANGELOG 缺少 [变更描述]
2. locale/zh.json 缺少 key [xxx]
3. DEVELOPER_GUIDE 字段表缺少 [字段名]
```
