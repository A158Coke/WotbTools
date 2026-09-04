# 3D Battle Playback — Client Map Research

## 状态

PR1 / Phase 0：**IN PROGRESS**。

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

## 仍需由实际 Maps.zip 回答的问题

PR1 必须以真实客户端 archive 为证据回答：

1. 每张地图包含哪些资源类型、扩展名和体积；
2. static 3D geometry 是直接存在于地图目录、被 SC2 引用，还是依赖 shared asset；
3. 建筑 / 岩石 / 墙体等可渲染 geometry 的实际格式与引用链；
4. 是否存在独立 collision mesh / blocking geometry / physics representation；
5. 是否存在 navmesh / passability / waypoint / pathfinding 数据；
6. geometry/material/texture 是否可在不发布完整客户端原始资源的前提下转成 derived runtime asset；
7. 第一张 vertical-slice 地图应该选择哪一张。

在真正解码文件格式之前，任何基于文件名的 `geometry/collision/navigation` 分类都只能标记为 **candidate**，不得写成已确认能力。

## Inventory 工具

使用：

```powershell
python common/python/inventory_maps_zip.py "<path-to-Maps.zip>"
```

默认输出：

```text
tmp/map-research/maps-inventory.json
```

inventory 只读取 ZIP central directory，不会为了盘点而解压整个多 GB archive。

报告包含：

- archive 文件数量与压缩/解压后总量；
- map directory 数量；
- 每张地图文件数 / bytes；
- 扩展名统计和有限 sample paths；
- scene / heightmap / geometry / collision / navigation / material / texture candidate groups。

### 单地图 extraction proof-of-concept

只抽取一张地图：

```powershell
python common/python/inventory_maps_zip.py "<path-to-Maps.zip>" \
  --extract-map 05_amigosville_am
```

默认落到：

```text
tmp/map-research/extracted/
```

`tmp/` 已被仓库 `.gitignore` 排除。禁止把完整 `Maps.zip`、完整客户端资源或批量 raw assets 提交到仓库。

## 下一步研究顺序

1. 在真实 `Maps.zip` 上生成 inventory。
2. 从 candidate groups 中选一张资料完整且熟悉的地图。
3. 仅抽取这一张地图，而不是解压整个 archive。
4. 追主 SC2 引用，确认 terrain/static object/material/resource dependency graph。
5. 对 collision/navigation candidate 做格式验证；不存在时也必须明确记录“未发现/未证明”。
6. 用现有 heightmap + coordinate contract 先生成 terrain mesh proof-of-concept。
7. 再决定 static geometry 转换策略及浏览器 runtime format；在这一步之前不锁定 Three.js/Babylon.js/glTF pipeline。

## PR1 Definition of Done

PR1 完成时必须留下可审计结论：

- [ ] 真实 `Maps.zip` inventory 已生成并核验；
- [ ] 地图数量、主要 extension、per-map/shared 结构已记录；
- [ ] terrain source 已与现有 heightmap parser 对上；
- [ ] static geometry source / reference chain 已确认或明确证明尚未确认；
- [ ] collision representation 状态已确认；
- [ ] navigation/passability representation 状态已确认；
- [ ] 至少一张地图完成 selective extraction；
- [ ] 第一张 3D vertical-slice 地图已选定；
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
