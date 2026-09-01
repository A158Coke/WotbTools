# Canonical BattleTimeline（AI Review V2 核心）

> 本文档描述 V2 引入的唯一权威时间线模型：com.wotb.core.replay.timeline。
> Battle Playback / Personal AI Review / Team AI Review 共享同一套战场事实，禁止各模块
> 自行重新解释 raw events 形成互相不同的事实模型（见本文件 §1/§43）。

## Battle Playback V2（Canonical Replay Truth Convergence）

`contracts/http/openapi.yaml` 只定义序列化后的 HTTP wire shape；canonical domain truth 仍由
`com.wotb.core.replay.timeline` 持有。Playback 的 domain→transport mapping 与旧 artifact
兼容边界必须显式实现，避免把 `DecodeConfidence` 或未来的 view model 泄漏到 API。

> 自 2026-08 起，Battle Playback 增加 V2 稀疏投影 `BattlePlaybackDataset`，由
> `BattlePlaybackProjector.project` 从 canonical `BattleTimeline` + canonical facts 直接投影。
> 目标原则：**Replay truth is decoded once, canonicalized once, and projected many times**。

### 事实层（新增 canonical facts）

- `VehicleLoadoutFacts`：materialized combat vehicle 的 battle loadout 是**持久配置**——
  一旦观察到本场装备了什么，即使离开 AoI（Type4）仍 KNOWN，不随 AoI 消失变 UNKNOWN。
- `ConsumableLifecycle`：consumable **runtime** 观测（wireCode/state/eventClock/param）。
  与 loadout 不同，runtime 在 hidden interval（UNKNOWN_AOI）内 = UNKNOWN——不能因为
  「没看到 activation」就显示 READY。
- `VehicleModuleCrewLifecycle`：method16 为 **recorder-visible telemetry**，每条带
  `recorderVisible` provenance；不得把 recorder 模块状态当全队事实。

### HP / orientation 统一

- **FrameHealth**：统一 `currentHp` 权威，去掉 `baseHp/effectiveMaxHp` 业务语义；
  `baseHp` 属 `VehicleReferenceMetadata`（tankopedia 参考展示）。新增
  `HealthKnowledge(CURRENT/LAST_KNOWN)`；无 HP fact 由空 transition track 表达，
  己方相对满血证明由独立的 `relativeFull` sparse fact 表达；
  presentation-only `displayCapacityHp` 与 backend 投影的 `relativeFull`
  （= 截至 t 的真实可信 currentHp 最大值，**anti-future-leak**，绝非 canonical max HP）。
- **FrameOrientation**：新增 `OrientationKnowledge` + `ageSec`；敌方离开 AoI 后方向
  `CURRENT → LAST_KNOWN`，不得继续表现为实时炮塔方向。无 orientation fact 不生成 HTTP
  segment；HTTP wire 只保留 `CURRENT/LAST_KNOWN`，domain 的 `UNKNOWN` 仅表示内部无事实。

### V2 投影契约（`BattlePlaybackDataset`)

稀疏 transition tracks（非 450s × 10Hz × 14 车全量 snapshot）：每辆车的
`positionSegments` / `orientationSegments` / `healthTransitions` / `lifeTransitions` /
`consumableTransitions` / `moduleCrewTransitions` / `loadout` / `damageLosses`，加 battle 级
`events` / `pointsSamples`。每条 track 自带 `knowledge / provenance / observation boundary`；
`damageLosses` 是 Playback 数值伤害的唯一来源，并携带 backend 已证明的
`fromHp/toHp/displayCapacityHp/transientAllowed`；事件中的 `observedHpLoss` 只服务通知展示。
module/crew transition 的 `state=null` 表示 backend 已证明该 component 当前无 active fault；
consumable 的 `invalidation=true` 是 runtime 全局失效边界，前端不解释 protocol UNKNOWN。

前端（`battlePlaybackV2.ts` 查询 + `V2VehicleInspector`）**只消费**这些已标注事实，
不再做 HP/AoI/death/loadout 推理，也**不**再以 5 秒 packet-gap 作为 observation authority。

## 数据流

    Replay archive
          ↓
    Parser / Decoder → ReplayEvent
          ↓
    BattleStateReconstructor（checkpoint 状态重建）
          ↓
    BattleTimelineBuilder
          ↓
    Canonical BattleTimeline（battle-relative · 1 秒 BattleFrame · 精确事件保留）
          ├── BattlePlaybackProjector → BattlePlaybackDataset (HTTP)
          ├── PersonalAiContextCompiler → Call #2 TACTICAL TIMELINE
          └── TeamAiContextCompiler → 团队 Episode 上下文

## 核心不变量

