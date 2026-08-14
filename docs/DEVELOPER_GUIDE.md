# Developer Guide

> 动手前先读这一份。接手维护的人或 AI 都适用。

---

## ✦ 给接手的一句话

这是个单人维护的 WoT Blitz 回放分析工具（Java core + Spring Boot + Vue + Keycloak，Web 版）。
动手前读 `.agents/AGENTS.md` 和本文件；跨层改动按 `.agents/skills/wotb-sync/SKILL.md` 的配方；
Maven 必须 `-s java/settings.xml` 且 `JAVA_HOME` 指向 JDK 21；
改完跑 `mvn -s settings.xml test`、`npm test` 和 `npm run build`；
提交用中文信息（账号 A158Coke）；推送前先 `git remote -v` 确认实际 remote（本机 remote 名/SSH 别名以本机配置为准），push main 即自动部署。

---

## 文档地图

文档索引（每个文档「何时读」）见 `docs/README.md`。本文件只列动手必读的几份：

| 文档 | 作用 | 何时读 |
|---|---|---|
| 本文件 `DEVELOPER_GUIDE.md` | 开发入口（环境 / 构建 / 仓库结构 / 架构速览 / 约定） | 最先 |
| `.agents/AGENTS.md` | 仓库级硬约定（RULES） | 动手前必读 |
| 各目录 `AGENTS.md`（java / frontend / common / deploy / .github / keycloak×2 / map-semanticizer） | 按作用域的局部约束 | 进入对应目录时 |
| `.agents/skills/wotb-sync/SKILL.md` | 跨层改动检查单（配方 A–K） | 增删列 / 改解析 / 导出 / 前端时 |
| `java/README.md` | Java / Web 运行、接口、构建 | 跑起来时 |

> Agent 指令层级以真实代码为 source of truth：发现文档与代码漂移时先修正文档。

---

## 环境与工具链（关键坑）

- **JDK 21 必需，且系统默认 `java` 可能是 JDK 8。** 跑任何 Maven 命令前必须先设：
  - bash: `JAVA_HOME="/c/Users/<user>/.jdks/jdk-21.0.1"`（本机实测路径，**不是** `C:\Program Files\Java`）
  - cmd: `set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1`
- **Maven 必须带 `-s java/settings.xml`**（该文件已跟踪，使用 aliyun 镜像 + `java/.m2repo`，干净 clone 可直接运行）。容器内用 `java/settings-docker.xml`。
- **Node 24**（`frontend/.nvmrc` 钉住，`nvm use` 生效）：前端 `frontend`，开发端口 5173，依赖安装用 `npm ci`，构建用 `npm run build`。CI（`ci.yml`）、deploy（`deploy.yml`）与 `Dockerfile.frontend` 均统一 Node 24。
- **Python 3**：`common/python/update_tankopedia.py` 仅用标准库（urllib，从 blitzkit 游戏客户端数据同步车辆库，需联网）；Pillow 仅用于偶尔的图像处理。

---

## 构建 / 运行 / 测试（确切命令）

```bash
# Java 全量测试
cd java && JAVA_HOME=<jdk21> mvn -s settings.xml test

# 前端测试 + 构建
cd frontend && npm test && npm run build

# 本地开发 — 八服务编译启动 (postgres + keycloak + backend + frontend + prometheus + loki + alloy + grafana)
cd docker/online && docker compose up -d --build   # 构建 Dockerfile.backend + Dockerfile.frontend, 8088
```

后端没有无数据库 profile。若要测试本地 Keycloak 管理员写操作，需在本地 realm 配置 `wotbtools-admin-api` 服务账号，并在启动 compose 前设置 `KEYCLOAK_ADMIN_CLIENT_SECRET`；普通回放解析可留空。
Wargaming ASIA 登录需要给 Keycloak 容器注入 `WG_APPLICATION_ID`（WoT Blitz 应用 ID，GitHub Secrets 或 `docker/online/.env`）；缺失时 Keycloak 正常启动、仅 WG 登录返回"未配置"。

> **测试夹具**：提交版真实回放夹具在 `common/fixtures/replays/*.wotbreplay`（CI 无条件执行，`ReplayParserFixtureTest` / `ParityTest` / `WebApiTest` 均加载；随机战斗样例 `random-battle-example.wotbreplay` 按用户指示原样提交、不脱敏）；本地可用 gitignored 的 `common/data/*.wotbreplay` 扩展样本，缺失时跳过仅本地样本的精确值断言。`WebApiTest` 的 PostgreSQL 集成路径在无 Docker 时条件跳过。

---

## 硬性约定

- **改动即更新文档**（同一次提交）。影响界面/导出/数据/构建/用法的改动，必须同步本文档 + 相关 README。
- **API 纯英文**：DTO 只回 raw enum、稳定 `code`/`error` + 数据，**不放 `*Label` 或 `message`**；显示名/错误文案归前端三语 locale。
- **显示名分两类出口**（改列名要全改）：
  - 前端：`frontend/src/locales/{zh,en,ru}.json` 的 `player_labels` / `agg_labels`（**三语都改**）。
  - 导出：`Columns.java`（单场 xlsx）、`AggregateSheets.java`（汇总 xlsx，仅中文）。
