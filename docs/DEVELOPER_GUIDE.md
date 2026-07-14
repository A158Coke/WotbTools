# Developer Guide for AI Maintainers

## Frontend Layout Note

- `App.vue` 顶栏样式为全局样式：桌面端固定在顶部，移动端使用 sticky + flex-wrap，避免语言选择、主题切换和个人中心入口挤压回放/排行榜页面。
- Vue SPA 主入口视觉变量集中在 `App.vue` 的 `:root` / `[data-theme="dark"]`；独立 `/extended` 入口通过 `frontend/src/styles/theme.css` 复用同一套变量。首页、上传区、排行榜和表格应优先复用这些变量，避免局部硬编码色板。
- 评分徽章样式使用 `r-elite` / `r-great` / `r-good` / `r-mid` / `r-poor`；最高/最低标记由 `utils/helpers.js` 的 `medal(...)` 统一计算，最低评分允许为 `0`，全员同分不显示奖惩。
- 公共首页可通过 `?view=home` 本地预览；线上 `wotbtools.com` / `www.wotbtools.com` 无参数仍默认进入首页。
- 首页首屏「最高伤害记录」读取 `/api/leaderboard/top-damage?page=1&size=1`，只展示当前全局第一条 `damageDealt`，接口失败或无数据时显示 `--`。
- Keycloak `check-sso` 依赖 `frontend/public/silent-check-sso.html`，不要移除，否则公共页面会被静默登录流程整页跳转。
- Keycloak 自助注册由 `docker/keycloak/wotbtools-realm.json` 的 `registrationAllowed` 控制；前端只触发登录流，不自建注册入口。

## SPA 路由参数

- `?view=home`：进入工具集首页（本地预览可用）。
- `?view=replay`：进入回放提取器。
- `?view=leaderboard`：进入排行榜。
- `?view=extended`：进入 Rating V2 扩展分析页。
- `?view=boost`：进入陪练、打手申请与管理员资格审批页。
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
├── README.md  LICENSE  .gitignore
├── docs/                        # TODO / DEVELOPER_GUIDE / CHANGELOG / HANDOVER
├── .agents/                     # AI 约定、技能与跨层同步检查单
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
├── .github/
│   ├── workflows/deploy.yml      # 测试门禁 + 增量构建/部署
│   ├── workflows/database-backup.yml # 每日生产双库备份
│   └── workflows/prod-diagnostics.yml # 线上诊断日志
├── common/                       # 共享资源
│   ├── tankopedia.json           #   车辆库
│   ├── rating.json               #   评分参数
│   ├── map_names.json            #   地图名三语映射
│   ├── assets/                   #   图标/logo 单一来源
│   │   ├── wotbtoolslogo.png  icon.ico  icon.png   #   Dockerfile 构建时 → homepage + frontend dist
│   └── data/                     #   示例回放（gitignore）
├── common/python/                # 车辆库更新脚本
│   └── update_tankopedia.py
├── deploy/                       # nginx、初始化 SQL、PostgreSQL 备份/检查/恢复脚本
└── java/
    ├── README.md
    ├── pom.xml                   # 父 POM
    ├── settings.xml / settings-docker.xml # 本地可移植配置 / 容器配置
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

解析安全预算：压缩回放不超过 20 MiB，只允许上述 3 个标准条目且禁止重复；条目分别限制为 1/8/20 MiB，总解压不超过 24 MiB。pickle 限制输入、字符串、长整数、栈和 opcode；protobuf 限制消息、length-delimited、字段值数量、field number 与 varint 长度；单回放 `#201` 名册/`#301` 战绩各最多 64 项；事件流最多保留 200000 包（高于已观测约 112K 合法样本）并执行 1000000 次扫描/重同步。非法主结构统一抛稳定英文 `IOException`，事件流超预算则按可选数据降级忽略。

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

> 下表列出当前 Java 主线的核心职责与跨层边界。

