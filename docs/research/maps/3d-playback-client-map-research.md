# 3D Battle Playback — Client Map Research

## 状态

PR1 / Phase 0：**IN PROGRESS — EXTRACTION PROVEN / INITIAL VISUAL STATE SEMANTICS NOT YET PROVEN**。

本报告刻意区分两件事：

1. 能否从 SC2/SCG 稳定提取 geometry；
2. 能否证明哪些 scene branches 在战斗初始时应该可见。

第 1 项已经通过 Canal + Port Bay 双地图 gate；第 2 项仍是 PR1 blocker。

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

Raw candidate geometry PoC：

```text
selected geometry groups           94
Mesh instances                    953
positions                       99736
indices                        182451
positions bytes               1196832
indices bytes                  729804
```

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

Raw candidate geometry PoC：

```text
selected geometry groups          106
Mesh instances                   2039
positions                       79837
indices                        149793
positions bytes                958044
indices bytes                  599172
```

因此 SC2↔SCG extraction contract 已经不是单图偶然结构。

---

# RenderBatch wildcard — PASS

第一轮空 PoC 根因已确认并修复。

DAVA RenderObject active batch rule：

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

`-1` 是 shared/wildcard batch。

schema v2 exporter 已复现该规则，并验证 numeric batch archive key / missing default / recursive hierarchy。

---

# New blocker — scene-level state variants

最终 sanity check 发现 raw candidate PoC 同时包含大量 State 0 / State 1 sibling geometry。

Port Bay 例子：

```text
$.#hierarchy[65].#hierarchy[1]  bld_pt_brickfence.sc2 State 0
$.#hierarchy[65].#hierarchy[2]  bld_pt_brickfence.sc2 State 1
```

两者都进入 PoC，且 batch switchIndex 都是 `-1`。

Canal 例子：

```text
$.#hierarchy[184].#hierarchy[1] fag_cn_03_woodenstuff.sc2 State 0
$.#hierarchy[184].#hierarchy[2] fag_cn_03_woodenstuff.sc2 State 1
```

同样两者都进入 PoC，batch switchIndex 都是 `-1`。

因此：

> RenderBatch LOD/switch selection 能决定一个 RenderObject 的 active batches，但当前证据不足以决定 scene-level State 0/State 1 branch 的初始可见性。

raw candidate PoC 不能被称为“initial visual scene”。

---

# Standard DAVA SwitchComponent evidence

公开 DAVA `SwitchSystem` 的行为已经确认：

```text
SwitchComponent newSwitchIndex
  -> SwitchSystem.SetSwitchHierarchy(entity, index)
  -> RenderObject.SetSwitchIndex(index)
  -> recursively apply to children
```

但 WoTB map scene 里还存在大量 `StateSwitcherComponent`，其行为不能从标准 `SwitchComponent` 自动类推。

特别禁止：

- 不能用 entity name `State 0` 直接作为 production initial-state rule；
- 不能简单删掉所有 `State 1`；
- 不能把 batch `switch=-1` 当成 scene-state selection。

---

# State-switcher diagnostic tooling

新增：

```text
common/python/inspect_map_state_switchers.py
common/python/tests/test_inspect_map_state_switchers.py
```

报告内容：

- recursive component inventory；
- `StateSwitcherComponent` raw archive；
- `SwitchComponent` raw archive；
- parent / immediate-child hierarchy；
- `ro.flags`；
- DAVA VISIBLE bit；
- child RenderBatch datasource / LOD / switch；
- State 0/State 1 name pair 仅作为 research locator。

生产 selector 必须来自 component/visibility evidence，而不是命名 heuristic。

下一次真实命令：

```powershell
python common/python/inspect_map_state_switchers.py "C:\Users\yu.chen\Downloads\Maps.zip" 18_canal_cn
python common/python/inspect_map_state_switchers.py "C:\Users\yu.chen\Downloads\Maps.zip" 14_port_pt
```

输出：

```text
tmp/map-research/18_canal_cn-state-switcher-inspection.json
tmp/map-research/14_port_pt-state-switcher-inspection.json
```

---

# Visual-state Gate

在 PR1 完成前必须证明 authoritative initial-state rule，候选证据包括：

- RenderObject `ro.flags` / VISIBLE；
- `SwitchComponent.sc.switchindex` + DAVA hierarchy propagation；
- WoTB `StateSwitcherComponent` raw fields；
- 其它可验证 scene metadata。

然后必须：

1. 实现通用 initial-state selector；
2. targeted regression tests；
3. rerun Canal + Port Bay；
4. 确认同一 state-switch group 不会把互斥 visual branches 同时输出。

通过前 PR247 保持 Draft，PR2 不开始。

---

# Large environment mesh note

PoC 中存在超出 playable `-300..300` bounds 的大范围 environment/surroundings meshes。它们可能是合法远景/环境 geometry，不能按尺寸或 filename 硬删。

PR2 应增加 transformed world-AABB / role sanity report，但任何 selection 都必须来自 scene/render evidence。

---

# Collision / nav boundary

已确认：

- `CollisionTypeComponent` metadata 存在；
- 独立 gameplay collision mesh 未证明；
- `.mkm/.lka` 与 TerrainData 关联；
- navmesh/passability semantics 未证明。

这些不阻塞 visual 3D Playback，但未来 AI LOS/pathing Spatial Analysis 前必须继续研究。

---

# PR1 DoD

- [x] Maps.zip inventory；
- [x] terrain + coordinate baseline；
- [x] SCPG / PolygonGroup parser；
- [x] recursive SC2 datasource ↔ SCG exact link；
- [x] vertex/index decoder；
- [x] DAVA RenderBatch wildcard contract；
- [x] Canal raw candidate geometry extraction blocker=0；
- [x] Port Bay raw candidate geometry extraction blocker=0；
- [x] state-switcher diagnostic tool + synthetic tests；
- [ ] prove initial scene state/visibility semantics；
- [ ] implement authoritative initial-state selector；
- [ ] Canal duplicated-active-state blocker=0；
- [ ] Port Bay duplicated-active-state blocker=0；
- [ ] finalize PR2 handoff。
