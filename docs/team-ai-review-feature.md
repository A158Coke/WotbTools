# WotbTools：训练房 / 联赛 Team-Level AI 战术复盘 — 设计文档

## 概述

训练房和联赛回放现在可以通过 AI Review 进行 Team-Level 战术复盘。

分析对象是整支录像者所在队伍，而非录像者个人。

## 产品语义

- Recorder raw team 1 → team 1 为分析对象
- Recorder raw team 2 → team 2 为分析对象
- 未知 team → UNKNOWN
- 胜负三态：TEAM_WIN / TEAM_LOSS / DRAW_OR_UNKNOWN
- draw/unknown 不压缩为 loss

## 系统架构

```
ReconstructionController.analyze()
  → AiReplayReviewService.analyze(MultipartFile[])
    → validateBatchSize() [16-file guard]
    → file validation (extension/empty/size/total)
    → DefaultReplayProcessingFacade.process()
    → BatchAnalyzer.analyze()
    → AiReplayAnalysisService.analyzeTeamGroups()
      → buildSingleTeamContext()
      → buildPartitions() [complete-link]
      → TeamAiPromptBuilder.single()/multi()
    → AnalyzeResponse
```

### 16 文件边界

AI Review 单次最多接受 16 个原始回放文件。校验早于 getBytes/hash/parsing。
空文件和重复文件计入原始数量。
`/api/replay/process` 和 `/api/replay/reconstruct-batch` 不受此限制。

### Prompt 三层预算

P1 (Mandatory): context type / analysisUnitId / perspective isolation / unitLimitations / omission / truncation
P2 (High-priority facts): authoritative aggregate / observed aggregate / memberFacts / coverage
P3 (Optional): memberMovements / formation / battlePhases / engagements / keyEvents

- Budget planning uses actual pre-built block lengths
- High-priority block is atomically written (all-or-nothing)
- Optional details can be truncated per-unit

### Unit 状态

- analysisUnitCount: 识别单元总数
- analyzedUnitCount: 进入 prompt 并获得 AI 输出的单元
- omittedAnalysisUnitCount: prompt cap/budget 导致的省略
- unavailableAnalysisUnitCount: capability/data 不足无法分析的单元

数学关系: total = analyzed + omitted + unavailable

### Limitation 契约

Global: `PERSPECTIVE_TIMELINES_ISOLATED`, `ROSTER_CONSISTENCY_UNCONFIRMED`, `PERSPECTIVES_OMITTED_COUNT_<N>`, `AI_INPUT_TRUNCATED`
Per-unit: `DUPLICATE_TEAM_MEMBER_ACCOUNT_IDS`, `BATTLE_END_UNRESOLVED`, `AI_PERSPECTIVE_OMITTED_FROM_PROMPT`, `AI_INPUT_TRUNCATED`

Global limitations 不出现在 unit report。Per-unit limitations 不出现在 global list。

### 安全

Provider error body: 不记录原始 text。日志仅含 provider/model/status/code/requestChars/mode/correlationId/body length。
Authorization header, Bearer/Basic/Digest: 内存分类使用，不写入日志。
JSON textual value: 不保留任意不可信 provider message。

```text
SINGLE_TEAM_BATTLE
MULTI_TEAM_BATTLE
```

只有团队实现、测试和前端展示全部完成后，才能删除该保护。

## 1.2 Capability 永远禁止团队分析

当前 `DefaultReplayProcessingFacade` 存在类似逻辑：

```java
final boolean perspectiveTeamResolved = false;
...
teamFeatureExtractionPossible = false;
```

导致训练房即使成功解析和重建，也永远不可进入团队 AI。

必须改为依据真实解析结果计算，禁止直接写死为 `true`。

## 1.3 当前 Team extractor 不能用于生产

当前 `DefaultTeamBattleFeatureExtractor`：

- 没有按 `perspectiveTeam` 过滤位置事件；
- 把双方全部位置事件加入 `teamPositions`；
- 把双方全部伤害事件加入 `teamDamageEvents`；
- `buildTeamEngagements()` 永远返回空列表；
- 无法区分本队造成与受到的伤害；
- `perspectiveTeam` 基本未参与实际计算；
- 可能把全场第一次伤害错误称为“本队首次伤害”；
- 把多个实体的位置混成一条 Movement path。

禁止在此状态下把数据交给 AI。

## 1.4 AI Service 只有个人分析

当前服务只有个人分析入口，例如：

```text
analyzePlayerContext
analyzePlayerOrFallback
analyzeMulti
```

（`analyzeMultiPlayerContext` 已被删除——该路径使用 `boolean victory` 两态压缩且无生产调用方；生产 multi-player 统一使用 `analyzeMulti(List<Battle>)` + `FriendlyEnemyResult.Winner` 三态。）

缺少 Team-Level 对应入口、摘要构建和 Prompt。

## 1.5 文件状态类型被硬编码

