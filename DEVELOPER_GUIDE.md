# Developer Guide for AI Maintainers

## Frontend Layout Note

- `App.vue` 顶栏样式为全局样式：桌面端固定在顶部，移动端使用 sticky + flex-wrap，避免语言选择、主题切换和个人中心入口挤压回放/排行榜页面。

## SPA 路由参数

- `?view=replay`：进入回放提取器。
- `?view=leaderboard`：进入排行榜。
- `?view=profile`：进入个人中心。
- `?view=admin-users`：进入管理员用户管理（仅 `wotbtools-admin` 角色可见）。
- `wotbtools.com` / `www.wotbtools.com` 无参数时默认显示工具集首页。

本文档面向后续维护者和 AI coder。优先阅读本文件，再改解析、导出或 Web API。项目里已有中文注释，但部分终端可能按错误编码显示乱码；源码和文档应保持 UTF-8。

## 项目意图

目标是把 WoT Blitz `.wotbreplay` 回放中的战斗结果提取成可分析的 Excel。项目主线为 Java，交付 Web 版：Spring Boot 4 后端，Vue 3 前端，支持浏览器上传、预览和下载。

当前边界：

- 解析战斗结算结果，不解析完整战斗过程流。
- 输出重点是玩家战绩、车辆信息、战斗基本信息、跨场汇总。

## 仓库结构

仓库按"语言/形态"分层：`common/`(共享资源) + `common/python/`(车辆库更新脚本) + `java/`(Java 主线 wotb-core + wotb-web) + `frontend/`(Vue 3 + 工具集主页) + `docker/`(镜像构建 + 本地开发 compose `docker/online/`)。

```text
.
├── README.md  TODO.md  DEVELOPER_GUIDE.md  LICENSE  .gitignore  AGENTS.md  CHANGELOG.md  HANDOVER.md
├── docker/                       # Docker 构建 + 本地开发 compose
│   ├── Dockerfile.backend        #   后端镜像：Maven → JRE（Spring Boot :8087）
│   ├── Dockerfile.frontend       #   前端镜像：Node → nginx（:80）
│   ├── nginx/                #   双 server（主页 + Vue SPA 反代 /api→wotb-backend:8087）
│   ├── keycloak/                 #   Keycloak realm 导入文件
│   └── online/                   #   开发者版 compose（build: 源码编译，四容器: pg+keycloak+backend+frontend）
├── .dockerignore                 # 减少 Docker 构建上下文
├── frontend/                     # Vue 3 前端
│   ├── src/
│   │   ├── App.vue               #   根组件
│   │   ├── main.js               #   Vue 入口
│   │   ├── composables/          #   组合式模块（useTheme / useReplay / useColumns / useAuth）
│   │   ├── utils/                #   工具层（api.js / theme.js / helpers.js）
│   │   ├── components/           #   UI 组件
│   │   └── locales/              #   三语（zh / en / ru）
│   ├── index.html  package.json  vite.config.js  .npmrc
│   ├── homepage/                 #   工具集主页（wotbtools.com，暗色卡片式）
│   │   └── index.html
├── .github/
│   └── workflows/deploy.yml      # CI/CD
├── common/                       # 共享资源
│   ├── error-codes.json          #   通用错误码（Java 加载 + 前端直读）
│   ├── tankopedia.json           #   车辆库
│   ├── rating.json               #   评分参数
│   ├── map_names.json            #   地图名
│   ├── assets/                   #   图标/logo 单一来源
│   │   ├── wotbtoolslogo.png  icon.ico  icon.png   #   Dockerfile 构建时 → homepage + frontend dist
│   └── data/                     #   示例回放（gitignore）
├── common/python/                # 车辆库更新脚本
│   └── update_tankopedia.py
└── java/
    ├── README.md
    ├── pom.xml                   # 父 POM
    ├── settings.xml / settings-docker.xml
    ├── wotb-core/                # 核心库
    │   └── ...
    └── wotb-web/                 # Spring Boot 应用
        └── ...

生成物和依赖目录通常不应手工维护，也已 gitignore：

- `java/**/target/`
- `frontend/node_modules/`、`frontend/dist/`
- `java/.m2repo/`
- `common/data/`（本地样本）

## 回放格式

`.wotbreplay` 是 zip 包，包含 3 个条目：

- `meta.json`：地图、版本、开始时间、战斗时长、录像者、录像者车辆等。
- `battle_results.dat`：Python pickle，结构为 `(arenaId, protobufBytes)`。
- `data.wotreplay`：BigWorld 事件流，用于存活时间推算（可选，非所有模式）。

`protobufBytes` 没有 `.proto` 文件，项目用通用 protobuf wire decoder 按字段号读取。核心结构：

```text
BattleResults
├── #1   mode/map id
├── #3   winner team
├── #201 repeated roster player
└── #301 repeated player result
```

名册字段 `#201 -> #2`：

