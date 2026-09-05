# AI Review 架构（随机战双 Call / 团队复盘 / Team Autopsy）

> 开发入口见 `docs/DEVELOPER_GUIDE.md`；Team-Level 复盘产品设计见 `docs/features/team-ai-review.md`。
> 权威结算 vs 事件流观测的数据边界见文末「权威数据源与 AI 分析」。
> 生产状态：AI 证据只消费 canonical facts（AFFIRMED）；UNKNOWN 为合法内部状态，不得猜成 0/无事件/静止/满血（选用例见 prompts 与 `PlayerEvidenceFormatter`）。

## AI Review Harness（随机战双 Call / 团队复盘 + Team Autopsy）

随机战个人复盘在满足条件时走两 Call Harness（`TacticalReviewHarness`），否则自动降级到旧单 Call 路径：

1. **Call #1（Pre-Battle Strategic Prior）**：`PreBattleStrategicService` 只输入地图名 + 双方阵容（坦克名/车种/等级/国家/单车血量）+ 双方总血量（tankopedia base 求和；仅当进场满血被回放证明时改用实测含加成值）+ `common/tank_tactical_profiles.json` 战术 Profile，严格剥离战绩字段（伤害/击杀/存活/胜负/阵亡顺序）；`preferredPlans` 契约要求分阶段（开局/中期/残局）输出；结构化 JSON 输出由 `PreBattleStrategicParser` 解析，失败返回 null 降级。
2. **Backend Evidence Skills**（`com.wotb.core.replay.evidence`）：`HpMomentumSkill` / `EngagementTradeSkill` / `LocalSupportSkill` / `DeathCascadeSkill` / `RouteSkill` / `TeamSeparationEvidenceSkill` / `PlayerSeparationEvidenceSkill` / `CriticalWindowSkill`，输出确定性 `AiEvidence`（含 confidence / provenance / priority），只描述「发生了什么」与确定性派生测量，不做战术裁决。
3. **Call #2（Tactical Review）**：`TacticalReviewPromptBuilder` 按 Priority Bookends 组织 Prompt（BATTLE SNAPSHOT（含结算、死亡时间线、**走位/区域时间线与压缩移动段**）→ STRATEGIC PRIOR → **TACTICAL TIMELINE（Canonical BattleTimeline 的 Episode 化主叙事，见 `docs/architecture/battle-timeline.md`；`PersonalAiContextCompiler` 渲染 BEFORE/EVENTS/AFTER/TACTICAL_CHANGE + 你 hp/pos + 敌方已知/未知分布）** → TOP PIVOTAL WINDOWS（≤8）→ PHASE → **对炮明细（ENGAGEMENTS·逐次交火）** → EVIDENCE → CRITICAL DECISION WINDOWS（≤8 完整证据）→ TASK），预算不足时按相关性裁剪（timeline 段在 evidence/phases/points 之后、窗口细节之前裁剪），书签段永不裁剪。
   - **Canonical Timeline hard gate**：随机战 harness 在录像者解析后立即构建 `BattleTimeline`（battle-relative 时钟：IDENTIFIED / ESTIMATED（`BattleEnded.raw − duration`）/ UNRESOLVED→拒绝）；无法构建 → `AI_TIMELINE_UNUSABLE` 业务错误，**不再 settlement-only fallback 调用 AI**；`PlayerReplayAnalysisService.analyzePlayerOrFallback` 无重建/录像者未解析同样拒绝。团队 prompt 经 `TeamAiContextCompiler` 注入双方对称 timeline 段（recon 可用时；结算级 Team Autopsy 不变）。


## Backend Evidence Boundary（PR #103 架构收口）

> 核心原则：**Backend 负责把战局事实整理到 LLM 能可靠理解的程度，但停在战术判断之前。**

数据流：

```
Replay
  ↓
Parser
  ↓
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
| **Layer 1 — Canonical Facts** | Backend（Parser / Timeline） | 发生了什么 | 时间 / HP / 伤害 / 阵亡 / 存活 / 位置 / 移动 / 结算 / roster |
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

AI 提示词正文维护在 `java/wotb-web/src/main/resources/prompts/` 下的 `.zh.md` 文件（随 jar 打包到 classpath），运行期由 `AiPromptLibrary.zh("<key>")` 惰性加载并缓存（`classpath:/prompts/<key>.zh.md`）。历史 Java 文本块常量已迁移为加载调用，prompt 内容字节级不变。md 支持 `{{key}}` 占位包含（`AiPromptLibrary` 加载时递归展开，循环包含 fail loud）；player×3 与 team/single 逐字重复的五块公共规则维护在 `prompts/common/{tank-noun,language,damage-semantics,hp-loss,evidence-logic}.zh.md` 复用，展开后内容与直接内联等价。`PromptRuleContractTest` 强制「展开后 ZH 片段与 Java 常量逐字一致 + EN/RU 本地化无中文残留」。

| key | 文件 | 对应常量 |
|---|---|---|
| player/fallback | `prompts/player/fallback.zh.md` | `PlayerPromptRules.SYSTEM_PROMPT`（旧单 Call 兜底） |
| player/single | `prompts/player/single.zh.md` | `PlayerPromptRules.SINGLE_PLAYER_PROMPT` |
| player/tactical | `prompts/player/tactical.zh.md` | `TacticalReviewPromptBuilder.TACTICAL_SYSTEM_PROMPT`（fallback + Harness 规则） |
| team/single | `prompts/team/single.zh.md` | `TeamPromptLocalizer.SINGLE_TEAM_PROMPT` |
| team/autopsy | `prompts/team/autopsy.zh.md` | `TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT_SETTLEMENT_ONLY` |
| prebattle/system | `prompts/prebattle/system.zh.md` | `PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT` |
| prebattle/user-header | `prompts/prebattle/user-header.zh.md` | `PreBattlePromptBuilder.PRE_BATTLE_USER_HEADER`（含 `%s`/`%d` 占位，由 `.formatted()` 填充） |
| prebattle/confidence-legend | `prompts/prebattle/confidence-legend.zh.md` | `PreBattlePromptBuilder.CONFIDENCE_LEGEND` |
| tactical-skills/team-execution | `prompts/tactical-skills/team-execution.zh.md` | `TeamPromptLocalizer.TEAM_EXECUTION_SKILL_RULE` |
| tactical-skills/position-tempo | `prompts/tactical-skills/position-tempo.zh.md` | `TeamPromptLocalizer.POSITION_TEMPO_SKILL_RULE` |
| tactical-skills/hp-trades | `prompts/tactical-skills/hp-trades.zh.md` | `TeamPromptLocalizer.HP_TRADES_SKILL_RULE` |
| tactical-skills/mode-objectives | `prompts/tactical-skills/mode-objectives.zh.md` | `TeamPromptLocalizer.MODE_OBJECTIVES_SKILL_RULE` |

编辑约定：

- UTF-8、LF 换行（加载器会把 CRLF 归一化为 LF；文件末尾换行保留——`confidence-legend` 以换行结尾，勿删）。
- 文件是 ZH 完整 prompt；EN/RU 由 `PlayerPromptRules.localizePlayerSystemPrompt` / `TeamPromptLocalizer.localizeTeamSystemPrompt` 对 ZH 规则片段做字符串替换生成。**展开后 md 内中文规则片段必须与 Java 常量（`COMMON_*_RULE` / `TEAM_*_RULE` 等）逐字一致**，否则 EN/RU 替换失效（`PromptRuleContractTest` 强制）。
- 多文件 AI 复盘已移除（2026-08-12）：`player/multi` / `team/multi` 提示词、`analyzeMulti`、`MULTI_*_BATTLE` AI 分支与团队多视角分区合并全部删除；AI 复盘仅单文件（`AiReplayBatchPolicy.MAX_FILES=1`），由 `AiReplayReviewService.analyzeResults` 直接按 `ReplayProcessingCapabilities.aiAnalyzable(scope)` 判定 eligibility（单一 SSOT；`BatchAnalyzer` 的 group/representative machinery 仅作为测试设置复用）。对应旧多文件批量分析的 `ReplayAnalysisMode.MULTI_*`、`DefaultReplayProcessingFacade.processBatch`/`buildBatchResult` 与 `ReplayBatchProcessingResult`/`ReplayBatchSummary` 已删除（无 current production consumer；legacy `/api/replay/process`、`/api/replay/reconstruct-batch`、multipart analyze 一律 410，已不存在多文件批量端点）。

### Team Tactical Skill v0.1

Team `Call #2` 在既有 `Canonical BattleTimeline → deterministic evidence → grounded JSON` 链路中，通过 `AiPromptLibrary` include 注入四个紧凑模块：团队执行、位置与节奏、HP/火力交换、模式与目标。模块只提供经验性决策考虑，不产生 `BAD_PUSH`、`HALF_COMMIT_ERROR`、`GOOD_TRADE` 等后端结论；`EpisodeDetector`、Focus Window 和现有 Team evidence 继续是唯一事实输入。

Team Review 不接受战术地图计划，也没有语音/通信证据。模型必须复盘可观察的执行：进入时序、局部兵力、commitment、信息更新、位置/轮转和交换结果；无法由证据支持的推断直接跳过。`primaryDiagnosis` 保留在 envelope 中，但表示本场最重要的结论，允许“没有明显确认错误”“关键成功因素”或“对手处理更好”。Strategic Prior 明确只是阵容与可能性的基线，不能作为实际队伍计划或单独的判错依据。

