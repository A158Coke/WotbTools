# 3D Battle Playback — Client Map Research

## 状态

PR1 / Phase 0：**IN PROGRESS — REAL INVENTORY COMPLETE / SCENE REFERENCE TRACE NEXT**。

当前仓库已经证明 terrain / coordinate 基础能力；本 PR 不重复造解析器，重点补齐完整 `Maps.zip` 的资源盘点，以及 3D Playback 真正缺失的 static geometry / collision / navigation 证据。

## 已确认的仓库事实

### 1. DVPL + SC2 已可解析

`common/python/wotb_sc2.py` 已提供纯标准库的 DVPL 解压和 DAVA SceneFileV2 (`*.sc2`) 解析能力；`extract_map_bases.py` 已直接支持从完整 `Maps.zip` 读取每张地图主场景。

因此 PR1 禁止再实现第二套 DVPL / SC2 parser。

### 2. Terrain heightmap 已可解码

`map-semanticizer/map_semanticizer.py` 已能够：

- 从 `Landscape` entity 读取 world bounds；
- 发现并解码 `*.heightmap*.dvpl`；
- 还原 height samples；
- 计算 elevation / slope；
- 在世界坐标上采样 terrain height。

这意味着“是否有真实高度数据”已经不是未知项。

### 3. Replay / client map coordinate 已有真实交叉验证

现有 map semantics 以米为单位保存 `x/y/z` world coordinates，并通过 SC2 的 spawn / base point Z 与 heightmap bilinear sampling 做交叉验证。

`docs/reference/maps.md` 同时记录：基地 scene coordinates 与 replay coordinates、2D basemap coordinate bounds 使用同一 world frame。

因此后续 3D Playback 应复用该 contract，而不是重新发明另一套坐标系。

## 真实 Maps.zip Inventory（2026-09-04）

开发机输入：

```text
C:\Users\yu.chen\Downloads\Maps.zip
```

archive central-directory inventory 已完成。以下数字均来自真实 ZIP，不是估计：

- archive bytes：`2,107,519,076`（约 1.96 GiB）；
- archive members：`4,316`；
- uncompressed member bytes：`2,291,239,572`（约 2.13 GiB）；
- 顶层资源全部位于 `Maps/`；
- inventory 识别出 35 个 `NN_*` 目录，其中：
  - `00_global_content`：全局资源根；
  - `00_shared_content`：共享资源根；
  - 其余 33 个为 battle map 目录。

### 主要扩展名

| extension | count | uncompressed bytes | 当前解释 |
|---|---:|---:|---|
| `.dds.dvpl` | 3514 | 1,795,153,886 | DirectX texture payload |
| `.pvr.dvpl` | 338 | 181,466,714 | texture payload |
| `.anim.dvpl` | 116 | 6,581,483 | animation asset |
| `.sc2.dvpl` | 84 | 43,889,613 | DAVA SceneFileV2 / scene-model side |
| `.scg.dvpl` | 84 | 243,187,825 | SCPG model-data candidate；需实际 decode 验证具体用途 |
| `.lka.dvpl` | 65 | 430,703 | engine-specific per-map data；语义未证明 |
| `.yaml.dvpl` | 40 | 4,831 | map effects config 等 |
| `.heightmap.dvpl` | 38 | 17,047,475 | 已有 parser 的 terrain height source |
| `.mkm.dvpl` | 37 | 3,477,042 | engine-specific per-map data；语义未证明 |

texture candidate 合计约 `1,976,620,600` bytes，占全部 uncompressed member bytes 约 **86.3%**。

结论：Production 3D 资产不能直接发布/加载原始客户端纹理集合；后续 runtime asset 必须做 derived geometry、纹理删除/替代/降采样等预算控制。

## Geometry heuristic 修正

第一版 inventory 的 `geometry=0` **不能解释为 Maps.zip 没有 geometry**。

原因：第一版 filename heuristic 只识别 `.mesh/.polygon/.geom/...`，没有把 `.scg` 纳入 geometry candidate。

公开的 WotB SC2/SCG reverse-engineering 资料指出：WoT Blitz 模型通常由 `.sc2 + .scg` 配对，SCPG/SCG 是模型数据的一部分。因此 `.scg` 必须进入 geometry investigation。

参考：

- https://github.com/Pyogenics/WOTBSCPGFormat

但仍需保持证据边界：

> “SCG 是模型格式”不等于“这 84 个 SCG 就是地图静态建筑 geometry”。

真实 inventory 显示，大多数 battle map 自己的目录并没有 `.scg`；`.scg` 主要集中于 shared content。地图主 SC2 很可能通过 shared references、SC2 render-object data 或其他 engine-specific resource chain 取得静态物体。这个引用链必须由主 SC2 实际解析结果证明。

## Collision / Navigation 当前结论

### Collision

filename/path heuristic 只找到 1 个：

```text
Maps/00_shared_content/other/images/blocking_volume.dx11.dds.dvpl
```

它是一个 texture path，不能据此声称存在 collision mesh。

当前状态：

> **独立 collision representation：NOT YET PROVEN。**