| 字段号  | 含义         |
|------|------------|
| `#1` | nickname   |
| `#2` | platoon_id |
| `#3` | team       |
| `#5` | clan       |
| `#9` | rank       |

战绩字段 `#301 -> #2`：

| 字段号          | 当前含义                                             |
|--------------|--------------------------------------------------|
| `#101`       | account_id                                       |
| `#102`       | team                                             |
| `#103`       | tank_id                                          |
| `#4`         | shots                                            |
| `#5`         | hits dealt                                       |
| `#7`         | penetrations dealt                               |
| `#8`         | damage dealt                                     |
| `#9` + `#10` | assisted damage                                  |
| `#11`        | damage received                                  |
| `#12`        | hits received                                    |
| `#15`        | penetrations received                            |
| `#17`        | enemies damaged                                  |
| `#18`        | kills                                            |
| `#23`        | xp，含义仍需更多样本确认                                    |
| `#105`       | survived marker，值为 unsigned all-ones / `-1` 表示存活 |
| `#106`       | credits，含义仍需更多样本确认                               |
| `#107`       | mm rating float bit pattern                      |
| `#117`       | damage blocked                                   |

不要轻易重命名或删除字段。若发现新字段，优先在"原始字段"表保留，并用测试样本交叉验证后再展示到主表。

## Java / Web 版维护点

### 核心类

> 下表第三列是当初移植的原 Python 原型函数名（该 Python 实现已移除，仅作概念对照保留）。

| 类                    | 文件                                     | 说明                                    |
|----------------------|----------------------------------------|---------------------------------------------|
| `ReplayParser`       | `wotb-core/.../ReplayParser.java`      | 回放解析入口（zip → meta + protobuf + 事件流） |
| `EventStreamReader`  | `wotb-core/.../EventStreamReader.java` | data.wotreplay 事件流解析（Type 4/8/10/39） |
| `Protobuf`           | `wotb-core/.../Protobuf.java`          | protobuf wire decoder                     |
| `PickleReader`       | `wotb-core/.../PickleReader.java`      | Python pickle 读取                        |
| `Tankopedia`         | `wotb-core/.../Tankopedia.java`        | 车辆库查表                                |
| `MapNames`           | `wotb-core/.../MapNames.java`          | 地图名中文化（读 classpath map_names.json）|
| `Players`            | `wotb-core/.../Players.java`           | 展示字段富化 + 排序                       |
| `Rating`             | `wotb-core/.../Rating.java`            | 表现评分计算                              |
| `Columns`            | `wotb-core/.../Columns.java`           | 列定义（单数据源, export 与 API 共用）    |
| `Aggregator`         | `wotb-core/.../Aggregator.java`        | 跨场汇总                                  |
| `ExcelExporter`      | `wotb-core/.../ExcelExporter.java`     | 导出门面                                  |
| `ExcelStyles`        | `wotb-core/.../ExcelStyles.java`       | POI 渲染底座                              |
| `SingleBattleSheets` | `wotb-core/.../SingleBattleSheets.java` | 单场三表                                  |
| `AggregateSheets`    | `wotb-core/.../AggregateSheets.java`   | 汇总三表                                  |
| `Replays`            | `wotb-core/.../Replays.java`           | 多回放去重收集                            |
| `ReplayController`   | `wotb-web/.../ReplayController.java`   | REST API 映射                            |
| `ReplayService`      | `wotb-web/.../ReplayService.java`      | 业务编排                                  |
| `DesktopLifecycle`   | `wotb-web/.../DesktopLifecycle.java`   | 桌面模式判定 + 关机                       |
| `Mapper`             | `wotb-web/.../Mapper.java`             | 核心模型 → DTO                           |
| `WotbWebApplication` | `wotb-web/.../WotbWebApplication.java` | Spring Boot 入口                          |
| `LeaderboardController` | `wotb-web/.../controller/LeaderboardController.java` | 排行榜 REST API（`@Profile("postgres")`）|
| `LeaderboardService` | `wotb-web/.../service/LeaderboardService.java` | 排行榜业务：录像者匹配/去重/查询（`@Profile("postgres")`）|
| `LeaderboardRecord`  | `wotb-web/.../entity/LeaderboardRecord.java` | JPA 实体（列与 Flyway V1 逐列对齐）|
| `LeaderboardRecordRepository` | `wotb-web/.../repository/LeaderboardRecordRepository.java` | Spring Data JPA 仓库 |
| `GlobalExceptionHandler` | `wotb-web/.../controller/GlobalExceptionHandler.java` | 统一异常处理 → JSON 错误响应 |

