# 地图鸟瞰与战局回放（Battle Playback）

> 用户可见契约：`ReplayPage` Workspace 的「战局回放」面板（`BattlePlaybackPanel.vue`）
> （热力 + 战局回放），**不依赖 AI 复盘**——不跑 AI 也能看图。
> 数据来源与素材权威见 `docs/reference/maps.md`（内部 code ↔ 展示名 ↔ 语义 mapId ↔ 素材）。
> 生产状态：回放 timeline 事实按 canonical 语义（AFFIRMED）；AoI hidden=UNKNOWN、禁止跨 AoI gap 插值、死亡 clamp 到权威死亡时刻。
>
> **2026-10-02 起数据在本机生成**（服务器没有 parser）：`frontend/src/replay-local/playback/` 把上游 Rust Core
> `parsePlayback`（+ `parseResult`、`parseAiReview` 伤害事件）转换为同一份 `BattlePlaybackDataset` / `MapOverview`。
> 工作台通过 `useReplayWorkspace.ts` 的共享 playback session 调用 `parseLocalPlaybackOffThread`，
> 优先在 `canonical.worker.ts` 生成 canonical 数据；仅线程设施故障回退主线程，解析失败保持错误。3D scene ready 不等待 canonical，Details 后台增强。
> 原服务端 `battle-playback-v2` / `map-overview` 端点、`BattlePlaybackProjector`、`MapOverviewQueryService` 已删除；
> 下文中「后端 / artifact / projector」描述的数据语义由本机转换层继承，与 Java 输出的对比数字见
> `frontend/src/replay-local/playback/playback.golden.test.ts`。

## Battle Playback V2（canonical 稀疏投影）

`BattlePlaybackDataset` 的形状仍以 `contracts/http/openapi.yaml` 的 schema component 为唯一事实源（端点已删除，
schema 保留）；前端 types 与 runtime 校验从该文件生成，本机转换层的输出必须通过同一校验。数据流：
`.wotbreplay` → `parseLocalPlayback`（`replay-local/playback`）→ `BattlePlaybackPanel` → `BattlePlayback.vue`
的 V2 检查器（`V2VehicleInspector`）。

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
- 2D / 3D 共用中心栈（2D 取最大正方形，3D 横屏铺满可用宽高）：地图/时间、HP/比分与 compact 基地 metadata 的持久 HUD → Stage → Transport。击杀流是独立的有界 overlay（2D 最多保留最新 2 条、3D 最多 3 条），不参与 HUD 高度预算，因此条目变化不会牵动 Stage / Transport 重排。
- 主控件共用 `PlaybackTransport.vue`，顺序为 `-5 / Play-Pause / +5 / 当前速度 / 全屏 / Display`，速度档位按需展开，六个触控目标至少 44px。
- 侧车道以 workspace 宽度作 fluid sizing，并保持可读下限；桌面左 / 中 / 右列约为 25% / 50% / 25%，短横屏保留主控件所需列宽。HUD 铺满中心列，桌面放大字号与血条厚度；名册与战场标签的装填条均与 HP 条等宽且更细；横条模式的战场血量数值置于加厚血条内，不重复显示百分比。2D Stage 同时受中心可用宽度和实测可用高度约束；3D 横屏画布铺满中心列可用宽高，相机比例随容器更新，竖屏保持正方形。容量按**视口**算（`视口高 − 顶栏/底栏 − 实测 HUD − 实测 Transport − 间距`），刻意不用根元素的内容高度，也就不用按断点各写一套固定扣减。
- Display 由 `PlaybackDisplaySurface.vue` 锚定 Gear，优先向上、空间不足换边并夹紧；竖屏采用有界 inline 面。Details 仍为独立的 workspace 级可拖动上下文窗；首次落位不压中心栏（HUD / Stage / Transport 同一列，以 Transport 的左右边为准）：侧边车道比浮窗窄时（如 1280 宽桌面）把浮窗收窄到侧边可用宽度，侧边不足 240px 或名册关闭时不收窄（`usePlaybackDetailsPlacement`）。
- **2D / 3D 同一战斗时钟**：播放条、顶栏计时与 Details 都以开战（canonical `clock.startRaw`）为 0、总长 `durationSec`，同一时刻在 2D / 3D 显示同一个时间；顶栏计时是已过时间（不是游戏内的剩余倒计时）。3D 的战斗时间轴 `[START, END]` 由**场景引擎**唯一持有（发布为 `store.startTime` / `store.duration`）：会话从开战时刻开始，`seekTo` / `seekBy`（±5）/ `seekFraction`、进度比例与自动停止全部夹在里面，准备 / 倒计时阶段回不去。时钟来源按优先级：工作台 canonical 的 clock（`Replay3DPane` 在 canonical 就绪 / 失败 / 换会话时经 `setBattleClock` 交给引擎，引擎重定范围并把当前 T 夹回去、越过新终点即停播）→ 场景按同一 `resolveReplayClock` 从自身 periods 推出的时钟 → 数据范围（`t_start` → `battleEnd.js`）。
- 形态判定（`shared/breakpoints` 的 `PLAYBACK_MOBILE_QUERY`）：Mobile = 宽 `<768px` 或触屏且高 `≤500px`（手机横屏）；`768–1199px` 一律 Tablet、`≥1200px` 一律 PC。布局只看可用空间，触屏只放大控件点击区域（44px），iPad / Android 平板拿 Tablet 形态。
- 不抢页面：滚轮只在全屏、按住 Ctrl/⌘ 或刚在地图上按下后才缩放，否则交给页面滚动并短暂提示；地图未放大、非全屏、未标注时 `touch-action: pan-y`，单指纵向滑动滚动页面；`active=false`（隐藏的模式 / KeepAlive 停用）时暂停并不响应空格 / 方向键。地图高度扣掉固定顶栏，手机横屏按可用高度封顶。
- 两队阵容属于 Stage 两侧的有界车道；地图快捷条提供显眼的「收起名单 / 展开名单」，与 Display 共用 `uiPrefs.showRoster`，不改变选车、跟随或播放时间。收起后把车道宽度交还地图；2D 保持完整正方形，已受视口高度限制时不会强行拉伸或裁图。点玩家打开独立 Details，未选车时不预留详情列。
- 2D / 3D 的「一键防遮」复用 `usePlaybackPreferences`：开启后保留车型名，车辆替换为类型符号，并隐藏玩家名、装填条、状态装饰与轨迹；2D 同时保留环形血量，3D 沿用隐藏血条的呈现；再按一次恢复开启前的配置。预设是临时状态，不覆盖持久化偏好；手动更改显示选项则退出预设并保存当前组合。名单开关独立于预设。Display 保留「坦克类型图标」「状态标记」单独开关。
- 实际车辆和战术标记统一使用 `TankClassIcon.vue` / `utils/tankClassIcon.js` 的 LT 单菱形、MT 双分段菱形、HT 三分段菱形和 TD 倒三角；未知车型不猜类别，使用中性圆形。3D 类型符号由既有投影标签层呈现并可选车，场景只隐藏车模绘制节点，保留位置、可见性事实与拾取代理。手机短横屏把标记入口并入地图快捷条，保留 44px 触控区域。
- Display 与 Events 从 Gear 按需打开，Vehicle 由选车打开 Details；Events 只呈现
  `DAMAGE`、`KILL`、`DESTROYED`，点击事件执行 seek + pause，纯时间轴不承载事件标记。
- 标注工具默认折叠，绘图不暂停 battle clock。画标注时整层车辆不接指针（从车辆上起笔只画线、不选中车辆）；地图上的鼠标拖动（平移 / 画标注）不触发浏览器的文本 / 图片选择。Fullscreen 继续保持同一组件实例的
  current time、playing、倍速、选中车辆、zoom/pan、annotations 和偏好；移动端只对
  `screen.orientation.lock('landscape')` 做 best-effort 尝试，失败不阻断播放。
- Fullscreen 复用普通工作区的 HUD → Stage → Transport ownership，只更新可用容量与 safe-area。`test:browser-layout` 和 `test:browser-interaction` 用真实 Chrome 几何与交互断言覆盖桌面、平板、手机横竖屏和原生 fullscreen。
- `BattlePlaybackDataset.baseStates` 是后端 canonical 基地 transition：Supremacy 来自
  wrapper12/root11（`baseId=A|B|C|D`），Assault 单基地来自 wrapper8/root8
  （`baseId=BASE`）。Assault controlled 11.20 样本证明 progress 会真实广播到 `100`；
  当前只提升 progress 语义，`ownerTeam/capturingTeam` 保持 null，禁止从 wrapper8 field4 猜阵营。
  `assaultObjectivePresent` 是**目标族存在性**（wrapper8/root8 目标族出现即 true，与是否发生过占领无关；
  v0.3.11 字段契约补正）：有目标但全程无人进圈也必须是 true。field3 未出现时 `baseStates=[]`，
  仍按 mapCode 从 verified semantic 数据渲染静态 BASE，LEFT JOIN 可为空的 runtime state。
  canonical 显式 `progress=0` 必须保留在 timeline；presentation 将 0 视为 reset/idle：BASE 本体继续显示，但 2D/3D 的水位、进度环和百分比立即清空，后续正值可重新开始显示。无 runtime progress 时同样不画水位；`arenaBonusType=2` 仅表示训练房，不是 Assault mode。
  Malinovka 无占领与 Neptune 满占领共用泛化路径，不按地图名称分支。
  查询 UI 时间点时只消费 `timeSec <= currentTime` 的最新状态。前端不接触 raw protobuf update，
  不负责合并缺失字段或协议 index，也不合成进度或阵营结论。协议证据见
  `docs/research/replay/assault-base-state.md` 与 `supremacy-base-state.md`。
  Assault state authority 是 `BattlePlaybackDataset.baseStates`；2D HUD/地图与 3D HUD/贴地标记共用 `utils/baseStatus.js` 的 presentation 语义，3D 不新增 wrapper8 协议解析路径。
  前端另以 canonical `positionSegments` 的 OBSERVED
  samples 派生最近 2 秒轨迹：不跨 segment/AoI gap，不使用 LAST_KNOWN，不读取未来样本，暂停
  冻结、seek 重算、倍速只改变时间推进语义。

测试也按同一责任边界组织：地图/标记/手势、控制、时间线和详情面板分别由对应 focused
suite 覆盖，时钟与车辆投影由纯函数 suite 覆盖；共享 replay fixture 位于 testing-only
`playbackTestHarness.js`。`BattlePlayback.test.js` 与 `BattlePlayback.integration.test.js`
只保留跨组件/domain 的编排回归，避免把已由 focused suite 覆盖的 presentation 断言重新堆回编排器测试。

- **数据源**：`parseLocalPlayback` 本机生成；时间线不可用 → `dataset = null` → UNAVAILABLE
  （capability unavailable，不是解析失败）；解析失败 / 引擎不可用 → ERROR（可重试，不回退服务端）。
- **前端 V2-only**：`BattlePlaybackPanel` 本机生成 V2 dataset 并注入 `playbackV2`；
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

### 生命状态与复活轨道（issue #622，2026-10-15）

`lifeTransitions` 的生命语义分层：

- **上游复活轨道在场**（PlaybackData 车辆 `death_times`（≥2 死才输出）/ `resurrection_times`
  （非空才输出），上游 2026-10-15 additive）：它取代 prop3 采样扫描成为死亡/复活时刻 SSOT——
  死亡 → DESTROYED、复活 → ALIVE 交替，采样只兜底 ALIVE 证据。复活模式（爆燃等）同一 eid
  死亡后可复活继续移动，死亡不再是终态。
- **字段缺省**（旧上游产物 / 普通回放）：prop3 `alive=false`（终态，EXACT）→ DESTROYED；
  可信血量 / alive → ALIVE——行为与既往逐位一致（golden 锁定）。
- **血量判死两条路径（2026-10-16 裁决，上游 `wotbtools-cross-reference.md` §七）**：
  ①上游切面 `damage`/`health` 的 `hp_state`（v0.4.9 起恒在场）**在场即权威**——`terminal` = 负 i16
  终态哨兵**全族**（实测 0xFFFF −1:68 / 0xFFFE −2:1 / 0xFFFD −3:59，其余负值同编码；同族全部取值
  同一处理，禁按分布裁剪），`classifyHpRaw(raw, hp_state)` → `DEATH_TERMINAL`；
  ②**字段缺省（旧产物 / 旧 pin）= legacy 分类不放宽**——仅 `{0x0000, 0xFFFD}` 为终态，
  `0xFFFF`/`0xFFFE` 等仍是"未证明哨兵（血量与生死都未知）"，不作为死亡证据（存量语料把 0xFFFF
  记为 unavailable；缺省放宽会在旧产物上产生无旁证的死亡判定）。回归：−1/−2 档弹药架殉爆
  （实例 1910 局 Intotherainy `0xFFFE`）曾在 2D/3D 被判成存活（血量冻在最后正值、装填条继续外播）——
  守卫 `canonical/facts.hpTerminal.test.ts`（字段权威 + legacy 缺省两侧）+ scene 用例（含
  `hp_state=terminal` 的 0xFFFE/0xFFFF 行与"legacy 0xFFFE 不判死"反例行）。
  ③**同一分类贯通 AI 复盘**：`toClientAiReviewProjection` 的 `prop3Health` / `healthEvents` 正式
  携带 `hpState`（canonical 权威分类），Java 侧 `HpRawState.fromProjection` 在场即权威——2D/3D
  与 AI 复盘对同一事件的生命状态一致（不会再出现「2D/3D 阵亡、AI 复盘判存活」）。
- def 层（canonical 缺位时的 3D 回退）：`defLifeAt`（`utils/battlePlaybackV2.ts`）同规则直读
  PlaybackData 字段；爆焰按**死亡身份**（`destroyedKnownAtSec`）去重——同一次死亡的重复迁移
  只爆一次，复活后的新死亡各自爆焰。
- **血量在复活后先落未知**（`healthTransitions`）：复活时刻起、到该实体出现第一份**可用数值**血量证据
  之前，血量 transition 显式落 `currentHp: null`（展示层渲染「—」）——绝不把死前的 0 / 终态哨兵镜像
  当成复活后的现值；未知哨兵（`hp = null`，如 PROP3 终态 `DEATH_TERMINAL`）与终态 0 都不算"新证据"
  （`isPlausibleHp` 判据）。证据窗口 `[复活, t]`，不使用未来采样。守卫：`lifeTransitions.test.ts`
  的"复活后无新血量证据 → 未知边界"、"证据在查询时刻之后不得提前使用"与"复活时刻只有未知哨兵
  采样 → 边界不被跳过"用例。
- **每次死亡各一条 DESTROYED 事件**：battle-level `events` 的 DESTROYED 原先只来自 canonical 终态
  重建（每账号至多一条终态），复活模式会死多次——轨道在场（且给出 ≥1 死亡时刻）的账号改用轨道
  死亡列（**同账号多实体的死亡列合并、升序去重**），其余账号维持 canonical。2D burst 与 Event Panel
  因此**每次死亡各出一次**，KILL 仍只由 canonical 致死窗口的唯一攻击者证据给出（不伪造击杀者）。
  守卫：`lifeTransitions.test.ts` 的 `respawnDestroyedTimes` 用例（含同账号多实体合并）+
  `parseLocalPlayback.test.ts` 的"复活轨道注入"用例。
- **阵亡期断链（履带印）**：DESTROYED 期间与 AoI 空洞同语义——历史印记保留、复活后从**新锚**开始，
  不与死前锚连铺（否则跨阵亡期/复活迁移桥出一条长印记）。守卫：`playbackScene.test.js` 的
  "履带印阵亡期断链"用例（复活落在新位置时不出现长戳）。
- **复活后装回炮塔（3D）**：分离（飞头）只属于**它发生的那一世**——`detachmentAppliesNow` 让
  detached 轨道的摘除从首帧起、到该车下一次复活为止生效；复活后的新车装回炮塔（旧飞头实体自身
  照旧按自己的 coverage 渲染，它是独立实体）。若复活后的新死亡再次飞头，会有新的 detached 轨道
  （新首帧）重新接管。守卫：`playbackScene.test.js` 的"复活后装回炮塔"用例（失败态即复活后仍无炮塔）。

### 反未来信息泄漏（anti-future-leak，硬性 invariant）

> 在 UI 时间 `t`，任何展示出来的事实只能来自 `timeSec <= t` 的证据。这是 Battle Playback V2
> 的硬性不变式（canonical 解码器 / battle-start / BattleTimeline 不改——当时服务端的
> BattlePlaybackProjector 已随解析器于 2026-10-02 退役，现为客户端 `replay-local/playback/**`；
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

战局回放面板与 2D dataset 在同一次本机解析中生成 `MapOverview`（`toMapOverview`，地图档案取自
`common/map-semantics`）→ 前端 `MapOverview.vue` 纯 SVG 渲染热力辅助视图。
- 地图不可构建（未知地图 / 无语义网格 / 无观测）→ `overview = null` → 「无地图视图」。
- `routes` 聚合字段随服务端一起删除（没有组件消费）。

### 数据链路

- **数据源**：客户端 `frontend/src/replay-local/playback/toMapOverview.ts` 直接读
  `common/map-semantics/*.semantic.json` 的
  `playableBoundsMeters` / `analysisGrid.cells`(6x6) / `sceneEvidence.battlePoints`（出生点），
  并从本地解析产出的 `BattlePlaybackDataset`（客户端 canonical facts：
  `frontend/src/replay-local/canonical/facts.ts` 的位置流 / 伤害事件 / 实体→账号映射，
  经 `frontend/src/replay-local/playback/toBattlePlaybackDataset.ts` 投影）与结算 `Battle`
  （权威名册/阵亡时刻/地图名）聚合。原服务端 `MapOverviewBuilder`(web) / `MapGridRegistry`(core)
  与 `ReplayReconstructionService` 已于 2026-10-02 退役删除（`ReplayReconstruction` 模型类型仍在
  `wotb-core`，只服务 AI timeline 侧；`TeamEntityMapper` 同样仍在 `wotb-core`，只服务 AI 侧）。
- **坐标约定**：分析坐标与 `playableBounds` 同系——`x` = 地图横向 = 回放 x，`y` = 地图纵向 =
  回放 z（同一原点同一米制）；`playableBounds` 用于 6×6 分析网格、热力分桶与可玩区域判断。
  图片渲染边界独立为 `coordinateBounds`（地图图片对应的世界坐标范围，见「图片素材与对齐约定」）：
  `px = (x - coordinateBounds.xMin)/(coordinateBounds.xMax - coordinateBounds.xMin) × W`、
  `py = (coordinateBounds.yMax - y)/(coordinateBounds.yMax - coordinateBounds.yMin) × H`。
  分析网格坐标仍来自 `playableBounds`，绘制时经同一变换换算，因此只覆盖可玩区、不铺满整图。
