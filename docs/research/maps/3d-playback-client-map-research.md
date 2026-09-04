# 3D Battle Playback — Client Map Research

## 状态

PR1 / Phase 0：**IN PROGRESS — EXTRACTION + INITIAL VISIBILITY CONTRACT PROVEN / SCHEMA V3 REAL RERUN NEXT**。

本报告区分三层：

1. SC2/SCG 是否能稳定提取 geometry；
2. RenderBatch LOD/switch 是否能确定 active batches；
3. scene hierarchy 中哪些 RenderObject 在战斗初始时可见。

前两层已通过；第 3 层现也已由 DAVA source + Canal/Port Bay 真实 scene evidence 证明。剩余工作只有 schema v3 双地图重跑。

---

# Static geometry extraction — PASS

已证明：

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

## Canal / 18_canal_cn

schema v2 recursive SCG inspection：

```text
entities                         2725
PolygonGroups                    237
vertices                      173017
indices                       299156
RenderBatch datasource occ.     3573
unique datasource ids            237
matched ids                  237/237
unmatched                          0
unreferenced PolygonGroups          0
warnings                           0
index payload mismatch             0
```

旧 raw candidate PoC：94 geometry / 953 Mesh instances / 99,736 positions / 182,451 indices。

## Port Bay / 14_port_pt

schema v2 recursive SCG inspection：

```text
entities                         3890
PolygonGroups                    217
vertices                      126466
indices                       223764
RenderBatch datasource occ.     4702
unique datasource ids            217
matched ids                  217/217
unmatched                          0
unreferenced PolygonGroups          0
warnings                           0
index payload mismatch             0
```

旧 raw candidate PoC：106 geometry / 2,039 Mesh instances / 79,837 positions / 149,793 indices。

因此 SC2 ↔ SCG geometry source/reference/extraction contract 已通过双地图 gate。

---

# RenderBatch wildcard — PASS

DAVA RenderObject active batch rule：

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

`-1` 是 shared/wildcard batch。

exporter 已复现该规则，并验证 numeric batch archive key、missing default `-1` 与 recursive hierarchy。

---

# Initial scene visibility — PROVEN

旧 schema v2 PoC 的 sanity check 发现大量同一 parent 下的 State 0 / State 1 siblings 同时进入输出。两边 RenderBatch 都是 `switchIndex=-1`，所以 scene branch selection 不能由 batch switch 独立决定。

## DAVA authoritative contract

公开 DAVA `RenderObject::eFlags` 明确定义：

```text
VISIBLE = 1 << 0
```

并且 `RenderObject::Load()` 对 `ro.flags`：

- explicit serialized flags：只恢复 serialization criteria 中的 flags；
- missing `ro.flags`：默认使用 `SERIALIZATION_CRITERIA`；
- `SERIALIZATION_CRITERIA` 包含 `VISIBLE`。

因此 renderer-neutral initial scene selector 可以直接复现 DAVA RenderObject 自身语义：

```text
explicit ro.flags -> require bit 0
missing ro.flags  -> visible by DAVA Load default
```

这比 entity filename 或 WoTB-specific state naming 更通用、更接近引擎真实 render state。

## Canal real evidence

- recursive entities：2,725；
- `StateSwitcherComponent`：347；
- Mesh RenderObject visible bit：590 true / 363 false；
- diagnostic State 0/1 sibling groups：347；
- **347 / 347** State 0：visible=true；
- **347 / 347** State 1：visible=false；
- sibling RenderBatch switch 仍全部 `-1`。

示例：

```text
bld_cn_shed01.sc2
  State 0 -> ro.flags=8193 -> VISIBLE bit set
  State 1 -> ro.flags=8192 -> VISIBLE bit clear
```

## Port Bay real evidence

- recursive entities：3,890；
- `StateSwitcherComponent`：596；
- Mesh RenderObject visible bit：1,326 true / 713 false；
- diagnostic State 0/1 sibling groups：596；
- **596 / 596** State 0：visible=true；
- **596 / 596** State 1：visible=false；
- sibling RenderBatch switch 仍全部 `-1`。

