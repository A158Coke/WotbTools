# 3D Battle Playback — Client Map Research

## 状态

PR1 / Phase 0：**IN PROGRESS — REAL INVENTORY + FIRST SCENE TRACE COMPLETE / POLYGONGROUP DECODE NEXT**。

目标仍然是先把真实客户端地图格式研究清楚，再进入 3D Playback renderer。当前 terrain / coordinate 已有可复用基础；本 PR 继续补齐 static geometry、collision、navigation/passability 的可审计证据。

## 已确认的仓库基础

### DVPL + SC2

`common/python/wotb_sc2.py` 已能解 DVPL 与 DAVA SceneFileV2 (`*.sc2`)；`extract_map_bases.py` 已证明可以直接从完整 `Maps.zip` 读取地图主场景。

因此禁止再实现第二套 DVPL / SC2 parser。

### Terrain heightmap

`map-semanticizer/map_semanticizer.py` 已能：

- 从 `Landscape` 读取 world bounds；
- 解码 `*.heightmap*.dvpl`；
- 还原 height samples；
- 计算 elevation / slope；
- 在世界坐标采样 terrain height。

### Replay / client coordinate contract

现有 map semantics 使用米制 `x/y/z` world coordinates，并已用 SC2 spawn/base Z 与 heightmap sampling 做交叉验证。`docs/reference/maps.md` 记录 client scene / replay / 2D basemap 使用同一 world frame。

后续 3D Playback 必须复用该 contract。

---

# 真实 Maps.zip Inventory（2026-09-04）

以下数字来自真实客户端 archive central directory，不是估计：

- archive bytes：`2,107,519,076`（约 1.96 GiB）；
- archive members：`4,316`；
- uncompressed member bytes：`2,291,239,572`（约 2.13 GiB）；
- 35 个 `NN_*` 目录，其中：
  - `00_global_content`：全局资源根；
  - `00_shared_content`：共享资源根；
  - 其余 33 个为 battle map 目录。

## 主要扩展名

| extension | count | uncompressed bytes | 当前解释 |
|---|---:|---:|---|
| `.dds.dvpl` | 3514 | 1,795,153,886 | texture payload |
| `.pvr.dvpl` | 338 | 181,466,714 | texture payload |
| `.anim.dvpl` | 116 | 6,581,483 | animation asset |
| `.sc2.dvpl` | 84 | 43,889,613 | DAVA SceneFileV2 |
| `.scg.dvpl` | 84 | 243,187,825 | SCPG model-data candidate |
| `.lka.dvpl` | 65 | 430,703 | TerrainDataComponent 引用的 engine-specific data；语义待解 |
| `.yaml.dvpl` | 40 | 4,831 | map effects config 等 |
| `.heightmap.dvpl` | 38 | 17,047,475 | terrain height source |
| `.mkm.dvpl` | 37 | 3,477,042 | TerrainDataComponent 引用的 engine-specific data；语义待解 |

texture payload 约 `1,976,620,600` bytes，占全部 uncompressed member bytes 约 **86.3%**。

结论：Production 3D 不能直接发布/加载原始客户端纹理集合。runtime asset 必须是 derived representation，并对纹理做删除、替代或强预算压缩。

---

# 第一张 Vertical Slice：05_amigosville_am

展示名：Falls Creek / 乡间溪流。

Inventory：

- 56 files；
- 31,425,796 uncompressed bytes；
- 1 main SC2；
- 1 heightmap；
- 47 texture candidates。

选择原因：主场景唯一、体积适中、有明显高低差和大型人工结构，且已经有 WotBTools 2D basemap / map semantics，可用于后续 replay coordinate overlay。

---

# First Scene Trace 结果

使用 `common/python/inspect_map_scene.py` 对 `05_amigosville_am` 主场景完成第一轮真实解析。

## Scene metadata

- SceneFileV2 version：`48`；
- declared nodes：`1775`；
- parsed scene bytes：`8,205,972`；
- entity count：`1775`。

## 关键 component 数量

