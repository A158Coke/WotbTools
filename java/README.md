# WoT Blitz Tools - Java 主线

`java/` 是项目主线。基于同一套 Java 核心能力交付：

- **Web 版**：Spring Boot 4 后端，Vue 3 前端，支持浏览器上传、预览、下载。

当前 Web 版已实现。路线图见 [../TODO.md]。

## 模块

| 模块/目录       | 说明                                                           |
|-------------|--------------------------------------------------------------|
| `wotb-core` | 核心库：解压回放、读取 pickle、解码 protobuf、车辆库映射、去重汇总、POI 导出 xlsx        |
| `wotb-web`  | Spring Boot 4 REST API + PostgreSQL/Flyway/Keycloak，监听 `8087` |
| `frontend`  | Vue 3 + Vite 前端，单文件组件，无 router，开发端口 `5173`                   |
| `docker/online/` | `docker-compose.yml`：`build:` 从源码编译运行四容器（postgres + keycloak + backend + frontend） |

> 车辆库 `common/tankopedia.json` 与地图名映射 `common/map_names.json`（仓库根的共享目录）都会在 `wotb-core` 构建时自动复制到 classpath，无需在模块内再放副本。

## Web 版（Docker + PostgreSQL）

```bash
cd ..\docker\online
docker compose up -d --build
```

访问 http://localhost:8088 （健康检查 `http://localhost:8088/api/health`）。

`docker/online/docker-compose.yml` 启动**四容器**（`postgres:18` + `keycloak` + `wotb-backend` + `wotb-frontend`），后两者分别构建 `docker/Dockerfile.backend` 和 `docker/Dockerfile.frontend`。nginx 托管 Vue + 反代 `/api → wotb-backend:8087`，后端连接 PostgreSQL 并由 Flyway 管理 schema。

赞助页从 `/sponsor-config.json` 读取运行时配置。生产配置保存在 `/opt/wotb/config/sponsor-config.json`，二维码保存在 `/opt/wotb/config/sponsor/`，以只读方式挂载到前端容器；仓库仅提供 disabled 示例配置，不包含个人收款二维码。

### CI/CD 自动部署

`push` 到 `main` 分支触发 GitHub Actions（[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)）：

1. 按完整 push change range 判断后端、前端、Keycloak 和部署脚本是否变化。
2. 后端先跑 `mvn test`；前端先跑 `npm ci && npm test && npm run build`。测试失败不会构建或部署镜像。
3. 按需构建并推送 backend/frontend/keycloak 镜像到 GHCR。
4. SSH 部署前先备份 `wotb` 与 `keycloak` 两个数据库，再 `docker compose pull && up -d`。
5. 部署等待 `wotb-backend` 的 `/api/health` 成功；失败会输出后端/前端日志并让 workflow 失败。

线上 502 排查可手动运行 [`.github/workflows/prod-diagnostics.yml`](../.github/workflows/prod-diagnostics.yml)，读取 VPS compose 状态与后端/前端日志。

> 四个容器：`postgres:18`（数据持久化，卷挂 `/var/lib/postgresql`）→ `keycloak`（认证，`auth.wotbtools.com`）→ `wotb-backend`（Spring Boot 8087）→ `wotb-frontend`（nginx + Vue，暴露 8088:80）。`paths` 过滤使纯文档 push 不触发部署。

## 本地开发

后端需要 JDK 21；完整运行使用四容器开发环境，确保 PostgreSQL、Keycloak 与必要环境变量同时存在。

```bash
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml test
cd ../docker/online
docker compose up -d --build
```

前端：

```bash
cd frontend
npm install
npm run dev
```

Vite 开发服会把 `/api` 代理到 `http://localhost:8087`。

## API

### `GET /api/health`

返回服务状态与已加载车辆数量。

所有 JSON API 只返回英文 key、raw enum 与稳定 `code`/`error`；不返回本地化 `*Label` 或 `message`。前端通过三语 locale 显示状态、成功和错误文案。
未显式声明的 `/api/**` 默认拒绝；`boost-manager` 仅能访问 `/api/admin/boost/**`。


