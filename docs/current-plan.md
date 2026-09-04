# 3D Battle Playback First — PR1 Client Map Research

## 状态

**COMPLETE / PR1 GATE PASS / PR2 HANDOFF READY**

Canal + Port Bay 已使用 schema v3 exporter 完成真实 `Maps.zip` 双地图验证。SC2/SCG geometry extraction、DAVA RenderBatch selection、initial RenderObject visibility 三层 contract 均已闭环。

PR #247 可以进入 Ready for Review；下一阶段为 PR2 Map Geometry Core。

## 已通过：SC2 -> SCG extraction contract

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

### Canal / `18_canal_cn`

SCG recursive cross-check：

- recursive entities：2,725；
- PolygonGroups：237；
- vertices：173,017；
- indices：299,156；
- unique datasource：237；
- matched：237 / 237；
- unmatched：0；
- unreferenced PolygonGroup：0；
- warnings / index payload mismatch：0。

### Port Bay / `14_port_pt`

SCG recursive cross-check：

- recursive entities：3,890；
- PolygonGroups：217；
- vertices：126,466；
- indices：223,764；
- unique datasource：217；
- matched：217 / 217；
- unmatched：0；
- unreferenced PolygonGroup：0；
- warnings / index payload mismatch：0。

结论：geometry source/reference/extraction contract 已通过双地图 gate。

## 已通过：DAVA RenderBatch wildcard

DAVA active-batch rule：

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

`-1` 是 shared/wildcard。exporter 已覆盖 missing default `-1`、numeric `ro.batches` keys、nested hierarchy 与 zero-instance fail-fast。

## 已通过：initial RenderObject visibility

DAVA authoritative contract：

```text
RenderObject::VISIBLE = 1 << 0
```

生产 selector：

```text
explicit ro.flags -> require (ro.flags & 1) != 0
missing ro.flags  -> visible, matching DAVA RenderObject::Load default
then apply shadow / LOD / switch rules
```

生产逻辑不读取 `State 0` / `State 1` filename。

真实 state-switcher evidence：

- Canal：347 groups；347 / 347 State 0 visible=true；347 / 347 State 1 visible=false；
- Port Bay：596 groups；596 / 596 State 0 visible=true；596 / 596 State 1 visible=false。

## Schema v3 final real gate

### Canal / `18_canal_cn`

- schemaVersion：3；
- geometry：70；
- Mesh instances：590；
- unique datasource：70；
- decoded positions：85,028；
- decoded indices：156,543；
- positions bytes：1,020,336；
- indices bytes：626,172；
- skipped invisible RenderObject：363；
- selected State 0 diagnostic instances：347；
- selected State 1 diagnostic instances：0；
- mutually-exclusive sibling groups simultaneously selected：0；
- orphan datasource：0；
- buffer/count consistency blocker：0。

### Port Bay / `14_port_pt`

- schemaVersion：3；
- geometry：80；
- Mesh instances：1,326；
- unique datasource：80；
- decoded positions：65,291；
- decoded indices：123,054；
- positions bytes：783,492；
- indices bytes：492,216；
- skipped invisible RenderObject：713；
- selected State 0 diagnostic instances：596；
- selected State 1 diagnostic instances：0；
- mutually-exclusive sibling groups simultaneously selected：0；
- orphan datasource：0；
- buffer/count consistency blocker：0。

Final visual gate：**PASS**。

## PR2 handoff contract

PR2 输入：

```text
SC2 + companion SCG + heightmap + existing map semantics
```

PR2 输出：

```text
deterministic renderer-neutral manifest
+ shared local static geometry buffers
+ initially-visible instance transforms
+ terrain representation
+ canonical world bounds / coordinate metadata
+ transformed world-AABB sanity report
```

Canal + Port Bay 继续作为双地图 gate。

大范围 environment/surroundings Mesh 可能合法超出 playable bounds；禁止按尺寸或 filename 删除。PR2 应报告 transformed world-AABB / role sanity，但 selection 继续基于 scene/render evidence。

## Collision / nav 边界

- `CollisionTypeComponent` metadata 已证明；独立 gameplay collision mesh 未证明；
- `.mkm/.lka` 与 TerrainData association 已证明；navmesh/passability semantics 未证明；
- visual PR2 不消费未经证明的 collision/nav data；未来 Spatial Analysis 单独继续研究。

## PR1 Definition of Done

- [x] Maps.zip inventory；
- [x] terrain + coordinate baseline；
- [x] SCPG / PolygonGroup parser；
- [x] recursive SC2 datasource ↔ SCG exact link；
- [x] vertex/index decoder；
- [x] DAVA RenderBatch shared `-1` contract；
- [x] renderer-neutral geometry exporter；
- [x] Canal extraction blocker=0；
- [x] Port Bay extraction blocker=0；
- [x] collision/nav research boundary；
- [x] prove initial scene visibility semantics；
- [x] authoritative initial-state selector + regression tests；
- [x] Canal schema v3 duplicated-active-state blocker=0；
- [x] Port Bay schema v3 duplicated-active-state blocker=0；
- [x] PR2 handoff finalized。

## 非目标

PR1 不实现 frontend 3D renderer、2D/3D toggle、raw client texture/material replication、SpeedTree/grass、tank 3D models、AI LOS/pathfinding，也不提交 Maps.zip / bulk raw client assets。