`buildFileStatuses()` 当前将 primary 文件硬编码为：

```java
BattleCategory.RANDOM
```

训练房和联赛必须返回真实类别。

## 1.6 文档和测试不一致

当前 Changelog 声称存在：

```text
DefaultTeamBattleFeatureExtractorTest
```

但最新 `main` 中没有对应测试文件。

需要修正文档，并补充真实存在、真实执行的测试。

---

# 2. 产品语义

## 2.1 随机战斗

保持现有语义：

```text
RANDOM
→ PLAYER_FOCUSED
→ 分析录像者个人表现
```

本任务不得破坏现有随机战斗单场和多场 AI 复盘。

## 2.2 训练房与联赛

训练房和联赛采用团队视角：

```text
TRAINING / TOURNAMENT
→ TEAM_PERSPECTIVE
→ 分析录像者所属整支队伍
```

录像者只用于确定：

```text
perspectiveTeam
```

确定队伍后：

- 不评价录像者个人；
- 不围绕录像者生成建议；
- 不因录像者是谁而改变同一队伍的分析结果；
- 分析本队阵型、路线、交火、交换、掉车、转场和协作。

## 2.3 团队共享视野规则

WoT Blitz 队伍内共享点亮信息。

因此同一场战斗中：

```text
同一 perspectiveTeam 的多个队员回放
```

视为同一个团队信息视角，通常是冗余数据。

处理规则：

- 同一场、同一队的多个回放按 `BattleIdentity + perspectiveTeam` 分组；
- 只选择质量最高的代表回放；
- 其他回放标记为 `SAME_TEAM_DUPLICATE_PERSPECTIVE`；
- 禁止把同队多个回放的事件流直接拼接；
- 不因为上传多个同队回放而重复调用 AI；
- 同一场两个不同队伍是两个独立 perspective；
- 不允许把双方 perspective 合并成一个“共同队伍”分析。

“团队共享视野”不等于服务器全知视角：

- 未被该队伍发现的敌方位置仍然未知；
- 不得声称掌握未点亮敌人的实时位置；
- 不得用对方回放信息反向补全本队当时不知道的信息；
- 如果用户同时上传双方回放，应分别生成两个 perspective 单元。

---

# 3. 数据可靠性等级

必须明确区分以下数据来源。

## 3.1 权威结算数据

来自：

```text
battle_results.dat
Battle
PlayerResult
```

可作为确定事实：

- 队伍；
- 玩家；
- 车辆；
- 最终伤害；
- 最终承伤；
- 助攻；
- 格挡；
- 击杀；
- 是否存活；
- 阵亡时间；
- 胜负；
- 地图；
- 战斗时长。

## 3.2 重建数据

来自：

```text
ReplayReconstruction
ReplayEvent
BattleParticipant
ParticipantMappingEvent
PositionChangedEvent
DamageEvent
```

必须携带或尊重已有置信度：

```text
EXACT
INFERRED
PARTIAL
UNKNOWN
```

只允许在映射可靠时进行实体归因。

## 3.3 事件流限制

当前事件流中的 Damage 数据可能只是观测子集，不是结算总伤害。

因此必须同时保留：

```text
authoritative team totals
observed event subset
coverage / confidence / limitations
```

禁止把事件流观测伤害冒充权威总伤害。

## 3.4 禁止推断

没有明确证据时，禁止 AI 声称：

- 某位玩家正在装填；
- 某位玩家弹夹为空；
- 某次射击未击穿；
- 某位玩家使用了某种炮弹；
- 某位玩家装备了某个配件；
- 某位玩家处于敌方射界；
- 某处一定是卖头位；
- 某辆未点亮敌车的准确位置；
- 某次转场的主观意图；
- 某个具体地形名称，除非项目有可靠地图坐标语义。

无法确定时输出：

```text
UNKNOWN
无法从当前回放数据确定
```

---

# 4. Perspective Team 解析

实现统一的 Team Perspective Resolver，禁止在多个类中重复写映射逻辑。

建议新增独立类，例如：

```text
TeamPerspectiveResolver
TeamPerspectiveResolution
```

至少使用以下证据：

1. `Battle.recorder`；
2. `Battle.recorderResult()`；
3. `PlayerResult.team`；
4. `ReplayReconstruction.participants()`；
5. `ParticipantMappingEvent`；
6. accountId / nickname / entityId 的可靠匹配。

返回值至少包含：

```java
public record TeamPerspectiveResolution(
        Integer perspectiveTeam,
        Long recorderAccountId,
        Integer recorderEntityId,
        DecodeConfidence confidence,
        List<String> limitations
) {
    public boolean resolved() {
        return perspectiveTeam != null && perspectiveTeam > 0;
    }
}
```

规则：

