# Developer Guide

> 动手前先读这一份。接手维护的人或 AI 都适用。

---

## ✦ 给接手的一句话

这是个单人维护的 WoT Blitz 回放分析工具（Java core + Spring Boot + Vue + Keycloak，Web 版）。
动手前读 `.agents/AGENTS.md` 和本文件；跨层改动按 `.agents/wotb-sync.md` 的配方；
Maven 必须 `-s java/settings.xml` 且 `JAVA_HOME` 指向 JDK 21；
改完跑 `mvn -s settings.xml test`、`npm test` 和 `npm run build`；
提交用中文信息、推 `github-personal`（账号 A158Coke），push main 即自动部署。

---

## 文档地图

| 文档 | 作用 | 何时读 |
|---|---|---|
| **本文件 `DEVELOPER_GUIDE.md`** | 开发指南（含环境、架构、部署、约定） | 最先 |
| [`.agents/AGENTS.md`](../.agents/AGENTS.md) | AI 硬性约定（RULES） | 动手前必读 |
| [`.agents/wotb-sync.md`](../.agents/wotb-sync.md) | 跨层改动检查单（配方 A–G） | 增删/改名数据列、改解析/导出/前端时 |
| [`docs/replay-data.md`](replay-data.md) | data.wotreplay 事件流格式、protobuf 字段表、死亡时间推算 | 深入回放格式时 |
| [`docs/rating-system.md`](rating-system.md) | 评分算法细节 | 碰评分时 |
| [`docs/rating-progress.md`](rating-progress.md) | rating 扩展目标、已完成项、缺口与下一步 | 接手 rating 扩展时 |
| [`docs/observability.md`](observability.md) | 可观测系统（日志/指标/Grafana/Prometheus/Loki/Alloy）运维与排障 | 动监控、查日志、调保留策略时 |
| [`docs/auth/wargaming-asia-login.md`](auth/wargaming-asia-login.md) | Wargaming.net ASIA / EU / NA 登录需求与实现（决策 D1–D18） | 改认证/账号绑定/登录页时 |
| [`docs/auth/wargaming-asia-deployment.md`](auth/wargaming-asia-deployment.md) | WG 登录部署与 Admin Console 手工配置（运维手册） | 上线/排障 WG 登录时 |
| [`docs/auth/keycloak-mapper-guide.md`](auth/keycloak-mapper-guide.md) | Keycloak Protocol Mapper / Client Scope 机制与生产补 mapper 指南 | JWT 缺 claim / 改 claims / 加 client scope 时 |
| [`CHANGELOG.md`](CHANGELOG.md) | 版本历史（对外） | 了解发布历史 |
| [`README.md`](../README.md) / [`java/README.md`](../java/README.md) | 用户向概览与文档索引；Java/Web 运行、接口、构建 | 跑起来时 |
| [`TODO.md`](TODO.md) | 待办（含已完成收尾记录与下一步） | 找下一步做什么 |

> `.agents/AGENTS.md` / `wotb-sync.md` 本就是写给"任意 AI/人"的，不绑定特定工具。

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

> **测试夹具**：真实回放断言读取 gitignored 的 `common/data/*.wotbreplay`；新克隆或 CI 无样本时只跳过对应样本测试，其余 parser、service、security、API 契约与 controller 测试仍执行。`WebApiTest` 的 PostgreSQL 集成路径在无 Docker 时条件跳过。

---

## 硬性约定

- **改动即更新文档**（同一次提交）。影响界面/导出/数据/构建/用法的改动，必须同步本文档 + 相关 README。
- **API 纯英文**：DTO 只回 raw enum、稳定 `code`/`error` + 数据，**不放 `*Label` 或 `message`**；显示名/错误文案归前端三语 locale。
- **显示名分两类出口**（改列名要全改）：
  - 前端：`frontend/src/locales/{zh,en,ru}.json` 的 `player_labels` / `agg_labels`（**三语都改**）。
  - 导出：`Columns.java`（单场 xlsx）、`AggregateSheets.java`（汇总 xlsx，仅中文）。
