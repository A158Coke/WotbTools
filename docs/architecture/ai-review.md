# AI Review 架构（随机战双 Call / 团队复盘）

> 输入边界（2026-10，A158Coke/WotbTools#447）：**服务器没有 parser**。浏览器用锁定版本的上游 Agent WASM 解析回放，
> 经 WotbTools canonical replay facts 产出 **client canonical AI projection**，以 `AiReviewRequest`（gzip）提交给
> Yecao 独立 `ai-service`；ai-service 由 `ClientAiProjectionAdapter`（`wotb-core` `replay/projection`）把投影装配成
> 内存 canonical 事件流（`ReplayReconstruction`），再按视角判定分派到 PLAYER_FOCUSED / TEAM_PERSPECTIVE 生产链。
> 详见下文「生产链总览」与「AI 复盘输入：client canonical AI projection」。部署边界见 `docs/operations/ai-service.md`。

## 生产链总览（2026-10 契约收敛后）

`POST /api/ai/reviews` → `AiReviewController.reviewJson`：限额 gzip 解压（传输体与解压后都 ≤ 16 MiB）→
请求信封只校验 `locale` 白名单（`zh-CN` / `en-US` / `ru-RU`，未知值 400 `UNKNOWN_LOCALE`）与 canonical UUID
`correlationId`（400 `INVALID_CORRELATION_ID`）→ `ReplayFactsCodec.battleFromJson` / `projectionFromJson` →
`ClientAiProjectionAdapter.toReconstruction` + `enrichBattle` → `BattleCategoryUtils.resolveScope` 判定视角：

- `RANDOM` → `PLAYER_FOCUSED`；`TRAINING` / `TOURNAMENT` → `TEAM_PERSPECTIVE`；`UNKNOWN` → HTTP 422
  `UNSUPPORTED_BATTLE_CATEGORY`（在返回 `SseEmitter` 之前）。

对应生产链：

| 视角 | 编排 | SSE `done` 载荷 |
|---|---|---|
| PLAYER_FOCUSED | `TacticalReviewHarness.analyzeWithPrior`（Call #1 `PreBattleStrategicService` → `EvidenceSkillEngine` 确定性证据 → `TacticalReviewPromptBuilder` → Call #2） | `analysis` / `preBattleSection`（`teamReview` 为 `null`） |
| TEAM_PERSPECTIVE | `TeamReplayAnalysisService.analyzeTeam` → `analyzeTeamContexts`（timeline hard gate）→ `callSingleTeamContext` → `callStructuredTeamReview`；contract 失败时恰好一次 `recoverTeamReview`（`SINGLE_TEAM_BATTLE_RECOVERY`） | 结构化 `teamReview`（`TeamAiReviewResult`）+ 权威 roster 派生的 `teamPlayers` |

SSE 事件集合固定为 `call1_start` / `call1_done` / `evidence_done` / `call2_token` / `done` / `error`
（`contracts/http/openapi.yaml` 的 `x-sse-events`）。生产链没有 autopsy 阶段事件，也没有第三次模型调用。

## Team AI Review v0.6：推理顺序与因果边界

v0.6 是 prompt 层的战术推理深度升级，保持 v0.5 `TeamAiReviewResult`、SSE/API、
解析器和前端渲染契约不变。`TeamAiPromptBuilder` 继续提供现有 canonical facts、timeline、
team context 和 deterministic evidence；本版本不新增 LLM call、Team Autopsy、后端战术语义
裁判或第二个 episode 模型。

Team Call #2 的内部顺序固定为：权威事实 → Information state / Remaining uncertainty →
objective obligation → pivotal local engagements → effective local participation →
tactical transition → propagation → HP/damage/deaths downstream validation → training targets
→ episode-grounded individual candidates → v0.5 structured JSON。Information 要形成
`Known → Remaining uncertainty → New observation → reduced uncertainty → Decision impact`；
`UNSEEN` 只代表没有证据，不代表空路或没有敌人。

局部参与以实际影响窗口的能力判断，综合 line of fire、遮挡、time-to-influence、机动性、目标、
交叉火力、敌方固定、目标贡献和安全路径，距离仅是证据。每个 episode 都要解释
`State before → Change → Immediate local consequence → Propagation`；相邻死亡不能自动构成
因果链，HP/伤害/死亡应验证而不是替代局部决策与传播分析。目标状态必须说明谁承担行动义务、
谁可以等待；训练建议必须绑定 `Trigger → Decision target → Training goal`。重点复查和高贡献者
只能来自有实际 role/action 与 decision/execution 依据的已展开 episode，没有证据则省略。

这些规则由三语 prompt contract tests 做确定性文本守护；默认 CI 不调用 provider。真实回放的
KSR / provider benchmark 仍是显式手动回归，不把 synthetic contract PASS 当作模型语义质量证明。

## Team AI Review v0.5：结构化结果契约

Team Call #2 返回 `TeamAiReviewResult`：`summary`、最多 6 个 `episodes`、
`trainingSuggestions`、最多 2 个 `reviewFocus` 与最多 2 个 `highContributors`。
Team Call #2 专用输出上限为 `wotb.ai.team-review-max-output-tokens`（默认 8192，
`AI_TEAM_REVIEW_MAX_OUTPUT_TOKENS`），effective = min(global, team)，同时作用于 prompt 预算与请求；
这是容量配置而非质量判定（player Call #2 沿用 global）。
Backend 只负责 JSON、类型、数量上限、roster/episode 引用和字符串边界；不判断战术正确性，
也不再追加 settlement-only Team Autopsy 或第三次模型调用。SSE `done` 事件携带 `teamReview`，
并携带由 authoritative Team roster 生成的 `teamPlayers`（`playerKey` → `displayName` / `tankName`）映射；
前端按固定组件层级渲染并用该映射显示身份，Markdown 只允许出现在字段值内。
技术层面的 schema 校验与确定性 salvage / normalization 见「Team Call #2 结果契约」。

## Team AI Review 稳定性契约：structured JSON + single recovery

Team Call #2 只接受完整、技术上有效的 `TeamAiReviewResult` JSON。解析器只判断 JSON、类型、
数量上限和 roster/episode 引用，不判断战术结论是否正确，也不把部分 JSON 或 Markdown 暴露给用户。

初始 completion 不是有效 contract 时，使用 canonical battle context 执行恰好一次
`SINGLE_TEAM_BATTLE_RECOVERY` JSON 调用；不会把失败 completion 传回 recovery，也不会进行多轮重试。
recovery 成功则返回结构化结果；两次均不满足 contract 时返回 `AI_REVIEW_SCHEMA_FAILED`。
provider、超时、取消等上游错误继续使用各自原始错误码。

初始失败、recovery 触发/失败和最终完成均写入不包含 prompt、原始 completion 或 review 正文的
低基数 WARN/INFO 结构化日志，并记录可用的累计 token metadata。SSE `done` 事件只携带结构化
`teamReview`（个人复盘仍沿用 `analysis`）。

## Team Call #2 结果契约（`TeamAiReviewResult` 技术 schema + 确定性 salvage）

Contract 失败处理只有下面两条确定性路径，二者共同构成本节描述的**当前生产行为**
（`TeamReplayAnalysisService.callStructuredTeamReview` + `TeamAiReviewResultParser`）：

- **技术 schema 校验**：`TeamAiReviewResultParser.parse(output, rosterPlayerKeys)` 只判断 JSON 是否合法、
  DTO 字段类型、数量上限（`MAX_EPISODES=6`、`MAX_REVIEW_FOCUS=2`、`MAX_HIGH_CONTRIBUTORS=2`、
  `MAX_TRAINING_SUGGESTIONS=12`、单 episode `MAX_PLAYER_KEYS_PER_EPISODE=8`）与 roster / episode 引用是否有效；
  不判断战术结论是否正确，也绝不改写战术文本（解析器 javadoc：「never changes tactical text」，只确定性移除或
  清空不受支持的 optional reference）。
- **确定性 salvage / normalization**：可选字段与可选引用（`dropOptional`）、可安全规范化的文本与整数
  （`salvageText` / `salvageInt`）、超限数组的 cardinality 截断（`Normalization`，如 `summary_defaulted` /
  `*_truncated`）都被确定性过滤或规范化；root / nested unknown field 不进入最终 DTO。规范化后仍满足最低
  contract（`summary` + `episodes`）时**直接返回结果，不触发额外模型调用**：`ParseResult.usable()` 为真且
  `ParseResult.normalized()` 为真时走 `primary.normalized()` 分支，记 `logContractSalvage` 低基数日志并
  `countValidationAttempt("salvaged")`。
- **恰好一次 fresh recovery**：只有 primary 完全不可用（空输出、非法 JSON、非 object）或规范化后仍缺
  `summary` / `episodes` 最低结构时，才基于 canonical battle context 执行一次
  `SINGLE_TEAM_BATTLE_RECOVERY`；失败 completion 不回传，也不降级为 Markdown / 纯文本；两次均不满足 contract
  → `AI_REVIEW_SCHEMA_FAILED`，provider / 超时 / 取消继续沿用各自原始错误码。
- **authoritative response source**：`callRaw()` 以 `AiChatResponse.completionText()` 为唯一权威完整响应
  （Gateway 契约：callback 是流式增量 progress，正常结束时 `completionText` 为聚合后的完整文本；失败一律抛
  `AiUpstreamException`，绝不返回 partial）；每次 attempt 独立 `stream()` 调用，不共享 buffer。

低基数指标为 `wotb_ai_team_review_schema_failure_total{reason,path_class}`、
`wotb_ai_team_review_repair_total{result=triggered|started|success|failed}` 与
`wotb_ai_team_review_validation_attempt_total{result=pass|salvaged|schema_invalid}`；严禁记录 prompt、completion、回放内容或
用户/玩家标识。事件与日志清单见 `docs/operations/observability.md`。

## 质量验证分层（contract tests / offline harness / 手动 benchmark）

质量验证分三层：普通 deterministic contract tests（0 token）、真实 `.wotbreplay` offline harness，以及显式手动 real-provider benchmark。offline harness（`wotb-ai` `TeamReplayOfflineEvalHarnessTest`：冻结的客户端投影夹具 `ReplayFactsFixtures` → `TeamContextBuilder.buildSingleTeamContext` → `BattleTimelineBuilder` → `TeamAiPromptBuilder` → `TeamGroundingFacts`）只验证 `evidence_required` 证据可用性，不判断模型是否找到了预期结论；benchmark 的 gold hit/miss 是 report-only lexical preflight，不能替代语义裁判。

`AiEvalHarnessTest` 的 synthetic A–H cases 仍用于 prompt/rule contract；synthetic PASS 不等于真实回放质量 PASS。`TeamReplayQualityBenchmarkRunner` 是非默认 `ai-live` runner：必须显式设置 `-Dai.quality.enabled=true`、`-Dai.quality.case=...` 或 `-Dai.quality.all=true`，并提供 `AI_API_KEY`；`ai.quality.runs` 默认 1。runner 不把 gold 或 evaluation scenario 放进生产 prompt，输出 `target/ai-eval-report/team-replay-quality-report.{json,md}`，只保存低基数 metadata、确定性检查、维度分数和最终 review。该 runner 原本与 test-only `TeamQualityShortcutValidator` 一起消费 legacy envelope（`primaryDiagnosis.evidenceBasis` 等）；两者与 legacy envelope 已随 2026-10 legacy 契约收敛删除，runner 已迁移到 v0.5 `TeamAiReviewResultParser` 结构化解析：评分维度改为 `contract`（parser 可用性 + 是否发生确定性 salvage）、gold `must_notice`/`must_not` 预检与 9 个 lexical 维度，报告列由 `shortcuts` 改名为 `contract`（能力变化与未验证项见 `docs/operations/ai-evaluation.md`）。

> 开发入口见 `docs/DEVELOPER_GUIDE.md`；Team-Level 复盘产品设计见 `docs/features/team-ai-review.md`。
> 权威结算 vs 事件流观测的数据边界见「AI 分析范围边界」与「Team Perspective 语义」两节。
> 生产状态：AI 证据只消费 canonical facts（AFFIRMED）；UNKNOWN 为合法内部状态，不得猜成 0/无事件/静止/满血（选用例见 prompts 与 `PlayerEvidenceFormatter`）。

## AI Review Harness（随机战双 Call）

随机战个人复盘在满足条件时走两 Call Harness（`TacticalReviewHarness`），否则自动降级到旧单 Call 路径：

