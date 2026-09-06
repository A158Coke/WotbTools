# WotbTools：训练房 / 联赛 Team-Level AI 战术复盘 — 设计文档

## Quality harness v1（0-token CI + 手动真实回放）

### Team AI Review v0.6：战术因果推理深度

v0.6 是 Team Call #2 的 reasoning-quality upgrade，不改变 v0.5 的
`TeamAiReviewResult` JSON、SSE/API 或前端字段，也不新增模型调用、Team Autopsy、
后端 tactical semantic validator 或第二套 `TacticalEpisode`。生产链仍由现有
`TeamAiPromptBuilder` 提供事实、时间线和确定性证据，质量提升集中在 prompt 的推理顺序与
contract tests。

模型必须先读权威事实，再建立 Information state，区分 Known、Remaining uncertainty 和
`CURRENT` / `LAST_KNOWN` / `UNSEEN`，说明新观察移除了哪种不确定性及其 Decision impact；
随后评估基地/点数、时间、存活、位置和可用火力形成的 objective obligation。每个关键 local
engagement 都要区分实际参与、潜在参与和无法影响窗口的存活车辆，并以射界、遮挡、
time-to-influence、目标、交叉火力、敌方固定、目标贡献和安全路径判断有效参与，距离只是证据。

选中的 episode 按 `State before → Change → Immediate local consequence → Propagation` 展开，
第一次减员后检查射线、牵制、释放的敌方火力、角度和互保是否变化；HP、伤害和死亡只作为
下游验证，不作为默认的 episode 入口。训练建议使用 `Trigger → Decision target → Training goal`，
个人重点复查和高贡献者只能从已展开且有 decision/execution 依据的 episode 选择，没有证据就省略。
证据不足时保留 UNKNOWN，不把相邻死亡自动串成因果，也不把 vehicle class 当作 tactical role。

v0.6 的 deterministic prompt contract tests 检查三语推理锚点、顺序、未知状态、目标义务、
局部参与、传播和下游验证；默认 CI 与现有规则一样保持 0 provider token。真实 `.wotbreplay`
质量仍通过显式手动 KSR / benchmark 回归确认，synthetic contract PASS 不代表真实模型语义 PASS。

### Team AI Review v0.5：结构化结果与前端渲染

Team Call #2 现在返回稳定 JSON 结果：`summary`、`episodes`、`trainingSuggestions`、
`reviewFocus`、`highContributors`。episodes 最多 6 条，后两类各最多 2 条；所有引用必须
指向当前 roster 和已存在 episode。Backend 只做技术契约校验，不做 tactical validator、正文
改写或 settlement-only Team Autopsy；SSE `done` 事件通过 `teamReview` 一次性传递最终结果。
前端自行控制标题层级，空的可选区块不渲染，字段内部仍可使用 Markdown。
SSE `done.teamPlayers` 同时携带由 authoritative Team roster 生成的 `playerKey` →
`displayName` / `tankName` 映射；LLM structured JSON 仍只返回稳定 `playerKey`，前端展示和复制均使用该映射。

### Team AI Review v0.4：从信息到决策影响

v0.4 不改变 v0.3 的输出长度、自由正文或 evidence model，而是约束长篇复盘的因果精度：对关键 Information 依次检查当时已观察事实、剩余未知状态（CURRENT/LAST_KNOWN/UNSEEN）和 decision impact。没有把信息转成部署、风险或行动义务变化时，不能只写「拿到信息」。

距离只能作为空间证据，不能单独判定脱节或支援价值。是否能支援局部要结合射界、遮挡、到达影响时间、机动性、目标、交叉火力、信息贡献、目标压力、敌方固定状态和安全路径。训练建议使用本局可观察状态触发，不生成通用的米数阈值、固定时刻或 vehicle-class mandatory role；目标状态改变行动义务时，应说明谁必须行动、谁可以等待。

「重点复查」「高贡献者」和「关键威胁」只能绑定正文中已经展开的 tactical episode，不能重新从 settlement leaderboard 选择。重点复查要给出时间/窗口、局部位置、实际角色和决策/执行问题；高贡献者要回答「他改变了什么」，仅有伤害、击杀或存活数据时省略。传播需要检查，但不要求每次都找到传播；缺证据时保持不确定，也不猜测敌方意图。

