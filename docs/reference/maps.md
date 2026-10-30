# 地图目录（Map Catalog）

> 地图鸟瞰功能的地图映射存档：**内部 code ↔ 展示名 ↔ 语义 mapId ↔ 素材**。
> 数据来源：`common/map_names.json`（展示名 zh/en/ru，取自游戏客户端）、
> `common/map-semantics/*.semantic.json`（语义 mapId）、`frontend/src/data/mapImages.js`（素材，唯一权威）。

## 主表

| 内部 code（meta.json mapName） | 中文名 | 英文名 | 语义 mapId | 素材（WxH） | 状态 |
|---|---|---|---|---|---|
| amigosville | 乡间溪流 | Falls Creek | 05_amigosville_am | falls-creek.webp (1254x1254) | ✅ 有素材 |
| canal | 运河尽头 | Canal | 18_canal_cn | canal.webp (1254x1254) | ✅ 有素材 |
| canyon | 夺命峡谷 | Canyon | 25_canyon_ca | canyon.webp (1254x1254) | ✅ 有素材 |
| desert_train | 黄沙荒漠 | Desert Sands | 02_desert_train_dt | desert-sands.webp (1254x1254) | ✅ 有素材 |
| erlenberg | 米德尔堡 | Middleburg | 03_erlenberg_er | middleburg.webp (1254x1254) | ✅ 有素材 |
| faust | 浮士德 | Faust | 32_faust_fa_night | faust.webp (1254x1254) | ✅ 有素材 |
| forgecity | 都市港口 | New Bay | 34_forgecity_fc | new-bay.webp (1254x1254) | ✅ 有素材 |
| fort | 绝望堡垒 | Fort Despair | 07_fort_ft | fort-despair.webp (1254x1254) | ✅ 有素材 |
| himmelsdorf | 锡默尔斯多夫 | Himmelsdorf | 19_himmelsdorf_hm | himmelsdorf.webp (1254x1254) | ✅ 有素材 |
| holland | 莫伦迪克 | Molendijk | 16_holland_hl | molendijk.webp (1254x1254) | ✅ 有素材 |
| holmeisk | 废弃之地 | Wasteland | 26_holmeisk_hk | wasteland.webp (1254x1254) | ✅ 有素材 |
| idle | 峪崆 | Yukon | 08_idle_id | yukon.webp (1254x1254) | ✅ 有素材 |
| italy | 葡萄庄园 | Vineyards | 22_italy_it | vineyards.webp (1254x1254) | ✅ 有素材 |
| karelia | 乱石荒野 | Rockfield | 17_karelia_ka | rockfield.webp (1254x1254) | ✅ 有素材 |
| karieri | 铜矿采集场 | Copperfield | 23_karieri_kr | copperfield.webp (1254x1254) | ✅ 有素材 |
| lagoon | 海岸礁湖 | Lagoon | 15_lagoon_ln | lagoon.webp (1254x1254) | ✅ 有素材 |
| lumber | 山麓角逐 | Horrorstadt | 31_lumber_lm | horrorstadt.webp (1254x1254) | ✅ 有素材 |
| malinovka | 马利诺夫卡 | Winter Malinovka | 12_malinovka_ma | winter-malinovka.webp (1254x1254) | ✅ 有素材 |
| medvedkovo | 废弃轨道 | Dead Rail | 04_medvedkovo_md | dead-rail.webp (1254x1254) | ✅ 有素材 |
| milbase | 落日军港 | Yamato Harbor | 24_milibase_mlb | yamato-harbor.webp (1254x1254) | ✅ 有素材 |
| mountain | 暗金矿窑 | Black Goldville | 21_mountain_mnt | black-goldville.webp (1254x1254) | ✅ 有素材 |
| neptune | 滩涂阵地 | Normandy | 33_neptune_nt | normandy.webp (1254x1254) | ✅ 有素材 |
| plant | 幽灵工厂 | Ghost Factory | 11_plant_pn | ghost-factory.webp (1254x1254) | ✅ 有素材 |
| pliego | 卡斯提拉 | Castilla | 13_pliego_pl | castilla.webp (1254x1254) | ✅ 有素材 |
| port | 港湾小镇 | Port Bay | 14_port_pt | port-bay.webp (1254x1254) | ✅ 有素材 |
| rift | 海拉斯 | Hellas | 35_rift_rt | hellas.webp (1254x1254) | ✅ 有素材 |
| rock | 古老秘境 | Mayan Ruins | 28_rock_rc | mayan-ruins.webp (1254x1254) | ✅ 有素材 |
| savanna | 沙漠之心 | Oasis Palms | 09_savanna_sv | oasis-palms.webp (1254x1254) | ✅ 有素材 |
| skit | 海防前沿 | Naval Frontier | 29_skit_sk | naval-frontier.webp (1254x1254) | ✅ 有素材 |