- **标题三语**：`MapOverview` 携带 `displayNames{zh,en,ru}`（来自 `common/map_names.json`，
  未收录时三语同 code）；前端按 vue-i18n 当前 locale 取标题，缺失回退 `displayName`（en）。
- **模式与录像者**：`MapOverview` 继续携带 `arenaBonusType`（meta.json 原值；1=随机战斗，其他=训练/联赛等，
  未知为 null）与 `recorderAccountId`（客户端由上游 `author_account_id` 归一化，
  `frontend/src/replay-local/canonical/facts.ts`；服务端 Java `Battle.recorderResult()` 按昵称匹配）。
  录像者昵称由上游 Rust Core（pin `deploy/agent/source.json`）在 `parseResult.author_nickname` 提供，
  客户端 `frontend/src/replay-local/battleFacts.ts` 原样写入 `Battle.recorder`（导出「录像者」单元格用）；
  原 Java `ReplayParser.resolveRecorderNickname` 的「先精确匹配 roster 昵称、再按 clan+分隔符唯一匹配」
  归一化实现已于 2026-10-02 退役，客户端当前没有等价实现（注意：上游值可能是「军团-昵称」拼接，
  如冻结 golden `frontend/src/replay-local/__golden__/wasm-results.json` 的 `CHRD-A158布丁`；
  权威录像者身份以 `author_account_id` 为准）。这些字段仍供 Battle Playback
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
  - **位置上报区间口径（2026-08-15 修复）**：`positionSegments` 是 client canonical projection 标注的 AoI/position boundary；
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
    **时长契约**（`BattleTimelineBuilder.resolveDurationSec`，wotb-core timeline 层）：playback
    `durationSec` 四优先级 = battle_results root5 `settlementDurationSec`（finite>0，权威）→
    `RoundFinishedEvent`（method4/AFTERBATTLE）rawClock − battle 开始 rawClock（finite>0）→
    legacy `battle.durationS`（无 settlement 时即 `meta.json#battleDuration`，不可靠，常比真实战斗长）→
    最后有限事件时刻；前三档均 cap 420s。round-finished 严格优先于 meta，因此 meta 偏长时
    进度条按真实结束时刻收尾（不再在战斗结束时只走到一半）。全部 event/interval/
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
    由与 3D 共用的 `PlaybackVehicleLabel.vue` 呈现（team 文字色消费语义 token、
    无整卡不透明黑底、destroyed/last-known 弱化）；PlayerName 按实际像素截断（max-width+ellipsis），截断才有
    完整名 tooltip；碰撞纯函数 `utils/labelLayout.js`（screen px，仅 tank model box 参与，离开 viewport 时自然裁剪）——
    TankName 冲突**从下往上** greedy 上移让位（下方先 finalized、上限一行，3+ 连锁不重新产生
    overlap）、PlayerName 冲突经时间阈值（hide 250ms / show 300ms，`performance.now` **UI wall
    clock**——播放由 frame 刷新、暂停由轻量 RAF 继续推进，不依赖播放状态）隐藏/恢复（~120ms
    opacity fade-in，类保持完整生命周期不被下一次 resolve 取消）；PlayerName 盒从 final TankName
    盒推导（与共享 label 块整体位移一致）；zoom 结束由 computed
    依赖 view.scale 自然重算；点击命中使用 marker 真实位置上的小幅扩展 hit target（不参与视觉碰撞，
    不含 gun overflow/label/三角/菱形/✕；destroyed/last-known 仍可点），重叠时
    取指针最近车辆、距离几乎一致且已选中则保持、否则 render order tie-break；倍速含 0.5×；
    `loop` prop（QA 场景循环）。
    **坦克标记不做防重叠位移**（2026-10-16 用户裁定）：车体严格落在真实位置，密集处允许图标互相
    压盖（与 3D 一致——3D 从不移动车体模型）；早前"整盒推开 + 虚线 leader 回指真实位置"的 2D 布局
    已整体删除（`computeTankCollisionLayout`、`presentationOffset`、`.pb-marker-leader` 与
    `screenOffsetToSvgDelta` 一并移除）。名牌 / HP 的防重叠仍由本节的标签车道机制承担。
   - **全屏模式（原生 Fullscreen API）**：控制栏「⛶ 全屏 / 退出全屏」（i18n 三语 `enter_fullscreen`/`exit_fullscreen`）；
    全屏对象 = `.battle-playback` 根容器（地图 + 全部 controls + 标注 + 信息面板，不含页面 header/nav）；
    状态事实源 = `document.fullscreenElement === 当前根容器` + `fullscreenchange`（ESC/浏览器 UI 退出立即同步，
    禁止手工 isFullscreen=!isFullscreen）；`typeof root.requestFullscreen !== 'function'` → 按钮隐藏、
    点击不抛错（不实现 fake fullscreen）；进入/退出不 reset currentTime / playing / speed /
    selectedAccountId / zoom / pan / filters / label 偏好 / annotations（同一组件实例，仅容器变化）。
    尺寸响应：`mapSize` reactive（`mapSize = ref({w,h})`）由 `ResizeObserver` 观察 `.pb-map` 更新，
    无 RO 环境回退 `clientWidth`（`mapWidth()/mapHeight()`）；markerScreen / labelLayout（viewportW/H）/
    selectAt（hitTest 像素→内容坐标）/ textInputStyle / semanticPoint 全部经 mapWidth/mapHeight 读取
    → fullscreen enter/exit 后 collision / hitbox / 标注换算立即用新尺寸重算（禁止 magic delay）；
    zoom/pan 不自动 reset（无 auto-fit；Reset View 由用户使用）。全屏 `.battle-playback:fullscreen`
    复用普通工作区的有界 roster 车道与中央 HUD → Stage → Transport 栈；Details 是
    workspace 级浮窗，Display 锚定 Gear（竖屏 inline）。地图按真实宽高比 contain，无非等比拉伸，
    zoom 后可大于 viewport 随 pan/zoom 裁剪；HUD 与 Transport 占流式布局，killfeed 有界覆盖。
    生命周期：`fullscreenchange` listener 与 ResizeObserver 在 unmount 时移除/disconnect；组件在全屏
    中被卸载时仅退出自己拥有的 fullscreen。
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
   - **标记模式（2D 独立战术编辑，2026-10-08 更新）**：默认关闭且没有预置标记，优先展示真实对局过程。
     播放区的一级「标记模式」按钮打开工具并暂停，默认选中「选择」，不会因点击地图误画；退出不自动播放，
     主动播放会退出编辑并保留已完成标记。标注仍为纯前端临时状态，不持久化、不调后端，不与 3D 互通——
     刷新/切文件/卸载战局回放即清空（切文件经 `watch(overview)` 重置，同时关闭编辑）。
     工具栏同级提供 LT / MT / HT / TD（坦歼），用共享实心兵种符号、虚线圈及「计划」标签与真实车辆区分；
     路线按地图点击添加途经点，至少两点后点「完成路线」或 Enter 提交，Esc / 取消按钮丢弃草稿。
     这些路线表达用户战术意图，不是车辆实际行驶轨迹。选择后可拖动整体移动，兵种/路线/文字可改名，
     所有对象可改色、删除、撤回；属性只在选中时显示在工具条内，不设常驻右侧栏。
     保留画笔/橡皮擦/箭头/直线/矩形/圆/文字 + 9 色固定色板（含纯黑）+ 粗细（1–12）+
     撤回/重做/清空/显隐。模式外保留原有平移/选车；模式内车标不抢点击，双指捏合和滚轮缩放保留。
     第二指加入或 pointercancel 取消当前单指编辑，避免捏合意外生成标记；输入框和 IME 合成不劫持快捷键。
     几何一律存 **语义坐标**（x=回放 x，y=回放 z），经既有 `createMapView` / 地形投影渲染；
     没有引入第二套 ReplaySession、parser 事实或持久化 schema。手机横屏（含全屏）工具条为一行横向滚动，
     退出固定靠左、路线完成和选中属性优先显示；开启期间暂收起播放控制/时间轴与入口行，为地图保留高度，
     HUD 仍显示当前时间；退出恢复同一播放器控件及暂停状态，不清除标注。竖屏和桌面仍保留完整播放控制及分行工具。
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
    client playback projection 在 HealthTransition 上直接投影的 `relativeFull` fact，敌方无 evidence 为 UNKNOWN。
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
  **AI 报告时间**：AI 复盘中的 `03:20` / `3分20秒` 等时间仅作为证据定位文本展示，不承担
  Playback seek / capability handoff。Replay Workspace 当前明确解耦 AI 与 2D/3D Playback；
  若未来统一交互，再由工作台级 player state 提供单一 seek 语义。
- **阶段切片**：opening = OPENING + FIRST_CONTACT 合并；mid = 中间段；late = 战斗末
  `BattlePhaseSummary.DENSE_KILL_WINDOW_SEC`（15s）窗口（残局）。
- **降级**：未知地图 / 无语义网格 / 无名册 / 无观测 / 视角未解析 → `mapOverview = null`，
  前端不渲染（本机投影返回 null 并显示不可用提示）。

### 图片素材与对齐约定

- **素材唯一权威在前端**：`frontend/src/data/mapImages.js`（mapCode → 图片资源 + 尺寸）既是
  渲染门控也是唯一素材源——该地图无素材时整块跳过、不画示意图；后端 `MapOverview.image` 恒
  null（兼容字段，不维护第二份目录）。
- **新增素材流程**：图片按英文展示名小写中划线放入 `frontend/src/assets/maps/`（如
  `normandy.webp`）+ `mapImages.js` 加一行（key 用内部 code，如 `neptune`）+ 更新
  `docs/reference/maps.md` 主表。完整映射（内部 code ↔ 展示名 ↔ 语义 mapId ↔ 素材）见
  `docs/reference/maps.md`。
- **对齐依据**：每张图片在 `frontend/src/data/mapImages.js` 配置 `coordinateBounds`——来源为对应
  `map-semantics/*.semantic.json` 的 `coordinateSystem.worldBounds`（当前 29 张已登记图均为
  -300..300，即完整世界坐标截图；新图以各自语义 JSON 为准，逐图校准）。渲染统一用
  `coordinateBounds`，不得用 `playableBounds` 铺满图片（会越靠近边缘偏移越大）。无
  `coordinateBounds` 的旧配置按兼容策略回退 `playableBounds`。

### 2D Local / 3D Remote 运行时渲染契约

- 2D 底图来自 `frontend/src/assets/maps/*.webp`（由 Agent 仓 asset_pack `ground.webp` 按冻结配方派生，WebP q90；来源与配方见 [reference/maps.md](../reference/maps.md) §2026-10-16），由 `mapImages.js` 静态 import 随站点发布；当前底图 intrinsic raster resolution 为 1254×1254。它只描述文件解码像素，不等于页面的 logical map frame。
- **3D 地面贴图四档统一 = `map`（`ground.webp`，±300 全幅契约）**（2026-10-16 用户裁定）：此前最低档用资产面 `res=mini`（客户端 HUD 小地图）省流量，实测它覆盖约 620 m——比 ±300 契约框多出**外围一圈**（水面/场景在 Landscape 框外侧），按 600 m 铺会把内容压缩约 3% 并把圈外内容摊进边界；2D 底图同框 ⇒ 低档地面与 2D 地图
  必然对不上。现四档同源，低档的带宽代价（4096² ground 而非 512² mini）如实记录，路由守卫见
  `playbackScene.test.js`「地面贴图四档统一用契约化的 `map`」。数据面背景见 Agent 仓 Agent 仓 `docs/game-data-sources.md` §5.7。
  Android 上该 URL 还可能被运行时更新通道顶替（包内兜底 + 在线校验：sha256 判据、下载校验、失败回落包内；规则见 [reference/maps.md](../reference/maps.md) §2026-10-16、实现见 `frontend/src/data/map2dOverlay.js`），因此 intrinsic 尺寸仍为 1254×1254 但不保证像素与包内那份相同——坐标契约不变。
- `mapImages.width/height` 保持既有 logical/render-frame dimensions（约 754–783），由 `createMapView()` 生成 `mapView.W/H`，作为 `coordinateBounds`、terrain projection、SVG `viewBox`、车辆/基地/轨迹/标注及 pointer conversion 的共同坐标空间；不得用图片实际像素替换。
- Battle Playback 的 2D 底图由 `BattleMap.vue` 的独立 `.pb-basemap` HTML `<img>` 渲染；`.pb-svg` 承载 vector overlays，`.pb-markers` 与两者共享同一个 `.pb-viewport` camera frame。底图和 SVG 按 `mapView.W / mapView.H` 的 frame `fill`，保持既有 overlay 对齐。
- 运行时 raster capacity 以 `requiredDeviceWidth = renderedCssWidth × view.scale × devicePixelRatio`（height 同理）诊断。`naturalWidth / requiredDeviceWidth` 小于 1 表示源分辨率不足；维持现有 1×→4× camera contract，不用滤镜弥补源图细节。
- 3D 模型、纹理及地图资产继续经 `frontend/src/scene/assetProvider.js` 读取 remote asset origin（生产 COS），与 2D 本地静态底图分开。2D 底图资源更新不改变 3D provider、缓存策略或资产托管。
- 3D 回放运行特征（2026-10-03 性能批）：解析在 Worker 内跑（`scene/playbackParse.worker.ts`，
  失败自动回退主线程），同一文件（名+长+mtime+采样指纹）的解析结果缓存最近 3 场；渲染按需刷新
  （暂停且无在飞特效、相机静止时不重绘）；**伤害数字与车辆标签同在 HTML 覆盖层**（数字是血条
  右侧的 DOM 文本，尺寸 / 漂移是屏幕空间常量，不再有第二个 WebGL 上下文、也没画布贴图池），
  战斗特效（曳光/光迹/开火/命中/爆炸/残骸烟）由 `scene/battleFx.js` 合批与池化，仅在会话结束时
  整体 dispose；资产加载有限并发（`ASSET_CONCURRENCY = 4`，地表贴图与坦克 GLB）；
  HUD/进度条/名册按 ~10Hz 写 store（3D 平滑度来自场景时钟，seek 时立即补写一次）。
- **3D 击毁车辆视觉**：复用原车模，死亡后 0.30 秒开始去饱和和压暗，0.80 秒完成
  哑光炭灰残骸状态，保持到回放结束。完全去饱和，在显示颜色上取原明度的 45%，
  再加 0.035 的暗部提亮，保留阴影里的装甲与履带细节；弱化金属反光（metalness 降至原值的 5%）、提高
  roughness（至少 0.90，封顶 1），emissive 归零。低模和 GLB 同一语义，原装甲/履带
  细节及透明度保留；作者标记环、标签与爆炸独立。倒带恢复原参数，不增加车辆
  残骸资产、贴图、几何或 draw call。
  模型、名牌与名册共用 canonical `lifeAt` 的死亡判据；canonical 时间以 `clock.startRaw`
  换算到场景 raw 秒，禁止用 HP=0 推断死亡。canonical 未就绪/失败时沿用场景权威
  `death_t`；canonical 已就绪但缺生命事实保持未知；已确认死亡但无死亡时刻直接显示终态。
  同账号实体重入时，生产者与场景共用 canonical 首次身份观测和「最新已出现实体」规则，
  不按 eid 数值排序选实体。`LocalPlayback.entityStartsByAccount` 是工作台内部的 battle-relative
  身份证据，不进入 HTTP dataset；解析只构建一次 canonical facts。死亡按实际死亡时刻归属，
  禁止广播给历史／未来实体；同刻首次观测或缺失而无法唯一归属时保持未知，不显示残骸或爆炸。
  旧本地会话没有身份证据映射时仅以已记录 coverage 使用同一选择规则。
  过渡只按回放时间求值，暂停、倍速、seek 和 GLB 迟到/重开均在当前时间投影。
  GLB 每车只克隆材质、同车复用原材质对应的副本；共享模板纹理/几何不由车辆释放。
  材质 shader 组合既有坦克光照补丁，渐变只改 uniform/PBR 参数，不逐帧重编译。
