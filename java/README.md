# WoT Blitz Tools - Java 主线

`java/` 是项目主线。基于同一套 Java 核心能力交付：

- **Web 版**：Spring Boot 4 后端，Vue 3 前端，支持浏览器上传、预览、下载。

当前 Web 版已实现。路线图见 [docs/ROADMAP.md](../docs/ROADMAP.md)。

## 模块

| 模块/目录       | 说明                                                           |
|-------------|--------------------------------------------------------------|
| `wotb-core` | 核心库：解压回放、读取 pickle、解码 protobuf、车辆库映射、去重汇总、POI 导出 xlsx        |
| `wotb-web`  | Spring Boot 4 REST API + PostgreSQL/Flyway/Keycloak，监听 `8087`（管理端口 `8088`，Actuator/Prometheus） |
| `frontend`  | Vue 3 + Vite 前端，单文件组件，无 router，开发端口 `5173`                   |
| `keycloak-wargaming-provider` | Keycloak 26 自定义 Identity Provider：Wargaming.net 登录 SPI（Provider ID `wargaming`，region 配置 ASIA/EU/NA → 官方 host 白名单：认证 `api.worldoftanks.*/wot/auth/`、账号 `api.wotblitz.*/wotb/account/`；ASIA/EU/NA 三个实例） |
| `docker/online/` | `docker-compose.yml`：`build:` 从源码编译运行八服务（postgres + keycloak + backend + frontend + prometheus + loki + alloy + grafana） |

> 车辆库 `common/tankopedia-tier{7,8,9,10}.json` 与地图名映射 `common/map_names.json`（仓库根的共享目录）都会在 `wotb-core` 构建时自动复制到 classpath，无需在模块内再放副本。

## AI Review Harness（双 Call + Team Autopsy）

随机战个人复盘（ZH）在重建与特征可用时走 `TacticalReviewHarness`（双 Call）：Call #1 用双方阵容 + `common/tank_tactical_profiles.json` + 地图语义（`common/map-semantics/*.semantic.json`，由 `map-semanticizer` 从 Wot Blitz 客户端 SC2 + heightmap 解码生成）建立赛前战略基线（不含任何战斗结果），Backend Evidence Skills（HpMomentum / EngagementTrade / LocalSupport / DeathCascade / Route / CriticalWindow）输出确定性战术证据，Call #2 按 Priority Bookends 对照「预期 vs 实际」输出复盘，输入含走位/区域时间线、逐次对炮明细、≤8 个关键决策窗口完整证据与口语化语气约束；随机战斗不评判 MVP/战犯。任何前提不满足自动降级旧单 Call 路径；EN/RU 保持旧路径。地图战术语义层（`MapTacticalSemanticsRegistry`）：按 `mapCodes` / `mapId` / token 边界别名查询，未收录地图明确 UNKNOWN（禁止编造区域语义）；语义数据 `displayName` 用 `map_names.json` 的 en 名（未收录回退 mapId），Call #1 语义段显示可读地图名 + 内部 code；语义 AREA 标注 `gridRegions`（GRID_REGION_1~9），与 `MapRegionResolver` 同一坐标约定（±250 m → 500×500 → 3×3），回放定位与地图语义共用同一九宫格；Call #1 有独立 45s stage 预算，Call #2 使用剩余预算并留安全余量，整体不超过 `AI_CALL_TIMEOUT_SEC`。**结构化 JSON 小调用关闭 thinking**：Call #1 与 TEAM_AUTOPSY 在请求层强制 `thinkingEnabled=false`（`reasoningEffort=null`）——生产实测 DeepSeek thinking（`AI_REASONING_EFFORT=max`）会把整个输出预算消耗在 reasoning 上返回空正文（`AI_EMPTY_RESPONSE`），关闭后直接输出契约 JSON；Call #2 主复盘默认也关闭 thinking（`AI_THINKING_ENABLED_CALL2` 默认 false）——DeepSeek 推理模式会让 content 末尾一次性到达、破坏 SSE 逐段流式，需要推理深度时开启（流式由网关分块兜底保证）。团队复盘（训练房/联赛，`TeamReplayAnalysisService`）与随机战一样**先执行 Call #1**（地图 + 双方阵容赛前先验，按视角队伍重标 TEAM_A=你的队伍 / TEAM_B=对方队伍 后注入团队 Prompt，先识别实际战局类型再对照「预期打法 vs 实际执行」；Call #1 失败仅缺 prior 段不阻断复盘），团队输入含每名成员整场路线序列（九宫格），单团队单元后追加**结算级** TEAM_AUTOPSY（判负→主要战犯 / 判胜→MVP，≥1，可多人）：仅当 recorderTeam 恰好 7 名有效本方玩家时才调用（0–6/8 人跳过并记录 roster_incomplete），Autopsy 无 Call #1 prior / Critical Window / Route 证据，LLM 判断 confidence 仅 PARTIAL/UNKNOWN（EXACT/INFERRED 拒绝），玩家身份用 `playerKey`（完整 roster 契约），预算 min(30s, 整体剩余 - margin)，失败/解析失败不输出该段且不影响主复盘；`AnalyzeResponse` 结构与前端零改动。

