# 3D Battle Playback First — PR1 Client Map Research

## 状态

**IMPLEMENTING / EXTRACTION CONTRACT PASS / INITIAL VISUAL STATE SELECTION BLOCKED**

PR #247 保持 Draft。当前不进入 PR2。

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
- warnings：0；
- index payload mismatch：0。

Raw candidate geometry PoC：

- selected geometry：94；
- Mesh instances：953；
- decoded positions：99,736；
- decoded indices：182,451；
- positions bytes：1,196,832；
- indices bytes：729,804。

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
- warnings：0；
- index payload mismatch：0。

Raw candidate geometry PoC：

- selected geometry：106；
- Mesh instances：2,039；
- decoded positions：79,837；
- decoded indices：149,793；
- positions bytes：958,044；
- indices bytes：599,172。

结论：**geometry extraction 已证明可行且双地图无 datasource blocker。**

## 已修复：DAVA RenderBatch wildcard

DAVA RenderObject active rule：

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

`-1` 是 shared/wildcard batch。

schema v2 exporter 已正确处理 wildcard、missing option default `-1`、numeric `ro.batches` keys、nested hierarchy，并对 zero selected instances fail-fast。

## 新 Blocker：scene-level initial visual state selection

双地图 PoC 的最终 sanity check 发现：**同一个可破坏/可切换对象的 State 0 与 State 1 sibling 同时被 exporter 选中。**

例子：

```text
Port Bay
parent $.#hierarchy[65]
  child[1] bld_pt_brickfence.sc2 State 0
  child[2] bld_pt_brickfence.sc2 State 1

Canal
parent $.#hierarchy[184]
  child[1] fag_cn_03_woodenstuff.sc2 State 0
  child[2] fag_cn_03_woodenstuff.sc2 State 1
```

两边这些 child RenderBatch 的 `switchIndex=-1`，所以 **RenderBatch switch rule 无法单独决定哪个 scene branch 初始可见**。

当前不能直接做：

- 不能因为名字叫 `State 0` 就把它硬编码为初始态；
- 不能删除所有 `State 1`；
- 不能把两态同时送进 browser renderer；
- 不能把 raw candidate geometry PoC 描述为“正确 initial visual scene”。

## 已确认的 DAVA SwitchComponent 行为

标准 DAVA `SwitchSystem` 在 `SwitchComponent` 变化时会：

```text
SetSwitchHierarchy(entity, switchIndex)
  -> current entity RenderObject.SetSwitchIndex(switchIndex)
  -> recursively apply to every child entity
```

但当前 WoTB scene 同时存在大量 `StateSwitcherComponent`，它不是当前公开 DAVA reference 中已证明的同一 contract。必须用真实 map scene 字段验证。

## 新 diagnostic tooling

新增：

```text
common/python/inspect_map_state_switchers.py
common/python/tests/test_inspect_map_state_switchers.py
```

该 inspector 会报告：

- recursive entity/component counts；
- `StateSwitcherComponent` 原始 component archive；
- `SwitchComponent` 原始 component archive；
- parent -> immediate children hierarchy；
- child RenderObject `ro.flags`；
- DAVA `VISIBLE` bit；
- RenderBatch datasource / LOD / switch；
- 仅用于研究定位的 State 0 / State 1 sibling group。

**State 名称 heuristic 只允许作为 diagnostic locator，禁止成为 production selection rule。**

## 下一执行步骤

更新分支后运行：

```powershell
git checkout research/client-map-3d-inventory
git pull origin research/client-map-3d-inventory

python common/python/inspect_map_state_switchers.py "C:\Users\yu.chen\Downloads\Maps.zip" 18_canal_cn
python common/python/inspect_map_state_switchers.py "C:\Users\yu.chen\Downloads\Maps.zip" 14_port_pt
```

输出：

```text
tmp/map-research/18_canal_cn-state-switcher-inspection.json
tmp/map-research/14_port_pt-state-switcher-inspection.json
```

只需要上传这两个 JSON。

## State-selection Gate

下一轮必须从真实 scene 证明至少一种 authoritative rule：

1. `ro.flags` / VISIBLE 明确区分 active/inactive state；或
2. 标准 `SwitchComponent.sc.switchindex` + hierarchy propagation 明确决定 state；或
3. WoTB `StateSwitcherComponent` 的实际字段提供可验证 initial-state contract；或
4. 其它 scene metadata 提供同等强度的 evidence。

如果证据指向上述任一规则，则实现通用 selector + targeted regression tests，再重新生成 Canal + Port Bay geometry PoC。

最终 PR1 visual gate：

```text
Canal extraction blocker = 0
Port extraction blocker  = 0
Canal duplicated active state blocker = 0
Port duplicated active state blocker  = 0
```

通过前不开始 PR2。

## 大范围 Mesh sanity

PoC 中存在 local AABB 超过 battle playable bounds 的大范围 geometry（例如 surroundings/environment mesh）。这本身不是错误，也不允许按尺寸或文件名删除。

PR2 必须增加 transformed world-AABB / role sanity report，区分 playable static geometry 与 environment/surroundings，但 selection 必须基于 scene/render evidence，而不是 `>600m` 之类 hardcode。

## Collision / nav 边界

PR1 仍保持此前边界：

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
- [ ] prove scene-level initial visual state semantics；
- [ ] implement authoritative initial-state selector；
- [ ] rerun Canal + Port Bay with duplicated-active-state blocker=0；
- [ ] finalize PR2 handoff after visual-state gate。

## 非目标

PR1 不实现 frontend 3D renderer、2D/3D toggle、raw client texture/material replication、SpeedTree/grass、tank 3D models、AI LOS/pathfinding，也不提交 Maps.zip / bulk raw client assets。