模式模块中的 Supremacy +40 击杀价值、约 750–800/800+ 点数压力梯度，以及 Assault 约 100 秒完整捕获、70–80 秒警戒区，均是 LLM 的经验参考，不是精确阈值状态机；实时总分仍遵守现有未解码边界。Golden cases (`team-tactical-skill-v01-a` 至 `h`) 覆盖半途执行、commitment 后新情报、成功线路的二次进攻、无明显错误、通信归因禁用和两种模式目标排序。

### AI 复盘评估 harness（golden cases + lessons）

- **CI 模式**：`AiEvalHarnessTest`（`@Tag("ai-eval")`，默认构建运行）加载 `src/test/resources/ai-eval/cases/*.json`（synthetic Team 场景），用 `TeamAiPromptBuilder.single` 构建 user prompt，并加载实际 Team system prompt（不调 AI），执行 `prompt_contains` / `prompt_omits` / `system_prompt_contains` / `system_prompt_omits` 断言，写 `target/ai-eval-report/report.md` + `report.json`；任一 FAIL 构建失败。A–H `team-tactical-skill-v01-*.json` 是 prompt contract / static golden cases，只证明提示词契约，不单独证明实际 LLM tactical behavior。

#### AI 测试分层与 live provider 隔离

| 类型 | 内容 | 默认 CI/`mvn test` 行为 |
|---|---|---|
| Unit / deterministic | fake/mock gateway、gateway 单测、loopback HTTP boundary、prompt/validator contract | 正常执行；不访问外部 provider |
| AI eval | `AiEvalHarnessTest` 等基于 synthetic case 的 prompt/evidence 确定性评估 | 正常执行；不调用 LLM，不消耗 provider token |
| `ai-live` probe | 真实 `SpringAiChatGateway` + DeepSeek/provider 请求，例如 team review E2E/repro probes | JUnit `@Tag("ai-live")` 且 Maven Surefire 默认排除；人工显式运行，可能产生 token/cost |

`AI_API_KEY` 表示机器具有 provider 访问资格，不表示普通测试具有调用意图。真实 probe 必须同时满足：显式选择 live 测试、显式清空 `-Dai.probe.excludedGroups=`、提供不写入仓库或日志的 `AI_API_KEY`。缺少 key 时 probe 仍通过 JUnit assumption skip；默认 `mvn test` 即使环境中存在 key 也不执行 `ai-live`。普通 GitHub Actions CI 不注入 DeepSeek secret，不新增 paid/live AI job。

当前 `wotb-web` 真实 DeepSeek probes 为 `TeamReviewRealE2EProbeTest`、`TeamReviewBatchE2EProbeTest`、`TeamReviewDetailedReproProbeTest` 和 `TeamTacticalSkillLiveBehaviorEvalTest`。后者复用现有 `SpringAiChatGateway` 的 Team Call #2 JSON 请求，逐例解析最终 envelope，再执行 `primaryDiagnosis`、自然复盘标题、grounding validator、禁猜通信/call、禁 authoritative tactical label 以及 A–H 行为检查；A–H 的 live scenario 只提供事实，预期战术结论只存在于 assertion，不写进送给模型的场景。报告包含 case id、provider/model、raw response、final analysis、每项检查与 violation reason，写入 `target/ai-eval-report/team-tactical-skill-live-report.{md,json}`。它要求额外的 `-Dai.tactical.live.enabled=true`，并且仍需显式选择测试和清空 `-Dai.probe.excludedGroups=`，因此默认 CI/普通 `mvn test` 不执行；它是未来手动诊断质量的工具，不是 CI 或 PR 合并条件。
`LiveAiTestIsolationTest` 对已知 probe 的 tag、测试源码中的 production external-provider 组合信号以及 `ai.probe.excludedGroups` POM contract 做 deterministic guard；loopback、Mockito、配置断言和 deterministic eval 不因引用 gateway 类型而被标为 live。

PowerShell 人工运行示例（从 `java` 目录执行；将占位符替换为通过带外方式取得的 key/回放路径）：

```powershell
$env:AI_API_KEY = "<provided-out-of-band>"
mvn -pl wotb-web -am test `
  "-Dtest=TeamReviewRealE2EProbeTest" `
  "-Dai.probe.excludedGroups=" `
  "-Dprobe.replay=<file>"

mvn -pl wotb-web -am test `
  "-Dtest=TeamReviewBatchE2EProbeTest" `
  "-Dai.probe.excludedGroups="

mvn -pl wotb-web -am test `
  "-Dtest=TeamReviewDetailedReproProbeTest" `
  "-Dai.probe.excludedGroups=" `
  "-Dprobe.replay=<file>"

mvn -pl wotb-web -am test `
  "-Dtest=TeamTacticalSkillLiveBehaviorEvalTest" `
  "-Dai.probe.excludedGroups=" `
  "-Dai.tactical.live.enabled=true"
