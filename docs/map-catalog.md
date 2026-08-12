# 地图目录（Map Catalog）

> 地图鸟瞰功能的地图映射存档：**内部 code ↔ 展示名 ↔ 语义 mapId ↔ 素材**。
> 数据来源：`common/map_names.json`（展示名 zh/en/ru，取自游戏客户端）、
> `common/map-semantics/*.semantic.json`（语义 mapId）、`frontend/src/data/mapImages.js`（素材，唯一权威）。

## 主表

| 内部 code（meta.json mapName） | 中文名 | 英文名 | 语义 mapId | 素材（WxH） | 状态 |
|---|---|---|---|---|---|
| amigosville | 乡间溪流 | Falls Creek | 05_amigosville_am | falls-creek.png (768x765) | ✅ 有素材 |
| canal | 运河尽头 | Canal | 18_canal_cn | canal.png (778x772) | ✅ 有素材 |
| canyon | 夺命峡谷 | Canyon | 25_canyon_ca | canyon.png (769x768) | ✅ 有素材 |
| desert_train | 黄沙荒漠 | Desert Sands | 02_desert_train_dt | desert-sands.png (765x772) | ✅ 有素材 |
| erlenberg | 米德尔堡 | Middleburg | 03_erlenberg_er | middleburg.png (763x768) | ✅ 有素材 |
| faust | 浮士德 | Faust | 32_faust_fa_night | faust.png (769x763) | ✅ 有素材 |
| forgecity | 都市港口 | New Bay | 34_forgecity_fc | new-bay.png (768x780) | ✅ 有素材 |
| fort | 绝望堡垒 | Fort Despair | 07_fort_ft | fort-despair.png (766x772) | ✅ 有素材 |
| himmelsdorf | 锡默尔斯多夫 | Himmelsdorf | 19_himmelsdorf_hm | himmelsdorf.png (768x765) | ✅ 有素材 |
| holland | 莫伦迪克 | Molendijk | 16_holland_hl | molendijk.png (766x769) | ✅ 有素材 |
| holmeisk | 废弃之地 | Wasteland | 26_holmeisk_hk | — | ⏳ 缺素材 |
| idle | 峪崆 | Yukon | 08_idle_id | yukon.png (766x769) | ✅ 有素材 |
| italy | 葡萄庄园 | Vineyards | 22_italy_it | vineyards.png (772x772) | ✅ 有素材 |
| karelia | 乱石荒野 | Rockfield | 17_karelia_ka | rockfield.png (768x768) | ✅ 有素材 |
| karieri | 铜矿采集场 | Copperfield | 23_karieri_kr | copperfield.png (763x768) | ✅ 有素材 |
| lagoon | 海岸礁湖 | Lagoon | 15_lagoon_ln | lagoon.png (765x766) | ✅ 有素材 |
| lumber | 山麓角逐 | Horrorstadt | 31_lumber_lm | horrorstadt.png (771x772) | ✅ 有素材 |
| malinovka | 马利诺夫卡 | Winter Malinovka | 12_malinovka_ma | winter-malinovka.png (754x762) | ✅ 有素材 |
| medvedkovo | 废弃轨道 | Dead Rail | 04_medvedkovo_md | dead-rail.png (763x766) | ✅ 有素材 |
| milbase | 落日军港 | Yamato Harbor | 24_milibase_mlb | yamato-harbor.png (769x765) | ✅ 有素材 |
| mountain | 暗金矿窑 | Black Goldville | 21_mountain_mnt | black-goldville.png (771x772) | ✅ 有素材 |
| neptune | 滩涂阵地 | Normandy | 33_neptune_nt | normandy.png (778x769) | ✅ 有素材 |
| plant | 幽灵工厂 | Ghost Factory | 11_plant_pn | ghost-factory.png (766x771) | ✅ 有素材 |
| pliego | 卡斯提拉 | Castilla | 13_pliego_pl | castilla.png (783x777) | ✅ 有素材 |
| port | 港湾小镇 | Port Bay | 14_port_pt | port-bay.png (769x769) | ✅ 有素材 |
| rift | 海拉斯 | Hellas | 35_rift_rt | hellas.png (766x765) | ✅ 有素材 |
| rock | 古老秘境 | Mayan Ruins | 28_rock_rc | mayan-ruins.png (769x771) | ✅ 有素材 |
| savanna | 沙漠之心 | Oasis Palms | 09_savanna_sv | oasis-palms.png (762x766) | ✅ 有素材 |
| skit | 海防前沿 | Naval Frontier | 29_skit_sk | naval-frontier.png (762x771) | ✅ 有素材 |

## 命名与维护约定

- **内部 code**（meta.json 的 `mapName`，如 `neptune`/`erlenberg`/`rock`）是**不可变键**：由游戏客户端回放元数据发出，语义文件 `mapCodes`、`mapImages.js` 的 key 都以它为准。**不要改名**，否则真实回放解析会失配。
- **展示名**（zh/en/ru）来自 `common/map_names.json`（游戏客户端名称）。注意内部 code 与英文名常不一致（如 `neptune`=Normandy、`erlenberg`=Middleburg、`rock`=Mayan Ruins），这是正常的，两套分别对应"解析键"与"用户可见名"。
- **素材文件名**：统一为**英文展示名小写中划线**（如 Normandy → `normandy.png`，Middleburg → `middleburg.png`，Winter Malinovka → `winter-malinovka.png`）。文件位于 `frontend/src/assets/maps/`。
- **唯一权威**：素材与尺寸只在 `frontend/src/data/mapImages.js` 维护（后端 `MapOverview.image` 恒 null）。新增/修改素材只需改这一处 + 本表。
- **语义数据手工调整**：`common/map-semantics/*.semantic.json` 的区域 label/特征/风险等人类可读字段为中文，可直接手工修改；**改后不要重跑 map-semanticizer**（重新生成会整份覆盖），直到语义化器引入人工覆写合并。

## 新增地图 / 素材流程

1. 素材图片按英文展示名小写中划线放入 `frontend/src/assets/maps/`（如 `wasteland.png`）。
2. 在 `frontend/src/data/mapImages.js` 加一行：`import xxxImg from '../assets/maps/xxx.png'` + `code: { src: xxxImg, width, height }`（key 为内部 code）。
3. 更新本表对应行（素材文件/尺寸/状态）。
4. 后端无需改动；前端 `vite build` 会自动打包素材。CI 绿后合并部署即生效。

## 待补素材

- `holmeisk`（Wasteland / 废弃之地）——尚无素材，收到图片后按上述流程补。