- 优先使用权威结算数据确定 recorder 所属队伍；
- reconstruction 仅用于补充 entity 映射；
- nickname fallback 必须记录 `INFERRED`；
- 多个证据冲突时不得静默选择；
- 冲突返回未解析，并记录稳定错误原因；
- 不得默认 team 1；
- 不得把 `0` 当作有效队伍；
- 队伍解析失败时不能调用团队 AI。

稳定错误码建议：

```text
PERSPECTIVE_TEAM_UNRESOLVED
PERSPECTIVE_TEAM_CONFLICT
TEAM_ENTITY_MAPPING_INSUFFICIENT
TEAM_FEATURES_UNAVAILABLE
```

API 错误码保持英文，中文由前端 i18n 处理。

---

# 5. Entity → Participant → Team 映射

实现单一、可复用的 Team Entity Mapping。

必须建立：

```text
entityId
→ BattleParticipant
→ accountId / nickname / tankId
→ team
→ mapping confidence
```

禁止只通过 entityId 数值范围猜队伍。

映射应优先使用：

```text
ParticipantMappingEvent
ReplayReconstruction.participants()
Battle.players
```

必须处理：

- accountId 可用；
- nickname 可用但 accountId 缺失；
- entityId 未映射；
- 同名冲突；
- spectator / observer / 非车辆实体；
- entity re-entry；
- entity leave；
- 不属于有效队伍的实体；
- 映射置信度不足。

未知实体的事件可以计入：

```text
unattributedEventCount
```

但不能归给本队或敌队。

---

# 6. Team Feature 数据模型

禁止继续把多个队员的位置事件压缩成一条公共 Movement path。

应增加队员级特征模型，例如：

```java
public record TeamMemberFeatureSet(
        Integer entityId,
        Long accountId,
        String nickname,
        Integer tankId,
        String tankName,
        int team,
        DecodeConfidence mappingConfidence,
        List<MovementSegment> movements,
        List<EngagementSummary> engagements,
        List<KeyBattleEvent> keyEvents,
        List<String> limitations
) {
}
```

团队级模型应至少包含：

```java
public record TeamBattleFeatureSet(
        int perspectiveTeam,
        List<TeamMemberFeatureSet> members,
        TeamAggregateResult authoritativeAggregate,
        TeamObservedAggregate observedAggregate,
        List<TeamFormationPhase> formationPhases,
        List<TeamEngagementSummary> engagements,
        List<KeyBattleEvent> keyEvents,
        TeamFeatureCoverage coverage,
        List<String> limitations,
        boolean hasFeatures
) {
}
```

具体命名可依据现有代码风格调整，但必须满足：

- 每名队员的 movement 独立；
- 本队和敌队分离；
- 权威结算与事件流子集分离；
- 未归因事件单独统计；
- AI 能看到数据限制；
- 不能依靠自然语言字符串保存核心计算结果。

所有集合必须：

- 非 null；
- 顺序确定；
- 输出可复现；
- 必要时使用不可变 List。

---

# 7. 团队确定性指标

AI 调用前，由后端确定性计算团队指标，禁止要求 AI 自行加总原始数字。

## 7.1 权威团队结算聚合

至少计算：

```text
teamTotalDamageDealt
teamTotalDamageReceived
teamTotalAssistedDamage
teamTotalBlockedDamage
teamTotalKills
teamSurvivorCount
teamDeathCount
averageDeathTime
firstDeathTime
lastDeathTime
win
```

只使用 `Battle` / `PlayerResult`。

## 7.2 队员级时间线

每个本队成员至少保留：

```text
nickname
tank
finalDamage
damageReceived
assistedDamage
blockedDamage
kills
survived
deathTime
movement summary
mapping confidence
```

## 7.3 团队移动与阵型

基于可靠位置事件，可以计算：

- 初始队伍分散度；
- 队伍 centroid；
- 队员到 centroid 的距离；
- 队伍是否分成多个 cluster；
- 队员间距离变化；
- 大规模转场；
- 掉队成员；
- 多名成员同时向同方向移动；
- 队形收缩或扩散。

禁止：

- 把不同 entity 的相邻 Position event 连成一段移动；
- 在无地图区域定义时凭坐标命名“重坦线”“中坦线”“A 点”等；
- 把坐标变化直接解释成玩家意图。

所有公式、时间窗口和阈值必须：

- 提取为命名常量；
- 在代码注释或开发文档说明；
- 具有边界测试；
- 不使用散落 magic numbers。

## 7.4 团队交火

只有在 source/target entity 映射可靠时才计算：

```text
team damage dealt subset
team damage received subset
engagement windows
focus-fire candidates
target switching
damage exchange
```

必须明确：

```text
事件流交火数据是观测子集
```

如果 Damage event 无法可靠映射 source/target：

- 不归因；
- 增加 limitation；
- 不生成 focus-fire 结论；
- 不用 `0` 表示“确定没有伤害”。

## 7.5 关键事件

可以使用的关键事件包括：

