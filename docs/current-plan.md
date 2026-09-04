# 3D Battle Playback First — PR1 Client Map Research

## 状态

IMPLEMENTING / STATIC GEOMETRY CHAIN PROVEN / CANAL + PORT BAY DERIVED POC VALIDATION NEXT

## 目标

完成 `Maps.zip -> Map Geometry Core -> 3D Battle Playback` 路线中的 PR1：

1. 用真实客户端资源证明 terrain / static geometry / collision / terrain-associated data 的来源；
2. 留下可重复的 research tooling；
3. 对第一批真实 Playback example 产出 renderer-neutral derived geometry PoC；
4. 明确 PR2 的 Map Geometry Core 输入。

当前不实现 frontend 3D renderer。

## Example 策略

### 格式逆向 research sample

保留：

```text
05_amigosville_am
```

Falls Creek / 乡间溪流。

它已经完成 SC2 / SCG / datasource / PolygonGroup 格式链路的实证研究，因此继续作为**格式研究样本**，无需因为后续 Playback example 调整而重做。

### 第一批 3D Playback examples

改为两张：

```text
18_canal_cn   = Canal / 运河尽头
14_port_pt    = Port Bay / 港湾小镇
```

原因：

- 用户数据库没有 `05_amigosville_am` 的 replay，因此它不适合作为第一批端到端 Playback 验证图；
- `18_canal_cn` 与 `14_port_pt` 都已有 WotBTools 2D basemap；
- 两张地图后续可直接使用真实 replay 验证 `replay coordinates -> terrain -> static geometry -> vehicle overlay`；
- 第一批使用两张图而不是一张，可尽早发现 map-specific SC2/SCG/LOD/switch 差异，避免把单图偶然结构误写成全地图 contract。

PR1 / PR2 后续不得再把 `05_amigosville_am` 描述为首批 Playback demo；它仅保留为 reverse-engineering reference sample。

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

## 已证明的 SC2 -> SCG static geometry contract

以下数字来自 `05_amigosville_am` research sample：

主场景：

- SceneFileV2 v48；
- 1775 entities；
- RenderComponent 1216；
- CollisionTypeComponent 1056；
- LodComponent 934；
- Mesh render objects 773；
- RenderBatch 3876。

主 SC2 `#dataNodes` 中 PolygonGroup = 0。

companion SCG：

- SCPG v1；
- 221 PolygonGroups；
- 164,307 vertices；
- 266,417 indices；
- 95,833 primitives；
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

因此以下链路已被真实数据证明：

```text
SC2 Entity
  -> RenderComponent
  -> Mesh
  -> RenderBatch
  -> rb.datasource
  -> same-basename companion SCG
  -> PolygonGroup #id
  -> vertices / indices
```

接下来 `18_canal_cn` 和 `14_port_pt` 的任务不是重新猜格式，而是验证这套 contract 是否可复用，并产出真实 derived geometry。

## Vertex / index contract

当前真实样本已经确认：

- interleaved vertex buffer；
- `EVF_VERTEX` 为 offset 0 的 float32 XYZ；
- stride 可由 `len(vertices) / vertexCount` 严格验证；
- 当前 221 个 PolygonGroup 的 `indexFormat=0`，实际 payload 均满足 `indexCount * 2`，即 uint16；
- decoder 会验证 finite position、index payload size 与 local index bounds。

DAVA world transform contract：

```text
scaled = worldScale * localVertex
world = worldRotation.ApplyToVectorFast(scaled) + worldTranslation
```

最终数据模型继续保持：

```text
shared local geometry + instance world transform
```

而不是为每个建筑实例复制 baked geometry。

## Collision

`05_amigosville_am` 已确认大量 `CollisionTypeComponent`，字段：

```text
CollisionType
Density
FallingType
Health
MaterialKind
```

当前结论：

> collision / destruction / material classification metadata 属于 scene entity。

仍未证明独立 collision mesh，或 gameplay collision 是否复用 visual PolygonGroup。

这不阻塞首批 3D Playback visual geometry，但会在后续 AI LOS/pathfinding spatial core 前继续解决。

## TerrainData / MKM / LKA

research sample 已确认 TerrainDataComponent 直接引用 `.mkm/.lka`。

MKM 的 24-byte header + 262,144-byte payload 是强 packed-grid 特征，但语义未证明；LKA 也仍是 terrain-associated opaque data。

