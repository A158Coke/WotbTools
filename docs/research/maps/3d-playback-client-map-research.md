# 3D Battle Playback — Client Map Research

## 状态

PR1 / Phase 0：**COMPLETE — DUAL-MAP REAL GATE PASS**。

Canal + Port Bay 已完成真实 `Maps.zip` schema v3 验证。当前已证明三层 contract：

1. SC2/SCG 可以稳定提取 static Mesh geometry；
2. DAVA RenderBatch LOD/switch active rule 可复现；
3. initial scene RenderObject visibility 可通过 DAVA `VISIBLE` bit 权威复现。

PR1 不再有 visual/extraction blocker；下一阶段进入 PR2 Map Geometry Core。

---

# Static geometry extraction — PASS

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

SCG recursive inspection：

```text
entities                         2725
PolygonGroups                    237
vertices                      173017
indices                       299156
unique datasource ids            237
matched ids                  237/237
unmatched                          0
unreferenced PolygonGroups          0
warnings                           0
index payload mismatch             0
```

## Port Bay / 14_port_pt

SCG recursive inspection：

```text
entities                         3890
PolygonGroups                    217
vertices                      126466
indices                       223764
unique datasource ids            217
matched ids                  217/217
unmatched                          0
unreferenced PolygonGroups          0
warnings                           0
index payload mismatch             0
```

因此 SC2 ↔ SCG geometry source/reference/extraction contract 已通过双地图 gate。

---

# RenderBatch wildcard — PASS

DAVA RenderObject active rule：

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

`-1` 是 shared/wildcard batch。

exporter 已验证 numeric batch archive key、missing default `-1`、recursive hierarchy 与 zero-instance fail-fast。

---

# Initial scene visibility — PASS

旧 schema v2 PoC 曾同时输出同一 parent 下的 State 0 / State 1 siblings。真实 scene evidence 与 DAVA source 最终证明，scene-level initial selector 应使用 RenderObject 自身 serialized visibility，而不是 filename 或 batch switch。

DAVA contract：

```text
RenderObject::VISIBLE = 1 << 0
```

`RenderObject::Load()` 对缺失 `ro.flags` 使用包含 `VISIBLE` 的默认 serialization criteria，因此 exporter contract 为：

```text
explicit ro.flags -> require bit 0
missing ro.flags  -> visible by DAVA Load default
```

真实 cross-check：

### Canal

- `StateSwitcherComponent`：347；
- Mesh visibility：590 true / 363 false；
- 347 / 347 diagnostic State 0 siblings visible=true；
- 347 / 347 diagnostic State 1 siblings visible=false。

### Port Bay

- `StateSwitcherComponent`：596；
- Mesh visibility：1,326 true / 713 false；
- 596 / 596 diagnostic State 0 siblings visible=true；
- 596 / 596 diagnostic State 1 siblings visible=false。

`State 0/State 1` 名称只作为 research cross-check，不参与 production selection。

---

# Schema v3 final real rerun — PASS

`common/python/export_map_geometry_poc.py` schema v3 selection：

```text
RenderComponent
  -> Mesh
  -> DAVA RenderObject::VISIBLE
  -> exclude shadow-only
  -> DAVA active LOD/switch
  -> rb.datasource
  -> SCG PolygonGroup
```

## Canal / 18_canal_cn

```text
schemaVersion                         3
selected geometry groups             70
Mesh instances                      590
unique datasource ids                70
decoded positions                 85028
decoded indices                  156543
positions bytes                 1020336
indices bytes                    626172
skipped invisible RenderObject       363
selected diagnostic State 0          347
selected diagnostic State 1            0
mutually-exclusive sibling overlap     0
orphan datasource                      0
buffer/count consistency blocker       0
```

## Port Bay / 14_port_pt

```text
schemaVersion                         3
selected geometry groups             80
Mesh instances                     1326
unique datasource ids                80
decoded positions                 65291
decoded indices                  123054
positions bytes                  783492
indices bytes                    492216
skipped invisible RenderObject       713
selected diagnostic State 0          596
selected diagnostic State 1            0
mutually-exclusive sibling overlap     0
orphan datasource                      0
buffer/count consistency blocker       0
```

Both manifests additionally satisfy:

- every selected instance datasource resolves to one exported geometry id；
- geometry ids are unique；
- instance/geometry summary counts match actual arrays；
- position buffer bytes = decoded position count × 12；
- index buffer bytes = decoded index count × 4；
- all instance world transforms contain finite numeric values。

Final PR1 visual gate：**PASS**。

---

# Regression protection

Exporter tests deliberately construct inverted names：

```text
name = "... State 1", ro.flags = 8193 -> export
name = "... State 0", ro.flags = 8192 -> skip
```

因此 production selector 被锁定为 RenderObject visibility，而不是 filename heuristic。

保留 `inspect_map_state_switchers.py` 作为版本升级/新地图 research diagnostic，不作为 production runtime dependency。

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

Large environment/surroundings meshes 可能合法超出 playable bounds；禁止按尺寸或 filename 删除。PR2 应增加 transformed world-AABB / role sanity report，但 selection 仍只依据 scene/render evidence。

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
- [x] Canal extraction blocker=0；
- [x] Port Bay extraction blocker=0；
- [x] state-switcher diagnostic + synthetic tests；
- [x] prove initial RenderObject visibility semantics；
- [x] authoritative initial-state selector；
- [x] Canal schema v3 duplicated-active-state blocker=0；
- [x] Port Bay schema v3 duplicated-active-state blocker=0；
- [x] PR2 handoff finalized。
