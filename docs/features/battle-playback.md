# 地图鸟瞰与战局回放（Battle Playback）

> 用户可见契约：`ReplayPage` Workspace 的「战局回放」面板（`BattlePlaybackPanel.vue`）（热力 + 战局回放），**不依赖 AI 复盘**——不跑 AI 也能看图。
> 数据来源与素材权威见 [reference/maps.md](../reference/maps.md)（内部 code ↔ 展示名 ↔ 语义 mapId ↔ 素材）。
> 生产口径：回放 timeline 事实按 canonical 语义；AoI hidden = UNKNOWN；禁止跨 AoI gap 插值；死亡 clamp 到权威死亡时刻。

## 数据流与权威边界

`.wotbreplay` → `parseLocalPlayback`（`frontend/src/replay-local/playback/`）→ `BattlePlaybackDataset` / `MapOverview` → `BattlePlaybackPanel` → `BattlePlayback.vue` 的 V2 检查器（`V2VehicleInspector`）。解析在本机完成，服务器没有 playback parser，也没有 `battle-playback-v2` / `map-overview` HTTP 端点。

- **解析位置**：`useReplayWorkspace.ts` 的共享 playback session 调用 `parseLocalPlaybackOffThread`，优先在 `canonical.worker.ts` 生成 canonical 数据；仅线程设施故障回退主线程，解析失败保持错误。3D scene ready 不等待 canonical，Details 后台增强。
- **契约来源**：`BattlePlaybackDataset` 的形状以 `contracts/http/openapi.yaml` 的 schema component 为唯一事实源（端点已删除，schema 保留）；前端 types 与 runtime 校验从该文件生成，本机转换层的输出必须通过同一校验。
- **前端 V2-only**：`BattlePlaybackPanel` 本机生成 V2 dataset 并注入 `playbackV2`；`BattlePlayback.vue` 的 marker / HP HUD / Details Panel / team HP / 事件 feed 全部直接消费 canonical tracks（`healthDisplayAt` / `friendlyHealthAt` / `healthAt` / `lifeAt` / `positionAtV2` / `orientationAtV2`），不经过 compatibility view，也不回退 `MapOverview.Playback`。
- **数据源状态**：时间线不可用 → `dataset = null` → UNAVAILABLE（capability unavailable，不是解析失败）；解析失败 / 引擎不可用 → ERROR（可重试，不回退其他解析路径）。
- **解析复用是方向性的，不是 universal single-parse**：工作台持有唯一一份文件选择与本机分析结果（`useReplaySession` + `useLocalReplayAnalysis`）。3D 先加载时，scene playback facet 可被 canonical projection 复用；2D 先加载时 canonical playback 已解析，之后首次打开 3D 仍会重新加载/解码 scene playback facet。当前共享 selection / session，但不保证两种顺序都只解析一次；不要把它描述成未来的共享缓存设计。

### Canonical 数据形状

- 每条 `VehiclePlaybackTrack` 携带账号 / 昵称 / 坦克 / 阵营 / `friendly`，以及 `positionSegments`、`orientationSegments`、`healthTransitions`、`lifeTransitions`、`consumableTransitions`、`moduleCrewTransitions`、`loadout`、`damageLosses`；battle-level 还有 `events`、`pointsSamples`、`baseStates`、`assaultObjectivePresent`。
- 每条 transition 带 `knowledge` / `provenance` / observation boundary。`positionSegments` 是 client canonical projection 标注的 AoI / position boundary；`EntityLeave`（type-4）只表示实体离开/停止存在，不代表阵亡，也不代表点亮/失察。每一次 leave 都是 coverage 的 hard segment boundary：leave 强制关闭当前区间，leave 后第一条 position（无论 gap 大小）开启新区间。同一实体位置流中断后重新上报的新区间必须保留；前端只依据 canonical segment boundary 判断覆盖。
- battle-level `events` 按 battle-relative 秒升序，稳定码为 `DAMAGE` / `DESTROYED` / `KILL` / `POSITION_REPORTED` / `POSITION_STALE`。`DAMAGE` 只有 `observedHpLoss` 非空时才可作为确定伤害；位置事件只表达服务器位置流覆盖变化，不是点亮。
- `damageLosses` 是伤害数值的唯一来源；`BattleEvent.observedHpLoss` 仅用于单条 notification。`displayCapacityHp` 是 presentation-only（anti-future-leak），不是 canonical max HP。
- `loadout` 离开 AoI 仍为 KNOWN；`consumableTransitions` 在 hidden interval = UNKNOWN。`moduleCrewTransitions` 的 `state=null` 表示该 component 当前无 active fault；consumable runtime 的全局失效由 `invalidation=true` 表达，前端只按 transition 应用状态。`consumableTransitions` 的 `durationSec` / `endsAt` 是上游派生的激活/冷却结束时刻（`endsAt` 为 battle-relative 秒）；`everActivated` 区分「未使用」与「用过后已就绪」，`consumableSlot` 是 loadout 槽位 0..2。
- 位置事件只承载 coverage 语义；`POSITION_REPORTED` / `POSITION_STALE` 等事件保留在 canonical 事件流供 playback state、combat feedback 与 tracer 等内部逻辑使用，不展示给普通用户。

### 方向与装载

- **方向契约**：`orientationSegments` 时间升序，约 1s 降采样 + 方向变化 ≥10° 保点；`hullYawDeg` 来自 type-10 yaw（弧度→度）；`turretRelativeYawDeg` 来自 type-7 propId=2（u16 LE：`raw*360/65536−180`，[-180,180)，完整 360° 且 ±180 回绕）；前端 `turretWorldYawDeg = normalize(hullYawDeg + turretRelativeYawDeg)`。只保留 finite、≤当前查询时间的样本；无可靠方向的车辆不伪造朝向。
- **装载本地化**：DTO 只返回稳定协议标识：`consumables`（logicalItemId，可 null）、`provisions`（可 null）、`equipmentIds`（numeric equipmentId）。上游 v0.4.18 起 `loadout` 直接给出 Type5 解码视图（3 消耗品 + 0..3 给养 + 模式额外能力 + 装备 ID），7 条 GravityMode 布局不再被 6 条门禁丢弃。前端 `src/data/loadoutItems.js` 把 logicalItemId / equipmentId 映射为三语名称（zh/en 取 `common/wotb-item-catalog-json/` authoritative 名称，ru 用官方游戏术语）；`V2VehicleInspector` 渲染本地化名称，绝不把 `MULTI_PURPOSE_RESTORATION_PACK` / `REPAIR_KIT` / `103` 当用户文案。未知 / 未映射条目走三语 fallback，并保留 raw id 仅作诊断。
- **局内定时消耗品徽标**：`utils/consumableRuntime.js` 只输出每车**正处于激活窗口**的定时主动消耗品（`ACTIVATED` 且 `durationSec > 0`）；冷却（`ACTIVE_ENDED_OR_COOLDOWN`）、未使用/已就绪（`INITIALIZED`）、瞬发（激活 duration=0）、`TEARDOWN`/`UNKNOWN` 与 AoI `invalidation` 一律不占 HUD——徽标只表达「现在正在生效」。2D/3D 共用 `PlaybackVehicleLabel`：徽标绝对定位在 HP 血条左侧（不改变血条中心与伤害数字右缘），图标取 `research/consumables` 客户端图标（32px 环内居中、20px 图标），SVG 环按 `remainingSec / durationSec` 消耗；身份未闭合（`logicalItemId` 为空）的条目一律不占位（fail-closed），仅已知身份但缺图时回退缩小的同色点；3D 直接消费 Playback facet 原始事件（`clock`/`state_name`/`duration_s`/`ends_at`/`slot`，与 `T` 同 base）并沿用协议精确 visibility（隐藏期不展示）；**重入 AoI 以当前可见段起点为窗口下界**，离开前的激活/冷却不得复活（未知段不猜状态）；窗口下界归一到 producer 的 0.01s 事件时钟网格（`clock` 经 `r2`，`visibility.t_in` 保留原始 f32），同一 tick 的新激活不会因舍入差被误判为旧事件；`remainingSec` 由 `endsAt` 计算，旧产物缺省时回退 `timeSec + durationSec`。环只表达剩余时间，不裸显 raw wire/logical ID；无图条目回退同色几何点。

### 前端职责边界

`BattlePlayback.vue` 是单一编排入口，负责时间、视图、选择与事件命令；展示层拆为 `BattlePlaybackHud.vue`（双方 HP、权威点数与权威基地状态）、`BattleMap.vue`（SVG、坦克标记、炮线、标注及瞬时反馈）、`PlaybackControls.vue`（紧凑播放控制，内部复用 `PlaybackTransport.vue`）、`PlaybackTimeline.vue`（纯进度条）、`AnnotationToolbar.vue`（折叠式标注工具）、`PlaybackSidePanel.vue`（Battle / Vehicle / Display / Events 面板）和 `VehicleDetailsPanel.vue`（当前车辆详情，内部使用 `V2VehicleInspector.vue`）。`PlaybackMobileOverlay.vue` 只管理移动端 controls 的显隐，不拥有 playback state。

**控件归属：地图盒里不放常驻 UI。** 呈现类开关（一键防遮、名册显隐、HP 档位、重置视图、事件、隐藏 UI）
都在 gear 锚定的 Display 面里；手机横屏的「标记模式」入口由 `PlaybackTransport.vue` 的控制条承载
（`annotationEnabled` prop），不占额外行高。依据：地图是主内容，而手机横屏的高度本来就紧张
（740×360 地图约 266px），放任何常驻控件都会违反 `docs/frontend/design-language.md` §5 的遮挡契约。

`utils/playbackVehicleState.ts` 负责将 canonical V2 track 投影为 marker state，`utils/playbackClock.ts` 提供播放时间/倍速纯函数。拆分不新增数据源、不改变 V2 query-at-time、anti-future-leak 或既有 tank-marker 资产契约。

测试按同一责任边界组织：地图/标记/手势、控制、时间线和详情面板分别由对应 focused suite 覆盖，时钟与车辆投影由纯函数 suite 覆盖；共享 replay fixture 位于 testing-only 的 `playbackTestHarness.js`。`BattlePlayback.test.js` 与 `BattlePlayback.integration.test.js` 只保留跨组件/domain 的编排回归，不重复 focused suite 已覆盖的 presentation 断言。

## 时间语义

- **同一战斗时钟**：播放条、顶栏计时与 Details 都以开战（canonical `clock.startRaw`）为 0、总长 `durationSec`；同一时刻在 2D / 3D 显示同一个时间。顶栏计时是已过时间，不是游戏内剩余倒计时。
- **2D**：`currentTime` 是 battle-relative 秒；所有 canonical 查询、事件、标记、炮线与 Details 都用这一时间。拖动、事件行跳转、±5s、倍速都只改变这一时钟。
- **3D**：战斗时间轴 `[START, END]` 由场景引擎唯一持有（发布为 `store.startTime` / `store.duration`）；会话从开战时刻开始，`seekTo` / `seekBy`（±5）/ `seekFraction`、进度比例与自动停止全部夹在里面，准备 / 倒计时阶段回不去。时钟来源按优先级：工作台 canonical clock（`Replay3DPane` 在 canonical 就绪 / 失败 / 换会话时经 `setBattleClock` 交给引擎，引擎重定范围并把当前 T 夹回去、越过新终点即停播）→ 场景按同一 `resolveReplayClock` 从自身 periods 推出的时钟 → 数据范围（`t_start` → `battleEnd.js`）。
- **时长契约**（`BattleTimelineBuilder.resolveDurationSec`）：playback `durationSec` 四优先级 = battle_results root5 `settlementDurationSec`（finite > 0，权威）→ `RoundFinishedEvent`（method4 / AFTERBATTLE）rawClock − battle 开始 rawClock（finite > 0）→ `battle.durationS`（无 settlement 时即 `meta.json#battleDuration`，不可靠，常比真实战斗长）→ 最后有限事件时刻；前三档均 cap 420s。round-finished 严格优先于 meta，因此 meta 偏长时进度条按真实结束时刻收尾。全部 event / interval / wire 时间字段由 producer 保证为 finite 且位于 `[0, durationSec]`。
- **显示格式**：`formatClock` 先对总秒数统一取整再分解分钟/秒（杜绝 59.6s 显示为 00:60）；3D 的绝对时间轴由 `PlaybackTransport` 统一换算为「已播放 / 总时长」，从 00:00 起算。
- **AI 报告时间**：AI 复盘中的 `03:20` / `3分20秒` 等时间只作为证据定位文本展示，不承担 Playback seek / capability handoff。Replay Workspace 明确解耦 AI 与 2D/3D Playback；若未来统一交互，由工作台级 player state 提供单一 seek 语义。

### 播放传输

- **速度**：0.5× / 1× / 2× / 4× / 8×，通过 `PlaybackTransport` 按需展开选择。
- **拖动**：进度条按下即暂停，拖动中实时 seek，松手时若原先在播放则自动继续；原先暂停则保持暂停。Event Panel 行跳转和 AI 报告时间跳转保持暂停。
- **键盘**：焦点不在输入框、下拉框或按钮时，Space 播放/暂停，Left/Right 分别 seek ∓5 秒；输入控件保留浏览器自身键盘行为。
- **终点**：停在终点时再按播放从时间轴起点重播；时间轴不可用时播放 / 跳秒 / 进度条为显式 disabled，不保留「看起来可用但无反应」的控件。
- **RAF 幂等**：`play()` 在已播放时直接返回，`pause()` 取消未完成回调，任意时刻至多一个 RAF 循环；播放到结尾、切离 playback Tab、折叠地图鸟瞰、组件卸载均停止。
- **全屏与移动端**：全屏进入/退出不 reset currentTime / playing / speed / selectedAccountId / zoom / pan / filters / label 偏好 / annotations（同一组件实例，仅容器变化）；移动端只对 `screen.orientation.lock('landscape')` 做 best-effort 尝试，失败不阻断播放。

## 可见性与反未来信息泄漏

> 在 UI 时间 `t`，任何展示出来的事实只能来自 `timeSec <= t` 的证据。这是 Battle Playback V2 的硬性不变式；canonical 解码器 / battle-start / BattleTimeline 不改，只约束 query-at-time 与 presentation 层。

