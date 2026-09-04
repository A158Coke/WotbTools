# 3D Battle Playback First — PR1 Client Map Research

## 状态

**IMPLEMENTING / INITIAL VISIBILITY SEMANTICS PROVEN / SCHEMA V3 REAL RERUN NEXT**

PR #247 继续保持 Draft；当前不进入 PR2，直到 Canal + Port Bay 用 schema v3 exporter 真实重跑通过。

## 已通过：SC2 -> SCG extraction contract

真实客户端数据已证明：

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

schema v2 recursive SCG cross-check：

- recursive entities：2,725；
- PolygonGroups：237；
- vertices：173,017；
- indices：299,156；
- RenderBatch datasource occurrences：3,573；
- unique datasource：237；
- matched：237 / 237；
- unmatched：0；
- unreferenced PolygonGroup：0；
- warnings / index payload mismatch：0。

旧 schema v2 raw candidate PoC：94 geometry / 953 Mesh instances / 99,736 positions / 182,451 indices。

### Port Bay / `14_port_pt`

schema v2 recursive SCG cross-check：

- recursive entities：3,890；
- PolygonGroups：217；
- vertices：126,466；
- indices：223,764；
- RenderBatch datasource occurrences：4,702；
- unique datasource：217；
- matched：217 / 217；
- unmatched：0；
- unreferenced PolygonGroup：0；
- warnings / index payload mismatch：0。

旧 schema v2 raw candidate PoC：106 geometry / 2,039 Mesh instances / 79,837 positions / 149,793 indices。

结论：**geometry source/reference/extraction contract 已通过双地图 gate。**

## 已通过：DAVA RenderBatch wildcard

DAVA RenderObject active batch rule：

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

`-1` 是 shared/wildcard batch。exporter 已覆盖 wildcard、missing option default `-1`、numeric `ro.batches` keys、nested hierarchy，并对 zero selected instances fail-fast。

## 已证明：initial scene visibility contract

旧 schema v2 PoC 曾同时导出同一 state-switch group 的 State 0 / State 1 sibling。真实 state-switcher inspection 现已证明这不是 RenderBatch switch 问题，而是 **RenderObject visibility**。

DAVA `RenderObject::eFlags` 定义：

```text
VISIBLE = 1 << 0
```

DAVA `RenderObject::Load()`：

```text
savedFlags = SERIALIZATION_CRITERIA & archive.ro.flags
```

且 `ro.flags` 缺失时默认使用包含 `VISIBLE` 的 `SERIALIZATION_CRITERIA`。

因此通用初始视觉选择规则是：

```text
Mesh RenderObject
  -> explicit ro.flags exists: require (ro.flags & 1) != 0
  -> ro.flags missing: visible, matching DAVA Load default
  -> then apply LOD/switch active-batch rule
```

**生产规则不读取 `State 0` / `State 1` 名称。**

## 双地图真实 state evidence

### Canal

- `StateSwitcherComponent`：347；
- diagnostic sibling groups：347；
- 347 / 347：State 0 render visible bit = true；
- 347 / 347：State 1 render visible bit = false；
- sibling batches 仍全部 `switchIndex=-1`。

### Port Bay

- `StateSwitcherComponent`：596；
- diagnostic sibling groups：596；
- 596 / 596：State 0 render visible bit = true；
- 596 / 596：State 1 render visible bit = false；
- sibling batches 仍全部 `switchIndex=-1`。

这让 visibility bit 成为比 filename / `StateSwitcherComponent` 命名更直接、更通用的 authoritative scene-render evidence。

## Schema v3 exporter

`common/python/export_map_geometry_poc.py` 已升级：

- schemaVersion = 3；
- 初始 Mesh selection 先检查 DAVA `RenderObject::VISIBLE`；
- explicit invisible Mesh 计入 `skipped.invisible_render_object`；
- missing `ro.flags` 按 DAVA Load default 视为 visible；
- 然后才应用 shadow / LOD / switch 规则；
- manifest 明确记录 `requireInitialVisibility`、visible bit 和 fallback semantics；
- 不使用 entity filename heuristic。

新增 regression coverage：

- visible flag `8193` 被导出；
- invisible flag `8192` 被排除；
- 测试故意让 visible 对象名为 `State 1`、invisible 对象名为 `State 0`，防止 filename heuristic 回归；
- missing flags 仍 visible；
- non-integer flags fail-fast。

## 下一执行步骤

只需要重跑 exporter；**不需要再跑 state inspector / SCG inspector**：

```powershell
git checkout research/client-map-3d-inventory
git pull origin research/client-map-3d-inventory

python common/python/export_map_geometry_poc.py "C:\Users\yu.chen\Downloads\Maps.zip" 18_canal_cn
python common/python/export_map_geometry_poc.py "C:\Users\yu.chen\Downloads\Maps.zip" 14_port_pt
```

上传：

```text
tmp/map-research/18_canal_cn-geometry-poc.json
tmp/map-research/14_port_pt-geometry-poc.json
```

二进制 buffer 不需要上传，只需 JSON 中的 byte counts。

## Final PR1 visual gate

两张 schema v3 manifest 必须同时满足：

```text
schemaVersion = 3
geometryCount > 0
instanceSummary.count > 0
positionsBytes > 0
indicesBytes > 0
skipped.invisible_render_object > 0
selected datasource orphan/blocker = 0
mutually-exclusive state siblings simultaneously selected = 0
```

通过后：

1. PR #247 标记 Ready；
2. PR1 DoD 全部关闭；
3. PR2 Map Geometry Core 正式开始。

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

大范围 environment/surroundings Mesh 不能按尺寸或 filename 删除；PR2 只做 world-AABB/role sanity report，selection 继续基于 scene/render evidence。

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
- [x] renderer-neutral raw candidate geometry exporter；
- [x] Canal extraction PoC non-empty / datasource blocker=0；
- [x] Port Bay extraction PoC non-empty / datasource blocker=0；
- [x] collision/nav research boundary；
- [x] prove scene-level initial visual state semantics；
- [x] implement authoritative initial-state selector + regression tests；
- [ ] rerun Canal schema v3 with duplicated-active-state blocker=0；
- [ ] rerun Port Bay schema v3 with duplicated-active-state blocker=0；
- [ ] finalize PR2 handoff after real rerun。

## 非目标

PR1 不实现 frontend 3D renderer、2D/3D toggle、raw client texture/material replication、SpeedTree/grass、tank 3D models、AI LOS/pathfinding，也不提交 Maps.zip / bulk raw client assets。