### 前端

- 根组件 `App.vue`（编排层），无 Vue Router、无组件库。逻辑全在 **composables** 和 **utils** 中：
  - `composables/useReplay.js` — 文件/预览/导出/战斗移除状态管理
  - `composables/useColumns.js` — 列可见性/排序/选择器状态
  - `composables/useTheme.js` — 主题切换（auto/light/dark），数据持久化调用 `utils/theme.js`
  - `composables/useAuth.js` — Keycloak 认证适配器（check-sso 游客模式）
  - `utils/api.js` — 集中式 API 层（healthCheck / preview / downloadBlob / shutdown）
  - `utils/theme.js` — 纯函数（readTheme / saveTheme / resolveTheme / applyTheme），Cookie `.wotbtools.com` 域共享 + localStorage 回退
  - `utils/helpers.js` — 常量（DEFAULT_VISIBLE / EXTENDED_ONLY_PLAYER_KEYS / RATING_TIERS）+ 工具函数（mapLabel / ratingTier 等）
- UI 组件在 `components/`：FileUploader / ColumnPicker / AggregateTable / BattleTable / RatingModal / RemoveConfirmModal / VersionPage / LeaderboardPage（排行榜整页，仅在线版显示）
- 开发时 Vite 代理 `/api → localhost:8087`。
- 语言持久化 `localStorage('wotb-lang')`，主题持久化 Cookie `wotbtools-theme`（domain `.wotbtools.com`）+ localStorage 回退。

### 显示名（i18n）架构

API 层为**纯英文**：`/api/columns` 与各 DTO 只回 `key`(snake_case) + 数据，**不含中文**。显示名由各输出通道**各自映射**：

- 前端：`vue-i18n` 三语 locale `frontend/src/locales/{zh,en,ru}.json` 的 `player_labels` / `agg_labels` / `rating_labels`（多套 key，因 `kills` 在单场=「击杀」、汇总=「总击杀」、rating=「人头」），模板用 `$t(...)` 渲染，语言可切换、`localStorage` 记忆（`wotb-lang`）。
- 导出层：`Columns.java`（单场 xlsx 表头）、`AggregateSheets.java` 的汇总列（导出仅中文）。

> 这是有意的取舍：API 干净、可多语言，但显示名存在多份（前端三语 locale + 导出）。**改/增任一列名，务必同步三语 locale 的相关 key（缺 key 会回退 `en`，再缺则显示原始 key）与导出标签。**
>
> 当前命名约定：辅助伤害=「协助伤害」、承受伤害=「损失血量」、抵挡伤害=「格挡」、击伤敌数=「击伤」；汇总用「总X / 场均X」。



### 潜在伤害与实时 rating