```

- **空间分离证据（Backend Evidence Boundary）**：`TeamSeparationEvidenceSkill` / `PlayerSeparationEvidenceSkill`（wotb-core）从阵型簇/移动段/交火推导中性 `SPATIAL_SEPARATION` 证据（`kind=OPENING_SPREAD` / `SEPARATION_WINDOW` + 距离/距离增长/静止占比/局部敌情/承伤/输出/阵亡/主力簇位移等确定性测量），`TeamEvidenceFormatter` 渲染 `SPATIAL_SEPARATION_EVIDENCE` 段（P3 optional）。不再输出 `SOLO_DELAY` / `SOLO_DETACHED` / `teammateBenefit` 等战术 verdict——是否拖延/脱节由 LLM 综合判断。
- **player 路径同规则**：`PlayerSeparationEvidenceSkill`（wotb-core）复用 `RouteSkill` 空间分离窗口推导同口径中性证据（个人复盘同样不输出拖延/脱节 verdict），已在 `EvidenceSkillEngine` 注册；player prompt（fallback/single/tactical）追加三语 `SEPARATION_EVIDENCE_RULE`。
- **争霸赛占点与点数胜负结束方式**：`FriendlyEnemyResult.resolveTeamBattle` 新增派生 `pointsEndReason`（`REACHED_1000`=双方均有存活 + 标准业务规则 + 时长<420s：某一方达到 1000 分上限导致提前结束，与胜方解耦，不使用任何点数字段；`TIME_EXPIRED`=标准规则 + 时长≥420s：时间耗尽，双方终局比分未解码；`UNKNOWN`=类别未知 / rosterComplete=false / 时长缺失；全歼=NOT_APPLICABLE），`TeamEvidenceFormatter` 在 `CAPTURE_AND_POINTS` 段输出 `pointsEndReason`（逐人/双方占点分、`pointsDecided`、占领点区域）；`TeamAiPromptBuilder` mandatory header 同时输出 `result` 与 `resultSource`（BATTLE_RESULTS 权威 / SURVIVOR_SETTLEMENT 结算存活推导 / UNKNOWN；POINTS_INFERENCE 已停用——枚举保留但不再产出，fail closed）；**所有依赖完整逐人结算的存活/点数推断共享"结算阵容完整"前提**（`Battle.rosterComplete`：ReplayParser 校验名册 #201 与战绩 #301 账号集合一致且每个账号队伍一致才为 true；不写死每队 7 人，完整名册的非 7v7 训练房同样生效）：SURVIVOR_SETTLEMENT 推导与 `annihilationSuffix` 在阵容不完整时一律 fail-closed；winnerTeam 缺失 + 双方均有存活 → 胜方 UNKNOWN（结束方式仍按标准时限证据判定，用于结果行后缀，禁止比较占点字段推断）；winnerTeam 存在时胜方为 BATTLE_RESULTS，`pointsEndReason` 正常判定（rosterComplete=false 时 UNKNOWN，result 只写通用「点数判定」）；`CAPTURE_AND_POINTS` 在阵容不完整时输出 `SETTLEMENT_ROSTER_INCOMPLETE=true` / `pointsTotalsUnavailable=true` 并抑制占点分总量；提示词 `CAPTURE_RULE`（ZH/EN/RU，含 2d 条阵容不完整口径）写明结束条件三分法——全歼胜（双向：全歼敌方获胜 / 被敌方全歼落败）/ 1000 分提前结束（某一方达到 1000 分上限，具体胜方由 winnerTeam 决定；缺失时只写「某一方达到 1000 分导致提前结束，具体胜方未知」，双方终局比分一律 UNKNOWN，不把 1000 分配给任何队伍）/ 时间耗尽点数决胜（仅双方均有存活且标准规则可证），`TIME_EXPIRED` 叙述必须写「时间耗尽」，禁止用 <1000 的中间比分作为获胜理由，禁止把失败方被全歼写成「全歼敌方获胜」；团队剖析胜负标签按结束方式输出「（时间耗尽点数判定）/（达到 1000 分提前获胜）/（某一方达到 1000 分提前结束，具体胜方未知）/（时间耗尽点数判定，具体胜方未知）/（点数判定）/（全歼敌方）/（被敌方全歼）」。`TeamPromptLocalizer` 三语 `SOLO_INTENT_RULE` / `CAPTURE_RULE`。
- **争霸赛点数口径（未证明项，禁止用于终局比分）**：`victoryPointsEarned`(#32) 的精确定义及是否包含被动占点增长/击杀夺分等调整仍未证明——已知计算口径（占点分+40×击杀−40×阵亡）已撤回，证据只输出原始结算字段（victoryPointsEarned/Seized、kills、deaths）；每据点每 tick 产分与 tick 间隔均未解码（无任何已验证的 tick 产分规则），不得用 tick 数或占点分计算终局比分；击杀夺分 40 分仅作叙述口径（`KILL_STEAL_POINTS` 不参与计算）；实时点数/基地占领/终局比分尚未解码（`PointsEvidenceProbeTest`/`ShotSpottingStreamProbeTest` 记录候选，语义 UNKNOWN）。
- **点数局势证据与规则（PointsSituationSkill，P3 optional）**：wotb-core 纯函数 `PointsSituationSkill` 产出三类可证明信号——击杀夺分时间线（±40/击杀业务规则按双方阵亡时刻对齐，叙述口径非实时比分；只表达击杀换分项净差值，禁止说成整体点数领先/落后、禁止反推早期点数状态）、占领点区域位置存在（服务器位置流在 CONTAINS_CONTROL_POINT 九宫格内的存在，几何可证，位置存在≠占点产分）、进攻推进窗口（车辆从非占领点区域移动进入占领点区域，仅 MOVING 采样位移判定，不声称意图；同队窗口 8s 合并）；wotb-web `PointsSituationEvidence` 复用 TeamEntityMapper 从重建事件流采集双方轨迹（2s 采样、battle-relative 秒），推进窗口与 `DamageWindowClusterer` 掉血窗口联接为「推进方窗口内承受伤害=防守方过路费」（OBSERVED_DAMAGE_IS_PARTIAL 时抑制数字）；接入点：团队复盘 `TeamEvidenceFormatter.appendPointsSituation`（与其它 P3 optional 同级、超预算整体裁剪）、随机战 Harness Call #2（裁剪阶梯在 phases 之后）、旧路径 fallback/full/fullNoRecon（fallback 与无重建路径仅击杀夺分时间线）。prompt 规则三语：team/single 占点规则 8（击杀换分项净劣势/优势只提示「点数压力方向」，是否抢点/防守拉交叉由 LLM 综合推断、禁止固定映射；进攻掉血情境化；过路费不足=防守失误必须由 LLM 形成 supported inference；fail-closed）、player tactical/single/fallback 点数局势规则（`PlayerPromptRules.POINTS_SITUATION_RULE` zh/en/ru 逐字契约）、autopsy 结算级点数规则（禁止编造比分与窗口级判断）。
- **生产反馈闭环**：人工评估 + 用户反馈登记模板见 `docs/ai-eval/feedback-checklist.md`；可复现反馈转 lesson + synthetic case 回归。评估人工，不引入 LLM-as-judge；真实回放不入库。

关键约束：

- **地图战术语义层**：`MapTacticalSemanticsRegistry` 加载 `common/map-semantics/*.semantic.json`（由 `map-semanticizer` 从 Wot Blitz 客户端 SC2 + heightmap 解码生成，含 `areas` / `relationships` / `spawnSemantics` / `mapCodes` / `gridRegions` / `verified` / `source` / `displayName` / 区域 `confidence`；`displayName` 为 `map_names.json` 的 en 名，未收录回退 mapId）；按 `mapCodes` / `mapId` / token 边界别名查询，未收录地图明确 UNKNOWN，禁止编造区域语义。`relationships` 为 `List<TacticalRelationship>`（from/type/to/reason/confidence 原样保留，不做分组/改名）：ADJACENT_TO 仅表示确定性分析网格相邻，不代表可通行路线/视线/交叉火力；CONTAINS_CONTROL_POINT 与 CONTAINS_STRATEGIC_POINT 保持区分。Call #1 Prompt 输出可信度图例：EXACT_CLIENT_DATA/EXACT_SCENE_DATA=客户端直接事实、NAME_HEURISTIC=对象位置精确但类别由资源名推断、GRID_RULE_DERIVED=区域名称/边界/合并是规则候选、RULE_DERIVED_CANDIDATE=favors/risks 是假设候选；`verified=true` 渲染"人工地图核验: 已完成"（2026-08-12 起仓库内 33 张地图语义全部核验；`verified=false` 时渲染"尚未完成人工地图核验"）；语义段显示「地图: "Desert Sands"（内部 code: "desert_train"）」。CONTROLS / ENABLES_PRESSURE_AGAINST 未提供时禁止声称；出生点语义仅在有数据时输出。每个 AREA 标注 `gridRegions`（GRID_REGION_1~9），与 `MapRegionResolver` 同一坐标约定（回放 raw 按每图 playableBounds 推导的 per-map profile（`MapCoordinateProfileRegistry`，含中心偏移与半边长）→ 500×500 canonical → 3×3）；无语义数据时 GRID_REGION_1~9 仍只是位置编号。TEAM_A=队伍1、TEAM_B=队伍2 固定映射。
- **双 Call 预算**：Call #1 独立 45s stage budget（`AiChatRequest.callTimeoutSec`），Call #2 使用剩余预算并留 10s 安全余量；Call #1 失败后剩余 < 60s 时不启动旧路径 fallback；总 deadline = `AI_CALL_TIMEOUT_SEC`。
- **结构化 JSON 调用关闭 thinking**：`PRE_BATTLE_STRATEGIC_PRIOR`（Call #1）与 `TEAM_AUTOPSY` 在请求层强制 `thinkingEnabled=false`（`reasoningEffort=null`）。生产实测 DeepSeek thinking（`AI_REASONING_EFFORT=max`）会把整个输出预算（Call #1 4096 / Autopsy 2048）消耗在 reasoning 上、`finish_reason=length` 且 content 为空（`AI_EMPTY_RESPONSE`），导致 Call #1 静默降级、战犯/MVP 段缺失；关闭后直接输出契约 JSON。**Call #2 主复盘默认也关闭 thinking**（`AI_THINKING_ENABLED_CALL2=false`，见配置表）——DeepSeek 推理模式下 `reasoning_content` 先流、content 末尾一次性到达，破坏 SSE 逐段流式；需要推理深度时开回 `AI_THINKING_ENABLED_CALL2=true`（流式体验由网关分块兜底保证）。
- **伤害语义（损失血量 vs 格挡伤害）**：AI 提示词统一用「损失血量」称呼 `damageReceived`（不再叫「承伤」），并强制区分两个概念——格挡伤害（`damageBlocked`）越高越好；损失血量本身中性，评价必须结合车型职责、存活时长、输出贡献与战况（重坦/装甲车抗线掉血可接受，薄皮输出车无价值掉血或过早阵亡前大量掉血才是问题）；不得仅因损失血量高判定表现差。个人复盘（fallback/harness）、团队复盘与 Team Autopsy 共用 `COMMON_DAMAGE_SEMANTICS_RULE`（ZH/EN/RU 三语，Team Autopsy 为 ZH）；战犯证据类别同步改写为「损失血量明显偏高且与车型职责/存活时长/输出不匹配」。
- **掉血时间范围（强制规则 + 窗口证据）**：新增 `HP_LOSS_TIME_RULE`（ZH/EN/RU，player/team 提示词共用）——凡提及掉血/损失血量必须给出明确时间范围（X分XX秒–X分XX秒）与掉血量，禁止笼统描述；很短窗口内大量掉血先描述为「短时间集中掉血/高压掉血窗口」，仅当窗口总跨度 ≤15 秒、解析出 ≥2 个不同攻击者且无未解析攻击者时才可写「被多车集火」，攻击者无法解析、只有 1 个攻击者或窗口总跨度超阈值（含 ≤10s 间隔链式聚类的大跨度窗口）时不得断言集火；正常慢速掉血不误标，无窗口证据写「无法确定」。证据侧：`DamageWindowClusterer`（wotb-web）把受击者视角的逐次伤害事件按 ≤10s 间隙聚类成掉血窗口（起止时间 + 总掉血量 + 命中次数 + 不同攻击者数 + 攻击者未解析标记 + `focusFireCandidate`——仅总跨度 ≤15s、攻击者 ≥2 且无未解析时为 true）；`DamageEventIdentityResolver`（wotb-web，唯一实现）负责 DamageEvent 攻击者/受击者身份解析——真实 decoder 的账号字段恒为 null，沿 `ParticipantMappingEvent` 的 entityId→accountId 映射（复用 `TeamEntityMapper`）按 `attackerEid/victimEid` 解析，合成 fixture 直填账号优先，不再依赖生产中恒为 false 的 `lethal()`；同解析器同时接入逐次伤害段 `PER_HIT_DAMAGE_EVENTS`、逐对手对炮段 `DAMAGE_EXCHANGE_BY_OPPONENT` 与掉血窗口。player 路径（fallback 与 Tactical Harness 主路径同格式/同口径）输出 `RECORDER_DAMAGE_RECEIVED_WINDOWS`，团队路径输出 `MEMBER_DAMAGE_RECEIVED_WINDOWS`（均受 `OBSERVED_DAMAGE_IS_PARTIAL` 覆盖率抑制，覆盖不全时输出 UNAVAILABLE 不给数字）。结算级 Team Autopsy 无事件流，不提供时间窗口。
- **掉血窗口严重度（进场满血 provenance + fail closed）**：`DamageWindowClusterer.DamageWindow` 带 `damageVsEntryMaxHpPct` + `entryHpProven`。进场满血契约（真实回放 probe `EntryHpProbeTest` 证伪「整场 max current HP = 初始满血」——绝大多数车辆首个 positive 样本与首次受击同刻且低于 tankopedia base）：`EntryHpSource.OBSERVED_EXACT` 仅在存在严格早于首次受击（或从未受击）且 ≥ base 的样本时成立，此时分母 = 已证明进场满血（含装备/物资加成）；否则 `BASE_FALLBACK`（只允许 tankopedia base 作 baseline，base 是 entry 下界）或 `UNKNOWN`。跨度 ≤10s 且伤害 ≥75% 已证明进场满血量 → `criticalWindow`（短窗高额伤害窗口）；**base baseline 一律 fail closed 不判 critical**（真实 entry ≥ base，按 base 判定会误报）；不判定「被秒杀」（无法证明窗口起始血量、窗口内阵亡与精确进场血量）。证据段按 provenance 输出「伤害/进场满血pct」或「伤害/base满血pct」，prompt 规则（player×3 + team/single 三语）强制定性并给时间范围。
- **观察性语义**：HP 动量只按两端共同可靠观察实体计算 delta（unspot / STALE 不伪造 HP swing；confirmed DESTROYED 按 0 HP 计入 lethal loss）；Call #2 只输出安全比较后的 HP_MOMENTUM 证据、不输出 raw 逐采样 HP 曲线，HP before/after/swing/coverage 必须来自同一 comparison cohort（禁止跨 cohort 拼接）；局部支援 denominator 使用当前时刻存活名单（已阵亡车辆不污染覆盖、存活敌军全部观察可重新 EXACT），敌军数量表达为"至少观察到 N"，仅两侧完整覆盖才 EXACT；隐藏/点亮不制造 local-number flip；Route 敌方人数优势需友军侧完整覆盖（observedEnemy 作为真实敌军下界）。
- **观察性**：HP 动量带 `observedCoverage`，覆盖率低时置信度降为 PARTIAL；局部支援只统计 `OBSERVED` 位置，STALE/UNKNOWN 不计入。
- **降级阶梯**：非 ZH / 无重建 / 录像者未解析 / 特征不可用 / Call #1 失败 / 无证据 → 旧单 Call 路径；对外 API 与响应结构不变。
- **Team 复盘也应用 Call #1**：随机战个人复盘（`TacticalReviewHarness`）与训练房/联赛团队复盘（`TeamReplayAnalysisService`）都先执行 Call #1（Pre-Battle Strategic Prior：基于地图与双方阵容的赛前先验，含开局/分路假设）；团队路径按视角队伍把 prior 重标为 TEAM_A=你的队伍（teamDisplayLabel，无值时「我方」）/ TEAM_B=对方队伍 后注入团队 Prompt（视角队伍为 2 时交换 Call #1 的 TEAM_A/TEAM_B）。该 prior 只是战略基线/可能性空间，不是实际队伍计划；Call #2 以可观察执行和确定性证据为准，偏离 prior 不能单独构成失误，未知的计划、call 或通信原因不得补写；Call #1 失败不阻断团队复盘（仅缺 prior 段）。
- **AI Review V2.1 — Team Review Quality Gate（docs/features/team-ai-review.md，2026-08）**：Team AI 复盘推理质量契约（FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN）收敛——真实失败案例（20260817 WildCat SPHT 回放）暴露的因果过度断言（位置→视野、掉血→掩体、结算→时间线因果、自创精确数字、残局万能规则、自创车辆角色）在 prompt 契约层禁止（prompts/team/single.zh.md + TeamPromptLocalizer 三语常量，PromptRuleContractTest 强制逐字一致）。输出结构改为「核心结论 / 关键决策窗口（1-3）/ 可确认问题（1-3）/ 训练建议（1-3 且必须对应可确认问题）/ 对方关键威胁（可选 1-3）」，删除强制 10 章节与「开局散开=图控/拿视野」危险规则（player/team 同步改为中性行为，证据不足 UNKNOWN）。Focus Window selector：TimelineFocusWindowSelector（wotb-core replay.timeline）用 bounded core window（≤20s 有界子区间，sliding）识别短时间连续减员（如真实回放 109–128s 本方 3 死对方 1 死），不链式吞并窗口外阵亡；评分按「绝对局势 swing（|fd−ed|）优先于总死亡密度」+ HP/点数/交火支撑；由 TeamAiContextCompiler.renderFocusWindowsSection 注入 TEAM REVIEW FOCUS WINDOWS 段（与 TACTICAL TIMELINE 同一已验证 timeline）。Team Autopsy 归因降级：结算级标签「主要战犯/MVP」→「重点复查对象/高贡献者」（prompt + TeamAutopsyPromptBuilder.renderSection），仅凭结算与死亡时间不得写成确定战术过错（earlyDeath/weakOutput 只是规则候选）。车辆角色统一来源：tankName/vehicleClass/tier 三路径（主复盘/Autopsy/赛前）同源 ReplayDisplayNames，角色语义唯一来源 TankTacticalProfileRegistry，prompt 禁止自创「薄皮输出型/前排/肉盾/狙击车」等角色。回归：TimelineFocusWindowSelectorTest / TeamReviewQualityGateContractTest / TeamFocusWindowsRenderTest / TeamTankRoleConsistencyTest / golden case team-review-causal-overreach-01 / 真实回放 probe TeamReviewRealReplayProbeTest（common/data 样本自动回归）。
- **PR #103 Final Quality Gate（2026-08）**：① Team 用户可见名称——`TeamPerspectiveLabelResolver` 拆分为 `resolveDisplayLabel`（唯一 dominant 且严格多数 → clan tag 最常见 casing；否则空串，绝不返回 `队伍-XXXX`）与 `resolveStableKey`（internal-only 身份键）；web 层 `TeamRosterResolver.resolveDisplayLabel / resolveOpponentDisplayLabel` 独立解析双方，TeamAiPromptBuilder header 输出 `teamDisplayLabel` / `opponentDisplayLabel`（无可靠 clan → `(none)`），PreBattleSectionRenderer 无 clan 只显示「我方画像/对方画像」，Team Autopsy 渲染侧 fallback「本方」；prompt 移除「主要军团」proper noun，禁止自创「X 对阵 Y」标题。② 真人教练风格——新增「内部证据与用户正文的关系」规则（AUTHORITATIVE_*/OBSERVED_*/FACT/UNKNOWN/canonical 等是内部推理材料，正文不得复述/不解释证据体系）；删除 blanket「无法从输入确定时必须写明…」改为 selective UNKNOWN（4 条件）；Focus 五项改为内部思考框架、正文自然 1-3 段不机械输出小标题；中文默认 600–1200 字（简单 400–700、复杂 ≤1500），数字只保留支撑核心判断的。③ Team Call #2 独立输出上限——`wotb.ai.team-review-max-output-tokens: \${AI_TEAM_REVIEW_MAX_OUTPUT_TOKENS:4096}`，effective = min(global, team)，同时用于 AiPromptBudgetGuard 与 AiChatRequest；Player Call #2 保持 global。④ Team Autopsy 用户可见渲染隐藏 confidence/PARTIAL/UNKNOWN/settlement-only/规则候选/provenance（internal structured contract），`mvps`/`biggestLiabilities` 允许为空。⑤ Opening Spread battle-specific inference——「敌方主力确认后本方没有及时合流」是本场具体结论，需「重新集中推断规则」4 证据门（enemy-known 支持主力确认 + 本方多分离集群 + 后续未靠近 + 首次关键交火在一侧集群）；known=4/unknown=3 只能说「至少观察到 4 辆，其余 3 辆位置不明确」，禁止「7 辆主力已集中在这一侧」；anti-future-leak 禁止后知信息回填。⑥ 真实回放 Golden probe 改为硬断言（样本存在时 friendlyDeaths==3、enemyDeaths==1、BEFORE 7v7、AFTER 4v6、core 接近 109–128s ±8s），删除 print-only matchesNarrative 验收。
- **Team Autopsy（仅 team perspective 结算级）**：随机战斗个人复盘不评判 MVP/战犯。战犯/MVP 只应用于训练房/联赛团队复盘——`TeamReplayAnalysisService` 单团队单元成功后追加结算级独立 TEAM_AUTOPSY 调用：Autopsy 输入只有权威逐人结算（**无** Call #1 prior / Critical Window / Route 证据，使用结算级 system prompt），与团队主复盘的 Call #1 注入互不影响。**完整七人门禁**：仅当 recorderTeam 恰好存在 7 名有效本方玩家时才调用 Gateway（0～6 人或超过 7 人跳过并记录 roster_incomplete，保留团队主复盘）。**settlement-only 置信度边界**：LLM 生成的 contribution / MVP / 战犯判断 confidence 只能 PARTIAL/UNKNOWN，EXACT/INFERRED 整段拒绝。玩家身份用 `playerKey`（本方 roster 稳定编号，同队同名坦克可区分）；Parser 要求 players 的 playerKey 集合与 roster **完全相等**（不缺失/不额外/不重复，超长不截断）、MVP/战犯各自 ≤3（超限拒绝）、每条 verdict 引用有效 playerKey 且列表内不重复、reason 非空、evidence 非空、判胜≥1 MVP / 判负≥1 战犯、空结果拒绝；渲染按 playerKey 回查后端权威昵称/坦克名。胜负与段落渲染使用实际队名（`TeamPerspectiveLabelResolver`，如 CHRD），Team Autopsy 枚举渲染中文化（HIGH→高、PARTIAL→部分，MVP 保留英文）；阵亡时刻与主力质心距离（`deathProximityMeters`，OBSERVED 位置 + 观测时间差 + 置信度）用于脱节判断，禁止用九宫格编号差推断距离。`TeamAutopsyStatsBuilder` 只构建 recorderTeam 本方玩家，weakOutput 均值仅本方；结算字段为 Battle Result 事实，earlyDeath/weakOutput 为规则候选（各自置信度），deathInCriticalWindow 继承窗口 confidence 且结算级代理不得 EXACT；死亡时间线仅本方。TEAM_AUTOPSY 预算 = min(30s, 整体剩余 - safety margin)，不足不启动并记录 budget_exhausted；`AI_CANCELLED` 重新抛出。
- **相对纵深/血量测量（中性）与区域覆盖测量**：`RelativeDepthHpEvidence`（wotb-web，原 BehindLineHpEvidence 中性化重构）确定性测量——reference 由<b>纯几何算法</b>选择（本阶段距观测敌方最近的存活本方成员，不是「扛线队友」之类的战术角色）；成员血量比率 ≥ reference × 1.2 且距敌比 reference 更远 是 salience filter（只决定哪些成员值得给 LLM 看，不是战术判定；tank profile 只作为静态事实附注，不参与筛选）；输出只报成员/reference 的 accountId + 静态 profile 事实 + hpRatio/hpRatio差 + memberDist/referenceDist/relativeDepthM + observedAttackEvents + coverage（COMPLETE/PARTIAL；partial 时 0 个已观测攻击事件 ≠ 无输出，禁止推断「避战」）+ HP_RATIO_UNKNOWN（血量数据不足只给位置与观测事实）；跨阶段出现次数是中性 salience，不是负面分级；不再输出吸血/避战/利用队友/「前线型未上前线」/degree 轻中重。团队路径遍历本队全体，个人路径仅录像者自己；Team Autopsy 注入 RELATIVE_DEPTH_HP_MEASUREMENT 段供综合位置测量参考。`FormationDepthEvidence` 纯几何纵深三分位（GEOMETRIC_FORWARD/GEOMETRIC_MIDDLE/GEOMETRIC_REAR 恒输出，不引用 tank profile 分类；已移除 isFrontlineCapable/isBacklineCapable/noFrontlineVehicle/noBacklineVehicle/lineupStructure）+ 九宫格「区域覆盖测量 REGION_COVERAGE_MEASUREMENTS」（每区输出 ownPositionPresence/enemyPositionPresence、ownWeightedCoverageScore/enemyWeightedCoverageScore（距离加权火力覆盖分 F=Σ 火力权重/(1+d/100)，权重只按车种/burst/sustained 静态事实）、ratio、coverageCompleteness；位置参考不完整时只输出 ownPositionPresence，不输出分数对比）——只输出确定性测量，不输出 own/contested/enemy 权威控制权标签；哪方「实际控制/压制某区」由 LLM 综合判断（Backend Evidence Boundary，PR #103 第三轮 + 第四轮收口）。

