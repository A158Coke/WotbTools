# Developer Guide

> 动手前先读这一份。接手维护的人或 AI 都适用。

---

## ✦ 给接手的一句话

这是一个单人维护的 WoT Blitz 回放分析 Web 工具：Java 21 core + Spring Boot 4 + Vue 3 + Keycloak + PostgreSQL。

动手前读 `.agents/AGENTS.md`、当前目录的 `AGENTS.md` 和本文件；跨层改动按 `.agents/skills/wotb-sync/SKILL.md`。真实代码始终是 source of truth，发现文档漂移时必须在同一次改动里修正文档。

---

## 文档地图

| 文档 | 作用 | 何时读 |
|---|---|---|
| `docs/DEVELOPER_GUIDE.md` | 开发入口、环境、结构、架构约束 | 最先 |
| `.agents/AGENTS.md` | 仓库级硬约定 | 动手前必读 |
| `frontend/AGENTS.md` / `java/AGENTS.md` 等 | 目录级约束 | 进入对应目录时 |
| `.agents/skills/wotb-sync/SKILL.md` | 跨层改动检查单 | 增删列、改解析、导出、前端时 |
| `java/README.md` | Java/Web 运行、接口、构建 | 跑后端时 |
| `docs/README.md` | 全部专题文档索引 | 查专项设计时 |

---

## 环境与工具链

- **JDK 21** 必需。Maven 必须带 `-s java/settings.xml`；容器构建使用 `java/settings-docker.xml`。
- **Node 24**：`frontend/.nvmrc` 固定版本；安装依赖用 `npm ci`。
- **Python 3**：`common/python/update_tankopedia.py` 使用标准库从 BlitzKit 客户端定义同步车辆数据。
- 不要使用任何公司 token、凭据或基础设施。

常用命令：

```bash
# Java 全量测试
cd java && JAVA_HOME=<jdk21> mvn -s settings.xml test

# 前端测试 + 构建
cd frontend && npm ci && npm test && npm run build

# 本地完整开发环境
cd docker/online && docker compose up -d --build
```

后端没有“无数据库” profile。测试 Keycloak Admin 写操作时需要 `wotbtools-admin-api` 服务账号与 `KEYCLOAK_ADMIN_CLIENT_SECRET`。

Wargaming ASIA/EU/NA 登录与百场 WG 官方认证需要 Keycloak 和 backend 同时获得相同 `WG_APPLICATION_ID`。缺失时服务仍应启动，只让相应 WG 能力稳定不可用；百场人工截图 + 5 replay 流程不得受影响。

真实回放 CI fixture 位于 `common/fixtures/replays/*.wotbreplay`；本地可用 gitignored `common/data/*.wotbreplay` 扩展样本。

---

## 硬性约定

- **改动即更新文档**：影响界面、导出、数据、构建或用法的改动，同一次提交更新相关文档。
- **API 纯英文**：DTO 返回 raw enum、稳定 `code/error` 和数据，不返回本地化 `*Label/message`。
- **显示名分两类出口**：前端三语 locale + Excel 导出中文标签；改列必须同步两边。
- **单一数据源**：车辆库为 `common/tankopedia-tier{7,8,9,10}.json`，地图名为 `common/map_names.json`；禁止模块内复制一份。
- 不引入 Lombok；record 用于不可变模型；Controller 只处理 HTTP，业务逻辑进入 service/core。
- 跨层联动必须执行 `wotb-sync`。
- **UI Profile（展示风格，非主题）**：`showcase`（沉浸，默认）/ `classic`（简约）是 Presentation Profile，共用同一套业务组件/状态/API；Classic 只通过 `frontend/src/styles/classic-profile.css`（`[data-ui-profile="classic"]`）去掉全屏 AI/装饰背景与视觉噪音，不改结构/密度/布局。业务组件不得按 Profile fork，禁止 `:key="uiProfile"` 触发组件重建。详见 `frontend/AGENTS.md` 与 `docs/current-plan.md` D1/D2。