- 权威首个己方阵亡；
- 权威连续掉车；
- 权威击杀变化；
- 可可靠映射的首次接敌；
- 可可靠映射的集中伤害；
- 多名成员转场；
- 队形明显分裂；
- 战斗结束。

事件必须包含：

```text
time
type
description/evidence key
confidence
source
related entities
```

核心模型和 API 中不应硬编码中文描述；使用稳定英文 key，展示层本地化。

---

# 8. Team Feature Extractor

重构或替换：

```text
DefaultTeamBattleFeatureExtractor
```

要求：

1. `perspectiveTeam` 必须真实参与过滤；
2. 只把己方实体的位置放入本队成员特征；
3. 敌方事件只能作为该队伍实际观察到的对手信息；
4. 未映射实体不得进入己方统计；
5. 每名队员单独压缩 Movement；
6. 不得复用会跨 entity 连接坐标的算法；
7. team engagements 必须真实实现或诚实标记 unavailable；
8. `hasFeatures` 不能仅由“存在一个 DamageEvent”决定；
9. 空事件流应得到稳定、可解释的空结果；
10. 输入顺序不同不应改变聚合结果；
11. 不得修改 `ReplayReconstruction`；
12. 不得原地修改共享事件集合。

`hasFeatures` 建议至少要求：

```text
perspectiveTeam resolved
AND at least one team member resolved
AND (
    authoritative team result available
    OR usable reconstructed team feature available
)
```

团队 AI 应允许在 reconstruction 部分不可用时使用权威结算数据做降级分析，但必须明确：

```text
位置/阵型分析不可用
```

不能把“没有完整位置”整体误判成 `NO_BATTLE_DATA`。

---

# 9. Capability 修复

修复 `DefaultReplayProcessingFacade` 的 capability 构建。

必须基于事实计算：

```text
perspectiveTeamResolved
teamFeatureExtractionPossible
```

例如：

```text
perspectiveTeamResolved =
    teamResolution.resolved()

teamFeatureExtractionPossible =
    reconstructionAvailable
    && perspectiveTeamResolved
    && entityTeamMapping has sufficient usable members
```

但团队基础 AI 可分析能力应区分：

```text
teamSummaryAnalyzable
teamFullFeatureAnalyzable
```

不要把“有权威结算，可以做基础团队复盘”和“有完整阵型特征”混成一个 boolean。

如果不希望给 `ReplayProcessingCapabilities` 增加混合语义字段，可以：

- 保持它只描述事实；
- 在 `BatchAnalyzer.isAiAnalyzable()` 中组合事实；
- Team context builder 自己决定 full-feature 或 fallback。

不得重新引入 scope-dependent 的含糊字段。

---

# 10. BatchAnalyzer 与去重

保留现有：

```text
BattleIdentity + perspectiveTeam
```

分组规则，并补齐测试。

要求：

## 10.1 同场同队

```text
同一 BattleIdentity
相同 perspectiveTeam
```

只产生一个 Analysis Unit。

代表回放按现有质量排序选取：

```text
reconstruction available
stream complete
decoded ratio
failed packets
unknown packets
resync count
```

## 10.2 同场不同队

产生两个独立 Analysis Unit：

```text
battle-X-team-1
battle-X-team-2
```

禁止互相合并信息。

## 10.3 不同战斗

保持独立时间轴和 entity namespace。

不得拼接原始事件流。

## 10.4 多场团队趋势

只有在能够确认是同一队伍/高度重叠 roster 时，才能生成“同一队伍跨场趋势”。

如果无法确认：

- 对每个 perspective 单独报告；
- 可以做“上传样本集合概览”；
- 不能声称是同一支固定队伍的稳定习惯。

如实现 roster consistency，应使用确定性字段并说明阈值，不能仅根据 `team=1` 判断。

---

# 11. Team AI Context

完善现有：

```text
SingleTeamBattleAnalysisContext
MultiTeamBattleAnalysisContext
TeamBattleAnalysisSummary
```

## 11.1 Single Team Context

至少包含：

```text
battle identity
map
battle category
duration
perspective team
authoritative roster/results
team aggregate
member features
formation phases
team engagements
key events
coverage
limitations
source/confidence metadata
```

## 11.2 Multi Team Context

每个 perspective 必须保持独立：

```text
analysisUnitId
battle identity
perspective team
file name
team roster
team aggregate
compressed team features
limitations
```

禁止把不同场次：

- 时钟；
- entityId；
- 坐标；
- Damage event

混成一个公共流。

---

# 12. AiReplayAnalysisService

新增明确入口，例如：

```java
AnalyzeResult analyzeSingleTeamContext(
        SingleTeamBattleAnalysisContext context
);

AnalyzeResult analyzeMultiTeamContext(
        MultiTeamBattleAnalysisContext context
);
```

也可以使用统一 dispatcher，但必须类型安全，不能依靠 Object + instanceof 长链。

## 12.1 单场团队 Prompt

Prompt 必须要求：