- **单一数据源**：`common/tankopedia-tier{7,8,9,10}.json`（车辆库，按等级拆分 4 个文件）、`common/rating.json`（评分参数）、`common/map_names.json`（地图三语名）。构建时由 `wotb-core/pom.xml` 复制到 classpath；**勿在模块内放副本**。
- **车辆库更新（blitzkit 单一来源）**：推荐手动触发 GitHub Actions **`Update Tankopedia`**——runner 直接从 `assets.blitzkit.app/definitions/tanks.pb` + `consumables.pb` + `provisions.pb` + `equipment.pb`（游戏客户端数据，公开 CDN，无 IP 白名单，无需任何 secret）同步并自动提交回 main。本地跑 `cd common/python && python update_tankopedia.py` 即可。数据源为什么不用 WG 百科：WG 滞后于游戏版本（11.19 的 SPHT / AC Atlas 等缺失）且 application_id 有 IP 白名单限制。脚本旧数据只从 `--existing-dir` 目录读取（`tankopedia-tier*.json`，用于保留 extraInfo）、新数据只写 `--output-dir`（workflow 两者路径分离，输入输出互不覆盖）；流程为 `parse_tanks → 过滤业务范围 tier 7–10 → apply 物资/装备 → merge_extraInfo → 完整性门禁 → 写 4 个 tier 文件`（真实 tanks.pb 含 1–10 级，1–6 级不参与校验与输出）。写入前有**完整性门禁**（解析为空 / 总量或单 tier 数量下降超 20% / tank ID 重复 / tier 不在 7–10 / 缺 id·name·hp·gun 均失败，失败不写文件不提交）。每个文件为 `meta` + `vehicles` 数组（全部字段与值均为英文/数字）：每辆车一条记录 `name/id/tier/class/nation/hp/forwardSpeed/reverseSpeed/turretRotationSpeed/hullRotationSpeed/powerToWeightRatio/guns/alphaDamage/allowedProvision/allowedConsumables/allowedEquipment/extraInfo`。`guns` 数组含该车顶配炮塔的**全部炮**（7–9 级也可能多把，如 T-34-2 有 5 把），每把带 `gunId/isDefault/alphaDamage/shells`（shells 每发 `{type, damage, penetration}`，type 归一化 ap/apcr/heat/he，顺序即游戏内弹序）；vehicle 级 `alphaDamage` 只在有唯一权威依据时输出——单炮车 / 7–9 级顶配炮（最高 tier，同 tier 取最高 alpha，如 T-34-2=400），**10 级多终局炮车省略**（回放无可靠实际炮，AI 不输出虚假唯一炮伤）。`allowedProvision`/`allowedConsumables` 由 blitzkit 的 include/exclude 过滤器（tier/ids/clip/nations）判定后映射为 `common/wotb-item-catalog-json` 的逻辑 id / code；`allowedEquipment` 由车辆 `equipment_preset` 槽位装备映射为 catalog 装备 code（含 VK 72.01 俯角/履带齿、Type 71 改进悬挂等专属装备）；手工维护的 `extraInfo`（个人知识点）按 tank_id 保留合并，仍存在车辆的知识点丢失会直接失败。AI prompt 会注入结构化事实（车种/等级/国家/炮伤/血量/知识），Team 路径（TEAM_MEMBERS / OPPOSING_TEAM_LINEUP_AUTHORITATIVE）额外注入 alphaDamage/hp/extraInfo，prompt 规则白名单已放行这些字段。
- **代码风格**：不可变模型用 `record`；可变模型用公有字段 POJO（**不引入 Lombok**）；局部变量/参数尽量 `final`。
- **分层**：controller 只做 HTTP；业务在 service；core 按功能分包。新 endpoint 的逻辑写进 service。
- 跨层联动改动（加列/改解析/改评分/改地图名…）务必按 `.agents/skills/wotb-sync/SKILL.md` 的配方走。

---

## 项目意图

目标是把 WoT Blitz `.wotbreplay` 回放中的战斗结果提取成可分析的 Excel。项目主线为 Java，交付 Web 版：Spring Boot 4 后端，Vue 3 前端，支持浏览器上传、预览和下载。

当前边界：
- 解析战斗结算结果，完整战斗重建已上线（支持逐文件解析 + 可选重建）。
- 输出重点是玩家战绩、车辆信息、战斗基本信息、跨场汇总。

---

## 仓库结构

仓库按"语言/形态"分层：`common/`(共享资源) + `common/python/`(车辆库更新脚本) + `java/`(Java 主线 wotb-core + wotb-web) + `frontend/`(Vue 3 + 工具集主页) + `docker/`(镜像构建 + 本地开发 compose `docker/online/`)。

```text
.
├── README.md  LICENSE  .gitignore  .dockerignore  qodana.yaml
├── docs/                       # 文档索引见 docs/README.md（architecture / features / research / operations / reference / auth 等）
├── docker/                       # Docker 构建 + 本地开发 compose
│   ├── Dockerfile.backend        #   后端镜像：Maven → JRE（Spring Boot :8087）
│   ├── Dockerfile.frontend       #   前端镜像：Node → nginx（:80）
│   ├── nginx/                #   三 server（monitor 反代 Grafana + auth + 主页/Vue SPA 反代 /api→wotb-backend:8087）
│   ├── keycloak/                 #   Keycloak realm 导入文件
│   └── online/                   #   开发者版 compose（build: 源码编译，八服务: pg+keycloak+backend+frontend+观测四件套）
├── .dockerignore                 # 减少 Docker 构建上下文
├── frontend/                     # Vue 3 前端
│   ├── src/
│   │   ├── App.vue               #   根组件
│   │   ├── main.js               #   Vue 入口
│   │   ├── composables/          #   组合式模块（useTheme / useReplay / useColumns / useAuth）
│   │   ├── utils/                #   API、i18n 显示、竞态控制、主题与通用工具
│   │   ├── styles/               #   独立入口共享主题变量（theme.css）
│   │   ├── components/           #   UI 组件
│   │   └── locales/              #   三语（zh / en / ru）
│   ├── index.html  package.json  vite.config.js  .npmrc
│   ├── homepage/                 #   工具集主页与运行时配置赞助页
│   │   ├── index.html
│   │   ├── sponsor.html
│   │   └── sponsor-config.js
│   ├── extended.html             #   Rating V2 独立入口
├── .github/
│   ├── workflows/deploy.yml      # 测试门禁 + 每次统一构建三镜像/部署
│   ├── workflows/database-backup.yml # 每日生产双库备份
│   └── workflows/prod-diagnostics.yml # 线上诊断日志
├── common/                       # 共享资源
│   ├── tankopedia-tier7.json     #   车辆库（7 级）
│   ├── tankopedia-tier8.json     #   车辆库（8 级）
│   ├── tankopedia-tier9.json     #   车辆库（9 级）
│   ├── tankopedia-tier10.json    #   车辆库（10 级）
│   ├── rating.json               #   评分参数
│   ├── map_names.json            #   地图名三语映射
│   ├── assets/                   #   图标/logo 单一来源
│   │   ├── wotbtoolslogo.png  icon.ico  icon.png   #   Dockerfile 构建时 → homepage + frontend/public
│   │   └── silent-check-sso.html #   Keycloak check-sso iframe
│   ├── python/                   #   车辆库更新脚本
│   │   └── update_tankopedia.py
│   └── data/                     #   测试回放（.gitignore）
├── java/                         # Java Maven 根（聚合 wotb-core + wotb-web）
│   ├── pom.xml                   #   聚合 POM
│   ├── settings.xml              #   本地 Maven 设置
│   └── settings-docker.xml       #   容器构建用 Maven 设置
├── deploy/                       # 部署辅助
│   ├── init-db.sql
│   ├── nginx/nginx.conf
│   ├── postgres-backup.sh / postgres-restore.sh / postgres-backup-inspect.sh
│   ├── sponsor-assets/ .gitignore
│   └── sponsor-config.example.json
├── .gitignore  .dockerignore  qodana.yaml
├── .agents/                      # AI 工具定义
│   ├── AGENTS.md                 #   AI 硬性约定（RULES）
│   ├── wotb-sync.md              #   跨层改动检查单（指向 skills/wotb-sync/SKILL.md）
│   └── skills/                   #   技能库（开发前：grill-me / plan-designer；开发后：review-fix / review-with-docs / code-smell / column-sync / wotb-sync）
```

