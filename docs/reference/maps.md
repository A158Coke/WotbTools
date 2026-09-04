# 地图目录（Map Catalog）

> 地图鸟瞰功能的地图映射存档：**内部 code ↔ 展示名 ↔ 语义 mapId ↔ 素材**。
> 数据来源：`common/map_names.json`（展示名 zh/en/ru，取自游戏客户端）、
> `common/map-semantics/*.semantic.json`（语义 mapId）、`frontend/src/data/mapImages.js`（素材，唯一权威）。

## 主表

| 内部 code（meta.json mapName） | 中文名 | 英文名 | 语义 mapId | 素材（WxH） | 状态 |
|---|---|---|---|---|---|
| amigosville | 乡间溪流 | Falls Creek | 05_amigosville_am | falls-creek.webp (2024x2024) | ✅ 有素材 |
| canal | 运河尽头 | Canal | 18_canal_cn | canal.webp (2024x2024) | ✅ 有素材 |
| canyon | 夺命峡谷 | Canyon | 25_canyon_ca | canyon.webp (2024x2024) | ✅ 有素材 |
| desert_train | 黄沙荒漠 | Desert Sands | 02_desert_train_dt | desert-sands.webp (2024x2024) | ✅ 有素材 |
| erlenberg | 米德尔堡 | Middleburg | 03_erlenberg_er | middleburg.webp (2024x2024) | ✅ 有素材 |
| faust | 浮士德 | Faust | 32_faust_fa_night | faust.webp (2024x2024) | ✅ 有素材 |
| forgecity | 都市港口 | New Bay | 34_forgecity_fc | new-bay.webp (2024x2024) | ✅ 有素材 |
| fort | 绝望堡垒 | Fort Despair | 07_fort_ft | fort-despair.webp (2024x2024) | ✅ 有素材 |
| himmelsdorf | 锡默尔斯多夫 | Himmelsdorf | 19_himmelsdorf_hm | himmelsdorf.webp (2024x2024) | ✅ 有素材 |
| holland | 莫伦迪克 | Molendijk | 16_holland_hl | molendijk.webp (2024x2024) | ✅ 有素材 |
| holmeisk | 废弃之地 | Wasteland | 26_holmeisk_hk | wasteland.webp (2024x2024) | ✅ 有素材 |
| idle | 峪崆 | Yukon | 08_idle_id | yukon.webp (2024x2024) | ✅ 有素材 |
| italy | 葡萄庄园 | Vineyards | 22_italy_it | vineyards.webp (2024x2024) | ✅ 有素材 |
| karelia | 乱石荒野 | Rockfield | 17_karelia_ka | rockfield.webp (2024x2024) | ✅ 有素材 |
| karieri | 铜矿采集场 | Copperfield | 23_karieri_kr | copperfield.webp (2024x2024) | ✅ 有素材 |
| lagoon | 海岸礁湖 | Lagoon | 15_lagoon_ln | lagoon.webp (2024x2024) | ✅ 有素材 |
| lumber | 山麓角逐 | Horrorstadt | 31_lumber_lm | horrorstadt.webp (2024x2024) | ✅ 有素材 |
| malinovka | 马利诺夫卡 | Winter Malinovka | 12_malinovka_ma | winter-malinovka.webp (2024x2024) | ✅ 有素材 |
| medvedkovo | 废弃轨道 | Dead Rail | 04_medvedkovo_md | dead-rail.webp (2024x2024) | ✅ 有素材 |
| milbase | 落日军港 | Yamato Harbor | 24_milibase_mlb | yamato-harbor.webp (2024x2024) | ✅ 有素材 |
| mountain | 暗金矿窑 | Black Goldville | 21_mountain_mnt | black-goldville.webp (2024x2024) | ✅ 有素材 |
| neptune | 滩涂阵地 | Normandy | 33_neptune_nt | normandy.webp (2024x2024) | ✅ 有素材 |
| plant | 幽灵工厂 | Ghost Factory | 11_plant_pn | ghost-factory.webp (2024x2024) | ✅ 有素材 |
| pliego | 卡斯提拉 | Castilla | 13_pliego_pl | castilla.webp (2024x2024) | ✅ 有素材 |
| port | 港湾小镇 | Port Bay | 14_port_pt | port-bay.webp (2024x2024) | ✅ 有素材 |
| rift | 海拉斯 | Hellas | 35_rift_rt | hellas.webp (2024x2024) | ✅ 有素材 |
| rock | 古老秘境 | Mayan Ruins | 28_rock_rc | mayan-ruins.webp (2024x2024) | ✅ 有素材 |
| savanna | 沙漠之心 | Oasis Palms | 09_savanna_sv | oasis-palms.webp (2024x2024) | ✅ 有素材 |
| skit | 海防前沿 | Naval Frontier | 29_skit_sk | naval-frontier.webp (2024x2024) | ✅ 有素材 |

