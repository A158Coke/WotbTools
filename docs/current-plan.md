# 3D Battle Playback First — PR1 Client Map Research

## 状态

IMPLEMENTING / REAL INVENTORY + FIRST SCENE TRACE COMPLETE / POLYGONGROUP DECODE NEXT

## 目标

完成 `maps.zip -> Map Geometry Core -> 3D Battle Playback` 路线中的 PR1：先证明客户端真实提供哪些可用于 3D Playback 的地图数据，再进入 renderer。

## 已确认基础

1. `common/python/wotb_sc2.py` 已能解析 DVPL + DAVA SceneFileV2；禁止新建第二套 parser。
2. `map-semanticizer` 已能读取 Landscape world bounds + heightmap，并生成 elevation / slope。
3. SC2 spawn/base Z 与 heightmap sampling 已存在数值交叉验证。
4. `docs/reference/maps.md` 已记录 client scene / replay / 2D basemap 使用同一 world-coordinate contract。
5. `extract_map_bases.py` 已证明完整 `Maps.zip` 可按 map id 直接读取主 SC2。

## 真实 Maps.zip inventory

已确认：

- archive 2,107,519,076 bytes（约 1.96 GiB）；
- 4,316 files；
- uncompressed 2,291,239,572 bytes；
- 35 个 `NN_*` 目录 = 33 battle maps + `00_global_content` + `00_shared_content`；
- `.sc2.dvpl` 84；
- `.scg.dvpl` 84；
- `.heightmap.dvpl` 38；
- `.mkm.dvpl` 37；
- `.lka.dvpl` 65；
- texture payload 约占 uncompressed archive 的 86.3%。

## 第一张 Vertical Slice

固定：

```text
05_amigosville_am
```

Falls Creek / 乡间溪流。

## 第一轮真实 SC2 trace

主场景已解析：

- SceneFileV2 version 48；
- 1775 entities；
- decoded scene 8,205,972 bytes；
- `RenderComponent` 1216；
- `CollisionTypeComponent` 1056；
- `LodComponent` 934；
- `StaticOcclusionComponent` 1；
- `StaticOcclusionDataComponent` 1；
- `TerrainDataComponent` 1。

已观察到 `Mesh` / `RenderBatch` / Landscape render data，说明主地图 SC2 本身包含实际 render/data-node payload，不应默认所有建筑 geometry 都依赖外部 SCG。

主 SC2 resource refs：

- `.tex` 2717；
- `.sc2` 1691；
- `.material` 134；
- `.heightmap` 1；
- `.lka` 1；
- `.mkm` 1；
- `.yaml` 1。

`TerrainDataComponent` 明确引用：

```text
blitz/05_amigosville_am.mkm
blitz/05_amigosville_am.lka
blitz/map_effects.yaml
```

因此 `.mkm/.lka` 已确认是 terrain-associated engine data，但不能无证据标为 navmesh。

Collision 当前可确认：

> Collision classification/participation metadata exists.

仍未证明是否存在独立 collision geometry。

## Geometry 方向调整

公开 WotB SCPG 资料说明普通模型可由 `.sc2 + .scg` 配对，但第一张真实 battle map 主 SC2 已包含大量 mesh/render/data-node binary。

DAVA Engine `PolygonGroup::Save()` 明确在 SceneFileV2 data nodes 序列化：

```text
vertexFormat
vertexCount
indexCount
vertices
indices
primitiveCount
```

所以当前优先级改为：

1. 先确认地图主 SC2 的 PolygonGroup data nodes；
2. 直接统计 vertex/index payload；
3. 只在真实 dependency 需要时追 shared SC2/SCG。

## 当前实现

### `common/python/inventory_maps_zip.py`

- central-directory-only inventory；
- per-map / extension / bytes 统计；
- selective extraction；
- 不把 filename heuristic 当事实。

### `common/python/inspect_map_scene.py` schema v2

已升级，可输出：

- target component keys / samples；
- render-object class counts；
- render-batch fields；
- `#dataNodes` class/key counts；
- PolygonGroup count；
- total vertex/index/primitive counts；
- vertex/index payload bytes；
- vertexFormat/indexFormat distributions；
- CollisionTypeComponent / TerrainDataComponent 样本；
- `.mkm/.lka` decoded header / uint32 / printable-string samples。

## 下一执行步骤

更新分支后重新运行：

```powershell
python common/python/inspect_map_scene.py "<Maps.zip>" 05_amigosville_am
```

目标：

1. 确认 PolygonGroup 是否已在主 SC2 内完整携带 vertex/index data；
2. 取得 total vertices / indices / primitive count；
3. 读取真实 vertexFormat / indexFormat；
4. 展开 CollisionTypeComponent fields；
5. 检查 `.mkm/.lka` payload shape；
6. 决定是否可以直接开始 PolygonGroup mesh decoder PoC。

## PR1 Definition of Done

- [x] 真实 Maps.zip inventory 完成；
- [x] map count / extension / per-map/shared structure 已落档；
- [x] terrain + coordinate 基础能力确认；
- [x] 第一张地图首轮 scene/resource trace；
- [x] CollisionTypeComponent 广泛存在已确认；
- [x] `.mkm/.lka` TerrainDataComponent 引用已确认；
- [x] 第一张 3D vertical-slice 地图已选定；
- [ ] PolygonGroup static geometry representation 最终确认；
- [ ] collision geometry representation 最终确认；
- [ ] nav/passability representation 状态最终确认；
- [ ] vertex/index decode PoC；
- [ ] PR2 的真实输入和复用边界明确。

## 非目标

- 不实现 frontend 3D renderer；
- 不提前锁定 Three.js/Babylon.js；
- 不批量转换全部地图；
- 不提交完整 Maps.zip / raw client asset；
- 不开始 AI spatial analysis。
