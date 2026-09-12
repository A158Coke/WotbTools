# Developer Guide

> 动手前先读这一份。接手维护的人或 AI 都适用。

---

## ✦ 给接手的一句话

这是一个单人维护的 WoT Blitz 回放分析 Web 工具：Java 25 core + Spring Boot 4 + Vue 3 + Keycloak + PostgreSQL。

动手前读 `.agents/AGENTS.md`、当前目录的 `AGENTS.md` 和本文件；跨层改动按 `.agents/skills/wotb-sync/SKILL.md`。真实代码始终是 source of truth，发现文档漂移时必须在同一次改动里修正文档。

固定接手方法：入口阅读 → 现实审计 → 任务分类 → 计划契约 → Reuse / SSOT 执行 → 分层验证 → 收尾交接。完整流程以 `.agents/AGENTS.md` 的「接手与调整方法（固定流程）」为准。

---

## 文档地图

| 文档 | 作用 | 何时读 |
|---|---|---|
| `docs/DEVELOPER_GUIDE.md` | 开发入口、环境、结构、架构约束 | 最先 |
| `.agents/AGENTS.md` | 仓库级硬约定、接手与调整固定流程 | 动手前必读 |
| `frontend/AGENTS.md` / `java/AGENTS.md` 等 | 目录级约束 | 进入对应目录时 |
| `.agents/skills/wotb-sync/SKILL.md` | 跨层改动检查单 | 增删列、改解析、导出、前端时 |
| `java/README.md` | Java/Web 运行、接口、构建 | 跑后端时 |
| `docs/README.md` | 全部专题文档索引 | 查专项设计时 |

---

## 环境与工具链

- **JDK 25** 必需。Maven 必须带 `-s java/settings.xml`；容器构建使用 `java/settings-docker.xml`。
- **Node 24**：`frontend/.nvmrc` 固定版本；安装依赖用 `npm ci`。前端使用 TypeScript 与
  `vue-tsc` 做独立类型检查；JavaScript 与 TypeScript 可共存，迁移期间不要求一次性改写旧代码。
- **Python 3**：`common/python/update_tankopedia.py` 使用标准库从 BlitzKit 客户端定义同步车辆数据。
- 不要使用任何公司 token、凭据或基础设施。

常用命令：

```bash
# Java 分层测试
# Targeted（改单个 class/function）：mvn -pl wotb-core -Dtest=<TestClass> test
# Module（单模块/一个 feature）：mvn -pl wotb-core test 或 mvn -pl wotb-web -am test
# Full（PR CI authoritative validation，Agent 默认不跑）：cd java && JAVA_HOME=<jdk21> mvn -s settings.xml test
# 注意：wotb-web 的真实外部 AI probe 标记为 ai-live，默认被 Surefire 排除；不要仅因环境存在 AI_API_KEY 就解除排除。

# 前端分层测试
# Targeted：cd frontend && npx vitest run <related-test-files>
# Type check：cd frontend && npm run typecheck
# Browser geometry gate（Playback 布局/形态）：cd frontend && npm run test:browser-layout
# Browser interaction gate（Playback / Replay Workspace 交互）：cd frontend && npm run test:browser-interaction
# Build（仅当改动涉及 build 范围）：cd frontend && npm run build
# Local Frontend → Production Backend / Keycloak（开发代理，谨慎使用真实数据）
# cd frontend && npm run dev:production-remote
# 说明与验收边界见 docs/frontend/local-production-dev.md；普通 npm run dev 仍代理 localhost:8087。

# 本地完整开发环境
cd docker/online && docker compose up -d --build
```

后端没有“无数据库” profile。测试 Keycloak Admin 写操作时需要 `wotbtools-admin-api` 服务账号与 `KEYCLOAK_ADMIN_CLIENT_SECRET`。

Wargaming ASIA/EU/NA 登录继续使用 Keycloak 的 `WG_APPLICATION_ID`。backend 不再调用 WG stats，也不再接收百场 WG 自动认证；百场统一使用截图 + 5 replay 人工流程。

真实回放 CI fixture 位于 `common/fixtures/replays/*.wotbreplay`；本地可用 gitignored `common/data/*.wotbreplay` 扩展样本。

---

## 硬性约定

- **改动即更新文档**：影响界面、导出、数据、构建或用法的改动，同一次提交更新相关文档。
- **API 纯英文**：成功 DTO 返回 raw enum 与数据；失败返回 canonical `ApiErrorResponse`（唯一错误 `id`、稳定 `errorCode`、可选 `errorMsg`、status、retryable、details、timestamp），不返回本地化 `*Label/message` 或 exception message。完整契约见 `docs/api/error-contract.md`。
- **HTTP Contract First**：FE ↔ BE 的序列化契约以 `contracts/http/openapi.yaml` 为唯一事实源；前端 generated transport、Ajv runtime schema 与 fixture 由它生成/校验。修改 HTTP shape 时按 `docs/architecture/http-contracts.md` 的顺序执行，不让 Java domain enum 或 Vue view model 直接泄漏到 wire。
- **显示名分两类出口**：前端三语 locale + Excel 导出中文标签；改列必须同步两边。
- **单一数据源**：车辆库为 `common/tankopedia-tier{7,8,9,10}.json`，地图名为 `common/map_names.json`；禁止模块内复制一份。
- 不引入 Lombok；record 用于不可变模型；Controller 只处理 HTTP，业务逻辑进入 service/core。
- 跨层联动必须执行 `wotb-sync`。
- **UI Profile（展示风格，非主题）**：`showcase`（沉浸，默认）/ `classic`（简约）是 Presentation Profile，共用同一套业务组件/状态/API；Classic 只通过 `frontend/src/styles/classic-profile.css`（`[data-ui-profile="classic"]`）去掉全屏 AI/装饰背景与视觉噪音，不改结构/密度/布局。业务组件不得按 Profile fork，禁止 `:key="uiProfile"` 触发组件重建。详见 [`docs/frontend/ui-system.md`](frontend/ui-system.md)。

---

## 仓库结构

```text
.
├── common/                     # 共享车辆/地图/资产/回放 fixture
├── contracts/                  # FE ↔ BE HTTP OpenAPI wire contract
├── java/                       # Java Maven 根：contracts/core、Replay feature modules、control、web composition root
├── frontend/                   # Vue 3 SPA + 独立 Sponsor 页
│   ├── index.html
│   ├── src/
│   │   ├── App.vue
│   │   ├── main.js
│   │   ├── components/
│   │   ├── composables/        # useReplay / useColumns / useAuth 等
│   │   ├── utils/
│   │   ├── styles/             # dark-only tokens + Showcase 分层样式
│   │   ├── locales/            # 基础 zh/en/ru + feature message composition
│   │   └── data/
│   └── homepage/
│       ├── sponsor.html
│       └── sponsor-config.js
├── docker/                     # backend/frontend/keycloak 镜像 + online compose
├── deploy/                     # production compose/nginx/备份与回滚
├── docs/                       # 架构、功能、参考、运维文档
└── .agents/                    # Agent 规则与 skills
```

