# Developer Guide for AI Maintainers

本文档面向后续维护者和 AI coder。优先阅读本文件，再改解析、导出或 Web API。项目里已有中文注释，但部分终端可能按错误编码显示乱码；源码和文档应保持 UTF-8。

## 项目意图

目标是把 WoT Blitz `.wotbreplay` 回放中的战斗结果提取成可分析的 Excel。项目历史上先做了 Python 离线 exe；后续主线迁移到 Java，并同时交付两种形态：

- Java 离线 exe：纯离线、双击运行、自动打开浏览器、可选择/拖拽回放、预览并导出 xlsx。
- Web 版：Spring Boot 4 后端，Vue 3 前端，支持浏览器上传、预览和下载。

当前边界：

- 解析战斗结算结果，不解析完整战斗过程流。
- 输出重点是玩家战绩、车辆信息、战斗基本信息、跨场汇总。
- Python 版是最早实现，也是当前历史可用的 GUI/CLI 离线工具。
- Java 版是当前主线，已同时服务离线 exe 和 Web 版。
- Python 版未来主要作为行为参照和回归对照，不应继续扩散新业务逻辑。

## 仓库结构

仓库按"语言/形态"分层：`common/`(共享资源) + `python/`(Python 离线版) + `java/`(Java 主线，其下再分共享模块与 `offline/`、`online/` 两种打包/部署)。

```text
.
├── README.md  TODO.md  DEVELOPER_GUIDE.md  LICENSE  .gitignore
├── common/                     # Python 与 Java 两侧共享资源
│   ├── tankopedia.json         # 车辆库单一来源
│   ├── assets/                 # 共享图标 icon.ico / icon.png
│   └── data/                   # 示例回放（gitignore，本地测试夹具）
├── python/                     # Python 离线版（历史/参照）
│   ├── wotb_extractor.py       # 核心：解析、汇总、xlsx、CLI
│   ├── wotb_gui.py             # Tkinter GUI
│   ├── test_wotb.py            # 回归测试（读 ../common/data）
│   ├── update_tankopedia.py    # 更新车辆库 → 写 ../common/tankopedia.json
│   ├── make_icon.py            # 生成图标 → ../common/assets/
│   ├── build.bat               # PyInstaller 构建（资源取自 ../common）
│   └── requirements.txt
└── java/
    ├── README.md
    ├── pom.xml                 # 父 POM：Spring Boot 4.1.0, Java 21
    ├── settings.xml            # 本地 Maven 配置，独立仓库 .m2repo（Aliyun 镜像）
    ├── settings-docker.xml     # 容器内 Maven 配置（仅 Aliyun 镜像）
    ├── wotb-core/              # 【共享】Java 核心库
    │   ├── pom.xml             #   构建时把 ../../common/tankopedia.json 复制到 classpath
    │   ├── src/main/java/com/wotb/core/
    │   │   ├── ReplayParser.java    # 回放解析入口
    │   │   ├── Protobuf.java        # protobuf wire decoder
    │   │   ├── PickleReader.java    # Python pickle 读取
    │   │   ├── Tankopedia.java      # 车辆库
    │   │   ├── Players.java         # 玩家展示字段与排序
    │   │   ├── Columns.java         # 列定义（单数据源）
    │   │   ├── Aggregator.java      # 跨场汇总
    │   │   ├── ExcelExporter.java   # POI xlsx 导出
    │   │   ├── Replays.java         # 多回放去重收集
    │   │   └── model/{Battle.java, PlayerResult.java}
    │   └── src/test/java/com/wotb/core/ParityTest.java   # 读 ../../common/data
    ├── wotb-web/              # 【共享】Spring Boot 应用（离线与联网都用它）
    │   ├── src/main/java/com/wotb/web/
    │   │   ├── WotbWebApplication.java  # 启动入口（含 --desktop 模式）
    │   │   ├── ReplayController.java    # REST API + /api/shutdown
    │   │   ├── Mapper.java              # 核心模型 → DTO 映射
    │   │   └── Dtos.java                # API 响应 DTO
    │   └── src/test/java/com/wotb/web/WebApiTest.java
    ├── frontend/             # 【共享】Vue 3 前端（单文件组件，无 router）
    │   ├── src/{main.js, App.vue}
    │   ├── index.html  package.json  vite.config.js  .npmrc
    ├── offline/              # 离线版打包
    │   └── build-desktop.bat     # 前端构建 → Maven 打包 → jpackage
    └── online/               # 联网版部署
        ├── docker-compose.yml    # nginx(Vue) + Spring Boot 两容器
        ├── backend.Dockerfile    # 上下文=仓库根（需 common/ 与 java/）
        ├── frontend.Dockerfile   # 上下文=java/（需 frontend/ 与 online/nginx.conf）
        └── nginx.conf
```

