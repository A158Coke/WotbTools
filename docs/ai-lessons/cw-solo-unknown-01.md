# AI Lesson：cw-solo-unknown-01 — 观测不足必须写无法确定

- **案例 id**：`cw-solo-unknown-01`
- **场景**：回放事件流缺观测（无 OBSERVED 位置/移动段/簇证据），`TEAM_MEMBER_MOVEMENT_UNAVAILABLE`。
- **AI 常见误判**：证据不足时仍硬判脱节/拖延。
- **正确判定**：**无法确定**（禁止臆断意图与行为标签）。
- **判定依据**：
  - 无移动段、无阵型簇证据；
  - 后端候选为空时，prompt 规则要求明确写「无法从当前回放数据确定」。
- **对应 golden case**：`ai-eval/cases/cw-solo-unknown-01.json`
- **规则引用**：Step 2 `SOLO_INTENT_RULE`（证据不足禁止硬下标签）。
