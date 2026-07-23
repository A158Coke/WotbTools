# Developer Guide

> 动手前先读这一份。接手维护的人或 AI 都适用。

---

## ✦ 给接手的一句话

这是个单人维护的 WoT Blitz 回放分析工具（Java core + Spring Boot + Vue + Keycloak，Web 版）。
动手前读 `AGENTS.md` 和本文件；跨层改动按 `.agents/wotb-sync.md` 的配方；
Maven 必须 `-s java/settings.xml` 且 `JAVA_HOME` 指向 JDK 21；
改完跑 `mvn -s settings.xml test`、`npm test` 和 `npm run build`；
提交用中文信息、推 `github-personal`（账号 A158Coke），push main 即自动部署。

---

## 文档地图

| 文档 | 作用 | 何时读 |
|---|---|---|
| **本文件 `DEVELOPER_GUIDE.md`** | 开发指南（含环境、架构、部署、约定） | 最先 |
| [`AGENTS.md`](AGENTS.md) | AI 硬性约定（RULES） | 动手前必读 |
| [`.agents/wotb-sync.md`](.agents/wotb-sync.md) | 跨层改动检查单（配方 A–G） | 增删/改名数据列、改解析/导出/前端时 |
| [`docs/replay-data.md`](docs/replay-data.md) | data.wotreplay 事件流格式、protobuf 字段表、死亡时间推算 | 深入回放格式时 |
| [`docs/rating-system.md`](docs/rating-system.md) | 评分算法细节 | 碰评分时 |
| [`docs/rating-progress.md`](docs/rating-progress.md) | rating 扩展目标、已完成项、缺口与下一步 | 接手 rating 扩展时 |
| [`CHANGELOG.md`](CHANGELOG.md) | 版本历史（对外） | 了解发布历史 |
| [`README.md`](README.md) / [`java/README.md`](java/README.md) | 用户向 + 运行/接口/构建 | 跑起来时 |
| [`TODO.md`](TODO.md) | 待办（含已完成收尾记录与下一步） | 找下一步做什么 |

> `AGENTS.md` / `wotb-sync.md` 本就是写给"任意 AI/人"的，不绑定特定工具。

---

## 环境与工具链（关键坑）

- **JDK 21 必需，且系统默认 `java` 可能是 JDK 8。** 跑任何 Maven 命令前必须先设：
  - bash: `JAVA_HOME="/c/Users/<user>/.jdks/jdk-21.0.1"`（本机实测路径，**不是** `C:\Program Files\Java`）
  - cmd: `set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1`
- **Maven 必须带 `-s java/settings.xml`**（该文件已跟踪，使用 aliyun 镜像 + `java/.m2repo`，干净 clone 可直接运行）。容器内用 `java/settings-docker.xml`。
- **Node**：前端 `frontend`，开发端口 5173，构建用 `npm run build`。
- **Python 3 + Pillow**：仅用于 `common/python/update_tankopedia.py`（更新车辆库，需联网）和偶尔的图像处理。

---

## 构建 / 运行 / 测试（确切命令）

```bash
# Java 全量测试
cd java && JAVA_HOME=<jdk21> mvn -s settings.xml test

# 前端测试 + 构建
cd frontend && npm test && npm run build

# 本地开发 — 四容器编译启动 (postgres + keycloak + backend + frontend)
cd docker/online && docker compose up -d --build   # 构建 Dockerfile.backend + Dockerfile.frontend, 8088
```

后端没有无数据库 profile。若要测试本地 Keycloak 管理员写操作，需在本地 realm 配置 `wotbtools-admin-api` 服务账号，并在启动 compose 前设置 `KEYCLOAK_ADMIN_CLIENT_SECRET`；普通回放解析可留空。

> **测试夹具**：真实回放断言读取 gitignored 的 `common/data/*.wotbreplay`；新克隆或 CI 无样本时只跳过对应样本测试，其余 parser、service、security、API 契约与 controller 测试仍执行。`WebApiTest` 的 PostgreSQL 集成路径在无 Docker 时条件跳过。

---

## 硬性约定

- **改动即更新文档**（同一次提交）。影响界面/导出/数据/构建/用法的改动，必须同步本文档 + 相关 README。
- **API 纯英文**：DTO 只回 raw enum、稳定 `code`/`error` + 数据，**不放 `*Label` 或 `message`**；显示名/错误文案归前端三语 locale。
- **显示名分两类出口**（改列名要全改）：
  - 前端：`frontend/src/locales/{zh,en,ru}.json` 的 `player_labels` / `agg_labels`（**三语都改**）。
  - 导出：`Columns.java`（单场 xlsx）、`AggregateSheets.java`（汇总 xlsx，仅中文）。