本轮扩展不改当前回放解析页面入口，新增独立 `/extended` 多页构建入口；生产 nginx 对 `/extended` 映射到 `extended.html`，Spring 静态资源由 `StaticForwardController` 转发。

新增字段：

- 单场玩家列：`alpha_damage`、`rank`、`potential_damage`、`potential_damage_supplement`、`potential_damage_detail`。
- 汇总列：`potential_damage`、`potential_damage_avg`、`potential_damage_supplement_avg`。
- 实时 rating 展示列：`rating`、`kast`、`contribution`、`impact`、`damage_avg`、`potential_damage_avg`、`potential_damage_supplement_avg`、`assist_avg`、`multi_damage_rate`、`kills`、`kills_avg`；`average_hp` 和 `account_id` 不再展示。

`frontend/src/composables/useColumns.js` 会过滤 `EXTENDED_ONLY_PLAYER_KEYS`，所以原回放解析页面不展示扩展专用列；扩展页 `/extended` 直接读取 `playerColumns`，可展示完整字段。

`ReplayParser` 仍解析 `xp`、`credits` 到 `PlayerResult`，但这两个值受经济/加成/首胜等因素影响，不作为玩家战绩展示字段、导出列或 rating 输入。

`Tankopedia` 已支持读取 `alphaDamage` 和车辆血量字段（`maxHp` / `hp` / `health` / `hitpoints` / `hitPoints` / `maxHealth`）。当前本地 `common/tankopedia.json` 和更新脚本都没有 HP 字段。`average_hp` 的目标口径是“敌方 7 台车实际进场总血量 / 7”，但回放里的每台车实际进场血量 / 双方总血量字段尚未确认解析；当前实现为：车辆库有 HP 时用车辆库，否则未知单车 HP 暂定 2400。

`PotentialDamage.apply(...)` 当前保守打通字段链路：在尚未解析“击杀者 -> 被击杀者”的逐目标伤害/击穿明细时，`potential_damage == damage_dealt`、`potential_damage_supplement == 0`、`potential_damage_detail == 未解析`。若未来 `killVictims` 与 `alphaDamage` 同时可用，会按 0.9 × 炮伤补增规则计算。
`PotentialDamage.apply(...)` 当前只保守打通字段链路：在尚未解析"击杀者 -> 被击杀者"的逐目标伤害/击穿明细时，`potential_damage == damage_dealt`、`potential_damage_supplement == 0`、`potential_damage_detail == 未解析`。这不会覆盖均伤。若未来 `killVictims` 与 `alphaDamage` 同时可用，会按 0.9 × 炮伤补增规则计算。

`POST /api/rating` 只基于本次上传的 multipart 回放实时计算，不落库、不读取历史记录；`GET /api/rating` 仍保留为旧评分参数接口。扩展页的实时 rating 由 `RatingAnalyzer` 独立计算，不替换原解析页/导出的旧 `Rating.compute(...)` 字段。

实时 rating 公式：

- `average_hp`：目标口径为敌方 7 台车实际进场总血量 / 7；当前真实进场血量字段尚未解析，车辆库无 HP 时未知单车 HP 暂定 2400。
- `KAST`：参考 CS2/CS:GO 的 Kill / Assist / Survive / Traded 思路，单场取 `damage/(average_hp*1.15)`、`assist/(average_hp*1.25)`、`win && survived ? 1 : 0`、`traded_death ? 1 : 0`、`(damage+assist)/(average_hp*1.20)` 的最大值，再跨场平均并封顶 100。
- `impact`：统计全部场次，按 `damage + assist` 在双方总池中的占比（期望份额 `1/14`）和人头折算成 Impact 百分比。
- `contribution`：全场 `damage + assist + kills * average_hp / 7` 在本方队伍中的占比。
- `multi_damage_rate`：单场满足 `damage >= average_hp*1.5`、`damage >= average_hp*1.2 && kills >= 1`、`damage >= average_hp && kills >= 2`、`kills >= 3` 任一条件记为一次多伤。
- `rating`：`potential-DPB`、KAST、Impact、AST（`assist_avg`）、多伤率、场均人头加权得到，当前系数为 0.70 / 0.15 / 0.25 / 0.30 / 0.10 / 0.10，最终乘以 10 输出。
### 评分（Rating）