- **3D 战斗特效（2026-10-13 写实化，只作用于 3D；2D 激光炮线与 2D burst 不变）**：
  外观、档位预算与 GPU 资源唯一 owner 是 `scene/battleFx.js`；`playbackScene.js` 只负责时序
  （事件泵、seek 语义、生命判据）。所有 billboard 粒子每帧按「特效年龄 → 外观」纯函数写进两个
  实例化批次（加色一批、普通混合一批且按视深从远到近排序），火星拖尾一个 `LineSegments`，
  曳光与光迹是相机朝向条带；自定义 shader 手挂 logdepthbuf 代码块、`toneMapped=false`、保留深度测试、
  不写深度。图集为 4×2 程序化 alpha 贴图（火焰 / 烟 / 光晕 / 星芒 / 碎片），不引入外部资产。
  - **飞行中炮弹 = 阵营色曳光**：白热弹头 + 阵营色渐隐尾迹（14 m，沿折线弧长回退）+ 弹头光晕；
    颜色沿用 `TRACER_FRIENDLY / TRACER_ENEMY`（未知阵营白色）。飞行段时长仍是真实 `flight_secs`。
  - **弹道光迹**：阵营色细线、柔边、整段等宽（不透明度 0.62），弹头飞过才显现（折线逐段显现），
    弹头走完全程后停留 2.5 s、再 1.5 s 淡出（**回放时钟**：暂停时一直留着，seek 清空）。
    曳光与光迹都有屏幕像素宽度下限（弹头 2.4 px / 光迹 1.6 px），拉远看全场不会细到消失。
  - **开火**：炮口前喷火光 + 星芒；均衡及以上加制退器侧焰，高清 / 极致加炮口烟（3 / 6 团）。
    回放记录的开火起点在火炮枢轴（炮塔 / 炮盾里），炮口特效改放在炮管末端：把射手车模临时摆到
    **开火时刻 `t_fire`** 的姿态（`poseGlbRig`：根位姿 + 炮塔 / 炮管，纯时间函数，不碰悬挂积分），
    取炮管节点（`gun_NN`）网格包围盒沿弹道方向的最远投影（`muzzleTipOf`），把起点沿弹道推过去，
    量完摆回本帧 T。处理帧总是晚于开火（掉帧 / 倍速），按 T 时刻的炮管量会把开火后的车辆位移混进
    固定弹道的起点（PR #613 审查：10 m/s 射手、100 ms 帧，1×/2×/4×/8× 起点 5/6/8/12 m，应为 4.5 m）。
    没有可见车模（代理车 / 兵种图标）或投影不在 0.3–15 m 内时用记录起点。同一段距离也是
    曳光与第一段光迹的可见起点：弹头没出炮口时不画曳光和弹头光晕，曳光尾部、光迹起点都不早于炮口
    （否则光迹会贴着炮管露出一条线）；弹道折线与计时不变，贴脸射击（抵达点在炮管长度以内）整段不画。
  - **命中**（替换旧白球 + 圆环，`impactKind` 分型不变，脱靶 / 未知结果不生成）：击穿 = 小火光 +
    橙色余火 + 暗烟；未击穿 = 亮白火花回溅 + 中灰烟；跳弹 = 火花沿出射段方向划过 + 淡烟。
    命中在弹头**抵达命中点**（`legEnds[0]`）时触发一次，跳弹弹头继续沿出射段飞。
    命中特效有**屏幕尺寸下限**：应用相机最近也在视点 `max(20 m, 地图尺寸×0.08)` 之外，按世界尺寸
    画的 2 m 火光只有十几像素、余火与烟几乎看不见（2026-10-13 实机近景）。参考尺寸 2 m 至少占
    56 px，镜头拉远时火光、余火、烟、火星的大小与散布等比放大，最多 3 倍；离得近时保持世界尺寸
    （与曳光 / 光迹条带的像素下限同一思路）。命中点就在车体表面，面向相机的火光 / 烟四边形会有一半
    插进车体被深度测试裁掉（实机近景里暗烟完全看不见），所以命中火光、余火与烟沿视线朝相机挪半个
    粒子尺寸：屏幕位置不变，只把四边形从车体里拉出来。单团烟贴图平均不透明度只有约 0.2，暗烟叠在
    深灰车体上读不出（像素回读：命中点附近中位只压暗约 13/255），所以每团命中烟再叠一层 0.6 倍的
    同心烟芯，颜色取深灰（击穿）/ 中灰（未击穿、跳弹）。
  - **击毁爆炸**：权威死亡触发一次（`buildBurstSources`，不要求击杀归属；先投影当前位姿和可见性，
    coverage 结束后也不跳过）。强闪光（0.22 s）+ 压扁的地面光斑、湍流火球（约 0.3 s 胀到约 6–7 m，
    1 s 内由白热转暗红）、带火光的浓黑烟柱上升、抛物线火星；高清 / 极致加碎片，均衡及以上加贴地尘浪
    （柔边团块，不是硬圆环）。壁钟寿命 4.2 s（3D 专用常量，不再由 2D 的 `BURST_MS` 推导），
    暂停后自然播完；seek 清空、不补播，canonical 晚到只安排未来事件。
    烟的颜色偏深、峰值不透明度高（爆炸烟 0.95），是按亮色白天地图（幽灵工厂）真实回放
    截图调的：浅色暗淡的半透明烟在沙地 / 草地上几乎看不见（2026-10-13）。
  - **残骸持续烟**（高清 / 极致）：是否存在由场景唯一死亡判据 `sceneLifeAt` 按回放时间判定
    （死亡 1.4 s 后渐入、倒带到死亡前立即消失；未知死亡时刻按已渐入处理），翻滚相位只在播放时按
    壁钟累计（倍速不加快、暂停冻结、不触发额外重绘）。极致档另有发动机舱余火，死亡后约 10 s 内熄灭。
    烟柱约 10 m 高，底部炭黑、顶部转灰；烟团大、底部不透明度接近 1、相邻烟团上下重叠，连成一根烟柱。
    烟贴图中心 alpha 只有约 0.6，稀疏摆放时实机亮图远景只剩一层看不出的薄灰（像素回读峰值只压暗
    约 1/3），单测锁定"底部 alpha ≥ 0.8、相邻烟团间距 < 半个烟团高"。
  - **独立炮塔**：新解析产物的 `detached_turrets` 提供炮塔实体、权威车辆归属、可见区间和位置 / yaw / pitch / roll。
    实体首次已知后，原车模的选中炮塔及炮管隐藏；同一组模型部件以炮塔枢轴为原点，按独立实体的完整位姿
    飞行、落地及后续移动。低模保持同一分离语义。直接 seek、倒带、暂停、倍速、GLB 迟到及模型开关均由
    回放时钟确定；AoI 缺口隐藏独立部件，不跨缺口插值。旧产物缺少字段则保持完整原车模。
    飞头实体是呈现依据，低血量、HP=0 或普通击杀不单独触发；不能由飞头反推弹药架殉爆死因。
    样本协议范围为 11.20：本机 77 场回放中 83 次 class-8 创建的 owner 均对应真实车辆，私人回放不入库。
    解析由上游 v0.4.7 起提供，本仓正式 pin 为 v0.4.9；观感由用户在真实资产和 GPU 上验收。
  - **画质档位预算**（`QUALITY_PRESETS[k].fx` 引用 `FX_BUDGETS[k]`；信息类元素四档都有，氛围元素按档裁剪；
    批次容量封顶，满了按「命中 → 开火 → 爆炸 → 回放驱动粒子」的优先级丢弃）：

    | 元素 | 流畅 | 均衡 | 高清 | 极致 |
    |---|---|---|---|---|
    | 粒子批次容量（加色 / 普通各） | 256 | 512 | 1024 | 1536 |
    | 曳光弹头 + 弹道光迹、命中火光、爆炸闪光 | ✓ | ✓ | ✓ | ✓ |
    | 炮口：制退器侧焰 / 炮口烟 | — / 0 | ✓ / 0 | ✓ / 3 | ✓ / 6 |
    | 命中火花 / 烟 | 6 / 0 | 10 / 2 | 16 / 4 | 16 / 6 |
    | 爆炸火球 / 黑烟柱 / 火星 | 5 / 6 / 16 | 8 / 10 / 32 | 11 / 16 / 56 | 14 / 20 / 80 |
    | 爆炸碎片 / 地面尘浪 | — / — | — / 10 | 12 / 16 | 16 / 20 |
    | 残骸持续烟 | — | — | 10 团 | 14 团 + 余火 |

  自动回归覆盖：档位预算单调、各元素按档出现、确定性、容量与优先级、批次排序、条带屏幕像素下限、
  材质直出与 logdepth、资源只释放一次（`battleFx.test.js`）；场景生命周期里的开火 / 抵达命中 /
  光迹回放时钟停留与淡出 / seek 清空 / 跳弹抵达即命中 / 高清档残骸烟随生命事实出现与倒带消失 /
  暂停不额外重绘（`playbackScene.test.js`）；真实 Chrome 着色器编译（含 logdepth，
  `node scripts/check-scenery-shaders.mjs`）。四档观感、亮 / 暗图、近远镜头与手机帧率由用户在
  真实回放中验收。
- 3D 顶栏双方总血量（2026-10-03 补回）：`scene/teamHpTotals.js` 按各队 `max_hp` 汇总剩余量与
  上限（未知阵营不计入任一方，unknown ≠ enemy），`playbackScene` 在 HUD 节流写 store，
  `Replay3DPane.vue` 顶栏第二行渲染「数值 + 阵营色条夹住比分」；数值用完整整数（§11 禁止
  1k / 22.3k 缩写），条宽用原始百分比保证平滑。顶栏与基地状态条同列堆叠，高度随内容变化。
  **整行是单一阵营视角**（`friendly_team` = 录像者一方）：左侧血条 = 己方，中间比分左 = 己方
  ——击杀计数在内核里是物理队伍（score1 = team 1），上屏前经 `perspectiveScore()` 映射成
  `scoreFriend/scoreEnemy`（`friendly_team = 2` 时交换），否则会出现「己方血条 + 对方比分」的错位；
  `friendly_team` 未知（≠ 1/2）时**不建立视角**：比分与两队血量一律 0 / 0（与 `pointsAt` 同为
  fail-closed，unknown ≠ enemy），不得把物理 team1 当「己方」上屏再染成 ally / enemy 两色。
- **队伍身份与 Recorder 视角**：`team` 保留物理队伍身份，`friendly_team` 只用于呈现关系。
  2D / 3D 名册均将己方放左、敌方放右；录像者属于 Team 2 时交换车道。名册 HP、圆点与
  行边框使用 `--color-team-ally` / `--color-team-enemy`，未知视角使用中性色，未知阵营独立分组。
- **3D 名册行状态在时刻投影**（`scene/rosterState.js`）：静态身份（eid / team / 昵称 / 车型）在会话
  开始时建一次；运行时状态（`hp` / `maxHp` / `dead` / `followed`）由 `projectRoster(vehicles, t, isDestroyed)`
  按当前回放时刻**纯函数**投影（死亡 resolver 与模型/名牌共享）（`reload` 复用场景的 reload resolver），`playbackScene.updateRoster()`
  只写变化过的字段；行由与 2D 共用的 `PlaybackRoster.vue` 呈现（见 `docs/frontend/replay-workspace.md`）。
  **写入必须经响应式代理**：`store` 是 `reactive()`，eid → 行索引登记的是读回 `store.roster` 得到的
  代理，不是建行时的原始对象——改原始对象 Vue 收不到通知，名册会停在满血，直到选中行之类的无关
  状态碰巧触发重绘（2026-10 线上故障；名册改经 computed / 子组件渲染后，不再有整页重绘替它掩盖）。
  **投影节拍 = HUD 节拍，不逐帧**：随 T 变化的投影只在 `writeHud()` 越过 ~10Hz 节流闸后运行，与顶栏
  总血量同帧写入（两者永远是同一个 T）；reload resolver 每次返回新数组，逐帧投影会让名册每帧重绘。
  seek / 会话开始 / 停播（暂停、播到终点）由 `writeHud(true)` 强制补一次——之后没有帧在跑，不补就停在
  节流窗口里的旧值。跟随目标（`followed`）变化由 `setCam()` 同样以 `writeHud(true)` 补写
  （`setFollow()` 也经由它），暂停时切跟随相机也立即可见；名册只经 `writeHud()` 投影，播放中也不会
  跑到顶栏前面。
- **响应式名册**：desktop / 大 tablet 的 normal 7v7 与 unknown group 在 root 内完整可见，
  不与播放控件重叠、无 team/lane 独立滚动。phone 与短视口不保留左右常驻名单，
  改为 Display → Roster 临时 surface；打开 Roster 即关闭 Display，dismiss 后完整场景立即恢复，
  不预留场景高度。受限临时 surface 可作为一个整体滚动，不能给两队分别建滚动区。
  `uiPrefs.showRoster` 控制呈现可用性；隐藏不清空 roster data、selected、follow 或播放状态。
- **选择与相机分离**：2D marker、3D raycast 与 roster 行都只选择车辆并打开共享
  `VehicleDetailsPanel.vue`；3D 场景通过 selection callback 上报，由 Pane 持有 selectedEid。
  选车不移动相机、不自动 Follow；Follow 是显式相机命令，Free/Top 不清选中。
  详情共用 identity/HP/time 契约，portrait、last-known、destroyed-at、stats、track inspector、
  damage log 使用 canonical track（含装备、物资、消耗品状态）；3D 缺失字段不写假零。phone / 短视口详情临时覆盖，不占永久场景空间，
  关闭不重新解析、不重建 Three.js 或加载资产。
- **共同 phone/fullscreen 契约**：`usePlaybackPhoneForm()` / `PLAYBACK_MOBILE_QUERY` 同时驱动
  2D/3D compact transport、toolbar hierarchy、临时名册/详情和 safe-area；3D 根 `.phone-form`
  将状态传给 CSS。390×844 → 844×390 coarse 仍保持 phone，触屏 tablet 不因 coarse 独自变 phone。
  `usePlaybackFullscreen` 的状态是当前 target 是否拥有全屏；2D/3D 同时挂载时只 owner 为 true，
  外部退出后同步为 false。只有 phone 进入自己的全屏尝试 landscape，tablet/desktop 不强制方向。
- **共享 2D / 3D 名牌**：`PlaybackVehicleLabel.vue` 统一姓名、车型、HP 数值/百分比/血条、
  装填分段及 destroyed/last-known 视觉。`VehicleMarker.vue` 消费同一组件并负责 2D marker
  位置与标签碰撞；`PlaybackVehicleLabels3D.vue` 将同一组件放在相机投影的屏幕 anchor 上。
  `usePlaybackPreferences` 是模块级唯一 reactive owner，所有存活的面板消费同一份
  `labelPrefs.showPlayerName / showTankName / showReload` 与 `hpPrefs.showHp`；默认昵称关、
  车型/血量/装填开，旧持久化 key 与迁移语义保留。任一面板改变偏好，另一面板立即观察到。
  名牌直接使用语义 CSS token，不铺整卡不透明黑底，字体保持屏幕空间可读大小，长名称受限截断。
  3D 车辆标签不再创建 CanvasTexture/Sprite；**伤害数字同样在 `PlaybackVehicleLabels3D` 的
  HTML 覆盖层里**（同一层、DOM 顺序排在所有名牌之后）：出生点是该车 **HP 血条右缘 + 8px、
  垂直居中于血条**（`measureDamageLayout` 只读血条 / 名牌 DOM 几何，不存在世界↔屏幕换算），
  不覆盖血条、不被姓名/车型/装填条遮挡。**几何缓存的是"相对名牌锚点的偏移"（dx/dy/textW），
  屏幕位置每帧用当前 `anchor.x / anchor.y` 重算**——车辆与相机移动时数字跟着血条走，resize 或
  出屏（`projected === false`）立即隐藏，不存在被冻结在旧坐标的数字；偏好 / 行开关 / 图标模式 /
  名牌内容发布（10Hz）变化才按布局签名重新量一次，不逐帧读 `getBoundingClientRect()`。
  生命周期内漂移 20×24px 并只在后半程淡出（CSS 动画，固定 px 字号 + 深色描边 token，远近缩放与
  自由/跟随/俯视镜头下屏幕尺寸一致）；**漂移方向按所在侧取号**（右 → +20px，左 → −20px），
  镜像后不会重新漂回血条。回退链：血条关掉 → 名牌块右缘同一规则；整块名牌关掉或**真实 0×0
  空名牌**（姓名/车型/HP/装填全关且非图标模式）→ 落回名牌锚点上方（`labelLiftWorld` 抬升的
  车体上方）；车辆出屏/不可见 → 不显示。同一辆车连续受击按 20px 槽位错开，避免多个数字完全
  重叠；贴屏幕右缘放不下（**含整段漂移行程**，不只出生帧）时镜像到血条左侧，两侧都不够时仍取
  右侧，不被 viewport 裁切。掉血事件跨过播放时钟时由场景
  `spawnDamage(eid, hpLoss, FLOAT_DMG_MS × FX_SCALE)` 生成一次（与 2D 同一组寿命常量），
  seek 由 `clearDamages` 清空且不补播；每个数字的 `animation-delay` 存活期间稳定（首次挂载为 0，
  只有 showStatus 关→开的真实 remount、showStatus 关闭期间出生后的延迟首次挂载、H 隐藏→恢复或出屏→进屏（含出生时在视野外的延迟首次可见）时按 `performance.now() - bornMs`
  补偿相位），rerender 不会重复快进 CSS 动画；remount 同时恢复所在侧的漂移方向。H 只隐藏视觉，
  不暂停或延长生命周期，到期仍由原始 `bornMs + durationMs` 决定。
  场景按帧投影 world position，隔离的轻量 DOM bridge 只更新 anchor transform/visibility，
  内容状态按 HUD cadence（约 10Hz）发布给标签子组件，seek 立即刷新，不驱动整个
  `Replay3DPane` reactive tree。背向相机、出屏、未可见车辆隐藏，既有遮挡语义保留；
  标签 overlay 的空白区域不截获场景 pointer 输入。
- **共享装填求值**：2D 的 `parseLocalPlayback` 从本地 WASM `parsePlayback` 结果保留独立
  `reloadTelemetry`，经面板传给 Playback；3D 消费同一上游 PlaybackData 字段。两者都调用
  `scene/reloadBar.js#createReloadStateResolver` 的 `reloadStateAt(vehicleId, time)`，
  基于当前 playback time 确定性重建，暂停不漂移、前后 seek 结果相同。
  只解释已闭环的本方遥测与 magazine 相位；敌方、未知 relation 或无遥测时隐藏装填，
  不根据车型/射击推算，不提升为通用 ReplayFacts，也不扩展 HTTP dataset schema。
- 3D 回放下方工具栏右上角支持收起／展开，默认展开。收起后仅保留恢复按钮，播放继续，进度、倍速、选车和相机保持；切换文件恢复展开，全屏和视口变化保留状态。此开关独立于“隐藏全部 UI”。
- **3D 显示控制**：`Replay3DPane` 工具条的「显示」面板锚在 `.pb-root` 右下角（**不参与工具条布局**
  ——让它撑高 `.controls` 会把底部控件顶到半个战场、把阵容车道挤出界），可分别开关顶栏 / 名册 /
  击杀流 / 基地条 / 四类标签行 / GLB 车模，并提供「隐藏全部 UI」（`H` 键等效）。
  按钮与 H 都调用同一 `setUiHidden()` 转换；进入隐藏模式立即关闭 Display，隐藏顶栏、名册、
  击杀流、基地、车辆标签、播放控件、结果 banner 与其余呈现 overlay，只保留右上角恢复按钮。
  恢复后原有结果 banner 重新显示（底层 state 不清空）；输入框/按钮等交互目标不触发 H。
  该状态**不写入持久化偏好**，刷新即回到常规界面。
- 3D 车体位姿：yaw/pitch 取自渲染滤波网格；**横滚取网格新增的 `vehicles[].hull_roll`**
  （上游 2026-10-03 起产出，additive；值来自原始 type=10 volatile 采样的最近邻——滤波层不输出侧倾）。
  消费端镜像约定：游戏系→场景系是「x 取负」的镜像，故 yaw 与 roll 取负、pitch 不变；
  旧产物缺 `hull_roll` 时按 0 = 水平（不拿 pitch 顶替）。
- 3D 场景内核 `frontend/src/scene/playbackScene.js` 是上游冻结 Agent 前端的**同源分叉**：上游已停止维护，
  本仓按需移植其场景渲染实现（材质实例去重、叶卡/伪透明/水体管线、曝光修整等，
  见 `scene/sceneryMaterials.test.js` 的源码级接线守卫）。上游若有新的渲染修复，需要人工比对移植，
  不会自动同步。