1. **1 秒 BattleFrame**：frame second=N 的 stateAt = N.000s（battle-relative）；
   events = (N-1, N] 内的精确事件（原始时间精度不丢失，§2.1/§2.2）。
2. **battle-relative 时钟硬门禁**（§2.4）：时钟解析优先级
   recon.battleStartRawClockSec（IDENTIFIED）→ 事件自带 battleClockSec（IDENTIFIED）
   → RoundFinishedEvent.raw − battle.durationS（ESTIMATED，estimation fallback；canonical battle duration 由 settlement root5 决定）。
   无法解析 → TIMELINE_CLOCK_UNRESOLVED → Timeline = INVALID → 拒绝 AI Review。
3. **Anti-future-leak**（§10/§47）：任意 frame 的状态只使用 battle-relative time ≤ t 的事件；
   battle_results 最终状态绝不反写进历史 Frame；重亮后仅允许 bounded retrospective
   inference（HP_GAP_DELTA：幅度可知、精确时刻/攻击者/原因 UNKNOWN）。
4. **Knowledge-world 分层**（§49）：canonical model 保留 backend 世界状态（playback/debug），
   FrameVehicle 的 knowledgeState 表达「当时已知」——敌方位置流中断即 LAST_KNOWN（带 age），
   绝不把 last-known 当 current（§9.1）。**己方 actual combatant（PR #103）**：服务器持续下发完整
   位置 state，静止时不重复发同坐标包（真实样本存活己方静止 10.8s 无新位置）；
   last position + 无 EntityLeave + 未 destroyed = 可 carry-forward 的当前位置，
   不因 age > POSITION_GAP_SEC 降级为 LAST_KNOWN（enemy 语义不变）。
5. **保守语义**：Type-5 点亮语义未正式证明（visibility.md 门禁 A = PARTIAL），
   位置流状态使用 POSITION_STREAM_ACTIVE / LAST_KNOWN / UNKNOWN / DESTROYED_KNOWN，
   不声称 SPOTTED/UNSPOTTED（§12/§57）。

## 结构

| 类型 | 职责 |
|---|---|
| BattleTimeline | 入口 record：mapCode / durationSec / battleStartRawClockSec / clockResolution / frames / events / validation / limitations；frameAt(t) 确定性查询 |
| BattleFrame | second / stateAtSec / world / vehicles / events / deltas / tacticalState |
| FrameVehicle | identity（entityId/accountId/nickname/tankId/tankName/tankClass/tankTier/team/friendly）+ lifeState + health + position + orientation + mapState + knowledgeState + 累计伤害 + destroyedKnownAtSec |
| FrameHealth | currentHp(+observedAt/age/source) 与 baseHp/effectiveMaxHp 严格分开（§7）：tankopedia base 绝不冒充本场 maxHp |
| FramePosition | position(+observedAt/age) + knowledge(CURRENT/LAST_KNOWN/UNKNOWN) + source(OBSERVED_EVENT/CARRIED_FORWARD) |
| FrameMapState | gridRegion / areaId / semanticTags / elevation / cover zone 候选；禁止 exact LOS 断言（§16.2） |
| WorldSummary | 双方存活 / enemyKnown / enemyLastKnown / enemyUnknown / enemyDestroyedKnown / 争霸点数 |
| BattleTimelineValidationResult | 错误码见下；valid=false → 拒绝 AI Review |
| BattleDeltaEngine | 帧间确定性 delta（§15）：POSITION_CHANGE / FIRST_KNOWN / ENEMY_LOST / ENEMY_REACQUIRED / HP_CHANGE / HP_GAP_DELTA / DESTROYED / ALIVE_COUNT_CHANGE / LOCAL_FORCE_CHANGE / POINTS_CHANGE / ENGAGEMENT_ACTIVITY |
| EpisodeDetector | 确定性章节切分（§23）：强信号（首次接敌/阵亡/存活变化/点数变化/HP 空窗）优先，首选 15–45s、硬最小 8s、硬最大 60s，覆盖整场、连续、无重叠；禁止固定 30 秒切块。**state/event boundary contract（PR #102）**：segment 半开秒区间 [start, end)，second=start 的 delta 属于本段；BEFORE = frameWorld(max(0, start−1))（frame(start) 已消费该秒事件，不能用作 BEFORE），首段 start=0 钳制到 0（t=0 前无状态取初始帧），AFTER = 最后包含秒 —— 保证 BEFORE → EVENTS → AFTER 因果顺序 |
| BattlePlaybackProjector | 从 canonical timeline/facts 直接投影 `BattlePlaybackDataset`（tracks、segments、transitions、events）；不生成前端 compatibility view |
| ReplayArtifactWriter normalization | 仅作为旧 persisted playback artifact 的读取边界兼容层；非 current Battle Playback 数据源 |

