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
  `coordinateSystem.worldBounds`；当前 29 张均为 -300..300）。渲染统一用它换算像素，
  分析网格仍用 `playableBounds`——两者分离，逐图可独立校准。
- **语义数据手工调整**：`common/map-semantics/*.semantic.json` 的区域 label/特征/风险等人类可读字段为中文，可直接手工修改；**改后不要重跑 map-semanticizer**（重新生成会整份覆盖），直到语义化器引入人工覆写合并。

## 新增地图 / 素材流程

1. 素材图片按英文展示名小写中划线放入 `frontend/src/assets/maps/`（如 `wasteland.webp`）。
2. 在 `frontend/src/data/mapImages.js` 加一行：`import xxxImg from '../assets/maps/xxx.webp'` + `code: { src: xxxImg, width, height, coordinateBounds }`（key 为内部 code；`coordinateBounds` 取该图语义 JSON 的 `coordinateSystem.worldBounds`）。
3. 更新本表对应行（素材文件/尺寸/状态）。
4. 后端无需改动；前端 `vite build` 会自动打包素材。CI 绿后合并部署即生效。

## 基地（占领点）几何

`frontend/src/data/mapBases.js` 是**生成文件**，来源为客户端地图场景 `Maps/<mapId>/<mapId>.sc2`。
底图为纯环境层（不含烘焙的基地图形），基地由前端按这份坐标绘制。

| 场景实体 | 对应模式 | 每图数量 | 说明 |
|---|---|---|---|
| `strategicpoint` | 争霸赛 | 3–4 | `baseID` 0..3 与后端 `SupremacyBaseId.fromProtocolIndex()` 及 wire 字段 `baseStates[].baseId` 同源，直接 join，无需推断 |
| `controlpoint` | 攻防战 / 遭遇战 | active variant 通常 1 个 | `team` 仅保留 raw scene metadata，攻/守语义未闭合；半径可能缺失。Battle Playback 已可按 runtime `baseId=BASE` 渲染单基地 |

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

- 全局基地生成器保留原有抽取行为；本 PR 不对全部地图施加未经真实 Maps corpus 验证的 variant 筛选。
  `mapBases.js` 保留 base branch 生成产物，旧注释中的“守方”不构成已证明语义；以本节 raw metadata 边界为准。
- 2D Assault 以 `assaultObjectivePresent`（wrapper8 目标族发出裸初始化对以外的字段）确认 objective 存在；
  按 `mapCode` 查找 verified `common/map-semantics/*.semantic.json`，使用唯一 EXACT_SCENE_DATA
  controlpoint 的 X/Y。无地图特例；Neptune 与 Malinovka 共用此路径。Docker 在 Vite build 前复制该目录。
  静态几何 LEFT JOIN runtime `baseStates`；无 field3、无 BASE transition 时仍画圈，但不画占领水位。
  semantic entry 未提供 radius 时沿用 presentation fallback；静态 team metadata 不解释为动态阵营。
- `controlpoint.team` 的攻/守含义未闭合：11.20 Neptune controlled Assault 样本中该值为 1，
  同时 team 1 是用户确认的进攻/占领方，因此不得再把它写死解释为“守方”。
- 部分 `controlpoint` 没有 `radius`。Playback 当前仅在 presentation 层使用 20m fallback；
  该 fallback 不是协议或客户端资源事实。
- `botspawn` 实体全部为 `performanceTestBot: true`（性能测试假车），不是战斗数据，未抽取。

## 2D Local / 3D Remote 资产边界

- 2D 地图鸟瞰与战局回放直接消费 `frontend/src/assets/maps/*.webp` 的游戏客户端原图，由 `mapImages.js` 静态 import 随前端镜像发布；不依赖远端资产源。
- 原图实际 raster 尺寸与本表一致（当前 29 张均为 2024×2024）。`mapImages.width/height` 是既有 logical frame 尺寸，与 raster 尺寸分开维护；更新图片不得改变地图坐标、车辆、基地与标注对齐。
- `frontend/src/data/mapAssets.test.js` 校验注册表与本地原图的一一对应及实际 WebP 尺寸；真实浏览器布局回归覆盖底图加载与 overlay 对齐。
- 3D 模型、纹理与地图资产继续由 `frontend/src/scene/assetProvider.js` 从已配置的 remote asset origin（生产 COS）读取；2D 原图不进入该 provider。
- 原始客户端地图是唯一 2D 来源，不维护 AI 增强副本、生成 manifest 或增强 QA 工具。
