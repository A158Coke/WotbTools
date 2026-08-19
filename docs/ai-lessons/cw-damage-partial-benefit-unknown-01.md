# AI Lesson：cw-damage-partial-benefit-unknown-01 — 伤害覆盖不完整 → 队友获利 UNKNOWN

- **案例 id**：`cw-damage-partial-benefit-unknown-01`
- **场景**：单走 span 60-90s，单走成员窗口内承伤 1000 且持续拉大距离；没有任何队友 Engagement；`features.limitations` 含 `OBSERVED_DAMAGE_IS_PARTIAL`。
- **AI/后端常见误判**：把“没有观察到队友获利”直接当成“确定没有获利”，teammateBenefit=false → 误判脱节。
- **正确判定**：无候选（伤害事件覆盖不完整时，否定判断不可靠 → `teammateBenefit=UNKNOWN`，SOLO_DELAY 必须 TRUE、SOLO_DETACHED 必须 FALSE，UNKNOWN 均不生成）。
- **判定依据**：`TeamSeparationEvidenceSkill.teammateBenefit` 对 `OBSERVED_DAMAGE_IS_PARTIAL` 返回 UNKNOWN；正向观测到的交火/承伤仍可作为证据。
- **对应 golden case**：`ai-eval/cases/cw-damage-partial-benefit-unknown-01.json`
- **规则引用**：`SEPARATION_EVIDENCE_RULE`（证据不足/矛盾 → 无法确定）。