- **场景渲染向客户端对齐三则（2026-10-09；逐条依据见上游 `WoT-Blitz-Agent/docs/map-render-align-audit.md`）**：
  ① **天穹恢复**：此前整节点 `visible=false`（背景纯色），现按客户端 `skyobject-materials` 语义走
  `makeSkyMaterial`——顶点 `w=0` 丢弃平移（网格坐标是**方向**：多数图天穹网格半径仅 ~10m，当普通几何渲染
  只是地图中心一个小球）、深度钉远平面、unlit、不参与雾；`frustumCulled=false` 必须关，否则镜头一转天就整片消失。
  **判据 = 材质 `extras.sky`（导出器按客户端 `Skyobject` 模板写入）**；旧包没有任何 sky 标记时才退回
  节点名 `/sky/i`，避免名字含 sky 的非天穹对象被误判。俯视烘焙 `bakeDropNode` 用同一标记（SSOT）。
  云的 flowmap 动画待上游导出器补 flowmap 槽与 `flowAnimSpeed/Offset` 后接。
  ④ **变体裁剪 fail-closed（2026-10-18）**：GLB 里存在 `mdVariant` 节点、但当前 `map_id`
  没有可用激活映射（映射缺失或 id 不在映射）时，隐藏**全部**带标记节点并告警；旧行为 fail-open
  全量渲染会让 Dead Rail/Middleburg 等 9 图出现游戏里不存在的幻影布景。导出器在组数/注册表数
  不一致时写 `scene.extras.variantMappingIncomplete`，消费端仍以“有标记节点”事实兜底。
  ⑤ **BLEND 语义标记（2026-10-18）**：导出器给所有 `alphaMode=BLEND` 材质写 `extras.alphaBlend`；
  消费端的“opacity≈1 伪透明→不透明+裁切”启发式只作用于无标记的旧包材质，新包按真混合渲染。
  ⑥ **资产失败状态（2026-10-18）**：地面/地形/场景/光照等 404 或解析失败写入
  `store.assetIssues` 并置 `store.assetDegraded`，不再只打一行 console 就把该段计为“加载完成”。
  ② **场景 GLB 贴图各向异性**：按画质档 `Q.anisotropy` 逐纹理设置一次（此前场景侧漏设=默认 1，掠射角
  发糊闪烁；地面早就设了）。③ **法线用几何 authored NORMAL**：删掉 `flatShading=true`（它让渲染器改用屏幕
  导数现算面法线，把导出器 v0.4.1 起随导的 authored 法线整条作废）。俯视烘焙页与内核共用同一材质约定，
  已同步；**下次重烘前均衡档底图仍是旧观感**（差异仅限曲面明暗：天空不参与俯视、各向异性在正交俯视下无影响）。
- **贴地薄构件走廊强制细分（B 方案，2026-10-14 用户裁定）**：贴地薄构件（铁轨基板这类，0.3 m 厚、钢条
  净空仅 0.15–0.19 m）在远视距会被自适应粗格插值抬过顶面盖住（`PrepareSubdivision` 的判据只约束**相对**
  误差 ≤ 0.014·d·tanFovY；真图实测 200/300/500 m 机位 rails_002 覆盖 1.8/7.0/72.7%、rails_005 0/0/70.6%），
  被盖处露出的地形在客户端 colormap 里本身很亮 ⇒ 用户看到"拉远后部分铁轨被白色盖住"。
  实现：**类判据筛件**（世界 AABB 高 ≤ 2.5 m 且底面贴地形真值、排除 `extras.water` 水面/水下片——统一
  适用于每个网格，不做逐件统计判定；跨图验证：medvedkovo 的同类件是 lightmap 类，故判据不能绑材质标记）
  → 按三角形沿边以 ≤1 texel 采足迹 → `terrainMesh.buildRefineMask`（`?debug=1` 下
  `window.__terrainRefineMask` 报告命中件数与 texel 数）→ `buildAdaptiveTerrain({ refineMask })`：命中补片
  **强制细分到最细层（1 texel）**，**不改任何高度值**；廊外层级与客户端口径一致，无裂缝口径保证不外扩，
  掩码命中补片的同胞补片按客户端三条判据在更细层级重新判定。实测代价：forgecity 掩码占全图 1.57% texel、
  五条轨在 200/300/500 m 的钢条覆盖全部 → **0.0%**（四边形 33.5k→47.1k / 27.5k→42.9k / 19.3k→35.8k）。
  ⚠️ 这是 2026-10-11「只对齐客户端」之后一次**有意偏离**（与该轮撤销的"让位掩码/脚印细分"不同：这里既不改
  高度值、也不全局改判据，只让走廊块分辨）；回归锁见 `terrainMesh.test.js`（掩码内必到 1 texel、掩码前被盖/
  掩码后不被盖、不传掩码时逐字节一致）与 `sceneryMaterials.test.js`（取样先于实例化合批等接线）。
- **海面材质判定改"语义先于名字" + 地形 LOD 阈值 fov 口径（2026-10-14，NewBay 抬视角"一片白"溯源）**：
  ① `SkySeaSurface.sc2`（NewBay 的海面，场景里挂在 SkySphere 目录下）的材质就是**水材质**
  （导出物 `extras.water` + normal/cube 槽；客户端 `WaterPerPixelCubemapAlphablend.material`），
  此前 `/sky/i` 名字正则把它当天穹 ⇒ 整片海挂 `makeSkyMaterial`（unlit、平面 UV 拉一张贴图、
  **深度钉远平面**）⇒ 海面永远画不出来、海床（colormap 浅土色）直接露出、远处只剩被拉平的贴图。
  现按**材质标记先于名字**判：`extras.water` 命中即落水材质分支（源码级守卫随
  `scene/sceneryMaterials.test.js`）。验证口径：`?debug=1` 下 `window.__waterCoast.materials` 在
  forgecity 应 ≥ 1（此前恒 0）。
  ② 地形自适应 LOD 的阈值按引擎 `LandscapeSubdivision::PrepareSubdivision` 口径取**相机配置的水平
  fov**（`camera->GetFOV()`；宽高比只进投影项 `tanFovY = tanf(fov/2)/aspect`）：此前把「55° 竖直 ×
  画布 aspect」折算成水平角喂进去 ⇒ 窄画布滑向狙击镜档（zoom 0.9/0.03，阈值最松 +78%）⇒ 同一机位
  我们的网格比客户端更粗。现恒传客户端正常相机口径（`CLIENT_NORMAL_CAMERA_FOV_H` = 70°；回放自由相机
  没有狙击镜档）。同批核实：`SubdividePatch` 的 `minSubdivLevel`/`forceMaxSubdiv` 在实例化+morph
  路径恒 0/false，且 `Decal.material`/`TileMaskAllQualities.material` 无任何深度偏置——客户端对
  贴地薄板的粗格越顶**没有**补偿机制（依据副本 `tmp_analysis/dava/`，见上游
  `docs/index.md` 同名条目）。
- **车体位姿 = 回放记录位姿（2026-10-10 回退定稿；客户端同构）**：整台车（含挂在其下的
  履带/负重轮节点）按记录的 yaw/pitch/roll + y 摆放——低模组走 `group.rotation`（YXZ，
  y=−yaw / x=pitch / z=−roll），GLB 根走 `poseFromYPR(−yaw, pitch, −roll)` 单次合成。
  背景：此前（2026-10-09）为治「履带离地」试过一版近似——**根吃地形局部平面 + 车体子树
  (`__hullGroup`) 收限幅残差**。它确实压住了当时观测到的现象（整台刚体按记录姿态旋转时，
  在「记录姿态 ≫ 地面坡度」的时刻——急刹/坑沿，实测残差最大 8~10.8°——履带整片抬离地形，
  后角 3.44·sinΔ ≈ 0.9 m，即用户报障 SPHT @Port Bay 1:21），但**与客户端结构相反**
  （客户端：车体 = 记录位姿；轮/带另算），观感被判「怪」，已整段回退。
  **保留 `__hullGroup` 但恒归单位**：非底盘节点（hull*/turret*/gun*）收进该组、`chassis_*`
  留在根上（命名不符 → `hullGroup=null`，整台刚体 fail-safe），作为下一步「逐轮贴地 +
  履带分段形变」的挂点；identity 下与拆分前逐像素等价（低模侧同式）。
  **固定战斗室车辆（歼击车）无 `turret_N` 节点也照常挂载（2026-10-14）**：客户端源模型
  本就没有炮塔实体（T110E3/ISU-152/T28/SU-85/StuG…，资产包实测 44/735 辆全部如此；
  导出器 `tools/export_tank_glb.py` 按源场景图忠实导出、不造节点），此前
  `collectGlbParts` 无条件要求 `turret_N` → 这批车在 3D 回放里确定性退代理盒（用户实测
  Faust 场两台敌 T110E3 全场盒子）。现按摆位证据放行：`model_origins`（track/turret 枢轴）
  与炮管组齐备即挂载，`poseGlbRig` 里炮管组直接吃 `mG = mT·Rx(gr)`——绕 `track+turret`
  枢轴的横转（含 `initial_turret_rotation` 补偿）与绕 `gun_origin` 的俯仰一并写入炮管组，
  与客户端「TD 的炮塔 = 炮架横转」呈现同构；回转炮塔路径逐值不变。无炮塔**且**无炮管组的
  模型无受姿部件，仍退代理车（fail-visible，warn 留痕）。
  **客户端结构（逆向，2026-10-10 复核；证据见上游 `docs/tank-suspension-client-re.md`）**：
  `SuspensionSystem` / `SuspensionWheelsSystem` / `SuspensionTrackSystem` 三个系统逐帧解算，
  逐车**数据是现成的**——`Data/3d/Tanks/Parameters/<nation>/<stem>.yaml` 的 `suspension:`
  块（本机 730/764 辆有；`wheels` 逐轮数组 + `left/rightTrackChains` 履带折线 + 弯曲/铺放
  系数），逐轮几何由 `SuspensionGenerator` / `SuspensionUtils` 从模型节点现算。⇒ 下一步
  实现不该再用量级常数（`SUSP_TRAVEL_M = 0.25` 只是占位）。
  **第二轮反汇编（2026-10-10）已把「怎么动」还原**（上游文档 §六~§七）：负重轮 = **纯竖直
  平移**，夹到 `[pz−b, pz+a]`（`a` 上行/`b` 下行行程，`flag` = 负重轮），按
  `wheelsReactionSpeed` 限速、首次可见直接吸附，**无弹簧/阻尼**；轮自转 = 绕轮节点局部 X
  轴 `θ += Δs_侧·k`（k 候选 1/半径，左右差速）；履带 = 静止折线 + 逐轮偏移 + 悬空段垂弧/包轮
  + 铺地 → 每帧 2D 链路，花纹按 `chassis.textureScale / chunkLength` 每米滚动；履带**不**采样
  地形（接触来自负重轮）。我们包内模型已带履带材质贴图，可直接在既有履带网格上形变，不必
  复刻客户端的实例化架构。
- **轮/带解算已接线（2026-10-10，T1+T2+T3）**：数据 = 包内 `suspension/<tank_id>.json`
  （上游 `tools/export_tank_suspension.py`，725/735 辆）；求解器 = 独立纯函数模块
  `scene/suspension.js`（单测 `suspension.test.js` 19 项），`playbackScene.js` 只做容器与写入：
  ① 负重轮按**局部 +z 平移**贴地（夹紧 `[−b, +a]`、`wheelsReactionSpeed·dt` 限速、seek 跳变
  吸附），`flag=0`（诱导/主动/托带轮）不参与贴地但照常自转；② 自转 `θ += −Δs_侧/r`
  （Δs_侧 = 该侧接触线中心的世界位移投影到车体前向 ⇒ 转向差速自动成立）；③ 履带链路
  （逐轮偏移 → 悬空段 `(t−t²)` 垂弧（幅度 `upperFactor·span^lengthPower`）→ 包轮 → 铺地）
  后**逐顶点形变**既有履带网格（逐车 clone 几何，只动模型 +z；法线按 2 cm 闸门重算）
  ——注意导出器把**轮几何烘进顶点、节点留在原点**：轮自转必须按轮心做**枢轴补偿**
  （`applyWheelSpin`；不补偿 = 轮绕整车公转，实测轮心漂 5.4–6.8 m）
  + 花纹 V 滚动（**每米速率来自网格实测 dV/ds**，UV 就地取模）。半径/挂点/`chunkLength`
  由模型现算（与客户端"从骨骼现算"同路）；数据缺失 / 轮数不符 / 命名不符 → `null`，
  整车回落刚体（fail-closed）。**2026-10-10 实测两处勘误**：① 轮自转**必须枢轴补偿**
  （见上条：导出器把轮几何烘进顶点，轮心不在节点原点）；② **花纹滚动速率不能用客户端形式
  常数** `chassis.textureScale / chunkLength`——实测它比网格真实沿带斜率大 **3.4~19×**
  （30 辆抽样、中位 4.5×，即"履带速度与前进速度不匹配"的根因）；那条常数活在客户端自己的
  shader V 空间（一个 chunk 一份原型），与导出网格的**图集式 per-link V**（IS-7 实测每 V
  ≈ 1.56 m）不同量纲。现改为**逐带实测 dV/ds**（`measureBeltUvSlope`：按弧长分桶取中位、
  剔除图集换行）× **底段走向**（`chainBottomRunDir`：材料在接地段向后流）定符号；测不到
  （≈3%，如 `Oth09_WH_Predator`）→ 该带停滚（fail-closed）。
  ③ **花纹写 V 只能对"偏移"取模，不能逐顶点取模**（"履带外表面有一小段没有纹理"的根因）：
  旧写法 `V = frac(uvBase + offset)` 会把任何**跨过纹理 wrap 的图元**两端 V 折到 [0,1) 的
  近邻两点（实测 KRV 底段一整根四边形跨 2.85 个 wrap：V 1.55→4.39 ⇒ 折成 0.85/0.69），
  而 GPU 仍线性插值 ⇒ 该四边形只画 0.15 个 wrap（应 2.85）＝纹理被拉长 ~18×，看起来
  "没有纹理"；每跨一次整数还会留下一条随偏移漂移的糊带（观感"跟着履带转"）。现为整带同相
  （`writeUvOffsetV`：取模只作用于 offset；纹理 REPEAT 下整数平移观感等价）。实测（真实网格
  逐边 ΔV，L/R × 3 车）：旧写法单边最大改变 **2.4~3.4**，新写法 **0.000000**（完全保持）。
  ③ **（已回退）履带网格沿带细分**：导出履带是**低模长直段**（实测 KRV 底段一根 4.2 m
  四边形、全带仅 24 个横截面；Maus 最长直段 7.6 m），逐顶点形变只能动它的两端。曾按链路
  弧长把长边等分到 `chunkLength` 量级（弧长档距 4.8~7.6 m → 0.23~0.30 m），**观感更差**
  （2026-10-10 用户判）⇒ 整段回退（含助手/单测/守卫）。长直段对"随地形起伏"的限制仍是
  已知近似（客户端履带是逐 chunk/逐 link 的实例化条带，本仓用既有网格形变）。
  **已知近似**（上游 §五 未定项）：铺地用"地面 max 抬升"
  代替客户端的接触树权重、`upperMin/frontFactor/backFactor` 未逐项落位（统一用
  `upperFactor`）、车轮地面取样用高度场（客户端是物理射线，桥/残骸处有差异）、
  `chunkOffset` 驱动量以"距离积分"替代。
  `glbRig.js` 的 `terrainPitchRoll` / `clampHullAttitude` / `poseLocalBetween` / `yprScene`
  是上一版近似的纯函数准备件，**当前无调用方**（测试仍在 `glbRig.test.js`，其 describe 已
  标注「当前无调用方」；若下一步不用，实现与测试一并删）。接线守卫：
  `sceneryMaterials.test.js`（两条位姿路径都按记录位姿 + 横滚符号、`__hullGroup` 恒归单位、
  内核不得再引用那三个准备件）。
