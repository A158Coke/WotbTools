# WotBTools 文档索引

> 本索引的唯一职责：**今天该读哪份文档？**
> 当前状态文档只描述合并后的系统；产品/业务演进见 `../HISTORY.md`，技术/架构演进见 `architecture/TECHNICAL_EVOLUTION.md`，逆向证据见 `research/**`。
> 未排期的 future wishlist 不进入 persistent repository docs；当前已批准任务只进入 `current-plan.md`，明确独立 follow-up 使用 GitHub Issue。

固定接手方法以 `../.agents/AGENTS.md` 的「接手与调整方法（固定流程）」为准：入口阅读 → 现实审计 → 任务分类 → 计划契约 → Reuse / SSOT 执行 → 分层验证 → 收尾交接。

## 入口

| 文档 | 何时读 |
|---|---|
| `DEVELOPER_GUIDE.md` | 接手维护 / 找环境、构建、仓库结构、架构速览时（最先） |
| `frontend/local-testing.md` | **本机全功能测试 runbook**：起环境（Agent 引擎 / 资产面 / 认证门禁）、自检探针、故障对照、自动化门禁时（本机测试最先读） |
| `frontend/local-production-dev.md` | 本地前端连接生产后端 / Keycloak 链路与安全边界时 |
| `../README.md` | 了解当前产品是什么、功能与工程取舍 |
| `../.agents/AGENTS.md` | 动手前必读（仓库级硬约定、接手与调整固定流程） |

## 开发与性能

| 文档 | 何时读 |
|---|---|
| `development/contribution-map.md` | 想加新功能、找后端/前端/契约入口或判断贡献点归属时 |
| `development/ai-virtual-thread-benchmark.md` | 运行真实 provider 的 Platform vs Virtual blocking-call A/B 时 |

## 架构

> 这一节描述当前架构；技术历史在 `architecture/TECHNICAL_EVOLUTION.md`。

| 文档 | 何时读 |
|---|---|
| `frontend/architecture.md` | 改 Vue 应用壳、路由、依赖方向或状态 ownership 时 |
| `frontend/replay-workspace.md` | 改 Replay Workspace capability、selection 或 dataset 边界时 |
| `frontend/ui-system.md` | 改 UI Profile、token、layout primitive 或响应式规则时 |
| `frontend/design-language.md` | 改任何界面前：颜色 / 字号 / 间距 / 组件 / 文案的设计规则与 stylelint 守护 |
| `architecture/TECHNICAL_EVOLUTION.md` | 查技术架构决策、authority / boundary、分布式 Replay 与双云拓扑的 canonical 技术演进时（历史，不是当前契约） |
| `architecture/ai-review.md` | 改 AI 复盘 / 证据链 / prompt / 双 Call / 结构化团队结果（`TeamAiReviewResult`）时 |
| `architecture/replay-pipeline.md` | 改客户端回放管线（上游 Rust Core WASM → 批次计算 / 导出 / 2D）或名人堂客户端事实时 |
| `architecture/battle-timeline.md` | 改 battle timeline 事件模型 / 时间轴聚合时 |
| `architecture/http-contracts.md` | 改 HTTP OpenAPI 契约、生成 transport 或 runtime schema 时 |
| `architecture/engineering-metrics.md` | GitHub engineering exporter、classification、freshness 与 Engineering Overview |
| `architecture/grafana-opentofu.md` | 改 Grafana OpenTofu API 管理方式时 |
| `architecture/opentofu-postgres-keycloak.md` | 改 TX Keycloak PostgreSQL OpenTofu root、state 或本地执行边界时 |
| `operations/business-postgres.md` | 改 Business PostgreSQL 运行时、OpenTofu root、state、凭据或恢复边界时 |
| `architecture/tankopedia-reference-data.md` | 改 Tankopedia reference data 同步 / 单一来源时 |
| `api/error-contract.md` | 新增/修改 API error code、Security 401/403、前端错误展示或 traceId 时 |

## 功能契约