## Web 版（Docker + PostgreSQL）

```bash
cd ..\docker\online
docker compose up -d --build
```

访问 http://localhost:8088 （健康检查 `http://localhost:8088/api/health`）。

`docker/online/docker-compose.yml` 启动**八服务**（`postgres:18` + `keycloak` + `wotb-backend` + `wotb-frontend` + `prometheus` + `loki` + `alloy` + `grafana`），后端与前端分别构建 `docker/Dockerfile.backend` 和 `docker/Dockerfile.frontend`，观测四件套使用固定版本镜像。nginx 托管 Vue + 反代 `/api → wotb-backend:8087`，后端连接 PostgreSQL 并由 Flyway 管理 schema。本地启动观测栈需在环境变量或 `docker/online/.env` 提供 `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`（compose required 语法校验）。

赞助页从 `/sponsor-config.json` 读取运行时配置。生产配置保存在 `/opt/wotb/config/sponsor-config.json`，二维码保存在 `/opt/wotb/config/sponsor/`，以只读方式挂载到前端容器；仓库仅提供 disabled 示例配置，不包含个人收款二维码。

### CI/CD 自动部署

`push` 到 `main` 分支触发 GitHub Actions（[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)）：

1. `push` 到 `main` 触发，按 `on.push.paths` 过滤（仅当构建/部署相关路径变化才触发；纯文档 push 不触发）。
2. 代码质量验证与测试由 PR CI（merge gate）承担；**deploy 不再运行 backend/frontend 测试套件**。
3. 统一构建并推送 backend/frontend/keycloak 三个 SHA 镜像到 GHCR（tag = `sha-<短 hash>`，确定性构建，无需反复运行测试）。
4. SSH 部署前先备份 `wotb` 与 `keycloak` 两个数据库，再 `docker compose pull && up -d`。
5. 部署等待 `wotb-backend` 的 `/api/health` 成功；失败会输出后端/前端日志并让 workflow 失败。

线上 502 排查可手动运行 [`.github/workflows/prod-diagnostics.yml`](../.github/workflows/prod-diagnostics.yml)，读取 VPS compose 状态与后端/前端日志。

> 八个服务：`postgres:18`（数据持久化，卷挂 `/var/lib/postgresql`）→ `keycloak`（认证，`auth.wotbtools.com`）→ `wotb-backend`（Spring Boot 8087，管理端口 8088）→ `wotb-frontend`（nginx + Vue，暴露 8088:80）+ 观测四件套（`prometheus`/`loki`/`alloy`/`grafana`，仅 Docker 内部网络）。`paths` 过滤使纯文档 push 不触发部署。

## 本地开发

后端需要 JDK 21；完整运行使用八服务开发环境，确保 PostgreSQL、Keycloak 与必要环境变量同时存在。

```bash
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml test
cd ../docker/online
docker compose up -d --build
```

前端：

```bash
cd frontend
npm ci
npm run dev
```

Vite 开发服会把 `/api` 代理到 `http://localhost:8087`。

## API

### `GET /api/health`

返回服务状态与已加载车辆数量。

所有 JSON API 只返回英文 key 与 raw enum；失败统一返回 canonical `ApiErrorResponse`（`code/status/messageKey/traceId/retryable/details/timestamp`），不返回本地化 `*Label`、exception message 或 stack trace。Phase 1 仍兼容既有稳定 `error` code。前端通过三语 locale 显示状态、成功和错误文案；完整契约见 `../docs/api/error-contract.md`。
未显式声明的 `/api/**` 默认拒绝；`boost-manager` 仅能访问 `/api/admin/boost/**`。


列定义由后端 `GET /api/replay/processing-jobs/{jobId}/result` 响应中的 `playerColumns`/`aggregateColumns` 字段和 `/api/columns` 提供（纯英文 key）。
前端用 `vue-i18n` 三语 locale（`frontend/src/locales/{zh,en,ru}.json` 的 `player_labels` / `agg_labels`）映射显示名，
导出层（单场 `Columns.java`、汇总 `AggregateSheets.java`）各自维护 xlsx 表头。回放页列选择器会把单场/汇总两套列顺序与可见性记到 `localStorage`，
并在后端新增列时自动补齐缺失键。详见 [DEVELOPER_GUIDE.md](../docs/DEVELOPER_GUIDE.md) 的「显示名（i18n）架构」。


地图名由共享字典 `common/map_names.json` 提供 `zh/en/ru` 三语映射；前端 `mapLabel()` 按当前 locale 取值，导出层 `MapNames.cn()` 继续固定使用中文。


战斗表现（Performance Metrics）由 Replay Processing V2 的
`GET /api/replay/processing-jobs/{jobId}/result` 统一返回。完整链：
`POST /api/replay/processing-jobs` → Processing Job → `ReplayParseScheduler` →
共享 `ProcessedDataset` → `GET .../result`。Performance Metrics / League Rating /
base replay facts 都来自同一 result。单场玩家表直接包含 `contribution`/`kast`/`impact`
列，汇总表包含跨场 `contribution`/`kast`/`impact`/`multi_damage_rate`/`traded_deaths`，
不存在独立 `/extended` 页面、`/api/performance` 端点或「战斗表现」tab。