---

## 仓库结构

```text
.
├── common/                     # 共享车辆/地图/资产/回放 fixture
├── java/                       # Java Maven 根：wotb-core + wotb-web
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
 wotb-web
 controller → service → mapper → dto
       ↓
 Vue SPA
```

核心原则：Preview、Export、League、AI/重建消费同一套权威 replay facts，禁止为了某个 UI/导出再造第二套解析/评分公式。

主要业务域：

- `replay`：Processing Job、Export Job、Battle Reconstruction、AI Review。
- `hof`：单场名人堂。
- `hundred`：百场名人堂（MANUAL + WARGAMING_API）。
- `mark3`：Tier X 单车最速三环人工审核排行榜（PENDING/CURRENT/REJECTED/CANCELLED/DELETED，无 SUPERSEDED）。
- `user`：Profile、WoTB 账号、Notification。
- `boost`：陪练/打手业务。
- `admin`：用户和后台管理。

### Replay Processing

Processing Job 创建后持久化输入，source 任务提交给全局 `ReplayParseScheduler`
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

训练房 `arenaBonusType=2` 与联赛/锦标赛 `=4` 才启用 0–1000 League Rating。普通回放不显示 Rating；混合普通 + League 批次 League Rating 不聚合（`league=null` + `leagueUnavailableCode=MIXED_LEAGUE_AND_STANDARD_REPLAYS`，battles 仍按普通回放语义成功返回，plan §21）。评分、完整性校验、批次中位数和 Excel 必须复用 core 单一公式。

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

- MANUAL：截图 + 5 个 replay，管理员审核。
- WARGAMING_API：只接受可信 ASIA/EU/NA WG 身份；账号总场次 >=5000、目标车 >=100；官方精确场均 <=3900 自动 CURRENT，>3900 创建无文件 PENDING。
- 首次 WG 登录可直接提交：服务端先同步 Profile，再做 JWT ↔ Profile ↔ WG 官方响应交叉校验。
- 管理员只能通过、拒绝或删除，不能改写成绩。
- 管理员百场摘要列表只展示认证值：WG 使用冻结官方快照，MANUAL 使用通过后的值；申报值仅在详情保留。

三环域只走人工审核：1–2 张截图、5 个已验证 replay，按 approved battleCount 升序 competition rank；CURRENT 不可替换，REJECTED/CANCELLED/DELETED 可重提。三环 replay 解析通过共享 `ReplayCapacityLimiter`，容量满沿用 `REPLAY_BUSY`。

详细契约见 `docs/features/hall-of-fame.md`。

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

### Replay Workspace

`?view=replay` 是统一回放工作台。选择 replay 后提供三个并列一级能力：

1. **解析预览**：支持批量。
2. **战局回放**：单场能力。
3. **AI 复盘**：单场能力。

规则：

- 单文件：AI/Playback 可直接进入，不要求先看赛果。
- 多文件：必须显式选择目标 replay；禁止默认/fallback 第一场。
- 目标 replay 被删除后选择立即失效，不得改指其它文件。
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
- `?view=reconstruction`：AI 复盘 / 地图 / 战局回放 workspace。
- `?view=version`：版本历史。
- `?view=contact`：联系页。
- `?view=rating-docs`：League Rating V5 算法说明页（构建期以 `?raw` 读取
  `docs/WotBTools_League_Rating_V5.md`，canonical 单一事实源；ReplayPage League 模式
  「算法说明」按钮跳转进入，返回时经 KeepAlive 保留解析状态）。
- `?view=playback-qa`：隐藏 QA 页（admin）。
- `?view=rating-v2`：隐藏历史 Rating V2 灰度页（仅 `wotbtools-admin`，只读 READY Processing Job）。

旧 `?view=leaderboard` canonicalize 到 `hof`，旧 `?view=extended` canonicalize 到 `replay`。

### AI Review / Battle Playback