- **单一数据源**：`common/tankopedia-tier{7,8,9,10}.json`（车辆库，按等级拆分 4 个文件）、`common/rating.json`（评分参数）、`common/map_names.json`（地图三语名）。构建时由 `wotb-core/pom.xml` 复制到 classpath；**勿在模块内放副本**。
- **车辆库更新（blitzkit 单一来源）**：推荐手动触发 GitHub Actions **`Update Tankopedia`**——runner 直接从 `assets.blitzkit.app/definitions/tanks.pb` + `consumables.pb` + `provisions.pb` + `equipment.pb`（游戏客户端数据，公开 CDN，无 IP 白名单，无需任何 secret）同步并自动提交回 main。本地跑 `cd common/python && python update_tankopedia.py` 即可。数据源为什么不用 WG 百科：WG 滞后于游戏版本（11.19 的 SPHT / AC Atlas 等缺失）且 application_id 有 IP 白名单限制。脚本旧数据只从 `--existing-dir` 目录读取（`tankopedia-tier*.json`，用于保留 extraInfo）、新数据只写 `--output-dir`（workflow 两者路径分离，输入输出互不覆盖），只输出 7–10 级 4 个文件。每个文件为 `meta` + `vehicles` 数组（全部字段与值均为英文/数字）：每辆车一条记录 `name/id/tier/class/nation/hp/forwardSpeed/reverseSpeed/turretRotationSpeed/hullRotationSpeed/powerToWeightRatio/guns/allowedProvision/allowedConsumables/allowedEquipment/extraInfo`。`guns` 数组含该车顶配炮塔的全部炮（7–9 级一把、10 级多炮车多把），每把带 `gunId/isDefault/alphaDamage/shells`（shells 每发 `{type, damage, penetration}`，type 归一化 ap/apcr/heat/he，顺序即游戏内弹序；多炮用 `isDefault` 判断默认炮）；`allowedProvision`/`allowedConsumables` 由 blitzkit 的 include/exclude 过滤器（tier/ids/clip/nations）判定后映射为 `common/wotb-item-catalog-json` 的逻辑 id / code；`allowedEquipment` 由车辆 `equipment_preset` 槽位装备映射为 catalog 装备 code（含 VK 72.01 俯角/履带齿、Type 71 改进悬挂等专属装备）；手工维护的 `extraInfo`（个人知识点）按 tank_id 保留合并，仍存在车辆的知识点丢失会直接失败。AI prompt 会注入结构化事实（车种/等级/国家/炮伤/血量/知识），prompt 规则白名单已放行这些字段。
- **代码风格**：不可变模型用 `record`；可变模型用公有字段 POJO（**不引入 Lombok**）；局部变量/参数尽量 `final`。
- **分层**：controller 只做 HTTP；业务在 service；core 按功能分包。新 endpoint 的逻辑写进 service。
- 跨层联动改动（加列/改解析/改评分/改地图名…）务必按 `.agents/wotb-sync.md` 的配方走。

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
├── docs/                       # 文档（TODO / DEVELOPER_GUIDE / CHANGELOG / replay-data / rating-system / observability / team-ai-review-feature）
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
│   ├── workflows/deploy.yml      # 测试门禁 + 增量构建/部署
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
│   ├── wotb-sync.md              #   跨层改动检查单（配方 A–G）
│   └── skills/                   #   审查类技能（grill-fix / code-smell / column-sync / wotb-sync）
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
| `AiReplayAnalysisService` | `wotb-web/.../ai/AiReplayAnalysisService.java` | 玩家/团队 AI 调用、上游错误分类与 context 编排 |
| `AiCancellationRegistry` | `wotb-web/.../ai/gateway/AiCancellationRegistry.java` | in-flight AI 请求取消注册表（客户端取消 → 中断上游调用，稳定错误码 `AI_CANCELLED`） |
| `ApiPaths` | `wotb-web/.../config/ApiPaths.java` | API URL 常量单一来源（SecurityConfig 匹配器与 Controller 映射共用） |
| `TeamAiPromptBuilder` | `wotb-web/.../ai/TeamAiPromptBuilder.java` | 确定性团队输入压缩和 token 估算预算（`BudgetWriter` + `AiTokenEstimator`） |
| `PlayerSideResolver` | `wotb-core/.../processing/PlayerSideResolver.java` | 随机战斗友方/敌方/未知解析（FRIENDLY/ENEMY/UNKNOWN），基于录像者权威 team |
| `FriendlyEnemyResult` | `wotb-core/.../processing/FriendlyEnemyResult.java` | 三态胜负转换（FRIENDLY_WIN/ENEMY_WIN/DRAW_OR_UNKNOWN） |
| `PlayerAnalysisPromptFormatter` | `wotb-web/.../ai/PlayerAnalysisPromptFormatter.java` | AI Prompt 格式化（友方/敌方标签，独立于 Excel 导出的 PlayerResultFormat） |
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

## AI 分析范围边界

AI 复盘区分两种 scope，互不混用：

### TEAM_PERSPECTIVE（训练房 / 联赛）

- 分析对象是录像者所在整支队伍。
- 保持独立 `perspectiveTeam` 内部语义（用于后端计算，不暴露给 AI）。
- 不使用随机战斗的 FRIENDLY/ENEMY formatter（`PlayerAnalysisPromptFormatter`）。
- **dominant clan 队伍标签**（`TeamPerspectiveLabelResolver`）：根据 roster 中成员人数最多的军团生成用户可见名称，如 `CHRD`；军团人数并列或无军团时使用稳定 fallback `队伍-<hash>`。
- **地图名称映射**（`MapNames.cn()`）：使用 `common/map_names.json` 单一数据源，AI prompt 中输出中文地图名。
- **Tank ID 映射**：`PlayerResult.tankName` 已在解析阶段通过 `common/tankopedia-tier{7,8,9,10}.json` 填充，AI prompt 直接使用。
- **500×500 九宫格区域**（`MapRegionResolver`）：地图业务尺寸 500×500，+Z 为地图上方。Replay 坐标范围约 ±1000（基于 `docs/replay-data.md`），线性映射到 0…500。区域编号：1|2|3（顶行）、4|5|6（中行）、7|8|9（底行）。无法解析时返回 UNKNOWN/0。
- **结构化 cluster**（`TeamFormationCluster`）：每个 cluster 包含 canonical centroid（`CanonicalMapPosition`，500×500）、region（基于 canonical centroid）、memberIdentities、memberCount、confidence、startTime（battle-relative）、endTime。centroid 计算顺序为「先对每个成员位置 resolve/clamp 到 canonical，再在 canonical 空间求平均」（不是先平均 raw 再转换）。`TeamFormationPhase.clusters` 派生 `clusterCount()`；`TeamFormationPhase.centroid` 亦为 `CanonicalMapPosition`，prompt 用 `formatCanonicalPosition(...)` 输出（含 region，不再 raw 二次映射）。构造时验证时间合法性、region 1-9、memberCount 等于有效 identities 数。
- **movement 单位**：distance/speed 使用 canonical 米（`MapRegionResolver.canonicalDistanceMeters(...)` 每端点先转 canonical 再求欧氏距离），speed = 米 / battle-relative 秒；stationary 阈值 `STATIONARY_THRESHOLD_METERS`（canonical 米）集中定义，Player 与 Team member movement 共用同一算法；无效/倒序/零时间差不产生 Infinity/NaN 速度，INVALID 坐标位置不参与 movement。
- **battle-relative phase end**：`findBattleEndEvidence(...)`/`lastObservedClock(...)` 使用 `BattleStartResolution` 把 replay raw clock 转成 battle-relative；`battle.durationS` 直接使用不再二次减 start。`buildRelativePhases(firstContactRelative, battleEndRelative)`：`UNKNOWN_FIRST_CONTACT=-1`，`firstContact==0` 合法，`openingEnd` 裁剪进 battle end，非法/非有限 battleEnd 返回空 fallback；每个 phase 由 `BattlePhaseSummary` 不变量兜底 `finite/>=0/start<=end`。
- **coverage 不变量**：单一共享 `classifyTime(event)`（USABLE/INVALID_TIMESTAMP/PRE_BATTLE）被 damage 循环、`teamPositionsByEntity`、`auditPositionEvidence` 与 phase guard 复用。invalid-timestamp damage 只计入 invalid-timestamp coverage，不计入 unattributed；pre-battle 与无效时间戳的 damage/position 不进入战术统计；`observedPositionEventCount`/`clampedPositionEventCount` 由同一分析集合派生，`TeamFeatureCoverage` 强制 `0<=clamped<=observed`；INVALID（丢弃）与 CLAMPED（降级但参与分析，附 `MAP_COORDINATES_CLAMPED` limitation）区分。
- **MovementSegment 不变量**：compact constructor 强制所有 float 有限、时间/距离/速度非负、`start<=end`、`type`/位置/`confidence` 非空；坐标字段命名为 `rawStartPosition`/`rawEndPosition`，显式标注 raw replay 坐标域（distance/speed 为 canonical 米）。
- **battle phases**：通过 `BATTLE_PHASES` 输出 start/end time 和 phase type。
- **uniqueBattleCount**：multi-perspective 中区分 perspective count 和 unique battle count，同一场战斗的 opposing perspective 只算一个 battle。
- **MemberIdentity**：accountId > 0 时优先使用 accountId；accountId ≤ 0 时使用规范化 nickname（trim、Locale.ROOT、case-insensitive）。用于 engagement 匹配、cluster 成员标识和 key events 的全链路 identity。
- **prompt 禁止 raw team**：AI prompt 中不出现 `perspectiveTeam=1/2`、`winnerTeam=1/2`、`Team 1/2`、`队伍1/2`。使用 `teamLabel=`、`result=TEAM_WIN/TEAM_LOSS/DRAW_OR_UNKNOWN`。BATTLE_END key event 同样使用 `result=` 三态。
- **secret redaction**：AI provider 错误摘要优先使用 Jackson tree JSON 递归隐藏敏感 key。`isSensitiveKey()` 归一化匹配覆盖 x-api-key、AWS Access Key、大小写/连字符/下划线变体。文本回退脱敏 `redactNonJson()` 采用分层正则策略：(1) `Authorization:` 前缀行整个隐藏；(2) JSON key-value 已知敏感 key 脱敏；(3) 无引号 key=value 脱敏；(4) AWS Signature/Credential 脱敏；(5) 已知 auth scheme（bearer/basic/digest）大小写不敏感，credential 任意长度，始终脱敏；(6) PascalCase custom scheme（如 `CustomScheme`、`TokenV2`）credential ≥ 3 脱敏；(7) 含数字的 scheme（如 `tokenv2`、`auth2`）credential ≥ 3 脱敏；(8) 小写 custom scheme 仅 credential 含非字母字符（数字或标点）时脱敏，避免自然语言误判。Digest auth 参数（response/nonce/opaque 等）独立脱敏。
- **battle start resolution**：`BattleStartResolver.resolve(reconstructionBattleStart, diagnostics)` 返回 `BattleStartResolution`（IDENTIFIED / ESTIMATED / UNRESOLVED）。仅通过静态 factories 构造。准备阶段静止不进入 STATIONARY；formation/first contact/engagement/key events 使用 `battleRelative(rawClock)`。`PRE_BATTLE_START_ESTIMATED`/`PRE_BATTLE_START_UNRESOLVED` limitation 传播。