- [新手引导与官方示例](features/onboarding.md)：真实页面教学、匿名示例、引导版本与账号完成记录。

| 文档 | 何时读 |
|---|---|
| `features/battle-playback.md` | 改地图鸟瞰 / 战局回放 / 双层坦克标记时 |
| `features/battle-playback-hp-authority.md` | 改战局回放 HP 权威来源 / settlement 优先级时 |
| `features/hall-of-fame.md` | 改名人堂时 |
| `features/tournament-points.md` | 改积分赛规则、截图识别、共享草稿、正式榜单、修正或证据生命周期时 |
| `features/league-broadcasts.md` | 改全服联赛直播回放目录、同页管理、季赛／分类／根节点与回放时 |
| `features/bilibili-creators.md` | 改 bilibili UP/优秀作品推荐、类型隔离、手动星级、站点头像/封面、实力评估或管理权限时 |
| `features/team-ai-review.md` | 改团队复盘产品语义时 |
| `features/league-rating.md` | 改训练赛/联赛评分（League Rating）公式 / 模式 / 完整性门槛 / 导出时 |
| `WotBTools_League_Rating_V6.md` | 改 League Rating V6 批次 pooled sum/count 算法 / 回放解析「算法说明」入口正文时 |

## 研究证据

> 本目录刻意保留实验、被否证假设与证据来源；其中已退役架构不作为当前生产描述。

| 文档 | 何时读 |
|---|---|
| `research/replay/README.md` | 进入 replay protocol 逆向研究前；按其中权威读取顺序继续读 |
| `research/replay/WOTB_REPLAY_PROTOCOL_11_19_BILINGUAL_COMPLETE_REFERENCE.md` | 查 11.19 replay protocol 中英双语顶层权威参考时；与英文旧综合参考冲突时优先读它 |
| `research/replay/protocol.md` | 逆向 data.wotreplay 包类型 / 协议时 |
| `research/replay/assault-base-state.md` | 查 11.20 Assault wrapper8/root8 字段解析、raw/canonical 边界与受控样本证据时 |
| `research/replay/turret-direction.md` | 查炮塔相对方向证据时 |
| `research/replay/visibility.md` | 查可见性 / 点亮证据时 |
| `research/replay/capture-probe.md` | 查占点时间线探测结论时 |
| `research/maps/3d-playback-client-map-research.md` | 查 3D playback 客户端地图研究时 |
| `research/armor-inspector-he-damage.md` | 查 Armor Inspector HE 伤害公式、首面 3× 规则、R 内采样域与实验归档时 |

## Android

| 文档 | 何时读 |
|---|---|
| `android/architecture.md` | 改 Android 运行时（GeckoView / 本机 LocalRuntimeServer）、native bridge 或启动流程时 |
| `android/replay-intent.md` | 改 Android 外部回放交接 / pending replay 消费时 |
| `android/release-process.md` | 改 Android 发布流程或版本门禁时 |
| `android/version-manifest.md` | 改 APK version manifest / update contract 时 |

## 运维

