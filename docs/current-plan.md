# 3D Battle Playback First — PR1 Client Map Research

## 状态

**COMPLETE / PR1 GATE PASS / PR247 REVIEW FIXES APPLIED / PR2 HANDOFF READY**

PR #247 已完成 Client Map Research 主目标，并闭环后续 review 发现的 2 个 MAJOR + 1 个 MINOR。

## 已通过的核心 contract

```text
SC2 Entity
  -> RenderComponent
  -> Mesh
  -> RenderObject initial visibility
  -> active RenderBatch (LOD/switch, shared -1)
  -> rb.datasource
  -> same-basename companion SCG
  -> unique PolygonGroup #id
  -> vertices / indices
```

### Canal / `18_canal_cn`

- recursive SC2 entities：2,725
- SCG PolygonGroups：237
- datasource exact match：237 / 237
- unmatched / unreferenced：0 / 0
- schema v3 geometry：70
- Mesh instances：590
- positions：85,028 / 1,020,336 bytes
- indices：156,543 / 626,172 bytes
- invisible RenderObject skipped：363
- selected State 0 diagnostic siblings：347
- selected State 1 diagnostic siblings：0
- mutually-exclusive sibling overlap：0

### Port Bay / `14_port_pt`

- recursive SC2 entities：3,890
- SCG PolygonGroups：217
- datasource exact match：217 / 217
- unmatched / unreferenced：0 / 0
- schema v3 geometry：80
- Mesh instances：1,326
- positions：65,291 / 783,492 bytes
- indices：123,054 / 492,216 bytes
- invisible RenderObject skipped：713
- selected State 0 diagnostic siblings：596
- selected State 1 diagnostic siblings：0
- mutually-exclusive sibling overlap：0

## DAVA selection semantics

RenderBatch active rule：

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

Initial RenderObject visibility：

```text
RenderObject::VISIBLE = 1 << 0
explicit ro.flags -> require bit 0
missing ro.flags  -> visible by DAVA RenderObject::Load default
```

Production selector 不读取 `State 0` / `State 1` filename。

## PR #247 review closure

### MAJOR 1 — raw `.sc2` scene loading

已修复：

- `inspect_map_scene.py` 不再无条件 `decode_dvpl(raw)`；
- `.dvpl` member 才解 DVPL；
- raw `.sc2` 直接交给 `read_sc2()`；
- regression test 验证 raw `.sc2` 不调用 DVPL decoder，`.sc2.dvpl` 必须调用。

### MAJOR 2 — duplicate PolygonGroup id

已修复为 shared parser invariant：

- `wotb_scg.read_scg()` 在解析完成后验证所有可解码 `PolygonGroup #id` 唯一；
- duplicate id 直接 `Sc2ParseError` fail-fast，错误包含重复 id 与两个 group index；
- `export_map_geometry_poc.py` 使用共享 `polygon_groups_by_id()`，不再用会静默覆盖的 dict comprehension；
- SCG inspector 同样经过 `read_scg()`，duplicate id 无法进入 set-based cross-check 造成假阳性；
- duplicate-id regression test 已覆盖。

### MINOR — scene inspector nested hierarchy

已修复：

- `inspect_map_scene.py` 改为 recursive `#hierarchy` traversal；
- report schema 升到 v3；
- 增加 `sceneTraversal.mode = recursive #hierarchy`；
- target component sample 增加 `entityPath`；
- nested RenderComponent / CollisionTypeComponent regression test 已覆盖。

## Regression protection

- SCG duplicate PolygonGroup id fail-fast
- raw `.sc2` vs `.sc2.dvpl` loading
- recursive scene hierarchy inspection
- shared `-1` LOD/switch
- numeric `ro.batches` keys
- zero-instance fail-fast
- visibility bit + missing-flags default
- intentionally inverted State names，确保不存在 filename heuristic

## PR2 handoff

输入：

```text
SC2 + companion SCG + heightmap + existing map semantics
```

输出：

```text
deterministic renderer-neutral manifest
+ shared local static geometry buffers
+ initially-visible instance transforms
+ terrain representation
+ canonical world bounds / coordinate metadata
+ transformed world-AABB sanity report
```

Canal + Port Bay 继续作为双地图 gate。

## Collision / nav 边界

- `CollisionTypeComponent` metadata 已证明；独立 gameplay collision mesh 未证明；
- `.mkm/.lka` 与 TerrainData association 已证明；navmesh/passability semantics 未证明；
- visual PR2 不消费未经证明的 collision/nav data；未来 Spatial Analysis 单独继续研究。

## PR1 Definition of Done

- [x] Maps.zip inventory
- [x] terrain + coordinate baseline
- [x] SCPG / PolygonGroup parser
- [x] recursive SC2 datasource ↔ SCG exact link
- [x] vertex/index decoder
- [x] unique PolygonGroup id invariant
- [x] DAVA RenderBatch shared `-1` contract
- [x] DAVA initial RenderObject visibility contract
- [x] raw `.sc2` / `.sc2.dvpl` scene loading
- [x] recursive scene inspector evidence
- [x] Canal schema v3 final gate
- [x] Port Bay schema v3 final gate
- [x] collision/nav research boundary
- [x] PR247 review findings closure

**PR1 blocker = 0. PR2 handoff ready.**

## 非目标

PR1 不实现 frontend 3D renderer、2D/3D toggle、raw client texture/material replication、SpeedTree/grass、tank 3D models、AI LOS/pathfinding，也不提交 Maps.zip / bulk raw client assets。
