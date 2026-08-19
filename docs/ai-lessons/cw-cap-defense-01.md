# AI Lesson：cw-cap-defense-01 — 守家翻盘（防守拖延）

- **案例 id**：`cw-cap-defense-01`
- **场景**：残局一名成员在本方基地守点（静止 + 敌情压力），队友借机占点获胜。
- **AI 常见误判**：把守家人判成「脱节/白给」。
- **正确判定**：**守家拖延是否有价值由 LLM 综合判断**（Backend 只给中性 `SPATIAL_SEPARATION` 测量：静止守点 + 局部敌情 + 窗口内活动；队友占点分上涨是 `CAPTURE_AND_POINTS` 事实——两者都是 evidence，是否「有价值的防守拖延」是 LLM 的 supported tactical inference，不是 Backend label）。
- **判定依据**：`SPATIAL_SEPARATION_EVIDENCE`（距离/静止占比/局部敌情测量）+ `CAPTURE_AND_POINTS`（队友占点分上涨事实）。
- **对应 golden case**：`ai-eval/cases/cw-cap-defense-01.json`
- **规则引用**：`SEPARATION_EVIDENCE_RULE`（行为模式由 LLM 综合）+ `CAPTURE_RULE`（守家 vs 占点）。