### Legacy（已废弃）

以下同步端点已随 Replay Processing V2 移除，一律返回 `410 REPLAY_LEGACY_DEPRECATED`：

`POST /api/preview`、`POST /api/export`、multipart `POST /api/replay/analyze`、
multipart `POST /api/replay/map-overview`、`POST /api/replay/process`、
`POST /api/replay/reconstruct-batch`。

当前 V2 只有：Processing Dataset → Export Job → XLSX/ZIP（`GET .../result` +
`POST /api/replay/export-jobs`），不再有 raw replay → Export 路径。历史契约见
`docs/CHANGELOG.md` 与 git history（当前 README 只描述 current state）。


### Replay Export Job（匿名公开，长任务导出）

大文件量导出（如 34+ 个回放）走异步 Job，页面不再阻塞等待同步 HTTP 响应：

- `POST /api/replay/export-jobs`（**Dataset-only**，`?mode=aggregate|each`；`processingJobId` 语义必填，缺失/空 → 410 `REPLAY_LEGACY_DEPRECATED`；可传 `teamNames` JSON（`{battle:{arenaId:team:名}, summary:{teamKey:名}}`：单场 vs 批次战队 identity 两种独立 override，仅本次调用内使用）result，**不接收 replay files / 不重新上传 / 不重新 processFull**）— 复用 READY Processing Job 的 ProcessedDataset 直接生成 artifact（无上传输入），返回 `202 {jobId, status, total}`。引用不存在的解析任务 → 404 `PROCESSING_JOB_NOT_FOUND`，未 READY → 409 `PROCESSING_JOB_NOT_READY`。
- `GET /api/replay/export-jobs/{jobId}` — 轮询真实进度：`{jobId, status, phase, total, processed, duplicates, failures, errorCode, filename, contentType}`。`status` ∈ QUEUED / PROCESSING / READY / FAILED / CANCELLED（终态 exactly once）；`phase` ∈ PROCESSING_REPLAYS / BUILDING_EXCEL / BUILDING_ARCHIVE。0 场有效 → FAILED `NO_VALID_REPLAYS`（不生成空 Excel）。
- `DELETE /api/replay/export-jobs/{jobId}` — 取消（QUEUED 立即终态；PROCESSING 协作取消，安全 checkpoint 后终态）。
- `GET /api/replay/export-jobs/{jobId}/download` — READY 后流式下载 artifact（单场/汇总 xlsx 或 each zip；`FileSystemResource` streaming，不 `readAllBytes`）。

容量：内存态 job store（单实例部署）+ 有界 worker 池（`REPLAY_EXPORT_JOB_MAX_CONCURRENT=2` / `REPLAY_EXPORT_JOB_QUEUE_CAPACITY=4`，满载 503 `EXPORT_QUEUE_FULL`）；Export 只消费已解析 result，**不执行 replay 解析，故不获取全局 `ReplayCapacityLimiter` 许可**。终态 job 与临时目录由 TTL（`REPLAY_EXPORT_JOB_TTL_MINUTES=30`）清理，启动清理孤儿目录。旧同步 `POST /api/export` 已随 V2 废弃（410）；当前只保留 `/api/replay/export-jobs`。

### Replay Processing Job（匿名公开，解析预览异步化）

「上传多个回放 → 解析预览」从长同步 HTTP 改为异步 Processing Job：HTTP request 立即返回 202 + jobId，source 任务提交给**全局 `ReplayParseScheduler`**（默认并发 2，job-aware 公平轮转 + queued cancellation + 有界 pending），每个 replay 恰好 `processFull` 一次，产出**共享的 ProcessedDataset** 供 Preview / Export / AI / 战局回放复用（同一批 34 个回放不再 Preview ×34 / AI ×34 / Playback ×34，总 `processFull` 调用数 = 文件数）。**READY 后消费者只读**：facts 层 enrich（populateBattle）只在 dataset 创建时执行一次，Preview result / from-result Export 不再二次 mutate 共享 Battle（并发 Preview / aggregate / each Export 同一 dataset 无 shared mutable write）；`validCount() > 0` 即允许 from-result 导出（failures 只用于进度/统计，不与有效场数相减）。

- `POST /api/replay/processing-jobs`（multipart `files`，可选表单字段 `prioritySourceIndex` 指定直接进入 AI/Playback 的目标 source）— 校验并立即持久化上传输入，返回 `202 {jobId, status, total}`。
- `GET /api/replay/processing-jobs/{jobId}` — 轮询真实进度：`{jobId, status, phase, total, processed, valid, duplicates, failures, errorCode, currentFile, parseCompleted, parseSucceeded, parseFailed, sources[], activeSources[]}`。`status` ∈ QUEUED / PROCESSING / READY / FAILED / CANCELLED（终态 exactly once）；`phase` ∈ WAITING_FOR_WORKER / PROCESSING_REPLAYS / FINALIZING_BATCH（parse 进度 = `parseCompleted/total`，与 dedupe/finalize 解耦；`valid/duplicates/failures` 只在 FINALIZING 后确定）；`sources[]` 为轻量 per-source 状态（`sourceId`（`r{index}`）/`sourceIndex`/`displayName`/`status`/`errorCode`），`activeSources[]` 为当前并行处理中的 source（≤2）。0 场有效 → FAILED `NO_VALID_REPLAYS`。
- `DELETE /api/replay/processing-jobs/{jobId}` — 取消（QUEUED 立即终态并释放 scheduler pending 容量；PROCESSING 置协作取消标志，已派发 source 完成安全 unit 后终态；FINALIZING 阶段间 checkpoint）。
- `GET /api/replay/processing-jobs/{jobId}/result` — READY 后返回 Preview 数据（battles / aggregate / duplicates / failures / playerColumns / aggregateColumns；**不再重新 process replay**）；未 READY → 409 `JOB_NOT_READY`。