- **地面履带印（TreadSystem 碾压痕，2026-10-11）**：坦克开过后地面上的暗色泥痕条带。
  数据面 = 包内 `tread/<tank_id>.json`（上游 `tools/export_tank_tread.py`，authored
  **311/735** 辆：印记宽/间距 + 贴图引用，客户端 `treadParameters` 块）+
  `tread/textures/*.webp`（13 张客户端 DDS 无损转码；`Tread.webp` 为通用回落张）——
  可行性定案与 fail-closed 边界见上游 `docs/feasibility-track-marks.md`（2026-10-10
  "地面贴花不做"对碾压痕一支的翻案；弹坑/血迹仍无源）。实现：
  - **生成 = 客户端槽位模型（2026-10-12 反汇编定案，`docs/feasibility-track-marks.md` §四）**
    = `scene/treadMarks.js` 纯函数：每侧一个**固定环 50 槽**（`wotblitz.exe`
    `(i + 0x32) % 0x32` @0x83d460；**50 槽含活戳**——落锚函数 0x727b80：
    `count=min(count+1,50); head=write; write=(write+1)%50`，没有独立第 51 槽；印记长度
    预算 = 50 × manualSpace 米，车后滚动收尾），active/write 槽持一枚「上次落锚点 → 当前
    触地点」的扫掠戳。车辆移动时**前沿逐帧拉伸**（活戳末端 = 当前位置——客户端每帧全量
    重发同款，实体批次整批替换 @0xe79050）；与锚点距离满 authored `manualSpace`（带 1e-9
    容差防浮点欠冲）**定型并推进 write**（锚点 = 当前点、不做精确倍数插值，客户端
    0x83d4ca 同款）⇒ 戳长 ∈ [space, space+步长]、无整数边界可重复跨越。
    **激活门 = 0.3 m**（客户端 `0x3632a54`，伴随沉积门 0.05）：净位移 < 0.3 m 的小范围
    蹭动不建活戳、不占 GPU；环满时活戳"顶掉"最老戳（head 槽），落锚后该槽由新戳接管。
    零位移样本（停车/原地转向）推进采样时刻与朝向但不累加里程；锚点时刻贴住当前采样
    （见下"锚点时间门控"）；
  - **锚点时间门控（2026-10-12 review P2 #589）**：锚点的出生时刻**始终贴住当前采样时刻**
    （停车/低速不冻结）——否则停车 7.62 s 后再起步，活戳与"跨过阈值时提交的那一戳"alpha=0
    （评审复现：(0,0)→(0.2,1)→停到 10 s→(0.4,10.1)，活戳长 0.4 m 而出生 t=0）。这也是
    客户端槽位时间门控的直接语义（`0x83d410`：槽位时间随样本推进，槽位存续由淡出窗按
    该时刻判定）。
  - **无空间去重（2026-10-12 方向收敛，A158Coke 裁示）**：客户端反汇编只证明「50 槽环 +
    槽位时间随落锚刷新 + 7.62 s 淡出」——印记是短寿命对象，反汇编证据里**没有**"同地带
    重占/几何去重"的提交规则（0xe79050 是整批重发，槽位就是滑动窗口本身）。评审过程中
    试行过的 `segRelation`/回压重占自创去重层（中心线→足迹→包含关系四轮演化）持续引入
    真实 bug（平行车道误伤、垂直交叉误清、partial 覆写丢尾段、a⊂b 丢两端），其收益
    （消除 7.62 s 内的短暂自然重叠）远低于代价，**整层移除**：重复碾压在淡出窗内的
    短暂 alpha 重叠是既定行为，随旧戳淡出自然收敛。若后续反汇编确认客户端确有去重
    提交规则，再按其真实机制实现（client fidelity first，不为"零叠墨"扩大自创算法）。
  - **老化逐槽独立（2026-10-12 review P2 #589 二轮定案）**：`ageTrailAlphas`
    **逐槽按自身 `t` 独立计算 alpha**（环 51 槽/侧，全扫与二分同量级）——不依赖"按序号
    出生时刻有序"的假设（该前提在环形覆写/重放下不可靠，二轮 review 曾复现二分把新戳
    当过期前缀清 0）；接线守卫锁定源码不得再引入有序假设。
  - **断链 vs 重建（2026-10-11 PR 分支远端改动，Chen Yu `16655487e`+`ca1ad19b0`）**：
    `resetTrailState` 语义收敛为"断开路径连续性"（只置 `breakPending`，**不动已有 `segs`**）；
    是否清历史的判定挪到 `advanceTrail` 的下一个 anchor：anchor 时刻 **晚于**最后历史段
    （AoI 空洞 / pose 大跳恢复，必然向前）⇒ 保留历史、仅重锚（印记继续按寿命淡出，语义上
    比旧版"进洞即抹掉已铺印记"更贴近客户端——碾过的印子不会因旁观者视野断开而消失）；
    anchor 时刻 **不晚于**最后历史段（seek 后退 / 关断重开 / 宽度变化都从 START 重喂）⇒
    内部 `clearTrailHistory` 清历史后重放。新增状态 `breakPending` / `lastSegT`。
    配套：`treadAlphaAt` 对**负年龄**（回放时钟早于段的出生时刻，例如重建尚未落地的窗口）
    返回 **0**（隐藏未来段），只容忍 1e-9 浮点抖动——旧版 fail-safe 返回 1 会在保留历史
    的形态下短暂显示"未来的履带印"。回归见 AoI 空洞测试（历史前缀逐值保留 + 洞内零出戳 +
    洞后新锚窗口 [48.5, 51]）。该测试初版按 `slice(before.total)` **计数**切"洞后"桶——
    `before` 是在 seek 目标 t0+4 取的，而空洞从 t0+5 才起，t0+4→t0+5 之间仍可见的尾巴段
    （5 戳，路径 21~25 m）被错误计入洞后桶 ⇒ postGap 10 > 上限 8、Required Gate 红
    （本地与 CI 同报 `expected 10 to be less than or equal to 8`）。现改为按**出生时刻**
    过滤（`t < gapEnd` = 洞前含尾巴，`t ≥ gapEnd` = 洞后新锚段），并对尾巴段独立断言
    横向区间——洞后窗口的语义（新锚、无桥接）不变。
    **阵亡期同属"向前的不连续"**（3.1.0 review P2，issue #622）：DESTROYED 期间同样
    flush + 双侧 `resetTrailState`（只是"不出段"而不复位锚点，复活落回新位置时会把这段位移
    盖成一条跨阵亡期的长印记）——回归见 `playbackScene.test.js` 的"履带印阵亡期断链"用例。
  - **呈现** = 每车一个动态合并几何 Mesh（槽位 = 环 50 槽/侧**含活戳**，左右交错
    ⇒ `TRAIL_SLOTS = 50×2 = 100` 个四边形；**绘制窗口恒为全部槽位**，无效槽（环内空槽）
    一律**显式隐藏 alpha=0**——转弯时左右落锚数因弧长差而不同，固定窗口没有 min/max 的
    互相截断问题，也不再依赖"位置全零即退化"的偶然；环满时活戳槽 = 最老戳槽，显示权归
    活戳，写入与老化都跳过该槽的旧值）；戳四边形经
    `trailStampCorners` **逐角独立贴地**
    （四角各自采样真值场高度 + 12 cm 抬升，随坡双向弯折）。首版"InstancedMesh 单平面 +
    中心梯度"被粗格地形网格成片盖住（全景视距下合法 LOD 网格与真值双线性面差 5~15 cm，
    印记断续可见）——单矩阵表达不了四角异高，是换合并几何的原因。`MeshBasicMaterial`
    不受光 + alpha blend + `depthWrite=false` + **`DoubleSide`**（扫掠戳的角序跟车体朝向
    走，倒车时位移反向 ⇒ 固定索引产生朝下法线，FrontSide 下倒车印记被背面剔除、地面以上
    完全不可见——2026-10-11 review P2；贴地覆盖层无光照，双面零代价）。
  - **生命周期**：游标增量泵（`tick → updateTrails`）；seek 后退 = 从 START **全量重算**
    （重建由 anchor 时刻判定触发，见"断链 vs 重建"）。喂样走**固定 0.1 s 网格片**（片界按
    START 对齐）且首锚 = 窗口起点 t0 的横截面，不足整片的尾巴留待下次（`builtT` 记最后已喂
    网格时刻）——片内交会点插值只依赖片界样本 ⇒ **seek 重算与逐帧连续播放逐值一致**
    （2026-10-11 review P2；旧实现从任意帧的 builtT 重切网格、首锚取第一次子步，同一直线
    同终点会得出不同的首锚与出生时刻）。开关关断 = 复位入口 + 重开从 START 重喂 ⇒ 由上述
    anchor 判定清历史全量重建（只回退 builtT 会让重开后的整条路径追加到旧末端：反向桥接、
    重复段、出生时刻非单调），视觉输出与连续播放一致（印记 = 回放数据的确定性函数）；
    `setTreadMarks` 在 setter 内直接驱动游标泵——暂停（animate 不 tick）时开关也**立即**
    生效。
  - **淡出窗 = 客户端引擎常数（2026-10-12 反汇编）**：`TREAD_FADE = { start: 5.45, end: 7.62 }`
    （`0x4010f94 / 0x4010f98`，直接参与槽位时间门控；与着色器 `fadeOutTimeStartEnd` 的
    `1 − smoothstep(start, end, age)` 同源推断）——RGBA 顶点色 alpha = `treadAlphaAt(T − t)`，
    `t` = **锚点时刻**（落锚即出生；客户端槽位时间随重新落锚刷新同款）。旧值 10 + 10 s
    （2026-10-11 产品定值）随之替换。老化扫描**逐槽独立**（见上"老化逐槽独立"）；
    暂停时时钟冻结 ⇒ 淡出冻结。
  - **画质档门禁（2026-10-11 用户裁示）**：履带印只在**高清/极致**两档提供（`QUALITY_PRESETS
    [key].treadMarks`，低两档不发起 tread 参数请求、开关在显示面板禁用）；且这两档
    **强制 GLB 真实车模**（`forceGlb`：`setGlb(false)` 被忽略、开关停用并提示）——印记的
    左右轨距取自 suspension 解析的模型实测 `halfW`，允许中途切低模会让同一车前后的印记
    轨距突变（用户实测报障）。均衡档仍可自由开关 GLB 但无印记。
  - **进场预载（2026-10-11 用户裁示）**：高/极致在 startPlayback 资产阶段 `await
    applyGlbToggle(true)`——**双方全部车辆模型就绪才开播**（此前 GLB 在开播后并发下载，
    开局数秒是盒子代理，且轨距随挂载跳变、起步印记出现侧向折线）。
  - **几何 = 扫掠四边形（2026-10-11 终版，客户端同构）**：每戳 = 「上一戳时刻的履带
    横截面 → 当前时刻横截面」之间的扫掠四边形——横截面 = 过履带中心线、垂直于**当时
    车体朝向**的宽度线；**相邻戳共享整条接缝边**（前一戳的远端横截面 ≡ 后一戳的近端
    横截面）。客户端 deferred-decal-vp.sl 的 `DECAL_TREAD` 分支同款（顶点按横向坐标剪切
    `y→y·z+w` 贴梯形，正是这一几何的痕迹）。此前"每段以段中心为锚的独立矩形"在转弯处
    外缘张开楔形缝（实测 FV215b 路径开口 p90 5 cm / p99 34 cm，用户报"仍不连续"）——
    扫掠戳从构造上消除。不变量由单测锁定（前戳 L1/R1 ≡ 后戳 L0/R0 逐值相等）。
  - **不透明度 = 客户端口径（2026-10-12 裁示取消全局压暗）**：alpha = 贴图 alpha ×
    淡出系数 × per-stem alpha 归一化（`/tread/textures.json`，用户裁示的跨贴图"统一
    深浅"），**没有全局阻尼系数**——与客户端 `FADE_OUT_WITH_TIME` 分支一致（那里
    `parameters.x` 是印记出生时间，透明度 = 贴图 alpha × 距离淡出
    （`treadsNear/FarFadeDistance`）× 时间淡出（`smoothstep(fadeOutTimeStartEnd)`），
    无任何整体压暗）。历史：0.8 曾是目视两点校准（补偿下述两处未复刻机制），随槽位模型
    一起退役。仍有两处**减淡**机制未复刻（数值在游戏层代码、未逆向，如实记录的缺口）：
    ① 距离淡出（旁观/俯瞰视距下客户端比我们淡）；② 贴花调色分支
    `#if GLOBAL_TINT: rgb *= globalFlatColor.rgb * 2.0`（同族着色器，铁轨贴花已证实该
    分支在贴花实例上启用）——故近距满景下本实现可能比客户端略深（缺口的直接后果）。
    回归见 `treadMarks.test.js`（抖动步长精确发 4 戳）。**同日三次定案（边界抖动）**：
    点位来自插值、步长带 ~1e-10 抖动，`floor(acc/space)+1` 在 acc 落在整数界下 1e-9 内
    时会把**同一戳发两次**（实测 20 m 窗口发 29/27 戳、L/R 因抖动不对称）；修复 = floor
    前加静差（`floor((st.acc + 1e-9)/space)+1`）。**过期戳清零**：大步 seek 前进时老戳
    一步跨出淡出窗口，若不显式清零会停在跨步前的旧 alpha（实测残留 0.55 全亮）；
    `ageTrailAlphas` 现对窗口前的有效戳写 0。**上传门控**：`writeTrailQuads` 仅在**本帧
    有新戳**时置 needsUpdate（此前每帧无条件全量上传 position+color 两个缓冲）。
    **过期段清零**：大步 seek 前进时老段一步跨出淡出窗口，若不显式清零会停在跨步前的旧
    alpha（实测残留 0.55 全亮）；`ageTrailAlphas` 现对窗口前的有效段写 0。
    **上传门控**：`writeTrailQuads` 仅在**本帧有新段**时置 needsUpdate——此前每帧无条件
    全量上传 position+color 两个缓冲（静止/暂停也在烧带宽）。
  - **大步断链（2026-10-11 用户报"刚进入对局时印记有一小段折线"）**：feedTrail 遇单步
    位移 > 2.5 m（出生摆放 / AoI 传送 / pose_kf 保持-跳变）即复位该侧路径态，跨步不铺印
    ——位姿折线不再被 stamp 成斜折线（实测起步折线段消失）。
  - **左右槽位交错**（2026-10-11 修"只有左侧履带有印记"）：第 k 对段占槽 `2k`(L)/`2k+1`(R)
    ——首版把 R 整块放在 `[cap,2cap)` 而 drawRange 从 0 数起，R 区间永远在绘制窗口外。
    绘制窗口取**较长侧**（`max(L,R)`，2026-10-11 review P2）：左右中心线在转弯时弧长不同、
    段数本就不成对，`min(L,R)` 会把较长侧最新段截在窗口外（实测 R=12/L=15 时 L 最新 3 段
    全不可见，转得越久落后越多）；较短侧落在窗口内的空槽（环形残留上一轮更长运行的旧段）
    **显式清零 alpha**，不靠"位置全零即退化"的偶然。
  - **回落与"统一深浅"（2026-10-11 用户报"215b 比 Kranvagn 黑"后重做）**：包内现在
    **全部 735 辆都有 `tread/<id>.json`** —— 424 辆无作者块的车按**国别主贴图**回落
    （`fallback:true`；Kranvagn→`European_01_tread`，与 GB 同族深色；此前回落浅色通用张
    `Tread.webp` 使墨量差约 3 倍）；其 `manual_width:null` 由前端**从模型履带盒实测**
    （`suspParts.beltW` 均值 → 常量 0.6 兜底），对应该类车"从履带几何现算"的客户端语义。
    **宽度晚到（2026-10-11 review P2）**：参数 JSON 通常早于 GLB 到达（此时 `beltW=0`），
    未 authored 宽度先落常量回落，GLB 挂载实测就位后 `updateTrails` 重解析并**复位全量
    重建**（旧段按旧宽度铺的，混宽会视觉分层）。`resolveTreadParams` 的 `width` 契约：
    只有有效 authored 数值透出数字，`manual_width` null/非法/无 json 一律透出 `null`
    = 未 authored——常量只存在于场景解析函数一处，不存在"被兜底值永久锁死"。
    另：`/tread/textures.json` 的 **per-stem alpha 归一化系数**（导出器按全库中位归一、
    钳位 [0.65, 1.8]）乘入印记不透明度——authored 贴图间密度差 1.7~4×（RGB/色调本已
    一致），按用户裁示统一。左右横距优先取 suspension `halfW`，无悬挂回落 0.9 m。
  - **开关**：显示面板「地面履带印」（`store.treadOn`，唯一 owner = 场景；
    `setTreadMarks` API，会话级不持久化）。客户端 Windows 默认档 `TankTreads=false`
    ——默认开的决定是产品裁示（2026-10-11 用户要求做并验收）。**暂停态即时生效**
    （2026-10-11 review P2）：setter 内直接驱动游标泵（可见性与重算不等继续播放/seek）。
  - **review 修复（2026-10-11，审查基线 8be30e25f）**：①Android `wotbVersion` 相对
    base 未动（#586 已把 2.2.0→2.2.1 用掉、本 PR 的 diff 缺该文件 ⇒ main push 不触发
    APK staging）——本 PR 递增到 **2.2.2**；②倒车绕序（DoubleSide，见上）；③转弯
    L≠R 截断（当时窗口取较长侧 + 空槽清零；**2026-10-12 槽位模型落地后改为"固定全窗口 +
    无效槽显式隐藏"**，见上——同一问题更彻底的解法）；④关断重开只回退游标 ⇒ 段数翻倍
    （49→148 复现）——两侧路径态一起复位；⑤暂停态开关不生效（setter 内驱动）；⑥宽度
    晚到锁死兜底值（惰性重解析 + 重建）；⑦静止样本不推进时刻 ⇒ 停车再起步的新戳出生
    时刻倒退（实测 100.1 s 被算成 40.1 s，alpha=0 一出生即不可见）——零位移仍推进
    t/yaw 不累加里程；⑧首锚与采样网格依赖播放步长（同一直线同终点：一次 seek 首锚
    z=0.5/t=0.3，60fps 泵 z=0.083/t=0.217）——固定 0.1 s 网格片 + t0 锚定（见上）；
    ⑨Float32 alpha 与 double 严格比较 ⇒ 未变化缓冲每 tick 标脏重传（color.version
    4→5 复现）——alpha 一律 `Math.fround` 量化门控。回归：`playbackScene.test.js`
    「履带印 review 回归」7 项（含 60fps 泵与一次 seek **逐值比较坐标+出生时刻**、
    倒车 raycast 命中、转弯空槽 alpha=0 等）+ `treadMarks.test.js` 2 项（停车再起步
    出生时刻、原地转向扫掠）。
  接线守卫：`treadMarks.test.js`（tick 泵 / API→store owner / teardown 释放三条源码级）。
- **空场景占位件不参与绘制（2026-10-09）**：`buildWorld` 的占位地面（深色底板）与占位网格
  （`THREE.GridHelper`，y=0.02）都落在真实地形/水面同层附近——**网格正好压在半透明水面（y=0）
  之上**，会在地图、水面与地图外沿画出一层蓝灰线，并透出深色底板掩盖水的 alpha 效果。两者统一
  `visible=false`，对象仍保留入 scene（拾取过滤、bbox 拟合按对象引用走，**不看 visible**；
  边界提示由 `buildBoundary` 负责）。守卫见 `src/scene/sceneryMaterials.test.js`。
- **出屏口径 = 客户端 linear（A2，2026-10-09）**：客户端发布版**没有任何 filmic 出屏曲线**——
  `Default/pbr-fp.sl:481-491` 里 Uncharted2 与 Hejl/Burgess 两段都注释掉，生效行是注释写着
  `Linear to sRGB conversion without tonemapping` 的 `LinearToSRGB`；非 PBR 的 `materials-fp.sl:385`
  直写 `outColor`、零变换；`Utilities/exposure-tonemapping-fp.sl:28-30` 的 `1 - exp(-lum × exposure)`
  同样注释掉，生效行是 `output.color.rgb = luminanceSample * exposure`（线性 × 曝光，**乘在显示空间**）。
  故 `renderer.toneMapping = LinearToneMapping`、`toneMappingExposure = 1.0`（= `saturate(exposure ×
  线性色)` → sRGB 编码，与客户端同式）。**不留 `?tonemap` / `?exposure` 旋钮**（2026-10-10 撤除）：
  客户端的曝光是**运行时自动曝光**（`[auto] property float exposure`），全客户端数据里没有一个静态值
  可抄 ⇒ 任何替代参数都只能靠手工调，属"无客户端依据"。**已知缺口**：自动曝光本身尚未实现，故
  画面整体亮度与客户端可能有系统性差异——这是**如实记录的缺口**，而不是用一个手调参数盖过去。**2026-10-10 落点（用户裁示“保色相、归亮度”）**：逐图太阳的 intensity（36 图 3–14）是配客户端**自动曝光**的，我们照搬强度会让走 three 内建管线的材质（受光场景件 = 河床/铺装等 Lambert 件、坦克）过曝 2–5×（米德尔堡地面“发白偏橙”报障）⇒ 现按 `toneMappingExposure = DEFAULT_SUN_INTENSITY / sun.intensity`（钳 0.05–4）把整图亮度归一到基准档：同图内 太阳:环境:IBL 相对关系不变（夜图/冷图氛围保留），绝对亮度钉回基准；客户端的动态自动曝光仍是有记录的缺口。守卫见 `sceneryMaterials.test.js`。
  **2026-10-11 补全（mountain 报障"坦克非常暗、反射不对"）**：首版只归一了**太阳项**
  （`sunLight.intensity` 保持 authored 14、靠输出曝光 0.214 压回 3.0），而环境两项
  （HemisphereLight 环境光、`scene.environmentIntensity` 的 IBL 反射）输入未归一、却被同一
  输出曝光整体压暗——mountain（intensity 14 = 36 图最高）坦克净光照 太阳 3.0 / hemi 0.51 /
  IBL 0.28，vs 基线图 3.0 / 0.9 / 0.49：PBR 坦克的反射/环境占大头 ⇒ 整车暗 2~4.7×。现把
  hemi 与 IBL 倍率同样除以 expo（`DEFAULT_HEMI_INTENSITY/expo`、`envAuthored/expo`），三通道
  输出端净值与基线图逐项相同；基线图（太阳≈3）逐像素不变（实测工厂图 sun 8 / expo 0.375：
  hemi 6.4 / envIntensity 3.467，净值 2.4 / 1.3 与修复前一致）。注意尾部兜底赋值必须以
  "是否走过归一"为门（首版无条件覆盖，env 归一被 authored 值打回，实测 envIntensity 恒 1.3）。
  守卫：`sceneryMaterials.test.js` IBL 倍率读取 + 归一两条源码锁。
  另：出屏曲线/曝光只作用于走 three 内建管线的材质（坦克）——**这不是遗漏**：C3 核实（下条）legacy
  类材质在客户端也 raw 写出、不经出屏变换；装甲查看器（`tankViewer.js`）仍用 ACES + 1.15，未动。
  守卫见 `src/scene/sceneryMaterials.test.js`。