Team review 的质量验证不依赖默认 CI 调用模型。deterministic contract tests 校验 prompt 的推理顺序、结构化输出边界和反 settlement-shortcut 规则；历史 offline harness 对真实 `.wotbreplay` 走生产 parser、reconstruction、canonical timeline、team context、prompt 和 grounding facts 链，只校验证据类型与结构性 gold constraint。gold 不包含标准 review，也不会发送给模型；已有 synthetic golden cases 只证明 prompt contract，不证明真实 LLM 行为。

手动 benchmark 使用非默认 `ai-live` 的 `TeamReplayQualityBenchmarkRunner`，显式选择 case/all 后才会创建 provider gateway。它不注入 synthetic scenario，运行次数默认 1，报告包含 model/prompt version/git SHA/date、grounding/shortcut/结构化 basis 结果、`must_notice`/`must_not`、最终 review 和可选 baseline 对比；不持久化 prompt、API key 或用户 token usage。

## 概述

训练房和联赛回放现在可以通过 AI Review 进行 Team-Level 战术复盘。

分析对象是整支录像者所在队伍，而非录像者个人。

> 2026-08-12：AI Review 收口为单文件（`AiReplayBatchPolicy.MAX_FILES=1`），多文件/多视角 partition 能力已移除（`analyzeMulti`、MULTI prompt、complete-link partition、多场 roster 趋势）。

## 1. 产品语义

- Recorder raw team 1 → team 1 为分析对象
- Recorder raw team 2 → team 2 为分析对象
- 未知 team → UNKNOWN
- 胜负三态：TEAM_WIN / TEAM_LOSS / DRAW_OR_UNKNOWN
- draw/unknown 不压缩为 loss
- PLAYER_FOCUSED（随机战斗）使用 FRIENDLY/ENEMY/UNKNOWN 标签
- TEAM_PERSPECTIVE（训练房/联赛）使用 dominant clan 标签
- 同场双方 perspectives 各自独立分析，不得合并
- Recorder 只用于确定视角，不被 AI 视为分析对象

### Team Tactical Skill v0.2

Team Call #2 通过 `AiPromptLibrary` 的模块化 include，按 INFORMATION/VISION → OBJECTIVES → LOCAL ENGAGEMENTS → POSITION/TEMPO → TEAM EXECUTION → HP/TRADES 注入六个紧凑的训练房/联赛推理模块：新增 `information-vision`、`local-engagements`，并升级已有四个模块。它们是给 LLM 的经验性思考框架，不是后端战术 verdict；后端仍只提供 Canonical Timeline 和确定性证据。

- 先重建当时信息状态（CURRENT/LAST_KNOWN/UNSEEN）、基地/点数义务、空间结构和局部有效兵力，再解释动作与结果；信息更新必须继续追踪是否被解释并转化为行动。
- 局部不是封闭盒子：检查外部火力、固定、逼位、交叉和释放车辆造成的信息/火力/空间传播；分析谁创造了击杀条件，而不只看最后一炮。
- 复盘 observable execution，不假设赛前战术计划，也不推断语音、call、指挥责任或心理原因；证据不足时跳过判断。
- `primaryDiagnosis` 仍保留以避免契约变更，但含义是“本场最重要的结论”，可以是关键成功因素、对手处理更好或没有明显确认错误，不要求制造问题。
- Strategic Prior 是阵容与可能性空间的战略基线，不是队伍实际计划；实际执行偏离它不能单独构成失误。
- `TeamAiContextCompiler` 复用 canonical timeline 额外输出 `OBJECTIVE_STATE_TIMELINE`，携带已解码的实时基地归属/捕获进度/实时点数；缺失不被当作零值，战术结论仍由 LLM 负责。
- 争霸赛使用约 +40 击杀价值、750–800 警戒区、800+ 高压力的经验梯度；攻防战使用约 100 秒完整捕获与 70–80 秒警戒区。阈值只影响 LLM 排序，不进入后端状态机。

模块同时提供 EN/RU 本地化替换锚点，`PromptRuleContractTest` 保证 include 展开和三语规则不漂移。`team-tactical-skill-v01-*.json` 是 prompt contract / static golden cases，保留用于验证规则进入 prompt，但不单独声称已验证实际 AI tactical behavior。未来手动诊断可使用 opt-in 的 `TeamTacticalSkillLiveBehaviorEvalTest`：复用现有 DeepSeek gateway 与 Team Call #2 JSON contract，解析最终输出并执行 A–H 的明确 contract checks；live scenario 只提供事实，expected behavior 只存在于测试 assertion，生成 `target/ai-eval-report/team-tactical-skill-live-report.{md,json}`。该测试带 `@Tag("ai-live")` 且需要 `-Dai.tactical.live.enabled=true`，永远不进入普通 `mvn test`、默认 CI 或 PR 合并条件；真实 provider evaluation 具有 token 成本和模型随机性。