自包含的表现评分（类 WN8 机制，但**期望值来自当前处理的这批战斗，不依赖外部表**）。实现：`wotb-core/Rating.java`。

> **可调项集中在 `common/rating.json`**（权重/阈值/scale/车型系数）——Java 经 classpath 读取，**改它即生效，不必改代码**；文件缺失/损坏则用内置默认。

- **有效贡献 EC** = `伤害 + 0.6*协助 + 0.35*格挡 + 200*击杀`（权重见 `rating.json`）。
- **按车型基准**：从这批数据按车型(轻/中/重/TD)求 EC 均值；某车型样本 `< 5`(含"没有同类车")时 `基准 = 全体均值 × 车型难度系数`(可调常量 `CLASS_FACTOR`，默认 轻坦0.7/中坦0.9/重坦1.0/TD1.0)，避免独苗轻坦被高 EC 的重坦拉低。
- **评分** = `round(1000 * EC/基准 * (1 + 0.05*胜))`；`1000` = 同车型平均。
- **基准范围 = 一起处理的这批战斗**：单场导出即相对该场；多场/预览相对整批。所以 rating 是"相对该批"的,不是绝对天梯分。
- 列：单场「评分」`key=rating`(在 `Columns.STAT`)、汇总「场均评分」`key=rating_avg`(Mapper/AggregateSheets)。计算时机：`ExcelExporter.writeSingle/writeAggregate`(门面) 与 `ReplayService.preview` 在用之前先 `Rating.compute(...)`。

### 存活时间（Survival Time）

存活时间列 `survival_time`（单场）和 `survival_avg`（汇总）推算阵亡玩家的死亡时刻：

**3 层 fallback + 假阳性检测：**

1. `deathTimeMillis / 1000`（proto `#104`；v11.18 实测不存在，代码保持兼容）
2. `damageDeathTimes`（Type 8 EntityMethod subtype 8 body[13]=3 直接 HP 伤害事件，累计达 `damageReceived` 阈值）
3. hybrid EntityLeave / Position：EntityLeave 有假阳性时，若 Position 显著晚于 EntityLeave（>5s）则以 Position 为准

**事件流来源：** `data.wotreplay` 文件由 `EventStreamReader` 解析，提取 Type 4 (EntityLeave)、Type 8 subtype 8 (damage)、Type 10 (Position)。详细格式见 `docs/replay-data.md`。

**实现位置：** `EventStreamReader.java`（事件解析 + 死亡推算方法）、`ReplayParser.java`（fallback 编排，第 148–180 行）。

### 排行榜（Leaderboard）

**仅在线版**功能（`postgres` profile）。MVP 只记录**录像者本人**在某场战斗中用某辆车打出的**单场伤害成绩**，不存全场 14 人，不存 replay 原文件。