- **水面海岸线 `coastLine`（2026-10-10，修"马利诺夫卡水面与地形交界处锯齿状条带、非常生硬"；
  同日已纠正首版口径）**：客户端在片元末按"水面片元 vs **背后表面**（深度预通道
  `dynamicDepthPrepass`，`depth-fetch.slh`）的**相对**深度差"淡出反射项
  （`Default/water-fp.sl` 的 `RETRIEVE_FRAG_DEPTH_AVAILABLE` 分支：
  `coastLine = saturate(2·|ndcZ_片元 − ndcZ_背后| / ndcZ_片元)`，然后 `fresnel *= coastLine`；
  客户端同时有折射通道，淡下去露出的是同一幅地形图 ⇒ 岸线无硬边）。**真因实测**：地形跨水面的
  等高线本身**是平滑的**（逐行追踪 0–2 texel 单调）⇒ 锯齿不是"地形戳出"，而是**水面自己的菲涅尔
  反射**在岸线带里与地形逐像素抢深度（|地形−水面| < 该视距深度分辨率的区间翻转）＋"水面片盖在
  岸上"的硬边（所报"水面" = `env_ma_ice02_*` 冰面片，60×60 m×25 片、统一 12.260，有相当比例
  盖在岸上；每片正下方 1 cm 另有不透明冰 `env_ma_ice01_*`，客户端 `ro.flags` 含
  `VISIBLE_REFRACTION`）。本实现对等但**不需要额外深度 pass**：把高度场（真值一份到底，
  跨度与网格同源 `terrainSpanOf()`）做成可线性滤波的 `DataTexture`
  （`RedFormat`/`FloatType`/`NoColorSpace`，一次性建好、随会话释放）传给水面材质，片元里按同一条
  改用本渲染器自己的深度分辨率表达同一现象（`dNdcZ = 2fn/((f−n)z²)·Δz_沿视线`，
  `uDepthUlp = 2/2^depthBits` 上下文实测）⇒
  **`coastLine = saturate(dNdcZ / (2·uDepthUlp))`**（`dNdcZ = 2fn/((f−n)z²)·(水面高−地形高)/|视线.y|`；`uDepthUlp = 2/2^depthBits` 由上下文实测、near/far 取相机实际值）、`alpha = 菲涅尔 × coastLine`
  ——**淡出带 = 该视距的深度抢胜带（2 ulp）**：岸线带淡出、**深水任何角度满反射（含俯视）**（旧版分母取"相机高−水面高" ⇒ 俯视时深水被压透明，2026-10-10 用户报障，已废并加守卫禁止复活）；`coastLine→0` 同时消掉
  "片盖在岸上"的硬边。缺高度场/旧包 ⇒ `uHasHeightmap=0` 不淡出（fail-open）。**边界**：背后表面
  只算地形、不算结构/浮冰 ⇒ 冰面上方保留少量反射（客户端取到 1 cm 下的 `ice01` ⇒ coastLine≈0）。
  ⚠️ 首版把淡出宽度取成"该视距下地形单元格上界"（≈4% 视距）——基于"盖住地形
  几何锯齿"的**错误归因**，且宽度 ∝ 视距 ⇒ 远景把整片水洗掉（用户"水面贴图也不太对了"）；该口径
  及其辅助函数已撤除，守卫禁止复活。守卫锁参数下发与片元式；着色器门禁 water 用例编译通过
  （首版 `uHeightmap.r` 对 sampler 取分量的非法写法被门禁当场抓出）。
- **水下静态件不接光照图（2026-10-10，修"马利诺夫卡水面边缘位置是黑色、与地形分隔锯齿状"）**：
  上面那条把水面贡献淡出后，露出的**冰面本体**是黑的——真因不在水，而在**光照图**：
  ① 那 25 片 `env_ma_ice02_*`（水面）正下方 1 cm 是不透明冰 `env_ma_ice01_*`，材质
  `TextureLightmap.material` + `flags: {FLATCOLOR: 1}`，客户端 `ro.flags = 2049` 含
  `VISIBLE_REFRACTION`（只经折射通道可见的件）；② 它们在**客户端自己的**光照图图集里落在
  **未烘焙的黑格**上（按客户端原样的 `uvScale/uvOffset` 采样：图集 22% 是黑区，逐片实测
  `ice01_04` 71%、`ice01_07` 63%、`ice01_08` 64%、`ice01_11` 69% 黑）⇒ 我们按主通道
  `albedo × lightmap × 2` 渲染 = 黑冰面；③ **客户端看不到这层乘法**：`materials-fp.sl` 的
  DRAW PHASE 里 `albedo × lightmap × 2` 只在 `#if MATERIAL_LIGHTMAP && VIEW_DIFFUSE` 下发生，
  而水下件只出现在 `ReflectionRefraction` 通道的画面上（那片水面在客户端是**不透明**的——
  `water-fp.sl` 的 REAL_REFLECTION 分支 `outColor.a = 1`——岸线带露出的是折射画面）。
  **实现（纯几何判据、无调参）**：整个包围盒落在某片水面占地内（0.5 m 余量）且低于该水面片
  标高（5 cm 余量）⇒ 该网格不接光照图，走**不受光 albedo**（`MeshBasicMaterial`，
  `color = albedo` 即客户端 `VIEW_DIFFUSE=0` 的口径；与 `convMat` 同一条 three 内建通路）。
  **受灾面实测**：全 36 图里只有 2 张有"全淹没的光照图实例"——malinovka 26 个（= 25 片冰 +
  `ice01_26`）、italy 1 个。**已知差异**：① 客户端还有 `flatColor` 末乘（冰上是
  ≈(0.92,1.0,0.97)，≤4% 色调，未随包导出）；② 只是**部分**淹没的件（桥/沉船）仍按主通道
  渲染（客户端按水面裁剪逐像素分属两个通道）。守卫见 `src/scene/sceneryMaterials.test.js`；
  本改动**纯前端**（包/COS 不动）。
- **岸线特征细分（2026-10-10 加；2026-10-11 PR 评审删除）**：加它的理由——用户两个观测定案
  （"拉近之后锯齿变细、旋转时形状固定"）⇒ 是**网格量化**（不是深度抢闪：那会闪；也不是数据
  噪声：那与视距无关）：岸线在源数据里是 **2–5 cm/texel 的平缓坡**，客户端 TPS 相机贴地 ⇒
  那里网格天然 1 texel 级；回放相机常在数百米外 ⇒ 客户端三条判据（同一相机位置）**合法地**
  给出粗格。当时的实现 = **第四条细分判据**（`terrainMesh.js` 的 `shores`）：补片矩形与水面
  标高占地相交且格点高度范围跨其标高 ⇒ 细分到 1 texel（真图实测 malinovka 300 m：摆动行
  22 → 7 行 = 与原始场（客户端最细口径）一致；三角形 17k → 70k）；标高表 = 水面片 + 水下薄板
  （冰面），装载后立即重建一次。
  **删除（2026-10-11 PR 评审，Blocker）**：DAVA `SubdividePatch` 只有三条判据——`shores` 是
  与"纯客户端三判据"目标直接冲突的自研第四条（评审：代码与 PR 核心设计目标实际不一致）。
  已整体删除：`buildAdaptiveTerrain` 不再收 `shores`；`playbackScene.js` 不再计算/传递标高表
  （水面片/水下薄板的 `underWater` 识别仍供材质分派用）；负向守卫锁死
  `shores`/`shoreLevels`/`shoreHit` 不复活。岸线视觉继续由水材质 `coastLine`（本节上一条）
  处理，**不改地形 tessellation**；远相机下岸线的网格量化与客户端同相机位置一致，如实接受。
  保留的附带修复：根补片步长取 2 的幂（非 2 的幂时 `step>>1` 会留空洞，n=96 实测）——
  与判据无关。**历史教训（上游数据面，2026-10-10）**：让位掩码曾把水面片/水下薄板（冰面）
  当"贴地结构"、把地形压到它们之下 ⇒ 可见岸线被整体挪走 2–4 texel（局部 5.9 m）；掩码与脚印
  机制已于 2026-10-11 整体撤销（见下节）。
- **地面分层混合的 uniform 类型对齐（2026-10-10）**：用户"米德尔堡地面贴图颜色还是不对"
  （= erlenberg，display='Middleburg'）。实况：`groundShaderMaterial` 的片元里 `uHbSoft` 被写成
  `uniform float`（应为 `vec4`，线上 remote 版即为 vec4），而 JS 侧下发 `Vector4` ⇒ three 按
  **声明类型**上传（uniform1f 收到对象 ⇒ NaN）⇒ 开 `HEIGHT_BLEND` 的 9 图
  （desert_train/erlenberg/holland/idle/lagoon/plant/pliego/rift/rudniki）高度分层混合权重全废、
  地面取错层色。着色器门禁只编译（`vec4 − float` 是合法标量广播）⇒ 抓不到，故加类型对齐守卫
  （声明类型必须与 JS 下发值一致）。地面贴图/层定义/高度场与线上**逐字节相同**，光照（另一条）
  与本地地形网格无关本条。
  **已知差异**：岸线在 1 texel 级仍有的细小起伏是**数据自身**的噪声，客户端同样有
  （用户"拉近变细但没完全平滑"）。守卫见 `terrainMesh.test.js`（三条判据 + 删除锁定负向用例）
  与 `sceneryMaterials.test.js`（签名/接线）；前端侧无数据面改动。

- **地形列对齐：整张地形沿场景 −x 偏一格（2026-10-13，修"墙前多出土包、游戏里没有"）**：用户给出同一处
  plant 厂房坡道的**客户端截图**（贴地自由相机）与我们的 3D 画面——客户端挡土墙一直落到平地，我们墙前
  多出 1–2 m 高的土坡盖住墙下半截。**根因（数据面 × 消费端口径错配）**：引擎顶点是 corner 口径
  （`Heightmap::GetPoint`：`x = min + k/size·span`、高度取 texel k；`tilemask-vp.sl`：
  `vx_position = (relativePosition − 0.5)·bboxSize`、在 `relativePosition + 0.5/size` 取纹素 = 同一口径）；
  上游打包器 `map_assets.rs::parse_heightmap` 为"场景 x = −游戏 x"把列按 `out[c] = src[size−1−c]` 离散翻转
  ——corner 口径下翻转后第 c 列的真实位置是 `((c+1)/n − 0.5)·span`，而网格 / `sampleHeight` / 拾取诊断 /
  水面岸线都按 `(c/n − 0.5)·span` 摆 ⇒ **整张地形沿场景 −x（游戏 +x）偏 1 texel = span/512（600 m 图
  1.17 m），行方向无偏，全部地图**。挡土墙贴着高度图台阶摆放 ⇒ 低侧朝场景 −x 的墙，墙后路基被推出墙面
  （= 截图里的土包）；朝 +x 的墙则墙顶后方地形缩回一格。**证据**：①编辑器贴地实例（`PlacePoint` →
  `GetHeightAtPoint`，与渲染同口径）原点高度与地形逐毫米吻合的数量只在"列偏 −1 格"时成峰，行恒在 0：
  plant 9→**177**、karelia 5→**157**、italy 0→**301**、amigosville 8→**95**、malinovka 14→**71**、
  erlenberg 5→**39**（其余半格/±1/±2 偏移 ≤37）；②plant 坡道侧墙（游戏 x≈−5.5、y −85…−55，墙后地形沿 +y
  约 5° 爬升、墙前平地 22.08 m）竖直剖面：墙前 0.3 m 处我们的地形高出地面 **1.2–2.4 m**，引擎口径
  **0–0.3 m**。**修复**：①上游（WoT-Blitz-Agent）`parse_heightmap` 改 corner 口径镜像
  `out[c] = src[min(size−c, size−1)]`，`terrain.json` / `X-Terrain-Meta` 写 `terrainLayout: 2`，提取缓存
  改名防旧缓存被当新数据打包；②本仓读取边界 `terrainMesh.js::decodeTerrainField`（唯一解码口径，网格 /
  采样 / 拾取 / 岸线共用这一份）：**只有 `terrainLayout`/`size`/`zmin`/`zmax`/`span` 齐全才解码**；
  `terrainLayout: 2` 原样用，`terrainLayout: 1` 仅作为显式旧布局平移一列
  `field[c] = 旧[max(c−1, 0)]`；缺字段/未知布局 fail-closed 返回 null（回退 2D）——不再按缺省
  `layout=1`/`zmax=100` 猜（旧行为会把 layout 2 的 bin 平移一列、高度按 100 m 缩放，且
  `heightMeta={}` 会让 `sampleHeight` 返回 NaN）。`worldBounds` 必须是居中正方形（当前消费口径），
  非居中/非方形同样回退 2D。两种布局都丢掉场景 +x 边界那一列顶点（n 列表示不下 n+1 个顶点；在包围盒边缘、可玩区之外）。
  ⚠️ **配对约束（review P2，2026-10-14）**：上面"重导前后都正确"只在 **json 与 bin 来自同一版本**时成立
  ——`terrain.json`（no-cache）与 `terrain.u16.bin`（max-age=3600）是两个独立请求，发布切换期可能错配：
  旧 JSON+新 bin = 对已修正数据再平移一列（plant 新 bin+旧 JSON 实测 250019/262144 高度不同、最大差
  5.607 m）；新 JSON+缓存旧 bin = 跳过所需补正（缓存窗口最长 1 h）。上游已在 `terrain.json` 写
  **`terrainBinSha256`**（bin 的逐文件 sha256，与 manifest 同源；2026-10-14 起线上已有）。
  **前端已强制配对（2026-10-14）**：`terrainMesh.js` 的 `pairedTerrainBinUrl` 以该 sha 作 bin 的缓存键
  （`terrain.u16.bin?sha256=<hex>`；浏览器 HTTP 缓存按完整 URL 区分，对象存储忽略该参数，Android 原生资产
  代理按 path 取并逐次 ETag 复验）⇒ 不会复用上一次发布缓存的旧 bin；解码前 `terrainBinMatchesMeta` 用
  WebCrypto 核对字节 sha256，不符（json/bin 不是同一次发布，只会出现在发布进行中）⇒ fail-closed 回退 2D，
  不画错位一列的地形。无 `terrainBinSha256` 的旧包无从配对、沿用原行为；**有 sha 但无 WebCrypto
  （非安全上下文/旧 WebView）⇒ fail-closed**，不能假装配对成功。
  守卫：`terrainMesh.test.js`（缓存键 / 字节核对 / 旧包与无 WebCrypto 分支）+ `playbackScene.test.js`（场景层
  真实加载：sha 键取回才建地形、不同批不建地形）。此前的过渡约束（前端切换晚于 COS 发布 ≥ 1 h bin 缓存窗口；
  #615 部署满足）随之解除。
  ③顺带修水面岸线高度纹理的半纹素偏移：`DataTexture` 纹素中心在 `(j+0.5)/n`、顶点在 `j/n` ⇒ 采样
  `xz/span + 0.5 + 0.5·uHmTexel`。守卫：`terrainMesh.test.js`（`decodeTerrainField`：两种布局解出同一张
  引擎顶点场、只动列不动行、米制换算、fail-closed）+ `sceneryMaterials.test.js`（解码接线 / 岸线半纹素）；
  着色器编译门禁 `scripts/check-scenery-shaders.mjs` 21 程序 0 失败。**人工核验**：同一机位看 plant 厂房
  坡道侧墙，墙前土坡应消失、墙直落平地；反向朝向的墙（低侧朝场景 +x）墙顶后方不应出现缝。
  ⚠️ 下文 2026-10-09～11 关于"墙/压顶越顶量""在客户端自己的数据里"的实测都是在这张偏一格的高度场上做的，
  结论需按修正后的口径复测（见各段勘误）。