| 类                    | 文件                                     | 说明                                    |
|----------------------|----------------------------------------|---------------------------------------------|
| `ReplayParser`       | `wotb-core/.../ReplayParser.java`      | 回放解析入口（zip → meta + protobuf + 事件流） |
| `EventStreamReader`  | `wotb-core/.../EventStreamReader.java` | data.wotreplay 事件流解析（Type 4/8/10/39） |
| `Protobuf`           | `wotb-core/.../Protobuf.java`          | protobuf wire decoder                     |
| `PickleReader`       | `wotb-core/.../PickleReader.java`      | Python pickle 读取                        |
| `Tankopedia`         | `wotb-core/.../Tankopedia.java`        | 车辆库查表                                |
| `VehicleCodes`       | `wotb-core/.../VehicleCodes.java`      | 车辆库中文车型/国家 → API 稳定英文码      |
| `MapNames`           | `wotb-core/.../MapNames.java`          | 地图名多语读取（导出固定中文，读 classpath map_names.json）|
| `Players`            | `wotb-core/.../Players.java`           | 展示字段富化 + 排序                       |
| `Rating`             | `wotb-core/.../Rating.java`            | 表现评分计算                              |
| `Columns`            | `wotb-core/.../Columns.java`           | 列定义（单数据源, export 与 API 共用）    |
| `Aggregator`         | `wotb-core/.../Aggregator.java`        | 跨场汇总                                  |
| `ExcelExporter`      | `wotb-core/.../ExcelExporter.java`     | 导出门面                                  |
| `ExcelStyles`        | `wotb-core/.../ExcelStyles.java`       | POI 渲染底座                              |
| `SingleBattleSheets` | `wotb-core/.../SingleBattleSheets.java` | 单场三表                                  |
| `AggregateSheets`    | `wotb-core/.../AggregateSheets.java`   | 汇总三表                                  |
| `Replays`            | `wotb-core/.../Replays.java`           | 多回放去重收集                            |
| `ReplayController`   | `wotb-web/.../replay/controller/ReplayController.java`   | REST API 映射                            |
| `ReplayService`      | `wotb-web/.../replay/service/ReplayService.java`      | 业务编排                                  |
| `ReplayCapacityLimiter` | `wotb-web/.../replay/service/ReplayCapacityLimiter.java` | 单实例回放解析并发闸门 |
| `Mapper`             | `wotb-web/.../replay/mapper/Mapper.java`             | 核心模型 → DTO                           |
| `WotbWebApplication` | `wotb-web/.../WotbWebApplication.java` | Spring Boot 入口并启用定时任务                          |
| `LeaderboardController` | `wotb-web/.../leaderboard/controller/LeaderboardController.java` | 排行榜 REST API |
| `LeaderboardService` | `wotb-web/.../leaderboard/service/LeaderboardService.java` | 排行榜业务：录像者匹配/去重/查询 |
| `LeaderboardUploadService` | `wotb-web/.../leaderboard/service/LeaderboardUploadService.java` | 公开上传的限流、解析与入库编排 |
| `LeaderboardRecord`  | `wotb-web/.../leaderboard/entity/LeaderboardRecord.java` | JPA 实体（列与 Flyway V1 逐列对齐）|
| `LeaderboardRecordRepository` | `wotb-web/.../leaderboard/repository/LeaderboardRecordRepository.java` | Spring Data JPA 仓库 |
| `GlobalExceptionHandler` | `wotb-web/.../controller/GlobalExceptionHandler.java` | 统一异常处理 → `error + timestamp` |
| `AdminUserController` | `wotb-web/.../admin/controller/AdminUserController.java` | 管理员用户管理 REST API |
| `AdminUserService` | `wotb-web/.../admin/service/AdminUserService.java` | 管理员用户管理；删除用户前编排打手档案、本地资料与 Keycloak 清理 |
| `AdminUserMapper` | `wotb-web/.../admin/service/AdminUserMapper.java` | 本地/Keycloak 用户 → 管理 DTO |
| `KeycloakAdminUserService` | `wotb-web/.../admin/service/KeycloakAdminUserService.java` | Keycloak Admin API 封装 |
| `AdminUserLog` | `wotb-web/.../admin/entity/AdminUserLog.java` | 管理员操作审计日志实体 |
| `ErrorCode` | `wotb-web/.../util/ErrorCode.java` | 管理员 API 错误码枚举 |
| `MyAssignmentController` | `wotb-web/.../boost/controller/MyAssignmentController.java` | 打手视角订单查询 |
| `MyBoosterController` | `wotb-web/.../boost/controller/MyBoosterController.java` | 打手本人资料与接单状态自助切换 |
| `BoosterApplicationController` | `wotb-web/.../boost/controller/BoosterApplicationController.java` | 玩家打手资格申请 API |
| `AdminBoosterApplicationController` | `wotb-web/.../boost/controller/AdminBoosterApplicationController.java` | 管理员资格审批 API |
| `BoosterApplicationService` | `wotb-web/.../boost/service/BoosterApplicationService.java` | 申请校验、审批、Keycloak role 与打手创建编排 |
| `BoostAssignmentService` | `wotb-web/.../boost/service/BoostAssignmentService.java` | 分配状态流转及客户/管理员/自动确认共用的带锁完结路径 |
| `BoostCompletionScheduler` | `wotb-web/.../boost/service/BoostCompletionScheduler.java` | 定时扫描超过客户确认期限的陪练订单 |
| `BoosterApplication` | `wotb-web/.../boost/entity/BoosterApplication.java` | 打手资格申请 JPA 实体（列与 Flyway V9 对齐） |
| `UserNotificationController` | `wotb-web/.../user/controller/UserNotificationController.java` | 当前用户站内通知查询、未读数与已读操作 |
| `UserNotificationService` | `wotb-web/.../user/service/UserNotificationService.java` | 写入站内通知，API payload 保持英文 key + 数据 |
| `UserNotification` | `wotb-web/.../user/entity/UserNotification.java` | 站内通知 JPA 实体（列与 Flyway V10 对齐） |