旧 `frontend/homepage/index.html` / `profile.html` 已删除；公共主页与个人中心统一由 Vue SPA 提供。

### HTTP Contract workflow

HTTP shape 变更遵循 `OpenAPI → generated FE transport → backend mapper/serialization → runtime validation → contract tests → affected tests → PR CI`。在 `frontend/` 使用 `npm run api:lint`、`npm run api:generate`、`npm run api:check`、`npm run api:fixture`；生成文件位于 `frontend/src/api/generated/`，不可手改。Playback 旧 artifact 的兼容处理只能放在读取边界；`204` capability unavailable 与 `200` schema violation 必须保持不同语义。完整边界与兼容规则见 [`docs/architecture/http-contracts.md`](architecture/http-contracts.md)。

---

## 后端架构速览

```text
.wotbreplay
  ├─ meta.json
  ├─ battle_results.dat
  └─ data.wotreplay
       ↓
 wotb-core
  ├─ parse / model / ref / stats / export
  └─ replay/{stream,decoder,event,reconstruction,feature,evidence,map,processing}
       ↓
 wotb-result / wotb-playback / wotb-ai / wotb-replay-coordinator
       ↓
 wotb-replay-processing           # current local scheduler and full-processing executor
       ↓
 wotb-web                          # single Spring Boot composition root
 controller → feature service → mapper → dto
       ↓
 Vue SPA

 Future async foundation (independent path)
 wotb-contracts                 # 纯 Java contracts；不泄漏到当前 Web/Android DTO
        ↓
 wotb-control                   # 独立管理面 artifact；不依赖 wotb-core
```

核心原则：Preview、Export、League、AI/重建消费同一套权威 replay facts，禁止为了某个 UI/导出再造第二套解析/评分公式。

Replay backend uses Maven feature artifacts as dependency boundaries while retaining the
existing `com.wotb.web...` Java namespace during the migration, so HTTP/security wiring and
component scanning stay stable. `wotb-web` remains the only container/JVM/Boot root. It may
depend on `wotb-result`, `wotb-playback`, `wotb-replay-coordinator`,
`wotb-replay-processing`, and `wotb-ai`; none of those feature modules may depend on
`wotb-web`. The coordinator owns lifecycle/state and consumes the value-only
`ReplayProcessingDispatcher` port declared in `wotb-contracts`; local execution publishes
in-process lifecycle value events, which are not a future RabbitMQ wire contract.
the processing module owns the current `LocalReplayProcessingDispatcher`, scheduler and local
full-processing executor. This is an in-process seam only: no MQ, worker executable, object
storage or cross-process callback is part of the current runtime.

API 错误由 `GlobalExceptionHandler` 与 Security 的 canonical entry point/access-denied handler 汇合到同一 envelope。新后端异常使用 `ApiException(id, ApiErrorCode enum, errorMsg)`；响应携带唯一错误 `id`（写入安全日志，可用 `id=<value>` 检索到同一异常/请求），可选 `errorMsg` 为安全诊断；不再对客户端暴露请求级 `traceId`（改用 body `id`）。前端 transport 统一经 `ApiError` parser，`errorCode -> i18n` 本地展示错误并显示 `id` 诊断 ID，Retry 由 `retryable` 决定。新增码必须同步 `docs/api/error-contract.md`、后端测试与 zh/en/ru locale。

主要业务域：

- `replay`：Processing Job、Export Job、Battle Reconstruction、AI Review。
- `hof`：单场名人堂。
- `hundred`：百场名人堂（MANUAL 人工证据审核）。
- `mark3`：Tier X 单车最速三环人工审核排行榜（PENDING/CURRENT/REJECTED/CANCELLED/DELETED，无 SUPERSEDED）。
- `user`：Profile、WoTB 账号、Notification。
- `boost`：陪练/打手业务。
- `admin`：用户和后台管理。

### Replay Processing

Processing Job 创建后持久化输入，协调器经 `ReplayProcessingDispatcher` 将 source 任务提交给
`wotb-replay-processing` 中的全局 `ReplayParseScheduler`
（Replay Full Processing 唯一 CPU 预算：默认并发 2、job-aware 公平轮转、queued
cancellation、有界 pending）；每个 source 独立 `processFull` 后写 derived artifact
（`ai-facts.json` / `map-overview.json`，原子写、先写后 READY），全部完成后单线程
deterministic FINALIZING_BATCH（去重 / League / Rating / 汇总）→ READY 保存
`ProcessedDataset`。Preview / Export / AI / 战局回放消费同一 Dataset（AI/Playback 走
`processingJobId + sourceId` 引用读 artifact，不再重复 full process）。`ReplayJobState` /
`ReplayJobStorage` 是 Export 与 Processing 共用的状态机/临时目录底座；
`ReplayArtifactWriter` 负责 artifact 读写，`acquireForSource/release` 提供 Dataset
Lease（读取期间 TTL 不清）。

公开解析边界：最多 100 个 replay、单文件 20 MiB、总请求 200 MiB；Replay Full Processing
默认并发 2（`REPLAY_PARSE_MAX_CONCURRENT`），pending source 上限 200
（`REPLAY_PARSE_QUEUE_CAPACITY`，满载 503 `PROCESSING_QUEUE_FULL`）；Excel/ZIP artifact
构建并发独立为 1（`REPLAY_ARTIFACT_MAX_CONCURRENT`）。

### League Rating

训练房 `arenaBonusType=2` 与联赛/锦标赛 `=4` 才启用 0–1000 League Rating。普通回放不显示 Rating；混合普通 + League 批次 League Rating 不聚合（`league=null` + `leagueUnavailableCode=MIXED_LEAGUE_AND_STANDARD_REPLAYS`，battles 仍按普通回放语义成功返回）。评分、完整性校验、V6 pooled sum/count 批次汇总和 Excel 必须复用 core 单一公式。

选手 Drawer 的「最常使用坦克」是纯展示（不参与 Rating / 七维 / MVP / Team Rating）：Core
`LeagueRatingBatchAggregator` 在 rated-only 循环里按 accountId 关联 `PlayerResult.tankId` 累计为
`PlayerLeagueSummary.vehicleUsage`（`List<PlayerVehicleUsage>`，只有 tankId + battles，Core 不复制
Tankopedia）；Web `Mapper` 消费 `Tankopedia` 选最常使用（场次降序 → 官方名忽略大小写升序 → tankId
升序；无可靠名称返回 null），生成 `LeaguePlayerSummaryDto.mostUsedVehicle`
（`LeagueVehicleUsageDto`）。前端 Drawer 渲染贴图（本地 Tier X WebP，缺图/非 Tier X 文字降级）与占比；
Battle 直接取该场 `tank_id`/`tank_name`（来源 `PlayerResult.tankId`）。

### Hall of Fame / Hundred Battles

单场 HoF 仅允许录像者本人随机战 `arenaBonusType=1` 或游戏内 Rating `=7`，其它模式拒绝且零持久化。

百场域生命周期为 `PENDING/CURRENT/SUPERSEDED/REJECTED/CANCELLED/DELETED`：

