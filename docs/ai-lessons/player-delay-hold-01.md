# AI Lesson：player-delay-hold-01 — 随机战卡点拖延

- **案例 id**：`player-delay-hold-01`
- **场景**：随机战，录像者脱离友军但静止卡点，有敌情压力不撤退。
- **AI 常见误判**：仅凭与友军距离大判「脱节」。
- **正确判定**：**拖延**（可观测行为：静止/卡点 + 敌情压力；个人复盘无队友获利维度）。
- **判定依据**：`PlayerSeparationEvidenceSkill` → `SEPARATION_WINDOW`（静止占比 + 敌情压力；是否拖延由 LLM 判断）。
- **对应 golden case**：`ai-eval/cases/player-delay-hold-01.json`
- **规则引用**：player `SEPARATION_EVIDENCE_RULE`（拖延需可观测行为，不得说成心理意图）。
