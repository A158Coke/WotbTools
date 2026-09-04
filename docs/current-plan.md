# 3D Battle Playback First — PR1 Client Map Research

## 状态

IMPLEMENTING / CANAL + PORT BAY SCG CONTRACT PROVEN / DERIVED POC RERUN NEXT

## 目标

完成 `Maps.zip -> Map Geometry Core -> 3D Battle Playback` 路线中的 PR1：

1. 用真实客户端资源证明 terrain / static geometry / collision / terrain-associated data 的来源；
2. 留下可重复的 research tooling；
3. 对第一批真实 Playback example 产出 renderer-neutral derived geometry PoC；
4. 明确 PR2 的 Map Geometry Core 输入。

当前不实现 frontend 3D renderer。

## Example 策略

### 格式逆向 research sample

`05_amigosville_am`（Falls Creek / 乡间溪流）继续只作为格式研究样本。

它已经完成 SC2 / SCG / datasource / PolygonGroup 的实证研究。由于当前没有可用 replay，不作为首批 Playback demo。

### 第一批 3D Playback examples

```text
18_canal_cn = Canal / 运河尽头
14_port_pt  = Port Bay / 港湾小镇
```

两张图都已有 WotBTools 2D basemap，并可后续用数据库真实 replay 验证：

```text
replay coordinates
  -> terrain
  -> static geometry
  -> vehicle overlay
  -> timeline / HP / death / base state
```

双地图同时验证可以尽早发现 map-specific SC2/SCG/LOD/switch 差异，禁止用 map-id hardcode 掩盖格式问题。

## 已确认基础

- `common/python/wotb_sc2.py`：DVPL + DAVA SceneFileV2 reader；
- `map-semanticizer`：Landscape world bounds + heightmap + elevation/slope；
- SC2 spawn/base Z 已与 heightmap sampling 做真实交叉验证；
- client scene / replay / 2D basemap 已使用同一 world-coordinate contract；
- 完整 `Maps.zip` 可按 map id 读取主 SC2。

## 真实 Maps.zip inventory

- archive：2,107,519,076 bytes（约 1.96 GiB）；
- 4,316 files；
- 35 个 `NN_*` 目录 = 33 battle maps + `00_global_content` + `00_shared_content`；
- `.sc2.dvpl` 84；
- `.scg.dvpl` 84；
- `.heightmap.dvpl` 38；
- `.mkm.dvpl` 37；
- `.lka.dvpl` 65；
- texture payload 约占 uncompressed archive 86.3%。

## Static geometry contract — 已在三张真实地图成立

格式链：

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

### 05_amigosville_am research sample

- SCG PolygonGroups：221；
- vertices：164,307；
- indices：266,417；
- unique `rb.datasource`：107；
- datasource match：107 / 107；
- unmatched：0。

### 18_canal_cn / 运河尽头

真实 SCG inspection：

- SCPG v1；
- PolygonGroups：237；
- vertices：173,017；
- indices：299,156；
- primitives：104,600；
- index payload mismatch：0；
- RenderBatch datasource occurrences：2,183；
- unique `rb.datasource`：115；
- matched：115 / 115；
- unmatched：0。

### 14_port_pt / 港湾小镇

真实 SCG inspection：

- SCPG v1；
- PolygonGroups：217；
- vertices：126,466；
- indices：223,764；
- primitives：77,454；
- index payload mismatch：0；
- RenderBatch datasource occurrences：2,781；
- unique `rb.datasource`：114；
- matched：114 / 114；
- unmatched：0。

结论：

> `SC2 rb.datasource -> companion SCG PolygonGroup #id` 已不再是单图偶然结构；至少在 Falls Creek、Canal、Port Bay 三张真实地图均成立且 unmatched=0。

## Vertex / index contract

当前真实样本已确认：

- interleaved vertex buffer；
- `EVF_VERTEX` 为 offset 0 的 float32 XYZ；
- stride 可由 `len(vertices) / vertexCount` 严格验证；
- 当前样本 `indexFormat=0` 对应 uint16 payload；
- decoder 验证 finite position、index payload size 与 local index bounds。

DAVA world transform contract：

```text
scaled = worldScale * localVertex
world = worldRotation.ApplyToVectorFast(scaled) + worldTranslation
```

derived runtime 数据模型保持：

```text
shared local geometry + instance world transform
```

而不是把重复建筑 bake 成重复 world-space mesh。

## 第一轮 Canal / Port Bay geometry PoC 暴露的 exporter bug

第一次运行 `export_map_geometry_poc.py` 时，两张图都输出：

```text
geometryCount = 0
instanceCount = 0
```

这不是客户端缺少 geometry。

当时 exporter 把 active batch 错误实现为：

```text
batch.lodIndex == requestedLod
AND
batch.switchIndex == requestedSwitch
```

因此把大量 `-1` batch 误记为 `other_lod / other_switch`：

- Canal：`other_lod=1116`, `other_switch=762`；
- Port Bay：`other_lod=2096`, `other_switch=1514`。