- MANUAL：截图 + 5 个 replay，管理员审核；WG 登录用户同样使用此流程。
- 管理员只能通过、拒绝或删除，不能改写成绩。
- 管理员百场摘要列表只展示通过后的值；申报值仅在详情保留。
- V20 的 `verification_source` / 官方 snapshot 列是历史 schema residue，应用不再映射；发布新版本前须先备份数据库，在旧版本/schema 上运行 `tools/cleanup-hundred-wargaming-api.py` dry-run，核对数量后再用精确确认 token apply。工具只删除 `WARGAMING_API` 来源，并按 MANUAL 与单场 HoF 的共享回放引用保护物理文件。

三环域只走人工审核：1–2 张截图、5 个已验证 replay，按 approved battleCount 升序 competition rank；CURRENT 不可替换，REJECTED/CANCELLED/DELETED 可重提。三环 replay 解析通过共享 `ReplayCapacityLimiter`，容量满沿用 `REPLAY_BUSY`。

**HoF ownership 的 canonical identity 是 `(区服, WotB 游戏账号)`，不是 Keycloak 用户**（Flyway `V22__hof_ownership_by_wotb_account.sql`）：百场/三环 submission 的 owner 为 `(wotb_server, wotb_account_id)`（`wotb_account_id` 在 V22 前名为 `game_account_id_snapshot`，`wotb_server` 为 V22 新增的 `varchar(16) NOT NULL` 快照列，CHECK 取值 `CN|ASIA|EU|NA`），`user_keycloak_id` 已删除，partial unique index 与查询索引改按 `(wotb_server, wotb_account_id, vehicle_id)`；单场 `hall_of_fame_record` 从一开始就按 `account_id` 归属（**无区服维度**，`GET /api/users/profile/records` 也只按账号 ID 匹配——已知遗留，见 [`docs/features/hall-of-fame.md`](features/hall-of-fame.md)）。区服不是可省略的展示字段：`(CN, 123456)` 与 `(EU, 123456)` 是两个不同账号，该组合与 `user_profile` 的 `UNIQUE (wotb_server, wotb_account_id)` 一致。归属解析的唯一入口是 `UserProfileService.currentWotbIdentity(keycloakUserId)` → `Optional<WotbAccountIdentity(server, accountId)>`；`cancelSubmission` / `userStatus` 同时比较**区服与账号**（任一不符或未绑定 → 403 `HUNDRED_FORBIDDEN` / `MARK3_FORBIDDEN`；未绑定账号时 status 返回三个空列表）。

**V22 是 fail-fast preflight，不含任何自动消解**：执行顺序为「加 `wotb_server`（先可空）→ 从 `user_profile` 回填（仅当旧 `user_keycloak_id` 对应的 profile 当前仍绑定同一账号时取其所服）→ preflight（区服无法解析 / 新 ownership 键下重复 active 记录均抛错并给出诊断）→ 收紧 NOT NULL 与 CHECK → 重建索引 → 删 `user_keycloak_id`」。迁移**不选 winner、不改任何 `status`、不删任何 replay evidence、不清空任何截图、不为无法解析的历史行猜区服**；Flyway 在 PostgreSQL 上把迁移包在单一事务里，因此 preflight 失败时全部 DDL/DML 回滚，数据库停留在 V21。冲突判定口径两域不同：百场是两个独立 partial index（按 `(区服, 账号, 车辆, 状态)`），三环是单个跨状态组合索引（按 `(区服, 账号, 车辆)` 跨 `PENDING`/`CURRENT`）。冲突只能由管理员**有意**处置后重跑迁移（见下方 runbook 与缺口说明）。

**迁移 runbook（V22 preflight 失败）**：

**前提**：preflight 失败时 V22 已整体回滚，schema 停留在 V21，因此检查命令只能用 V21 列
（`user_keycloak_id` / `game_account_id_snapshot`）；`wotb_account_id` / `wotb_server` 此刻不存在，
候选区服通过 `LEFT JOIN user_profile` 反推。

```text
1) 读 Flyway 报错的 message / detail / hint：detail 直接列出前 20 个样例 id 或全部冲突键
2) 区服无法解析（百场；三环把表名与列换成 mark3_submission）：
     select s.id, s.user_keycloak_id, s.game_account_id_snapshot, s.status,
            p.wotb_server as candidate_server
       from hundred_battle_submission s
       left join user_profile p
         on p.keycloak_user_id = s.user_keycloak_id
        and p.wotb_account_id = s.game_account_id_snapshot
      where p.wotb_server is null;
   → 恢复 / 重绑该行所属 profile（让回填能取到区服），或有意删除这些行
3) ownership 冲突：按 候选区服 + game_account_id_snapshot + vehicle_id [+ status] 自行分组后
   人工比对 approved_average_damage / submitted_at 等，由人决定保留哪一条
4) 有意清理其余记录，然后重跑迁移（Flyway 重新执行 V22）
```

**失败时刻的处置工具可用性**：新版本起不来，本次新增的 bulk-delete 端点不可用；只有旧版本提供的
`POST /api/admin/hof/{hundred,mark3}/submissions/{id}/delete` 可用，且只接受 `CURRENT`。非 `CURRENT` 的行
（如被点名的 `PENDING`）需要运维显式 DB 动作，且 evidence 外键为 `RESTRICT`，删 submission 前先删证据行。

> 已知缺口（待产品决策，非本 PR 范围）：被 preflight 点名的 `PENDING` 行目前没有受支持的 admin 处置路径。

详细契约见 `docs/features/hall-of-fame.md`（含三个域的删除语义对照与 IAM≠HoF 不变量）。

### Admin（Admin Users / Admin HoF 治理）

**删除用户 ≠ 删除 HoF 记录**：HoF 数据属于 WotB 游戏账号（百场/三环为 `(区服, 账号)`，单场为 `account_id`），仓库中没有任何 FK 指向 `user_profile`（全仓唯一的 `on delete cascade` 在 `V3__create_boosting_tables.sql`，boost 域内部）。因此**删除 Keycloak 用户必须走 WotBTools admin API**（`AdminUserService` 先删本地 profile 再删 Keycloak 用户）；绕过它直连 Keycloak 会留下孤儿 profile 并阻塞后续重绑，需用 Admin Users 的 `segment=local` 清理。

**Admin Users 列表（服务端分页 + 合并数据源）**：`GET /api/admin/users?query=&segment=&idpAlias=&page=0&size=25` 返回 `{items, page, size, totalItems, totalPages}`；**旧的 `?limit=` 参数已移除**（不再有 `limit=200` 的假分页），`size` 会被 clamp 到 1..100，`page` 为 0-based。