### 架构速览

```
.wotbreplay (zip)
  ├─ meta.json            地图(内部英文名)、版本、时间、录像者…
  ├─ battle_results.dat   Python pickle → (arenaId, protobuf bytes)
  └─ data.wotreplay       BigWorld 事件流（存活时间推算）
        │
    wotb-core (纯 Java 库, 无 Spring)
    ├── parse/      解析+去重
    ├── stats/      评分+富化+汇总
    ├── export/     POI 写 xlsx
    ├── ref/        车辆库+地图名查表
    ├── model/      数据模型(record)
    ├── Columns     列定义契约
    ├── processing/ 统一单/多文件处理门面
    └── replay/
         ├── stream/       原始包流读取
         ├── decoder/      包解码器
         ├── event/        领域事件模型
         ├── reconstruction/ 战场状态重建
         └── feature/      玩家/团队战术特征与 AI context
        │
   wotb-web (Spring Boot)  controller(HTTP) → service(业务) → mapper(→DTO) → dto
        │
   frontend (Vue 3 + Vite, 单文件 App.vue, vue-i18n 三语, Keycloak 认证)
```

核心包结构（`com.wotb.core`）：`parse / ref / stats / export / model / processing / replay` 子包 + 顶层 `Columns`。Web 侧按 `user / leaderboard / replay / boost / admin` 业务域分包，每个域内部再分 controller/service/entity/repository/dto。

### 后端核心类