列定义由后端 `/api/preview` 响应中的 `playerColumns`/`aggregateColumns` 字段和 `/api/columns` 提供（纯英文 key）；实时 rating 使用 `ratingColumns`。
前端用 `vue-i18n` 三语 locale（`frontend/src/locales/{zh,en,ru}.json` 的 `player_labels` / `agg_labels` / `rating_labels`）映射显示名，
导出层（单场 `Columns.java`、汇总 `AggregateSheets.java`）各自维护 xlsx 表头。回放页列选择器会把单场/汇总两套列顺序与可见性记到 `localStorage`，
并在后端新增列时自动补齐缺失键。详见 [DEVELOPER_GUIDE.md](../docs/DEVELOPER_GUIDE.md) 的「显示名（i18n）架构」。


地图名由共享字典 `common/map_names.json` 提供 `zh/en/ru` 三语映射；前端 `mapLabel()` 按当前 locale 取值，导出层 `MapNames.cn()` 继续固定使用中文。


扩展页 `/extended` 可展示原回放页隐藏的扩展字段：`alpha_damage`、`rank`、`potential_damage`、`potential_damage_supplement`、`potential_damage_detail`。
这些字段仍会出现在 API 与导出列定义中，原回放页面的列选择器会过滤扩展专用字段。`xp`、`credits` 仅在 parser/model 保留，不作为战绩字段展示。


### `GET /api/rating`

返回当前生效的评分参数（取自 `common/rating.json`），供前端「评分规则」弹窗实时展示算法与真实权重：

```json
{ "assist": 0.6, "block": 0.35, "killValue": 200, "winBonus": 0.05,
  "minSamples": 5, "scale": 1000,
  "classFactor": { "HEAVY_TANK": 1.0, "MEDIUM_TANK": 0.9, "TANK_DESTROYER": 1.0, "LIGHT_TANK": 0.7, "OTHER": 0.9 } }
```



### `POST /api/rating`

`multipart/form-data`，字段名为 `files`。只基于本次上传回放实时计算，不落库、不读取历史记录。

返回：

- `rows`：每名选手的 `rating`、`kast`、`contribution`、`impact`、`assist_avg`、`multi_damage_rate`、`damage_avg`、`potential_damage_avg`、`kills` 等。
- `duplicates` / `failures`：与 `/api/preview` 相同的去重和失败信息。
- `ratingColumns`：纯英文 key + 是否数值，前端由三语 `rating_labels` 显示。

前端可从 SPA 的 `?view=extended` 或独立 `/extended` 入口进入。

### `POST /api/preview`

`multipart/form-data`，字段名为 `files`，可上传一个或多个 `.wotbreplay`。

入口限制：最多 100 个文件，单文件不超过 20 MiB，请求合计不超过 200 MiB；每个应用实例默认最多同时处理 2 个解析任务（`REPLAY_MAX_CONCURRENT_JOBS` 可调），容量满返回 HTTP 503 + `REPLAY_BUSY`。ZIP、pickle、protobuf、单场玩家数与事件流包/扫描次数另有独立预算。

返回：

- 去重后的战斗列表。
- 每场玩家数据。
- 多场上传时的跨场汇总。
- 重复文件与失败文件信息。
- 列定义。

### `POST /api/export`

`multipart/form-data`，字段名为 `files`。可选 `?mode=aggregate`（默认）或 `?mode=each`。

返回：

- `mode=aggregate`（默认）：返回 xlsx。仅一场战斗时为单场工作簿；多场时为按 `arenaUniqueId` 去重后的汇总工作簿。
- `mode=each`：返回 zip（`逐场导出.zip`），内含每场各自的单场 xlsx；无法解析的文件会被跳过。

### 排行榜

每条记录 = 录像者本人在一场**随机战斗**（`arenaBonusType==1`，训练房/娱乐/联赛拒绝）中用某辆车打出的单场伤害；通过排行榜上传入口写入（去重键 `arena_id + account_id`）。

- `GET /api/leaderboard/top-damage?page=1&size=50` — 全局伤害榜（降序，`size` 最大 200）。
- `GET /api/leaderboard/tanks/{tankId}/top-damage?page=1&size=50` — 指定车辆伤害榜。
- `POST /api/leaderboard/upload` — 上传单场回放；跳过时返回英文 `reasonCode`，由前端本地化。

### 陪练与打手（仅在线版）

