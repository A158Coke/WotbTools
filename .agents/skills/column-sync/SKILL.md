---
name: column-sync
description: >
  新增/重命名/删除数据列时的跨层同步检查单。比 wotb-sync 更聚焦于列定义同步。
  Trigger: 新增列、删除列、重命名列、改列 key。
---

# column-sync

> 本技能聚焦**列同步**。改动涉及上游 WASM pin、Flyway/Keycloak、auth 时请同时走 `wotb-sync`。
>
> **前提**：服务器没有回放解析器。列定义、取值、汇总、导出、评分全在浏览器端
> `frontend/src/replay-local/`；服务端只有 domain（`java/wotb-core`）与业务 API（`java/wotb-web`）。

## 检查单（按顺序执行）

### 1. 列定义与取值（canonical）
- [ ] `frontend/src/replay-local/compute/columns.ts` — 单场列加进 `PLAYER_COLUMNS`、汇总列加进
      `AGGREGATE_CORE_COLUMNS`（联赛维度加进 `compute/league-rating.ts` 的 `LEAGUE_DIM_KEYS`）；
      每条 `{ key(snake_case), num, get }`，数组顺序即展示顺序
- [ ] `frontend/src/replay-local/compute/model.ts` — 输入事实字段形状（`PlayerResult` / `Battle`）
- [ ] `frontend/src/replay-local/compute/performance.ts` — 汇总累计与派生指标（`Agg`、`aggAvg` /
      `aggHitRate` / `aggVehicleUsage`、`computePerformance`、`PerformanceRow`）
- [ ] 解析来源是上游 Rust Core WASM：单场事实字段来自
      `frontend/src/replay-local/canonical/facts.ts` 与 `frontend/src/replay-local/battleFacts.ts`；
      改字段语义要走上游发版 + `deploy/agent/source.json` pin 升级（见 `wotb-sync` 配方 C）

### 2. 导出层 — 表头与标签
- [ ] `frontend/src/replay-local/export/sheets.ts` — `PLAYER_PRESENTATION`（单场）/ `SUMMARY_PRESENTATION`
      （汇总）/ `DIMENSION_TITLES`（联赛七维）各加一条（表头 + Excel 列宽）；漏加会在模块加载期
      fail fast（`player column presentation missing: <key>`）
- [ ] `frontend/src/replay-local/export/spec.ts` — 样式/写入原语（仅新样式时需要）
- [ ] `frontend/src/replay-local/export/format.ts` — 值格式化（时长、比例、地图中文名等）

### 3. 前端 i18n — 三语同步
- [ ] `frontend/src/locales/zh.json` → `player_labels` / `agg_labels` 新增 key
- [ ] `frontend/src/locales/en.json` → 同上
- [ ] `frontend/src/locales/ru.json` → 同上

### 4. 前端映射与可见集
- [ ] `frontend/src/utils/helpers.js` — `DEFAULT_VISIBLE` / `AGG_DEFAULT_VISIBLE` /
      `EXTENDED_ONLY_PLAYER_KEYS` / `COL_GROUP_CAT`（列分组）是否需调整
- [ ] `frontend/src/composables/useColumns.js` — 消费上述可见集/顺序；改语义时确认 localStorage
      迁移逻辑仍成立

### 5. 测试
- [ ] `frontend/src/replay-local/compute/compute.golden.test.ts` / `java.test.ts` — 列值/汇总断言
- [ ] `frontend/src/replay-local/export/export.golden.test.ts` / `roundtrip.test.ts` — 表头/导出回归
- [ ] 跑 `npx vitest run src/replay-local src/utils src/composables`（改前端）
- [ ] **只有真的改了 `java/`** 才跑 `cd java && JAVA_HOME=<JDK 25> mvn -pl wotb-web -am -Dtest=WebApiTest test`
- [ ] golden 基线更新流程：`frontend/src/replay-local/__golden__/README.md`

### 6. 文档
- [ ] `docs/DEVELOPER_GUIDE.md` — 字段表/回放格式表更新
- [ ] `docs/reference/replay-data.md` — 客户端列/汇总口径变更
- [ ] `HISTORY.md` — 仅当列变更是长期数据模型演进时记录，不作为逐列变更日志（判据见 `.agents/AGENTS.md` 规则 3）

## 子 agent 分工建议

列同步现在基本是**前端单层**工作，默认不拆子 agent。文件多（如跨 `compute/` + `export/` + 三语 locale
+ golden）时可拆两个：

| 子 agent | type | 负责 |
|----------|------|------|
| compute-export-sync | implementer | 步骤 1-2（列定义 + 导出表头/标签） |
| ui-doc-sync | implementer | 步骤 3-6（三语 i18n + 映射可见集 + 测试 + 文档），最后 review-fix |