容量与生命周期：Replay Full Processing 的唯一 CPU 预算为 `ReplayParseScheduler`
（`REPLAY_PARSE_MAX_CONCURRENT`，默认 2；`REPLAY_PARSE_QUEUE_CAPACITY` 默认 200，
满载 503 `PROCESSING_QUEUE_FULL`）；Excel/ZIP artifact 构建独立于 parse
（`REPLAY_ARTIFACT_MAX_CONCURRENT`，默认 1）。ProcessedDataset 为**内存态短生命周期缓存**
（TTL `REPLAY_PROCESSING_JOB_TTL_MINUTES=30`）：只缓存已 enrich 的 Battle 结算战绩
（不携带 reconstruction 事件流）；per-source derived artifact（`ai-facts.json` /
`map-overview.json`）写 `derived/{sourceId}/`（临时文件 + atomic move，先写后 READY，
TTL 随 job 目录清理）。Dataset Lease：Export / AI / Playback 读取前 `acquire`（引用计数
+1，TTL 清理跳过），结束后 `release`；acquire 后任何失败都释放引用（不泄漏 refcount）。
临时输入目录由 `REPLAY_PROCESSING_JOB_DIR` 管理（TTL 清理 + 启动孤儿清理）。旧同步
`POST /api/preview` / `POST /api/export` 已随 V2 移除（返回 `410 REPLAY_LEGACY_DEPRECATED`；
导出改走 `/api/replay/export-jobs` 异步 Job）。

> **容量边界**：Replay Full Processing 的唯一 CPU 预算是 Processing Job 的 `ReplayParseScheduler`（`REPLAY_PARSE_MAX_CONCURRENT` / `REPLAY_PARSE_QUEUE_CAPACITY`）。全局 `ReplayCapacityLimiter`（`REPLAY_MAX_CONCURRENT_JOBS`，默认 2，与 HoF/Hundred/Mark3 等**非 Processing** 业务共享）是「同一实例同一时刻执行其它领域回放解析任务」的独立许可，容量满由对应业务接口返回 `503 REPLAY_BUSY`；它**不是** Processing V2（`/api/replay/processing-jobs`）的容量 authority，二者不重复计费、不存在第二套并行处理。

### AI 复盘与批量处理（wotbtools-user / wotbtools-admin）

完整战斗重建（parse + reconstruction + enrich）在 Processing Job 的 per-source
`processFull` 阶段完成（`ReplayParseScheduler` → `DefaultReplayProcessingFacade`），产出
`ai-facts.json` / `map-overview.json` 等 derived artifact。AI / 战局回放只读这些 artifact，
**不在** `/analyze` 内部做 reconstruction，也绝不重新上传 / 重新 full process。

- `POST /api/replay/analyze` — **Dataset 路径（唯一）**：JSON body `{processingJobId, sourceId, lang, correlationId}`，只读 derived `ai-facts.json`（**不重新上传 / 不重新 full process / 不执行 reconstruction**）；legacy multipart `files[]` 路径已废弃（410 `REPLAY_LEGACY_DEPRECATED`）。**单文件限制（`AiReplayBatchPolicy.MAX_FILES=1`）**，仅 `SINGLE_PLAYER_BATTLE` / `SINGLE_TEAM_BATTLE` 模式。表单/JSON 字段 `lang`（必填，白名单 `zh`/`en`/`ru`）控制输出语言；缺失返回 `400`，空白或未知值返回 `400 UNKNOWN_LOCALE`。可选 `correlationId` 用于客户端取消；`POST /api/replay/analyze/cancel?correlationId=...` 中断 in-flight 上游调用（返回 `204`，未注册返回 `404`）。稳定错误码：`JOB_NOT_FOUND`（job/dataset 已 TTL 清理，可重建）/`SOURCE_NOT_FOUND` / `SOURCE_NOT_READY` / `SOURCE_PROCESSING_FAILED` / `DATASET_UNAVAILABLE`（artifact 读取/存储故障，**不可**按过期 dataset 自动重建）。`POST /api/replay/map-overview` — Dataset 路径 JSON body `{processingJobId, sourceId}` 读 cached `map-overview.json`（不重新 full process）；legacy multipart 路径已废弃（410 `REPLAY_LEGACY_DEPRECATED`）。地图不可构建返回 `204`。**响应为 SSE 流式**：事件 `call1_start` / `call1_done` / `evidence_done` / `call2_token`（`{"delta"}`）/ `autopsy_start` / `autopsy_done` / `done`（`{"analysis","preBattleSection"}`）/ `error`（`{"code"}`）；request-envelope 校验与 worker 池饱和在返回 `SseEmitter` 前由 HTTP 状态码 + 稳定错误码文本返回（400/503）。完整协议见 `docs/features/team-ai-review.md`。

