# 3D Battle Playback First — PR1 Client Map Research

## 状态

IMPLEMENTING / LOCAL MAPS.ZIP SCAN PENDING

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

## 当前实现

新增：

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

研究说明：

```text
docs/research/maps/3d-playback-client-map-research.md
```

## 下一执行步骤

在开发机真实运行：

```powershell
python common/python/inventory_maps_zip.py "<Maps.zip>"
```

然后：

1. 检查 `tmp/map-research/maps-inventory.json`；
2. 确认真实 map 数量与资源类型；
3. 从 candidate groups 选择一张地图；
4. `--extract-map <mapId>` 只抽取该地图；
5. 追 SC2 static object / resource references；
6. 验证 geometry / collision / navigation 实际格式；
7. 选定 PR2 vertical slice 地图和转换输入。

## PR1 Definition of Done

- [ ] 真实 Maps.zip inventory 完成；
- [ ] map count / extension / per-map/shared structure 已落档；
- [x] terrain + coordinate 基础能力已从现有代码确认；
- [ ] static geometry source / reference chain 已确认；
- [ ] collision representation 已确认；
- [ ] nav/passability representation 已确认；
- [ ] 至少一张地图 selective extraction 完成；
- [ ] 第一张 3D vertical-slice 地图已选定；
- [ ] PR2 的真实输入和复用边界明确。

## 非目标

- 不实现 3D renderer；
- 不选定 Three.js/Babylon.js；
- 不批量转换全部地图；
- 不提交完整 Maps.zip / raw client asset；
- 不开始 AI spatial analysis。
