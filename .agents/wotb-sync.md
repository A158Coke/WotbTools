# wotb-sync — 改动检查单 (工具无关)

> 本文件是**工具无关**的改动 playbook,供任意 AI coder / 人类贡献者使用。
> Claude Code 用户可通过技能 `.claude/skills/wotb-sync/` 调用它;其它工具直接读本文件即可。
> 背景与数据格式见 [../DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md),硬性约定见 [../AGENTS.md](../AGENTS.md)。

本项目同一份数据要经过**多层多语言**呈现,所以一处改动常需多处同步。下面按"改什么"给出最小步骤。

---

## 黄金法则

- **API 纯英文**:`/api/columns`、DTO 只回 `key`(snake_case) + 数据,绝不放中文。
- **中文显示名分散在两类出口**,改名要全改:
  - 前端:`java/frontend/src/App.vue` 的 `PLAYER_LABELS`(单场)与 `AGG_LABELS`(汇总)。
  - 导出:`java/wotb-core/.../Columns.java`(单场 xlsx)、`java/wotb-core/.../ExcelExporter.java`(汇总 xlsx)、`python-legacy/wotb_extractor.py`(`STAT_COLUMNS` + `export_aggregate_xlsx`)。
- **列 `key` 三方一致**:API / 前端 / 导出。
- **改完必过测试 + 更新文档**(见末尾)。

---

## 配方 A:给某列改中文显示名(不动数据)

`key` 不变,只改中文。**改这几处,保持一致**:

1. `App.vue` → `PLAYER_LABELS` 和/或 `AGG_LABELS` 中该 `key` 的值。
2. `Columns.java`(若是单场列)对应 `Col(...)` 的 title。
3. `ExcelExporter.java` 的汇总 `AggCol(...)`(若是汇总列)。
4. `python-legacy/wotb_extractor.py` 的 `STAT_COLUMNS`(单场)/ `export_aggregate_xlsx` 的 `agg_cols`(汇总)。
5. 验证 + 文档。

> 命名约定:辅助伤害=「协助伤害」、承受伤害=「损失血量」、抵挡伤害=「格挡」、击伤敌数=「击伤」;汇总「总X / 场均X」。

## 配方 B:新增一个玩家/汇总数据列

1. **解析**:`wotb-core/.../ReplayParser.java` 读出字段写入 `PlayerResult`(单场列在 `RESULT_UINT_FIELDS`/对应解析;汇总指标在 `Aggregator.java` 累计)。
2. **列定义/取值**:
   - 单场:`Columns.java` 加一条 `Col(title, key, xlsxW, pxW, num, getter)`。
   - 汇总:`Mapper.AGG_COLS`(key+num+getter) 和 `ExcelExporter` 的汇总 `AggCol`(title+宽+num+getter) 各加一条;指标计算在 `Aggregator.Agg`。
3. **API 暴露**:`/api/columns` 自动包含(来自 Columns/AGG_COLS 的 key)。
4. **前端**:`App.vue` 的 `PLAYER_LABELS`/`AGG_LABELS` 补该 key 的中文;如要默认显示,改 `DEFAULT_VISIBLE`。
5. **Python**(若历史版也要):`RESULT_UINT_FIELDS` / `STAT_COLUMNS` / `aggregate_players` / `export_aggregate_xlsx`。
6. 验证 + 文档(含 DEVELOPER_GUIDE 字段表)。

## 配方 C:改解析逻辑(字段含义/protobuf 字段号)

1. `ReplayParser.java`(及 `Protobuf`/`PickleReader` 如涉及格式)。
2. 同步 Python `wotb_extractor.py` 的对应解析(若需保持历史版一致)。
3. 更新 `ParityTest` 与 `test_wotb.py` 的断言/期望值。
4. 验证 + 更新 DEVELOPER_GUIDE 的字段表。

## 配方 D:纯前端交互/样式

只动 `App.vue`(+ 必要时 `online/nginx.conf`)。不碰后端/导出。改完 `npm run build`,并在文档记一句。

## 配方 F:调评分(权重/系数/阈值)

只改 `common/rating.json`(权重 assist/block/killValue/winBonus、minSamples、scale、车型系数 classFactor)。Java 经 classpath、Python 经 `../common` 共用同一份,**改它即生效不必改代码**。改完跑测试(均值应仍 ≈ scale)、重建 exe/镜像。改公式结构(而非数值)才需动 `Rating.java` + Python `compute_ratings` 两处。

## 配方 E:更新车辆库

`cd python && python update_tankopedia.py`(写 `common/tankopedia.json`,需联网)→ 跑测试 → 重建 exe/镜像。Java 构建会自动把 `common/tankopedia.json` 复制到 classpath,无需手动同步。

---

## 验证(改完必跑)

```bash
cd java && JAVA_HOME=<jdk21> mvn -s settings.xml test     # ParityTest + WebApiTest
cd python-legacy && python test_wotb.py                    # 26 项 (历史版)
cd java/frontend && npm run build                         # 改了前端时
```

> 默认 `java` 是 JDK 8,跑 mvn 必须先把 `JAVA_HOME` 指向 JDK 21。本环境/沙箱可能无法真正监听端口,用 MockMvc 测试(`WebApiTest`)即可,不必起服务。

## 收尾

1. **更新文档**:`DEVELOPER_GUIDE.md` + 相关 `README.md` / `java/README.md`(任何影响界面/导出/数据/构建/用法的改动)。
2. 提交:中文信息,结尾 `Co-Authored-By`。
3. 推送:个人仓库,SSH remote `github-personal`(账号 `A158Coke`),不使用公司 token。