- **数据库分层**：默认 profile 在 `application.yml` 排除 JPA/DataSource 自动配置（无数据库也能启动）；`postgres` profile 设 `autoconfigure.exclude: []` 重新启用，并开启 Flyway（`ddl-auto: validate`）。
- **Schema 来源**：Flyway 迁移 `wotb-web/.../resources/db/migration/V1__init_leaderboard.sql` → `V2__add_version_battle_time.sql`。**改表结构必须新增迁移**（`V3__...`），不要改已应用的 V1/V2；实体列与迁移列**逐列对齐**，否则 `validate` 启动即失败。
- **仅随机战斗**：只有 `meta.json#arenaBonusType == 1`（随机）的战斗计入；训练房（==2）/娱乐/联赛等其他模式、以及模式未知（null）一律拒绝。`ReplayParser` 解析到 `Battle.arenaBonusType`，策略判断在 `LeaderboardService`。取值经真实样本核实（1=随机、2=训练房）。
- **录像者识别**：`meta.json` 无录像者 `accountId`，`ReplayParser` 仅给出 `Battle.recorder`（昵称）。`LeaderboardService` 按 `nickname.equals(battle.recorder)` 在 `players` 中匹配；匹配不到则跳过（不猜）。
- **去重**：唯一键 `(arena_id, account_id)` —— 同一场+同一玩家唯一；不同玩家/不同场各自成行。保存前 `findByArenaIdAndAccountId` 查重，并发冲突兜底捕获 `DataIntegrityViolationException`。
- **数据列**（V2 新增 `version`/`battle_time`）：`version` 来自 `meta.json#version`（游戏版本号如 `"11.18.0"`），`battle_time` 来自 `meta.json#battleStartTime` epoch ms（战斗实际发生时间），`created_at` 为上传时间。两新列均可 NULL（兼容旧数据）。
- **集成点**：`ReplayService.preview()` 解析后 best-effort 调用；`ReplayService` 经 `ObjectProvider<LeaderboardService>` 可选注入，**无数据库时静默跳过，绝不影响预览/导出**。
- **API**（纯英文 key）：`GET /api/leaderboard/top-damage?limit=`（全局伤害榜）、`GET /api/leaderboard/tanks/{tankId}/top-damage?limit=`（按车辆筛选伤害榜）。
- **前端**：`components/LeaderboardPage.vue`（整页，复用全局表格样式 + `mapLabel`），入口按钮在 `App.vue` 顶栏 `v-if="!isDesktop"`——**仅在线版显示**（桌面版 `/api/health` 返回 `desktop:true`，隐藏入口，且后端无这些端点）。三语文案在 `locales/{zh,en,ru}.json` 的 `leaderboard` 块。API 调用在 `utils/api.js`。
- **测试**：`LeaderboardServiceTest`（Mockito，无库，覆盖匹配/去重/跳过）；真实 Flyway+validate+落库用临时 postgres 容器手动验证（不入常驻测试，避免 `mvn test` 依赖 DB）。

### 一致性要求

Java Web 版必须保持以下规则一致：

- `arena_id` / `arenaUniqueId` 去重规则。
- 玩家排序：先队伍，再按伤害降序。
- 协助伤害：`#9 + #10`。
- 存活判断：`#105 == -1`。
- 单场 xlsx 的工作表结构。
- 多场 xlsx 的 `汇总`、`明细`、`战斗列表` 语义。
- 车辆库 fallback：找不到车辆时显示 `#tank_id`。
- 列的 `key`（snake_case）在 API、前端映射、导出三方一致；中文显示名在前端两套映射 + 导出标签一致。
- **地图名中文化**：`meta.json` 的 `mapName` 是内部英文名（如 `lagoon`），中文名映射**单一来源** `common/map_names.json`（构建复制到 classpath）。导出走 `MapNames.cn()`（`SingleBattleSheets` 单场信息 + `AggregateSheets` 明细列/战斗列表），前端 `App.vue` 直接 `import` 同一份 JSON 用 `mapLabel()`（标签页/地图卡/移除确认）。API 仍回原始英文 `mapName`。未匹配则原样显示。

如修改字段解释或列名，必须同步：

1. Java `ReplayParser`、`PlayerResult`、`Columns`（单场列）、`AggregateSheets`（汇总列）。
2. Java Web API `Mapper`（`/api/columns` 只回英文 key）+ 前端三语 locale `locales/{zh,en,ru}.json` 的 `player_labels` / `agg_labels` / `rating_labels`。
3. 测试（`ParityTest`、`WebApiTest`）。
4. 文档（本文件 + README）。

原则：业务逻辑只有 Java 一套主线（`common/python/` 仅保留车辆库更新脚本，不承载提取/导出逻辑）。所有解析/评分/导出改动都进 `java/`。

## 测试命令

Java：

```bash
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml test
```

前端构建：

```bash
cd frontend
npm run build
```

网络受限环境下，Java / npm 依赖可能无法重新下载。仓库当前包含 `node_modules` 和部分构建产物，但不要把它们当成源码真相。

> Windows 环境默认 `java` 可能是 JDK 8。执行 Maven 前请先把 `JAVA_HOME` 指向 JDK 21。