- **新增共享资源**：`common/tank_tactical_profiles.json`（精选 Tier X + 车型级默认 fallback），`wotb-core/pom.xml` 与 `docker/Dockerfile.backend` 已同步复制。

## Natural Coach Mode + Factual Consistency Guard（PR #103 之上，2026-08）

> 核心原则：**Backend 负责「不许瞎说」，LLM 负责「必须有看法」**。Backend 把事实整理到
> LLM 能可靠理解的程度，但停在战术判断之前；LLM 负责主判断/战术解释/优先级/训练建议；
> Validator 只检查 LLM 有没有改写 Backend 事实；Renderer 只负责展示。

### 数据流（Team Call #2）

```
Replay → Parser → Canonical BattleTimeline → 确定性 Grounding Facts（证据编号 E1xx）
  → TeamAiPromptBuilder（TACTICAL TIMELINE + FOCUS WINDOWS + 全部确定性证据）
  → Call #2（system prompt 要求 JSON envelope）→ TeamReviewEnvelopeParser
  → TeamFactualConsistencyValidator（V1–V6）→ PASS → 流式输出 reviewMarkdown
                                              → FAIL → 反馈 LLM 自修（targeted → full → fail-safe）
```

### Team Call #2 structured envelope（内部 grounding 契约）

```json
{
  "primaryDiagnosis": {"title": "...", "reasoning": "...", "supportingEvidenceIds": ["E1xx"]},
  "reviewMarkdown": "完整自然语言复盘（用户最终看到的全部内容，主标题 ## 团队复盘）",
  "claims": [{"text": "涉及数值/时间/位置/玩家事件的陈述", "evidenceIds": ["E1xx"]}]
}
```