- **单一数据源**：`common/tankopedia.json`（车辆库）、`common/rating.json`（评分参数）、`common/map_names.json`（地图三语名）。构建时由 `wotb-core/pom.xml` 复制到 classpath；**勿在模块内放副本**。
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
├── README.md  TODO.md  DEVELOPER_GUIDE.md  LICENSE  .gitignore  AGENTS.md  CHANGELOG.md
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
│   └── ReplayController.java.java  ...（这个是错的，应该是 web 端点）
├── .github/
│   ├── workflows/deploy.yml      # 测试门禁 + 增量构建/部署
│   ├── workflows/database-backup.yml # 每日生产双库备份
│   └── workflows/prod-diagnostics.yml # 线上诊断日志
├── common/                       # 共享资源
│   ├── tankopedia.json           #   车辆库
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
│   └── skills/ / wotb-sync.md
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
         └── feature/      战术特征提取 + AI 输入占位
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
| `Tankopedia` | `wotb-core/.../Tankopedia.java` | 车辆库查表（via common/tankopedia.json） |
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
| `ReplayProcessingCapabilities` | `wotb-core/.../processing/ReplayProcessingCapabilities.java` | 能力模型（`aiAnalyzable` / `fullFeatureAnalysisAvailable`） |
| `RecorderEntityMapping` | `wotb-core/.../processing/RecorderEntityMapping.java` | 录像者 entity 映射结果 |
| `DefaultReplayProcessingFacade` | `wotb-core/.../processing/DefaultReplayProcessingFacade.java` | 统一处理门面（解析+重建+能力标记） |
| `BatchAnalyzer` | `wotb-core/.../processing/BatchAnalyzer.java` | 视角分组+去重+模式判定 |
| `DefaultPlayerBattleFeatureExtractor` | `wotb-core/.../feature/DefaultPlayerBattleFeatureExtractor.java` | 录像者个人特征提取（移动段/交火段） |
| `PlayerBattleFeatureSet` | `wotb-core/.../feature/PlayerBattleFeatureSet.java` | 个人特征集（含 `hasFeatures` / `limitations`） |
| `AiReplayAnalysisService` | `wotb-web/.../ai/AiReplayAnalysisService.java` | AI 调用入口 + Prompt 构建 |
| `ReplayService` | `wotb-web/.../replay/service/ReplayService.java` | 业务编排 |
| `ReplayCapacityLimiter` | `wotb-web/.../replay/service/ReplayCapacityLimiter.java` | 单实例回放解析并发闸门 |
| `Mapper` | `wotb-web/.../replay/mapper/Mapper.java` | 核心模型 → DTO |
| `WotbWebApplication` | `wotb-web/.../WotbWebApplication.java` | Spring Boot 入口 |
| `LeaderboardController` | `wotb-web/.../leaderboard/controller/LeaderboardController.java` | 排行榜 REST API |
| `LeaderboardService` | `wotb-web/.../leaderboard/service/LeaderboardService.java` | 排行榜业务：录像者匹配/去重/查询 |
| `LeaderboardUploadService` | `wotb-web/.../leaderboard/service/LeaderboardUploadService.java` | 公开上传的限流、解析与入库编排 |
| `LeaderboardRecord` | `wotb-web/.../leaderboard/entity/LeaderboardRecord.java` | JPA 实体（列与 Flyway V1 逐列对齐） |
| `LeaderboardRecordRepository` | `wotb-web/.../leaderboard/repository/LeaderboardRecordRepository.java` | Spring Data JPA 仓库 |
| `GlobalExceptionHandler` | `wotb-web/.../controller/GlobalExceptionHandler.java` | 统一异常处理 → `error + timestamp` |
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

- `App.vue` 顶栏样式为全局样式：桌面端固定在顶部，移动端使用 sticky + flex-wrap，避免语言选择、主题切换和个人中心入口挤压回放/排行榜页面。
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
- `?view=reconstruction`：进入回放战斗重建测试页（仅 `wotbtools-admin` 可见）。
- `wotbtools.com` / `www.wotbtools.com` 无参数时默认显示工具集首页。

### 前端组件

- 根组件 `App.vue`（编排层），无 Vue Router、无组件库。逻辑全在 **composables** 和 **utils** 中：
  - `composables/useReplay.js` — 文件/预览/导出/战斗移除状态管理
  - `composables/useColumns.js` — 列可见性/排序/选择器状态；`localStorage` 持久化单场/汇总两套列配置，并在后端新增列时自动补齐顺序
  - `composables/useTheme.js` — 主题切换（auto/light/dark），数据持久化调用 `utils/theme.js`
  - `composables/useAuth.js` — Keycloak 认证适配器（check-sso 游客模式）
  - `utils/api.js` / `utils/api-boost.js` — 集中式 API 层；非 2xx 统一转换为稳定 `ApiError`
  - `utils/display.js` — raw enum、成功码和错误码的三语显示
  - `utils/latest-debounce.js` — 丢弃过期异步搜索结果
  - `utils/page.js` — Spring `Page.number` 响应归一化与分页默认值
  - `utils/theme.js` — 纯函数（readTheme / saveTheme / resolveTheme / applyTheme），Cookie `.wotbtools.com` 域共享 + localStorage 回退
