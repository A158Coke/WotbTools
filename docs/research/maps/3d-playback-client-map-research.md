# 3D Battle Playback — Client Map Research

## 状态

PR1 / Phase 0：**IN PROGRESS — STATIC GEOMETRY CHAIN PROVEN / CANAL + PORT BAY VALIDATION NEXT**。

本 PR 只研究并验证客户端地图数据，不实现 frontend 3D renderer。

---

# Sample policy

## Reverse-engineering reference sample

```text
05_amigosville_am = Falls Creek / 乡间溪流
```

该地图已经完成 SC2 / SCG / datasource / PolygonGroup 的格式逆向实证，因此继续作为格式研究 reference sample。

它**不再作为首批 3D Playback example**，原因是当前没有可用于端到端 Playback 验证的对应 replay。

## First Playback examples

```text
18_canal_cn = Canal / 运河尽头
14_port_pt  = Port Bay / 港湾小镇
```

这两张地图都已有 WotBTools 2D basemap，并将用于首批：

```text
client terrain/static geometry
  -> derived map geometry
  -> existing world-coordinate contract
  -> real replay vehicle overlay
  -> 3D Battle Playback
```

使用两张而不是一张地图也是一个 contract gate：如果它们在 SC2/SCG/LOD/switch 上出现差异，应修通用 parser/exporter，而不是加入 map-id 特判。

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
- 35 个 `NN_*` 目录：33 battle maps + `00_global_content` + `00_shared_content`。

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

结论：Production 3D 不应直接发布/加载客户端原纹理集合。Playback 需要 derived geometry representation，并独立设计视觉材质。

---

# `05_amigosville_am` research evidence

主 SC2：

- SceneFileV2 v48；
- 1775 entities；
- RenderComponent 1216；
- CollisionTypeComponent 1056；
- LodComponent 934；
- Mesh render objects 773；
- RenderBatch 3876；
- main SC2 PolygonGroup = 0。

companion sidecar：

```text
Maps/05_amigosville_am/05_amigosville_am.sc2.dvpl
Maps/05_amigosville_am/05_amigosville_am.scg.dvpl
```

SCG：

- SCPG v1；
- nodeCount = nodeCount2 = 221；
- trailing bytes = 0；
- 221 PolygonGroups；
- 164,307 vertices；
- 266,417 indices；
- 95,833 primitives；
- index payload mismatch = 0。

SC2 ↔ SCG exact datasource cross-check：

```text
SC2 RenderBatch rb.datasource occurrences  = 3876
SC2 unique rb.datasource ids               = 107
SCG PolygonGroup ids                       = 221
matched unique datasource ids              = 107 / 107
matched RenderBatch occurrences            = 3876 / 3876
unmatched datasource ids                   = 0
```

所以 static geometry source/reference chain 已闭环：

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

114 个未引用 PolygonGroup 不应在没有消费证据时自动进入 runtime geometry。

---

# Vertex / Index Layout

真实样本已确认：

- interleaved vertex storage；
- `EVF_VERTEX` 位于 vertex offset 0；
- `EVF_VERTEX` 是 float3 XYZ；
- stride 可由 `len(vertices) / vertexCount` 验证；
- 当前全部 221 个 group `indexFormat=0`；
- index payload 全部满足 `indexCount * 2`，即当前样本为 uint16 indices。

DAVA TransformComponent world-space contract：

```text
scaled = worldScale * localVertex
world = worldRotation.ApplyToVectorFast(scaled) + worldTranslation
```

因此 Map Geometry Core 应保留：

```text
shared local geometry + SC2 instance world transform
```

而不是复制大量 baked instance mesh。

---

# Collision

`05_amigosville_am` 已确认 1056 个 `CollisionTypeComponent`，字段：

```text
CollisionType
Density
FallingType
Health
MaterialKind
```

当前状态：

> **COLLISION CLASSIFICATION PROVEN / COLLISION GEOMETRY NOT YET PROVEN**

这不阻塞 3D Playback visual geometry；但在未来 AI LOS/pathing spatial core 前仍需继续研究。