### PLAYER_FOCUSED（随机战斗）

- 分析对象是录像者个人。
- 使用 FRIENDLY / ENEMY / UNKNOWN 标签，禁止输出"队伍1/队伍2"。
- 录像者所属队伍 → 友方；另一队 → 敌方。
- 录像者在原始 team 2 时仍正确识别为友方（`PlayerSideResolver`）。
- 胜负使用完整三态（`FriendlyEnemyResult`）：友方获胜 / 敌方获胜 / 平局或未知。
- 同一录像者的多场随机战斗分析会对每场战斗独立解析录像者视角。
- 胜率只统计已知胜负场数，平局/未知不作为失败。
- `PlayerResult.team` 原始编号不受影响（仅用于内部计算）。
- AI Prompt 由 `PlayerAnalysisPromptFormatter` 格式化（独立于 `PlayerResultFormat`）。

### AiModelProperties 配置

| 属性 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `apiKey` | `AI_API_KEY` | 空 | DeepSeek API Key；为空时应用正常启动，AI 调用返回 `AI_NOT_CONFIGURED` |
| `baseUrl` | `AI_BASE_URL` | `https://api.deepseek.com` | Provider Base URL |
| `model` | `AI_MODEL` | `deepseek-v4-flash` | 模型字符串，原样传递给 Provider |
| `connectTimeoutSec` | `AI_CONNECT_TIMEOUT_SEC` | 10 | 连接超时（秒） |
| `timeoutSec` | `AI_TIMEOUT_SEC` | 300 | 单次 read/response 超时（秒） |
| `callTimeoutSec` | `AI_CALL_TIMEOUT_SEC` | 315 | **整个 `AiChatGateway.chat()` 的总时间预算**（首次请求 + 全部 retry + 全部 backoff + 响应解析），必须 ≥ connect + read |
| `retryMaxAttempts` | `AI_RETRY_MAX_ATTEMPTS` | 3 | 总预算允许范围内的最大尝试次数（含首次） |
| `retryInitialBackoffMillis` | `AI_RETRY_INITIAL_BACKOFF_MS` | 1000 | 首次重试等待（毫秒） |
| `retryMaxBackoffMillis` | `AI_RETRY_MAX_BACKOFF_MS` | 8000 | 重试等待上限（毫秒） |
| `retryBackoffMultiplier` | `AI_RETRY_BACKOFF_MULTIPLIER` | 2.0 | 指数退避倍数 |
| `contextWindowTokens` | `AI_CONTEXT_WINDOW_TOKENS` | 1000000 | DeepSeek 上下文窗口大小 |
| `singleReplayMaxInputTokens` | `AI_SINGLE_REPLAY_MAX_INPUT_TOKENS` | 940000 | 单回放输入硬上限 |
| `maxOutputTokens` | `AI_MAX_OUTPUT_TOKENS` | 32768 | 单次请求最大输出 |
| `promptSafetyMarginTokens` | `AI_PROMPT_SAFETY_MARGIN_TOKENS` | 16384 | 安全余量 |
| `thinkingEnabled` | `AI_THINKING_ENABLED` | true | 是否启用思考模式 |
| `reasoningEffort` | `AI_REASONING_EFFORT` | max | 推理力度（high/max） |

