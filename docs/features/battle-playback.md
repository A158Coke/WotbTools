# 地图鸟瞰与战局回放（Battle Playback）

> 用户可见契约：`ReplayPage` Workspace 的「战局回放」面板（`BattlePlaybackPanel.vue`）
> （热力 + 路线 + 战局回放三视图），**不依赖 AI 复盘**——不跑 AI 也能看图。
> 数据来源与素材权威见 `docs/reference/maps.md`（内部 code ↔ 展示名 ↔ 语义 mapId ↔ 素材）。
> 生产状态：回放 timeline 事实按 canonical 语义（AFFIRMED）；AoI hidden=UNKNOWN、禁止跨 AoI gap 插值、死亡 clamp 到权威死亡时刻。

## 地图鸟瞰（Map Overview，Dataset-only）

战局回放面板读取同一 Processing Dataset 的 `map-overview.json` derived artifact：
`POST /api/replay/map-overview`（`Content-Type: application/json`，body `{ processingJobId, sourceId }`）
→ `MapOverviewQueryService.buildOverviewFromDataset` → `ReplayArtifactWriter.readMapOverview` →
前端 `MapOverview.vue` 纯 SVG 渲染（热力 + 路线 + 战局回放三视图）。
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
- **模式与录像者**：`MapOverview` 携带 `arenaBonusType`（meta.json 原值；1=随机战斗，其他=训练/联赛等，
  未知为 null）与 `recorderAccountId`（经 `Battle.recorderResult()` 解析，录像者昵称已在
  `ReplayParser.resolveRecorderNickname` 归一化为纯昵称；未解析为 null）。随机战路线视图提供
  「全部/本方/敌方/仅玩家」筛选，「仅玩家」只渲染录像者一条路线（含阶段切片）；非随机战维持三档。
- **自适应配色**：前端 `frontend/src/utils/mapPalette.js` 将底图降采样 64×64 后计算平均相对亮度
  （sRGB 线性化后按 0.2126/0.7152/0.0722 加权），阈值 0.45——低于视为暗图用亮色系、否则用深饱和色系；
  路线 7+7 色、热力、网格/九宫格/出生点/死亡标记与路线对比描边均随色板切换；canvas 不可用或计算失败时
  回退暗图默认色板。不做每图手工配色表。
- **布局与标注**：鸟瞰 SVG 宽度由 scoped CSS 控制——桌面/平板为容器宽度 66.7%（约 2/3）并居中，
  `max-width: 768px` 时恢复 100%（viewBox 不变、不裁切）；九宫格仅绘制分区框（region-line），
  不绘制数字标注（region-label）。
- **热力口径**：伤害热力按**受击方**位置落格（受击方阵营）；驻留/阵亡为事件计数；
  每层 36 个值按 `gridCells` 顺序，前端按 max 归一化。
- **路线**：双方 14 车，2s 均匀采样（间隔 = max(2s, duration/200)，每车 ≤200 点），
  `firstObservedSec/lastObservedSec` 诚实标注观测区间（敌方静止开局通常缺失，
  前端显示「位置观测自 X 秒起」），`deathSec` 标注阵亡；连续点 gap > 5s 前端断线。