---

# TerrainData / MKM / LKA

research sample 的 TerrainDataComponent 明确引用：

```text
blitz/05_amigosville_am.mkm
blitz/05_amigosville_am.lka
blitz/map_effects.yaml
```

MKM：

- 262,168 decoded bytes；
- `kkm\0`；
- 24-byte header + 262,144-byte payload；
- 有明显 packed-grid shape，但 bit semantics 尚未证明。

LKA：

- 12,862 decoded bytes；
- `KA` header；
- 当前仍为 terrain-associated opaque binary。

因此不得把 MKM/LKA 直接命名为 navmesh/passability。

---

# Research tooling

## `common/python/inventory_maps_zip.py`

- central-directory inventory；
- per-map / extension / bytes；
- selective extraction；
- traversal protection。

## `common/python/inspect_map_scene.py`

- SC2 component / render-object / RenderBatch；
- collision / terrain / static-occlusion evidence；
- MKM/LKA basic payload inspection。

## `common/python/wotb_scg.py`

Reusable SCPG geometry decoder：

- `read_scg()`；
- `polygon_group_id()`；
- `polygon_group_vertex_stride()`；
- `decode_polygon_positions()`；
- `decode_polygon_indices()`；
- `position_aabb()`。

## `common/python/inspect_map_scg.py`

- same-basename SCG discovery；
- PolygonGroup inventory；
- vertex/index format distribution；
- SC2 datasource ↔ SCG id exact cross-check。

## `common/python/export_map_geometry_poc.py`

Renderer-neutral derived geometry exporter：

- Mesh only；
- default LOD 0 / switch 0；
- exclude shadow-only；
- decode each referenced PolygonGroup once；
- positions -> float32 XYZ；
- indices -> normalized uint32 output；
- preserve SC2 world scale/rotation/translation；
- no original textures/materials/UV/tangents/SpeedTree export。

Derived files live under ignored `tmp/` and are not committed.

## Tests

`common/python/tests/test_wotb_scg.py` covers position/index decoding and malformed-payload validation without client assets.

---

# 下一次真实验证：双地图

```powershell
python common/python/inspect_map_scg.py "<Maps.zip>" 18_canal_cn
python common/python/export_map_geometry_poc.py "<Maps.zip>" 18_canal_cn

python common/python/inspect_map_scg.py "<Maps.zip>" 14_port_pt
python common/python/export_map_geometry_poc.py "<Maps.zip>" 14_port_pt
```

需要比较：

- companion SCG discovery；
- datasource match rate；
- PolygonGroup formats/stride/index formats；
- Mesh instance count；
- selected unique geometry count；
- derived buffer size；
- skipped LOD/switch/shadow count；
- malformed/unsupported geometry blockers。

Gate：

```text
18_canal_cn blocker = 0
14_port_pt blocker  = 0
```

两张图都通过后，static geometry extraction contract 才升级为 PR2 的首版 Map Geometry Core contract。

---

# PR1 Definition of Done

- [x] Maps.zip inventory；
- [x] terrain + coordinate baseline；
- [x] `05_amigosville_am` reverse-engineering reference sample；
- [x] main SC2 PolygonGroup absence；
- [x] companion SCPG decode；
- [x] SC2 datasource ↔ SCG PolygonGroup exact link；
- [x] vertex/index layout evidence；
- [x] reusable position/index decoder；
- [x] derived geometry PoC exporter；
- [x] collision classification metadata evidence；
- [x] MKM/LKA TerrainData association；
- [x] first Playback examples changed to `18_canal_cn` + `14_port_pt`；
- [ ] Canal real geometry PoC blocker=0；
- [ ] Port Bay real geometry PoC blocker=0；
- [ ] close PR1 collision/nav boundary；
- [ ] finalize PR2 Map Geometry Core contract。

## 非目标

PR1 不做 frontend renderer、full-map batch conversion、original client visual replication、tank models、AI LOS/pathfinding，也不提交 raw Maps.zip / bulk client assets。