## 命名与维护约定

- **内部 code**（meta.json 的 `mapName`，如 `neptune`/`erlenberg`/`rock`）是**不可变键**：由游戏客户端回放元数据发出，语义文件 `mapCodes`、`mapImages.js` 的 key 都以它为准。**不要改名**，否则真实回放解析会失配。
- **展示名**（zh/en/ru）来自 `common/map_names.json`（游戏客户端名称）。注意内部 code 与英文名常不一致（如 `neptune`=Normandy、`erlenberg`=Middleburg、`rock`=Mayan Ruins），这是正常的，两套分别对应"解析键"与"用户可见名"。
- **素材文件名**：统一为**英文展示名小写中划线**（如 Normandy → `normandy.webp`，Middleburg → `middleburg.webp`，Winter Malinovka → `winter-malinovka.webp`）。文件位于 `frontend/src/assets/maps/`。
- **唯一权威**：素材引用、逻辑尺寸与坐标边界只在 `frontend/src/data/mapImages.js` 维护（后端 `MapOverview.image` 恒 null）。新增/修改素材只需改这一处 + 本表。
- **渲染坐标边界**：每条素材配置 `coordinateBounds`（图片对应的世界坐标范围，取自语义 JSON 的
  `coordinateSystem.worldBounds`；当前 29 张均为 -300..300）。渲染统一用它换算像素，
  分析网格仍用 `playableBounds`——两者分离，逐图可独立校准。
- **语义数据手工调整**：`common/map-semantics/*.semantic.json` 的区域 label/特征/风险等人类可读字段为中文，可直接手工修改；**改后不要重跑 map-semanticizer**（重新生成会整份覆盖），直到语义化器引入人工覆写合并。

## Collector 物理出生侧

`common/map-semantics/*.semantic.json` 的 `spawnSemantics.TEAM_1/TEAM_2.physicalSide` 是显式的已审校方向，值为 `NORTH/SOUTH/WEST/EAST`，两组必须互补。方向缺失的地图不参与 Collector；不得按编号、坐标符号或最长轴自动猜方向。

**TEAM 是客户端场景出生点分组，不是回放队伍编号。** 本机回放样本里，训练房类 mode 2 / 24 的回放 team n 都出生在场景第 n 组；mode 1 随机战中海防前沿、马利诺夫卡，mode 4 滩涂阵地、mode 8 废弃之地都出现 team 2 出生在场景第 1 组。两者没有固定对应，所以 `battlePoints[].team` 保持场景分组标签，不按单场回放翻转；物理出生侧只能由实际位置命中的场景组决定。

方向分类：北 / 东北 / 西北归 `NORTH`，南 / 东南 / 西南归 `SOUTH`；铜矿采集场（`23_karieri_kr`）为 `WEST/EAST`。管理端把 `NORTH/SOUTH` 显示为上方 / 下方，这只是展示语义，DB、API 与 Collector 始终保持原值。

33 份语义全部标注方向。方向依据是语义网格 `A is north/top; 1 is west/left` 与 exact scene 出生点的位置，2D 底图同样以 +y 为上、+x 为右。`35_rift_rt` 的场景组 1 为 `SOUTH`、组 2 为 `NORTH`，仓库 Random 夹具的录像者早期位置距北侧 `Spawn2-8` 约 0.937m；马利诺夫卡的非采集模式回放初始位置距场景 `SpawnTeam2_01` 不到 0.001 米，独立验证南侧映射。

`06_rudniki_rd`、`30_grossberg_sh`、`40_moon_mn`、`41_iceworld_ic` 没有 `mapCodes`，回放无法寻址，不计入 Collector 覆盖；有 mapCodes 的 29 份都可采集。覆盖测试逐图断言方向落在对应 exact 出生组上，新增语义地图时要重新审计并更新数量基线。

Collector 按 Agent `map_key` 匹配现有 `mapCodes`，不以数字 `map_id` 匹配文件名前缀。回放 `[x,y,z]` 的 `[x,z]` 对应语义平面 `[x,y]`；只接收 `0≤clock≤1s` 且距某个 `EXACT_SCENE_DATA` 出生点不超过 2m、仅命中一个物理侧的位置，再用 `author_team` 映射两支回放队伍。晚观测、超界、歧义、未知或缺元数据均整场跳过。1s/2m 是刻意保守的接收策略，不是全地图误差保证。

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
- 2D Assault 以 `assaultObjectivePresent`（wrapper8 目标族存在性：field2==1 且 field1∈{1,2} 出现即 true，
  与是否发生占领无关）确认 objective 存在；
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

