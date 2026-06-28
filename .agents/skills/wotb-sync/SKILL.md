---
name: wotb-sync
description: >
  改回放解析、数据列、前端交互、排行榜 schema、auth、i18n 时使用。
  跨层同步检查单：API key → locale JSON → 导出 Java → 测试 → 文档。
  Trigger: 新增列、改 protobuf、改表结构、改 i18n、改 Flyway、改 Keycloak。
---

# wotb-sync

本技能是项目改动检查单的 **OpenCode 薄封装**。真正内容是工具无关的：

**请打开并严格遵循 [`.agents/wotb-sync.md`](../../wotb-sync.md)**。

要点速记（详情以那份为准）：

- **API 纯英文**：`/api/columns`、DTO 只回 `key`(snake_case) + 数据，不放中文。
- **改列显示名 = 全改**：`frontend/src/locales/{zh,en,ru}.json` 的 `player_labels`/`agg_labels` 三语同步 + 导出 `Columns.java`/`AggregateSheets.java`。
- **列 `key` 三方一致**：API / 前端 / 导出。
- **改表结构**：新增 Flyway migration（V3+），不改已应用的 V1/V2；Entity、DTO、column 与迁移逐列对齐。
- **改完必跑**：`mvn -s settings.xml test`(JAVA_HOME→JDK21)、改前端则 `npm run build`。
- **收尾**：更新 `DEVELOPER_GUIDE.md` 与相关 README；中文提交尾带 `Co-Authored-By`；推送 SSH `github-personal`。