| 参数 | 语义 |
|---|---|
| `segment=keycloak`（默认） | 权威源是 Keycloak realm users（Keycloak Admin API `first/max` 分页 + 权威 count），本地 profile 只按当前页做一次 IN 查询增强。**没有任何本地 profile 的 Keycloak-only 用户也能被找到并删除**（旧 Juhe QQ cleanup 的前提）；支持 `idpAlias` 过滤 |
| `segment=local` | 权威源是本地 `user_profile`（DB 分页 + 权威总数），用于暴露 Keycloak 侧已不存在的**孤儿绑定**（行上 `keycloakUserMissing=true`），删除它可释放 `(wotb_server, wotb_account_id)` 唯一槽位。传 `idpAlias` → 400 `IDP_FILTER_REQUIRES_KEYCLOAK_SEGMENT`；未知 segment → 400 `INVALID_USER_SEGMENT` |

列表行 DTO（`AdminUserListItemDto`，旧的 `AdminUserDto` 已删除）：`keycloakUserId, keycloakUsername, keycloakEmail, keycloakEnabled, profileId, displayName, wotbAccountId, wotbNickname, wotbServer, profileCreatedAt, hasLocalProfile, keycloakUserMissing`。两个 segment 都不做「拉一页再在内存里筛」的伪造分页。`segment=local` 的代价是每页产生 N（≤ size）次 Keycloak Admin 调用——**Keycloak 没有按 ids 批量查询用户的能力**，这是客户端/服务端的能力事实，见 [`docs/auth/keycloak-admin-user-search.md`](auth/keycloak-admin-user-search.md)（该文档同时记录 admin-client 26.0.9 的重载缺口与「IdP 过滤在 CI 端到端验证前不得宣称生产可用」的局限）。

**Admin DTO 的 WotB 身份字段（本轮同步）**：百场/三环的 admin DTO 现在都携带 `wotbServer`，与 `wotbAccountId` 一起表示归属身份，避免管理页只显示账号 ID 时把跨服同号看成同一个账号。

| DTO | 身份字段 | 前端渲染 |
|---|---|---|
| `AdminUserListItemDto`（user 域） | `wotbServer` + `wotbAccountId` | 用户列表 |
| `HundredAdminListItemDto` / `HundredAdminDetailDto` | `wotbServer` + `wotbAccountId` | 百场审核列表 + 详情（`{{ wotbServer }}·{{ wotbAccountId }}`） |
| `Mark3AdminListItemDto` / `Mark3AdminDetailDto` | `wotbServer` + `wotbAccountId` | 三环审核列表 + 详情（同上） |

`HoFAdminPage.vue` 在百场/三环的列表与详情共 4 处使用 `{{ wotbServer }}·{{ wotbAccountId }}`；`wotbServer` 的取值域是 `CN|ASIA|EU|NA`（DB CHECK 约束）。

**批量删除契约（三个域共用形状，partial success）**：

| 端点 | 请求体 | 响应 |
|---|---|---|
| `DELETE /api/admin/users?confirm=true` | body 为 Keycloak sub 数组（单条 = 长度 1） | `{requested, deleted, failed, results:[{userId, deleted, errorCode}]}` |
| `POST /api/admin/hof/records/bulk-delete` | `{ids}`（单场无 reason） | `{requested, deleted, failed, results:[{id, deleted, errorCode}]}` |
| `POST /api/admin/hof/hundred/submissions/bulk-delete` | `{ids, reason, reasonText}` | 同上 |
| `POST /api/admin/hof/mark3/submissions/bulk-delete` | `{ids, reason, reasonText}` | 同上 |

共同语义：每个目标跑在**独立事务**中（`TransactionTemplate`，禁止 `this.method()` 自调用绕过 Spring 代理），因此允许 partial success；单批去重后上限 100 → 400 `BULK_LIMIT_EXCEEDED`。用户批量删除的 `confirm` 缺失/false → 整批 400 `CONFIRMATION_REQUIRED`，且逐用户复用 `deleteOneInternal` 的全部业务保护（self-delete 保护、打手依赖阻断、先删本地 profile 再删 Keycloak、审计日志）。HoF 批量删除**逐条复用权威单条删除语义**：单场仍是 hard delete（audit 快照 + 真删行 + commit 后引用计数清理物理文件），百场/三环仍是 soft delete（仅 CURRENT 可删，`CURRENT` → `DELETED`）；非 CURRENT 逐条失败于 `HUNDRED_NOT_CURRENT` / `MARK3_NOT_CURRENT` 而不阻塞其他记录。百场/三环的 reason 是批次级参数，先整体校验一次（参数错误整批 400，不表现为逐条失败）。

新增错误码（`util/ErrorCode.java`）：`BULK_LIMIT_EXCEEDED`、`INVALID_USER_SEGMENT`、`IDP_FILTER_REQUIRES_KEYCLOAK_SEGMENT`。

**契约覆盖范围（本轮更新）**：`contracts/http/openapi.yaml` 本轮新增 `GET /api/admin/users`（服务端分页）、`DELETE /api/admin/users`（body 为 Keycloak sub 数组，单条即长度 1）、`POST /api/admin/hof/records/bulk-delete`（单场，无 reason）、`POST /api/admin/hof/mark3/submissions/bulk-delete`，以及 6 个 schema（`AdminUserListItem`、`AdminUserPage`、`DeleteUserResult`、`DeleteUsersResponse`、`BulkDeleteModerationRequest`、`BulkDeleteRecordsRequest`）；百场 admin 的 `gameAccountIdSnapshot` 已改名为 `wotbAccountId` 并新增 `wotbServer`，`HundredAdminListItem` / `HundredAdminDetail` 两个 schema 覆盖该字段。

**既有缺口（如实记录，本轮未补全）**：mark3 的 admin GET 家族（`Mark3AdminListItemDto` / `Mark3AdminDetailDto`）**从未进入 OpenAPI**——即便 Java 侧两个 DTO 本轮同样新增了 `wotbServer`，`openapi.yaml` 里也不存在对应的 mark3 admin schema；单场 HoF admin 列表/详情的完整字段同样未覆盖。补全它们超出本次改动范围。生成产物 `frontend/src/api/generated/*` 由 `npm run api:generate` 重建，禁止手改。

**Admin HoF 治理边界**：admin 是 governance，不是数据编辑器——`/api/admin/hof/**` 只做查看 / 搜索 / 筛选 / 下载 / 删除 / 审计，禁止人工修改 replay-derived authoritative facts。

---

## 前端架构

### UI Profile 与主题（showcase=dark, classic=light）

**`data-theme` 不是独立主题偏好，而是 UI Profile 唯一派生。**

- `showcase` → `data-ui-profile="showcase"` + `data-theme="dark"` + `color-scheme:dark`（默认，保持生产深色沉浸视觉：AI 背景/渐变/阴影）。
- `classic` → `data-ui-profile="classic"` + `data-theme="light"` + `color-scheme:light`（真浅色简约：浅灰底/白卡片/深色文字/浅边框/轻阴影/橙金强调）。
- `frontend/index.html` 首屏内联脚本按 `wotb-ui-profile` 同时设置 `data-ui-profile` 与派生的 `data-theme`（无 FOUC）；`src/styles/tokens.css :root` 仍是 dark 基础视觉 token 单一事实源，Classic 由 `styles/classic-profile.css` 的 `html[data-ui-profile="classic"]` 覆盖浅色语义 token + namespace 覆盖（该文件必须最后导入）。
- 唯一持久化状态 `wotb-ui-profile`（只存 profile，不存主题）；不读取 `prefers-color-scheme`；不保存独立 `wotbtools-theme` cookie/localStorage；不存在独立 `useTheme` / `utils/theme.js`。
- 当前 Showcase Topbar 高度为 **60px**，`--topbar-h` 也必须保持 60px；full-workspace viewport 依赖这个 token。
- Sponsor 独立静态页（homepage/）固定暗色，不经 Profile 派生。