- 2D 地图鸟瞰与战局回放直接消费 `frontend/src/assets/maps/*.webp`（WebP q90），由 `mapImages.js` 静态 import 随前端镜像发布；不依赖远端资产源。现役来源 = Agent 仓 asset_pack 的 `ground.webp` 派生（见下节）。
- 底图实际 raster 尺寸与本表一致（当前 29 张均为 1254×1254）。`mapImages.width/height` 是既有 logical frame 尺寸，与 raster 尺寸分开维护；更新图片不得改变地图坐标、车辆、基地与标注对齐。
- `frontend/src/data/mapAssets.test.js` 校验注册表与本地底图的一一对应及实际 WebP 尺寸；真实浏览器布局回归覆盖底图加载与 overlay 对齐。
- Web 的 3D 模型、纹理与地图资产由 `frontend/src/scene/assetProvider.js` 从 `https://assets.wotbtools.com` 读取；新 Android 版本通过 Native `AgentAssetProxy` 从相同 origin 读取，旧 APK 可继续使用编译时 COS origin。2D 底图不进入该 provider。
- canonical 目录只维护**一套** 2D 底图（来源见下节），**Web 与 APK 共用同一份字节**；
  对照材料与中间产物不进入运行时或前端镜像。

## 2026-10-16 底图来源更换：客户端原图 × AI 增强 → pack `ground.webp` 派生

- 29 张底图改由 Agent 仓 `release/asset_pack/map/<key>/ground.webp`（4096²，含俯视屋顶/树冠烘焙）
  经**冻结配方**派生：LANCZOS 1254² → 全局对比曲线 ×1.17（两端 24 级软肩）→ 饱和 ×0.9748 →
  逐通道软肩（无硬裁切）→ USM 1.0px/80%/thr2 → WebP q90 / method 6。工具 = Agent 仓
  `tools/export_2d_basemaps.py`（`--verify` 全量重算逐张比对；`--self-test` 锁曲线单调/不裁切/色相）；
  **全部 29 张同一套参数**（不做逐图统计决策，见 Agent 仓 AGENTS.md）。
- 取向与世界框由契约确定：`ground.webp` 顶行 = +Z_scene、左列 = +X_scene，与 2D 渲染契约
  （`utils/mapView.js` 的 `toX/toY` + `coordinateBounds`）在同一坐标系 ⇒ **无需翻转/裁剪**，
  本批未做任何几何校正。
- 总量 21.50 MiB（原 AI 增强批 18.28 MiB）；`mapImages.js` 的 logical width/height、code 与
  `coordinateBounds` 保持原值，只替换同名 WebP 文件，不新增资源服务或运行时切换。
- **Android 不再派生缩小副本**（2026-10-16 决定）：APK 随包字节 = canonical 原图（同一份 1254²，
  合计 21.5 MiB），Web 与 APK 像素完全一致；旧的 ≤1024²/q72 Pillow 派生链（及其不变量与 CI 步骤）
  已整体删除。`wotbVersion` 已按 Version-as-Code 递增（内嵌 bundle 内容变了）。
  见 [docs/android/architecture.md](../android/architecture.md) §2D 底图随包。
- 旧批（客户端原图 2024² × AI 增强）的来源说明与回退指向（git 提交 `51cf93de` / 离线 ZIP）**随本批作废**：
  底图现在可由 Agent 仓 pack 一条命令复现——`ground.webp` 重烘后重跑同一工具即可。
- 观感（锐度配方 B + 对比曲线 ×1.17）已经用户对照页验收；色阶宽度差是**逐图属性**，
  按仓规不做逐图配平，残余差距如实记录在 Agent 仓 `release/2d-basemaps-manifest.json` 同批材料中。

### COS 免发版通道（Android：包内兜底 + 在线校验）

Agent 仓同批产出（并随既有发布链上传）包内 `map2d/<code>.webp` + `map2d/index.json`
（**schemaVersion 2**：`generated`、`recipe`、逐图 `path/sha256/bytes/width/height` **＋几何契约
`worldBounds`/`orientation`**；2026-10-16 起）。App 侧实现单点 =
`frontend/src/data/map2dOverlay.js`，规则确定、无启发式：

1. 无包内清单（web / 旧包）⇒ 通道关闭（web 行为完全不变）；
2. 索引拉取失败且无有效 localStorage 副本 ⇒ 通道关闭；**候选（远端 / 持久化副本）取
   `generated` 最大者**——`AgentAssetProxy` 在上游失败时会返回陈旧磁盘缓存，remote 可能比
   本地副本更旧，此时必须用副本且**不回写**（否则会把见过的新版打回去、甚至 OTA 回退）；
3. `schemaVersion` 不支持 / 时间戳不可解析 ⇒ 通道关闭（fail closed）；
4. **`index.generated ≤ 包内 contentGeneratedAt` ⇒ 一律包内**——索引不比包内内容新时，
   包内那份就是较新的（或同一批），远端没有更新可拿；两侧时间戳都取自**产物内容**，
   无本地时钟参与；
