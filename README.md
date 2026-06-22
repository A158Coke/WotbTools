# WoT Blitz Replay Data Extractor

从《坦克世界闪击战》（World of Tanks Blitz）的 `.wotbreplay` 回放文件中提取战斗数据，并导出为 Excel。

项目最早是 Python 离线工具：用 Python 解析、计算、导出，再通过 PyInstaller 封装为 exe。后续主线迁移到 Java，目前 Java 主线已同时交付两种形态：**Java 离线 exe** 和 **Web 版**。

## 当前目标

| 目标 | 技术方向 | 状态 |
| --- | --- | --- |
| Java 离线 exe | Java 21 + Spring Boot 4 + 内置 Vue UI + jpackage | ✅ 已完成 |
| Web 版 | Spring Boot 4 后端 + Vue 3 前端 | ✅ 已完成 |
| Python 离线版 | Python + Tkinter + PyInstaller | 历史可用版本，作为迁移参照 |

详细任务拆分见 [TODO.md](TODO.md)。

## 当前实现

| 版本 | 技术栈 | 入口 | 适用场景 |
| --- | --- | --- | --- |
| Python 离线版 | Python + Tkinter + openpyxl + PyInstaller | 根目录脚本与 `dist\*.exe` | 本机批量处理、拖拽使用、生成 xlsx |
| Java 离线 exe | Java 21 + Spring Boot 4 + Vue 3 + jpackage | `java\dist-desktop\WoT Blitz Replay Extractor\*.exe` | 双击运行、本地浏览器 UI、离线导出 |
| Java Web 版 | Java 21 + Spring Boot 4 + Vue 3 + Docker | `java/` | 浏览器上传、在线预览、REST API、容器部署 |

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
- GUI 支持选择文件或文件夹、预览数据、合并汇总或逐场导出。
- Java / Web 版提供 `/api/preview`、`/api/export`、`/api/columns`、`/api/health`、`/api/shutdown`。
- Java 离线 exe：双击运行，自动打开浏览器，无需 Python 或 JDK。

## 快速使用：Python 离线版

```bat
dist\wotb_gui.exe
```

GUI 流程：

1. 点击"选择回放文件"或"选择文件夹"。
2. 在列表中预览每场战斗的玩家数据。
3. 选择"合并汇总(去重)"或"每场单独导出"。

命令行版本：

```bat
dist\wotb_extractor.exe replay.wotbreplay
dist\wotb_extractor.exe C:\replays\
dist\wotb_extractor.exe C:\replays\ -o 联赛汇总.xlsx
dist\wotb_extractor.exe C:\replays\ --each
```

默认规则：

- 输入单个回放时，输出同名 `.xlsx`。
- 输入文件夹或多个回放时，默认合并为一个汇总工作簿。
- 多场合并按 `arenaUniqueId` 去重，同一场战斗重复上传只统计一次。
- 使用 `--each` 可改为每场单独导出。

## 快速使用：Java 离线 exe

```bat
java\dist-desktop\WoT Blitz Replay Extractor\WoT Blitz Replay Extractor.exe
```

无需安装 Python、JDK 或 Node.js，双击即可运行。自动打开浏览器，UI 与 Web 版一致，提供文件选择、预览、导出功能。

## 从源码运行与构建

### Python 版

需要 Python 3.9+。

```bat
pip install -r requirements.txt
python wotb_extractor.py Data
python wotb_gui.py
```

构建两个单文件 exe：

```bat
build.bat
```

输出：

- `dist\wotb_gui.exe`：图形界面版。
- `dist\wotb_extractor.exe`：命令行 / 拖拽版。

### Java 版

需要 JDK 21、Maven、Node.js。

```bat
cd java
mvn -s settings.xml -DskipTests -pl wotb-core,wotb-web -am install
java -jar wotb-web\target\wotb-web.jar
```

构建离线 exe：

```bat
cd java
build-desktop.bat
```

输出：

- `java\dist-desktop\WoT Blitz Replay Extractor\WoT Blitz Replay Extractor.exe`

详细说明见 [java/README.md](java/README.md)。

## 更新车辆库

车辆库文件是 `tankopedia.json`，由 `update_tankopedia.py` 从 blitzkit 的 `tanks.pb` 转换生成。游戏新增车辆后可重新拉取：

```bat
python update_tankopedia.py
build.bat
```

注意：这一步需要网络访问。

同步到 Java 资源目录：

```bat
copy tankopedia.json java\wotb-core\src\main\resources\tankopedia.json
```

## 测试

Python 侧测试脚本：

```bat
python test_wotb.py
```

Java 侧测试：

```bash
cd java
mvn -s settings.xml test
```

## 主要文件

| 路径 | 说明 |
| --- | --- |
| `wotb_extractor.py` | Python 核心解析、汇总、Excel 导出、CLI |
| `wotb_gui.py` | Tkinter GUI，复用 `wotb_extractor.py` 的核心逻辑 |
| `test_wotb.py` | Python 回归测试 |
| `update_tankopedia.py` | 更新车辆库 |
| `tankopedia.json` | 车辆 ID 映射数据 |
| `Data/` | 示例 `.wotbreplay` 文件 |
| `java/` | Java 主线（核心库 + Web + 离线 exe 构建） |
| `java/wotb-core/` | Java 核心库：解析、protobuf 解码、pickle 读取、汇总、POI 导出 |
| `java/wotb-web/` | Spring Boot 4 REST API + 桌面模式入口 |
| `java/frontend/` | Vue 3 前端（单文件组件，无 router） |
| `java/build-desktop.bat` | jpackage 离线 exe 构建脚本 |

## 数据来源与限制

`.wotbreplay` 本质是 zip 包，当前工具只依赖其中的：

- `meta.json`：地图、版本、开始时间、时长、录像者等基础信息。
- `battle_results.dat`：pickle 包装的 `(arenaId, protobufBytes)`，其中 protobuf 包含玩家战绩。

项目不解析 `data.wotreplay` 的完整战斗过程流，因此不会输出逐帧轨迹、击毁时间线等事件级数据。
