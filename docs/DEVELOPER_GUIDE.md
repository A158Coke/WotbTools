# Developer Guide

> 动手前先读这一份。维护者与 AI 都适用。

本文件回答「今天如何开发 WotbTools」：环境、仓库结构、模块边界、契约、测试、CI/CD 与部署入口。产品/业务语义、算法与审核规则由专题文档拥有；本文件只保留开发入口与跨层不变量，并链接到对应权威。

---

## ✦ 给接手的一句话

WotbTools 是 WoT Blitz `.wotbreplay` 回放分析工具集：Java 25 + Spring Boot 4 业务与 AI 服务、Vue 3 Web/Android 客户端、上游 Rust/WASM 回放引擎、Keycloak + PostgreSQL。

动手前读 [`.agents/AGENTS.md`](../.agents/AGENTS.md)、当前目录的 `AGENTS.md` 和本文件；跨层改动按 [`.agents/skills/wotb-sync/SKILL.md`](../.agents/skills/wotb-sync/SKILL.md)。真实代码是 source of truth，发现文档漂移时必须在同一次改动里修正文档。

固定接手方法（入口阅读 → 现实审计 → 任务分类 → 计划契约 → Reuse / SSOT 执行 → 分层验证 → 收尾交接）以 [`.agents/AGENTS.md`](../.agents/AGENTS.md) 的「接手与调整方法」为准。

---

## 文档地图

| 文档 | 作用 | 何时读 |
|---|---|---|
| `docs/DEVELOPER_GUIDE.md` | 开发入口、环境、结构、架构约束 | 最先 |
| [`docs/README.md`](README.md) | 全部专题文档索引 | 查专项设计时 |
| [`.agents/AGENTS.md`](../.agents/AGENTS.md) | 仓库级硬约定、接手与调整固定流程 | 动手前必读 |
| [`frontend/AGENTS.md`](../frontend/AGENTS.md) / [`java/AGENTS.md`](../java/AGENTS.md) 等 | 目录级约束 | 进入对应目录时 |
| [`.agents/skills/wotb-sync/SKILL.md`](../.agents/skills/wotb-sync/SKILL.md) | 跨层改动检查单 | 增删列、改解析、导出、前端时 |
| [`java/README.md`](../java/README.md) | Java/Web 运行、接口、构建 | 跑后端时 |
| [`docs/development/contribution-map.md`](development/contribution-map.md) | 新功能/接口/页面落点 | 判断贡献点归属时 |

产品/能力演进见 [`HISTORY.md`](../HISTORY.md)，技术/架构演进见 [`architecture/TECHNICAL_EVOLUTION.md`](architecture/TECHNICAL_EVOLUTION.md)；两者是历史，不是当前契约。

---

## 环境与工具链

- **JDK 25** 必需。Maven 必须显式使用 settings 文件：在 `java/` 下为 `-s settings.xml`，仓库根为 `-s java/settings.xml`；容器构建使用 `java/settings-docker.xml`。
- **Node 24**：`frontend/.nvmrc` 固定版本；安装依赖用 `npm ci`。前端使用 TypeScript 与 `vue-tsc` 做独立类型检查；源码中 JavaScript 与 TypeScript 共存，新代码跟随所在模块的现有约定。
- **Python 3**：`common/python/update_tankopedia.py` 使用标准库从 BlitzKit 客户端定义同步车辆数据。
- 不要使用任何公司 token、凭据或基础设施。

常用命令：