启动时校验 `totalReserved <= contextWindowTokens`，不合规则 Spring Boot 启动失败。

### Token 估算器

`ConservativeDeepSeekTokenEstimator` 使用 `codePointCount * 1.25` 保守估算 token 数。精确 token 数通过 API 响应的 `usage` 字段获取。

---

### Spring AI 集成

- 项目使用 **Spring AI 2.0.0**（BOM 在父 POM dependencyManagement 管理），生产 transport adapter 为 `SpringAiChatGateway`：官方 **OpenAI-compatible adapter**（`spring-ai-starter-model-openai`）连接 `https://api.deepseek.com`。原因：2.0.0 的 DeepSeek Starter 无法传递 `thinking`/`reasoning_effort`，这两个字段经 OpenAI adapter 的 `extraBody` 机制原样发送。
- 业务层只依赖项目内 `AiChatGateway` 接口；Spring AI / OpenAI SDK 类型只存在于 `gateway` 包。Replay 领域逻辑（`wotb-core`）不依赖 Spring AI。
- 缺少 `AI_API_KEY` 时应用正常启动，`/api/replay/analyze` 返回 `AI_NOT_CONFIGURED`；其余功能不受影响。
- timeout/retry 由 `AiRetryPolicy` 单层控制（SDK `maxRetries=0`，无双重重试）；可重试：429、连接失败、500/502/503/504；不重试：**超时（`AI_TIMEOUT`——上游可能已完成并计费，重试会重复扣费）**、认证/权限、invalid request、context too large、空/无效 completion。
- 总调用边界：`AI_CALL_TIMEOUT_SEC` 使用单调时钟（`System.nanoTime`）覆盖一次 `chat()` 的整个生命周期（含响应体读取与 SDK 解析）；每轮尝试前检查剩余预算，backoff 不得超过剩余预算，in-flight 请求会在预算耗尽时被中止（okhttp interceptor 捕获 Call + 看门狗，覆盖连接→发送→等待→响应体读取→反序列化；成功返回前还会复检 deadline），因此单轮实际请求时间上限为 `min(AI_TIMEOUT_SEC, 剩余预算)`。预算耗尽统一返回稳定 `AI_TIMEOUT`，超时后绝不返回 success。
- **全链路超时对齐**（改 nginx/Dockerfile/前端时必须保持）：后端 AI 单次调用预算 `AI_CALL_TIMEOUT_SEC=315s`（connect 10 + read 300 + 重试/backoff/解析余量）；回放解析可能额外占用数十秒；容器 nginx 对 `/api/replay/analyze` 的 `proxy_read/send_timeout` 为 **420s**（余量防 504）；前端 analyze 请求安全超时 **400s**（`ReconstructionPage.vue` 的 `AI_ANALYZE_TIMEOUT_MS`），在代理 504 之前给出干净 `AI_TIMEOUT`。host 级 Caddy/Nginx 反代也必须允许 ≥420s，否则会提前 504。
- **客户端取消 → 上游中断**：analyze 请求携带 `correlationId`；前端取消按钮 / 页面离开（`beforeunload` keepalive）/ 前端超时会调用 `POST /api/replay/analyze/cancel`，后端 `AiCancellationRegistry` 命中后取消 in-flight okhttp Call 并停止重试（稳定错误码 `AI_CANCELLED`），避免为无人等待的响应继续计费。
- Prompt/completion 默认不记录、不进 metrics；Spring AI Observation 未启用（NOOP）。日志经 `AiSecretRedactor` 集中脱敏。
- 测试不调用真实 AI API：`SpringAiChatGatewayTest`/`SpringAiChatGatewayMetricsTest` 使用 mock `ChatModel`。
- **AI 输出语言跟随前端 locale**：`/api/replay/analyze` 的 multipart 表单字段 `lang`（必填，白名单 `zh`/`en`/`ru`）控制 AI 复盘输出语言；缺失时由 Spring 返回 `400`，空白或未知值返回 `400 UNKNOWN_LOCALE`。语言穿透 ReviewService → facade → Player/Team Service → Prompt Builder：ZH 直接使用原有中文 system prompt（字节级不变）；EN/RU 在中文基座上替换互斥的中文输出强制句（输出语言、称谓、车种、时间格式、未知字段与无法确定措辞），业务事实约束（不编造、坦克专有名词原样、perspective/friendly-enemy、权威结算与观测子集、注入防护、数据限制）不变。en 时间格式统一为 `Xm Xs`（如 `1m 15s`、`3m 0s`、`3m 12s`），ru 为 `X мин X с`（如 `1 мин 15 с`、`3 мин 0 с`、`3 мин 12 с`）。覆盖 player full/fallback/multi 与 team single/multi 全部路径；地图/坦克/clan/昵称等专有名词不翻译；`limitations` 与错误码仍为英文稳定码、由前端本地化。前端由 vue-i18n 当前 locale 携带 `lang`。

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
- AI 复盘页组件：`ReconstructionPage`（登录门控 + 编排）→ `ReplayInputPanel`（`ReplayFilePicker` 选文件 + `ReplayAnalysisAction` 触发分析）→ `AnalysisResultPanel`（Markdown 正文常驻展示，`MarkdownContent` 渲染）
- 回放解析上传页由 `FileUploader.vue` 负责交互，`App.vue` 提供全局上传区样式；空态、拖拽态、已选文件态共用 `upload.*` 三语文案。
- 开发时 Vite 代理 `/api → localhost:8087`。
- 语言持久化 `localStorage('wotb-lang')`，主题持久化 Cookie `wotbtools-theme`（domain `.wotbtools.com`）+ localStorage 回退。
- 回放预览列配置持久化使用 `localStorage`：`wotb-replay-player-visible-cols`、`wotb-replay-player-order`、`wotb-replay-agg-visible-cols`、`wotb-replay-agg-order`。读取缓存时需按当前响应列集合清洗，避免旧缓存吃掉新列。
- 内联 SVG 图标统一使用全局 `.ic` 描边样式；上传按钮使用 `.filebtn input { display:none; }` 隐藏原生文件控件，避免浏览器默认控件破坏布局。
- `BoostPage.vue` 的打手管理页同时展示两套状态：`booster_profile.status` 是资格状态（`ACTIVE/INACTIVE/BANNED`），接单状态由 `booster_profile.available + activeAssignmentCount` 推导（可接单/忙碌/暂停接单）。分配弹窗按资格、接单状态、活跃订单数、等级和擅长内容排序推荐打手；改动任一含义时，务必同步三语 locale。
- `ProfilePage.vue` 是个人主页，展示用户身份、WoTB 账号绑定、排行榜记录和站内通知面板；若当前用户是打手，还会显示接单状态与进行中/历史订单。未登录时直接跳转 Keycloak 托管登录页（无自定义登录页）。Wargaming 官方账号（`wotbAccountSource=WARGAMING` 或 JWT 明确为 WG 登录 `isWargamingLogin`，覆盖 ASIA/EU/NA）显示来源 Wargaming.net 与已验证状态，资料只读（无编辑/解绑按钮）；**同步失败不再静默**——显示「同步失败 + 重试」，且绝不显示手动绑定入口；服务器标签按实际区服展示（中国/亚洲/欧洲/北美），页面加载后调用一次 `PUT /api/users/wotb-account/from-login` 幂等同步昵称。通知面板在右侧栏顶部，点击展开通知列表（最近 30 条），支持单条已读和全部已读，未读数字小红点提示。打手接单状态通过 `PATCH /api/boost/boosters/my/availability` 让打手本人暂停/恢复接收新订单；这个开关只影响新订单，不会隐藏已有进行中订单。
- 陪练订单生命周期由 `boost_request.status` 表示：`NEW/REVIEWING/MATCHED/ACCEPTED/IN_PROGRESS/PENDING_CONFIRM/CLOSED/EXCEPTION/REJECTED/CANCELLED`。打手单次接单生命周期由 `boost_request_assignment.status` 表示：`ASSIGNED/ACCEPTED/IN_PROGRESS/PENDING_CONFIRM/DECLINED/CANCELLED/COMPLETED/EXCEPTION`。订单完成、取消、拒绝或拒单时设置 `unassigned_at` 释放打手忙碌状态。
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

