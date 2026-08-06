# WoTBTools

《坦克世界闪击战》（World of Tanks Blitz）工具集：从 `.wotbreplay` 回放提取战斗数据并导出 Excel、在线伤害排行榜、实时评分（Rating V2）、AI 战术复盘、Keycloak 认证。

入口：[https://wotbtools.com](https://wotbtools.com) · 仓库：[https://github.com/A158Coke/WotbTools](https://github.com/A158Coke/WotbTools)

## 文档入口

- [DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) — 架构、仓库结构、路由、i18n、测试与部署约定（接手维护必读）
- [java/README.md](java/README.md) — Java / Web 版运行、接口与部署
- [CHANGELOG.md](docs/CHANGELOG.md) — 版本历史（技术）
- [CHANGELOG-PRODUCT.md](docs/CHANGELOG-PRODUCT.md) — 版本历史（产品）
- [TODO.md](docs/TODO.md) — 待办事项
- [replay-data.md](docs/replay-data.md) — `data.wotreplay` 事件流格式与字段
- [rating-system.md](docs/rating-system.md) — 评分算法与参数
- [observability.md](docs/observability.md) — 监控 / 日志 / 备份等运维
- [team-ai-review-feature.md](docs/team-ai-review-feature.md) — AI 团队复盘功能说明
- [auth/wargaming-asia-login.md](docs/auth/wargaming-asia-login.md) — Wargaming.net ASIA / EU / NA 登录需求与实现说明
- [auth/wargaming-asia-deployment.md](docs/auth/wargaming-asia-deployment.md) — Wargaming 登录部署与手工配置（运维手册）
- [auth/keycloak-mapper-guide.md](docs/auth/keycloak-mapper-guide.md) — Keycloak Protocol Mapper / Client Scope 机制与生产补 mapper 指南

## 快速开始

- 本地运行 / 构建：见 [java/README.md](java/README.md)（本地八服务 `docker/online/`）
- 测试与质量门禁：见 [DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)
- 更新车辆库：手动触发 GitHub Actions `Update Tankopedia`（在 VPS 上跑 WG 官方同步并自动提交回 main）；本地跑 `cd common/python && WG_APPLICATION_ID=... python update_tankopedia.py` 需先把本机 IP 加入 WG 开发者后台白名单（详见 DEVELOPER_GUIDE）

## 已上线工具

回放解析与 Excel 导出 · 在线排行榜 · 实时评分（Rating V2）· AI 战术复盘（个人 / 团队）· Keycloak 认证（QQ + Wargaming.net ASIA/EU/NA）· 陪练与打手管理