- **查询守卫**：`positionAtV2` / `orientationAtV2` 中，整个 segment `startSec > t` 对当前查询完全不可见；任何候选样本进入 `lastSeen` 前必须满足 `sample.timeSec <= t`；单样本段在 `t == 首样本时刻` 正确返回。
- **因此**：`t` 之前从未观测的敌方不显示 marker / 位置；仅过去观测过则冻结 last-known（≤ t）；未来重新出现不得使用未来位置。Inspector 的 `last_spotted` 时间恒 ≤ 当前回放时间。
- **稀疏产物**：canonical artifact 允许包含整场时间序列；前端 query-at-time 不允许跨 `t` 读取未来 transition，否则即为 future information leak。
- **位置连续性**：`positionAtV2` 只在 canonical segment 明确允许且相邻 sample 可形成区间时插值；`interpolationAllowed=false`、LAST_KNOWN、segment gap、未来 segment 不生成新坐标，改为返回当前时刻以前的最后可信 sample。`vehicleState.lastKnown = !covered`；covered 只表示 canonical 位置流覆盖，车辆显示位置由 `positionAtV2` 的最后可信结果兜底，阵亡优先于位置中断。
- **方向连续性**：方向采样必须落在该车同一可信 position interval 内，hull yaw 只从同区间位置配对；位置流中断期间不继续旋转炮塔、不跨 gap 取对侧 hull yaw，re-entry 后新段继续。每个可信方向段最后一个样本恒保留（冻结准确）；无可靠方向的车辆不伪造朝向。
- **可见性段**：3D 精确 `visibility[]` 段控制活车显隐（`collision` / 炮塔 / 尾迹同源），`coverage` 只表示「有采样可信」。短隐藏段在 `coverage` 中不断开，因此必须使用 `visibility[]`，不能各自回退到 `coverage`。采样器在隐藏段内取值时，网格列夹到前一段末（最后已知），不无约束地滑向下一段；短于一个网格间隔的可见窗口取窗口结束前的最近网格点，不能取窗口后的下一个 tick。
- **阵亡残骸**：阵亡残骸仍按最后已知位姿保留；活车在短隐藏段内不渲染，2D 平滑冻结最后观测点。

## 生命状态与复活轨道

`lifeTransitions` 的生命语义分层：

- **上游复活轨道在场**：PlaybackData 车辆 `death_times`（≥2 死才输出）/ `resurrection_times`（非空才输出）是死亡/复活时刻 SSOT——死亡 → DESTROYED、复活 → ALIVE 交替，采样只兜底 ALIVE 证据。复活模式（爆燃等）同一 eid 死亡后可复活继续移动，死亡不再是终态。
- **字段缺省**（产物不含复活轨道 / 普通回放）：prop3 `alive=false`（终态，EXACT）→ DESTROYED；可信血量 / alive → ALIVE。字段缺省行为由 golden 锁定。
- **血量判死**：上游切面 `damage` / `health` 的 `hp_state`（当前 pin 恒在场）在场即权威——`terminal` 是负 i16 终态哨兵**全族**（0xFFFF −1 / 0xFFFE −2 / 0xFFFD −3，其余负值同编码；同族全部取值同一处理，禁按分布裁剪），`classifyHpRaw(raw, hp_state)` → `DEATH_TERMINAL`。字段缺省（产物不含 `hp_state`）时缺省分类不放宽：仅 `{0x0000, 0xFFFD}` 为终态，`0xFFFF` / `0xFFFE` 等仍是「未证明哨兵（血量与生死都未知）」，不作为死亡证据；缺省放宽会产生无旁证的死亡判定。
- **AI 复盘一致**：`toClientAiReviewProjection` 的 `prop3Health` / `healthEvents` 正式携带 `hpState`（canonical 权威分类）；Java 侧 `HpRawState.fromProjection` 在场即权威。2D / 3D 与 AI 复盘对同一事件的生命状态一致。
- **3D 回退**：canonical 缺位时 `defLifeAt`（`utils/battlePlaybackV2.ts`）同规则直读 PlaybackData 字段；爆焰按死亡身份（`destroyedKnownAtSec`）去重——同一次死亡的重复迁移只爆一次，复活后的新死亡各自爆焰。
- **复活后血量先落未知**：复活时刻起、到该实体出现第一份可用数值血量证据之前，`healthTransitions` 显式落 `currentHp: null`（展示层渲染「—」）；绝不把死前的 0 / 终态哨兵镜像当成复活后的现值。未知哨兵（`hp = null`，如 PROP3 终态 `DEATH_TERMINAL`）与终态 0 都不算「新证据」（`isPlausibleHp` 判据）。证据窗口 `[复活, t]`，不使用未来采样。
- **每次死亡各一条 DESTROYED**：battle-level `events` 的 DESTROYED 在复活轨道在场（且给出 ≥1 死亡时刻）时改用轨道死亡列（同账号多实体的死亡列合并、升序去重），其余账号维持 canonical 终态重建。2D burst 与 Event Panel 因此每次死亡各出一次；KILL 仍只由 canonical 致死窗口的唯一攻击者证据给出（不伪造击杀者）。
- **阵亡期断链（履带印）**：DESTROYED 期间与 AoI 空洞同语义——既有印记保留、复活后从新锚开始，不与死前锚连铺，避免跨阵亡期/复活迁移桥出长印记。
- **复活后装回炮塔（3D）**：分离（飞头）只属于它发生的那一世——`detachmentAppliesNow` 让 detached 轨道的摘除从首帧起、到该车下一次复活为止生效；复活后的新车装回炮塔（原飞头实体自身仍然按自己的 coverage 渲染，它是独立实体）。若复活后的新死亡再次飞头，会有新的 detached 轨道（新首帧）重新接管。

回归守卫：`canonical/facts.hpTerminal.test.ts`（字段权威 + 字段缺省两侧）、`lifeTransitions.test.ts`（复活后未知边界、证据窗口、每次死亡 DESTROYED、同账号多实体合并）、`playbackScene.test.js`（hp_state=terminal 的 0xFFFE/0xFFFF 行与 0xFFFE 不判死反例、复活后装回炮塔、履带印阵亡期断链）。

## 血量、击毁与战斗反馈

- **HP presentation selectors**：`healthDisplayAt(track, t)` 和 `friendlyHealthAt(tracks, friendly, t)` 是 Battle Playback 的单一展示查询入口。它们只消费 `friendly`、`healthTransitions`、`lifeTransitions`、team 与不晚于 t 的 transition：DESTROYED 显示权威 0；CURRENT / LAST_KNOWN 显示最近可信 current 与 anti-future-leak 的 `displayCapacityHp`；己方存活且 client playback projection 已证明相对满血时返回 `relativeFull`，只渲染 100% presentation；敌方没有 health evidence 时保持 UNKNOWN。relative-full 不代表具体 HP 或 actual max。
- **队伍聚合**：perspective 聚合只在每辆车都有可证 current/capacity 时返回 EXACT；己方 opening 时只消费 client playback projection 提供的 `relativeFull=true`，混合 exact-full / relative-full 仍返回 FULL_RELATIVE；已知掉血 / 阵亡返回 PARTIAL，无证据返回 UNKNOWN，不读取 tankopedia base 或参考 sample 推导本局分母。
- **HP HUD**：每辆可显示车辆常驻「HP 数字 + 定宽 bar」（screen-space 恒定，friendly = 地图 tone、enemy = red 与整车 team token 同源）；last-known 冻结最后可信值并弱化；destroyed（lifeState 权威）隐藏单车 HP number + bar，保留 ✕ / 灰化 / labels / selected / recorder。开关「显示血量」（默认开，`wotb.pb.hp-prefs` localStorage 持久化）隐藏数字 / bar / ghost，不影响 floating damage / destroyed ✕ / sidebar HP / combat state / kill feed / timeline 正确性；重新开启立即按当前 timestamp 显示正确 HP（纯派生，不重头累计）。
- **HUD 数字与语义**：队总 HP 显示完整整数（禁止 1k / 22.3k 缩写）；label 明确「己方总HP / 敌方总HP / 点数」（三语 i18n `hud_friendly_hp` / `hud_enemy_hp` / `points`）。
- **Team HP 延迟伤害**：authoritative current HP 立即更新，delayed-damage chip 短暂停留上一帧值并追赶（0.42s 克制过渡；`prefers-reduced-motion` 禁用；seek / 恢复帧 `hpNoTransition` 直接同步不补播）。
- **destroyed Details**：selected vehicle 已击毁时 `V2VehicleInspector` 明确显示「已击毁」（而非 0 HP / 空血条）；伤害记录 / 击杀 / 承受伤害 / 最后位置等 authoritative facts 仍正常展示。
- **战斗反馈（wall-clock transient；seek 清空 / pause 自然完成 / resume 不重复）**：播放时钟跨过事件由 `eventsCrossed`（严格左开 cursor）消费——DAMAGE → 伤害飘字（-N，受击方阵营色，约 1s 可读时长，同车连续受击纵向 stack）+ HP 数字立即切换 + bar 150–300ms 缩短（CSS transition，seek 单帧禁用）+ hit flash + lost-HP ghost（同阵营色浅版，约 600ms 消退）。`DamageLoss.transientAllowed`、`fromHp`、`toHp` 与 `displayCapacityHp` 均由 client playback projection 直接投影；无法证明时前端不显示 transient / ghost。DESTROYED → 克制 2D burst；KILL → Event Banner（Map Workspace top-center）（「玩家名（车辆名）被击毁」，victim-only，来自 canonical playerName + tankName，最多 2 条队列，单条约 4s 生命周期）。失察期间受击（事件时刻无位置流覆盖）不跳伤害、不更新 HP、不显示 attacker；`prefers-reduced-motion` 取消 ghost / flash / burst / feed 动画（事实保留）。

### 击杀归因

KILL 事件派生自 lethal DamageEvent（type-8 直接伤害通知），只能证明录像者客户端收到该伤害通知、不能证明客户端当时可见全局击杀广播中的击杀者身份 → kill feed 不显示攻击者（victim-only）。

killer attribution 由 `PlaybackCombatReconstruction` fail-closed 推导：致死窗口优先 = 权威致死 HP-loss 窗口（HP 掉到 0 的最后一档，无前序样本回退 0.25s）；窗口内必须存在唯一可信攻击者（身份可解析、候选一致、非自伤）且不含任何无法排除的 unsupported damage 变体。结构合法但语义未解码的伤害方法变体（火灾/撞击等，type-8 解码层产出 `UnsupportedDamageEvent` 证据事件，无精确伤害数字；只要包头确认 damage method 就必产出带时间戳的冲突证据——结构不足短体 `SHORT_DAMAGE_VARIANT`（victim 用 outer entityId）与 direct raw=0（`ZERO_RAW_DAMAGE`，raw 非权威不得当「无伤害」）同样作为冲突证据，warning 只作诊断、不是唯一输出）可能就是真实致死源，窗口内存在即 killer=null，绝不把窗口内无关 direct DAMAGE 错判为击杀者。

unsupported 变体同时阻止 HP-loss attribution：掉血窗口 `(prevT, curT]` 内存在该受害者的 unsupported 变体、或 victim 无法解析的 unsupported 证据（解码层已用可靠 outer entityId 回退，仍无法解析的不得静默视为「无冲突」）→ 掉血数值事实保留、attacker=null、`attackerReliable=false`、`observedHpLoss=null`（cumulative dealt / 伤害日志 / 事件级掉血均不得归给窗口内 direct DAMAGE）；destroyed 事实保留并去重，不因 killer 未知删除 HP=0 / 击毁。

KILL / DAMAGE / DESTROYED 事件多重集（含 `observedHpLoss`）与掉血明细在真实 fixture 上与冻结的 Java golden（`frontend/src/replay-local/__golden__/java-playback.json`）精确比对，由 `frontend/src/replay-local/playback/playback.golden.test.ts` 强制执行。

## 基地与占领

`BattlePlaybackDataset.baseStates` 是 canonical 基地 transition：Supremacy 来自 wrapper12/root11（`baseId=A|B|C|D`），Assault 单基地来自 wrapper8/root8（`baseId=BASE`）。协议证据见 [assault-base-state.md](../research/replay/assault-base-state.md) 与 [supremacy-base-state.md](../research/replay/supremacy-base-state.md)。

- **Assault**：`assaultObjectivePresent` 是目标族存在性（wrapper8/root8 目标族出现即 true，与是否发生过占领无关）；有目标但全程无人进圈也必须是 true。`ownerTeam` / `capturingTeam` 保持 null，禁止从 wrapper8 field4 猜阵营；Assault 的 progress 会真实广播到 100。
- **无状态时**：field3 未出现时 `baseStates=[]`，仍按 mapCode 从 verified semantic 数据渲染静态 BASE，LEFT JOIN 可为空的 runtime state。
- **查询**：UI 时间点只消费 `timeSec <= currentTime` 的最新状态。前端不接触 raw protobuf update，不负责合并缺失字段或协议 index，也不合成进度或阵营结论。
- **进度展示**：`utils/baseStatus.js` 是 2D HUD / 地图 / 3D HUD / 贴地标记共用的 presentation 语义。Assault 的 canonical 显式 `progress=0` 保留在 timeline，但 presentation 视为 reset / idle：BASE 本体继续显示，水位 / 进度环 / 百分比立即清空，后续正值可重新开始显示。Supremacy 的进度只在 `capturingTeam != null` 时展示（缺省字段会保留上一帧 progress，因此门控是 capturingTeam，不是 progress 数值）；无 runtime progress 时同样不画水位。进度数值钳制在 0–100。
- **归属**：owner / capturing 按 `friendlyTeam` 映射为 friendly / enemy / neutral；友方队伍未知时一律 neutral，不猜阵营。Assault 恒为中性，不据静态 scene 推断归属。
- **点数**：争霸赛实时点数来自回放广播 `pointsSamples`（type-8 subtype48 root field12，PROVEN；纯函数 `teamPointsAt` 取最近一次 ≤ currentTime 的广播值，随进度条变化；非争霸赛 / 无广播不显示，结算值不得冒充实时比分）。
- **3D**：Agent 契约的 `supremacy_bases` / `assault_bases` 按 clock 升序折叠到时刻 t（`foldSupremacyTransitions` / `foldAssaultProgress`），再进入同一 `baseView`；3D 不新增 wrapper8 协议解析路径。单基地始终中性，争霸基地从未出现按无主处理。

## 地图鸟瞰（Map Overview，Dataset-only）

战局回放面板与 2D dataset 在同一次本机解析中生成 `MapOverview`（`toMapOverview`，地图档案取自 `common/map-semantics`）→ 前端 `MapOverview.vue` 纯 SVG 渲染热力辅助视图。地图不可构建（未知地图 / 无语义网格 / 无观测）→ `overview = null` → 「无地图视图」。

### 数据链路