`GET /api/booster/assignments` 默认返回当前登录打手的活跃订单；追加 `?includeHistory=true` 时返回活跃 + 历史订单（活跃优先、历史按分配时间倒序），供个人中心回看已完成/已取消/已拒绝订单。`PATCH /api/boost/boosters/my/availability` 允许打手本人切换 `available`，用于暂停/恢复接收新订单，并返回最新 `BoosterDto` 给个人中心即时刷新。打手可通过 `PATCH /api/booster/assignments/{id}/accept|start|complete|decline` 流转自己的订单；提交完成后需求进入 `PENDING_CONFIRM`，客户调用 `PATCH /api/boost/requests/my/{id}/confirm-completion` 确认为 `CLOSED`。若客户未操作，系统默认 72 小时后自动确认；管理员也可关闭 `PENDING_CONFIRM`/`EXCEPTION` 订单。三条入口共用带行锁的幂等完结路径，同时把分配置为 `COMPLETED`、写入 `unassigned_at` 并释放打手。管理员分配订单时要求打手资格为 `ACTIVE`、未暂停接单且没有活跃订单；前端会按资格、接单状态、活跃订单数、等级和擅长内容推荐排序。

完成确认窗口由 `BOOST_AUTO_CONFIRM_HOURS` 配置（默认 `72`），到期扫描间隔由 `BOOST_AUTO_CONFIRM_SCAN_MS` 配置（默认 `300000` 毫秒）；线上部署可用同名 GitHub repository variables 覆盖。Flyway V11 会给已有 `PENDING_CONFIRM` 订单从迁移时刻起补一个 72 小时窗口。

`DELETE /api/admin/boost/boosters/{id}` 会保留资格申请并清空其 `approved_booster_id`；存在任意订单分配历史时以 `BOOSTER_HAS_DEPENDENCIES` 拒绝。管理员删除用户时会先复用该流程清理关联打手档案，再删除本地资料与 Keycloak 用户。

`GET /api/users/notifications`、`GET /api/users/notifications/unread-count`、`PATCH /api/users/notifications/{id}/read` 和 `PATCH /api/users/notifications/read-all` 提供站内通知基础能力。通知 API 返回英文 `type` 与 `payload` 数据，具体文案由前端三语 i18n 渲染。

## 测试

```bash
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml test
```

测试覆盖：

- `wotb-core` 的 `ParityTest`：集成测试，覆盖解析、字段不变量、去重、汇总、xlsx 导出。
- `wotb-web` 的 boost / leaderboard / security / API 契约单元测试都会执行；无需数据库的 controller 契约已拆出，始终运行。
- `WebApiTest` 只保留 PostgreSQL/真实回放集成路径；无 Docker 或无 `common/data` 时按条件跳过。

测试样本来自仓库根目录的 `common/data/`。

前端测试与构建：

```bash
cd frontend
npm test
npm run build
```

## 生产备份与恢复

- `.github/workflows/database-backup.yml` 每日香港时间 03:15 备份 `wotb` 与 `keycloak`；部署前也会自动备份。
- 归档在 `/opt/wotb/backups/{wotb,keycloak}/`，通过 catalog + 全压缩数据读取校验，按数据库分别保留 7 天。
- 查看归档：`deploy/postgres-backup-inspect.sh <archive.dump>`。
- 恢复：`deploy/postgres-restore.sh --database wotb|keycloak --file <archive.dump> --confirm RESTORE-<database>`。脚本会先做安全备份；恢复失败时依赖服务保持停止，需人工处理。

## 构建配置

项目使用独立 Maven 配置，避免污染或依赖用户全局 Maven 设置：

- `java/settings.xml`：仓库跟踪的可移植本地 Maven settings；在 `java/` 目录执行时使用独立仓库 `java/.m2repo`，干净 clone 无需生成。
- `java/settings-docker.xml`：Docker 构建用 Maven settings。
- `frontend/package-lock.json`：固定前端依赖版本。

默认端口在 `wotb-web/src/main/resources/application.yml`：

```yaml
server:
  port: 8087
spring:
  servlet:
    multipart:
      max-file-size: 20MB
      max-request-size: 200MB
  web:
    resources:
      static-locations: classpath:/static/
wotb:
  replay:
    max-concurrent-jobs: ${REPLAY_MAX_CONCURRENT_JOBS:2}
```

## 维护注意

- 列定义在 `wotb-core/.../Columns.java` 中集中管理，前端通过 `/api/preview` 响应获取列定义，不在前端硬编码业务字段。
- 车辆库单一来源在 `common/tankopedia.json`；`wotb-core` 构建时自动复制到 classpath，勿在模块内再放副本。