1. **Call #1（Pre-Battle Strategic Prior）**：`PreBattleStrategicService` 只输入地图名 + 双方阵容（坦克名/车种/等级/国家/单车血量）+ 双方总血量（tankopedia base 求和；仅当进场满血被回放证明时改用实测含加成值）+ `common/tank_tactical_profiles.json` 战术 Profile，严格剥离战绩字段（伤害/击杀/存活/胜负/阵亡顺序）；`preferredPlans` 契约要求分阶段（开局/中期/残局）输出；结构化 JSON 输出由 `PreBattleStrategicParser` 解析，失败返回 null 降级。
2. **Backend Evidence Skills**（`com.wotb.core.replay.evidence`）：`HpMomentumSkill` / `EngagementTradeSkill` / `LocalSupportSkill` / `DeathCascadeSkill` / `RouteSkill` / `TeamSeparationEvidenceSkill` / `PlayerSeparationEvidenceSkill` / `CriticalWindowSkill`，输出确定性 `AiEvidence`（含 confidence / provenance / priority），只描述「发生了什么」与确定性派生测量，不做战术裁决。
3. **Call #2（Tactical Review）**：`TacticalReviewPromptBuilder` 按 Priority Bookends 组织 Prompt（BATTLE SNAPSHOT（含结算、死亡时间线、**走位/区域时间线与压缩移动段**）→ STRATEGIC PRIOR → **TACTICAL TIMELINE（Canonical BattleTimeline 的 Episode 化主叙事，见 `docs/architecture/battle-timeline.md`；`PersonalAiContextCompiler` 渲染 BEFORE/EVENTS/AFTER/TACTICAL_CHANGE + 你 hp/pos + 敌方已知/未知分布）** → TOP PIVOTAL WINDOWS（≤8）→ PHASE → **对炮明细（ENGAGEMENTS·逐次交火）** → EVIDENCE → CRITICAL DECISION WINDOWS（≤8 完整证据）→ TASK），预算不足时按相关性裁剪（timeline 段在 evidence/phases/points 之后、窗口细节之前裁剪），书签段永不裁剪。
   - **Canonical Timeline hard gate**：随机战 harness 在录像者解析后立即构建 `BattleTimeline`（battle-relative 时钟：IDENTIFIED / ESTIMATED（`BattleEnded.raw − duration`）/ UNRESOLVED→拒绝）；无法构建 → `AI_TIMELINE_UNUSABLE` 业务错误，**不再 settlement-only fallback 调用 AI**；`PlayerReplayAnalysisService.analyzePlayerOrFallback` 无重建/录像者未解析同样拒绝。团队 prompt 经 `TeamAiContextCompiler` 注入双方对称 timeline 段。


## Backend Evidence Boundary（PR #103 架构收口）

> 核心原则：**Backend 负责把战局事实整理到 LLM 能可靠理解的程度，但停在战术判断之前。**

数据流：

```
client canonical AI projection（`AiReviewRequest.projection`）
  ↓  ClientAiProjectionAdapter（结构校验 + 装配 canonical 事件流）
Canonical BattleTimeline
  ↓
Deterministic Evidence Extraction（Backend Evidence Skills）
  ↓
LLM Tactical Interpretation（Call #2）
  ↓
Recommendation / Natural Review
```

### 三层职责

| 层 | 谁负责 | 回答 | 例子 |
|---|---|---|---|
| **Layer 1 — Canonical Facts** | 客户端 canonical facts（投影）+ Backend（Timeline） | 发生了什么 | 时间 / HP / 伤害 / 阵亡 / 存活 / 位置 / 移动 / 结算 / roster |
| **Layer 2 — Deterministic Derived Evidence** | Backend（Evidence Skills） | 根据这些事实可以确定性计算出什么 | 109–128s 3:1 / 7v7→4v6 / HP swing / cluster 距离 / 静止占比 / 局部敌我数量 / 已知/未知敌车数 / 死亡连锁 / 进入控制点区域窗口 / salience ranking |
| **Layer 3 — Tactical Interpretation** | LLM（Call #2） | 这些事实意味着什么 | 拖延 / 脱节 / 图控 / 交换是否值得 / 主要问题 / 训练建议 |

### 核心判断标准

> 如果同一组 replay facts，两个高水平 WoT Blitz 教练可能合理地产生不同判断，那么这个结论不应该成为 Backend authoritative label。

- Backend：「2+5 分组，两个 cluster 相距 160m。」✅ 允许
- Backend：「这次分兵是正确图控。」❌ 禁止（交给 LLM）
- Backend：「109–128s 本方3死、对方1死。」✅ 允许
- Backend：「这里的主要错误是没有止损。」❌ 交给 LLM
- Backend：「某成员 25 秒内与主要友军集群保持 >150m 距离，期间承伤900。」✅ 允许
- Backend：「该成员严重脱节。」❌ 交给 LLM

### Backend 可以做什么（不是 tactical judgement）

1. **原始事实**：时间 / HP / 伤害 / 承伤 / 阵亡 / 存活 / 玩家/车辆 / team / position / movement / observed/unknown / capture event / battle result / roster / vehicle class / authoritative settlement。
2. **确定性计算**：减员窗口与人数比（如 109–128s 3:1、7v7→4v6）、HP 差变化、damage dealt/received、两车/两 cluster 距离、distance growth、stationary ratio、observed enemy count、unknown enemy count、cluster member count、friendly/enemy nearby count、区域内车辆出现、region 移动、窗口内阵亡。
3. **中性结构分类**：`OPENING_SPREAD`（开局阶段空间分离结构）、`DEATH_CLUSTER`、`FOCUS_WINDOW`、`FORMATION_CLUSTER`、`SEPARATION_WINDOW`、`LOCAL_NUMBERS_CHANGE`、`CONTROL_REGION_ENTRY_WINDOW`。
4. **Salience / ranking**：哪个 HP swing 最大、哪个死亡窗口人数 swing 最大、哪几个窗口最值得送 LLM、`EvidencePriority = NORMAL/IMPORTANT/CRITICAL`——表示「Prompt 输入优先级 / 数据变化显著程度」，**不是**「战术上正确/错误程度」。

### Backend 禁止做什么

Backend Evidence 层不得直接输出：正确/错误打法、拖延、无效拖延、脱节、失败合流、图控成功、拿视野、侦察行为、合理/错误转场、bad trade、favorable tactical trade、misplay、team mistake、好的/没有支援、无掩护、卡点、守点、谁从谁的行为中获利、tactical benefit/payoff、tactical intent。

禁止用 `if A && B && C → TACTICAL_VERDICT` 的规则引擎取代 LLM。

> **第二轮（2026-08）**：feature 层 `EngagementOutcome`（`FAVORABLE/UNFAVORABLE/EVEN`，原 `dealt > received * 1.25 → 有利/不利/均势` 判定）已整体移除——`EngagementSummary`/`TeamEngagementSummary` 不再携带 `outcome` 字段，`DefaultPlayerBattleFeatureExtractor`/`TeamEngagementExtractor` 不再计算交换好坏（`ENGAGEMENT_OUTCOME_RATIO` 删除），三个渲染点（`PlayerEvidenceFormatter` 交火段 / `TacticalReviewPromptBuilder` 对炮明细 / `TeamEvidenceFormatter` TEAM_ENGAGEMENTS 段）不再输出「结果: 有利/不利/均势」。交火段只保留确定性数字（damageDealt / damageReceived / 存活变化 / 局部人数 / HP swing / 集火目标 / 目标切换），「交换是否值得」（bad trade / favorable trade）与拖延/脱节/图控一样由 LLM 综合多事实判断。

### Evidence 输出规范

- 复用 `AiEvidence`（type / startSec / endSec / entities / numbers / labels / confidence / priority / provenance / summary）。
- `type` / `labels` / `summary` 保持中性：如 `type=SPATIAL_SEPARATION`、`labels: phase=OPENING, region=GRID_REGION_5, movementState=STATIONARY`、`numbers: distanceM=180, distanceGrowthM=25, stationaryRatio=0.72, observedEnemyNearby=2, damageReceived=800`。
- summary 禁止：单走拖延成功 / 单走脱节 / 没有队友获利 / 无掩护。

### 保留的防 hallucination 边界（LLM 不得伪造事实）

- 未观察敌军不能当已知位置；enemy unknown 不得填满；不能 future leak；没 terrain/LOS evidence 不说具体掩体/射界；没 visibility evidence 不说谁点亮谁；不从 settlement aggregate 推具体 timeline causality；不编 magic number；不自创车辆 role；UNKNOWN selective；Canonical Timeline hard gate。

### AI 提示词文件（单一事实源）

AI 提示词正文维护在 `java/wotb-ai/src/main/resources/prompts/` 下的 `.zh.md` 文件（随 jar 打包到 classpath），运行期由 `AiPromptLibrary.zh("<key>")` 惰性加载并缓存（`classpath:/prompts/<key>.zh.md`）。历史 Java 文本块常量已迁移为加载调用，prompt 内容字节级不变。md 支持 `{{key}}` 占位包含（`AiPromptLibrary` 加载时递归展开，循环包含 fail loud）；player×3 与 team/single 逐字重复的五块公共规则维护在 `prompts/common/{tank-noun,language,damage-semantics,hp-loss,evidence-logic}.zh.md` 复用，展开后内容与直接内联等价。`PromptRuleContractTest` 强制「展开后 ZH 片段与 Java 常量逐字一致 + EN/RU 本地化无中文残留」。

| key | 文件 | 对应常量 |
|---|---|---|
| player/fallback | `prompts/player/fallback.zh.md` | `PlayerPromptRules.SYSTEM_PROMPT`（旧单 Call 兜底） |
| player/single | `prompts/player/single.zh.md` | `PlayerPromptRules.SINGLE_PLAYER_PROMPT` |
| player/tactical | `prompts/player/tactical.zh.md` | `TacticalReviewPromptBuilder.TACTICAL_SYSTEM_PROMPT`（fallback + Harness 规则） |
| team/single | `prompts/team/single.zh.md` | `TeamPromptLocalizer.SINGLE_TEAM_PROMPT` |
| team/reasoning-contract | `prompts/team/reasoning-contract.zh.md` | `TeamPromptLocalizer.TEAM_REASONING_CONTRACT_RULE`（v0.6 推理顺序，由 `team/single` include） |
| prebattle/system | `prompts/prebattle/system.zh.md` | `PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT` |
| prebattle/user-header | `prompts/prebattle/user-header.zh.md` | `PreBattlePromptBuilder.PRE_BATTLE_USER_HEADER`（含 `%s`/`%d` 占位，由 `.formatted()` 填充） |
| prebattle/confidence-legend | `prompts/prebattle/confidence-legend.zh.md` | `PreBattlePromptBuilder.CONFIDENCE_LEGEND` |
| tactical-skills/information-vision | `prompts/tactical-skills/information-vision.zh.md` | `TeamPromptLocalizer.INFORMATION_VISION_SKILL_RULE` |
| tactical-skills/local-engagements | `prompts/tactical-skills/local-engagements.zh.md` | `TeamPromptLocalizer.LOCAL_ENGAGEMENTS_SKILL_RULE` |
| tactical-skills/team-execution | `prompts/tactical-skills/team-execution.zh.md` | `TeamPromptLocalizer.TEAM_EXECUTION_SKILL_RULE` |
| tactical-skills/position-tempo | `prompts/tactical-skills/position-tempo.zh.md` | `TeamPromptLocalizer.POSITION_TEMPO_SKILL_RULE` |
| tactical-skills/hp-trades | `prompts/tactical-skills/hp-trades.zh.md` | `TeamPromptLocalizer.HP_TRADES_SKILL_RULE` |
| tactical-skills/mode-objectives | `prompts/tactical-skills/mode-objectives.zh.md` | `TeamPromptLocalizer.MODE_OBJECTIVES_SKILL_RULE` |

编辑约定：

- UTF-8、LF 换行（加载器会把 CRLF 归一化为 LF；文件末尾换行保留——`confidence-legend` 以换行结尾，勿删）。
- 文件是 ZH 完整 prompt；EN/RU 由 `PlayerPromptRules.localizePlayerSystemPrompt` / `TeamPromptLocalizer.localizeTeamSystemPrompt` 对 ZH 规则片段做字符串替换生成。**展开后 md 内中文规则片段必须与 Java 常量（`COMMON_*_RULE` / `TEAM_*_RULE` 等）逐字一致**，否则 EN/RU 替换失效（`PromptRuleContractTest` 强制）。
- 多文件 AI 复盘已移除（2026-08-12，历史）：`player/multi` / `team/multi` 提示词、`analyzeMulti`、`MULTI_*_BATTLE` AI 分支与团队多视角分区合并全部删除。当时的实现（`AiReplayBatchPolicy.MAX_FILES=1`、`AiReplayReviewService.analyzeResults` 按 `ReplayProcessingCapabilities.aiAnalyzable(scope)` 判定 eligibility、`BatchAnalyzer` 的 group/representative machinery）以及 `ReplayAnalysisMode.MULTI_*`、`DefaultReplayProcessingFacade.processBatch`/`buildBatchResult`、`ReplayBatchProcessingResult`/`ReplayBatchSummary` 已随 2026-09 AI 解耦与 2026-10 契约收敛全部删除（legacy `/api/replay/process`、`/api/replay/reconstruct-batch`、multipart analyze 一律 410，不存在多文件批量端点）。**当前约束**：「单文件」由 `POST /api/ai/reviews` 的单 `battle` + 单 `projection` 请求形态结构性保证。

