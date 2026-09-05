# 地图鸟瞰与战局回放（Battle Playback）

> 用户可见契约：`ReplayPage` Workspace 的「战局回放」面板（`BattlePlaybackPanel.vue`）
> （热力 + 战局回放），**不依赖 AI 复盘**——不跑 AI 也能看图。
> 数据来源与素材权威见 `docs/reference/maps.md`（内部 code ↔ 展示名 ↔ 语义 mapId ↔ 素材）。
> 生产状态：回放 timeline 事实按 canonical 语义（AFFIRMED）；AoI hidden=UNKNOWN、禁止跨 AoI gap 插值、死亡 clamp 到权威死亡时刻。

## Battle Playback V2（canonical 稀疏投影）

HTTP wire shape 的唯一事实源是 `contracts/http/openapi.yaml`；前端 transport types 与 runtime
schema 从该文件生成。Java domain facts 通过显式 mapper 投影为 wire enum，旧 playback artifact
只在读取边界做兼容 normalization；新写入与 live response 不接受 legacy `DecodeConfidence` 值。

> 增加 V2 契约 `BattlePlaybackDataset`：`POST /api/replay/battle-playback-v2`
> （`Content-Type: application/json`，body `{ processingJobId, sourceId }`）→
> `MapOverviewQueryService.buildBattlePlaybackFromDataset` → `ReplayArtifactWriter.readBattlePlaybackV2`
> → 前端 `BattlePlayback.vue` 的 V2 检查器（`V2VehicleInspector`）。

### 前端职责边界

`BattlePlayback.vue` 是单一编排入口，负责时间、视图、选择与事件命令；展示层拆为
`BattlePlaybackHud.vue`（双方 HP、权威点数与权威基地状态）、`BattleMap.vue`
（SVG、坦克标记、炮线、标注及瞬时反馈）、`PlaybackControls.vue`（紧凑播放控制）、
`PlaybackTimeline.vue`（纯进度条）、`AnnotationToolbar.vue`（折叠式标注工具）、
`PlaybackSidePanel.vue`（Battle / Vehicle / Display / Events 面板）和
`VehicleDetailsPanel.vue`（当前车辆详情）。`PlaybackMobileOverlay.vue` 只管理移动端
controls 的显隐，不拥有 playback state。
`utils/playbackVehicleState.ts` 负责将 canonical V2 track 投影为 marker state，
`utils/playbackClock.ts` 提供播放时间/倍速纯函数。拆分不新增数据源、不改变 V2 query-at-time、
anti-future-leak 或现有 tank-marker 资产契约。

### 响应式展示契约

- Desktop（`>=1200px`）、Tablet（`768–1199px`）和 Mobile（`<768px`）共用同一套
  Universal Battle HUD：己方在左、权威比分/基地状态在中（无事实时不渲染占位符）、敌方在右；HP 的
  `FULL_RELATIVE`、`EXACT`、`PARTIAL`、`UNKNOWN` 语义保持不变。
- 地图是 workspace 的主视觉。Desktop / Tablet 的 controls 为紧凑流式布局，Mobile
  初始只保留地图和 HUD；轻触地图显示播放 controls，控制事件不会穿透到地图。
- Display、Events、Vehicle 与 Battle 内容通过侧面板按需显示；Events 只呈现
  `DAMAGE`、`KILL`、`DESTROYED`，点击事件执行 seek + pause，纯时间轴不承载事件标记。
- 标注工具默认折叠，绘图不暂停 battle clock。Fullscreen 继续保持同一组件实例的
  current time、playing、倍速、选中车辆、zoom/pan、annotations 和偏好；移动端只对
  `screen.orientation.lock('landscape')` 做 best-effort 尝试，失败不阻断播放。
- Fullscreen 几何 ownership 按 form 固定：Universal Battle HUD 在 PC / Tablet / Mobile 始终属于地图顶部，即使存在 `pb-side-slots` 也不会迁移到 gutter；side-slot 只允许复用 PC / Tablet 的非移动端 controls 空白侧边空间。camera fit 动态量取顶部 `.pb-hud` 的真实高度，并在 Mobile transient controls 可见时额外量取 `.pb-mobile-overlay-content` 作为 bottom safe inset；Mobile 本身不启用 side-slot optimization。`test:browser-layout` 用真实 Chrome 几何断言覆盖 fullscreen + side-slot / mobile bottom-overlay，禁止只靠 CSS 源码正则判断。
- `BattlePlaybackDataset.baseStates` 是 wrapper12（UpdateArena2 root field11）经后端 sparse
  reconstruction 投影的权威基地 transition；查询 UI 时间点时只消费 `timeSec <= currentTime` 的最新
  A/B/C/D 完整状态。前端不接触 raw protobuf update，不负责合并缺失字段或协议 index，也不合成
  进度或阵营结论。前端另以 canonical `positionSegments` 的 OBSERVED
  samples 派生最近 2 秒轨迹：不跨 segment/AoI gap，不使用 LAST_KNOWN，不读取未来样本，暂停
  冻结、seek 重算、倍速只改变时间推进语义。

测试也按同一责任边界组织：地图/标记/手势、控制、时间线和详情面板分别由对应 focused
suite 覆盖，时钟与车辆投影由纯函数 suite 覆盖；共享 replay fixture 位于 testing-only
`playbackTestHarness.js`。`BattlePlayback.test.js` 与 `BattlePlayback.integration.test.js`
只保留跨组件/domain 的编排回归，避免把已由 focused suite 覆盖的 presentation 断言重新堆回编排器测试。

- **数据源**：processing 阶段当 canonical `BattleTimeline` 可用时写出
  `battle-playback-v2.json`（`BattlePlaybackProjector.project` 纯投影）；timeline 不可用
  → 不写 artifact → 204（capability unavailable，非 parse failure）。
- **前端 V2-only**：`BattlePlaybackPanel` 拉取 V2 dataset 并注入 `playbackV2`；
  `BattlePlayback.vue` 的 marker / HP HUD / Details Panel / team HP / 事件 feed 全部直接消费
  canonical tracks（`healthDisplayAt` / `friendlyHealthAt` / `healthAt` / `lifeAt` /
  `positionAtV2` / `orientationAtV2`），不再经过 compatibility view 或回退
  `MapOverview.Playback`。
