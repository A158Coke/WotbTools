# 项目系统记忆

## 最近工作（PR #29 修复）

### P1 — aiAnalyzable 语义修正
- `aiAnalyzable` = `summaryAvailable && recorderResultAvailable`，不再要求 reconstruction
- 新增 `fullFeatureAnalysisAvailable` 区分完整特征分析能力
- `recorderResultAvailable` = `battle.recorderResult() != null`
- `recorderEntityMapped` 改由 `reconstruction.participants().anyMatch(BattleParticipant::recorder)` 判断

### P1 — DamageEvent 与权威结算对账
- `buildPlayerContextSummary` 输出事件流观测伤害子集与权威结算对比
- 交火段数值标记为"观测子集"，非权威总伤害
- 每个 engagement 输出置信度
- Prompt 末尾追加 limitations 章节
- `DefaultPlayerBattleFeatureExtractor.hasFeatures` 改为基于真实内容判断

### P2 — Duplicate 响应修复
- `BatchAnalyzer.ExactDuplicate` 记录 original+duplicate 关系
- `duplicateOf` 指向保留的原始文件（非自身）
- 重复文件保留原始 `SUCCESS` 状态，不再标记为 `FAILED`
- `perspectiveTeam` 使用 `gp.key().perspectiveTeam()` 而非硬编码 0
- `failedFileCount` 只统计 `INDEPENDENT_BATTLE + FAILED + error != null`

### P3 — 清理
- AiReplayAnalysisService 删除重复的 PlayerResult import

### 测试
- 后端 104 测试全部通过
- 前端 21 测试全部通过
- 构建通过

### 关键文件
- `ReplayProcessingCapabilities.java` — 能力模型（含 aiAnalyzable/fullFeatureAnalysisAvailable）
- `DefaultReplayProcessingFacade.java` — 门面：compute recorderResultAvailable, isRecorderEntityMapped
- `BatchAnalyzer.java` — 分析计划：ExactDuplicate 记录，analyzableUnitCount
- `ReconstructionController.java` — 控制器：callPlayerContext fallback 选择逻辑
- `AiReplayAnalysisService.java` — AI Prompt：权威 vs 观测伤害对账、limitations
- `DefaultPlayerBattleFeatureExtractor.java` — 特征提取：真实 hasFeatures、limitations
- `ReplayFileAnalysisStatus.java` — 文件状态：duplicate 保持原始状态
- `.agents/AGENTS.md` — AI 编码规则
