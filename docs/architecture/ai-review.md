# AI Review 架构（随机战双 Call / 团队复盘 / Team Autopsy）

> 开发入口见 `docs/DEVELOPER_GUIDE.md`；Team-Level 复盘产品设计见 `docs/features/team-ai-review.md`。
> 权威结算 vs 事件流观测的数据边界见文末「权威数据源与 AI 分析」。

## AI Review Harness（随机战双 Call / 团队复盘 + Team Autopsy）

随机战个人复盘在满足条件时走两 Call Harness（`TacticalReviewHarness`），否则自动降级到旧单 Call 路径：

1. **Call #1（Pre-Battle Strategic Prior）**：`PreBattleStrategicService` 只输入地图名 + 双方阵容（坦克名/车种/等级/国家/单车血量）+ 双方总血量（tankopedia maxHp 求和）+ `common/tank_tactical_profiles.json` 战术 Profile，严格剥离战绩字段（伤害/击杀/存活/胜负/阵亡顺序）；`preferredPlans` 契约要求分阶段（开局/中期/残局）输出；结构化 JSON 输出由 `PreBattleStrategicParser` 解析，失败返回 null 降级。
2. **Backend Evidence Skills**（`com.wotb.core.replay.evidence`）：`HpMomentumSkill` / `EngagementTradeSkill` / `LocalSupportSkill` / `DeathCascadeSkill` / `RouteSkill` / `CriticalWindowSkill`，输出确定性 `AiEvidence`（含 confidence / provenance / priority），只描述「发生了什么」，不做战术裁决。
3. **Call #2（Tactical Review）**：`TacticalReviewPromptBuilder` 按 Priority Bookends 组织 Prompt（BATTLE SNAPSHOT（含结算、死亡时间线、**走位/区域时间线与压缩移动段**）→ STRATEGIC PRIOR → TOP PIVOTAL WINDOWS（≤8）→ PHASE → **对炮明细（ENGAGEMENTS·逐次交火）** → EVIDENCE → CRITICAL DECISION WINDOWS（≤8 完整证据）→ TASK），预算不足时按相关性裁剪，书签段永不裁剪。

### AI 提示词文件（单一事实源）

AI 提示词正文维护在 `java/wotb-web/src/main/resources/prompts/` 下的 `.zh.md` 文件（随 jar 打包到 classpath），运行期由 `AiPromptLibrary.zh("<key>")` 惰性加载并缓存（`classpath:/prompts/<key>.zh.md`）。历史 Java 文本块常量已迁移为加载调用，prompt 内容字节级不变。

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

编辑约定：

- UTF-8、LF 换行（加载器会把 CRLF 归一化为 LF；文件末尾换行保留——`confidence-legend` 以换行结尾，勿删）。
- 文件是 ZH 完整 prompt；EN/RU 由 `PlayerPromptRules.localizePlayerSystemPrompt` / `TeamPromptLocalizer.localizeTeamSystemPrompt` 对 ZH 规则片段做字符串替换生成。**md 内中文规则片段必须与 Java 常量（`COMMON_*_RULE` / `TEAM_*_RULE` 等）逐字一致**，否则 EN/RU 替换失效。
- 多文件 AI 复盘已移除（2026-08-12）：`player/multi` / `team/multi` 提示词、`analyzeMulti`、`MULTI_*_BATTLE` AI 分支与团队多视角分区合并全部删除；AI 复盘仅单文件（`AiReplayBatchPolicy.MAX_FILES=1`）。`BatchAnalyzer` / `ReplayAnalysisMode` 保留 MULTI 模式，因为非 AI 端点（`/api/replay/process`、`/api/replay/reconstruct-batch`）不受单文件限制。

### AI 复盘评估 harness（golden cases + lessons）

