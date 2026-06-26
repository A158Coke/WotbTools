# 版本历史

## [Unreleased]

## [1.5.0] - 2026-06-26

### Added
- 工具集主页 `wotbtools.com`：暗色卡片式入口，三档主题切换（跟随系统/亮色/暗色），回放工具入口，未来工具占位，底部版本历史
- 主题切换系统：`auto`/`light`/`dark` 三档，`.wotbtools.com` 域 Cookie 跨子域名同步 + localStorage 回退，主页与 replay 页面双向同步，三语 i18n 标签
- 排行榜功能（仅在线版）：伤害排行榜、按车辆筛选、上传单场回放录入排行、仅收录随机战斗模式
- PostgreSQL 数据库：`postgres:18-alpine`，Flyway 管理 schema 迁移，密码由 GitHub Secret 注入
- `GlobalExceptionHandler`：统一异常 → JSON 错误响应，不再返回 HTML 错误页
- 部署健康检查：workflow 在 `docker compose up` 后轮询容器状态，不健康则 workflow 标记失败
- 离线版 Docker 分发：`offline/start.bat`（Windows）+ `offline/start.sh`（macOS/Linux），自动检测安装 Docker、拉取镜像、启动三容器

### Changed
- 容器拆分：单镜像 → 三服务（`postgres:18` + `wotb-backend` + `wotb-frontend`），改前端不触发 Maven 构建
- 项目重构：`offline/` `frontend/` `online/` 从 `java/` 移至仓库根；Dockerfile 归入 `docker/`；`deploy/nginx.conf` → `deploy/nginx/nginx.conf`
- 前端重构：抽取 composables（`useTheme` `useReplay` `useColumns`）+ utils（`api.js` `theme.js`），App.vue 缩减 68%
- 离线版方案变更：jpackage exe → Docker 镜像分发，用户只需 Docker Desktop
- 数据库 schema 管理：`ddl-auto: update` → Flyway 版本化 migration
- Hibernate 方言移除：`PostgreSQLDialect` 由 Spring Boot 自动检测
- 版本历史移至主页展示，replay 页面移除版本按钮

### Removed
- 旧版 jpackage 离线 exe（`build-desktop.bat` `build-desktop.ps1` `dist-desktop/`）
- 旧版单镜像 `Dockerfile`
- ReplayService 与 LeaderboardService 耦合（`recordLeaderboard` 桥接）

## [1.4.0] - 2026-06-25

### Fixed
- 存活时间推算更准确：解决部分玩家被误判阵亡或观战期间不停止的问题

## [1.3.0] - 2026-06-24

### Added
- 存活时间列、i18n 三语、评分系统、地图中文化、列选择器重做、上传区重做、便携构建、Docker 部署

## [1.0.0] - 2026-06-23

### Added
- 回放解析引擎、Web API、Vue 前端、Excel 导出、离线 exe

## [0.1.0] - 2026-06-22

### Added
- 项目初始化