- **地形网格客户端同构（2026-10-09，修"不规则地形穿出石板面"）**：引擎里 `Landscape` 渲染
  对象只有 `hmap`+`bbox`（**程序化生成**，无网格），`LandscapeSubdivision.cpp:133-136` 的顶点全部
  来自 `Heightmap::GetPoint(x, y)` —— 即**顶点落在高度图 texel 原位（`i/size·span` 角点口径）、
  高度取 texel 值（不平滑）**；地面查询 `Landscape::GetHeightAtPoint` 同为 `fx = size·(x−min)/span`。
  **关键：它是补片级自适应 LOD 网格**——一个补片 = 8×8 四边形（`PATCH_SIZE_VERTICES−1`）；层级 k 的
  补片边长 `size>>k` texel、补片内顶点间距 = 补片边长/8 ⇒ **终止的补片内部仍是 8×8 网格**（level 0
  最粗 = 整图一个补片、64 texel 间距；最细 `FastLog2(size/8)` 层 ⇒ step = 1 texel）。细分判据
  （`SubdividePatch:252-258`；误差量 = 补片内 8×8 格各自的"一步细分误差"取最大）**三条任一命中即
  细分**：① 屏幕半径 `radius/(patchDist·tanFovY) ≥ maxPatchRadiusError`（0.45）；② 屏幕高度
  `|maxErr|/(errDist·tanFovY) ≥ maxHeightError`（0.014，距离取**最差样本位置**）；③ 绝对
  `|maxErr| > 3 m`（`normalMaxAbsoluteHeightError`）。阈值随 fov 在 `zoom`(6.5°)/`normal`(70°)
  两套预设间线性插值（引擎 `Camera::GetFOV()` 是**水平** fov；`tanFovY = tanf(fov/2)/aspect ≡
  tan(vfov/2)`）。⇒ 顶点是高度图的**抽样**、厘米~分米级毛刺不进网格，而**近处由半径判据强制细化**
  （终止补片半径 ≈ 0.234·视距 ⇒ 单元格 ≈ 4% 视距）。✅ 这解释并修复了"我们交叠、客户端无论如何看
  都干净"：我们此前逐 texel 全画 ⇒ 毛刺全在 ⇒ 与结构齐平的接缝（Δ=0.00 的吸附设计）上被顶出。
  实现：`terrainMesh.js`（补片级细分 + **两通道高度（原始 texel × 双抽头均值，按误差比 morph 插值）**
  + 8×8 内部网格）+ `maybeRebuildTerrainLod`
  （**单向滞回**重建，见下）；阈值系数固定 **1 = 客户端口径**实测（forgecity）：远景 25 k / 近景 50 k 四边形，一次重建 **≈18 ms**（定型数组缓存 + 预分配缓冲；
  误差须恒量满以喂 morph，故不再短路）。
  我们此前用 `PlaneGeometry(seg) + sampleHeight(双线性)`：顶点与 texel 网格**相位错位**、格宽
  也不等 ⇒ 陡坡/切槽处地形面沿坡向外探出（实测等高线水平 +0.5–0.75 m、同点高度 +0.04 中位/
  +1.34 最大）。挡土墙顶与地形同高（实测墙顶 31.91 m vs 地形 31.90 m），俯瞰视角下这点偏差就
  成了"不规则地形穿过墙的贴面"。现改为几何**直接建在场景系**（不再 PlaneGeometry+旋转）、
  高度按 `GetHeightClamp` 夹取；`sampleHeight` 同步改引擎口径（`(x/span+0.5)·n`，此前误用
  `(n−1)` ⇒ 0.2% 水平拉伸、边缘差一整格）。实测 vs 引擎采样：墙区 p95 0.65 → **0.28 m**、
  max 1.86 → **1.60 m**；`?debug` 下挂 `window.__terrain` 诊断钩子。
  **无裂缝契约（2026-10-09 用户"这次引入了横竖条纹"）**：首版用"细侧缝合 k 网格"补共享边，
  相邻叶混排多档尺寸时仍留下 **0.58–0.66 m** 的 T 型接缝（沿四边形边成横竖细缝，透出下层
  地面/水面 = 用户看到的条带）。现口径：顶点高度 = **该处最粗相邻叶所在层级的边界直线值**
  （顶点落在该叶**边的内部** ⇒ 取该边直线；落在**格点角** ⇒ texel 原值——否则会有更粗的
  象限、该叶就不是最粗；边的端点自身可能被更粗象限拉扯 ⇒ **端点递归**，层级严格变大 ⇒ 良基）
  ⇒ 同一 `(i,j)` 恒得同一高度、细侧折线落在粗侧直线上 ⇒ 无需 2:1 平衡也无 T 型接缝。另按
  `(i,j)` 去重顶点（索引网格 ⇒ `computeVertexNormals` 的法线跨叶连续，不再有逐叶硬边）。
  实测最大缝 **0.655 m → 1.8e-6 m**（后者 = float32 存储的 1 ulp，33 m 高度处）。守卫：
  `terrainMesh.test.js`（9 用例：阈值口径 / 终止补片满足三条判据 / **单元格边长 ≤ 0.08·视距**
  （"薄结构被盖"判定性回归）/ 平地近细远粗且处处 texel 原值 / 陡坎细化 / 贴地薄板不被盖 /
  混排层级下**无裂缝** / **无空洞** + 三角形**全部朝上** / 契约常量与预算）+
  `sceneryMaterials.test.js`（网格构建口径、不得回退 PlaneGeometry+interp）。
  **补修（2026-10-09 用户"地形把铁轨相关组件遮挡了"）**：报障点 = forgecity `env_fs_rails_002sc2`
  （拾取两点 (35.3,135.8)、(25.0,131.4)），实测铁轨是一块 z ∈ **22.30–22.60** 的贴地薄板、地形真值
  22.330 ⇒ 净空只有 **0.27 m**。旧口径（每格一个四边形、只按高度误差细分）在 252 m 处留下 **75 m
  整格**，该点网格高 **22.889 = 高出真值 +0.56 m ⇒ 越顶盖住铁轨**；根因两条（本次全面复核
  `LandscapeSubdivision.{h,cpp}` 才补齐）：① 终止补片内部本应是 **8×8 四边形**（顶点间距 = 补片
  边长/8），我此前把补片当成"一个四边形"⇒ 同距离下单元格粗 8 倍；② 漏了**屏幕半径判据**（客户端
  `||` 最左项）⇒ 近处不再细化到屏幕尺度。补齐后实测：同一两点在 78–252 m 各视距下网格 =
  **22.330/22.335（与真值逐点一致）**，铁轨不再被盖；终止补片的判据值实测 **零违反**且紧贴阈值
  （radiusError 0.437/0.450、heightError 0.0139/0.0140 = 恰好停在客户端允许的最粗处）。
- **贴花材质（客户端 `MATERIAL_DECAL`，2026-10-10，修"铁轨贴图太亮"）**：铁轨/地界标线这类
  **"被地形着色"**的贴地件，客户端材质是 `Decal.material`（顶层 `UniqueDefines:
  [MATERIAL_TEXTURE, MATERIAL_DECAL]`，实例不启用 `LightMap`）⇒ 走**贴花**路径
  （`materials-vp.sl:473-483` + `materials-fp.sl:183/447-493/539-607`）：顶点期
  `varTexCoord1 = texcoord1`（**无 uvScale/uvOffset**）、片元
  `decal = tex2D(decal, UV1)`（槽 = **地图 colormap**，客户端注释 "objects colored with
  landscape"）、`separate_lm` 时再 `× decal.a`、DRAW PHASE `color = albedo(UV0) × decal × 2.0`
  ——**全程无光照项 ⇒ 不受光**。我们此前无此路径 ⇒ 落到受光 Lambert ⇒ **偏亮 1.5–2.3×**
  （实测：铁轨处客户端等效乘子 **0.84**（`colormap.rgb × lm × 2` = 0.88/0.88/0.74），
  我们 ≈ `sun(8×NdotL/π) + ambient` × 0.75 ≈ 1.2–1.9）。实现：`makeDecalMaterial`
  （`extras.decal` 触发，需几何 UV1 + 地表分层贴图在位；`GLOBAL_TINT` 时按
  `materialLightmapAdjustment` 做 brightness/contrast/gamma）；数据面：导出器 `decal_capable`
  判据 + `extras.decal`/`decalLmAdjust` + **UV1 随导**（fail-closed：无 UV1 不标 decal）。
  方向性已用数据核验：铁轨顶点 UV1 与地面着色器的世界→UV 公式**同空间**（样例 (0.4219, 0.2775)
  vs 公式 (0.422, 0.2767)）⇒ 直接采 colormap、无需翻转。守卫：`sceneryMaterials.test.js`
  贴花用例（UV1 原样 / colormap 采样 / 无光照项 / ×2.0 / 调整分支 / 接线次序）+ 门禁
  **14 用例 / 13 程序 / 0 失败**（新增 `decal`、`decal+alphaTest`）。

  **地形 LOD 重建改单向滞回（2026-10-10 用户"铁轨被地形遮挡、转动/缩放后时不时变正常"）**：
  量测（forgecity 铁轨 `env_fs_rails_002`，0.3 m 厚贴地基板）：**真值（高度图双线性）在所有视距下
  恒定只盖住 39/1262 个采样点、最深 +16 cm**；而我们的网格是 **100 → 762 个、最深 +32 → +69 cm**，
  **随轨道视距变化** ⇒ "时有时无"的来源。逐视距核对 LOD 层级后确认：**同一相机位置，我们的步长
  从不比客户端判据允许的更粗**（模拟一条拉远/拉近轨迹，修正斜距后 0/16 帧越界）⇒ 高出量本身是
  客户端判据的容许范围（容许误差 ∝ 视距，0.3 m 厚构件在 ~41 m 外就可能被合法盖住，这是客户端
  设计；客户端的贴地相机永远在 3–15 m 内所以看不到）。**但我们的旧实现还叠加了"滞后"**：
  `maybeRebuildTerrainLod` 原本是**双向 25% 滞回** ⇒ 网格会长期停在"更远视距"的**更粗**层级，
  粗格插值把地形抬到构件之上，且随重建时机出现/消失。现改为**单向滞回**（`terrainMesh.js`
  `terrainLodStale`：拉近 ≥5% 立即细化、拉远 ≥40% 才允许变粗、两次重建至少隔 120 ms）⇒
  网格**永不比客户端同一相机位置允许的层级更粗**，且"时有时无"消失。守卫 +单测锁该契约。
  **滞回输入与构建判据同源（2026-10-10 review P2）**：滞回此前只读"相机到 controls.target 的视距"，而 `buildAdaptiveTerrain` 的判据读相机三维位置/FOV/aspect ⇒ **绕目标水平旋转、视距恒等时网格永远跳过重建**，停在旧相机位置的 LOD 分布上（近处该细的补片保持粗格）；`onResize` 也只改 `camera.aspect` 不重建地形。现滞回输入改为相机姿态快照 `terrainLodState`（位置/视距/视轴/FOV/aspect）：侧向绕转 ≥5% 视距、FOV/aspect 相对变化 >0.1% 都触发重建，同受 120 ms 节流（上限 ≈1 次/120 ms，成本同原先拉近场景）。守卫（`sceneryMaterials.test.js` 源码接线）+ 单测（`terrainMesh.test.js` 绕转/FOV/aspect 用例）锁该契约。
  **评审批修复（2026-10-10，基线 1da7b4e9）**：①**P1** 自适应地形几何补回 `uv`——低档/均衡档与分层材质不可用时底图（`ground.webp`）走 `MeshBasicMaterial({map})`，缺 uv 整图退化成单 texel 常量；朝向取旧 `PlaneGeometry+rotπ` 契约（`u = 0.5−(X−cx)/span`、`v = 0.5+(Z−cz)/span`，与合成器「顶行=+Z」一致；实测梯度结构相关在 erlenberg/medvedkovo/malinovka 三图唯一命中该式，`cm.webp` 是另一套 v（两文件导出侧 v 互翻，公式不可互换））。②场景纹理依赖 `getDependency('texture')` 全部 await 之后、任何共享状态写入前复查会话失效。③履带 UV 回退分支未定义变量（`v0tankId`→`tankId`，否则 ReferenceError 中断装配、留下半初始化状态）。④光照图材质改按输入指纹 `cachedSceneryMat` 共享（逐 mesh 新建会把 (几何,材质) 合批拆成 count=1 单实例批；逐实例光照图变换本就走 `aLm` 实例属性）。⑤履带形变下发判定改为比较**解算链**（`chainChanged`，顶点输出是链的纯函数）——只比最大幅度会漏"幅度相同、分布不同"的形变；**法线闸门**同样按链判定（`chainDrift`：与上次重算法线时的链逐点取最大偏差，2 cm 阈值兼作成本刹车）——累计统计量（最大幅度/均值）表达不了空间分布（复审曾据此漏报一次：把 0.1 m 的形变从一处挪到另一处，两项统计量都不变、法线却必须重算）。⑥关闭 GLB 时先释放该车悬挂克隆几何（`suspParts.disposables`）再清引用，反复开关不累积 GPU 缓冲。守卫见 `sceneryMaterials.test.js`「场景装配的会话/资源卫生」与 `terrainMesh.test.js` 的 `groundMapUv` 用例；纯前端，无数据面改动。
  **地形 LOD 逐行对齐引擎源码（2026-10-11）**：用户"同距下客户端两侧平整、我们台阶分界处下陷/上浮"后，
  从 dava.engine 源码镜像（github `the-tuxedo-cat/dava.engine`，`Sources/Internal/Render/Highlevel/`
  `LandscapeSubdivision.{h,cpp}` + `Landscape.{h,cpp}` + `Scene3D/Systems/LandscapeSystem.cpp`）逐行
  对照，修复三处转写偏差（均使旧实现比客户端更粗/更糊）：①`maxError` 必须自底向上**聚合整棵子树**
  （`UpdatePatchInfo` 把子补片 maxError/positionOfMaxError 并入父补片；我们此前只算本层 8×8×5 样本
  ⇒ 采样漏掉的细节误差被低估）；②`radius` 的 bbox 同样并入全部子补片（`AddAABBox`）；③两通道均值
  的对角配对——引擎 odd-odd 用**反对角** `(x+step,y−step)&(x−step,y+step)`（`CreateHeightTextureData`），
  我们误写主对角。实现改为 `buildPatchTableAscending`（`UpdatePatchInfo` 直译，相机无关，按 field
  备忘——LOD 重建只走相机遍历、不再逐次重采样）；`morphFunc`/`subdivMorph`/`DrawPatchInstancing`
  的映射逐字核对**无偏差**；`EngineSettings.yaml` = `Landscape.RenderMode.Morphing`（morph 开启）；
  `forceMaxSubdiv` 仅编辑器使用（游戏内无此开关）。**实测（plant 墙基两级平台）**：修复前后该露台
  逐视距 morphRaw 一致（半径判据主导）：30/100m 平台平整（morphFunc 0.47 仅影响坎带 ±2 texel）、
  300m morphFunc=0.95、400m=0.63——大视距的羽化是**引擎 morph 的自身输出**（客户端贴地相机不可达；
  同机位渲染与客户端逐式一致）。聚合修复在"细节被本层采样漏掉"的地形上使细分/羽化与客户端一致。

  **画质档与地形：细分/几何不随档位变化（2026-10-11 核查）**：`LandscapeSystem::AddEntity` 会用
  **landscape 画质预设**覆盖细分阈值，但本版客户端 `Data/quality.yaml`（= 引擎加载的
  `~res:/quality.yaml`）**没有 `landscape:` 块** ⇒ `GetLandscapeQuality()` 返回 nullptr ⇒
  阈值恒为出厂默认；wotblitz.exe 里那组默认值立即数（70/6.5、0.014/0.45/3、0.03/0.9/3）与
  开源 .h 逐字一致 ⇒ **任何画质档下地形网格生成用同一组阈值**（与我们的实现相同）；
  morph 开关来自 `EngineSettings.yaml = Landscape.RenderMode.Morphing`（非档位控制）。
  画质档真正影响地形的是**材质层**：`TileMaskAllQualities.material` 的
  QualityDependentUniqueDefines（ULTRA/HIGH = `LANDSCAPE_RELAXMAP + LANDSCAPE_HEIGHT_BLEND_ALLOWED`、
  MEDIUM 空）——①RELAXMAP 需 landscape 材质绑 `relaxmap` 槽（`LANDSCAPE_USE_RELAXMAP`）才生效，
  plant/forgecity 均无该槽 ⇒ 本图空转；②HEIGHT_BLEND 在 plant/forgecity 等图 ULTRA/HIGH 实际开启，
  我们的分层地面复刻按开启状态导出（`ground.layers.json height_blend=true`）⇒ 已对齐。
  纹理档（各向异性/分辨率）与 PBR 路径属材质档，与地形网格无关。

  **场景材质 TEST_OCCLUSION（"土包"真凶，数据面修复；2026-10-11）**：用户"客户端墙面上没有
  土包、我们 3D 回放里有"（任何机位不变）。排除了地形数据（客户端遥测 459/459 帧吻合、315 棵
  作者摆树吻合）、方法差异（坎位 mask/hmap/colormap 逐字节一致）与机位（射线：土包像素处地形
  坎面与墙盖板件沿视线仅相差 0.01–0.55m）后，定位到 `wall_03` 的 colormap 盖板件与
  **`materials-fp.sl:187-192` 的 `TEST_OCCLUSION` 分支**：带该旗标的材质客户端按
  `rgb = albedo.rgb × albedo.a` 采样——plant 五件盖板（albedo=plant_colormap_test、alpha
  区 15–111/255）在客户端是**近黑暗色覆盖层**（读作墙脚阴影），我们此前按满色渲染 ⇒
  "亮褐土包"。**上游导出器已将 `rgb×a` 烘进贴图（客户端同式），本前端无需改动**；plant
  scenery.glb 重导随包（manifest 4284.9MB）。见上游 index.md 同名条目。

  **地形细分差分验证 + 全包重导（2026-10-11）**：把引擎 `UpdatePatchInfo`/`SubdividePatch` 用
  Python **独立重写**一份参考实现（逐行对着 `dava.engine` 源码），与 `terrainMesh.js` 在同一张 plant
  上逐补片对比**终止补片集 + 每补片误差 + morph**：三个机位（贴地 26m / 270m / 425m）全部**集合
  零差**（262/262、532/532、151/151），数值差 ≤ float32 精度（1.4e-3），morph 差 ≤ 0.0009 ——
  地形细分实现与引擎**可证明等价**。**资产面**：全包按修正后的 alpha 判据重导 scenery（36 图、74s；
  其余 35 图共 15 个材质由误判 MASK 转不透明），包内替换 + manifest 重算；**COS 未同步**。
  **墙/压顶 vs 地形越顶量（数据面实测）**：plant 墙板覆盖的 2161 texel 中 41.9% 地形高于板面
  >2cm（主墙迹 +88/+120mm，墙台地带最大数米）——该交叉在**客户端自己的数据里**（同一高度图/
  同一网格/同一变换），客户端靠贴地相机 + 墙自身遮挡不可见，俯瞰视角会看到地形色带越过板面。
  此为"高度分界处"唯一存留的数据面差异，与算法无关。
  ⚠️ **勘误（2026-10-13）**：该实测用的是列偏一格的高度场（见上文"地形列对齐"），"在客户端自己的数据里"
  不成立——墙台地带数米级的越顶正是平移一格把路基推出墙面；修正后需复测。

  **地形-结构交叠：最终态 = 只对齐客户端（2026-10-11 用户裁示"不要自行发明处理方法"）**：
  薄贴地构件（铁轨基板 0.3 m、压顶、铺装）在远视距下会被**客户端同源**的自适应 LOD 合法盖住
  ——实测铁轨可见带逐 2 m 采样 157 点：60 m 1 / 150 m 2 / 250 m 12（+15 cm）/ 300 m 50
  （+35 cm）/ 450 m 97（+43.5 cm），**细真值恒定 0**。三代处理全部撤销：①让位掩码
  （2026-10-10，数据面造高度）；②贴地结构脚印判据（2026-10-11，scenery 扫描 → structs.u8.bin
  → 第五条细分判据）及其两层派生修补（特征强制带 morph 归零、缝合边陡坎吸收）——均无客户端
  依据。客户端机制穷尽核实（地形顶点着色器直出高度图、材质 52/52 无 DepthBias、36 图场景组件
  无协调件、引擎二进制地形系统全是"往地上画"的叠加层）：它没有交叠/塌陷问题**全靠贴地相机**
  （3–15 m ⇒ 网格天然 1 texel 级）。**最终形态 = 纯客户端三判据 LOD + 两通道 morph + 真值
  高度场一份到底**；远距相机下薄构件被盖住是客户端同机位的忠实结果（客户端的贴地相机从不看到），
  如实接受、不再补偿。高度场一份到底（渲染/查询/放置同源）与 renderField/terrainCover/structs
  管线禁止复活的守卫保留。
  **共面接缝：找到并实现了客户端自己的机制（2026-10-10 定案；此前两处手调手法已撤除）**：
  ① 事实（数据层逐点实测）——铺装（地形）与挡土墙顶/建筑基础在客户端是**吸附齐平**的：沿墙顶缝 92%
  的采样 |地形−结构| ≤1 cm、地形略高者 75% ≤2 cm / 98% ≤5 cm；用户报障那处
  （`env_fs_retaining_wall_017sc2`）沿墙 101 点里 97% 地形在压顶之下、**4% 高出 5–7 cm**。
  ② 客户端的两条手法都没有人工偏移：材质层 `Data/Materials/*` 52/52 无
  `DepthBias`/`SlopeScaleDepthBias`（引擎 `sl_Parser.cpp:282-283` 认得该字段、本图未用；`.sc2` 里
  同名命中只是 FX 参数 `constantDepthBias`/`depthDifferenceSlope` 的子串）；几何层同一份数据同样共面。
  ③ **但客户端有一条我们此前漏掉的地形平滑机制**（用户追问"客户端为什么不会"后定点，逐行核对
  `Landscape.cpp:CreateHeightTextureData` + `Shaders/Landscape/tilemask-vp.sl`）：高度图被引擎打包成
  RGBA8，每个 mip 纹素 = **[本层原始高度, 该纹素与相距一个 step 的对侧邻居之半和]**；顶点着色器
  `height = lerp(averaged, accurate, morphAmount)`，`morphAmount` 来自 `SubdividePatch` 末尾的误差比
  （**粗糙/贴阈值的补片 → morph→1 ⇒ 被"双抽头均值"抹平**），再经
  `morphFunc(x) = 4(1−x)⁵ − 5(1−x)⁴ + 1` 整形；最外一圈按 `zeroLodMul` 退回原始值。
  本实现已 1:1 直译（`terrainMesh.js` 的两通道 + morph，无自由参数）：实测最细层顶点 **22–25%** 有
  >5 mm 改动；**线性坡面/台阶上 morph 恒等**（双抽头均值在直线上等于原值）⇒ 不会动路基/坡面/贴地薄板。
  ④ 结论（对用户报障那处，2026-10-10 二轮实测）：**整面墙**逐 0.5 m 扫描（客户端自己的高度图 +
  LOD0 网格）——"地形高出墙表面 >2 cm"共 289 点，其中绝大多数是墙**埋在地下的部分**（两个渲染器都
  看不见）；**可见的**是墙顶边缘露头的几处：拾取点旁 (73.2, 107.6) 地形 **31.734** vs 墙顶 **31.687
  ⇒ +4.7 cm**；x≈54–60 的齐平段（压顶 30.3–30.8）地形高出 **+5.5~7.0 cm**；x≈90–93.5 段最大 +22.6 cm；
  x≈108.5~109 段最大 +39.3 cm。⇒ 这些高出量**就在客户端自己的数据里**（同一份高度图、同一 LOD0 网格、
  同一变换——均已逐一核过），所以客户端渲染的是同一个几何关系。客户端侧能查的机制已穷尽：材质层无
  深度偏移（52/52 + `.sc2` 关键字扫过）、`SnapToLandscapeControllerComponent` 在本图 **0 引用**、
  导出本取 LOD0、全图仅一份高度图、地形平滑机制（两通道 morph）已 1:1 实现（且对这类**直线坡/台阶
  恒等**，抹不掉它）。⇒ 差异只剩**相机**：客户端贴地第三人称在墙顶之下、被墙自身遮住，且其常规视距
  （60–150 m）下这 5–7 cm 的带只有亚像素；我们的俯瞰/低角近距相机会把它展开成一条沿石板边的地形色带。
  **要闭环需要一次客户端侧的对照**（同一机位同一视距的客户端画面，或客户端里的等效拾取信息）；
  在此之前我不再改动渲染端——已无客户端依据可依。若要**无论如何都看不见**，只能数据面有意偏离
  （地形在贴地结构覆盖处让位，烘焙掩码），见下段的决策项。
  ⚠️ **勘误（2026-10-13）**：这里要的"客户端侧对照"已由用户截图给出（plant 厂房坡道，客户端墙前无土坡），
  并据此定位到地形列偏一格（见上文"地形列对齐"）——本段的逐点高出量是在偏移的高度场上量的，修正后需复测。

