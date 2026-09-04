# 3D Battle Playback First — PR1 Client Map Research

## 状态

IMPLEMENTING / REAL INVENTORY + SC2 TRACE COMPLETE / SCPG DATASOURCE VERIFY NEXT

## 目标

完成 `Maps.zip -> Map Geometry Core -> 3D Battle Playback` 路线中的 PR1：先用真实客户端资源证明 terrain / static geometry / collision / terrain-associated data 的来源与关联，再进入 renderer。

## 已确认基础

1. `common/python/wotb_sc2.py` 已能解析 DVPL + DAVA SceneFileV2。
2. `map-semanticizer` 已能读取 Landscape world bounds + heightmap，并生成 elevation / slope。
3. SC2 spawn/base Z 与 heightmap sampling 已存在数值交叉验证。
4. client scene / replay / 2D basemap 已使用同一 world-coordinate contract。
5. 完整 `Maps.zip` 已可按 map id 直接读取主 SC2。

## 真实 Maps.zip inventory

已确认：

- archive 2,107,519,076 bytes（约 1.96 GiB）；
- 4,316 files；
- uncompressed 2,291,239,572 bytes；
- 35 个 `NN_*` 目录 = 33 battle maps + `00_global_content` + `00_shared_content`；
- `.sc2.dvpl` 84；
- `.scg.dvpl` 84；
- `.heightmap.dvpl` 38；
- `.mkm.dvpl` 37；
- `.lka.dvpl` 65；
- texture payload 约占 uncompressed archive 的 86.3%。

## 第一张 Vertical Slice

固定：`05_amigosville_am`（Falls Creek / 乡间溪流）。

## SC2 schema v2 真实结论

主场景：

- SceneFileV2 version 48；
- 1775 entities；
- `RenderComponent` 1216；
- `CollisionTypeComponent` 1056；
- `LodComponent` 934；
- `TerrainDataComponent` 1。

Render objects：

- `Mesh` 773；
- `SpeedTreeObject` 435；
- 其他 Landscape / Water / Vegetation / MapBorder。

RenderBatch：

- 3,876 batches；
- 每个 batch 都有 `rb.datasource`；
- `rb.datasource` 是整数 data-source id。

### 关键修正：主 SC2 没有 PolygonGroup

主 SC2 的 `#dataNodes` 共 9,250 个，但 class 只有：

- `NMaterial` 5559；
- `ParticleEmitterNode` 3689；
- `SceneRenderConfig` 1；
- `AnimationData` 1。

**PolygonGroup count = 0。**

因此此前“battle-map 主 SC2 直接内嵌 static mesh PolygonGroup”的假设已被真实数据否定。

当前最强证据链变成：

```text
SC2 RenderBatch
  -> rb.datasource integer id
  -> companion SCPG / SCG PolygonGroup #id
  -> vertices / indices
```

`.sc2.dvpl` 与 `.scg.dvpl` 在完整 archive 中均为 84 个，也支持优先验证同 basename sidecar 的路线。

## Collision 当前结论

`CollisionTypeComponent` 广泛存在，并带真实字段：

```text
CollisionType
Density
FallingType
Health
MaterialKind
```

因此已确认 collision classification / destruction-material metadata 是场景实体的一部分。

仍未证明：

- 是否存在独立 collision mesh；
- 或 gameplay collision 是否直接复用 visual geometry + CollisionType metadata。

## TerrainDataComponent / MKM / LKA

`TerrainDataComponent` 明确引用：

```text
blitz/05_amigosville_am.mkm
blitz/05_amigosville_am.lka
blitz/map_effects.yaml
```

两者已成功 DVPL 解码。

### MKM

- decoded bytes：262,168；
- header magic-like bytes：`kkm\0`；
- header uint32 包含 `1`, `1024`, `262144`；
- payload shape 为 24-byte header + 262,144 bytes。

这是明显的固定尺寸 packed terrain-associated binary，但在格式被进一步证明之前**不得标为 navmesh / passability map**。

### LKA

- decoded bytes：12,862；
- header：`KA...`；
- 包含大量数字字符串；
- 当前仍是 opaque terrain-associated binary。

## 当前实现

### `common/python/inventory_maps_zip.py`

- central-directory-only inventory；
- per-map / extension / bytes；
- selective extraction；
- filename/path heuristic 始终保持 candidate 语义。

### `common/python/inspect_map_scene.py`

- SC2 component / render-object / RenderBatch evidence；
- CollisionTypeComponent / TerrainDataComponent samples；
- dataNodes / PolygonGroup check；
- MKM/LKA header inspection。

### `common/python/wotb_scg.py`

新增最小 SCPG reader：

```text
SCPG
version
nodeCount
nodeCount2
nodeCount x KeyedArchive
```

复用现有 `Reader + read_archive()`，不复制第二套 KeyedArchive parser。

### `common/python/inspect_map_scg.py`

新增 companion SCG verifier：

- 自动找到主 SC2 同 basename `.scg(.dvpl)`；
- 解码真实 SCPG header；
- 统计 PolygonGroup / vertices / indices / primitive；
- 记录 vertexFormat / attribute bitmask / vertex stride；
- 校验 index payload size；
- 将 SC2 `rb.datasource` 与 SCG PolygonGroup `#id` 做 exact integer-id cross-check。

## 下一执行步骤

更新分支后执行：

```powershell
python common/python/inspect_map_scg.py "<Maps.zip>" 05_amigosville_am
```

默认输出：

```text
tmp/map-research/05_amigosville_am-scg-inspection.json
```

本轮只需要回答：

1. 是否存在同 basename SCG sidecar；
2. SCPG version / nodeCount；
3. PolygonGroup 总量、vertex/index 总量；
4. SC2 `rb.datasource` 与 PolygonGroup `#id` 的命中率；
5. 真实 vertexFormat / stride / indexFormat。

如果 datasource 命中率高，则 static geometry source/reference chain 可以视为已确认，下一步直接做 vertex/index decoder PoC。

## PR1 Definition of Done

- [x] 真实 Maps.zip inventory；
- [x] map count / extension / per-map/shared structure；
- [x] terrain + coordinate 基础能力；
- [x] 第一张地图 scene/resource trace；
- [x] CollisionTypeComponent 字段确认；
- [x] `.mkm/.lka` TerrainDataComponent 引用与 payload shape；
- [x] 第一张 3D vertical-slice 地图；
- [x] 主 SC2 PolygonGroup=0 已确认；
- [ ] companion SCG PolygonGroup / datasource link 最终确认；
- [ ] collision geometry representation 最终确认；
- [ ] nav/passability representation 状态最终确认；
- [ ] vertex/index decode PoC；
- [ ] PR2 的真实输入和复用边界明确。

## 非目标

- 不实现 frontend 3D renderer；
- 不提前锁定 Three.js/Babylon.js；
- 不批量转换全部地图；
- 不提交完整 Maps.zip / raw client asset；
- 不开始 AI spatial analysis。