`NO_SIGNIFICANT_CONFIRMED_ERROR` 只表示当前可确认/可观察证据中没有确认的重大错误，不证明本场不存在任何错误。证据覆盖不足时跳过不受支持的判断；保留 `primaryDiagnosis` 字段，不新增 backend tactical verdict、权威 `GOOD_TRADE`/`BAD_PUSH`/`HALF_COMMIT_ERROR` 标签或第二套 episode/harness。Strategic Prior 仍只是非实际赛前战术的战略基线，回放不能证明语音、call、沟通或指挥责任时不得猜测。

### Team AI Review v0.3：只选关键内容，但完整解释关键内容

Team Review 不再以尽可能短为目标，而是采用 selective but complete tactical review：不逐秒复述时间线、不为格式凑段落，但被选中的关键 episode 要完整说明「发生了什么 → 当时知道什么 → 哪些车辆参与 → 为什么重要 → 如何影响下一阶段」。当证据存在时，Information 要写出它怎样改变决策空间，Objectives/点数、局部交战和多个局部之间的传播也不能为了简洁省略。

`primaryDiagnosis` 只是整场摘要，正文 `reviewMarkdown` 可以继续保留次级关键 episode、信息变化、目标义务、传播和执行后果。正文优先级为团队战术分析、Information/Objectives、关键 episode、propagation、训练建议，之后才是可选的「重点复查」和「高贡献者」；两个个人 section 各自最多 0–2 人，缺少 structural evidence 或可复查的决策/执行问题时完全省略。普通 7v7 约 1200–2200 字、复杂局允许约 2500–3500 字只是软目标；Team Call #2 默认专用输出上限调整为 8192 tokens，仍不改变 SSE/API contract。

## 2. 入口和分层（Dataset-only）

```
Replay selection
  -> Processing Job (ReplayParseScheduler / full process，multipart 上传仅发生在此一次)
  -> derived artifacts：
       ai-facts.json       (ReplayArtifactWriter.writeAiFacts)
       map-overview.json   (ReplayArtifactWriter.writeMapOverview)
  -> source READY（r0）
  -> authoritative Dataset identity = processingJobId + sourceId

AI：
  ReplayPage Workspace -> AiReviewPanel
  -> POST /api/replay/analyze   (Content-Type: application/json)
       { processingJobId, sourceId, lang, correlationId }
  -> ReconstructionController.analyzeDataset
  -> AiReplayReviewService.analyzeFacts(processingJobId, sourceIndex, language, listener)
       -> ReplayProcessingJobStore.acquireForSource(processingJobId)   [Dataset lease]
       -> ReplayArtifactWriter.readAiFacts(...)
       -> AiReplayAnalysisService.analyzeTeamGroups / analyzePlayerOrFallback / TacticalReviewHarness
   -> SSE 流式响应（call1 / evidence / call2 阶段事件；Team v0.5 在 done 一次性返回结构化结果）
```

- 不重新上传 replay、不重新 full-process：AI Review / Battle Playback / Export 全部消费同一 Processing Dataset。
- multipart `POST /api/replay/analyze` 已废弃为 legacy 410 compatibility shim（`ReplayLegacyEndpoints`），不是业务入口。

## 3. 上传边界 / Dataset 边界

- 用户选择回放 → 创建 Processing Job（multipart 上传在此发生一次；upload/process once → derived artifacts 复用）
- AI Review 单次分析 1 个 source（`sourceId` 形如 `r0`，对应 Processing Job sources[i]）
- source 未 READY → `PREPARING_DATASET`（前端禁用 Analyze，显示「正在准备回放数据…」）
- Dataset 过期（`JOB_NOT_FOUND`）→ 前端可自动恢复一次（exactly-once + generation-owned + authoritative invalidation，保留已有 `resp`）
- `DATASET_UNAVAILABLE` / `DATASET_REFERENCE_REQUIRED` / `SOURCE_NOT_FOUND` 不是可恢复的过期信号：本地化展示，绝不静默 full-process
- `SOURCE_NOT_READY` / `SOURCE_PROCESSING_FAILED` 保持稳定语义
- `/api/replay/analyze`（AI）与 `/api/replay/map-overview`（Playback）走同一 Dataset 引用，绝无 multipart AI/Playback 回退