## 潜在伤害与实时 rating

扩展分析页同时支持主 SPA 路由 `?view=extended` 和独立 `/extended` 多页构建入口；生产 nginx 对 `/extended` 映射到 `extended.html`，Spring 静态资源由 `StaticForwardController` 转发。

新增字段：
- 单场玩家列：`alpha_damage`、`rank`、`potential_damage`、`potential_damage_supplement`、`potential_damage_detail`。
- 汇总列：`potential_damage`、`potential_damage_avg`、`potential_damage_supplement_avg`。
- 实时 rating 展示列：`rating`、`kast`、`contribution`、`impact`、`damage_avg`、`potential_damage_avg`、`potential_damage_supplement_avg`、`assist_avg`、`multi_damage_rate`、`kills`、`kills_avg`；`contribution` 仅展示，不参与最终权重；`average_hp` 和 `account_id` 不再展示。

`frontend/src/composables/useColumns.js` 会过滤 `EXTENDED_ONLY_PLAYER_KEYS`，所以原回放解析页面不展示扩展专用列；扩展页 `/extended` 直接读取 `playerColumns`，可展示完整字段。列选择器缓存只作用于原回放解析页，不影响扩展页完整字段展示。

`ReplayParser` 仍解析 `xp`、`credits` 到 `PlayerResult`，但这两个值受经济/加成/首胜等因素影响，不作为玩家战绩展示字段、导出列或 rating 输入。

`Tankopedia` 读取车辆库（`common/tankopedia-tier{7,8,9,10}.json`，blitzkit 生成，全部英文/数字）：`name` / `tier` / `class`（英文） / `nation`（英文） / `hp` / 默认炮（`guns` 数组第一把或 `isDefault=true`）的 `alphaDamage` / 手工 `extraInfo`。`alphaDamage` 取标准弹（`shells[0]`，已用真实数据验证；HE 往往伤害更高故禁止 `max`）；`hp` = 车体 + 顶配炮塔；`forwardSpeed`/`reverseSpeed` 来自 `speed_forwards`/`speed_backwards`，`turretRotationSpeed` 取顶配炮塔 traverse，`hullRotationSpeed` 取顶配履带 traverse，`powerToWeightRatio` = 顶配引擎功率 / 车重。10 级多炮车（如 E 100 的 12,8cm/15cm、AC Atlas 的 V1/V2）在 `guns` 数组中按炮区分，第一把为 `isDefault`（与 WG 默认配置一致，已用 WG API 核对）。刷新时旧数据只从 `--existing-dir` 读取、新数据只写 `--output-dir`（Workflow 两者路径分离），并按 tank_id 保留合并旧文件中的 `extraInfo`（兼容旧 `extraKnowledge`），若仍存在的车辆知识点丢失会直接失败。`average_hp` 的目标口径是"敌方 7 台车实际进场总血量 / 7"，但回放里的每台车实际进场血量 / 双方总血量字段尚未确认解析；当前实现为：车辆库有 HP 时用车辆库，否则未知单车 HP 暂定 2400。

`ReplayParser` 会从 `data.wotreplay` 的 Type 8 / subtype 8 / sub=3 direct HP damage 事件解析攻击者、受害者和伤害值；当阵亡玩家的累计 direct damage 达到 `damageReceived` 阈值时，当前攻击者被推断为击杀者，并把该击杀者对受害者的累计 direct damage / penetrations 写入 `PlayerResult.killVictims`。

`PotentialDamage.apply(...)` 会读取 `killVictims` 和 `Tankopedia.alphaDamage`，按 `0.9 * alphaDamage * penetrations` 补增潜在伤害。若回放事件缺失、entity_id 无法映射、特殊伤害未被 direct HP damage 覆盖，仍保守回退为 `potential_damage == damage_dealt`、`potential_damage_supplement == 0`、`potential_damage_detail == 未解析`。

