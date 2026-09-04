# 3D Battle Playback First — PR1 Client Map Research

## 状态

**COMPLETE / READY FOR REVIEW / PR2 MAP GEOMETRY CORE NEXT**

本 PR 只完成客户端地图资源研究、解析 contract 与 renderer-neutral derived geometry PoC，不实现 frontend 3D renderer。

## PR1 结论

`Maps.zip -> static geometry` 的主链路已经由真实客户端数据闭环：

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

第一批 Playback examples：

```text
18_canal_cn = Canal / 运河尽头
14_port_pt  = Port Bay / 港湾小镇
```

`05_amigosville_am`（Falls Creek / 乡间溪流）继续只作为早期 reverse-engineering reference sample；它的旧 SCG report 使用 schema v1 非递归 datasource traversal，因此不再拿旧绝对 datasource 数量与 schema v2 双地图结果做横向比较，但它仍提供了最初的 `rb.datasource -> PolygonGroup #id` exact-match 证据。

## 真实 Maps.zip baseline

- archive bytes：2,107,519,076（约 1.96 GiB）；
- 4,316 files；
- 33 battle maps + `00_global_content` + `00_shared_content`；
- `.sc2.dvpl` 84；
- `.scg.dvpl` 84；
- `.heightmap.dvpl` 38；
- `.mkm.dvpl` 37；
- `.lka.dvpl` 65；
- 原 texture payload 约占 uncompressed archive 86.3%。

因此 production 3D pipeline 不应直接发布/加载整套客户端纹理；PR2 继续只生成 derived runtime data，并使用 WotBTools 自己的中性材质/视觉语言。

## Canal schema v2 — PASS

SCG inspection：

- recursive `#hierarchy` entities：2,725；
- SCPG v1；
- PolygonGroups：237；
- vertices：173,017；
- indices：299,156；
- primitiveCount：104,600；
- trailing bytes：0；
- warnings：0；
- index payload mismatch：0；
- RenderBatch datasource occurrences：3,573；
- unique `rb.datasource`：237；
- matched：237 / 237；
- unmatched：0；
- unreferenced PolygonGroup：0。

Derived geometry PoC：

- schemaVersion：2；
- selected geometry：94；
- selected unique datasource：94；
- Mesh instances：953；
- decoded positions：99,736；
- decoded indices：182,451；
- positions bytes：1,196,832；
- indices bytes：729,804；
- selected primitive type：triangle list only；
- orphan instance datasource：0；
- unused selected geometry：0；
- malformed / unsupported blocker：0。

Skipped by intended runtime policy：

- inactive LOD：925；
- SpeedTreeObject：311；
- VegetationRenderObject：3；
- MapBorderRenderObject：2；
- Landscape：1；
- WaterRenderObject：1。

## Port Bay schema v2 — PASS

SCG inspection：

- recursive `#hierarchy` entities：3,890；
- SCPG v1；
- PolygonGroups：217；
- vertices：126,466；
- indices：223,764；
- primitiveCount：77,454；
- trailing bytes：0；
- warnings：0；
- index payload mismatch：0；
- RenderBatch datasource occurrences：4,702；
- unique `rb.datasource`：217；
- matched：217 / 217；
- unmatched：0；
- unreferenced PolygonGroup：0。

Derived geometry PoC：

- schemaVersion：2；
- selected geometry：106；
- selected unique datasource：106；
- Mesh instances：2,039；
- decoded positions：79,837；
- decoded indices：149,793；
- positions bytes：958,044；
- indices bytes：599,172；
- selected primitive type：triangle list only；
- orphan instance datasource：0；
- unused selected geometry：0；
- malformed / unsupported blocker：0。

Skipped by intended runtime policy：

- inactive LOD：1,571；
- SpeedTreeObject：162；
- VegetationRenderObject：3；
- Landscape：1；
- WaterRenderObject：1；
- MapBorderRenderObject：1。

## DAVA active RenderBatch contract

第一轮双地图 PoC 暴露并已修复 exporter bug。

真实 DAVA rule：

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

因此 `-1` 是 shared/wildcard batch，不是 inactive batch。

当前 schema v2 exporter：

- 默认 requested LOD=0 / switch=0；
- 正确接纳 `-1` shared LOD/switch；
- 缺失 option 按 DAVA load default `-1`；
- `ro.batches` 使用真实 numeric archive key 解析 batch index；
- 0 selected instances fail-fast；
- regression tests 覆盖 wildcard、numeric batch key、nested hierarchy。

## Coordinate / geometry contract

继续使用现有 canonical world frame：