### Team Tactical Skill v0.2

Team `Call #2` 在既有 `Canonical BattleTimeline → deterministic evidence → grounded JSON` 链路中，通过 `AiPromptLibrary` include 按 INFORMATION/VISION → OBJECTIVES → LOCAL ENGAGEMENTS → POSITION/TEMPO → TEAM EXECUTION → HP/TRADES 注入六个紧凑模块。模块只提供经验性决策考虑，不产生 `BAD_PUSH`、`HALF_COMMIT_ERROR`、`GOOD_TRADE` 等后端结论；`EpisodeDetector`、Focus Window 和现有 Team evidence 继续是唯一事实输入。

Team Review 不接受战术地图计划，也没有语音/通信证据。模型先重建当时的信息状态（CURRENT/LAST_KNOWN/UNSEEN）、基地与点数义务、空间结构和局部有效兵力，再分析局部之间的信息/火力/空间传播、推进/等待/脱离/角色转换和交换结果；无法由证据支持的推断直接跳过。`summary.primaryDiagnosis` 表示本场最重要的结论，允许“没有明显确认错误”“关键成功因素”或“对手处理更好”。Strategic Prior 明确只是阵容与可能性的基线，不能作为实际队伍计划或单独的判错依据。

`TeamAiContextCompiler` 复用 canonical timeline 的已验证事件，额外输出 `OBJECTIVE_STATE_TIMELINE`：已解码的实时基地 owner/capturing/progress 与 Supremacy points。该段只输出中立事实；缺少状态不等于没有占点/没有点数，基地和点数的战术意义仍由 LLM 解释。模式模块中的 Supremacy +40 击杀价值、约 750–800/800+ 点数压力梯度，以及 Assault 约 100 秒完整捕获、70–80 秒警戒区，均是 LLM 的经验参考，不是精确阈值状态机。Golden cases (`team-tactical-skill-v01-a` 至 `h`) 扩展覆盖信息状态、局部传播、基地/点数主动权和反捷径约束。

### AI 复盘评估 harness（golden cases + lessons）

- **CI 模式**：`AiEvalHarnessTest`（`@Tag("ai-eval")`，默认构建运行）加载 `src/test/resources/ai-eval/cases/*.json`（synthetic Team 场景），用 `TeamAiPromptBuilder.single` 构建 user prompt，并加载实际 Team system prompt（不调 AI），执行 `prompt_contains` / `prompt_omits` / `system_prompt_contains` / `system_prompt_omits` 断言，写 `target/ai-eval-report/report.md` + `report.json`；任一 FAIL 构建失败。A–H `team-tactical-skill-v01-*.json` 是 prompt contract / static golden cases，只证明提示词契约，不单独证明实际 LLM tactical behavior。

#### AI 测试分层与 live provider 隔离

| 类型 | 内容 | 默认 CI/`mvn test` 行为 |
|---|---|---|
| Unit / deterministic | fake/mock gateway、gateway 单测、loopback HTTP boundary、prompt/validator contract | 正常执行；不访问外部 provider |
| AI eval | `AiEvalHarnessTest` 等基于 synthetic case 的 prompt/evidence 确定性评估 | 正常执行；不调用 LLM，不消耗 provider token |
| `ai-live` probe | 真实 `SpringAiChatGateway` + DeepSeek/provider 请求，例如 team review E2E/repro probes | JUnit `@Tag("ai-live")` 且 Maven Surefire 默认排除；人工显式运行，可能产生 token/cost |

`AI_API_KEY` 表示机器具有 provider 访问资格，不表示普通测试具有调用意图。真实 probe 必须同时满足：显式选择 live 测试、显式清空 `-Dai.probe.excludedGroups=`、提供不写入仓库或日志的 `AI_API_KEY`。缺少 key 时 probe 仍通过 JUnit assumption skip；默认 `mvn test` 即使环境中存在 key 也不执行 `ai-live`。普通 GitHub Actions CI 不注入 DeepSeek secret，不新增 paid/live AI job。

当前 `wotb-ai` 的真实 DeepSeek live 工具只剩 `TeamTacticalSkillLiveBehaviorEvalTest`（复用现有 `SpringAiChatGateway` 的 Team Call #2 JSON 请求，逐例解析最终结构化结果，再执行 primaryDiagnosis 存在、自然团队复盘文本存在、禁猜通信/call、禁 authoritative tactical label 以及 A–H 行为检查；A–H 的 live scenario 只提供事实，预期战术结论只存在于 assertion，不写进送给模型的场景）。报告包含 case id、provider/model/raw response/final analysis、每项检查与 violation reason，写入 `target/ai-eval-report/team-tactical-skill-live-report.{md,json}`。它要求额外的 `-Dai.tactical.live.enabled=true`，并且仍需显式选择测试和清空 `-Dai.probe.excludedGroups=`，因此默认 CI/普通 `mvn test` 不执行；它是手动诊断质量的工具，不是 CI 或 PR 合并条件。旧 `wotb-web` 时代依赖服务端 replay parsing 的 E2E / 批量 / repro probes（`TeamReviewRealE2EProbeTest`、`TeamReviewBatchE2EProbeTest`、`TeamReviewDetailedReproProbeTest`、`TeamReviewRealReplayProbeTest`）已随服务端 parser 退役删除。
`LiveAiTestIsolationTest` 对已知 probe 的 tag、测试源码中的 production external-provider 组合信号以及 `ai.probe.excludedGroups` POM contract 做 deterministic guard；loopback、Mockito、配置断言和 deterministic eval 不因引用 gateway 类型而被标为 live。

PowerShell 人工运行示例（从 `java` 目录执行；将占位符替换为通过带外方式取得的 key）：

```powershell
$env:AI_API_KEY = "<provided-out-of-band>"
mvn -pl wotb-ai -am test `
  "-Dtest=TeamTacticalSkillLiveBehaviorEvalTest" `
  "-Dai.probe.excludedGroups=" `
  "-Dai.tactical.live.enabled=true"
