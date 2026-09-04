# 3D Battle Playback First — PR1 Client Map Research

## 状态

IMPLEMENTING / REAL INVENTORY COMPLETE / SCENE REFERENCE TRACE NEXT

## 目标

先完成 `maps.zip -> Map Geometry Core -> 3D Battle Playback` 路线中的 PR1：客户端地图资源研究。

本 PR 只回答客户端真实提供了哪些可用于 3D Playback 的地图数据，不进入 frontend renderer 实现。

## 已确认基础

1. `common/python/wotb_sc2.py` 已能解析 DVPL + DAVA SceneFileV2；禁止新建第二套 parser。
2. `map-semanticizer` 已能读取 Landscape world bounds 和 heightmap，并生成 elevation / slope。
3. SC2 spawn/base Z 与 heightmap sampling 已存在数值交叉验证。
4. `docs/reference/maps.md` 已记录 client scene / replay / 2D basemap 使用同一 world-coordinate contract。
5. `extract_map_bases.py` 已证明完整 `Maps.zip` 可以按 map id 直接读取主 SC2。

因此 PR1 的核心未知项已经收敛为：

- static 3D geometry；
- object/resource reference chain；
- collision representation；
- navigation/passability representation；
- derived runtime asset 的可转换边界。

## 真实 Maps.zip 已完成盘点

开发机输入：

```text
C:\Users\yu.chen\Downloads\Maps.zip
```

已确认：

- archive：2,107,519,076 bytes（约 1.96 GiB）；
- 4,316 files；
- uncompressed：2,291,239,572 bytes（约 2.13 GiB）；
- 35 个 `NN_*` 目录 = 33 battle maps + `00_global_content` + `00_shared_content`；
- `.sc2.dvpl` 84；
- `.scg.dvpl` 84；
- `.heightmap.dvpl` 38；
- `.mkm.dvpl` 37；
- `.lka.dvpl` 65；
- texture payload 约占 uncompressed archive 的 86.3%。

第一版 inventory 的 `geometry=0` 只是 heuristic 没识别 `.scg`，不能解释为客户端没有 geometry。
公开 WotB SCPG reverse-engineering 资料把 `.sc2 + .scg` 描述为模型配对；但 battle map 目录本身普遍没有 `.scg`，所以现在必须追主 SC2 的 shared/render resource chain，而不是继续按文件名猜。

## 当前实现

### Inventory

```text
common/python/inventory_maps_zip.py
```

能力：

- central-directory-only inventory，不全量解压多 GB archive；
- extension / bytes / per-map 统计；
- scene / heightmap / geometry / collision / navigation / material / texture candidate 分组；
- candidate 只代表 filename/path evidence，不冒充已解码事实；
- 支持只抽取一张地图到 `tmp/map-research/extracted/`；
- extraction 有 traversal 防护与默认 1 GiB 单图大小上限。

### SC2 scene reference inspection

```text
common/python/inspect_map_scene.py
```

能力：

- 直接从完整 `Maps.zip` 读取指定地图主 SC2；
- 复用 `wotb_sc2.py`；
- 输出 component type counts；
- 输出 `RenderComponent` / `rc.renderObj` key evidence；
- 收集 SC2 内实际 resource path/string references；
- 收集 binary field path/size samples；
- 不根据字符串引用直接宣布 geometry/collision/navigation 语义。

研究说明：

```text
docs/research/maps/3d-playback-client-map-research.md
```

## 第一张 Vertical Slice

固定优先研究：

```text
05_amigosville_am
```

原因：单主 SC2、单 heightmap、56 files / 31.4 MB，且地图有明显高低差与大型人工结构；适合同时验证 terrain、static-object reference 与 replay coordinate overlay。

## 下一执行步骤

在开发机运行：

```powershell
python common/python/inspect_map_scene.py "C:\Users\yu.chen\Downloads\Maps.zip" 05_amigosville_am
```

默认输出：

```text
tmp/map-research/05_amigosville_am-scene-inspection.json
```

然后：

1. 读取真实 SC2 render/resource references；
2. 只抽取引用到的 shared `.sc2/.scg` 或其他必要资源；
3. 验证 `.scg` parser/converter compatibility；
4. 检查 collision representation；
5. 检查 `.mkm/.lka` header/reference，确认或排除 navigation/passability 角色；
6. 形成 PR2 的真实 conversion input。

## PR1 Definition of Done

- [x] 真实 Maps.zip inventory 完成；
- [x] map count / extension / per-map/shared structure 已落档；
- [x] terrain + coordinate 基础能力已从现有代码确认；
- [ ] static geometry source / reference chain 已确认；
- [ ] collision representation 已确认；
- [ ] nav/passability representation 已确认；
- [ ] 至少一张地图 selective extraction / scene trace 完成；
- [x] 第一张 3D vertical-slice 地图已选定；
- [ ] PR2 的真实输入和复用边界明确。

## 非目标

- 不实现 3D renderer；
- 不选定 Three.js/Babylon.js；
- 不批量转换全部地图；
- 不提交完整 Maps.zip / raw client asset；
- 不开始 AI spatial analysis。