```text
DAVA local XYZ
  -> worldScale
  -> worldRotation quaternion XYZW
  -> worldTranslation
```

runtime representation：

```text
shared local geometry + SC2 world-transform instances
```

不把重复建筑 bake 成重复 world-space vertex buffers。

Terrain 高度继续复用 `map-semanticizer` 已验证的 Landscape world bounds + heightmap pipeline；replay/client/2D basemap 已共享同一 world-coordinate contract。

## Collision 边界 — PR1 CLOSED

已证明：scene entity 广泛存在 `CollisionTypeComponent`，字段包含：

```text
CollisionType
Density
FallingType
Health
MaterialKind
```

PR1 能证明的是：

> collision / destruction / material classification metadata 属于 scene entity。

PR1 **不能证明**：

- 独立 gameplay collision mesh 的来源；
- gameplay collision 是否直接复用 visual PolygonGroup；
- `CollisionType` 完整 enum / engine 行为。

因此：

- **不把 visual SCG geometry 声称为 gameplay collision geometry**；
- collision mesh 不是 PR2 visual 3D Playback 的 blocker；
- 在未来 AI LOS/pathing/spatial core 前单独继续研究。

## Nav / passability 边界 — PR1 CLOSED

`TerrainDataComponent` 已证明直接引用 `.mkm/.lka`。

当前仅能证明：

- MKM 是 fixed-size packed terrain-associated binary；
- LKA 是 terrain-associated opaque archive/data。

当前不能证明它们是 navmesh、passability grid 或路径规划数据。

因此：

- PR2 不消费 MKM/LKA；
- 不在 API/schema/code 中使用 `navmesh` / `passability` 等未经证明的名称；
- 后续 Spatial Analysis PR 再做语义逆向。

## PR2 — Map Geometry Core contract

PR2 目标：把 PR1 的 research PoC 收敛成可重复、可测试、可供浏览器 renderer 消费的 **renderer-neutral Map Geometry Core**。

### 输入

```text
Maps.zip
  ├─ <map>/<map>.sc2(.dvpl)
  ├─ <map>/<map>.scg(.dvpl)
  └─ <map>/<map>.heightmap(.dvpl)

+ existing common map semantics / world bounds / base metadata
```

### Derived runtime output

至少包含：

```text
map-manifest.json
static-positions.bin
static-indices.bin
terrain representation
instance transforms
world bounds / coordinate metadata
```

具体文件名可在实现中调整，但 contract 必须保持 renderer-neutral，不直接绑定 Three.js/Babylon.js/glTF。

### Static mesh selection

PR2 v1：

- `Mesh` only；
- requested LOD=0 / switch=0；
- shared `-1` batch 生效；
- exclude shadow-only；
- SpeedTree / vegetation 不进入 v1；
- Landscape 由 heightmap terrain pipeline 单独生成；
- Water / map border 不作为 static-mesh dependency；
- 不输出客户端 texture/material/UV/tangent 数据。

### PR2 DoD

Canal + Port Bay 必须同时满足：

1. deterministic conversion；
2. static geometry decode blocker=0；
3. terrain decode blocker=0；
4. canonical world bounds 一致；
5. shared geometry + instances 无 orphan datasource；
6. derived package 不包含 raw SC2/SCG/texture bulk asset；
7. output size / counts 有 manifest validation；
8. replay/world coordinate 不引入第二套 map coordinate system；
9. targeted Python tests 覆盖 conversion contract；
10. 为 PR3 Browser 3D Technical Prototype 提供稳定输入。

PR3 再负责第一张真正的 browser 3D map：terrain + static mesh + camera，随后叠加真实 replay vehicle state。

## PR1 Definition of Done

- [x] 真实 Maps.zip inventory；
- [x] terrain + replay/client coordinate baseline；
- [x] SCPG / PolygonGroup parser；
- [x] SC2 `rb.datasource` -> SCG `#id` exact contract；
- [x] vertex/index decoder；
- [x] renderer-neutral geometry exporter；
- [x] DAVA shared LOD/switch rule + regression tests；
- [x] Canal schema v2 recursive datasource gate；
- [x] Canal derived geometry PoC blocker=0；
- [x] Port Bay schema v2 recursive datasource gate；
- [x] Port Bay derived geometry PoC blocker=0；
- [x] collision representation PR1 boundary；
- [x] nav/passability PR1 boundary；
- [x] PR2 Map Geometry Core input / output / DoD。

## 非目标

PR1 不做 frontend renderer、2D/3D toggle、full-map production conversion、客户端原视觉复刻、SpeedTree/草地重建、tank 3D model、AI LOS/pathfinding，也不提交 raw Maps.zip / bulk client assets。
