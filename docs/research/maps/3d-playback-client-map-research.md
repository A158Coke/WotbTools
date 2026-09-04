# 3D Battle Playback — Client Map Research

## 状态

PR1 / Phase 0：**COMPLETE — READY FOR REVIEW**。

本报告记录 `Maps.zip` 中 terrain / static geometry / collision metadata / terrain-associated data 的实证结果，并定义后续 PR2 Map Geometry Core 的边界。

---

# 1. Sample policy

Reverse-engineering reference：

```text
05_amigosville_am = Falls Creek / 乡间溪流
```

首批 Playback examples：

```text
18_canal_cn = Canal / 运河尽头
14_port_pt  = Port Bay / 港湾小镇
```

Falls Creek 用于最初格式逆向；Canal + Port Bay 用 schema v2 recursive traversal 和 derived exporter 作为真正 PR1 gate。

---

# 2. Existing repository baseline

仓库已具备：

- `common/python/wotb_sc2.py`：DVPL + DAVA SceneFileV2；
- `map-semanticizer`：Landscape world bounds / heightmap / elevation / slope；
- SC2 spawn/base Z 与 heightmap sampling 的交叉验证；
- replay/client/2D basemap 共用 world-coordinate contract。

因此 3D Playback 不新建第二套地图坐标系。

---

# 3. Maps.zip inventory

真实 archive：

- bytes：2,107,519,076；
- files：4,316；
- 33 battle maps + `00_global_content` + `00_shared_content`；
- `.sc2.dvpl`：84；
- `.scg.dvpl`：84；
- `.heightmap.dvpl`：38；
- `.mkm.dvpl`：37；
- `.lka.dvpl`：65。

Texture payload 约占 uncompressed archive 86.3%。

结论：production 不应分发整个客户端纹理集合；本路线只生产 derived runtime geometry，并使用自有材质。

---

# 4. Static geometry source/reference contract

已证明主链：

```text
SC2 Entity
  -> RenderComponent
  -> Mesh
  -> RenderBatch
  -> rb.datasource integer id
  -> same-basename companion SCG
  -> PolygonGroup #id
  -> vertices / indices
```

主 SC2 本身不是 static PolygonGroup container；几何数据位于 companion SCPG `.scg` sidecar。

## Falls Creek

早期 schema v1 research sample：

- SCPG v1；
- PolygonGroups：221；
- vertices：164,307；
- indices：266,417；
- top-level traversal 中 unique datasource：107；
- matched：107/107；
- unmatched：0。

注意：该旧 report 在 recursive inspector 引入前生成，因此它证明 exact id link，但不用于和 schema v2 的 absolute datasource coverage 对比。

## Canal — schema v2

Scene：

- recursive entities：2,725。

SCG：

- SCPG v1；
- PolygonGroups：237；
- groups with id：237；
- unique ids：237；
- vertices：173,017；
- indices：299,156；
- primitives：104,600；
- trailing bytes：0；
- warnings：0；
- index payload mismatch：0。

Recursive datasource cross-check：

```text
RenderBatch datasource occurrences = 3573
unique SC2 datasource ids           = 237
SCG PolygonGroup ids                = 237
matched unique ids                  = 237 / 237
unmatched ids                       = 0
unreferenced PolygonGroup ids       = 0
```

## Port Bay — schema v2

Scene：

- recursive entities：3,890。

SCG：

- SCPG v1；
- PolygonGroups：217；
- groups with id：217；
- unique ids：217；
- vertices：126,466；
- indices：223,764；
- primitives：77,454；
- trailing bytes：0；
- warnings：0；
- index payload mismatch：0。

Recursive datasource cross-check：

```text
RenderBatch datasource occurrences = 4702
unique SC2 datasource ids           = 217
SCG PolygonGroup ids                = 217
matched unique ids                  = 217 / 217
unmatched ids                       = 0
unreferenced PolygonGroup ids       = 0
```

结论：Canal + Port Bay 中 companion SCG 的 PolygonGroup id universe 与 recursively discovered SC2 datasource universe 完全一致。

---

# 5. Vertex / index contract

当前真实数据证明：

- interleaved vertex storage；
- `EVF_VERTEX` 位于 offset 0；
- position = little-endian float32 XYZ；
- stride = `len(vertices) / vertexCount`，必须严格整除；
- 当前三张样本 index payload validation 均通过；
- decoder 会拒绝 non-finite position、index payload mismatch、out-of-range local index。

Runtime 不复制每个建筑 mesh，而使用：

```text
shared local geometry
+ SC2 worldScale
+ SC2 worldRotation quaternion XYZW
+ SC2 worldTranslation
```

---

# 6. DAVA RenderBatch active rule

第一轮 Canal + Port Bay PoC 都得到空 geometry，最终确认是 exporter bug，而不是客户端资源缺失。

DAVA active rule：

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

`-1` 是 shared/wildcard batch。