约定：`data-theme` 由 `useUiProfile.themeForProfile` 派生；禁止手工 set `data-theme` 或另立 theme 状态；Classic 只改 Presentation 层，不改 layout/density/spacing/结构/业务组件；禁止 `filter:invert` / 全局 opacity / `html *` / 双套业务组件 / `:key="uiProfile"` 触发重建。

### i18n

基础 locale：

```text
frontend/src/locales/zh.json
frontend/src/locales/en.json
frontend/src/locales/ru.json
```

PR125 起按功能追加的消息使用：

```text
feature-messages.json
messages.js
```

`messages.js` 非破坏性 deep merge 基础 JSON，禁止在 `main.js` 或组件初始化阶段直接修改 imported locale 对象。这样必须保留已有 key，例如 `replay.processing_job.mixed_league_standard`，同时可以补历史 Notification code。

语言持久化只使用 `localStorage('wotb-lang')`。

### Layout primitives

- `layout-content`：Profile / Settings / 普通内容。
- `layout-wide`：HoF / Rating / 数据页。
- `layout-data-workspace`：Replay Parser / 大表格。
- `layout-full-workspace`：Battle Reconstruction / Map / Strategy。

Replay/管理宽表必须保持高 information density；允许横向滚动，但不能因为页面容器过窄而制造无意义滚动。

Showcase Topbar 为 60px。跨页面高优先级修复集中在 `showcase-regressions.css`，该文件最后加载，只用于布局/叠层 regression guard，不承载主题状态。

### Replay capabilities

`?view=replay` 专注批量解析、结果预览和汇总；AI 复盘与战局重建分别注册为
`?view=ai-review`、`?view=battle-playback` 独立能力页。解析页的具体 Battle 通过
内存 `ReplayDatasetRef = { processingJobId, sourceId }` 交接，三者继续消费同一
`ProcessedDataset`，不按文件名推断身份，也不重复创建 Processing Job。

规则：

- 独立能力页只接受单个 replay；多文件选择会给出明确提示。
- 从解析页进入 AI/Playback 时不显示上传器，直接使用权威 sourceId；刷新或引用过期后回到可重新上传状态。
- 解析后的 Aggregate/Summary 不代表某一场 battle；结果 toolbar 的 battle-level shortcut 只在具体 battle tab 出现。
- League 模式的汇总人数读取 `league.playerSummaries.length`；普通模式读取 `aggregate.length`。

Processing/Export task notification 必须低于 Modal stacking level；移动端必须限制 viewport 尺寸，不能遮住整个结果区。

### SPA views

- `?view=home`：主页。
- `?view=replay`：Replay Workspace。
- `?view=hof`：名人堂。
- `?view=hof-admin`：名人堂管理。
- `?view=boost`：陪练。
- `?view=profile`：个人中心。
- `?view=admin-users`：用户管理。
- `?view=version`：版本历史。
- `?view=contact`：联系页。
  - `?view=rating-docs`：League Rating V6 算法说明页（构建期以 `?raw` 读取
  `docs/WotBTools_League_Rating_V6.md`，canonical 单一事实源；ReplayPage League 模式
  「算法说明」按钮跳转进入，返回时经 KeepAlive 保留解析状态）。
- `?view=playback-qa`：隐藏 QA 页（admin）。
- `?view=rating-v2`：隐藏历史 Rating V2 灰度页（仅 `wotbtools-admin`，只读 READY Processing Job）；
  选中结果表玩家后在右侧非模态抽屉查看 V2 六轴雷达（移动端为遮罩面板）。V2 保持相对当前批次的
  `平均=75 / 2×平均=100 / 4×=125 / 8×=150` 标尺；V6 七维改用 `0→0 / 当前 Battle/Global
  Average→75 / 后端维度满分→150` 的分段线性标尺，100 对应平均到满分区间的三分之一。玩家顶点显示
  0–150 视觉分，明细默认分数并可切换原始值；共享图形支持 50%–150% 缩放（只影响页面 SVG，窄屏由
  radar viewport 横向滚动），V2 桌面抽屉宽 560px，V6 继续使用可拖拽持久化侧栏。V6 Rating Profile PNG
  同步 bounded geometry 但保持固定导出尺寸。移动端模态抽屉锁定 Tab 焦点，桌面非模态不锁；后端 raw
  score/评分公式与 API 不变。
- `?view=ai-review` / `?view=battle-playback`：与 `?view=replay` 共用同一个 `ReplayWorkspace`，
  仅默认 `activeCapability` 不同（ai / playback）。三者不是三个隔离业务页。

旧 `?view=leaderboard` canonicalize 到 `hof`；旧 `?view=extended` canonicalize 到 `replay`；旧 `?view=reconstruction` canonicalize 到 `battle-playback`。

### AI Review / Battle Playback

