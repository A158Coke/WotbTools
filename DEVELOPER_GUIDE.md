# Developer Guide for AI Maintainers

本文档面向后续维护者和 AI coder。优先阅读本文件，再改解析、导出或 Web API。项目里已有中文注释，但部分终端可能按错误编码显示乱码；源码和文档应保持 UTF-8。

## 项目意图

目标是把 WoT Blitz `.wotbreplay` 回放中的战斗结果提取成可分析的 Excel。项目历史上先做了 Python 离线 exe；后续主线迁移到 Java，并交付两种形态：

- Java 离线 exe：纯离线、双击运行、保留选择文件/文件夹、预览、导出体验。
- Web 版：Spring Boot 4 后端，前端暂定 Vue 3，支持浏览器上传、预览和下载。

当前边界：

- 解析战斗结算结果，不解析完整战斗过程流。
- 输出重点是玩家战绩、车辆信息、战斗基本信息、跨场汇总。
- Python 版是最早实现，也是当前历史可用的 GUI/CLI 离线工具。
- Java 版是后续主线，应同时服务离线 exe 和 Web 版。
- Python 版未来主要作为行为参照和回归对照，不应继续扩散新业务逻辑。

## 仓库结构

```text
.
├── README.md
├── TODO.md
├── DEVELOPER_GUIDE.md
├── wotb_extractor.py          # Python 核心：解析、汇总、xlsx、CLI
├── wotb_gui.py                # Tkinter GUI
├── test_wotb.py               # Python 回归测试
├── update_tankopedia.py       # 更新车辆库
├── tankopedia.json            # 根目录车辆库
├── Data/                      # 示例回放
├── dist/                      # PyInstaller 产物
└── java/
    ├── README.md
    ├── pom.xml
    ├── docker-compose.yml
    ├── wotb-core/             # Java 核心库
    ├── wotb-web/              # Spring Boot API
    └── frontend/              # Vue 3 前端
```

生成物和依赖目录通常不应手工维护：

- `dist/`
- `__pycache__/`
- `java/**/target/`
- `java/frontend/node_modules/`
- `java/frontend/dist/`
- `java/.m2repo/`

## 回放格式

`.wotbreplay` 是 zip 包。当前只使用：

- `meta.json`：地图、版本、开始时间、战斗时长、录像者、录像者车辆等。
- `battle_results.dat`：Python pickle，结构为 `(arenaId, protobufBytes)`。

`protobufBytes` 没有 `.proto` 文件，项目用通用 protobuf wire decoder 按字段号读取。核心结构：

```text
BattleResults
├── #1   mode/map id
├── #3   winner team
├── #201 repeated roster player
└── #301 repeated player result
```

名册字段 `#201 -> #2`：

| 字段号 | 含义 |
| --- | --- |
| `#1` | nickname |
| `#2` | platoon_id |
| `#3` | team |
| `#5` | clan |
| `#9` | rank |

战绩字段 `#301 -> #2`：

| 字段号 | 当前含义 |
| --- | --- |
| `#101` | account_id |
| `#102` | team |
| `#103` | tank_id |
| `#4` | shots |
| `#5` | hits dealt |
| `#7` | penetrations dealt |
| `#8` | damage dealt |
| `#9` + `#10` | assisted damage |
| `#11` | damage received |
| `#12` | hits received |
| `#15` | penetrations received |
| `#17` | enemies damaged |
| `#18` | kills |
| `#23` | xp，含义仍需更多样本确认 |
| `#105` | survived marker，值为 unsigned all-ones / `-1` 表示存活 |
| `#106` | credits，含义仍需更多样本确认 |
| `#107` | mm rating float bit pattern |
| `#117` | damage blocked |

不要轻易重命名或删除字段。若发现新字段，优先在“原始字段”表保留，并用测试样本交叉验证后再展示到主表。

## Python 版维护点

核心文件：[wotb_extractor.py](wotb_extractor.py)。

重要函数：

- `decode_protobuf(buf)`：无 schema 的 protobuf wire decoder。
- `parse_replay(path)`：读取 zip、pickle、protobuf，并返回 `(battle, players)`。
- `load_tankopedia()` / `tank_info()`：车辆库读取与 fallback。
- `enrich_display()`：补充车辆名、队伍、存活标签等展示字段。
- `collect_battles(paths)`：多回放解析、按 `arena_id` 去重。
- `aggregate_players()`：跨场按 `account_id` 汇总。
- `export_xlsx()`：单场 xlsx。
- `export_aggregate_xlsx()`：多场汇总 xlsx。
- `main()`：CLI 参数。

列定义集中在：

- `IDENTITY_COLUMNS`
- `STAT_COLUMNS`
- `TAIL_COLUMNS`
- `PLAYER_COLUMNS`

改 Excel 或 GUI 表格列时，优先改这些定义，避免 GUI 和导出不一致。

## Java / Web 版维护点

核心解析入口：[java/wotb-core/src/main/java/com/wotb/core/ReplayParser.java](java/wotb-core/src/main/java/com/wotb/core/ReplayParser.java)。

当前主要类：

- `ReplayParser`：等价于 Python `parse_replay()`。
- `Protobuf`：Java 版 protobuf wire decoder。
- `PickleReader`：读取 Python pickle 中的 `(arenaId, protobufBytes)`。
- `Tankopedia`：车辆库加载。
- `Players` / `Columns`：展示字段与列定义。
- `Aggregator`：跨场汇总。
- `ExcelExporter`：POI 导出。
- `ReplayController`：REST API。
- `Mapper` / `Dtos`：核心模型到前端 JSON 的映射。