## 常见改动流程

### 增加一个玩家字段

1. 在 Java `ReplayParser`、`PlayerResult`、`Columns`、`Mapper` 中同步（单场表与明细表经 `Columns` 自动生效，无需手改导出类）。
2. 更新测试（`ParityTest`），至少验证字段存在、类型正确、导出不破坏。
3. 更新文档字段表。

### 调整汇总指标

1. 先改 Java `Aggregator`（+ `model.Agg` 指标）和 `AggregateSheets`（汇总列）。
2. 若 Web UI 预览展示该指标，同步 `Mapper.aggregateColumns()`。
3. 用 `common/data/` 样本跑 Java 测试。

### 更新车辆库

车辆库是**单一来源** `common/tankopedia.json`，无需手动同步：

1. `cd python && python update_tankopedia.py`（写入 `common/tankopedia.json`，需要网络）。
2. 跑 Java 测试（Java 构建会自动把 `common/tankopedia.json` 复制到 classpath）。
3. 重新构建 Docker 镜像。

## 风险点

- 终端编码：Windows PowerShell 可能把 UTF-8 中文显示成乱码，但文件仍应保存为 UTF-8。
- protobuf 字段没有官方 schema，字段语义来自样本和社区项目交叉验证。
- pickle 读取逻辑只针对当前 `battle_results.dat` 结构，不是通用 pickle VM。
- `data.wotreplay` 事件流解析依赖 BigWorld 包头格式，跨版本可能有偏移变化。
- `tankopedia.json` 依赖外部 blitzkit 资源，更新时需要网络。
- Web 上传接口无持久化和鉴权，适合本地/内网工具，不是公开服务安全模型。
- **Spring Boot 4 自动配置模块化**：自动配置类已从 `org.springframework.boot.autoconfigure.*` 迁到按技术拆分的模块包（`org.springframework.boot.{jdbc,hibernate,data.jpa}.autoconfigure.*`）。`spring.autoconfigure.exclude` 必须用**新类名**，旧类名写了也不报错但等于没排除（默认 profile 会误启 DataSource → 启动失败）。同理 Flyway 的自动配置在独立模块 `spring-boot-flyway`，**只加 `flyway-core` 不会在启动时自动迁移**，必须同时依赖 `org.springframework.boot:spring-boot-flyway`。

## CI/CD 自动部署

`push` 到 `main` 分支触发 GitHub Actions（[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)）：

1. **并行构建两镜像**：`Dockerfile.backend`（Maven → JRE runtime，Spring Boot :8087）+ `Dockerfile.frontend`（Node → nginx，:80）。带 `type=gha` 层缓存。
2. **推送 GHCR**：双镜像各推 `sha-<SHA>` + `latest` 标签 — `ghcr.io/a158coke/wotbtools-backend` 和 `ghcr.io/a158coke/wotbtools-frontend`。认证走内置 `GITHUB_TOKEN`（`packages: write` 权限），无需额外 secret。
3. **SSH 部署 VPS**：在 `/opt/wotb` 写入三服务 `docker-compose.yml`（postgres + keycloak + wotb-backend + wotb-frontend），先清理旧容器再 `docker compose pull && up -d --remove-orphans`。homepage 编入前端镜像（`COPY frontend/homepage /homepage`）。

## 给 AI coder 的工作准则

- 先读 `README.md`、`java/README.md`、本文件和相关测试，再改代码。
- 不要根据乱码输出判断文件内容坏了；优先用 UTF-8 方式读取。
- 不要在 `node_modules`、`target`、`dist` 中做源码修改。
- 如果只改 Web UI 的显示名，改前端三语 locale `locales/{zh,en,ru}.json` 的 `player_labels`/`agg_labels` 即可；API 只回英文 key，不要把中文加回 API。
- `Columns.java` 是 Java 侧列的 key/顺序/取值与**单场 xlsx 表头**的来源；新增字段先加 `Column` 记录，再同步前端 locale、汇总列。
- 任何会改变界面/导出/数据的更新，都要同步更新文档（本文件 + README/java/README）。
