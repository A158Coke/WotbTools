# WotBTools 文档索引

> 每个文档「什么时候该读」。动手前先读 `DEVELOPER_GUIDE.md` 与 `../.agents/AGENTS.md`。

## Start here（入口）

| 文档 | 何时读 |
|---|---|
| `DEVELOPER_GUIDE.md` | 接手维护 / 找环境、构建、仓库结构、架构速览时（最先） |
| `../README.md` / `../README.en-US.md` | 了解产品是什么、功能与工程取舍 |
| `../.agents/AGENTS.md` | 动手前必读（仓库级硬约定） |

## Architecture（架构）

| 文档 | 何时读 |
|---|---|
| `architecture/ai-review.md` | 改 AI 复盘 / 证据链 / prompt / 双 Call / Team Autopsy 时 |
| `architecture/replay-pipeline.md` | 改回放重建 / decoder / 事件流时 |

## Features（功能契约）

| 文档 | 何时读 |
|---|---|
| `features/battle-playback.md` | 改地图鸟瞰 / 战局回放 / 双层坦克标记时 |
| `features/performance.md` | 改战斗表现指标时 |
| `features/rating-v2.md` | 改管理员灰度 Rating V2 的公式、阈值、输出字段、六轴雷达展示或历史比较口径时（唯一算法维护基线） |
| `features/hall-of-fame.md` | 改名人堂时 |
| `features/team-ai-review.md` | 改团队复盘产品语义时 |
| `features/league-rating.md` | 改训练赛/联赛评分（League Rating）公式 / 模式 / 完整性门槛 / 导出时 |
| `WotBTools_League_Rating_V5.md` | 改 League Rating V5 批次证据评分算法 / 回放解析「算法说明」入口正文时 |

## Research（逆向研究）

| 文档 | 何时读 |
|---|---|
| `research/replay/protocol.md` | 逆向 data.wotreplay 包类型 / 协议时 |
| `research/replay/turret-direction.md` | 查炮塔相对方向证据时 |
| `research/replay/visibility.md` | 查可见性 / 点亮证据时 |
| `research/replay/capture-probe.md` | 查占点时间线探测结论时 |

## Operations（运维）

| 文档 | 何时读 |
|---|---|
| `operations/observability.md` | 动监控 / 日志 / Grafana / 保留策略 / 排障时 |

## Reference（参考字典）

| 文档 | 何时读 |
|---|---|
| `reference/replay-data.md` | 深入回放格式 / 字段 / protobuf 结构时 |
| `reference/replay-parsed-fields.md` | 查已确认字段含义时 |
| `reference/maps.md` | 加地图素材 / 查内部 code ↔ 展示名映射时 |
| `assets/tier-x-models/README.md` | 改 Tier X 专属车型系统 / 资产交接 / 生成资产时 |
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
| `auth/keycloak-mapper-guide.md` | JWT 缺 claim / 改 claims 时 |
| `auth/keycloak-qq-only.md` | QQ 登录部署参考时 |

## Test（测试）

| 文档 | 何时读 |
|---|---|
| `test/test-framework.md` | 了解测试框架约定时 |
