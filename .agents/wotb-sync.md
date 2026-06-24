# wotb-sync — 改动检查单 (工具无关)

> 本文件是**工具无关**的改动 playbook,供任意 AI coder / 人类贡献者使用。
> Claude Code 用户可通过技能 `.claude/skills/wotb-sync/` 调用它;其它工具直接读本文件即可。
> 背景与数据格式见 [../DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md),硬性约定见 [../AGENTS.md](../AGENTS.md)。

本项目同一份数据要经过**多层多语言**呈现,所以一处改动常需多处同步。下面按"改什么"给出最小步骤。

---

## 黄金法则

- **API 纯英文**:`/api/columns`、DTO 只回 `key`(snake_case) + 数据,绝不放中文。
- **显示名分散在两类出口**,改名要全改:
  - 前端(三语 i18n):`java/frontend/src/locales/{zh,en,ru}.json` 的 `player_labels`(单场)与 `agg_labels`(汇总),**三语都改**。
  - 导出:`java/wotb-core/.../Columns.java`(单场 xlsx)、`java/wotb-core/.../AggregateSheets.java`(汇总 xlsx,仅中文)。
- **列 `key` 三方一致**:API / 前端 / 导出。
- **Web 分层**:`ReplayController` 只做 HTTP 映射;业务编排在 `service/ReplayService`(解析/评分/映射/导出),桌面关机在 `service/DesktopLifecycle`。新增 endpoint 的业务逻辑写进 service,controller 只接参数、拼 `ResponseEntity`。
- **改完必过测试 + 更新文档**(见末尾)。

---

## 配方 A:给某列改显示名(不动数据)

`key` 不变,只改显示文案。**改这几处,保持一致**:

1. `locales/{zh,en,ru}.json` → `player_labels` 和/或 `agg_labels` 中该 `key` 的值(**三语都改**;导出仍中文)。
2. `Columns.java`(若是单场列)对应 `Column(...)` 的 title。
3. `AggregateSheets.java` 的汇总 `AggregateColumn(...)`(若是汇总列;单场表结构在 `SingleBattleSheets.java`)。
4. 验证 + 文档。

> 命名约定:辅助伤害=「协助伤害」、承受伤害=「损失血量」、抵挡伤害=「格挡」、击伤敌数=「击伤」;汇总「总X / 场均X」。

## 配方 B:新增一个玩家/汇总数据列

1. **解析**:`wotb-core/.../ReplayParser.java` 读出字段写入 `PlayerResult`(单场列在 `RESULT_UINT_FIELDS`/对应解析;汇总指标在 `Aggregator.java` 累计)。
2. **列定义/取值**:
   - 单场:`Columns.java` 加一条 `Column(title, key, xlsxW, pxW, num, getter)`。
   - 汇总:`Mapper.AGG_COLS`(key+num+getter) 和 `AggregateSheets` 的汇总 `AggregateColumn`(title+宽+num+getter) 各加一条;指标计算在 `model.Agg`(由 `Aggregator` 聚合产生)。
3. **API 暴露**:`/api/columns` 自动包含(来自 Columns/AGG_COLS 的 key)。
5. **前端**:`locales/{zh,en,ru}.json` 的 `player_labels`/`agg_labels` 补该 key 的三语文案;如要默认显示,改 `App.vue` 的 `DEFAULT_VISIBLE`。
6. 验证 + 文档(含 DEVELOPER_GUIDE 字段表)。

## 配方 C:改解析逻辑(字段含义/protobuf 字段号)

1. `ReplayParser.java`(及 `Protobuf`/`PickleReader` 如涉及格式)。
2. 更新 `ParityTest` 的断言/期望值。
3. 验证 + 更新 DEVELOPER_GUIDE 的字段表。

## 配方 D:纯前端交互/样式

只动 `App.vue`(+ 必要时 `deploy/nginx.conf`)。不碰后端/导出。改完 `npm run build`,并在文档记一句。

## 配方 F:调评分(权重/系数/阈值)

只改 `common/rating.json`(权重 assist/block/killValue/winBonus、minSamples、scale、车型系数 classFactor)。改完跑测试(均值应仍 ≈ scale)、重建 exe/镜像。改公式结构(而非数值)才需动 `Rating.java`。

## 配方 G:增改地图中文名

地图中文名**单一来源**在 `common/map_names.json`(`内部名(小写) -> 中文`)。只改这一个文件即可两端生效:

1. 编辑 `common/map_names.json`(key 用 `meta.json` 里的原始 `mapName`,全小写)。
2. 无需改代码:导出端 `MapNames.cn()`(已在 `SingleBattleSheets`/`AggregateSheets` 接入)读 classpath 的副本;前端 `App.vue` `import` 同一份 JSON 经 `mapLabel()` 显示。
3. 新增 key 别忘了让 `wotb-core/pom.xml` 的 `<includes>` 仍含 `map_names.json`(已含)。
4. **docker 部署**:根 `Dockerfile`(单镜像,CI/CD 与本地 compose 共用)构建上下文是仓库根,已 `COPY common/map_names.json` 到后端 classpath 与前端构建处(`/app/common/`,因 `App.vue` 跨目录 import 该 JSON,镜像内保持 `java/frontend` 与 `common` 的相对结构)。若以后前端再 import 新的 `common/*.json`,记得在 `Dockerfile` 的前端阶段加对应 `COPY`。
5. 验证(改前端要 `npm run build`,Java 改了才需 `mvn test`;改 docker 用 `docker compose up --build` 重建)+ 文档。

> 未匹配的地图名原样显示(英文内部名),不会报错。API 始终回原始英文 `mapName`,中文只在前端/导出两个出口呈现。

## 配方 E:更新车辆库

`cd python && python update_tankopedia.py`(写 `common/tankopedia.json`,需联网)→ 跑测试 → 重建 exe/镜像。Java 构建会自动把 `common/tankopedia.json` 复制到 classpath,无需手动同步。

---

## 验证(改完必跑)

```bash
cd java && JAVA_HOME=<jdk21> mvn -s settings.xml test     # ParityTest + WebApiTest
cd java/frontend && npm run build                         # 改了前端时
```

> 默认 `java` 是 JDK 8,跑 mvn 必须先把 `JAVA_HOME` 指向 JDK 21。本环境/沙箱可能无法真正监听端口,用 MockMvc 测试(`WebApiTest`)即可,不必起服务。

## 收尾

1. **更新文档**:`DEVELOPER_GUIDE.md` + 相关 `README.md` / `java/README.md`(任何影响界面/导出/数据/构建/用法的改动)。
2. 提交:中文信息,结尾 `Co-Authored-By`。
3. 推送:个人仓库,SSH remote `github-personal`(账号 `A158Coke`),不使用公司 token。