后续要检查 SC2 components / render objects / model payload 是否携带 collision/physics 数据。

### Navigation / Passability

filename/path heuristic 没有发现 `navmesh/navigation/waypoint/pathfinding/passability` 命名资源。

但每张地图普遍存在 `.mkm`，并且不少地图存在多个 `.lka` variant。这两个格式目前仍是 engine-specific opaque data，不能无证据标成 navmesh。

当前状态：

> **独立 navigation/passability representation：NOT YET PROVEN。**

下一步必须先 inspect payload/header/reference usage，再决定 `.mkm/.lka` 的语义。

## 第一张 3D Vertical Slice 地图

选择：

```text
05_amigosville_am
```

展示名：Falls Creek / 乡间溪流。

真实 inventory：

- 56 files；
- 31,425,796 uncompressed bytes；
- 1 heightmap；
- 1 main SC2；
- 47 texture candidates。

选择原因：

1. 主场景唯一，不需要先解决多 SC2 variant；
2. 体积适中，selective research 成本低；
3. 有明显高低差，适合验证 terrain mesh；
4. 有大型人工结构，适合追 static-object reference chain；
5. 已有 WotBTools 2D basemap / map semantics，可直接做坐标对照；
6. 后续真实 replay overlay 能同时验证 terrain height、XY frame、建筑位置与基地位置。

除非 scene inspection 证明资源结构异常，否则 PR2 vertical slice 固定从该地图开始。

## Inventory 工具

使用：

```powershell
python common/python/inventory_maps_zip.py "C:\Users\yu.chen\Downloads\Maps.zip"
```

默认输出：

```text
tmp/map-research/maps-inventory.json
```

inventory 只读取 ZIP central directory，不会为了盘点而解压整个多 GB archive。

### 单地图 extraction

只抽取一张地图：

```powershell
python common/python/inventory_maps_zip.py "C:\Users\yu.chen\Downloads\Maps.zip" \
  --extract-map 05_amigosville_am
```

默认落到：

```text
tmp/map-research/extracted/
```

`tmp/` 已被仓库 `.gitignore` 排除。禁止把完整 `Maps.zip`、完整客户端资源或批量 raw assets 提交到仓库。

## SC2 Resource Reference Inspector

新增：

```text
common/python/inspect_map_scene.py
```

直接从完整 ZIP 中读取指定地图主 SC2，复用 `wotb_sc2.py`，输出：

- SC2 metadata；
- entity count / entity names sample；
- component type counts；
- `RenderComponent` / `rc.renderObj` keys；
- SC2 中实际出现的 resource path/string references；
- reference extension counts；
- binary field path / size samples。

下一步执行：

```powershell
python common/python/inspect_map_scene.py "C:\Users\yu.chen\Downloads\Maps.zip" 05_amigosville_am
```

默认输出：

```text
tmp/map-research/05_amigosville_am-scene-inspection.json
```

这份 report 将决定下一步到底应该：

- 解析 shared `.sc2/.scg` model pair；
- 从 map SC2 内部 render object 提取 polygon data；
- 追其他 shared asset reference；
- 或研究 `.mkm/.lka`。

在 scene reference trace 完成之前，不选 Three.js/Babylon.js，也不开始 glTF converter。

## 下一步研究顺序

1. [x] 在真实 `Maps.zip` 上生成 inventory。
2. [x] 核对真实目录数量、extension、shared-vs-map structure。
3. [x] 选择第一张 vertical-slice map：`05_amigosville_am`。
4. [ ] 执行 `inspect_map_scene.py`，追主 SC2 resource/render reference。
5. [ ] 根据真实 reference 只抽取必要 shared model/resource，而不是整个 shared root。
6. [ ] 对 `.scg` geometry path 做实际 parser/converter compatibility test。
7. [ ] 检查 collision representation。
8. [ ] 检查 `.mkm/.lka` header/reference，确认或排除 navigation/passability 角色。
9. [ ] 用现有 heightmap + coordinate contract 生成 terrain mesh proof-of-concept。
10. [ ] 再决定 static geometry 转换策略及 browser runtime format。

## PR1 Definition of Done

PR1 完成时必须留下可审计结论：

- [x] 真实 `Maps.zip` inventory 已生成并核验；
- [x] 地图数量、主要 extension、per-map/shared 结构已记录；
- [x] terrain source 已与现有 heightmap parser 对上；
- [ ] static geometry source / reference chain 已确认或明确证明尚未确认；
- [ ] collision representation 状态已确认；
- [ ] navigation/passability representation 状态已确认；
- [ ] 至少一张地图完成 selective extraction / scene trace；
- [x] 第一张 3D vertical-slice 地图已选定；
- [ ] PR2 输入明确：需要转换哪些真实资源，以及哪些现有 parser/coordinate contract 直接复用。

## 非目标

PR1 不做：

- 3D frontend renderer；
- 2D/3D toggle；
- 全地图批量转换；
- 完整坦克模型；
- 纹理/光照复刻；
- AI LOS/pathfinding；
- 将 filename heuristic 当成已解码事实。