- **数据源**：`frontend/src/replay-local/playback/toMapOverview.ts` 直接读 `common/map-semantics/*.semantic.json` 的 `playableBoundsMeters` / `analysisGrid.cells`(6x6) / `sceneEvidence.battlePoints`（出生点），并从本地解析产出的 `BattlePlaybackDataset`（client canonical facts：`frontend/src/replay-local/canonical/facts.ts` 的位置流 / 伤害事件 / 实体→账号映射，经 `toBattlePlaybackDataset.ts` 投影）与结算 `Battle`（权威名册 / 阵亡时刻 / 地图名）聚合。
- **坐标约定**：分析坐标与 `playableBounds` 同系——`x` = 地图横向 = 回放 x，`y` = 地图纵向 = 回放 z（同一原点、同一米制）；`playableBounds` 用于 6×6 分析网格、热力分桶与可玩区域判断。图片渲染边界独立为 `coordinateBounds`（地图图片对应的世界坐标范围）：`px = (x - coordinateBounds.xMin)/(coordinateBounds.xMax - coordinateBounds.xMin) × W`、`py = (coordinateBounds.yMax - y)/(coordinateBounds.yMax - coordinateBounds.yMin) × H`。分析网格坐标仍来自 `playableBounds`，绘制时经同一变换换算，因此只覆盖可玩区、不铺满整图。
- **标题三语**：`MapOverview` 携带 `displayNames{zh,en,ru}`（来自 `common/map_names.json`，未收录时三语同 code）；前端按 vue-i18n 当前 locale 取标题，缺失回退 `displayName`（en）。
- **模式与录像者**：`MapOverview` 携带 `arenaBonusType`（meta.json 原值；1 = 随机战斗，其他 = 训练 / 联赛等，未知为 null）与 `recorderAccountId`（客户端由上游 `author_account_id` 归一化）。录像者昵称由上游 Rust Core（pin 见 `deploy/agent/source.json`）在 `parseResult.author_nickname` 提供，客户端 `frontend/src/replay-local/battleFacts.ts` 原样写入 `Battle.recorder`，导出「录像者」单元格使用。上游值可能是「军团-昵称」拼接（如 `CHRD-A158布丁`），权威录像者身份以 `author_account_id` 为准。
- **自适应配色**：`frontend/src/utils/mapPalette.js` 将底图降采样 64×64 后计算平均相对亮度（sRGB 线性化后按 0.2126/0.7152/0.0722 加权），阈值 0.45——低于视为暗图用亮色系，否则用深饱和色系；热力、网格/九宫格/出生点均随色板切换；canvas 不可用或计算失败时回退暗图默认色板。不做每图手工配色表。
- **布局与标注**：鸟瞰 SVG 宽度由 scoped CSS 控制——桌面/平板为容器宽度 66.7%（约 2/3）并居中，`max-width: 768px` 时恢复 100%（viewBox 不变、不裁切）；九宫格仅绘制分区框（region-line），不绘制数字标注（region-label）。
- **热力口径**：伤害热力按受击方位置落格（受击方阵营）；驻留/阵亡为事件计数；每层 36 个值按 `gridCells` 顺序，前端按 max 归一化。
- **路线字段**：`MapOverview.routes` 仍由 `toMapOverview` 生成（双方 14 车，2s 均匀采样，间隔 = max(2s, duration/200)，每车 ≤200 点；`firstObservedSec/lastObservedSec` 保留诚实观测区间，阵亡时刻由 canonical `lifeTransitions` 标注；连续点是否可插值由 position segment permission 决定，不以固定 packet gap 作为 authority）。当前 `MapOverview.vue` 不渲染路线，数据仅供其他消费者使用。
- **阶段切片**：opening = OPENING + FIRST_CONTACT 合并；mid = 中间段；late = 战斗末 `BattlePhaseSummary.DENSE_KILL_WINDOW_SEC`（15s）窗口（残局）。
- **降级**：未知地图 / 无语义网格 / 无名册 / 无观测 / 视角未解析 → `mapOverview = null`，前端不渲染并显示不可用提示。

### 图片素材与对齐

- **素材唯一权威在前端**：`frontend/src/data/mapImages.js`（mapCode → 图片资源 + 尺寸）既是渲染门控也是唯一素材源——该地图无素材时整块跳过、不画示意图；`MapOverview.image` 恒为 null（兼容字段，不维护第二份目录）。
- **新增素材流程**：图片按英文展示名小写中划线放入 `frontend/src/assets/maps/`（如 `normandy.webp`）+ `mapImages.js` 加一行（key 用内部 code，如 `neptune`）+ 更新 [reference/maps.md](../reference/maps.md) 主表。完整映射（内部 code ↔ 展示名 ↔ 语义 mapId ↔ 素材）见该文档。
- **对齐依据**：每张图片在 `mapImages.js` 配置 `coordinateBounds`——来源为对应 `map-semantics/*.semantic.json` 的 `coordinateSystem.worldBounds`（已登记图均为 -300..300，即完整世界坐标截图；新图以各自语义 JSON 为准，逐图校准）。渲染统一用 `coordinateBounds`，不得用 `playableBounds` 铺满图片（会越靠近边缘偏移越大）。无 `coordinateBounds` 的配置按兼容策略回退 `playableBounds`。
- **2D 底图来源**：`frontend/src/assets/maps/*.webp` 由 Agent 仓 asset_pack `ground.webp` 按冻结配方派生（WebP q90），由 `mapImages.js` 静态 import 随站点发布；当前底图 intrinsic raster resolution 为 1254×1254。来源与配方见 [reference/maps.md](../reference/maps.md)。
- **Android 运行时覆盖**：Android 上底图 URL 可能被运行时更新通道顶替（包内兜底 + 在线校验：sha256 判据、下载校验、失败回落包内），因此 intrinsic 尺寸仍为 1254×1254 但不保证像素与包内那份相同——坐标契约不变。规则见 [reference/maps.md](../reference/maps.md)，实现见 `frontend/src/data/map2dOverlay.js`。

## 2D 战局回放

### 布局与控件

- **手机横屏高度账**：正方形地图只受纵向预算约束，所以横屏把非地图的行压到最小——外壳（顶栏 + Tab 栏）在 2D / 3D 回放就绪的触屏手机横屏下让出（沉浸态，转竖屏或离开回放即恢复）、HUD 压成一行（己方血条 │ 时钟 / 比分 / 基地 │ 敌方血条，不显示地图名）、传输条（时间轴 + 按钮 + 时间）合成一行横跨全宽。实测地图：740×360 约 266px、667×375 约 281px、844×390 约 298px；名册车道只跨 HUD + Stage 两行，不浮在地图上。
- **形态判定**：`shared/breakpoints` 的 `PLAYBACK_MOBILE_QUERY`——Mobile = 宽 < 768px 或触屏且高 ≤ 500px（手机横屏）；768–1199px 一律 Tablet；≥1200px 一律 PC。布局只看可用空间，触屏只放大控件点击区域（44px），iPad / Android 平板使用 Tablet 形态。
- **Universal Battle HUD**：Desktop / Tablet / Mobile 共用同一套 HUD——己方在左、权威比分 / 基地状态在中（无事实时不渲染占位符）、敌方在右；HP 的 FULL_RELATIVE / EXACT / PARTIAL / UNKNOWN 语义保持不变。
- **中心栈**：2D / 3D 共用「地图/时间、HP/比分与 compact 基地 metadata 的持久 HUD → Stage → Transport」。2D 取最大正方形；3D 横屏铺满可用宽高。击杀流是独立的有界 overlay（2D 最多保留最新 2 条、3D 最多 3 条），不参与 HUD 高度预算，条目变化不牵动 Stage / Transport 重排。
- **主控件**：共用 `PlaybackTransport.vue`，顺序为 −5 / Play-Pause / +5 / 当前速度 / 全屏 / Display；速度档位按需展开，六个触控目标至少 44px。时间轴不可用时相关控件显式 disabled。
- **侧车道**：以 workspace 宽度作 fluid sizing，并保持可读下限；桌面左 / 中 / 右列约为 25% / 50% / 25%，短横屏保留主控件所需列宽。HUD 铺满中心列，桌面放大字号与血条厚度；名册与战场标签的装填条均与 HP 条等宽且更细；横条模式的战场血量数值置于加厚血条内，不重复显示百分比。2D Stage 同时受中心可用宽度和实际可用高度约束；3D 横屏画布铺满中心列可用宽高，相机比例随容器更新，竖屏保持正方形。容量按视口算（视口高 − 顶栏/底栏 − 实际 HUD − 实际 Transport − 间距），刻意不用根元素的内容高度，也就不用按断点各写一套固定扣减。
- **Display**：由 `PlaybackDisplaySurface.vue` 锚定 Gear，优先向上、空间不足换边并夹紧；竖屏采用有界 inline 面。Display 与 Events 从 Gear 按需打开，Vehicle 由选车打开 Details；Events 只呈现 `DAMAGE` / `KILL` / `DESTROYED`，点击事件执行 seek + pause，纯时间轴不承载事件标记。
- **Details**：workspace 级可拖动上下文窗；首次落位不压中心栏（HUD / Stage / Transport 同一列，以 Transport 的左右边为准）：侧边车道比浮窗窄时（如 1280 宽桌面）把浮窗收窄到侧边可用宽度，侧边不足 240px 或名册关闭时不收窄（`usePlaybackDetailsPlacement`）。
- **名册**：两队阵容属于 Stage 两侧的有界车道；地图快捷条提供显眼的「收起名单 / 展开名单」，与 Display 共用 `uiPrefs.showRoster`，不改变选车、跟随或播放时间。收起后把车道宽度交还地图；2D 保持完整正方形，已受视口高度限制时不会强行拉伸或裁图。点玩家打开独立 Details，未选车时不预留详情列。
- **详情面板**：点击 marker 打开 / 切换（不 toggle-off）、点击空白不关闭、× 显式关闭、destroyed 车可选、seek 保持同一 selected vehicle；宽屏右侧固定、窄屏（≤768px）置于地图下方。Tier X 车辆按 tankId 懒加载随站点发布的 BlitzKit 车型图；非 Tier X / 缺图 / 单图加载失败时静默省略图片，production 不访问第三方 CDN。面板只含当前 playback 时间点状态：阵营 / 车辆类型（replay → tankopedia fallback）/ 状态（当前观测 / 最后已知 / 已击毁）/ 当前或最后已知 HP（按 provenance：已阵亡 → 0；己方开局相对满血 → 100%；有真实 current → 数字，容量已证明时显示 pct；敌方无依据 → —）/ 当前播放时间 / 已记录伤害（录像者优先取当前时刻之前的 Avatar prop10 累计伤害广播；无该证据时 Σ 可 attribution 的权威掉血）/ 承受伤害（Σ 该车 HP 条可信读数的累计下降，与当前 HP 同源；车辆库 provisional 开局种子不作下降起点）/ 击杀数 + 最近伤害记录（权威掉血；incoming 在相邻可信 CURRENT HP 观测窗口内关联 `DAMAGE`，仅当唯一攻击者的全部可归因掉血恰好覆盖该窗口掉血时显示来源，否则显示「来源未知」）。面板不显示整场最终战绩或协助伤害汇总。
- **不抢页面**：滚轮只在全屏、按住 Ctrl/⌘ 或刚在地图上按下后才缩放，否则交给页面滚动并短暂提示；地图未放大、非全屏、未标注时 `touch-action: pan-y`，单指纵向滑动滚动页面；`active=false`（隐藏的模式 / KeepAlive 停用）时暂停并不响应空格 / 方向键。地图高度扣掉固定顶栏，手机横屏按可用高度封顶。
- **防遮**：2D / 3D 的「一键防遮」复用 `usePlaybackPreferences`：开启后保留车型名，车辆替换为类型符号，并隐藏玩家名、装填条、状态装饰与轨迹；2D 同时保留环形血量，3D 沿用隐藏血条的呈现；再按一次恢复开启前的配置。预设是临时状态，不覆盖持久化偏好；手动更改显示选项则退出预设并保存当前组合。名单开关独立于预设。Display 保留「坦克类型图标」「状态标记」单独开关。
- **车型图标**：实际车辆和战术标记统一使用 `TankClassIcon.vue` / `utils/tankClassIcon.js` 的 LT 单菱形、MT 双分段菱形、HT 三分段菱形和 TD 倒三角；未知车型不猜类别，使用中性圆形。3D 类型符号由既有投影标签层呈现并可选车，场景只隐藏车模绘制节点，保留位置、可见性事实与拾取代理。手机短横屏把标记入口并入地图快捷条，保留 44px 触控区域。

### 地图、标记与图层

- **渲染结构**：2D 底图由 `BattleMap.vue` 的独立 `.pb-basemap` HTML `<img>` 渲染；`.pb-svg` 承载 vector overlays，`.pb-markers` 与两者共享同一个 `.pb-viewport` camera frame。底图和 SVG 按 `mapView.W / mapView.H` 的 frame `fill`，保持 overlay 对齐。
- **坐标空间**：`mapImages.width/height` 是 logical / render-frame dimensions（约 754–783），由 `createMapView()` 生成 `mapView.W/H`，作为 `coordinateBounds`、terrain projection、SVG `viewBox`、车辆 / 基地 / 轨迹 / 标注及 pointer conversion 的共同坐标空间；不得用图片实际像素替换。
- **相机与栅格**：运行时 raster capacity 以 `requiredDeviceWidth = renderedCssWidth × view.scale × devicePixelRatio`（height 同理）诊断；源分辨率不足时保持 1×→4× camera contract，不用滤镜弥补源图细节。地图、网格、炮线与标记在同一 `.pb-viewport` 单层 transform（translate + scale）下严格对齐；网格 / 区域 / 出生点（A/B/C 基地）属地图内容，随缩放。
- **坦克标记**：用四张运行时 PNG（`frontend/src/assets/tank-icons/tank-marker-{friendly,enemy}-{hull,turret}.png`，512×512 RGBA、共同 pivot 256,256）渲染 HTML overlay 标记；marker 尺寸由 `utils/vehicleMarkerSizing.js` 集中计算（`vehicleSizes` 真实车体表优先，模型 `hullBounds` 与 replay / tankopedia vehicle class 依次兜底，桌面 / 移动端分别 clamp 在 10–30px / 10–26px）。raster 使用等比 square renderBox（dedicated bake 的车体长边约占 88%，真实长宽比已由图片 geometry 编码）；physical footprint 只用于 tank model collision，hit target 独立计算；不对 raster 做非等比 X/Y 拉伸。
- **标记视觉**：hull / turret img 放大到按钮 134% 并以共同 pivot 居中旋转（`translate(-50%,-50%) rotate(...)`）；generic 素材透明留白有效车体 bbox ≈ 210×336/512（长边占 65.6%），dedicated hull.webp 车体按自身模型盒渲染。hull 层按 `hullYawDeg` 旋转、turret 层按 `turretWorldYawDeg` 旋转（炮管不脱离炮塔）。整车 team outline + glow 由 `VehicleMarker .pb-graphics` 双层 drop-shadow 表达（CSS vars `--pb-team-*` / `--pb-enemy-*`，friendly 按地图显式 tone green|blue、enemy 固定 red，见 `data/mapTeamColors.js`；generic 素材自身阵营色保留，叠加同一 team 光晕）。Selected 红色倒三角（label 上方、浮动、screen-space 恒定；元素尺寸按 overlayInverse = 1/view.scale 反缩放；bottom 按推导式 `X = 4.5 + 14.5×inv` px 使三角底边跟随 name 顶边，selected→name 屏幕 gap 恒 3px；浮动幅度 2px × `--pb-overlay-inv` 恒约 2px）；Recorder 空心菱形（tank 下方、friendly 色、offset 按 5×inv 反缩放 → 屏幕间距恒 5px）；最后已知淡化；阵亡 ✕（覆盖车体中心、明显放大 30px、screen-space 恒定）均为独立 overlay，不烘焙进 PNG。
- **型号名**：标记上方常显固定字号坦克型号名小标签（`PlaybackVehicle.tankName`，权威解析自 tankopedia，如 29985 → `SPHT`）；标签自身按 `1/view.scale` 反缩放 → 字号不随地图缩放、任意缩放下可见。
- **模型与回落**：`preload` 未完成（asset decision 未定）时不渲染车辆，禁止 generic 闪现后替换；非 Tier X / preload 失败 / 模块加载失败 → generic marker 单车 fallback。
- **真实位置**：坦克标记不做防重叠位移——车体严格落在真实位置，密集处允许图标互相压盖（与 3D 一致，3D 从不移动车体模型）。名牌 / HP 的防重叠由标签车道机制承担。