| 类 | 路径 | 职责 |
|---|---|---|
| `ReplayParser` | `wotb-core/.../ReplayParser.java` | 回放入口：读 meta、parse pickle/protobuf、解析事件流 |
| `BattleResultsReader` | `wotb-core/.../BattleResultsReader.java` | pickle → `arenaId` + protobuf `battle_results` |
| `BattleResultsMapper` | `wotb-core/.../BattlereResultsMapper.java` | protobuf → `BattleResults` |
| `EventStreamReader` | `wotb-core/.../EventStreamReader.java` | data.wotreplay → 事件流 + 死亡推算 |
| `ReplayPacketParser` | `wotb-core/.../ReplayPacketParser.java` | data.wotreplay 包头/包解析 + 二进制读取（B3） |
| `ReplayEventExtractors` | `wotb-core/.../ReplayEventExtractors.java` | EntityLeave/Position/updateArena/EntityMethod 提取（B3） |
| `DeathTimeEstimator` | `wotb-core/.../DeathTimeEstimator.java` | 三条证据链死亡时间估算（B3） |
| `Rating` | `wotb-core/.../Rating.java` | 评分引擎 |
| `RatingAnalyzer` | `wotb-core/.../RatingAnalyzer.java` | 实时 rating V2（扩展页使用） |
| `Tankopedia` | `wotb-core/.../Tankopedia.java` | 车辆库查表（via common/tankopedia-tier{7,8,9,10}.json） |
| `MapNames` | `wotb-core/.../MapNames.java` | 地图名中文表（via common/map_names.json） |
| `Columns` | `wotb-core/.../Columns.java` | 列定义（单数据源，export 与 API 共用） |
| `Aggregator` | `wotb-core/.../Aggregator.java` | 跨场汇总 |
| `ExcelExporter` | `wotb-core/.../ExcelExporter.java` | 导出门面 |
| `ExcelStyles` | `wotb-core/.../ExcelStyles.java` | POI 渲染底座 |
| `SingleBattleSheets` | `wotb-core/.../SingleBattleSheets.java` | 单场三表 |
| `AggregateSheets` | `wotb-core/.../AggregateSheets.java` | 汇总三表 |
| `Replays` | `wotb-core/.../Replays.java` | 多回放去重收集 |
| `ReplayController` | `wotb-web/.../replay/controller/ReplayController.java` | REST API 映射 |
| `ReconstructionController` | `wotb-web/.../replay/controller/ReconstructionController.java` | AI 分析 + 重建 REST API |
| `ReplayProcessingCapabilities` | `wotb-core/.../processing/ReplayProcessingCapabilities.java` | scope-independent 能力事实；可分析规则由 `BatchAnalyzer` 计算 |
| `RecorderEntityMapping` | `wotb-core/.../processing/RecorderEntityMapping.java` | 录像者 entity 映射结果 |
| `TeamPerspectiveResolver` | `wotb-core/.../processing/TeamPerspectiveResolver.java` | 以权威战绩、accountId、participant、nickname 证据解析录像者所在队 |
| `TeamEntityMapper` | `wotb-core/.../processing/TeamEntityMapper.java` | entity → account → team 映射，支持 re-entry 与置信度 |
| `DefaultReplayProcessingFacade` | `wotb-core/.../processing/DefaultReplayProcessingFacade.java` | 统一处理门面（解析+重建+能力标记） |
| `BatchAnalyzer` | `wotb-core/.../processing/BatchAnalyzer.java` | 视角分组+去重+模式判定 |
| `DefaultPlayerBattleFeatureExtractor` | `wotb-core/.../feature/DefaultPlayerBattleFeatureExtractor.java` | 录像者个人特征提取（移动段/交火段） |
| `PlayerBattleFeatureSet` | `wotb-core/.../feature/PlayerBattleFeatureSet.java` | 个人特征集（含 `hasFeatures` / `limitations`） |
| `DefaultTeamBattleFeatureExtractor` | `wotb-core/.../feature/DefaultTeamBattleFeatureExtractor.java` | perspective team 的队员独立移动、阵型、交火、关键事件与权威聚合 |
| `TeamBattleFeatureSet` | `wotb-core/.../feature/TeamBattleFeatureSet.java` | 团队特征、覆盖率、权威结算、观测子集与 limitations |
| `AiReplayAnalysisService` | `wotb-web/.../ai/AiReplayAnalysisService.java` | 兼容 facade（保持旧入口不变，委托 PlayerReplayAnalysisService / TeamReplayAnalysisService；无真实编排） |
| `AiCancellationRegistry` | `wotb-web/.../ai/gateway/AiCancellationRegistry.java` | in-flight AI 请求取消注册表（客户端取消 → 中断上游调用，稳定错误码 `AI_CANCELLED`） |
| `ApiPaths` | `wotb-web/.../config/ApiPaths.java` | API URL 常量单一来源（SecurityConfig 匹配器与 Controller 映射共用） |
| `TeamAiPromptBuilder` | `wotb-web/.../ai/TeamAiPromptBuilder.java` | 确定性团队输入压缩和 token 估算预算（`BudgetWriter` + `AiTokenEstimator`） |
| `PlayerSideResolver` | `wotb-core/.../processing/PlayerSideResolver.java` | 随机战斗友方/敌方/未知解析（FRIENDLY/ENEMY/UNKNOWN），基于录像者权威 team |
| `FriendlyEnemyResult` | `wotb-core/.../processing/FriendlyEnemyResult.java` | 三态胜负转换（FRIENDLY_WIN/ENEMY_WIN/DRAW_OR_UNKNOWN） |
| `PlayerAnalysisPromptFormatter` | `wotb-web/.../ai/PlayerAnalysisPromptFormatter.java` | AI Prompt 格式化（友方/敌方标签，独立于 Excel 导出的 PlayerResultFormat） |
| `TacticalReviewHarness` | `wotb-web/.../ai/TacticalReviewHarness.java` | 双 Call Harness 编排与降级阶梯（随机战个人复盘 ZH） |
| `PreBattleStrategicService` | `wotb-web/.../ai/PreBattleStrategicService.java` | Call #1：roster-only 赛前战略基线（结构化 JSON，≤4k tokens） |
| `TacticalReviewPromptBuilder` | `wotb-web/.../ai/TacticalReviewPromptBuilder.java` | Call #2：Priority Bookends Prompt + 相关性预算裁剪 |
| `EvidenceSkillEngine` | `wotb-core/.../replay/evidence/EvidenceSkillEngine.java` | 6 个 Backend Skill 编排（确定性证据编译，不裁决） |
| `TankTacticalProfileRegistry` | `wotb-core/.../replay/evidence/TankTacticalProfileRegistry.java` | 坦克战术语义层（`common/tank_tactical_profiles.json` + 车型 fallback） |
| `MapTacticalSemanticsRegistry` | `wotb-core/.../replay/map/MapTacticalSemanticsRegistry.java` | 地图战术语义层（`common/map-semantics/*.semantic.json`，`map-semanticizer` 客户端资源解码；未收录 → UNKNOWN） |
| `TeamAutopsyStatsBuilder` | `wotb-core/.../replay/feature/TeamAutopsyStatsBuilder.java` | 团队剖析逐人确定性数据（仅本方 roster + playerKey + 派生 flag 各自置信度） |
| `TeamAutopsyService` | `wotb-web/.../ai/TeamAutopsyService.java` | 团队复盘的结算级 TEAM_AUTOPSY：判负→主要战犯 / 判胜→MVP（完整 roster 契约，预算按整体剩余裁剪，失败不影响主复盘） |
| `ReplayService` | `wotb-web/.../replay/service/ReplayService.java` | 业务编排 |
| `ReplayCapacityLimiter` | `wotb-web/.../replay/service/ReplayCapacityLimiter.java` | 单实例回放解析并发闸门 |
| `Mapper` | `wotb-web/.../replay/mapper/Mapper.java` | 核心模型 → DTO |
| `WotbWebApplication` | `wotb-web/.../WotbWebApplication.java` | Spring Boot 入口 |
| `LeaderboardController` | `wotb-web/.../leaderboard/controller/LeaderboardController.java` | 排行榜 REST API |
| `LeaderboardService` | `wotb-web/.../leaderboard/service/LeaderboardService.java` | 排行榜业务：录像者匹配/去重/查询 |
| `LeaderboardUploadService` | `wotb-web/.../leaderboard/service/LeaderboardUploadService.java` | 公开上传的限流、解析与入库编排 |
| `LeaderboardRecord` | `wotb-web/.../leaderboard/entity/LeaderboardRecord.java` | JPA 实体（列与 Flyway V1 逐列对齐） |
| `LeaderboardRecordRepository` | `wotb-web/.../leaderboard/repository/LeaderboardRecordRepository.java` | Spring Data JPA 仓库 |
| `GlobalExceptionHandler` | `wotb-web/.../controller/GlobalExceptionHandler.java` | 统一异常处理 → `error + timestamp`；客户端/代理断连（Broken pipe、Connection reset，含 cause-chain 包装）仅记 WARN、不写错误 JSON |
| `AdminUserController` | `wotb-web/.../admin/controller/AdminUserController.java` | 管理员用户管理 REST API |
| `AdminUserService` | `wotb-web/.../admin/service/AdminUserService.java` | 管理员用户管理业务 |
| `AdminUserMapper` | `wotb-web/.../admin/service/AdminUserMapper.java` | 本地/Keycloak 用户 → 管理 DTO |
| `KeycloakAdminUserService` | `wotb-web/.../admin/service/KeycloakAdminUserService.java` | Keycloak Admin API 封装 |
| `AdminUserLog` | `wotb-web/.../admin/entity/AdminUserLog.java` | 管理员操作审计日志实体 |
| `ErrorCode` | `wotb-web/.../util/ErrorCode.java` | 管理员 API 错误码枚举 |
| `MyAssignmentController` | `wotb-web/.../boost/controller/MyAssignmentController.java` | 打手视角订单查询 |
| `MyBoosterController` | `wotb-web/.../boost/controller/MyBoosterController.java` | 打手本人资料与接单状态自助切换 |
| `BoosterApplicationController` | `wotb-web/.../boost/controller/BoosterApplicationController.java` | 玩家打手资格申请 API |
| `AdminBoosterApplicationController` | `wotb-web/.../boost/controller/AdminBoosterApplicationController.java` | 管理员资格审批 API |
| `BoosterApplicationService` | `wotb-web/.../boost/service/BoosterApplicationService.java` | 申请校验、审批、Keycloak role 与打手创建编排 |
| `BoosterApplication` | `wotb-web/.../boost/entity/BoosterApplication.java` | 打手资格申请 JPA 实体（列与 Flyway V9 对齐） |
| `UserNotificationController` | `wotb-web/.../user/controller/UserNotificationController.java` | 当前用户站内通知查询、未读数与已读操作 |
| `UserNotificationService` | `wotb-web/.../user/service/UserNotificationService.java` | 写入站内通知，API payload 保持英文 key + 数据 |
| `UserNotification` | `wotb-web/.../user/entity/UserNotification.java` | 站内通知 JPA 实体（Flyway V10） |

---

## 前端架构

### Frontend Layout Note