### 单车血量 HUD / 战斗反馈 / 车辆详情面板（PR5）

- **HP presentation selectors**：`healthDisplayAt(track, t)` 和 `friendlyHealthAt(tracks, friendly, t)`
  是 Battle Playback 的单一展示查询入口。它们只消费 `friendly`、`healthTransitions`、
  `lifeTransitions`、team 与不晚于 t 的 transition：`DESTROYED` 显示权威 0；CURRENT/
  LAST_KNOWN 显示最近可信 current 与 anti-future-leak 的 `displayCapacityHp`；己方存活且
  client playback projection 已证明相对满血时返回 `relativeFull`，只渲染 100% presentation；敌方没有 health
  evidence 时保持 UNKNOWN。relative-full 不代表具体 HP 或 actual max。
  perspective 聚合只在每辆车都有可证 current/capacity 时返回 `EXACT`；己方 opening 时只消费
  client playback projection 提供的 `relativeFull=true`，混合 exact-full/relative-full 仍返回 `FULL_RELATIVE`；已知掉血/阵亡返回
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
  `displayCapacityHp` 均由 client playback projection 直接投影；无法证明时前端不显示 transient/ghost。
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
  当前播放时间/已记录伤害（录像者优先取当前时刻之前的 Avatar prop10 累计伤害广播；
  无该证据的车辆/旧数据集回退到 Σ 可 attribution 的权威掉血）/承受伤害（Σ 该车 HP 条
  可信读数的累计下降，与「当前 HP」同源——含点亮 / 重新进入视野时 materialization 读数参与的掉血；
  车辆库 provisional 开局种子不作下降起点。canonical DamageLoss 仍按 Java 口径只用相邻 prop3，不作承受伤害）/击杀数 + 最近伤害记录（权威掉血；incoming 在相邻可信 CURRENT HP 观测窗口内关联
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
  destroyed 事实保留并去重，不因 killer 未知删除 HP=0/击毁。KILL / DAMAGE / DESTROYED 事件
  多重集（含 observedHpLoss）与掉血明细在真实 fixture 上与冻结的 Java golden
  （`frontend/src/replay-local/__golden__/java-playback.json`）精确比对，由
  `frontend/src/replay-local/playback/playback.golden.test.ts` 强制执行（原 Java
  `BattlePlaybackAdapterParityTest` 已随服务端解析器退役）。

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

## 2D 位姿与 3D 同源（2D = 3D 的严格俯视投影）

2D 俯视**就是 3D 场景的俯视版本**（2026-10-16 定案）：车辆位置与朝向不再由 2D 自采原始观测，
而是与 3D 场景共用**同一个位姿采样器** `replay-local/pose/vehiclePose.ts`——
同一套通道选择（`pose_kf` 关键帧折线优先，缺省回退 10 Hz 滤波网格线性插值）、同一插值、同一
解卷绕域，因此两个页签逐帧同一画面。

AoI 段首的 `pose_kf` = 上游 2026-10-18 起生成的**显示重建**：客户端滤波器原始复位的
latency 从 0.02s 缓慢收敛到 0.2s，段首数秒是 10Hz 保持-跳变阶梯；上游折线改按 10Hz 标称
间隔铺满历史、稳态 0.2s 延迟起步，段首只保留 0.2s 静止，其后匀速插值。判定锚点（命中 /
炮口位置）不受影响，仍是客户端 0.02s 复位语义。旧 pin 的产物仍带原始阶梯，升级 pin 后
两者观感不同是预期行为。

**分层契约**（决定改动落点）：

- **画在哪 / 朝哪** → 位姿通道（playback facet 的位姿列投影 `PoseFacet`，随 `LocalPlayback` 带出，
  2D 单独打开也拿得到）；game 坐标系（x 不镜像、z 北），视图各自施加帧变换：
  3D 场景 `(−x, y, z)` + `yaw/roll` 取负，2D 地图 `toX/toY`（y 翻转、无 x 镜像）。
  帧契约的可执行验收：`replay-local/pose/vehiclePose.parity.test.ts`。
- **可不可信** → 仍是 canonical 知识层：观测区间（`positionCoveredAtV2`）决定 last-known 淡化、
  尾迹断链、炮线端点门控与伤害浮字锚点；canonical 原始观测（type=10）不再进入渲染取值。
  冻结的 Java 金标（`__golden__/java-playback.json`）因此不受影响。

炮塔：facet 的 `turret_yaw` 为绝对角且与 `hull_yaw` 严格同长（上游"本车无 prop2 ⇒ 相对 0"回退），
2D 换算 `wrapPi(绝对 − 车体)` 后渲染——**不再出现"prop2 首样本前炮塔整层消失"**
（旧实现把 `turretRelativeYawDeg: null` 当"无炮塔"，实测开局最长 90 s 缺炮塔）。
炮塔/炮管/侧倾只有 10Hz 网格列，采样器现在接收**协议精确的 `visibility[]` 段**
（`buildPoseFacet` 逐车透出；缺省回退 `coverage`）：只在段内网格点之间插值
（`sampleChannelWithin`），车辆刚进视野时不再从隐藏段的旧角缓慢滑到新角（旧行为在
0.86s 可见起点会把 0.8s 的 0° 与 0.9s 的 90° 插成 54°）。段内第一个网格点之前保持该点值。
短隐藏段（<2s）在 `coverage` 中不断开，因此必须用 `visibility[]` 而不是 `coverage`。
2D 与 3D 共用 `visibilitySpansByEid` 投影（3D 从 `DATA.visibility` 建 eid 映射），末段
`t_out` 缺省投影为 `+Infinity` 并作为合法段终点；两视图不得各自回退到 `coverage`。
3D 活车的**显隐**也改读精确 `visibility`（`collision`/炮塔/尾迹同源），`coverage` 只表示
"有采样可信"；短隐藏段内活车不渲染，死亡残骸仍按最后已知位姿保留。采样器若被要求在一
隐藏段内取值（2D/标签/诊断），网格列夹到**前一段末**（最后已知），不得无约束地滑向下一段；
短于一个网格间隔的可见窗口取**窗口结束前**的最近网格点，不能取窗口后的下一个 tick（否则会把
后一段的炮塔角泄漏进短可见段）。透明材质（含 `extras.alphaBlend`）不进入实例化合批——three
只按 object 排序，批内实例顺序固定会破坏软混合；保留独立节点由透明队列排序。其中带
逐节点光照图变换（`node.userData.lm`）的透明网格用**单实例 InstancedMesh** 承载，既保持
一个透明排序单位，又复用 `aLm` 的 atlas UV 变换（普通 Mesh 非实例分支会按原始 `uv1` 采错区域）。
分层地表元数据形状错误（如缺 `tiling`）时记 `groundLayers/invalid` 降级、释放坏层并用烘焙
底图重试，不能因异常跳过后续场景 GLB。烘焙侧同样排除透明材质，并在变体映射 fail-closed 或
`variantMappingIncomplete` 时拒绝出图。
核心资产缺失/失败时 3D 面板显示**非阻塞**降级提示（`scene3d-asset-degraded`），不再把
`hasData=true` 当作健康加载完成；变体映射缺失/`variantMappingIncomplete` 标记导致的 fail-closed 裁剪同样计入降级。
`extras.alphaBlend` 在 SpeedTree / 光照图 / 贴花等专用材质路由上也保持软混合（alpha 乘
`m.opacity`）；多材质网格只有**整组**命中 `extras.sky` 才走无限远天空，混合组按普通网格
fail-closed（不把普通 group 投到无限远，也不让烘焙整件剔除）。

**失察即冻结**（2026-10-16 用户裁定）：车辆离开我方视野后，2D 图标**停在最后观测点**——采样时刻由
`observedFreezeTimeAt`（`utils/battlePlaybackV2.ts`）给出（最后一个 OBSERVED 段的结束时刻），
位姿仍取自同一通道但**时刻冻结**，不跟随客户端滤波器在失察区间的预测延续（实测滤波延续可与最后
观测点相差 177 m）。语义与 3D 对齐：3D 里该车模型直接不显示（`visibleAt(v, T)` = coverage 区间，
阵亡残骸除外），2D 变灰停在原地。守卫：`vehiclePose.canonical-parity.test.ts`（区间内亚米级、
区间外 ≤20 m 冻结差）、`battlePlaybackV2.test.js` 的 `observedFreezeTimeAt` 用例、以及
`BattlePlayback.integration.test.js` 的"失察即冻结"用例（观测内跟随通道、失察冻结在段末）。

**多实体账号（AoI 重入 / 复活换实体）**：同一账号在回放里可能有多个实体，位姿列按 eid 各列一份。
2D 的**活跃实体**判定与 3D 的死亡归属**同源**——canonical 身份证据（`entityFirstSeenByAccount` +
`activeEntityAt`，随 `PoseFacet.entityStartsByAccount` 带出），按采样时刻选活跃实体；证据缺失或
并列（歧义）→ 该车回落 canonical 位姿（fail-closed，不猜）。
**采样时刻还必须落在所选实体的 `coverage` 证据内**（`poseCoveredAt`）：coverage 外没有位姿证据，
而关键帧 / 网格采样在首样本前**端点钳位**——新实体的身份证据（HP / 观测先见）可能早于其首个位姿
样本，直接采样就会把它未来的首帧位姿泄漏到过去（review P2）。不覆盖同样回落 canonical。
守卫：`vehiclePose.test.ts` 的 `selectActiveDef` / `poseCoveredAt` 用例 +
`BattlePlayback.integration.test.js` 的"多实体账号"与"实体身份证据早于位姿覆盖"用例（后者失败态
即泄漏成后一实体的钳位首帧）。

**刻意不呈现**：俯仰/侧倾（"多出的那个维度"）与炮管仰角。2D 是纯俯视，标记视觉层不施加任何
3D 倾斜（原"2.5D 车辆地形姿态"——用底图 heightfield 合成 pitch/roll + ×1.35 增益 + ±14°/±10°
钳制——已整体删除：它是地形坡度而不是记录的车辆姿态，且与 3D 记录值可差数十度）。
2.5D 的**地形起伏背景**（`BattleMap3D` / `projectTerrainPoint`）保留，它只是底图升级，与车辆姿态无关。

- 3D Details 与 2D 共用 canonical 查询及 `V2VehicleInspector`：选中账号对应的 track 提供时刻统计、伤害日志、最后已知时间、装备、物资与消耗品状态，肖像按车型懒加载。2D / 3D 复用工作台 playback session 的同一份解析结果；3D 只等待 scene readiness，canonical 后台就绪后自动增强已打开的 Details。3D 按独立 clock.startRaw 转换场景时钟（不依赖 reload telemetry，与播放条 / 顶栏同一个原点）；2D 的位姿通道同样按 `clock.startRaw` 偏移到回放时钟域（`clockOffset` prop）；数据缺失保持 unavailable，不使用终局汇总代替当前统计。

### 2D 车辆血量显示

Display 的「血量显示方式」提供横条 / 环形，默认横条；偏好与显示血量开关由
`usePlaybackPreferences` 持有并持久化，旧版本偏好自动补为横条。
环形围绕当前车模或类型图标，用剩余弧长表示已知血量比例，我方绿色、敌方红色；
位置或血量进入最后已知状态时变灰，不推测实时视野。未知血量 / 未知容量显示中性虚线，
开局相对满血仍按已有投影语义显示完整环，阵亡车不画血量环。
环形模式不显示血量数字和装填条；切回横条会恢复用户原本的装填开关。
车型图标的环保持屏幕尺寸，车模的环跟随模型大小，线宽及周围间距不随地图缩放增加。
环直径与模型、标签碰撞布局共用尺寸计算，不改变车辆的真实坐标、伤害或观测事实。

标记模式选择工具下，点击未被计划标记占用的车辆仍可打开车辆详情；绘图与拖动操作不触发检查。
2D 详情摘要的血量、百分比与车辆标识来自同一条当前时间投影，拖动时间轴会同步更新，不取最终结算。

### 回放环线身份标志

车型名旁的一／二／三道杠为该玩家在本车已获得的 Gun Marks。数据表、手机卡片、车辆详情、2D／3D 名册与车型标签共用维护者供图提取的透明标志（`src/assets/gun-marks/`）；3D 炮管无贴花。事实读取 workspace 持有的 `LocalPlayback.result.players[].gun_marks`，通过账号联表，属于静态车辆成就，不按回放时钟升降，也不能用于推断本场获得时刻或当前精确百分位。暂停下 canonical 晚到会更新展示，切文件清除旧身份。0 环不画图标，缺失／非法保持未知；详情和独立列用占位符，Excel 留空。名牌标志固定屏幕尺寸并计入名称布局盒，保持既有 HP／reload 行高与选车接线。

地图鸟瞰／回放的完整车辆检查器在车辆信息区显示同一环线徽章和环数；尚无 canonical track 时由简版详情显示，避免重复条目。切换车辆和回放时沿用 owner 结果按账号匹配，未知显示破折号。

环线 SVG 内联透明 PNG 图集，导出图片保持自包含；既有 Chrome 交互门禁包含三档实际 PNG 解码后的像素检查与外链负对照。