1. 战局和阵容概述；
2. 开局分路与队形；
3. 首次接敌；
4. 团队交火与交换；
5. 关键掉车和转折；
6. 转场与协同；
7. 做得好的团队行为；
8. 团队级失误；
9. 3–5 条可执行训练建议；
10. 明确数据限制。

必须强调：

```text
分析对象是 perspectiveTeam，不是录像者个人。
录像者只决定队伍视角。
不得推断未点亮敌人的位置。
权威结算与事件流观测子集不可混淆。
无法判断时必须明确说明。
```

## 12.2 多场团队 Prompt

必须要求：

- 每场 perspective 独立；
- 引用具体场次、队伍和时间证据；
- 不混淆 entity/time；
- 只有 roster 一致性满足条件时才输出团队趋势；
- 否则只做样本集合比较；
- 不把对立双方当作同一队伍；
- 不根据一次事件总结长期习惯。

## 12.3 AI 输入压缩

禁止把完整原始 event stream、逐帧坐标或完整 mesh 发送给 DeepSeek。

必须由后端压缩：

- 每名成员的关键 movement segments；
- formation phases；
- team engagement summaries；
- key events；
- authoritative aggregates；
- limitations。

设置确定性的输入预算：

```text
max members
max movement segments per member
max team key events
max engagements
max input chars/tokens
```

不能静默截断。发生截断时必须增加 limitation：

```text
AI_INPUT_TRUNCATED
```

## 12.4 模型配置

继续使用可配置项：

```yaml
wotb:
  ai:
    api-key: ${AI_API_KEY:}
    base-url: ${AI_BASE_URL:https://api.deepseek.com}
    model: ${AI_MODEL:deepseek-v4-flash}
```

禁止在 Team service 中重新硬编码模型名。

CI 测试不得调用真实 DeepSeek。

---

# 13. Controller 集成

`ReconstructionController.analyze()` 必须完整处理：

```java
case SINGLE_PLAYER_BATTLE
case MULTI_PLAYER_BATTLE
case SINGLE_TEAM_BATTLE
case MULTI_TEAM_BATTLE
case NONE
```

要求：

## 13.1 SINGLE_TEAM_BATTLE

流程：

```text
代表回放
→ resolve perspective team
→ build team context
→ full features 或 authoritative fallback
→ aiService.analyzeSingleTeamContext()
→ AnalyzeResponse
```

## 13.2 MULTI_TEAM_BATTLE

流程：

```text
每个 perspective group 独立构建 summary
→ MultiTeamBattleAnalysisContext
→ aiService.analyzeMultiTeamContext()
→ AnalyzeResponse
```

## 13.3 删除门禁条件

只有团队路径完成后才能删除：

```text
TEAM_ANALYSIS_NOT_IMPLEMENTED
```

删除后全仓搜索，确保：

- 生产代码无残留；
- 前端不再把它作为正常业务错误；
- 文档不再声明团队未实现；
- 测试不再期待 422。

## 13.4 文件状态修复

禁止继续硬编码：

```java
BattleCategory.RANDOM
```

必须从每个 `ReplayProcessingResult.battle().arenaBonusType` 解析真实类别。

返回：

```text
RANDOM
TRAINING
TOURNAMENT
UNKNOWN
```

---

# 14. API 契约

保持当前 `/api/replay/analyze` multipart 接口兼容。

团队成功响应至少正确返回：

```json
{
  "mode": "SINGLE_TEAM_BATTLE",
  "totalFileCount": 1,
  "validFileCount": 1,
  "effectiveUnitCount": 1,
  "analyzedUnitCount": 1,
  "analysis": "...",
  "fileStatuses": [],
  "analysisUnits": [],
  "keyEvents": []
}
```

字段名称以当前 DTO 为准，不得擅自制造第二套相似契约。

`analysisUnits` 中团队单元必须包含：

```text
analysisUnitId
battle identity
scope = TEAM_PERSPECTIVE
perspectiveTeam
representative file
duplicate files
```

API 只返回英文枚举/key；显示文案由前端三语 i18n 提供。

---

# 15. AI 上游错误处理

当前代码只返回：

```text
AI_UPSTREAM_ERROR: HTTP 400
```

但丢失上游原因。

本任务需要同时修复诊断能力：

- 用户响应不得泄露上游敏感信息；
- 后端日志记录脱敏后的 provider、model、status、error code；
- 不记录 Authorization/API Key；
- 不记录完整 replay；
- 不记录完整 prompt；
- 可以记录 request size、analysis mode、correlation id；
- 上游 response body 只记录安全、长度受限的错误摘要。

稳定错误分类至少包括：

```text
AI_INVALID_REQUEST
AI_AUTHENTICATION_ERROR
AI_RATE_LIMITED
AI_CONTEXT_TOO_LARGE
AI_UPSTREAM_UNAVAILABLE
AI_TIMEOUT
AI_EMPTY_RESPONSE
AI_RESPONSE_INVALID
```

