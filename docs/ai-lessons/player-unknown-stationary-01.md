# AI Lesson：player-unknown-stationary-01 — 移动覆盖不足 ≠ MOVING

- **案例 id**：`player-unknown-stationary-01`
- **场景**：随机战，窗口内没有移动段覆盖（观测缺失），但有窗口内承伤。
- **AI/后端常见误判**：把「移动覆盖不足」当作正在移动，结合承伤判脱节。
- **正确判定**：无候选（未知 ≠ MOVING；缺失/矛盾信号必须返回空）。
- **判定依据**：`SoloPlayIntentSkill.stationaryRatio == null` → 不判静止也不判移动。
- **对应 golden case**：`ai-eval/cases/player-unknown-stationary-01.json`
- **规则引用**：player `SOLO_INTENT_RULE`（证据不足/矛盾 → 明说无法确定）。