```

- **空间分离证据（Backend Evidence Boundary）**：`TeamSeparationEvidenceSkill` / `PlayerSeparationEvidenceSkill`（wotb-core）从阵型簇/移动段/交火推导中性 `SPATIAL_SEPARATION` 证据（`kind=OPENING_SPREAD` / `SEPARATION_WINDOW` + 距离/距离增长/静止占比/局部敌情/承伤/输出/阵亡/主力簇位移等确定性测量），`TeamEvidenceFormatter` 渲染 `SPATIAL_SEPARATION_EVIDENCE` 段（P3 optional）。不再输出 `SOLO_DELAY` / `SOLO_DETACHED` / `teammateBenefit` 等战术 verdict——是否拖延/脱节由 LLM 综合判断。
- **player 路径同规则**：`PlayerSeparationEvidenceSkill`（wotb-core）复用 `RouteSkill` 空间分离窗口推导同口径中性证据（个人复盘同样不输出拖延/脱节 verdict），已在 `EvidenceSkillEngine` 注册；player prompt（fallback/single/tactical）追加三语 `SEPARATION_EVIDENCE_RULE`。
- **争霸赛占点与点数胜负结束方式**：`FriendlyEnemyResult.resolveTeamBattle` 新增派生 `pointsEndReason`（`REACHED_1000`=双方均有存活 + 标准业务规则 + 时长<420s：某一方达到 1000 分上限导致提前结束，与胜方解耦，不使用任何点数字段；`TIME_EXPIRED`=标准规则 + 时长≥420s：时间耗尽，双方终局比分未解码；`UNKNOWN`=类别未知 / rosterComplete=false / 时长缺失；全歼=NOT_APPLICABLE），`TeamEvidenceFormatter` 在 `CAPTURE_AND_POINTS` 段输出 `pointsEndReason`（逐人/双方占点分、`pointsDecided`、占领点区域）；`TeamAiPromptBuilder` mandatory header 同时输出 `result` 与 `resultSource`（BATTLE_RESULTS 权威 / SURVIVOR_SETTLEMENT 结算存活推导 / UNKNOWN；POINTS_INFERENCE 已停用——枚举保留但不再产出，fail closed）；**所有依赖完整逐人结算的存活/点数推断共享"结算阵容完整"前提**（`Battle.rosterComplete`：上游 WASM v0.3.8 的 `parseResult.roster_complete`（结算花名册与战绩账号集合一致，`contracts/agent/replay-facets-v2.md` §6）经客户端 `frontend/src/replay-local/battleFacts.ts` 写入 canonical facts，再随 `AiReviewBattle` 进入 ai-service；不写死每队 7 人，完整名册的非 7v7 训练房同样生效）：SURVIVOR_SETTLEMENT 推导与 `annihilationSuffix` 在阵容不完整时一律 fail-closed；winnerTeam 缺失 + 双方均有存活 → 胜方 UNKNOWN（结束方式仍按标准时限证据判定，用于结果行后缀，禁止比较占点字段推断）；winnerTeam 存在时胜方为 BATTLE_RESULTS，`pointsEndReason` 正常判定（rosterComplete=false 时 UNKNOWN，result 只写通用「点数判定」）；`CAPTURE_AND_POINTS` 在阵容不完整时输出 `SETTLEMENT_ROSTER_INCOMPLETE=true` / `pointsTotalsUnavailable=true` 并抑制占点分总量；提示词 `CAPTURE_RULE`（ZH/EN/RU，含 2d 条阵容不完整口径）写明结束条件三分法——全歼胜（双向：全歼敌方获胜 / 被敌方全歼落败）/ 1000 分提前结束（某一方达到 1000 分上限，具体胜方由 winnerTeam 决定；缺失时只写「某一方达到 1000 分导致提前结束，具体胜方未知」，双方终局比分一律 UNKNOWN，不把 1000 分配给任何队伍）/ 时间耗尽点数决胜（仅双方均有存活且标准规则可证），`TIME_EXPIRED` 叙述必须写「时间耗尽」，禁止用 <1000 的中间比分作为获胜理由，禁止把失败方被全歼写成「全歼敌方获胜」；团队剖析胜负标签按结束方式输出「（时间耗尽点数判定）/（达到 1000 分提前获胜）/（某一方达到 1000 分提前结束，具体胜方未知）/（时间耗尽点数判定，具体胜方未知）/（点数判定）/（全歼敌方）/（被敌方全歼）」。`TeamPromptLocalizer` 三语 `SOLO_INTENT_RULE` / `CAPTURE_RULE`。
- **争霸赛点数口径（未证明项，禁止用于终局比分）**：`victoryPointsEarned`(#32) 的精确定义及是否包含被动占点增长/击杀夺分等调整仍未证明——已知计算口径（占点分+40×击杀−40×阵亡）已撤回，证据只输出原始结算字段（victoryPointsEarned/Seized、kills、deaths）；每据点每 tick 产分与 tick 间隔均未解码（无任何已验证的 tick 产分规则），不得用 tick 数或占点分计算终局比分；击杀夺分 40 分仅作叙述口径（`KILL_STEAL_POINTS` 不参与计算）；实时点数/基地占领/终局比分尚未解码（`PointsEvidenceProbeTest`/`ShotSpottingStreamProbeTest` 记录候选，语义 UNKNOWN）。
- **点数局势证据与规则（PointsSituationSkill，P3 optional）**：wotb-core 纯函数 `PointsSituationSkill` 产出三类可证明信号——击杀夺分时间线（±40/击杀业务规则按双方阵亡时刻对齐，叙述口径非实时比分；只表达击杀换分项净差值，禁止说成整体点数领先/落后、禁止反推早期点数状态）、占领点区域位置存在（服务器位置流在 CONTAINS_CONTROL_POINT 九宫格内的存在，几何可证，位置存在≠占点产分）、进攻推进窗口（车辆从非占领点区域移动进入占领点区域，仅 MOVING 采样位移判定，不声称意图；同队窗口 8s 合并）；wotb-ai `PointsSituationEvidence` 复用 TeamEntityMapper（`wotb-core`）从重建事件流采集双方轨迹（2s 采样、battle-relative 秒），推进窗口与 `DamageWindowClusterer` 掉血窗口联接为「推进方窗口内承受伤害=防守方过路费」（OBSERVED_DAMAGE_IS_PARTIAL 时抑制数字）；接入点：团队复盘 `TeamEvidenceFormatter.appendPointsSituation`（与其它 P3 optional 同级、超预算整体裁剪）、随机战 Harness Call #2（裁剪阶梯在 phases 之后）、fallback 路径（fallback 与无重建路径仅击杀夺分时间线）。prompt 规则三语：team/single 占点规则 8（击杀换分项净劣势/优势只提示「点数压力方向」，是否抢点/防守拉交叉由 LLM 综合推断、禁止固定映射；进攻掉血情境化；过路费不足=防守失误必须由 LLM 形成 supported inference；fail-closed）、player tactical/single/fallback 点数局势规则（`PlayerPromptRules.POINTS_SITUATION_RULE` zh/en/ru 逐字契约）。
- **生产反馈闭环**：人工评估 + 用户反馈登记模板见 `docs/ai-eval/feedback-checklist.md`；可复现反馈转 lesson + synthetic case 回归。评估人工，不引入 LLM-as-judge；真实回放不入库。

关键约束：

- **地图战术语义层**：`MapTacticalSemanticsRegistry` 加载 `common/map-semantics/*.semantic.json`（由 `map-semanticizer` 从 Wot Blitz 客户端 SC2 + heightmap 解码生成，含 `areas` / `relationships` / `spawnSemantics` / `mapCodes` / `gridRegions` / `verified` / `source` / `displayName` / 区域 `confidence`；`displayName` 为 `map_names.json` 的 en 名，未收录回退 mapId）；按 `mapCodes` / `mapId` / token 边界别名查询，未收录地图明确 UNKNOWN，禁止编造区域语义。`relationships` 为 `List<TacticalRelationship>`（from/type/to/reason/confidence 原样保留，不做分组/改名）：ADJACENT_TO 仅表示确定性分析网格相邻，不代表可通行路线/视线/交叉火力；CONTAINS_CONTROL_POINT 与 CONTAINS_STRATEGIC_POINT 保持区分。Call #1 Prompt 输出可信度图例：EXACT_CLIENT_DATA/EXACT_SCENE_DATA=客户端直接事实、NAME_HEURISTIC=对象位置精确但类别由资源名推断、GRID_RULE_DERIVED=区域名称/边界/合并是规则候选、RULE_DERIVED_CANDIDATE=favors/risks 是假设候选；`verified=true` 渲染"人工地图核验: 已完成"（2026-08-12 起仓库内 33 张地图语义全部核验；`verified=false` 时渲染"尚未完成人工地图核验"）；语义段显示「地图: "Desert Sands"（内部 code: "desert_train"）」。CONTROLS / ENABLES_PRESSURE_AGAINST 未提供时禁止声称；出生点语义仅在有数据时输出。每个 AREA 标注 `gridRegions`（GRID_REGION_1~9），与 `MapRegionResolver` 同一坐标约定（回放 raw 按每图 playableBounds 推导的 per-map profile（`MapCoordinateProfileRegistry`，含中心偏移与半边长）→ 500×500 canonical → 3×3）；无语义数据时 GRID_REGION_1~9 仍只是位置编号。TEAM_A=队伍1、TEAM_B=队伍2 固定映射。
- **双 Call 预算**：Call #1 独立 45s stage budget（`AiChatRequest.callTimeoutSec`），Call #2 使用剩余预算并留 10s 安全余量；Call #1 失败后剩余 < 60s 时不启动旧路径 fallback；总 deadline = `AI_CALL_TIMEOUT_SEC`。
- **结构化 JSON 调用关闭 thinking**：`PRE_BATTLE_STRATEGIC_PRIOR`（Call #1）在请求层强制 `thinkingEnabled=false`（`reasoningEffort=null`）。生产实测 DeepSeek thinking（`AI_REASONING_EFFORT=max`）会把整个输出预算（Call #1 4096）消耗在 reasoning 上、`finish_reason=length` 且 content 为空（`AI_EMPTY_RESPONSE`），导致 Call #1 静默降级；关闭后直接输出契约 JSON。**Call #2 主复盘默认也关闭 thinking**（`AI_THINKING_ENABLED_CALL2=false`，见配置表）——DeepSeek 推理模式下 `reasoning_content` 先流、content 末尾一次性到达，破坏 SSE 逐段流式；需要推理深度时开回 `AI_THINKING_ENABLED_CALL2=true`（流式体验由网关分块兜底保证）。
- **伤害语义（损失血量 vs 格挡伤害）**：AI 提示词统一用「损失血量」称呼 `damageReceived`（不再叫「承伤」），并强制区分两个概念——格挡伤害（`damageBlocked`）越高越好；损失血量本身中性，评价必须结合车型职责、存活时长、输出贡献与战况（重坦/装甲车抗线掉血可接受，薄皮输出车无价值掉血或过早阵亡前大量掉血才是问题）；不得仅因损失血量高判定表现差。个人复盘（fallback/harness）与团队复盘共用 `COMMON_DAMAGE_SEMANTICS_RULE`（ZH/EN/RU 三语）。
- **掉血时间范围（强制规则 + 窗口证据）**：`HP_LOSS_TIME_RULE`（ZH/EN/RU，player/team 提示词共用）——凡提及掉血/损失血量必须给出明确时间范围（X分XX秒–X分XX秒）与掉血量，禁止笼统描述；很短窗口内大量掉血先描述为「短时间集中掉血/高压掉血窗口」，仅当窗口总跨度 ≤15 秒、解析出 ≥2 个不同攻击者且无未解析攻击者时才可写「被多车集火」，攻击者无法解析、只有 1 个攻击者或窗口总跨度超阈值（含 ≤10s 间隔链式聚类的大跨度窗口）时不得断言集火；正常慢速掉血不误标，无窗口证据写「无法确定」。证据侧：`DamageWindowClusterer`（wotb-ai）把受击者视角的逐次伤害事件按 ≤10s 间隙聚类成掉血窗口（起止时间 + 总掉血量 + 命中次数 + 不同攻击者数 + 攻击者未解析标记 + `focusFireCandidate`——仅总跨度 ≤15s、攻击者 ≥2 且无未解析时为 true）；`DamageEventIdentityResolver`（wotb-ai，唯一实现）负责 DamageEvent 攻击者/受击者身份解析——真实 decoder 的账号字段恒为 null，沿 `ParticipantMappingEvent` 的 entityId→accountId 映射（复用 `TeamEntityMapper`）按 `attackerEid/victimEid` 解析，合成 fixture 直填账号优先，不再依赖生产中恒为 false 的 `lethal()`；同解析器同时接入逐次伤害段 `PER_HIT_DAMAGE_EVENTS`、逐对手对炮段 `DAMAGE_EXCHANGE_BY_OPPONENT` 与掉血窗口。player 路径（fallback 与 Tactical Harness 主路径同格式/同口径）输出 `RECORDER_DAMAGE_RECEIVED_WINDOWS`，团队路径输出 `MEMBER_DAMAGE_RECEIVED_WINDOWS`（均受 `OBSERVED_DAMAGE_IS_PARTIAL` 覆盖率抑制，覆盖不全时输出 UNAVAILABLE 不给数字）。
- **掉血窗口严重度（进场满血 provenance + fail closed）**：`DamageWindowClusterer.DamageWindow` 带 `damageVsEntryMaxHpPct` + `entryHpProven`。进场满血契约（真实回放 probe `EntryHpProbeTest` 证伪「整场 max current HP = 初始满血」——绝大多数车辆首个 positive 样本与首次受击同刻且低于 tankopedia base）：`EntryHpSource.OBSERVED_EXACT` 仅在存在严格早于首次受击（或从未受击）且 ≥ base 的样本时成立，此时分母 = 已证明进场满血（含装备/物资加成）；否则 `BASE_FALLBACK`（只允许 tankopedia base 作 baseline，base 是 entry 下界）或 `UNKNOWN`。跨度 ≤10s 且伤害 ≥75% 已证明进场满血量 → `criticalWindow`（短窗高额伤害窗口）；**base baseline 一律 fail closed 不判 critical**（真实 entry ≥ base，按 base 判定会误报）；不判定「被秒杀」（无法证明窗口起始血量、窗口内阵亡与精确进场血量）。证据段按 provenance 输出「伤害/进场满血pct」或「伤害/base满血pct」，prompt 规则（player×3 + team/single 三语）强制定性并给时间范围。
- **观察性语义**：HP 动量只按两端共同可靠观察实体计算 delta（unspot / STALE 不伪造 HP swing；confirmed DESTROYED 按 0 HP 计入 lethal loss）；Call #2 只输出安全比较后的 HP_MOMENTUM 证据、不输出 raw 逐采样 HP 曲线，HP before/after/swing/coverage 必须来自同一 comparison cohort（禁止跨 cohort 拼接）；局部支援 denominator 使用当前时刻存活名单（已阵亡车辆不污染覆盖、存活敌军全部观察可重新 EXACT），敌军数量表达为"至少观察到 N"，仅两侧完整覆盖才 EXACT；隐藏/点亮不制造 local-number flip；Route 敌方人数优势需友军侧完整覆盖（observedEnemy 作为真实敌军下界）。
- **观察性**：HP 动量带 `observedCoverage`，覆盖率低时置信度降为 PARTIAL；局部支援只统计 `OBSERVED` 位置，STALE/UNKNOWN 不计入。
- **降级阶梯**：非 ZH / 无重建 / 录像者未解析 / 特征不可用 / Call #1 失败 / 无证据 → 旧单 Call 路径；对外 API 与响应结构不变。
- **Team 复盘也应用 Call #1**：随机战个人复盘（`TacticalReviewHarness`）与训练房/联赛团队复盘（`TeamReplayAnalysisService`）都先执行 Call #1（Pre-Battle Strategic Prior：基于地图与双方阵容的赛前先验，含开局/分路假设）；团队路径按视角队伍把 prior 重标为 TEAM_A=你的队伍（teamDisplayLabel，无值时「我方」）/ TEAM_B=对方队伍 后注入团队 Prompt（视角队伍为 2 时交换 Call #1 的 TEAM_A/TEAM_B）。该 prior 只是战略基线/可能性空间，不是实际队伍计划；Call #2 以可观察执行和确定性证据为准，偏离 prior 不能单独构成失误，未知的计划、call 或通信原因不得补写；Call #1 失败不阻断团队复盘（仅缺 prior 段）。
- **AI Review V2.1 — Team Review Quality Gate（docs/features/team-ai-review.md，2026-08）**：Team AI 复盘推理质量契约（FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN）收敛——真实失败案例（20260817 WildCat SPHT 回放）暴露的因果过度断言（位置→视野、掉血→掩体、结算→时间线因果、自创精确数字、残局万能规则、自创车辆角色）在 prompt 契约层禁止（prompts/team/single.zh.md + TeamPromptLocalizer 三语常量，PromptRuleContractTest 强制逐字一致）。输出结构改为「核心结论 / 关键决策窗口（1-3）/ 可确认问题（1-3）/ 训练建议（1-3 且必须对应可确认问题）/ 对方关键威胁（可选 1-3）」，删除强制 10 章节与「开局散开=图控/拿视野」危险规则（player/team 同步改为中性行为，证据不足 UNKNOWN）。Focus Window selector：TimelineFocusWindowSelector（wotb-core replay.timeline）用 bounded core window（≤20s 有界子区间，sliding）识别短时间连续减员（如真实回放 109–128s 本方 3 死对方 1 死），不链式吞并窗口外阵亡；评分按「绝对局势 swing（|fd−ed|）优先于总死亡密度」+ HP/点数/交火支撑；由 TeamAiContextCompiler.renderFocusWindowsSection 注入 TEAM REVIEW FOCUS WINDOWS 段（与 TACTICAL TIMELINE 同一已验证 timeline）。结算级归因只保留「重点复查对象/高贡献者」（`reviewFocus` / `highContributors`），不再输出「主要战犯/MVP」；仅凭结算与死亡时间不得写成确定战术过错（earlyDeath/weakOutput 只是规则候选）。车辆角色统一来源：tankName/vehicleClass/tier 三路径（主复盘/赛前）同源 ReplayDisplayNames，角色语义唯一来源 TankTacticalProfileRegistry，prompt 禁止自创「薄皮输出型/前排/肉盾/狙击车」等角色。回归：TimelineFocusWindowSelectorTest / TeamReviewQualityGateContractTest / TeamFocusWindowsRenderTest / TeamTankRoleConsistencyTest / golden case team-review-causal-overreach-01。
- **PR #103 Final Quality Gate（2026-08）**：① Team 用户可见名称——`TeamPerspectiveLabelResolver` 拆分为 `resolveDisplayLabel`（唯一 dominant 且严格多数 → clan tag 最常见 casing；否则空串，绝不返回 `队伍-XXXX`）与 `resolveStableKey`（internal-only 身份键）；web 层 `TeamRosterResolver.resolveDisplayLabel / resolveOpponentDisplayLabel` 独立解析双方，TeamAiPromptBuilder header 输出 `teamDisplayLabel` / `opponentDisplayLabel`（无可靠 clan → `(none)`），PreBattleSectionRenderer 无 clan 只显示「我方画像/对方画像」；prompt 移除「主要军团」proper noun，禁止自创「X 对阵 Y」标题。② 真人教练风格——新增「内部证据与用户正文的关系」规则（AUTHORITATIVE_*/OBSERVED_*/FACT/UNKNOWN/canonical 等是内部推理材料，正文不得复述/不解释证据体系）；删除 blanket「无法从输入确定时必须写明…」改为 selective UNKNOWN（4 条件）；Focus 五项改为内部思考框架、正文自然 1-3 段不机械输出小标题；中文默认 600–1200 字（简单 400–700、复杂 ≤1500），数字只保留支撑核心判断的。③ Team Call #2 独立输出上限——`wotb.ai.team-review-max-output-tokens: \${AI_TEAM_REVIEW_MAX_OUTPUT_TOKENS:8192}`，effective = min(global, team)，同时用于 AiPromptBudgetGuard 与 AiChatRequest；Player Call #2 保持 global。④ Opening Spread battle-specific inference——「敌方主力确认后本方没有及时合流」是本场具体结论，需「重新集中推断规则」4 证据门（enemy-known 支持主力确认 + 本方多分离集群 + 后续未靠近 + 首次关键交火在一侧集群）；known=4/unknown=3 只能说「至少观察到 4 辆，其余 3 辆位置不明确」，禁止「7 辆主力已集中在这一侧」；anti-future-leak 禁止后知信息回填。⑤（历史）原「真实回放 Golden probe 硬断言」（friendlyDeaths==3 / enemyDeaths==1 / BEFORE 7v7 / AFTER 4v6 / core 109–128s ±8s）随服务端 parser 与 `TeamReviewRealReplayProbeTest` 退役删除；真实回放回归改由客户端投影夹具上的 offline harness / parity 测试承担。
- **相对纵深/血量测量（中性）与区域覆盖测量**：`RelativeDepthHpEvidence`（wotb-ai，原 BehindLineHpEvidence 中性化重构）确定性测量——reference 由<b>纯几何算法</b>选择（本阶段距观测敌方最近的存活本方成员，不是「扛线队友」之类的战术角色）；成员血量比率 ≥ reference × 1.2 且距敌比 reference 更远 是 salience filter（只决定哪些成员值得给 LLM 看，不是战术判定；tank profile 只作为静态事实附注，不参与筛选）；输出只报成员/reference 的 accountId + 静态 profile 事实 + hpRatio/hpRatio差 + memberDist/referenceDist/relativeDepthM + observedAttackEvents + coverage（COMPLETE/PARTIAL；partial 时 0 个已观测攻击事件 ≠ 无输出，禁止推断「避战」）+ HP_RATIO_UNKNOWN（血量数据不足只给位置与观测事实）；跨阶段出现次数是中性 salience，不是负面分级；不再输出吸血/避战/利用队友/「前线型未上前线」/degree 轻中重。团队路径遍历本队全体，个人路径仅录像者自己。`FormationDepthEvidence` 纯几何纵深三分位（GEOMETRIC_FORWARD/GEOMETRIC_MIDDLE/GEOMETRIC_REAR 恒输出，不引用 tank profile 分类；已移除 isFrontlineCapable/isBacklineCapable/noFrontlineVehicle/noBacklineVehicle/lineupStructure）+ 九宫格「区域覆盖测量 REGION_COVERAGE_MEASUREMENTS」（每区输出 ownPositionPresence/enemyPositionPresence、ownWeightedCoverageScore/enemyWeightedCoverageScore（距离加权火力覆盖分 F=Σ 火力权重/(1+d/100)，权重只按车种/burst/sustained 静态事实）、ratio、coverageCompleteness；位置参考不完整时只输出 ownPositionPresence，不输出分数对比）——只输出确定性测量，不输出 own/contested/enemy 权威控制权标签；哪方「实际控制/压制某区」由 LLM 综合判断（Backend Evidence Boundary，PR #103 第三轮 + 第四轮收口）。