- `reviewMarkdown` 由 LLM 自由写出，Backend 绝不拼接主体；`evidenceIds` 只出现在 structured
  字段，validator 拦截其泄漏进用户正文（INTERNAL 检查）。
- Natural Coach Mode：主正文为 3-5 个自然段（简单 2-3、复杂约 5），无固定章节模板；
  Focus Window 是内部 attention primitive（「这里最值得集中分析」），不是用户标题结构；
  必须有唯一 PRIMARY DIAGNOSIS（禁止「无法判断/可能性枚举」）；「教练不是司法鉴定员」——
  事实必须准确，战术判断不要求数学证明。

### TeamFactualConsistencyValidator（wotb-core `com.wotb.core.replay.evidence`，确定性）

只检查「LLM 有没有改写 Backend 事实」，**绝不判断战术观点**（「这局主要问题是第一次正面交换」
「应该先回收」等 coaching judgment 一律放行）：

| 检查 | 内容 |
|---|---|
| V1 temporal ownership | 声称的时间窗口必须包含其引用的阵亡/存活变化事件（含正文窗口内点名阵亡） |
| V2 player event correctness | 玩家阵亡时间与后端事实一致（容差 2s；紧邻 ±20 字符窗口，避免把句内时间范围误判） |
| V3 alive transition | 存活变化（如 7v7→4v6）必须存在于后端 step 或 FOCUS_WINDOW 聚合前后（正文三语 + structured value 机器格式） |
| V4 position temporal grounding | 某时刻位置数量不得超出该时刻区域快照（±6s 最近快照）；**structured region+count 为精确语义（exact == actual）**，at-least/subset 标记放行下界/子集陈述 |
| V5 CURRENT / LAST_KNOWN | 敌方 LAST_KNOWN 不得写成「此时就在这里/正在某区」/ "is right here now" / "прямо здесь"（structured + 正文双路径，ZH/EN/RU 短语覆盖） |
| V6 unsupported hard facts | 无 LOS/spotting 证据的硬事实化表达（进入所有炮线/LOS/掩体/点亮/瞄准，ZH/EN/RU 短语覆盖），除非已降级为「更可能/从交换结果看/如果当时」/ more likely / более вероятно 级别；structured claimType 声明 LOS/SPOTTING/VISION → 一律 FAIL（无 evidence kind） |
| EVIDENCE / OUTPUT / INTERNAL | 引用不存在证据编号 / 空输出 / 证据编号泄漏进正文 / 缺主判断 |