- **契约**：稀疏 transition tracks（`positionSegments` / `orientationSegments` /
  `healthTransitions` / `lifeTransitions` / `consumableTransitions` /
  `moduleCrewTransitions` / `loadout` / `damageLosses` + battle-level `events`(DAMAGE/KILL/DESTROYED/
  POSITION_REPORTED/POSITION_STALE) / `pointsSamples`），每条带
  `knowledge / provenance / observation boundary`。`damageLosses` 是伤害数值唯一来源；
  `BattleEvent.observedHpLoss` 仅用于单条 notification。`displayCapacityHp` 是 presentation-only
  （anti-future-leak），非 canonical max HP；loadout 离开 AoI 仍 KNOWN；consumable runtime
  在 hidden interval = UNKNOWN。

### 反未来信息泄漏（anti-future-leak，硬性 invariant）

> 在 UI 时间 `t`，任何展示出来的事实只能来自 `timeSec <= t` 的证据。这是 Battle Playback V2
> 的硬性不变式（canonical 解码器 / battle-start / BattleTimeline / BattlePlaybackProjector 不改，
> 只修 query-at-time 与 presentation 层）。

- `positionAtV2` / `orientationAtV2` 增加守卫：整个 segment `startSec > t` 对当前查询完全不可见；
  任何候选样本进入 `lastSeen` 前必须满足 `sample.timeSec <= t`；单样本段在 `t == 首样本时刻` 正确返回。
- 因此：`t` 之前从未观测的敌方 **不** 显示 marker / 位置；仅过去观测过则冻结 `last-known`（≤ t）；
  未来重新出现不得使用未来位置（Case A/B/C）。Inspector 的 `last_spotted` 时间恒 ≤ 当前回放时间。
- 后端 sparse artifact 允许包含整场时间序列（这是正常的）；前端 query-at-time 不允许跨 `t` 读取
  未来 transition（否则即为 future information leak）。

### 战斗装载本地化（loadout i18n）

- 后端 DTO 只返回稳定协议标识：`consumables`（logicalItemId，可 null）、`provisions`（可 null）、
  `equipmentIds`（numeric equipmentId）。前端 `src/data/loadoutItems.js` 把 logicalItemId /
  equipmentId 映射为三语名称（zh/en 取 `common/wotb-item-catalog-json/` authoritative 名称，ru 用官方
  游戏术语）；`V2VehicleInspector` 渲染本地化名称，**绝不**把 `MULTI_PURPOSE_RESTORATION_PACK` /
  `REPAIR_KIT` / `103` 当用户文案。
- 未知 / 未映射条目走三语「未知消耗品/补给/装备（id）」fallback，并保留 raw id 仅作诊断。

## 地图鸟瞰（Map Overview，Dataset-only）

战局回放面板读取同一 Processing Dataset 的 `map-overview.json` derived artifact：
`POST /api/replay/map-overview`（`Content-Type: application/json`，body `{ processingJobId, sourceId }`）
→ `MapOverviewQueryService.buildOverviewFromDataset` → `ReplayArtifactWriter.readMapOverview` →
前端 `MapOverview.vue` 纯 SVG 渲染热力辅助视图。后端 overview 中的 `routes` 聚合字段及其
采样合同继续保留，供后续能力与兼容消费者使用；本轮只移除用户可见的路线视图、筛选和图例。
- **不重新上传 replay、不单独 full-process**：AI Review / Battle Playback / Export 共用同一 Processing Dataset。
- 地图不可构建（未知地图/无语义网格/无名册/无观测/视角未解析）→ `mapOverview = null` → 204。
- `JOB_NOT_FOUND`（Processing Job / Dataset identity 已被 TTL 清理）→ 触发前端 Dataset recovery（exactly-once + generation-owned + authoritative invalidation）。
- map-overview artifact 缺失 = capability unavailable → 204（不是 `JOB_NOT_FOUND`，不触发 recovery）；artifact 读/解码/存储故障 → `DATASET_UNAVAILABLE`（503，不可恢复，不重新 full-process）。`SOURCE_NOT_READY` / `SOURCE_PROCESSING_FAILED` → 稳定错误码，经 i18n 本地化，不裸展示。
- 旧的 multipart `POST /api/replay/map-overview`（`MultipartFile[]`）已废弃为 legacy 410 compatibility shim（`ReplayLegacyEndpoints`），不是业务入口。

### 数据链路

- **数据源**：`MapGridRegistry`（core）从 `map-semantics/*.semantic.json` 读取
  `playableBoundsMeters` / `analysisGrid.cells`(6x6) / `sceneEvidence.battlePoints`（出生点）；
  `MapOverviewBuilder`（web）从 `Battle`（权威名册/阵亡时刻/地图名）+ `ReplayReconstruction`
  （type-10 位置流 / 伤害事件 / 实体→账号映射，经 `TeamEntityMapper`）聚合。
- **坐标约定**：分析坐标与 `playableBounds` 同系——`x` = 地图横向 = 回放 x，`y` = 地图纵向 =
  回放 z（同一原点同一米制）；`playableBounds` 用于 6×6 分析网格、热力分桶与可玩区域判断。
  图片渲染边界独立为 `coordinateBounds`（地图图片对应的世界坐标范围，见「图片素材与对齐约定」）：
  `px = (x - coordinateBounds.xMin)/(coordinateBounds.xMax - coordinateBounds.xMin) × W`、
  `py = (coordinateBounds.yMax - y)/(coordinateBounds.yMax - coordinateBounds.yMin) × H`。
  分析网格坐标仍来自 `playableBounds`，绘制时经同一变换换算，因此只覆盖可玩区、不铺满整图。
- **标题三语**：`MapOverview` 携带 `displayNames{zh,en,ru}`（来自 `common/map_names.json`，
  未收录时三语同 code）；前端按 vue-i18n 当前 locale 取标题，缺失回退 `displayName`（en）。
