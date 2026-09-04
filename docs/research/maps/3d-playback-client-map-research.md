# 3D Battle Playback — Client Map Research

## 状态

PR1 / Phase 0：**IN PROGRESS — STATIC GEOMETRY CHAIN PROVEN / DERIVED GEOMETRY POC VALIDATION NEXT**。

本 PR 只研究并验证客户端地图数据，不实现 frontend 3D renderer。

---

# 已确认的仓库基础

## DVPL + SC2

`common/python/wotb_sc2.py` 已提供 DVPL + DAVA SceneFileV2 reader。后续工具必须复用它，不得实现第二套 parser。

## Terrain heightmap

`map-semanticizer/map_semanticizer.py` 已能从 `Landscape` 读取 world bounds、解码 heightmap、恢复 elevation/slope，并按 world coordinate 采样高度。

## Replay / client coordinate contract

现有 map semantics 已用 SC2 spawn/base Z 与 heightmap sampling 做真实交叉验证；client scene / replay / 2D basemap 使用同一 world frame。

因此 3D Playback 不需要重新发明地图坐标系。

---

# 真实 Maps.zip Inventory（2026-09-04）

来自真实 archive central directory：

- archive bytes：`2,107,519,076`；
- members：`4,316`；
- uncompressed bytes：`2,291,239,572`；
- 35 个 `NN_*` 目录：
  - 33 battle maps；
  - `00_global_content`；
  - `00_shared_content`。

主要格式：

| extension | count | uncompressed bytes | 当前结论 |
|---|---:|---:|---|
| `.dds.dvpl` | 3514 | 1,795,153,886 | texture payload |
| `.pvr.dvpl` | 338 | 181,466,714 | texture payload |
| `.anim.dvpl` | 116 | 6,581,483 | animation |
| `.sc2.dvpl` | 84 | 43,889,613 | DAVA SceneFileV2 |
| `.scg.dvpl` | 84 | 243,187,825 | SCPG PolygonGroup sidecar |
| `.heightmap.dvpl` | 38 | 17,047,475 | terrain height |
| `.mkm.dvpl` | 37 | 3,477,042 | TerrainData-associated binary |
| `.lka.dvpl` | 65 | 430,703 | TerrainData-associated binary |

texture payload 约占 uncompressed archive 的 **86.3%**。

结论：

> Production 3D 不应直接发布/加载客户端原纹理集合。Playback 需要 derived geometry representation，并独立设计视觉材质。

---

# Vertical Slice：05_amigosville_am

展示名：Falls Creek / 乡间溪流。

选择理由：

- 单主 SC2；
- 单 heightmap；
- 体积适中；
- 有明显高低差；
- 有大量建筑/围墙/桥梁等静态结构；
- 已有 WotBTools basemap / semantics 可做 world-coordinate validation。

---

# 主 SC2 真实结构

主场景：

- SceneFileV2 version `48`；
- 1775 entities；
- decoded bytes `8,205,972`。

关键 component：

| component | count |
|---|---:|
| TransformComponent | 1775 |
| RenderComponent | 1216 |
| CollisionTypeComponent | 1056 |
| LodComponent | 934 |
| SpeedTreeComponent | 435 |
| StaticOcclusionComponent | 1 |
| StaticOcclusionDataComponent | 1 |
| TerrainDataComponent | 1 |

Render objects：

| class | count |
|---|---:|
| Mesh | 773 |
| SpeedTreeObject | 435 |
| MapBorderRenderObject | 3 |
| VegetationRenderObject | 3 |
| Landscape | 1 |
| WaterRenderObject | 1 |

RenderBatch：

- 3,876；
- 每个 batch 有 `rb.datasource`；
- `rb.datasource` 为整数 geometry data-source id。

## 关键否定证据：主 SC2 PolygonGroup = 0

主 SC2 `#dataNodes` 共 9,250 个：

- NMaterial 5559；
- ParticleEmitterNode 3689；
- SceneRenderConfig 1；
- AnimationData 1；
- **PolygonGroup 0**。

因此：

> battle-map static mesh PolygonGroup 不在主 SC2 dataNodes 内。

---

# Companion SCG / SCPG — Static Geometry Chain 已闭环

真实 sidecar：

```text
Maps/05_amigosville_am/05_amigosville_am.sc2.dvpl
Maps/05_amigosville_am/05_amigosville_am.scg.dvpl
```

SCG DVPL 解压后：

- bytes：`10,243,320`；
- magic：`SCPG`；
- version：`1`；
- `nodeCount = 221`；
- `nodeCount2 = 221`；
- trailing bytes：0。

PolygonGroup：