离线 exe 目标尚未落地。实现时优先新增独立启动/打包层，保持解析与导出逻辑只在 `wotb-core` 中维护。推荐路线是：

1. Vue 前端继续作为主 UI。
2. `wotb-web` 同时能服务 API 和打包后的静态资源。
3. 新增离线启动入口负责启动本地 Spring Boot、打开浏览器、处理端口占用。
4. 用 `jpackage` 生成 Windows exe。

前端：

- [java/frontend/src/App.vue](java/frontend/src/App.vue)：主要 UI。
- [java/frontend/src/main.js](java/frontend/src/main.js)：Vue 入口。
- [java/frontend/vite.config.js](java/frontend/vite.config.js)：开发代理 `/api -> :8087`。

前端应通过 `/api/columns` 获取列定义，避免复制后端字段列表。

## 一致性要求

Python 历史版、Java 离线 exe、Java Web 版必须保持以下规则一致：

- `arena_id` / `arenaUniqueId` 去重规则。
- 玩家排序：先队伍，再按伤害降序。
- 辅助伤害：`#9 + #10`。
- 存活判断：`#105 == -1`，Python 中表现为 `0xFFFFFFFFFFFFFFFF`。
- 单场 xlsx 的工作表结构。
- 多场 xlsx 的 `汇总`、`明细`、`战斗列表` 语义。
- 车辆库 fallback：找不到车辆时显示 `#tank_id`。

如修改字段解释，必须同步：

1. Java 核心解析、映射和导出。
2. Java 离线 exe 与 Web 预览列。
3. Python 测试或参照用例，确认历史行为是否需要同步。
4. 测试。
5. README 与本文件。

原则：新功能优先进入 Java 主线。除非需要修复历史 Python exe，否则不要在 Python 中新增一套长期维护的业务逻辑。

## 测试命令

Python：

```bat
python test_wotb.py
```

Java：

```bash
cd java
mvn -s settings.xml test
```

前端构建：

```bash
cd java/frontend
npm run build
```

网络受限环境下，Java / npm 依赖可能无法重新下载。仓库当前包含 `node_modules` 和部分构建产物，但不要把它们当成源码真相。

离线 exe 完成后应补充：

- jpackage 产物启动测试。
- 无 Python 环境机器上的冒烟测试。
- 本地端口冲突测试。
- 打包后 `tankopedia.json` 与静态资源加载测试。

## 常见改动流程

### 增加一个玩家字段

1. 在 Java `ReplayParser`、`PlayerResult`、`Columns`、`Mapper`、`ExcelExporter` 中同步。
2. 如果历史 Python 版仍需同字段，再在 Python `RESULT_UINT_FIELDS` 或相关解析逻辑中读取字段。
3. 更新 Web/离线 UI 列，或只保留在 `原始字段`。
4. 更新测试，至少验证字段存在、类型正确、导出不破坏。
5. 更新文档字段表。

### 调整汇总指标

1. 先改 Java `Aggregator` 和 `ExcelExporter`。
2. 若 Web/离线 UI 预览展示该指标，同步 `Mapper.aggregateColumns()`。
3. 如需保持 Python 历史版同能力，再同步 Python `aggregate_players()` 与 `export_aggregate_xlsx()`。
4. 用 `Data/` 样本跑 Python 和 Java 测试。

### 更新车辆库

1. 运行 `python update_tankopedia.py`。
2. 确认根目录 `tankopedia.json` 更新。
3. 同步到 Java resources 中的 `tankopedia.json`，如果没有自动同步脚本则手动复制。
4. 跑 Python 和 Java 测试。
5. 重新构建 exe 或 Docker 镜像。

### 实现 Java 离线 exe

1. 确认 `wotb-core` 覆盖 Python 离线版的解析、汇总和导出能力。
2. 决定 UI：当前建议复用 Vue，不另起 JavaFX，除非明确需要原生桌面控件。
3. 配置前端构建产物复制到 Spring Boot 静态资源目录。
4. 新增本地启动入口：启动服务、打开浏览器、优雅退出。
5. 新增 jpackage 构建脚本和图标资源。
6. 在干净 Windows 环境验证：无 Python、无外部 JDK、无网络也能运行。

## 风险点

- 终端编码：Windows PowerShell 可能把 UTF-8 中文显示成乱码，但文件仍应保存为 UTF-8。
- protobuf 字段没有官方 schema，字段语义来自样本和社区项目交叉验证。
- pickle 读取逻辑只针对当前 `battle_results.dat` 结构，不是通用 pickle VM。
- `tankopedia.json` 依赖外部 blitzkit 资源，更新时需要网络。
- Web 上传接口无持久化和鉴权，适合本地/内网工具，不是公开服务安全模型。
- Spring Boot 版本声明目前需要收敛；目标是 Spring Boot 4。
- Java 离线 exe 若采用本地 Web UI，需要处理端口占用、浏览器启动失败、程序退出后服务残留等桌面体验问题。

## 给 AI coder 的工作准则

- 先读 `README.md`、`java/README.md`、本文件和相关测试，再改代码。
- 不要根据乱码输出判断文件内容坏了；优先用 UTF-8 方式读取。
- 不要在 `node_modules`、`target`、`dist` 中做源码修改。
- 小改动也要考虑 Java 离线 exe 与 Web 版是否需要同步。
- 如果只改 Python 离线版，明确说明这是历史版本修复，以及 Java 主线是否仍需跟进。
- 如果只改 Web UI，确认 API 响应字段是否已经存在，优先复用 `/api/columns`。
