# Developer Guide for AI Maintainers

本文档面向后续维护者和 AI coder。优先阅读本文件，再改解析、导出或 Web API。项目里已有中文注释，但部分终端可能按错误编码显示乱码；源码和文档应保持 UTF-8。

## 项目意图

目标是把 WoT Blitz `.wotbreplay` 回放中的战斗结果提取成可分析的 Excel。项目主线为 Java，已同时交付两种形态：

- Java 离线 exe：纯离线、双击运行、自动打开浏览器、可选择/拖拽回放、预览并导出 xlsx。
- Web 版：Spring Boot 4 后端，Vue 3 前端，支持浏览器上传、预览和下载。

当前边界：

- 解析战斗结算结果，不解析完整战斗过程流。
- 输出重点是玩家战绩、车辆信息、战斗基本信息、跨场汇总。

## 仓库结构

仓库按"语言/形态"分层：`common/`(共享资源) + `python/`(车辆库更新脚本) + `java/`(Java 主线，其下再分共享模块与 `offline/`、`online/` 两种打包/部署)。

```text
.
├── README.md  TODO.md  DEVELOPER_GUIDE.md  LICENSE  .gitignore
├── Dockerfile                  # CI/CD 单镜像（前后端合并，用于 Docker Hub 推送与 VPS 部署）
├── .dockerignore               # 减少 Docker 构建上下文
├── .github/
│   └── workflows/deploy.yml    # GitHub Actions: 构建镜像 → 推送 Docker Hub → SSH 部署 VPS
├── common/                     # 共享资源
│   ├── tankopedia.json         # 车辆库单一来源
│   ├── rating.json             # 评分可调参数单一来源
│   ├── map_names.json          # 地图内部名→中文 单一来源（前端+导出共用）
│   ├── assets/                 # 共享图标 icon.ico / icon.png
│   └── data/                   # 示例回放（gitignore，本地测试夹具）
├── python/                     # 车辆库更新脚本
│   └── update_tankopedia.py    # 更新车辆库 → 写 ../common/tankopedia.json
└── java/
    ├── README.md
    ├── pom.xml                 # 父 POM：Spring Boot 4.1.0, Java 21
    ├── settings.xml            # 本地 Maven 配置，独立仓库 .m2repo（Aliyun 镜像）
    ├── settings-docker.xml     # 容器内 Maven 配置（仅 Aliyun 镜像）
    ├── wotb-core/              # 【共享】Java 核心库
    │   ├── pom.xml             #   构建时把 ../../common/tankopedia.json 复制到 classpath
    │   ├── src/main/java/com/wotb/core/   # 按功能分包
    │   │   ├── Columns.java         # 列定义（单数据源, export 与 API 共用的跨切契约）
    │   │   ├── parse/               # 回放摄入：解析 + 去重
    │   │   │   ├── ReplayParser.java    # 回放解析入口
    │   │   │   ├── Protobuf.java        # protobuf wire decoder
    │   │   │   ├── PickleReader.java    # Python pickle 读取
    │   │   │   └── Replays.java         # 多回放去重收集
    │   │   ├── ref/                 # 参考数据查表
    │   │   │   ├── Tankopedia.java      # 车辆库
    │   │   │   └── MapNames.java        # 地图内部名 → 中文（读 classpath map_names.json）
    │   │   ├── stats/               # 解析后的派生 / 富化
    │   │   │   ├── Players.java         # 玩家展示字段与排序
    │   │   │   ├── Rating.java          # 表现评分
    │   │   │   └── Aggregator.java      # 跨场汇总
    │   │   ├── export/              # xlsx 输出
    │   │   │   ├── ExcelExporter.java   # 导出门面（writeSingle/writeAggregate）
    │   │   │   ├── ExcelStyles.java     # POI 渲染底座（样式 + 写格 + 值格式化）
    │   │   │   ├── SingleBattleSheets.java  # 单场三表（战斗信息/玩家数据/原始字段）
    │   │   │   └── AggregateSheets.java     # 汇总三表（汇总/明细/战斗列表）
    │   │   └── model/               # 数据模型(每个一个文件)
    │   │       ├── Battle.java  PlayerResult.java
    │   │       ├── Agg.java           # 跨场汇总(原 Aggregator.Agg)
    │   │       ├── TankInfo.java      # 车辆信息(原 Tankopedia.TankInfo)
    │   │       ├── Source.java        # 待处理回放(原 Replays.Source)
    │   │       └── Collected.java     # 去重结果(原 Replays.Collected)
    │   └── src/test/java/com/wotb/core/ParityTest.java   # 读 ../../common/data
    ├── wotb-web/              # 【共享】Spring Boot 应用（离线与联网都用它）
    │   ├── src/main/java/com/wotb/web/
    │   │   ├── WotbWebApplication.java  # 启动入口（含 --desktop 模式）
    │   │   ├── controller/              # REST API（仅 HTTP 映射）
    │   │   │   └── ReplayController.java
    │   │   ├── service/                 # 业务层（与 HTTP 解耦）
    │   │   │   └── ReplayService（解析/评分/映射/导出） / DesktopLifecycle（桌面判定/关机）
    │   │   ├── mapper/                  # 核心模型 → DTO 映射
    │   │   │   └── Mapper.java
    │   │   └── dto/                     # API 响应 DTO(每个一个文件)
    │   │       └── PlayerRow / BattleDto / AggRow / ColumnDef / PreviewResponse / ExportResult
    │   └── src/test/java/com/wotb/web/WebApiTest.java
    ├── frontend/             # 【共享】Vue 3 前端（单文件组件，无 router）
    │   ├── src/{main.js, App.vue}
    │   ├── index.html  package.json  vite.config.js  .npmrc
    ├── offline/              # 离线版打包
    │   ├── build-desktop.bat     # 入口（调用 .ps1；兼容双击）
    │   └── build-desktop.ps1    # 主脚本：自动检测/下载工具 → 构建 → jpackage
    └── online/               # 联网版部署
        ├── docker-compose.yml    # 本地开发用：nginx(Vue) + Spring Boot 两容器
        ├── backend.Dockerfile    # 本地开发用，上下文=仓库根（需 common/ 与 java/）
        ├── frontend.Dockerfile   # 本地开发用，上下文=仓库根（App.vue import common/map_names.json）
        └── nginx.conf            # CI/CD 与本地共用
```