- **模式与录像者**：`MapOverview` 继续携带 `arenaBonusType`（meta.json 原值；1=随机战斗，其他=训练/联赛等，
  未知为 null）与 `recorderAccountId`（经 `Battle.recorderResult()` 解析，录像者昵称已在
  `ReplayParser.resolveRecorderNickname` 归一化为纯昵称；未解析为 null）。这些字段仍供 Battle Playback
  编排和事件事实使用；路线聚合仍按既有 wire contract 生成，但不再在 MapOverview 中提供用户视图。
- **自适应配色**：前端 `frontend/src/utils/mapPalette.js` 将底图降采样 64×64 后计算平均相对亮度
  （sRGB 线性化后按 0.2126/0.7152/0.0722 加权），阈值 0.45——低于视为暗图用亮色系、否则用深饱和色系；
  热力、网格/九宫格/出生点均随色板切换；canvas 不可用或计算失败时
  回退暗图默认色板。不做每图手工配色表。
- **布局与标注**：鸟瞰 SVG 宽度由 scoped CSS 控制——桌面/平板为容器宽度 66.7%（约 2/3）并居中，
  `max-width: 768px` 时恢复 100%（viewBox 不变、不裁切）；九宫格仅绘制分区框（region-line），
  不绘制数字标注（region-label）。
- **热力口径**：伤害热力按**受击方**位置落格（受击方阵营）；驻留/阵亡为事件计数；
  每层 36 个值按 `gridCells` 顺序，前端按 max 归一化。
