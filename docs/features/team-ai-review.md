# WotbTools：训练房 / 联赛 Team-Level AI 战术复盘 — 设计文档

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
  -> SSE 流式响应（call1 / evidence / call2 / autopsy 阶段事件 + call2_token 主复盘增量）
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

- 部分回放的 `battle_results` 缺少死亡时刻字段（`deathTimeMillis` 为 0），系统回退事件流估算（damage threshold → entity leave → position）。`BattlePhaseSummary.deathSourceLabel()` 输出 `DEATH_SOURCE=权威结算 | 事件流估算 | 未知`，prompt 禁止把估算数据标注为权威。
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
2. BattleEndedEvent（battle-relative）
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
| `autopsy_start` | `{}` | Team Autopsy 开始 |
| `autopsy_done` | `{}` | Team Autopsy 结束 |
| `done` | `{"analysis":"...","preBattleSection":"..."}` | 全部完成；`preBattleSection` 为 null 时输出 JSON null |
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

**Natural Coach Mode + Factual Consistency Guard（PR #103 之上，2026-08）**：
- Team Call #2 输出改为 JSON envelope（`primaryDiagnosis` / `reviewMarkdown` / `claims`，
  由 `TeamReviewEnvelopeParser` 解析）；`done.analysis` 仍为 `reviewMarkdown`（用户看到的
  完整自然语言复盘，主标题 `## 团队复盘`），structured 字段为内部 grounding 契约，不进正文。
- **claims 机器字段（Review B1-2，三语通用）**：涉及数值/时间/位置/玩家事件的 claim 携带
  `timeSec`（battle-relative 秒）/ `region`（1-9）/ `count`（车辆数）/ `subject`（玩家昵称或坦克名）/
  `value`（存活变化机器格式如 `7v7 -> 4v6`）/ `claimType` / `side`（FRIENDLY/ENEMY）/
  `countSemantics`（EXACT/AT_LEAST/SUBSET）/ `knowledge`（CURRENT/LAST_KNOWN）；validator 优先按机器字段做语言无关校验，
  正文自然语言（ZH/EN/RU）仅作兜底；`region + count` 为精确语义（exact），at-least/subset 标记放行下界/子集。
- **Evidence Binding（Review Blocker B1，最终）**：claims 的 `evidenceIds` 必须真正绑定支撑它的证据——
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
