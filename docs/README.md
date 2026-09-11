# WotBTools 文档索引

> 每个文档「什么时候该读」。动手前先读 `DEVELOPER_GUIDE.md` 与 `../.agents/AGENTS.md`。

固定接手方法以 `../.agents/AGENTS.md` 的「接手与调整方法（固定流程）」为准：入口阅读 → 现实审计 → 任务分类 → 计划契约 → Reuse / SSOT 执行 → 分层验证 → 收尾交接。

## Language map（中英分类）

| 分类 | 范围 | 维护规则 |
|---|---|---|
| 中文 / mixed primary | `README.md`、`DEVELOPER_GUIDE.md`、本索引、功能/运维/Auth/Android/前端契约文档 | 作为接手、开发、运维入口；面向维护者，允许中英术语混排 |
| English primary | 大部分 `research/replay/*.md`、`research/maps/*.md`、部分 architecture/development benchmark 文档 | 作为逆向研究、实验、benchmark 原始记录；除结论已收敛的入口外，不要求逐篇翻译 |
| Bilingual canonical | `research/replay/WOTB_REPLAY_PROTOCOL_11_19_BILINGUAL_COMPLETE_REFERENCE.md` | Replay protocol 顶层权威参考；与英文旧综合参考冲突时优先读它 |
| Localized prompt docs | `java/wotb-ai/src/main/resources/prompts/**/*.zh.md` | 不是 `docs/` 索引文档；按 prompt 资源随代码维护 |

## Start here（入口）

| 文档 | 何时读 |
|---|---|
| `DEVELOPER_GUIDE.md` | 接手维护 / 找环境、构建、仓库结构、架构速览时（最先） |
| `current-plan.md` | 查看当前 worktree 正在执行 / 刚完成的任务计划与状态时 |
| `frontend/local-production-dev.md` | 本地前端连接生产后端 / Keycloak 开发模式时 |
| `../README.md` / `../README.en-US.md` | 了解产品是什么、功能与工程取舍 |
| `../.agents/AGENTS.md` | 动手前必读（仓库级硬约定、接手与调整固定流程） |

## Development（开发与性能）

| 文档 | 何时读 |
|---|---|
| `development/replay-performance.md` | 运行 replay core 本地性能基准、JFR 或规划生产 one-shot 测量时 |
| `development/replay-performance-results.md` | 查看最近一次本地性能基线、JFR 证据与优化决策时 |
| `development/ai-virtual-thread-benchmark.md` | 运行真实 provider 的 Platform vs Virtual blocking-call A/B 时 |

## Architecture（架构）

| 文档 | 何时读 |
|---|---|
| `frontend/architecture.md` | 改 Vue 应用壳、路由、依赖方向或状态 ownership 时 |
| `frontend/replay-workspace.md` | 改 Replay Workspace capability、selection 或 dataset 边界时 |
| `frontend/ui-system.md` | 改 UI Profile、token、layout primitive 或响应式规则时 |
| `architecture/ai-review.md` | 改 AI 复盘 / 证据链 / prompt / 双 Call / Team Autopsy 时 |
| `architecture/replay-pipeline.md` | 改回放重建 / decoder / 事件流时 |
| `architecture/battle-timeline.md` | 改 battle timeline 事件模型 / 时间轴聚合时 |
| `architecture/http-contracts.md` | 改 HTTP OpenAPI 契约、生成 transport 或 runtime schema 时 |
| `architecture/async-contracts.md` | 改异步 Control / Worker 契约或 future async foundation 时 |
| `architecture/control-api.md` | 改 Control API 管理面契约时 |
| `architecture/control-api-native-benchmark.md` | 查 Control API native benchmark 设计 / 结果时 |
| `architecture/grafana-opentofu.md` | 改 Grafana OpenTofu API 管理方式时 |
| `architecture/opentofu-production-baseline.md` | 改生产 OpenTofu baseline / import / state 边界时 |
| `architecture/tankopedia-reference-data.md` | 改 Tankopedia reference data 同步 / 单一来源时 |
| `api/error-contract.md` | 新增/修改 API error code、Security 401/403、前端错误展示或 traceId 时 |

## Features（功能契约）

