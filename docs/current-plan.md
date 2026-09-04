# 3D Battle Playback First — PR1 Client Map Research

## 状态

**COMPLETE / PR1 GATE PASS / PR247 REVIEW FIXES APPLIED / PR2 HANDOFF READY**

PR #247 已完成 Client Map Research 主目标，并闭环 review 发现的 2 个 MAJOR + 1 个 MINOR。

## 核心 contract

```text
SC2 Entity
  -> RenderComponent
  -> Mesh
  -> RenderObject initial visibility
  -> active RenderBatch (LOD/switch, shared -1)
  -> rb.datasource
  -> companion SCG
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
- selected diagnostic State 0：347
- selected diagnostic State 1：0
- mutually-exclusive overlap：0

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
- selected diagnostic State 0：596
- selected diagnostic State 1：0
- mutually-exclusive overlap：0

## DAVA selection semantics

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

```text
RenderObject::VISIBLE = 1 << 0
explicit ro.flags -> require bit 0
missing ro.flags  -> visible by RenderObject::Load default
```

Production selector 不读取 `State 0` / `State 1` filename。

## PR247 review closure

### MAJOR 1 — raw `.sc2`

- `.dvpl` member 才调用 `decode_dvpl`；
- raw `.sc2` 直接传给 `read_sc2`；
- regression test 覆盖 raw `.sc2` 与 `.sc2.dvpl` 两条路径。

### MAJOR 2 — duplicate PolygonGroup id

- `wotb_scg.read_scg()` 在共享 parser boundary 校验所有可解码 `#id` 唯一；
- duplicate id 直接 `Sc2ParseError` fail-fast；
- 错误包含 duplicate id 与两个 PolygonGroup index；
- exporter 使用共享 `polygon_groups_by_id()`，不再静默覆盖；
- SCG inspector 同样无法让 duplicate id 进入 set-based cross-check；
- regression test 覆盖 duplicate id。

### MINOR — nested scene entities

- scene inspector 改为 recursive `#hierarchy` traversal；
- report schema v3；
- `sceneTraversal.mode = recursive #hierarchy`；
- target component sample 包含 `entityPath`；
- regression test 覆盖 nested RenderComponent / CollisionTypeComponent。

## PR2 handoff

```text
SC2 + companion SCG + heightmap + existing map semantics
  -> deterministic renderer-neutral manifest
  -> shared local static geometry buffers
  -> initially-visible instance transforms
  -> terrain representation
  -> canonical world bounds / coordinate metadata
  -> transformed world-AABB sanity report
```

Canal + Port Bay 继续作为双地图 gate。

## Collision / nav 边界

- `CollisionTypeComponent` metadata 已证明；独立 gameplay collision mesh 未证明；
- `.mkm/.lka` 与 TerrainData association 已证明；navmesh/passability semantics 未证明；
- visual PR2 不消费未经证明的数据。

## PR1 DoD

- [x] Maps.zip inventory
- [x] terrain + coordinate baseline
- [x] SCPG / PolygonGroup parser
- [x] recursive SC2 datasource ↔ SCG exact link
- [x] vertex/index decoder
- [x] unique PolygonGroup id invariant
- [x] RenderBatch shared `-1` contract
- [x] initial RenderObject visibility contract
- [x] raw `.sc2` / `.sc2.dvpl` loading
- [x] recursive scene inspector
- [x] Canal schema v3 final gate
- [x] Port Bay schema v3 final gate
- [x] collision/nav research boundary
- [x] PR247 review findings closure

**PR1 blocker = 0. PR2 handoff ready.**