## Validation 错误码（§4）

    TIMELINE_META_INVALID / TIMELINE_RESULTS_INVALID / TIMELINE_ROSTER_INCOMPLETE /
    TIMELINE_RECORDER_UNRESOLVED / TIMELINE_TEAM_UNRESOLVED / TIMELINE_CLOCK_UNRESOLVED /
    TIMELINE_STREAM_CORRUPTED / TIMELINE_POSITION_COVERAGE_INSUFFICIENT /
    TIMELINE_MAPPING_INSUFFICIENT / TIMELINE_MAP_UNRESOLVED

- 个人复盘额外要求：recorder 唯一解析 + account 可识别 + perspective team。
- 团队复盘额外要求：perspective team + 队伍 roster 充分。
- 完全 optional 字段缺失不拒绝（只影响置信度/limitations）。

## AI 集成

- Call #2 主叙事收敛为 BATTLE SNAPSHOT → PRE-BATTLE PRIOR → TACTICAL TIMELINE（Episode 化）→
  CRITICAL DECISION WINDOWS → TASK（§33）；窗口证据保留在文末避免重复全文（§22.1）。
- PersonalAiContextCompiler：Episode 化 compact 上下文（BEFORE/EVENTS/AFTER/TACTICAL_CHANGE +
  YOU hp/pos + 敌方已知/未知分布），deterministic、可测试、不 dump 全帧（§34-§36）。
- TeamAiContextCompiler：双方对称（我方部署/敌方知识/局部兵力/点数），actor = perspectiveTeam，
  不以录像者为中心（§29/§51）。
- 无 settlement-only fallback（§3）：Timeline 无法构建 → AI_TIMELINE_UNUSABLE 业务错误，不调用 LLM。
- **Personal AI hard gate（§3）**：TacticalReviewHarness / analyzePlayerOrFallback 在 Call #1 之前
  构建并验证 canonical timeline（无重建 / 录像者未解析 / timeline 不可用 → AI_TIMELINE_UNUSABLE，
  AI Gateway requests = 0）。
- **Team AI hard gate（§3，PR #102 ）**：TeamReplayAnalysisService.analyzeTeamGroups（Team AI
  唯一 production 编排入口）在 Call #1 / Call #2 / Team Autopsy 之前为每个 context 构建并验证 canonical
  timeline（一次 build、一次 validation）：reconstruction 缺失 / timeline 不可用 → AI_TIMELINE_UNUSABLE，
  AI Gateway requests = 0；验证通过后同一 validated timeline 下传 TeamAiPromptBuilder 渲染 TACTICAL
  TIMELINE 段（PromptBuilder 不重复 build、不 catch 降级）。analyzeSingleTeamContext / analyzePlayerContext
  为兼容/测试入口（非 production AI Review entrypoint）。
- Context 可观测性（§38/§39）：wotb_ai_review_context_section_tokens{section} 低基数指标 +
  Call #2 预算日志。

## 权威性矩阵（§46）

| 字段 | 分类 | 说明 |
|---|---|---|
| identity（entityId/accountId/nickname/team/tankId） | PROVEN / EXACT | ParticipantMappingEvent + battle_results 名册 |
| tankName / tankClass / tankTier / baseHp | DERIVED（reference） | tankopedia 参考数据，不是本场事实 |
| XYZ 位置 | PROVEN / EXACT（位置流） | type-10；LAST_KNOWN 时降级 |
| hullYaw | PROVEN / EXACT | type-10 yaw（弧度→度） |
| turretRelativeYaw | PROVEN / EXACT | type-7 propId=2（u16*360/65536-180） |
| currentHp | PROVEN / EXACT | type-7 propId=3（signed i16；sentinel 归一化） |
| effectiveMaxHp | PARTIAL | 仅本场观测证明；禁止 tankopedia base 冒充 |
| destroyed（world fact） | PROVEN / EXACT | EXACT alive=false / 死亡 sentinel |
| damage / points | PROVEN / EXACT | type-8 伤害；type-8 subtype48 root field12（争霸实时点数） |
| observation / SPOTTED | NOT_ALLOWED_FOR_AI | Type-5 未证明；仅位置流覆盖语义 |
| exact LOS / 障碍挡炮 / hull-down | NOT_ALLOWED_FOR_AI | 无 geometry/raycast 证据 |
| shot fired | NOT_ALLOWED_FOR_AI（无可靠 firing event） | 禁止 DamageEvent 强推开火（§13.1） |

## 未来能力（明确不做/待验证）

- 逐位置 heightmap 栅格 / 逐对象几何（当前 semantic JSON 仅聚合统计）→ 不做 per-cell 地形断言。
- exact LOS / raycast：无验证证据前明确标注未来能力（§16.3）。
- Type-5 精确点亮语义：继续有限 research，不阻塞 V2（§57）。