- **战局回放（Battle Playback，第三视图）**：`MapOverview.playback`（可空）携带
  `durationSec`、`vehicles`（账号/昵称/坦克/阵营/`positionIntervals` 位置上报区间/`deathSec`）与
  `events`（按 battle-relative 秒升序的英文稳定码：`DAMAGE`/`DESTROYED`/`KILL`/
  `POSITION_REPORTED`/`POSITION_STALE`，伤害/击毁身份经 `TeamEntityMapper` 实体映射解析，
  无法可靠解析则不输出；`POSITION_REPORTED/STALE` 只表达服务器位置流覆盖变化，不是点亮）。
  - **位置上报区间口径（2026-08-15 修复）**：`positionIntervals` 按 type-10 gap>5s 分段聚类；
    EntityLeave(type-4) 只表示实体离开/停止存在，不代表阵亡，也不代表点亮/失察——每一次 leave 都是
    coverage 的 hard segment boundary：leave 强制关闭当前区间，leave 后第一条 position（无论 gap 大小）
    开启新区间；同一实体位置流中断后重新上报的新区间必须保留（此前 leave 被当作单点截断，
    重新上报 gap ≤ 5s 时会被吞掉，前端 `covered` 永假、车标一直淡化；
    `MapOverviewBuilderPositionIntervalsTest` 回归）。
  - **方向契约（2026-08-13 门禁 B 破解）**：`PlaybackVehicle.directionSamples`（时间升序，
    约 1s 降采样 + 方向变化 ≥10° 保点）：`hullYawDeg` 来自 type-10 yaw（弧度→度）；
    `turretRelativeYawDeg` 来自 type-7 propId=2（u16 LE：`raw*360/65536-180`，[-180,180)，
    完整 360° 且 ±180 回绕；旋转实验 + 开火锚点拟合证明，交叉验证残差 2.3°）；
    前端 `turretWorldYawDeg = normalize(hullYawDeg + turretRelativeYawDeg)`。
    仅保留 finite、≤deathSec 样本；无可靠方向的车辆不伪造朝向。
    方向采样必须落在该车同一可信 position-interval 内，hull yaw 只从同区间位置配对——
    位置流中断期间不继续旋转炮塔、不跨 gap 取对侧 hull yaw，re-entry 后新段继续；
    每个可信方向段最后一个样本恒保留（冻结准确）。
    **时长契约**：playback `durationSec` 三优先级 = `battle.durationS`（finite>0）→
    `RoundFinishedEvent`（合法 battle-relative）→ 位置流最后时刻；全部 event/interval/
    directionSample/deathSec 强制 `[0, durationSec]`。
  - **双层坦克标记**：前端 `BattlePlayback.vue` 用 PR #72 四张运行时 PNG
    （`frontend/src/assets/tank-icons/tank-marker-{friendly,enemy}-{hull,turret}.png`，512×512
    RGBA、共同 pivot 256,256）渲染 HTML overlay 标记（**PR3 增补：按钮约 36px，移动端 28px**
    ——人工 QA 全局地图视角车型辨识度不足，约 +28%；按钮不再反缩放 → 坦克随地图同比缩放）：
    hull/turret img 放大到按钮 **134%** 并以共同 pivot 居中旋转
    （`translate(-50%,-50%) rotate(...)`）——generic 素材透明留白实测有效车体 bbox
    ≈210×336/512（长边占 65.6%），dedicated hull.webp 车体长边 ≈88.1%（fit padding 0.88），
    **134% = 0.881/0.656 使 generic 车体长边视觉与 dedicated 对齐**（36px 容器下均 ≈31.7px；
    generic 车体宽 ≈19.8px、dedicated 按真实长宽比 ≈11–16px，宽体 icon 为素材固有比例）；
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
    完整名 tooltip；碰撞纯函数 `utils/labelLayout.js`（screen px，viewport 内才参与）——
    TankName 冲突**从下往上** greedy 上移让位（下方先 finalized、上限一行，3+ 连锁不重新产生
    overlap）、PlayerName 冲突经时间阈值（hide 250ms / show 300ms，`performance.now` **UI wall
    clock**——播放由 frame 刷新、暂停由轻量 RAF 继续推进，不依赖播放状态）隐藏/恢复（~120ms
    opacity fade-in，类保持完整生命周期不被下一次 resolve 取消）；PlayerName 盒从 final TankName
    盒推导（与共享 label 块整体位移一致）；zoom 结束由 computed
    依赖 view.scale 自然重算；点击命中改为 hull hitbox（dedicated 90% / generic 58%×90% 盒比例，
    随 marker 缩放，不含 gun overflow/label/三角/菱形/✕；destroyed/last-known 仍可点），重叠时
    取指针最近车辆、距离几乎一致且已选中则保持、否则 render order tie-break；倍速含 0.5×；
    `loop` prop（QA 场景循环）。
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
    zoom/pan 不自动 reset（无 auto-fit；Reset View 由用户使用）。全屏样式 `.battle-playback:fullscreen`
    （100%×100%、内部滚动兜底）与 `.battle-playback:fullscreen .pb-map`（100% 宽、垂直预算
    `max-width: calc(100vh - 190px)`、`margin: auto` 居中——保持宽高比、不拉伸/不 letterbox）。
    生命周期：`fullscreenchange` listener 与 ResizeObserver 在 unmount 时移除/disconnect；组件在全屏
    中被卸载时主动 `exitFullscreen`。
    旋转换算：地图 yaw 从北(+Z)顺时针 → 屏幕 `rotate(yawDeg)`（0=朝上/90=朝右/180=朝下/270=朝左，
    两次翻转抵消，无符号/偏移修正）。
   - **炮线/曳光线（已知射击）**：`visibleTracers` 由纯函数 `tracerLines`（`utils/battlePlayback.js`）
     按当前时间推导——候选 = 过滤后事件流中的 DAMAGE 与 KILL（攻击者已解析），同刻同 attacker/target
     去重为一条；两端都必须满足 `trustedPositionAt`（事件时刻落在该车路线首末点之间且所在段 gap ≤ 5s；
     末点后的最后已知位置/gap 内/首点前一律拒绝，不用最后已知位置伪造射击位置）；可见窗口 =
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
     （用户 2026-08-14 确认去除；路线数据仍被车辆位置插值与炮线端点复用，只删渲染层；
     想看路线用「路线」视图）。
   - **地图标注（画笔/形状/文字，2026-08-16 新增）**：纯前端临时标注，不持久化、不调后端——
     刷新/切文件/切离战局回放视图即清空（切文件经 `BattlePlayback` `watch(overview)` 重置，
     切视图经 v-if 卸载）。工具栏提供画笔/橡皮擦/箭头/直线/矩形/圆/文字 + 8 色固定色板 +
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
     （`interpolateDirection` 末样本冻结语义），无方向样本以素材默认 0° 渲染（不代表朝向）；
     **中度变暗**（`.pb-destroyed .pb-graphics { opacity:.55 }`，不再极端透明）+ grayscale +
     team outline 弱化保留（drop-shadow 在 grayscale 后绘制不灰化）+ 一次性 transition 0.45s
     （prefers-reduced-motion 直达终态）；红色 ✕ / Selected 三角 / Recorder 菱形在 `.pb-graphics`
     容器外，保持完整强度。**Last-known**：`.pb-graphics` 淡化 0.35 + 仅弱 outline
     （无 glow）；label 仅文字弱化（background 正常）；Selected/Recorder 正常强度。
   - **真实 i18n 回归**：三语 `recon.map.playback.last_known` 文案不得含裸 `@`（Vue I18n 11
     linked-message 语法），选中 last-known/已击毁车辆首次渲染该文案时编译报错会导致组件整体卸载；
     `BattlePlayback.i18n.test.js` 用真实 `createI18n`（不 mock `$t`）覆盖 zh/en/ru 选车路径。
   - **双方总血量条 + 争霸赛实时点数**：地图下方两条 bar（本方/敌方阵营色）——
     `totalMax=ΣmaxHp`（理论容量）、`knownRemaining=Σ已知剩余`、`unknownMax=Σ未观测容量`
     （纯函数 `teamHp/vehicleHpAt`）；阵营色实段=已知剩余、灰色弱化段=未观测（UNKNOWN，不冒充满血）、
     空白=已损失；`maxHp` 与 `hpSamples` 来自后端消费 type-7 propId=3（**signed i16**，含装备/物资加成，
     `ObservedMaxHp` 解析；0xFFFD/-3 死亡 sentinel 归一化为 0、0xFFFF/-1 等 UNKNOWN sentinel 绝不进入）。
     争霸赛实时点数来自回放广播 `pointsSamples`（type-8 subtype48 root field12，PROVEN；纯函数
     `teamPointsAt` 取最近一次 ≤currentTime 的广播值，随进度条变化；非争霸赛/无广播不显示，
     结算值不得冒充实时比分）。
  前端 `BattlePlayback.vue`（独立组件，复用 mapImages/coordinateBounds/色板/响应式布局）用
  `requestAnimationFrame` 推进播放时间：仅在同一可信连续点（gap ≤ 5s）之间线性插值，
  跨断线/位置中断/无效坐标禁止穿线；`positionCoveredAt` 决定车辆当前是否有位置流覆盖——
  覆盖中实体实心显示、位置中断实体淡化最后已知位置、从未上报位置实体不显示、阵亡实体在阵亡时刻切换为 ✕；
  随机战默认只显示与录像者相关的伤害/击杀/阵亡 + 全部可见性事件（可切换「全部已知事件」），
  训练房/联赛默认显示本方关键事件；进度条按秒聚合事件标记，点击标记跳转该秒并弹出事件列表。
  播放控制：播放/暂停、±5s、上一/下一事件、1×/2×/4×、拖动 seek。
  - **gap 内最后已知**：`positionAt` 只返回可信插值位置（gap 内为 null，禁止穿线）；
    t 恰为采样点（含 gap > 5s 后的重新上报首点）直接返回该点本身（gap 判定只用于两点间插值），
    否则重新上报首点会被误判为「gap 内」→ 车辆 lastKnown 残留淡化（位置流恢复覆盖仍淡化）。
    **覆盖即不淡化**：`vehicleState.lastKnown = !covered`——covered 只表示服务器位置流覆盖（type-10），route 采样点
    稀疏（长局采样间隔 max(2, duration/200) 可 >5s）导致 live=null 不代表位置中断，只有位置流未覆盖才淡化。
    车辆显示位置由 `lastKnownPosition` 兜底——gap/位置中断/阵亡时车辆停在淡化的最后可信位置而非消失，
    阵亡优先于位置中断；「最后已知」面板显示真实的最后可信时间（`pos.timeSec`），不再显示 `currentTime`。
  - **拖动与跳转即暂停**：进度条 `pointerdown/mousedown/touchstart` 立即暂停，拖动中实时 seek，
    松开保持暂停（不恢复拖动前状态）；事件标记点击、上一/下一事件跳转、AI 报告时间跳转均保持暂停。
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
  `map-semantics/*.semantic.json` 的 `coordinateSystem.worldBounds`（当前 28 张已登记图均为
  -300..300，即完整世界坐标截图；新图以各自语义 JSON 为准，逐图校准）。渲染统一用
  `coordinateBounds`，不得用 `playableBounds` 铺满图片（会越靠近边缘偏移越大）。无
  `coordinateBounds` 的旧配置按兼容策略回退 `playableBounds`。
