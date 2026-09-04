# 3D Battle Playback First — PR1 Client Map Research

## 状态

IMPLEMENTING / STATIC GEOMETRY CHAIN PROVEN / DERIVED GEOMETRY POC VALIDATION NEXT

## 目标

完成 `Maps.zip -> Map Geometry Core -> 3D Battle Playback` 路线中的 PR1：

1. 用真实客户端资源证明 terrain / static geometry / collision / terrain-associated data 的来源；
2. 留下可重复的 research tooling；
3. 产出第一张地图的 renderer-neutral derived geometry PoC；
4. 明确 PR2 的 Map Geometry Core 输入。

当前不实现 frontend 3D renderer。

## 已确认基础

- `common/python/wotb_sc2.py`：DVPL + DAVA SceneFileV2 reader。
- `map-semanticizer`：Landscape world bounds + heightmap + elevation/slope。
- SC2 spawn/base Z 已与 heightmap sampling 做真实交叉验证。
- client scene / replay / 2D basemap 已使用同一 world-coordinate contract。
- 完整 `Maps.zip` 可按 map id 读取主 SC2。

## 真实 Maps.zip inventory

已确认：

- archive：2,107,519,076 bytes（约 1.96 GiB）；
- 4,316 files；
- 35 个 `NN_*` 目录 = 33 battle maps + `00_global_content` + `00_shared_content`；
- `.sc2.dvpl` 84；
- `.scg.dvpl` 84；
- `.heightmap.dvpl` 38；
- `.mkm.dvpl` 37；
- `.lka.dvpl` 65；
- texture payload 约占 uncompressed archive 86.3%。

第一张 vertical slice：

```text
05_amigosville_am
```

Falls Creek / 乡间溪流。

## SC2 真实结论

主场景：

- SceneFileV2 v48；
- 1775 entities；
- RenderComponent 1216；
- CollisionTypeComponent 1056；
- LodComponent 934；
- Mesh render objects 773；
- RenderBatch 3876。

主 SC2 `#dataNodes`：

- NMaterial 5559；
- ParticleEmitterNode 3689；
- SceneRenderConfig 1；
- AnimationData 1；
- **PolygonGroup 0**。

所以地图 static mesh 不在主 SC2 dataNodes 内。

每个 RenderBatch 都带整数：

```text
rb.datasource
```

## Static geometry reference chain — 已确认

真实 companion sidecar：

```text
Maps/05_amigosville_am/05_amigosville_am.sc2.dvpl
Maps/05_amigosville_am/05_amigosville_am.scg.dvpl
```

SCG：

- SCPG version 1；
- nodeCount = nodeCount2 = 221；
- parsed bytes = file bytes = 10,243,320；
- trailing bytes = 0；
- 221 PolygonGroups；
- 221/221 有唯一 `#id`；
- 164,307 vertices；
- 266,417 indices；
- 95,833 primitives；
- vertex payload 9,643,728 bytes；
- index payload 532,834 bytes；
- index payload mismatch = 0。

SC2 ↔ SCG exact datasource cross-check：

```text
RenderBatch occurrences          3876
unique rb.datasource ids          107
SCG PolygonGroup ids              221
matched unique datasource ids     107 / 107
matched RenderBatch occurrences  3876 / 3876
unmatched datasource ids            0
```

因此 static geometry source/reference chain 已闭环：

```text
SC2 Entity
  -> RenderComponent
  -> Mesh
  -> RenderBatch
  -> rb.datasource
  -> companion SCG PolygonGroup #id
  -> vertices / indices
```

114 个 SCG PolygonGroup 未被当前主场景 RenderBatch 引用；不能在没有消费证据时自动加入 runtime geometry。

## Vertex / index format

真实 SCG vertexFormat：

```text
411    157 groups
27      25
13837   22
395      9
5129     3
5        3
5133     1
17       1
```

真实 derived stride：

```text
64 B  157 groups
56 B   31
40 B   28
16 B    3
44 B    1
20 B    1
```

indexFormat：

```text
0 = all 221 groups
```

真实 payload 对 `indexCount * 2` 全部匹配，所以当前样本 indexFormat 0 对应 uint16 payload。

DAVA `PolygonGroup::UpdateDataPointersAndStreams()` 的实现确认：

1. vertex buffer 是 interleaved stride；
2. `EVF_VERTEX` 最先处理；
3. `EVF_VERTEX` 是 float3 position；
4. 所以后续 PoC 可按每个 vertex 的 offset 0 读取 `<fff>` position。

## World transform contract

DAVA `TransformComponent::Serialize()` 明确保存：

```text
tc.worldTranslation
tc.worldScale
tc.worldRotation
```

Quaternion layout：

```text
x, y, z, w
```

DAVA world transform 语义：

```text
scaled = worldScale * localVertex
world = worldRotation.ApplyToVectorFast(scaled) + worldTranslation
```

因此 geometry 不需要 bake 成重复 world-space mesh；最终结构应保留：

```text
shared local geometry + instance world transform
```

## Collision

已确认 1056 个 `CollisionTypeComponent`，字段：

```text
CollisionType
Density
FallingType
Health
MaterialKind
```

当前能确认：