## 命名与维护约定

- **内部 code**（meta.json 的 `mapName`，如 `neptune`/`erlenberg`/`rock`）是**不可变键**：由游戏客户端回放元数据发出，语义文件 `mapCodes`、`mapImages.js` 的 key 都以它为准。**不要改名**，否则真实回放解析会失配。
- **展示名**（zh/en/ru）来自 `common/map_names.json`（游戏客户端名称）。注意内部 code 与英文名常不一致（如 `neptune`=Normandy、`erlenberg`=Middleburg、`rock`=Mayan Ruins），这是正常的，两套分别对应"解析键"与"用户可见名"。
- **素材文件名**：统一为**英文展示名小写中划线**（如 Normandy → `normandy.webp`，Middleburg → `middleburg.webp`，Winter Malinovka → `winter-malinovka.webp`）。文件位于 `frontend/src/assets/maps/`。
- **唯一权威**：素材与尺寸只在 `frontend/src/data/mapImages.js` 维护（后端 `MapOverview.image` 恒 null）。新增/修改素材只需改这一处 + 本表。
- **渲染坐标边界**：每条素材配置 `coordinateBounds`（图片对应的世界坐标范围，取自语义 JSON 的
  `coordinateSystem.worldBounds`；当前 28 张均为 -300..300）。渲染统一用它换算像素，
  分析网格仍用 `playableBounds`——两者分离，逐图可独立校准。
- **语义数据手工调整**：`common/map-semantics/*.semantic.json` 的区域 label/特征/风险等人类可读字段为中文，可直接手工修改；**改后不要重跑 map-semanticizer**（重新生成会整份覆盖），直到语义化器引入人工覆写合并。

## 新增地图 / 素材流程

1. 素材图片按英文展示名小写中划线放入 `frontend/src/assets/maps/`（如 `wasteland.webp`）。
2. 在 `frontend/src/data/mapImages.js` 加一行：`import xxxImg from '../assets/maps/xxx.webp'` + `code: { src: xxxImg, width, height, coordinateBounds }`（key 为内部 code；`coordinateBounds` 取该图语义 JSON 的 `coordinateSystem.worldBounds`）。
3. 更新本表对应行（素材文件/尺寸/状态）。
4. 后端无需改动；前端 `vite build` 会自动打包素材。CI 绿后合并部署即生效。

## 待补素材

- `holmeisk`（Wasteland / 废弃之地）——尚无素材，收到图片后按上述流程补。

## 基地（占领点）几何

`frontend/src/data/mapBases.js` 是**生成文件**，来源为客户端地图场景 `Maps/<mapId>/<mapId>.sc2`。
底图为纯环境层（不含烘焙的基地图形），基地由前端按这份坐标绘制。

| 场景实体 | 对应模式 | 每图数量 | 说明 |
|---|---|---|---|
| `strategicpoint` | 争霸赛 | 3–4 | `baseID` 0..3 与后端 `SupremacyBaseId.fromProtocolIndex()` 及 wire 字段 `baseStates[].baseId` 同源，直接 join，无需推断 |
| `controlpoint` | 攻防战 / 遭遇战 | 1（按模式配置可能多份） | `team` 为守方；半径大于争霸基地。**当前已抽取但未渲染** |

半径由场景 `radius` 声明（争霸基地 93 个里 92 个为 15 m）。坐标是世界米，与回放坐标、
`mapImages.js` 的 `coordinateBounds` 同一坐标系，可直接落到底图上。

### 客户端更新后如何重新生成

```
python common/python/extract_map_bases.py <Maps.zip 或解包后的 Maps 目录>
python common/python/extract_map_bases.py <同上> --check   # CI：过期即失败
```

解析器在 `common/python/wotb_sc2.py`（DAVA SceneFileV2 + DVPL，纯标准库），
自外部 map-semanticizer 工具移植而来——即生成 `common/map-semantics/*.semantic.json` 的那个工具。

### 已知限制

- `controlpoint` 每图有 1–5 个（如 `milbase` 5 个），是同一基地的不同模式配置；
  场景实体不带 variant 标签（`entity_labels` 为空），**无法自动判定哪个属于哪个模式**。
  需要渲染攻防战基地时必须先解决这个归属问题。
- `botspawn` 实体全部为 `performanceTestBot: true`（性能测试假车），不是战斗数据，未抽取。