- 字符串空值规范：回放解析、地图名回退、排行榜入库、汇总昵称和实时 rating 昵称一律把仅含空白的字符串视为缺失值；Java 侧统一使用 `org.springframework.util.StringUtils.hasText(...)`，避免空格版本号入库或空白时间戳触发解析异常。

### 前端

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
- UI 组件在 `components/`：FileUploader / ColumnPicker / AggregateTable / BattleTable / RatingModal / RemoveConfirmModal / LeaderboardPage / ProfilePage / BoostPage / AdminUsersPage
- 回放解析上传页由 `FileUploader.vue` 负责交互，`App.vue` 提供全局上传区样式；空态、拖拽态、已选文件态共用 `upload.*` 三语文案。
- 开发时 Vite 代理 `/api → localhost:8087`。
- 语言持久化 `localStorage('wotb-lang')`，主题持久化 Cookie `wotbtools-theme`（domain `.wotbtools.com`）+ localStorage 回退。
- 回放预览列配置持久化使用 `localStorage`：`wotb-replay-player-visible-cols`、`wotb-replay-player-order`、`wotb-replay-agg-visible-cols`、`wotb-replay-agg-order`。读取缓存时需按当前响应列集合清洗，避免旧缓存吃掉新列。
- 内联 SVG 图标统一使用全局 `.ic` 描边样式；上传按钮使用 `.filebtn input { display:none; }` 隐藏原生文件控件，避免浏览器默认控件破坏布局。
- `BoostPage.vue` 的打手管理页同时展示两套状态：`booster_profile.status` 是资格状态（`ACTIVE/INACTIVE/BANNED`），接单状态由 `booster_profile.available + activeAssignmentCount` 推导（可接单/忙碌/暂停接单）。分配弹窗按资格、接单状态、活跃订单数、等级和擅长内容排序推荐打手；改动任一含义时，务必同步三语 locale。
- `BoostPage.vue` 的资格审批默认请求 `NEW` 状态，服务端按 `created_at DESC` 返回最新待审批申请；申请截图使用站内遮罩大图预览，避免浏览器拦截 `data:` 顶层导航。
- `ProfilePage.vue` 复用同一套接单状态语义：打手个人中心显示 `available + activeAssignmentCount` 推导出的接单状态，并通过 `PATCH /api/boost/boosters/my/availability` 让打手本人暂停/恢复接收新订单；这个开关只影响新订单，不会隐藏已有进行中订单。
- 陪练订单生命周期由 `boost_request.status` 表示：`NEW/REVIEWING/MATCHED/ACCEPTED/IN_PROGRESS/PENDING_CONFIRM/CLOSED/EXCEPTION/REJECTED/CANCELLED`。打手单次接单生命周期由 `boost_request_assignment.status` 表示：`ASSIGNED/ACCEPTED/IN_PROGRESS/PENDING_CONFIRM/DECLINED/CANCELLED/COMPLETED/EXCEPTION`。所有相关写操作遵循“锁需求 → 锁活跃分配 → 重检状态 → 修改”；管理员使用显式源状态转换矩阵，`CLOSED/REJECTED/CANCELLED` 终态不可重开。打手提交完成时写入 `completion_submitted_at` 与 `auto_confirm_at`；客户确认、管理员兜底和定时自动确认共用 `BoostAssignmentService` 的完结路径，把需求置为 `CLOSED`、分配置为 `COMPLETED` 并写入 `unassigned_at`。自动确认每个订单使用独立新事务，单笔失败不会回滚同批其他订单。默认确认窗口 72 小时，可用 `BOOST_AUTO_CONFIRM_HOURS` 调整；扫描间隔由 `BOOST_AUTO_CONFIRM_SCAN_MS` 控制，线上部署从同名 GitHub repository variables 注入。
- 站内通知由 `user_notification` 保存，boost domain 只调用 `UserNotificationService` 写事件；API 返回 `type + payload` 英文 key，前端 `frontend/src/locales/{zh,en,ru}.json` 负责渲染文案。
- Boost DTO 不返回 `*Label`、`message` 或本地化 `warning`；选项只返回 `value + enabled`，状态使用 raw enum，成功/失败/警告分别使用 `code`、`error`、`warningCode`。新增任何 code 必须同步三语 `api_codes` / `api_errors`。
- 回放 DTO 的 `tank_type`、`tank_nation`、`survived_label`、`potential_damage_detail` 与 `/api/rating.classFactor` 只返回稳定英文码；车型、国家、潜在解析状态和评分车型通过 `replay_values` 映射，存活状态通过 `survived.alive/dead` 映射；Excel 导出继续使用中文。
- 权限采用 allowlist：公开端点、登录端点和后台端点必须显式列入 `SecurityConfig`；末尾 `/api/**` 为 `denyAll()`。`boost-manager` 仅允许 `/api/admin/boost/**`，其他 `/api/admin/**` 只允许 `wotbtools-admin`。
- Keycloak realm role 不是数据库事务资源：`BoosterService` 先 `saveAndFlush` 验证唯一键/外键，再增删 role，并注册 transaction rollback compensation。删除打手会锁定打手行并与分配流程串行化；打手创建/换绑和管理员删除用户还会共同锁定 `user_profile` 行，避免删除过程中并发产生孤立档案。`assignmentRepository.existsByBoosterId` 检查任意订单分配历史，已审批申请的 `approved_booster_id` 引用会自动解除并保持 `APPROVED` 状态。`AdminUserService` 删除用户前复用这条删除链；不要在 Controller 或申请 Service 中重复直接改 role。

