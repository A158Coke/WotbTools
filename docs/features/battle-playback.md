# 地图鸟瞰与战局回放（Battle Playback）

> 用户可见契约：AI 复盘页面（ReconstructionPage）的独立「地图鸟瞰」区块
> （热力 + 路线 + 战局回放三视图），**不依赖 AI 复盘**——不跑 AI 也能看图。
> 数据来源与素材权威见 `docs/reference/maps.md`（内部 code ↔ 展示名 ↔ 语义 mapId ↔ 素材）。

## 地图鸟瞰（Map Overview）

AI 复盘页面的独立「地图鸟瞰」区块：文件选中后点「加载地图」按钮 → `POST /api/replay/map-overview`
（只解析回放、不调 AI，同步返回 `MapOverview` JSON；地图不可构建返回 204）→ 前端
`MapOverview.vue` 纯 SVG 渲染（热力 + 路线 + 战局回放三视图）。AI 复盘 SSE `done` 载荷仍携带
`mapOverview` 字段（后端兼容保留），但前端不再从复盘结果渲染地图——两处同源（同一
`MapOverviewBuilder`），无数据漂移。

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
    `BattleEndedEvent`（合法 battle-relative）→ 位置流最后时刻；全部 event/interval/
    directionSample/deathSec 强制 `[0, durationSec]`。
  - **双层坦克标记**：前端 `BattlePlayback.vue` 用 PR #72 四张运行时 PNG
    （`frontend/src/assets/tank-icons/tank-marker-{friendly,enemy}-{hull,turret}.png`，512×512
    RGBA、共同 pivot 256,256）渲染 HTML overlay 标记（按钮约 28px，移动端 22px；按钮不再反缩放 →
    坦克随地图同比缩放）：hull/turret img 放大到按钮 131% 并以共同 pivot 居中旋转
    （`translate(-50%,-50%) rotate(...)`）——素材透明留白实测有效车体 bbox ≈210×336/512，
    131% 后桌面有效可见车体 ≈15×24px，放大地图不再显小；hull 层按 `hullYawDeg` 旋转、turret 层按
    `turretWorldYawDeg` 旋转（炮管不脱离炮塔）；阵营色只来自素材本身；录像者 gold halo、选中 ring、
    最后已知淡化、阵亡 ✕ 为独立 overlay，不烘焙进 PNG；标记**上方**常显固定字号坦克型号名小标签
    （`PlaybackVehicle.tankName`，后端 `ReplayDisplayNames.tankName(tankId, tankName)` 权威解析自
    tankopedia，如 29985 → "SPHT"，不再是空串/纯数字；标签自身按 `1/view.scale` 反缩放 → 字号不随地图缩放、任意缩放下可见）。
    旋转换算：地图 yaw 从北(+Z)顺时针 → 屏幕 `rotate(yawDeg)`（0=朝上/90=朝右/180=朝下/270=朝左，
    两次翻转抵消，无符号/偏移修正）。
   - **炮线/曳光线（已知射击）**：`visibleTracers` 由纯函数 `tracerLines`（`utils/battlePlayback.js`）
     按当前时间推导——候选 = 过滤后事件流中的 DAMAGE 与 KILL（攻击者已解析），同刻同 attacker/target
     去重为一条；两端都必须满足 `trustedPositionAt`（事件时刻落在该车路线首末点之间且所在段 gap ≤ 5s；
     末点后的最后已知位置/gap 内/首点前一律拒绝，不用最后已知位置伪造射击位置）；可见窗口 =
     `1s × 播放倍速`（1×/2×/4× 各约 1s 真实时间，`TRACER_BASE_SEC=1.0`），**激光样式**：
     每炮线渲染三层——外层阵营色光晕（`6/view.scale`、opacity×0.35）+ 内芯亮白细线
     （`1.75/view.scale`、opacity）+ 命中端扩散闪光（`flashProgress` 0→1，半径 3→12px、
     opacity 0.9→0，窗口 `TRACER_FLASH_REAL_SEC=0.35` 真实秒）；opacity 为「先亮后淡」
     （前 `TRACER_HOLD_REAL_SEC=0.4` 真实秒保持全亮，之后线性淡出到窗口结束）；保持期/闪光窗口
     随倍速换算，各倍速真实时长一致；纯函数依赖 now/speed → seek/倍速天然正确，无一次性定时器。
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
   - **阵亡状态（pb-destroyed）**：destroyed 是显式独立状态，不并入 `pb-last-known`；敌我阵亡车
     结构一致（hull+turret 双层 + 同款 ✕）：方向冻结在最后可信样本（`interpolateDirection` 末样本
     冻结语义），无方向样本以素材默认 0° 渲染（不代表朝向）；`.pb-destroyed { opacity:.35 }` +
     `img { filter: grayscale(1) }`（去饱和≠换阵营色）；录像者 halo/选中 ring 为独立 overlay，
     不改变阵亡结构。
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