`POST /api/rating` 只基于本次上传的 multipart 回放实时计算，不落库、不读取历史记录；`GET /api/rating` 仍保留为旧评分参数接口。扩展页的实时 rating 由 `RatingAnalyzer` 独立计算，不替换原解析页/导出的旧 `Rating.compute(...)` 字段。

实时 rating 公式：
- `average_hp`：目标口径为敌方 7 台车实际进场总血量 / 7；当前真实进场血量字段尚未解析，车辆库无 HP 时未知单车 HP 暂定 2400。
- `KAST`：参考 CS2/CS:GO 的 Kill / Assist / Survive / Traded 思路，单场取 `damage/(average_hp*1.15)`、`assist/(average_hp*1.25)`、`win && survived ? 1 : 0`、`traded_death ? 1 : 0`、`(damage+assist)/(average_hp*1.20)` 的最大值，再跨场平均并封顶 100。
- `impact`：统计全部场次，按 `damage + assist` 在双方总池中的占比（期望份额 `1/14`）和人头折算成 Impact 百分比。
- `contribution`：全场 `damage + assist + kills * average_hp / 7` 在本方队伍中的占比。
- `multi_damage_rate`：单场满足 `damage >= average_hp*1.5`、`damage >= average_hp*1.2 && kills >= 1`、`damage >= average_hp && kills >= 2`、`kills >= 3` 任一条件记为一次多伤。
- `rating`：`potential-DPB`、KAST、Impact、AST（`assist_avg`）、多伤率、场均人头加权得到，当前系数为 0.70 / 0.15 / 0.25 / 0.30 / 0.10 / 0.10，最终乘以 10 输出。

---

## 评分（Rating）

自包含的表现评分（类 WN8 机制，但**期望值来自当前处理的这批战斗，不依赖外部表**）。实现：`wotb-core/Rating.java`。

> **可调项集中在 `common/rating.json`**（权重/阈值/scale/车型系数）——Java 经 classpath 读取，**改它即生效，不必改代码**；文件缺失/损坏则用内置默认。

- **有效贡献 EC** = `伤害 + 0.6*协助 + 0.35*格挡 + 200*击杀`（权重见 `rating.json`）。
- **按车型基准**：从这批数据按车型(轻/中/重/TD)求 EC 均值；某车型样本 `< 5`(含"没有同类车")时 `基准 = 全体均值 × 车型难度系数`(可调常量 `CLASS_FACTOR`，默认 轻坦0.7/中坦0.9/重坦1.0/TD1.0)，避免独苗轻坦被高 EC 的重坦拉低。
- **评分** = `round(1000 * EC/基准 * (1 + 0.05*胜))`；`1000` = 同车型平均。
- **基准范围 = 一起处理的这批战斗**：单场导出即相对该场；多场/预览相对整批。所以 rating 是"相对该批"的，不是绝对天梯分。
- 列：单场「评分」`key=rating`(在 `Columns.STAT`)、汇总「场均评分」`key=rating_avg`(Mapper/AggregateSheets)。计算时机：`ExcelExporter.writeSingle/writeAggregate`(门面) 与 `ReplayService.preview` 在用之前先 `Rating.compute(...)`。

---

## 存活时间（Survival Time）

存活时间列 `survival_time`（单场）和 `survival_avg`（汇总）推算阵亡玩家的死亡时刻：

**3 层 fallback + 假阳性检测：**
1. `deathTimeMillis / 1000`（proto `#104`；v11.18 实测不存在，代码保持兼容）
2. `damageDeathTimes`（Type 8 EntityMethod subtype 8 body[13]=3 直接 HP 伤害事件，累计达 `damageReceived` 阈值）
3. hybrid EntityLeave / Position：EntityLeave 有假阳性时，若 Position 显著晚于 EntityLeave（>5s）则以 Position 为准

**事件流来源：** `data.wotreplay` 文件由 `EventStreamReader` 解析，提取 Type 4 (EntityLeave)、Type 8 subtype 8 (damage)、Type 10 (Position)。详细格式见 `docs/replay-data.md`。

**实现位置：** `EventStreamReader.java`（事件解析 + 死亡推算方法）、`ReplayParser.java`（fallback 编排，第 148–180 行）。

---

## 排行榜（Leaderboard）

MVP 只记录**录像者本人**在某场战斗中用某辆车打出的**单场伤害成绩**，不存全场 14 人，不存 replay 原文件。当前后端为单一在线配置，启动依赖 PostgreSQL。

