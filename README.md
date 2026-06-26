# WoTBTools

《坦克世界闪击战》（World of Tanks Blitz）工具集。

已上线工具：从 `.wotbreplay` 回放文件中提取战斗数据导出 Excel、在线伤害排行榜。

项目主线为 Java：**Java 离线版**、**Web 版** 与 **工具集主页** 均已完成。

## 当前目标

| 目标          | 技术方向                                           | 状态            |
|-------------|------------------------------------------------|---------------|
| Java 离线版 | Docker Desktop + 拉取镜像 | ✅ 已完成         |
| Web 版       | Spring Boot 4 + Vue 3 + PostgreSQL + Docker | ✅ 已完成         |
| 工具集主页    | 暗色卡片式入口 + 主题切换 + 三语 i18n | ✅ 已完成         |

在线演示：https://replay.wotbtools.com
工具集主页：https://wotbtools.com

版本历史见 [CHANGELOG.md](CHANGELOG.md)，任务拆分见 [TODO.md](TODO.md)。

## 当前实现

| 版本          | 技术栈                                        | 入口                                                   | 适用场景                     |
|-------------|--------------------------------------------|------------------------------------------------------|--------------------------|
| Java 离线版 | Docker Desktop + pull 镜像 | `offline\start.bat` | 双击启动、首次需联网（安装 Docker + 拉镜像）、本地浏览器 UI       |
| Java Web 版  | Java 21 + Spring Boot 4 + Vue 3 + Docker | `online\` 本地开发；CI/CD → `a158coke/wotbtool` 双镜像 | 浏览器上传、在线预览、排行榜、REST API |

文档入口：

- 本文件：项目概览、Java 版使用与构建。
- [HANDOVER.md](HANDOVER.md)：**交接 / AI 工具迁移总入口**（环境坑、CI/CD、部署、约定一站式）。
- [java/README.md](java/README.md)：Java / Web 版运行、接口、部署、离线版分发。
- [CHANGELOG.md](CHANGELOG.md)：版本历史（对外）。
- [TODO.md](TODO.md)：待办事项。
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)：维护上下文、架构、回放格式、i18n、测试策略。
- [docs/replay-data.md](docs/replay-data.md)：data.wotreplay 事件流格式、protobuf 字段表、死亡时间推算。
- [docs/rating-system.md](docs/rating-system.md)：评分算法、参数、展示。

## 功能

- 品牌展示：logo 与 favicon（`common/assets/` 单一来源，Docker 构建时分发至首页与前端）
- 解析单个 `.wotbreplay` 中的 14 名玩家战斗数据。
- 读取 `meta.json` 战斗信息、`battle_results.dat` pickle + protobuf、`data.wotreplay` 事件流。
- 使用 `tankopedia.json` 将车辆 ID 映射为车辆名、等级、类型和国家。
- 单场导出 Excel：`战斗信息`、`玩家数据`、`原始字段`。
- 多场导出 Excel：按 `arenaUniqueId` 去重，生成 `汇总`、`明细`、`战斗列表`。
- 存活时间列：基于伤害事件的秒级估算。
- 自包含表现**评分**：按车型基准归一化（类 WN8，1000=同型平均），单场「评分」、汇总「场均评分」。
- GUI 支持选择文件或文件夹、预览数据、合并汇总或逐场导出。
- Java / Web 版提供 `/api/preview`、`/api/export`、`/api/columns`、`/api/rating`、`/api/health`、`/api/shutdown`。
- 排行榜（仅在线版 `postgres` profile）：上传随机战斗回放自动记录录像者单场伤害，`/api/leaderboard/top-damage` 等端点查询。
- Java 离线版：双击 `start.bat`，拉取 Docker 镜像，自动打开浏览器，无需源码或 JDK。

> 排行榜支持按车辆筛选（点击车辆名查看专属伤害榜），URL 参数 `?view=leaderboard` 可直接跳转排行榜视图。

## 快速使用：离线版

**前提**：首次运行需联网（安装 Docker、拉取镜像）。后续可离线使用。

脚本自动检测 Docker：未安装则询问是否自动安装（Windows 调用 winget，macOS 调用 Homebrew，Linux 调用 get.docker.com）。用户拒绝则需手动安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)。

- Windows：双击 `offline\start.bat`
- macOS / Linux：终端运行 `offline/start.sh`

脚本自动检测系统 → 安装/检查 Docker → 拉取最新镜像 → 启动 → 打开浏览器 `http://localhost:8088`。停止：`docker compose -f offline/docker-compose.yml down`。

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

### 离线版（用户分发，首次需联网）

```bat
cd offline
start.bat
```

脚本自动检测系统 → 未安装 Docker 则询问是否自动安装（winget / Homebrew / get.docker.com）→ 拉取镜像 → 启动 → 打开浏览器 `http://localhost:8088`。首次需联网，后续离线可用。

详细说明见 [java/README.md](java/README.md)。

## 更新车辆库

车辆库 `common/tankopedia.json` 是**单一来源**，由 `update_tankopedia.py`
从 blitzkit 的 `tanks.pb` 转换生成。游戏新增车辆后重新拉取即可（需要网络）：

```bat
cd python
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
| `homepage/`                   | 工具集主页（`wotbtools.com`，暗色卡片式单页）|
| `common/`                     | 共享资源：`tankopedia.json`、`rating.json`、`map_names.json`、`assets/`（logo/favicon 单一来源）、`data/`（示例回放） |
| `common/python/`              | 车辆库更新脚本（`update_tankopedia.py`）    |
| `java/`                       | Java 主线（wotb-core + wotb-web）                   |
| `java/wotb-core/`             | 共享核心库：解析、protobuf 解码、pickle 读取、汇总、POI 导出     |
| `java/wotb-web/`              | Spring Boot 4 应用：REST API + Leaderboard + Flyway |
| `frontend/`                   | Vue 3 前端（composables + utils + 组件）                  |
| `offline/`                    | 离线版分发：`start.bat` / `start.sh` 一键拉镜像启动 |
| `online/`                     | 开发者本地：`docker compose up --build` 编译启动 |
| `docker/`                     | Dockerfile.backend / Dockerfile.frontend |
| `deploy/nginx/`               | nginx 配置（双 server：主页 + Vue SPA） |
| `.github/workflows/`          | CI/CD 自动部署 |

## 数据来源与限制

`.wotbreplay` 本质是 zip 包，当前工具使用其中的：

- `meta.json`：地图、版本、开始时间、时长、录像者等基础信息。
- `battle_results.dat`：pickle 包装的 `(arenaId, protobufBytes)`，其中 protobuf 包含玩家战绩。
- `data.wotreplay`：BigWorld 事件流，用于存活时间推算（Type 8 EntityMethod 伤害事件）。

项目不解析完整战斗过程流，因此不会输出逐帧轨迹、每发炮弹弹道等事件级数据。