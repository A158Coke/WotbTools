# 版本历史

## [Unreleased]

### Added
- 实时 rating 扩展页：新增独立 `/extended` 入口，不改现有回放解析页面入口。
- `POST /api/rating`：基于本次 multipart 上传回放实时计算每名选手 rating、KAST、贡献率、影响力、均伤、潜在均伤、AST、多伤率和人头，不落库；平均血量和账号 ID 不再作为 rating 展示列。
- 潜在伤害字段链路：新增 `potential_damage`、`potential_damage_supplement`、`potential_damage_detail`，并同步单场/汇总导出、API、前端三语 label。
- 补齐旧解析链路字段：单场玩家列新增 `alpha_damage`、`rank`，扩展页/API/导出可用，原回放页面列选择器保持隐藏；`xp`、`credits` 仅在 parser/model 保留，不作为战绩展示字段。
- 扩展页 rating 算法落地：按潜在均伤、KAST、全场 impact、AST、多伤率、场均人头加权；KAST 改为单场最大贡献项，impact 改按双方总池计算，多伤率阈值按 1.5 倍均血 / 1.2 倍均血+人头 / 均血+2 头 / 3 头判定。

## [1.8.0] - 2026-06-27

### Added
- Keycloak 认证集成：auth.wotbtools.com + realm wotbtools + client wotbtools-web
- 个人中心（ProfilePage）：check-sso + 登录/登出 + 用户名显示
- Vue SPA 工具集主页：HomePage.vue 替代静态 HTML，版本历史动态加载
- 域名统一：移除 replay.wotbtools.com，仅 wotbtools.com
- 部署磁盘清理：docker image prune -af && docker builder prune -af

### Changed
- nginx 单 server block，wotbtools.com/replay 合并
- 移除 offline 版本

### Fixed
- Keycloak client 统一为 wotbtools-web

## [1.7.0] - 2026-06-27

### Added
- 品牌升级：logo + favicon 首页/前端双站点展示，`common/assets/` 单一来源
- 赞助页面：暗色卡片式 + 主题自适应 + 支付宝/微信二维码，三语 i18n 同步
- 主题按钮 i18n：auto/light/dark 三档中英俄切换，主页+赞助页统一
- Blitz account 绑定设计文档（`docs/auth/keycloak-qq-only.md`）
- AGENTS.md 新增规则：三语 i18n、数据库迁移、安全、Java final
- Java 全量 final 审计：局部变量、方法入参一律 `final`

### Changed
- homepage 目录归入 `frontend/homepage/`，Docker 构建路径同步
- AGENTS.md 精简并增强（12 条规则 + 6 条禁止）

### Fixed
- 排行榜卡片点击跳转回放页面 → 正确读取 `?view=leaderboard` 参数
- 排行榜战斗时间显示 1970 年 → `battleStartTime == 0` 按 null 处理

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