### 单车血量 HUD / 战斗反馈 / 车辆详情面板（PR5）

- **HP 数据优先级与 provenance 状态（确定性重建，PR #107 扩展 + Blocker 3 收口）**：`hpDisplay`
  （`utils/battlePlayback.js`）按状态机输出（`state` 字段，替代单一黑条/UNKNOWN 语义）：
  ① 已阵亡（deathSec ≤ t）→ `DESTROYED`（权威 0，Details Panel 显示 0）；
  ② 最近可信 HP 采样 + `entryHpSource==OBSERVED_EXACT`
  （受击覆盖完整 + 严格早于首次受击的 positive 样本 ≥ tankopedia base）→ `OBSERVED_EXACT`
  （精确 current/entryHp/pct——只有实际进场 max 已被可靠证明时才允许计算真实 HP 百分比）；
  ③ 有真实 Type-7 current 采样但进场 max 未证明 →
  `CURRENT_HP_EXACT_MAX_UNKNOWN`（**current 精确、maxHp=null、pct=null**——绝不使用
  tankopedia base/观测容量计算百分比；DTO 已把 `maxHp` 拆分为 `baseHp`（Tankopedia 静态参考）+
  `observedCapacityHp`（= 纯回放观测：真实可信 Type-7 positive HP 采样的最大值，无可信 sample 为
  null，绝不 max(观测, base)/fallback base）+ `entryHp`（已证明进场满血），三者独立 provenance；
  tooltip「当前 HP 已观测，进场最大 HP 未知」，渲染阵营色 indeterminate 斜纹、不渲染黑条；
  **己方开局（当前时间之前无权威 hpLoss、无 destroyed 证据）被 `OPENING_RELATIVE_FULL` 覆盖**）；
  ④ 本方存活 + 有可信 current 采样但进场 max 未证明 + 当前时间之前无权威 hpLoss /
  无 destroyed 证据 → `OPENING_RELATIVE_FULL`（开局相对满血展示判定，PR #107 第 5 轮 Blocker 2）：
  current=**真实采样**（Details/数字可显示）、maxHp=null、pct=null、fullState=true
  （100% 阵营色实心条，**无 indeterminate 斜纹**——即使部分车辆已有 current sample、但全队
  entry/max 尚未全部证明，开局也不显示斜纹）；
  ⑤ 已证明 entryHp 但存在矛盾证据（PR #107 第 5/6 轮 Blocker 3/2：≤t 可信采样超出 [0, entryHp]、
  HP 先降后升（违反单调非增）、0 之后再次 positive；**含已阵亡车辆的历史矛盾**）→
  `INCONSISTENT`：current=**真实采样（绝不钳制/改写）**、maxHp=null、pct=null（不产出语义上的
  OBSERVED_EXACT 百分比），渲染 indeterminate 斜纹（当前值已知、比例不可信）；
  ⑥ 本方存活 + 无采样 + 无战前掉血证据 → `RULE_DERIVED_FULL_AT_SPAWN`
  （开局相对满血：marker 100% 阵营色完整血条**无条纹**，Details Panel 显示 **「100%」**——
  **100% 是「开局相对满血状态」的 UI 投影，不是具体 HP 数值、也不证明 actual max HP**；
  tankopedia base 永不冒充本局 max/current/entry；三语 tooltip「开局满血，具体 HP 尚未从回放确认」）；
  ⑦ 敌方/无依据 → `UNKNOWN`（灰段未知样式、Details Panel —，不因己方 fallback 泄漏）。
  任意 timestamp 确定性重建，backward/forward seek 均直接恢复状态；不把未来 sample 泄漏到过去。