- `App.vue` 顶栏样式为全局样式：桌面端固定在顶部，≤1080px 时切换为 sticky + flex-wrap（导航换行到第二行并自带横向滚动），任意宽度下顶栏自身可横向滚动，保证语言选择、主题切换、反馈入口、版本历史、联系入口和个人中心入口都不会被挤出屏幕。顶栏反馈按钮为外链 `https://github.com/A158Coke/WotbTools/issues/new`（`target="_blank"`，三语文案 `app.feedback`）；版本历史（`version.btn`）与联系页（`contact.nav`）为 SPA 内导航。
- Vue SPA 主入口视觉变量集中在 `App.vue` 的 `:root` / `[data-theme="dark"]`；独立 `/extended` 入口通过 `frontend/src/styles/theme.css` 复用同一套变量。首页、上传区、排行榜和表格应优先复用这些变量，避免局部硬编码色板。
- 评分徽章样式使用 `r-elite` / `r-great` / `r-good` / `r-mid` / `r-poor`；最高/最低标记由 `utils/helpers.js` 的 `medal(...)` 统一计算，最低评分允许为 `0`，全员同分不显示奖惩。
- 公共首页可通过 `?view=home` 本地预览；线上 `wotbtools.com` / `www.wotbtools.com` 无参数仍默认进入首页。
- 首页首屏「最高伤害记录」读取 `/api/leaderboard/top-damage?page=1&size=1`，只展示当前全局第一条 `damageDealt`，接口失败或无数据时显示 `--`。
- Keycloak `check-sso` 依赖 `frontend/public/silent-check-sso.html`，不要移除，否则公共页面会被静默登录流程整页跳转。
- Keycloak 自助注册由 `docker/keycloak/wotbtools-realm.json` 的 `registrationAllowed` 控制；前端只触发登录流，不自建注册入口。

### SPA 路由参数

- `?view=home`：进入工具集首页（本地预览可用）。
- `?view=replay`：进入回放提取器。
- `?view=leaderboard`：进入排行榜。
- `?view=extended`：进入 Rating V2 扩展分析页。
- `?view=boost`：进入陪练、打手申请与管理员资格审批页。
- `?view=profile`：进入个人中心。
- `?view=admin-users`：进入管理员用户管理（仅 `wotbtools-admin` 角色可见）。
- `?view=login`：前端登录选择页（中国大陆 QQ / 亚服 Wargaming 两个入口；未登录访问个人中心时也会展示该页）。
- `?view=reconstruction`：进入 AI 复盘页。入口（顶栏按钮 + 首页卡片）随时可见，不做角色门控；`ReconstructionPage` 挂载时检查登录，未登录自动 `login('reconstruction')` 跳转登录页并在登录后回到本页。页面只提供「选择回放文件 → 开始 AI 复盘 → 展示结果」，不再展示重建过程与任意时刻状态查询。
- `?view=version`：进入版本历史页（`VersionPage.vue`，读取 `frontend/src/data/versions.json` 渲染，顶栏「更新历史」入口）。
- `?view=contact`：进入联系页（`ContactPage.vue`，展示 QQ / 微信 / Discord 联系方式，支持一键复制，顶栏「联系我」入口）。
- `wotbtools.com` / `www.wotbtools.com` 无参数时默认显示工具集首页。

### 前端组件

- 根组件 `App.vue`（编排层），无 Vue Router、无组件库。逻辑全在 **composables** 和 **utils** 中：
  - `composables/useReplay.js` — 文件/预览/导出/战斗移除状态管理
  - `composables/useColumns.js` — 列可见性/排序/选择器状态；`localStorage` 持久化单场/汇总两套列配置，并在后端新增列时自动补齐顺序
  - `composables/useTheme.js` — 主题切换（auto/light/dark），数据持久化调用 `utils/theme.js`
  - `composables/useAuth.js` — Keycloak 认证适配器（check-sso 游客模式；未登录时 `login(view)` 直接跳转 Keycloak 托管登录页，IdP 选择（QQ + 三个 WG 区服）由 Keycloak 页面提供，前端不硬编码 idpHint）
  - `utils/api.js` / `utils/api-boost.js` — 集中式 API 层；非 2xx 统一转换为稳定 `ApiError`
  - `utils/display.js` — raw enum、成功码和错误码的三语显示
  - `utils/latest-debounce.js` — 丢弃过期异步搜索结果
  - `utils/page.js` — Spring `Page.number` 响应归一化与分页默认值
  - `utils/theme.js` — 纯函数（readTheme / saveTheme / resolveTheme / applyTheme），Cookie `.wotbtools.com` 域共享 + localStorage 回退
