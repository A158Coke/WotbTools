# WotBTools Agent Instructions

WoT Blitz（坦克世界闪击战）回放工具集：Java 21 + Spring Boot 后端、Vue 3 前端、Keycloak 认证。
入口 https://wotbtools.com · 仓库 https://github.com/A158Coke/WotbTools

## 必读

1. **`.agents/AGENTS.md`** — 仓库级硬约定（Plan-First / 提交约定 / 跨层一致 / 禁止清单），任何改动前先读。
2. **`docs/DEVELOPER_GUIDE.md`** — 架构、目录结构、环境、测试与部署约定（接手维护必读）。
3. 进入具体目录工作时，同时读取该目录的 `AGENTS.md`（存在时）：

| 目录 | AGENTS.md 覆盖 |
|---|---|
| `java/` | Maven/JDK、domain 分包、分层、Flyway、代码风格、wotb-core vs wotb-web 边界、AI Review 边界 |
| `frontend/` | Node 24、Vue 3/Vite、三语 i18n、versions.json、跨站 cookie、坦克标记 PNG 契约 |
| `common/` | 单一来源数据（tankopedia tier 文件/rating/map_names/map-semantics）、更新链、fixtures vs data 边界 |
| `deploy/` | 三镜像构建、deploy.sh 契约校验、nginx/超时链、备份、生产排障 |
| `.github/` | CI/部署/数据同步 workflow 职责 |
| `keycloak-wargaming-provider/` `keycloak-juhe-qq-provider/` | Keycloak SPI provider 构建与注册 |
| `map-semanticizer/` | 地图语义化独立工具（覆盖式生成，核验后勿重跑） |

## 技能库（按需显式加载）

`.agents/skills/`：grill-me（需求澄清）· plan-designer（方案设计）· plan-executer · review-fix ·
review-with-docs · code-smell · column-sync · wotb-sync · fallow · finish-task · keycloak-upgrade

## 文档入口

README.md · docs/DEVELOPER_GUIDE.md · docs/CHANGELOG.md · docs/CHANGELOG-PRODUCT.md · docs/TODO.md ·
docs/replay-data.md · docs/replay-reverse-engineering.md · docs/observability.md