## 4. Grouping 与 Partition

- Exact duplicate detection（同一文件上传多次）
- Perspective grouping（同一战斗同一队伍合并为一个代表）
- Opposing perspectives 永远不可合并（同战斗不同队伍）
- 单文件策略：1 个文件 = 1 个 perspective group；Team 路径逐 context 单队调用
- 多视角 complete-link partition 已移除（2026-08-12）

## 5. Team Evidence

| 类型 | 来源 | 说明 |
|------|------|------|
| Authoritative aggregate | battle_results.dat | 伤害/承伤/助攻/格挡/击杀/幸存/死亡时刻 |
| Observed aggregate | 事件流 | 事件流观测子集，非权威 |
| Member identity | TeamEntityMapper | accountId / nickname / tankId / entityId 映射 |
| Formation phases | PositionChangedEvent | 15 秒窗口、BFS 聚类、canonical centroid |
| Clusters | Formation phase | 100m 距离、九宫格 region、CLAMPED/VALID |
| Engagements | DamageEvent | 10 秒 gap、focus fire、target switch |
| Battle phases | Damage + position | OPENING(45s) / FIRST_CONTACT / MID_GAME / ENDGAME |
| Key events | Battle + events | TEAM_MEMBER_DESTROYED / FIRST_CONTACT / BATTLE_END |
| Coverage | Event stream | 解码率、完整度、CLAMPED/INVALID 计数 |

### 5.3 死亡时刻口径与阶段语义

- 业务死亡秒值只来自 settlement `#301 field24 lifeTime`；Playback/live reconstruction 仅用于播放、HP/动画和诊断，不能覆盖或回写 `PlayerResult`。EntityLeave、最后位置和 damage threshold 不是死亡 authority；无有效结算秒值时依赖死亡时刻的 prompt 证据必须 fail-closed。
- 阶段时间线行明确「至阶段末」存活人数（`阶段末friendlyAlive` / `至阶段末 我方存活`），system prompt 禁止把阶段末人数解读为「某时刻前已全灭」；prompt 注入双方逐车阵亡时间线（`DEATH_TIMELINE`，本队/对方 + 昵称 + 坦克 + X分XX秒）。

### 5.4 观测伤害抑制

事件流迄今只逆向出 sub3 直接伤害，观测聚合与权威结算不一致时标记 `OBSERVED_DAMAGE_IS_PARTIAL`（条件触发：观测=权威时自动消失），prompt 层抑制观测数字、强制以 `AUTHORITATIVE_TEAM_RESULT` 为唯一可信口径；随机战交火段同步抑制「观测输出子集 + 百分比」。待事件流覆盖达 100%（type 5/31/35/39 与更多 EntityMethod subtype 逆向完成）后数字自动恢复输出。

### 5.5 位置知识状态契约（CURRENT / LAST_KNOWN，2026-08 第六轮）

FormationDepthEvidence / RelativeDepthHpEvidence 的阶段位置参考带 knowledge provenance
（`PhasePositionReference`：accountId / team / x / z / knowledge / observedAtSec / ageSec，
knowledge 复用 canonical `PositionKnowledge`）：

- **friendly actual combatant**（last position + 无 EntityLeave + 未阵亡）→ **CURRENT**
  （含 phase 内无新 PositionChanged 的 carry-forward，与 canonical BattleTimeline 同口径）；
- **enemy** → 最后观测 age ≤ canonical 当前阈值（`BattleTimelineBuilder.POSITION_GAP_SEC=5s`）
  → **CURRENT**，否则 **LAST_KNOWN**；
- **exact 阵型/覆盖/距离数学只消费 CURRENT**：enemy LAST_KNOWN 不得满足 current-position completeness、
  不得作为当前 enemy centroid / enemyPositionPresence / enemyWeightedCoverageScore 坐标、不生成
  memberDist/referenceDist/relativeDepthM exact 距离；