- `utils/helpers.js` — 常量（DEFAULT_VISIBLE / EXTENDED_ONLY_PLAYER_KEYS / RATING_TIERS）+ 工具函数（按 locale 取地图名的 `mapLabel` / ratingTier / medal 等）
- UI 组件在 `components/`：FileUploader / ColumnPicker / AggregateTable / BattleTable / RatingModal / RemoveConfirmModal / LeaderboardPage / LoginPage（QQ + Wargaming 登录选择页）/ ProfilePage（含站内通知面板）/ BoostPage / AdminUsersPage / HomePage / ExtendedPage / ReplayPage
- AI 复盘页组件：`ReconstructionPage`（登录门控 + 编排）→ `ReplayInputPanel`（`ReplayFilePicker` 选文件 + `ReplayAnalysisAction` 触发分析）→ 独立「地图鸟瞰」区块（`MapOverview` 三视图：热力/路线/战局回放，经 `POST /api/replay/map-overview` 只解析回放、不调 AI——不跑 AI 复盘也能看图；`AnalysisResultPanel` 不再渲染地图块，其 AI 报告时间链接把 `seek` 事件上抛给页面加载/跳转）→ `AnalysisResultPanel`（Markdown 正文常驻展示，`MarkdownContent` 渲染）
- 回放解析上传页由 `FileUploader.vue` 负责交互，`App.vue` 提供全局上传区样式；空态、拖拽态、已选文件态共用 `upload.*` 三语文案。
- 开发时 Vite 代理 `/api → localhost:8087`。
- 语言持久化 `localStorage('wotb-lang')`，主题持久化 Cookie `wotbtools-theme`（domain `.wotbtools.com`）+ localStorage 回退。
- 回放预览列配置持久化使用 `localStorage`：`wotb-replay-player-visible-cols`、`wotb-replay-player-order`、`wotb-replay-agg-visible-cols`、`wotb-replay-agg-order`。读取缓存时需按当前响应列集合清洗，避免旧缓存吃掉新列。
- 内联 SVG 图标统一使用全局 `.ic` 描边样式；上传按钮使用 `.filebtn input { display:none; }` 隐藏原生文件控件，避免浏览器默认控件破坏布局。
- `BoostPage.vue` 的打手管理页使用 `Teleport` 模态框新增/编辑。编辑已有打手时关联用户只读，前端 PATCH 不发送 `nickname/keycloakUserId`；系统申请资料必须留在 `booster_application` 专用字段，禁止拼入可编辑 `booster_profile.description`。页面同时展示两套状态：`booster_profile.status` 是资格状态（`ACTIVE/INACTIVE/BANNED`），接单状态由 `booster_profile.available + activeAssignmentCount` 推导（可接单/忙碌/暂停接单）。分配弹窗按资格、接单状态、活跃订单数、等级和擅长内容排序推荐打手；改动任一含义时，务必同步三语 locale。
- `ProfilePage.vue` 是个人主页，展示用户身份、WoTB 账号绑定、排行榜记录和站内通知面板；若当前用户是打手，还会显示接单状态与进行中/历史订单。未登录时直接跳转 Keycloak 托管登录页（无自定义登录页）。Wargaming 官方账号（`wotbAccountSource=WARGAMING` 或 JWT 明确为 WG 登录 `isWargamingLogin`，覆盖 ASIA/EU/NA）显示来源 Wargaming.net 与已验证状态，资料只读（无编辑/解绑按钮）；**同步失败不再静默**——显示「同步失败 + 重试」，且绝不显示手动绑定入口；服务器标签按实际区服展示（中国/亚洲/欧洲/北美），页面加载后调用一次 `PUT /api/users/wotb-account/from-login` 幂等同步昵称。通知面板在右侧栏顶部，点击展开通知列表（最近 30 条），支持单条已读和全部已读，未读数字小红点提示。打手接单状态通过 `PATCH /api/boost/boosters/my/availability` 让打手本人暂停/恢复接收新订单；这个开关只影响新订单，不会隐藏已有进行中订单。
- 陪练订单生命周期由 `boost_request.status` 表示：`NEW/REVIEWING/MATCHED/ACCEPTED/IN_PROGRESS/PENDING_CONFIRM/CLOSED/EXCEPTION/REJECTED/CANCELLED`。打手单次接单生命周期由 `boost_request_assignment.status` 表示：`ASSIGNED/ACCEPTED/IN_PROGRESS/PENDING_CONFIRM/DECLINED/CANCELLED/COMPLETED/EXCEPTION`。订单完成、取消、拒绝或拒单时设置 `unassigned_at` 释放打手忙碌状态。
- 客户提交陪练需求的区服由 `BoostRegion` 统一校验，规范值为 `CN / ASIA / EU / NA`；`GET /api/boost/options` 从该枚举动态返回四服选项，前端通过 `boost.regionValue` 三语展示。空值保持向后兼容并默认 `CN`，未知区服以 `UNSUPPORTED_BOOST_REGION` 拒绝。需求区服在客户、管理员列表和 `BoostAssignmentDto` 打手工作台中可见；当前仍由管理员人工选择打手，不做区服自动匹配。
- 站内通知由 `user_notification` 保存，boost domain 只调用 `UserNotificationService` 写事件；API 返回 `type + payload` 英文 key，前端 `frontend/src/locales/{zh,en,ru}.json` 负责渲染文案。
- Boost DTO 不返回 `*Label`、`message` 或本地化 `warning`；选项只返回 `value + enabled`，状态使用 raw enum，成功/失败/警告分别使用 `code`、`error`、`warningCode`。新增任何 code 必须同步三语 `api_codes` / `api_errors`。
- 回放 DTO 的 `tank_type`、`tank_nation`、`survived_label`、`potential_damage_detail` 与 `/api/rating.classFactor` 只返回稳定英文码；车型、国家、潜在解析状态和评分车型通过 `replay_values` 映射，存活状态通过 `survived.alive/dead` 映射；Excel 导出继续使用中文。
- 权限采用 allowlist：公开端点、登录端点和后台端点必须显式列入 `SecurityConfig`；末尾 `/api/**` 为 `denyAll()`。`boost-manager` 仅允许 `/api/admin/boost/**`，其他 `/api/admin/**` 只允许 `wotbtools-admin`。
- Keycloak realm role 不是数据库事务资源：`BoosterService` 先 `saveAndFlush` 验证唯一键/外键，再增删 role，并注册 transaction rollback compensation。删除打手前只查活跃分配依赖（`assignmentRepository.existsByBoosterId`），已审批申请的 `approved_booster_id` 引用会在删除时自动解除并保持 APPROVED 状态，不阻塞二次申请；不要在 Controller 或申请 Service 中重复直接改 role。

### 认证与 Wargaming ASIA 登录

