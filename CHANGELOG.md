# 版本历史

## [Unreleased]

### Added
- 品牌升级：添加 logo（`wotbtoolslogo.png`）和 favicon（`icon.ico`/`icon.png`），首页 header + 前端顶栏双站点展示，`common/assets/` 单一来源、Dockerfile 构建时分发
- 主题按钮三语 i18n：跟随系统/亮色/暗色 三档支持中英俄切换

### Fixed
- 修复主页排行榜卡片点击后进入回放页面而非排行榜视图（前端 `App.vue` 读取 `?view=leaderboard` 查询参数）

## [1.6.0] - 2026-06-26

### Added
- 排行榜新增 `version`（回放游戏版本号）和 `battle_time`（战斗实际发生时间）列，V2 Flyway 迁移、前端表格同步展示
- 排行榜新增按车辆筛选：点击车辆名即可查看该车专属伤害榜，复用 `/api/leaderboard/tanks/{tankId}/top-damage`

### Changed
- 后端删除未使用的 `/api/columns` 和 `/api/leaderboard/records/{id}` 端点，前端 `RatingModal.vue` 统一走 `api.js`

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