因此不得提前把 MKM/LKA 写成 navmesh/passability。

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

Reusable SCPG geometry decoder：

- `read_scg()`；
- `polygon_group_id()`；
- `polygon_group_vertex_stride()`；
- `decode_polygon_positions()`；
- `decode_polygon_indices()`；
- `position_aabb()`。

### `common/python/inspect_map_scg.py`

- companion SCG discovery；
- SCPG / PolygonGroup inventory；
- SC2 `rb.datasource` ↔ SCG `#id` exact cross-check。

### `common/python/export_map_geometry_poc.py`

renderer-neutral derived geometry PoC：

- 只选 `Mesh` render objects；
- 默认 `lodIndex=0`；
- 默认 `switchIndex=0`；
- 排除 shadow-only；
- 每个实际引用到的 PolygonGroup 只 decode 一次；
- positions 输出 float32 XYZ；
- indices 规范化输出 uint32；
- manifest 保留 SC2 world scale/rotation/translation；
- 不输出 textures/materials/normals/tangents/UV/SpeedTree；
- derived output 位于已 ignore 的 `tmp/`。

### Tests

`common/python/tests/test_wotb_scg.py` 覆盖：

- interleaved position decode；
- uint16 index decode；
- local AABB；
- out-of-range index rejection；
- missing EVF_VERTEX rejection。

## 下一执行步骤 — 第一批双地图

在开发机更新分支后执行：

```powershell
python common/python/inspect_map_scg.py "<Maps.zip>" 18_canal_cn
python common/python/export_map_geometry_poc.py "<Maps.zip>" 18_canal_cn

python common/python/inspect_map_scg.py "<Maps.zip>" 14_port_pt
python common/python/export_map_geometry_poc.py "<Maps.zip>" 14_port_pt
```

默认输出：

```text
tmp/map-research/18_canal_cn-scg-inspection.json
tmp/map-research/18_canal_cn-geometry-poc.json
tmp/map-research/18_canal_cn-positions.f32le.bin
tmp/map-research/18_canal_cn-indices.u32le.bin

tmp/map-research/14_port_pt-scg-inspection.json
tmp/map-research/14_port_pt-geometry-poc.json
tmp/map-research/14_port_pt-positions.f32le.bin
tmp/map-research/14_port_pt-indices.u32le.bin
```

两张图都必须记录：

1. companion SCG 是否存在；
2. `rb.datasource -> PolygonGroup #id` 命中率；
3. selected Mesh instance count；
4. selected unique datasource count；
5. decoded position/index count；
6. output buffer bytes；
7. skipped LOD/switch/shadow counts；
8. malformed / unsupported geometry blocker。

### 双地图 Gate

只有同时满足：

```text
18_canal_cn blocker = 0
14_port_pt  blocker = 0
```

才把当前 static-geometry extraction contract 升级为 PR2 的首版 Map Geometry Core contract。

如果两张图出现不同 SC2/SCG/LOD/switch 结构，则先修通用 parser/exporter，不做 map-id hardcode。

## PR1 Definition of Done

- [x] 真实 Maps.zip inventory；
- [x] terrain + coordinate 基础能力；
- [x] `05_amigosville_am` format research sample；
- [x] main SC2 PolygonGroup=0；
- [x] companion SCG SCPG/PolygonGroup decode；
- [x] SC2 datasource ↔ SCG PolygonGroup exact link 107/107；
- [x] vertex/index format contract；
- [x] reusable position/index decoder；
- [x] renderer-neutral derived geometry PoC exporter；
- [x] first Playback examples 改为 `18_canal_cn` + `14_port_pt`；
- [ ] `18_canal_cn` real derived geometry PoC blocker=0；
- [ ] `14_port_pt` real derived geometry PoC blocker=0；
- [ ] collision representation 的 PR1 最终边界说明；
- [ ] nav/passability 的 PR1 最终边界说明；
- [ ] PR2 Map Geometry Core 输入/DoD 定稿。

## 非目标

PR1 不做：

- frontend 3D renderer；
- 2D/3D toggle；
- 全地图 batch conversion；
- 原客户端纹理/材质复刻；
- SpeedTree/草地重建；
- 完整 tank 3D model；
- AI LOS/pathfinding；
- 把 MKM/LKA 猜测写成事实；
- 把 raw Maps.zip 或 bulk client asset 提交进 Git。