DAVA `RenderObject::UpdateActiveRenderBatchesFromCollection()` 的真实规则是：

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

即 `-1` 是 shared/wildcard batch。

### 已修复

`common/python/export_map_geometry_poc.py` schema v2：

- `-1` LOD/switch 按 DAVA shared batch 规则参与目标 0/0 state；
- SceneFileV2 缺失 batch option 按 DAVA load default `-1` 处理；
- `ro.batches` dict 使用真实 `0000/0001/...` archive key 解析 batch index，不依赖 Python dict enumeration；
- 如果 selected Mesh instances 为 0，直接失败并删除空输出，不再生成“成功但 0 bytes”的 PoC；
- manifest 明确记录 shared batch rule。

`common/python/inspect_map_scg.py` schema v2：

- datasource discovery 改为递归遍历全部 nested `#hierarchy`；
- 与 exporter 使用一致的 entity universe。

新增 `common/python/tests/test_export_map_geometry_poc.py`：

- `lod=-1 / switch=-1` shared batch 必须被目标 0/0 接纳；
- `lod=0 / switch=-1` 接纳；
- `lod=-1 / switch=0` 接纳；
- 非目标 LOD/switch 排除；
- reverse insertion-order 的 `0000/0001/...` batch keys 仍映射正确；
- non-numeric archive batch key fail-fast；
- nested hierarchy traversal 覆盖。

## Collision

已确认 `CollisionTypeComponent` 字段：

```text
CollisionType
Density
FallingType
Health
MaterialKind
```

当前能证明 collision/destruction/material classification metadata 属于 scene entity。

仍未证明：

- 是否存在独立 collision mesh；
- gameplay collision 是否复用 visual PolygonGroup；
- `CollisionType` 的完整 enum 语义。

这不阻塞首批 visual 3D Playback，但在 AI LOS/pathfinding spatial core 前必须继续解决。

## TerrainData / MKM / LKA

TerrainDataComponent 已确认直接引用 `.mkm/.lka`。

MKM research sample：24-byte header + 262,144-byte payload，具有强 packed-grid 特征；LKA 仍是 terrain-associated opaque data。

证据不足前不得标成 navmesh/passability。

## 当前工具

- `common/python/inventory_maps_zip.py`：archive inventory / selective extraction；
- `common/python/inspect_map_scene.py`：SC2/render/collision/terrain evidence；
- `common/python/wotb_scg.py`：SCPG + position/index decoder；
- `common/python/inspect_map_scg.py`：recursive SC2 datasource ↔ SCG exact cross-check；
- `common/python/export_map_geometry_poc.py`：renderer-neutral shared geometry + instance manifest exporter。

## 下一执行步骤

更新分支后重新执行两张图。前一轮 SCG 已证明 contract，但 inspector 已升级为 recursive schema v2，因此建议一并重跑：

```powershell
git checkout research/client-map-3d-inventory
git pull origin research/client-map-3d-inventory

python common/python/inspect_map_scg.py "C:\Users\yu.chen\Downloads\Maps.zip" 18_canal_cn
python common/python/export_map_geometry_poc.py "C:\Users\yu.chen\Downloads\Maps.zip" 18_canal_cn

python common/python/inspect_map_scg.py "C:\Users\yu.chen\Downloads\Maps.zip" 14_port_pt
python common/python/export_map_geometry_poc.py "C:\Users\yu.chen\Downloads\Maps.zip" 14_port_pt
```

下一轮 Gate：

1. `schemaVersion=2`；
2. recursive datasource unmatched = 0；
3. geometryCount > 0；
4. instance count > 0；
5. positionsBytes > 0；
6. indicesBytes > 0；
7. unsupported/malformed geometry blocker = 0。

只有 Canal + Port Bay 同时通过，才把当前 extraction contract 升级为 PR2 首版 Map Geometry Core contract。

## PR1 Definition of Done

- [x] 真实 Maps.zip inventory；
- [x] terrain + coordinate 基础能力；
- [x] Falls Creek format research sample；
- [x] companion SCG SCPG/PolygonGroup decode；
- [x] Falls Creek datasource link 107/107；
- [x] Canal datasource link 115/115；
- [x] Port Bay datasource link 114/114；
- [x] vertex/index decoder；
- [x] renderer-neutral geometry exporter；
- [x] DAVA shared LOD/switch `-1` 规则修复 + regression tests；
- [ ] Canal schema v2 derived geometry PoC blocker=0；
- [ ] Port Bay schema v2 derived geometry PoC blocker=0；
- [ ] collision representation 的 PR1 最终边界说明；
- [ ] nav/passability 的 PR1 最终边界说明；
- [ ] PR2 Map Geometry Core 输入/DoD 定稿。

## 非目标

PR1 不做 frontend 3D renderer、2D/3D toggle、全地图 batch conversion、原客户端纹理/材质复刻、SpeedTree/草地重建、完整 tank 3D model、AI LOS/pathfinding，也不提交 raw Maps.zip / bulk client assets。