- **底部双方总血量条（PR #107 Blocker 2 aggregate display state）**：`teamHp`
  （`utils/battlePlayback.js`）输出 `state`（确定性、可测试）：
  - `FULL_RELATIVE`：本方**全部存活车辆（无阵亡）**都处于开局相对满血展示判定（存活、当前时间
    之前无权威 hpLoss、无 destroyed 证据——即使部分车辆已有 current sample、但全队 entry/max
    尚未全部证明，开局也不显示斜纹）→ 填充固定 100% 阵营色实心条，数值区显示「100%」
    （相对状态）或本地化「开局满血」，绝不显示 0；
  - `EXACT`：**仅当该队所有参战车辆（含已阵亡、含无采样）的实际 entryHp 都已证明**
    **且所有当前证据一致**——对**全部已证明车辆（含已阵亡）**检查每个 ≤t 可信采样都在 [0, entryHp]、
    按 battle-relative time 单调非增（HP 不得先降后升）、0 之后不得再次 positive
    （sentinel 不参与、也不改写；未来 sample 不参与当前判断，seek/backward 确定性）→
    真实分数 knownRemaining/totalMax（known ≤ total 由「全部采样 ≤ entryHp」的一致性门槛保证，
    绝不 Math.min 钳制真实采样）；
  - `PARTIAL`/MIXED：部分证明或混合 provenance（OBSERVED_EXACT + RULE_DERIVED_FULL_AT_SPAWN /
    + CURRENT_HP_EXACT_MAX_UNKNOWN / + UNKNOWN、已阵亡但 entryHp 未证明、或**证据矛盾**
    （current > entryHp / HP 回升 / 0 后回正、含已阵亡车辆历史矛盾：真实 current 保留但整队
    不得 EXACT / 100% 实心条））→
    有真实已知剩余但无「全队已证明分母」：100% 斜纹 indeterminate + 只显示真实已知剩余数字
    （totalMax 归零，绝不显示 knownRemaining / partialTotalMax 分数、不伪造分母）；
    禁止「totalMax=0、knownRemaining&gt;0 却仍 0%」的空条；
  - `UNKNOWN`：无任何数据（敌方无采样）→ 空条 + —，不显示虚假的「0 / 0」。
  阵亡是权威事实（HP=0），dead 车容量不进未知灰段；Tankopedia base 相加不得冒充总 HP；
  混合 provenance 一律不得冒充精确队伍总血量。