| component | count | 当前意义 |
|---|---:|---|
| `TransformComponent` | 1775 | 每个 entity 的空间 transform |
| `RenderComponent` | 1216 | 大量 entity 有实际 render object |
| `CollisionTypeComponent` | 1056 | **碰撞分类/参与信息明确存在**；具体字段与 geometry 仍需下一轮展开 |
| `LodComponent` | 934 | static objects 有 LOD 结构 |
| `SpeedTreeComponent` | 435 | 植被单独处理 |
| `StaticOcclusionComponent` | 1 | 场景存在静态遮挡数据组件 |
| `StaticOcclusionDataComponent` | 1 | 场景存在静态遮挡数据组件 |
| `TerrainDataComponent` | 1 | 明确引用 `.mkm/.lka/map_effects` |

## Render-object 事实

第一轮 report 已直接观察到：

- `Landscape` render object；
- `MapBorderRenderObject`；
- 大量 `Mesh` render objects；
- `ro.batches` / `RenderBatch`；
- LOD / switch indexes。

因此 battle-map 主 SC2 本身已经不是“只有 object names + transforms”的轻量 scene descriptor；它包含真实 render graph / render batch / binary data-node 内容。

## Resource reference 事实

主 SC2 中检测到：

- `.tex` references：2717；
- `.sc2` references：1691；
- `.material` references：134；
- `.heightmap`：1；
- `.lka`：1；
- `.mkm`：1；
- `.yaml`：1。

对象名称包含 `WaterTank.sc2`、建筑、围墙、桥、车辆残骸、树木等；同时 data nodes 直接引用大量 global/shared texture/material。

注意：entity `name = *.sc2` 本身不等于运行时再次加载一个外部 SC2；必须看对应 render/data-node 内容和真实 archive dependency 才能判断资源是否已经被 flatten/embedded。

## TerrainDataComponent 引用链已确认

场景中同一个 `TerrainDataComponent` 明确引用：

```text
blitz/05_amigosville_am.mkm
blitz/05_amigosville_am.lka
blitz/map_effects.yaml
```

因此 `.mkm/.lka` 不再只是“同目录可疑文件”，而是 **terrain subsystem 的直接输入**。

但当前仍不能把它们标为 navmesh：

> Terrain-associated data != proven navigation/passability data.

下一版 inspector 会读取这两个 DVPL payload 的 header / printable strings / basic binary shape，继续判断其格式。

---

# Static Geometry：方向已改变

## SCG 不再是第一假设

第一版 inventory 的 `geometry=0` 是 filename heuristic 漏掉 `.scg`，不能解释为没有 geometry。

公开 WotB SCPG reverse-engineering 资料说明普通 WoT Blitz 模型可由 `.sc2 + .scg` 配对：

- https://github.com/Pyogenics/WOTBSCPGFormat

但第一张真实 battle-map scene trace 显示：地图主 SC2 自身已经包含大量 `Mesh` / `RenderBatch` / binary data-node 内容。

因此当前优先顺序调整为：

1. **先验证主 SC2 的 `PolygonGroup` data nodes 是否已经承载 static mesh vertex/index data**；
2. 如果某些 render batch 仍引用外部 model payload，再追 shared SC2/SCG；
3. 不再默认“地图建筑一定需要外部 SCG”。

## DAVA format cross-check

DAVA Engine 的 `PolygonGroup::Save()` 明确在 SceneFileV2 data node 中序列化：

```text
vertexFormat
vertexCount
indexCount
textureCoordCount
rhi_primitiveType
primitiveCount
vertices (byte array)
indexFormat
indices (byte array)
```

SceneFileV2 load path 也会对 `PolygonGroup` data node 做专门注册。

参考：

- `Scene3D/SceneFileV2.cpp`
- `Render/3D/PolygonGroup.cpp`

这与当前主 SC2 已观察到的大量 binary data nodes 相吻合。第一轮 report 共看到：

- binary fields：`20,234`；
- decoded binary bytes：`2,369,518`。

但第一版 inspector 没有按 `PolygonGroup` 聚合，所以尚不能从旧 report 直接给出 total vertices / indices。

`inspect_map_scene.py` schema v2 已补上该能力。

---