- **CI 模式**：`AiEvalHarnessTest`（`@Tag("ai-eval")`，默认构建运行）加载 `src/test/resources/ai-eval/cases/*.json`（synthetic 7v7 争霸赛场景），用 `TeamAiPromptBuilder.single` 构建 prompt（不调 AI），执行 `prompt_contains` / `prompt_omits` 断言，写 `target/ai-eval-report/report.md` + `report.json`；任一 FAIL 构建失败。
- **单走行为候选**：`TeamSoloIntentSkill`（wotb-core）从阵型簇/移动段/交火/占点分推导 `OPENING_MAP_CONTROL` / `SOLO_DELAY` / `SOLO_DETACHED` 候选（PARTIAL 规则候选，B1 口径：拖延需队友获利；开局图控抑制脱节），`TeamEvidenceFormatter` 渲染 `SOLO_INTENT_CANDIDATES` 段（P3 optional）。
- **player 路径同规则**：`SoloPlayIntentSkill`（wotb-core）复用 `RouteSkill` 脱节窗口推导同口径候选（个人复盘无「队友获利」维度），已在 `EvidenceSkillEngine` 注册；player prompt（fallback/single/tactical）追加三语 `SOLO_INTENT_RULE`。
- **争霸赛占点与点数胜负结束方式**：`FriendlyEnemyResult.resolveTeamBattle` 新增派生 `pointsEndReason`（`REACHED_1000`=双方均有存活 + 标准业务规则 + 时长<420s：某一方达到 1000 分上限导致提前结束，与胜方解耦，不使用任何点数字段；`TIME_EXPIRED`=标准规则 + 时长≥420s：时间耗尽，双方终局比分未解码；`UNKNOWN`=类别未知 / rosterComplete=false / 时长缺失；全歼=NOT_APPLICABLE），`TeamEvidenceFormatter` 在 `CAPTURE_AND_POINTS` 段输出 `pointsEndReason`（逐人/双方占点分、`pointsDecided`、占领点区域）；`TeamAiPromptBuilder` mandatory header 同时输出 `result` 与 `resultSource`（BATTLE_RESULTS 权威 / SURVIVOR_SETTLEMENT 结算存活推导 / UNKNOWN；POINTS_INFERENCE 已停用——枚举保留但不再产出，fail closed）；**所有依赖完整逐人结算的存活/点数推断共享"结算阵容完整"前提**（`Battle.rosterComplete`：ReplayParser 校验名册 #201 与战绩 #301 账号集合一致且每个账号队伍一致才为 true；不写死每队 7 人，完整名册的非 7v7 训练房同样生效）：SURVIVOR_SETTLEMENT 推导与 `annihilationSuffix` 在阵容不完整时一律 fail-closed；winnerTeam 缺失 + 双方均有存活 → 胜方 UNKNOWN（结束方式仍按标准时限证据判定，用于结果行后缀，禁止比较占点字段推断）；winnerTeam 存在时胜方为 BATTLE_RESULTS，`pointsEndReason` 正常判定（rosterComplete=false 时 UNKNOWN，result 只写通用「点数判定」）；`CAPTURE_AND_POINTS` 在阵容不完整时输出 `SETTLEMENT_ROSTER_INCOMPLETE=true` / `pointsTotalsUnavailable=true` 并抑制占点分总量；提示词 `CAPTURE_RULE`（ZH/EN/RU，含 2d 条阵容不完整口径）写明结束条件三分法——全歼胜（双向：全歼敌方获胜 / 被敌方全歼落败）/ 1000 分提前结束（某一方达到 1000 分上限，具体胜方由 winnerTeam 决定；缺失时只写「某一方达到 1000 分导致提前结束，具体胜方未知」，双方终局比分一律 UNKNOWN，不把 1000 分配给任何队伍）/ 时间耗尽点数决胜（仅双方均有存活且标准规则可证），`TIME_EXPIRED` 叙述必须写「时间耗尽」，禁止用 <1000 的中间比分作为获胜理由，禁止把失败方被全歼写成「全歼敌方获胜」；团队剖析胜负标签按结束方式输出「（时间耗尽点数判定）/（达到 1000 分提前获胜）/（某一方达到 1000 分提前结束，具体胜方未知）/（时间耗尽点数判定，具体胜方未知）/（点数判定）/（全歼敌方）/（被敌方全歼）」。`TeamPromptLocalizer` 三语 `SOLO_INTENT_RULE` / `CAPTURE_RULE`。
- **争霸赛点数口径（未证明项，禁止用于终局比分）**：`victoryPointsEarned`(#32) 的精确定义及是否包含被动占点增长/击杀夺分等调整仍未证明——已知计算口径（占点分+40×击杀−40×阵亡）已撤回，证据只输出原始结算字段（victoryPointsEarned/Seized、kills、deaths）；每据点每 tick 产分与 tick 间隔均未解码（无任何已验证的 tick 产分规则），不得用 tick 数或占点分计算终局比分；击杀夺分 40 分仅作叙述口径（`KILL_STEAL_POINTS` 不参与计算）；实时点数/基地占领/终局比分尚未解码（`PointsEvidenceProbeTest`/`ShotSpottingStreamProbeTest` 记录候选，语义 UNKNOWN）。
- **生产反馈闭环**：人工评估 + 用户反馈登记模板见 `docs/ai-eval/feedback-checklist.md`；可复现反馈转 lesson + synthetic case 回归。评估人工，不引入 LLM-as-judge；真实回放不入库。

关键约束：

- **地图战术语义层**：`MapTacticalSemanticsRegistry` 加载 `common/map-semantics/*.semantic.json`（由 `map-semanticizer` 从 Wot Blitz 客户端 SC2 + heightmap 解码生成，含 `areas` / `relationships` / `spawnSemantics` / `mapCodes` / `gridRegions` / `verified` / `source` / `displayName` / 区域 `confidence`；`displayName` 为 `map_names.json` 的 en 名，未收录回退 mapId）；按 `mapCodes` / `mapId` / token 边界别名查询，未收录地图明确 UNKNOWN，禁止编造区域语义。`relationships` 为 `List<TacticalRelationship>`（from/type/to/reason/confidence 原样保留，不做分组/改名）：ADJACENT_TO 仅表示确定性分析网格相邻，不代表可通行路线/视线/交叉火力；CONTAINS_CONTROL_POINT 与 CONTAINS_STRATEGIC_POINT 保持区分。Call #1 Prompt 输出可信度图例：EXACT_CLIENT_DATA/EXACT_SCENE_DATA=客户端直接事实、NAME_HEURISTIC=对象位置精确但类别由资源名推断、GRID_RULE_DERIVED=区域名称/边界/合并是规则候选、RULE_DERIVED_CANDIDATE=favors/risks 是假设候选；`verified=true` 渲染"人工地图核验: 已完成"（2026-08-12 起仓库内 33 张地图语义全部核验；`verified=false` 时渲染"尚未完成人工地图核验"）；语义段显示「地图: "Desert Sands"（内部 code: "desert_train"）」。CONTROLS / ENABLES_PRESSURE_AGAINST 未提供时禁止声称；出生点语义仅在有数据时输出。每个 AREA 标注 `gridRegions`（GRID_REGION_1~9），与 `MapRegionResolver` 同一坐标约定（回放 raw 按每图 playableBounds 推导的 per-map profile（`MapCoordinateProfileRegistry`，含中心偏移与半边长）→ 500×500 canonical → 3×3）；无语义数据时 GRID_REGION_1~9 仍只是位置编号。TEAM_A=队伍1、TEAM_B=队伍2 固定映射。
- **双 Call 预算**：Call #1 独立 45s stage budget（`AiChatRequest.callTimeoutSec`），Call #2 使用剩余预算并留 10s 安全余量；Call #1 失败后剩余 < 60s 时不启动旧路径 fallback；总 deadline = `AI_CALL_TIMEOUT_SEC`。
- **结构化 JSON 调用关闭 thinking**：`PRE_BATTLE_STRATEGIC_PRIOR`（Call #1）与 `TEAM_AUTOPSY` 在请求层强制 `thinkingEnabled=false`（`reasoningEffort=null`）。生产实测 DeepSeek thinking（`AI_REASONING_EFFORT=max`）会把整个输出预算（Call #1 4096 / Autopsy 2048）消耗在 reasoning 上、`finish_reason=length` 且 content 为空（`AI_EMPTY_RESPONSE`），导致 Call #1 静默降级、战犯/MVP 段缺失；关闭后直接输出契约 JSON。**Call #2 主复盘默认也关闭 thinking**（`AI_THINKING_ENABLED_CALL2=false`，见配置表）——DeepSeek 推理模式下 `reasoning_content` 先流、content 末尾一次性到达，破坏 SSE 逐段流式；需要推理深度时开回 `AI_THINKING_ENABLED_CALL2=true`（流式体验由网关分块兜底保证）。
- **伤害语义（损失血量 vs 格挡伤害）**：AI 提示词统一用「损失血量」称呼 `damageReceived`（不再叫「承伤」），并强制区分两个概念——格挡伤害（`damageBlocked`）越高越好；损失血量本身中性，评价必须结合车型职责、存活时长、输出贡献与战况（重坦/装甲车抗线掉血可接受，薄皮输出车无价值掉血或过早阵亡前大量掉血才是问题）；不得仅因损失血量高判定表现差。个人复盘（fallback/harness）、团队复盘与 Team Autopsy 共用 `COMMON_DAMAGE_SEMANTICS_RULE`（ZH/EN/RU 三语，Team Autopsy 为 ZH）；战犯证据类别同步改写为「损失血量明显偏高且与车型职责/存活时长/输出不匹配」。
- **掉血时间范围（强制规则 + 窗口证据）**：新增 `HP_LOSS_TIME_RULE`（ZH/EN/RU，player/team 提示词共用）——凡提及掉血/损失血量必须给出明确时间范围（X分XX秒–X分XX秒）与掉血量，禁止笼统描述；很短窗口内大量掉血先描述为「短时间集中掉血/高压掉血窗口」，仅当窗口总跨度 ≤15 秒、解析出 ≥2 个不同攻击者且无未解析攻击者时才可写「被多车集火」，攻击者无法解析、只有 1 个攻击者或窗口总跨度超阈值（含 ≤10s 间隔链式聚类的大跨度窗口）时不得断言集火；正常慢速掉血不误标，无窗口证据写「无法确定」。证据侧：`DamageWindowClusterer`（wotb-web）把受击者视角的逐次伤害事件按 ≤10s 间隙聚类成掉血窗口（起止时间 + 总掉血量 + 命中次数 + 不同攻击者数 + 攻击者未解析标记 + `focusFireCandidate`——仅总跨度 ≤15s、攻击者 ≥2 且无未解析时为 true）；`DamageEventIdentityResolver`（wotb-web，唯一实现）负责 DamageEvent 攻击者/受击者身份解析——真实 decoder 的账号字段恒为 null，沿 `ParticipantMappingEvent` 的 entityId→accountId 映射（复用 `TeamEntityMapper`）按 `attackerEid/victimEid` 解析，合成 fixture 直填账号优先，不再依赖生产中恒为 false 的 `lethal()`；同解析器同时接入逐次伤害段 `PER_HIT_DAMAGE_EVENTS`、逐对手对炮段 `DAMAGE_EXCHANGE_BY_OPPONENT` 与掉血窗口。player 路径（fallback 与 Tactical Harness 主路径同格式/同口径）输出 `RECORDER_DAMAGE_RECEIVED_WINDOWS`，团队路径输出 `MEMBER_DAMAGE_RECEIVED_WINDOWS`（均受 `OBSERVED_DAMAGE_IS_PARTIAL` 覆盖率抑制，覆盖不全时输出 UNAVAILABLE 不给数字）。结算级 Team Autopsy 无事件流，不提供时间窗口。
- **掉血窗口严重度**：`DamageWindowClusterer.DamageWindow` 带 `damageVsBaseMaxHpPct`（累计伤害/基础满血量，tankopedia 基础值、不含装备加成——只是计算基准，不是实际掉血比例）：跨度 ≤10s 且伤害 ≥75% 基础满血量 → `criticalWindow`（短窗高额伤害窗口）；不判定「被秒杀」（无法证明窗口起始血量、窗口内阵亡与实际最大血量）；证据段输出基准百分比与标记，prompt 规则（player×3 + team/single 三语）强制定性并给时间范围。
- **观察性语义**：HP 动量只按两端共同可靠观察实体计算 delta（unspot / STALE 不伪造 HP swing；confirmed DESTROYED 按 0 HP 计入 lethal loss）；Call #2 只输出安全比较后的 HP_MOMENTUM 证据、不输出 raw 逐采样 HP 曲线，HP before/after/swing/coverage 必须来自同一 comparison cohort（禁止跨 cohort 拼接）；局部支援 denominator 使用当前时刻存活名单（已阵亡车辆不污染覆盖、存活敌军全部观察可重新 EXACT），敌军数量表达为"至少观察到 N"，仅两侧完整覆盖才 EXACT；隐藏/点亮不制造 local-number flip；Route 敌方人数优势需友军侧完整覆盖（observedEnemy 作为真实敌军下界）。
- **观察性**：HP 动量带 `observedCoverage`，覆盖率低时置信度降为 PARTIAL；局部支援只统计 `OBSERVED` 位置，STALE/UNKNOWN 不计入。
- **降级阶梯**：非 ZH / 无重建 / 录像者未解析 / 特征不可用 / Call #1 失败 / 无证据 → 旧单 Call 路径；对外 API 与响应结构不变。
- **Team 复盘也应用 Call #1**：随机战个人复盘（`TacticalReviewHarness`）与训练房/联赛团队复盘（`TeamReplayAnalysisService`）都先执行 Call #1（Pre-Battle Strategic Prior：基于地图与双方阵容的赛前先验，含开局/分路假设）；团队路径按视角队伍把 prior 重标为 TEAM_A=你的队伍（teamLabel）/ TEAM_B=对方队伍 后注入团队 Prompt（视角队伍为 2 时交换 Call #1 的 TEAM_A/TEAM_B），要求对每条战略假设逐条判定 先识别实际战局类型（常规推进/一波流/蹲坑僵持等），再逐条对照「预期打法 vs 实际执行」；实际偏离预期不等于失误，特殊战局可能使分阶段计划失效；Call #1 失败不阻断团队复盘（仅缺 prior 段）。
- **Team Autopsy（仅 team perspective 结算级）**：随机战斗个人复盘不评判 MVP/战犯。战犯/MVP 只应用于训练房/联赛团队复盘——`TeamReplayAnalysisService` 单团队单元成功后追加结算级独立 TEAM_AUTOPSY 调用：Autopsy 输入只有权威逐人结算（**无** Call #1 prior / Critical Window / Route 证据，使用结算级 system prompt），与团队主复盘的 Call #1 注入互不影响。**完整七人门禁**：仅当 recorderTeam 恰好存在 7 名有效本方玩家时才调用 Gateway（0～6 人或超过 7 人跳过并记录 roster_incomplete，保留团队主复盘）。**settlement-only 置信度边界**：LLM 生成的 contribution / MVP / 战犯判断 confidence 只能 PARTIAL/UNKNOWN，EXACT/INFERRED 整段拒绝。玩家身份用 `playerKey`（本方 roster 稳定编号，同队同名坦克可区分）；Parser 要求 players 的 playerKey 集合与 roster **完全相等**（不缺失/不额外/不重复，超长不截断）、MVP/战犯各自 ≤3（超限拒绝）、每条 verdict 引用有效 playerKey 且列表内不重复、reason 非空、evidence 非空、判胜≥1 MVP / 判负≥1 战犯、空结果拒绝；渲染按 playerKey 回查后端权威昵称/坦克名。胜负与段落渲染使用实际队名（`TeamPerspectiveLabelResolver`，如 CHRD），Team Autopsy 枚举渲染中文化（HIGH→高、PARTIAL→部分，MVP 保留英文）；阵亡时刻与主力质心距离（`deathProximityMeters`，OBSERVED 位置 + 观测时间差 + 置信度）用于脱节判断，禁止用九宫格编号差推断距离。`TeamAutopsyStatsBuilder` 只构建 recorderTeam 本方玩家，weakOutput 均值仅本方；结算字段为 Battle Result 事实，earlyDeath/weakOutput 为规则候选（各自置信度），deathInCriticalWindow 继承窗口 confidence 且结算级代理不得 EXACT；死亡时间线仅本方。TEAM_AUTOPSY 预算 = min(30s, 整体剩余 - safety margin)，不足不启动并记录 budget_exhausted；`AI_CANCELLED` 重新抛出。
- **新增共享资源**：`common/tank_tactical_profiles.json`（精选 Tier X + 车型级默认 fallback），`wotb-core/pom.xml` 与 `docker/Dockerfile.backend` 已同步复制。

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
- **uniqueBattleCount**：multi-perspective 中区分 perspective count 和 unique battle count，同一场战斗的 opposing perspective 只算一个 battle。
- **MemberIdentity**：accountId > 0 时优先使用 accountId；accountId ≤ 0 时使用规范化 nickname（trim、Locale.ROOT、case-insensitive）。用于 engagement 匹配、cluster 成员标识和 key events 的全链路 identity。
- **prompt 禁止 raw team**：AI prompt 中不出现 `perspectiveTeam=1/2`、`winnerTeam=1/2`、`Team 1/2`、`队伍1/2`。使用 `teamLabel=`、`result=TEAM_WIN/TEAM_LOSS/DRAW_OR_UNKNOWN`。BATTLE_END key event 同样使用 `result=` 三态。
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
| `model` | `AI_MODEL` | `deepseek-v4-pro` | 模型字符串，原样传递给 Provider |
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
- **全链路超时对齐**（改 nginx/Dockerfile/前端时必须保持）：后端 AI 单次调用预算 `AI_CALL_TIMEOUT_SEC=315s`（connect 10 + read 300 + 重试/backoff/解析余量）；团队复盘共 3 次 AI 调用（Call #1 + Call #2 + Team Autopsy），整体 deadline 默认 **1100s**（3×315 + 余量，`AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC`）——覆盖「切页后仍在后台跑完」的长复盘，不再被旧 400s 硬杀；容器 nginx 对 `/api/replay/analyze` 的 `proxy_read/send_timeout` 为 **1120s**（余量防 504）；前端 analyze 请求安全超时 **1100s**（`ReconstructionPage.vue` 的 `AI_ANALYZE_TIMEOUT_MS`），在代理 504 之前给出干净 `AI_TIMEOUT`；`SseEmitter` 超时同步为 1120s。host 级 Caddy/Nginx 反代也必须允许 ≥1120s，否则会提前 504。
- **SSE 流式协议（breaking change，analyze 已无同步 JSON 响应）**：`POST /api/replay/analyze` 返回 `text/event-stream`，`ReplaySseWriter` 序列化事件（自定 JSON event，`data` 为 JSON）：`call1_start` / `call1_done`（Call #1 开始/结束，真实发起调用时必发，无论成败）、`evidence_done`（证据分析完成；随机战 harness 与团队路径均发射，团队路径在 `TeamReplayAnalysisService.analyzeTeamGroups` 首轮 Call #2 前补发）、`call2_token`（`{"delta":"..."}` 主复盘 token 增量）、`autopsy_start` / `autopsy_done`（Team Autopsy）、`done`（`{"analysis":"...","preBattleSection":"...","mapOverview":{...}}`——mapOverview 为可空的「地图鸟瞰」数据（见 `docs/features/battle-playback.md`），未知地图/无观测/无名册/视角未解析时为 JSON null，前置字段为 null 时同样输出 JSON null）、`error`（`{"code":"AI_..."}` 稳定错误码）。**异常传达规则**：request-envelope 校验（`UNKNOWN_LOCALE` / `NO_REPLAY_FILES` / `NO_REPLAY_FILE` / `REPLAY_FILE_COUNT_EXCEEDED` / `INVALID_REPLAY_FILE_TYPE` / `FILE_TOO_LARGE` / `TOTAL_REQUEST_TOO_LARGE`）与 worker 池饱和（`AI_REVIEW_BUSY`）在返回 `SseEmitter` 前由 `@ExceptionHandler` 映射 HTTP 400 / 503；worker 启动后的运行时/业务失败（`NO_BATTLE_DATA` / `PERSPECTIVE_TEAM_UNRESOLVED` / `PERSPECTIVE_TEAM_CONFLICT` / `TEAM_FEATURES_UNAVAILABLE` / `AI_NOT_CONFIGURED` / `AI_PROMPT_MANDATORY_SECTION_TOO_LARGE` / `AI_RATE_LIMITED` / `AI_TIMEOUT` / `AI_CANCELLED` / `AI_UPSTREAM_UNAVAILABLE` 等）经 `error` 事件传达（HTTP 已 200），客户端断开时终止上游调用（cancel 端点语义）不向已断开连接写入。`AiChatGateway.stream(request, consumer)` 为单次尝试（不流内重试），失败即断流并保留已输出部分；总预算 watchdog 与 `correlationId` cancel 语义与 `chat()` 一致（`AI_TIMEOUT` / `AI_CANCELLED`）。**超大 delta 分块兜底**：`SpringAiChatGateway` 对单块 >512 字符的 delta 按句子边界切成 ≤128 字符片段、每片间隔 ~20ms 转发（上限 512 片，超长自动放大单片段），保证上游粗粒度返回时前端仍逐段出字；正常 token 流不触发。同步测试路径委托流式实现（`AiReviewStreamListener.NOOP`）。nginx 该 location 已配置 `proxy_buffering off` + `X-Accel-Buffering: no` + HTTP/1.1 + 清空 `Connection` 头（chunked 流式反代必需）；**任何 host 级反代改动必须保留上述三项**，否则阶段事件/token 无法实时到达。 **公开回放接口限流（C）**：`/api/preview` `/api/export` `/api/rating` 应用 `limit_req`（单 IP 1r/s + burst 10 nodelay，429）与 `limit_conn`（单 IP 并发 5，503），仅 nginx 层，后端额度契约不变。
- **SSE worker 池配置（`AiReviewWorkerExecutor`）**：analyze 端点的整段 AI 复盘在 worker 线程执行，servlet request 线程提交完即返回 `SseEmitter`。worker 池为**有界**（core=max fixed thread pool + bounded queue + `AbortPolicy`），**绝不使用 `CallerRunsPolicy`**——后者会让 request 线程同步执行整段 AI 复盘，重新引入 SSE blocking bug。默认 **4 concurrent workers + 4 queued**（V1 VPS 2C4G，最多 8 active/pending），第 9 个请求被立即拒绝并返回 **`503 AI_REVIEW_BUSY`**（`AiReviewBusyException` → `@ExceptionHandler`）。容量经环境变量 **`AI_REVIEW_WORKER_MAX_CONCURRENT`** / **`AI_REVIEW_WORKER_QUEUE_CAPACITY`** 可调（无需 rebuild）。线程为 daemon，命名 `wotb-ai-review-worker-N`，`@PreDestroy` 关闭池。**request-envelope 校验前置**：`files` 为空 / 文件超 `AiReplayBatchPolicy.MAX_FILES` / 类型/大小非法等请求在提交 worker 前就抛 `IllegalArgumentException` / `ReplayFileCountExceededException` → `@ExceptionHandler` 映射 HTTP 400 结构化错误码，不再进入 SSE 流后以 `error` 事件传达（worker 内 `analyzeInternal` 保留相同校验作防御）。**queued cancellation**：任务在队列中等待期间若被取消（客户端断开 / cancel 端点），worker 启动后第一时间检查 `AiCancellationToken.isCancelled()`，命中即 `complete()` emitter 并清理、不调回放解析与 AI Gateway、不向已断开连接写入。`emitter.onTimeout` / `emitter.onError`（客户端断开）只翻转 cancellation token、不主动 complete——连接错误由 Servlet async lifecycle 负责终止 emitter，worker `finally` 统一清理 `AiRequestContext` 与 cancellation registry，与显式 cancel 端点幂等。 **整体 deadline（E）**：任务在提交时刻计算 `now + overall-deadline-sec` 并通过 `AiRequestContext.overallDeadlineNanos()` 暴露给 worker；`TeamReplayAnalysisService` / `TacticalReviewHarness` 预算起点回溯到提交时刻（排队时长计入剩余预算），启动时预算耗尽直接抛 `AI_TIMEOUT`；排队等待记 DEBUG 日志与 `wotb_ai_review_queue_wait` timer。**上传校验收敛（B4）**：Controller 三个端点与 `AiReplayReviewService` 统一使用共享 `ReplayUploadValidator`（错误码不变）。
- **客户端取消 → 上游中断**：analyze 请求携带 `correlationId`；前端取消按钮 / 页面离开（`beforeunload` keepalive）/ 前端超时会调用 `POST /api/replay/analyze/cancel`，后端 `AiCancellationRegistry` 命中后取消 in-flight okhttp Call 并停止重试（稳定错误码 `AI_CANCELLED`），避免为无人等待的响应继续计费。 **correlationId 契约（D）**：客户端提供的 correlationId 必须为 canonical UUID（格式+长度 36），analyze 与 cancel 端点非法/重复一律 400（`INVALID_CORRELATION_ID` / `DUPLICATE_CORRELATION_ID`）；`AiCancellationRegistry.register` 对重复活跃 id 返回 null（不复用 token），`unregister(id, token)` 为 ConcurrentHashMap compare-and-remove（已完成的请求不会误删复用同一 id 的新注册）。
- Prompt/completion 默认不记录、不进 metrics；Spring AI Observation 未启用（NOOP）。日志经 `AiSecretRedactor` 集中脱敏。
- **Call #1 覆盖可观测性**：`PreBattleStrategicService` 每次调用前输出 `Pre-battle Call #1 input`（map、mapSemantics=found/UNKNOWN、verified、areas/relationships/spawnSemantics 数量、source、displayName、team1/team2 人数、curatedProfiles/fallbackProfiles 车辆 Profile 覆盖），成功后输出 `Pre-battle Call #1 success`（hypotheses/matchups/winConditions/双方 strengths·plans 数量）；`TacticalReviewHarness` 输出 `Harness prior obtained`（prior 已注入 Call #2）与 `Harness fell back to old path: <reason>`；`TeamAutopsyService` 成功输出 `Team autopsy success`（liabilities/mvps 数量）。新增指标 `wotb_ai_review_map_semantics_total{status=found|unknown}`。按 requestId 可在 Loki 逐请求验证地图/车辆语义是否进入 Call #1 并注入 Call #2。
- **回放解析覆盖率可观测**：`AiReplayReviewService` 对每个回放输出 `Replay event-stream parsed`（file/map/packets/decoded/partial/unknown/failed/decodedRatio），可在 Loki 按回放查看事件流解码覆盖率；真实样本 `decodedRatio≈0.31–0.35`，type 39/31/35/7 为主要未知/未解桶（逆向推进的量化基线）。
- 测试不调用真实 AI API：`SpringAiChatGatewayTest`/`SpringAiChatGatewayMetricsTest` 使用 mock `ChatModel`。
- **AI 输出语言跟随前端 locale**：`/api/replay/analyze` 的 multipart 表单字段 `lang`（必填，白名单 `zh`/`en`/`ru`）控制 AI 复盘输出语言；缺失时由 Spring 返回 `400`，空白或未知值返回 `400 UNKNOWN_LOCALE`。语言穿透 ReviewService → facade → Player/Team Service → Prompt Builder：ZH 直接使用原有中文 system prompt（字节级不变）；EN/RU 在中文基座上替换互斥的中文输出强制句（输出语言、称谓、车种、时间格式、未知字段与无法确定措辞），业务事实约束（不编造、坦克专有名词原样、perspective/friendly-enemy、权威结算与观测子集、注入防护、数据限制）不变。en 时间格式统一为 `Xm Xs`（如 `1m 15s`、`3m 0s`、`3m 12s`），ru 为 `X мин X с`（如 `1 мин 15 с`、`3 мин 0 с`、`3 мин 12 с`）。覆盖 player full/fallback/multi 与 team single/multi 全部路径；地图/坦克/clan/昵称等专有名词不翻译；`limitations` 与错误码仍为英文稳定码、由前端本地化。前端由 vue-i18n 当前 locale 携带 `lang`。

---

## AI 回放复盘

### 视角分组与模式判定

```
files → DefaultReplayProcessingFacade.processBatch()
  → 逐文件 validateFile(扩展名/大小) + parse + reconstruct
  → ReplayProcessingCapabilities(summaryAvailable, reconstructionAvailable, …)
  → BatchAnalyzer.analyze()
       ├─ BattleCategoryUtils.fromArenaBonusType()
       ├─ resolveScope() → PLAYER_FOCUSED / TEAM_PERSPECTIVE
       ├─ SHA-256 精确重复去重
       ├─ scope 一致性验证（不混合 + UNKNOWN 排除）
       ├─ BattleIdentity + TeamPerspectiveResolver 结果分组
       ├─ 代表回放选择（reconstruction 成功优先）
       └─ 录像者一致性验证（PLAYER_FOCUSED + RANDOM）
  → resolveMode() → AI 复盘单文件：SINGLE_PLAYER_BATTLE / SINGLE_TEAM_BATTLE
    （MULTI_*_BATTLE 仅供非 AI 批量端点；AI 多文件复盘已移除）
  → ReconstructionController
       ├─ PLAYER_FOCUSED → analyzePlayerOrFallback
       └─ TEAM_PERSPECTIVE → analyzeTeamGroups
            ├─ TeamPerspectiveResolver（录像者只决定 perspectiveTeam）
            ├─ TeamEntityMapper（可靠映射，未知实体不归队）
            ├─ DefaultTeamBattleFeatureExtractor
            ├─ reconstruction 可用 → 完整团队时序特征
            └─ reconstruction 不可用 → 权威团队结算 fallback
```

### Team Perspective 语义

- `RANDOM` 仍是录像者个人复盘；`TRAINING` / `TOURNAMENT` 是录像者所在整队复盘。
- 录像者不获得特殊个人分析权重，只用于解析 `perspectiveTeam`。
- 同场同队回放是 `SAME_TEAM_DUPLICATE_PERSPECTIVE`，只选质量最高的代表；禁止拼接原始事件流。
- **死亡时刻口径**：部分回放 `battle_results` 的 `deathTimeMillis` 为 0，系统回退事件流估算；prompt 用 `DEATH_SOURCE` 标注来源（`BattlePhaseSummary.deathSourceLabel`），禁止把估算当权威。阶段存活人数为「至阶段末」语义（`BattlePhaseTimelineSection`），prompt 注入双方逐车阵亡时间线（`DEATH_TIMELINE`）。
- **观测伤害抑制**：事件流覆盖未达 100% 时 `DefaultTeam/PlayerBattleFeatureExtractor` 条件标记 `OBSERVED_DAMAGE_IS_PARTIAL`，prompt 层抑制观测数字（`TeamAiPromptBuilder.appendObserved` / 随机战交火段），以权威结算为唯一口径；覆盖补齐后自动恢复。
- **赛前预测渲染**：`PreBattleSectionRenderer` 覆盖 TEAM 变体（A队/B队/A 队/队伍1 等）、AREA ID → 中文名 + 九宫格（复用 `MapTacticalSemanticsRegistry`）、composition 键值三语翻译。
- **复盘正文规范**：`COMMON_EVIDENCE_LOGIC_RULE`（ZH/EN/RU）禁止集火同义反复、机器标签直出与标题粘连；团队剖析段 MVP/战犯加粗、不渲染限制段；`AiReplayReviewService` 统一追加三语免责结尾。前端 `MarkdownContent` 对 `^(#{1,6})(?!#|\s)` 行补空格（`utils/markdownHeadingNormalize.js`）。
- 同场不同队是两个独立 perspective，entityId、坐标和时钟不跨 perspective 合并。
- 未点亮敌人的位置仍未知；不能用对方录像补写本队当时不可见的信息。
- `battle_results.dat` 的团队总伤害、承伤、助攻、格挡、击杀、存活和死亡时刻是权威值；damage event 只标为观测子集。
- 完整团队能力要求可靠 entity mapping；只有权威结算时仍可分析，但报告必须显示 fallback 与 limitations。
- `ParticipantMappingEvent` 优先按 accountId 连接；accountId 缺失时保留 updateArena2 的 nickname/team，只允许唯一昵称匹配并降级为 `INFERRED`。同名冲突、非车辆实体和低置信度映射不归队。

### Team Feature 判定阈值

| 判定 | 规则 |
|---|---|
| 交火分段 | 相邻可靠伤害事件间隔 `<= 10s` 属于同一段 |
| 集火候选 | 同一目标在任意 `<= 5s` 滑动窗口内被至少 2 名己方成员命中 |
| 交火结果 | 一方观测伤害严格大于另一方的 `1.25` 倍才判优势/劣势；边界值算均势 |
| 阵型采样 | `15s` 窗口，每名成员保留窗口内最后位置 |
| 阵型连通簇 | X/Z 平面距离 `<= 100m` 视为连通 |
| 坐标可信范围 | `|x|, |z| <= 1050 (1000 + 50 CLAMP_TOLERANCE_RAW)` 且 `|y| <= 200`；越界点忽略并计入 coverage/limitation |
| 时间戳 | 必须 finite 且 `>= 0`；非法事件不进入移动、阵型、交火或关键事件 |

> 多文件 AI 复盘已移除（2026-08-12），无多场 roster 趋势聚合（原 coverage ≥ 0.75 + Jaccard ≥ 0.60 阈值随之删除）。

### Team AI 输入预算

> 已从「固定数量/字符截断」迁移到 **token 估算预算**：`TeamAiPromptBuilder` 使用 `AiTokenEstimator` 估算 token，`BudgetWriter.finish(estimator, maxInputTokens, ...)` 在写入时实时判定；输入硬上限由 `AiModelProperties` 配置（`singleReplayMaxInputTokens` 等，见上文表格）。不再有 `MAX_MEMBERS` / `MAX_KEY_EVENTS` / 30,000 字符等固定截断常量。

超过预算会确定性截断，并在结果中加入 `AI_INPUT_TRUNCATED`。截断策略采用三层优先级输出：
1. **Mandatory contract**（context type、analysisUnitId、perspective header、unitLimitations、isolation/omission contract）必须完整写入，超出预算时抛 `AiPromptBudgetExceededException`（analyze 端点 worker 内经 `error` 事件传达 `AI_PROMPT_MANDATORY_SECTION_TOO_LARGE`），不得静默丢失；
2. **High-priority facts**（authoritative aggregate、observed aggregate、member facts、coverage）必须原子完整写入，无法容纳时该 perspective 整体 omitted；
3. **Optional details**（movements、formation、battle phases、engagements、key events）可按 unit 整块省略，被省略的 unit 加入 `truncatedUnitIds`，global `AI_INPUT_TRUNCATED` 添加。任意 unit 的截断不影响其他 unit 的 mandatory/high-priority facts。

所有入口使用相同的 evidence limitation 规则：`AiReplayAnalysisService`（兼容 facade）委托 Player/Team Service 编排 `analyzeTeamGroups()` / `analyzePlayerOrFallback()`，per-unit limitations 在各自上下文头部作为 `unitLimitations=[...]` 优先输出，不混入 global `DATA_LIMITATIONS`。

原始 `ReplayEvent` 和逐帧坐标流不得进入 Prompt。文件名、昵称、地图名和证据文本按 JSON 字符串编码，并在 system prompt 中声明为不可信数据，不能作为模型指令。PLAYER_FOCUSED 与 TEAM_PERSPECTIVE 使用同一个 `PromptDataQuoter.quote(value, fallback)` 实现，分别传入 `"?"` 或 `"UNKNOWN"` 作为 fallback。`TeamAiPromptBuilder.quoteData()` 和 `PlayerResultFormat.quoteForPrompt()` 均为轻量委托，不含 escaping 逻辑。所有外部字符串必须通过 `PromptDataQuoter.quote()` 转义后才能写入 prompt body。

### 错误与安全

上游错误统一为稳定英文码：`AI_INVALID_REQUEST`、`AI_AUTHENTICATION_ERROR`、`AI_RATE_LIMITED`、`AI_CONTEXT_TOO_LARGE`、`AI_UPSTREAM_UNAVAILABLE`、`AI_TIMEOUT`、`AI_CANCELLED`（客户端取消）、`AI_EMPTY_RESPONSE`、`AI_RESPONSE_INVALID`。**HTTP request-envelope 层**：`NO_REPLAY_FILES`、`INVALID_REPLAY_FILE_TYPE`、`FILE_TOO_LARGE`、`TOTAL_REQUEST_TOO_LARGE`、`UNKNOWN_LOCALE`、`REPLAY_FILE_COUNT_EXCEEDED`（`@ExceptionHandler` 映射 400）；**worker 池饱和** `AI_REVIEW_BUSY`（`AiReviewBusyException` → 503）。HTTP 200 中的畸形 JSON、非法 completion envelope 均归为 `AI_RESPONSE_INVALID`。日志只能包含 provider/model/status、请求字符数、分析模式、correlation ID，provider body 原文不进入日志（统一替换为 `[PROVIDER_BODY_REDACTED]`），不得记录密钥、Authorization 或完整 Prompt。普通用户文案由前端 zh/en/ru 翻译。

### 测试

核心测试覆盖 `TeamPerspectiveResolverTest`、`TeamEntityMapperTest`、`DefaultTeamBattleFeatureExtractorTest` 与 `BatchAnalyzerTest`；Web/AI 测试使用 MockMvc 与 mock `ChatModel`（不调用真实 AI API），前端使用 Vitest + Vue Test Utils。执行：

```bash
cd java && mvn -s settings.xml test
cd frontend && npm ci && npm run test && npm run build
```
---

## 权威数据源与 AI 分析

回放里有两类数据，可靠性与用途不同，**AI 战术复盘以结算数据为权威源**：

| 维度                     | 权威来源                                                                                         | 说明                              |
|------------------------|----------------------------------------------------------------------------------------------|---------------------------------|
| 伤害 / 承伤 / 助攻 / 格挡 / 击杀 | `battle_results.dat` → `PlayerResult`                                                        | 游戏结算值，可靠                        |
| 是否存活 / **死亡时刻** / 存活时间 | `battle_results.dat` → `PlayerResult.survived` / `deathTimeMillis`(#104) / `survivalTimeSec` | 可靠；死亡时间线据此生成                    |
| 队伍 / 坦克 / 昵称 / 录像者     | `Battle` / `PlayerResult` / `Battle.recorderResult()`                                        | 结算名册可靠；录像者队伍仍需多证据解析             |
| 胜负 / 地图 / 时长 / 模式      | `Battle.winnerTeam` / `mapName` / `durationS` / `arenaBonusType`                             | 可靠                              |
| 位置 / 走位时间线             | `data.wotreplay` type 10（重建）                                                                 | 仅对已可靠映射且实际观测到的 entity 可用           |
| 事件流伤害                  | `DamageEvent`                                                                                | 观测子集，不能替代权威团队总伤害；覆盖未达 100% 时 prompt 层抑制观测数字 |
| **逐帧血量 / 击毁事件**        | —（type 7/8 尚不可靠）                                                                             | **已知限制**：不作为血量/死亡来源，见 `docs/reference/replay-data.md` |
| **车辆炮/模块配置（所选炮）**   | —（meta 只有 tankId；事件流无可靠模块 id）                                                              | **已知限制**：无法从回放读取所选炮，见下文          |

### 车辆所选炮不可读（已知限制）

11.18 样本回放的 `meta.json` 只有 `vehicleCompDescriptor`（== tankId），`battle_results.dat` 战绩
同样只有 tank_id；`data.wotreplay` 各包中未发现可稳定编码的模块/炮 id（type 13 战斗尾包的 zlib
解压流中出现的少量模块 id 命中为字节巧合，跨车样本无法复现；开源解析器均不解析 Blitz 车辆模块）。
因此**无法从回放可靠读取玩家实际使用的炮**：10 级多炮车（如 E 100 的 12,8cm/15cm、AC Atlas 的
V1/V2）在 `common/tankopedia-tier10.json` 的 `vehicles[].guns` 数组中保留全部炮，但**不输出
vehicle 级权威 `alphaDamage`**（回放无法确定实际炮，AI structured facts 省略炮伤，不把某一门炮的
伤害伪装成本场实际炮伤）；7–9 级与 10 级单炮车才输出权威 `alphaDamage`。待拿到客户端属性定义或新的回放字段后再接入。

### AI 分析数据流（`/api/replay/analyze`，仅 `wotbtools-admin`）

#### 完整回放重建架构

```
com.wotb.core.replay 包：
  stream/      原始包流读取（错误容忍 + 重同步）
  event/       统一领域事件接口
  decoder/     包解码器注册中心（Type 4/7/8/10/14 等）
  reconstruction/ 战场状态重建 + checkpoint + stateAt(t)
  feature/     战术特征提取（DefaultPlayerBattleFeatureExtractor / DefaultTeamBattleFeatureExtractor）
```

#### 处理流水线

```
files[]
  └─ DefaultReplayProcessingFacade.processBatch() / process()
       ├─ validateFile（扩展名/空/大小）
       ├─ ReplayParser.parse           → Battle（结算数据）
       └─ ReplayReconstructionService.reconstruct(data, context) → ReplayReconstruction
  └─ BatchAnalyzer.analyze()
       ├─ BattleCategoryUtils → RANDOM / TRAINING / TOURNAMENT
       ├─ resolveScope() → PLAYER_FOCUSED / TEAM_PERSPECTIVE
       ├─ scope 一致性验证
       ├─ perspective 分组（BattleIdentity + perspectiveTeam）
       ├─ 代表回放选择
       └─ 录像者一致性验证（PLAYER_FOCUSED）
  └─ mode 判定 → SINGLE/MULTI_PLAYER_BATTLE | SINGLE/MULTI_TEAM_BATTLE
  └─ scope 感知 AI 调用
       ├─ PLAYER_FOCUSED → 个人 full feature 或权威结算 fallback
       └─ TEAM_PERSPECTIVE
            ├─ TeamPerspectiveResolver
            ├─ TeamEntityMapper
            ├─ DefaultTeamBattleFeatureExtractor
            └─ AiReplayAnalysisService.analyzeTeamGroups()
```

#### 视角规则

| 战斗模式       | Scope            | 分析对象 | 可分析条件 |
|------------|------------------|------|------|
| RANDOM     | PLAYER_FOCUSED   | 录像者个人 | `summaryAvailable && recorderResultAvailable` |
| TRAINING   | TEAM_PERSPECTIVE | 录像者所在整队 | `summaryAvailable && perspectiveTeamResolved && (recorderResultAvailable \|\| teamFeatureExtractionPossible)` |
| TOURNAMENT | TEAM_PERSPECTIVE | 录像者所在整队 | `summaryAvailable && perspectiveTeamResolved && (recorderResultAvailable \|\| teamFeatureExtractionPossible)` |
| UNKNOWN    | —                | 不支持 | 返回 `UNSUPPORTED_BATTLE_CATEGORY` |

Team 模式中，录像者**只用于确定 `perspectiveTeam`**，不是特殊分析对象。解析按权威
`recorderResult`、accountId、reconstruction participant、唯一 nickname fallback 交叉验证；
nickname fallback 标记 `INFERRED`，证据冲突或 team=0 时不默认到队伍 1。
updateArena2 会保留 entityId/accountId/nickname/team；accountId 缺失但昵称唯一且有车辆证据时，
entity 可通过 nickname 连接，置信度为 `INFERRED`。同名、观战/非车辆实体和
`PARTIAL`/`UNKNOWN` 映射不会归队。

完整团队时序能力要求 reconstruction 可用且至少一名本队成员有可靠 entity 映射。
如果重建、位置或 damage event 不可用，只要权威团队名册与队伍已解析，仍允许使用
`battle_results.dat` 做 summary fallback；API 的 `TeamFeatureCoverage.fullFeaturesAvailable=false`
和 `limitations` 会明确说明缺失内容。

#### 去重与分组

- **EXACT_DUPLICATE**：SHA-256 完全相同，只处理一次
- **SAME_TEAM_DUPLICATE_PERSPECTIVE**：同一战斗 + 相同队伍，只选质量最高的代表，不拼接事件流
- **独立 perspective**：同一场不同队伍分别分析；entityId、坐标、时钟和可见信息禁止跨视角补全
- **不同战斗**：各自保持独立时间线；每个 perspective 的有效 accountId 覆盖率
  `validAccountIds / authoritativeMemberCount` 必须不低于 0.75，且 roster
  `Jaccard = |A ∩ B| / |A ∪ B|` 不低于 0.60，才允许描述为同一阵容的跨场趋势

未点亮敌人的位置仍是未知。即使同时上传双方录像，也不能用对方录像补写某队当时未观察到的信息。

#### 团队特征与 AI 输入

`DefaultTeamBattleFeatureExtractor` 先按 team 过滤，再按 entity/member 分别压缩移动，避免两名队员坐标串成一条路径。输出分为：

- `TeamAggregateResult`：结算权威团队聚合；
- `TeamObservedAggregate`：事件流已归因的伤害观测子集，并单独记录 `unattributedDamageEventCount`；
- `TeamMemberFeatureSet`：每名成员的独立移动、交火、关键事件和 limitations；
- `TeamFormationPhase`：15 秒窗口的质心、平均离散度与 100 米连通簇；
- `TeamFeatureCoverage`：重建、映射、位置、伤害覆盖与 full/fallback 状态；未归因 damage/position、
  越界 position 和非法 timestamp 分别计数。

确定性阈值如下：

- 相邻伤害事件间隔 `<= 10s` 属于同一 engagement；
- 同一目标在任意 `<= 5s` 滑动窗口内被至少 2 名己方成员命中，才是 focus-fire candidate；
- 观测伤害严格超过对方 `1.25` 倍才判定交火优势/劣势，恰好 `1.25` 倍仍为均势；
- 阵型按 `15s` 分窗，X/Z 距离 `<= 100m` 的成员属于同一连通簇；
- 团队特征仅接受 `|x|, |z| <= 1050 (1000 + 50 CLAMP_TOLERANCE_RAW)`、`|y| <= 200` 的位置，以及 finite、非负时间戳。

发送给 AI 的是压缩特征，不是原始 event stream。prompt 长度由 token 估算器（`AiTokenEstimator`）按 `AiModelProperties` 预算控制（`singleReplayMaxInputTokens` 等），不再使用固定成员数/事件数/字符数截断（历史文档中的 15 名成员、30,000 字符等固定上限已移除）；超限时追加 `AI_INPUT_TRUNCATED` limitation。文件名、昵称、地图名和证据文本以 JSON 字符串形式界定，并在 system prompt 中明确为不可信数据，而不是指令。

#### 错误处理

| 错误 | 原因 | 行为 |
|---|---|---|
| `NO_BATTLE_DATA` | 战绩解析失败或无可分析数据 | SSE `error` 事件（HTTP 200） |
| `AI_NOT_CONFIGURED` | 未配置 AI 密钥 | SSE `error` 事件（HTTP 200） |
| `MIXED_RANDOM_BATTLE_RECORDERS` | 多场随机战斗录像者不同 | SSE `error` 事件（HTTP 200） |
| `MIXED_ANALYSIS_SCOPES` | 混合随机与训练/联赛，或混入 UNKNOWN | SSE `error` 事件（HTTP 200） |
| `UNSUPPORTED_BATTLE_CATEGORY` | 战斗类型无法识别 | SSE `error` 事件（HTTP 200） |
| `PERSPECTIVE_TEAM_UNRESOLVED` | 无法可靠确定录像者所在队 | SSE `error` 事件（HTTP 200） |
| `PERSPECTIVE_TEAM_CONFLICT` | 多个可靠证据给出不同队伍 | SSE `error` 事件（HTTP 200） |
| `AI_INVALID_REQUEST` / `AI_AUTHENTICATION_ERROR` / `AI_RATE_LIMITED` | 上游拒绝请求 | SSE `error` 事件（HTTP 200） |
| `AI_CONTEXT_TOO_LARGE` / `AI_TIMEOUT` / `AI_UPSTREAM_UNAVAILABLE` | 上游容量、超时或服务异常 | SSE `error` 事件（HTTP 200） |
| `AI_EMPTY_RESPONSE` / `AI_RESPONSE_INVALID` | 上游返回空白、畸形 JSON 或非法 envelope | SSE `error` 事件（HTTP 200） |
| `AI_REVIEW_BUSY` | AI Review worker 池饱和（workers + queue 全占用） | 返回 503 + `{"code":"AI_REVIEW_BUSY"}`，流尚未开始（worker 提交失败） |
| `NO_REPLAY_FILE(S)` / `INVALID_REPLAY_FILE_TYPE` / `FILE_TOO_LARGE` / `REPLAY_FILE_COUNT_EXCEEDED` / `TOTAL_REQUEST_TOO_LARGE` / `UNKNOWN_LOCALE` | request-envelope 预校验失败（提交 worker 前同步执行） | 返回 400 结构化错误码，不进入 SSE 流 |
| 单个文件解析/重建失败 | 进入逐文件处理后的文件级错误 | 与其他已通过预校验的文件隔离 |

上游日志只保留 provider/model/status、请求字符数、分析模式、correlation ID 和脱敏限长错误摘要；
API Key、Authorization、完整 Prompt 与原始事件流不得写入日志。前端按稳定英文码提供
zh/en/ru 文案，未知 Java/后端文本不直接展示。