### 显示名（i18n）架构

API 层为**纯英文**：`/api/columns` 与各 DTO 只回 `key`(snake_case) + 数据，**不含中文**。显示名由各输出通道**各自映射**：

- 前端：`vue-i18n` 三语 locale `frontend/src/locales/{zh,en,ru}.json` 的 `player_labels` / `agg_labels` / `rating_labels`（多套 key，因 `kills` 在单场=「击杀」、汇总=「总击杀」、rating=「人头」），模板用 `$t(...)` 渲染，语言可切换、`localStorage` 记忆（`wotb-lang`）。
- 导出层：`Columns.java`（单场 xlsx 表头）、`AggregateSheets.java` 的汇总列（导出仅中文）。

> 这是有意的取舍：API 干净、可多语言，但显示名存在多份（前端三语 locale + 导出）。**改/增任一列名，务必同步三语 locale 的相关 key（缺 key 会回退 `en`，再缺则显示原始 key）与导出标签。**
>
> 当前命名约定：辅助伤害=「协助伤害」、承受伤害=「损失血量」、抵挡伤害=「格挡」、击伤敌数=「击伤」；汇总用「总X / 场均X」。



### 潜在伤害与实时 rating

扩展分析页同时支持主 SPA 路由 `?view=extended` 和独立 `/extended` 多页构建入口；生产 nginx 对 `/extended` 映射到 `extended.html`，Spring 静态资源由 `StaticForwardController` 转发。