- CURRENT 不完整时 FormationDepth fail-close 只输出 `POSITION_COVERAGE_INSUFFICIENT` + CURRENT presence
  + 独立信息段 `ENEMY_LAST_KNOWN_POSITION_REFERENCES`（account + region + observedAtSec + ageSec +
  knowledge=LAST_KNOWN，不伪装 current）；RelativeDepthHp 直接 fail-close 该 phase 的 exact 距离测量；
- **Region presence 基于 resolved 车辆位置 state**（每辆 CURRENT 车辆 +1，不是位置包数量）——同一车辆
  100 个包 presence 仍 1，coverageCompleteness 与 presence 同一套 resolved state；
- **Actual Combatant 边界**：证据层只消费 battle_results #301（battle.players）成员位置；
  spectator/observer/camera/静态实体位置绝不进入战术位置覆盖。

### 5.6 ActualCombatantEntitySet（Canonical BattleTimeline 边界，2026-08 第七轮）

Canonical BattleTimeline 的 tactical FrameVehicle universe 从源头按 #301 过滤（实际参战实体集）：

- **建立方式**：`TeamEntityMapping.actualCombatantEntityIds(#301 账号集)`——
  #301 账号集 = battle.players 中 accountId > 0 的账号（battle_results #301 actual combatant）；
  实体集 = mapping.entitiesById 中 identity.usable 且 identity.accountId ∈ #301 账号集的实体；
  `BattleTimelineBuilder` 帧循环只对 `knownEntityIdsAt(t) ∩ actualCombatantEntityIds` 构造 FrameVehicle；
  空实体集 → fail-close `TIMELINE_MAPPING_INSUFFICIENT`（timeline 不进入 AI Review）。
- **为何必须源头过滤**：`BattleDeltaEngine` 以 `isEnemy = !friendly()` 判定敌方，team=null 的
  spectator/camera 实体会被当作 enemy，产生假的 FIRST_KNOWN / ENEMY_LOST / ENEMY_REACQUIRED，
  POSITION_CHANGE / REGION_CHANGE 本身无 team gate——只在 FrameVehicle 层过滤才能堵死全部 delta 路径。
- **broad-roster 完整身份也不放行**：即使 #201 / ParticipantMapping / reconstruction participants 给
  spectator 提供 accountId / team / nickname / 坦克元数据（usable identity），只要 account 不在 #301，
  仍从 tactical timeline 排除（防止未来 spectator metadata 更完整后重新污染）。
- **下游确认**：WorldSummary（#301 roster 为战术名单）、BattleDeltaEngine、EpisodeDetector、
  TimelineFocusWindowSelector、TeamAiContextCompiler / PersonalAiContextCompiler 全部只消费过滤后的
  universe（compiler 输出不得出现 spectator 的 车辆#<eid> / account）；raw timeline.events 保留原始事件
  供必要协议用途。

### 5.1 战斗开始

`BattleStartResolver.resolve()` 返回 `BattleStartResolution`（IDENTIFIED / ESTIMATED / UNRESOLVED）。所有事件时间通过 `tryRelative()` 转换为 battle-relative（即开战后第 N 秒）。准备阶段事件被排除。

### 5.2 战斗结束

`BattleEndResolver.resolve()` 按优先级：
1. `battle.durationS`（finite 且 > 0）
2. RoundFinishedEvent（battle-relative）
3. Scope-local evidence（该 perspective 的最后有效 position/damage）
4. UNKNOWN（返回 BATTLE_END_UNRESOLVED limitation，phases 为空）

Enemy-only damage 不得延长 Team phase。

## 6. 地图和时间

- 地图名通过 `common/map_names.json` 映射为中/英/俄
- Tank 名通过 `common/tankopedia-tier{7,8,9,10}.json` 解析（单一数据源，按等级拆分）
- 地图坐标 500x500 canonical 米
- X/Z 为水平轴，Y 仅作高度
- 九宫格 region 1-9（对随机战斗和团队赛共用）
- 坐标三态：VALID / CLAMPED / INVALID
- 不可信数据通过 `PromptDataQuoter.quote()` JSON 转义

## 7. Prompt Budget

### 三层优先级

| 层级 | 内容 | 保证 |
|------|------|------|
| P1 Mandatory | context type, analysisUnitId, perspective header, unitLimitations, isolation/omission contract | 原子写入，超出预算抛 AiPromptBudgetExceededException（HTTP 400） |
| P2 High-priority facts | authoritative aggregate, observed aggregate, memberFacts, coverage | 原子写入，无法容纳时该 perspective 整体 omitted |
| P3 Optional | memberMovements, formation, battlePhases, engagements, keyEvents | 可按 unit 整块省略，不影响其他 unit |