前端必须本地化，不能直接向普通用户展示 Java 异常类名。

---

# 16. 前端

更新 `ReconstructionPage.vue` 和三语 locale。

要求：

- 支持展示 `SINGLE_TEAM_BATTLE`；
- 支持展示 `MULTI_TEAM_BATTLE`；
- 明确显示“团队视角”；
- 显示 perspective team；
- 显示有效 analysis units；
- 显示被去重的同队回放；
- 显示数据限制；
- 团队报告不能使用“你的个人操作”语气；
- 随机战斗继续使用个人报告语义；
- API 错误码通过 zh/en/ru 三语本地化；
- 不显示 `TEAM_ANALYSIS_NOT_IMPLEMENTED`；
- 未获得成功结果时不显示空报告面板；
- loading 状态避免重复提交；
- 保持 admin-only 权限。

不得在前端重新计算团队统计。

---

# 17. 测试要求

## 17.1 Perspective Resolver

覆盖：

- 从 recorderResult 解析 team；
- 从 participant/accountId 解析；
- nickname fallback；
- recorder 不存在；
- team 为 0；
- 多证据一致；
- 多证据冲突；
- observer entity；
- 未映射 entity。

## 17.2 Team Entity Mapping

覆盖：

- 本队实体；
- 敌队实体；
- 未知实体；
- accountId 映射；
- nickname fallback；
- entity re-entry；
- 映射置信度。

## 17.3 Team Feature Extractor

必须新增真实存在的：

```text
DefaultTeamBattleFeatureExtractorTest
```

覆盖：

- 只提取 perspectiveTeam；
- 敌队位置不会进入本队 movement；
- 两名队员的移动不会串成一条路径；
- 本队 dealt/received 正确归因；
- 未映射 Damage 不归因；
- 空事件；
- 无 Damage 但有权威结算；
- 关键掉车；
- 队形分裂与聚合；
- 事件输入顺序稳定性；
- limitation；
- `hasFeatures` 语义。

## 17.4 BatchAnalyzer

覆盖：

- TRAINING → TEAM_PERSPECTIVE；
- TOURNAMENT → TEAM_PERSPECTIVE；
- 同场同队多回放去重；
- 同场不同队保持独立；
- 随机与训练房混合报错；
- UNKNOWN 混合报错；
- SINGLE_TEAM_BATTLE；
- MULTI_TEAM_BATTLE；
- capability 不满足时正确降级或返回稳定错误。

## 17.5 AI Service

使用 stub/fake HTTP server，禁止真实消费 API。

覆盖：

- single team request；
- multi team request；
- model 取配置；
- prompt 包含 perspectiveTeam；
- prompt 包含 limitations；
- 不包含原始事件流；
- 上游 400；
- 上游 401；
- 上游 429；
- timeout；
- 空响应；
- 非法响应。

## 17.6 Controller

MockMvc 覆盖：

- 单个训练房成功；
- 多个同队训练房回放只分析一次；
- 同场双方回放生成两个 units；
- 多场团队分析；
- perspective unresolved；
- team feature unavailable fallback；
- AI not configured；
- AI upstream error；
- 非 admin 拒绝；
- 随机战斗回归测试。

## 17.7 前端

Vitest 覆盖：

- SINGLE_TEAM_BATTLE 展示；
- MULTI_TEAM_BATTLE 展示；
- team perspective 文案；
- duplicate perspective；
- limitations；
- 英文错误码本地化；
- loading；
- 失败时不保留旧报告；
- 随机战斗个人报告不回归。

---

# 18. 文档同步

同一次提交必须更新：

```text
docs/CHANGELOG.md
docs/CHANGELOG-PRODUCT.md
docs/DEVELOPER_GUIDE.md
docs/replay-data.md
java/README.md
相关前端 README（如适用）
```

要求：

- 删除“TEAM_ANALYSIS_NOT_IMPLEMENTED”作为当前限制；
- 说明训练房/联赛使用 Team Perspective；
- 说明录像者只决定 perspectiveTeam；
- 说明同队多个回放冗余；
- 说明同场双方是独立 perspectives；
- 说明未点亮敌人仍未知；
- 说明权威结算与事件流子集；
- 说明 fallback；
- 说明 AI 输入预算；
- 修复 Changelog 声称测试存在但文件缺失的问题；
- 文档必须与最终代码一致，不得提前宣称未完成能力。

---

# 19. 禁止事项

禁止：