> 关键：离线版与联网版**复用同一套源码**（`wotb-core` + `wotb-web` + `frontend`）。`offline/` 与 `online/` 只放打包/部署文件，**不要把共享逻辑复制进去**。

生成物和依赖目录通常不应手工维护，也已 gitignore：

- `python/dist/`、`__pycache__/`
- `java/**/target/`
- `java/frontend/node_modules/`、`java/frontend/dist/`
- `java/.m2repo/`
- `java/offline/dist-desktop/`
- `common/data/`（本地样本）

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

不要轻易重命名或删除字段。若发现新字段，优先在"原始字段"表保留，并用测试样本交叉验证后再展示到主表。

## Python 版维护点

核心文件：[python/wotb_extractor.py](python/wotb_extractor.py)。

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

### 核心类

| 类 | 文件 | 等价于 Python |
| --- | --- | --- |
| `ReplayParser` | `wotb-core/.../ReplayParser.java` | `parse_replay()` |
| `Protobuf` | `wotb-core/.../Protobuf.java` | `decode_protobuf()` |
| `PickleReader` | `wotb-core/.../PickleReader.java` | `pickle.loads()` |
| `Tankopedia` | `wotb-core/.../Tankopedia.java` | `load_tankopedia()` / `tank_info()` |
| `Players` | `wotb-core/.../Players.java` | `enrich_display()` / `sort_players()` |
| `Columns` | `wotb-core/.../Columns.java` | `PLAYER_COLUMNS` 等 |
| `Aggregator` | `wotb-core/.../Aggregator.java` | `aggregate_players()` |
| `ExcelExporter` | `wotb-core/.../ExcelExporter.java` | `export_xlsx()` / `export_aggregate_xlsx()` |
| `Replays` | `wotb-core/.../Replays.java` | `collect_battles()` |
| `ReplayController` | `wotb-web/.../ReplayController.java` | REST API |
| `Mapper` | `wotb-web/.../Mapper.java` | 核心模型 → JSON |
| `WotbWebApplication` | `wotb-web/.../WotbWebApplication.java` | Spring Boot 入口 + `--desktop` 模式 |

### 桌面模式 (离线 exe)

离线 exe 的实现方案是"本地 Spring Boot + 内置 Vue 静态资源 + jpackage"：

1. Vue 前端构建产物被打入 Spring Boot JAR 的 `classpath:/static/` 目录。
2. `WotbWebApplication` 检测 `--desktop` 参数后：
   - 选择 8087+ 的可用端口。
   - 绑定 `127.0.0.1`（仅本地访问）。
   - 启动后自动打开默认浏览器。
3. `build-desktop.bat` 执行：前端构建 → Maven 打包 → jpackage 生成 app image。

### 前端