5. 逐图 `sha256` 与包内一致 ⇒ 用包内（零流量）；不同 ⇒ 取远端。**远端字节必须 sha256 校验通过
   才启用**（`crypto.subtle` 不可用也视为不通过），任何失败都回落包内、不抛给渲染层。
6. **逐图几何契约必须与注册表一致**（2026-10-16 起）：索引条目须带 `worldBounds`（与
   `mapImages.js` 的 `coordinateBounds` 逐值相等）与 `orientation = top=+Z,left=+X`，像素为方形；
   任一不符 ⇒ 该图不换（`window.__wotbMap2d.maps[code]` 记 `source='rejected'`、`reason: geometry`），
   schemaVersion 1 的索引因缺这两项一律不换（通道状态 `schema`）。理由：2D 渲染把回放坐标按
   `coordinateBounds` 线性映射到整幅图，**栅格分辨率不参与映射**（底图与标记同框拉伸），所以
   sha256/尺寸全对仍可能"换了图但取景变了"（裁剪/补边/换框后尺寸可以不变），只有世界框能判出来；
   换图后还会**解码一次**核对 `naturalWidth/Height` 与索引声明一致。

- 传输与离线缓存**复用现有 `AgentAssetProxy`**（条件请求 + ETag 磁盘缓存 + 上游失败回落陈旧；
  本机制**不需要任何 Kotlin 改动**）；索引另在 localStorage 留副本，离线时仍能判定"远端有更新"。
- 包内清单由 `scripts/build-android-bundle.mjs` 构建期产出（`map2d-embedded.json`：
  code → {file, asset, sha256} 与 **`contentGeneratedAt`**）；web 构建没有该文件 ⇒ 通道自然关闭。
  该时间戳取自**底图内容自身**（与 29 张 webp 同批交接来的 `src/assets/maps/map2d-source.json`，
  由 Agent 仓导出时写下，与 COS 索引 `generated` 同源），**不是构建时间**：用 wall-clock 会把
  "内容其实更新"判成更旧（Android stage 晚于 COS 发布才构建时永久拒绝升级），也会让同一 commit
  重跑构建产出不同字节的 bundle（破坏 stage 可重跑性与 APK 不可变性）。构建脚本对缺失/非法
  的 `map2d-source.json` fail closed（契约测试同时断言构建脚本里没有 `new Date()`）。
- **交接件与字节的绑定（schemaVersion 2）**：`map2d-source.json` 除时间戳外还带
  `maps: {code: {file, sha256}}`（29 条）与 `mapsDigest`（排序后 `code<TAB>sha256` 的 sha256），
  即"这份元数据描述的正是哪 29 个字节"。消费侧**用本地真实字节重算并逐条比对、fail closed**：
  - 构建期（`buildMap2dEmbedded`）：与**随包** `assets/<名>-<哈希>.webp` 的 sha256 逐条比对，
    缺图/多图/文件名不符/哈希不符即构建失败（**不查 COS**——COS 允许独立前进，这里要证的是
    "元数据 == 随包图集"）；
  - CI 测试（`src/assets/maps.test.js`）：与仓库里的 `src/assets/maps/*.webp` 重算比对。
  缺了这条绑定，"换图但忘了重跑 Agent 仓导出并同步交接件"会让旧 `contentGeneratedAt` 配上新图，
  运行时据 COS 索引判断时可能把包内更新的图 OTA 降级（违反 never-downgrade）。
- 诊断：`window.__wotbMap2d`（Android 运行时与本地 dev）暴露通道状态与逐图来源
  （`embedded` / `pending` / `remote` / `rejected`）。消费点 = `BattlePlayback` / `MapOverview`
  的 `imageSrc` 计算属性与 `BattleMap3D` 贴图前的 `ensureMap2dImage`。
- 契约测试：`src/data/map2dOverlay.test.js`（25 例：不降级 / 哈希不符不启用 / 离线回落 /
  schema 与时间戳 fail-closed / **几何契约逐项判否（换框 / 取向 / 非方形 / 缺字段 / 无注册表）
  与解码尺寸不符回落** / 构建产物存在性）。**真机端到端**（确实换到新图、离线仍可用）
  属设备验收，由用户在真机确认。
- **随包底图的配准证据（2026-10-16 补）**：29 张逐个与 Agent 仓 `map/<key>/ground.webp`
  （±300 全幅渲染）做零位移比对——移位 (0,0)、取向 identity、尺度 1.000、相关 0.987–0.998，
  即每一张都是包内渲染的全幅等比降采样。分辨率变化因此**不改变**坐标语义；
  非方形 logical frame 只影响形状（底图与标记同框拉伸），不影响对齐。
