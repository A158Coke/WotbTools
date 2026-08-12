# WotB Map Semanticizer

这是一个单文件、无第三方依赖的 WotB 客户端地图语义化脚本。

它读取地图目录或单张地图 ZIP 中的：

- 主 `.sc2` / `.sc2.dvpl` 场景；
- `.heightmap` / `.heightmap.dvpl` 高程图；
- SC2 中的出生点、占领点、地图边界和场景对象。

然后输出：

- `<mapId>.semantic.json`：供 WotBTools 后端读取的 `areas + relationships + spawnSemantics`；
- `<mapId>.semantic.txt`：可直接作为 Map Skill 注入 LLM 的紧凑中文文本。

## Windows 使用

要求 Python 3.11 或更高版本，不需要执行 `pip install`。

```powershell
python .\map_semanticizer.py `
  "E:\World_of_Tanks_EU\app\Data\3d\Maps\02_desert_train_dt" `
  --output-dir ".\semantic-output" `
  --variant dt1 `
  --map-code "desert_train" `
  --display-name "Desert Sands"
```

也可以直接输入一张地图的 ZIP：

```powershell
python .\map_semanticizer.py `
  ".\02_desert_train_dt.zip" `
  --output-dir ".\semantic-output" `
  --map-code "desert_train"
```

`--map-code` 是 WotBTools 后端的内部地图 code（`meta.json` 的 `mapName`，如 `desert_train`），可重复传入；脚本会写入 JSON 的 `mapCodes` 字段，后端据此把客户端场景 ID（如 `02_desert_train_dt`）映射到内部地图 code。批量模式不能使用 `--map-code`（无法为每张地图自动推断 code）。

## 接入 WotBTools 后端

生成的 `<mapId>.semantic.json` 放到仓库 `common/map-semantics/` 目录（构建时由后端复制到 classpath，与 tankopedia/tactical profiles 同一来源模式）：

```powershell
python .\map_semanticizer.py `
  "E:\World_of_Tanks_EU\app\Data\3d\Maps" `
  --batch `
  --output-dir "..\..\common\map-semantics" `
  --variant auto `
  --map-names-file "..\..\common\map_names.json"