# Collision 当前结论

第一轮主场景有：

```text
CollisionTypeComponent = 1056
```

因此可以确认：

> **Collision participation/classification metadata exists in the map SC2.**

但还不能确认：

- collision shape 是否直接复用 render PolygonGroup；
- 是否有单独 collision geometry；
- CollisionTypeComponent 的字段和值如何解释；
- `invisiblewall.sc2` 等 entity 是否承担部分 blocking geometry。

状态：

> **COLLISION CLASSIFICATION PROVEN / COLLISION GEOMETRY NOT YET PROVEN**

schema v2 inspector 会展开 `CollisionTypeComponent` 的真实 keys/value samples。

---

# Navigation / Passability 当前结论

没有发现显式命名为 `navmesh/navigation/waypoint/pathfinding/passability` 的 archive 文件。

现在新增的强证据是 `.mkm/.lka` 被 `TerrainDataComponent` 明确引用。

因此状态从“完全未知文件”提升为：

> **TERRAIN-ASSOCIATED ENGINE DATA — NAVIGATION ROLE NOT PROVEN**

下一轮直接检查真实 `.mkm/.lka` 解压后 header / bytes / strings，再决定是否继续 reverse engineering。

---

# Inspector schema v2

`common/python/inspect_map_scene.py` 已升级，下一次运行除了原 report 外，还会输出：

- `componentKeyCountsByType`；
- `CollisionTypeComponent` / `TerrainDataComponent` / static-occlusion component samples；
- render-object class counts；
- render-batch key/value-type evidence；
- `#dataNodes` class/key counts；
- `PolygonGroup` count；
- total vertex / index / primitive counts；
- `vertexFormat` / `indexFormat` / primitive-type distributions；
- total vertex / index payload bytes；
- PolygonGroup sample byte prefixes；
- `.mkm/.lka` DVPL decoded size、header、uint32 head、ASCII string samples。

运行：

```powershell
python common/python/inspect_map_scene.py "<Maps.zip>" 05_amigosville_am
```

默认输出：

```text
tmp/map-research/05_amigosville_am-scene-inspection.json
```

这次 report 是决定 PR1 是否能直接进入 mesh decoder 的关键证据。

---

# 下一步研究顺序

1. [x] 真实 `Maps.zip` inventory。
2. [x] map count / extensions / shared structure。
3. [x] vertical slice 选择：`05_amigosville_am`。
4. [x] 第一轮主 SC2 scene/reference trace。
5. [x] 确认 `CollisionTypeComponent` 广泛存在。
6. [x] 确认 `.mkm/.lka` 由 `TerrainDataComponent` 直接引用。
7. [ ] 运行 schema v2 inspector，确认 PolygonGroup vertex/index payload。
8. [ ] 展开 CollisionTypeComponent keys / values。
9. [ ] 检查 `.mkm/.lka` binary header / content shape。
10. [ ] 若 PolygonGroup 成立，完成 vertexFormat decode proof-of-concept。
11. [ ] 只在实际 dependency 需要时追 shared SC2/SCG。
12. [ ] 生成 terrain + static mesh vertical-slice derived asset。
13. [ ] 明确 PR2 browser/runtime conversion input。

---

# PR1 Definition of Done

- [x] 真实 `Maps.zip` inventory 已核验；
- [x] 地图数量、主要 extension、per-map/shared 结构已记录；
- [x] terrain source 与现有 heightmap parser 对上；
- [x] 第一张地图完成第一轮 scene/resource trace；
- [x] 第一张 3D vertical-slice 地图已选定；
- [ ] static geometry representation 最终确认；
- [ ] collision geometry/state representation 最终确认；
- [ ] navigation/passability representation 状态最终确认；
- [ ] PolygonGroup vertex/index decode PoC；
- [ ] PR2 的真实转换输入与复用边界明确。

## 非目标

PR1 不做：

- frontend 3D renderer；
- 2D/3D toggle；
- 全地图批量转换；
- 完整坦克模型；
- 原客户端纹理复刻；
- AI LOS/pathfinding；
- 把未解码 binary 的猜测写成事实。
