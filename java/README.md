# WoT Blitz Replay Data Extractor - Java 主线

`java/` 是项目后续主线。基于同一套 Java 核心能力同时交付两种形态：

- **Java 离线 exe**：无须安装 JDK，双击运行，自动打开浏览器，本地选择/拖拽回放并导出 Excel。
- **Web 版**：Spring Boot 4 后端，Vue 3 前端，支持浏览器上传、预览、下载。

当前两种形态均已实现。路线图见 [../TODO.md](../TODO.md)。

## 模块

离线版与联网版**共用同一套源码**（`wotb-core` + `wotb-web` + `frontend`），区别只在打包/部署方式，分别放在 `offline/` 与 `online/`。

| 模块/目录       | 共享? | 说明                                                           |
|-------------|------|--------------------------------------------------------------|
| `wotb-core` | 共享 | 核心库：解压回放、读取 pickle、解码 protobuf、车辆库映射、去重汇总、POI 导出 xlsx        |
| `wotb-web`  | 共享 | Spring Boot 4 REST API + 桌面模式入口，监听 `8087`（Web 模式）或自动端口（桌面模式） |
| `frontend`  | 共享 | Vue 3 + Vite 前端，单文件组件，无 router，开发端口 `5173`                   |
| `offline/`  | 离线 | `build-desktop.bat`（前端构建 → Maven 打包 → jpackage），产物 `offline/dist-desktop/` |
| `online/`   | 联网 | `docker-compose.yml`：本地构建并运行根 `Dockerfile` 单镜像（与 CI/CD 同一镜像） |

> 车辆库 `common/tankopedia.json`（仓库根的共享目录）在 `wotb-core` 构建时自动复制到 classpath，无需在模块内再放一份。

## 离线 exe（桌面模式）

离线 exe 采用"本地 Spring Boot + 内置 Vue 静态资源 + jpackage"方案：

1. Vue 前端构建产物（`frontend/dist/`）在 Maven 构建时自动复制到 JAR 的 `classpath:/static/`。
2. 启动时检测 `--desktop` 参数，自动选择可用端口、绑定 `127.0.0.1`、打开默认浏览器。
3. 前端通过 `/api/health` 的 `desktop` 字段识别桌面模式，显示"关闭离线程序"按钮。
4. `POST /api/shutdown` 优雅关闭服务并退出 JVM（仅桌面模式可用）。

### 构建

脚本会自动检测：`tools/` 便携工具 → `%USERPROFILE%\.jdks\jdk-21*` → 系统 PATH。全都没有则**自动下载**到 `java\offline\tools\`，宿主机只需联网，无需预装任何工具。

```bash
cd java\offline
build-desktop.bat
```

> **首次运行**会下载 JDK 21、Maven、Node.js 到 `tools/`（~200MB），缓存后后续离线也可构建。
>
> 用 `--no-download` 禁止自动下载（仅用已有工具或 PATH）。
>
> **注意：构建产物 `dist-desktop/` 不在仓库里**（已 gitignore）。新克隆的人按上面自行构建，或用他人打包的 `WoT Blitz Replay Extractor` 文件夹。

输出：

```
java/offline/dist-desktop/WoT Blitz Replay Extractor/
  ├── WoT Blitz Replay Extractor.exe
  ├── app/
  └── runtime/
```

### 运行

```bat
offline\dist-desktop\WoT Blitz Replay Extractor\WoT Blitz Replay Extractor.exe
```

双击即可，无需 JDK 或 Node.js。首次启动可能略慢（JVM 启动）。

## Web 版（Docker）

```bash
cd java\online
docker compose up --build
```

访问 http://localhost:8088 （健康检查 `http://localhost:8088/api/health`）。

`java/online/docker-compose.yml` 构建并运行**与 CI/CD 完全相同的根 `Dockerfile` 单镜像**（`context: ../..` = 仓库根，因 Dockerfile 需要 `common/*.json` + `java/`）。单容器内 nginx(:80) 托管 Vue 静态资源，并把 `/api` 反代到同容器的 Spring Boot(:8087)；后端无状态、不落库。仓库根 `.dockerignore` 负责排除 `node_modules`/`target`/`dist` 等，避免上下文过大。

### CI/CD 自动部署

`push` 到 `main` 分支触发 GitHub Actions（[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)）：

1. 并行构建两个镜像：`Dockerfile.backend`（Maven + JRE）+ `Dockerfile.frontend`（Node + nginx）。
2. 推送 `a158coke/wotbtool:backend-sha-<SHA>` + `frontend-sha-<SHA>` + `backend-latest` + `frontend-latest` 到 Docker Hub。
3. SSH 登录 VPS，写入三服务 `docker-compose.yml`（postgres + wotb-backend + wotb-frontend），`docker compose pull && up -d`。

> 三个容器：`postgres:18`（数据持久化）→ `wotb-backend`（Spring Boot 8087）→ `wotb-frontend`（nginx + Vue，暴露 8088:80）。homepage 作为 volume 挂载，不编进镜像。`paths` 过滤使纯文档 push 不触发部署。

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
cd java/frontend
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

### `GET /api/columns`

返回列的**集合与顺序**（纯英文，不含中文显示名）：每项为 `{key, num}`。

- `player`：单场玩家数据列。
- `aggregate`：多场汇总列。

显示名不在 API 里：前端用 `vue-i18n` 三语 locale（`frontend/src/locales/{zh,en,ru}.json` 的 `player_labels` / `agg_labels`），导出层（单场 `Columns.java`、汇总 `AggregateSheets.java`）各自维护 xlsx 表头。详见 [../DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md) 的「显示名（i18n）架构」。

### `GET /api/rating`

返回当前生效的评分参数（取自 `common/rating.json`），供前端「评分规则」弹窗实时展示算法与真实权重：

```json
{ "assist": 0.6, "block": 0.35, "killValue": 200, "winBonus": 0.05,
  "minSamples": 5, "scale": 1000, "classFactor": { "重坦": 1.0, "中坦": 0.9, "TD": 1.0, "轻坦": 0.7, "其他": 0.9 } }
```

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

## 测试

```bash
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml test
```

测试覆盖：

- `wotb-core` 的 `ParityTest`：集成测试，覆盖解析、字段不变量、去重、汇总、xlsx 导出。
- `wotb-web` 的 `WebApiTest`：`/api/columns`、`/api/preview`、`/api/export` 的 controller 测试。

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

- 列定义在 `wotb-core/.../Columns.java` 中集中管理，前端通过 `/api/columns` 获取，不在前端硬编码业务字段。
- 车辆库单一来源在 `common/tankopedia.json`；`wotb-core` 构建时自动复制到 classpath，勿在模块内再放副本。
- 离线 exe 和 Web 版复用同一个 `wotb-core`，不复制解析逻辑。