- **路线聚合合同（非本轮 UI）**：双方 14 车，2s 均匀采样（间隔 = max(2s, duration/200，
  每车 ≤200 点），`firstObservedSec/lastObservedSec` 保留诚实观测区间，阵亡时刻由 canonical
  `lifeTransitions` 标注；连续点是否可插值由 position segment permission 决定，不以固定 packet gap
  作为 Battle Playback authority。本轮不删除这些后端字段或生成逻辑。
   - **战局回放（Battle Playback）**：`BattlePlaybackDataset` 是唯一 current
  playback 输入；每辆 `VehiclePlaybackTrack` 携带账号/昵称/坦克/阵营/`friendly` 以及
  `positionSegments`、`orientationSegments`、`healthTransitions`、`lifeTransitions`、
  loadout/runtime transitions。battle-level `events` 按 battle-relative 秒升序，稳定码为
  `DAMAGE`/`DESTROYED`/`KILL`/`POSITION_REPORTED`/`POSITION_STALE`；`DAMAGE` 只有
  `observedHpLoss` 非空时才可作为确定伤害。位置事件只表达服务器位置流覆盖变化，不是点亮。
  - **位置上报区间口径（2026-08-15 修复）**：`positionSegments` 是 backend 标注的 AoI/position boundary；
    EntityLeave(type-4) 只表示实体离开/停止存在，不代表阵亡，也不代表点亮/失察——每一次 leave 都是
    coverage 的 hard segment boundary：leave 强制关闭当前区间，leave 后第一条 position（无论 gap 大小）
    开启新区间；同一实体位置流中断后重新上报的新区间必须保留（此前 leave 被当作单点截断，
     重新上报的新 segment 必须保留，前端仅依据 canonical segment boundary 判断覆盖。
  - **方向契约（2026-08-13 门禁 B 破解）**：`orientationSegments`（时间升序，
    约 1s 降采样 + 方向变化 ≥10° 保点）：`hullYawDeg` 来自 type-10 yaw（弧度→度）；
    `turretRelativeYawDeg` 来自 type-7 propId=2（u16 LE：`raw*360/65536-180`，[-180,180)，
    完整 360° 且 ±180 回绕；旋转实验 + 开火锚点拟合证明，交叉验证残差 2.3°）；
    前端 `turretWorldYawDeg = normalize(hullYawDeg + turretRelativeYawDeg)`。
    仅保留 finite、≤当前查询时间的 canonical 样本；无可靠方向的车辆不伪造朝向。
    方向采样必须落在该车同一可信 position-interval 内，hull yaw 只从同区间位置配对——
    位置流中断期间不继续旋转炮塔、不跨 gap 取对侧 hull yaw，re-entry 后新段继续；
    每个可信方向段最后一个样本恒保留（冻结准确）。
    **时长契约**：playback `durationSec` 三优先级 = `battle.durationS`（finite>0）→
    `RoundFinishedEvent`（合法 battle-relative）→ 位置流最后时刻；全部 event/interval/
    所有 wire 时间字段由 producer 保证为 finite 且 `[0, durationSec]`。
  - **双层坦克标记**：前端 `BattlePlayback.vue` 用 PR #72 四张运行时 PNG
    （`frontend/src/assets/tank-icons/tank-marker-{friendly,enemy}-{hull,turret}.png`，512×512
    RGBA、共同 pivot 256,256）渲染 HTML overlay 标记；marker 尺寸由
    `utils/vehicleMarkerSizing.js` 集中计算：Tier X 优先使用模型 metadata 的真实 `hullBounds`，
    其它车辆按 replay/tankopedia vehicle class fallback，桌面/移动端分别 clamp 在约 18–30px /
    16–26px 的标记范围内。raster 使用等比 square renderBox（dedicated bake 的车体长边约占 88%，
    真实长宽比已由图片 geometry 编码），physical footprint 只单独用于 tank model collision，
    hit target 也独立于二者计算；不对 raster 做非等比 X/Y 拉伸。按钮不反缩放 → 坦克随地图同比缩放：
    hull/turret img 放大到按钮 **134%** 并以共同 pivot 居中旋转
    （`translate(-50%,-50%) rotate(...)`）——generic 素材透明留白实测有效车体 bbox
    ≈210×336/512（长边占 65.6%），dedicated hull.webp 车体按自身模型盒渲染；
    放大地图不再显小；hull 层按 `hullYawDeg` 旋转、turret 层按
    `turretWorldYawDeg` 旋转（炮管不脱离炮塔）；**阵营视觉**：整车 team outline+glow
    由 `VehicleMarker .pb-graphics` 双层 drop-shadow 表达（CSS vars `--pb-team-*/`--pb-enemy-*`，
    friendly 按地图显式 tone green|blue、enemy 固定 red，见 `data/mapTeamColors.js`；generic 素材
    自身阵营色保留，叠加同一 team 光晕）；Selected 红色倒三角（label 上方、浮动、screen-space 恒定——
    元素尺寸按 overlayInverse（=1/view.scale）反缩放；bottom 按推导式 X = 4.5 + 14.5×inv px
    使三角底边跟随 name 顶边，selected→name 屏幕 gap 恒 3px（1× 即 19px 车辆契约；name 自身
    anchor 按既有语义随 zoom 上移）；浮动幅度 2px × var(--pb-overlay-inv) 恒 ≈2px；
    阵亡车为克制变体——缩小 + 淡化，destroyed 为主状态）、
    Recorder 空心菱形（tank 下方、friendly 色、offset 按 5×inv 反缩放 → 屏幕间距恒 5px）、
    最后已知淡化、阵亡 ✕（覆盖车体中心、明显放大 30px、screen-space 恒定）均为独立 overlay，不烘焙进 PNG；
    标记**上方**常显固定字号坦克型号名小标签
    （`PlaybackVehicle.tankName`，后端 `ReplayDisplayNames.tankName(tankId, tankName)` 权威解析自
    tankopedia，如 29985 → "SPHT"，不再是空串/纯数字；标签自身按 `1/view.scale` 反缩放 → 字号不随地图缩放、任意缩放下可见）。
   - **玩家/坦克名标签与碰撞**：控制栏「显示玩家名 / 显示坦克名」checkbox
    （默认 玩家名关 / 坦克名开，`localStorage` 持久化 `wotb.pb.label-prefs`）；PlayerName + TankName
    共用一个半透明深色背景块（自适应宽度、team 文字色 `--pb-team-text`/`--pb-enemy-text`、
    destroyed/last-known 只弱化文字）；PlayerName 按实际像素截断（max-width+ellipsis），截断才有
    完整名 tooltip；碰撞纯函数 `utils/labelLayout.js`（screen px，仅 tank model box 参与，离开 viewport 时自然裁剪）——
    TankName 冲突**从下往上** greedy 上移让位（下方先 finalized、上限一行，3+ 连锁不重新产生
    overlap）、PlayerName 冲突经时间阈值（hide 250ms / show 300ms，`performance.now` **UI wall
    clock**——播放由 frame 刷新、暂停由轻量 RAF 继续推进，不依赖播放状态）隐藏/恢复（~120ms
    opacity fade-in，类保持完整生命周期不被下一次 resolve 取消）；PlayerName 盒从 final TankName
    盒推导（与共享 label 块整体位移一致）；zoom 结束由 computed
    依赖 view.scale 自然重算；点击命中使用随 vehicle-aware marker 与 presentation offset 移动的
    小幅扩展 hit target（不参与视觉碰撞，不含 gun overflow/label/三角/菱形/✕；destroyed/last-known 仍可点），重叠时
    取指针最近车辆、距离几乎一致且已选中则保持、否则 render order tie-break；倍速含 0.5×；
    `loop` prop（QA 场景循环）。Tank model collision 仅作用于 model box，使用 desktop 约 10px /
     mobile 约 8px 的 soft bounded avoidance，以 overlap cost + minimal displacement + previous
     layout stability 为目标；预算耗尽时接受 residual overlap，不改变 canonical position。
   - **全屏模式（原生 Fullscreen API）**：控制栏「⛶ 全屏 / 退出全屏」（i18n 三语 `enter_fullscreen`/`exit_fullscreen`）；
    全屏对象 = `.battle-playback` 根容器（地图 + 全部 controls + 标注 + 信息面板，不含页面 header/nav）；
    状态事实源 = `document.fullscreenElement` + `fullscreenchange`（ESC/浏览器 UI 退出立即同步，
    禁止手工 isFullscreen=!isFullscreen）；`typeof root.requestFullscreen !== 'function'` → 按钮隐藏、
    点击不抛错（不实现 fake fullscreen）；进入/退出不 reset currentTime / playing / speed /
    selectedAccountId / zoom / pan / filters / label 偏好 / annotations（同一组件实例，仅容器变化）。
    尺寸响应：`mapSize` reactive（`mapSize = ref({w,h})`）由 `ResizeObserver` 观察 `.pb-map` 更新，
    无 RO 环境回退 `clientWidth`（`mapWidth()/mapHeight()`）；markerScreen / labelLayout（viewportW/H）/
    selectAt（hitTest 像素→内容坐标）/ textInputStyle / semanticPoint 全部经 mapWidth/mapHeight 读取
    → fullscreen enter/exit 后 collision / hitbox / 标注换算立即用新尺寸重算（禁止 magic delay）；
    zoom/pan 不自动 reset（无 auto-fit；Reset View 由用户使用）。全屏 `.battle-playback:fullscreen`
    为 3-column Workspace grid（64px Left Rail | Map Workspace | Right Details）：Left Rail 提供
    Battle/Vehicle/Display/Events/Annotation/Reset View；Map Workspace 中央列承载 HUD + 地图 + controls
    （均为 overlay，不占地图 layout）；Right Details 常驻（未选状态默认 Battle Summary，选车/选事件切换
    对应 Details）。地图按 `--pb-map-ratio` 保持真实宽高比（contain，无非等比拉伸，zoom 后可大于
    viewport 随 pan/zoom 裁剪）；HUD / controls 为顶部/底部 overlay；non-fullscreen 仍 map-first。
    生命周期：`fullscreenchange` listener 与 ResizeObserver 在 unmount 时移除/disconnect；组件在全屏
    中被卸载时主动 `exitFullscreen`。
    旋转换算：地图 yaw 从北(+Z)顺时针 → 屏幕 `rotate(yawDeg)`（0=朝上/90=朝右/180=朝下/270=朝左，
    两次翻转抵消，无符号/偏移修正）。
   - **炮线/曳光线（已知射击）**：`visibleTracers` 由纯函数 `tracerLines`（`utils/battlePlayback.js`）
     按当前时间推导——候选 = 真实事件流中的 DAMAGE 与 KILL（攻击者已解析），同刻同 attacker/target
      去重为一条；Battle Playback 两端必须满足 canonical `positionSegments` 的 OBSERVED 覆盖与
      事件时刻位置查询，segment gap/末点后/首点前一律拒绝，不用最后已知位置伪造射击位置；可见窗口 =
     `0.4s × 播放倍速`（1×/2×/4× 各约 **0.4s 真实时间**，`TRACER_BASE_SEC=0.4`——短 shot effect，
     命中后 ≈400ms 完全消失，不再挂在地图上整秒），**激光样式**：
     每炮线渲染三层——外层阵营色光晕（`6/view.scale`、opacity×0.35）+ 内芯亮白细线
     （`1.75/view.scale`、opacity）+ 命中端短促冲击闪光（`flashProgress` 0→1，半径 3→12px、
     `flashOpacity` 峰值曲线：前 0.1s 由 0 升至 0.9、之后线性淡出到 0，窗口
     `TRACER_FLASH_REAL_SEC=0.35` 真实秒，结束后不再渲染圆点）；opacity 为「先亮后淡」
     （前 `TRACER_HOLD_REAL_SEC=0.15` 真实秒保持全亮，之后快速线性淡出到窗口结束）；保持期/闪光窗口
     随倍速换算，各倍速真实时长一致；纯函数依赖 now/speed → seek/倍速天然正确，无一次性定时器；
     端点恒为事件时刻可信位置（`trustedPositionAt`），绝不绑定车辆后来的位置——历史射击几何不变。
     未命中/盲射/弹道弧线/瞄准线无数据依据，不渲染。
   - **缩放平移**：`.pb-viewport` 单一 transform 层（translate+scale）同时承载 SVG 与 HTML 标记 →
     地图/网格/炮线/标记严格对齐；滚轮锚点缩放（1×–4×，`zoomViewAt` 锚点不动）、双指捏合、
     单指/鼠标拖动（>5px 阈值，拖动后吞 click 防误选车）、重置按钮；地图区域 `touch-action:none`，
     地图外页面滚动不受影响；卸载清理 window 级 pointer 监听。炮线各层 `stroke-width`
     逐元素绑定（光晕 `6/view.scale`、内芯 `1.75/view.scale`，屏幕宽度恒定，放大后不变成粗色带；
     长度仍随地图坐标）；
     网格/区域/出生点（A/B/C 基地）属地图内容，随缩放。**战局回放视图不再渲染车辆路线**
     （用户 2026-08-14 确认去除；路线数据仍仅作为位置插值与炮线端点的内部输入）。
   - **地图标注（画笔/形状/文字，2026-08-16 新增）**：纯前端临时标注，不持久化、不调后端——
     刷新/切文件/切离战局回放视图即清空（切文件经 `BattlePlayback` `watch(overview)` 重置，
     切视图经 v-if 卸载）。工具栏提供画笔/橡皮擦/箭头/直线/矩形/圆/文字 + 9 色固定色板（含纯黑） +
     粗细滑块（1–12）+ 撤回/重做/清空/显隐开关；绘制需显式选工具（未选工具保持原有缩放/平移/
     选车交互；绘制中车标按钮 `pointer-events:none` 防误触，双指捏合/滚轮缩放保留）。几何一律存
     **语义坐标**（x=回放 x，y=回放 z），渲染经 `createMapView.toX/toY`（新增 `fromX/fromY`
     逆映射）→ SVG 像素，随 viewport transform 缩放/平移锚定不漂移；线宽/字号/半径按 x/y 轴比例
     换算成 SVG 单位（随地图缩放）。
     **屏幕↔语义换算（CSS px ≠ SVG unit，2026-08-16 修复）**：`.pb-map` 渲染宽度为容器 66.7%
     （移动端 100%），CSS 渲染尺寸 ≠ viewBox W/H，禁止把 CSS px 当 SVG unit。正链：client px →
     相对 `.pb-map` 的 CSS px（`screenPoint`）→ 撤销 viewport translate/scale → 未缩放 CSS px
     ×(viewBox/渲染尺寸)（`screenToSvg`，渲染尺寸取 `.pb-map` clientWidth/clientHeight，缺失按
     1:1 回退）→ `fromX/fromY` → 语义（`screenToSemantic`）；反链（文字输入框定位）`svgToScreen`
     = SVG unit ÷W/H ×渲染尺寸 ×scale + translate，`svgToScreen(screenToSvg(p)) ≈ p`。
     undo/redo 为全量快照（`commit/undo/redo`，上限 `UNDO_LIMIT=100`）；橡皮擦对自由笔迹
     **点擦局部**（删半径内点 + 断点拆段，`applyEraser`），对形状/文字整件擦除；文字标注落点即
     位置（临时输入框 Enter/blur 提交、Esc 取消，committed 幂等防重复）。三语文案
     `recon.map.playback.annot.*`；纯函数与交互回归见 `utils/annotation.test.js` 与
     `BattlePlayback.annot.test.js`。
   - **阵亡状态（pb-destroyed）**：destroyed 是显式独立状态，不并入 `pb-last-known`；
     敌我阵亡车结构一致（hull+turret 双层 + 同款 ✕）：方向冻结在最后可信样本
     （`interpolateDirection` 末样本冻结语义），canonical state 无方向样本不合成旋转角；
     generic destroyed marker 仅以未旋转素材保持可见（不代表朝向）；
     **中度变暗**（`.pb-destroyed .pb-graphics { opacity:.55 }`，不再极端透明）+ grayscale +
     team outline 弱化保留（drop-shadow 在 grayscale 后绘制不灰化）+ 一次性 transition 0.45s
     （prefers-reduced-motion 直达终态）；红色 ✕ / Selected 三角 / Recorder 菱形在 `.pb-graphics`
     容器外，保持完整强度。**Last-known**：`.pb-graphics` 淡化 0.35 + 仅弱 outline
     （无 glow）；label 仅文字弱化（background 正常）；Selected/Recorder 正常强度。
   - **真实 i18n 回归**：三语 `recon.map.playback.last_known` 文案不得含裸 `@`（Vue I18n 11
     linked-message 语法），选中 last-known/已击毁车辆首次渲染该文案时编译报错会导致组件整体卸载；
     `BattlePlayback.i18n.test.js` 用真实 `createI18n`（不 mock `$t`）覆盖 zh/en/ru 选车路径。
  - **双方总血量条 + 争霸赛实时点数**：地图下方两条 bar（本方/敌方阵营色）——
    `friendlyHealthAt` 只聚合 canonical `healthTransitions`、`lifeTransitions` 与 `friendly`；
    `EXACT` 才显示已证明的 current/displayCapacityHp 分数；己方的 `FULL_RELATIVE` 只消费
    backend 在 HealthTransition 上直接投影的 `relativeFull` fact，敌方无 evidence 为 UNKNOWN。
    不得使用静态参考容量或旧 artifact 字段推导本局总 HP。
     争霸赛实时点数来自回放广播 `pointsSamples`（type-8 subtype48 root field12，PROVEN；纯函数
     `teamPointsAt` 取最近一次 ≤currentTime 的广播值，随进度条变化；非争霸赛/无广播不显示，
     结算值不得冒充实时比分）。
   前端 `BattlePlayback.vue`（独立组件，复用 mapImages/coordinateBounds/色板/响应式布局）用
   `requestAnimationFrame` 推进播放时间：位置查询只服从 canonical `positionSegments` 的
   `knowledge`、`interpolationAllowed` 与 sample range，绝不以固定 packet gap 推断可插值性；
   跨 segment/位置中断/无效坐标禁止穿线；`positionCoveredAtV2` 决定车辆当前是否有位置流覆盖——
  覆盖中实体实心显示、位置中断实体淡化最后已知位置、从未上报位置实体不显示、阵亡实体在阵亡时刻切换为 ✕；
  Event Panel 默认折叠，展开后仅列出用户可读的 DAMAGE/KILL/DESTROYED 事件；POSITION_REPORTED/
  POSITION_STALE 等 coverage 事件仍保留在 canonical 事件流，供 playback state、combat feedback
  与 tracer 等内部逻辑使用，不展示给普通用户。点击事件行 seek 到该事件时间并保持暂停。
  播放控制：播放/暂停、±5s、0.5×/1×/2×/4×、Reset View、Fullscreen 和拖动 seek。
   - **segment 内/外查询**：`positionAtV2` 只在 canonical segment 明确允许且相邻 sample
     可形成区间时插值；`interpolationAllowed=false`、LAST_KNOWN、segment gap、未来 segment
     不生成新坐标，改为返回当前时刻以前的最后可信 sample。`vehicleState.lastKnown = !covered`，
     covered 只表示 canonical 位置流覆盖；车辆显示位置由 `positionAtV2` 的最后可信结果兜底，
     阵亡优先于位置中断。
    阵亡优先于位置中断；「最后已知」面板显示真实的最后可信时间（`pos.timeSec`），不再显示 `currentTime`。
  - **拖动与跳转即暂停**：进度条 `pointerdown/mousedown/touchstart` 立即暂停，拖动中实时 seek，
  松开保持暂停（不恢复拖动前状态）；Event Panel 行跳转和 AI 报告时间跳转均保持暂停。
  键盘焦点不在输入框、下拉框或按钮时，Space 播放/暂停，Left/Right 分别 seek -5/+5 秒；
  输入控件保留浏览器自身键盘行为。
  - **RAF 幂等**：`play()` 在已播放时直接返回、`pause()` 取消未完成回调，任意时刻至多一个 RAF 循环；
    播放到结尾、切离 playback Tab、折叠地图鸟瞰、组件卸载均停止。
  - **时间格式**：`formatClock` 先对总秒数统一取整再分解分钟/秒（杜绝 59.6s 显示为 00:60）。
  **AI 报告时间跳转**：`MarkdownContent` 把明确时间文本（`03:20` / `3分20秒` / `3m 20s` /
  `3 мин 20 с`）转成 `#seek=<秒>` 链接（不识别普通数字/比分）；结果面板把 seek 事件上抛给页面，
  页面确保独立地图区块已加载（未加载自动拉取 /api/replay/map-overview）并把 seek 传给 MapOverview——
  自动切换到战局回放并 seek 到该时刻暂停；随后页面 scrollIntoView 回滚到地图区块（地图在结果面板上方，
  点报告底部时间链接即可直接看到对应时刻的回放）。
- **阶段切片**：opening = OPENING + FIRST_CONTACT 合并；mid = 中间段；late = 战斗末
  `BattlePhaseSummary.DENSE_KILL_WINDOW_SEC`（15s）窗口（残局）。
- **降级**：未知地图 / 无语义网格 / 无名册 / 无观测 / 视角未解析 → `mapOverview = null`，
  前端不渲染（加载按钮返回 204 并显示不可用提示）。

### 图片素材与对齐约定

- **素材唯一权威在前端**：`frontend/src/data/mapImages.js`（mapCode → 图片资源 + 尺寸）既是
  渲染门控也是唯一素材源——该地图无素材时整块跳过、不画示意图；后端 `MapOverview.image` 恒
  null（兼容字段，不维护第二份目录）。
- **新增素材流程**：图片按英文展示名小写中划线放入 `frontend/src/assets/maps/`（如
  `normandy.png`）+ `mapImages.js` 加一行（key 用内部 code，如 `neptune`）+ 更新
  `docs/reference/maps.md` 主表。完整映射（内部 code ↔ 展示名 ↔ 语义 mapId ↔ 素材）见
  `docs/reference/maps.md`。
- **对齐依据**：每张图片在 `frontend/src/data/mapImages.js` 配置 `coordinateBounds`——来源为对应
  `map-semantics/*.semantic.json` 的 `coordinateSystem.worldBounds`（当前 29 张已登记图均为
  -300..300，即完整世界坐标截图；新图以各自语义 JSON 为准，逐图校准）。渲染统一用
  `coordinateBounds`，不得用 `playableBounds` 铺满图片（会越靠近边缘偏移越大）。无
  `coordinateBounds` 的旧配置按兼容策略回退 `playableBounds`。

### HD 底图运行时渲染契约

- `maps-hd/*.webp` 的 intrinsic raster resolution（当前约 4048×4048）只描述文件本身的
  解码像素；它不等于页面中的 logical map frame，也不等于任意 DPR/缩放下都能达到像素级
  清晰度。
- `mapImages.width/height` 是既有 logical/render-frame dimensions（约 754–783），由
  `createMapView()` 生成 `mapView.W/H`，并继续作为 `coordinateBounds`、terrain projection、
  SVG `viewBox`、车辆/基地/轨迹/标注及 pointer conversion 的共同坐标空间。它们不是 HD 文件
  的 intrinsic width/height，不得替换为 4048。
- Battle Playback 的 2D 底图由 `BattleMap.vue` 的独立 `.pb-basemap` HTML `<img>` 渲染；
  `.pb-svg` 只承载 vector overlays，`.pb-markers` 与两者共享同一个 `.pb-viewport` camera
  frame。底图和 SVG 都按 `mapView.W / mapView.H` 的 frame `fill`，因此近似正方形的 HD
  intrinsic ratio 不会改变既有非正方形地图的 overlay 对齐。
- 运行时 raster capacity 以
  `requiredDeviceWidth = renderedCssWidth × view.scale × devicePixelRatio`（height 同理）
  诊断。`naturalWidth / requiredDeviceWidth` 小于 1 表示源分辨率不足，不是通过滤镜或降低
  最大缩放可以修复的 renderer bug；该诊断不改变 1×→4× camera contract。
### 单车血量 HUD / 战斗反馈 / 车辆详情面板（PR5）

- **HP presentation selectors**：`healthDisplayAt(track, t)` 和 `friendlyHealthAt(tracks, friendly, t)`
  是 Battle Playback 的单一展示查询入口。它们只消费 `friendly`、`healthTransitions`、
  `lifeTransitions`、team 与不晚于 t 的 transition：`DESTROYED` 显示权威 0；CURRENT/
  LAST_KNOWN 显示最近可信 current 与 anti-future-leak 的 `displayCapacityHp`；己方存活且
  backend 已证明相对满血时返回 `relativeFull`，只渲染 100% presentation；敌方没有 health
  evidence 时保持 UNKNOWN。relative-full 不代表具体 HP 或 actual max。
  perspective 聚合只在每辆车都有可证 current/capacity 时返回 `EXACT`；己方 opening 时只消费
  backend 提供的 `relativeFull=true`，混合 exact-full/relative-full 仍返回 `FULL_RELATIVE`；已知掉血/阵亡返回
  `PARTIAL`，无证据返回 `UNKNOWN`，不读取 tankopedia base 或旧 sample 推导本局分母。
- **HP HUD**：每辆可显示车辆常驻「HP 数字 + 定宽 bar」（screen-space 恒定，friendly=地图 tone、
  enemy=red 与整车 team token 同源）；last-known 冻结最后可信值并弱化；destroyed（lifeState 权威）
  隐藏单车 HP number+bar（§18/§19，保留 ✕/灰化/labels/selected/recorder）；
  开关「显示血量」（默认开，`wotb.pb.hp-prefs` localStorage 持久化）隐藏数字/bar/ghost，
  不影响 floating damage / destroyed ✕ / sidebar HP / combat state / kill feed / timeline 正确性；
  重新开启立即按当前 timestamp 显示正确 HP（纯派生，不重头累计）。
  module/crew transition 的 `state=null` 表示该 component 当前无 active fault；consumable
  runtime 的全局失效由 `invalidation=true` 明确表达，前端只按 transition 应用状态。
- **HUD 数字与语义（§11/§12）**：队总 HP 显示完整整数（禁止 1k / 22.3k 缩写）；label 明确
  「己方总HP / 敌方总HP / 点数」（三语 i18n `hud_friendly_hp` / `hud_enemy_hp` / `points`）。
- **Team HP 延迟伤害（§13）**：authoritative current HP 立即更新，delayed-damage chip 短暂停留旧值并追赶
  （0.42s 克制过渡；`prefers-reduced-motion` 禁用；seek/恢复帧 `hpNoTransition` 直接同步不补播）。
- **destroyed Details（§21）**：selected vehicle 已击毁时 V2VehicleInspector 明确显示「已击毁」（而非 0 HP /
  空血条）；伤害历史 / 击杀 / 承受伤害 / 最后位置等 authoritative facts 仍正常展示。
- **战斗反馈（wall-clock transient，seek 清空 / pause 自然完成 / resume 不重复）**：
  播放时钟跨过事件由 `eventsCrossed`（严格左开 cursor）消费——DAMAGE → 伤害飘字
  （-N，受击方阵营色，约 1s 可读时长，同车连续受击纵向 stack）+ HP 数字立即切换 +
  bar 150–300ms 缩短（CSS transition，seek 单帧禁用）+ hit flash + lost-HP ghost
  （同阵营色浅版，约 600ms 消退）。`DamageLoss.transientAllowed`、`fromHp`、`toHp` 与
  `displayCapacityHp` 均由 backend 直接投影；无法证明时前端不显示 transient/ghost。
  DESTROYED → 克制 2D burst；KILL → Event Banner（Map Workspace top-center）
  （「玩家名（车辆名）被击毁」，victim-only，来自 canonical playerName+tankName，最多 2 条队列、约 3s 生命周期）。
  失察期间受击（事件时刻无位置流覆盖）不跳伤害、不更新 HP、不显示 attacker；
  prefers-reduced-motion 取消 ghost/flash/burst/feed 动画（事实保留）。
- **Detail Sidebar（2026-08 收敛为 current-state only）**：点击 marker 打开/切换（不 toggle-off）、
  点击空白不关闭、× 显式关闭、destroyed 车可选、seek 保持同一 selected vehicle；宽屏右侧固定、
  窄屏（≤768px）置于地图下方。Tier X 车辆按 tankId 懒加载随站点发布的 BlitzKit 车型图；
  非 Tier X、缺图或单图加载失败时静默省略图片，production 不访问第三方 CDN。面板只含
  **当前 playback 时间点**状态：阵营/车辆类型（replay →
  tankopedia fallback，全部 metadata 缺失才 —）/状态（已发现/最后已知/已击毁）/当前或最后已知
  HP（按 provenance 显示，PR #107 Blocker 1：已阵亡 → 0；己方开局相对满血
  （RELATIVE_FULL）→ **「100%」**（相对 UI 状态，不是具体 HP、也不证明 actual max）；
  有真实 current 采样（CURRENT）→ 真实 current 数字（容量已证明时显示 pct，否则保持 indeterminate 纹理）；
  有真实 sample → 精确 current 数字；敌方无依据 → —。tankopedia base HP 是静态 metadata 不是本局
  最大 HP，不再展示「最大 HP / HP %」（除已证明 OBSERVED_EXACT 的 pct））/
  当前播放时间/已记录伤害（Σ 可 attribution 的权威掉血）/承受伤害（Σ 该车全部
  掉血）/击杀数 + 最近伤害记录（权威掉血；incoming 在相邻可信 CURRENT HP 观测窗口内关联
  `DAMAGE`，仅当唯一攻击者的全部可归因掉血恰好覆盖该窗口掉血时显示来源，否则显示「来源未知」）。
  「最终战绩」分区与协助伤害行已**删除**（整场结算不混入当前时间点面板）。
- **KILL 广播 provenance（验证结论 + PR #107 Blocker 5 扩展）**：KILL 事件派生自 lethal
  DamageEvent（type-8 直接伤害通知），只能证明录像者客户端收到该伤害通知、不能证明客户端当时可见
  全局击杀广播中的击杀者身份 → kill feed 不显示攻击者（victim-only）。killer attribution 由
  `PlaybackCombatReconstruction` fail-closed 推导：致死窗口优先 = 权威致死 HP-loss 窗口
  （HP 掉到 0 的最后一档，无前序样本回退 0.25s）；窗口内必须存在**唯一可信攻击者**（身份可解析、
  候选一致、非自伤）且**不含任何无法排除的 unsupported damage 变体**——结构合法但语义未解码的
  伤害方法变体（火灾/撞击等，type-8 解码层产出 `UnsupportedDamageEvent` 证据事件，无精确伤害数字；
  只要包头确认 damage method 就必产出带时间戳的冲突证据——结构不足短体（SHORT_DAMAGE_VARIANT，
  victim 用 outer entityId）与 direct raw=0（ZERO_RAW_DAMAGE，raw 非权威不得当「无伤害」）
  同样作为冲突证据，warning 只作诊断、不是唯一输出）
  可能就是真实致死源，窗口内存在即 killer=null，绝不把窗口内无关 direct DAMAGE 错判为击杀者；
  **unsupported 变体同时阻止 HP-loss attribution**：掉血窗口 (prevT, curT] 内存在该受害者的
  unsupported 变体、或 victim 无法解析的 unsupported 证据（解码层已用可靠 outer entityId 回退，
  仍无法解析的不得静默视为「无冲突」）→ 掉血数值事实保留、attacker=null、attackerReliable=false、
  observedHpLoss=null（cumulative dealt / 伤害日志 / 事件级掉血均不得归给窗口内 direct DAMAGE）；
  destroyed 事实保留并去重，不因 killer 未知删除 HP=0/击毁。每 KILL 由同炮 DAMAGE 支撑的断言在
  `BattlePlaybackAdapterParityTest` 真实 fixture 上强制执行。

## 车辆标记尺寸（真实车体比例）

标记按地图米制缩放：`frontend/src/data/vehicleSizes.js` 是**生成文件**，存全部 735 辆的真实
车体长/宽（米），来源 BlitzKit `definitions/models.pb` 的车体包围盒——不含炮管。

尺寸优先级（`frontend/src/utils/vehicleMarkerSizing.js`）：

1. `vehicleSizes[tankId]` —— 真实车体表，覆盖全部车辆
2. 模型 metadata 的 `hullBounds` —— 表未覆盖的 tankId 才用
3. `CLASS_FOOTPRINT_M` 按车种猜测 —— 最后兜底；未知车种用全表真实中位车长

渲染尺寸 = `车体长 × 每米像素 × READABILITY_SCALE`，再按 `MARKER_SIZE_LIMITS` 钳制。
`READABILITY_SCALE = 1.14` 只补偿车体图形约占方形烘焙 88% 的空白，不额外放大；
下限只保证「还看得见」，**点击目标由 `HIT_TARGET_MIN_PX` 单独兜底**，所以视觉可以贴近真实尺寸。

> 历史：曾用 `READABILITY_SCALE = 1.6` + 下限 18px，导致 800px 地图上毛斯画到 21.6px
> （真实约 12px）、轻坦被下限抬到 18px（真实约 9px），与地形明显不成比例。

### 客户端/BlitzKit 更新后如何重新生成

```
python common/python/extract_vehicle_sizes.py
python common/python/extract_vehicle_sizes.py --check   # CI：过期即失败
```

## 2.5D 车辆地形姿态

Playback 继续使用现有俯视 hull/turret 资产，不引入 3D 坦克模型。启用 2.5D terrain relief 时，前端以当前车辆 footprint 和可靠 hull yaw 在 heightfield 上采样前/后/左/右地面高度，得到 presentation-only pitch/roll。pitch/roll 只倾斜车辆视觉层 `.pb-graphics`；HP、名称、hitbox、selected/recorder 与 collision layout 保持 screen-aligned。

该姿态来自地图权威 heightfield，不从前端猜测 replay Z；无 terrain model 或无可靠 hull yaw 时保持原有平面 marker。为避免小尺寸贴图翻卡片，视觉 pitch clamp ±14°、roll clamp ±10°，并遵守 `prefers-reduced-motion`。