新增字段：

- 单场玩家列：`alpha_damage`、`rank`、`potential_damage`、`potential_damage_supplement`、`potential_damage_detail`。
- 汇总列：`potential_damage`、`potential_damage_avg`、`potential_damage_supplement_avg`。
- 实时 rating 展示列：`rating`、`kast`、`contribution`、`impact`、`damage_avg`、`potential_damage_avg`、`potential_damage_supplement_avg`、`assist_avg`、`multi_damage_rate`、`kills`、`kills_avg`；`contribution` 仅展示，不参与最终权重；`average_hp` 和 `account_id` 不再展示。

`frontend/src/composables/useColumns.js` 会过滤 `EXTENDED_ONLY_PLAYER_KEYS`，所以原回放解析页面不展示扩展专用列；扩展页 `/extended` 直接读取 `playerColumns`，可展示完整字段。列选择器缓存只作用于原回放解析页，不影响扩展页完整字段展示。

`ReplayParser` 仍解析 `xp`、`credits` 到 `PlayerResult`，但这两个值受经济/加成/首胜等因素影响，不作为玩家战绩展示字段、导出列或 rating 输入。

`Tankopedia` 已支持读取 `alphaDamage` 和车辆血量字段（`maxHp` / `hp` / `health` / `hitpoints` / `hitPoints` / `maxHealth`）。`common/python/update_tankopedia.py` 会从 BlitzKit `tanks.pb` 的炮/弹模块解析 `alphaDamage`：取最高等级炮候选中的首发弹伤害。当前本地 `common/tankopedia.json` 和更新脚本都没有 HP 字段。`average_hp` 的目标口径是“敌方 7 台车实际进场总血量 / 7”，但回放里的每台车实际进场血量 / 双方总血量字段尚未确认解析；当前实现为：车辆库有 HP 时用车辆库，否则未知单车 HP 暂定 2400。

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

MVP 只记录**录像者本人**在某场战斗中用某辆车打出的**单场伤害成绩**，不存全场 14 人，不存 replay 原文件。当前后端为单一在线配置，启动依赖 PostgreSQL。