- 只删除 `TEAM_ANALYSIS_NOT_IMPLEMENTED`；
- 返回空字符串伪装成功；
- 把双方事件都算作本队；
- 把不同 entity 的坐标串成一条 Movement；
- 将同队多回放原始事件流拼接；
- 用对方回放补全本队当时未知的信息；
- 把 `perspectiveTeam` 默认设为 1；
- 把 capability 直接硬编码为 true；
- 把事件流伤害当作权威总伤害；
- 在后端模型中硬编码中文；
- 把原始 event stream 发给 AI；
- 在 CI 调用真实 DeepSeek；
- 记录 API Key、Authorization 或完整 prompt；
- 破坏现有随机战斗 AI；
- 修改 leaderboard 的随机战斗限制；
- 顺手开发车辆知识库、装甲模型或地图动画；
- 引入第二套重复的回放处理 pipeline；
- 使用通配 import；
- 修改已应用 Flyway migration；
- 留下 TODO 占位后宣布完成；
- 文档宣称完成但测试文件不存在。

---

# 20. 验证命令

后端：

```bash
cd java
JAVA_HOME=<JDK21_PATH> mvn -s settings.xml test
```

前端：

```bash
cd frontend
npm ci
npm run test
npm run build
```

全仓残留检查：

```bash
rg -n \
  "TEAM_ANALYSIS_NOT_IMPLEMENTED|perspectiveTeamResolved = false|BattleCategory\\.RANDOM" \
  java frontend docs
```

注意：

- `BattleCategory.RANDOM` 在真正随机战斗逻辑中允许存在；
- 必须人工检查每个匹配；
- 不允许训练房状态继续硬编码 RANDOM。

检查 Team context 使用情况：

```bash
rg -n \
  "SingleTeamBattleAnalysisContext|MultiTeamBattleAnalysisContext|DefaultTeamBattleFeatureExtractor" \
  java
```

必须确认它们已进入生产调用链，不再只是未使用骨架。

检查测试文件：

```bash
find java -type f \
  | grep -E "Team.*Test|.*TeamBattle.*Test"
```

---

# 21. Grill-Fix 闭环

完成代码后，按仓库 Grill-Fix 规范反复检查：

1. 团队/敌队是否混淆；
2. entity/team mapping；
3. 未知实体；
4. null/空集合；
5. 输入顺序；
6. 时间单位；
7. entity re-entry；
8. duplicate perspective；
9. 同场双方；
10. 多场时钟隔离；
11. capability 是否诚实；
12. fallback 是否误称完整分析；
13. Prompt 是否可能诱导幻觉；
14. API key 和日志脱敏；
15. 三语 i18n；
16. 文档与代码；
17. 未使用 Team skeleton；
18. 临时日志和 TODO；
19. 随机战斗回归；
20. 测试是否真正执行。

发现问题后修复并重新执行 Grill，直到没有新增问题。

---

# 22. 完成标准

只有全部满足才算完成：

- 训练房单文件不再返回 `TEAM_ANALYSIS_NOT_IMPLEMENTED`；
- 联赛回放可以进入 Team Perspective；
- `SINGLE_TEAM_BATTLE` 有真实 AI 报告；
- `MULTI_TEAM_BATTLE` 有真实 AI 报告；
- 同场同队多回放只分析一次；
- 同场双方保持独立；
- recorder 只用于解析 perspective team；
- Team extractor 不混入敌队事件；
- 每名成员 movement 独立；
- 权威结算与事件流子集分离；
- capability 不再硬编码；
- Controller 不再硬编码训练房为 RANDOM；
- Team context 已进入生产调用链；
- DeepSeek 模型继续通过配置读取；
- 上游错误可诊断且不泄露 Secret；
- 前端完整支持两种 Team mode；
- zh/en/ru 完整；
- 后端测试通过；
- 前端测试和 build 通过；
- 随机战斗 AI 无回归；
- 文档同步；
- 无临时 TODO；
- 无已知技术债。

---

# 22b. 时间域、坐标域与证据边界契约（PR #39 修复）

以下不变量在生产代码中强制成立，AI prompt 只消费满足这些契约的结构化语义：

## 时间统一为 battle-relative

- 所有 tactical 时间（movement、engagement、first contact、key event、battle phase）都以 **battle-relative 秒**表示，battle start = 0。
- raw replay clock 只通过 `BattleStartResolution.battleRelative(rawClock)` 转换一次；`BattleStartResolution.isPreBattle(rawClock)` 判断准备阶段。
- `battle.durationS` 本身就是 battle-relative duration，直接使用，**不再减去 battle start**。
- replay `BattleEndedEvent.safeClockSec()` 和 `lastObservedClock(...)` 都是 raw replay clock，必须经 `battleRelative(...)` 转换后才能作为 phase end；转换结果非有限或为负则退回 unknown/limitation，raw absolute clock 绝不进入 prompt。
- `buildRelativePhases(firstContactRelative, battleEndRelative)`：`battleEndRelative` 必须 finite 且 `>=0`，否则返回稳定空 fallback；`firstContactRelative < 0`（`UNKNOWN_FIRST_CONTACT = -1`）表示无接敌，`0` 是合法接敌时刻；`openingEnd` 裁剪进 battle end；FIRST_CONTACT 仅在 first contact finite、`>=0` 且 `<= battleEnd` 时创建。每个 phase 满足 `finite`、`start>=0`、`end>=0`、`start<=end`、`end<=battleEnd`（由 `BattlePhaseSummary` compact constructor 兜底）。

