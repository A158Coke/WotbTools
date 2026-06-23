# WoT Blitz Replay Data Extractor

从《坦克世界闪击战》（World of Tanks Blitz）的 `.wotbreplay` 回放文件中提取战斗数据，并导出为 Excel。

项目最早是 Python 离线工具：用 Python 解析、计算、导出，再通过 PyInstaller 封装为 exe。后续主线迁移到 Java，目前 Java 主线已同时交付两种形态：**Java 离线 exe** 和 **Web 版**。

## 当前目标

| 目标          | 技术方向                                           | 状态            |
|-------------|------------------------------------------------|---------------|
| Java 离线 exe | Java 21 + Spring Boot 4 + 内置 Vue UI + jpackage | ✅ 已完成         |
| Web 版       | Spring Boot 4 后端 + Vue 3 前端                    | ✅ 已完成         |
| Python 离线版  | Python + Tkinter + PyInstaller                 | 历史可用版本，作为迁移参照 |

在线演示：https://replay.wotbtools.com

详细任务拆分见 [TODO.md](TODO.md)。

## 当前实现

| 版本          | 技术栈                                        | 入口                                                   | 适用场景                     |
|-------------|--------------------------------------------|------------------------------------------------------|--------------------------|
| Python 离线版  | Python + Tkinter + openpyxl + PyInstaller  | `python/` 下脚本与 `python\dist\*.exe`                        | 本机批量处理、拖拽使用、生成 xlsx      |
| Java 离线 exe | Java 21 + Spring Boot 4 + Vue 3 + jpackage | `java\offline\dist-desktop\WoT Blitz Replay Extractor\*.exe` | 双击运行、本地浏览器 UI、离线导出       |
| Java Web 版  | Java 21 + Spring Boot 4 + Vue 3 + Docker   | `java/`（`java\online\` 部署）                                | 浏览器上传、在线预览、REST API、容器部署 |

文档入口：

- 本文件：项目概览、Python 离线版使用与构建。
- [java/README.md](java/README.md)：Java / Web 版运行、接口、部署、离线 exe 构建。
- [TODO.md](TODO.md)：迁移目标与待办。
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)：给后续开发者和 AI coder 的维护上下文、数据格式、测试策略。

## 功能

- 解析单个 `.wotbreplay` 中的 14 名玩家战斗数据。
- 读取 `meta.json` 战斗信息与 `battle_results.dat` 中的 pickle + protobuf 数据。
- 使用 `tankopedia.json` 将车辆 ID 映射为车辆名、等级、类型和国家。
- 单场导出 Excel：`战斗信息`、`玩家数据`、`原始字段`。
- 多场导出 Excel：按 `arenaUniqueId` 去重，生成 `汇总`、`明细`、`战斗列表`。
- 自包含表现**评分**：按车型基准归一化(类 WN8，1000=同型平均)，单场出「评分」、汇总出「场均评分」。详见 [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) 的「评分（Rating）」。
- GUI 支持选择文件或文件夹、预览数据、合并汇总或逐场导出。
- Java / Web 版提供 `/api/preview`、`/api/export`、`/api/columns`、`/api/health`、`/api/shutdown`。
- Java 离线 exe：双击运行，自动打开浏览器，无需 Python 或 JDK。

## 快速使用：Python 离线版

```bat
python\dist\wotb_gui.exe
```

GUI 流程：

1. 点击"选择回放文件"或"选择文件夹"。
2. 在列表中预览每场战斗的玩家数据。
3. 选择"合并汇总(去重)"或"每场单独导出"。

命令行版本：

```bat
python\dist\wotb_extractor.exe replay.wotbreplay
python\dist\wotb_extractor.exe C:\replays\
python\dist\wotb_extractor.exe C:\replays\ -o 联赛汇总.xlsx
python\dist\wotb_extractor.exe C:\replays\ --each
```

默认规则：

- 输入单个回放时，输出同名 `.xlsx`。
- 输入文件夹或多个回放时，默认合并为一个汇总工作簿。
- 多场合并按 `arenaUniqueId` 去重，同一场战斗重复上传只统计一次。
- 使用 `--each` 可改为每场单独导出。

## 快速使用：Java 离线 exe

```bat
java\offline\dist-desktop\WoT Blitz Replay Extractor\WoT Blitz Replay Extractor.exe
```

无需安装 Python、JDK 或 Node.js，双击即可运行。自动打开浏览器，UI 与 Web 版一致，提供文件选择、预览、导出功能。

## 从源码运行与构建

### Python 版

需要 Python 3.9+。在 `python/` 目录运行：

```bat
cd python
pip install -r requirements.txt
python wotb_extractor.py ..\common\data
python wotb_gui.py
```

构建两个单文件 exe：

```bat
cd python
build.bat
```

输出：

- `python\dist\wotb_gui.exe`：图形界面版。
- `python\dist\wotb_extractor.exe`：命令行 / 拖拽版。

### Java 版

需要 JDK 21、Maven、Node.js。

```bat
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml -DskipTests -pl wotb-core,wotb-web -am install
java -jar wotb-web\target\wotb-web.jar
```

> Windows 环境默认 `java` 可能是 JDK 8。执行 Maven 前请先把 `JAVA_HOME` 指向 JDK 21。

构建离线 exe：

```bat
cd java\offline
build-desktop.bat
```

> 脚本会自动检测或下载 JDK 21、Maven、Node.js 到 `java/offline/tools/`，宿主机无需预先安装。
> 可加 `--no-download` 禁止自动下载（仅用 PATH 已有工具）。

输出：

- `java\offline\dist-desktop\WoT Blitz Replay Extractor\WoT Blitz Replay Extractor.exe`

详细说明见 [java/README.md](java/README.md)。

## 更新车辆库

车辆库 `common/tankopedia.json` 是 Python 与 Java 两侧**共用的单一来源**，由 `update_tankopedia.py`
从 blitzkit 的 `tanks.pb` 转换生成。游戏新增车辆后重新拉取即可（需要网络）：

```bat
cd python
python update_tankopedia.py
```

无需手动同步到 Java：`wotb-core` 构建时会自动把 `common/tankopedia.json` 复制到 classpath。

## 测试

Python 侧：

```bat
cd python
python test_wotb.py
```

Java 侧：

```bash
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml test
```

## 主要目录

| 路径                            | 说明                                          |
|-------------------------------|---------------------------------------------|
| `common/`                     | 两侧共享资源：`tankopedia.json`、`assets/`(图标)、`data/`(示例回放) |
| `python/`                     | Python 离线版：核心解析、Tkinter GUI、CLI、构建脚本、回归测试   |
| `python/wotb_extractor.py`    | Python 核心解析、汇总、Excel 导出、CLI                 |
| `python/wotb_gui.py`          | Tkinter GUI，复用 `wotb_extractor.py` 的核心逻辑    |
| `python/test_wotb.py`         | Python 回归测试                                 |
| `python/update_tankopedia.py` | 更新车辆库（写入 `common/tankopedia.json`）          |
| `java/`                       | Java 主线（共享核心 + Web + 离线打包）                   |
| `java/wotb-core/`             | 共享核心库：解析、protobuf 解码、pickle 读取、汇总、POI 导出     |
| `java/wotb-web/`              | 共享 Spring Boot 4 应用：REST API + 桌面模式入口       |
| `java/frontend/`              | 共享 Vue 3 前端（单文件组件，无 router）                  |
| `java/offline/`               | 离线版打包：`build-desktop.bat`（jpackage）         |
| `java/online/`                | 联网版部署：`docker-compose.yml`、Dockerfile、nginx.conf |

## 数据来源与限制

`.wotbreplay` 本质是 zip 包，当前工具只依赖其中的：

- `meta.json`：地图、版本、开始时间、时长、录像者等基础信息。
- `battle_results.dat`：pickle 包装的 `(arenaId, protobufBytes)`，其中 protobuf 包含玩家战绩。

项目不解析 `data.wotreplay` 的完整战斗过程流，因此不会输出逐帧轨迹、击毁时间线等事件级数据。
