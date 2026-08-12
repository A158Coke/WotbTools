# AI Lesson：cw-cap-defense-01 — 守家翻盘（防守拖延）

- **案例 id**：`cw-cap-defense-01`
- **场景**：残局一名成员在本方基地守点（静止 + 敌情压力），队友借机占点获胜。
- **AI 常见误判**：把守家人判成「脱节/白给」。
- **正确判定**：**守家拖延有价值**（`SOLO_DELAY` 候选：静止守点 + 敌情压力 + 队友占点获利）。
- **判定依据**：`SOLO_INTENT_CANDIDATES`（SOLO_DELAY）+ `CAPTURE_AND_POINTS`（队友占点分上涨）。
- **对应 golden case**：`ai-eval/cases/cw-cap-defense-01.json`
- **规则引用**：`SOLO_INTENT_RULE`（拖延=行为 + 队友获利）+ `CAPTURE_RULE`（守家 vs 占点）。