> **三语契约**：validator 优先按 structured claims 的**机器字段**做语言无关校验
> （`timeSec` battle-relative 秒 / `region` 1-9 / `count` / `subject` / `value` 存活变化机器格式 /
> `claimType`），正文自然语言仅作兜底（时间解析支持 `X分Y秒` / `1:49` / `109s` / `1m49s` /
> `1 мин 49 сек` / `109 seconds` / `109 секунд` 等三语常见格式；位置/LAST_KNOWN/LOS 短语列表
> ZH/EN/RU 三语覆盖）。纯战术观点 claim 可无机器字段。
>
> **Structured Factual Contract（fail-close）**：`TeamReviewEnvelopeParser` 对
> claims 强制 machine schema——`claimType` 必填且 ∈ {DEATH, ALIVE_TRANSITION, POSITION_REGION,
> ENEMY_POSITION, TACTICAL}（LOS/SPOTTING/VISION/LINE_OF_SIGHT 显式禁止类型 → reject/rewrite；
> **P0-4 容错**：claimType 缺失/未知变体按机器字段 deterministic 推断——knowledge→ENEMY_POSITION、
> region+count+side+countSemantics→POSITION_REGION、value 机器存活变化→ALIVE_TRANSITION、
> subject+timeSec→DEATH、纯文本陈述→TACTICAL（正文由 validator 文本检查兜底，不浪费 LLM retry））；
> 每种 factual claimType 的 required fields 强制（DEATH=subject+timeSec+evidenceIds；
> ALIVE_TRANSITION=value 机器格式+evidenceIds；POSITION_REGION=timeSec+region+count+side
> +countSemantics+evidenceIds；ENEMY_POSITION=subject+timeSec+region+knowledge+evidenceIds；
> TACTICAL 无机器字段要求）；机器字段类型错误（如 `region="six"`、`timeSec="112"`）→ reject/rewrite，
> 不静默 null。validator 对应 machine 校验：V2m（DEATH subject+timeSec）、V3m（value 存活变化）、
> V4m（POSITION_REGION side 感知 friendlyCounts/enemyCurrentCounts + countSemantics EXACT/AT_LEAST/SUBSET
> 机器语义）、V5m（ENEMY_POSITION knowledge CURRENT/LAST_KNOWN 与后端 exact 校验，不靠正文短语）、
> V6m（claimType=LOS/SPOTTING 一律 FAIL）。
>
> **Evidence Binding（最终）**：claims 的 evidenceIds 必须**真正绑定**支撑它的
> evidence fact，不能只靠「全局恰好存在该值/该变化」通过——`requiredEvidenceType(claimType)` 统一映射：
> DEATH→PLAYER_DESTROYED、ALIVE_TRANSITION→ALIVE_COUNT_TRANSITION 或 FOCUS_WINDOW（窗口级聚合，
> 明确允许）、POSITION_REGION→POSITION_REGION、ENEMY_POSITION→ENEMY_POSITION_KNOWN；每个引用必须
> 存在且属于允许类型（借用无关编号/类型不匹配 → `BINDING` FAIL），且至少一个引用 evidence 必须完整支撑
> 该 claim：DEATH=身份（subjectAccountId 优先，其次昵称/坦克名）+时间容差；ALIVE_TRANSITION=value 与
> 引用证据 before/after 一致；POSITION_REGION=引用证据的 side 感知快照（FRIENDLY→friendly、ENEMY→
> enemyCurrent）校验 region/count/countSemantics，证据无该区域数据 → FAIL；ENEMY_POSITION=身份+时间+
> 区域+knowledge 全部一致（只因为 CURRENT==CURRENT 就 PASS 是漏洞）。重复坦克名（如两辆 IS-7）时
> 仅凭 tankName 无法唯一绑定身份 → 必须用 subjectAccountId 或昵称（`BINDING` 歧义 FAIL）。有 evidenceIds
> 时引用证据是 primary source，nearest-snapshot/全局列表只作为无直接 evidence mapping 的 defense-in-depth。
> 正文自然语言短语列表（`就在这里` / "is right here now" / `прямо здесь` 等）仍只作为 defense-in-depth，
> 不是 correctness boundary。claims coverage 最低契约：Grounding Facts 非空且主判断引用
> 证据编号或正文出现可验证事实锚点时，claims 不允许无条件为空（CONTRACT 冲突）。

### 校验失败 → LLM 自修循环（P0 修复后：severity 分级）

```
Draft → validate → PASS → 流式输出
                  → 仅 metadata 冲突（STRUCTURED_METADATA / FORMAT）→ PASS_METADATA 直接输出
                    （正文事实正确时不浪费 LLM retry；P0-2/P0-6）
                  → HARD_FACT 冲突 #1 → targeted rewrite（携带 [V1]…[V6] 冲突反馈，LLM 自行改写）
                  → HARD_FACT 冲突 #2 → full rewrite
                  → 仍 HARD_FACT 冲突 → fail-safe：AI_REVIEW_GROUNDING_FAILED 业务错误（绝不静默输出矛盾）
```

- **severity 分级（P0-2/P0-6）**：validator 把每条冲突分为 `HARD_FACT`（用户可见事实错误：
  阵亡时间/存活变化/位置数量/knowledge/身份/unsupported hard fact——必须阻止输出，可 retry，
  最终 fail-safe）/ `STRUCTURED_METADATA`（evidence binding 类型/时间细节、coverage 缺失、
  非关键 machine 字段——正文事实正确时不阻塞输出）/ `FORMAT`（可 deterministic normalize 的
  格式问题——由 parser 容错处理）。生产已证明旧行为「任何 structured 小错误都 3 次 140k prompt
  全量重写后 502」导致 AI Review 连续不可用，修复后 metadata-only 冲突 0 次额外 LLM 调用。
- Backend 绝不代改句子；校验通过后才把 reviewMarkdown 转给前端（不暴露待改写草稿）。
- 上限：`TeamReplayAnalysisService.MAX_VALIDATION_ATTEMPTS = 3`（draft + 2 次 rewrite，仅 HARD 冲突）。
- **authoritative response source**：`callRaw()` 以 `AiChatResponse.completionText()`
  为唯一权威完整响应（Gateway 契约：callback 是流式增量 progress，正常结束时 completionText 为
  聚合后的完整文本；失败一律抛 `AiUpstreamException`，绝不返回 partial）；每轮 attempt 独立
  `stream()` 调用，不共享 buffer（无「前一轮 buffer 串扰」）。

### Grounding Facts（TeamGroundingFacts，wotb-core）

- **死亡时刻时钟契约**：`PlayerResultFormat.deathSec()` 只读取 settlement `field24 lifeTime`（业务秒值）；
  live reconstruction 事件仅用于 Playback/HP/动画/诊断，不得覆盖 settlement。`TeamGroundingFacts.build` 统一按 `raw > startRaw → raw − startRaw`
  转 battle-relative——compat 入口（无 timeline）必须传 `reconstruction.battleStartRawClockSec()`。
- 从权威结算 + 已验证 canonical BattleTimeline 提取带稳定证据编号（E1xx，确定性顺序：
  阵亡→存活变化→关注窗口→位置快照→敌方位置知识）的事实清单；timeline 为 null（兼容入口）
  时只输出结算可推导事实（阵亡/存活变化），位置/窗口类校验自动 no-op。
- 渲染为 prompt 的 `=== GROUNDING FACTS ===` 段；时间一律「XX分XX秒」。

## AI 分析范围边界

AI 复盘区分两种 scope，互不混用：

### TEAM_PERSPECTIVE（训练房 / 联赛）

- 分析对象是录像者所在整支队伍。
- 保持独立 `perspectiveTeam` 内部语义（用于后端计算，不暴露给 AI）。
- 不使用随机战斗的 FRIENDLY/ENEMY formatter（`PlayerAnalysisPromptFormatter`）。
- **dominant clan 队伍标签**（`TeamPerspectiveLabelResolver`）：根据 roster 中成员人数最多的军团生成用户可见名称，如 `CHRD`；军团人数并列或无军团时使用稳定 fallback `队伍-<hash>`。
- **地图名称映射**（`MapNames.cn()`）：使用 `common/map_names.json` 单一数据源，AI prompt 中输出中文地图名。
- **Tank ID 映射**：`PlayerResult.tankName` 已在解析阶段通过 `common/tankopedia-tier{7,8,9,10}.json` 填充，AI prompt 直接使用。
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
| `call2ThinkingEnabled` | `AI_THINKING_ENABLED_CALL2` | false | Call #2 自由文本复盘是否启用思考；默认关闭以保证 SSE 逐段流式（`AI_THINKING_ENABLED` 为 legacy，Call #2 已改由本开关控制） |
| `reasoningEffort` | `AI_REASONING_EFFORT` | max | 推理力度（high/max） |

启动时校验 `totalReserved <= contextWindowTokens`，不合规则 Spring Boot 启动失败。

#### `AiReviewWorkerExecutor` 配置（SSE worker 池）

| 属性 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `wotb.ai.review-worker.max-concurrent` | `AI_REVIEW_WORKER_MAX_CONCURRENT` | 4 | AI Review SSE worker 池线程数（core = max，固定不弹性伸缩），必须 ≥ 1；V1 VPS 2C4G 默认 4 |
| `wotb.ai.review-worker.queue-capacity` | `AI_REVIEW_WORKER_QUEUE_CAPACITY` | 4 | worker 池有界队列容量，必须 ≥ 1；满载（workers + queue 全占用）时第 N+1 个请求立即返回 `503 AI_REVIEW_BUSY`（`AbortPolicy`，绝不使用 `CallerRunsPolicy`） |
| `wotb.ai.review-worker.overall-deadline-sec` | `AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC` | 1100 | 请求整体 deadline（提交时刻 + overall，排队计入预算）：默认 1100s 覆盖团队 3 次 AI 调用（Call #1 + Call #2 + Autopsy，各 ≤315s）+ 余量，对齐前端 1100s / nginx 1120s；worker 启动时剩余预算耗尽 → 干净失败 `AI_TIMEOUT`（E 阶段） |

### Token 估算器

`ConservativeDeepSeekTokenEstimator` 使用 `codePointCount * 1.25` 保守估算 token 数。精确 token 数通过 API 响应的 `usage` 字段获取。

---

### Spring AI 集成