**策略**：上传文件先统一校验扩展名、空文件和单文件大小；通过预校验后，解析/重建错误才按文件隔离。系统执行 SHA-256 精确去重，并按 battle + perspective 分组。随机战斗分析录像者个人；训练房/联赛分析录像者所在整队，录像者只用于解析 `perspectiveTeam`。同场同队回放只选一个代表，同场双方保持独立；未点亮敌人仍未知，不能跨录像补全视野。

团队总伤害、承伤、助攻、格挡、击杀、存活来自 `battle_results.dat` 权威结算；死亡时刻权威链为 `LIVE_EXACT`（回放 live EXACT，sub-second）→ `SETTLEMENT_SECOND`（结算 `deathTimeMillis`）→ `UNKNOWN`（`survivalTimeSec=0`）；`PlayerResultFormat.deathSec` 按 `deathTimeSource` 消费，legacy 启发式不作为死亡 authority；事件流伤害只作为观测子集。重建可用时补充每名队员独立移动、阵型、交火和关键事件；重建不可用时仍可生成明确标注的权威结算 fallback。AI 输入不包含原始事件流，prompt 长度由 token 估算器（`AiTokenEstimator`）按 `AiModelProperties` 预算控制（`singleReplayMaxInputTokens` 等），不再使用固定成员数/事件数/字符数截断；超限时返回 `AI_INPUT_TRUNCATED` limitation。

AI 上游与数据错误只向 API 返回稳定英文码（含 `AI_TIMEOUT`、`AI_CANCELLED`、`AI_UPSTREAM_UNAVAILABLE` 等），前端以 zh/en/ru 本地化。`/api/replay/**` 需要 `wotbtools-user` 或 `wotbtools-admin` 角色；未配置 `AI_API_KEY` 时 `/analyze` 返回 `AI_NOT_CONFIGURED`，应用其余功能不受影响。全链路超时对齐：整体 deadline 默认 1100s（团队 3 次 AI 调用 + 余量，`AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC`）→ 前端 analyze 安全超时 1100s < 容器 nginx `/api/replay/analyze` 1120s，后端 AI 单次预算 `AI_CALL_TIMEOUT_SEC=315s` + 解析余量；`AI_TIMEOUT` 不再自动重试（上游可能已计费）。

### 名人堂（Hall of Fame）

每条记录 = 录像者本人在一场**随机战斗**（`arenaBonusType==1`）或**评级战斗**（`==7`）中用某辆车打出的单场伤害（战斗模式判断集中在 `HallOfFameBattleTypePolicy`，其余模式 → 400 `UNSUPPORTED_BATTLE_TYPE`，零持久化）；通过名人堂上传入口写入（去重键 `arena_id + account_id`）。