- 单文件组件 `App.vue`，无 Vue Router、无组件库。
- 开发时 Vite 代理 `/api → localhost:8087`。
- 通过 `/api/health` 的 `desktop` 字段检测是否为离线模式，如果是则显示"关闭离线程序"按钮。
- 列**集合与顺序**通过 `/api/columns` 获取（纯数据：`{key, num}`），但**中文显示名由前端自带映射**（见下）。
- 主要交互：
  - 选择文件 / 选择文件夹 / 拖拽上传；文件列表每项有 `×` 单删、「清空」清全部；解析后**每个战斗标签页(地图 #n)带 `×`** 可移除该场(`removeBattle` 删对应回放并自动重新解析以更新汇总)。
  - 「解析预览」→ 多场出「汇总」+ 每场标签页；「合并汇总(去重)」「每场单独导出」下载。
  - **列选择器作用于当前所在的表**（汇总表 / 单场表各一套可见列）；为草稿模式，勾选后点「应用」才生效，另有 全选 / 重置默认 / 取消。

### 显示名（i18n）架构

API 层为**纯英文**：`/api/columns` 与各 DTO 只回 `key`(snake_case) + 数据，**不含中文**。中文显示名由各输出通道**各自映射**：

- 前端：`App.vue` 的 `PLAYER_LABELS` / `AGG_LABELS`（两套，因 `kills` 在单场=「击杀」、汇总=「总击杀」，同 key 不同义）。
- 导出层：`Columns.java`（单场 xlsx 表头）、`ExcelExporter` 的汇总列、Python `STAT_COLUMNS` / `export_aggregate_xlsx`。

> 这是有意的取舍：API 干净、可多语言，但中文标签存在多份（前端 + 导出）。**改任一列名，务必同步前端两套映射与三处导出标签。**
>
> 当前命名约定：辅助伤害=「协助伤害」、承受伤害=「损失血量」、抵挡伤害=「格挡」、击伤敌数=「击伤」；汇总用「总X / 场均X」。

### 一致性要求

Python 历史版、Java 离线 exe、Java Web 版必须保持以下规则一致：

- `arena_id` / `arenaUniqueId` 去重规则。
- 玩家排序：先队伍，再按伤害降序。
- 协助伤害：`#9 + #10`。
- 存活判断：`#105 == -1`，Python 中表现为 `0xFFFFFFFFFFFFFFFF`。
- 单场 xlsx 的工作表结构。
- 多场 xlsx 的 `汇总`、`明细`、`战斗列表` 语义。
- 车辆库 fallback：找不到车辆时显示 `#tank_id`。
- 列的 `key`（snake_case）在 API、前端映射、导出三方一致；中文显示名在前端两套映射 + 三处导出标签一致。

如修改字段解释或列名，必须同步：

1. Java `ReplayParser`、`PlayerResult`、`Columns`、`ExcelExporter`（含汇总列）。
2. Java Web API `Mapper`（`/api/columns` 只回英文 key）+ 前端 `PLAYER_LABELS` / `AGG_LABELS`。
3. Python `RESULT_UINT_FIELDS` / `STAT_COLUMNS` / `export_aggregate_xlsx`。
4. 测试（`ParityTest`、`WebApiTest`、`test_wotb.py`）。
5. 文档（本文件 + README）。

原则：新功能优先进入 Java 主线。除非需要修复历史 Python exe，否则不要在 Python 中新增一套长期维护的业务逻辑。

## 测试命令

Python：

```bat
cd python
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

## 常见改动流程

### 增加一个玩家字段

1. 在 Java `ReplayParser`、`PlayerResult`、`Columns`、`Mapper`、`ExcelExporter` 中同步。
2. 如果历史 Python 版仍需同字段，再在 Python `RESULT_UINT_FIELDS` 或相关解析逻辑中读取字段。
3. 更新测试（`ParityTest` 和 `test_wotb.py`），至少验证字段存在、类型正确、导出不破坏。
4. 更新文档字段表。

### 调整汇总指标

1. 先改 Java `Aggregator` 和 `ExcelExporter`。
2. 若 Web/离线 UI 预览展示该指标，同步 `Mapper.aggregateColumns()`。
3. 如需保持 Python 历史版同能力，再同步 Python `aggregate_players()` 与 `export_aggregate_xlsx()`。
4. 用 `common/data/` 样本跑 Python 和 Java 测试。

### 更新车辆库

车辆库是**单一来源** `common/tankopedia.json`，两侧共用，无需手动同步：

1. `cd python && python update_tankopedia.py`（写入 `common/tankopedia.json`，需要网络）。
2. 跑 Python 和 Java 测试（Java 构建会自动把 `common/tankopedia.json` 复制到 classpath）。
3. 重新构建 exe 或 Docker 镜像。

## 风险点

- 终端编码：Windows PowerShell 可能把 UTF-8 中文显示成乱码，但文件仍应保存为 UTF-8。
- protobuf 字段没有官方 schema，字段语义来自样本和社区项目交叉验证。
- pickle 读取逻辑只针对当前 `battle_results.dat` 结构，不是通用 pickle VM。
- `tankopedia.json` 依赖外部 blitzkit 资源，更新时需要网络。
- Web 上传接口无持久化和鉴权，适合本地/内网工具，不是公开服务安全模型。
- 离线 exe 采用本地 Web UI，已处理端口占用、浏览器自动启动、程序退出服务残留等问题。

## 给 AI coder 的工作准则

- 先读 `README.md`、`java/README.md`、本文件和相关测试，再改代码。
- 不要根据乱码输出判断文件内容坏了；优先用 UTF-8 方式读取。
- 不要在 `node_modules`、`target`、`dist` 中做源码修改。
- 小改动也要考虑 Java 离线 exe 与 Web 版是否需要同步。
- 如果只改 Python 离线版，明确说明这是历史版本修复，以及 Java 主线是否仍需跟进。
- 如果只改 Web UI 的显示名，改前端 `PLAYER_LABELS` / `AGG_LABELS` 即可；API 只回英文 key，不要把中文加回 API。
- `Columns.java` 是 Java 侧列的 key/顺序/取值与**单场 xlsx 表头**的来源；新增字段先加 `Col` 记录，再同步前端映射、汇总列与 Python。
- 任何会改变界面/导出/数据的更新，都要同步更新文档（本文件 + README/java/README）。
