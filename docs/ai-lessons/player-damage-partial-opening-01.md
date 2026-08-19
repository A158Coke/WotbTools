# AI Lesson：player-damage-partial-opening-01 — 伤害覆盖不完整不得判“未接火”

- **案例 id**：`player-damage-partial-opening-01`
- **场景**：开局窗口内未观察到任何交火；`features.limitations` 含 `OBSERVED_DAMAGE_IS_PARTIAL`。
- **AI/后端常见误判**：把“事件流没看到交火”当成“确实没接火”，判开局分散。
- **正确判定**：无候选（伤害观测覆盖不完整时，否定判断“窗口内未接火”不可靠 → 不生成 `OPENING_SPREAD`）。
- **判定依据**：`SoloPlayIntentSkill.classify` 对 `OBSERVED_DAMAGE_IS_PARTIAL` 抑制开局分散（与 Team 路径一致）。
- **对应 golden case**：`ai-eval/cases/player-damage-partial-opening-01.json`
- **规则引用**：player `SOLO_INTENT_RULE`（未接火未承伤未阵亡才可判开局分散，覆盖不完整时无法确定）。