- `GET /api/hof?battleType=RANDOM|RATING&nation=&vehicleType=&tier=&tankId=&nickname=&page=&size=` — 统一公开查询（匿名；国家/车种/等级无需先选车辆即可独立过滤，所有非空车辆条件与 `tankId` 取交集；排序 damage DESC → RATING 优先 → battleTime ASC NULLS LAST → createdAt → id；rank = 完整 filter 上下文位置排名）。
- `GET /api/hof/vehicle-options` — 匿名车辆选项（当前单场名人堂实际存在车辆的名称、国家/系别、车种、等级），供公开页与管理页无序交集筛选复用。
- `POST /api/hof/upload` — 上传单场回放（**需登录**）；不支持战斗模式 → 400 `UNSUPPORTED_BATTLE_TYPE`；其余跳过时返回英文 `reasonCode`（`DUPLICATE_OR_UNKNOWN_RECORDER` / `REPLAY_HASH_CONFLICT`），由前端本地化。
- `GET /api/hof/{id}/replay` — 下载该记录原始回放文件（**需登录**，任意已登录用户；无文件 → 404 `REPLAY_FILE_NOT_FOUND`）。
- 管理后台（**需 `HoF-admin` 或 `wotbtools-admin`**）：`GET /api/admin/hof`（国家/车种/等级可独立真实筛选并与具体车辆取交集，另支持搜索/排序/分页；不暴露 Arena ID 或原始 `arenaBonusType`）、`GET /api/admin/hof/vehicle-options`（复用公开车辆选项实现）、`GET /api/admin/hof/audit`（操作日志，只读）、`GET /api/admin/hof/{id}/replay`（下载）、`DELETE /api/admin/hof/{id}`（hard delete，audit+delete 单事务，最后引用清理物理文件；删除后同一回放可重新上传）。
- 原始 .wotbreplay 以 SHA-256 内容寻址存 `HOF_REPLAY_DIR`（默认 `data/replays`，生产 volume `/data/replays`）；老记录无文件不显示下载按钮。
- **百场（Hundred Battles）**：Tier X 车辆独立的生涯场均伤害排行榜，同时提供原人工审核与 WG 官方 API 自动认证（`com.wotb.web.hundred` 域）：
  - `GET /api/hof/hundred?nation=&vehicleType=&vehicleId=&page=&size=` — 公开排行榜（匿名；三项交集：全空为全站 CURRENT Top 10，仅分类为分类交集 Top 10，具体车辆为该车独立分页；competition ranking 与筛选上下文一致）。
  - `POST /api/hof/hundred/submissions` — 提交百场成绩（**需登录** + Profile gameId/nickname 已配置；multipart：vehicleId/averageDamage/battleCount/screenshot(base64)/replays×5）。硬门禁：Tier X authoritative 校验、5 个 replay 全部解析成功且 gameId/vehicleId 匹配、5 场不同 battle；任一失败整单拒绝不进入 PENDING。同车已有 PENDING → 409 `HUNDRED_PENDING_EXISTS`；新成绩未严格高于 CURRENT → 409 `HUNDRED_NOT_HIGHER`。
  - `POST /api/hof/hundred/submissions/wargaming` — WG 自动认证（**仅 `wotb_verified` 的 ASIA/EU/NA 登录账号**；JSON：vehicleId/averageDamage/battleCount，不上传文件）。首次可信 WG 登录后可直接调用：后端先同步 Profile，再交叉校验 JWT/Profile/WG 官方响应；同步或身份冲突时不调用 WG stats、不创建 submission。账号总场次 >=5000、目标车场次 >=100，官方精确场均 <=3900 自动 CURRENT，>3900 自动创建无文件的 WG 来源 PENDING。claimed 值仅审计，不能影响分流或排名；WG 失败零落库并回退人工入口。
  - `POST /api/hof/hundred/submissions/{id}/cancel` — 用户撤销自己的 PENDING（**需登录**）。
  - `GET /api/users/hundred/status` — 个人中心百场状态（CURRENT / PENDING / 最近拒绝；**需登录**）。
  - 管理后台（**需 `HoF-admin` 或 `wotbtools-admin`**）：`GET /api/admin/hof/hundred/submissions?status=&nation=&vehicleType=&vehicleId=`（状态/国家/车种/车辆可独立筛选并取交集；摘要只返回 `certifiedAverageDamage` / `certifiedBattleCount`，WG 为冻结官方快照，MANUAL 为通过后的值）、`GET .../submissions/{id}`（所有状态详情，保留用户申报值；MANUAL PENDING 返回 proof，WG PENDING 返回官方快照）、`GET .../submissions/{id}/replays`（仅 MANUAL PENDING 回放证据 metadata）、`GET .../submissions/{submissionId}/replays/{replayId}`（下载原始 .wotbreplay，ownership 校验 + UTF-8 filename）、`POST .../{id}/approve`（无请求体；按来源校验证据后以 MANUAL 原申报值或 WG 官方冻结快照原子替换 CURRENT）、`POST .../{id}/reject`（原因强制）、`POST .../{id}/delete`（仅 CURRENT，原因强制，不恢复 SUPERSEDED）。
  - 数据模型：`hundred_battle_submission` 单表生命周期（Flyway `V18`），partial unique index 保证 user+vehicle 最多一个 PENDING/CURRENT；Flyway `V20` 增加 `verification_source` 与 WG 官方 totals 快照。MANUAL proof 截图和 5 个原始 replay 仅 PENDING admin-only 保留，终态立即清理；WARGAMING_API 来源从不保存文件，管理员审核冻结的官方数字快照。

- **三环（Mark 3）**：Tier X 单车最速三环排行榜，仅走人工审核（`com.wotb.web.mark3` 域）：
  - `GET /api/hof/mark3?nation=&vehicleType=&vehicleId=&page=&size=` — 公开排行榜（匿名；与百场相同的国家/系别、车种、车辆交集；全空或仅分类时为 CURRENT Top 10，选择车辆后为该车独立分页；按 approvedBattleCount ASC，场数相同为 competition rank，稳定展示按 approvedAt ASC、id ASC）。
  - `POST /api/hof/mark3/submissions` — 提交三环成绩（**需登录** + Profile gameId/nickname 已配置；multipart：vehicleId/battleCount/averageDamage/winRate/proofScreenshots×1–2（单张不超过 4 MiB 的 base64 `data:image/`）/replays×5）。仅 authoritative Tier X；胜率为 0–100 的百分数且最多两位小数；5 个回放均须解析成功、匹配账号与车辆且 arenaId 不重复。读取/解析/落盘/事务全程通过全局 `ReplayCapacityLimiter`，容量满在解析前返回 503 `REPLAY_BUSY`。截图只校验图片数量/格式：从 0 场开始打三环的新车可 1 张，其他申请由管理员核验 0% 与 95% 起止截图。
  - `POST /api/hof/mark3/submissions/{id}/cancel` — 用户撤销自己的 PENDING（**需登录**）。
  - `GET /api/users/mark3/status` — 个人中心三环状态（CURRENT / PENDING / 最近拒绝；**需登录**）。
  - 管理后台（**需 `HoF-admin` 或 `wotbtools-admin`**）：`GET /api/admin/hof/mark3/submissions?status=&nation=&vehicleType=&vehicleId=`（状态/国家/车种/车辆交集筛选）、`GET .../submissions/{id}`（详情与 PENDING proof）、`GET .../submissions/{id}/replays` 与 `GET .../submissions/{submissionId}/replays/{replayId}`（仅 PENDING 回放证据）、`POST .../{id}/approve`（无请求体，冻结原申报数据）、`POST .../{id}/reject`、`POST .../{id}/delete`（原因强制）。管理员不能改写场数、场均或胜率。
  - 数据模型：`mark3_submission` / `mark3_replay_evidence`（Flyway `V21`）；状态仅 PENDING/CURRENT/REJECTED/CANCELLED/DELETED，禁止 `SUPERSEDED` 和任何 CURRENT 替代。同用户同车已有 CURRENT 时拒绝新提交/通过；REJECTED/CANCELLED/DELETED 后允许重提。截图与 5 个回放仅在 PENDING admin-only 保留，所有终态立即清理。

