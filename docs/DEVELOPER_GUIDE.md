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

Playback 2D/3D 的布局所有权与浏览器验收矩阵见 [`frontend/replay-workspace.md`](frontend/replay-workspace.md)：共享 fluid 三列、实测正方形 Stage、紧凑 HUD/Transport、Gear 锚定 Display；Details 拖动与 fullscreen/session 生命周期沿用既有 owner。

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
# Full（PR CI authoritative validation，Agent 默认不跑）：cd java && JAVA_HOME=<jdk25> mvn -s settings.xml test
# JAVA_HOME 指向 JDK 25 安装目录（主工程 JDK 25；只有 keycloak provider 子工程用 JDK 21）。
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

# Keycloak realm 集成验证（独立 disposable PostgreSQL + Keycloak + local OpenTofu state）
bash deploy/test-keycloak-tofu.sh
```

后端没有“无数据库” profile。测试 Keycloak Admin 写操作时需要 `wotbtools-admin-api` 服务账号与 `KEYCLOAK_ADMIN_CLIENT_SECRET`。
仓库不再提供本地完整 Docker Compose 开发环境；上述 smoke 不访问 production COS state，也不要求 production secrets。

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
- **UI Profile（展示风格）**：`showcase`（深色，默认）/ `classic`（浅色）共用同一套业务组件、布局、状态与 API；`auto` 偏好按系统深浅色解析到其中一种。共享外壳和已迁移页面使用语义 token，Classic 在 `frontend/src/styles/classic-profile.css` 中提供浅色映射。业务组件不得按 Profile fork，禁止 `:key="uiProfile"` 触发组件重建。详见 [`docs/frontend/ui-system.md`](frontend/ui-system.md)。

---

## 仓库结构

```text
.
├── common/                     # 共享车辆/地图/资产/回放 fixture
├── contracts/                  # FE ↔ BE HTTP OpenAPI wire contract
├── java/                       # Java Maven 根：contracts/core、Replay feature modules、control、web composition root
├── frontend/                   # Vue 3 SPA（Sponsor 为 AppShell 内的 /sponsor 路由）
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
├── docker/                     # backend/frontend/keycloak/ai-service 镜像与 Keycloak 主题
├── deploy/                     # production compose/nginx/备份与回滚
├── docs/                       # 架构、功能、参考、运维文档
└── .agents/                    # Agent 规则与 skills
```

旧 `frontend/homepage/index.html` / `profile.html` 已删除；公共主页与个人中心统一由 Vue SPA 提供。

### HTTP Contract workflow

HTTP shape 变更遵循 `OpenAPI → generated FE transport → backend mapper/serialization → runtime validation → contract tests → affected tests → PR CI`。在 `frontend/` 使用 `npm run api:lint`、`npm run api:generate`、`npm run api:check`、`npm run api:fixture`；生成文件位于 `frontend/src/api/generated/`，不可手改。Playback 旧 artifact 的兼容处理只能放在读取边界；`204` capability unavailable 与 `200` schema violation 必须保持不同语义。完整边界与兼容规则见 [`docs/architecture/http-contracts.md`](architecture/http-contracts.md)。

### PR CI validation gate

`.github/workflows/ci-gate.yml` 是唯一 PR 入口：校验 PR/base/head SHA 身份，用 `dorny/paths-filter` 将变更映射到 owner，调用相应 reusable CI workflow，最后由稳定的 `CI / Required Gate` 汇总。未受影响的 owner 跳过；五个 OpenTofu root 只在各自 owner 受影响时验证。PR trigger 不设置 paths，确保 required check 始终产生。PR CI 不接触 production credentials、host、state 或 authenticated plan。

三个数据更新 workflow 在创建/更新 PR 时分别执行来源数据的真实同步与验证，再 dispatch CI 验证精确 open PR head。生产发布继续由 service owner workflow 的原生路径规则独立触发。

### CI/CD owner 依赖清单

`ci-gate.yml` 读取 `.github/ci-owner-paths.yml` 作为 PR 路由表；生产 owner workflow 的 `on.push.paths` 与 `PRODUCTION_INPUT_PATHS` 必须逐项相同。共享输入按真实依赖 fan-out，未列出的普通文档变更只执行 PR gate。下表是维护边界索引，具体路径以 workflow 为准。

| Owner | Source / shared inputs | Runtime inputs | PR validation | OpenTofu root | Production workflow |
|---|---|---|---|---|---|
| Business API | Java web/core modules、HTTP contract、shared common data | business-api image、TX Compose、dependency readiness | Maven、HTTP contract | — | `business-api.yml` |
| AI Service（预部署） | `java/wotb-ai`、shared core | GHCR image、Yecao Compose、TX ingress `/api/ai/**` 反代（不重写 path）、WireGuard readiness；前端已解除维护（`AiReviewWorkspacePane` 直接挂载，无维护门） | Maven、AI image build、Compose | — | `ai-service.yml` |
| Frontend | Vue、HTTP contract、shared assets/map/tier data | frontend image、nginx、TX Compose | typecheck、unit/browser、bundle | — | `frontend.yml` |
| Keycloak | QQ/Wargaming providers、Keycloak image | realm runtime、TX Compose | provider/runtime、Tofu | `keycloak` | `keycloak.yml` |
| Android | Android source、native bridge、release helpers | APK release | JVM/assemble、bridge/version | — | `android-release.yml` |
| Business PostgreSQL | root config、backup/restore | TX Compose、local state | disposable PostgreSQL、Tofu | `postgres-business` | `business-postgres.yml` |
| Keycloak PostgreSQL | root config、backup | TX Compose、local state | backup safety、Tofu | `postgres-keycloak` | `keycloak-postgres.yml` |
| Observability | Prometheus/Loki/Alloy/Grafana config | Yecao Compose、local state | config/runtime、Tofu | `grafana` | `observability.yml` |
| Caddy / TX Alloy | gateway / TX shipper config | TX Compose | config validation | — | `caddy.yml` / `alloy-tx.yml` |
| Komodo 控制平面 | Core/Mongo Compose、plan guard | Yecao Core/Mongo runtime、`/opt/komodo` local state、DNSPod | Compose 契约、Tofu validation | `komodo` | `komodo-controller.yml` |
| Komodo Periphery (Yecao / TX1 / TX2) | pinned release manifest、每宿主 target profile、共享 config/unit | 各宿主 `/usr/local/bin/periphery`、`/etc/komodo`、systemd unit；Yecao `/opt/periphery`、TX1 `/opt/wotb-tx/periphery`、TX2 `/opt/wotb-tx2/periphery` 暂存 | release/config/unit/target 契约、onboarding 生命周期与 lock fixture | — | `komodo-periphery.yml` |
| Komodo 声明式资源 (K4.1) | `infra/komodo/resources/**` 的 ResourceSync 与 Server 期望状态 | Komodo 控制面（只由人工在 UI apply，CI 不 apply） | `scripts/ci/test-komodo-resources.py`（tomllib 结构契约） | — | — （仅 `deployment` PR gate） |
| Deployment / Python | shared deploy policy / common Python tools | shared scripts | contract smokes / unit tests | — | — |
---

## 后端架构速览

**服务器没有 parser。** 回放解析与对解析结果的一切计算都在客户端（见下方「客户端 Replay Engine」与
[`architecture/replay-pipeline.md`](architecture/replay-pipeline.md)）；服务端只负责存储、去重键、授权、
名人堂记录与 AI 编排。

```text
 wotb-core     model（Battle / PlayerResult 事实形状）/ ref（Tankopedia）/ util /
               replay/{event,facts,feature,evidence,map,processing,reconstruction,timeline}（AI 复盘的客户端投影解码与分析）
       ↓
 wotb-ai       独立 ai-service（AI 复盘，消费客户端投影；前端已解除维护）
 wotb-web      single Spring Boot composition root：controller → feature service → mapper → dto
       ↓
 Vue SPA（frontend/src/replay-local：WASM 解析 + 批次计算 + 导出 + 2D 数据）
```

API 错误由 `GlobalExceptionHandler` 与 Security 的 canonical entry point/access-denied handler 汇合到同一 envelope。新后端异常使用 `ApiException(id, ApiErrorCode enum, errorMsg)`；响应携带唯一错误 `id`（写入安全日志，可用 `id=<value>` 检索到同一异常/请求），可选 `errorMsg` 为安全诊断；不再对客户端暴露请求级 `traceId`（改用 body `id`）。前端 transport 统一经 `ApiError` parser，`errorCode -> i18n` 本地展示错误并显示 `id` 诊断 ID，Retry 由 `retryable` 决定。新增码必须同步 `docs/api/error-contract.md`、后端测试与 zh/en/ru locale。

主要业务域：

- `hof`：单场名人堂（客户端提交结算事实 + 回放附件）。
- `hundred`：百场名人堂（MANUAL 人工证据审核）。
- `mark3`：Tier X 单车最速三环人工审核排行榜（PENDING/CURRENT/REJECTED/CANCELLED/DELETED，无 SUPERSEDED）。
- `user`：Profile、WoTB 账号（含「用回放验证」）。
- `admin`：用户和后台管理。
- `tournament`：按年份/区服/季赛配置积分规则，截图排名的共享草稿、正式榜单、修正与审计；见 [`features/tournament-points.md`](features/tournament-points.md)。独立 AI Service 识别图片，Business API 按规则精确算分并持久化。
- `replay`：只剩 `/api/health` 与名人堂共用的 `ReplayCapacityLimiter`。

### 客户端 Replay Engine（上游 Agent）

`.wotbreplay` 的唯一解析器是上游 [fanypcd/WoT-Blitz-Agent](https://github.com/fanypcd/WoT-Blitz-Agent) 的 Rust Core（作者同为 WotbTools 贡献者，可以直接改上游、发版）。本仓库**不维护第二份解析器**：此前的 `replay-engine/` 移植已于 2026-09-30 退役；服务端 Java `ReplayParser`、parser-worker、parser MQ、processing-jobs、导出任务与 2D 产物已于 2026-10-02 删除（[迁移记录](architecture/client-replay-engine-migration.md)）。

- **产物锁定（content-addressed）**：`deploy/agent/source.json` 是 Agent identity 的**唯一来源**（`ref` = 上游完整 commit，`artifact.release` = Release tag，`artifact.sha256` = 附件校验）。`scripts/fetch-agent-wasm.sh` 下载 Release 附件、校验 sha256 与产物自带 `fingerprint.json` 后落位到 `common/assets/wasm/<ref>/`；`scripts/build-agent-wasm.sh` 是按源码自建的后备路径，产出同一形状。落位目录名就是 URL identity：运行期加载 `/wasm/<ref>/wotb_replay_wasm.js`（wrapper 从同目录取 `_bg.wasm`），**stable `/wasm/wotb_replay_wasm.js` 已废除且由测试/构建/发布三处断言不存在**。`frontend/vite.config.js:agentWasmIdentity()` 在 build 时把 `ref`/`release` 注入 `__AGENT_WASM_COMMIT__` / `__AGENT_WASM_RELEASE__`，装载器据此拼 URL 并先校验 fingerprint，不一致抛 `AgentWasmVersionMismatchError`（fail closed，UI 提示刷新）。缓存失效靠 URL identity，`/wasm/<40 位 commit>/` 因此是长期 `immutable`——普通刷新即可生效，不需要 Ctrl+F5。CI（`ci-frontend.yml`）与发布（`frontend.yml`）执行同一校验；细节见 [replay-pipeline.md](architecture/replay-pipeline.md)「Agent 产物身份」。
- **消费契约**：`contracts/agent/replay-facets-v2.md`。四个独立的 WASM 入口：`parseResult`（结算，毫秒级，适合批量与 HoF 投影；可选 `tankNamesJson` 注入车型名）、`parsePlayback`（时序与花名册；可选 `tankNamesJson`）、`parseShotReplays`（射击复现；可选俯仰锚定表与弹种反解表）、`parseAiReview`（AI 事件数据）。前端唯一装载与校验边界是 `frontend/src/api/agent-replay-facets.ts`。
- **消费方**：回放工作台（数据 / 导出 / 2D 回放 / 3D 回放 / 射击分析 / AI 复盘五能力同一工作台）、装甲查看器、名人堂 / 百场 / 三环提交、个人主页账号验证、Android（WebView 同一套前端）。五个 Replay capability 对匿名、普通用户与管理员永久可见：数据 / 2D 匿名可用，3D / 射击分析与复现 / AI 登录后使用；admin role 不改变工作台能力。装甲查看器匿名可用（Tankopedia 详情入口卡对全员开放），OIDC 返回仍保留完整 scene query。详见 [Replay Workspace](frontend/replay-workspace.md)。
- **一致性基线**：`frontend/src/replay-local/__golden__/` 是 Java 删除前在仓库 fixture 上的最后输出（只读），CI 常驻断言客户端全链路逐字段一致；上游升级后重新导出 `wasm-*` 再跑同一组测试。
- **缺字段**：一律向上游要（改上游 → 发版 → 升级 `source.json`），不在客户端启发式推导，也不在服务端解析。

### League Rating

训练房 `arenaBonusType=2` 与联赛/锦标赛 `=4` 才启用 0–1000 League Rating。普通回放不显示 Rating；混合普通 + League 批次 League Rating 不聚合（`league=null` + `leagueUnavailableCode=MIXED_LEAGUE_AND_STANDARD_REPLAYS`，battles 仍按普通回放语义成功返回）。评分、完整性校验、V6 pooled sum/count 批次汇总与 Excel 导出都在客户端 `frontend/src/replay-local/compute/` 与 `export/`（移植自已删除的 Java core，逐字段对齐 golden），必须复用这一份公式，禁止为某个 UI 再造第二套。

选手 Drawer 的「最常使用坦克」是纯展示（不参与 Rating / 七维 / MVP / Team Rating）：批次计算在 rated-only 循环里按 accountId 关联 `tankId` 累计 `vehicleUsage`，Preview 投影用 Tankopedia 选最常使用（场次降序 → 官方名忽略大小写升序 → tankId 升序；无可靠名称返回 null）生成 `mostUsedVehicle`。前端 Drawer 渲染贴图（本地 Tier X WebP，缺图/非 Tier X 文字降级）与占比。

### Hall of Fame / Hundred Battles

单场 HoF 仅允许录像者本人随机战 `arenaBonusType=1` 或游戏内 Rating `=7`，其它模式拒绝且零持久化。

**服务器没有 parser**：三个提交入口（单场 `POST /api/hof/upload`、百场、三环）都由浏览器本机解析回放，把结算事实按 `Battle` 形状放进 `facts` 字段（多回放时一份回放一份、同序），原始回放作为证据附件一并上传存档。服务端 `ClientReplayFacts` 只做结构校验（`INVALID_REPLAY_FACTS` / `REPLAY_FACTS_COUNT_MISMATCH`），准入策略、SHA-256 去重、`(arena_id, account_id)` 唯一键照旧作用于这份事实；无法从字节验证事实，防伪造靠管理员审核与回放附件。

百场域生命周期为 `PENDING/CURRENT/SUPERSEDED/REJECTED/CANCELLED/DELETED`：

- MANUAL：截图 + 5 个 replay，管理员审核；WG 登录用户同样使用此流程。
- 管理员只能通过、拒绝或删除，不能改写成绩。
- 管理员百场摘要列表只展示通过后的值；申报值仅在详情保留。
- V20 的 `verification_source` / 官方 snapshot 列是历史 schema residue，应用不再映射；发布新版本前须先备份数据库，在旧版本/schema 上运行 `tools/cleanup-hundred-wargaming-api.py` dry-run，核对数量后再用精确确认 token apply。工具只删除 `WARGAMING_API` 来源，并按 MANUAL 与单场 HoF 的共享回放引用保护物理文件。

三环域只走人工审核：1–2 张截图、5 个已验证 replay，按 approved battleCount 升序 competition rank；CURRENT 不可替换，REJECTED/CANCELLED/DELETED 可重提。三环 replay 证据落盘通过共享 `ReplayCapacityLimiter`，容量满沿用 `REPLAY_BUSY`。

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

**删除用户 ≠ 删除 HoF 记录**：HoF 数据属于 WotB 游戏账号（百场/三环为 `(区服, 账号)`，单场为 `account_id`），仓库中没有任何 FK 指向 `user_profile`（`on delete cascade` 只出现在 replay processing 权威状态的域内组合关系上）。因此**删除 Keycloak 用户必须走 WotBTools admin API**（`AdminUserService` 先删本地 profile 再删 Keycloak 用户）；绕过它直连 Keycloak 会留下孤儿 profile 并阻塞后续重绑，需用 Admin Users 的 `segment=local` 清理。

**Admin Users 列表（服务端分页 + 合并数据源）**：`GET /api/admin/users?query=&segment=&idpAlias=&page=0&size=25` 返回 `{items, page, size, totalItems, totalPages}`；**旧的 `?limit=` 参数已移除**（不再有 `limit=200` 的假分页），`size` 会被 clamp 到 1..100，`page` 为 0-based。

| 参数 | 语义 |
|---|---|
| `segment=keycloak`（默认） | 权威源是 Keycloak realm users（Keycloak Admin API `first/max` 分页 + 权威 count），本地 profile 只按当前页做一次 IN 查询增强。**没有任何本地 profile 的 Keycloak-only 用户也能被找到并删除**（历史第三方 IdP 用户清理的前提）；支持 `idpAlias` 过滤 |
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

- `showcase` → `data-ui-profile="showcase"` + `data-theme="dark"` + `color-scheme:dark`（默认，深色纯色表面与克制的强调色）。
- `classic` → `data-ui-profile="classic"` + `data-theme="light"` + `color-scheme:light`（真浅色简约：浅灰底/白卡片/深色文字/浅边框/轻阴影/橙金强调）。
- `frontend/index.html` 首屏内联脚本按 `wotb-ui-profile` 同时设置 `data-ui-profile` 与派生的 `data-theme`（无 FOUC）；`src/styles/tokens.css :root` 仍是 dark 基础视觉 token 单一事实源，Classic 由 `styles/classic-profile.css` 的 `html[data-ui-profile="classic"]` 覆盖浅色语义 token + namespace 覆盖（该文件必须最后导入）。
- 唯一持久化偏好 `wotb-ui-profile` 支持 `showcase` / `classic` / `auto`；`auto` 读取并监听 `prefers-color-scheme`。不保存独立主题状态，实际 Profile 与 `data-theme` 由 `useUiProfile` 派生。
- 手机顶栏高度使用 `--header-h`（48px，另加安全区）；平板 / 桌面使用左侧导航。旧 `--topbar-h` 只是兼容别名，不能作为独立布局 authority。
- Sponsor 页面使用 `/sponsor` Vue Router path，在共享 AppShell 中消费主题和三语 locale。

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

`messages.js` 非破坏性 deep merge 基础 JSON，禁止在 `main.js` 或组件初始化阶段直接修改 imported locale 对象。这样必须保留已有 key，例如 `replay.processing_job.mixed_league_standard`，同时可以补 `feature-messages.json` 中的增量文案。

语言持久化只使用 `localStorage('wotb-lang')`。

### Layout primitives

- `layout-content`：Profile / Settings / 普通内容。
- `layout-wide`：HoF / Rating / 数据页。
- `layout-data-workspace`：Replay Parser / 大表格。
- `layout-full-workspace`：Battle Reconstruction / Map / Strategy。

Replay/管理宽表必须保持高 information density；允许横向滚动，但不能因为页面容器过窄而制造无意义滚动。

全站使用统一页面标题、按钮、提示与表格样式；首页内容按正常文档流排列，更多页复用可滚动分段导航，文档页限制阅读宽度并允许代码 / 表格局部横滚。全屏装饰背景已移除。`showcase-regressions.css` 只保留既有布局 guard；共享外壳与回放样式在其后导入，`classic-profile.css` 最后提供 Profile 映射。新增规则应写入实际组件或样式 owner，避免继续叠加全局覆盖。

### Replay capabilities

`?view=replay` 专注批量解析、结果预览和汇总；`?view=battle-playback` 是同一工作台的 2D 模式，`?view=ai-review` 为 AI 复盘（已解除维护，见 `AiReviewWorkspacePane`）。工作台持有唯一一份文件选择与本机分析结果（`useReplaySession` + `useLocalReplayAnalysis`）：选择一次、分析一次，数据 / 导出 / 2D 共用。

规则：

- 分析在本机进行（Worker 跑 WASM → 批次计算），匿名即可用、不等登录；失败只显示原因（引擎不可用 / 无有效回放 / 意外错误），不回退服务端。
- 2D 回放解析单场：单文件直接用；多文件须先在场次选择器选一场（`sourceId = r{文件序号}`）。
- 导出直接复用最近一次分析的批次结果，客户端生成 xlsx / zip，不重新解析。
- 解析后的 Aggregate/Summary 不代表某一场 battle；结果 toolbar 的 battle-level shortcut 只在具体 battle tab 出现。
- League 模式的汇总人数读取 `league.playerSummaries.length`；普通模式读取 `aggregate.length`。

### SPA views

- `?view=home`：主页。
- `?view=replay`：Replay Workspace。
- `?view=hof`：名人堂。
- `?view=hof-admin`：名人堂管理。
- `?view=profile`：个人中心。
- `?view=admin-users`：用户管理。
- `?view=history`：项目历史，直接渲染仓库根 `HISTORY.md`。
- `?view=contact`：联系页。
  - `?view=rating-docs`：League Rating V6 算法说明页（构建期以 `?raw` 读取
  `docs/WotBTools_League_Rating_V6.md`，canonical 单一事实源；ReplayPage League 模式
  「算法说明」按钮跳转进入，返回时经 KeepAlive 保留解析状态）。
- 玩家详情抽屉的 V6 七维雷达：`0→0 / 当前 Battle/Global Average→75 / 后端维度满分→150` 的分段线性标尺，
  100 对应平均到满分区间的三分之一。玩家顶点显示 0–150 视觉分，明细默认分数并可切换原始值；共享图形支持
  50%–150% 缩放（只影响页面 SVG，窄屏由 radar viewport 横向滚动），桌面为可拖拽持久化侧栏。V6 Rating
  Profile PNG 同步 bounded geometry 但保持固定导出尺寸。移动端模态抽屉锁定 Tab 焦点，桌面非模态不锁。
- 已退役（2026-10-02）：`?view=playback-qa`（隐藏 QA 页）与 `?view=rating-v2`（历史 Rating V2 灰度页，
  连同 `/api/admin/rating-v2/**` 与 `RatingV2Calculator`）。旧深链回落到默认视图。
- `?view=ai-review` / `?view=battle-playback`：与 `?view=replay` 共用同一个 `ReplayWorkspace`，
  仅默认 `activeCapability` 不同（ai / playback）。三者不是三个隔离业务页。

旧 `?view=leaderboard` canonicalize 到 `hof`；旧 `?view=extended` canonicalize 到 `replay`；旧 `?view=reconstruction` canonicalize 到 `battle-playback`。

Web 登录回程先由 `useAuth` / keycloak-js 处理，再动态加载 Router：启动入口仅判断 query / fragment 是否同时存在 `state` 和 `code` / `error`，不自行校验或信任其值。认证落定后才构造 history、转换旧 view，避免重定向丢掉原回调或 Router 留下已消费的认证参数。生产 SDK 仍使用默认 fragment 模式；query 形状检测只是保守等待，不代表新增 query-mode 支持。落定信号也不承诺清理所有畸形或超时 URL。失败 / 12s watchdog 后正常挂载原有失败恢复界面；普通访问与 APK 不等待此 Web 回程路径。旧 view 转换保留 query 上下文与 hash。回归入口为 `frontend/src/main.test.js`、`frontend/src/App.test.js`；职责详见 [`frontend/architecture.md`](frontend/architecture.md)。

### AI Review / Battle Playback

`ReplayWorkspace` 是回放**五种能力**（数据 / 2D 回放 / 3D 回放 / 射击分析 / AI 复盘）的唯一统一载体：这些能力不再是各自独立页面，深链只是能力入口（`app/viewRegistry.js` 的 `replayInitialCapability` 是唯一映射点）。它通过唯一 `useReplay` 组合并消费 `useReplaySession` 持有的 selection / 分析状态 / 结果，分析生命周期由 `useLocalReplayAnalysis` 持有（Worker 解析 → 批次计算 → 提交结果；选择变化 / 取消即作废在途分析）。能力切换不重新选文件、不重建 session；能力面板首次激活才挂载（`useMountedWhenActive`）并按需异步加载，切走只隐藏（3D 停帧不销毁）。Workspace 的标题、能力切换、批次与当前回放 selector 分别由 `PageHeader`、`ReplayCapabilityTabs`、`FileDrop`、`BattlePicker` 展示（数据结果区的工具栏、系列赛概览与导出菜单在 `ReplayPage` 内）；这些子组件只接收派生状态并发出命令，session 仍是唯一 selection owner。`ReplayPage` 只作为 data 结果 tab 嵌入，渲染结果 / 列系统 / Export / Drawer。

**匿名可用**：服务器没有 parser，分析全部在本机，工作台挂载即可用，不等 Keycloak init、没有登录门禁（只有 AI 复盘与名人堂等写操作需要登录）。
**能力解耦**：AI 与 Playback 不做 `AI@seek → Playback` 时间点联动 / 跨 capability 状态 handoff。tab 切换经 pushState + popstate 形成可 Back/Forward 的 history，返回时 selection / 分析结果不丢，只恢复 activeCapability。
**2D 回放**：`BattlePlaybackPanel` 接收目标文件，本机 `parseLocalPlayback`（parseResult + parsePlayback + parseAiReview 伤害事件 → `BattlePlaybackDataset` + `MapOverview`）；多文件未选场次时给出明确提示。
**Android Local-First**：APK 从 `https://appassets.androidplatform.net/index.html` 启动同一 Vue 产品；
`WebViewAssetLoader` 的 `/` 映射到 APK `assets/web/`，Vue Router 的 `/index.html` alias 与历史路由
共用工作台。离线冷启动不等待更新 manifest；联网后 Native 最佳努力检查版本，已确认 mandatory update 仍阻断。
`src/platform/runtime.js` 只把 Android 业务 `/api/**` 与下载 metadata URL 解析为 `https://wotbtools.com`；
Web 保持同源。Native Bearer 请求不发送 cookies，Caddy 对 exact appassets origin 放行实际方法/headers、
先响应匿名 OPTIONS。Android 远端 3D 资产固定使用 `/agent-assets/` 网关（固定 reviewed COS upstream），
不接受 Web 的 `?assets=` override；本地 JS/WASM、2D 地图和射击参数快照始终从 APK 读取。
Native 过期 token 无法离线刷新时保留 encrypted session；前端只清 API token，离线不会清 replay selection。

**Android 外部 replay 完整自动解析**：仅 Android external intent 触发——Native `shouldInterceptRequest` 以固定同源 `https://wotbtools.com/__native/replay-pending` stream 缓存字节，Web `fetch(pending.uri)` 构造 `File` → 替换 selection → 本机分析一次（完成后 data tab 展示结果，绝不自动启动 AI）；普通 Web/FileDrop 手动选文件不经过此路径。读取使用 `X-Wotb-Pending-Id` header 校验 metadata 与文件 identity，避免 pending 替换时串包；Native 无 pending/文件返回 404、identity 不匹配返回 409、读取失败返回 500，禁止网络 fallback，响应 no-store。读取失败复用 Replay 错误区与重试，不 ACK；WebView file/content access 保持禁用。ACK 边界是「本机分析已完成」（`analyze()` 返回 `completed: true`，无论有没有有效场次——重新导入同一份结果相同）；回放引擎装载失败（可重试）不 ACK，Native pending 原样保留。认证不再参与 WebView navigation（Android 2.0 起原生 OIDC 在外部 user-agent 完成，WebView 不承载登录）；登录期间收到的 replay intent 正常持久化并按 `ReplayDispatchPolicy` 分发，pending metadata（24h TTL）持久化在 app private storage，跨 process death 恢复，且不以登录状态为前置条件。Tier X 车型图位于 `src/assets/tank-portraits/tier-x/<tankId>.webp`，由 BlitzKit 确定性生成，production 不访问 BlitzKit。

Battle Playback 的页面编排保留在 `BattlePlayback.vue`；地图 SVG/标记/瞬时反馈与 canonical 2 秒轨迹由
`BattleMap.vue` 渲染，通用 HUD 由 `BattlePlaybackHud.vue` 渲染，播放控制与标注工具由
`PlaybackControls.vue`/`AnnotationToolbar.vue` 渲染。`PlaybackTimeline.vue` 是纯 seek bar，事件列表位于
`PlaybackSidePanel.vue` 并通过 root command 执行 seek + pause；当前车辆详情仍由
`VehicleDetailsPanel.vue` 渲染。基地 runtime state 由本机 2D 转换层（`replay-local/playback`，取自上游 PlaybackData 的 `supremacy_bases` / `assault_bases`）统一提供 `baseStates`，前端只按当前回放时间查询，
不从静态地图或最终结果推导。Supremacy 形成 `baseId=A/B/C/D` 的完整 canonical state；
Assault 单基地形成
`baseId=BASE` 的 progress transition（0..100，阵营 unknown；进度判据为 field2==1 且 field3 存在，
**不锁 field1**——携带进度的族会在 field1=1/2 间切换）；`assaultObjectivePresent` 是**目标族存在性**
（wrapper8 目标族出现、field2==1 且 field1∈{1,2} 即为 true，与是否已有进度无关；v0.3.11 字段契约补正），
无 field3 时保留空 progress timeline。显式 `progress=0` 作为 canonical reset 继续保留，但共享 `baseView` 在 2D/3D presentation 中把它投影为 idle（不画水位/进度环/百分比），后续正值可恢复显示。2D 按 mapCode 从 verified semantic
数据解析静态 BASE，并 LEFT JOIN runtime state；训练房 arenaBonusType 不参与 Assault 判定。
前端不合并 protobuf sparse update；坦克 marker sizing 优先使用可靠 hull metadata，model overlap 只通过有界
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

`WG_APPLICATION_ID` 只注入 Keycloak 侧，用于 WG IdP；backend 不再需要该配置。GitHub Secrets `WG_APPLICATION_ID` 是这份凭据的唯一来源，同时供 Keycloak runtime env（自定义 SPI）与 TX-local OpenTofu 的 `wargaming-asia`/`wargaming-eu`/`wargaming-na` IdP `client_id` 使用；不新增第二个 Wargaming 凭据。

IdP 部署步骤见 `docs/auth/wargaming-asia-deployment.md`。

### 绑定账号的验证状态（`wotb_account_verified_at`）

`user_profile.wotb_account_verified_at`（`V12__add_wotb_asia_fields.sql` 引入，可空）是「**当前**绑定账号是否已验证」的唯一表达：NULL = 未验证，非 NULL = 已验证（保留**首次**成功验证时间，不重写）。写入方只有两个：

1. 可信 WG claims 的 canonical provisioning / 空 Profile 升级（`wotb_account_source=WARGAMING`，见上文）；
2. **用回放验证**——个人主页「用回放验证」按钮：浏览器本机解析选中的回放（服务器没有 parser），只把录像者数值 accountId 提交到 `POST /api/users/wotb-account/verify-replay`。这是**客户端声称、可伪造的便利徽章**：不授予权限、不参与授权、不是身份安全边界（产品决策，见 `docs/features/user-profile.md`）。

判定比较的是**数值账号**而不是身外之物：

```text
recorderAccountId（客户端 parseResult.author_account_id）
  == profile.wotb_account_id ?
  相等 → wotb_account_verified_at = now()（首次；已验证则原样返回）
  否则 → 409 REPLAY_RECORDER_MISMATCH（未绑定 400 WOTB_ACCOUNT_NOT_BOUND，缺录像者 400 REPLAY_RECORDER_REQUIRED）
```

昵称相同不通过；账号只是出现在同局名册里不通过。录像者 accountId 来自客户端，理论上可伪造——已验证状态只用于个人主页徽章，**不授予任何权限**；若将来要依赖它，应附带回放附件供管理员抽检。换绑（`(wotb_server, wotb_account_id)` 任一变化）与解绑会清空验证；与账号身份无关的编辑（例如昵称刷新、`ensure`）不清空。

### 身份两层与 profile self-heal

```text
Keycloak User  = 认证 / IAM 身份（谁登录了）
user_profile   = WotBTools 业务用户投影（这个人在业务上是谁）
```

稳态不变量：**每个活跃、已认证并成功进入 WotBTools 的用户都拥有 `user_profile`。**

实现方式是 **eventual self-healing**，不是跨系统强事务：

```text
Keycloak 认证成功
  → 进入 SPA（任意 view：home / replay / battle-playback / AI Review / HoF / admin / profile）
  → AppShell 触发 useBusinessUserBootstrap()
  → PUT /api/users/profile（幂等 ensure）
  → 已有 profile 原样返回；没有则按 canonical provisioning 创建
```

- **canonical owner 只有全局 bootstrap**（`frontend/src/composables/useBusinessUserBootstrap.js`）。页面只等待其结果，不得各自实现「读不到资料 → 自己创建」。
- **个人中心区分连通性与业务失败**：`whenBusinessUserSettled` 返回 false 时，`ACCOUNT_PROFILE` 不可用进入中性 connectivity 状态；仍可用则显示资料错误与显式重试，不停在 loading，也不自动循环重试。只有连通性不可用状态恢复可用时自动加载一次。等待 bootstrap、解绑/撤销确认或本地回放解析后，真正调用 backend 前再次检查对应 capability；回放解析仍完全本地。
- **KC-only 是允许的临时/历史状态**：broker 刚注册但浏览器还没回站、用户回站前关掉浏览器、bootstrap 暂时失败、历史 legacy 数据、管理员手工建 KC user。任何 KC-only 用户下一次成功进入 WotBTools 都会被自动补齐。
- **不做强一致声明**：Keycloak 与业务 DB 之间没有分布式事务，也不在 Keycloak First Broker Login 里写业务库；provisioning 失败**不删除 Keycloak 用户**、**不回退认证状态**、**不永久缓存失败**（刷新 / 重新 bootstrap / 页面上的重试入口都会重新 ensure）。
- **`PUT /api/users/profile` 是 ensure 而非 create**：已存在时不改写 `wotb_server` / `wotb_account_id` / `wotb_nickname` / `wotb_account_source` / `wotb_account_verified_at`。并发 ensure 靠唯一约束**按约束名**区分：`keycloak_user_id` 冲突（同一 sub 的并发创建）重读胜者并幂等成功；`(wotb_server, wotb_account_id)` 冲突是真实账号占用，仍返回 409 `WOTB_ACCOUNT_ALREADY_USED`，绝不吞掉。
- **Admin Users 仍以 KC 为权威**（`segment=keycloak` 默认）并显式暴露 `hasLocalProfile=false`，作为 IAM 清点与 legacy/不完整状态的观测能力；self-heal 不改变这一点。

Keycloak 登录页为 V8 Unified Theme（深色=Battlefield/浅色=Minimal、深色登录卡局部毛玻璃 dark-only、浅色无 blur、IdP 动态渲染、`registrationAllowed:false`）；主题文件在 `docker/keycloak/themes/wotbtools/login/`，仅覆盖 `template.ftl`（其余认证页经 `registrationLayout` 共享），生产 realm 需手动设 `loginTheme=wotbtools` 并关闭 Registration（见 `docs/auth/keycloak-login-theme.md`）。

---

## i18n / DTO 约定

积分赛应用只检查 `tournament-admin`，全站 `wotbtools-admin` 由 Keycloak 复合角色继承此权限，前端入口、业务管理 API 和独立 AI 识别共用此权限边界；该专属角色不授予其它管理权限，也不是默认角色。历史积分通过管理员预览/正式导入接口进入同一累计与审计链，V29 区分历史分数与名次小组的互斥来源，公开读取使用一致的事务快照。V30 在后端启动时一次性导入已核对的 2026 国服夏季赛最终榜前 32 支军团，保留未参赛空值、记录审计并拒绝覆盖已有成绩；由现有 Flyway/后端部署流程执行。公开榜单支持当前赛事的客户端 Excel 导出与原生打印另存 PDF，三语列标签与页面同源；此功能不改变回放 Excel 的中文表头契约。见 [积分赛功能契约](features/tournament-points.md)。

API 只输出稳定英文 key/enum。前端 `player_labels` / `agg_labels` 渲染三语；Excel 继续使用中文表头。新增任何 `code/error/warningCode` 必须同步三语 `api_codes/api_errors`。

站内通知子系统已随 Boost 域退役删除：其唯一写入方 `UserNotificationService` 随 `com.wotb.web.boost` 一并删除后该子系统不再有任何生产者，本次连同 Controller / Repository / DTO / 前端通知面板与三语文案一并删除，表由 forward-only `V26__drop_user_notification.sql` 永久删除。

---

## CI/CD 与生产部署

### OpenTofu production baseline

Production OpenTofu roots 按 owner 在所属主机使用固定 local-state 文件；per-SHA staging 只承载
source，不能承载 state。TX state 位于 `/opt/wotb-tx/{postgres-business,postgres-keycloak,keycloak}-tofu-state/`，
Yecao Grafana state 位于 `/opt/wotb/grafana-tofu-state/`，Komodo 控制平面 state 位于
`/opt/komodo/tofu-state/`。Business PostgreSQL 保留现有 authoritative local
state；postgres-keycloak、Keycloak 与 Grafana 的新 local state 需由 owner 手工 adopt 既有生产对象、
验证 zero-change plan 并创建 bootstrap marker 后才能部署；Komodo 是全新 root，首次 bootstrap 直接
create DNSPod 记录，同样要求 zero-change second plan 后才写 marker。正常 workflow 在 init 前拒绝未 bootstrap 的 state。历史 COS state 被放弃，不执行
读取或迁移。COS state backend、legacy COS artifact root、Lighthouse 和 firewall IaC ownership 已从仓库移除，
不会触发真实云资源 destroy。详见 `docs/operations/opentofu-local-state.md`。

PR 侧只做 validation：五个 OpenTofu root 均运行 `tofu fmt -check`、`tofu init -backend=false`、
`tofu validate` 与适用的本地 safety fixture。PR 不 SSH 任何生产宿主、不读取生产 local
state、也不接收 host-local 生产凭据；五个需要 production-local provider 的 root，其 plan 只在
对应 main-only service workflow 运行中产生。PR workflow 与
production apply 不共享 binary plan；main 始终重新 plan。Local state、plan、真实 tfvars 不得提交，
provider lockfile 必须提交。
production maintenance workflows 不因新 push 取消正在执行的写入。

Grafana dashboard root 仍管理 `deploy/observability/grafana/dashboards` 中的六个 dashboard；
Prometheus/Loki datasource 仍由 file provisioning 管理。删除或替换必须通过
`infra/tofu/grafana/validate-plan.sh` 的 safety guard，认证仅使用 GitHub Actions secret
`GRAFANA_PAT`。

### TX application runtime boundary

Phase 1 将 `wotb-frontend`、`keycloak` 与其专用 `keycloak-postgres` 路由到
TX；Yecao 宿主在 cutover 后只承载 AI service 与观测服务，不再运行任何业务应用（服务器没有 parser：解析执行面、MinIO、RabbitMQ 已于 2026-10-02 删除）。
TX 的业务运行时是
Compose 服务 `business-api`（Tencent TCR `<TCR_REGISTRY>/<TCR_NAMESPACE>/wotbtools-business-api` 的 immutable 镜像；GHCR 保留为 TX 恢复副本）：
单个 Spring Boot 进程承载全部 public business endpoint（不再有任何回放解析 / 计算端点），
app :8087 与 management :8088 分别发布在 TX1 WireGuard `10.20.0.1` 上；现有生产访问仍来自
TX-internal frontend nginx、Caddy readiness surface 与 deployment-owned `health-probe`（app `/api/health` + management
`/actuator/health`，管理端口 8088）。因此 release plan 把 backend 镜像路由到
`business-api`（target `tx`）；Yecao 侧的 `wotb-backend`/`wotb-frontend`/`keycloak`/`postgres`
已随退役 PR 从 Compose 与 deploy 白名单中删除，不再是可选项。
公开 API 路由由 TX service plane 终结：`wotb-frontend` 的 nginx upstream 通过
`TX_BACKEND_UPSTREAM` 表达 logical endpoint，允许 Docker-local `http://business-api:8087`
或 reviewed TX1/TX2 WireGuard `:8087`；公网 host、错误端口与已退役 Yecao
`10.20.0.2:8087` 一律 fail-closed。K6B-2A–2F 已把六个 TX consumer 依次切到 TX1 WireGuard：
Frontend → Business API `http://10.20.0.1:8087`、Business API → Business PostgreSQL
`10.20.0.1:25432`、Business API → Keycloak Admin `http://10.20.0.1:8080`、Keycloak → Keycloak
PostgreSQL `10.20.0.1:15432`、Caddy → Frontend `10.20.0.1:8081`、Caddy → Keycloak
`10.20.0.1:8080`（同一套 canonical validator 的已评审值）。**K6B-2 与 K6B 均已 COMPLETE**：
六个 TX placement 都是 reviewed WireGuard 值，Docker-local 值只剩生产事故 rollback 用途，
TX2 等价地址仍是 canonical allowlist 里的未来 placement——三者语义见
`docs/operations/tx-service-plane.md` 的「三类合法值」；`K6B_FINAL_PLACEMENT_MATRIX` 是冻结的
K7 baseline，请勿弱化或改成 repository variable。Caddy 的 upstream 由容器 env 经只读
bind-mounted Caddyfile 的 `{$VAR}` 替换决定，
没有渲染中间层，所以 runtime gate 读运行容器 env 即实际生效的 upstream；Caddyfile 的 route、
`header_up Host`、TLS 与公开 hostname 都不随 placement 改变，2F 只改 Caddy 的私有 upstream，
Keycloak 的 `--hostname`、公开 issuer 与 OIDC redirect 语义不变。
service-plane 端口不可互换：8081 Frontend、8080 Keycloak、8087 Business API、
25432 Business PostgreSQL、15432 Keycloak PostgreSQL。`KEYCLOAK_ISSUER_URI` 仍是公开 realm URL：issuer 不是 placement endpoint，
`dependency-readiness.py` 还会对已校验的 admin endpoint 断言 discovery 报告的 issuer 等于它。
2C 的凭据顺序是 resolve → validate → 才发 `KEYCLOAK_ADMIN_CLIENT_SECRET`，探针只打印
`label: PASS` 或异常类型名，secret/access token 不进日志。全部 logical endpoint 由同一组 canonical validator
（`deploy/tx/deploy.sh`）守护：staged deploy、只读 `dependency-readiness.sh`（在任何
secret-bearing 连接之前）与 runtime gate 共用，仓库不存在第二份 allowlist。TX deploy staging
与只读 `TX_RUNTIME_READY` 分别用 `assert_routing_boundary`、`tx-logical-endpoints-declared`、
`tx-logical-endpoints-active`、`retired-replay-switches` 守护 routing/placement 不变量
（declared = render 出的 Compose，active = `docker inspect` 读到的运行容器真实 env，两者都必须
等于 deploy helper 当前会选择的 placement）；K6A published bindings 仍由
`wireguard-service-plane` 守护。frontend owner deploy 另外用 `frontend-api` 探针**穿过
frontend**（nginx → `BACKEND_UPSTREAM`）请求 `/api/health`，因此切到不可达端点会立刻让该次
frontend 部署失败，而不必等手工 runtime gate。端点、验收与回滚见
`docs/operations/tx-service-plane.md`。

**全业务运行时 E2E 检查**：`deploy/tx/runtime-check.sh` 加载独立只读校验库
`deploy/tx/runtime-check-lib.sh`；除基础设施与路由 token 外，还用
Keycloak 的 `wotbtools-e2e` 机器身份（client_credentials，唯一 realm role `wotbtools-user`，secret 由
`KEYCLOAK_E2E_CLIENT_SECRET` 注入）驱动真实业务链并逐项给出 PASS/FAIL：`hof-replay-storage`、`admin-authz`、匿名访问拒绝等
（回放解析相关检查随服务端解析一起删除），以及公网
边缘断言（`public-tls-web` / `public-tls-auth`，要求 host 解析到 TX 地址 + 受信任证书 + 2xx）。
`business-data-integrity` 已随 cutover machinery 退役（其 Yecao 冻结行数快照输入不可再生），
不保留替代检查。检查全程不关闭 TLS 校验、不使用 `-k`；对基础设施与用户数据只读。
任一 token 失败即 `TX_RUNTIME_NOT_READY`。
Caddy 已是生产公网入口（默认 `0.0.0.0:80` / `0.0.0.0:443`
tcp + udp），但没有固定容器地址：readiness surface 通过 Docker service DNS
（`http://caddy/_wotb/...`）访问，frontend 的 `set_real_ip_from` 信任 `wotb_tx_internal`
子网；DNS 切换仍是 operator 的受控外部操作，仓库不写任何 DNS 变更。
`KEYCLOAK_ISSUER_URI` 保持 public URL（Keycloak 的 `iss` 由 hostname 决定）。
`TX_KEYCLOAK_ADMIN_SERVER_URL` 默认 `http://keycloak:8080`，仅允许 reviewed TX1/TX2
WireGuard Keycloak endpoint，永不允许用公网 hostname 代替 Admin path；K6B-2C 后 active value 为
`http://10.20.0.1:8080`（TX1 WireGuard），公开 issuer 与 hostname 不变。
Business/Keycloak
PostgreSQL 同样以 host/port logical endpoint 表达：Business PostgreSQL 在 K6B-2B 后 active value
为 `10.20.0.1:25432`，Keycloak PostgreSQL 在 K6B-2D 后为 `10.20.0.1:15432`（两者端口不可互换）；
Keycloak 的 `KC_DB_URL` 仍由 `TX_KEYCLOAK_DB_HOST/PORT` 生成，库名/账号/密码/驱动/连接池不变，
`10.20.0.1:15432` 是 WG-only 发布（loopback 仅供宿主管理）。
HoF 回放原件是永久内容寻址文件，挂 TX
`replay_data` 卷到 `HOF_REPLAY_DIR`（服务端唯一的回放文件存储）。
TX 与 Yecao 的每个服务都由自己的 workflow 路径规则及手动入口拥有，不再通过 release planner
路由。TX Keycloak PostgreSQL 保留
`127.0.0.1:15432:5432` 给 TX-local OpenTofu，并增加 `10.20.0.1:15432:5432` 私有 WG endpoint；GitHub runner 只 SSH 触发，绝不
直连数据库、建立 SSH tunnel 或使用 Terraform `remote-exec`。详见
`docs/architecture/opentofu-postgres-keycloak.md`。

TX Business PostgreSQL 与 Keycloak PostgreSQL 完全独立：主 Compose 通过
`include` 使用 `business-postgres.compose.yml` 和 `keycloak-postgres.compose.yml` 两个 owner 文件。
二者使用固定 Compose project `deploy`，生产 Docker volumes 分别是
`deploy_business_postgres_data` 与 `deploy_keycloak_postgres_data`。Business PostgreSQL 为
`postgres:18-alpine`，使用 `business_postgres_data`、
`127.0.0.1:25432:5432` loopback administration + `10.20.0.1:25432:5432` WG service、`pg_isready` 健康检查）；`infra/tofu/postgres-business`
只管理 `wotb` 数据库、`control_api` 应用角色与 database-level grant，用独立 local
state `/opt/wotb-tx/postgres-business-tofu-state`，provider 经
`/opt/wotb-tx/tofu-provider-mirror` 的 filesystem mirror fail-closed 安装。业务表仍
由 Flyway 单一拥有，OpenTofu 不声明任何表/索引/序列。`business-postgres`-only
部署不需要 Keycloak/frontend/Caddy 输入；`infra/tofu/postgres-business/**`
变更只选择该部署路径，不重建应用镜像。备份/恢复（`pg_dump` + SHA-256 + 恢复到一次性库）
与名人堂迁移前置见 `docs/operations/business-postgres.md`，边界见
`docs/architecture/opentofu-postgres-business.md`。

TX Compose 先启动 PostgreSQL，再由 TX-local OpenTofu 创建 database/role/grant；
随后 `infra/tofu/keycloak` 在 `127.0.0.1:18080` 声明 fresh realm、`wotbtools-web`、
`wotbtools-admin-api`、realm role、mapper 和 IdP；`wotbtools-web` 的浏览器客户端契约
（login theme、front-channel logout、PKCE、consent）也在该 root 显式声明，字段映射见
`docs/auth/keycloak-tx-bootstrap.md`。backend 使用
`KEYCLOAK_ADMIN_CLIENT_ID=wotbtools-admin-api` 与 runtime-only
`KEYCLOAK_ADMIN_CLIENT_SECRET`，service account 只授予
`manage-users`、`query-users`、`view-realm`；secret 通过 write-only OpenTofu 输入传递，
不写入 HCL/tfvars/log 或普通 state attribute。只有成功 apply 写入 provision marker
后才允许 Keycloak/frontend 启动。TX 的 Caddy 是生产公网入口，默认在 TX 所有接口上监听
80/443（tcp + http/3 udp；可用 `CADDY_HTTP_BIND` / `CADDY_HTTPS_BIND` 覆盖）；仓库不做
任何 DNS 变更，也不会停止或删除 Yecao 服务。IdP 配置、
`user_profile` dependency audit、DNS cutover 与旧服务退役均是受控的外部操作，分别
需要相应人工批准；启动细节见 `docs/auth/keycloak-tx-bootstrap.md`。

生产 CI/CD 使用唯一 PR 验证入口和独立的 service owner workflows：

- `.github/workflows/ci-gate.yml` 是唯一 PR 入口；按 changed paths 调用受影响的 `ci-<owner>.yml`，
  `CI / Required Gate` 汇总受影响结果。Backend 运行 Maven，frontend 运行类型检查、单测、两套真实浏览器回归和 build；
  OpenTofu 每个 owner 只验证自己的 root。PR 验证不 push 镜像。
- `.github/workflows/business-api.yml`、`frontend.yml`、`keycloak.yml` 与 `ai-service.yml`
  分别构建一个应用镜像。每个 workflow 保留 SHA tag 供诊断，并在确认 source SHA 仍为
  远端 main HEAD 后发布 `latest`；部署只使用所属服务的 `latest`。服务级 concurrency 会取消旧 main
  的工作流，Keycloak 在 runtime 后继续执行自己的 OpenTofu 与最终验证。
- `frontend.yml` 的镜像发布按 BUILD → VERIFY → PUBLISH → PROMOTE 分段：构建只产出本地镜像，
  内容校验在任何 registry 写入之前完成，immutable tag 的 `docker push` 有 per-attempt 超时与
  有界瞬态重试，发布后只校验 digest 对应关系；每段独立步级超时，禁止把 push 合回构建步骤。
  该 workflow 不使用 GHA 构建缓存（仅前端决策，不适用于其他应用 owner）。
- `.github/workflows/caddy.yml` 独立负责 TX 网关：staged Caddy 配置与 assets 校验后只 reconcile
  Caddy，并验证 trusted TLS、redirect、前端/API、Keycloak、auth asset 与 Komodo
  （`komodo.wotbtools.com` → `10.20.0.2:9120`，先验私有上游语义版本，再要求公网值与私有值一致，
  不读任何 Komodo 版本 pin）路由。它不 build 应用镜像、
  不依赖数据库或 Keycloak admin credentials。
- `.github/workflows/business-postgres.yml`、`keycloak-postgres.yml` 与
  `observability.yml` 分别拥有两个 PostgreSQL 和 Yecao 观测运行时/Grafana root。
  各 workflow 自己执行 root 专属 safety guard、apply 后 clean second-plan/readiness；observability
  失败仍按现有契约显示为 degraded，不改变应用服务结果。
- 三个数据更新 workflow (`update-tankopedia.yml`、`update-equipment.yml`、`update-crew-skills.yml`)
  保持独立，生成 PR 后核对 open PR 的 main base、自动化 head branch 和精确 head SHA，再 dispatch
  `ci-gate.yml`；CI 通过只读 GitHub API 核对该 run 仍验证同一 PR head。它们不自动 merge。
- main 是应用的唯一目标状态；生产镜像来自当前 main 的 `latest`。TX 服务定义按 owner 分离，
  各部署只渲染所属服务和通用探针。固定基础设施使用既有 volume、network 与 OpenTofu state，
  不读取应用镜像发布记录。运行中的版本通过 `docker inspect`、镜像 digest 与 `BUILD_COMMIT` 查询。


Android 发布同样采用仓库内 Version-as-Code：`android/gradle.properties` 的
`wotbVersion` 是唯一版本来源，`versionCode` 由 SemVer 确定性计算；发布工作流
禁止通过输入参数覆盖版本，并把版本、bridge version、源 commit SHA 写入
`version.json`。`contracts/android-native-bridge.json` 是 Native/Web bridge
契约 SSOT；运行时变更必须 bump Android 版本，breaking bridge 变更必须同步 bump
bridge version、Native 实现和前端兼容门禁。CI 会比较 PR base/head 的版本与契约，
生产发布前还会校验 APK、manifest 和 `version.json` 的 SHA/版本一致性。

发布分两阶段（`android-release.yml`）：main 合并后自动 **stage**（构建/签名/上传 immutable APK、
建 tag、写 staging evidence，**不碰** production `version.json`）；真机 A14 验证通过后手工
`workflow_dispatch(mode=publish, version=<已 staged 版本>)` **publish**（显式版本决定 tag/APK/evidence
名，tag target 源码给出 versionCode/bridge/Agent pin，再校验 staged 身份 + Keycloak client +
APK bundled frontend 身份/Bridge/native-auth + API/资产 exact-origin CORS 就绪 + minSupported
至少 2000001 的 local-first cutover，最后才写 `version.json`）。候选身份与当前 main 分离：main 前进
不会改变要发布的版本，只提供 ancestry/minSupported/compatibility 策略。Web build commit 不再是
Android publish 的运行时依赖；schema2 staging evidence 从实际 APK 内 manifest 核验并在 publish
再验证。细节见 `docs/android/release-process.md`。

**Flyway 迁移不可变（canonical policy 见 `java/AGENTS.md`）**：`java/wotb-web/src/main/resources/db/migration/V*.sql` 中已存在的 versioned migration 是 immutable historical artifact——禁止修改、重命名、删除、格式化、改注释、转换换行或编码；schema 变化只能新增更高版本 forward-only `V<N>__*.sql`。仅当 Git history 证明生产已执行且文件发生 checksum drift 时，才允许恢复 exact deployed blob（本次 V18 是一次性例外）。CI `deploy-smoke` 用 `deploy/check-flyway-immutability.sh` 以 PR base SHA 做 diff 检测，任何既有 migration 的 M/D/R 一律失败，新 migration 版本号必须高于 base 最大版本。

Deploy、Tofu Apply 与 database backup 共用 `production-maintenance` concurrency，`cancel-in-progress: false`（`queue: max` 只排队、不丢弃已开始的生产写入）；服务器脚本另用 `flock` 串行化 production mutation。TX 人工 mutation 必须通过 `bash /opt/wotb-tx/deploy/with-deploy-lock.sh <command...>`（源文件 `deploy/tx/with-deploy-lock.sh`）让锁 FD 只存在于命令进程树，禁止在交互 SSH shell 直接 `exec 9>` 持锁；冲突时 wrapper 会输出当前 holder 诊断。Build 与 Release 不占用该队列，但每个 lane 都在 mutation 前核对 source 仍是当前 main。这不是 distributed lock。

生产数据库每日香港时间 03:15 由独立 `database-backup.yml` 调用 TX owner 的 `deploy/tx/business-postgres-backup.sh` 与 `deploy/tx/keycloak-postgres-backup.sh` 备份；两者只访问已运行的 owner service，并在 pg_dump 前核对固定 Compose project、卷标签与实际挂载卷。同一维护队列随后备份 TX/Yecao/Komodo 三个 owner-host local Tofu states 到本机 root-only 目录并生成 SHA-256（`deploy/tofu-local-state-backup.sh tx|yecao|komodo`）。Business PostgreSQL 归档只能用 `deploy/tx/business-postgres-restore.sh` 校验并恢复到经确认的 disposable 数据库；Keycloak PostgreSQL 归档不能传给 Business restore 工具。

Sponsor QR 不进仓库/镜像：生产使用 `/opt/wotb-tx/config/sponsor-config.json` 与 `/opt/wotb-tx/config/sponsor/{alipay,wechat}.png` 只读挂载，Vue 页面从 `/sponsor-config.json` 按 no-store 读取运行时配置。二维码加载失败时页面必须隐藏失败方式；全部方式不可用时回退到“暂未配置”，不得显示 broken image。

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
| League Rating | `docs/features/league-rating.md` |
| 名人堂 / 百场 | `docs/features/hall-of-fame.md` |
| Team AI Review | `docs/features/team-ai-review.md` |
| 回放数据字典 | `docs/reference/replay-data.md` |
| 已确认解析字段 | `docs/reference/replay-parsed-fields.md` |
| 地图目录 | `docs/reference/maps.md` |
| Tier X 车型资产 | `docs/assets/tier-x-models/README.md` |
| 观测运维 | `docs/operations/observability.md` |

修改任何专项能力时，以对应专题文档 + 实际代码共同作为验收基线。