- count：221；
- groups with id：221；
- unique ids：221；
- total vertices：164,307；
- total indices：266,417；
- total primitiveCount：95,833；
- vertex payload：9,643,728 bytes；
- index payload：532,834 bytes；
- index payload mismatch：0。

## SC2 ↔ SCG exact id cross-check

```text
SC2 RenderBatch rb.datasource occurrences  = 3876
SC2 unique rb.datasource ids               = 107
SCG PolygonGroup ids                       = 221
matched unique datasource ids              = 107 / 107
matched RenderBatch occurrences            = 3876 / 3876
unmatched datasource ids                   = 0
unreferenced SCG PolygonGroup ids           = 114
```

因此以下链路是**真实格式证据，不再是假设**：

```text
SC2 Entity
  -> RenderComponent
  -> Mesh
  -> RenderBatch
  -> rb.datasource integer id
  -> same-basename SCG
  -> PolygonGroup #id
  -> vertices + indices
```

114 个未引用 PolygonGroup 不应在没有消费证据时自动进入 runtime map geometry。

---

# Vertex / Index Layout

真实 vertexFormat：

| format | groups |
|---:|---:|
| 411 | 157 |
| 27 | 25 |
| 13837 | 22 |
| 395 | 9 |
| 5129 | 3 |
| 5 | 3 |
| 5133 | 1 |
| 17 | 1 |

真实 interleaved stride：

| stride | groups |
|---:|---:|
| 64 B | 157 |
| 56 B | 31 |
| 40 B | 28 |
| 16 B | 3 |
| 44 B | 1 |
| 20 B | 1 |

全部 221 个 group：

```text
indexFormat = 0
```

并且全部满足：

```text
indexPayloadBytes == indexCount * 2
```

所以在当前真实地图样本中，indexFormat 0 的实际 payload 是 uint16。

## DAVA source cross-check

DAVA `PolygonGroup::UpdateDataPointersAndStreams()` 明确按固定顺序设置 interleaved vertex streams：

1. `EVF_VERTEX`；
2. `EVF_NORMAL`；
3. `EVF_COLOR`；
4. TEXCOORD；
5. tangent / binormal；
6. 其他 attributes。

`EVF_VERTEX` 被映射为：

```text
Vector3 / float3
```

因此 position decoder 的 contract 是：

```text
vertex base offset + 0 bytes -> float32 x
vertex base offset + 4 bytes -> float32 y
vertex base offset + 8 bytes -> float32 z
next vertex = base + derived stride
```

这已经足够完成第一阶段 3D geometry extraction，不需要先理解 normals/UV/tangent。

---

# World Transform Contract

DAVA `TransformComponent::Serialize()` 保存：

```text
tc.worldTranslation
tc.worldScale
tc.worldRotation
```

Quaternion storage：

```text
x, y, z, w
```

DAVA `TransformUtils::TransformVector()`：

```text
rotation.ApplyToVectorFast(scale * localVertex) + translation
```

因此 Map Geometry Core 更适合：

```text
shared local PolygonGroup geometry
+
SC2 instance world transform
```

而不是：

```text
为每个 fence / building 实例复制一份 baked geometry
```

这同时降低 runtime asset 大小和 GPU memory。

---

# Collision

`CollisionTypeComponent = 1056`。

真实字段：

```text
CollisionType
Density
FallingType
Health
MaterialKind
```

例如树与建筑的 CollisionType / Density / MaterialKind 值不同，因此至少可以确认：

> collision/destruction/material classification metadata 属于 scene entity contract。

当前仍未证明：

- 是否存在独立 collision geometry；
- gameplay collision 是否复用 visual PolygonGroup；
- CollisionType enum 的完整语义。

结论状态：

> **COLLISION CLASSIFICATION PROVEN / COLLISION GEOMETRY NOT YET PROVEN**

这不会阻塞 3D Playback 的 static visual geometry，但会阻塞后续 AI LOS / pathing 的严格 spatial core，必须继续研究。

---

# Static Occlusion

场景存在：

```text
StaticOcclusionComponent
StaticOcclusionDataComponent
```

其中真实数据包括：

- scene bbox；
- `50 x 50 x 3` subdivision；
- objectCount 2176；
- objectCountReal 2163；
- 约 2,040,000 bytes `sodc.data`。

这说明客户端另有预计算 static-occlusion 数据。

当前 PR1 只把它记录为可用于后续 LOS/visibility research 的权威候选，不把格式猜测写入 runtime contract。

---

# TerrainData / MKM / LKA

`TerrainDataComponent` 明确引用：

```text
blitz/05_amigosville_am.mkm
blitz/05_amigosville_am.lka
blitz/map_effects.yaml
```