### 陪练与打手（仅在线版）

`GET /api/booster/assignments` 默认返回当前登录打手的活跃订单；追加 `?includeHistory=true` 时返回活跃 + 历史订单（活跃优先、历史按分配时间倒序），供个人中心回看已完成/已取消/已拒绝订单。`PATCH /api/boost/boosters/my/availability` 允许打手本人切换 `available`，用于暂停/恢复接收新订单，并返回最新 `BoosterDto` 给个人中心即时刷新。打手可通过 `PATCH /api/booster/assignments/{id}/accept|start|complete|decline` 流转自己的订单；提交完成后需求进入 `PENDING_CONFIRM`，客户调用 `PATCH /api/boost/requests/my/{id}/confirm-completion` 确认为 `CLOSED`。若客户未操作，系统默认 72 小时后自动确认；管理员也可关闭 `PENDING_CONFIRM`/`EXCEPTION` 订单。三条入口共用带行锁的幂等完结路径，同时把分配置为 `COMPLETED`、写入 `unassigned_at` 并释放打手。管理员分配订单时要求打手资格为 `ACTIVE`、未暂停接单且没有活跃订单；前端会按资格、接单状态、活跃订单数、等级和擅长内容推荐排序。

客户提交陪练需求和打手资格申请都支持 `CN / ASIA / EU / NA` 四个区服。`GET /api/boost/options` 从 `BoostRegion` 动态返回客户需求区服选项，空值默认 `CN`、未知值返回 `UNSUPPORTED_BOOST_REGION`；需求区服会显示在客户、管理员列表，并通过 `BoostAssignmentDto.region` 提供给打手工作台。打手申请则把用户资料中规范化后的真实区服写入申请记录；审批后区服固化到 `booster_profile.wotb_server`。玩家可申请 `CASUAL / SKILLED / ELITE / PRO / MASTER` 五档；兼容内部值 `AVERAGE_GOD` 的“殿堂级”（英文 `Mythic`）只能由管理员编辑已有打手授予，且每服最多一名。申请 ID、账号 ID、档期等仍保存在申请表专用字段，不写进可编辑打手备注。列表接口 `GET /api/boost/booster-applications/my` 与 `GET /api/admin/boost/booster-applications` 返回不含截图、微信、日常时段和自评的 `BoosterApplicationSummaryDto`，并通过 JPA 构造投影避免读取 Base64 图片列；审核状态变更接口也返回该摘要 DTO，避免重复回传图片。管理员需要完整资料时调用 `GET /api/admin/boost/booster-applications/{id}`；资格审批前端只在点击“详情”后请求该接口。

完成确认窗口由 `BOOST_AUTO_CONFIRM_HOURS` 配置（默认 `72`），到期扫描间隔由 `BOOST_AUTO_CONFIRM_SCAN_MS` 配置（默认 `300000` 毫秒）；线上部署可用同名 GitHub repository variables 覆盖。Flyway V11 会给已有 `PENDING_CONFIRM` 订单从迁移时刻起补一个 72 小时窗口。

`DELETE /api/admin/boost/boosters/{id}` 会保留资格申请并清空其 `approved_booster_id`；存在任意订单分配历史时以 `BOOSTER_HAS_DEPENDENCIES` 拒绝。管理员删除用户时会先复用该流程清理关联打手档案，再删除本地资料与 Keycloak 用户。

`GET /api/users/notifications`、`GET /api/users/notifications/unread-count`、`PATCH /api/users/notifications/{id}/read` 和 `PATCH /api/users/notifications/read-all` 提供站内通知基础能力。通知 API 返回英文 `type` 与 `payload` 数据，具体文案由前端三语 i18n 渲染。

### 用户资料（WoTB 账号）

