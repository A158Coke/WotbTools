# WoT Blitz Replay Data Extractor - Java 主线

`java/` 是项目后续主线。目标不是只做 Web 版，而是基于同一套 Java 核心能力交付两种形态：

- Java 离线 exe：无须安装 Python，双击运行，本地选择/拖拽回放并导出 Excel。
- Web 版：Spring Boot 4 后端，前端暂定 Vue 3，支持浏览器上传、预览、下载。

当前代码已经具备 `wotb-core`、Spring Boot API 和 Vue 前端雏形；离线 exe 还未完成。路线图见 [../TODO.md](../TODO.md)。

## 模块

| 模块 | 说明 |
| --- | --- |
| `wotb-core` | 核心库：解压回放、读取 pickle、解码 protobuf、车辆库映射、去重汇总、POI 导出 xlsx |
| `wotb-web` | Spring Boot 4 REST API，监听 `8087` |
| `frontend` | Vue 3 + Vite 前端，开发端口 `5173`，Docker 运行时由 nginx 暴露 `8088` |

计划新增或补齐：

- `wotb-desktop` 或等价离线启动模块：承载 Java 离线 exe 的入口。
- `jpackage` 构建脚本：输出 Windows exe / installer。
- 前端静态资源打包到 Spring Boot 的流程：为“本地 Spring Boot + 内置 Web UI”离线模式服务。

## Docker 运行

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

## Java 离线 exe 目标

离线 exe 的推荐路线：

1. 复用 `wotb-core` 做解析、汇总和 Excel 导出。
2. 复用现有 Vue 前端作为本地 UI，构建后放入 `wotb-web/src/main/resources/static/` 或构建产物复制目录。
3. 由 Spring Boot 在本机随机或固定端口启动服务，并打开默认浏览器。
4. 使用 `jpackage` 打包 runtime、jar、图标和启动脚本，生成 Windows exe。

也可以选择 JavaFX/Swing 原生 UI，但当前已有 Vue 前端，因此优先路线是“本地 Spring Boot + 内置 Vue 静态资源 + jpackage”。

## API

### `GET /api/health`

返回服务状态和已加载车辆数量。

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

`multipart/form-data`，字段名为 `files`。

返回 xlsx：

- 单场：单场工作簿。
- 多场：按 `arenaUniqueId` 去重后的汇总工作簿。

## 测试

```bash
cd java
mvn -s settings.xml test
```

测试覆盖：

- `wotb-core` 的解析、字段一致性、去重、汇总、xlsx 导出。
- `wotb-web` 的 `/api/columns`、`/api/preview`、`/api/export`。

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
```

注意：父 `java/pom.xml` 和 `wotb-web/pom.xml` 中的 Spring Boot 版本声明需要收敛；当前 Web 模块实际声明 `4.1.0`，项目目标按 Spring Boot 4 维护。

## 维护注意

- Java 版字段号、列定义和汇总规则应与 Python 版同步。
- 修改解析逻辑后同时更新 `wotb-core` 测试和 Python `test_wotb.py`。
- 修改前端表格列时优先从 `/api/columns` 获取列定义，不要在前端硬编码业务字段。
- `wotb-core/src/main/resources/tankopedia.json` 应与根目录 `tankopedia.json` 保持一致。
- 离线 exe 和 Web 版必须复用同一个 `wotb-core`，不要复制解析逻辑。
