---
name: wotb-sync
description: >
  改回放解析、数据列、前端交互、排行榜 schema、auth、i18n 时使用。
  跨层同步检查单：API key → locale JSON → 导出 Java → 测试 → 文档。
  Trigger: 新增列、改 protobuf、改表结构、改 i18n、改 Flyway、改 Keycloak。
---

# wotb-sync — 跨层改动检查单（工具无关，单一事实源）

> 本文件是**工具无关**的改动 playbook，供任意 AI coder / 人类贡献者使用，
> 也是本技能的唯一维护点（内容只增删于此）。
> 背景与数据格式见 `docs/DEVELOPER_GUIDE.md`，硬性约定见 `.agents/AGENTS.md`；
> 数据目录单一来源清单见 `common/AGENTS.md`。

本项目同一份数据要经过**多层多语言**呈现，所以一处改动常需多处同步。下面按"改什么"给出最小步骤。

---

## 黄金法则

- **API 纯英文**：`/api/columns`、DTO 只回 `key`(snake_case) + 数据，绝不放中文。
- **显示名分散在两类出口**，改名要全改：
  - 前端（三语 i18n）：`frontend/src/locales/{zh,en,ru}.json` 的 `player_labels`（单场）与 `agg_labels`（汇总），**三语都改**。
  - 导出：`java/wotb-core/.../Columns.java`（单场 xlsx）、`java/wotb-core/.../AggregateSheets.java`（汇总 xlsx，仅中文）。
- **列 `key` 三方一致**：API / 前端 / 导出。
- **Web 分层**：`ReplayController` 只做 HTTP 映射；业务编排在 `service/ReplayService`（解析/评分/映射/导出）。新增 endpoint 的业务逻辑写进 service，controller 只接参数、拼 `ResponseEntity`。
- **改完必过测试 + 更新文档**（见末尾）。

---

## 配方 A：给某列改显示名（不动数据）

`key` 不变，只改显示文案。**改这几处，保持一致**：

1. `locales/{zh,en,ru}.json` → `player_labels` 和/或 `agg_labels` 中该 `key` 的值（**三语都改**；导出仍中文）。
2. `Columns.java`（若是单场列）对应 `Column(...)` 的 title。
3. `AggregateSheets.java` 的汇总 `AggregateColumn(...)`（若是汇总列；单场表结构在 `SingleBattleSheets.java`）。
4. 验证 + 文档。

> 命名约定：辅助伤害=「协助伤害」、承受伤害=「损失血量」、抵挡伤害=「格挡」、击伤敌数=「击伤」；汇总「总X / 场均X」。

## 配方 B：新增一个玩家/汇总数据列

1. **解析**：`wotb-core/.../ReplayParser.java` 读出字段写入 `PlayerResult`（单场列在 `RESULT_UINT_FIELDS`/对应解析；汇总指标在 `Aggregator.java` 累计）。
2. **列定义/取值**：
   - 单场：`Columns.java` 加一条 `Column(title, key, xlsxW, pxW, num, getter)`。
   - 汇总：`Mapper.AGG_COLS`（key+num+getter）和 `AggregateSheets` 的汇总 `AggregateColumn`（title+宽+num+getter）各加一条；指标计算在 `model.Agg`（由 `Aggregator` 聚合产生）。
3. **API 暴露**：`/api/columns` 自动包含（来自 Columns/AGG_COLS 的 key）。
4. **前端**：`locales/{zh,en,ru}.json` 的 `player_labels`/`agg_labels` 补该 key 的三语文案；如要默认显示，改列选择默认可见集（`composables/useColumns.js` / `utils/helpers.js` 的 `DEFAULT_VISIBLE`）。
5. 验证 + 文档（含 DEVELOPER_GUIDE 字段表）。

## 配方 C：改解析逻辑（字段含义/protobuf 字段号）

1. `ReplayParser.java`（及 `Protobuf`/`PickleReader` 如涉及格式）。
2. 更新 `ParityTest` 的断言/期望值。
3. 验证 + 更新 DEVELOPER_GUIDE 的字段表。

## 配方 D：纯前端交互/样式

只动前端组件/样式（必要时 `deploy/nginx/nginx.conf`）。不碰后端/导出。改完 `npm test` + `npm run build`，并在文档记一句。

## 配方 E：调评分（权重/系数/阈值）

只改 `common/rating.json`（权重 assist/block/killValue/winBonus、minSamples、scale、车型系数 classFactor）。改完跑测试（均值应仍 ≈ scale）、重建镜像。改公式结构（而非数值）才需动 `Rating.java`。
> 前端「评分规则」弹窗与 `GET /api/rating`（`Rating.config()`→`RatingConfig`）自动反映 rating.json 的数值，无需改前端。只有改了**公式文字说明**才动 `locales/*.json` 的 `rating_help`（三语）。

## 配方 F：增改地图显示名

地图显示名**单一来源**在 `common/map_names.json`，结构为 `内部名(小写) -> { zh, en, ru }`。只改这一个文件即可两端生效：