- **新增共享资源**：`common/tank_tactical_profiles.json`（精选 Tier X + 车型级默认 fallback），`wotb-core/pom.xml` 与 `docker/Dockerfile.business-api` 已同步复制。

### Grounding Facts（TeamGroundingFacts，wotb-core）

- **死亡时刻时钟契约**：`PlayerResultFormat.deathSec()` 只读取 settlement `field24 lifeTime`（业务秒值）；
  live reconstruction 事件仅用于 Playback/HP/动画/诊断，不得覆盖 settlement。`TeamGroundingFacts.build` 统一按 `raw > startRaw → raw − startRaw`
  转 battle-relative——compat 入口（无 timeline）必须传 `reconstruction.battleStartRawClockSec()`。
- 从权威结算 + 已验证 canonical BattleTimeline 提取带稳定证据编号（E1xx，确定性顺序：
  阵亡→存活变化→关注窗口→位置快照→敌方位置知识）的事实清单；timeline 为 null（兼容入口）
  时只输出结算可推导事实（阵亡/存活变化），不产出位置/窗口类事实。
- 渲染为 prompt 的 `=== GROUNDING FACTS ===` 段；时间一律「XX分XX秒」。

## AI 分析范围边界

AI 复盘区分两种 scope，互不混用：

### TEAM_PERSPECTIVE（训练房 / 联赛）

- 分析对象是录像者所在整支队伍。
- 保持独立 `perspectiveTeam` 内部语义（用于后端计算，不暴露给 AI）。
- 不使用随机战斗的 FRIENDLY/ENEMY formatter（`PlayerAnalysisPromptFormatter`）。
- **dominant clan 队伍标签**（`TeamPerspectiveLabelResolver`）：根据 roster 中成员人数最多的军团生成用户可见名称，如 `CHRD`；军团人数并列或无军团时用户可见标签为空串（正文称「我方/对方」），绝不返回 `队伍-XXXX`。
- **地图名称映射**（`MapNames.cn()`）：使用 `common/map_names.json` 单一数据源，AI prompt 中输出中文地图名。
- **Tank ID 映射**：`PlayerResult.tankName` 由客户端 canonical facts 经 `common/tankopedia-tier{7,8,9,10}.json` 填充，AI prompt 直接使用。
- **500×500 九宫格区域**（`MapRegionResolver`）：地图业务尺寸 500×500，+Z 为地图上方。Replay 坐标按每图 `MapCoordinateProfile`（`MapCoordinateProfileRegistry` 从 semantic `playableBoundsMeters` 推导，含中心偏移与半边长；未收录回退默认 ±250 m）线性映射到 0…500。区域编号：1|2|3（顶行/北）、4|5|6（中行）、7|8|9（底行/南），列自西向东。无法解析时返回 UNKNOWN/0。地图语义数据的 `gridRegions` 使用同一约定（`map-semanticizer` 内 `NINE_GRID_HALF_EXTENT=250`），若调整 `REPLAY_COORDINATE_HALF_EXTENT` 需同步脚本并重新生成。
- **结构化 cluster**（`TeamFormationCluster`）：每个 cluster 包含 canonical centroid（`CanonicalMapPosition`，500×500）、region（基于 canonical centroid）、memberIdentities、memberCount、confidence、startTime（battle-relative）、endTime。centroid 计算顺序为「先对每个成员位置 resolve/clamp 到 canonical，再在 canonical 空间求平均」（不是先平均 raw 再转换）。`TeamFormationPhase.clusters` 派生 `clusterCount()`；`TeamFormationPhase.centroid` 亦为 `CanonicalMapPosition`，prompt 用 `formatCanonicalPosition(...)` 输出（含 region，不再 raw 二次映射）。构造时验证时间合法性、region 1-9、memberCount 等于有效 identities 数。
- **movement 单位**：distance/speed 使用 canonical 米（`MapRegionResolver.canonicalDistanceMeters(...)` 每端点先转 canonical 再求欧氏距离），speed = 米 / battle-relative 秒；stationary 阈值 `STATIONARY_THRESHOLD_METERS`（canonical 米）集中定义，Player 与 Team member movement 共用同一算法；无效/倒序/零时间差不产生 Infinity/NaN 速度，INVALID 坐标位置不参与 movement。
- **battle-relative phase end**：`findBattleEndEvidence(...)`/`lastObservedClock(...)` 使用 `BattleStartResolution` 把 replay raw clock 转成 battle-relative；`battle.durationS` 直接使用不再二次减 start。`buildRelativePhases(firstContactRelative, battleEndRelative)`：`UNKNOWN_FIRST_CONTACT=-1`，`firstContact==0` 合法，`openingEnd` 裁剪进 battle end，非法/非有限 battleEnd 返回空 fallback；每个 phase 由 `BattlePhaseSummary` 不变量兜底 `finite/>=0/start<=end`。
- **coverage 不变量**：单一共享 `classifyTime(event)`（USABLE/INVALID_TIMESTAMP/PRE_BATTLE）被 damage 循环、`teamPositionsByEntity`、`auditPositionEvidence` 与 phase guard 复用。invalid-timestamp damage 只计入 invalid-timestamp coverage，不计入 unattributed；pre-battle 与无效时间戳的 damage/position 不进入战术统计；`observedPositionEventCount`/`clampedPositionEventCount` 由同一分析集合派生，`TeamFeatureCoverage` 强制 `0<=clamped<=observed`；INVALID（丢弃）与 CLAMPED（降级但参与分析，附 `MAP_COORDINATES_CLAMPED` limitation）区分。
- **MovementSegment 不变量**：compact constructor 强制所有 float 有限、时间/距离/速度非负、`start<=end`、`type`/位置/`confidence` 非空；坐标字段命名为 `rawStartPosition`/`rawEndPosition`，显式标注 raw replay 坐标域（distance/speed 为 canonical 米）。
- **battle phases**：通过 `BATTLE_PHASES` 输出 start/end time 和 phase type。
- **MemberIdentity**：accountId > 0 时优先使用 accountId；accountId ≤ 0 时使用规范化 nickname（trim、Locale.ROOT、case-insensitive）。用于 engagement 匹配、cluster 成员标识和 key events 的全链路 identity。
- **prompt 禁止 raw team**：AI prompt 中不出现 `perspectiveTeam=1/2`、`winnerTeam=1/2`、`Team 1/2`、`队伍1/2`。使用 `teamDisplayLabel=` / `opponentDisplayLabel=`（唯一 dominant 且严格多数（>一半）的 clan tag；无可靠 clan 时为 `(none)`，正文称「我方/对方」；`队伍-XXXX` 只存在于 core 的 internal `resolveStableKey`，禁止进入 Prompt/UI/渲染）、`result=TEAM_WIN/TEAM_LOSS/DRAW_OR_UNKNOWN`。BATTLE_END key event 同样使用 `result=` 三态。
- **secret redaction**：AI provider 错误摘要优先使用 Jackson tree JSON 递归隐藏敏感 key。`isSensitiveKey()` 归一化匹配覆盖 x-api-key、AWS Access Key、大小写/连字符/下划线变体。文本回退脱敏 `redactNonJson()` 采用分层正则策略：(1) `Authorization:` 前缀行整个隐藏；(2) JSON key-value 已知敏感 key 脱敏；(3) 无引号 key=value 脱敏；(4) AWS Signature/Credential 脱敏；(5) 已知 auth scheme（bearer/basic/digest）大小写不敏感，credential 任意长度，始终脱敏；(6) PascalCase custom scheme（如 `CustomScheme`、`TokenV2`）credential ≥ 3 脱敏；(7) 含数字的 scheme（如 `tokenv2`、`auth2`）credential ≥ 3 脱敏；(8) 小写 custom scheme 仅 credential 含非字母字符（数字或标点）时脱敏，避免自然语言误判。Digest auth 参数（response/nonce/opaque 等）独立脱敏。
- **battle start resolution**：`BattleStartResolver.resolve(reconstructionBattleStart, diagnostics)` 返回 `BattleStartResolution`（IDENTIFIED / ESTIMATED / UNRESOLVED）。仅通过静态 factories 构造。准备阶段静止不进入 STATIONARY；formation/first contact/engagement/key events 使用 `battleRelative(rawClock)`。`PRE_BATTLE_START_ESTIMATED`/`PRE_BATTLE_START_UNRESOLVED` limitation 传播。

### PLAYER_FOCUSED（随机战斗）

- 分析对象是录像者个人。
- 使用 FRIENDLY / ENEMY / UNKNOWN 标签，禁止输出"队伍1/队伍2"。
- 录像者所属队伍 → 友方；另一队 → 敌方。
- 录像者在原始 team 2 时仍正确识别为友方（`PlayerSideResolver`）。
- 胜负使用完整三态（`FriendlyEnemyResult`）：友方获胜 / 敌方获胜 / 平局或未知。
- 胜率只统计已知胜负场数，平局/未知不作为失败。
- `PlayerResult.team` 原始编号不受影响（仅用于内部计算）。
- AI Prompt 由 `PlayerAnalysisPromptFormatter` 格式化（独立于 `PlayerResultFormat`）。

### AiModelProperties 配置