- **数据库配置**：`application.yml` 始终启用 DataSource/JPA/Flyway，`ddl-auto: validate`；本地开发需提供 PostgreSQL 与 `POSTGRES_PASSWORD`。
- **Schema 来源**：Flyway 迁移 `wotb-web/.../resources/db/migration/V1__init_leaderboard.sql` → `V11__add_boost_completion_confirmation.sql`。**改表结构必须新增迁移**（`V12__...`），不要改已应用的 V1–V11；实体列与迁移列**逐列对齐**，否则 `validate` 启动即失败。
- **打手资格申请**：`booster_application` 保存玩家申请的 WoTB 账号、两张截图、申请等级、QQ/微信、可接单频率、日在线时间和审核状态；同一 Keycloak 用户只允许存在一个 `NEW`/`REVIEWING` 申请。审批通过由 `BoosterService` 先 flush `booster_profile`，再授予 Keycloak `booster` role；外层事务回滚会撤销新增 role。
- **打手资料双状态**：`booster_profile.status` 控制资格是否有效；`booster_profile.available` 控制是否手动暂停接单；`boost_request_assignment` 活跃记录数控制是否忙碌。分配打手时必须同时满足 `ACTIVE`、`available=true`、活跃订单数为 0。`GET /api/booster/assignments` 默认返回打手工作台所需的活跃订单详情（需求状态、联系方式、可安排时间、备注）；`GET /api/booster/assignments?includeHistory=true` 供个人中心回看活跃 + 历史订单，服务端会把仍未释放的订单排在前面；`PATCH /api/boost/boosters/my/availability` 允许打手本人切换是否接收新订单；`PATCH /api/booster/assignments/{id}/accept|start|complete|decline` 只允许当前打手操作自己的活跃订单。
- **仅随机战斗**：只有 `meta.json#arenaBonusType == 1`（随机）的战斗计入；训练房（==2）/娱乐/联赛等其他模式、以及模式未知（null）一律拒绝。`ReplayParser` 解析到 `Battle.arenaBonusType`，策略判断在 `LeaderboardService`。取值经真实样本核实（1=随机、2=训练房）。
- **录像者识别**：`meta.json` 无录像者 `accountId`，`ReplayParser` 仅给出 `Battle.recorder`（昵称）。`LeaderboardService` 按 `nickname.equals(battle.recorder)` 在 `players` 中匹配；匹配不到则跳过（不猜）。
- **去重**：唯一键 `(arena_id, account_id)` —— 同一场+同一玩家唯一；不同玩家/不同场各自成行。保存前 `findByArenaIdAndAccountId` 查重，并发冲突兜底捕获 `DataIntegrityViolationException`。
- **数据列**（V2 新增 `version`/`battle_time`）：`version` 来自 `meta.json#version`（游戏版本号如 `"11.18.0"`），`battle_time` 来自 `meta.json#battleStartTime` epoch ms（战斗实际发生时间），`created_at` 为上传时间。两新列均可 NULL（兼容旧数据）。
- **集成点**：`POST /api/leaderboard/upload` → `LeaderboardUploadService` → `ReplayCapacityLimiter` → `ReplayParser` → `LeaderboardService.saveIfEligible`。预览不落库、不触发上传限流。
- **API**：`POST /api/leaderboard/upload`（上传回放，限流），`GET /api/leaderboard/top-damage?page=&size=`（全局伤害榜），`GET /api/leaderboard/tanks/{tankId}/top-damage?page=&size=`（按车）。
- **解析边界**：最多 100 个回放、单文件 20 MiB、总请求 200 MiB；单实例默认同时处理 2 个任务。ZIP/pickle/protobuf 还有独立预算，容量满返回 503 `REPLAY_BUSY`。

---

## 领域速记

- **回放格式**：zip 包含 3 个文件 —— `meta.json`（战斗信息）+ `battle_results.dat`（pickle + protobuf 战绩）+ `data.wotreplay`（BigWorld 事件流，用于存活时间推算）。字段表见 `docs/replay-data.md`。**不要轻易重命名/删字段**，新字段先进「原始字段」表交叉验证。
- **存活时间**：3 层 fallback（#104 → Damage 伤害事件 → hybrid EntityLeave/Position），详见 `docs/replay-data.md`。
- **评分**：自包含、类 WN8，基准来自"一同计算的这批战斗"（相对分，非绝对天梯）。参数在 `common/rating.json`，前端「评分规则」弹窗 + `GET /api/rating` 实时展示。细节见 `docs/rating-system.md`。
- **数据库**：后端使用 PostgreSQL 18，单一配置始终启用 JPA/Flyway（`ddl-auto: validate`）；本地运行也必须提供数据库与 `POSTGRES_PASSWORD`。Flyway 自动配置依赖 `spring-boot-flyway`。
- **排行榜**：schema 由 Flyway 管理。只记录录像者本人在**随机战斗**（`arenaBonusType==1`）中的单场伤害，去重键 `arena_id+account_id`；由 `POST /api/leaderboard/upload` 显式写入，预览不隐式落库。
- **i18n**：vue-i18n 三语（zh/en/ru），`locales/*.json`；语言持久化在 `localStorage('wotb-lang')`。地图名共享字典 `common/map_names.json` 已接 `zh/en/ru`，网页按当前语言显示，导出仍固定中文。
- **API 端点**：`GET /api/health`、`GET/POST /api/rating`、`POST /api/preview`、`POST /api/export?mode=aggregate|each`；排行榜 `POST /api/leaderboard/upload`、`GET /api/leaderboard/top-damage?page=&size=`、`GET /api/leaderboard/tanks/{tankId}/top-damage?page=&size=`；站内通知 `GET /api/users/notifications`、`GET /api/users/notifications/unread-count`、`PATCH /api/users/notifications/{id}/read`、`PATCH /api/users/notifications/read-all`。
- **公开解析边界**：最多 100 个回放、单文件 20 MiB、总请求 200 MiB；单实例默认同时处理 2 个任务。ZIP/pickle/protobuf 还有独立预算，容量满返回 503 `REPLAY_BUSY`。

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

- **远程**：SSH remote `github-personal`，账号 **`A158Coke`**。推送：
  `GIT_SSH_COMMAND="ssh -o ConnectTimeout=15" git push github-personal main`
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

## AI 回放复盘

### 视角分组与模式判定

```
files → DefaultReplayProcessingFacade.processBatch()
  → 逐文件 validateFile(扩展名/大小) + parse + reconstruct
  → ReplayProcessingCapabilities(summaryAvailable, reconstructionAvailable, …)
  → BatchAnalyzer.analyze()
       ├─ BattleCategoryUtils.fromArenaBonusType()
       ├─ resolveScope() → PLAYER_FOCUSED / TEAM_PERSPECTIVE
       ├─ SHA-256 精确重复去重
       ├─ scope 一致性验证（不混合 + UNKNOWN 排除）
       ├─ BattleIdentity + TeamPerspectiveResolver 结果分组
       ├─ 代表回放选择（reconstruction 成功优先）
       └─ 录像者一致性验证（PLAYER_FOCUSED + RANDOM）
  → resolveMode() → SINGLE/MULTI_PLAYER_BATTLE, SINGLE/MULTI_TEAM_BATTLE
  → ReconstructionController
       ├─ PLAYER_FOCUSED → analyzePlayerOrFallback / analyzeMulti
       └─ TEAM_PERSPECTIVE → analyzeTeamGroups
            ├─ TeamPerspectiveResolver（录像者只决定 perspectiveTeam）
            ├─ TeamEntityMapper（可靠映射，未知实体不归队）
            ├─ DefaultTeamBattleFeatureExtractor
            ├─ reconstruction 可用 → 完整团队时序特征
            └─ reconstruction 不可用 → 权威团队结算 fallback
```

### Team Perspective 语义