示例：

```text
bld_pt_brickfence.sc2
  State 0 -> ro.flags=8193 -> VISIBLE bit set
  State 1 -> ro.flags=8192 -> VISIBLE bit clear
```

`State 0/State 1` 名称在这里仅用于 evidence cross-check，不成为 production selector。

---

# Schema v3 geometry exporter

`common/python/export_map_geometry_poc.py` 已升级到 schema v3：

```text
RenderComponent
  -> Mesh
  -> DAVA RenderObject::VISIBLE check
  -> exclude shadow-only
  -> DAVA active LOD/switch rule
  -> rb.datasource
  -> SCG PolygonGroup
```

行为：

- explicit `ro.flags & 1 == 0`：跳过整个 RenderObject；
- missing `ro.flags`：按 DAVA Load default 保持 visible；
- skipped summary 新增 `invisible_render_object`；
- manifest 明确记录 initial visibility contract；
- entity filename 不参与 selection。

Regression tests 额外故意构造：

```text
name = "... State 1", ro.flags = 8193 -> 必须导出
name = "... State 0", ro.flags = 8192 -> 必须排除
```

以确保 selector 永远不会退化为 filename heuristic。

---

# State-switcher diagnostic tooling

保留：

```text
common/python/inspect_map_state_switchers.py
common/python/tests/test_inspect_map_state_switchers.py
```

它用于版本升级或新地图研究时重新验证：

- StateSwitcher/Switch components；
- parent-child hierarchy；
- `ro.flags` / VISIBLE；
- batch datasource / LOD / switch；
- diagnostic state sibling correlation。

它不是 production runtime dependency。

---

# Final PR1 real rerun

不再需要重跑 state inspector 或 SCG inspector，只运行：

```powershell
python common/python/export_map_geometry_poc.py "C:\Users\yu.chen\Downloads\Maps.zip" 18_canal_cn
python common/python/export_map_geometry_poc.py "C:\Users\yu.chen\Downloads\Maps.zip" 14_port_pt
```

最终双地图 gate：

```text
schemaVersion = 3
geometryCount > 0
instance count > 0
positionsBytes > 0
indicesBytes > 0
skipped.invisible_render_object > 0
selected datasource blocker = 0
same mutually-exclusive state group duplicated in selected instances = 0
```

通过后 PR247 才 Ready，随后进入 PR2。

---

# PR2 Map Geometry Core handoff

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

Large environment/surroundings meshes 可能合法超出 playable `-300..300` bounds，禁止按尺寸或 filename 删除。PR2 只增加 transformed world-AABB / role sanity，selection 仍必须来自 scene/render evidence。

---

# Collision / nav boundary

已确认：

- `CollisionTypeComponent` metadata 存在；
- 独立 gameplay collision mesh 未证明；
- `.mkm/.lka` 与 TerrainData 关联；
- navmesh/passability semantics 未证明。

这些不阻塞 visual 3D Playback；未来 AI LOS/pathing Spatial Analysis 前单独继续研究。

---

# PR1 DoD

- [x] Maps.zip inventory；
- [x] terrain + coordinate baseline；
- [x] SCPG / PolygonGroup parser；
- [x] recursive SC2 datasource ↔ SCG exact link；
- [x] vertex/index decoder；
- [x] DAVA RenderBatch wildcard contract；
- [x] Canal raw extraction blocker=0；
- [x] Port Bay raw extraction blocker=0；
- [x] state-switcher diagnostic tool + synthetic tests；
- [x] prove initial scene visibility semantics；
- [x] implement authoritative initial-state selector；
- [ ] Canal schema v3 duplicated-active-state blocker=0；
- [ ] Port Bay schema v3 duplicated-active-state blocker=0；
- [ ] finalize PR2 handoff after real rerun。