### 预构建与原子写入

- Budget planning 使用 `AiTokenEstimator` 估算 token（保守系数 `codePointCount * 1.25`），输入硬上限由 `AiModelProperties.singleReplayMaxInputTokens` 配置（默认 940,000）；不再使用固定字符数（历史 `MAX_INPUT_CHARS=30,000` 按 `String.length()` 计数的实现已移除）。
- `appendRequiredBlock()` 保证 block 整体写入或抛出异常
- 被截断的 unit 加入 `truncatedUnitIds`
- `globalLimitations` 包含 `AI_INPUT_TRUNCATED`
- 总 token 预算由 `BudgetWriter.finish(estimator, maxInputTokens, ...)` 在写入时判定，超限标记 truncated
- Optional 截断不影响其他 perspective 的 mandatory/high-priority facts

## 8. Result Contract

`POST /api/replay/analyze` 已由同步 JSON 改为 **SSE 流式**（`text/event-stream`，旧同步端点不保留），
`ReplaySseWriter` 序列化（自定 JSON event，`data` 为 JSON）：

| event | data | 说明 |
|-------|------|------|
| `call1_start` | `{}` | Call #1（赛前战略基线）开始 |
| `call1_done` | `{}` | Call #1 结束（真实发起调用时必发，无论成败） |
| `evidence_done` | `{}` | 后端证据分析完成（随机战 harness 与团队路径均发射；团队路径在 `TeamReplayAnalysisService.analyzeTeamGroups` 首轮 Call #2 前补发，前端阶段指示随之推进） |
| `call2_token` | `{"delta":"..."}` | 主复盘 token 增量 |
| `done` | `{"analysis":null,"preBattleSection":"...","teamReview":{...}}` | Team v0.5 结构化结果一次性完成；个人旧文本结果仍可使用 `analysis` |
| `error` | `{"code":"AI_..."}` | 流中途失败（稳定错误码） |

异常传达规则：request-envelope 校验（`UNKNOWN_LOCALE` / `NO_REPLAY_FILES` /
`NO_REPLAY_FILE` / `REPLAY_FILE_COUNT_EXCEEDED` / `INVALID_REPLAY_FILE_TYPE` /
`FILE_TOO_LARGE` / `TOTAL_REQUEST_TOO_LARGE`）与 worker 池饱和
（`AI_REVIEW_BUSY`）在返回 `SseEmitter` 前由 `@ExceptionHandler` 映射 HTTP
400 / 503；worker 启动后的运行时/业务失败（`NO_BATTLE_DATA` /
`PERSPECTIVE_TEAM_*` / `TEAM_FEATURES_UNAVAILABLE` / `AI_NOT_CONFIGURED` /
`AI_*` 等）经 `error` 事件传达（HTTP 已 200），客户端断开时终止上游调用不向
已断开的连接写入。`AiChatGateway.stream` 单次尝试不流内重试，
`AI_TIMEOUT` / `AI_CANCELLED`（`correlationId` cancel）语义与同步 `chat()` 一致；
同步测试路径委托流式实现（`AiReviewStreamListener.NOOP`）。

**Call #2 流式保证**：Call #2 自由文本复盘默认关闭 thinking（`AI_THINKING_ENABLED_CALL2`
默认 `false`，见 DEVELOPER_GUIDE 配置表）——DeepSeek 推理模式下 `reasoning_content` 先流、
content 末尾一次性到达会破坏逐段流式；`SpringAiChatGateway` 另对单块 >512 字符的 delta
按句切分（≤128 字符/片、间隔 ~20ms、上限 512 片）兜底，保证前端 `stream-text` 在 `done`
前持续出字。

**Historical Natural Coach Mode + Factual Consistency Guard（legacy，2026-08）**：
- Team Call #2 输出改为 JSON envelope（`primaryDiagnosis` / `reviewMarkdown` / `claims`，
  由 `TeamReviewEnvelopeParser` 解析）；`done.analysis` 仍为 `reviewMarkdown`（用户看到的
  完整自然语言复盘，主标题 `## 团队复盘`），structured 字段为内部 grounding 契约，不进正文。