- **数据库配置**：`application.yml` 始终启用 DataSource/JPA/Flyway，`ddl-auto: validate`；本地开发需提供 PostgreSQL 与 `POSTGRES_PASSWORD`。
- **Schema 来源**：Flyway 迁移 `wotb-web/.../resources/db/migration/V1__init_leaderboard.sql` → `V11__add_boost_completion_confirmation.sql`。**改表结构必须新增迁移**（`V3__...`），不要改已应用的 V1/V2；实体列与迁移列**逐列对齐**，否则 `validate` 启动即失败。
- **打手资格申请**：`booster_application` 保存玩家申请的 WoTB 账号、两张截图、申请等级、QQ/微信、可接单频率、日在线时间和审核状态；同一 Keycloak 用户只允许存在一个 `NEW`/`REVIEWING` 申请。审批通过由 `BoosterService` 先 flush `booster_profile`，再授予 Keycloak `booster` role；外层事务回滚会撤销新增 role。
- **打手资料双状态**：`booster_profile.status` 控制资格是否有效；`booster_profile.available` 控制是否手动暂停接单；`boost_request_assignment` 活跃记录数控制是否忙碌。分配打手时必须同时满足 `ACTIVE`、`available=true`、活跃订单数为 0。`GET /api/booster/assignments` 默认返回打手工作台所需的活跃订单详情（需求状态、联系方式、可安排时间、备注）；`GET /api/booster/assignments?includeHistory=true` 供个人中心回看活跃 + 历史订单，服务端会把仍未释放的订单排在前面；`PATCH /api/boost/boosters/my/availability` 允许打手本人切换是否接收新订单；`PATCH /api/booster/assignments/{id}/accept|start|complete|decline` 只允许当前打手操作自己的活跃订单；`PATCH /api/boost/requests/my/{id}/confirm-completion` 只允许需求提交者确认 `PENDING_CONFIRM` 订单。
- **仅随机战斗**：只有 `meta.json#arenaBonusType == 1`（随机）的战斗计入；训练房（==2）/娱乐/联赛等其他模式、以及模式未知（null）一律拒绝。`ReplayParser` 解析到 `Battle.arenaBonusType`，策略判断在 `LeaderboardService`。取值经真实样本核实（1=随机、2=训练房）。
- **录像者识别**：`meta.json` 无录像者 `accountId`，`ReplayParser` 仅给出 `Battle.recorder`（昵称）。`LeaderboardService` 按 `nickname.equals(battle.recorder)` 在 `players` 中匹配；匹配不到则跳过（不猜）。
- **去重**：唯一键 `(arena_id, account_id)` —— 同一场+同一玩家唯一；不同玩家/不同场各自成行。保存前 `findByArenaIdAndAccountId` 查重，并发冲突兜底捕获 `DataIntegrityViolationException`。
- **数据列**（V2 新增 `version`/`battle_time`）：`version` 来自 `meta.json#version`（游戏版本号如 `"11.18.0"`），`battle_time` 来自 `meta.json#battleStartTime` epoch ms（战斗实际发生时间），`created_at` 为上传时间。两新列均可 NULL（兼容旧数据）。
- **集成点**：`POST /api/leaderboard/upload` → `LeaderboardUploadService` → `ReplayCapacityLimiter` → `ReplayParser` → `LeaderboardService`。预览接口不隐式落库。
- **API**（纯英文 key）：`GET /api/leaderboard/top-damage?page=&size=`、`GET /api/leaderboard/tanks/{tankId}/top-damage?page=&size=`；`POST /api/leaderboard/upload` 跳过时返回 `reasonCode`。
- **前端**：`components/LeaderboardPage.vue` 负责上传、分页和按车辆筛选；请求使用 generation 丢弃过期分页响应。三语文案在 `locales/{zh,en,ru}.json` 的 `leaderboard` 块。
- **测试**：`LeaderboardServiceTest` 覆盖匹配/去重/跳过；`LeaderboardControllerTest` 始终运行；`WebApiTest` 使用 Testcontainers 2.0.5 验证 Flyway/JPA 集成，无 Docker 时条件跳过。

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
- **地图名三语映射**：`meta.json` 的 `mapName` 是内部英文名（如 `lagoon`），显示名**单一来源** `common/map_names.json`，结构为 `{ zh, en, ru }`（构建复制到 classpath）。前端 `utils/helpers.js` 直接 `import` 同一份 JSON，`mapLabel()` 按当前 locale 渲染回放页/排行榜/扩展页/个人中心；导出继续走 `MapNames.cn()`（`SingleBattleSheets` 单场信息 + `AggregateSheets` 明细列/战斗列表）固定使用中文。API 仍回原始英文 `mapName`。未匹配则原样显示。

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

前端测试与构建：

