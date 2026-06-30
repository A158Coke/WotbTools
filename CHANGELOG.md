# 版本历史

## [Unreleased]

### Added
- **管理员用户删除**：后端 `/api/admin/users` 全套 API（搜索/详情/双删），Keycloak Admin Client 集成，审计日志 `admin_user_log` 表（Flyway V6），`wotbtools-admin` 角色权限校验。
- **通用错误码系统**：`common/error-codes.json` 单源，Java `ErrorCodes` 加载器 + 前端可直读，替代硬编码字符串。
- AGENTS.md 规则 18（StringUtils.hasText）、19（优先 Stream）。
- **用户资料增强**：`user_profile` 新增 `username` 字段（Flyway V7），映射 Keycloak `preferred_username`。
- **displayName JWT 映射**：`wotbtools-web` client 新增 `display-name-mapper` protocol mapper，QQ 昵称映射到 JWT `display_name` claim。
- **QQ username 生成**：`{清洗后昵称}-{sha8(socialUid)}` 确保唯一，无效昵称返回 400。
- **Juhe QQ 登录**：Keycloak 自定义 Identity Provider (`keycloak-juhe-qq-provider`)，通过聚合登录平台 open.juhedenglu.cn 实现 QQ 登录。
  - 新增 Maven 模块：`keycloak-juhe-qq-provider`（Keycloak SPI，provider ID: juhe-qq）
  - 自定义 Keycloak Docker 镜像（`docker/Dockerfile.keycloak`），集成 provider jar

### Changed
- Keycloak 从 26.6.3 升级至 26.6.4（安全补丁 + Quarkus 3.33.2.1），Docker Compose 切换为自定义构建镜像
- 前端 QQ 登录按钮添加 `kc_idp_hint=juhe-qq`，直接跳转聚合登录平台

### Fixed
- CI/CD 部署：`docker compose pull` 添加 3 次重试，缓解 VPS DNS 暂时不可达问题
- 修复回放解析和排行榜上传区内联 SVG 缺少全局描边样式时被浏览器填充成黑色大块的问题，并隐藏样式化上传按钮内的原生 file input。

## [2.0.0] - 2026-06-29

### Added
- **陪练功能**：玩家提交需求、管理员审核分配、打手管理、需求管理。前端 /?view=boost 页面，后端 12 个 REST API，三语 i18n。
- **用户资料系统**：user_profile 表（Flyway V5），Keycloak sub 关联，支持设置展示名和 WoTB 账号绑定（唯一性约束），前端个人中心可编辑。
- 首页新增「寻找陪练」卡片。
- 页面加载动画（旋转环 + 品牌名），替代白屏等待。

### Changed
- Keycloak 从 26.1 升级至 26.6.3（Docker 镜像），前端 keycloak-js 升级至 26.2.0。
- Keycloak realm 新增 wotbtools-admin 和 boost-manager 角色。
- Spring Security 启用 OAuth2 Resource Server JWT 认证，自定义嵌套 claim 提取（realm_access.roles）。
- 移除离线/桌面模式：删除 DesktopLifecycle、--desktop 启动参数、/api/shutdown 端点。
- 合并 @Profile("postgres") 为单一配置，移除双 profile 架构。
- 顶栏响应式优化（768/480px 断点）。

### Fixed
- 修复移动端回放解析/排行榜页面顶栏挤压导致主题切换器样式异常的问题，并清理静态首页残留的旧 `replay.wotbtools.com` 入口链接。
- PostgreSQL 18 volume 挂载路径适配。
- JWT 角色提取 bug：JwtGrantedAuthoritiesConverter 不支持嵌套 claim，改为手动解析。
- 已取消/已完成需求不再显示分配按钮。
- 管理员设终态时自动清理活跃分配。
- api.js 死代码清理（shutdown/getMe/getWotbAccount/getMyRecords）。

## [1.9.0] - 2026-06-28

### Changed
- CI/CD 镜像仓库从 DockerHub 迁移至 GHCR：`deploy.yml` 双镜像推送 `ghcr.io/a158coke/wotbtools-backend` / `wotbtools-frontend`，认证改用内置 `GITHUB_TOKEN`。
- `cleanup-images` workflow 改为清理 GHCR 旧版本（`actions/delete-package-versions@v5`），移除 DockerHub 清理脚本。
- PostgreSQL 容器 volume 挂载点适配 18+ 布局：`/var/lib/postgresql/data` → `/var/lib/postgresql`。
- 文档（README、java/README、HANDOVER、DEVELOPER_GUIDE）同步更新镜像路径，移除 `DOCKER_PASSWORD` secret 引用。

### Added
- 实时 rating 扩展页：新增独立 `/extended` 入口，不改现有回放解析页面入口。
- `POST /api/rating`：基于本次 multipart 上传回放实时计算每名选手 rating、KAST、贡献率、Impact、均伤、潜在均伤、AST、多伤率和人头，不落库；平均血量和账号 ID 不再作为 rating 展示列。
- 潜在伤害字段链路：新增 `potential_damage`、`potential_damage_supplement`、`potential_damage_detail`，并同步单场/汇总导出、API、前端三语 label。
- 补齐旧解析链路字段：单场玩家列新增 `alpha_damage`、`rank`，扩展页/API/导出可用，原回放页面列选择器保持隐藏；`xp`、`credits` 仅在 parser/model 保留，不作为战绩展示字段。
- 扩展页 rating 算法落地：按潜在均伤、KAST、全场 impact、AST、多伤率、场均人头加权；KAST 改为单场最大贡献项且封顶 100%，impact 改按双方总池计算并按百分比展示，多伤率阈值按 1.5 倍均血 / 1.2 倍均血+人头 / 均血+2 头 / 3 头判定。

### Fixed
- 修复首页 `?view=replay` 未被 SPA 识别导致回放提取器卡片跳转仍停留首页的问题。

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