- 项目使用 **Spring AI 2.0.0**（BOM 在父 POM dependencyManagement 管理），生产 transport adapter 为 `SpringAiChatGateway`：官方 **OpenAI-compatible adapter**（`spring-ai-starter-model-openai`）连接 `https://api.deepseek.com`。原因：2.0.0 的 DeepSeek Starter 无法传递 `thinking`/`reasoning_effort`，这两个字段经 OpenAI adapter 的 `extraBody` 机制原样发送。
- 业务层只依赖项目内 `AiChatGateway` 接口；Spring AI / OpenAI SDK 类型只存在于 `gateway` 包。Replay 领域逻辑（`wotb-core`）不依赖 Spring AI。
- 缺少 `AI_API_KEY` 时应用正常启动，`/api/replay/analyze` 返回 `AI_NOT_CONFIGURED`；其余功能不受影响。
- timeout/retry 由 `AiRetryPolicy` 单层控制（SDK `maxRetries=0`，无双重重试）；可重试：429、连接失败、500/502/503/504；不重试：**超时（`AI_TIMEOUT`——上游可能已完成并计费，重试会重复扣费）**、认证/权限、invalid request、context too large、空/无效 completion。
- 总调用边界：`AI_CALL_TIMEOUT_SEC` 使用单调时钟（`System.nanoTime`）覆盖一次 `chat()` 的整个生命周期（含响应体读取与 SDK 解析）；每轮尝试前检查剩余预算，backoff 不得超过剩余预算，in-flight 请求会在预算耗尽时被中止（okhttp interceptor 捕获 Call + 看门狗，覆盖连接→发送→等待→响应体读取→反序列化；成功返回前还会复检 deadline），因此单轮实际请求时间上限为 `min(AI_TIMEOUT_SEC, 剩余预算)`。预算耗尽统一返回稳定 `AI_TIMEOUT`，超时后绝不返回 success。
- **全链路超时对齐**（改 nginx/Dockerfile/前端时必须保持）：后端 AI 单次调用预算 `AI_CALL_TIMEOUT_SEC=315s`（connect 10 + read 300 + 重试/backoff/解析余量）；团队复盘共 3 次 AI 调用（Call #1 + Call #2 + Team Autopsy），整体 deadline 默认 **1100s**（3×315 + 余量，`AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC`）——覆盖「切页后仍在后台跑完」的长复盘，不再被旧 400s 硬杀；容器 nginx 对 `/api/replay/analyze` 的 `proxy_read/send_timeout` 为 **1120s**（余量防 504）；前端 analyze 请求安全超时 **1100s**（`AiReviewPanel.vue` 的 `AI_ANALYZE_TIMEOUT_MS`），在代理 504 之前给出干净 `AI_TIMEOUT`；`SseEmitter` 超时同步为 1120s。host 级 Caddy/Nginx 反代也必须允许 ≥1120s，否则会提前 504。
- **SSE 流式协议（breaking change，analyze 已无同步 JSON 响应）**：`POST /api/replay/analyze` 返回 `text/event-stream`，`ReplaySseWriter` 序列化事件（自定 JSON event，`data` 为 JSON）：`call1_start` / `call1_done`（Call #1 开始/结束，真实发起调用时必发，无论成败）、`evidence_done`（证据分析完成；随机战 harness 与团队路径均发射，团队路径在 `TeamReplayAnalysisService.analyzeTeamGroups` 首轮 Call #2 前补发）、`call2_token`（`{"delta":"..."}` 主复盘 token 增量）、`autopsy_start` / `autopsy_done`（Team Autopsy）、`done`（`{"analysis":"...","preBattleSection":"..."}`；地图鸟瞰不由 AI 响应承载——由 Processing Job 的 canonical `map-overview.json` artifact 供独立战局回放面板消费，见 `docs/features/battle-playback.md`）、`error`（`{"code":"AI_..."}` 稳定错误码）。**异常传达规则**：request-envelope 校验（`UNKNOWN_LOCALE` / `DATASET_REFERENCE_REQUIRED` / `INVALID_CORRELATION_ID` / `DUPLICATE_CORRELATION_ID`）与 worker 池饱和（`AI_REVIEW_BUSY`）在返回 `SseEmitter` 前由 `@ExceptionHandler` 映射 HTTP 400 / 503；worker 启动后的运行时/业务失败（`NO_BATTLE_DATA` / `PERSPECTIVE_TEAM_UNRESOLVED` / `PERSPECTIVE_TEAM_CONFLICT` / `TEAM_FEATURES_UNAVAILABLE` / `AI_NOT_CONFIGURED` / `AI_PROMPT_MANDATORY_SECTION_TOO_LARGE` / `AI_RATE_LIMITED` / `AI_TIMEOUT` / `AI_CANCELLED` / `AI_UPSTREAM_UNAVAILABLE` 等）经 `error` 事件传达（HTTP 已 200），客户端断开时终止上游调用（cancel 端点语义）不向已断开连接写入。`AiChatGateway.stream(request, consumer)` 为单次尝试（不流内重试），失败即断流并保留已输出部分；总预算 watchdog 与 `correlationId` cancel 语义与 `chat()` 一致（`AI_TIMEOUT` / `AI_CANCELLED`）。**超大 delta 分块兜底**：`SpringAiChatGateway` 对单块 >512 字符的 delta 按句子边界切成 ≤128 字符片段、每片间隔 ~20ms 转发（上限 512 片，超长自动放大单片段），保证上游粗粒度返回时前端仍逐段出字；正常 token 流不触发。同步测试路径委托流式实现（`AiReviewStreamListener.NOOP`）。nginx 该 location 已配置 `proxy_buffering off` + `X-Accel-Buffering: no` + HTTP/1.1 + 清空 `Connection` 头（chunked 流式反代必需）；**任何 host 级反代改动必须保留上述三项**，否则阶段事件/token 无法实时到达。 **公开回放接口限流（C）**：Dataset 路径 replay 接口（`/api/replay/processing-jobs`、`/api/replay/export-jobs`、`/api/replay/analyze`、`/api/replay/map-overview`）应用 `limit_req`（单 IP 1r/s + burst 10 nodelay，429）与 `limit_conn`（单 IP 并发 5，503），仅 nginx 层，后端额度契约不变；legacy multipart 回放端点（`/api/preview`、`/api/export`）已弃用为 410，不在限流列。
- **地图鸟瞰独立端点（不调 AI）**：`POST /api/replay/map-overview`（Dataset 路径 JSON body `{processingJobId, sourceId}`，同步 JSON，与 analyze 同角色/校验/错误码）经 `MapOverviewQueryService` 读 cached `map-overview.json`（不重新 full process；legacy multipart 已 410），地图不可构建返回 204。战场回放面板（`BattlePlaybackPanel.vue`，ReplayPage Workspace 的「战局回放」视图）消费该 cached 地图；AI 复盘页面不加载地图。analyze SSE `done` 载荷**已不含** `mapOverview`（地图由 Processing Job artifact 承载，非 AI 响应字段）。
- **SSE worker 池配置（`AiReviewWorkerExecutor`）**：analyze 端点的整段 AI 复盘在 worker 线程执行，servlet request 线程提交完即返回 `SseEmitter`。worker 池为**有界**（core=max fixed thread pool + bounded queue + `AbortPolicy`），**绝不使用 `CallerRunsPolicy`**——后者会让 request 线程同步执行整段 AI 复盘，重新引入 SSE blocking bug。默认 **4 concurrent workers + 4 queued**（V1 VPS 2C4G，最多 8 active/pending），第 9 个请求被立即拒绝并返回 **`503 AI_REVIEW_BUSY`**（`AiReviewBusyException` → `@ExceptionHandler`）。容量经环境变量 **`AI_REVIEW_WORKER_MAX_CONCURRENT`** / **`AI_REVIEW_WORKER_QUEUE_CAPACITY`** 可调（无需 rebuild）。线程为 daemon，命名 `wotb-ai-review-worker-N`，`@PreDestroy` 关闭池。**request-envelope 校验前置**：Dataset 引用（`processingJobId` / `sourceId`）缺失或非法等请求在提交 worker 前就抛 `DATASET_REFERENCE_REQUIRED` → `@ExceptionHandler` 映射 HTTP 400 结构化错误码，不再进入 SSE 流后以 `error` 事件传达（worker 内 `analyzeInternal` 保留相同校验作防御）。**queued cancellation**：任务在队列中等待期间若被取消（客户端断开 / cancel 端点），worker 启动后第一时间检查 `AiCancellationToken.isCancelled()`，命中即 `complete()` emitter 并清理、不调回放解析与 AI Gateway、不向已断开连接写入。`emitter.onTimeout` / `emitter.onError`（客户端断开）只翻转 cancellation token、不主动 complete——连接错误由 Servlet async lifecycle 负责终止 emitter，worker `finally` 统一清理 `AiRequestContext` 与 cancellation registry，与显式 cancel 端点幂等。 **整体 deadline（E）**：任务在提交时刻计算 `now + overall-deadline-sec` 并通过 `AiRequestContext.overallDeadlineNanos()` 暴露给 worker；`TeamReplayAnalysisService` / `TacticalReviewHarness` 预算起点回溯到提交时刻（排队时长计入剩余预算），启动时预算耗尽直接抛 `AI_TIMEOUT`；排队等待记 DEBUG 日志与 `wotb_ai_review_queue_wait` timer。**request-envelope 校验收敛**：`ReconstructionController` 与 `AiReplayReviewService` 统一前置校验 dataset reference（`DATASET_REFERENCE_REQUIRED` / `SOURCE_NOT_FOUND` / `SOURCE_NOT_READY` / `SOURCE_PROCESSING_FAILED`），错误码一致。
- **客户端取消 → 上游中断**：analyze 请求携带 `correlationId`；前端取消按钮 / 页面离开（`beforeunload` keepalive）/ 前端超时会调用 `POST /api/replay/analyze/cancel`，后端 `AiCancellationRegistry` 命中后取消 in-flight okhttp Call 并停止重试（稳定错误码 `AI_CANCELLED`），避免为无人等待的响应继续计费。 **correlationId 契约（D）**：客户端提供的 correlationId 必须为 canonical UUID（格式+长度 36），analyze 与 cancel 端点非法/重复一律 400（`INVALID_CORRELATION_ID` / `DUPLICATE_CORRELATION_ID`）；`AiCancellationRegistry.register` 对重复活跃 id 返回 null（不复用 token），`unregister(id, token)` 为 ConcurrentHashMap compare-and-remove（已完成的请求不会误删复用同一 id 的新注册）。
- Prompt/completion 默认不记录、不进 metrics；Spring AI Observation 未启用（NOOP）。日志经 `AiSecretRedactor` 集中脱敏。
- **Call #1 覆盖可观测性**：`PreBattleStrategicService` 每次调用前输出 `Pre-battle Call #1 input`（map、mapSemantics=found/UNKNOWN、verified、areas/relationships/spawnSemantics 数量、source、displayName、team1/team2 人数、curatedProfiles/fallbackProfiles 车辆 Profile 覆盖），成功后输出 `Pre-battle Call #1 success`（hypotheses/matchups/winConditions/双方 strengths·plans 数量）；`TacticalReviewHarness` 输出 `Harness prior obtained`（prior 已注入 Call #2）与 `Harness fell back to old path: <reason>`；`TeamAutopsyService` 成功输出 `Team autopsy success`（liabilities/mvps 数量）。新增指标 `wotb_ai_review_map_semantics_total{status=found|unknown}`。按 requestId 可在 Loki 逐请求验证地图/车辆语义是否进入 Call #1 并注入 Call #2。
- **回放解析覆盖率可观测**：`AiReplayReviewService` 对每个回放输出 `Replay event-stream parsed`（file/map/packets/decoded/partial/unknown/failed/decodedRatio），可在 Loki 按回放查看事件流解码覆盖率；真实样本 `decodedRatio≈0.31–0.35`，type 39/31/35/7 为主要未知/未解桶（逆向推进的量化基线）。
- 测试不调用真实 AI API：`SpringAiChatGatewayTest`/`SpringAiChatGatewayMetricsTest` 使用 mock `ChatModel`。
#### DeepSeek 官方 JSON Output（Team Call #2）