## MKM

成功 DVPL decode：

- bytes：262,168；
- header：`kkm\0`；
- uint32 head 包含 `1 / 1024 / 262144`；
- payload shape：24-byte header + 262,144 bytes。

`262144 = 1024 * 1024 / 4` 是一个很强的 packed-grid 特征，但当前没有足够证据给每格 bit 语义。

状态：

> **FIXED-SIZE PACKED TERRAIN-ASSOCIATED BINARY / SEMANTICS UNKNOWN**

## LKA

成功 DVPL decode：

- bytes：12,862；
- header 以 `KA` 开始；
- 包含大量数字字符串。

状态：

> **TERRAIN-ASSOCIATED BINARY / SEMANTICS UNKNOWN**

因此当前仍不得把 MKM/LKA 称为 navmesh/passability map。

---

# Research Tooling

## `common/python/inventory_maps_zip.py`

- central-directory inventory；
- map/resource counts；
- selective extraction；
- traversal protection。

## `common/python/inspect_map_scene.py`

- SC2 component / render-object / RenderBatch inspection；
- collision / terrain / static-occlusion evidence；
- MKM/LKA basic payload inspection。

## `common/python/wotb_scg.py`

Reusable SCPG + minimal geometry decoder：

- `read_scg()`；
- `polygon_group_id()`；
- `polygon_group_vertex_stride()`；
- `decode_polygon_positions()`；
- `decode_polygon_indices()`；
- `position_aabb()`。

decoder validation：

- EVF_VERTEX required；
- vertex payload stride consistency；
- finite XYZ；
- index payload size；
- local index bounds。

## `common/python/inspect_map_scg.py`

- same-basename SCG discovery；
- PolygonGroup inventory；
- vertex/index format distribution；
- SC2 datasource ↔ SCG id exact cross-check。

## `common/python/export_map_geometry_poc.py`

Renderer-neutral derived geometry exporter。

默认只选：

```text
RenderObject class = Mesh
LOD = 0
switch/state = 0
not shadow-only
```

每个实际使用的 PolygonGroup 只 decode 一次，输出：

```text
tmp/map-research/05_amigosville_am-geometry-poc.json
tmp/map-research/05_amigosville_am-positions.f32le.bin
tmp/map-research/05_amigosville_am-indices.u32le.bin
```

Manifest 保存：

- geometry id；
- vertexFormat / original stride；
- position/index offsets；
- primitive type；
- local AABB；
- entity path/name；
- datasource id；
- SC2 world translation/scale/quaternion；
- selection policy。

PoC 主动丢弃：

- textures；
- materials；
- normals；
- tangents/binormals；
- UV；
- SpeedTree/vegetation；
- client lighting/effects。

这些 derived files 位于 `tmp/`，不得提交 Git。

## Tests

`common/python/tests/test_wotb_scg.py` 覆盖：

- interleaved XYZ decode；
- uint16 indices；
- AABB；
- invalid local index rejection；
- missing EVF_VERTEX rejection。

---

# 下一次真实验证

执行：

```powershell
python common/python/export_map_geometry_poc.py "<Maps.zip>" 05_amigosville_am
```

需要记录：

- selected Mesh instance count；
- unique selected datasource count；
- decoded position count；
- decoded index count；
- output bytes；
- skipped LOD/switch/shadow counts；
- malformed / unsupported geometry blocker。

如果 blocker=0，则 PR1 的 static geometry 研究已经完成，可以进入 PR2 的 Map Geometry Core / first browser renderer vertical slice。

---

# PR1 Definition of Done

- [x] Maps.zip inventory；
- [x] map count / extensions / shared roots；
- [x] terrain + coordinate baseline；
- [x] first-map SC2 trace；
- [x] main SC2 PolygonGroup absence confirmed；
- [x] companion SCPG decode；
- [x] SC2 datasource ↔ SCG PolygonGroup exact link；
- [x] vertex/index layout evidence；
- [x] position/index reusable decoder；
- [x] derived geometry PoC exporter；
- [x] collision classification metadata evidence；
- [x] MKM/LKA TerrainData association；
- [ ] run derived geometry PoC against real Maps.zip with blocker=0；
- [ ] close PR1 collision/nav scope explicitly；
- [ ] finalize PR2 Map Geometry Core contract。

## 非目标

PR1 不做：

- frontend 3D renderer；
- full-map batch conversion；
- original client texture/material replication；
- SpeedTree recreation；
- tank model rendering；
- AI LOS/pathfinding；
- unproven MKM/LKA semantics；
- raw client asset commit/distribution。