> collision / destruction / material classification metadata 属于 scene entity。

仍未确认：

- 是否存在独立 collision mesh；
- gameplay collision 是否直接复用 visual PolygonGroup；
- `CollisionType` 的完整 enum 语义。

PR1 不因为 collision mesh 未完全逆向而阻塞 static 3D Playback geometry PoC；但必须在 PR2 spatial-analysis 前继续解决。

## TerrainData / MKM / LKA

TerrainDataComponent 明确引用：

```text
blitz/05_amigosville_am.mkm
blitz/05_amigosville_am.lka
blitz/map_effects.yaml
```

MKM：

- 262,168 decoded bytes；
- `kkm\0`；
- header uint32 出现 `1 / 1024 / 262144`；
- 24-byte header + 262,144-byte payload。

该 shape 很像固定尺寸 packed map，但目前只记录为：

> fixed-size packed terrain-associated binary

不得提前写成 navmesh/passability。

LKA：

- 12,862 decoded bytes；
- KeyedArchive-like `KA` header；
- 当前仍为 opaque terrain-associated binary。

## 当前工具

### `common/python/inventory_maps_zip.py`

- central-directory inventory；
- per-map / extension / bytes；
- selective extraction。

### `common/python/inspect_map_scene.py`

- SC2 component / render-object / RenderBatch；
- collision / terrain components；
- MKM/LKA basic payload inspection。

### `common/python/wotb_scg.py`

已从最小 SCPG reader 扩展为 reusable geometry decoder：

- `read_scg()`；
- `polygon_group_id()`；
- `polygon_group_vertex_stride()`；
- `decode_polygon_positions()`；
- `decode_polygon_indices()`；
- `position_aabb()`。

decoder 会验证：

- EVF_VERTEX 存在；
- vertex payload 可整除 vertexCount；
- position 为 finite float3；
- index payload size；
- index 不越界。

### `common/python/inspect_map_scg.py`

- companion SCG discovery；
- SCPG / PolygonGroup inventory；
- SC2 `rb.datasource` ↔ SCG `#id` exact cross-check。

### `common/python/export_map_geometry_poc.py`

renderer-neutral derived geometry PoC：

输入：

```text
Maps.zip + map id
```

输出到 `tmp/map-research/`：

```text
05_amigosville_am-geometry-poc.json
05_amigosville_am-positions.f32le.bin
05_amigosville_am-indices.u32le.bin
```

设计：

- 只选 `Mesh` render objects；
- 默认 `lodIndex=0`；
- 默认 `switchIndex=0`；
- 排除 shadow-only；
- 每个实际引用到的 PolygonGroup 只 decode 一次；
- positions 输出 float32 XYZ；
- indices 规范化输出 uint32；
- instance manifest 保留 SC2 world scale/rotation/translation；
- 不输出 textures/materials/normals/tangents/UV/SpeedTree；
- 不提交 derived output，默认全部位于已 ignore 的 `tmp/`。

### Tests

`common/python/tests/test_wotb_scg.py`：

- interleaved position decode；
- uint16 index decode；
- local AABB；
- out-of-range index rejection；
- missing EVF_VERTEX rejection。

## 下一执行步骤

在开发机更新分支后运行：

```powershell
python common/python/export_map_geometry_poc.py "<Maps.zip>" 05_amigosville_am
```

目标不是再次证明 SCG link，而是验证：

1. 107 个当前场景实际使用的 geometry 是否全部成功 decode；
2. position/index validation blocker 是否为 0；
3. 初始状态 `LOD 0 / switch 0` 实际得到多少 Mesh instances；
4. derived position/index buffer 大小；
5. manifest 中 world transform 是否完整；
6. 是否出现 unsupported / malformed group。

成功后，PR1 的 static geometry 研究部分结束。

## PR1 Definition of Done

- [x] 真实 Maps.zip inventory；
- [x] map count / extension / per-map/shared structure；
- [x] terrain + coordinate 基础能力；
- [x] 第一张地图 SC2 scene/resource trace；
- [x] CollisionTypeComponent 字段确认；
- [x] `.mkm/.lka` TerrainDataComponent 引用与 basic payload shape；
- [x] 主 SC2 PolygonGroup=0；
- [x] companion SCG SCPG/PolygonGroup decode；
- [x] SC2 datasource ↔ SCG PolygonGroup exact link 107/107；
- [x] vertex/index format + stride/index payload contract；
- [x] reusable position/index decoder implementation；
- [x] renderer-neutral derived geometry PoC exporter implementation；
- [ ] 在真实 Maps.zip 上执行 derived geometry PoC，blocker=0；
- [ ] collision representation 的 PR1 最终边界说明；
- [ ] nav/passability 的 PR1 最终边界说明；
- [ ] PR2 Map Geometry Core 输入/DoD 定稿。

## 非目标

PR1 不做：

- frontend 3D renderer；
- 2D/3D toggle；
- 全地图批量 conversion；
- 原客户端纹理/材质复刻；
- SpeedTree/草地重建；
- 完整 tank 3D model；
- AI LOS/pathfinding；
- 把 MKM/LKA 猜测写成事实；
- 把 raw Maps.zip 或 bulk client asset 提交进 Git。