| 属性 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `apiKey` | `AI_API_KEY` | 空 | DeepSeek API Key；为空时应用正常启动，AI 调用返回 `AI_NOT_CONFIGURED` |
| `baseUrl` | `AI_BASE_URL` | `https://api.deepseek.com` | Provider Base URL |
| `model` | `AI_MODEL` | `deepseek-v4-flash` | 模型字符串，原样传递给 Provider |
| `connectTimeoutSec` | `AI_CONNECT_TIMEOUT_SEC` | 10 | 连接超时（秒） |
| `timeoutSec` | `AI_TIMEOUT_SEC` | 300 | 单次 read/response 超时（秒） |
| `callTimeoutSec` | `AI_CALL_TIMEOUT_SEC` | 315 | **整个 `AiChatGateway.chat()` 的总时间预算**（首次请求 + 全部 retry + 全部 backoff + 响应解析），必须 ≥ connect + read |
| `retryMaxAttempts` | `AI_RETRY_MAX_ATTEMPTS` | 3 | 总预算允许范围内的最大尝试次数（含首次） |
| `retryInitialBackoffMillis` | `AI_RETRY_INITIAL_BACKOFF_MS` | 1000 | 首次重试等待（毫秒） |
| `retryMaxBackoffMillis` | `AI_RETRY_MAX_BACKOFF_MS` | 8000 | 重试等待上限（毫秒） |
| `retryBackoffMultiplier` | `AI_RETRY_BACKOFF_MULTIPLIER` | 2.0 | 指数退避倍数 |
| `contextWindowTokens` | `AI_CONTEXT_WINDOW_TOKENS` | 1000000 | DeepSeek 上下文窗口大小 |
| `singleReplayMaxInputTokens` | `AI_SINGLE_REPLAY_MAX_INPUT_TOKENS` | 940000 | 单回放输入硬上限 |
| `maxOutputTokens` | `AI_MAX_OUTPUT_TOKENS` | 32768 | 单次请求最大输出 |
| `promptSafetyMarginTokens` | `AI_PROMPT_SAFETY_MARGIN_TOKENS` | 16384 | 安全余量 |
| `thinkingEnabled` | `AI_THINKING_ENABLED` | true | 是否启用思考模式 |
| `call2ThinkingEnabled` | `AI_THINKING_ENABLED_CALL2` | false | Call #2 的模型思考是否启用；个人路径输出自由文本，团队 v0.5 路径输出结构化 JSON；默认关闭以保证逐段流式（`AI_THINKING_ENABLED` 为 legacy） |
| `reasoningEffort` | `AI_REASONING_EFFORT` | max | 推理力度（high/max） |

启动时校验 `totalReserved <= contextWindowTokens`，不合规则 Spring Boot 启动失败。

#### `AiReviewWorkerExecutor` 配置（SSE worker 池）

| 属性 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `wotb.ai.review-worker.max-concurrent` | `AI_REVIEW_WORKER_MAX_CONCURRENT` | 4 | AI Review SSE worker 池线程数（core = max，固定不弹性伸缩），必须 ≥ 1；V1 VPS 2C4G 默认 4 |
| `wotb.ai.review-worker.queue-capacity` | `AI_REVIEW_WORKER_QUEUE_CAPACITY` | 4 | worker 池有界队列容量，必须 ≥ 1；满载（workers + queue 全占用）时第 N+1 个请求立即返回 `503 AI_REVIEW_BUSY`（`AbortPolicy`，绝不使用 `CallerRunsPolicy`） |
| `wotb.ai.review-worker.overall-deadline-sec` | `AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC` | 1100 | 请求整体 deadline（提交时刻 + overall，排队计入预算）：默认 1100s 覆盖团队 Call #1 + Call #2（各 ≤315s）+ 余量，对齐前端 1100s / nginx 1120s；worker 启动时剩余预算耗尽 → 干净失败 `AI_TIMEOUT`（E 阶段） |

### Token 估算器

`ConservativeDeepSeekTokenEstimator` 使用 `codePointCount * 1.25` 保守估算 token 数。精确 token 数通过 API 响应的 `usage` 字段获取。

---

### SSE error 诊断契约

运行时 `error` 事件使用 canonical `{id, errorCode, errorMsg}` envelope；旧 `code` 字段仅作为兼容 alias 保留。`id` 复用本次请求的 `correlationId`，因此前端展示的错误 ID 可以直接在 Loki 中检索 `ai_review_contract_failed` / `ai_review_contract_salvage_*`、`ai_review_recovery_triggered` / `ai_review_recovery_failed`、`team_review_completed`、`ai_prompt_budget` 与上游事件（`ai_upstream_call_started` / `ai_upstream_call_completed` / `ai_upstream_call_failed` / `ai_transport_retry`）。`errorMsg` 只允许安全、可本地化的诊断信息，不携带 prompt、原始模型输出、回放内容或凭据。该事件不再仅发送裸 `code`。

### Spring AI 集成

- 项目使用 **Spring AI 2.0.0**（BOM 在父 POM dependencyManagement 管理），生产 transport adapter 为 `SpringAiChatGateway`：官方 **OpenAI-compatible adapter**（`spring-ai-starter-model-openai`）连接 `https://api.deepseek.com`。原因：2.0.0 的 DeepSeek Starter 无法传递 `thinking`/`reasoning_effort`，这两个字段经 OpenAI adapter 的 `extraBody` 机制原样发送。
- 业务层只依赖项目内 `AiChatGateway` 接口；Spring AI / OpenAI SDK 类型只存在于 `gateway` 包。Replay 领域逻辑（`wotb-core`）不依赖 Spring AI。
- 缺少 `AI_API_KEY` 时应用正常启动，`POST /api/ai/reviews` 的 SSE `error` 事件返回 `AI_NOT_CONFIGURED`；其余功能不受影响。
- timeout/retry 由 `AiRetryPolicy` 单层控制（SDK `maxRetries=0`，无双重重试）；可重试：429、连接失败、500/502/503/504；不重试：**超时（`AI_TIMEOUT`——上游可能已完成并计费，重试会重复扣费）**、认证/权限、invalid request、context too large、空/无效 completion。
- 总调用边界：`AI_CALL_TIMEOUT_SEC` 使用单调时钟（`System.nanoTime`）覆盖一次 `chat()` 的整个生命周期（含响应体读取与 SDK 解析）；每轮尝试前检查剩余预算，backoff 不得超过剩余预算，in-flight 请求会在预算耗尽时被中止（okhttp interceptor 捕获 Call + 看门狗，覆盖连接→发送→等待→响应体读取→反序列化；成功返回前还会复检 deadline），因此单轮实际请求时间上限为 `min(AI_TIMEOUT_SEC, 剩余预算)`。预算耗尽统一返回稳定 `AI_TIMEOUT`，超时后绝不返回 success。
- **全链路超时对齐**（改 nginx/Dockerfile/前端时必须保持）：AI 单次调用预算 `AI_CALL_TIMEOUT_SEC=315s`（connect 10 + read 300 + 重试/backoff/解析余量）；团队复盘为 Call #1 + Call #2 两次 AI 调用，整体 deadline 默认 **1100s**（2×315 + 余量，`AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC`）——覆盖「切页后仍在后台跑完」的长复盘，不再被旧 400s 硬杀；TX ingress 对 `/api/ai/**` 的 `proxy_read/send_timeout` 为 **1120s**（余量防 504）；前端 review 请求安全超时 **1100s**，在代理 504 之前给出干净 `AI_TIMEOUT`；`SseEmitter` 超时同步为 1120s。host 级 Caddy/Nginx 反代也必须允许 ≥1120s，否则会提前 504。
- **SSE 流式协议**：`POST /api/ai/reviews` 返回 `text/event-stream`（由独立 `ai-service` 承载），事件语义与旧 analyze 保持一致：`call1_start` / `call1_done`（Call #1 开始/结束，真实发起调用时必发，无论成败）、`evidence_done`（证据分析完成；随机战 harness 与团队路径均发射）、`call2_token`（`{"delta":"..."}` 个人文本复盘 token 增量）、`done`（个人结果为 `{"analysis":"...","preBattleSection":"..."}`，团队结果为 `{"analysis":null,"preBattleSection":"...","teamReview":{...}}`；另携带 `teamPlayers` 与由请求事实推导的 `capability`）、`error`（`{"id":"...","errorCode":"AI_..."}`）。生产链不发送任何 autopsy 阶段事件（`autopsy_start` / `autopsy_done` 随 Team Autopsy 一起删除，`openapi.yaml` 的 `x-sse-events` 正确定义为上述六个事件）。**异常传达规则**：请求信封校验（`INVALID_AI_REQUEST` / `UNKNOWN_LOCALE` / `INVALID_CORRELATION_ID` / `DUPLICATE_CORRELATION_ID` / `UNSUPPORTED_BATTLE_CATEGORY` / 413 `AI_REQUEST_TOO_LARGE` / 415 编码拒绝）与准入饱和（`AI_REVIEW_BUSY`）在返回 `SseEmitter` 前映射 HTTP 400 / 409 / 413 / 415 / 422 / 503；worker 启动后的运行时/业务失败（`NO_BATTLE_DATA` / `PERSPECTIVE_TEAM_UNRESOLVED` / `PERSPECTIVE_TEAM_CONFLICT` / `TEAM_FEATURES_UNAVAILABLE` / `AI_NOT_CONFIGURED` / `AI_PROMPT_MANDATORY_SECTION_TOO_LARGE` / `AI_RATE_LIMITED` / `AI_TIMEOUT` / `AI_CANCELLED` / `AI_UPSTREAM_UNAVAILABLE` 等）经 `error` 事件传达（HTTP 已 200），客户端断开时终止上游调用（cancel 端点语义）不向已断开连接写入。`AiChatGateway.stream(request, consumer)` 为单次尝试（不流内重试），失败即断流并保留已输出部分；总预算 watchdog 与 `correlationId` cancel 语义与 `chat()` 一致（`AI_TIMEOUT` / `AI_CANCELLED`）。同步测试路径委托流式实现（`AiReviewStreamListener.NOOP`）。TX ingress 的 `/api/ai/**` location 必须保留 `proxy_buffering off` + `X-Accel-Buffering: no` + HTTP/1.1 + 清空 `Connection` 头（chunked 流式反代必需）；**任何 host 级反代改动必须保留上述三项**，否则阶段事件/token 无法实时到达。 回放解析 / 汇总 / 导出接口已随服务端解析删除（服务器没有 parser），nginx 不再有对应限流 location。
- **SSE worker 池配置（`AiReviewWorkerExecutor`）**：`/api/ai/reviews` 的整段 AI 复盘在 worker 线程执行，servlet request 线程提交完即返回 `SseEmitter`。worker 池为**有界**（core=max fixed thread pool + bounded queue + `AbortPolicy`），**绝不使用 `CallerRunsPolicy`**——后者会让 request 线程同步执行整段 AI 复盘，重新引入 SSE blocking bug。默认 **4 concurrent workers + 4 queued**（`ai-service` 在 Yecao 2C4G 上按实测可调；`deploy/docker-compose.prod.yml` 现用 2+2），队列满时新请求被立即拒绝并返回 **`503 AI_REVIEW_BUSY`**。容量经环境变量 **`AI_REVIEW_WORKER_MAX_CONCURRENT`** / **`AI_REVIEW_WORKER_QUEUE_CAPACITY`** 可调（无需 rebuild）。线程为 daemon，命名 `wotb-ai-review-worker-N`，`@PreDestroy` 关闭池。**request-envelope 校验前置**：`locale` 白名单 / canonical UUID `correlationId` / `battle` + `projection` 结构校验在提交 worker 前完成，失败以 HTTP 400 / 409 / 413 / 415 / 422 + 稳定错误码返回（不再进入 SSE 流以 `error` 事件传达）。**queued cancellation**：任务在队列中等待期间若被取消（客户端断开 / cancel 端点），worker 启动后第一时间检查 `AiCancellationToken.isCancelled()`，命中即 `complete()` emitter 并清理、不调回放解析与 AI Gateway、不向已断开连接写入。`emitter.onTimeout` / `emitter.onError`（客户端断开）只翻转 cancellation token、不主动 complete——连接错误由 Servlet async lifecycle 负责终止 emitter，worker `finally` 统一清理 `AiRequestContext` 与 cancellation registry，与显式 cancel 端点幂等。 **整体 deadline（E）**：任务在提交时刻计算 `now + overall-deadline-sec` 并通过 `AiRequestContext.overallDeadlineNanos()` 暴露给 worker；`TeamReplayAnalysisService` / `TacticalReviewHarness` 预算起点回溯到提交时刻（排队时长计入剩余预算），启动时预算耗尽直接抛 `AI_TIMEOUT`；排队等待记 DEBUG 日志与 `wotb_ai_review_queue_wait` timer。
- **客户端取消 → 上游中断**：review 请求携带 `correlationId`；前端取消按钮 / 页面离开（`beforeunload` keepalive）/ 前端超时会调用 `POST /api/ai/reviews/{correlationId}/cancel`，`AiCancellationRegistry` 命中后取消 in-flight 上游 provider 调用并停止重试（稳定错误码 `AI_CANCELLED`），避免为无人等待的响应继续计费。 **correlationId 契约（D）**：客户端提供的 correlationId 必须为 canonical UUID（格式+长度 36），review 与 cancel 端点非法/重复一律 400 / 409（`INVALID_CORRELATION_ID` / `DUPLICATE_CORRELATION_ID`）；`AiCancellationRegistry.register` 对重复活跃 id 返回 null（不复用 token），`unregister(id, token)` 为 ConcurrentHashMap compare-and-remove（已完成的请求不会误删复用同一 id 的新注册）。
- Prompt/completion 默认不记录、不进 metrics；Spring AI Observation 未启用（NOOP）。日志经 `AiSecretRedactor` 集中脱敏。
- **Call #1 覆盖可观测性**：`PreBattleStrategicService` 每次调用前输出 `Pre-battle Call #1 input`（map、mapSemantics=found/UNKNOWN、verified、areas/relationships/spawnSemantics 数量、source、displayName、team1/team2 人数、curatedProfiles/fallbackProfiles 车辆 Profile 覆盖），成功后输出 `Pre-battle Call #1 success`（hypotheses/matchups/winConditions/双方 strengths·plans 数量）；`TacticalReviewHarness` 输出 `Harness prior obtained`（prior 已注入 Call #2）与 `Harness fell back to old path: <reason>`。新增指标 `wotb_ai_review_map_semantics_total{status=found|unknown}`。按 requestId 可在 Loki 逐请求验证地图/车辆语义是否进入 Call #1 并注入 Call #2。
- **回放解析覆盖率可观测**：包解码覆盖率在客户端投影里**不存在**——`ClientAiProjectionAdapter` 不读回放字节，投影不携带 packets / decoded / decodedRatio，因此 `coverage = null`，prompt 显示 `decodedPacketRatio=UNAVAILABLE`；`ai-service` 不再输出 `Replay event-stream parsed`。
- 测试不调用真实 AI API：`SpringAiChatGatewayTest`/`SpringAiChatGatewayMetricsTest` 使用 mock `ChatModel`。
- **AI 输出语言跟随前端 locale**：`/api/ai/reviews` 的 JSON body 字段 `locale`（`AiReviewRequest` 请求体 `{locale, correlationId, battle, projection}`，必填，白名单 `zh-CN`/`en-US`/`ru-RU`，`contracts/http/openapi.yaml#AiReviewRequest`）控制 AI 复盘输出语言；未知值返回 `400 UNKNOWN_LOCALE`。语言穿透 `AiReviewController.languageOf` → `TacticalReviewHarness` / `TeamReplayAnalysisService` → Prompt Builder：ZH 直接使用原有中文 system prompt（字节级不变）；EN/RU 在中文基座上替换互斥的中文输出强制句（输出语言、称谓、车种、时间格式、未知字段与无法确定措辞），业务事实约束（不编造、坦克专有名词原样、perspective/friendly-enemy、权威结算与观测子集、注入防护、数据限制）不变。en 时间格式统一为 `Xm Xs`（如 `1m 15s`、`3m 0s`、`3m 12s`），ru 为 `X мин X с`（如 `1 мин 15 с`、`3 мин 0 с`、`3 мин 12 с`）。覆盖 player fallback/single/tactical 与 team single 路径；地图/坦克/clan/昵称等专有名词不翻译；`limitations` 与错误码仍为英文稳定码、由前端本地化。前端由 vue-i18n 当前 locale 携带 `lang`。