| 文档 | 何时读 |
|---|---|
| `operations/observability.md` | 监控 / 日志 / Grafana / 保留策略 / 排障时 |
| `operations/observability-runbook.md` | 生产观测链路排障和人工 runbook 时 |
| `operations/business-postgres.md` | TX Business PostgreSQL runtime/OpenTofu ownership、凭据、备份/恢复与当前运行验证时 |
| `operations/opentofu-local-state.md` | OpenTofu owner-host persistent local state、bootstrap/adoption 与备份时 |
| `operations/security-log-retention.md` | 安全日志 190 天留存边界、脱敏规则、合规查询与投诉举报渠道（公安自评估事实源）时 |
| `operations/ai-evaluation.md` | 运行 / 复盘 AI evaluation 运维流程时 |
| `operations/agent-asset-origin.md` | 部署/更换 Agent 3D 静态资产源（GLB/地图/坦克数据）时 |
| `operations/league-broadcast-covers.md` | 配置联赛直播封面 COS、权限、上传失败和孤立对象回收时 |
| `operations/sponsor-runtime-content.md` | 更新/轮换赞助收款码、关闭赞助入口，或排查「赞助页显示暂未配置」时 |
| `operations/ai-service.md` | Yecao 独立 AI 服务的生产运行、私网边界与健康验收时 |
| `operations/komodo-public-ingress.md` | Komodo 控制平面公网入口 ownership、DNS/TLS/Caddy、验证与回滚时 |
| `operations/komodo-periphery.md` | Komodo Periphery agent（Yecao / TX1 / TX2）owner、一套 lifecycle + 多宿主 profile、二进制 pin、身份文件、凭据生命周期、三把宿主锁、TX2 WireGuard MTU 1380 前置条件与恢复时 |
| `operations/komodo-server-lifecycle.md` | 新增/迁移/下线服务器、Komodo Stack/Deployment/容器迁移、持久数据 inventory/cutover/rollback 时 |
| `operations/komodo-resource-sync.md` | 声明式 Komodo 资源层 `infra/komodo/resources/**` ownership、ResourceSync `wotbtools-main` 安全设置、Server 期望状态、手工 bootstrap、可逆 drift 验证与只读 diff → 人工 apply 流程时 |
| `operations/tx-service-plane.md` | TX1 WireGuard 生产 service placement、loopback 管理与 Docker-local rollback 值时 |
| `operations/tx2-production-worker.md` | TX2 production worker：独立 host 前置条件、Compose/镜像/凭据生命周期、ownership 边界、fail-closed 矩阵与从零重建流程时 |

## 参考

| 文档 | 何时读 |
|---|---|
| `reference/replay-data.md` | 深入回放格式 / 字段 / protobuf 结构时 |
| `reference/replay-parsed-fields.md` | 查已确认字段含义时 |
| `reference/maps.md` | 加地图素材 / 查内部 code ↔ 展示名映射时 |
| `assets/tier-x-models/README.md` | 改 Tier X 专属车型系统 / 资产交接 / 生成资产时 |
| `assets/tier-x-models/information-loss-audit.md` | 审查 Tier X 资产生成信息损失或渲染保真时 |
| `assets/tier-x-models/svg-generation-spec.md` | 生成/修复车型资产（WebP bake）时（唯一全局规则） |
| `assets/tier-x-models/tier-x-inventory.md` | 查 Tier X 清单 / baseModelKey / 参考链接时 |

## AI 工程

| 文档 | 何时读 |
|---|---|
| `ai-eval/feedback-checklist.md` | 登记 AI 复盘评估反馈时 |
| `ai-lessons/*.md` | 查阅 AI 复盘经验教训时 |

## 项目历史

| 文档 | 何时读 |
|---|---|
| `../HISTORY.md` | 查产品/业务能力为何引入、变化或退役，以及产品方向决策时（产品历史，不是当前契约） |
| `architecture/TECHNICAL_EVOLUTION.md` | 查技术架构、数据流、authority、身份模型与生产拓扑的演进时（技术历史，不是当前契约） |

## 认证

| 文档 | 何时读 |
|---|---|
| `auth/wargaming-asia-login.md` | 改 WG 登录需求 / 实现时（当前契约） |
| `auth/wargaming-asia-deployment.md` | 上线 / 排障 WG 登录时 |
| `auth/keycloak-login-theme.md` | 改 Keycloak 登录页主题或 realm theme 配置时 |
| `auth/keycloak-mapper-guide.md` | JWT 缺 claim / 改 claims 时 |
| `auth/keycloak-tx-bootstrap.md` | TX 新 Keycloak realm / IdP 启动与凭据交接时 |
| `auth/keycloak-admin-user-search.md` | 改 Keycloak Admin 用户检索 / Admin Users 分页与 IdP 过滤时 |

## 测试

| 文档 | 何时读 |
|---|---|
| `test/test-framework.md` | 了解测试框架约定时 |