主入口在 `?view=replay` 的 Battle Workspace：`ReplayPage` 下半部分原地切换「解析结果 / AI 复盘 / 战局回放」三个面板（`v-show` 保持状态，不跨视图跳转）。`AiReviewPanel`（SSE 分析流 + 结果）与 `BattlePlaybackPanel`（`/api/replay/map-overview` + MapOverview）是单一事实源实现；独立深链 `?view=reconstruction` 由 `ReconstructionPage` 登录门控后组合同一对面板。Tier X 车型图位于 `src/assets/tank-portraits/tier-x/<tankId>.webp`，由 BlitzKit 确定性生成，production 不访问 BlitzKit。

地图鸟瞰/战局回放契约见 `docs/features/battle-playback.md`；AI 双 Call、Team Review、Evidence/Validator 契约见 `docs/architecture/ai-review.md` 与 `docs/features/team-ai-review.md`。

---

## Wargaming 登录与 WoTB 账号

每个 Keycloak 用户都有 `region`：`CN/ASIA/EU/NA`。

WG broker 身份以 `wg:{region}:{account_id}` 隔离区服；`account_id` 必须来自 WG 服务端 token prolongate 响应，浏览器回调提供的 accountId/nickname/expiresAt 只能做一致性检查，不能作为信任源。

JWT mapper 提供 `wotb_region / wotb_account_id / wotb_nickname / wotb_verified`。WG Profile 为只读来源；Profile 不存在时 `PUT /api/users/wotb-account/from-login` 可以原子创建/同步 WARGAMING 资料。

`WG_APPLICATION_ID` 同时注入 Keycloak 和 backend：前者用于 WG IdP，后者用于百场官方 account/info + tanks/stats。

IdP 部署步骤见 `docs/auth/wargaming-asia-deployment.md`。

---

## i18n / DTO 约定

API 只输出稳定英文 key/enum。前端 `player_labels` / `agg_labels` 渲染三语；Excel 继续使用中文表头。新增任何 `code/error/warningCode` 必须同步三语 `api_codes/api_errors`。

站内通知保存 `type + payload`，boost domain 只通过 `UserNotificationService` 写事件；显示文案由前端 locale composition 负责。

---

## CI/CD 与生产部署

主流水线在 `.github/workflows/deploy.yml`。生产发布原则：

1. 后端 Maven、前端 Vitest/Vite build 先通过。
2. 每次部署统一构建 backend/frontend/keycloak 三个 `sha-<SHA>` 镜像；生产 compose 钉 SHA，不依赖 `latest`。
3. 新 compose 先写 `docker-compose.next.yml` 并 pull；成功后才替换正式 compose。
4. 部署后检查 backend `/api/health`、前端 nginx E2E、Keycloak realm。
5. 健康检查失败自动恢复 `docker-compose.prev.yml` 并再次验证。
6. 镜像 prune 只允许在成功部署或成功回滚后执行。

Deploy 与 database backup 共用 `production-maintenance` concurrency，`cancel-in-progress: false`。

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
- Keycloak Admin API 通过 `KeycloakAdminUserService` 封装后 mock。
- **架构测试（ArchUnit）**：`wotb-core` 与 `wotb-web` 各含 `*ArchitectureTest`
  （`com.wotb.core.architecture` / `com.wotb.web.architecture`），随 `mvn test` 自动执行；
  守护模块边界（core 禁 Spring Web/Boot 与反向依赖 web、web domain 分包与分层、
  禁字段注入/Lombok、顶层包无循环依赖）。规则失败即构建失败。
- 前端：Vitest + happy-dom（按需声明）。
- Replay/League/UI regression 必须补针对真实 invariant 的测试，而不是只验证函数被调用。

```bash
cd java && mvn -s settings.xml test
cd frontend && npm test && npm run build
```

涉及 Docker/部署时同时跑对应 Docker build 与 deployment smoke。

---

## 专题文档

| 主题 | 文档 |
|---|---|
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