- `RANDOM` 仍是录像者个人复盘；`TRAINING` / `TOURNAMENT` 是录像者所在整队复盘。
- 录像者不获得特殊个人分析权重，只用于解析 `perspectiveTeam`。
- 同场同队回放是 `SAME_TEAM_DUPLICATE_PERSPECTIVE`，只选质量最高的代表；禁止拼接原始事件流。
- 同场不同队是两个独立 perspective，entityId、坐标和时钟不跨 perspective 合并。
- 未点亮敌人的位置仍未知；不能用对方录像补写本队当时不可见的信息。
- `battle_results.dat` 的团队总伤害、承伤、助攻、格挡、击杀、存活和死亡时刻是权威值；damage event 只标为观测子集。
- 完整团队能力要求可靠 entity mapping；只有权威结算时仍可分析，但报告必须显示 fallback 与 limitations。
- `ParticipantMappingEvent` 优先按 accountId 连接；accountId 缺失时保留 updateArena2 的 nickname/team，只允许唯一昵称匹配并降级为 `INFERRED`。同名冲突、非车辆实体和低置信度映射不归队。

### Team Feature 判定阈值

| 判定 | 规则 |
|---|---|
| 交火分段 | 相邻可靠伤害事件间隔 `<= 10s` 属于同一段 |
| 集火候选 | 同一目标在任意 `<= 5s` 滑动窗口内被至少 2 名己方成员命中 |
| 交火结果 | 一方观测伤害严格大于另一方的 `1.25` 倍才判优势/劣势；边界值算均势 |
| 阵型采样 | `15s` 窗口，每名成员保留窗口内最后位置 |
| 阵型连通簇 | X/Z 平面距离 `<= 100m` 视为连通 |
| 坐标可信范围 | `|x|, |z| <= 1050 (1000 + 50 CLAMP_TOLERANCE_RAW)` 且 `|y| <= 200`；越界点忽略并计入 coverage/limitation |
| 时间戳 | 必须 finite 且 `>= 0`；非法事件不进入移动、阵型、交火或关键事件 |

多场趋势还需要每个 perspective 的有效 accountId 覆盖率
`validAccountIds / authoritativeMemberCount >= 0.75`，且 roster
`Jaccard = |A ∩ B| / |A ∪ B| >= 0.60`；任一条件不满足时只比较上传样本，不声称固定阵容趋势。

### Team AI 输入预算

> 已从「固定数量/字符截断」迁移到 **token 估算预算**：`TeamAiPromptBuilder` 使用 `AiTokenEstimator` 估算 token，`BudgetWriter.finish(estimator, maxInputTokens, ...)` 在写入时实时判定；输入硬上限由 `AiModelProperties` 配置（`singleReplayMaxInputTokens` 等，见上文表格）。不再有 `MAX_MEMBERS` / `MAX_KEY_EVENTS` / 30,000 字符等固定截断常量。

超过预算会确定性截断，并在结果中加入 `AI_INPUT_TRUNCATED`。截断策略采用三层优先级输出：
1. **Mandatory contract**（context type、analysisUnitId、perspective header、unitLimitations、isolation/omission contract）必须完整写入，超出预算时抛 `AiPromptBudgetExceededException`（HTTP 400 映射），不得静默丢失；
2. **High-priority facts**（authoritative aggregate、observed aggregate、member facts、coverage）必须原子完整写入，无法容纳时该 perspective 整体 omitted；
3. **Optional details**（movements、formation、battle phases、engagements、key events）可按 unit 整块省略，被省略的 unit 加入 `truncatedUnitIds`，global `AI_INPUT_TRUNCATED` 添加。任意 unit 的截断不影响其他 unit 的 mandatory/high-priority facts。

所有入口（单队/多队/编排）使用相同的 evidence limitation 规则：`AiReplayAnalysisService`（兼容 facade）委托 Player/Team Service 编排 `analyzeTeamGroups()` / `analyzeMulti()` / `analyzePlayerOrFallback()`，per-unit limitations 在各自上下文头部作为 `unitLimitations=[...]` 优先输出，不混入 global `DATA_LIMITATIONS`。

原始 `ReplayEvent` 和逐帧坐标流不得进入 Prompt。文件名、昵称、地图名和证据文本按 JSON 字符串编码，并在 system prompt 中声明为不可信数据，不能作为模型指令。PLAYER_FOCUSED 与 TEAM_PERSPECTIVE 使用同一个 `PromptDataQuoter.quote(value, fallback)` 实现，分别传入 `"?"` 或 `"UNKNOWN"` 作为 fallback。`TeamAiPromptBuilder.quoteData()` 和 `PlayerResultFormat.quoteForPrompt()` 均为轻量委托，不含 escaping 逻辑。所有外部字符串必须通过 `PromptDataQuoter.quote()` 转义后才能写入 prompt body。

### 错误与安全

上游错误统一为稳定英文码：`AI_INVALID_REQUEST`、`AI_AUTHENTICATION_ERROR`、`AI_RATE_LIMITED`、`AI_CONTEXT_TOO_LARGE`、`AI_UPSTREAM_UNAVAILABLE`、`AI_TIMEOUT`、`AI_CANCELLED`（客户端取消）、`AI_EMPTY_RESPONSE`、`AI_RESPONSE_INVALID`。HTTP 200 中的畸形 JSON、非法 completion envelope 均归为 `AI_RESPONSE_INVALID`。日志只能包含 provider/model/status、请求字符数、分析模式、correlation ID，provider body 原文不进入日志（统一替换为 `[PROVIDER_BODY_REDACTED]`），不得记录密钥、Authorization 或完整 Prompt。普通用户文案由前端 zh/en/ru 翻译。

### 测试

核心测试覆盖 `TeamPerspectiveResolverTest`、`TeamEntityMapperTest`、`DefaultTeamBattleFeatureExtractorTest` 与 `BatchAnalyzerTest`；Web/AI 测试使用 MockMvc 与 mock `ChatModel`（不调用真实 AI API），前端使用 Vitest + Vue Test Utils。执行：

```bash
cd java && mvn -s settings.xml test
cd frontend && npm ci && npm run test && npm run build
```