### 标签、偏好与命中

- **标签内容**：控制栏「显示玩家名 / 显示坦克名」checkbox（默认玩家名关 / 坦克名开，`localStorage` 持久化 `wotb.pb.label-prefs`）；PlayerName + TankName 由与 3D 共用的 `PlaybackVehicleLabel.vue` 呈现（team 文字色消费语义 token、无整卡不透明黑底、destroyed / last-known 弱化）；PlayerName 按实际像素截断（max-width + ellipsis），截断才有完整名 tooltip。
- **标签碰撞**：纯函数 `utils/labelLayout.js`（screen px，仅 tank model box 参与，离开 viewport 时自然裁剪）——TankName 冲突从下往上 greedy 上移让位（下方先 finalized、上限一行，3+ 连锁不重新产生 overlap）；PlayerName 冲突经时间阈值（hide 250ms / show 300ms，`performance.now` UI wall clock——播放由 frame 刷新、暂停由轻量 RAF 继续推进，不依赖播放状态）隐藏 / 恢复（约 120ms opacity fade-in，类保持完整生命周期不被下一次 resolve 取消）；PlayerName 盒从 final TankName 盒推导（与共享 label 块整体位移一致）；zoom 结束由 computed 依赖 view.scale 自然重算。
- **命中测试**：点击使用 marker 真实位置上的小幅扩展 hit target（不参与视觉碰撞，不含 gun overflow / label / 三角 / 菱形 / ✕；destroyed / last-known 仍可点）；重叠时取指针最近车辆，距离几乎一致且已选中则保持，否则 render order tie-break。
- **偏好 owner**：`usePlaybackPreferences` 是模块级唯一 reactive owner，所有存活的面板消费同一份 `labelPrefs.showPlayerName / showTankName / showReload` 与 `hpPrefs.showHp`；默认昵称关、车型/血量/装填开，既有持久化 key 与迁移语义保留。任一面板改变偏好，另一面板立即观察到。名牌直接使用语义 CSS token，不铺整卡不透明黑底，字体保持屏幕空间可读大小，长名称受限截断。
- **i18n 回归**：三语 `recon.map.playback.last_known` 文案不得含裸 `@`（Vue I18n 11 linked-message 语法）；选中 last-known / 已击毁车辆首次渲染该文案时编译报错会导致组件整体卸载。`BattlePlayback.i18n.test.js` 用真实 `createI18n`（不 mock `$t`）覆盖 zh/en/ru 选车路径。

### 缩放、全屏与标注

- **缩放平移**：`.pb-viewport` 单一 transform 层（translate + scale）同时承载 SVG 与 HTML 标记；滚轮锚点缩放（1×–4×，`zoomViewAt` 锚点不动）、双指捏合、单指 / 鼠标拖动（>5px 阈值，拖动后吞 click 防误选车）、重置按钮；地图区域 `touch-action:none`，地图外页面滚动不受影响；卸载清理 window 级 pointer 监听。炮线各层 `stroke-width` 逐元素绑定（光晕 `6/view.scale`、内芯 `1.75/view.scale`，屏幕宽度恒定，放大后不变成粗色带；长度仍随地图坐标）。
- **全屏**：控制栏「⛶ 全屏 / 退出全屏」（i18n 三语 `enter_fullscreen` / `exit_fullscreen`）；全屏对象 = `.battle-playback` 根容器（地图 + 全部 controls + 标注 + 信息面板，不含页面 header/nav）；状态事实源 = `document.fullscreenElement === 当前根容器` + `fullscreenchange`（ESC / 浏览器 UI 退出立即同步，禁止手工 `isFullscreen = !isFullscreen`）；`typeof root.requestFullscreen !== 'function'` → 按钮隐藏、点击不抛错（不实现 fake fullscreen）。尺寸响应：`mapSize` 由 `ResizeObserver` 观察 `.pb-map` 更新，无 RO 环境回退 `clientWidth`；markerScreen / labelLayout（viewportW/H）/ selectAt（hitTest 像素→内容坐标）/ textInputStyle / semanticPoint 全部经 `mapWidth/mapHeight` 读取 → fullscreen enter/exit 后 collision / hitbox / 标注换算立即用新尺寸重算，禁止 magic delay。zoom / pan 不自动 reset（无 auto-fit；Reset View 由用户使用）。地图按真实宽高比 contain，无非等比拉伸；zoom 后可大于 viewport 随 pan/zoom 裁剪。生命周期：`fullscreenchange` listener 与 `ResizeObserver` 在 unmount 时移除 / disconnect；组件在全屏中被卸载时仅退出自己拥有的 fullscreen。旋转换算：地图 yaw 从北(+Z)顺时针 → 屏幕 `rotate(yawDeg)`（0=朝上 / 90=朝右 / 180=朝下 / 270=朝左，两次翻转抵消，无符号 / 偏移修正）。
- **标注模式**：默认关闭且没有预置标记，优先展示真实对局过程。播放区的一级「标记模式」按钮打开工具并暂停，默认选中「选择」，不会因点击地图误画；退出不自动播放，主动播放会退出编辑并保留已完成标记。标注仍为纯前端临时状态，不持久化、不调远程接口；2D 标注不与 3D 同步（3D 有独立的 session-only drawing，见下）——刷新 / 切文件 / 卸载战局回放即清空（切文件经 `watch(overview)` 重置，同时关闭编辑）。
- **标注工具**：工具栏同级提供 LT / MT / HT / TD（坦歼），用共享实心兵种符号、虚线圈及「计划」标签与真实车辆区分；路线按地图点击添加途经点，至少两点后点「完成路线」或 Enter 提交，Esc / 取消按钮丢弃草稿。这些路线表达用户战术意图，不是车辆实际行驶轨迹。选择后可拖动整体移动，兵种 / 路线 / 文字可改名，所有对象可改色、删除、撤回；属性只在选中时显示在工具条内，不设常驻右侧栏。保留画笔 / 橡皮擦 / 箭头 / 直线 / 矩形 / 圆 / 文字 + 9 色固定色板（含纯黑）+ 粗细（1–12）+ 撤回 / 重做 / 清空 / 显隐。模式外保留原有平移 / 选车；模式内车标不抢点击，双指捏合和滚轮缩放保留。第二指加入或 pointercancel 取消当前单指编辑，避免捏合意外生成标记；输入框和 IME 合成不劫持快捷键。
- **标注几何**：几何一律存语义坐标（x = 回放 x，y = 回放 z），经既有 `createMapView` / 地形投影渲染；没有第二套 ReplaySession、parser 事实或持久化 schema。手机横屏（含全屏）工具条为一行横向滚动，退出固定靠左、路线完成和选中属性优先显示；开启期间暂收起播放控制 / 时间轴与入口行，为地图保留高度，HUD 仍显示当前时间；退出恢复同一播放器控件及暂停状态，不清除标注。竖屏和桌面仍保留完整播放控制及分行工具。
- **屏幕↔语义换算**：`.pb-map` 渲染宽度为容器 66.7%（移动端 100%），CSS 渲染尺寸 ≠ viewBox W/H，禁止把 CSS px 当 SVG unit。正链：client px → 相对 `.pb-map` 的 CSS px（`screenPoint`）→ 撤销 viewport translate/scale → 未缩放 CSS px ×(viewBox/渲染尺寸)（`screenToSvg`，渲染尺寸取 `.pb-map` clientWidth/clientHeight，缺失按 1:1 回退）→ `fromX/fromY` → 语义（`screenToSemantic`）；反链（文字输入框定位）`svgToScreen` = SVG unit ÷W/H ×渲染尺寸 ×scale + translate，`svgToScreen(screenToSvg(p)) ≈ p`。
- **撤销与橡皮擦**：undo/redo 为全量快照（`commit/undo/redo`，上限 `UNDO_LIMIT=100`）；橡皮擦把 eraser path 当作 semantic capsule 扫过平面，按子段裁剪自由笔迹（`applyEraser`，2D/3D 共用），对形状 / 文字整件擦除；文字标注落点即位置（临时输入框 Enter/blur 提交、Esc 取消，committed 幂等防重复）。三语文案 `recon.map.playback.annot.*`；纯函数与交互回归见 `utils/annotation.test.js` 与 `BattlePlayback.annot.test.js`。
- **3D 地形绘制（V1）**：3D drawing 入口属于 3D 自己的 tool-row（Camera / GLB / Drawing），不在 shared transport；打开后 tool-row 让位给 AnnotationToolbar，shared transport 保持六个 primary actions（−5 / Play / +5 / Speed / Fullscreen / Display）。打开不改变 playback 的播放/暂停状态（transport 仍归 play / pause / seek / speed 控件），关闭后标注保留。compact 工具条复用 `AnnotationToolbar`，只显示当前 tool 相关 slider：Pen → Color / Pen width，Eraser → Eraser radius；Undo / Redo / Clear / Show-Hide / Close 常驻。annotation 仍只有 `{ type:'pen', color, width, points:[{x,y}] }`：`x = 回放 x`、`y = 回放 z`，3D world Y 不进入 SSOT；width / eraser radius 由 `semanticWidthFromSlider` 按 `mapImages` 的 canonical logical width + coordinateBounds 换成 map-space，不随 camera zoom 改变（2D 共用同一 helper；未登记地图 1:1 回退）。commit boundary 先 normalize（sanitize + 轻量 Chaikin smoothing + committed budget resample）；`annotation.points` 是 renderer 与 eraser 共用的 durable centerline，renderer 不再二次平滑。renderer 按当前 terrain build 做纵向 adaptive subdivision，并做 adaptive cross-width tessellation（center sample + cross midpoint terrain error / 实际 miter span 触发细分）；对候选 ribbon cell 的两个 triangle interior 做 terrain-clearance validation（递归 sub-triangle，按 terrain deviation / 空间 edge bound 终止），失败时继续细分 longitudinal row / cross fraction，受 depth 与 total vertex budget 约束；预算耗尽或 max-depth 仍未 convergence 时，该 cell 作为 unresolved/unsafe 跳过 indices（不输出无法证明安全的 triangle），不截断 stroke。terrain LOD 重建后按 semantic XZ 重投影；raw input / committed centerline / projected centerline / cross vertices 预算分离，预算不足按 segment/横向密度降精度且保留首尾/完整 span，不会 prefix truncate。Eraser 不操作 Three.js 三角形：scene 收集 semantic eraser path + radius，pointerup 时由 pane 调一次 `applyEraser` 并只产生一个 undo step；capsule 的 start/end disc 始终参与，body projection miss 不会绕过端点圆帽。桌面左键在 terrain 上画/擦，右键 / 滚轮 / 点车选中在 tool off 时保持原语义；手机单指画/擦，第二指取消未提交草稿并把双指交给现有相机导航，双指结束后工具保持、下一次全新单指继续。连续有效 terrain hit 之间的大距离只按 fast swipe 处理，不触发 reconnect freeze；仅 hit → miss → hit 且 XZ 跳超过 25m 时冻结该 gesture。1 个完整 gesture = 1 undo step；Clear = 1 step；Hide 只切 renderer 可见性、不进 history。V1 不持久化、不与 2D 同步；无 LT/MT/HT/TD、路线、形状、文字、选择/移动、压感。三语 `recon.map.playback.annot.*`（新增 `eraser_radius`），几何 / 交互回归见 `scene/playback/annotation3d.test.js`、`playbackScene.test.js`、`Replay3DPane.test.js`。

### 炮线、事件与状态

- **炮线 / 曳光线（已知射击）**：`visibleTracers` 由纯函数 `tracerLines`（`utils/battlePlayback.js`）按当前时间推导——候选 = 真实事件流中的 DAMAGE 与 KILL（攻击者已解析），同 attacker / target 且时间差 ≤ 0.25s 视为同一炮，只画一条并优先保留 DAMAGE；目标端必须满足 canonical `positionSegments` 的 OBSERVED 覆盖与事件时刻位置查询，segment gap / 末点后 / 首点前一律拒绝；射手端有可信位置才连线，射手未侦察时只出命中闪光、不画线。两端都不用最后已知位置伪造射击位置。
- **炮线时间**：可见窗口 = `0.8s × 播放倍速`（1× / 2× / 4× / 8× 各约 0.8s 真实时间，`TRACER_BASE_SEC=0.8`），前 0.3s 保持全亮（`TRACER_HOLD_REAL_SEC=0.3`），之后线性淡出到窗口结束；命中闪光窗口 `0.7s` 真实秒、前 0.2s 由 0 升至峰值 0.9 后线性淡出（`TRACER_FLASH_REAL_SEC=0.7` / `TRACER_FLASH_PEAK_REAL_SEC=0.2`），`flashProgress=1` 时不再渲染圆点。保持期 / 闪光窗口随倍速换算，各倍速真实时长一致；纯函数只依赖 now / speed → seek / 倍速天然正确，无一次性定时器；端点恒为事件时刻可信位置（`trustedPositionAt`），绝不绑定车辆后来的位置——射击几何不变。
- **炮线外观**：每炮线渲染三层——外层阵营色光晕（`6/view.scale`、opacity × 0.35）+ 内芯亮白细线（`1.75/view.scale`、opacity）+ 命中端短促冲击闪光（半径 3→12px）。未命中 / 盲射 / 弹道弧线 / 瞄准线无数据依据，不渲染。
- **阵亡与最后已知**：destroyed 是显式独立状态，不并入 `pb-last-known`；敌我阵亡车结构一致（hull + turret 双层 + 同款 ✕）：方向冻结在最后可信样本（`orientationAtV2` 末样本冻结语义），canonical state 无方向样本不合成旋转角；generic destroyed marker 仅以未旋转素材保持可见（不代表朝向）。中度变暗（`.pb-destroyed .pb-graphics { opacity:.55 }`）+ grayscale + team outline 弱化保留（drop-shadow 在 grayscale 后绘制不灰化）+ 一次性 transition 0.45s（`prefers-reduced-motion` 直达终态）；红色 ✕ / Selected 三角 / Recorder 菱形在 `.pb-graphics` 容器外，保持完整强度。Last-known：`.pb-graphics` 淡化 0.35 + 仅弱 outline（无 glow）；label 仅文字弱化（background 正常）；Selected / Recorder 正常强度。
- **最后已知面板**：显示真实的最后可信时间（`pos.timeSec`），不显示 `currentTime`；覆盖中实体实心显示、位置中断实体淡化最后已知位置、从未上报位置实体不显示、阵亡实体在阵亡时刻切换为 ✕。
- **事件面板**：默认折叠，展开后仅列出用户可读的 DAMAGE / KILL / DESTROYED 事件；POSITION_REPORTED / POSITION_STALE 等 coverage 事件不展示给普通用户。点击事件行 seek 到该事件时间并保持暂停。
- **路线不渲染**：2D 战局回放视图不渲染车辆路线；路线数据仅作为位置插值与炮线端点的内部输入。