- **HP HUD**：每辆可显示车辆常驻「HP 数字 + 定宽 bar」（screen-space 恒定，friendly=地图 tone、
  enemy=red 与整车 team token 同源）；last-known 冻结最后可信值并弱化、destroyed 归零；
  开关「显示血量」（默认开，`wotb.pb.hp-prefs` localStorage 持久化）隐藏数字/bar/ghost，
  不影响 floating damage / destroyed ✕ / sidebar HP / combat state / kill feed / timeline 正确性；
  重新开启立即按当前 timestamp 显示正确 HP（纯派生，不重头累计）。
- **战斗反馈（wall-clock transient，seek 清空 / pause 自然完成 / resume 不重复）**：
  播放时钟跨过事件由 `eventsCrossed`（严格左开 cursor）消费——DAMAGE → 伤害飘字
  （-N，受击方阵营色，约 1s 可读时长，同车连续受击纵向 stack）+ HP 数字立即切换 +
  bar 150–300ms 缩短（CSS transition，seek 单帧禁用）+ hit flash + lost-HP ghost
  （同阵营色浅版，约 600ms 消退）；DESTROYED → 克制 2D burst；KILL → kill feed
  （只显示「受害者被击毁」，victim-only，最多 3 条队列、约 5s 生命周期）。
  失察期间受击（事件时刻无位置流覆盖）不跳伤害、不更新 HP、不显示 attacker；
  prefers-reduced-motion 取消 ghost/flash/burst/feed 动画（事实保留）。
