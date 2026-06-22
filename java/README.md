# WoT Blitz Replay Data Extractor - Java 主线

`java/` 是项目后续主线。基于同一套 Java 核心能力同时交付两种形态：

- **Java 离线 exe**：无须安装 Python / JDK，双击运行，自动打开浏览器，本地选择/拖拽回放并导出 Excel。
- **Web 版**：Spring Boot 4 后端，Vue 3 前端，支持浏览器上传、预览、下载。

当前两种形态均已实现。路线图见 [../TODO.md](../TODO.md)。

## 模块

| 模块                  | 说明                                                           |
|---------------------|--------------------------------------------------------------|
| `wotb-core`         | 核心库：解压回放、读取 pickle、解码 protobuf、车辆库映射、去重汇总、POI 导出 xlsx        |
| `wotb-web`          | Spring Boot 4 REST API + 桌面模式入口，监听 `8087`（Web 模式）或自动端口（桌面模式） |
| `frontend`          | Vue 3 + Vite 前端，单文件组件，无 router，开发端口 `5173`                   |
| `build-desktop.bat` | 离线 exe 构建脚本：前端构建 → Maven 打包 → jpackage                       |
| `dist-desktop/`     | jpackage 产物目录                                                |

## 离线 exe（桌面模式）

离线 exe 采用"本地 Spring Boot + 内置 Vue 静态资源 + jpackage"方案：

1. Vue 前端构建产物（`frontend/dist/`）在 Maven 构建时自动复制到 JAR 的 `classpath:/static/`。
2. 启动时检测 `--desktop` 参数，自动选择可用端口、绑定 `127.0.0.1`、打开默认浏览器。
3. 前端通过 `/api/health` 的 `desktop` 字段识别桌面模式，显示"关闭离线程序"按钮。
4. `POST /api/shutdown` 优雅关闭服务并退出 JVM（仅桌面模式可用）。

### 构建

需要 JDK 21、Maven、Node.js。

```bash
cd java
build-desktop.bat
```

输出：

```
dist-desktop/WoT Blitz Replay Extractor/
  ├── WoT Blitz Replay Extractor.exe
  ├── app/
  └── runtime/
```

### 运行

```bat
dist-desktop\WoT Blitz Replay Extractor\WoT Blitz Replay Extractor.exe
```

双击即可，无需 Python、JDK 或 Node.js。首次启动可能略慢（JVM 启动）。

## Web 版（Docker）

```bash
cd java
docker compose up --build
```

访问：

- 前端：http://localhost:8088
- 后端 API：http://localhost:8087
- 健康检查：http://localhost:8087/api/health

容器结构：

- `frontend`：nginx 托管 Vue 构建产物，并把 `/api` 反代到后端容器。
- `backend`：Spring Boot 服务，无状态处理上传文件，不落库。

## 本地开发

后端需要 JDK 21。

```bash
cd java
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
mvn -s settings.xml -DskipTests -pl wotb-core,wotb-web -am install
java -jar wotb-web/target/wotb-web.jar --desktop
```

## API

### `GET /api/health`

返回服务状态、已加载车辆数量、是否桌面模式。

### `GET /api/columns`

返回前端构建表格所需的列定义：

- `player`：单场玩家数据列。
- `aggregate`：多场汇总列。

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
mvn -s settings.xml test
```

测试覆盖：

- `wotb-core` 的 `ParityTest`：与 Python 版输出一致性的集成测试，覆盖解析、字段不变量、去重、汇总、xlsx 导出。
- `wotb-web` 的 `WebApiTest`：`/api/columns`、`/api/preview`、`/api/export` 的 controller 测试。

测试样本来自仓库根目录的 `Data/`。

## 构建配置

项目使用独立 Maven 配置，避免污染或依赖用户全局 Maven 设置：

- `java/settings.xml`：本地开发 Maven settings，使用独立本地仓库 `java/.m2repo`。
- `java/settings-docker.xml`：Docker 构建用 Maven settings。
- `frontend/package-lock.json`：固定前端依赖版本。

默认端口在 `wotb-web/src/main/resources/application.properties`：

```properties
server.port=8087
spring.servlet.multipart.max-file-size=20MB
spring.servlet.multipart.max-request-size=200MB
spring.web.resources.static-locations=classpath:/static/
```

桌面模式下会忽略 `server.port`，自动选择 8087+ 的可用端口。

## 维护注意

- Java 版字段号、列定义和汇总规则应与 Python 版同步。
- 修改解析逻辑后同时更新 `ParityTest` 和 Python `test_wotb.py`。
- 列定义在 `wotb-core/.../Columns.java` 中集中管理，前端通过 `/api/columns` 获取，不在前端硬编码业务字段。
- `wotb-core/src/main/resources/tankopedia.json` 应与根目录 `tankopedia.json` 保持一致。
- 离线 exe 和 Web 版复用同一个 `wotb-core`，不复制解析逻辑。