```bash
cd frontend
npm test
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

1. `cd common/python && python update_tankopedia.py`（写入 `common/tankopedia.json`，需要网络）。
2. 跑 Java 测试（Java 构建会自动把 `common/tankopedia.json` 复制到 classpath）。
3. 重新构建 Docker 镜像。

## 风险点

- 终端编码：Windows PowerShell 可能把 UTF-8 中文显示成乱码，但文件仍应保存为 UTF-8。
- protobuf 字段没有官方 schema，字段语义来自样本和社区项目交叉验证。
- pickle 读取逻辑只针对当前 `battle_results.dat` 结构，不是通用 pickle VM。
- `data.wotreplay` 事件流解析依赖 BigWorld 包头格式，跨版本可能有偏移变化。
- `tankopedia.json` 依赖外部 blitzkit 资源，更新时需要网络。
- 回放解析/排行榜上传是公开接口：必须保留 Spring multipart 限制、`ReplayService` 文件数/总量检查、`ReplayCapacityLimiter` 并发闸门与 parser 内部预算；新增公开解析路径必须复用并发闸门。
- **Spring Boot 4 自动配置模块化**：Flyway 自动配置在独立模块 `spring-boot-flyway`，**只加 `flyway-core` 不会在启动时自动迁移**。当前应用为单一数据库配置，不再维护无数据库/桌面 profile。

## CI/CD 自动部署

赞助二维码采用运行时文件配置，不进入 Git 或前端镜像：

- schema：`{"enabled":true,"methods":[{"type":"alipay","image":"/sponsor-assets/alipay.png"}]}`；`type` 仅允许 `alipay`/`wechat`，图片仅允许 `/sponsor-assets/` 下的安全单层文件名。
- VPS：`/opt/wotb/config/sponsor-config.json` + `/opt/wotb/config/sponsor/`，前端容器只读挂载为 `/usr/share/nginx/html/sponsor-config.json` 与 `/usr/share/nginx/html/sponsor-assets/`。
- 首次部署从 `deploy/sponsor-config.example.json` 创建 disabled 配置，后续部署不得覆盖现有配置。配置缺失或无效时页面显示三语“暂未配置”。

`push` 到 `main` 分支触发 GitHub Actions（[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)）：

1. **完整 push range 检测**：用 `github.event.before..github.sha` 判定 backend/frontend/keycloak/deployment；`rating.json`、`map_names.json`、`common/assets/` 和部署脚本都有明确映射。
2. **测试门禁**：后端变化先跑 Maven 全测；前端变化先跑 `npm ci`、Vitest 和 Vite build。任一失败都禁止构建/部署对应镜像。
3. **按需构建三镜像**：backend/frontend/keycloak 只在相关路径变化时构建，推 `sha-<SHA>` + `latest` 到 GHCR。
4. **部署前双库备份**：已有 compose 时先运行 `postgres-backup.sh --database wotb` 与 `--database keycloak`；任何备份/校验失败都会终止部署。
5. **SSH 部署与健康检查**：在 `/opt/wotb` 更新四服务 compose，`pull && up -d --remove-orphans`；必须等后端健康检查成功，否则输出日志并失败。

独立 `.github/workflows/database-backup.yml` 每日香港时间 03:15 运行。归档按 `/opt/wotb/backups/{wotb,keycloak}/` 分库保存并保留 7 天；`pg_restore --list` 加 `--file=/dev/null` 校验 catalog 与全部压缩数据。恢复只能 SSH 手动调用 `deploy/postgres-restore.sh`，必须使用对应目录与 `RESTORE-<database>` 确认词，并会先创建安全备份。恢复失败时依赖服务保持停止。

线上 502 排查优先运行 [`.github/workflows/prod-diagnostics.yml`](../.github/workflows/prod-diagnostics.yml)，它会通过 VPS SSH secrets 打印 `docker compose ps`、后端容器状态和后端/前端日志。

## 给 AI coder 的工作准则

- 先读 `README.md`、`java/README.md`、本文件和相关测试，再改代码。
- 不要根据乱码输出判断文件内容坏了；优先用 UTF-8 方式读取。
- 不要在 `node_modules`、`target`、`dist` 中做源码修改。
- 如果只改 Web UI 的显示名，改前端三语 locale `locales/{zh,en,ru}.json` 的 `player_labels`/`agg_labels` 即可；API 只回英文 key，不要把中文加回 API。
- `Columns.java` 是 Java 侧列的 key/顺序/取值与**单场 xlsx 表头**的来源；新增字段先加 `Column` 记录，再同步前端 locale、汇总列。
- 任何会改变界面/导出/数据的更新，都要同步更新文档（本文件 + README/java/README）。
