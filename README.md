# WoTBTools

## SPA 路由参数

- `?view=home`：进入工具集首页。
- `?view=replay`：进入回放提取器。
- `?view=leaderboard`：进入排行榜。
- `?view=boost`：进入陪练与打手申请。
- `?view=extended`：进入 Rating V2 解析。
- `?view=profile`：进入个人中心。
- `?view=admin-users`：进入管理员用户管理（需 `wotbtools-admin` 角色）。

《坦克世界闪击战》（World of Tanks Blitz）工具集。

已上线工具：从 `.wotbreplay` 回放文件中提取战斗数据导出 Excel、在线伤害排行榜、Keycloak 认证。

入口：[https://wotbtools.com](https://wotbtools.com)

## 当前目标

| 目标          | 技术方向                                           | 状态            |
|-------------|------------------------------------------------|---------------|
| Web 版       | Spring Boot 4 + Vue 3 + PostgreSQL + Docker + Keycloak | ✅ 已完成         |
| 工具集主页    | Vue SPA 游戏工具站风格入口 + 主题切换 + 三语 i18n | ✅ 已完成         |

版本历史见 [CHANGELOG.md](CHANGELOG.md)，任务拆分见 [TODO.md](TODO.md)。

## 当前实现

| 版本          | 技术栈                                        | 入口                                                   | 适用场景                     |
|-------------|--------------------------------------------|------------------------------------------------------|--------------------------|
| Java Web 版  | Java 21 + Spring Boot 4 + Vue 3 + Docker | `docker\online\` 本地开发；CI/CD → GHCR `ghcr.io/a158coke/wotbtools-*` 双镜像 | 浏览器上传、在线预览、排行榜、REST API、Keycloak 认证 |

文档入口：

- 本文件：项目概览、Java 版使用与构建。
- [HANDOVER.md](HANDOVER.md)：**交接 / AI 工具迁移总入口**（环境坑、CI/CD、部署、约定一站式）。
- [java/README.md](java/README.md)：Java / Web 版运行、接口、部署。
- [CHANGELOG.md](CHANGELOG.md)：版本历史（对外）。
- [TODO.md](TODO.md)：待办事项。
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)：维护上下文、架构、回放格式、i18n、测试策略。
- [docs/replay-data.md](docs/replay-data.md)：data.wotreplay 事件流格式、protobuf 字段表、死亡时间推算。
- [docs/rating-system.md](docs/rating-system.md)：评分算法、参数、展示。

## 功能

- 品牌展示：logo 与 favicon（`common/assets/` 单一来源，Docker 构建时分发至首页与前端）
- 解析单个 `.wotbreplay` 中的 14 名玩家战斗数据。
- 读取 `meta.json` 战斗信息、`battle_results.dat` pickle + protobuf、`data.wotreplay` 事件流。
- 使用 `tankopedia.json` 将车辆 ID 映射为车辆名、等级、类型、国家和炮伤。
- 单场导出 Excel：`战斗信息`、`玩家数据`、`原始字段`。
- 多场导出 Excel：按 `arenaUniqueId` 去重，生成 `汇总`、`明细`、`战斗列表`。
- 存活时间列：基于伤害事件的秒级估算。
- 自包含表现**评分**：按车型基准归一化（类 WN8，1000=同型平均），单场「评分」、汇总「场均评分」。
- 评分徽章：回放预览中最高评分显示奖牌，最低评分显示金 shit，支持 `0` 分最低值。
- Rating V2 分析页：主站 `?view=extended` 与独立入口 `/extended` 均可进入，额外展示扩展字段与本次上传实时 rating。
- 扩展字段：`alpha_damage`、`rank` 已接入 API/导出/扩展页，原回放页面不默认展示；`xp`、`credits` 仅解析保留，不作为战绩字段展示。
- 潜在伤害字段：`potential_damage` / `potential_damage_supplement` / `potential_damage_detail`，优先从回放 direct HP damage 事件推断逐击杀目标；事件缺失、映射失败或特殊伤害未覆盖时保守等于实际伤害。
- 地图名共享字典：`common/map_names.json` 现提供 `zh/en/ru` 三语映射，网页按当前语言显示，导出继续使用中文。
- 空白元数据兜底：回放里仅含空格的录像者、昵称、版本号、地图翻译或时间戳会按缺失值处理，避免污染排行榜记录、汇总昵称和时间解析。
- GUI 支持选择文件或文件夹、预览数据、合并汇总或逐场导出。
- 回放预览列选择器会把单场/汇总的列可见性与排序分别记到 `localStorage`，新增列会自动补到当前顺序末尾。
- Java / Web 版提供 `/api/preview`、`/api/export`、`/api/columns`、`/api/rating`、`/api/health`、`/api/shutdown`。
- 排行榜（仅在线版 `postgres` profile）：上传随机战斗回放自动记录录像者单场伤害，`/api/leaderboard/top-damage` 等端点查询。
- 工具集首页首屏展示排行榜当前最高单场伤害记录；排行榜暂无数据或接口不可用时显示 `--`。
- **Keycloak 认证**：`https://auth.wotbtools.com` Keycloak 容器，realm `wotbtools`，client `wotbtools-web`。前端 `check-sso` 游客模式 + 登录/登出，注册入口由 Keycloak realm 托管。
- **个人中心**：`/profile` 页面显示用户名、登出按钮、排行榜记录；若当前用户是打手，还会展示进行中订单、历史订单，并可直接暂停/恢复接收新订单。未登录时展示"登入"按钮触发 Keycloak OIDC 流程。
- **陪练与打手申请**：`?view=boost` 页面支持玩家提交打手资格申请，管理员在资格审批中查看截图、联系方式和在线时间，审批通过后自动关联 Keycloak `booster` role 与打手资料。打手管理页会分别显示资格状态（`status`）和接单状态（由 `available + activeAssignmentCount` 推导为可接单/忙碌/暂停接单），分配时会优先推荐可接单且匹配度更高的打手；打手本人可在工作台接单、开始、提交完成或拒单，个人中心可回看历史订单，订单状态覆盖 `MATCHED/ACCEPTED/IN_PROGRESS/PENDING_CONFIRM/CLOSED/EXCEPTION`，并通过站内通知提醒相关用户。
- **工具集主页**：Vue SPA 内 `HomePage.vue`（卡片入口 + 版本历史），版本历史数据来自 `frontend/src/data/versions.json`。
- **域名统一**：`wotbtools.com` 和 `www.wotbtools.com`，去除 `replay.wotbtools.com` 子域名。
- **管理员用户管理**：`/api/admin/users` API 搜索/查看/删除用户，Keycloak Admin API 集成，审计日志 `admin_user_log` 表，`wotbtools-admin` 角色权限控制。
- **移动端顶栏**：回放解析、排行榜、个人中心、陪练和管理员页面共享同一套响应式顶栏；主题/语言/账号入口自动换行，不压缩主题切换器。
- **上传区图标**：回放解析与排行榜上传区共用描边 SVG 图标样式，原生文件控件隐藏在自定义按钮内。

> 排行榜支持按车辆筛选（点击车辆名查看专属伤害榜），URL 参数 `?view=leaderboard` 可直接跳转排行榜视图。

## 从源码运行与构建

### Java 版

需要 JDK 21、Maven、Node.js。

```bat
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml -DskipTests -pl wotb-core,wotb-web -am install
java -jar wotb-web\target\wotb-web.jar
```

> Windows 环境默认 `java` 可能是 JDK 8。执行 Maven 前请先把 `JAVA_HOME` 指向 JDK 21。

## 更新车辆库

车辆库 `common/tankopedia.json` 是**单一来源**，由 `update_tankopedia.py`
从 blitzkit 的 `tanks.pb` 转换生成，包含车辆基础信息和 `alphaDamage`。游戏新增车辆后重新拉取即可（需要网络）：

```bat
cd common/python
python update_tankopedia.py
```

无需手动同步：`wotb-core` 构建时会自动把 `common/tankopedia.json` 复制到 classpath。

## 测试

Java 侧：

```bash
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml test
```

## 主要目录

| 路径                            | 说明                                          |
|-------------------------------|---------------------------------------------|
| `common/`                     | 共享资源：`tankopedia.json`、`rating.json`、`map_names.json`、`assets/`（logo/favicon 单一来源）、`data/`（示例回放） |
| `common/python/`              | 车辆库更新脚本（`update_tankopedia.py`）    |
| `java/`                       | Java 主线（wotb-core + wotb-web）                   |
| `java/wotb-core/`             | 共享核心库：解析、protobuf 解码、pickle 读取、汇总、POI 导出     |
| `java/wotb-web/`              | Spring Boot 4 应用：REST API + Leaderboard + Flyway |
| `frontend/`                   | Vue 3 前端（含工具集主页 HomePage.vue、三语 locale、共享主题变量） |
| `frontend/src/data/`          | 纯前端数据（版本历史 versions.json） |
| `docker/online/`              | 开发者本地：`docker compose up -d --build` 编译启动（四容器含 keycloak） |
| `docker/`                     | Dockerfile.backend / Dockerfile.frontend / keycloak (realm) |
| `deploy/`                     | `nginx/` 配置 + `init-db.sql` |
| `.github/workflows/`          | CI/CD 自动部署 |

## 数据来源与限制

`.wotbreplay` 本质是 zip 包，当前工具使用其中的：

- `meta.json`：地图、版本、开始时间、时长、录像者等基础信息。
- `battle_results.dat`：pickle 包装的 `(arenaId, protobufBytes)`，其中 protobuf 包含玩家战绩。
- `data.wotreplay`：BigWorld 事件流，用于存活时间推算（Type 8 EntityMethod 伤害事件）。

项目不解析完整战斗过程流，因此不会输出逐帧轨迹、每发炮弹弹道等事件级数据。