## 2D / 3D 位姿同源

2D 俯视就是 3D 场景的俯视版本：车辆位置与朝向由 3D 场景和 2D 共用的位姿采样器 `replay-local/pose/vehiclePose.ts` 提供——同一套通道选择（`pose_kf` 关键帧折线优先，缺省回退 10Hz 滤波网格线性插值）、同一插值、同一解卷绕域；两个页签逐帧同一画面。

- **画在哪 / 朝哪** → 位姿通道（playback facet 的位姿列投影 `PoseFacet`，随 `LocalPlayback` 带出，2D 单独打开也拿得到）；game 坐标系（x 不镜像、z 北），视图各自施加帧变换：3D 场景 `(−x, y, z)` + yaw / roll 取负，2D 地图 `toX/toY`（y 翻转、无 x 镜像）。帧契约的可执行验收：`replay-local/pose/vehiclePose.parity.test.ts`。
- **可不可信** → canonical 知识层：观测区间（`positionCoveredAtV2`）决定 last-known 淡化、尾迹断链、炮线端点门控与伤害浮字锚点；canonical 原始观测（type=10）不再进入渲染取值。冻结的 Java 金标（`__golden__/java-playback.json`）因此不受影响。
- **炮塔**：facet 的 `turret_yaw` 为绝对角且与 `hull_yaw` 严格同长（上游「本车无 prop2 ⇒ 相对 0」回退），2D 换算 `wrapPi(绝对 − 车体)` 后渲染；炮塔层在相对角首样本前也按上述回退显示。炮塔 / 炮管 / 侧倾只有 10Hz 网格列，采样器接收协议精确的 `visibility[]` 段（`buildPoseFacet` 逐车透出；缺省回退 `coverage`）：只在段内网格点之间插值（`sampleChannelWithin`），车辆刚进视野时只在已观测段内插值，不跨隐藏段滑角。段内第一个网格点之前保持该点值。短隐藏段（<2s）在 `coverage` 中不断开，因此必须使用 `visibility[]` 而不是 `coverage`。
- **共享投影**：2D 与 3D 共用 `visibilitySpansByEid` 投影（3D 从 `DATA.visibility` 建 eid 映射）；末段 `t_out` 缺省投影为 `+Infinity` 并作为合法段终点；两视图不得各自回退到 `coverage`。
- **失察即冻结**：车辆离开我方视野后，2D 图标停在最后观测点——采样时刻由 `observedFreezeTimeAt`（`utils/battlePlaybackV2.ts`）给出（最后一个 OBSERVED 段的结束时刻），位姿仍取自同一通道但时刻冻结，不跟随客户端滤波器在失察区间的预测延续。语义与 3D 对齐：3D 里该车模型直接不显示（`visibleAt(v, T)` = coverage 区间，阵亡残骸除外），2D 变灰停在原地。守卫：`vehiclePose.canonical-parity.test.ts`（区间内亚米级、区间外 ≤20m 冻结差）、`battlePlaybackV2.test.js` 的 `observedFreezeTimeAt` 用例、`BattlePlayback.integration.test.js` 的「失察即冻结」用例。
- **多实体账号（AoI 重入 / 复活换实体）**：同一账号在回放里可能有多个实体，位姿列按 eid 各列一份。2D 的活跃实体判定与 3D 的死亡归属同源——canonical 身份证据（`entityFirstSeenByAccount` + `activeEntityAt`，随 `PoseFacet.entityStartsByAccount` 带出），按采样时刻选活跃实体；证据缺失或并列（歧义）→ 该车回落 canonical 位姿（fail-closed，不猜）。采样时刻还必须落在所选实体的 `coverage` 证据内（`poseCoveredAt`）：coverage 外没有位姿证据，而关键帧 / 网格采样在首样本前端点钳位——新实体的身份证据可能早于其首个位姿样本，直接采样会把它未来的首帧位姿泄漏到过去。不覆盖同样回落 canonical。守卫：`vehiclePose.test.ts` 的 `selectActiveDef` / `poseCoveredAt` 用例 + `BattlePlayback.integration.test.js` 的「多实体账号」与「实体身份证据早于位姿覆盖」用例。
- **刻意不呈现**：俯仰 / 侧倾（「多出的那个维度」）与炮管仰角。2D 是纯俯视，标记视觉层不施加任何 3D 倾斜；2.5D 的地形起伏背景（`BattleMap3D` / `projectTerrainPoint`）保留，它只是底图升级，与车辆姿态无关。

## 3D 回放

### 运行时与资源

- **解析**：3D 解析在 Worker 内跑（`scene/playbackParse.worker.ts`，失败自动回退主线程），同一文件（名 + 长 + mtime + 采样指纹）的解析结果缓存最近 3 场；解析只构建一次 canonical facts。
- **渲染节拍**：按需刷新（暂停且无在飞特效、相机静止时不重绘）；HUD / 进度条 / 名册按约 10Hz 写 store（3D 平滑度来自场景时钟，seek 时立即补写一次）。**实时帧率角标**：舞台右下角常驻 `FPS · 平均/峰值 ms`，**只统计真正渲染的帧**（按需渲染下 rAF 每帧都跑、暂停静止时一帧都不画，数 rAF 回调会得到与画面无关的高帧率——这正是「卡顿与显示帧率不符」的来源）。`scene/frameMeter.js` 做 500ms 窗口统计并暴露窗口内最差一帧间隔；空闲超过 0.6s 归零显示 `—`；平均 <45 FPS 或峰值 >2.5×平均（顿挫）时变琥珀色。`隐藏全部 UI`（`H`）时一并隐藏；`pointer-events:none`，不拦截场景拖拽。
- **特效与资产**：战斗特效（曳光 / 光迹 / 开火 / 命中 / 爆炸 / 残骸烟）由 `scene/battleFx.js` 合批与池化，仅在会话结束时整体 dispose；资产加载有限并发（`ASSET_CONCURRENCY = 4`，地表贴图与坦克 GLB）。
- **场景内核**：`frontend/src/scene/playbackScene.js` 是上游冻结 Agent 前端的同源分叉；上游已停止维护，本仓按需移植其场景渲染实现（材质实例去重、叶卡 / 伪透明 / 水体管线、曝光修整等，见 `scene/sceneryMaterials.test.js` 的源码级接线守卫）。上游若有新的渲染修复，需要人工比对移植，不会自动同步。
- **资产降级**：核心资产缺失 / 失败时 3D 面板显示非阻塞降级提示（`scene3d-asset-degraded`），`hasData=true` 不单独代表健康加载完成；地面 / 地形 / 场景 / 光照等 404 或解析失败写入 `store.assetIssues` 并置 `store.assetDegraded`；变体映射缺失 / `variantMappingIncomplete` 标记导致的 fail-closed 裁剪同样计入降级。

### 车辆、击毁与相机

- **车体位姿 = 回放记录位姿**：整台车（含挂在其下的履带 / 负重轮节点）按记录的 yaw / pitch / roll + y 摆放——低模组走 `group.rotation`（YXZ，y = −yaw / x = pitch / z = −roll），GLB 根走 `poseFromYPR(−yaw, pitch, −roll)` 单次合成。模型系到场景系是「x 取负」的镜像，故 yaw 与 roll 取负、pitch 不变；产物缺 `hull_roll` 时按 0 = 水平（不拿 pitch 顶替）。
- **非底盘节点**：`__hullGroup` 保留但恒归单位——非底盘节点（hull* / turret* / gun*）收进该组、`chassis_*` 留在根上（命名不符 → `hullGroup=null`，整台刚体 fail-safe），作为逐轮贴地 + 履带分段形变的挂点；identity 下不改变渲染结果（低模侧同式）。
- **固定战斗室车辆（歼击车）**：客户端源模型本就没有炮塔实体（T110E3 / ISU-152 / T28 / SU-85 / StuG 等）时，`model_origins`（track / turret 枢轴）与炮管组齐备即挂载；`poseGlbRig` 里炮管组直接吃 `mG = mT·Rx(gr)`——绕 track + turret 枢轴的横转（含 `initial_turret_rotation` 补偿）与绕 `gun_origin` 的俯仰一并写入炮管组，与客户端「TD 的炮塔 = 炮架横转」呈现同构；回转炮塔路径逐值不变。无炮塔且无炮管组的模型无受姿部件，仍退代理车（fail-visible，warn 留痕）。
- **3D 击毁车辆视觉**：复用原车模，死亡后 0.30 秒开始去饱和和压暗，0.80 秒完成哑光炭灰残骸状态，保持到回放结束。完全去饱和，在显示颜色上取原明度的 45%，再加 0.035 的暗部提亮，保留阴影里的装甲与履带细节；弱化金属反光（metalness 降至原值的 5%）、提高 roughness（至少 0.90，封顶 1），emissive 归零。低模和 GLB 同一语义，原装甲 / 履带细节及透明度保留；作者标记环、标签与爆炸独立。倒带恢复原参数，不增加车辆残骸资产、贴图、几何或 draw call。
- **死亡判据**：模型、名牌与名册共用 canonical `lifeAt` 的死亡判据；canonical 时间以 `clock.startRaw` 换算到场景 raw 秒，禁止用 HP=0 推断死亡。canonical 未就绪 / 失败时沿用场景权威 `death_t`；canonical 已就绪但缺生命事实保持未知；已确认死亡但无死亡时刻直接显示终态。同账号实体重入时，生产者与场景共用 canonical 首次身份观测和「最新已出现实体」规则，不按 eid 数值排序选实体。`LocalPlayback.entityStartsByAccount` 是工作台内部的 battle-relative 身份证据，不进入 HTTP dataset。死亡按实际死亡时刻归属，禁止广播给过去 / 未来实体；同刻首次观测或缺失而无法唯一归属时保持未知，不显示残骸或爆炸。既有本地会话没有身份证据映射时仅以已记录 coverage 使用同一选择规则。
- **过渡求值**：只按回放时间求值，暂停、倍速、seek 和 GLB 迟到 / 重开均在当前时间投影。GLB 每车只克隆材质、同车复用原材质对应的副本；共享模板纹理 / 几何不由车辆释放。材质 shader 组合既有坦克光照补丁，渐变只改 uniform / PBR 参数，不逐帧重编译。
- **独立炮塔**：含 `detached_turrets` 的产物提供炮塔实体、权威车辆归属、可见区间和位置 / yaw / pitch / roll。实体首次已知后，原车模的选中炮塔及炮管隐藏；同一组模型部件以炮塔枢轴为原点，按独立实体的完整位姿飞行、落地及后续移动。低模保持同一分离语义。直接 seek、倒带、暂停、倍速、GLB 迟到及模型开关均由回放时钟确定；AoI 缺口隐藏独立部件，不跨缺口插值。产物缺少字段则保持完整原车模。飞头实体是呈现依据，低血量、HP=0 或普通击杀不单独触发；不能由飞头反推弹药架殉爆死因。样本协议范围为 11.20；当前正式 pin 为 v0.4.9，`detached_turrets` 在场。
- **选择与相机分离**：2D marker、3D raycast 与 roster 行都只选择车辆并打开共享 `VehicleDetailsPanel.vue`；3D 场景通过 selection callback 上报，由 Pane 持有 `selectedEid`。选车不移动相机、不自动 Follow；Follow 是显式相机命令，Free / Top 不清选中。详情共用 identity / HP / time 契约，portrait、last-known、destroyed-at、stats、track inspector、damage log 使用 canonical track（含装备、物资、消耗品状态）；3D 缺失字段不写假零。phone / 短视口详情临时覆盖，不占永久场景空间，关闭不重新解析、不重建 Three.js 或加载资产。
- **自由视角键盘飞行（FPS 相机）**：相机档位 `自由 / 俯视 / 跟随` 中，只有**自由**时内核接管为 FPS 语义——左键拖拽直接改相机 yaw/pitch，target 重钉到相机前方固定视距，因此**旋转中心是相机自身**；`W/A/S/D` 沿相机水平朝向平移、`Q` 升 / `E` 降（世界系垂直），`1–6` 切换速率档 `[2, 6, 15, 40, 90, 200] m/s`（默认档 3 = 15 m/s，与播放倍速互相独立）；滚轮沿视线推拉相机（推近/拉远，视角与视距不变）。接管态由 `CAM === 'free'` 派生，不存第二份状态，**也不按输入设备能力探测开关**（`(pointer: fine)` 在触屏笔记本 / 平板模式下会报 coarse，一旦据此关闭接管，自由模式会整条失效并退回 OrbitControls）。`pointerdown/move/up/wheel` 在容器的 **capture 阶段**拦截并 `stopPropagation`，OrbitControls 在自由模式收不到输入，切回跟随 / 俯视时恢复原生环绕（含阻尼）；触屏使用同一套手势：**单指拖拽 = 转头、双指捏合 = 沿视线推拉（缩放）**。相机被外部路径改过（初始视野 fit、跟随退出、边界钳制）时，拖拽 / 滚轮 / 飞行的起点先按当前 cam→target 重新反解朝向基准。单击选中与拖拽转头共存：位移 ≤ 4px 的 pointerup 才 raycast 上报，拖拽不改变选中；`top → free` 时接近天顶的朝向回落到斜俯视（保留 yaw、保持俯视方向），保证 WASD 立即可用。键盘焦点在**文本输入**（INPUT 文本类 / TEXTAREA / SELECT / contentEditable）时不劫持；按钮不拦截——模式按钮点击后仍持有焦点，若按 BUTTON 跳过，用户「点过自由按钮再按 WASD」会全部失效。画布交互会主动 `blur` 当前焦点（capture 的 `preventDefault` 挡住了浏览器自己的焦点迁移），空格 / ←→ 播放传输不被残留焦点吞掉。排障埋点 `[fly]` 在 `?debug` 下走 `console.info`（默认级别可见），否则 `console.debug`。
- **共同 phone / fullscreen 契约**：`usePlaybackPhoneForm()` / `PLAYBACK_MOBILE_QUERY` 同时驱动 2D / 3D compact transport、toolbar hierarchy、临时名册 / 详情和 safe-area；3D 根 `.phone-form` 将状态传给 CSS。390×844 → 844×390 coarse 仍保持 phone，触屏 tablet 不因 coarse 独自变 phone。`usePlaybackFullscreen` 的状态是当前 target 是否拥有全屏；2D / 3D 同时挂载时只 owner 为 true，外部退出后同步为 false。只有 phone 进入自己的全屏尝试 landscape，tablet / desktop 不强制方向。
- **3D 工具条**：下方工具栏右上角支持收起 / 展开，默认展开。收起后仅保留恢复按钮，播放继续，进度、倍速、选车和相机保持；切换文件恢复展开，全屏和视口变化保留状态。此开关独立于「隐藏全部 UI」。
- **3D 显示控制**：`Replay3DPane` 工具条的「显示」面板锚在 `.pb-root` 右下角（不参与工具条布局），可分别开关顶栏 / 名册 / 击杀流 / 基地条 / 四类标签行 / GLB 车模，并提供「隐藏全部 UI」（`H` 键等效）。按钮与 `H` 都调用同一 `setUiHidden()` 转换；进入隐藏模式立即关闭 Display，隐藏顶栏、名册、击杀流、基地、车辆标签、播放控件、结果 banner 与其余呈现 overlay，只保留右上角恢复按钮。恢复后原有结果 banner 重新显示（底层 state 不清空）；输入框 / 按钮等交互目标不触发 `H`。该状态不写入持久化偏好，刷新即回到常规界面。