- **claims 机器字段（三语通用）**：涉及数值/时间/位置/玩家事件的 claim 携带
  `timeSec`（battle-relative 秒）/ `region`（1-9）/ `count`（车辆数）/ `subject`（玩家昵称或坦克名）/
  `value`（存活变化机器格式如 `7v7 -> 4v6`）/ `claimType` / `side`（FRIENDLY/ENEMY）/
  `countSemantics`（EXACT/AT_LEAST/SUBSET）/ `knowledge`（CURRENT/LAST_KNOWN）；validator 优先按机器字段做语言无关校验，
  正文自然语言（ZH/EN/RU）仅作兜底；`region + count` 为精确语义（exact），at-least/subset 标记放行下界/子集。
- **Evidence Binding（最终）**：claims 的 `evidenceIds` 必须真正绑定支撑它的证据——
  claimType→允许证据类型统一映射（DEATH→PLAYER_DESTROYED / ALIVE_TRANSITION→ALIVE_COUNT_TRANSITION·
  FOCUS_WINDOW / POSITION_REGION→POSITION_REGION / ENEMY_POSITION→ENEMY_POSITION_KNOWN），每个引用必须
  存在且属于允许类型（借用无关编号 → BINDING FAIL），且至少一个引用证据完整支撑该 claim（身份/时间/数值/
  区域/knowledge 一致）；重复坦克名（如两辆 IS-7）必须用 `subjectAccountId`（可选稳定身份）或昵称，
  禁止仅凭 tankName 绑定。有 evidenceIds 时引用证据是 primary source，全局列表/最近快照只作 defense-in-depth。
- 输入注入确定性 `GROUNDING FACTS` 段（证据编号 E1xx）；`TeamFactualConsistencyValidator`
  （V1–V6）校验通过后才把 `reviewMarkdown` 以 `call2_token` 增量流式转给前端——
  **Call #2 在通过校验前不流式输出**（避免把待改写的草稿暴露给用户，代价是 draft 阶段
  前端保持「战术复盘生成中…」）。
- 校验失败 → LLM 自修循环（targeted rewrite → full rewrite → fail-safe），Backend 绝不
  代改句子；重试耗尽 → `error` 事件 `AI_REVIEW_GROUNDING_FAILED`（HTTP 已 200）。
**Technical schema resilience（当前生产行为）**：Team Call #2 保持 v0.5 JSON/API 契约，backend
parser 返回 `result/failures/normalizations/status`。不存在的 episode/player reference 等 optional
错误确定性清理并继续完成；core schema 的 fatal 错误 fail-closed，repairable 错误只允许一次紧凑、
定向 technical repair。repair 输入仅含生成 JSON、精确 failure path/code/constraint、权威 roster
keys 与已有 episode reference 约束，不重复发送完整战术 context。repair 仍失败返回
`AI_REVIEW_SCHEMA_FAILED`，前端三语文案和诊断 ID 与 `AI_REVIEW_GROUNDING_FAILED`、provider
unavailable 分开。对应事件和低基数指标见 `docs/operations/observability.md`。

**DeepSeek 官方 JSON Output（2026-08，JSON 语法层加固）**：Team Call #2 已启用 provider
`response_format=json_object`（`AiChatRequest.responseFormat=JSON_OBJECT`，仅此调用；Player /
Pre-battle / Harness / Autopsy 保持 TEXT）。目的：消灭「非法 JSON / JSON 前后多余文本 → parser fail →
昂贵完整 LLM retry」这一类 syntax 层失败。**职责三层不混用**：provider JSON mode = syntax guarantee，
`TeamReviewEnvelopeParser` = business schema guarantee（合法 JSON 但 schema 违反仍 FAIL），
`TeamFactualConsistencyValidator` = truth guarantee。Parser 失败现在可按稳定枚举分类
（`EMPTY_OUTPUT` / `INVALID_JSON` / `MISSING_PRIMARY_DIAGNOSIS` / `INVALID_CLAIMS` /
`UNKNOWN_CLAIM_TYPE` / `INVALID_MACHINE_FIELD_TYPE` / `MISSING_REQUIRED_MACHINE_FIELD` 等，
经 `event=team_review_parse_result` 记录）；每轮 attempt 的校验结果（`conflictCount` / `checks` /
conflict `reasonCode`）经 `event=team_review_validation` 记录，Loki 按 correlationId 可重建完整时间线
（见 `docs/operations/observability.md`）。