`ReplayWorkspace` 是回放数据 / AI / 战局回放三个能力的统一载体：通过唯一 `useReplay`
组合并消费 `useReplaySession` 持有的 selection / Processing / Result identity（并 `provide('replay')`），Processing lifecycle 由 `useProcessingJob` 持有，data / AI / Playback 共享同一
`processingJobId + sourceId` Dataset 引用，绝不 multipart 重传/重解析。三个 capability tab 始终可见
（不因能力不可用而消失）；AI 与 Playback 各持独立 `useCapabilityReplay`，Dataset 状态互不污染。
Workspace 的标题/清空、能力 tabs、批次与当前回放 selector 分别由
`ReplayWorkspaceHeader`、`ReplayCapabilityTabs`、`ReplaySourcePanel` 展示；这些子组件只接收派生状态并发出命令，session 仍是唯一 selection owner。
`ReplayPage` 作为 data 结果 tab 嵌入（`embedded` prop），在 Workspace 内只渲染结果 / 列系统 / Export /
Drawer。**登录门禁**：整个 Replay Workspace 全部要求登录——未登录进入任意 replay capability
（data / ai / playback）自动跳 Keycloak/OIDC 并按 redirectUri 回原 capability，不再有「data 匿名解析」；
判断前先等 Keycloak init 完成（auth init race safe），已有 SSO/session 用户不被无谓 `kc.login()` 打断。
`useAuth` 将状态明确表示为 `idle` / `initializing` / `authenticated` / `unauthenticated` /
`failed`；12 秒 app-level watchdog 到期后进入可恢复失败态，不把失败伪装成匿名。retry 与
login recovery 会创建新的 Keycloak adapter generation，旧 init 的迟到结果不能写回；正常 Web/Android
仍使用 `check-sso`，只有 direct login recovery 不重复 silent iframe bootstrap。
Workspace 是四态 UI gate（检查登录态 / Login Required + 可重试登录 / auth init failed + 恢复操作 /
工作台）：未登录时不渲染
Source panel、上传器与任何 capability 面板，因此未登录无法发出 processing 请求；`useAuth.login()` 只对
「同一个进行中的 redirect」去重（`loginInFlight` 在 `finally` 释放，无 component-lifetime 一次性锁），
失败或取消后 capability tabs、登录按钮与 UserMenu 都能重新发起新的 login transaction。后端同样把
`/api/replay/processing-jobs/**`（创建/状态/result/取消）收紧为 `wotbtools-user`/`wotbtools-admin`，
前端 gate 只是 UX，后端才是 authorization authority。
**能力解耦**：AI 与 Playback 仅共享 replay/source/processing dataset，不做 `AI@seek → Playback`
时间点联动 / 跨 capability 状态 handoff。tab 切换经 pushState + popstate 形成可 Back/Forward 的 history，
返回时 selection / Processing Job 不丢，只恢复 activeCapability。
**Android 外部 replay 完整自动解析**：仅 Android external intent 触发——Native `shouldInterceptRequest` 以
固定同源 `https://wotbtools.com/__native/replay-pending` stream 缓存字节，Web `fetch(pending.uri)` 构造 `File` → 替换 selection →
自动 `startProcessingJob` exactly once（READY 后 data tab 展示结果，绝不自动启动 AI，失败走现有
Processing error/retry，不无限重试）；普通 Web/FileUploader 手动选文件不经过此路径，保持现有 UX。
读取使用 `X-Wotb-Pending-Id` header 校验 metadata 与文件 identity，避免 pending 替换时串包；
Native 无 pending/文件返回 404、identity 不匹配返回 409、读取失败返回 500，禁止网络 fallback，响应 no-store。
读取失败复用 Replay 错误区与重试，不 ACK；WebView file/content access 保持禁用。
`getPendingReplay()==null` 不清零 eligible（warm resume 后 Native 新增 pending 仍可消费）。
Pending replay 只在已登录时消费，ACK 边界是「server 已接受 processing request」
（`startProcessingJob()` 返回 `accepted: true` + `jobId`）而不是 job READY；未登录/未受理/失败一律不 ACK，
Native pending 原样保留。auth flow 进行中的 replay intent 只入队、绝不抢 WebView navigation；pending
metadata（24h TTL）持久化在 app private storage，可跨 QQ 登录期间的 process death 恢复。核心实现仍由
`AiReviewPanel`（SSE 分析流 + 结果）与 `BattlePlaybackPanel`
（cached map-overview + MapOverview）提供。Tier X 车型图位于 `src/assets/tank-portraits/tier-x/<tankId>.webp`，
由 BlitzKit 确定性生成，production 不访问 BlitzKit。

Battle Playback 的页面编排保留在 `BattlePlayback.vue`；地图 SVG/标记/瞬时反馈与 canonical 2 秒轨迹由
`BattleMap.vue` 渲染，通用 HUD 由 `BattlePlaybackHud.vue` 渲染，播放控制与标注工具由
`PlaybackControls.vue`/`AnnotationToolbar.vue` 渲染。`PlaybackTimeline.vue` 是纯 seek bar，事件列表位于
`PlaybackSidePanel.vue` 并通过 root command 执行 seek + pause；当前车辆详情仍由
`VehicleDetailsPanel.vue` 渲染。wrapper12 权威基地状态由后端 projector 提供 `baseStates`，前端只按当前
回放时间查询，不从静态地图或最终结果推导。wrapper12 raw update 只在后端经过
`SupremacyBaseStateReconstructor` 形成带 `baseId`（A/B/C/D）的完整 canonical state，前端不合并
protobuf sparse update；坦克 marker sizing 优先使用可靠 hull metadata，model overlap 只通过有界
presentation offset 软避让，canonical 坐标和命中判定语义保持一致。
车辆状态投影与时钟推进分别由 `utils/playbackVehicleState.ts`、`utils/playbackClock.ts` 提供纯函数，
组件只负责把 canonical V2 数据转换为展示 props/commands。
对应测试按 ownership 分层：地图/标记/手势、控制、时间线、详情面板及时钟/车辆投影各有 focused
suite，共享 fixture 位于 testing-only `playbackTestHarness.js`；`BattlePlayback.test.js` 与
`BattlePlayback.integration.test.js` 只验证无法由单组件证明的跨组件协作与历史回归。

地图鸟瞰/战局回放契约见 `docs/features/battle-playback.md`；AI 双 Call、Team Review、Evidence/Validator 契约见 `docs/architecture/ai-review.md` 与 `docs/features/team-ai-review.md`。

---

## Wargaming 登录与 WoTB 账号

每个 Keycloak 用户都有 `region`：`CN/ASIA/EU/NA`。

WG broker 身份以 `wg:{region}:{account_id}` 隔离区服；`account_id` 必须来自 WG 服务端 token prolongate 响应，浏览器回调提供的 accountId/nickname/expiresAt 只能做一致性检查，不能作为信任源。

JWT mapper 提供 `wotb_region / wotb_account_id / wotb_nickname / wotb_verified`。WG Profile 为只读来源；Profile 不存在时 `PUT /api/users/wotb-account/from-login` 可以原子创建/同步 WARGAMING 资料。

`WG_APPLICATION_ID` 仅注入 Keycloak，用于 WG IdP；backend 不再需要该配置。

IdP 部署步骤见 `docs/auth/wargaming-asia-deployment.md`。

### 身份两层与 profile self-heal

```text
Keycloak User  = 认证 / IAM 身份（谁登录了）
user_profile   = WotBTools 业务用户投影（这个人在业务上是谁）
```

稳态不变量：**每个活跃、已认证并成功进入 WotBTools 的用户都拥有 `user_profile`。**

实现方式是 **eventual self-healing**，不是跨系统强事务：

```text
Keycloak 认证成功
  → 进入 SPA（任意 view：home / replay / battle-playback / AI Review / HoF / admin / profile / boost）
  → AppShell 触发 useBusinessUserBootstrap()
  → PUT /api/users/profile（幂等 ensure）
  → 已有 profile 原样返回；没有则按 canonical provisioning 创建
```