---

## AI 回放复盘

### 视角分组与模式判定

```
.wotbreplay（本机）→ 上游 Agent WASM：parseResult + parsePlayback + parseAiReview（typed facets，pin = deploy/agent/source.json）
  → frontend/src/replay-local/canonical：WotbTools canonical replay facts（身份 / 视角 / AoI / 血量 / 归属 / 终态）
  → frontend/src/replay-local/ai：ClientAiReviewProjection（+ battle 结算事实）
  → AiReviewRequest（locale / correlationId / battle / projection）
  → POST /api/ai/reviews（application/json，Content-Encoding: gzip）

POST /api/ai/reviews → TX ingress /api/ai/** → WireGuard 私网 → Yecao 独立 ai-service
  → AiReviewController.reviewJson：限额 gzip 解压（传输体与解压后都 ≤ 16 MiB）→ 信封校验（locale 白名单 /
    canonical UUID correlationId）→ ReplayFactsCodec + ClientAiProjectionAdapter（结构校验 + 装配 canonical
    事件流 + checkpoints）→ ObservedMaxHp 回填
  → 视角判定（BattleCategoryUtils.resolveScope：RANDOM→PLAYER_FOCUSED，TRAINING/TOURNAMENT→TEAM_PERSPECTIVE，
    UNKNOWN→422 UNSUPPORTED_BATTLE_CATEGORY）
        ├─ PLAYER_FOCUSED → TacticalReviewHarness.analyzeWithPrior（Call #1 → Call #2）
        └─ TEAM_PERSPECTIVE → TeamReplayAnalysisService.analyzeTeam（结构化 TeamAiReviewResult）
  → timeline / features / evidence → Prompt → Spring AI → LLM provider
  → SSE 流式：call1_start / call1_done / evidence_done / call2_token / done / error
  → 取消：POST /api/ai/reviews/{correlationId}/cancel（传播到 in-flight 上游 provider 调用）
```

> Business Backend 不承载 AI Review：旧 `/api/replay/analyze` 端点与 `AiReplayReviewService` 已移除，服务端回放
> dataset 路径已删除（服务器没有 parser）。AI 只消费 client canonical AI projection（见下节）。

### Team Perspective 语义

- `RANDOM` 仍是录像者个人复盘；`TRAINING` / `TOURNAMENT` 是录像者所在整队复盘（`BattleCategoryUtils.resolveScope`；`UNKNOWN` 在 controller 层返回 422，不进入 AI）。
- 录像者不获得特殊个人分析权重，只用于解析 `perspectiveTeam`。
- 同场双方 perspectives 各自独立分析，不得合并：`POST /api/ai/reviews` 每次只承载一场战斗的一个视角（客户端投影的 `perspective` 决定 `perspectiveTeam`），后端不存在跨请求的同场去重或「代表场次」选择；历史文档中的 `SAME_TEAM_DUPLICATE_PERSPECTIVE` 去重规则**未实现**（全仓无生产者），不构成当前契约。
- **死亡时刻口径**：业务死亡秒值只来自 settlement `#301 field24 lifeTime`；settlement 无效时依赖死亡时刻的证据 fail-closed。Playback/live reconstruction 不覆盖 `PlayerResult`，也不产生额外死亡 provenance 层；legacy 启发式不作为权威。阶段存活人数为「至阶段末」语义（`BattlePhaseTimelineSection`），prompt 注入双方逐车阵亡时间线（`DEATH_TIMELINE`）。
- **观测伤害抑制**：事件流覆盖未达 100% 时 `DefaultTeam/PlayerBattleFeatureExtractor` 条件标记 `OBSERVED_DAMAGE_IS_PARTIAL`，prompt 层抑制观测数字（`TeamAiPromptBuilder.appendObserved` / 随机战交火段），以权威结算为唯一口径；覆盖补齐后自动恢复。
- **赛前预测渲染**：`PreBattleSectionRenderer` 覆盖 TEAM 变体（A队/B队/A 队/队伍1 等）、AREA ID → 中文名 + 九宫格（复用 `MapTacticalSemanticsRegistry`）、composition 键值三语翻译。

## AI 复盘输入：client canonical AI projection（`AiReviewRequest`）

### 为什么不是「Agent JSON 直接上传」

上游 Agent 切面（`AiReviewFacet` / `PlaybackData`）是**协议事实的载体**，不是 WotbTools 的领域契约。旧 Java canonical
层（`TeamEntityMapper` / `ReplayAoiLifecycle` / `EntityIndex` / `PlaybackCombatReconstruction` / `ReplayTerminalLifecycle` /
`EntityClassRegistry`）里的语义决定——谁是参战者、录像者是谁、观测段边界、哪些血量是可信采样、哪些 method8 通知是
归属证据还是冲突证据——必须在一个明确、可测试的边界里完成，而不是让每个消费方各自 reshape。这个边界就是：

```text
typed facets（api/agent-replay-facets.ts，信任边界校验）
  → canonical replay facts（replay-local/canonical/facts.ts，2D 回放与 AI 共用）
  → ClientAiReviewProjection（replay-local/ai/toClientAiReviewProjection.ts）
```

### 投影内容（`contracts/http/openapi.yaml#ClientAiReviewProjection`）

| 部分 | 内容 | canonical 规则 |
|---|---|---|
| `participants` | 结算实际参战者的实体 → 账号 / 队伍 / 车辆 / 是否录像者 | 结算花名册是队伍权威；实体自报队伍与结算矛盾 → 剔除 + `TEAM_ENTITY_MAPPING_CONFLICT` |
| `perspective` | 录像者账号 / 视角队伍 / 录像者实体 / 胜方 | 视角无法解析 → `perspectiveTeam=null` + `PERSPECTIVE_TEAM_UNRESOLVED`，绝不缺省成某一队 |
| `clock` | 开战（period 3）/ 时长 / 战斗结束（AFTERBATTLE）/ 流末 | 无 period 3 时按 AFTERBATTLE − 结算时长反推（`CLOCK_ESTIMATED`）；时间轴不可用 → 不产生投影 |
| `observationWindows` | AoI 观测段 [Type5 物化, Type4 离开) + 开段物化血量 | 半开区间；每次重入各自携带物化血量 |
| `positions` / `turrets` | 原始 type10 世界位姿 / prop2 原始炮塔（列式） | 只收 attachmentParent=0；不是渲染滤波网格（重入后网格有收敛滞后） |
| `prop3Health` / `healthEvents` | prop3 血量广播 / method1 血量-来源-原因，**原始 u16** | `HpRawState` 由服务端按原值分类：0 = HP 归零，0xFFFD = 终态哨兵（血量未知，不改写为 0） |
| `damageNotices` | method8 通知：`HIT`（result=3）/ `UNDECODED_VARIANT` / `SHORT_VARIANT` | 只对战斗车辆实体（Type5 entityTypeId=2）分类；录像者实体按 Avatar 角色分派，不产生伤害通知 |
| `objectives` | 争霸点数 / A–D 基地 / 单基地目标存在性与进度 | 目标存在性独立于是否有占领进度 |
| `limitations` | 影响能力的缺口 | 非空 → `AVAILABLE_WITH_LIMITED_TIMELINE` |
| `unavailableEvidence` | 引擎不提供的证据类 | `PACKET_DECODE_COVERAGE` / `SHOT_LIFECYCLE` / `TARGETING` / `AMMUNITION`：渲染为不可用，不当作「没有发生」 |

ai-service 侧 `ClientAiProjectionAdapter`（wotb-core `replay/projection`）只做结构校验与**编码装配**：把投影按旧 canonical
事件语义装回 `ReplayReconstruction`（ParticipantMapping / Materialization + EntityRemoved / PositionChanged /
TurretDirectionChanged / HealthChanged / VehicleHealthState / VehicleHit / UnsupportedDamage / ArenaPeriodChanged +
RoundFinished / Supremacy*），由 `BattleStateReconstructor`（纯事件归约）生成 checkpoints / finalState，再按旧处理链
同一函数 `ObservedMaxHp.populate` 回填实测血量。它不读任何回放字节——server has no replay parser。包解码覆盖率不存在：
`coverage = null`，prompt 显示 `decodedPacketRatio=UNAVAILABLE`。

### 上游补齐的原始证据（upstream-first）

| 上游版本 | 字段 | 用途 |
|---|---|---|
| v0.3.5 | `Damage.hp_raw`、`Visibility.hp_raw`（每次物化）、`HitNotice`（method8 全变体） | 终态哨兵 vs HP 归零；重入血量；归属 fail-closed |
| v0.3.6 | `Health`（prop3 原始值） | 录像者自身血量常只走 prop3（3 场分别 4 / 17 / 11 条无 method1） |
| v0.3.7 | `AiReviewFacet.poses` / `turrets`（原始 type10 / prop2） | 位置证据（渲染网格重入后单帧偏差可达 276 m） |
| v0.3.8 | `BattleSummary.roster_complete` / `author_vehicle_codename` | 「一方全员阵亡 → 全歼」推导的守卫；录像者车辆 |

### 语义 parity（永久测试）