```

`--variant` 默认 `auto`：从 SC2 标签中选取战斗点最多的变体（如 `cn0` / `mlb1`）；无标签的夜战/重制地图（如 `faust_fa_night`）仍按精确场景数据输出出生点语义。`--map-names-file` 指向 `common/map_names.json`，批处理按 token 边界为每张图推导 `mapCodes`（客户端目录名与 meta.json mapName 不一致时在脚本 `MAP_ID_CODE_ALIASES` 中登记，如 `24_milibase_mlb` → `milbase`），并自动用 `map_names.json` 的 en 名填充 `displayName`（未收录的新图回退 mapId），保证语义数据里的地图名可读且与 `map_names.json` 一致；`map_names.json` 未收录的新图（如 `rudniki` / `grossberg` / `moon` / `iceworld`）`mapCodes` 留空，待补充显示名后可显式 `--map-code` 重新生成。

后端 `MapTacticalSemanticsRegistry` 会加载 `classpath:/map-semantics/*.semantic.json`，按 `mapCodes` / `mapId` 查询，并对 `NN_<code>_<variant>` 形式的 mapId 做 token 边界别名匹配；没有语义数据的地图保持 UNKNOWN，禁止 LLM 编造。

## 九宫格 GRID_REGION_1~9 对齐

每个语义网格 cell 输出 `nineGridRegion`（1–9），每个 area 汇总 `gridRegions`，与后端 `MapRegionResolver` 使用同一约定：

- 回放 raw 坐标 ±250 m 线性映射到 500×500 canonical 空间（`MapCoordinateProfile.DEFAULT`）；
- 行：北/上为 1|2|3，中为 4|5|6，南/下为 7|8|9；列自西向东；
- 语义化器 `x` 东正、`y` 北正，与回放 `(x, z)` 同向，`GRID_REGION = resolveRegion(x+250, y+250)`。

若部署端调整 `REPLAY_COORDINATE_HALF_EXTENT`，需同步修改脚本 `NINE_GRID_HALF_EXTENT` 并重新生成语义数据。

## 批量处理地图目录

脚本可以直接输入整个 `Maps` 根目录：

```powershell
python .\map_semanticizer.py `
  "E:\World_of_Tanks_EU\app\Data\3d\Maps" `
  --batch `
  --output-dir ".\semantic-output" `
  --variant dt1
```

批处理会逐个处理一级地图目录。某张地图缺少 SC2、heightmap 或指定战斗变体时会记录 `SKIP`，其余地图继续执行；只要存在失败项，进程最终返回非零退出码，方便 CI 或本地日志发现不完整结果。

## 可信边界

脚本会保留以下置信度层级：

- `EXACT_CLIENT_DATA` / `EXACT_SCENE_DATA`：客户端直接数值或属性；
- `NAME_HEURISTIC`：对象位置精确，但“建筑/铁路/植被”等类别由资源名判断；
- `GRID_RULE_DERIVED`：由 6×6 网格和确定性阈值合并出的区域候选；
- `RULE_DERIVED_CANDIDATE`：`favors` 和 `risks`，仅供 LLM 提出假设。

每份文档还带 `verified`：2026-08-12 起仓库内全部 33 张地图语义已由用户完成人工核验并置为 `true`；生成新地图时默认 `false`，需人工核验区域名称/类型/边界/favors/risks 后置 `true`。后端 Call #1 Prompt 会原样渲染该状态（已完成/未完成）与区域 `confidence` 五字段（geometry / objectPositions / objectCategories / areaBoundary / favorsAndRisks）；`verified=false` 时区域候选不得被描述为已验证事实。

当前版本不会自动生成：

- `CONTROLS`；
- `ENABLES_PRESSURE_AGAINST`；
- 已验证的交叉火力；
- 已验证的射线/视线；
- 已验证的可通行路线。

这些需要继续解析碰撞体、导航数据并执行视线/车辆尺度通行计算。缺少证据时输出 `UNKNOWN`，不猜地图战术。

后端 `MapTacticalSemanticsRegistry` 对 `relationships` 做**无损保留**：`from / type / to / reason / confidence` 原样进入 `List<TacticalRelationship>`，不做分组或改名（ADJACENT_TO 不会被改成 connects，CONTAINS_CONTROL_POINT 与 CONTAINS_STRATEGIC_POINT 不合并）；Call #1 Prompt 按原始类型渲染并明确「ADJACENT_TO 仅表示分析网格相邻，不代表可通行路线/视线/交叉火力」。

## 测试（手动维护，不接入 CI）

```powershell
python -m unittest discover -s map-semanticizer/tests -p 'test_*.py'
```

覆盖：heightmap 16×16 分块还原、`--variant auto` 与无标签地图、mapId→mapCodes token 边界匹配、区域置信度保留、关系引用有效性、禁止关系类型（CONTROLS / ENABLES_PRESSURE_AGAINST / CROSS_FIRE / 保证通行 / 保证视线）、全部 `common/map-semantics/*.semantic.json` 可解析、`map_names.json` 每个生产 map code 恰好一份语义文件覆盖、`gridRegions` 仅 1–9、Z 轴校验规则。

Z 轴校验规则以 P90 绝对偏差为准（稳健）：如 `24_milibase_mlb` 的 MAE=1.45m 由少量高架出生点拉高，但 P90=0.08m，heightmap 本身正常，不判失败；仅当 P90 > 0.5m 或无样本时才判失败。

## 输出结构

JSON 的主要结构：

```text
mapId
mapCodes
verified
source
terrain
analysisGrid.cells
areas
relationships
spawnSemantics
notGeneratedWithoutFurtherEvidence
```

`areas` 不使用人工写死的 `HILL/CITY`。脚本先基于客户端证据生成诸如：

```text
ELEVATED_TERRAIN_01
HARD_COVER_ZONE_01
LINEAR_CORRIDOR_01
LOW_TERRAIN_01
```

后续人工校验通过后，可以在 WotBTools 数据层给这些稳定区域 ID 增加业务别名，例如 `CITY`、`HILL`，而不破坏底层证据。