### 战斗特效（3D）

外观、档位预算与 GPU 资源唯一 owner 是 `scene/battleFx.js`；`playbackScene.js` 只负责时序（事件泵、seek 语义、生命判据）。所有 billboard 粒子每帧按「特效年龄 → 外观」纯函数写进两个实例化批次（加色一批、普通混合一批且按视深从远到近排序），火星拖尾一个 `LineSegments`，曳光与光迹是相机朝向条带；自定义 shader 手挂 logdepthbuf 代码块、`toneMapped=false`、保留深度测试、不写深度。图集为 4×2 程序化 alpha 贴图（火焰 / 烟 / 光晕 / 星芒 / 碎片），不引入外部资产。

- **飞行中炮弹 = 阵营色曳光**：白热弹头 + 阵营色渐隐尾迹（14m，沿折线弧长回退）+ 弹头光晕；颜色沿用 `TRACER_FRIENDLY / TRACER_ENEMY`（未知阵营白色）。飞行段时长仍是真实 `flight_secs`（只做 1 帧下限，不加最小显示时长）。
- **弹道光迹**：阵营色细线、柔边、整段等宽（不透明度 0.62），弹头飞过才显现（折线逐段显现），弹头走完全程后停留 2.5s、再 1.5s 淡出（回放时钟：暂停时一直留着，seek 清空）。曳光与光迹都有屏幕像素宽度下限（弹头 2.4px / 光迹 1.6px），拉远看全场不会细到消失。
- **开火**：炮口前喷火光 + 星芒；均衡及以上加制退器侧焰，高清 / 极致加炮口烟（3 / 6 团）。回放记录的开火起点在火炮枢轴，炮口特效放在炮管末端：把射手车模临时摆到开火时刻 `t_fire` 的姿态（`poseGlbRig`：根位姿 + 炮塔 / 炮管，纯时间函数，不碰悬挂积分），取炮管节点（`gun_NN`）网格包围盒沿弹道方向的最远投影（`muzzleTipOf`），把起点沿弹道推过去，量完摆回本帧 T。没有可见车模（代理车 / 兵种图标）或投影不在 0.3–15m 内时用记录起点。同一段距离也是曳光与第一段光迹的可见起点：弹头没出炮口时不画曳光和弹头光晕，曳光尾部、光迹起点都不早于炮口；弹道折线与计时不变，贴脸射击（抵达点在炮管长度以内）整段不画。
- **命中**（按 `impactKind` 分型；脱靶 / 未知结果不生成）：击穿 = 小火光 + 橙色余火 + 暗烟；未击穿 = 亮白火花回溅 + 中灰烟；跳弹 = 火花沿出射段方向划过 + 淡烟。命中在弹头抵达命中点（`legEnds[0]`）时触发一次，跳弹弹头继续沿出射段飞。命中特效有屏幕尺寸下限：参考尺寸 2m 至少占 56px，镜头拉远时火光、余火、烟、火星的大小与散布等比放大，最多 3 倍；离得近时保持世界尺寸。命中火光、余火与烟沿视线朝相机挪半个粒子尺寸，避免四边形插进车体被深度测试裁掉；每团命中烟叠一层 0.6 倍的同心烟芯（击穿深灰 / 未击穿、跳弹中灰）。
- **击毁爆炸**：权威死亡触发一次（`buildBurstSources`，不要求击杀归属；先投影当前位姿和可见性，coverage 结束后也不跳过）。强闪光（0.22s）+ 压扁的地面光斑、湍流火球（约 0.3s 胀到约 6–7m，1s 内由白热转暗红）、带火光的浓黑烟柱上升、抛物线火星；高清 / 极致加碎片，均衡及以上加贴地尘浪（柔边团块，不是硬圆环）。壁钟寿命 4.2s，暂停后自然播完；seek 清空、不补播，canonical 晚到只安排未来事件。
- **残骸持续烟**（高清 / 极致）：是否存在由场景唯一死亡判据 `sceneLifeAt` 按回放时间判定（死亡 1.4s 后渐入、倒带到死亡前立即消失；未知死亡时刻按已渐入处理），翻滚相位只在播放时按壁钟累计（倍速不加快、暂停冻结、不触发额外重绘）。极致档另有发动机舱余火，死亡后约 10s 内熄灭。烟柱约 10m 高，底部炭黑、顶部转灰；烟团大、底部不透明度接近 1、相邻烟团上下重叠，连成一根烟柱。
- **画质档位预算**（`QUALITY_PRESETS[k].fx` 引用 `FX_BUDGETS[k]`；信息类元素四档都有，氛围元素按档裁剪；批次容量封顶，满了按「命中 → 开火 → 爆炸 → 回放驱动粒子」的优先级丢弃）：

  | 元素 | 流畅 | 均衡 | 高清 | 极致 |
  |---|---|---|---|---|
  | 粒子批次容量（加色 / 普通各） | 256 | 512 | 1024 | 1536 |
  | 曳光弹头 + 弹道光迹、命中火光、爆炸闪光 | ✓ | ✓ | ✓ | ✓ |
  | 炮口：制退器侧焰 / 炮口烟 | — / 0 | ✓ / 0 | ✓ / 3 | ✓ / 6 |
  | 命中火花 / 烟 | 6 / 0 | 10 / 2 | 16 / 4 | 16 / 6 |
  | 爆炸火球 / 黑烟柱 / 火星 | 5 / 6 / 16 | 8 / 10 / 32 | 11 / 16 / 56 | 14 / 20 / 80 |
  | 爆炸碎片 / 地面尘浪 | — / — | — / 10 | 12 / 16 | 16 / 20 |
  | 残骸持续烟 | — | — | 10 团 | 14 团 + 余火 |

### 3D HUD、名册与标签

- **顶栏总血量**：`scene/teamHpTotals.js` 按各队 `max_hp` 汇总剩余量与上限（未知阵营不计入任一方，unknown ≠ enemy），`playbackScene` 在 HUD 节流写 store，`Replay3DPane.vue` 顶栏第二行渲染「数值 + 阵营色条夹住比分」；数值用完整整数（禁止 1k / 22.3k 缩写），条宽用原始百分比保证平滑。顶栏与基地状态条同列堆叠，高度随内容变化。整行是单一阵营视角（`friendly_team` = 录像者一方）：左侧血条 = 己方，中间比分左 = 己方——击杀计数在内核里是物理队伍（score1 = team 1），上屏前经 `perspectiveScore()` 映射成 `scoreFriend / scoreEnemy`（`friendly_team = 2` 时交换）。`friendly_team` 未知（≠ 1/2）时不建立视角：比分与两队血量一律 0 / 0（与 `pointsAt` 同为 fail-closed，unknown ≠ enemy），不得把物理 team1 当「己方」上屏再染成 ally / enemy 两色。
- **队伍身份与 Recorder 视角**：`team` 保留物理队伍身份，`friendly_team` 只用于呈现关系。2D / 3D 名册均将己方放左、敌方放右；录像者属于 Team 2 时交换车道。名册 HP、圆点与行边框使用 `--color-team-ally` / `--color-team-enemy`，未知视角使用中性色，未知阵营独立分组。
- **名册时刻投影**：`scene/rosterState.js` 在会话开始时建一次静态身份（eid / team / 昵称 / 车型）；运行时状态（`hp` / `maxHp` / `dead` / `followed`）由 `projectRoster(vehicles, t, isDestroyed)` 按当前回放时刻纯函数投影（死亡 resolver 与模型 / 名牌共享；`reload` 复用场景的 reload resolver），`playbackScene.updateRoster()` 只写变化过的字段。写入必须经响应式代理：eid → 行索引登记的是读回 `store.roster` 得到的代理，不是建行时的原始对象。投影节拍 = HUD 节拍，不逐帧：随 T 变化的投影只在 `writeHud()` 越过约 10Hz 节流闸后运行，与顶栏总血量同帧写入；seek / 会话开始 / 停播（暂停、播到终点）由 `writeHud(true)` 强制补一次；跟随目标（`followed`）变化由 `setCam()` 同样以 `writeHud(true)` 补写，暂停时切跟随相机也立即可见。
- **响应式名册**：desktop / 大 tablet 的 normal 7v7 与 unknown group 在 root 内完整可见，不与播放控件重叠、无 team / lane 独立滚动。phone 与短视口不保留左右常驻名单，改为 Display → Roster 临时 surface；打开 Roster 即关闭 Display，dismiss 后完整场景立即恢复，不预留场景高度。受限临时 surface 可作为一个整体滚动，不能给两队分别建滚动区。`uiPrefs.showRoster` 控制呈现可用性；隐藏不清空 roster data、selected、follow 或播放状态。
- **共享名牌**：`PlaybackVehicleLabel.vue` 统一姓名、车型、HP 数值 / 百分比 / 血条、装填分段、定时消耗品状态徽标及 destroyed / last-known 视觉。`VehicleMarker.vue` 消费同一组件并负责 2D marker 位置与标签碰撞；`PlaybackVehicleLabels3D.vue` 将同一组件放在相机投影的屏幕 anchor 上。消耗品徽标由 `utils/consumableRuntime.js` 的同一 resolver 驱动（2D `vehicleConsumablesAt` / 3D `consumableStateAt`），只在 ACTIVE/COOLDOWN 且 `durationSec > 0` 时渲染，位置固定在血条左侧。`usePlaybackPreferences` 是模块级唯一 reactive owner，所有存活的面板消费同一份 `labelPrefs.showPlayerName / showTankName / showReload` 与 `hpPrefs.showHp`；默认昵称关、车型 / 血量 / 装填开，既有持久化 key 与迁移语义保留。任一面板改变偏好，另一面板立即观察到。
- **3D 标签与伤害数字**：3D 车辆标签与伤害数字共用 HTML 覆盖层（不创建 CanvasTexture / Sprite）；伤害数字在 `PlaybackVehicleLabels3D` 的 HTML 覆盖层里（同一层、DOM 顺序排在所有名牌之后）：出生点是该车 HP 血条右缘 + 8px、垂直居中于血条（`measureDamageLayout` 只读血条 / 名牌 DOM 几何，不存在世界↔屏幕换算），不覆盖血条、不被姓名 / 车型 / 装填条遮挡。几何缓存的是「相对名牌锚点的偏移」（dx/dy/textW），屏幕位置每帧用当前 `anchor.x / anchor.y` 重算——车辆与相机移动时数字跟着血条走，resize 或出屏（`projected === false`）立即隐藏，不存在被冻结在过期坐标的数字；偏好 / 行开关 / 图标模式 / 名牌内容发布（10Hz）变化才按布局签名重新量一次，不逐帧读 `getBoundingClientRect()`。
- **伤害数字表现**：生命周期内漂移 20×24px 并只在后半程淡出（CSS 动画，固定 px 字号 + 深色描边 token，远近缩放与自由 / 跟随 / 俯视镜头下屏幕尺寸一致）；漂移方向按所在侧取号（右 → +20px，左 → −20px），镜像后不会重新漂回血条。回退链：血条关掉 → 名牌块右缘同一规则；整块名牌关掉或真实 0×0 空名牌（姓名 / 车型 / HP / 装填全关且非图标模式）→ 落回名牌锚点上方（`labelLiftWorld` 抬升的车体上方）；车辆出屏 / 不可见 → 不显示。同一辆车连续受击按 20px 槽位错开；贴屏幕右缘放不下（含整段漂移行程，不只出生帧）时镜像到血条左侧，两侧都不够时仍取右侧，不被 viewport 裁切。掉血事件跨过播放时钟时由场景 `spawnDamage(eid, hpLoss, FLOAT_DMG_MS × FX_SCALE)` 生成一次（与 2D 同一组寿命常量），seek 由 `clearDamages` 清空且不补播；每个数字的 `animation-delay` 存活期间稳定，seek / remount 不重复快进 CSS 动画；`H` 只隐藏视觉，不暂停或延长生命周期，到期仍由原始 `bornMs + durationMs` 决定。场景按帧投影 world position，隔离的轻量 DOM bridge 只更新 anchor transform / visibility，内容状态按 HUD cadence（约 10Hz）发布给标签子组件，seek 立即刷新，不驱动整个 `Replay3DPane` reactive tree。背向相机、出屏、未可见车辆隐藏，既有遮挡语义保留；标签 overlay 的空白区域不截获场景 pointer 输入。
- **共享装填求值**：2D 的 `parseLocalPlayback` 从本地 WASM `parsePlayback` 结果保留独立 `reloadTelemetry`，经面板传给 Playback；3D 消费同一上游 PlaybackData 字段。两者都调用 `scene/reloadBar.js#createReloadStateResolver` 的 `reloadStateAt(vehicleId, time)`，基于当前 playback time 确定性重建，暂停不漂移、前后 seek 结果相同。只解释已闭环的本方遥测与 magazine 相位；敌方、未知 relation 或无遥测时隐藏装填，不根据车型 / 射击推算，不提升为通用 ReplayFacts，也不扩展 HTTP dataset schema。

### 画质、加载与 3D 详情

