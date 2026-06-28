# WoT Blitz Replay Data Extractor - Java 主线

`java/` 是项目主线。基于同一套 Java 核心能力交付：

- **Web 版**：Spring Boot 4 后端，Vue 3 前端，支持浏览器上传、预览、下载。

当前 Web 版已实现。路线图见 [../TODO.md](../TODO.md)。

## 模块

| 模块/目录       | 说明                                                           |
|-------------|--------------------------------------------------------------|
| `wotb-core` | 核心库：解压回放、读取 pickle、解码 protobuf、车辆库映射、去重汇总、POI 导出 xlsx        |
| `wotb-web`  | Spring Boot 4 REST API + 桌面模式入口，监听 `8087`（Web 模式）或自动端口（桌面模式） |
| `frontend`  | Vue 3 + Vite 前端，单文件组件，无 router，开发端口 `5173`                   |
| `docker/online/` | `docker-compose.yml`：`build:` 从源码编译运行四容器（postgres + keycloak + backend + frontend） |

> 车辆库 `common/tankopedia.json`（仓库根的共享目录）在 `wotb-core` 构建时自动复制到 classpath，无需在模块内再放一份。

## Web 版（Docker + PostgreSQL）

```bash
cd ..\docker\online
docker compose up -d --build
```

访问 http://localhost:8088 （健康检查 `http://localhost:8088/api/health`）。

`docker/online/docker-compose.yml` 启动**四容器**（`postgres:18` + `keycloak` + `wotb-backend` + `wotb-frontend`），后两者分别构建 `docker/Dockerfile.backend` 和 `docker/Dockerfile.frontend`。nginx 托管 Vue + 反代 `/api → wotb-backend:8087`，后端通过 `SPRING_PROFILES_ACTIVE: postgres` 连接 PostgreSQL。

### CI/CD 自动部署

`push` 到 `main` 分支触发 GitHub Actions（[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)）：

1. 并行构建两个镜像：`Dockerfile.backend`（Maven + JRE）+ `Dockerfile.frontend`（Node + nginx）。
2. 推送 `a158coke/wotbtool:backend-sha-<SHA>` + `frontend-sha-<SHA>` + `backend-latest` + `frontend-latest` 到 Docker Hub。
3. SSH 登录 VPS，写入四服务 `docker-compose.yml`（postgres + keycloak + wotb-backend + wotb-frontend），`docker compose pull && up -d`。

> 四个容器：`postgres:18`（数据持久化，卷挂 `/var/lib/postgresql`）→ `keycloak`（认证，`auth.wotbtools.com`）→ `wotb-backend`（Spring Boot 8087）→ `wotb-frontend`（nginx + Vue，暴露 8088:80）。`paths` 过滤使纯文档 push 不触发部署。

## 本地开发

后端需要 JDK 21。

```bash
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml -DskipTests -pl wotb-core,wotb-web -am install
java -jar wotb-web/target/wotb-web.jar
```

前端：

```bash
cd frontend
npm install
npm run dev
```

Vite 开发服会把 `/api` 代理到 `http://localhost:8087`。

### 桌面模式开发

```bash
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml -DskipTests -pl wotb-core,wotb-web -am install
java -jar wotb-web/target/wotb-web.jar --desktop
```

## API

### `GET /api/health`

返回服务状态、已加载车辆数量、是否桌面模式。

列定义由后端 `/api/preview` 响应中的 `playerColumns`/`aggregateColumns` 字段和 `/api/columns` 提供（纯英文 key）；实时 rating 使用 `ratingColumns`。前端用 `vue-i18n` 三语 locale（`frontend/src/locales/{zh,en,ru}.json` 的 `player_labels` / `agg_labels` / `rating_labels`）映射显示名，导出层（单场 `Columns.java`、汇总 `AggregateSheets.java`）各自维护 xlsx 表头。详见 [../DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md) 的「显示名（i18n）架构」。

扩展页 `/extended` 可展示原回放页隐藏的扩展字段：`alpha_damage`、`rank`、`potential_damage`、`potential_damage_supplement`、`potential_damage_detail`。这些字段仍会出现在 API 与导出列定义中，原回放页面的列选择器会过滤扩展专用字段。`xp`、`credits` 仅在 parser/model 保留，不作为战绩字段展示。

### `GET /api/rating`

返回当前生效的评分参数（取自 `common/rating.json`），供前端「评分规则」弹窗实时展示算法与真实权重：

```json
{ "assist": 0.6, "block": 0.35, "killValue": 200, "winBonus": 0.05,
  "minSamples": 5, "scale": 1000, "classFactor": { "重坦": 1.0, "中坦": 0.9, "TD": 1.0, "轻坦": 0.7, "其他": 0.9 } }
```



### `POST /api/rating`

`multipart/form-data`，字段名为 `files`。只基于本次上传回放实时计算，不落库、不读取历史记录。

返回：

- `rows`：每名选手的 `rating`、`kast`、`contribution`、`influence`、`damage_avg`、`potential_damage_avg`、`kills` 等。
- `duplicates` / `failures`：与 `/api/preview` 相同的去重和失败信息。
- `ratingColumns`：纯英文 key + 是否数值，前端由三语 `rating_labels` 显示。

独立前端入口为 `/extended`，不在当前回放解析页面增加跳转按钮。

### `POST /api/preview`

`multipart/form-data`，字段名为 `files`，可上传一个或多个 `.wotbreplay`。

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

### `POST /api/shutdown`

仅桌面模式可用。优雅关闭后端服务并退出 JVM。

### 排行榜（仅 `postgres` profile）

仅在线版提供，需数据库。桌面版不暴露这些端点。每条记录 = 录像者本人在一场**随机战斗**（`arenaBonusType==1`，训练房/娱乐/联赛拒绝）中用某辆车打出的单场伤害；上传 `/api/preview` 时自动落库（去重键 `arena_id + account_id`）。

- `GET /api/leaderboard/top-damage?limit=50` — 全局伤害榜（降序，`limit` 1–200）。
- `GET /api/leaderboard/tanks/{tankId}/top-damage?limit=50` — 指定车辆伤害榜。

## 测试

```bash
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml test
```

测试覆盖：

- `wotb-core` 的 `ParityTest`：集成测试，覆盖解析、字段不变量、去重、汇总、xlsx 导出。
- `wotb-web` 的 `WebApiTest`：`/api/columns`、`GET/POST /api/rating`、`/api/preview`、`/api/export` 的 controller 测试。

测试样本来自仓库根目录的 `common/data/`。

## 构建配置

项目使用独立 Maven 配置，避免污染或依赖用户全局 Maven 设置：

- `java/settings.xml`：本地开发 Maven settings，使用独立本地仓库 `java/.m2repo`。
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
```

桌面模式下会忽略 `server.port`，自动选择 8087+ 的可用端口。

## 维护注意

- 列定义在 `wotb-core/.../Columns.java` 中集中管理，前端通过 `/api/preview` 响应获取列定义，不在前端硬编码业务字段。
- 车辆库单一来源在 `common/tankopedia.json`；`wotb-core` 构建时自动复制到 classpath，勿在模块内再放副本。