schema v2 exporter 已修复：

- requested LOD=0 / switch=0；
- 接纳 shared `-1`；
- missing option 使用 DAVA load default `-1`；
- numeric archive batch key 作为真实 batch index；
- zero selected instances fail-fast；
- tests 覆盖 wildcard、nested hierarchy、batch key ordering。

---

# 7. Derived geometry PoC gate

## Canal — PASS

```text
selected geometry groups = 94
Mesh instances           = 953
unique selected ids      = 94
decoded positions        = 99,736
decoded indices          = 182,451
positions bytes          = 1,196,832
indices bytes            = 729,804
orphan instance ids      = 0
unused selected geometry = 0
blocker                   = 0
```

Skipped intentionally：inactive LOD 925、SpeedTree 311、Vegetation 3、MapBorder 2、Landscape 1、Water 1。

## Port Bay — PASS

```text
selected geometry groups = 106
Mesh instances           = 2,039
unique selected ids      = 106
decoded positions        = 79,837
decoded indices          = 149,793
positions bytes          = 958,044
indices bytes            = 599,172
orphan instance ids      = 0
unused selected geometry = 0
blocker                   = 0
```

Skipped intentionally：inactive LOD 1,571、SpeedTree 162、Vegetation 3、Landscape 1、Water 1、MapBorder 1。

双地图 gate：

```text
18_canal_cn blocker = 0
14_port_pt blocker  = 0
```

**PASS**。

---

# 8. Collision boundary

已确认 scene entity 中存在 `CollisionTypeComponent`：

```text
CollisionType
Density
FallingType
Health
MaterialKind
```

可证明：collision/destruction/material classification metadata 属于 scene entity。

不可证明：

- 独立 gameplay collision mesh 来源；
- gameplay collision 是否复用 visual SCG PolygonGroup；
- CollisionType 完整 enum/engine behavior。

所以 PR1 明确禁止把 visual SCG geometry 描述成 gameplay collision geometry。

这不阻塞 visual 3D Playback；未来 AI LOS/pathing spatial core 前再继续研究。

---

# 9. MKM / LKA / nav-passability boundary

`TerrainDataComponent` 已证明引用 `.mkm/.lka`。

MKM 有 fixed-size packed-grid 特征；LKA 是 terrain-associated opaque data。

没有足够证据证明它们是 navmesh/passability。

因此：

- PR2 不消费 MKM/LKA；
- code/schema/doc 不提前命名为 navmesh/passability；
- spatial-analysis 阶段另开研究。

---

# 10. PR2 Map Geometry Core handoff

PR2 输入：

```text
map SC2
+ companion SCG
+ heightmap
+ existing common map semantics/world bounds/base metadata
```

PR2 derived runtime representation：

```text
renderer-neutral manifest
+ shared static position/index buffers
+ instance transforms
+ terrain representation
+ canonical world bounds/coordinate metadata
```

PR2 v1 static selection：

- Mesh only；
- LOD 0 / switch 0 + shared `-1`；
- exclude shadow-only；
- no SpeedTree/vegetation；
- Landscape 走 heightmap terrain pipeline；
- Water / MapBorder 不作为 static dependency；
- no client texture/material/UV/tangent bulk export。

PR2 DoD：

1. Canal + Port Bay deterministic conversion；
2. static geometry blocker=0；
3. terrain blocker=0；
4. world bounds/coordinate contract 与现有 map/replay 一致；
5. no orphan datasource；
6. manifest validates counts/bytes；
7. derived package 不含 raw SC2/SCG 或原 texture bulk assets；
8. targeted Python tests；
9. 为 PR3 Browser 3D Technical Prototype 提供稳定输入。

PR3 才开始真正 browser scene：terrain + static mesh + camera，然后接真实 replay vehicle state。

---

# 11. Research tooling retained

- `common/python/inventory_maps_zip.py`
- `common/python/inspect_map_scene.py`
- `common/python/wotb_scg.py`
- `common/python/inspect_map_scg.py`
- `common/python/export_map_geometry_poc.py`
- `common/python/tests/test_wotb_scg.py`
- `common/python/tests/test_export_map_geometry_poc.py`

Derived outputs 留在 ignored `tmp/`；禁止提交完整 Maps.zip 或 bulk raw client assets。

---

# 12. PR1 Definition of Done

- [x] Maps.zip inventory；
- [x] terrain + coordinate baseline；
- [x] SCPG / PolygonGroup parser；
- [x] SC2 datasource ↔ SCG exact link；
- [x] recursive datasource traversal；
- [x] vertex/index decoder；
- [x] DAVA shared LOD/switch contract；
- [x] renderer-neutral derived exporter；
- [x] Canal real PoC blocker=0；
- [x] Port Bay real PoC blocker=0；
- [x] collision boundary closed；
- [x] nav/passability boundary closed；
- [x] PR2 Map Geometry Core handoff defined。