- `utils/helpers.js` — 常量（DEFAULT_VISIBLE / EXTENDED_ONLY_PLAYER_KEYS / RATING_TIERS）+ 工具函数（按 locale 取地图名的 `mapLabel` / ratingTier / medal 等）
- UI 组件在 `components/`：FileUploader / ColumnPicker / AggregateTable / BattleTable / RatingModal / RemoveConfirmModal / LeaderboardPage / ProfilePage（含站内通知面板）/ BoostPage / AdminUsersPage / HomePage / ExtendedPage / ReplayPage
- 回放解析上传页由 `FileUploader.vue` 负责交互，`App.vue` 提供全局上传区样式；空态、拖拽态、已选文件态共用 `upload.*` 三语文案。
- 开发时 Vite 代理 `/api → localhost:8087`。
- 语言持久化 `localStorage('wotb-lang')`，主题持久化 Cookie `wotbtools-theme`（domain `.wotbtools.com`）+ localStorage 回退。
- 回放预览列配置持久化使用 `localStorage`：`wotb-replay-player-visible-cols`、`wotb-replay-player-order`、`wotb-replay-agg-visible-cols`、`wotb-replay-agg-order`。读取缓存时需按当前响应列集合清洗，避免旧缓存吃掉新列。
- 内联 SVG 图标统一使用全局 `.ic` 描边样式；上传按钮使用 `.filebtn input { display:none; }` 隐藏原生文件控件，避免浏览器默认控件破坏布局。
- `BoostPage.vue` 的打手管理页同时展示两套状态：`booster_profile.status` 是资格状态（`ACTIVE/INACTIVE/BANNED`），接单状态由 `booster_profile.available + activeAssignmentCount` 推导（可接单/忙碌/暂停接单）。分配弹窗按资格、接单状态、活跃订单数、等级和擅长内容排序推荐打手；改动任一含义时，务必同步三语 locale。
- `ProfilePage.vue` 是个人主页，展示用户身份、WoTB 账号绑定、排行榜记录和站内通知面板；若当前用户是打手，还会显示接单状态与进行中/历史订单。通知面板在右侧栏顶部，点击展开通知列表（最近 30 条），支持单条已读和全部已读，未读数字小红点提示。打手接单状态通过 `PATCH /api/boost/boosters/my/availability` 让打手本人暂停/恢复接收新订单；这个开关只影响新订单，不会隐藏已有进行中订单。
- 陪练订单生命周期由 `boost_request.status` 表示：`NEW/REVIEWING/MATCHED/ACCEPTED/IN_PROGRESS/PENDING_CONFIRM/CLOSED/EXCEPTION/REJECTED/CANCELLED`。打手单次接单生命周期由 `boost_request_assignment.status` 表示：`ASSIGNED/ACCEPTED/IN_PROGRESS/PENDING_CONFIRM/DECLINED/CANCELLED/COMPLETED/EXCEPTION`。订单完成、取消、拒绝或拒单时设置 `unassigned_at` 释放打手忙碌状态。
- 站内通知由 `user_notification` 保存，boost domain 只调用 `UserNotificationService` 写事件；API 返回 `type + payload` 英文 key，前端 `frontend/src/locales/{zh,en,ru}.json` 负责渲染文案。
- Boost DTO 不返回 `*Label`、`message` 或本地化 `warning`；选项只返回 `value + enabled`，状态使用 raw enum，成功/失败/警告分别使用 `code`、`error`、`warningCode`。新增任何 code 必须同步三语 `api_codes` / `api_errors`。
- 回放 DTO 的 `tank_type`、`tank_nation`、`survived_label`、`potential_damage_detail` 与 `/api/rating.classFactor` 只返回稳定英文码；车型、国家、潜在解析状态和评分车型通过 `replay_values` 映射，存活状态通过 `survived.alive/dead` 映射；Excel 导出继续使用中文。
- 权限采用 allowlist：公开端点、登录端点和后台端点必须显式列入 `SecurityConfig`；末尾 `/api/**` 为 `denyAll()`。`boost-manager` 仅允许 `/api/admin/boost/**`，其他 `/api/admin/**` 只允许 `wotbtools-admin`。
- Keycloak realm role 不是数据库事务资源：`BoosterService` 先 `saveAndFlush` 验证唯一键/外键，再增删 role，并注册 transaction rollback compensation。删除打手前只查活跃分配依赖（`assignmentRepository.existsByBoosterId`），已审批申请的 `approved_booster_id` 引用会在删除时自动解除并保持 APPROVED 状态，不阻塞二次申请；不要在 Controller 或申请 Service 中重复直接改 role。

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