- **Detail Sidebar（2026-08 收敛为 current-state only）**：点击 marker 打开/切换（不 toggle-off）、
  点击空白不关闭、× 显式关闭、destroyed 车可选、seek 保持同一 selected vehicle；宽屏右侧固定、
  窄屏（≤768px）置于地图下方。Tier X 车辆按 tankId 懒加载随站点发布的 BlitzKit 车型图；
  非 Tier X、缺图或单图加载失败时静默省略图片，production 不访问第三方 CDN。面板只含
  **当前 playback 时间点**状态：阵营/车辆类型（replay →
  tankopedia fallback，全部 metadata 缺失才 —）/状态（已发现/最后已知/已击毁）/当前或最后已知
  HP（按 provenance 显示，PR #107 Blocker 1：已阵亡 → 0；己方开局相对满血
  （RULE_DERIVED_FULL_AT_SPAWN）→ **「100%」**（相对 UI 状态，不是具体 HP、也不证明 actual max）；
  己方开局有真实 current 采样（OPENING_RELATIVE_FULL）→ 真实 current 数字（bar 仍 100% 实心、无斜纹）；
  有真实 sample → 精确 current 数字；敌方无依据 → —。tankopedia base HP 是静态 metadata 不是本局
  最大 HP，不再展示「最大 HP / HP %」（除已证明 OBSERVED_EXACT 的 pct））/
  当前播放时间/已记录伤害（Σ 可 attribution 的权威掉血）/承受伤害（Σ 该车全部
  掉血）/击杀数 + 最近伤害记录（权威掉血，攻击者不可证明或未点亮显示「来源未知」）。
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