| 文档 | 何时读 |
|---|---|
| `features/battle-playback.md` | 改地图鸟瞰 / 战局回放 / 双层坦克标记时 |
| `features/battle-playback-hp-authority.md` | 改战局回放 HP 权威来源 / settlement 优先级时 |
| `features/performance.md` | 改战斗表现指标时 |
| `features/rating-v2.md` | 改管理员灰度 Rating V2 的公式、阈值、输出字段、六轴雷达展示或历史比较口径时（唯一算法维护基线） |
| `features/hall-of-fame.md` | 改名人堂时 |
| `features/team-ai-review.md` | 改团队复盘产品语义时 |
| `features/league-rating.md` | 改训练赛/联赛评分（League Rating）公式 / 模式 / 完整性门槛 / 导出时 |
| `WotBTools_League_Rating_V6.md` | 改 League Rating V6 批次 pooled sum/count 算法 / 回放解析「算法说明」入口正文时 |

## Research（逆向研究）

| 文档 | 何时读 |
|---|---|
| `research/replay/README.md` | 进入 replay protocol 逆向研究前；按其中权威读取顺序继续读 |
| `research/replay/WOTB_REPLAY_PROTOCOL_11_19_BILINGUAL_COMPLETE_REFERENCE.md` | 查 11.19 replay protocol 中英双语顶层权威参考时 |
| `research/replay/protocol.md` | 逆向 data.wotreplay 包类型 / 协议时 |
| `research/replay/turret-direction.md` | 查炮塔相对方向证据时 |
| `research/replay/visibility.md` | 查可见性 / 点亮证据时 |
| `research/replay/capture-probe.md` | 查占点时间线探测结论时 |
| `research/maps/3d-playback-client-map-research.md` | 查 3D playback 客户端地图研究时 |

## Android

| 文档 | 何时读 |
|---|---|
| `android/architecture.md` | 改 Android WebView 壳、native bridge 或启动流程时 |
| `android/replay-intent.md` | 改 Android 外部回放交接 / pending replay 消费时 |
| `android/release-process.md` | 改 Android 发布流程或版本门禁时 |
| `android/version-manifest.md` | 改 APK version manifest / update contract 时 |

## Operations（运维）

| 文档 | 何时读 |
|---|---|
| `operations/observability.md` | 监控 / 日志 / Grafana / 保留策略 / 排障时 |
| `operations/observability-runbook.md` | 生产观测链路排障和人工 runbook 时 |
| `operations/ai-evaluation.md` | 运行 / 复盘 AI evaluation 运维流程时 |

## Reference（参考字典）

| 文档 | 何时读 |
|---|---|
| `reference/replay-data.md` | 深入回放格式 / 字段 / protobuf 结构时 |
| `reference/replay-parsed-fields.md` | 查已确认字段含义时 |
| `reference/maps.md` | 加地图素材 / 查内部 code ↔ 展示名映射时 |
| `assets/tier-x-models/README.md` | 改 Tier X 专属车型系统 / 资产交接 / 生成资产时 |
| `assets/tier-x-models/information-loss-audit.md` | 审查 Tier X 资产生成信息损失或渲染保真时 |
| `assets/tier-x-models/svg-generation-spec.md` | 生成/修复车型资产（WebP bake）时（唯一全局规则） |
| `assets/tier-x-models/tier-x-inventory.md` | 查 Tier X 清单 / baseModelKey / 参考链接时 |

## AI engineering（AI 工程）

| 文档 | 何时读 |
|---|---|
| `ai-eval/feedback-checklist.md` | 登记 AI 复盘评估反馈时 |
| `ai-lessons/*.md` | 查阅 AI 复盘经验教训时 |

## Release history（发布历史）

| 文档 | 何时读 |
|---|---|
| `CHANGELOG.md` | 技术版本历史 |
| `CHANGELOG-PRODUCT.md` | 产品版本历史 |

## Roadmap（路线图）

| 文档 | 何时读 |
|---|---|
| `ROADMAP.md` | 了解产品方向（Now / Next / Later / Research） |

## Auth（认证）

| 文档 | 何时读 |
|---|---|
| `auth/wargaming-asia-login.md` | 改 WG 登录需求 / 实现时 |
| `auth/wargaming-asia-deployment.md` | 上线 / 排障 WG 登录时 |
| `auth/keycloak-login-theme.md` | 改 Keycloak 登录页主题或 realm theme 配置时 |
| `auth/keycloak-mapper-guide.md` | JWT 缺 claim / 改 claims 时 |
| `auth/keycloak-qq-only.md` | QQ 登录部署参考时 |
| `auth/keycloak-admin-user-search.md` | 改 Keycloak Admin 用户检索 / Admin Users 分页与 IdP 过滤时 |

## Test（测试）

| 文档 | 何时读 |
|---|---|
| `test/test-framework.md` | 了解测试框架约定时 |