- **canonical owner 只有全局 bootstrap**（`frontend/src/composables/useBusinessUserBootstrap.js`）。页面只等待其结果，不得各自实现「读不到资料 → 自己创建」。
- **KC-only 是允许的临时/历史状态**：broker 刚注册但浏览器还没回站、用户回站前关掉浏览器、bootstrap 暂时失败、历史 legacy 数据、管理员手工建 KC user。任何 KC-only 用户下一次成功进入 WotBTools 都会被自动补齐。
- **不做强一致声明**：Keycloak 与业务 DB 之间没有分布式事务，也不在 Keycloak First Broker Login 里写业务库；provisioning 失败**不删除 Keycloak 用户**、**不回退认证状态**、**不永久缓存失败**（刷新 / 重新 bootstrap / 页面上的重试入口都会重新 ensure）。
- **`PUT /api/users/profile` 是 ensure 而非 create**：已存在时不改写 `wotb_server` / `wotb_account_id` / `wotb_nickname` / `wotb_account_source` / `wotb_account_verified_at`。并发 ensure 靠唯一约束**按约束名**区分：`keycloak_user_id` 冲突（同一 sub 的并发创建）重读胜者并幂等成功；`(wotb_server, wotb_account_id)` 冲突是真实账号占用，仍返回 409 `WOTB_ACCOUNT_ALREADY_USED`，绝不吞掉。
- **Admin Users 仍以 KC 为权威**（`segment=keycloak` 默认）并显式暴露 `hasLocalProfile=false`，作为 IAM 清点与 legacy/不完整状态的观测能力；self-heal 不改变这一点。
- **Boost 打手选择器显式用 `segment=local`** 并排除 `keycloakUserMissing=true` 的孤儿绑定（那是管理员清理对象，不是有效打手候选）。

Keycloak 登录页为 V8 Unified Theme（深色=Battlefield/浅色=Minimal、深色登录卡局部毛玻璃 dark-only、浅色无 blur、IdP 动态渲染、`registrationAllowed:false`）；主题文件在 `docker/keycloak/themes/wotbtools/login/`，仅覆盖 `template.ftl`（其余认证页经 `registrationLayout` 共享），生产 realm 需手动设 `loginTheme=wotbtools` 并关闭 Registration（见 `docs/auth/keycloak-login-theme.md`）。

---

## i18n / DTO 约定

API 只输出稳定英文 key/enum。前端 `player_labels` / `agg_labels` 渲染三语；Excel 继续使用中文表头。新增任何 `code/error/warningCode` 必须同步三语 `api_codes/api_errors`。

站内通知保存 `type + payload`，boost domain 只通过 `UserNotificationService` 写事件；显示文案由前端 locale composition 负责。

---

## CI/CD 与生产部署

### OpenTofu production baseline

现有生产 COS artifact bucket 的 OpenTofu 配置位于
`infra/tofu/environments/prod`，权威 state 存放在独立的 Tencent COS state
bucket；设计、一次性 import、locking 边界与 owner 命令见
`docs/architecture/opentofu-production-baseline.md`。

OpenTofu workflow 对 fork PR 使用 `tofu init -backend=false`，不获得生产
credentials；trusted same-repo PR / owner 手工触发才在 backend init 与
authenticated plan 两个步骤注入 scoped secrets。所有运行继续执行
`fmt/init/validate`，trusted run 额外执行只读 `tofu plan`，永不执行
`import` 或 `apply`。CI concurrency 只串行 GitHub workflow，不等价于
backend distributed lock。trusted plan 还会阻断 artifact bucket、生产
Lighthouse instance 或 firewall collection 的 delete/replacement action。

当前 production root 除 COS artifact bucket 外，仅纳管已发现并手工
import 的 Lighthouse 实例 `lhins-97n0wmx6` 及其四条现有 firewall 规则。
它不是 CVM；VPC/subnet/security-group/disk 未在本次缺少完整读取权限的
情况下猜测纳管。新增资源前必须先完成 owner discovery、provider schema
核对、manual import 与 authenticated `No changes` plan。

Grafana API configuration 的独立 OpenTofu root 位于
`infra/tofu/grafana`，使用同一 COS state bucket 的独立 key
`wotbtools/prod/grafana.tfstate`，provider 固定为 `grafana/grafana 4.45.2`。
6 个 dashboard 由 provider 管理，canonical JSON 仍来自
`deploy/observability/grafana/dashboards`；Prometheus/Loki datasource 因
Grafana `readOnly` 继续由 file provisioning 管理。Docker Compose 仍管理
Grafana runtime。PR workflow 只做 trusted authenticated plan；合并到
`main` 后由 `.github/workflows/grafana-tofu-apply.yml` 重新 plan、执行
三项旧 dashboard 的精确 delete allowlist safety gate、apply 同一个 saved
plan，并只读验证 6 个保留 UID 与 3 个移除 UID 的 404。认证只从 GitHub
Actions secret `GRAFANA_PAT` 注入；当前
secret 是 owner 批准的既有 Admin service-account token，最小权限 Editor
token 是后续 hardening，不得把当前 token 描述成 least privilege。

local state、计划文件和真实 tfvars 禁止提交；`.terraform.lock.hcl` 必须继续
提交。state bucket 是当前 owner-managed bootstrap boundary，不由 production
root 管理，也不能使用带一天 expiration 的 artifact bucket 承载 state。

生产 Build 与 Deploy 分为 `.github/workflows/build.yml` 和
`.github/workflows/deploy.yml`。Build 在 `main` 成功 push 后构建 immutable
`sha-<SHA>` 镜像并上传唯一 `deployment-manifest`；Deploy 由成功的 Build
`workflow_run` 自动接力，也保留 `workflow_dispatch` 手动入口。Build 可选择
`all` 或单个应用镜像；Deploy 只部署 manifest 中的 production Compose service。
纯 `deploy/observability/grafana/dashboards/**` 只触发 Grafana OpenTofu API
reconciliation，不触发应用 Build。生产发布原则：

1. 代码质量验证（后端 Maven / 前端 Vitest + Vite build）由 PR CI 作为 merge gate 承担；Build/Deploy 不重复运行测试套件，Build 只负责 Docker 镜像构建推送，Deploy 只负责部署与健康检查。无论 main push 或 `workflow_dispatch`，`changes` job 只解析一次 `main` 的 full commit SHA，production builders 全部 checkout 该冻结 SHA，不能从 feature ref 或移动的 main 推送 SHA / `latest`。
2. Build 构建同一 frozen main commit 的 backend/frontend/keycloak `sha-<SHA>` 镜像，并把 commit SHA、Build run number、镜像 tag、需要部署的 service 与需要更新的 image service 写入权威 manifest；生产 compose 钉 SHA，不依赖 `latest`。Deploy 只消费并校验该 manifest，不重新计算变更、不重新 build、不重复跑测试；targeted service 只更新所选 service，非目标应用继续使用当前 live compose 中的 immutable tag。
3. 新 compose 先写 `docker-compose.next.yml` 并 pull；成功后才替换正式 compose。
4. 部署后检查 backend `/api/health`、前端 nginx E2E、Keycloak realm。
5. 每次成功的完整 `all` 部署先把完整已验证部署树提升为 `/opt/wotb/deploy.lkg`、`docker-compose.lkg.yml` 与 `DEPLOYED_SHA.lkg`；targeted service deploy 不提升 LKG。完整 `all` 健康检查失败只从该 LKG 恢复；targeted failure 只恢复失败 service 的 `deploy.prev` / `docker-compose.prev.yml` pre-deploy snapshot，保留其它独立 targeted release。
6. 镜像 prune 只允许在成功部署或成功回滚后执行。
7. 健康检查最终失败时，回滚前必须保留新版本诊断（`report_health_status` 各服务 PASS/FAILED/SKIPPED + `dump_logs` 的 `ps -a`/容器 inspect/三服务 logs）；诊断命令失败不得阻断回滚。
8. 部署前保存 `deploy.prev` 取证快照；compose 切换后显式应用观测配置。阻塞 gate 只验证 backend `/api/health`、frontend/nginx `Host: wotbtools.com` `/api/health` 与 Keycloak OIDC discovery；通过后立即把应用可用部署树提升为 LKG。Prometheus/Loki/Alloy/Grafana、datasource/dashboard、metrics 与 log ingestion 由 `verify-observability.sh` 继续严格验证，但失败只记录 `OBSERVABILITY DEGRADED`，不得触发 application rollback。没有经校验的 LKG 时禁止破坏当前 live tree；若已有健康 live deployment，正常发布流程会先验证并建立 LKG，否则必须 fail-closed 并人工处理。回滚成功标准同样只有三项应用可用性检查。
9. Keycloak 镜像以 `start --optimized` 启动并保留 PostgreSQL 与应用 OIDC discovery；不再启用或暴露 management health/metrics 端口。Keycloak 观测只保留 Docker 日志经 Alloy → Loki → Grafana 的链路，CI 的 `keycloak-runtime` job 必须真实构建并启动该应用运行时契约。