1. 编辑 `common/map_names.json`（key 用 `meta.json` 里的原始 `mapName`，全小写；值同步补齐 `zh/en/ru`）。
2. 无需改代码：导出端 `MapNames.cn()` 读 classpath 的副本并固定用中文；前端 `utils/helpers.js` import 同一份 JSON，经 `mapLabel()` 按当前 locale 显示。
3. 新增 key 别忘了让 `wotb-core/pom.xml` 的 `<includes>` 仍含 `map_names.json`（已含）。
4. **docker 部署**：`Dockerfile.backend` 已 `COPY common/map_names.json` 到后端 classpath；`Dockerfile.frontend` 已 `COPY common/map_names.json /common/` 供前端 import。若以后前端再 import 新 `common/*.json`，在 `Dockerfile.frontend` 加对应 `COPY`。
5. 验证（改前端要 `npm run build`，Java 改了才需 `mvn test`；改 docker 用 `docker compose up --build` 重建）+ 文档。

> 未匹配的地图名原样显示（英文内部名），不会报错。API 始终回原始英文 `mapName`；前端按 locale 渲染，导出固定中文。

## 配方 G：更新车辆库

更新走 `.github/workflows/update-tankopedia.yml`（手动触发，blitzkit 数据源，自动提交 4 个文件）或本地 `cd common/python && python update_tankopedia.py`（需联网）。产物为 `common/tankopedia-tier{7,8,9,10}.json`（**不是** `tankopedia.json`）；写入前有完整性门禁。Java 构建会自动复制到 classpath，无需手动同步。详见 `common/AGENTS.md`。

---

## 配方 H：Leaderboard 改动（Schema/端点/上传）

1. **Flyway**：改表结构必须新增下一序号 Flyway 迁移（当前最高 V14，命名 `V<N>__xxx.sql`），不改已应用版本。
2. **列对齐**：JPA Entity、DTO、Repository 列与迁移逐列对齐，否则 `ddl-auto: validate` 启动失败。
3. **分层**：Controller → Service → Repository；新端点/查询走 `LeaderboardController` + `LeaderboardService` + `LeaderboardRepository`（Service 只调自己域的 Repository）。
4. **API 纯英文稳定 key**（snake_case）；前端三语 label 在 `locales/*.json` 的 `leaderboard` 块。
5. **前端上传/调用**：`api.leaderboardUpload(file)` → `POST /api/leaderboard/upload`；新增端点同步前端 API 调用函数。
6. **测试 + 文档**：Java `mvn test`（WebApiTest）+ 前端 `npm test`，并更新文档。

## 配方 I：新增跨站点状态（主题/语言/偏好）

1. Cookie 写入 `domain=.wotbtools.com`（主页 + 子域名共享），key 命名 `wotbtools-xxx`。
2. 读写函数命名 `readXxx()` / `saveXxx()`，localStorage 作为本地开发回退。
3. 前端三语文案同步更新 `locales/*.json`。

## 配方 J：改 Extended 扩展页

1. `ExtendedApp.vue` 独立入口（`/extended`），和 `App.vue` 无关，不改主回放页。
2. 静态路由：`frontend/extended.html` → `src/extended.js` → 挂载 `src/ExtendedApp.vue`。
3. nginx：`location = /extended { try_files /extended.html =404; }`。
4. 离线/dev：`StaticForwardController` `@GetMapping("/extended")` → `forward:/extended.html`。
5. 三语 i18n：`locales/*.json` 的 `extended` 块。
6. API：`POST /api/preview`（复用）+ `POST /api/rating`（实时评分）。
7. 验证 + 文档。

## 配方 K：Auth 改动

1. Keycloak：`auth.wotbtools.com` 独立容器，realm `wotbtools`，client `wotbtools-web`。
2. 前端：`useAuth.js` composable（Keycloak adapter check-sso 游客模式）。
3. 后端：Spring Security Resource Server + `application.yml` JWT 验证。
4. 新表（user/binding）：Flyway migration，`ddl-auto: validate` 验证。
5. 验证 + 文档（WG 登录见 `docs/auth/wargaming-asia-login.md` 与 `keycloak-wargaming-provider/AGENTS.md`）。

## 验证（改完必跑）

```bash
cd java && JAVA_HOME=<jdk21> mvn -s settings.xml test     # ParityTest + WebApiTest
cd frontend && npm test && npm run build                  # 改了前端时
```

> 系统默认 `java` 可能不是 JDK 21，跑 mvn 必须先把 `JAVA_HOME` 指向 JDK 21。本环境/沙箱可能无法真正监听端口，用 MockMvc 测试（`WebApiTest`）即可，不必起服务。

## 收尾

1. **更新文档**：`DEVELOPER_GUIDE.md` + 相关 `README.md` / `java/README.md`（任何影响界面/导出/数据/构建/用法的改动）。
2. 提交：中文信息，结尾 `Co-Authored-By`。
3. 推送：执行前先 `git remote -v` 确认实际 remote（个人仓库；本机 remote 名/SSH 别名以本机配置为准，不写死）。