`Tankopedia` 已支持读取 `alphaDamage` 和车辆血量字段（`maxHp` / `hp` / `health` / `hitpoints` / `hitPoints` / `maxHealth`）。`common/python/update_tankopedia.py` 会从 BlitzKit `tanks.pb` 的炮/弹模块解析 `alphaDamage`：取最高等级炮候选中的首发弹伤害。当前本地 `common/tankopedia.json` 和更新脚本都没有 HP 字段。`average_hp` 的目标口径是"敌方 7 台车实际进场总血量 / 7"，但回放里的每台车实际进场血量 / 双方总血量字段尚未确认解析；当前实现为：车辆库有 HP 时用车辆库，否则未知单车 HP 暂定 2400。

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
- **Schema 来源**：Flyway 迁移 `wotb-web/.../resources/db/migration/V1__init_leaderboard.sql` → `V10__create_user_notifications.sql`。**改表结构必须新增迁移**（`V3__...`），不要改已应用的 V1/V2；实体列与迁移列**逐列对齐**，否则 `validate` 启动即失败。
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
1. 用完整 push range 判断 backend/frontend/keycloak/deployment 哪些范围变化。
2. 后端 Maven 全测、前端 Vitest + Vite build 通过后，才按需构建三类镜像。
3. SSH 部署前备份 `wotb` 与 `keycloak`，再更新 `/opt/wotb` compose、`pull` + `up -d`。
4. 后端健康检查失败会输出日志并让 workflow 失败。

**必须配置的 GitHub Secrets**（迁移/换仓库时容易漏）：
- `VPS_HOST` / `VPS_USER` / `VPS_PORT` / `VPS_SSH_KEY` —— VPS SSH。
- `KC_ADMIN_PASSWORD` / `DB_PASSWORD` —— Keycloak 与 PostgreSQL 密码。
- `KEYCLOAK_ADMIN_CLIENT_SECRET` —— 后端 Keycloak Admin API 服务账号 secret。

**已知坑 & 现有对策**（改 workflow/Dockerfile 时别踩回去）：
- backend/frontend/keycloak 镜像各推 `sha-<SHA>` + `latest`；当前 VPS compose 使用 `latest`，需要回滚时手工改为对应 sha 标签。
- **VPS 上可能有遗留旧容器占端口** → 部署脚本会先 `docker rm -f wotb-backend wotb-frontend` 腾出 8088，`up -d` 带 `--remove-orphans`。
- **SSH 脚本必须 `set -e`** → 否则 `docker compose up` 失败仍退出 0，Actions「假绿」而站点不更新（本会话真实发生过）。
- **构建上下文是仓库根**（前端 `utils/helpers.js` 跨目录 `import ../../../common/map_names.json`，后端要 `common/*.json`）。仓库根 `.dockerignore` 排除 `**/node_modules`、`**/target`、`**/dist`、`common/data` 等。
- 镜像层用 GitHub Actions 缓存（`type=gha`）加速。
- deploy 与 database-backup 共用 `production-maintenance` concurrency，且 `cancel-in-progress: false`，避免部署与备份互相中断。

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

## AI 回放复盘（PR #29）

### 视角分组与模式判定

```
files → DefaultReplayProcessingFacade.processBatch()
  → 逐文件 validateFile(扩展名/大小) + parse + reconstruct
  → ReplayProcessingCapabilities.of(summaryOk, recorderResultAvailable, …)
  → BatchAnalyzer.analyze()
       ├─ BattleCategoryUtils.detectCategory()
       ├─ resolveScope() → PLAYER_FOCUSED / TEAM_PERSPECTIVE
       ├─ SHA-256 精确重复去重
       ├─ scope 一致性验证（不混合 + UNKNOWN 排除）
       ├─ BattleIdentity + perspectiveTeam 分组
       ├─ 代表回放选择（reconstruction 成功优先）
       └─ 录像者一致性验证（PLAYER_FOCUSED + RANDOM）
  → resolveMode() → SINGLE/MULTI_PLAYER_BATTLE, SINGLE/MULTI_TEAM_BATTLE
  → ReconstructionController.callPlayerContext()
       ├─ reconstruction==null → aiService.analyze(fallback)
       ├─ recorder.resolved() == false → aiService.analyze(fallback)
       ├─ featureSet.hasFeatures() == false → aiService.analyze(fallback)
       └─ full feature → aiService.analyzePlayerContext(context)
```

### 测试

wotb-core: 104 tests / wotb-web: 114 tests ≈ 218，0 failure（部分 skip 因缺少样本或 Docker）