> 关键：离线版与联网版**复用同一套源码**（`wotb-core` + `wotb-web` + `frontend`）。`offline/` 与 `online/` 只放打包/部署文件，**不要把共享逻辑复制进去**。

生成物和依赖目录通常不应手工维护，也已 gitignore：

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

| 字段号  | 含义         |
|------|------------|
| `#1` | nickname   |
| `#2` | platoon_id |
| `#3` | team       |
| `#5` | clan       |
| `#9` | rank       |

战绩字段 `#301 -> #2`：

| 字段号          | 当前含义                                             |
|--------------|--------------------------------------------------|
| `#101`       | account_id                                       |
| `#102`       | team                                             |
| `#103`       | tank_id                                          |
| `#4`         | shots                                            |
| `#5`         | hits dealt                                       |
| `#7`         | penetrations dealt                               |
| `#8`         | damage dealt                                     |
| `#9` + `#10` | assisted damage                                  |
| `#11`        | damage received                                  |
| `#12`        | hits received                                    |
| `#15`        | penetrations received                            |
| `#17`        | enemies damaged                                  |
| `#18`        | kills                                            |
| `#23`        | xp，含义仍需更多样本确认                                    |
| `#105`       | survived marker，值为 unsigned all-ones / `-1` 表示存活 |
| `#106`       | credits，含义仍需更多样本确认                               |
| `#107`       | mm rating float bit pattern                      |
| `#117`       | damage blocked                                   |

不要轻易重命名或删除字段。若发现新字段，优先在"原始字段"表保留，并用测试样本交叉验证后再展示到主表。

## Java / Web 版维护点

### 核心类

> 下表第三列是当初移植的原 Python 原型函数名（该 Python 实现已移除，仅作概念对照保留）。