- **画质档位**：`QUALITY_PRESETS` 四档（流畅 / 均衡 / 高清 / 极致）分别控制 antialias、maxDpr、scenery、groundLayers、anisotropy、allowGlb、treadMarks、forceGlb 与 FX 预算。地形细分与几何不随档位变化（客户端没有 landscape 画质覆盖块，阈值恒为出厂默认）；画质档真正影响地形的是材质层（RELAXMAP 需要 landscape 材质绑 relaxmap 槽才生效；HEIGHT_BLEND 按导出时的 `ground.layers.json height_blend=true` 复刻）。
- **履带印档位**：`treadMarks` 仅高清 / 极致开启，且这两档强制 GLB 真实车模（`forceGlb`：`setGlb(false)` 被忽略、开关停用并提示）——印记左右轨距取自 suspension 解析的模型 `halfW`，中途切低模会让同一车前后的印记轨距突变。均衡档仍可自由开关 GLB 但无印记。
- **进场预载**：高 / 极致在 `startPlayback` 资产阶段 `await applyGlbToggle(true)`——双方全部车辆模型就绪才开播，避免开局数秒的盒子代理、轨距跳变与起步印记折线。
- **3D Details**：与 2D 共用 canonical 查询及 `V2VehicleInspector`：选中账号对应的 track 提供时刻统计、伤害日志、最后已知时间、装备、物资与消耗品状态，肖像按车型懒加载。3D 按独立 `clock.startRaw` 转换场景时钟（不依赖 reload telemetry，与播放条 / 顶栏同一个原点）；数据缺失保持 unavailable，不使用终局汇总代替当前统计。

## 地形、地面与场景材质

3D 运行时与俯视烘焙共用 `frontend/src/scene/groundPass.js`：地形数据读取、地形几何装配、分层地表材质、水面海岸线资源、贴地薄构件走廊掩码都只此一份；两侧只保留 I/O 与相机差异（运行时透视自由相机 + 视距 LOD；烘焙固定正交俯拍）。运行时与烘焙的地面因此像素级同源。

### 地形数据边界

- **高度场口径**：地形是客户端同构的补片自适应网格，顶点落在高度图 texel 的角点口径（`(i/n − 0.5)·span`，高度取 texel 值，不平滑）；`terrainMesh.js::decodeTerrainField` 是唯一解码口径，网格 / 采样 / 拾取 / 岸线共用这一份。
- **布局**：`terrainLayout: 2` 为当前修正布局（corner 口径镜像），`terrainLayout: 1` 按一列平移解码（`field[c] = prev[max(c−1, 0)]`）；只有 `terrainLayout` / `size` / `zmin` / `zmax` / `span` 齐全才解码，缺字段 / 未知布局 / 尺寸不符一律 fail-closed 返回 null（回退 2D），不按缺省 layout / zmax 猜。
- **worldBounds**：必须是居中正方形（当前消费口径），非居中 / 非方形同样回退 2D。两种布局都丢掉场景 +x 边界那一列顶点（n 列表示不下 n+1 个顶点；该列在包围盒边缘、可玩区之外）。
- **json/bin 配对**：`terrain.json`（no-cache）与 `terrain.u16.bin`（max-age=3600）是两次独立请求。bin 以 `terrainBinSha256` 作缓存键取（`pairedTerrainBinUrl` → `terrain.u16.bin?sha256=<hex>`），解码前用 WebCrypto 核对字节 sha256（`terrainBinMatchesMeta`）；不符（发布进行中）或“有 sha 但 WebCrypto 不可用”即 fail-closed 回退 2D，不画错位一列的地形。不含 `terrainBinSha256` 的产物无从配对，沿用原行为。

### 地形网格与 LOD

- **补片结构**：一个补片 = 8×8 四边形（`PATCH_QUADS = 8`）；层级 k 的补片边长 `size >> k` texel、补片内顶点间距 = 补片边长 / 8；终止补片内部仍是 8×8 网格，不是“一个四边形”。
- **三条客户端判据**（任一命中即细分）：① 屏幕半径 `radius / (patchDist · tanFovY) ≥ maxPatchRadiusError`；② 屏幕高度 `|maxError| / (errDist · tanFovY) ≥ maxHeightError`（距离取最差样本位置）；③ 绝对 `|maxError| > 3m`。阈值随水平 FOV 在 zoom（6.5°）/ normal（70°）两套预设间线性插值；回放自由相机没有狙击镜档，运行时恒传 `CLIENT_NORMAL_CAMERA_FOV_H = 70`，宽高比只进投影项 `tanFovY = tan(fov/2)/aspect`。
- **两通道高度 + morph**：高度图像素 = [本层原始高度, 与相距一个 step 的对侧邻居的均值]；顶点高度 = `lerp(averaged, accurate, morphAmount)`，`morphAmount` 由误差比经 `morphFunc(x) = 4(1−x)⁵ − 5(1−x)⁴ + 1` 整形；最外一圈退回原始值。误差贴近阈值的补片被双抽头均值抹平，这是客户端在墙顶 / 建筑基础吸附缝上不穿出的机制。
- **无裂缝契约**：顶点高度取“该处最粗相邻叶所在层级”的边界直线 / 格点值（边端点递归）；同一 (i,j) 恒得同一高度，细侧折线落在粗侧直线上——不需要 2:1 平衡也没有 T 型接缝。按 (i,j) 去重顶点，法线跨叶连续。守卫：`terrainMesh.test.js`（三条判据 / 终止补片 / 单元格 ≤0.08·视距 / 混排层级无裂缝 / 无空洞 / 三角形朝上 / 预算）。
- **单向滞回**：`terrainLodStale` 的输入是与 `buildAdaptiveTerrain` 同源的相机姿态快照（位置 / 视距 / 视轴 / FOV / aspect）：拉近 ≥5% 立即细化，拉远 ≥40% 才允许变粗；侧向位移 ≥5%·视距、FOV 或 aspect 相对变化 >0.1% 也触发重建；两次重建至少隔 120ms。网格永不比客户端同一相机位置允许的层级更粗。
- **贴地薄构件走廊**：贴地薄构件（铁轨基板 / 压顶 / 铺装这类，世界 AABB 高 ≤2.5m、底面贴地形真值、排除水面 / 水下片）按三角形沿边以 ≤1 texel 采样足迹 → `buildCorridorRefineMask` → `buildRefineMask`；命中补片强制细分到最细层（1 texel），不改任何高度值，廊外层级仍按三条判据。运行时与俯视烘焙共用这一机制。守卫：`terrainMesh.test.js`（掩码内必到 1 texel、掩码前被盖 / 掩码后不被盖、不传掩码逐字节一致）与 `sceneryMaterials.test.js`（取样先于实例化合批）。
- **画质无关**：客户端 Data/quality.yaml 没有 landscape 块，地形阈值恒为出厂默认；地形细分 / 几何不随画质档变化。画质档真正影响的是材质层（RELAXMAP 需 landscape 材质绑 relaxmap 槽才生效；HEIGHT_BLEND 按导出的 `ground.layers.json height_blend=true` 复刻）。

### 地面、水与天空

- **分层地面**：`groundShaderMaterial` 按客户端 tilemask 非 PBR 路径复刻 GLOBAL_TINT（globalFlatColor×2 + lightmap 通道 brightness / contrast / gamma 调整）、SCALED_TILES（每通道 tileScale）、HEIGHT_BLEND（tilemaskWeight×(mask×2−1) + hMap×scale + offset，softness 归一加权）。UV 在片元由世界坐标反推（`u = 0.5 − X/s`、`v = 0.5 − Z/s`）；tile / height 用 Repeat 平铺原生分辨率采样；cm / lm / mask 不得设 colorSpace（客户端原样采样口径）；tile / hmap 全部开各向异性。
- **底图回退**：低档 / 均衡档或分层材质不可用时，把契约化的 `ground.webp` 摊在地形网格上；UV 取既有 `PlaneGeometry + rotation` 契约（`u = 0.5 − (X − cx)/span`、`v = 0.5 + (Z − cz)/span`）。分层着色器的 `v = 0.5 − Z/span` 只适用于 `cm.webp`，两套公式各自只对自己的文件成立。
- **水面语义**：材质标记先于节点名——`extras.water` 命中即落水材质分支，`/sky/i` 名字正则不能把 `SkySeaSurface` 这类海面当天穹；产物没有 sky 标记时才退回节点名。水面 alpha = 菲涅尔 × `coastLine`，`coastLine = saturate(dNdcZ / (2·uDepthUlp))`，`dNdcZ = 2fn/((f−n)z²)·(水面高−地形高)/|视线.y|`；淡出带 = 该视距的深度抢胜带（2 ulp）。深水任何角度满反射（含俯视）。缺高度场 / 产物不含高度场 → `uHasHeightmap=0` 不淡出（fail-open）。背后表面只算地形、不算结构 / 浮冰，冰面上方保留少量反射。
- **水下静态件**：整个包围盒落在某片水面占地内（0.5m 余量）且低于该水面片标高（5cm 余量）的网格不接光照图，走不受光 albedo（`MeshBasicMaterial`，`color = albedo`，客户端 VIEW_DIFFUSE=0 口径）。只是部分淹没的桥 / 沉船仍按主通道渲染。
- **天空**：材质 `extras.sky`（导出器按客户端 Skyobject 模板写入）走 `makeSkyMaterial`——顶点 `w=0` 丢弃平移（网格坐标是方向；多数天穹网格半径仅约 10m）、深度钉远平面、unlit、不参与雾、`frustumCulled=false`。产物无任何 sky 标记时才退回节点名 `/sky/i`；俯视烘焙 `bakeDropNode` 用同一标记。多材质网格只有整组命中 `extras.sky` 才走无限远天空，混合组按普通网格 fail-closed。
- **贴花材质**：`extras.decal` 命中且几何有 UV1、地表分层贴图在位时走 `makeDecalMaterial`：顶点期 UV1 原样（无 uvScale/uvOffset），片元 `decal = tex2D(decal, UV1)`（槽 = 地图 colormap），DRAW PHASE `color = albedo(UV0) × decal × 2.0`，全程无光照项；`GLOBAL_TINT` 时按 `materialLightmapAdjustment` 做 brightness / contrast / gamma。无 UV1 不标 decal（fail-closed）。贴图遮挡测试材质由导出器按客户端 `albedo.rgb × albedo.a` 烘焙，前端不二次处理。
- **透明与变体**：`extras.alphaBlend` 材质按真软混合渲染（alpha 乘 `m.opacity`）；透明材质不进入实例化合批（three 只按 object 排序），带逐节点光照图变换的透明网格用单实例 `InstancedMesh` 承载以复用 `aLm` 的 atlas UV。GLB 存在 `mdVariant` 节点但当前 `map_id` 无可用激活映射时，隐藏全部带标记节点并告警（fail-closed）；导出器在映射不完整时写 `scene.extras.variantMappingIncomplete`。烘焙侧同样排除透明材质，并在变体映射 fail-closed / 标记不完整时拒绝出图。
- **材质参数**：场景 GLB 贴图按画质档 `Q.anisotropy` 逐纹理设置一次；法线使用几何 authored NORMAL（不由 `flatShading` 现算面法线）；地面分层着色器的 uniform 声明类型必须与 JS 下发类型一致（`uHbSoft` 为 `vec4`，错写 `float` 会让 9 张 HEIGHT_BLEND 图取错层色）。空场景占位地面 / 网格（`THREE.GridHelper`）统一 `visible=false`，对象仍保留入 scene（拾取过滤、bbox 拟合按对象引用走，不看 visible）；边界提示由 `buildBoundary` 负责。
- **光照与出屏**：客户端发布版没有 filmic 出屏曲线，生效路径是线性 → sRGB；本仓 `renderer.toneMapping = LinearToneMapping`、`toneMappingExposure = 1.0`（基线），逐图太阳按 `DEFAULT_SUN_INTENSITY / sun.intensity` 钳制到 0.05–4 做曝光归一；hemi 与 IBL 基准同样除以 expo，三通道输出端净值与基线图逐项同档。太阳方向 / 颜色 / 强度、环境色、IBL 倍率来自 `lighting.json`，3D 运行时与俯视烘焙共用 `mapLighting.js`。**已知缺口**：客户端运行时自动曝光尚未实现，画面整体亮度可能与客户端有系统性差异；不提供手调 `?tonemap` / `?exposure` 旋钮。出屏曲线 / 曝光只作用于走 three 内建管线的材质（坦克）；非 PBR 类材质在客户端也 raw 写出。装甲查看器（`tankViewer.js`）仍用 ACES + 1.15。
- **资产边界**：Web 的 3D 模型、纹理及地图资产由 `frontend/src/scene/assetProvider.js` 从 `https://assets.wotbtools.com` 读取；Android 新版本经本机 `/agent-assets` 路径由 Native `AgentAssetProxy` 读取相同 Alibaba origin。旧 APK 继续使用编译时 COS origin，COS 仅供 legacy/rollback；2D 底图仍为本地静态资源。地面贴图统一使用契约化的 `ground.webp`（±300 全幅，与 2D 底图同源同框），不使用客户端 HUD 小地图。

### 悬挂与履带

- **数据与求解器**：数据 = 包内 `suspension/<tank_id>.json`（上游 `tools/export_tank_suspension.py`）；求解器 = 独立纯函数 `scene/suspension.js`（单测 `suspension.test.js`），`playbackScene.js` 只做容器与写入。① 负重轮按局部 +z 平移贴地（夹紧 `[−b, +a]`、`wheelsReactionSpeed·dt` 限速、seek 跳变吸附），`flag=0`（诱导 / 主动 / 托带轮）不参与贴地但照常自转；② 自转 `θ += −Δs_侧 / r`（Δs_侧 = 该侧接触线中心的世界位移投影到车体前向，转向差速自动成立）；③ 履带链路（逐轮偏移 → 悬空段 `(t−t²)` 垂弧（幅度 `upperFactor·span^lengthPower`）→ 包轮 → 铺地）后逐顶点形变既有履带网格（逐车 clone 几何，只动模型 +z；法线按 2cm 闸门重算）。导出器把轮几何烘进顶点、节点留在原点：轮自转必须按轮心做枢轴补偿（`applyWheelSpin`）。
- **花纹滚动**：每米 V 变化用该带网格的沿带斜率 `dV/ds`（`measureBeltUvSlope`）× 底段走向（`chainBottomRunDir`）定符号；斜率测量按弧长 0.01m 分桶、桶内 V 去重（去掉横向重复行）、逐顶点对配对并剔除图集换行跳变，取 **|斜率| 中位**为幅值——图集**双行反向**铺设的带（Grille 15 等：上下两行 V 随弧长方向相反）带符号中位会互相抵消归零，幅值中位不受污染；纹理写 V 只对偏移取模（`writeUvOffsetV`），不逐顶点取模。样本对不足（约 3%）→ 该带停滚（fail-closed）。
- **缺失回落**：数据缺失 / 轮数不符 / 命名不符 → `null`，整车回落刚体（fail-closed）。已知近似：铺地用“地面 max 抬升”代替客户端的接触树权重，`upperMin / frontFactor / backFactor` 未逐项落位（统一用 `upperFactor`），车轮地面取样用高度场（客户端是物理射线，桥 / 残骸处有差异），`chunkOffset` 驱动量以“距离积分”替代。
- **接线守卫**：`sceneryMaterials.test.js`（两条位姿路径都按记录位姿 + 横滚符号、`__hullGroup` 恒归单位）；`suspension.test.js` 覆盖行程夹紧、限速、自转、链路、UV 斜率与写入。