- **region 不变量**：每个 Keycloak 用户都有 `region` 属性（`CN`/`ASIA`/`EU`/`NA` 大写）。存量用户已迁移补 `CN`（一次性脚本，dry-run 138 → 更新 138，执行后已删除）；QQ Provider（`JuheQqEndpoint`）对新增用户写 `region=CN`；WG Provider 写实例配置的区服（当前 ASIA，EU/NA 实例写对应值）。
- **WG 身份**：broker 唯一标识 `wg:{region}:{account_id}`（ASIA 实例即 `wg:asia:{account_id}`），Keycloak `username = wg_{region}_{account_id}`（区服隔离，如 `wg_asia_512345678`，防跨区服 account_id 冲突；游戏账号 ID 保持纯数字存 `wotb.account_id`）。`account_id` 一律来自 `POST api.worldoftanks.{region}/wot/auth/prolongate/` 服务端响应（官方契约字段 `account_id`，token↔账号服务端绑定）；**认证接口走 `api.worldoftanks.{asia|eu|com}/wot/auth/`，账号接口走 `api.wotblitz.{asia|eu|com}/wotb/account/`（`api.wotblitz.*` 无 `/wot/auth/*`）**；浏览器回调的 `account_id`/`nickname`/`expires_at` 均不可信，仅作一致性检查。重复登录由 `WargamingIdentityProvider.updateBrokeredUser` 显式刷新 `displayName` / `wotb.nickname`，身份不变（决策 D11）。
- **JWT claims**：`wotbtools-web` client 的 4 个只读 protocol mapper（realm JSON 已含）：`region→wotb_region`、`wotb.account_id→wotb_account_id`、`wotb.nickname→wotb_nickname`、`wotb.verified→wotb_verified`（`jsonType=boolean`）。后端缺失 `wotb_region` / `wotb_verified` 一律按 CN 兜底。
- **数据库**：V12 扩展 `CHECK (wotb_server IN ('CN','ASIA'))` 并新增 `wotb_account_source`（默认 `MANUAL`）与 `wotb_account_verified_at`（可空）；V13 再扩展 `CHECK IN ('CN','ASIA','EU','NA')`；存量 CN 数据默认 `MANUAL` / NULL，平滑迁移。
- **API**：`POST /api/users/profile` 按可信 WG claims 自动创建对应区服资料（ASIA/EU/NA）；`PUT /api/users/wotb-account/from-login` 在 Profile 不存在时原子创建 WARGAMING、空 Profile 升级为 WARGAMING、同 (region, account_id) 幂等刷新昵称（不刷新 verified_at）、已绑定 MANUAL 返回 409；`PATCH/DELETE /api/users/wotb-account` 在 JWT 明确为 WG 身份时（即使 DB 仍未同步）返回只读错误（ASIA 为 `ASIA_PROFILE_READONLY`，EU/NA 或 DB 未同步场景为 `WARGAMING_PROFILE_READONLY`）。错误码 `PROFILE_REGION_MISMATCH` / `WOTB_ACCOUNT_MISMATCH` / `WOTB_ACCOUNT_ALREADY_USED` 为 409，`WOTB_CLAIMS_INVALID` / `ASIA_PROFILE_READONLY` / `WARGAMING_PROFILE_READONLY` 为 400。
- **环境变量**：`WG_APPLICATION_ID`（WoT Blitz 应用 ID）注入 Keycloak 容器；缺失时 Keycloak 正常启动，仅 WG 登录返回"未配置"。
- **IdP 载体（决策 D18）**：`wargaming` 类型 IdP（Provider ID `wargaming`）的 ASIA / EU / NA 三个实例（alias `wargaming-asia` / `wargaming-eu` / `wargaming-na`）不进 realm JSON（避免密钥进导入配置），共用 `WG_APPLICATION_ID` 与 `wotbtools-web` client，dev/prod 均在 Admin Console 手工创建；步骤见 `docs/auth/wargaming-asia-deployment.md`。
- **测试**：WG Provider 用 JUnit 5 + JDK `HttpServer` stub（`keycloak-wargaming-provider/src/test`），CI 新增 `keycloak-providers` job 跑两个 provider 模块的 `mvn test`；后端用 Mockito 单测覆盖 create/syncFromLogin 的 CN/ASIA/EU/NA 分支与错误码。

### 显示名（i18n）架构

API 层为**纯英文**：`/api/columns` 与各 DTO 只回 `key`(snake_case) + 数据，**不含中文**。显示名由各输出通道**各自映射**：

- 前端：`vue-i18n` 三语 locale `frontend/src/locales/{zh,en,ru}.json` 的 `player_labels` / `agg_labels` / `rating_labels`（多套 key，因 `kills` 在单场=「击杀」、汇总=「总击杀」、rating=「人头」），模板用 `$t(...)` 渲染，语言可切换、`localStorage` 记忆（`wotb-lang`）。
- 导出层：`Columns.java`（单场 xlsx 表头）、`AggregateSheets.java` 的汇总列（导出仅中文）。

> 这是有意的取舍：API 干净、可多语言，但显示名存在多份（前端三语 locale + 导出）。**改/增任一列名，务必同步三语 locale 的相关 key（缺 key 会回退 `en`，再缺则显示原始 key）与导出标签。**
>
> 当前命名约定：辅助伤害=「协助伤害」、承受伤害=「损失血量」、抵挡伤害=「格挡」、击伤敌数=「击伤」；汇总用「总X / 场均X」。

---

## 领域速记

- **回放格式**：zip 含 3 文件 —— `meta.json` + `battle_results.dat`（pickle + protobuf 战绩）+ `data.wotreplay`（BigWorld 事件流）。字段表见 `docs/reference/replay-data.md`。**不要轻易重命名/删字段**，新字段先进「原始字段」表交叉验证。
- **存活时间**：3 层 fallback（#104 → Damage → hybrid EntityLeave/Position），详见 `docs/reference/replay-data.md`。
- **评分**：自包含、类 WN8，基准来自「一同计算的这批战斗」（相对分，非绝对天梯）。参数在 `common/rating.json`。细节见 `docs/features/rating.md`。
- **数据库**：PostgreSQL 18，JPA/Flyway（`ddl-auto: validate`）；Flyway 自动配置依赖 `spring-boot-flyway`。
- **排行榜**：schema 由 Flyway 管理；只记录录像者本人随机战斗（`arenaBonusType==1`）单场伤害。见 `docs/features/leaderboard.md`。
- **i18n**：vue-i18n 三语（zh/en/ru），`locales/*.json`；地图名 `common/map_names.json`，网页按当前语言显示，导出固定中文。
- **API 端点**：`GET /api/health`、`GET/POST /api/rating`、`POST /api/preview`、`POST /api/export?mode=aggregate|each`；排行榜 / 站内通知端点见 `java/README.md`。
- **公开解析边界**：最多 100 个回放、单文件 20 MiB、总请求 200 MiB；单实例默认同时处理 2 个任务；容量满 503 `REPLAY_BUSY`。

---

## CI/CD 与部署

**流水线**：`.github/workflows/deploy.yml` —— push 到 `main` 命中 `java/**`、`frontend/**`、`common/**`、Dockerfile、Keycloak 或 `deploy/**` 时触发，也支持手动 `workflow_dispatch`：
1. 用完整 push range 判断 backend/frontend 哪些范围变化（仅用于测试门禁与 tag 计算）。
2. 后端 Maven 全测、前端 Vitest + Vite build 通过后，**统一构建 backend/frontend/keycloak 三个 SHA 镜像**——生产部署不按路径增量构建，避免 compose 引用不存在的镜像导致 pull 失败。
3. SSH 部署前备份 `wotb` 与 `keycloak`；新 compose 先写入 `docker-compose.next.yml`（三个 wotb 镜像钉住本次 `sha-<SHA>` 标签），`docker compose -f docker-compose.next.yml pull` 成功后才把当前正式 compose 备份为 `docker-compose.prev.yml` 并替换，再 `up -d`。
4. 部署后三端健康检查（后端 `/api/health`、前端经 nginx E2E、Keycloak realm 可用性）：失败自动回滚到上一份 compose 并重新验证；回滚也失败时保留现场、输出日志并让 workflow 失败，人工介入。

**必须配置的 GitHub Secrets**（迁移/换仓库时容易漏）：
- `VPS_HOST` / `VPS_USER` / `VPS_PORT` / `VPS_SSH_KEY` —— VPS SSH。
- `KC_ADMIN_PASSWORD` / `DB_PASSWORD` —— Keycloak 与 PostgreSQL 密码。
- `KEYCLOAK_ADMIN_CLIENT_SECRET` —— 后端 Keycloak Admin API 服务账号 secret。