Android 发布同样采用仓库内 Version-as-Code：`android/gradle.properties` 的
`wotbVersion` 是唯一版本来源，`versionCode` 由 SemVer 确定性计算；发布工作流
禁止通过输入参数覆盖版本，并把版本、bridge version、源 commit SHA 写入
`version.json`。`contracts/android-native-bridge.json` 是 Native/Web bridge
契约 SSOT；运行时变更必须 bump Android 版本，breaking bridge 变更必须同步 bump
bridge version、Native 实现和前端兼容门禁。CI 会比较 PR base/head 的版本与契约，
生产发布前还会校验 APK、manifest 和 `version.json` 的 SHA/版本一致性。

**Flyway 迁移不可变（canonical policy 见 `java/AGENTS.md`）**：`java/wotb-web/src/main/resources/db/migration/V*.sql` 中已存在的 versioned migration 是 immutable historical artifact——禁止修改、重命名、删除、格式化、改注释、转换换行或编码；schema 变化只能新增更高版本 forward-only `V<N>__*.sql`。仅当 Git history 证明生产已执行且文件发生 checksum drift 时，才允许恢复 exact deployed blob（本次 V18 是一次性例外）。CI `deploy-smoke` 用 `deploy/check-flyway-immutability.sh` 以 PR base SHA 做 diff 检测，任何既有 migration 的 M/D/R 一律失败，新 migration 版本号必须高于 base 最大版本。

Deploy、Grafana OpenTofu apply 与 database backup 共用 `production-maintenance` concurrency，`cancel-in-progress: false`；这是 GitHub Actions 调度串行化，不等价于服务器端 distributed lock。

生产数据库每日香港时间 03:15 备份 `wotb` 和 `keycloak`，保留 7 天；恢复只允许手工使用 `deploy/postgres-restore.sh` 并显式确认。

Sponsor QR 不进仓库/镜像：生产使用 `/opt/wotb/config/sponsor-config.json` 与 `/opt/wotb/config/sponsor/{alipay,wechat}.png` 只读挂载。二维码加载失败时页面必须隐藏失败方式并回退到“暂未配置”，不得显示 broken image。

---

## Git / 提交

- 执行前先 `git remote -v`，不要写死本机 remote/SSH alias。
- 仓库账号 `A158Coke`。
- 提交信息使用中文；工具支持时可带 `Co-Authored-By`。
- bash 不要使用 PowerShell 的 `git commit -m @'...'` here-string 写法。
- LF/CRLF 转换提示通常只是警告。

---

## 测试策略

- Java：JUnit 5 / Mockito；业务单测不要启动真实 Keycloak。
- 新基础模块：`mvn -s settings.xml -pl wotb-contracts -am test` 或 `mvn -s settings.xml -pl wotb-control -am package`；contracts production classes must remain free of Spring, persistence, broker, storage and provider SDK dependencies。Control API 的 `8090/8091` 端口与现有 `wotb-web` 独立；集成验收必须使用真实 PostgreSQL Testcontainers 与独立 management port smoke。
- Keycloak Admin API 通过 `KeycloakAdminUserService` 封装后 mock。
- **架构测试（ArchUnit）**：`wotb-core` 与 `wotb-web` 各含 `*ArchitectureTest`
  （`com.wotb.core.architecture` / `com.wotb.web.architecture`），随 `mvn test` 自动执行；
  守护模块边界（core 禁 Spring Web/Boot 与反向依赖 web、web domain 分包与分层、
  禁字段注入/Lombok、顶层包无循环依赖）。规则失败即构建失败。
- 前端：Vitest + happy-dom（按需声明）。
- Replay/League/UI regression 必须补针对真实 invariant 的测试，而不是只验证函数被调用。
- **职责分层（Fast Feedback First）**：开发过程中 Agent 只跑 targeted / module / feature regression，
  不重复跑 repository-level full test；仓库级 full validation 由 PR CI 统一执行（authoritative gate）。
  仅当改动影响跨模块 / build / test infrastructure（`.agents/AGENTS.md` 的 Full-test 例外清单）时，
  Agent 才跑 `cd java && mvn -s settings.xml test` / `cd frontend && npm test && npm run build`。
- `wotb-web` 的真实 DeepSeek/provider probe 使用 `@Tag("ai-live")`，普通 `mvn test` 默认不执行；仅在明确选择 probe、清空 `-Dai.probe.excludedGroups=` 且通过环境变量提供 key 时手动运行。gateway mock、loopback 和 deterministic AI eval 仍属于普通测试。
- 涉及 Docker/部署时同时跑对应 Docker build 与 deployment smoke；Deploy 不重复运行测试套件。

---

## 专题文档

| 主题 | 文档 |
|---|---|
| 前端应用架构 / Replay Workspace / UI system | `docs/frontend/architecture.md`、`docs/frontend/replay-workspace.md`、`docs/frontend/ui-system.md` |
| AI 复盘架构 | `docs/architecture/ai-review.md` |
| 回放重建流水线 | `docs/architecture/replay-pipeline.md` |
| 地图鸟瞰 / 战局回放 | `docs/features/battle-playback.md` |
| 战斗表现 | `docs/features/performance.md` |
| 历史 Rating V2（管理员灰度） | `docs/features/rating-v2.md` |
| League Rating | `docs/features/league-rating.md` |
| 名人堂 / 百场 | `docs/features/hall-of-fame.md` |
| Team AI Review | `docs/features/team-ai-review.md` |
| 回放数据字典 | `docs/reference/replay-data.md` |
| 已确认解析字段 | `docs/reference/replay-parsed-fields.md` |
| 地图目录 | `docs/reference/maps.md` |
| Tier X 车型资产 | `docs/assets/tier-x-models/README.md` |
| 观测运维 | `docs/operations/observability.md` |

修改任何专项能力时，以对应专题文档 + 实际代码共同作为验收基线。