### 地面履带印

- **数据**：包内 `tread/<tank_id>.json`（上游 `tools/export_tank_tread.py`：印记宽 / 间距 + 贴图引用，客户端 `treadParameters` 块）+ `tread/textures/*.webp`（13 张客户端 DDS 无损转码；`Tread.webp` 为通用回落张）。全部 735 辆都有参数：无作者块的车按国别主贴图回落（`fallback:true`），`manual_width:null` 由前端从模型履带盒测得（`suspParts.beltW` 均值 → 常量 0.6 兜底）；`/tread/textures.json` 的 per-stem alpha 归一化系数（全库中位归一、钳位 [0.65, 1.8]）乘入不透明度。
- **槽位模型**：每侧固定环 50 槽（含活戳），`TREAD_RING=50`；active / write 槽持一枚「上次落锚点 → 当前触地点」的扫掠戳。车辆移动时前沿逐帧拉伸（活戳末端 = 当前位置）；与锚点距离满 authored `manualSpace`（1e-9 容差）定型并推进 write；戳长 ∈ [space, space+步长]，无整数边界可重复跨越。激活门 = 净位移 0.3m（`TREAD_ACTIVATE`），小范围蹭动不建活戳、不占 GPU；环满时活戳顶掉最老戳。零位移样本推进采样时刻与朝向但不累加里程。
- **老化与淡出**：`TREAD_FADE = { start: 5.45, end: 7.62 }`，alpha = `1 − smoothstep(start, end, age)`；逐槽按自身锚点时刻独立计算，不依赖“按序号出生有序”的假设；负年龄（回放时钟早于段出生时刻）返回 0，隐藏未来段，只容忍 1e-9 浮点抖动。暂停时时钟冻结 ⇒ 淡出冻结。
- **无空间去重**：重复碾压在淡出窗内的短暂 alpha 重叠是既定行为，随既有戳淡出自然收敛；不引入自创的 segRelation / 足迹包含 / 回压重占去重层——反汇编只证明 50 槽环 + 槽位时间随落锚刷新 + 淡出窗，没有“同地带重占 / 几何去重”的提交规则。
- **断链与重建**：`resetTrailState` 只置 `breakPending`，不动已有 `segs`；下一个 anchor 时刻晚于最后一段（AoI 空洞 / pose 大跳恢复，必然向前）⇒ 保留既有段、仅重锚；anchor 时刻不晚于最后一段（seek 后退 / 关断重开 / 宽度变化都从 START 重喂）⇒ 清空既有段后重放。DESTROYED 期间同属“向前的不连续”：flush + 双侧 `resetTrailState`，复活后从新锚开始，不跨阵亡期桥接。
- **呈现**：每车一个动态合并几何 Mesh（槽位 = 环 50 槽 / 侧含活戳，左右交错 ⇒ `TRAIL_SLOTS = 100` 个四边形；绘制窗口恒为全部槽位，无效槽显式 alpha=0）。戳四边形经 `trailStampCorners` 逐角独立贴地（四角各自采样真值场高度 + 12cm 抬升，随坡双向弯折）。`MeshBasicMaterial` 不受光 + alpha blend + `depthWrite=false` + `DoubleSide`（倒车时位移反向，固定索引会产生朝下法线）。材质透明度 = 贴图 alpha × 淡出系数 × per-stem alpha，无全局压暗。
- **生命周期与开关**：游标增量泵（`tick → updateTrails`）；seek 后退从 START 全量重算；喂样走固定 0.1s 网格片（片界按 START 对齐），首锚 = 窗口起点 t0 的横截面，不足整片的尾巴留待下次——seek 重算与逐帧连续播放逐值一致。显示面板「地面履带印」（`store.treadOn`，唯一 owner = 场景；`setTreadMarks` API，会话级不持久化）；setter 内直接驱动游标泵，暂停态也立即生效。**已知缺口**：客户端相机距离淡出（`treadsNear/FarFadeDistance`）与 GLOBAL_TINT 贴花调色分支尚未复刻；缺 authored 参数时的模型测宽与通用贴图 / 间距回落是产品回落，不是客户端事实。
- **回归**：`treadMarks.test.js`（槽位模型、0.3m 激活、锚点时间、淡出、无有序假设、停车再起步、原地转向）、`playbackScene.test.js`（履带印断链、阵亡期断链、倒车命中、暂停态开关、开关重开不重复）；接线守卫锁 tick 泵 / API→store owner / teardown 释放。

## 当前协议边界与已知限制

- **纯客户端解析**：`.wotbreplay` 只在本机解析；服务器没有 playback parser、没有 `battle-playback-v2` / `map-overview` HTTP 端点。`BattlePlaybackDataset` schema 仍保留在 OpenAPI components 中，用于校验本地构建的 2D 数据集，不代表存在对应 path。
- **录像者**：上游 `author_nickname` 可能是「军团-昵称」拼接，客户端原样写入 `Battle.recorder`；权威录像者身份以 `author_account_id` 为准。
- **不可见即未知**：AoI hidden = UNKNOWN，coverage 不等于点亮 / 被发现；不得从位置流缺失推断阵亡、点亮或失察。位置事件只表达服务器位置流覆盖变化。
- **装填**：只解释已闭环的本方遥测与 magazine 相位；协议没有敌方装填流，敌方 / 未知 relation / 无遥测时隐藏装填，不根据车型或射击推算。
- **击杀**：KILL 事件只能证明录像者客户端收到伤害通知，不能证明全局击杀广播的击杀者身份；kill feed victim-only。killer attribution 需要窗口内唯一可信攻击者且无 unsupported 变体，否则 killer=null。结构合法但语义未解码的伤害方法变体（火灾 / 撞击等）、短体变体、direct raw=0 都作为冲突证据，不静默视为无伤害。
- **Assault**：协议不给 owner / capturing，一律中性，不据静态 scene 推断；只提升 progress 语义。`assaultObjectivePresent` 只表示目标族存在，不表示发生过占领。
- **产物字段缺省**：缺 `hp_state` 时按缺省分类，只有 0x0000 / 0xFFFD 是终态，未证明哨兵不作为死亡证据；缺 `detached_turrets` 时保持完整原车模；缺 `hull_roll` 时按 0 水平；缺 terrain 布局 / sha 配对时回退 2D。
- **飞头**：独立炮塔是呈现依据；低血量、HP=0 或普通击杀不单独触发，不能由飞头反推弹药架殉爆死因。
- **炮线**：未命中 / 盲射 / 弹道弧线 / 瞄准线无数据依据，不渲染；射手未侦察时只出命中闪光、不画线，绝不用最后已知位置伪造射击点。
- **AI 时间**：AI 复盘时间文本不承担 Playback seek / capability handoff。
- **3D 光照**：客户端运行时自动曝光尚未实现，画面整体亮度可能与客户端有系统性差异；不提供手调 tonemap / exposure 旋钮。
- **履带印**：客户端相机距离淡出与 GLOBAL_TINT 贴花调色分支尚未复刻；无 authored 参数时的模型测宽、通用贴图 / 间距是产品回落，不是客户端事实。
- **2D 姿态**：纯俯视，刻意不呈现俯仰 / 侧倾与炮管仰角；2.5D 地形起伏背景只影响底图，不改变车辆姿态。
- **路线**：`MapOverview.routes` 仍生成但不进入 UI；2D 战局回放不渲染车辆路线。
- **场景内核**：3D 场景是上游冻结 Agent 前端的同源分叉，上游渲染修复需要人工比对移植，不会自动同步。

## 车辆标记尺寸（真实车体比例）

标记按地图米制缩放：`frontend/src/data/vehicleSizes.js` 是生成文件，存全部 735 辆的真实车体长 / 宽（米），来源 BlitzKit `definitions/models.pb` 的车体包围盒——不含炮管。

尺寸优先级（`frontend/src/utils/vehicleMarkerSizing.js`）：

1. `vehicleSizes[tankId]` —— 真实车体表，覆盖全部车辆；
2. 模型 metadata 的 `hullBounds` —— 表未覆盖的 tankId 才用；
3. `CLASS_FOOTPRINT_M` 按车种猜测 —— 最后兜底；未知车种用全表真实中位车长。

渲染尺寸 = `车体长 × 每米像素 × READABILITY_SCALE`，再按 `MARKER_SIZE_LIMITS` 钳制。`READABILITY_SCALE = 1.14` 只补偿车体图形约占方形烘焙 88% 的空白，不额外放大；下限只保证「还看得见」，点击目标由 `HIT_TARGET_MIN_PX` 单独兜底，所以视觉可以贴近真实尺寸。回归见 `vehicleMarkerSizing.test.js`。

客户端 / BlitzKit 更新后重新生成：

~~~text
python common/python/extract_vehicle_sizes.py
python common/python/extract_vehicle_sizes.py --check   # CI：过期即失败
~~~

## 2D 车辆血量显示

Display 的「血量显示方式」提供横条 / 环形，默认横条；偏好与显示血量开关由 `usePlaybackPreferences` 持有并持久化，既有偏好自动补为横条。

- 环形围绕当前车模或类型图标，用剩余弧长表示已知血量比例，我方绿色、敌方红色；位置或血量进入最后已知状态时变灰，不推测实时视野。
- 未知血量 / 未知容量显示中性虚线；开局相对满血仍按已有投影语义显示完整环；阵亡车不画血量环。
- 环形模式不显示血量数字和装填条；切回横条会恢复用户原本的装填开关。
- 车型图标的环保持屏幕尺寸，车模的环跟随模型大小；线宽及周围间距不随地图缩放增加。
- 环直径与模型、标签碰撞布局共用尺寸计算，不改变车辆的真实坐标、伤害或观测事实。
- 标记模式选择工具下，点击未被计划标记占用的车辆仍可打开车辆详情；绘图与拖动操作不触发检查。2D 详情摘要的血量、百分比与车辆标识来自同一条当前时间投影，拖动时间轴同步更新，不取最终结算。

## 回放环线身份标志

车型名旁的一 / 二 / 三道杠为该玩家在本车已获得的 Gun Marks。数据表、手机卡片、车辆详情、2D / 3D 名册与车型标签共用维护者供图提取的透明标志（`src/assets/gun-marks/`）；3D 炮管无贴花。

- **事实来源**：workspace 持有的 `LocalPlayback.result.players[].gun_marks`，通过账号联表；属于静态车辆成就，不按回放时钟升降，不能用于推断本场获得时刻或当前精确百分位。
- **呈现**：0 环不画图标，缺失 / 非法保持未知；详情和独立列用占位符，Excel 留空。名牌标志固定屏幕尺寸并计入名称布局盒，保持既有 HP / reload 行高与选车接线。暂停下 canonical 晚到会更新展示，切文件清除既有身份。
- **检查器**：地图鸟瞰 / 回放的完整车辆检查器在车辆信息区显示同一环线徽章和环数；尚无 canonical track 时由简版详情显示，避免重复条目。切换车辆和回放时沿用 owner 结果按账号匹配，未知显示破折号。
- **导出与门禁**：环线 SVG 内联透明 PNG 图集，导出图片保持自包含；既有 Chrome 交互门禁包含三档实际 PNG 解码后的像素检查与外链负对照。回归见 `gunMarks.test.js` 与 `GunMarksBadge.test.js`。

## 回归不变式与证据

- **canonical 事实 / 时间**：`playback.golden.test.ts` 对冻结 Java golden（`__golden__/java-playback.json`）比对 KILL / DAMAGE / DESTROYED 事件多重集（含 `observedHpLoss`）与掉血明细；`battlePlaybackV2.test.js` 锁定 query-at-time、anti-future-leak、HP 选择器与 `friendlyHealthAt` 聚合；`canonical/facts.hpTerminal.test.ts` 与 `lifeTransitions.test.ts` 锁定终态哨兵、复活后未知边界、每次死亡 DESTROYED。
- **位姿同源**：`vehiclePose.parity.test.ts` 锁定 game 系到 2D / 3D 的帧变换；`vehiclePose.canonical-parity.test.ts` 锁定观测区间内亚米级、区间外 ≤20m 冻结差；`BattlePlayback.integration.test.js` 覆盖失察即冻结、多实体账号、实体身份证据早于位姿覆盖、履带印断链。
- **地形 / 场景**：`terrainMesh.test.js` 锁定三条判据、终止补片、无裂缝 / 无空洞、走廊掩码、布局解码、sha 配对、单向滞回与 FOV 口径；`sceneryMaterials.test.js` 锁定 sky / water / decal / alphaBlend / 变体 fail-closed、地面 pass 接线、uniform 类型、sRGB、logdepth 与资源卫生；`scripts/check-scenery-shaders.mjs` 编译全部场景着色器程序。
- **3D 特效 / 履带**：`battleFx.test.js` 锁定档位预算单调、各元素按档出现、确定性、容量与优先级、批次排序、条带屏幕像素下限、材质直出与 logdepth、资源只释放一次；`playbackScene.test.js` 覆盖开火 / 抵达命中 / 光迹回放时钟停留与淡出 / seek 清空 / 跳弹抵达即命中 / 残骸烟随生命事实出现与倒带消失 / 暂停不额外重绘；`treadMarks.test.js` 覆盖槽位 / 激活 / 锚点 / 淡出 / 断链 / 重建。
- **2D UI / 交互**：`BattlePlayback.test.js`、`BattlePlayback.integration.test.js`、`BattlePlayback.annot.test.js`、`BattlePlayback.i18n.test.js` 覆盖编排、标注、真实三语 i18n；`test:browser-layout` 与 `test:browser-interaction` 用真实 Chrome 几何与交互断言覆盖桌面、平板、手机横竖屏与原生 fullscreen。
- **研究证据**：基地协议见 [assault-base-state.md](../research/replay/assault-base-state.md) 与 [supremacy-base-state.md](../research/replay/supremacy-base-state.md)；可见性 / 点亮见 [visibility.md](../research/replay/visibility.md)；炮塔方向见 [turret-direction.md](../research/replay/turret-direction.md)；3D 地图 / 渲染研究见 [3d-playback-client-map-research.md](../research/maps/3d-playback-client-map-research.md)；时间轴模型见 [battle-timeline.md](../architecture/battle-timeline.md)。地图目录、底图来源与对齐约定见 [reference/maps.md](../reference/maps.md)。