- `GET /api/users/profile` — 当前用户资料；未创建返回 404 `PROFILE_NOT_FOUND`。
- `POST /api/users/profile` — 懒创建资料。JWT 带可信 WG claims（`wotb_verified=true` 且 `wotb_region ∈ {ASIA,EU,NA}` 且账号/昵称有效）时自动创建对应区服资料（`wotb_account_source=WARGAMING`、`wotb_account_verified_at=首次同步时间`）；否则按 CN（`MANUAL`）创建。
- `PATCH /api/users/wotb-account` — CN 手动绑定（仅允许 `wotbServer=CN`）；WARGAMING source 资料返回只读错误（ASIA 为 400 `ASIA_PROFILE_READONLY`，EU/NA 为 400 `WARGAMING_PROFILE_READONLY`）。
- `PUT /api/users/wotb-account/from-login` — WG 登录后的幂等同步（无 body，只读 JWT）；Profile 不存在时原子创建 WARGAMING、空 Profile 升级为 WARGAMING、同 (region, account_id) 刷新官方昵称（不刷新 verified_at）；百场 WG 提交会在查询 stats 前复用相同同步。已绑定 CN 覆盖或跨区服返回 409 `PROFILE_REGION_MISMATCH`、换账号返回 409 `WOTB_ACCOUNT_MISMATCH`、账号被他人占用返回 409 `WOTB_ACCOUNT_ALREADY_USED`、Claims 缺失返回 400 `WOTB_CLAIMS_INVALID`。
- `DELETE /api/users/wotb-account` — 解绑；WARGAMING source 资料返回只读错误（ASIA 为 400 `ASIA_PROFILE_READONLY`，EU/NA 为 400 `WARGAMING_PROFILE_READONLY`）。

资料 DTO 含 `wotbAccountSource`（MANUAL/WARGAMING）与 `wotbAccountVerifiedAt`（ISO 时间或 null）。JWT claims 由 Keycloak realm 的 4 个 protocol mapper 提供（`region→wotb_region`、`wotb.account_id→wotb_account_id`、`wotb.nickname→wotb_nickname`、`wotb.verified→wotb_verified(boolean)`）；Keycloak 与 backend 容器需注入同一个 `WG_APPLICATION_ID`（分别用于 WG 登录与百场官方认证，缺失时相应 WG 功能报错但应用和人工链路可用）。详见 [docs/auth/wargaming-asia-login.md](../docs/auth/wargaming-asia-login.md) 与部署手册 [docs/auth/wargaming-asia-deployment.md](../docs/auth/wargaming-asia-deployment.md)。

## 测试

```bash
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml test
```

测试覆盖：

- `wotb-core` 的 `ParityTest`：集成测试，覆盖解析、字段不变量、去重、汇总、xlsx 导出。
- `wotb-web` 的 boost / hof / security / API 契约单元测试都会执行；无需数据库的 controller 契约已拆出，始终运行。
- 架构测试：`CoreArchitectureTest` / `WebArchitectureTest`（ArchUnit）守护模块边界与分层，随 `mvn test` 自动执行。
- `WebApiTest` 只保留 PostgreSQL/真实回放集成路径；无 Docker 或无 `common/data` 时按条件跳过。

测试样本来自仓库根目录的 `common/data/`。

前端测试与构建：

```bash
cd frontend
npm test
npm run build
```

## 生产备份与恢复

- `.github/workflows/database-backup.yml` 每日香港时间 03:15 备份 `wotb` 与 `keycloak`；部署前也会自动备份。
- 归档在 `/opt/wotb/backups/{wotb,keycloak}/`，通过 catalog + 全压缩数据读取校验，按数据库分别保留 7 天。
- 查看归档：`deploy/postgres-backup-inspect.sh <archive.dump>`。
- 恢复：`deploy/postgres-restore.sh --database wotb|keycloak --file <archive.dump> --confirm RESTORE-<database>`。脚本会先做安全备份；恢复失败时依赖服务保持停止，需人工处理。

## 构建配置

项目使用独立 Maven 配置，避免污染或依赖用户全局 Maven 设置：

- `java/settings.xml`：仓库跟踪的可移植本地 Maven settings；在 `java/` 目录执行时使用独立仓库 `java/.m2repo`，干净 clone 无需生成。
- `java/settings-docker.xml`：Docker 构建用 Maven settings。
- `frontend/package-lock.json`：固定前端依赖版本。

默认端口在 `wotb-web/src/main/resources/application.yml`：

```yaml
server:
  port: 8087
management:
  server:
    port: 8088   # 独立管理端口：/actuator/health、/actuator/prometheus（仅 Docker 内部网络，不映射公网）
spring:
  servlet:
    multipart:
      max-file-size: 20MB
      max-request-size: 200MB
  web:
    resources:
      static-locations: classpath:/static/
wotb:
  replay:
    max-concurrent-jobs: ${REPLAY_MAX_CONCURRENT_JOBS:2}
```

## 维护注意

- 列定义在 `wotb-core/.../Columns.java` 中集中管理，前端通过 `GET /api/replay/processing-jobs/{jobId}/result` 响应获取列定义，不在前端硬编码业务字段。
- 车辆库单一来源在 `common/tankopedia-tier{7,8,9,10}.json`（由 `common/python/update_tankopedia.py` 从 blitzkit 游戏客户端数据同步，按等级拆分 4 个文件，`vehicles` 数组全英文格式，含手工 `extraInfo` 每车知识点与每车可用物资/消耗品/装备）；`wotb-core` 构建时自动复制到 classpath，勿在模块内再放副本。
