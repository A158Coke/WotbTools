# WotbTools：训练房 / 联赛 Team-Level AI 战术复盘 — 设计文档

## 概述

训练房和联赛回放现在可以通过 AI Review 进行 Team-Level 战术复盘。

分析对象是整支录像者所在队伍，而非录像者个人。

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

## 2. 入口和分层

```
ReconstructionController.analyze()
  -> AiReplayReviewService.analyze(MultipartFile[], AllowedLanguage)
    -> validateBatchSize() [1-file guard]
    -> file validation (extension/empty/size/total)
    -> DefaultReplayProcessingFacade.process()
    -> BatchAnalyzer.analyze()
    -> AiReplayAnalysisService.analyzeTeamGroups(groups, AllowedLanguage)
      -> buildSingleTeamContext()
      -> buildPartitions() [complete-link]
      -> TeamAiPromptBuilder.single()/multi()
    -> AnalyzeResponse
```

Controller 只负责 HTTP binding + 委托 Service。Service 接管 validate / process / BatchAnalyzer / AI orchestration。

## 3. 上传边界

- AI Review 单次最多 1 个原始回放文件
- 原始数量检查早于 getBytes / hash / parsing
- 空文件和重复文件计入原始数量
- 单文件 <= 20MB，总请求 <= 200MB
- `/api/replay/process` 和 `/api/replay/reconstruct-batch` 不受 1 文件限制

## 4. Grouping 与 Partition

- Exact duplicate detection（同一文件上传多次）
- Perspective grouping（同一战斗同一队伍合并为一个代表）
- Opposing perspectives 永远不可合并（同战斗不同队伍）
- Complete-link partition：新 context 必须与分区内每个现有成员都兼容
- Roster coverage >= 0.75 且 Jaccard >= 0.60 才能合并
- Partition 输出顺序按输入顺序稳定

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
- Tank 名通过 `common/tankopedia.json` 解析（单一数据源）
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

### 四类计数

| 字段 | 含义 |
|------|------|
| `analysisUnitCount` | BatchAnalyzer 识别出的独立 analysis units 总数 |
| `analyzedUnitCount` | 实际进入 provider prompt 并获得 AI 输出的 units |
| `omittedAnalysisUnitCount` | 因 perspective cap 或 prompt budget 被省略的 units |
| `unavailableAnalysisUnitCount` | 因 capability/data 不足无法分析的 units |

**不变量：** `analysisUnitCount = analyzedUnitCount + omittedAnalysisUnitCount + unavailableAnalysisUnitCount`

### 四类计数

四类计数由上一节的不变量契约保证（后端返回）；当前前端 `AnalysisResultPanel` 仅渲染最终 Markdown 报告，不再逐单元展示计数明细。

## 9. Limitations

### Global（仅存在于 `AnalyzeResponse.limitations`）

- `PERSPECTIVE_TIMELINES_ISOLATED`
- `ROSTER_CONSISTENCY_UNCONFIRMED`
- `PERSPECTIVES_OMITTED_COUNT_<TOTAL>`（多 partition 聚合）
- `AI_INPUT_TRUNCATED`

### Per-unit（仅存在于对应 `TeamAnalysisUnitReport.limitations`）

- `DUPLICATE_TEAM_MEMBER_ACCOUNT_IDS`
- `TEAM_MEMBER_ENTITY_UNMAPPED`
- `TEAM_MEMBER_MOVEMENT_UNAVAILABLE`
- `BATTLE_END_UNRESOLVED`
- `AI_PERSPECTIVE_OMITTED_FROM_PROMPT`
- `AI_INPUT_TRUNCATED`（仅当该 unit 实际发生 truncation）

### 隔离规则

- Global limitations 不出现在 unit report
- Per-unit limitations 不出现在 global list
- Partition A 的 global limitation 不泄漏到 partition B 的 unit
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
- limitation code 由后端合并去重写入报告；前端不再逐单元渲染 limitation 明细
- 文件交互：单文件选择（替换而非追加），超限拒绝，单文件删除，clear all
- Fetch Response body 只读取一次（text -> JSON.parse）
- JSON structured error 使用 `code`/`maxFiles`/`actualFiles`
- zh/en/ru 三语

## 12. 已知限制

- Custom auth scheme（非 Bearer/Basic/Digest）在 provider body 中不做特定脱敏——统一返回 `[PROVIDER_BODY_REDACTED]`
- Player path 暂无 prompt omission（`omittedAnalysisUnitCount = 0`）
- Multi-team 不再有固定 `MAX_PERSPECTIVES` 数量上限；perspective 是否省略由 token 预算（mandatory/high-priority 原子写入）与编排决定，省略单位进入 `truncatedUnitIds`/`omittedAnalysisUnitCount`
- 不支持 drag-and-drop 文件上传
- 不要求真实 `.wotbreplay` E2E fixture
