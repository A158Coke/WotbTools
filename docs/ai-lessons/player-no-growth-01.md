# AI Lesson：player-no-growth-01 — 无距离增长不判脱节

- **案例 id**：`player-no-growth-01`
- **场景**：随机战，录像者窗口内移动并有承伤，但与友军距离没有增长。
- **AI/后端常见误判**：仅凭「距离持续高于 150m + 承伤」判脱节。
- **正确判定**：无候选（脱节必须证明窗口内持续拉大距离）。
- **判定依据**：`PlayerSeparationEvidenceSkill` 从 checkpoints 计算窗口内距离增长；<2 个有效点或增长 <20m → 不输出 SOLO_DETACHED。
- **对应 golden case**：`ai-eval/cases/player-no-growth-01.json`
- **规则引用**：player `SEPARATION_EVIDENCE_RULE`（脱节需持续拉大距离 + 无掩护/无收益）。
