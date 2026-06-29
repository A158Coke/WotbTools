---
name: column-sync
description: >
  新增/重命名/删除数据列时的跨层同步检查单。比 wotb-sync 更聚焦于列定义同步。
  Trigger: 新增列、删除列、重命名列、改列 key。
---

# column-sync

> 本技能聚焦**列同步**。改动涉及 protobuf/Flyway/Keycloak 时请同时走 `wotb-sync`。

## 检查单（按顺序执行）

### 1. Java core — 列定义
- [ ] `Columns.java` — 新增 `Column` 记录，确认 `key`(snake_case)、`type`、`group`
- [ ] `PlayerResult.java` — 确认字段存在、类型正确
- [ ] `ReplayParser.java` — 确认解析/填充逻辑
- [ ] `Players.java` / `Aggregator.java` — 如有汇总版本确认

### 2. Web 层 — DTO
- [ ] `Mapper.java` — `toDto()` / `aggregateColumns()` 字段对齐
- [ ] 相关 Controller — 返回 DTO 确认包含新列

### 3. 导出层 — Excel 表头
- [ ] `SingleBattleSheets.java` — 单场 xlsx 表头
- [ ] `AggregateSheets.java` — 汇总 xlsx 表头（如有汇总版本）

### 4. 前端 i18n — 三语同步
- [ ] `frontend/src/locales/zh.json` → `player_labels` / `agg_labels` 新增 key
- [ ] `frontend/src/locales/en.json` → 同上
- [ ] `frontend/src/locales/ru.json` → 同上

### 5. 前端映射
- [ ] `useColumns.js` — `DEFAULT_VISIBLE` / `EXTENDED_ONLY_PLAYER_KEYS` 是否需调整
- [ ] `helpers.js` — `COL_GROUP_CAT` 分类是否需新增

### 6. 测试
- [ ] `ParityTest.java` — 字段存在性/类型验证
- [ ] `WebApiTest.java` — `/api/columns` 响应验证
- [ ] 跑 `mvn -s settings.xml test`（JAVA_HOME→JDK21）
- [ ] 改前端则 `npm run build`

### 7. 文档
- [ ] `DEVELOPER_GUIDE.md` — 字段表/回放格式表更新
- [ ] `docs/replay-data.md` — 如有 protobuf 字段号变更
- [ ] `CHANGELOG.md` — 记录列变更

## 子 agent 分工建议

列同步是跨层工作，建议按层拆分子 agent：

| 子 agent | type | 负责 |
|----------|------|------|
| core-sync | implementer | 步骤 1-3（Java core + Web DTO + 导出） |
| ui-sync | implementer | 步骤 4-5（前端 i18n + 映射） |
| verify-sync | verifier | 步骤 6-7（测试 + 文档），最后 grill-fix |
