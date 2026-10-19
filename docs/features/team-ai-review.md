# WotbTools：训练房 / 联赛 Team-Level AI 战术复盘

> 当前模式入口以 `BattleCategoryUtils.fromArenaBonusType` 为准：1=个人、2=团队、3..10 也映射为团队（包含 raw 7 评级战）。这是现行宽范围分类行为，不代表 3..10 均经协议证明为联赛；League 与 HoF 另有独立 policy。见 [AI 架构的分类限制](../architecture/ai-review.md#raw-模式分类的实现限制)。

## 概述

训练房和联赛回放通过 AI Review 进行 Team-Level 战术复盘。分析对象是整支录像者所在队伍，而不是录像者个人；每次请求只承载一场战斗的一个视角，同场双方各自独立分析，不合并。

复盘输出是结构化 `TeamAiReviewResult`，由后端做技术校验后通过 SSE `done` 事件一次性下发；前端按字段渲染，不要求模型输出固定章节。

## 1. 产品语义

- 录像者 raw team 1 → team 1 为分析对象
- 录像者 raw team 2 → team 2 为分析对象
- 未知 team → UNKNOWN
- 胜负三态：TEAM_WIN / TEAM_LOSS / DRAW_OR_UNKNOWN
- 平局/未知不压缩为失败
- PLAYER_FOCUSED（随机战斗）使用 FRIENDLY/ENEMY/UNKNOWN 标签
- TEAM_PERSPECTIVE（训练房/联赛）使用 dominant clan（主导军团）标签
- 同场双方视角各自独立分析，不得合并
- 录像者只用于确定视角，不被 AI 视为分析对象
- 单文件：一次请求 = 一场战斗的一个视角（perspective）；Team 路径逐 context 单队调用

## 2. 入口和分层（独立 ai-service，无 Dataset 依赖）

```
Replay selection（本地文件，不上传）
  -> 客户端 Rust/WASM 解析 → canonical replay facts → ClientAiReviewProjection
  -> AiReviewRequest = { locale, correlationId, battle, projection }（openapi#AiReviewRequest，required 恰为这四个字段）

AI（独立 ai-service，无 DB / MinIO / Business Backend 依赖）：
  ReplayPage Workspace -> AiReviewPanel
  -> POST /api/ai/reviews   (Content-Type: application/json, Content-Encoding: gzip)
  -> TX ingress /api/ai/** → WireGuard 私网 → Yecao ai-service
  -> AiReviewController.reviewJson：信封校验（locale 白名单 / canonical UUID correlationId）
     + ClientAiProjectionAdapter 装配 + BattleCategoryUtils.resolveScope 视角判定
  -> TacticalReviewHarness.analyzeWithPrior（个人）/ TeamReplayAnalysisService.analyzeTeam（团队）
   -> SSE 流式响应（call1_start / call1_done / evidence_done / call2_token / done / error；
      Team 在 done 一次性返回结构化 teamReview + teamPlayers）
```

- AI Review 只消费客户端 projection，不消费 Processing Dataset；服务器不解析回放，Business Backend 不承载也不代理 AI 请求。
- 前端没有维护状态卡，`ai_maintenance` 三语 key 无消费者；AI tab / 深链直接挂载 `AiReviewPanel.vue`，受登录门控与客户端投影可用性约束。
- 取消使用 `POST /api/ai/reviews/{correlationId}/cancel`；取消为尽力而为（best-effort），已完成、已取消或从未注册都视为目标状态已达成。

## 3. AI 输入 = client canonical AI projection

- 输入只有客户端投影：`projection` 由 `frontend/src/replay-local/ai/toClientAiReviewProjection.ts` 从 canonical replay facts 生成（上游 Agent WASM typed facets → `replay-local/canonical`），`ai-service` 侧由 `ClientAiProjectionAdapter` 装配成内存 `ReplayReconstruction`。
- 投影内容与 canonical 规则（`participants` / `perspective` / `clock` / `observationWindows` / `positions` / `turrets` / `prop3Health`·`healthEvents` / `damageNotices` / `objectives` / `limitations` / `unavailableEvidence`）见 [`docs/architecture/ai-review.md`](../architecture/ai-review.md) 的「投影内容（openapi#ClientAiReviewProjection）」。
- 服务端不解析回放，投影不携带包解码覆盖率：`coverage = null`，prompt 显示 `decodedPacketRatio=UNAVAILABLE`。
- 请求信封校验先于投影结构校验：locale 仅接受 `zh-CN` / `en-US` / `ru-RU`；correlationId 必须是 canonical UUID；请求体上限 16 MiB，`Content-Encoding` 仅接受 identity / gzip，gzip 解压后同样限 16 MiB；不支持的战斗类别返回 422。
- `done.capability` 是 request 级判定，不来自 Team 编排：只会是 `AVAILABLE` / `AVAILABLE_WITH_LIMITED_TIMELINE`；客户端时钟缺失或 projection 声明了 limitations 时为后者。`UNAVAILABLE` 保留在 wire enum 中但生产不产出，时间线不可用走 `AI_TIMELINE_UNUSABLE` 错误。

## 4. 团队证据（Team Evidence）

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

### 4.1 死亡时刻口径与阶段语义

- 业务死亡秒值只来自 settlement `#301 field24 lifeTime`；Playback/live reconstruction 仅用于播放、HP/动画和诊断，不能覆盖或回写 `PlayerResult`。EntityLeave、最后位置和 damage threshold 不是死亡 authority；无有效结算秒值时依赖死亡时刻的 prompt 证据必须 fail-closed。
- 阶段时间线行明确「至阶段末」存活人数（`阶段末friendlyAlive` / `至阶段末 我方存活`），system prompt 禁止把阶段末人数解读为「某时刻前已全灭」；prompt 注入双方逐车阵亡时间线（`DEATH_TIMELINE`，本队/对方 + 昵称 + 坦克 + X分XX秒）。

### 4.2 观测伤害抑制

事件流当前只逆向出 sub3 直接伤害；观测聚合与权威结算不一致时标记 `OBSERVED_DAMAGE_IS_PARTIAL`（条件触发：观测=权威时自动消失），prompt 层抑制观测数字、强制以 `AUTHORITATIVE_TEAM_RESULT` 为唯一可信口径；随机战交火段同步抑制「观测输出子集 + 百分比」。事件流覆盖达到 100% 后数字自动恢复输出。

### 4.3 位置知识状态契约（CURRENT / LAST_KNOWN）

FormationDepthEvidence / RelativeDepthHpEvidence 的阶段位置参考带 knowledge provenance（`PhasePositionReference`：accountId / team / x / z / knowledge / observedAtSec / ageSec，knowledge 复用 canonical `PositionKnowledge`）：

- **friendly actual combatant**（last position + 无 EntityLeave + 未阵亡）→ **CURRENT**（含 phase 内无新 PositionChanged 的 carry-forward，与 canonical BattleTimeline 同口径）；
- **enemy** → 最后观测 age ≤ canonical 当前阈值（`BattleTimelineBuilder.POSITION_GAP_SEC=5s`）→ **CURRENT**，否则 **LAST_KNOWN**；
- **exact 阵型/覆盖/距离数学只消费 CURRENT**：enemy LAST_KNOWN 不得满足 current-position completeness、不得作为当前 enemy centroid / enemyPositionPresence / enemyWeightedCoverageScore 坐标，也不生成 memberDist/referenceDist/relativeDepthM exact 距离；
- CURRENT 不完整时 FormationDepth fail-close 只输出 `POSITION_COVERAGE_INSUFFICIENT` + CURRENT presence + 独立信息段 `ENEMY_LAST_KNOWN_POSITION_REFERENCES`（account + region + observedAtSec + ageSec + knowledge=LAST_KNOWN，不伪装 current）；RelativeDepthHp 直接 fail-close 该 phase 的 exact 距离测量；
- **Region presence 基于 resolved 车辆位置 state**（每辆 CURRENT 车辆 +1，不是位置包数量）——同一车辆 100 个包 presence 仍 1，coverageCompleteness 与 presence 同一套 resolved state；
- **Actual Combatant 边界**：证据层只消费 battle_results #301（battle.players）成员位置；spectator/observer/camera/静态实体位置绝不进入战术位置覆盖。

### 4.4 ActualCombatantEntitySet（Canonical BattleTimeline 边界）

Canonical BattleTimeline 的 tactical FrameVehicle universe 从源头按 #301 过滤（实际参战实体集）：

- **建立方式**：`TeamEntityMapping.actualCombatantEntityIds(#301 账号集)`——#301 账号集 = battle.players 中 accountId > 0 的账号；实体集 = mapping.entitiesById 中 identity.usable 且 identity.accountId ∈ #301 账号集的实体；`BattleTimelineBuilder` 帧循环只对 `knownEntityIdsAt(t) ∩ actualCombatantEntityIds` 构造 FrameVehicle；空实体集 → fail-close `TIMELINE_MAPPING_INSUFFICIENT`（timeline 不进入 AI Review）。
- **必须源头过滤**：`BattleDeltaEngine` 以 `isEnemy = !friendly()` 判定敌方，team=null 的 spectator/camera 实体会被当作 enemy，产生假的 FIRST_KNOWN / ENEMY_LOST / ENEMY_REACQUIRED；POSITION_CHANGE / REGION_CHANGE 本身无 team gate——只在 FrameVehicle 层过滤才能堵死全部 delta 路径。
- **broad-roster 完整身份也不放行**：即使 #201 / ParticipantMapping / reconstruction participants 给 spectator 提供 accountId / team / nickname / 坦克元数据（usable identity），只要 account 不在 #301，仍从 tactical timeline 排除。
- **下游确认**：WorldSummary（#301 roster 为战术名单）、BattleDeltaEngine、EpisodeDetector、TimelineFocusWindowSelector、TeamAiContextCompiler / PersonalAiContextCompiler 全部只消费过滤后的 universe（compiler 输出不得出现 spectator 的 车辆#<eid> / account）；raw timeline.events 保留原始事件供必要协议用途。

### 4.5 战斗开始

`BattleStartResolver.resolve()` 返回 `BattleStartResolution`（IDENTIFIED / ESTIMATED / UNRESOLVED）。所有事件时间通过 `tryRelative()` 转换为 battle-relative（即开战后第 N 秒）。准备阶段事件被排除。
仅涉及敌方的伤害不得延长 Team phase。
### 4.6 战斗结束

`BattleEndResolver.resolve()` 按优先级：

1. `battle.durationS`（finite 且 > 0）
2. RoundFinishedEvent（battle-relative）
3. Scope-local evidence（该 perspective 的最后有效 position/damage）
4. UNKNOWN（返回 BATTLE_END_UNRESOLVED limitation，phases 为空）

仅涉及敌方的伤害不得延长 Team phase。

## 5. 地图和时间

- 地图名通过 `common/map_names.json` 映射为中/英/俄
- Tank 名通过 `common/tankopedia-tier{1..10}.json` 解析（单一数据源，按等级拆分）
- 地图坐标 500x500 canonical 米
- X/Z 为水平轴，Y 仅作高度
- 九宫格 region 1-9（随机战斗和团队赛共用）
- 坐标三态：VALID / CLAMPED / INVALID
- 不可信数据通过 `PromptDataQuoter.quote()` JSON 转义

## 6. Prompt 预算

### 6.1 三层优先级

| 层级 | 内容 | 保证 |
|------|------|------|
| P1 Mandatory | context type, analysisUnitId, perspective header, unitLimitations | 原子写入，超出预算抛 `AiPromptBudgetExceededException`（流内 `AI_PROMPT_MANDATORY_SECTION_TOO_LARGE`） |
| P2 High-priority facts | authoritative aggregate, observed aggregate, memberFacts, coverage | 原子写入，优先于 optional 证据保留 |
| P3 Optional | memberMovements, formation, battlePhases, engagements, keyEvents | 可按证据块整块省略，不影响 mandatory/high-priority facts |

### 6.2 预构建与原子写入

- Budget planning 使用 `AiTokenEstimator` 估算 token（保守系数 `codePointCount * 1.25`），输入硬上限由 `AiModelProperties.singleReplayMaxInputTokens` 配置（默认 940,000）。
- `appendRequiredBlock()` 保证 block 整体写入或抛出异常
- 被截断的 unit 加入 `truncatedUnitIds`
- `globalLimitations` 包含 `AI_INPUT_TRUNCATED`
- 总 token 预算由 `BudgetWriter.finish(estimator, maxInputTokens, ...)` 在写入时判定，超限标记 truncated
- Optional 截断不影响其他 perspective 的 mandatory/high-priority facts

## 7. Team 推理契约

### 7.1 推理顺序与因果质量

Team Call #2 必须先读权威事实，再按以下顺序内部推理，最后才生成结构化 JSON：

1. **读取权威事实**：区分权威结算/阵容与事件流观测子集，确认时间、人数、位置、伤害覆盖和结果来源。
2. **建立信息状态**：每个关键窗口写清当时 Known、敌方已确认信息和信息状态（CURRENT / LAST_KNOWN / UNSEEN）。
3. **识别剩余不确定性**：明确尚未确认的敌方数量、另一方向兵力、LAST_KNOWN 是否仍有效；UNSEEN 是没有证据，不是无人。
4. **评估目标义务**：结合基地归属、当前点数、点数增长、剩余时间、存活车辆、位置和可用火力，判断谁必须主动、谁可以等待、谁承担基地/时间压力。
5. **识别关键局部交战**：分析实际参与者、短时间内可补枪者、存活但无法影响该窗口者，以及外围提供有效侧射、信息或目标压力者。局部有效人数不是全队存活数。
6. **判定有效局部参与**：综合射界、地形/遮挡、time-to-influence、机动性、目标可用性、交叉火力、敌方固定、目标贡献和安全路径；距离只是证据（evidence），不是可支援性判定（supportability verdict）。
7. **追踪战术转换**：每个关键 episode 按 `State before → Change → Immediate local consequence` 展开；不要把时间接近的死亡事件自动串成因果 episode。
8. **追踪传播**：检查局部结果如何影响后续局部的火力、空间、固定、释放车辆、支援路径、信息状态和 objective obligation；证据不足时明确无法确认直接传播。
9. **把 HP/伤害/死亡用作下游验证**：HP、伤害、死亡是 position/decision 因果链的下游结果或验证信号，不是默认 episode 入口。
10. **选择训练目标**：每条建议使用 `Trigger → Decision target → Training goal`，来自本局已解释的状态和因果链；通常 2–4 条，简单局可更少，不得凑数量。
11. **仅在 episode 有据时选择个人候选**：重点复查与高贡献者只能从已展开的 tactical episode 选择，必须有实际 role/action 与 decision/execution 依据；没有证据就输出空数组。
12. **产出结构化 JSON**：只输出 `summary`、`episodes`、`trainingSuggestions`、`reviewFocus`、`highContributors`，不新增字段。

### 7.2 选择性完整表达

- 不逐秒复述时间线、不为格式凑段落，但被选中的关键 episode 要完整说明「发生了什么 → 当时知道什么 → 哪些车辆参与 → 为什么重要 → 如何影响下一阶段」。
- 信息（Information）必须说明它如何改变决策输入（decision input）；Objectives/点数、局部交战和多个局部之间的传播不能为了简洁省略。距离只能作为空间证据，不能单独判定脱节或支援价值。
- 目标状态改变行动义务时，应说明谁必须行动、谁可以等待。点数领先不自动等于必须进攻，点数落后也不自动等于立即冲锋。
- 正文优先级为团队战术分析、信息（Information）/目标（Objectives）、关键 episode、传播（propagation）、训练建议，之后才是可选的「重点复查」和「高贡献者」；两个个人 section 各自最多 0–2 人，缺少结构性证据（structural evidence）或可复查的决策/执行问题时应完全省略。
- 普通 7v7 约 1200–2200 字、复杂局约 2500–3500 字是软目标；Team Call #2 专用输出上限为 8192 tokens。
- 证据不足时保留 UNKNOWN，不把相邻死亡自动串成因果，也不把车型（vehicle class）当作战术角色（tactical role）。

### 7.3 Team Tactical Skill 模块

Team Call #2 通过 `AiPromptLibrary` 的模块化 include，按 INFORMATION/VISION → OBJECTIVES → LOCAL ENGAGEMENTS → POSITION/TEMPO → TEAM EXECUTION → HP/TRADES 注入六个紧凑的训练房/联赛推理模块：`information-vision`、`mode-objectives`、`local-engagements`、`position-tempo`、`team-execution`、`hp-trades`。它们是给 LLM 的经验性思考框架，不是后端战术 verdict；后端仍只提供 Canonical Timeline 和确定性证据。

- 先重建当时信息状态（CURRENT/LAST_KNOWN/UNSEEN）、基地/点数义务、空间结构和局部有效兵力，再解释动作与结果；信息更新必须继续追踪是否被解释并转化为行动。
- 局部不是封闭盒子：检查外部火力、固定、逼位、交叉和释放车辆造成的信息/火力/空间传播；分析谁创造了击杀条件，而不只看最后一炮。
- 复盘可观察执行（observable execution），不假设赛前战术计划，也不推断语音、call、指挥责任或心理原因；证据不足时跳过判断。
- `summary.primaryDiagnosis` 是本场最重要的结论，可以是关键成功因素、对手处理更好或没有明显确认错误，不要求制造问题。
- Strategic Prior 是阵容与可能性空间的战略基线，不是队伍实际计划；实际执行偏离它不能单独构成失误。
- `TeamAiContextCompiler` 复用 canonical timeline 额外输出 `OBJECTIVE_STATE_TIMELINE`，携带已解码的实时基地归属/捕获进度/实时点数；缺失不被当作零值，战术结论仍由 LLM 负责。
- 争霸赛使用约 +40 击杀价值、750–800 警戒区、800+ 高压力的经验梯度；攻防战使用约 100 秒完整捕获与 70–80 秒警戒区。阈值只影响 LLM 排序，不进入后端状态机。
- 模块同时提供 EN/RU 本地化替换锚点，`PromptRuleContractTest` 保证 include 展开和三语规则不漂移。`team-tactical-skill-v01-*.json` 是 prompt contract / static golden cases，只用于验证规则进入 prompt，不单独声称已验证实际 AI tactical behavior。

### 7.4 证据边界

- `NO_SIGNIFICANT_CONFIRMED_ERROR` 只表示当前可确认/可观察证据中没有确认的重大错误，不证明本场不存在任何错误。
- 证据覆盖不足时跳过不受支持的判断；不新增 backend tactical verdict、权威 `GOOD_TRADE`/`BAD_PUSH`/`HALF_COMMIT_ERROR` 标签或第二套 episode/harness。
- 回放不能证明语音、call、沟通或指挥责任时不得猜测；Strategic Prior 只是非实际赛前战术的战略基线。
- 不生成通用的米数阈值、固定时刻或 vehicle-class mandatory role；没有证据时不写具体点亮、侦察收益、地形/掩体/LOS 或玩家心理。

## 8. 结果契约（Result Contract）

`POST /api/ai/reviews`（由独立 `ai-service` 承载）返回 **SSE 流式**（`text/event-stream`，无同步 JSON 响应），`AiReviewController` 直接向 `SseEmitter` 写入（自定 JSON event，`data` 为 JSON）：

| event | data | 说明 |
|-------|------|------|
| `call1_start` | `{}` | Call #1（赛前战略基线）开始 |
| `call1_done` | `{}` | Call #1 结束（真实发起调用时必发，无论成败） |
| `evidence_done` | `{}` | 后端证据分析完成（随机战 harness 与团队路径均发射；团队路径在首轮 Call #2 前补发，前端阶段指示随之推进） |
| `call2_token` | `{"delta":"..."}` | 主复盘 token 增量；仅个人路径产生，团队结构化路径不产生 |
| `done` | `{"analysis":...,"preBattleSection":...,"capability":...,"teamReview":...,"teamPlayers":...}` | 终点事件；五个 key 必须全部存在，null 按 wire contract 保留 |
| `error` | `{"id":"...","errorCode":"AI_..."}` | 流中途失败（稳定错误码；`id` 复用 `correlationId`） |

`done` 的两个分支：

- **个人**：`analysis` 为随机战复盘正文（末尾由后端追加三语免责句），`teamReview` 为 null，`teamPlayers` 为空数组。
- **团队**：`analysis` 为 `teamReview.summary.verdict` 的兼容文本，`teamReview` 非 null，`teamPlayers` 为 authoritative roster 生成的 `playerKey` → `displayName` / `tankName` 映射；LLM 结构化 JSON 只返回稳定 `playerKey`，前端展示和复制使用该映射。

`capability` 只有 `AVAILABLE` / `AVAILABLE_WITH_LIMITED_TIMELINE` 由 producer 产出；`UNAVAILABLE` 保留在 contract 中但不出现于 `done`。

### 8.1 Team 结构化结果

`done.teamReview` 是 `TeamAiReviewResult`：

| 字段 | 约束 |
|---|---|
| `summary.verdict` / `summary.primaryDiagnosis` | **必填、非 null、非空白字符串，长度 ≤ 4000**；`primaryDiagnosis` 是本场主判断摘要，不是独立的问题清单。缺失/空白由 `TeamAiReviewResultParser` 记为 INVALID_FIELD；最低 contract 不成立时触发一次 recovery，不接受 null 或空字符串 |
| `episodes` | 最多 6 条；`id` / `title` / `analysis` 必填且非空；`startSec` / `endSec` 可为 null，非 null 时 `endSec >= startSec`；`playerKeys` 最多 8 个且必须来自当前 roster；`id` 唯一 |
| `trainingSuggestions` | 最多 12 条；`title` / `content` 必填；`episodeId` 必须为 null 或引用已存在的 episode |
| `reviewFocus` | 最多 2 条；`playerKey` 必须来自 roster，`episodeId` 必须存在，`reason` 非空 |
| `highContributors` | 最多 2 条；约束同 `reviewFocus` |

所有数组必须存在，可为空。Markdown 只能出现在字段值内部；页面标题和层级由前端控制。

### 8.2 技术校验与 recovery

- Call #2 使用 provider `response_format=json_object`（`AiChatRequest.responseFormat=JSON_OBJECT`；Player / Pre-battle / Harness 保持 TEXT）。
- `TeamAiReviewResultParser` 只校验 DTO、字段类型、数量上限及 roster/episode 引用，不判断战术结论是否正确。
- 局部可安全修复的 optional reference 由 backend 确定性 salvage：超限 episodes 截断、无效 optional reference 丢弃、optional array 截断、root/nested unknown field 不进入最终 DTO；形成最低可用 contract（`summary` + `episodes`）时直接返回，不触发额外模型调用。
- 只有 primary 空响应、不可解析 JSON、非 object，或规范化后仍缺少最低 contract（`summary` 的 `verdict`/`primaryDiagnosis` 与 `episodes` 根数组）时，才基于同一 canonical battle context 发起恰好一次 `SINGLE_TEAM_BATTLE_RECOVERY`；失败 completion 不传回模型，也不把 Markdown 或部分 JSON 直接展示。recovery 指令跟随允许语言（中文、English、Русский），复用同一 canonical contract。
- recovery 仍失败时返回 `AI_REVIEW_SCHEMA_FAILED`；provider 原始错误继续沿用原错误码。成功 recovery 的汇总日志和 token 指标包含 primary 与 recovery 两次调用的累计值。
- 日志不记录 prompt、completion 或 review 正文；对应事件和低基数指标见 `docs/operations/observability.md`。

### 8.3 流式与错误

- `AiChatGateway.stream` 单次尝试不流内重试，`AI_TIMEOUT` / `AI_CANCELLED`（correlationId cancel）语义与同步 `chat()` 一致；同步测试路径委托流式实现（`AiReviewStreamListener.NOOP`）。
- 个人路径 Call #2 自由文本默认关闭 thinking（`AI_THINKING_ENABLED_CALL2` 默认 `false`）——DeepSeek 推理模式下 `reasoning_content` 先流、content 末尾一次性到达会破坏逐段流式；`SpringAiChatGateway` 对单块 >512 字符的 delta 按句切分（≤128 字符/片、间隔 ~20ms、上限 512 片）兜底，保证前端在 `done` 前持续出字。
- 团队结构化路径不产生 `call2_token`，前端在 `done` 一次性渲染。
- request-envelope 校验（`INVALID_AI_REQUEST` / `UNKNOWN_LOCALE` / `INVALID_CORRELATION_ID` / `DUPLICATE_CORRELATION_ID` / `UNSUPPORTED_BATTLE_CATEGORY` / `AI_REQUEST_TOO_LARGE` / `UNSUPPORTED_CONTENT_ENCODING`）与 worker 池饱和（`AI_REVIEW_BUSY`）在返回 `SseEmitter` 前由 `@ExceptionHandler` 映射 HTTP 400 / 409 / 413 / 415 / 422 / 503。
- worker 启动后的运行时/业务失败（`NO_BATTLE_DATA` / `PERSPECTIVE_TEAM_*` / `TEAM_FEATURES_UNAVAILABLE` / `AI_TIMELINE_UNUSABLE` / `AI_NOT_CONFIGURED` / `AI_PROMPT_MANDATORY_SECTION_TOO_LARGE` / `AI_EMPTY_RESPONSE` / `AI_REVIEW_SCHEMA_FAILED` / `AI_UPSTREAM_UNAVAILABLE` / `AI_TIMEOUT` / `AI_CANCELLED` 等）经 `error` 事件传达（HTTP 已 200）；客户端断开时终止上游调用，不向已断开的连接写入。

## 9. 质量验证（0-token CI + 手动真实回放）

- **确定性 prompt 契约测试**校验三语推理锚点、推理顺序、未知状态、目标义务、局部参与、传播、下游验证、结构化输出边界和反 settlement-shortcut 规则；默认 CI 不调用模型，保持 0 provider token。
- **离线 harness**（`TeamReplayOfflineEvalHarnessTest`）用冻结的客户端投影夹具（`common/fixtures/replay-facts/*.json.gz`）走 canonical timeline、team context、prompt 和 grounding facts 链，只校验证据类型与结构性 gold constraint。gold 不包含标准 review，也不会发送给模型。
- `team-tactical-skill-v01-*` 与 `TeamTacticalSkillScenarioContractTest` 只证明 prompt contract，不证明真实 LLM 行为；synthetic contract PASS 不代表真实模型语义 PASS。
- 手动 benchmark 使用非默认 `ai-live` 的 `TeamReplayQualityBenchmarkRunner`：必须显式设置 `-Dai.quality.enabled=true` 并选择 case/all，提供 `AI_API_KEY` 后才会创建 provider gateway；不注入 synthetic scenario，运行次数默认 1。报告包含 model / prompt version / git SHA / generatedAt / runsPerCase、契约结果、确定性 gold/lexical 分数和可选 baseline 对比；不持久化 prompt、API key 或用户 token usage。它不进入普通 `mvn test`、默认 CI 或 PR 合并条件。
- 手动 live 行为评估使用 `TeamTacticalSkillLiveBehaviorEvalTest`：`@Tag("ai-live")` 且需要 `-Dai.tactical.live.enabled=true`，复用现有 DeepSeek gateway 与 Team Call #2 JSON contract，按 A–H 的明确 contract checks 解析最终输出，生成 `target/ai-eval-report/team-tactical-skill-live-report.{md,json}`。真实 provider evaluation 具有 token 成本和模型随机性，永远不进入默认 CI。
- 真实 `.wotbreplay` 质量仍通过显式手动 KSR / benchmark 回归确认，不能用 synthetic fixture 代替。

## 10. 限制（Limitations）

### 全局（Global，prompt 内容中的全局限制行）

- `AI_INPUT_TRUNCATED`

### 逐单元（Per-unit，prompt 中 `unitLimitations=[...]` 头部）

- `DUPLICATE_TEAM_MEMBER_ACCOUNT_IDS`
- `TEAM_MEMBER_ENTITY_UNMAPPED`
- `TEAM_MEMBER_POSITION_UNAVAILABLE`
- `BATTLE_END_UNRESOLVED`
- `OBSERVED_DAMAGE_IS_PARTIAL`
- `OPPOSING_LINEUP_UNAVAILABLE`

### 注入规则

- `globalLimitations` 与 `unitLimitations` 分开注入，不互相复制
- Per-unit limitation 绑定 `analysisUnitId`
- 限制代码只作为内部字段传给模型；用户正文不得出现这些机器标签

## 11. Provider 安全

- Provider body 只用于内存错误分类（HTTP status 判断/context length 检测）
- 非空 body 日志统一替换为 `[PROVIDER_BODY_REDACTED]`
- 空 body 日志为 `empty provider error body`
- 日志仅含：provider, model, status, stable code, requestChars, mode, correlationId
- Provider body 不进入 exception message 或 API response
- `stable code`, `status`, `correlationId` 保留

## 12. 前端展示

- `ReplayWorkspace.vue`：工作台编排层（五种能力的唯一载体），capability=ai 的切换 / 深链直接挂载 `AiReviewWorkspacePane.vue` → `AiReviewPanel.vue`（登录门控 + 客户端投影可用性），触发分析并展示结果。
- AI Review 权限：已登录且 realm role 含 `wotbtools-user` 或 `wotbtools-admin`；登录成功但缺 role 时渲染显式权限态，不静默隐藏入口。投影未就绪时显示准备中/失败状态，失败可触发重建投影。
- `FileDrop.vue`：全站唯一的文件投放面（单文件选择替换而非追加），超限拒绝，单文件删除，clear all。前端不支持 drag-and-drop 文件上传。
- `AnalysisResultPanel.vue`：个人路径渲染最终 Markdown 报告；团队路径按 `summary` / `episodes` / `trainingSuggestions` / `reviewFocus` / `highContributors` 分区渲染，空的可选区块不渲染；身份使用 `done.teamPlayers` 的 authoritative 映射，缺失时显示未知玩家/未知坦克。
- `MarkdownContent`：渲染前对 `^(#{1,6})(?!#|\s)` 行补空格（跳过围栏代码块），避免 AI 输出 `##一、` 时 `##` 字面显示；归一化逻辑在 `utils/markdownHeadingNormalize.js`，语义由 utils 单测 + markdown-it 断言覆盖。
- 个人路径 `analysis` 末尾由后端统一追加三语免责句（AI复盘仅供参考 / This AI review is for reference only / Разбор ИИ приведён только для справки）；团队结构化结果不追加。
- 流式阶段按 `call1` / `evidence` / `call2` 推进；失败分类覆盖登录/权限、AI 服务不可达、繁忙、超时、provider 失败、返回格式异常、已取消，可重试的失败给「重试」，取消只给中性提示并展示/复制 diagnostic id。
- Fetch Response body 只读取一次（text -> JSON.parse）；SSE 事件经 `aiReviewSse` runtime guard 校验，畸形事件被忽略。
- zh/en/ru 三语。

## 13. 已知限制

- Custom auth scheme（非 Bearer/Basic/Digest）在 provider body 中不做特定脱敏——统一返回 `[PROVIDER_BODY_REDACTED]`。
- AI 复盘仅单文件；P3 optional evidence 可整块省略，省略/截断集合只在 prompt 构建内部（`truncatedUnitIds`/`omittedUnitIds`），响应不暴露单元计数。
- 不要求真实 `.wotbreplay` E2E fixture；synthetic/golden case 只锁定 prompt 与结构契约，不证明真实模型语义质量。
