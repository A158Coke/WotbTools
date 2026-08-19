# AI Lesson：player-no-growth-01 — 无距离增长不判脱节

- **案例 id**：`player-no-growth-01`
- **场景**：随机战，录像者窗口内移动并有承伤，但与友军距离没有增长。
- **AI/后端常见误判**：仅凭「距离持续高于 150m + 承伤」判脱节。
- **正确判定**：后端只输出确定性测量（distance/distanceGrowth/stationaryRatio/承伤）；distanceGrowth 不足 20m 只是缺少「距离持续拉大」这个事实，脱节与否由 LLM 综合判断，不得仅凭距离+承伤硬判。
- **判定依据**：`PlayerSeparationEvidenceSkill` 从 checkpoints 计算窗口内距离增长；<2 个有效点或增长 <20m → distanceGrowth 缺省（中性），不产生任何脱节候选标签。
- **对应 golden case**：`ai-eval/cases/player-no-growth-01.json`
- **规则引用**：player `SEPARATION_EVIDENCE_RULE`（脱节需综合距离增长/局部人数/承伤/后续移动判断）。
