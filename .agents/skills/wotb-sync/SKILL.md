---
name: wotb-sync
description: 在本仓库(WoT Blitz 回放提取)做改动时使用——尤其是增删/改名数据列、改解析或导出、改前端交互。强制按检查单跨层同步(API 纯英文 key、前端两套中文映射、导出两处)、跑测试、更新文档。
---

# wotb-sync

本技能是项目改动检查单的 **Codex 薄封装**。真正的内容是工具无关的:

**请打开并严格遵循 [`.agents/wotb-sync.md`](../../../.agents/wotb-sync.md)**(从仓库根算 `.agents/wotb-sync.md`)。

要点速记(详情以那份为准):

- **API 纯英文**:`/api/columns`、DTO 只回 `key` + 数据,不放中文。
- **改列中文名 = 全改**:前端 `App.vue` 的 `PLAYER_LABELS`/`AGG_LABELS` + 导出两处(`Columns.java`、`ExcelExporter` 汇总)。
- **列 `key` 三方一致**:API / 前端 / 导出。
- **改完必跑**:`mvn -s settings.xml test`(JDK21)、改前端则 `npm run build`。
- **收尾**:更新 `DEVELOPER_GUIDE.md` 与相关 README;提交结尾带 `Co-Authored-By`;推送用 SSH `github-personal`(账号 A158Coke,不用公司 token)。

> 其它 AI 工具不读本文件,直接用 `.agents/wotb-sync.md` 与根目录 `AGENTS.md` 即可。