```bash
# Java 分层测试
# 以下 Maven 命令均从 java/ 执行，并使用 -s settings.xml。
# Targeted（改单个 class/function）：mvn -s settings.xml -pl wotb-core -Dtest=<TestClass> test
# Module（单模块/一个 feature）：mvn -s settings.xml -pl wotb-core test 或 mvn -s settings.xml -pl wotb-web -am test
# Full（PR CI authoritative validation，Agent 默认不跑）：cd java && JAVA_HOME=<jdk25> mvn -s settings.xml test
# JAVA_HOME 指向 JDK 25 安装目录（主工程 JDK 25；只有 keycloak provider 子工程用 JDK 21）。
# 注意：wotb-ai 的真实外部 AI probe 标记为 ai-live，默认被 Surefire 排除；不要仅因环境存在 AI_API_KEY 就解除排除。

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
本机全功能联调（Agent 引擎产物、资产服务、认证门禁、自检探针）以 [`frontend/local-testing.md`](frontend/local-testing.md) 为准；仓库不提供本地完整 Docker Compose 开发环境。上述 smoke 不访问 production COS state，也不要求 production secrets。

Wargaming ASIA/EU/NA 登录使用 Keycloak 的 `WG_APPLICATION_ID`；backend 不需要该配置。账号绑定与验证行为见 [`features/user-profile.md`](features/user-profile.md)。

真实回放 CI fixture 位于 `common/fixtures/replays/*.wotbreplay`；本地可用 gitignored `common/data/*.wotbreplay` 扩展样本。

---

## 硬性约定

- **改动即更新文档**：影响界面、导出、数据、构建或用法的改动，同一次提交更新相关文档。
- **API 纯英文**：成功 DTO 返回 raw enum 与数据；失败返回 canonical `ApiErrorResponse`（唯一错误 `id`、稳定 `errorCode`、可选 `errorMsg`、status、retryable、details、timestamp），不返回本地化 `*Label/message` 或 exception message。完整契约见 [`api/error-contract.md`](api/error-contract.md)。
- **HTTP Contract First**：FE ↔ BE 的序列化契约以 [`contracts/http/openapi.yaml`](../contracts/http/openapi.yaml) 为唯一事实源；前端 generated transport、Ajv runtime schema 与 fixture 由它生成/校验。修改 HTTP shape 时按 [`architecture/http-contracts.md`](architecture/http-contracts.md) 的顺序执行，不让 Java domain enum 或 Vue view model 直接泄漏到 wire。
- **显示名分两类出口**：前端三语 locale + Excel 导出中文标签；改列必须同步两边。
- **单一数据源**：车辆库为 `common/tankopedia-tier{1..10}.json`，地图名为 `common/map_names.json`；禁止模块内复制一份。坦克百科搜索别名 `common/tank_aliases.json` 是独立的**搜索 metadata**（开发者审校维护，允许有来源记录的客户端名称批量导入；稀疏存储、只扩搜索召回，不参与车辆身份与显示名）；按任意 `tank_id` 离线校验/查询用生成的完整名册 `common/tank_ids.json`（全 tier，只有 id ↔ 名字，不是属性来源）。两者契约见 [`architecture/tankopedia-reference-data.md`](architecture/tankopedia-reference-data.md)。
- 不引入 Lombok；record 用于不可变模型；Controller 只处理 HTTP，业务逻辑进入 service/core。
- 跨层联动必须执行 `wotb-sync`。
- **UI Profile（展示风格）**：`showcase`（深色，默认）/ `classic`（浅色）共用同一套业务组件、布局、状态与 API；`auto` 偏好按系统深浅色解析到其中一种。共享外壳和业务页面使用语义 token，Classic 在 `frontend/src/styles/classic-profile.css` 中提供浅色映射。业务组件不得按 Profile fork，禁止 `:key="uiProfile"` 触发组件重建。详见 [`frontend/ui-system.md`](frontend/ui-system.md)。

---

## 仓库结构

```text
.
├── android/                    # GeckoView APK、Native bridge 与发布辅助
├── common/                     # 共享车辆/地图/资产/回放 fixture
├── contracts/                  # FE ↔ BE HTTP OpenAPI、Agent、Android bridge 契约
├── docker/                     # backend/frontend/keycloak/ai-service 镜像与 Keycloak 主题
├── deploy/                     # production compose/nginx/备份、回滚与部署脚本
├── docs/                       # 当前状态文档、专题契约与 research 证据
├── frontend/                   # Vue 3 SPA；src/replay-local 为本机解析/计算/导出
├── infra/                      # OpenTofu roots 与 Komodo 声明式资源
├── java/                       # Java Maven 根：wotb-core、wotb-ai、wotb-web
├── keycloak-*-provider/        # 自定义 Keycloak IdP / session SPI
├── map-semanticizer/           # 地图语义化独立工具
├── scripts/                    # Agent WASM、CI 与发布辅助脚本
└── .agents/                    # Agent 规则与 skills
```

`frontend/` 的主要目录：`src/app/`（视图注册、导航、路由）、`src/components/`、`src/composables/`、`src/api/`（transport 与 generated）、`src/replay-local/`（WASM 解析、批次计算、导出、2D/AI 投影）、`src/styles/`、`src/locales/`。Java 按 domain 分包，入口见 [`java/README.md`](../java/README.md)。

### HTTP Contract workflow

HTTP shape 变更遵循 `OpenAPI → generated FE transport → backend mapper/serialization → runtime validation → contract tests → affected tests → PR CI`。在 `frontend/` 使用 `npm run api:lint`、`npm run api:generate`、`npm run api:check`、`npm run api:fixture`；生成文件位于 `frontend/src/api/generated/`，不可手改。Playback 数据由客户端投影并使用同一 generated schema 校验；HTTP status 依具体 endpoint 契约解释，本地 Playback unavailable 与 schema violation 必须区分。完整边界与兼容规则见 [`architecture/http-contracts.md`](architecture/http-contracts.md)。

### PR CI 与 owner 路由

`.github/workflows/ci-gate.yml` 是唯一 PR 入口：校验 PR/base/head SHA 身份，用 `dorny/paths-filter` 将变更映射到 owner，调用相应 reusable CI workflow，最后由稳定的 `CI / Required Gate` 汇总。未受影响的 owner 跳过；五个 OpenTofu root 只在各自 owner 受影响时验证。PR trigger 不设置 paths，确保 required check 始终产生。PR CI 不接触 production credentials、host、state 或 authenticated plan。

三个数据更新 workflow 在创建/更新 PR 时分别执行来源数据的真实同步与验证，再 dispatch CI 验证精确 open PR head。生产发布继续由 service owner workflow 的原生路径规则独立触发。

[`ci-owner-paths.yml`](../.github/ci-owner-paths.yml) 是 PR 路由表；生产 owner workflow 的 `on.push.paths` 与 `PRODUCTION_INPUT_PATHS` 必须逐项相同。共享输入按真实依赖 fan-out，未列出的普通文档变更只执行 PR gate。下表是维护边界索引，具体路径以 workflow 为准；完整 owner 清单与运行时不变量见 [`.github/AGENTS.md`](../.github/AGENTS.md)。

| Owner | Source / shared inputs | Runtime inputs | PR validation | OpenTofu root | Production workflow |
|---|---|---|---|---|---|
| Business API | Java web/core modules、HTTP contract、shared common data | business-api image、TX Compose、dependency readiness | Maven、HTTP contract | — | `business-api.yml` |
| AI Service | `java/wotb-ai`、shared core | GHCR image、Yecao Compose、TX ingress `/api/ai/**` 反代（不重写 path）、WireGuard readiness | Maven、AI image build、Compose | — | `ai-service.yml` |
| Frontend | Vue、HTTP contract、shared assets/map/tier data | frontend image、nginx、TX Compose | typecheck、unit/browser、bundle | — | `frontend.yml` |
| Keycloak | QQ/Wargaming/session providers、Keycloak image | realm runtime、TX Compose | provider/runtime、Tofu | `keycloak` | `keycloak.yml` |
| Android | Android source、native bridge、release helpers | APK release | JVM/assemble、bridge/version | — | `android-release.yml` |
| Business PostgreSQL | root config、backup/restore | TX Compose、local state | disposable PostgreSQL、Tofu | `postgres-business` | `business-postgres.yml` |
| Keycloak PostgreSQL | root config、backup | TX Compose、local state | backup safety、Tofu | `postgres-keycloak` | `keycloak-postgres.yml` |
| Observability | Prometheus/Loki/Alloy/Grafana config | Yecao Compose、local state | config/runtime、Tofu | `grafana` | `observability.yml` |
| Caddy / TX Alloy | gateway / TX shipper config | TX Compose | config validation | — | `caddy.yml` / `alloy-tx.yml` |
| Komodo 控制平面 | Core/Mongo Compose、plan guard | Yecao Core/Mongo runtime、`/opt/komodo` local state、DNSPod | Compose 契约、Tofu validation | `komodo` | `komodo-controller.yml` |
| Komodo Periphery (Yecao / TX1 / TX2) | pinned release manifest、每宿主 target profile、共享 config/unit | 各宿主 `/usr/local/bin/periphery`、`/etc/komodo`、systemd unit；Yecao `/opt/periphery`、TX1 `/opt/wotb-tx/periphery`、TX2 `/opt/wotb-tx2/periphery` 暂存 | release/config/unit/target 契约、onboarding 生命周期与 lock fixture | — | `komodo-periphery.yml` |
| Komodo 声明式资源 | `infra/komodo/resources/**` 的 ResourceSync 与 Server 期望状态 | Komodo 控制面（只由人工在 UI apply，CI 不 apply） | `scripts/ci/test-komodo-resources.py`（tomllib 结构契约） | — | —（仅 deployment PR gate） |
| Deployment / Python | shared deploy policy / common Python tools | shared scripts | contract smokes / unit tests | — | — |

另有 `frontend-replica.yml`、`production-worker.yml`、`asset-origin.yml`、`tx-runtime-check.yml`、`database-backup.yml`、`cleanup-images.yml`、`prod-diagnostics.yml` 与 `android-offload-probe.yml` 等独立发布、运维与诊断入口，职责见 `.github/AGENTS.md`。

---

## 后端架构速览

**服务器没有 parser。** 回放解析与对解析结果的一切计算都在客户端（见下方「客户端 Replay Engine」与 [`architecture/replay-pipeline.md`](architecture/replay-pipeline.md)）；服务端只负责存储、去重键、授权、名人堂记录与 AI 编排。

```text
 wotb-core     model（Battle / PlayerResult 事实形状）/ ref（Tankopedia）/ util /
               replay/{event,facts,feature,evidence,map,processing,reconstruction,timeline}（AI 复盘的客户端投影解码与分析）
       ↓
 wotb-ai       独立 ai-service（AI 复盘，消费客户端投影）
 wotb-web      single Spring Boot composition root：controller → feature service → mapper → dto
       ↓
 Vue SPA（frontend/src/replay-local：WASM 解析 + 批次计算 + 导出 + 2D 数据）
```

API 错误由 `GlobalExceptionHandler` 与 Security 的 canonical entry point/access-denied handler 汇合到同一 envelope。新后端异常使用 `ApiException(id, ApiErrorCode enum, errorMsg)`；响应携带唯一错误 `id`（写入安全日志，可用 `id=<value>` 检索到同一异常/请求），可选 `errorMsg` 为安全诊断。前端 transport 统一经 `ApiError` parser，`errorCode -> i18n` 本地展示错误并显示 `id` 诊断 ID，Retry 由 `retryable` 决定。新增码必须同步 [`api/error-contract.md`](api/error-contract.md)、后端测试与 zh/en/ru locale。

主要业务域：

- `hof` / `hundred` / `mark3`：单场名人堂、百场名人堂、Tier X 三环排行榜；提交事实由浏览器本机解析，原始回放作为证据附件，服务端只做结构校验与持久化权限控制。当前规则与删除语义见 [`features/hall-of-fame.md`](features/hall-of-fame.md)。
- `user`：个人主页、WoTB 账号绑定与「用回放验证」；契约见 [`features/user-profile.md`](features/user-profile.md)。
- `admin`：用户与名人堂治理（查看/搜索/删除/审计），不是数据编辑器；见下方 Admin 边界与 [`auth/keycloak-admin-user-search.md`](auth/keycloak-admin-user-search.md)。
- `creator`：bilibili UP/优秀作品共用五表目录，按类型隔离分类和 UID/BV 标识；统一 recommendations API、服务和事务锁；管理使用 `content-admin`。契约见 [`features/bilibili-creators.md`](features/bilibili-creators.md)。
- `tournament`：按年份/区服/季赛配置积分规则、截图排名的共享草稿、CSV 整表替换、正式榜单、修正与审计；同域 `Broadcast*` 管理五服联赛直播目录。契约见 [`features/tournament-points.md`](features/tournament-points.md) 与 [`features/league-broadcasts.md`](features/league-broadcasts.md)。
- `replay`：只剩 `/api/health` 与名人堂共用的 `ReplayCapacityLimiter`。

### 客户端 Replay Engine

`.wotbreplay` 的唯一解析器是上游 [fanypcd/WoT-Blitz-Agent](https://github.com/fanypcd/WoT-Blitz-Agent) 的 Rust Core（作者同为 WotbTools 贡献者，可以直接改上游、发版）。本仓库**不维护第二份解析器**，服务端也不解析回放。

- **产物锁定（content-addressed）**：`deploy/agent/source.json` 是 Agent identity 的**唯一来源**（`ref` = 上游完整 commit，`artifact.release` = Release tag，`artifact.sha256` = 附件校验）。`scripts/fetch-agent-wasm.sh` 下载 Release 附件、校验 sha256 与产物自带 `fingerprint.json` 后落位到 `common/assets/wasm/<ref>/`；`scripts/build-agent-wasm.sh` 是按源码自建的后备路径，产出同一形状。落位目录名就是 URL identity：运行期加载 `/wasm/<ref>/wotb_replay_wasm.js`（wrapper 从同目录取 `_bg.wasm`），**stable `/wasm/wotb_replay_wasm.js` 必须不存在且由测试/构建/发布三处断言**。`frontend/vite.config.js:agentWasmIdentity()` 在 build 时把 `ref`/`release` 注入 `__AGENT_WASM_COMMIT__` / `__AGENT_WASM_RELEASE__`，装载器据此拼 URL 并先校验 fingerprint，不一致抛 `AgentWasmVersionMismatchError`（fail closed，UI 提示刷新）。缓存失效靠 URL identity，`/wasm/<40 位 commit>/` 因此是长期 `immutable`。CI（`ci-frontend.yml`）与发布（`frontend.yml`）执行同一校验；细节见 [`architecture/replay-pipeline.md`](architecture/replay-pipeline.md)「Agent 产物身份」。
- **消费契约**：`contracts/agent/replay-facets-v2.md`。四个独立的 WASM 入口：`parseResult`（结算，毫秒级，适合批量与 HoF 投影；可选 `tankNamesJson` 注入车型名）、`parsePlayback`（时序与花名册；可选 `tankNamesJson`）、`parseShotReplays`（射击复现；可选俯仰锚定表与弹种反解表）、`parseAiReview`（AI 事件数据）。前端唯一装载与校验边界是 `frontend/src/api/agent-replay-facets.ts`。
- **独立炮塔**：可选 `PlaybackData.detached_turrets` 由上游 class-8 实体初始化和 Type10 产出权威 owner、AoI 区间及完整三轴位姿。本仓只校验和呈现：原模型炮塔/炮管以枢轴重心化，独立世界位姿按回放时钟插值；缺字段保持旧行为，不按 HP 推断，也不增加二进制解析器。当前正式 pin 为上游 v0.4.9（`deploy/agent/source.json`），见 [`features/battle-playback.md`](features/battle-playback.md)。
- **消费方**：回放工作台（数据 / 导出 / 2D 回放 / 3D 回放 / 射击分析 / AI 复盘五能力同一工作台）、装甲查看器、名人堂 / 百场 / 三环提交、个人主页账号验证、Android（APK 自带 GeckoView 运行同一套前端）。五个 Replay capability 对匿名、普通用户与管理员永久可见：数据 / 2D 匿名可用，个人回放的 3D / 射击分析与复现 / AI 登录后使用；已验证的官方示例开放匿名 3D/射击；admin role 不改变工作台能力。装甲查看器匿名可用（Tankopedia 详情入口卡对全员开放），OIDC 返回仍保留完整 scene query。详见 [`frontend/replay-workspace.md`](frontend/replay-workspace.md)。
- **一致性基线**：`frontend/src/replay-local/__golden__/` 固定客户端全链路的逐字段输出，CI 常驻断言解析/批次计算/导出/2D 投影与 golden 一致（2D 时序按文档化容差）；上游升级后重新导出 `wasm-*` 再跑同一组测试。
- **缺字段**：一律向上游要（改上游 → 发版 → 升级 `source.json`），不在客户端启发式推导，也不在服务端解析。

### 业务域权威

业务规则不在这里复制，按域读对应文档：

| 主题 | 权威文档 |
|---|---|
| League Rating（适用范围、完整性门槛、七维公式、V6 批次汇总与导出） | [`features/league-rating.md`](features/league-rating.md)、[`WotBTools_League_Rating_V6.md`](WotBTools_League_Rating_V6.md) |
| 名人堂 / 百场 / 三环（信任模型、审核门禁、归属、删除语义） | [`features/hall-of-fame.md`](features/hall-of-fame.md) |
| 账号绑定 / 解绑 / 用回放验证 | [`features/user-profile.md`](features/user-profile.md) |
| 积分赛规则、截图统计、CSV 导入与公开榜单 | [`features/tournament-points.md`](features/tournament-points.md) |
| 全服联赛直播目录、封面与初始化数据 | [`features/league-broadcasts.md`](features/league-broadcasts.md)、[`operations/league-broadcast-covers.md`](operations/league-broadcast-covers.md) |
| bilibili UP/优秀作品推荐与内容管理权限 | [`features/bilibili-creators.md`](features/bilibili-creators.md) |

League Rating 的适用范围、完整性门槛、公式、批次汇总与导出语义由 [`features/league-rating.md`](features/league-rating.md) 与 [`WotBTools_League_Rating_V6.md`](WotBTools_League_Rating_V6.md) 拥有。实现只在客户端 `frontend/src/replay-local/compute/` 与 `export/`；必须复用这一份，禁止为某个 UI 再造第二套。

名人堂/百场/三环的信任模型、审核门禁、归属与删除语义由 [`features/hall-of-fame.md`](features/hall-of-fame.md) 拥有。跨层不变量：提交事实由浏览器本机解析并以 `Battle` 形状上传，原始回放作为证据附件；服务端只做结构校验与持久化，不重新解析、不验证事实真实性；admin 只能审核/删除，不能改写 replay-derived facts。**归属身份分两种**：百场 / 三环使用 `(区服, WotB 游戏账号)`；单场 Hall of Fame 当前只按 `accountId` 查询/归属，没有 server 维度，跨区同号可能误关联（已知当前限制，见 feature doc）。

---

## 前端架构

新手引导与匿名官方示例见 [`features/onboarding.md`](features/onboarding.md)。AppShell 持有唯一 `useOnboarding`，Replay session 持有可信示例选择；真实页面通过 typed `ONBOARDING_KEY` 和稳定锚点参与。完成/跳过由当前用户 `GET/PUT /api/users/onboarding` 同步。

Replay Workspace 的 Data 批次分析与 2D/3D/Shots/AI 单场目标共享同一 selection；多文件先选首个有效 battle，`sourceId` 保留原始文件索引。布局所有权与浏览器验收矩阵见 [`frontend/replay-workspace.md`](frontend/replay-workspace.md)。

### UI Profile 与主题（showcase=dark, classic=light）

**`data-theme` 不是独立主题偏好，而是 UI Profile 唯一派生。**

- `showcase` → `data-ui-profile="showcase"` + `data-theme="dark"` + `color-scheme:dark`（默认）。
- `classic` → `data-ui-profile="classic"` + `data-theme="light"` + `color-scheme:light`；只改 Presentation 层，不改 layout/density/spacing/结构/业务组件。
- `frontend/index.html` 首屏内联脚本按 `wotb-ui-profile` 同时设置 `data-ui-profile` 与派生的 `data-theme`（无 FOUC）；`src/styles/tokens.css :root` 是 dark 基础视觉 token 单一事实源，Classic 由 `styles/classic-profile.css` 的 `html[data-ui-profile="classic"]` 覆盖浅色语义 token + namespace 覆盖（该文件必须最后导入）。
- 唯一持久化偏好 `wotb-ui-profile` 支持 `showcase` / `classic` / `auto`；`auto` 读取并监听 `prefers-color-scheme`。不保存独立主题状态，实际 Profile 与 `data-theme` 由 `useUiProfile` 派生。
- 手机顶栏高度使用 `--header-h`（48px，另加安全区）；平板/桌面使用左侧导航。旧 `--topbar-h` 只是兼容别名，不能作为独立布局 authority。
- Sponsor 页面使用 `/sponsor` Vue Router path，在共享 AppShell 中消费主题和三语 locale。

约定：`data-theme` 由 `useUiProfile.themeForProfile` 派生；禁止手工 set `data-theme` 或另立 theme 状态；禁止 `filter:invert` / 全局 opacity / `html *` / 双套业务组件 / `:key="uiProfile"` 触发重建。

### i18n

基础 locale：

```text
frontend/src/locales/zh.json
frontend/src/locales/en.json
frontend/src/locales/ru.json
```

按功能追加的消息使用 `feature-messages.json`、`tournament-messages.json`、`creator-messages.json`，由 `messages.js` 非破坏性 deep merge 基础 JSON。禁止在 `main.js` 或组件初始化阶段直接修改 imported locale 对象；已有 key（例如 `replay.processing_job.mixed_league_standard`）必须保留。语言持久化只使用 `localStorage('wotb-lang')`。

### Layout primitives

- `layout-content`：Profile / Settings / 普通内容。
- `layout-wide`：HoF / Rating / 数据页。
- `layout-data-workspace`：Replay Parser / 大表格。
- `layout-full-workspace`：Battle Reconstruction / Map / Strategy。

Replay/管理宽表必须保持高 information density；允许横向滚动，但不能因为页面容器过窄而制造无意义滚动。

全站使用统一页面标题、按钮、提示与表格样式；首页内容按正常文档流排列，更多页复用可滚动分段导航，文档页限制阅读宽度并允许代码/表格局部横滚。`showcase-regressions.css` 只保留既有布局 guard；共享外壳与回放样式在其后导入，`classic-profile.css` 最后提供 Profile 映射。新增规则应写入实际组件或样式 owner，避免继续叠加全局覆盖。

### Replay capabilities

`?view=replay` 专注批量解析、结果预览和汇总；`?view=battle-playback` 是同一工作台的 2D 模式，`?view=ai-review` 为 AI 复盘。工作台持有唯一一份文件选择与本机分析结果（`useReplaySession` + `useLocalReplayAnalysis`）：选择一次、分析一次，数据/导出/2D/3D/射击/AI 共用。

规则：

- 分析在本机进行（Worker 跑 WASM → 批次计算），匿名即可用、不等登录；失败只显示原因（引擎不可用 / 无有效回放 / 意外错误），不回退服务端。
- 2D 回放解析单场：单文件直接用；多文件须先在场次选择器选一场（`sourceId = r{文件序号}`）。
- 导出直接复用最近一次分析的批次结果，客户端生成 xlsx / zip，不重新解析。
- 解析后的 Aggregate/Summary 不代表某一场 battle；结果 toolbar 的 battle-level shortcut 只在具体 battle tab 出现。
- League 模式的汇总人数读取 `league.playerSummaries.length`；普通模式读取 `aggregate.length`。

### SPA views

`frontend/src/app/navigation.js` 是 view allowlist/query 契约，`viewRegistry.js` 是 view → 组件与 Replay 能力映射的唯一入口。主要入口：

- 回放工作台：`replay`、`battle-playback`、`ai-review`、`agent-replay`、`agent-shots` 共用 `ReplayWorkspace`，仅初始能力不同；坦克百科/装甲查看器为 `agent-tankopedia` / `agent-armor`。
- 业务页：`home`、`hof`、`tournament-points`（含 `tournament-points-config` / `tournament-points-admin`）、`league-broadcasts`、`recommendations` / `creators`（含 `recommended-videos` / `creators-config`）、`profile`、`admin-users`、`hof-admin`。
- 信息页：`history` 渲染仓库根 `HISTORY.md`；`technical-evolution` 渲染技术演进；`rating-docs` 构建期以 `?raw` 读取 [`WotBTools_League_Rating_V6.md`](WotBTools_League_Rating_V6.md)（canonical 单一事实源，ReplayPage League 模式「算法说明」跳转进入，返回时经 KeepAlive 保留解析状态）；`contact`、`android`、`sponsor`、`more`。

旧 view alias：`leaderboard → hof`、`extended → replay`、`reconstruction → battle-playback`；未知 view 回落到默认视图。

Web 登录回程先由 `useAuth` / keycloak-js 处理，再动态加载 Router：启动入口仅判断 query/fragment 是否同时存在 `state` 和 `code` / `error`，不自行校验或信任其值。认证落定后才构造 history、转换旧 view，避免重定向丢掉原回调或 Router 留下已消费的认证参数。生产 SDK 仍使用默认 fragment 模式；query 形状检测只是保守等待，不代表新增 query-mode 支持。失败 / 12s watchdog 后正常挂载原有失败恢复界面；普通访问与 APK 不等待此 Web 回程路径。回归入口为 `frontend/src/main.test.js`、`frontend/src/App.test.js`；职责详见 [`frontend/architecture.md`](frontend/architecture.md)。

### AI Review / Battle Playback

`ReplayWorkspace` 是回放**五种能力**（数据 / 2D 回放 / 3D 回放 / 射击分析 / AI 复盘）的唯一统一载体：这些能力不是各自独立页面，深链只是能力入口（`app/viewRegistry.js` 的 `replayInitialCapability` 解析深链初始能力，`ReplayWorkspace.vue` 的 `viewFor` 为能力切换选择路由）。它通过唯一 `useReplay` 组合并消费 `useReplaySession` 持有的 selection / 分析状态 / 结果，分析生命周期由 `useLocalReplayAnalysis` 持有（Worker 解析 → 批次计算 → 提交结果；选择变化/取消即作废在途分析）。能力切换不重新选文件、不重建 session；能力面板首次激活才挂载（`useMountedWhenActive`）并按需异步加载，切走只隐藏（3D 停帧不销毁）。Workspace 的标题、能力切换、批次与当前回放 selector 分别由 `PageHeader`、`ReplayCapabilityTabs`、`FileDrop`、`BattlePicker` 展示；这些子组件只接收派生状态并发出命令，session 仍是唯一 selection owner。`ReplayPage` 只作为 data 结果 tab 嵌入，渲染结果/列系统/Export/Drawer。

**匿名可用**：服务器没有 parser，分析全部在本机，数据分析与 2D 挂载即可用，不等 Keycloak init。个人回放的 3D、射击与 AI 有登录门禁；可信官方示例可匿名使用 3D/射击，AI 仍需登录。3D 与 AI 还须满足对应的联网可用性门禁；名人堂等写操作另行鉴权。
**能力解耦**：AI 与 Playback 不做跨 capability 状态 handoff；tab 切换经 Vue Router navigation 形成可 Back/Forward 的 history，返回时 selection/分析结果不丢，只恢复 activeCapability。
**车辆环线**：已有 WASM `parseResult.players[].gun_marks` → `battleFacts.gunMarks` → 单场 `gun_marks` 列/中文 Excel；缺失和非法保留未知。专用标志共用于数据表、手机卡片、详情、2D/3D 名册与车型标签，回放读取 owner 的 `LocalPlayback.result` 按账号匹配，generic HTTP dataset 不增加字段。实体重入的活动身份选择与场景共用 canonical 首次观测映射（LocalPlayback 内部 sidecar），按时间而非 eid 排序；环线 SVG 显式内联图集以保留 PNG 导出。成就不按玩家跨车汇总，不推断精确百分位或获得时刻；3D 炮管贴花暂未实现。详见 [`字段字典`](reference/replay-parsed-fields.md#车辆环线gun-marks)。
**2D 回放**：`BattlePlaybackPanel` 接收目标文件，本机 `parseLocalPlayback`（parseResult + parsePlayback + parseAiReview 伤害事件 → `BattlePlaybackDataset` + `MapOverview`）；多文件未选场次时给出明确提示。
**组件所有权**：Battle Playback 的页面编排保留在 `BattlePlayback.vue`；地图 SVG/标记/瞬时反馈与 canonical 2 秒轨迹由 `BattleMap.vue` 渲染，通用 HUD 由 `BattlePlaybackHud.vue` 渲染，播放控制与标注工具由 `PlaybackControls.vue`/`AnnotationToolbar.vue` 渲染。`PlaybackTimeline.vue` 是纯 seek bar，事件列表位于 `PlaybackSidePanel.vue` 并通过 root command 执行 seek + pause；当前车辆详情仍由 `VehicleDetailsPanel.vue` 渲染。车辆状态投影与时钟推进分别由 `utils/playbackVehicleState.ts`、`utils/playbackClock.ts` 提供纯函数，组件只负责把 canonical V2 数据转换为展示 props/commands。对应测试按 ownership 分层：地图/标记/手势、控制、时间线、详情面板及时钟/车辆投影各有 focused suite，共享 fixture 位于 testing-only `playbackTestHarness.js`；`BattlePlayback.test.js` 与 `BattlePlayback.integration.test.js` 只验证无法由单组件证明的跨组件协作与回归。

基地 runtime state、Assault/Supremacy 字段判据、2D/3D presentation 与地图语义契约见 [`features/battle-playback.md`](features/battle-playback.md)；AI 双 Call、Team Review、Evidence/Validator 契约见 [`architecture/ai-review.md`](architecture/ai-review.md) 与 [`features/team-ai-review.md`](features/team-ai-review.md)。

### Android runtime

APK 由自带 GeckoView 渲染同一套 Vue 产品，从固定 loopback `http://127.0.0.1:21653/index.html` 启动；Native `LocalRuntimeServer` 把 `/` 映射到 APK `assets/web/`。离线冷启动不等待更新 manifest；联网后 Native 最佳努力检查版本，已确认 mandatory update 仍阻断。

`src/platform/runtime.js` 只把 Android 业务 `/api/**` 与下载 metadata URL 解析为 `https://wotbtools.com`；Web 保持同源。Native Bearer 请求不发送 cookies，Caddy 对 exact 本机 origin（loopback 与 appassets）放行实际方法/headers，先响应匿名 OPTIONS。Android 远端 3D 资产固定使用 `/agent-assets/` 网关，本地 JS/WASM、2D 地图和射击参数快照始终从 APK 读取；Native 过期 token 无法离线刷新时保留 encrypted session，前端只清 API token，离线不会清 replay selection。

- **文件选择与目录导入**：Gecko file prompt 的系统 picker URI 先在后台复制到独立 private cache，整批成功后才确认本地文件给 Gecko（1h TTL）；`FileDrop` 按可选 Native bridge capability `replay-folder-picker` 使用 SAF `ACTION_OPEN_DOCUMENT_TREE`，取消、超限或读取失败保留当前回放，目录不触发自动分析，授权不持久化。未提供该 capability 的 APK 保留文件多选，普通 Web 使用 `webkitdirectory`。详见 [`Android 架构`](android/architecture.md)。
- **外部 replay 自动解析**：仅 Android external intent 触发——Native 以固定同源 `__native/replay-pending` stream 缓存字节，Web 构造 `File` 后替换 selection 并本机分析一次（完成后 data tab 展示结果，绝不自动启动 AI）。读取用 `X-Wotb-Pending-Id` 校验 metadata 与文件 identity；无 pending 404、identity 不匹配 409、读取失败 500，禁止网络 fallback，响应 no-store。ACK 边界是「本机分析已完成」，回放引擎装载失败不 ACK；pending metadata（1h TTL）持久化并跨 process death 恢复。认证不参与页面导航。生命周期与验收见 [`Android Replay Intent`](android/replay-intent.md#app-手动目录导入独立于-external-pending)。
- **资产**：Tier X 车型图位于 `frontend/src/assets/tank-portraits/tier-x/<tankId>.webp`，由 BlitzKit 确定性生成，production 不访问 BlitzKit；规则见 [`assets/tier-x-models/README.md`](assets/tier-x-models/README.md)。

发布与 Bridge 契约见 [`android/release-process.md`](android/release-process.md)；逐版本发布说明在 `docs/android/releases/`。

---

## 认证与用户

每个 Keycloak 用户都有 `region`：`CN/ASIA/EU/NA`。

WG broker 身份以 `wg:{region}:{account_id}` 隔离区服；`account_id` 必须来自 WG 服务端 token prolongate 响应，浏览器回调提供的 accountId/nickname/expiresAt 只能做一致性检查，不能作为信任源。

JWT mapper 提供 `wotb_region / wotb_account_id / wotb_nickname / wotb_verified`。WG Profile 为只读来源；Profile 不存在时 `PUT /api/users/wotb-account/from-login` 可以原子创建/同步 WARGAMING 资料。

`WG_APPLICATION_ID` 只注入 Keycloak 侧，用于 WG IdP；backend 不需要该配置。GitHub Secrets `WG_APPLICATION_ID` 是这份凭据的唯一来源，同时供 Keycloak runtime env（自定义 SPI）与 TX-local OpenTofu 的 `wargaming-asia`/`wargaming-eu`/`wargaming-na` IdP `client_id` 使用；不新增第二个 Wargaming 凭据。部署步骤见 [`auth/wargaming-asia-deployment.md`](auth/wargaming-asia-deployment.md)。

### 绑定账号的验证状态（`wotb_account_verified_at`）

`user_profile.wotb_account_verified_at` 的语义、绑定 / 解绑 / WG 登录同步 / 「用回放验证」的信任模型与错误码，见 [`features/user-profile.md`](features/user-profile.md)。本文件只保留实现入口：`UserProfileService`、`POST /api/users/wotb-account/verify-replay`、`ProfilePage.vue`。

### 身份两层与 profile self-heal

```text
Keycloak User  = 认证 / IAM 身份（谁登录了）
user_profile   = WotBTools 业务用户投影（这个人在业务上是谁）
```

稳态不变量：**每个活跃、已认证并成功进入 WotBTools 的用户都拥有 `user_profile`。** 实现方式是 **eventual self-healing**，不是跨系统强事务：

```text
Keycloak 认证成功
  → 进入 SPA（任意 view）
  → AppShell 触发 useBusinessUserBootstrap()
  → PUT /api/users/profile（幂等 ensure）
  → 已有 profile 原样返回；没有则按 canonical provisioning 创建
```

- **身份隔离**：全局 bootstrap 的缓存/在途请求按 `authEpoch` 作废；登出和直接切换账号均清理账户页旧投影，迟到成功/失败不得覆盖当前身份。
- **canonical owner 只有全局 bootstrap**（`frontend/src/composables/useBusinessUserBootstrap.js`）。页面只等待其结果，不得各自实现「读不到资料 → 自己创建」。
- **个人中心区分连通性与业务失败**：`whenBusinessUserSettled` 返回 false 时，`ACCOUNT_PROFILE` 不可用进入中性 connectivity 状态；仍可用则显示资料错误与显式重试，不停在 loading，也不自动循环重试。只有连通性不可用状态恢复可用时自动加载一次。真正调用 backend 前再次检查对应 capability；回放解析仍完全本地。
- **KC-only 是允许的临时状态**：broker 刚注册但浏览器还没回站、用户回站前关掉浏览器、bootstrap 暂时失败、legacy 数据、管理员手工建 KC user。任何 KC-only 用户下一次成功进入 WotBTools 都会被自动补齐。
- **不做强一致声明**：Keycloak 与业务 DB 之间没有分布式事务，也不在 Keycloak First Broker Login 里写业务库；provisioning 失败**不删除 Keycloak 用户**、**不回退认证状态**、**不永久缓存失败**（刷新/重新 bootstrap/页面重试都会重新 ensure）。
- **`PUT /api/users/profile` 是 ensure 而非 create**：已存在时不改写 `wotb_server` / `wotb_account_id` / `wotb_nickname` / `wotb_account_source` / `wotb_account_verified_at`。并发 ensure 靠唯一约束**按约束名**区分：`keycloak_user_id` 冲突（同一 sub 的并发创建）重读胜者并幂等成功；`(wotb_server, wotb_account_id)` 冲突是真实账号占用，仍返回 409 `WOTB_ACCOUNT_ALREADY_USED`，绝不吞掉。
- **Admin Users 仍以 KC 为权威**（`segment=keycloak` 默认）并显式暴露 `hasLocalProfile=false`，作为 IAM 清点与 legacy/不完整状态的观测能力；self-heal 不改变这一点。

**删除用户 ≠ 删除 HoF 记录**：HoF 数据属于 WotB 游戏账号（百场/三环为 `(区服, 账号)`，单场为 `account_id`），仓库中没有任何 FK 指向 `user_profile`（`on delete cascade` 只出现在 replay processing 权威状态的域内组合关系上）。因此**删除 Keycloak 用户必须走 WotBTools admin API**（`AdminUserService` 先删本地 profile 再删 Keycloak 用户）；绕过它直连 Keycloak 会留下孤儿 profile 并阻塞后续重绑，需用 Admin Users 的 `segment=local` 清理。

**Admin Users 列表（服务端分页 + 合并数据源）**：`GET /api/admin/users?query=&segment=&idpAlias=&page=0&size=25` 返回 `{items, page, size, totalItems, totalPages}`；`size` clamp 到 1..100，`page` 为 0-based。

| 参数 | 语义 |
|---|---|
| `segment=keycloak`（默认） | 权威源是 Keycloak realm users（Keycloak Admin API `first/max` 分页 + 权威 count），本地 profile 只按当前页做一次 IN 查询增强。没有任何本地 profile 的 Keycloak-only 用户也能被找到并删除；支持 `idpAlias` 过滤 |
| `segment=local` | 权威源是本地 `user_profile`（DB 分页 + 权威总数），用于暴露 Keycloak 侧已不存在的孤儿绑定（行上 `keycloakUserMissing=true`），删除它可释放 `(wotb_server, wotb_account_id)` 唯一槽位。传 `idpAlias` → 400 `IDP_FILTER_REQUIRES_KEYCLOAK_SEGMENT`；未知 segment → 400 `INVALID_USER_SEGMENT` |

两个 segment 都不做「拉一页再在内存里筛」的伪造分页。`segment=local` 的代价是每页产生 N（≤ size）次 Keycloak Admin 调用——Keycloak 没有按 ids 批量查询用户的能力；这是能力事实，见 [`auth/keycloak-admin-user-search.md`](auth/keycloak-admin-user-search.md)。

Admin DTO 在百场/三环的列表与详情携带 `wotbServer` + `wotbAccountId` 表示归属身份，避免把跨服同号看成同一个账号。`wotbServer` 的取值域是 `CN|ASIA|EU|NA`（DB CHECK 约束）。

**批量删除契约（三个域共用形状，partial success）**：每个目标跑在**独立事务**中（`TransactionTemplate`，禁止 `this.method()` 自调用绕过 Spring 代理），允许 partial success；单批去重后上限 100 → 400 `BULK_LIMIT_EXCEEDED`。用户批量删除的 `confirm` 缺失/false → 整批 400 `CONFIRMATION_REQUIRED`，且逐用户复用 `deleteOneInternal` 的全部业务保护（self-delete 保护、打手依赖阻断、先删本地 profile 再删 Keycloak、审计日志）。HoF 批量删除**逐条复用权威单条删除语义**：单场仍 hard delete（audit 快照 + 真删行 + commit 后引用计数清理物理文件），百场/三环仍 soft delete（仅 CURRENT 可删，`CURRENT` → `DELETED`）；非 CURRENT 逐条失败于 `HUNDRED_NOT_CURRENT` / `MARK3_NOT_CURRENT` 而不阻塞其他记录。百场/三环的 reason 是批次级参数，先整体校验一次（参数错误整批 400，不表现为逐条失败）。

当前 OpenAPI 覆盖 `GET/DELETE /api/admin/users`、单场/百场/三环的 bulk-delete 与 `AdminUserListItem` 等 schema；mark3 admin 列表/详情与单场 HoF admin 列表/详情仍未进入 OpenAPI。生成产物 `frontend/src/api/generated/*` 由 `npm run api:generate` 重建，禁止手改。

**Admin HoF 治理边界**：admin 是 governance，不是数据编辑器——`/api/admin/hof/**` 只做查看/搜索/筛选/下载/删除/审计，禁止人工修改 replay-derived authoritative facts。删除语义与 IAM≠HoF 不变量见 [`features/hall-of-fame.md`](features/hall-of-fame.md)。

Keycloak 登录页为 V8 Unified Theme（深色=Battlefield/浅色=Minimal、深色登录卡局部毛玻璃 dark-only、浅色无 blur、IdP 动态渲染、`registrationAllowed:false`）；主题文件在 `docker/keycloak/themes/wotbtools/login/`，仅覆盖 `template.ftl`（其余认证页经 `registrationLayout` 共享），生产 realm 需手动设 `loginTheme=wotbtools` 并关闭 Registration（见 [`auth/keycloak-login-theme.md`](auth/keycloak-login-theme.md)）。

---

## API / DTO / 权限约定

积分赛应用只检查 `tournament-admin`；全站 `wotbtools-admin` 由 Keycloak 复合角色继承此权限，前端入口、业务管理 API 和独立 AI 识别共用此权限边界；内容域管理使用独立的 `content-admin`（与积分赛 `tournament-admin` 完全分离）。该专属角色不授予其它管理权限，也不是默认角色。规则细节见 [`features/tournament-points.md`](features/tournament-points.md) 与 [`features/bilibili-creators.md`](features/bilibili-creators.md)。

API 只输出稳定英文 key/enum。前端 `player_labels` / `agg_labels` 渲染三语；Excel 继续使用中文表头。新增任何 `code/error/warningCode` 必须同步三语 `api_codes/api_errors`。

---

## CI/CD 与生产部署

生产由 GitHub Actions 的独立 owner workflow 驱动：每个服务只在自己的 `on.push.paths` 与 `PRODUCTION_INPUT_PATHS` 命中时部署；manual dispatch 必须指向 exact current `main`；`main` 是唯一目标状态。完整 workflow 职责与清单见 [`.github/AGENTS.md`](../.github/AGENTS.md)，owner 路由见 [`ci-owner-paths.yml`](../.github/ci-owner-paths.yml)。

### OpenTofu local state

五个 production root（`postgres-business`、`postgres-keycloak`、`keycloak`、`grafana`、`komodo`）的 authoritative state 固定在所属 owner 主机的持久目录；per-SHA staging 只承载 source，不能承载 state。PR 只做 validation：`tofu fmt -check`、`tofu init -backend=false`、`tofu validate` 与适用的本地 safety fixture；PR 不 SSH 生产宿主、不读取生产 state、不接收 host-local 生产凭据。需要 production-local provider 的 plan 只在对应 main-only service workflow 运行中产生；PR workflow 与 production apply 不共享 binary plan，main 始终重新 plan。Local state、plan、真实 tfvars 不得提交，provider lockfile 必须提交。

未 bootstrap 的 state 在 `init` 前被拒绝；adopted root 还需要 `bootstrap-complete` marker。正常 workflow 不会用空 state 初始化生产。具体路径、marker、adoption 与备份边界见 [`operations/opentofu-local-state.md`](operations/opentofu-local-state.md)。

Grafana dashboard root 管理 `deploy/observability/grafana/dashboards` 中的六个 dashboard；Prometheus/Loki datasource 由 file provisioning 管理。删除或替换必须通过 `infra/tofu/grafana/validate-plan.sh` 的 safety guard，认证仅使用 GitHub Actions secret `GRAFANA_PAT`。

### TX service plane 与运行时所有权

TX 运行时由独立 owner workflow 管理：Business API、Keycloak、Caddy 与两套 PostgreSQL 运行在 TX1；Frontend 为 TX1 + TX2 active-active（`10.20.0.1:8081` / `10.20.0.3:8081`，steady-state 权重 20/80，Caddy 在 TX1 健康检查两侧）；TX2 还承载 production-worker 主机前置条件；Yecao 承载 AI service、Observability stack、Komodo Core（WireGuard `10.20.0.2:9120`）与 Komodo MongoDB 持久控制面数据。唯一公网 HTTP/HTTPS 入口是 TX1 Caddy 80/443；固定 WireGuard 端口为 Business API app `10.20.0.1:8087` / management `10.20.0.1:8088`、Keycloak `10.20.0.1:8080`、Keycloak PostgreSQL `10.20.0.1:15432`、Business PostgreSQL `10.20.0.1:25432`。`TX_BACKEND_UPSTREAM` 等 logical endpoint 由 `deploy/tx/deploy.sh` 的 canonical validator 守护：staged deploy、dependency readiness 与 runtime gate 共用同一份 allowlist，declared 必须等于 active；公网 hostname、错误端口与未审核地址一律 fail closed。`KEYCLOAK_ISSUER_URI` 始终是公开 realm URL，不是 placement endpoint。

两套 PostgreSQL 完全独立，Compose 通过 `include` 使用各自 owner 文件，固定 project `deploy`；OpenTofu 只管理 database/role/grant，业务表由 Flyway 单一拥有；备份/恢复工具不交叉，Business 归档只能用 `business-postgres-restore.sh` 恢复到经确认的 disposable 库。完整端点矩阵、rollback 值、Keycloak/PostgreSQL 拓扑与验收见 [`operations/tx-service-plane.md`](operations/tx-service-plane.md)、[`operations/business-postgres.md`](operations/business-postgres.md)、[`auth/keycloak-tx-bootstrap.md`](auth/keycloak-tx-bootstrap.md)；Frontend active-active 见 [`operations/komodo-k7c-frontend-cutover.md`](operations/komodo-k7c-frontend-cutover.md)，TX2 主机前置条件见 [`operations/tx2-production-worker.md`](operations/tx2-production-worker.md)；state/bootstrap 见 [`operations/opentofu-local-state.md`](operations/opentofu-local-state.md)。

### 应用镜像与发布

- Business API 镜像采用 Spring Boot 默认四层（dependencies / spring-boot-loader / snapshot-dependencies / application），tools 提取后运行精简 `wotb-web.jar`；`ci-business-api.yml` 在一次性 PostgreSQL 下验证启动、readiness、`/api/health` 与 `BUILD_COMMIT`。
- `business-api.yml`、`frontend.yml`、`keycloak.yml` 与 `ai-service.yml` 分别拥有应用发布闭环。TX business-api/frontend 先 mirror exact GitHub SHA 到 Gitee，再在 TX 从该 SHA 构建并发布 immutable TCR tag，生产只消费 `repo@sha256:<digest>`（`TX_BUSINESS_API_IMAGE_REF` / `TX_FRONTEND_IMAGE_REF`），禁止 `latest` 回退。Keycloak 与 Yecao ai-service 保留各自 SHA tag + latest/freshness 契约。各应用的服务级 concurrency 会取消过期 main workflow。
- `frontend.yml` runner 只负责 release authority、Gitee mirror、下载校验 pinned Agent WASM/可选 Sponsor bundle 与 staging；不在 GitHub 构建 Frontend 镜像或上传 TCR 大镜像。`deploy/tx/build-frontend-from-gitee.sh` 复用持久 Gitee clone 与 host build lock，创建 exact-SHA worktree；镜像 identity 包含 source SHA、`ASSET_BASE_URL` 与 Sponsor bundle SHA256，existing immutable tag 先 pull digest 校验，缺失才 `docker build`。内容/BUILD_COMMIT/Agent/Sponsor 校验在 registry 写入前完成，发布后回读并 pull digest 再校验。
- `caddy.yml` 独立负责 TX 网关：staged 配置与 assets 校验后只 reconcile Caddy，并验证 trusted TLS、redirect、前端/API、Keycloak、auth asset 与 Komodo 路由；它不 build 应用镜像、不依赖数据库或 Keycloak admin credentials。
- `business-postgres.yml` / `keycloak-postgres.yml` / `observability.yml` 分别拥有两个 PostgreSQL 与 Yecao 观测运行时/Grafana root，各自执行 safety guard、apply 后 clean second-plan/readiness；observability 失败显示为 degraded，不改变应用服务结果。
- 三个数据更新 workflow（`update-tankopedia.yml`、`update-equipment.yml`、`update-crew-skills.yml`）保持独立，生成 PR 后核对 main base / 自动化 head branch / 精确 head SHA，再 dispatch `ci-gate.yml`；CI 通过只读 API 核对该 run 仍验证同一 PR head，不自动 merge。
- main 是应用的唯一目标状态；business-api/frontend 使用 exact digest，Keycloak/ai-service 使用各自 latest/freshness。运行中的版本通过 `docker inspect`、镜像 digest 与 `BUILD_COMMIT` 查询。

### Android 发布

`android/gradle.properties` 的 `wotbVersion` 是唯一版本来源，`versionCode` 由 SemVer 确定性计算；stage 不允许输入覆盖源码版本，publish 只选择已 staged 的不可变候选。发布将版本、bridge version、源 commit SHA 写入 `version.json`。`contracts/android-native-bridge.json` 是 Native/Web bridge 契约 SSOT；运行时变更必须 bump Android 版本，breaking bridge 变更必须同步 bump bridge version、Native 实现与前端兼容门禁。

发布分两阶段（`android-release.yml`）：main 合并后自动 **stage**（构建/签名/上传 immutable APK、建 tag、写 staging evidence，不碰 production `version.json`）；真机验收后手工 `workflow_dispatch(mode=publish, version=<已 staged 版本>)` **publish**（校验 staged 身份 + Keycloak client + APK bundled frontend/Bridge/native-auth + API exact-origin CORS/对象存储匿名可读 + minSupported，最后写 `version.json`）。stage preflight 与 publish 都执行 `guard_min_supported` / `guard_local_first_cutover` / `guard_bridge_covered`，因此 major / bridge cutover 的 `ANDROID_MIN_SUPPORTED_VERSION_CODE` 必须在合并前设好。版本号在任一 immutable artifact 出现时即被消耗（tag、任一台 origin 上核验的 APK、staging evidence、production `version.json`），stage 失败不代表版本可复用；main 前进不改变候选，只提供 ancestry/minSupported/compatibility 策略。细节见 [`android/release-process.md`](android/release-process.md)。

### Flyway 迁移不可变

**Flyway 迁移不可变（canonical policy 见 [`java/AGENTS.md`](../java/AGENTS.md)）**：`java/wotb-web/src/main/resources/db/migration/V*.sql` 中已存在的 versioned migration 是 immutable historical artifact——禁止修改、重命名、删除、格式化、改注释、转换换行或编码；schema 变化只能新增更高版本 forward-only `V<N>__*.sql`。CI `deploy-smoke` 用 `deploy/check-flyway-immutability.sh` 以 PR base SHA 做 diff 检测，任何既有 migration 的 M/D/R 一律失败，新 migration 版本号必须高于 base 最大版本。

### 并发、锁与备份

Deploy job、固定基础设施 Tofu/runtime workflows 与 database backup 共用 `production-maintenance` concurrency（`cancel-in-progress: false`、`queue: max`）；应用 workflow 使用 `deploy-<service>` + `cancel-in-progress: true`，所以新 main 可以取消旧应用 workflow。Business API/Frontend 的 mirror jobs 共用 `production-gitee-mirror`，TX build jobs 共用 `tx-production-build`，两者不取消运行项并最大排队。TX builders 共用 host build lock；production mutation 由各宿主 deploy `flock` 串行化。应用 lane 在 mutation 前执行 current-main/freshness 校验。

TX 人工 mutation 必须通过 `bash /opt/wotb-tx/deploy/with-deploy-lock.sh <command...>`（源文件 `deploy/tx/with-deploy-lock.sh`），让锁 FD 只存在于命令进程树；禁止在交互 SSH shell 直接 `exec 9>` 持锁。冲突时 wrapper 输出当前 holder 诊断；这不是 distributed lock。

生产数据库每日香港时间 03:15 由 `database-backup.yml` 调用 TX owner 的 `business-postgres-backup.sh` 与 `keycloak-postgres-backup.sh`；两者只访问已运行的 owner service，并在 `pg_dump` 前核对 Compose project、卷标签与实际挂载卷。同一维护队列备份 TX/Yecao/Komodo 三个 owner-host local Tofu states 并生成 SHA-256。Business PostgreSQL 归档只能用 `business-postgres-restore.sh` 校验并恢复到经确认的 disposable 数据库；Keycloak 归档不能传给 Business restore 工具。

Sponsor QR 不进仓库：配置与收款码作为 **GitHub Release 资产**发布，由 `deploy/sponsor/content.json` 钉住 release/asset/sha256，构建期下载校验后注入 publicDir（`common/assets/`），随 Frontend 镜像与 APK bundle 两个发布面出去；TX 不挂载也不下发。轮换、不变量与回滚见 [`operations/sponsor-runtime-content.md`](operations/sponsor-runtime-content.md)。二维码加载失败时页面必须隐藏失败方式；全部方式不可用时回退到“暂未配置”，不得显示 broken image。

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
- **架构测试（ArchUnit）**：`wotb-core` 与 `wotb-web` 各含 `*ArchitectureTest`，随 `mvn test` 自动执行；守护模块边界（core 禁 Spring Web/Boot 与反向依赖 web、web domain 分包与分层、禁字段注入/Lombok、顶层包无循环依赖）。规则失败即构建失败。
- 前端：Vitest + happy-dom（按需声明）；浏览器 gate 的命令与覆盖范围见 [`frontend/AGENTS.md`](../frontend/AGENTS.md)。
- Replay/League/UI regression 必须补针对真实 invariant 的测试，而不是只验证函数被调用。
- **职责分层（Fast Feedback First）**：开发过程中 Agent 只跑 targeted / module / feature regression，不重复跑 repository-level full test；仓库级 full validation 由 PR CI 统一执行（authoritative gate）。仅当改动影响跨模块 / build / test infrastructure（[`.agents/AGENTS.md`](../.agents/AGENTS.md) 的 Full-test 例外清单）时，Agent 才跑 `cd java && mvn -s settings.xml test` / `cd frontend && npm test && npm run build`。
- `wotb-ai` 的真实 DeepSeek/provider probe 使用 `@Tag("ai-live")`，普通 `mvn test` 默认不执行；仅在明确选择 probe、清空 `-Dai.probe.excludedGroups=` 且通过环境变量提供 key 时手动运行。gateway mock、loopback 与 deterministic AI eval 仍属于普通测试。
- 涉及 Docker/部署时同时跑对应 Docker build 与 deployment smoke；Deploy 不重复运行测试套件。

---

## 专题文档

| 主题 | 文档 |
|---|---|
| 前端应用架构 / Replay Workspace / UI system | [`frontend/architecture.md`](frontend/architecture.md)、[`frontend/replay-workspace.md`](frontend/replay-workspace.md)、[`frontend/ui-system.md`](frontend/ui-system.md) |
| 回放解析管线 / Agent 产物身份 | [`architecture/replay-pipeline.md`](architecture/replay-pipeline.md) |
| AI 复盘架构 | [`architecture/ai-review.md`](architecture/ai-review.md) |
| Team AI Review | [`features/team-ai-review.md`](features/team-ai-review.md) |
| 地图鸟瞰 / 战局回放 | [`features/battle-playback.md`](features/battle-playback.md) |
| 战斗表现 / 回放数据字典 | [`reference/replay-data.md`](reference/replay-data.md)、[`features/league-rating.md`](features/league-rating.md) |
| 已确认解析字段 | [`reference/replay-parsed-fields.md`](reference/replay-parsed-fields.md) |
| 地图目录 | [`reference/maps.md`](reference/maps.md) |
| 名人堂 / 百场 / 三环 | [`features/hall-of-fame.md`](features/hall-of-fame.md) |
| League Rating | [`features/league-rating.md`](features/league-rating.md)、[`WotBTools_League_Rating_V6.md`](WotBTools_League_Rating_V6.md) |
| 积分赛 / 联赛直播 | [`features/tournament-points.md`](features/tournament-points.md)、[`features/league-broadcasts.md`](features/league-broadcasts.md) |
| bilibili 推荐 | [`features/bilibili-creators.md`](features/bilibili-creators.md) |
| Android 架构 / 发布 | [`android/architecture.md`](android/architecture.md)、[`android/release-process.md`](android/release-process.md) |
| 认证 / Keycloak | [`auth/wargaming-asia-deployment.md`](auth/wargaming-asia-deployment.md)、[`auth/keycloak-tx-bootstrap.md`](auth/keycloak-tx-bootstrap.md) |
| 观测运维 | [`operations/observability.md`](operations/observability.md) |
| 逆向协议与证据 | [`research/replay/README.md`](research/replay/README.md)、[`reference/replay-data.md`](reference/replay-data.md) |
| Tier X 车型资产 | [`assets/tier-x-models/README.md`](assets/tier-x-models/README.md) |

修改任何专项能力时，以对应专题文档 + 实际代码共同作为验收基线。

## 产品可观测性

Grafana 有六个由 OpenTofu 管理的看板：WotbTools Engineering Overview 加五个产品看板：Active users (home)、Feature usage、Android downloads、AI token usage 与 Backend error logs。客户端遥测使用有界的 `/api/observability/events` 契约；认证活动需要仅运行时的 `WOTB_OBSERVABILITY_HASH_KEY`。Yecao Alloy 还采集 ai-service 日志。看板删除/替换没有 allowlist；数据源删除仍受保护。可查询历史为七天，Loki 异步删除，Docker 原始日志按大小轮转。精确计数、隐私、缺失用量与保留限制见 [`operations/observability.md`](operations/observability.md)。

工程健康：Yecao `dev-metrics-exporter`、每 15 分钟刷新 GitHub、内存快照与独立的 15 秒 Prometheus 抓取。canonical 语义与恢复见 [`architecture/engineering-metrics.md`](architecture/engineering-metrics.md)。不提供开发者排名或生产力评分。