**已知坑 & 现有对策**（改 workflow/Dockerfile 时别踩回去）：
- backend/frontend/keycloak 镜像各推 `sha-<SHA>` + `latest`；**生产 compose 钉住 `sha-<SHA>`，不使用 `latest`**（`latest` 仅作镜像仓库入口）。**每次生产部署三件套镜像全部构建**（`build-backend`/`build-frontend`/`build-keycloak` 无条件执行；`changes` 路径检测只保留测试门禁）。部署失败自动回滚：新 compose 以 `docker-compose.next.yml` 暂存、`pull` 成功后才备份 `docker-compose.prev.yml` 并替换正式文件（pull 失败不污染正式 compose 与回滚目标），健康检查失败时恢复上一份 compose、`pull` + `up -d` 并复检；`DEPLOYED_SHA` 只在成功/回滚成功时更新。
- **镜像清理时机**：`docker image prune -af` 只在健康检查通过（或回滚成功）后执行，避免失败时旧镜像被提前清掉；GHCR 保留最近 5 个版本（`deploy.yml` 成功后才清理），回滚目标始终可拉取。
- **VPS 上可能有遗留旧容器占端口** → 部署脚本会先 `docker rm -f wotb-backend wotb-frontend` 腾出 8088，`up -d` 带 `--remove-orphans`。
- **SSH 脚本必须 `set -e`** → 否则 `docker compose up` 失败仍退出 0，Actions「假绿」而站点不更新（本会话真实发生过）。
- **构建上下文是仓库根**（前端 `utils/helpers.js` 跨目录 `import ../../../common/map_names.json`，后端要 `common/*.json`）。仓库根 `.dockerignore` 排除 `**/node_modules`、`**/target`、`**/dist`、`common/data` 等。
- 镜像层用 GitHub Actions 缓存（`type=gha`）加速。
- deploy 与 database-backup 共用 `production-maintenance` concurrency，且 `cancel-in-progress: false`，避免部署（含回滚阶段）与备份互相中断。

**数据库保护**：`.github/workflows/database-backup.yml` 每日香港时间 03:15 备份两库；归档在 `/opt/wotb/backups/{wotb,keycloak}/`，完整读取校验后分库保留 7 天。恢复只允许 SSH 手动执行 `deploy/postgres-restore.sh`，必须传对应目录文件和 `--confirm RESTORE-<database>`；脚本先做安全备份，失败时依赖服务保持停止。

**赞助运行时配置**：二维码不在仓库/镜像内。VPS 使用 `/opt/wotb/config/sponsor-config.json` 与 `/opt/wotb/config/sponsor/{alipay,wechat}.png`，前端容器只读挂载。部署只在配置不存在时写入 `deploy/sponsor-config.example.json` 的 disabled 默认值，绝不覆盖线上二维码；更新二维码无需重建镜像。

> 部署后验证：站点强刷（`Ctrl+Shift+R`，绕开旧 `index.html` 缓存）。若 Actions 绿但站点没变，多半是 VPS 容器/端口或上层缓存问题，去看 `Deploy via SSH` 步骤日志里的 `docker compose` 输出。

---

## Git / 推送（个人项目，勿碰公司基建）

- **远程**：执行前先 `git remote -v` 确认实际 remote（本机 remote 名/SSH 别名以本机配置为准，不写死）；仓库账号 **`A158Coke`**。推送：`git push <实际 remote> main`
- **绝不**使用任何公司 token / 凭据。
- **提交信息**：中文，结尾带 `Co-Authored-By`（若工具支持）。
- ⚠️ **提交信息别用 `git commit -m @'...'`** —— 那是 PowerShell here-string，在 **bash** 里 `@` 会变成提交首行（历史里能看到一串以 `@` 开头的提交就是这么来的）。bash 里用普通双引号 `-m "..."` 或多个 `-m`。
- 行尾：仓库混用 LF/CRLF，`git add` 常报 `LF will be replaced by CRLF` 警告，无害。

---

## 测试策略

### BoosterServiceTest

打手业务使用 Mockito + `@ExtendWith(MockitoExtension.class)`，不启动真实 Keycloak。

| 测试 | 覆盖点 |
|---|---|
| `shouldClearApprovedApplicationRefWhenDeletingBooster` | 关联审批申请不阻止删除，引用自动解除 |
| `shouldRejectDeleteWhenAssignmentDependenciesExist` | 有活跃订单时拒绝删除 |
| `shouldNotChangeRoleWhenDeletePersistenceFails` | 数据库失败不操作 Keycloak |
| `shouldDeleteProfileBeforeRemovingRole` | DB 删除在 Keycloak role 移除之前 |
| `shouldRestoreRemovedRoleWhenDeleteTransactionRollsBack` | 事务回滚恢复已移除的 role |

### Keycloak 相关测试策略

不要在普通单元测试里启动真实 Keycloak。Keycloak Admin API 应该通过 `KeycloakAdminUserService` 接口封装，业务 service 测试中 mock 它。

真实 Keycloak 集成测试后续再考虑，不作为 MVP 必需。

### 测试运行

```bash
cd java && mvn -s settings.xml test
cd frontend && npm test
```

---

## 专题文档（已从本文件拆出，按需阅读）

| 主题 | 文档 | 何时读 |
|---|---|---|
| AI 复盘架构（双 Call / 团队复盘 / Autopsy / 范围边界 / 预算） | `docs/architecture/ai-review.md` | 改 AI 复盘 / 证据链 / prompt 时 |
| 完整回放重建流水线 | `docs/architecture/replay-pipeline.md` | 改重建 / decoder 时 |
| 地图鸟瞰与战局回放 | `docs/features/battle-playback.md` | 改地图鸟瞰 / 战局回放 / 坦克标记时 |
| 评分（Rating）与潜在伤害 | `docs/features/rating.md` | 改评分 / 潜在伤害时 |
| 排行榜 | `docs/features/leaderboard.md` | 改排行榜时 |
| Team AI 复盘设计 | `docs/features/team-ai-review.md` | 改团队复盘产品语义时 |
| 回放数据字典 | `docs/reference/replay-data.md` | 深入回放格式 / 字段时 |
| 已确认字段字典 | `docs/reference/replay-parsed-fields.md` | 查字段含义时 |
| 地图目录 | `docs/reference/maps.md` | 加地图素材时 |
| 逆向研究（protocol / turret / visibility / capture-probe） | `docs/research/replay/*.md` | 逆向 packet / 方向 / 可见性 / 占点时 |
| 观测运维 | `docs/operations/observability.md` | 动监控 / 日志 / 保留策略时 |