| 类                    | 文件                                     | 原 Python 原型(已移除)                           |
|----------------------|----------------------------------------|---------------------------------------------|
| `ReplayParser`       | `wotb-core/.../ReplayParser.java`      | `parse_replay()`                            |
| `Protobuf`           | `wotb-core/.../Protobuf.java`          | `decode_protobuf()`                         |
| `PickleReader`       | `wotb-core/.../PickleReader.java`      | `pickle.loads()`                            |
| `Tankopedia`         | `wotb-core/.../Tankopedia.java`        | `load_tankopedia()` / `tank_info()`         |
| `Players`            | `wotb-core/.../Players.java`           | `enrich_display()` / `sort_players()`       |
| `Columns`            | `wotb-core/.../Columns.java`           | `PLAYER_COLUMNS` 等                          |
| `Aggregator`         | `wotb-core/.../Aggregator.java`        | `aggregate_players()`                       |
| `ExcelExporter`      | `wotb-core/.../ExcelExporter.java`     | 导出门面 `export_xlsx()` / `export_aggregate_xlsx()` |
| `ExcelStyles`        | `wotb-core/.../ExcelStyles.java`       | POI 渲染底座 (样式 + 写格 + 值格式化)        |
| `SingleBattleSheets` | `wotb-core/.../SingleBattleSheets.java` | 单场三表 (战斗信息/玩家数据/原始字段)        |
| `AggregateSheets`    | `wotb-core/.../AggregateSheets.java`   | 汇总三表 (汇总/明细/战斗列表)                 |
| `Replays`            | `wotb-core/.../Replays.java`           | `collect_battles()`                         |
| `ReplayController`   | `wotb-web/.../ReplayController.java`   | REST API（仅 HTTP 映射）                          |
| `ReplayService`      | `wotb-web/.../service/ReplayService.java` | 业务编排（解析/评分/映射/导出）              |
| `DesktopLifecycle`   | `wotb-web/.../service/DesktopLifecycle.java` | 桌面判定 + `/api/shutdown` 关机          |
| `Mapper`             | `wotb-web/.../Mapper.java`             | 核心模型 → JSON                                 |
| `WotbWebApplication` | `wotb-web/.../WotbWebApplication.java` | Spring Boot 入口 + `--desktop` 模式             |

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
  - **顶部上传区按状态切换**(无外部依赖, 图标为内联 SVG 以兼容离线 exe):未选文件时显示**上传卡**`.uploadcard`(上传图标 + 提示 + 内嵌「选择回放文件 / 选择文件夹」, 同时是拖拽目标);已选文件后收起为紧凑**文件条**`.filebar`(文件数 + 文件 chip + 添加文件/文件夹 + 清空), 下方是强调主按钮**「解析预览」**`.actionrow`。文件列表每项 `×` 单删、「清空」清全部。
  - **导出按钮在解析后才出现**, 位于结果区工具条 `.restoolbar`(左侧标签页 + 右侧 `.resactions`:选择列 / 合并汇总 / 每场导出);解析后**每个战斗标签页(地图 #n)带 `×`** 可移除该场:点击弹应用内二次确认对话框,确认后(`confirmRemoveBattle`)删对应回放并自动重新解析以更新汇总。
  - 视觉(数据网格风):浅色表头、**所有列居中**、行下细线;**队伍行底色**——单场按本场队伍、汇总按该选手最近一场队伍(后端 `model.Agg.team` → `dto.AggRow.team`);`评分`/`场均评分` 渲染为**分级彩色徽章**(`ratingTier()`:差/中/良/优/卓越);表格上方一排**指标卡**(汇总=场次/选手/最高场均评分/最高单场伤害;单场=地图/时长/获胜/玩家)。
  - **列选择器**是按钮下的下拉面板，作用于当前所在的表（汇总/单场各一套），**即点即生效**：勾选切换显示、**拖拽 `⋮⋮` 调整列顺序**，另有 全选/重置/完成。**面板打开时锁定表格切换**(汇总/各场标签禁用),避免作用域错乱，点「完成」后恢复。状态：`visibleKeys`/`aggVisibleKeys`(显示集合) + `playerOrder`/`aggOrder`(顺序)；表格列 = 顺序过滤出可见列。

### 显示名（i18n）架构

API 层为**纯英文**：`/api/columns` 与各 DTO 只回 `key`(snake_case) + 数据，**不含中文**。中文显示名由各输出通道**各自映射**：

- 前端：`App.vue` 的 `PLAYER_LABELS` / `AGG_LABELS`（两套，因 `kills` 在单场=「击杀」、汇总=「总击杀」，同 key 不同义）。
- 导出层：`Columns.java`（单场 xlsx 表头）、`AggregateSheets.java` 的汇总列。

> 这是有意的取舍：API 干净、可多语言，但中文标签存在多份（前端 + 导出）。**改任一列名，务必同步前端两套映射与三处导出标签。**
>
> 当前命名约定：辅助伤害=「协助伤害」、承受伤害=「损失血量」、抵挡伤害=「格挡」、击伤敌数=「击伤」；汇总用「总X / 场均X」。

### 评分（Rating）

自包含的表现评分（类 WN8 机制，但**期望值来自当前处理的这批战斗，不依赖外部表**）。实现：`wotb-core/Rating.java`。

> **可调项集中在 `common/rating.json`**（权重/阈值/scale/车型系数）——Java 经 classpath 读取，**改它即生效，不必改代码**；文件缺失/损坏则用内置默认。

- **有效贡献 EC** = `伤害 + 0.6*协助 + 0.35*格挡 + 200*击杀`（权重见 `rating.json`）。
- **按车型基准**：从这批数据按车型(轻/中/重/TD)求 EC 均值；某车型样本 `< 5`(含"没有同类车")时 `基准 = 全体均值 × 车型难度系数`(可调常量 `CLASS_FACTOR`，默认 轻坦0.7/中坦0.9/重坦1.0/TD1.0)，避免独苗轻坦被高 EC 的重坦拉低。
- **评分** = `round(1000 * EC/基准 * (1 + 0.05*胜))`；`1000` = 同车型平均。
- **基准范围 = 一起处理的这批战斗**：单场导出即相对该场；多场/预览相对整批。所以 rating 是“相对该批”的,不是绝对天梯分。
- 列：单场「评分」`key=rating`(在 `Columns.STAT`)、汇总「场均评分」`key=rating_avg`(Mapper/AggregateSheets)。计算时机：`ExcelExporter.writeSingle/writeAggregate`(门面) 与 `ReplayService.preview` 在用之前先 `Rating.compute(...)`。

### 一致性要求

Java 离线 exe、Java Web 版必须保持以下规则一致：

- `arena_id` / `arenaUniqueId` 去重规则。
- 玩家排序：先队伍，再按伤害降序。
- 协助伤害：`#9 + #10`。
- 存活判断：`#105 == -1`。
- 单场 xlsx 的工作表结构。
- 多场 xlsx 的 `汇总`、`明细`、`战斗列表` 语义。
- 车辆库 fallback：找不到车辆时显示 `#tank_id`。
- 列的 `key`（snake_case）在 API、前端映射、导出三方一致；中文显示名在前端两套映射 + 导出标签一致。
- **地图名中文化**：`meta.json` 的 `mapName` 是内部英文名（如 `lagoon`），中文名映射**单一来源** `common/map_names.json`（构建复制到 classpath）。导出走 `MapNames.cn()`（`SingleBattleSheets` 单场信息 + `AggregateSheets` 明细列/战斗列表），前端 `App.vue` 直接 `import` 同一份 JSON 用 `mapLabel()`（标签页/地图卡/移除确认）。API 仍回原始英文 `mapName`。未匹配则原样显示。

如修改字段解释或列名，必须同步：

1. Java `ReplayParser`、`PlayerResult`、`Columns`（单场列）、`AggregateSheets`（汇总列）。
2. Java Web API `Mapper`（`/api/columns` 只回英文 key）+ 前端 `PLAYER_LABELS` / `AGG_LABELS`。
3. 测试（`ParityTest`、`WebApiTest`）。
5. 文档（本文件 + README）。

原则：业务逻辑只有 Java 一套主线（`python/` 仅保留车辆库更新脚本，不承载提取/导出逻辑）。所有解析/评分/导出改动都进 `java/`。

## 测试命令

Java：

```bash
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml test
```

前端构建：

```bash
cd java/frontend
npm run build
```

网络受限环境下，Java / npm 依赖可能无法重新下载。仓库当前包含 `node_modules` 和部分构建产物，但不要把它们当成源码真相。

> Windows 环境默认 `java` 可能是 JDK 8。执行 Maven 前请先把 `JAVA_HOME` 指向 JDK 21。

## 常见改动流程

### 增加一个玩家字段

1. 在 Java `ReplayParser`、`PlayerResult`、`Columns`、`Mapper` 中同步（单场表与明细表经 `Columns` 自动生效，无需手改导出类）。
2. 更新测试（`ParityTest`），至少验证字段存在、类型正确、导出不破坏。
3. 更新文档字段表。

### 调整汇总指标

1. 先改 Java `Aggregator`（+ `model.Agg` 指标）和 `AggregateSheets`（汇总列）。
2. 若 Web/离线 UI 预览展示该指标，同步 `Mapper.aggregateColumns()`。
3. 用 `common/data/` 样本跑 Java 测试。

### 更新车辆库

车辆库是**单一来源** `common/tankopedia.json`，无需手动同步：

1. `cd python && python update_tankopedia.py`（写入 `common/tankopedia.json`，需要网络）。
2. 跑 Java 测试（Java 构建会自动把 `common/tankopedia.json` 复制到 classpath）。
3. 重新构建 exe 或 Docker 镜像。

## 风险点

- 终端编码：Windows PowerShell 可能把 UTF-8 中文显示成乱码，但文件仍应保存为 UTF-8。
- protobuf 字段没有官方 schema，字段语义来自样本和社区项目交叉验证。
- pickle 读取逻辑只针对当前 `battle_results.dat` 结构，不是通用 pickle VM。
- `tankopedia.json` 依赖外部 blitzkit 资源，更新时需要网络。
- Web 上传接口无持久化和鉴权，适合本地/内网工具，不是公开服务安全模型。
- 离线 exe 采用本地 Web UI，已处理端口占用、浏览器自动启动、程序退出服务残留等问题。

## CI/CD 自动部署

`push` 到 `main` 分支触发 GitHub Actions（[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)）：

1. **构建镜像**：根目录 `Dockerfile` 多阶段构建，合并 nginx + JRE 单镜像。
2. **推送 Docker Hub**：`a158coke/wotbtool:sha-<7位SHA>` + `a158coke/wotbtool:latest`。
3. **SSH 部署 VPS**：`/opt/wotb` 下 `docker compose pull && docker compose up -d`。

VPS 上只需要一个 `docker-compose.yml`：

```yaml
services:
  wotb:
    image: a158coke/wotbtool:latest
    container_name: wotb
    ports:
      - "8088:80"
    restart: unless-stopped
```

> 根 `Dockerfile` 与 `java/online/` 下的 Dockerfile 用途不同：前者是 CI/CD 单镜像（部署用），后者保留给本地 `docker compose up --build` 开发。

## 给 AI coder 的工作准则

- 先读 `README.md`、`java/README.md`、本文件和相关测试，再改代码。
- 不要根据乱码输出判断文件内容坏了；优先用 UTF-8 方式读取。
- 不要在 `node_modules`、`target`、`dist` 中做源码修改。
- 小改动也要考虑 Java 离线 exe 与 Web 版是否需要同步。
- 如果只改 Web UI 的显示名，改前端 `PLAYER_LABELS` / `AGG_LABELS` 即可；API 只回英文 key，不要把中文加回 API。
- `Columns.java` 是 Java 侧列的 key/顺序/取值与**单场 xlsx 表头**的来源；新增字段先加 `Col` 记录，再同步前端映射、汇总列。
- 任何会改变界面/导出/数据的更新，都要同步更新文档（本文件 + README/java/README）。