## 坐标：raw replay vs canonical 500×500

- canonical 地图固定为 **500×500 米**，X/Z 为水平轴，Y（高度）不参与九宫格。
- 九宫格 region 1–9，从上到下、从左到右，边界集中定义于 `MapRegionResolver.resolveRegion(canonicalX, canonicalZ)`；Player 与 Team 共用同一 resolver，region 由后端确定性计算，AI 不依据裸坐标猜测。
- raw replay 坐标只经过一次 `MapRegionResolver.resolve(...)`：越界但有限的坐标 clamp 到 `[0,500]` 并标记 `CLAMPED`；NaN/Infinity/结构损坏为 `INVALID`（不可用证据，非 CLAMPED）。
- 强类型 `CanonicalMapPosition`（构造期校验 `[0,500]`）承载已解析的 canonical 坐标；`TeamFormationPhase.centroid` 与 `TeamFormationCluster.centroid` 均为 `CanonicalMapPosition`，下游 `TeamAiPromptBuilder.formatCanonicalPosition(...)` 只校验/取 region/格式化，**不再执行 raw→canonical 映射**；raw 坐标（movement start/end）经 `formatRawPosition(...)` 解析。
- formation centroid、cluster centroid 都在 canonical 坐标域中计算一次：cluster 先对每个成员位置 resolve/clamp 到 canonical，再在 canonical 空间求平均（不是先平均 raw 再转换）。
- movement distance/speed 使用 **canonical 米**：`MapRegionResolver.canonicalDistanceMeters(...)` 对每个端点先转 canonical 再求欧氏距离；speed = canonical 米 / battle-relative 秒；stationary 阈值 `STATIONARY_THRESHOLD_METERS`（canonical 米）集中定义于 `DefaultPlayerBattleFeatureExtractor`，Player 与 Team member movement 共用同一算法与单位；时间差 `<=0`、倒序或无效时间戳不产生 Infinity/NaN 速度。

## 证据边界与 coverage 不变量

- 单一共享时间分类器 `classifyTime(event)` → `USABLE / INVALID_TIMESTAMP / PRE_BATTLE`，被 damage 循环、`teamPositionsByEntity`、`auditPositionEvidence` 与 phase guard 复用，避免各路径维护漂移的时间规则。
- `INVALID_TIMESTAMP`（NaN/Infinity/负）证据只计入 invalid-timestamp coverage，**不计入 unattributed tactical count**；只有战斗内、时间合法但身份不可归属的 damage 才算 unattributed。`PRE_BATTLE` 证据一律不进入任何战术统计：damage（attributed/unattributed、observed aggregate、engagement、first contact、focus fire、key event）、position（observed/clamped/movement/formation/cluster）。
- `MovementSegment` compact constructor 强制不变量：所有 float 有限、时间/距离/速度非负、`start<=end`、`type`/位置/`confidence` 非空；`rawStartPosition`/`rawEndPosition` 字段名显式标注为 raw replay 坐标域。
- position coverage：`observedPositionEventCount` 是真正参与分析的位置数；`clampedPositionEventCount` 是其严格子集（同一集合按 status 过滤），`TeamFeatureCoverage` compact constructor 强制 `0 <= clamped <= observed`；`auditPositionEvidence(...)` 使用 `BattleStartResolution` 排除 pre-battle 与无效时间戳，敌方/不可归属位置不计入本队 coverage、cluster、formation。
- `INVALID` 与 `CLAMPED` 区分：INVALID 是不可用证据（丢弃并计入越界/无效计数），CLAMPED 是已观测、参与分析并附带 `MAP_COORDINATES_CLAMPED` limitation 的降级证据。
- structured cluster 至少包含 canonical centroid、region、member identities、派生 memberCount、battle-relative start/end、confidence 与 clamped/limitation 信息；`memberCount` 与 identities 数量一致，region 与 canonical centroid 一致。

## perspective 隔离

- TEAM_PERSPECTIVE 只使用该 perspective 当时合法观察到的信息，不通过敌方录像补全本队未发现的信息，不构建全知视角；同队多录像共享视野仅作冗余证据，opposing perspectives 独立分析、不被错误统计为两场 battle。

---

# 23. 最终报告格式

完成后输出：

```text
1. 根因
2. 最终架构
3. 修改文件列表
4. Team Perspective 解析规则
5. Entity-Team 映射规则
6. 同队回放去重规则
7. AI 输入与证据边界
8. SINGLE_TEAM_BATTLE 实现
9. MULTI_TEAM_BATTLE 实现
10. 前端变化
11. 测试结果
12. Grill 轮次、发现问题数、修复数
13. 剩余限制
14. 手动验证步骤
```

如果任何完成标准未满足，必须明确写为未完成，不得使用“基本完成”“大致可用”掩盖。