- **目的**：消灭「非法 JSON / JSON 外多余文本 / JSON 格式漂移 → parser fail → 昂贵完整 LLM retry」这一类
  syntax 层失败。**不是** Strict Function Calling / JSON Schema constrained generation
  （明确不宣传为 strict schema output）。
- **职责三层（不混用）**：
  - Provider JSON mode（`response_format=json_object`）= **syntax guarantee**（合法 JSON）；
  - `TeamReviewEnvelopeParser` = **WotBTools business schema guarantee**（合法 JSON 但 `claims` 类型错误等仍 FAIL）；
  - `TeamFactualConsistencyValidator` = **truth guarantee**（事实一致性，JSON mode 只解决 syntax 不解决 truth）。
- **contract**：`AiChatRequest` 新增 `AiResponseFormat`（`TEXT` / `JSON_OBJECT`，默认 `TEXT`，兼容构造器回退 TEXT）。
  只有 Team Call #2（`SINGLE_TEAM_BATTLE` Natural Coach Call #2，`TeamReplayAnalysisService.callRaw`）显式传
  `JSON_OBJECT`（输出格式属于 request contract，不由 analysisMode 隐式推断）；Player / Pre-battle / Harness /
  Autopsy 全部保持 `TEXT`，不进入 JSON mode。
- **mapping**：Spring AI 2.0.0 `OpenAiChatOptions` 原生支持 `responseFormat`（javap 实证），
  `SpringAiChatGateway.buildPrompt` 在 **per-request options** 上设置
  `OpenAiChatModel.ResponseFormat.builder().type(Type.JSON_OBJECT).build()`；`TEXT` 不发送 response_format。
  绝不写进连接级/全局 model options，否则所有调用都会变 JSON。
- **streaming**：Team Call #2 继续走 `gateway.stream(request, IGNORED_STREAM)`（draft 不推给用户，
  校验 PASS 后由 `forwardTokens` 模拟 SSE 增量）；JSON Output 与 stream 的兼容性在生产 smoke 实测确认；
  若实测不可靠，允许改 `chat()`（用户不可见契约不变）。
- **thinking**：`call2ThinkingEnabled` 默认 false；启用时需在生产实测 JSON Output + thinking 兼容性，
  不静默关闭 thinking（官方明确不兼容 + 测试 + 文档三者齐备才处理）。
- **observability**：每次 Team Call #2 attempt 记录 `event=team_review_parse_result`（result/
  reason=低基数枚举）、`event=team_review_validation`（conflictCount/checks）、`event=team_review_validation_conflict`
  （DEBUG，check/reasonCode）、`event=ai_validation_retry`、`event=team_review_validation_attempt_completed`
  （token 累计）、`event=ai_prompt_budget`（发送前预算）；指标 `wotb_ai_team_review_validation_attempt_total`
  （result=pass/parser_invalid/validation_failed）。详见 `docs/operations/observability.md`「AI Review 全链路事件日志」。

---
- **AI 输出语言跟随前端 locale**：`/api/replay/analyze` 的 JSON body 字段 `lang`（Dataset 引用请求体 `{processingJobId, sourceId, lang, correlationId}`，必填，白名单 `zh`/`en`/`ru`）控制 AI 复盘输出语言；缺失时由 Spring 返回 `400`，空白或未知值返回 `400 UNKNOWN_LOCALE`。语言穿透 ReviewService → facade → Player/Team Service → Prompt Builder：ZH 直接使用原有中文 system prompt（字节级不变）；EN/RU 在中文基座上替换互斥的中文输出强制句（输出语言、称谓、车种、时间格式、未知字段与无法确定措辞），业务事实约束（不编造、坦克专有名词原样、perspective/friendly-enemy、权威结算与观测子集、注入防护、数据限制）不变。en 时间格式统一为 `Xm Xs`（如 `1m 15s`、`3m 0s`、`3m 12s`），ru 为 `X мин X с`（如 `1 мин 15 с`、`3 мин 0 с`、`3 мин 12 с`）。覆盖 player fallback/single/tactical 与 team single 路径；地图/坦克/clan/昵称等专有名词不翻译；`limitations` 与错误码仍为英文稳定码、由前端本地化。前端由 vue-i18n 当前 locale 携带 `lang`。

---

## AI 回放复盘

### 视角分组与模式判定

```
.wotbreplay → POST /api/replay/processing-jobs（上传输入持久化；202 + jobId）
  → ReplayParseScheduler（全局并发=2、job-aware 公平、queued cancellation）
       └─ per-source processFull = parse + reconstruct + enrich（Parse once / consume many）
            ├─ ProcessedDataset（battles / aggregates / League Rating）
            ├─ ai-facts.json（AI Review derived artifact）
            └─ map-overview.json（地图鸟瞰 derived artifact）
  → Processing Job READY（ProcessedDataset + derived artifacts 就绪；单 source 失败不中断 batch）

POST /api/replay/analyze（Dataset JSON `{processingJobId, sourceId, lang, correlationId}`）
  → ReconstructionController.analyzeDataset → dataset reference 校验（DATASET_REFERENCE_REQUIRED / SOURCE_NOT_FOUND）
  → AiReplayReviewService.analyzeFacts（acquire Dataset lease，读 Processing Job 的 ai-facts.json）
       ├─ source READY → 视角判定（PLAYER_FOCUSED / TEAM_PERSPECTIVE）+ AI 链（Call #1 → Call #2 → Team Autopsy）
       ├─ source 未 READY → SOURCE_NOT_READY / SOURCE_PROCESSING_FAILED（稳定码，不重建）
       └─ artifact 读/解码/存储故障 → DATASET_UNAVAILABLE（503，不可恢复）
  → SSE 流式：call1_start / evidence_done / call2_token / autopsy_* / done / error
```

### Team Perspective 语义

- `RANDOM` 仍是录像者个人复盘；`TRAINING` / `TOURNAMENT` 是录像者所在整队复盘。
- 录像者不获得特殊个人分析权重，只用于解析 `perspectiveTeam`。
- 同场同队回放是 `SAME_TEAM_DUPLICATE_PERSPECTIVE`，只选质量最高的代表；禁止拼接原始事件流。
- **死亡时刻口径**：业务死亡秒值只来自 settlement `#301 field24 lifeTime`；settlement 无效时依赖死亡时刻的证据 fail-closed。Playback/live reconstruction 不覆盖 `PlayerResult`，也不产生额外死亡 provenance 层；legacy 启发式不作为权威。阶段存活人数为「至阶段末」语义（`BattlePhaseTimelineSection`），prompt 注入双方逐车阵亡时间线（`DEATH_TIMELINE`）。
- **观测伤害抑制**：事件流覆盖未达 100% 时 `DefaultTeam/PlayerBattleFeatureExtractor` 条件标记 `OBSERVED_DAMAGE_IS_PARTIAL`，prompt 层抑制观测数字（`TeamAiPromptBuilder.appendObserved` / 随机战交火段），以权威结算为唯一口径；覆盖补齐后自动恢复。
- **赛前预测渲染**：`PreBattleSectionRenderer` 覆盖 TEAM 变体（A队/B队/A 队/队伍1 等）、AREA ID → 中文名 + 九宫格（复用 `MapTacticalSemanticsRegistry`）、composition 键值三语翻译。