历史上响应的四类计数（`analysisUnitCount` / `analyzedUnitCount` /
`omittedAnalysisUnitCount` / `unavailableAnalysisUnitCount`）、`files`、
`analyses`、`keyEvents`、`limitations` 等统计/诊断字段均无消费者
（前端只渲染 `analysis`），已作为提前性载荷删除；对应不变量只存在于
prompt 构建内部（`TeamAiPromptBuilder` 的 included/omitted/truncated 集合）。

## 9. Limitations

### Global（prompt 内容中的全局限制行）

- `AI_INPUT_TRUNCATED`

（`PERSPECTIVE_TIMELINES_ISOLATED` / `ROSTER_CONSISTENCY_UNCONFIRMED` / `PERSPECTIVES_OMITTED_COUNT_<TOTAL>` 为多文件 partition 历史限制，2026-08-12 移除后不再产生）

### Per-unit（prompt 中 `unitLimitations=[...]` 头部）

- `DUPLICATE_TEAM_MEMBER_ACCOUNT_IDS`
- `TEAM_MEMBER_ENTITY_UNMAPPED`
- `TEAM_MEMBER_POSITION_UNAVAILABLE`
- `BATTLE_END_UNRESOLVED`
- `AI_PERSPECTIVE_OMITTED_FROM_PROMPT`
- `AI_INPUT_TRUNCATED`（仅当该 unit 实际发生 truncation）

### 隔离规则

- Global limitations 不出现在 unit report
- Per-unit limitations 不出现在 global list
- Per-unit limitation 始终绑定 `analysisUnitId`

### Omission 本地化

- `AI_PERSPECTIVE_OMITTED_FROM_PROMPT` -> 三语静态文本（`recon.limitations.*`）
- `PERSPECTIVES_OMITTED_COUNT_<N>` -> 动态模板（`recon.limitations.PERSPECTIVES_OMITTED`，`{count}` 参数）
- 前端 `localizeLimitation()` 统一处理两种形式

## 10. Provider 安全

- Provider body 只用于内存错误分类（HTTP status 判断/context length 检测）
- 非空 body 日志统一替换为 `[PROVIDER_BODY_REDACTED]`
- 空 body 日志为 `empty provider error body`
- 日志仅含：provider, model, status, stable code, requestChars, mode, correlationId
- Provider body 不进入 exception message 或 API response
- `stable code`, `status`, `correlationId` 保留

## 11. 前端展示

- `ReconstructionPage`：登录门控 + 编排，触发分析并展示结果
- `ReplayInputPanel`：单文件选择（替换而非追加），超限拒绝，单文件删除，clear all
- `AnalysisResultPanel`：仅渲染最终 Markdown 报告（`MarkdownContent`）
- `MarkdownContent`：渲染前对 `^(#{1,6})(?!#|\s)` 行补空格（跳过围栏代码块），修复 AI 输出 `##一、` 导致 `##` 字面显示的问题；归一化逻辑在 `utils/markdownHeadingNormalize.js`（happy-dom 下 DOMPurify 会剥掉 h1-h6，组件测试断言文本，语义由 utils 单测 + markdown-it 断言）
- `analysis` 末尾由后端统一追加三语免责句（AI复盘仅供参考 / This AI review is for reference only / Разбор ИИ приведён только для справки）
- limitation code 由后端合并去重写入报告；前端不再逐单元渲染 limitation 明细
- 文件交互：单文件选择（替换而非追加），超限拒绝，单文件删除，clear all
- Fetch Response body 只读取一次（text -> JSON.parse）
- JSON structured error 使用 `code`/`maxFiles`/`actualFiles`
- zh/en/ru 三语

## 12. 已知限制

- Custom auth scheme（非 Bearer/Basic/Digest）在 provider body 中不做特定脱敏——统一返回 `[PROVIDER_BODY_REDACTED]`
- Player path 暂无 prompt omission（prompt 构建内部无省略单位）
- 多文件/多视角 partition 已移除（2026-08-12）：AI 复盘仅单文件，Team 路径逐 context 单队调用；perspective 省略仍由 token 预算（mandatory/high-priority 原子写入）决定，省略单位进入 `truncatedUnitIds`/`omittedUnitIds`（prompt 构建内部；响应不再暴露单元计数）
- 不支持 drag-and-drop 文件上传
- 不要求真实 `.wotbreplay` E2E fixture