`java/wotb-ai/.../ClientAiProjectionParityTest`：三场 fixture（随机 / CW / 联赛）上，Java 删除前冻结的 canonical 重建
（`common/fixtures/replay-facts`）与「锁定 WASM → canonical facts → 投影（`common/fixtures/ai-projection`，前端测试保证与
现场 WASM 逐字段一致）→ adapter」两条输入走同一套下游，逐层断言：

- 实体映射、开战时钟（≤ 1e-3 s）、时长；
- 掉血（区间 / 血量 / 攻击者 / 可靠性 / 证据条数）、击毁（时刻 ≤ 0.01 s / 击杀者）——**完全相等**；
- BattleTimeline 每秒每车：位置 knowledge（CURRENT / LAST_KNOWN）、车辆 knowledge、朝向 knowledge、位置（≤ 1 mm）、
  生命、血量、血量 knowledge、HP bar 量程、地图区域——**完全相等**（3 场共 7 374 个帧-车辆）；
- grounding facts（formation / clustering / relative depth / map region 的上游输入）——**完全相等**；
- 团队 / 个人 prompt 全文（生产路径：客户端结算事实 + 投影）——仅三处固定差异（`normalizePrompt` 每条写明原因）：
  内部事件条数（新链路只装配被消费的事件类型）、`decodedPacketRatio=UNAVAILABLE`、同 tick 内争霸点数与基地迁移的
  相对顺序 + 基地迁移的分秒（上游两类事件分列数组、目标时钟舍入 0.01 s，包序不可恢复；行内容逐字一致）。
  此外 v0.3.11「占领中断归零」在**已知 fixture**（联赛场）上产生团队 prompt 的**逐条冻结**差异
  （`PINNED_BASE_CAPTURE_JAVA_ONLY` / `PINNED_BASE_CAPTURE_CLIENT_ONLY`）：只放行逐字列出的具体行、
  条数漂移即失败，**不做字段通配**——任何未列入的 capture 回归仍由逐行比较抓住。同一次契约补正的另一侧
  看守在前端 `playback.golden.test.ts` 的 `PINNED_BASE_ABORT_CLEARS` / `PINNED_ASSAULT_RESET_ROWS`。

### 请求体量与传输

| fixture | 客户端投影请求 JSON（`openapi#ClientAiReviewProjection`） | gzip（level 6） | 历史参考：旧服务端 `ReplayReconstruction` 请求 JSON（已退役） |
|---|---|---|---|
| random-battle-example | 1,642,047 | 491,184 | 46,046,004 |
| cw-training-15-14-example | 1,372,784 | 477,709 | 28,770,763 |
| tournament-14-14-example | 1,133,015 | 380,115 | 25,625,002 |

前端 `authedReplayPost(..., { gzip: true })` 同步压缩（不引入取消 / 超时的异步窗口），`Content-Encoding: gzip`；
`AiReviewController.readBody` 限额解压（传输体 / 解压后任一超过 16 MiB → 413，非 gzip / identity 编码 → 415）。
审计工具：`node frontend/scripts/audit-ai-payload.mjs --request <AiReviewRequest.json>`。

---

## 前端交付与失败态契约（2026-10，AI Review 生产可用性）

AI Review 是正式开放能力，入口没有 maintenance gate / admin-only gate：`?view=ai-review` 与
`?view=replay` 共用 `ReplayWorkspace`，`AiReviewWorkspacePane` 直接挂载（匿名只显示登录提示）。

**懒加载与部署的关系（生产可用性根因）**：`AiReviewWorkspacePane` / `BattlePlaybackPanel` 是
`ReplayWorkspace` 的懒加载 chunk（`frontend/src/utils/lazyModule.ts` 的 `defineLazyModule`）。Vite 产物按内容
哈希命名，而 TX 部署用 `docker compose up -d --force-recreate` 整体替换镜像里的 `/usr/share/nginx/html`
（`deploy/tx/deploy.sh`），**上一次部署的 chunk 文件随即消失**。因此「部署前打开、部署后仍然存活」的页面
进入这两个能力时必然 404。`index.html` 固定 `no-store`，重新加载即拿到与新部署一致的 bundle——这是旧
hashed URL 唯一正确的补救动作。边界契约：

- 动态 import 失败**不得中断整页渲染**：`defineLazyModule` 的 `onError` 调用 Vue 的 `fail()` 明确结束
  这一代（不调用则 loader promise 永远 pending，渲染无法 settle；`onError` 的返回值不是「恢复协议」）；
- 失败态复用 `Banner` + `AppButton`（design-language §7/§10），说明发生了什么 + 下一步；
- 失败态是**持久的**：切走再切回能力仍然显示，只有用户显式选择才算处理过——自动清状态只会把「有提示的
  失败」变成「没有提示的空白」；
- 恢复动作有明确主次：「重新加载」是 chunk 失败的唯一可靠恢复（换新 bundle → 新 URL）。「重试」创建
  **新一代 `defineAsyncComponent`**（Vue 的 async wrapper 会把失败的 promise 记进 `pendingRequest`，
  重复调用同一代 loader 或重新挂载同一份组件定义都只会复用那个已 reject 的 promise，表现为「错误被清空
  但面板仍然空白」），但它**不能**让浏览器重新请求一个已失败的 chunk URL——实测（生产构建 + CDP）再次
  `import()` 同一 URL 直接抛错且**不发网络请求**，所以界面文案必须把重新加载放在首位。
  generation / recovery 归 `lazyModule` 唯一所有，Workspace 不重复管理。

**失败态分类**（`AiFailure.kind`，`frontend/src/types/ai-review.ts`）：`busy` / `not_configured` /
`timeout` / `upstream` / `malformed` / `cancelled` / `client`；`not_configured` 与 `cancelled` 不提供重试
按钮（前者重试无意义，后者是用户主动取消、不是错误，渲染为中性 info）。未归类的原始运行时异常只进
console 与诊断日志，UI 显示 canonical `AI_CLIENT_ERROR` 文案——不把浏览器异常文本交给用户。
**登录与权限不在这套归类里**：登录门禁属于宿主（`AiReviewWorkspacePane`，未登录显示登录入口），已登录但缺
realm role 是渲染前就确定的**前置权限态**（`data-testid="ai-permission-required"`，说明缺什么并给下一步），
不是一次 run 的失败。权限判定因此存在两层且都必须成立：前端（`tokenParsed.realm_access.roles` 含
`wotbtools-user` 或 `wotbtools-admin`）与 ai-service（`AiServiceSecurityConfig` 的 `/api/ai/**`
`hasAnyRole`）。界面只消费 `kind` + 本地化文案，不渲染服务端 message 或异常字符串。

---

## 历史演进（机制已删除，见 `HISTORY.md`）

> 本节只记录 2026-10 AI domain contract 收敛（S6/S7）中**已删除**的机制，供追溯与理解历史测试命名；
> 其中的类/字段已不存在，任何实现都不得再引用。当前契约见上文各节。

### v0.3 / v0.4 设计记录（prompt 层，仍有效的规则已并入 v0.5/v0.6 正文）

- **v0.3「selective but complete」**：把写作目标从 concise review 调整为「只选关键内容，但完整解释关键内容」；
  A–H reasoning contract 与中性 backend evidence 不变，变化只在 prompt 优先级与输出空间。普通 7v7 约
  1200–2200 中文字、复杂赛事/训练局约 2500–3500 字的软目标由此而来（v0.5/v0.6 沿用）。
- **v0.4「信息链与个人复查边界」**：Information 必须说明「当时确认了什么 / 什么仍是 CURRENT·LAST_KNOWN·UNSEEN /
  这如何改变部署或行动义务」；几何距离只是 evidence，不得直接判脱节、无法支援或必须合流；
  重点复查/高贡献者/关键威胁只能来自正文已展开的 tactical episode。这些约束已由 v0.5 结构化字段与
  v0.6 reasoning contract 承接。

### Natural Coach Mode + Factual Consistency Guard（2026-08，契约层已删除）

- **旧 Team Call #2 JSON envelope**：`{primaryDiagnosis:{title,reasoning,supportingEvidenceIds}, reviewMarkdown,
  claims:[{text,evidenceIds}]}`，由 `TeamReviewEnvelopeParser` 解析 → `TeamReviewEnvelope`（wotb-core）
  承载；`reviewMarkdown` 是用户可见正文，`evidenceIds` 只允许出现在 structured 字段。
- **`TeamFactualConsistencyValidator`（truth guarantee）**：只检查 LLM 有没有改写 backend 事实，不判断战术观点；
  检查项 V1 temporal ownership / V2 player event correctness（阵亡时间 ±2s）/ V3 alive transition /
  V4 position temporal grounding（region+count 精确语义）/ V5 CURRENT·LAST_KNOWN 措辞 /
  V6 unsupported hard facts（无 LOS/spotting 证据的硬事实化表达）/ EVIDENCE·OUTPUT·INTERNAL；
  三语契约优先按 structured claims 的机器字段（`timeSec` / `region` / `count` / `subject` / `value` /
  `claimType`）做语言无关校验，正文自然语言仅作兜底；`evidenceIds` 必须真正绑定允许类型的证据
  （DEATH→PLAYER_DESTROYED、ALIVE_TRANSITION→ALIVE_COUNT_TRANSITION·FOCUS_WINDOW、
  POSITION_REGION→POSITION_REGION、ENEMY_POSITION→ENEMY_POSITION_KNOWN）。
- **校验失败 → LLM 自修循环**：Draft → validate → HARD_FACT 冲突 #1 targeted rewrite → #2 full rewrite →
  #3 conservative safe rewrite → 仍失败 fail-safe `AI_REVIEW_GROUNDING_FAILED`；
  `MAX_VALIDATION_ATTEMPTS=4`；severity 分为 `HARD_FACT` / `STRUCTURED_METADATA` / `FORMAT`。
- **DeepSeek 官方 JSON Output（旧 Team Envelope）**：Provider `response_format=json_object` 只提供 syntax
  guarantee（职责分层：provider=JSON 语法、`TeamReviewEnvelopeParser`=业务 schema、
  `TeamFactualConsistencyValidator`=事实一致性）；Team Call #2 显式传 `JSON_OBJECT`，Player / Pre-battle /
  Harness / Autopsy 保持 `TEXT`；不宣传为 strict schema output。
- 对应类与测试全部随 2026-10 收敛删除：`TeamReviewEnvelope`、`TeamReviewEnvelopeParser`
  （含 `ParseFailureReason`）、`TeamFactualConsistencyValidator`、`TeamReviewEnvelopeParserTest`、
  `TeamQualityContractTest`、`TeamFactualConsistencyValidatorTest`，以及 test-only
  `TeamQualityShortcutValidator`（settlement-only / 车种套角色 / 未观测信息 / 自动推进 / 无结构性原因的死亡聚集
  检查）。

### Team Autopsy（结算级第三次调用，已删除）

- 战犯/MVP 只用于训练房/联赛团队复盘：`TeamReplayAnalysisService` 在单团队单元成功后追加结算级独立
  `TEAM_AUTOPSY` 调用，输入只有权威逐人结算（无 Call #1 prior / Critical Window / Route 证据），
  七人门禁（recorderTeam 恰好 7 名有效本方玩家）、settlement-only 置信度上限（PARTIAL/UNKNOWN）、
  `playerKey` 与 roster 完全相等、`TEAM_AUTOPSY` 预算 `min(30s, 整体剩余 − safety margin)`。
- 相关类/资源/统计全部删除：`TeamAutopsyService`、`TeamAutopsyParser`、`TeamAutopsyPromptBuilder`、
  `TeamAutopsyResult`、`TeamAutopsyOutcome`、`TeamAutopsyStats`、`TeamAutopsyStatsBuilder`、
  `prompts/team/autopsy.zh.md` 及其 prompt key、`team/autopsy` contract 测试；
  生产链**没有**第三次模型调用，也没有 autopsy SSE 阶段事件。

### 已删除的编排与 transport 层（2026-10 收敛）

- `AiReplayAnalysisService`：曾经的「兼容 facade」，只做转发；controller 现直接注入
  `TacticalReviewHarness` + `TeamReplayAnalysisService`。其 legacy 成员
  （`analyzeSingleTeamContext` / `callLegacyValidatedTeamReview` / `appendTeamAutopsy`）随 S6 删除。
- `TeamAnalyzeResult`：team 内部中间结果类型 → 收敛为 controller 消费的单一 transport 形状。
- `AnalyzeResponse`（顶层 record，零实例化）：删除；其 `Capability`（→ `AiReviewDonePayload.capability`）
  与 `TeamPlayer`（→ `openapi#TeamAiPlayerIdentity`）两个内嵌类型迁到收敛后的单一 transport 类型
  （`wotb-ai` `replay/dto/AiReviewDonePayload`，字段与 `contracts/http/openapi.yaml#AiReviewDonePayload` 一致）。
- **`TeamAiReviewResult` 的技术 resilience 不是历史**：确定性 normalization / salvage / 单次 recovery
  是当前生产行为，正文见「Team Call #2 结果契约」。
