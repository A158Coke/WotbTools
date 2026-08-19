# AI Lesson：cw-damage-partial-benefit-unknown-01 — 伤害覆盖不完整 → 队友活动 UNKNOWN

- **案例 id**：`cw-damage-partial-benefit-unknown-01`
- **场景**：单走 span 60-90s，单走成员窗口内承伤 1000 且持续拉大距离；没有任何队友 Engagement；`features.limitations` 含 `OBSERVED_DAMAGE_IS_PARTIAL`。
- **AI/后端常见误判**：把“没有观察到队友活动”直接当成“确定队友未参与”，从而误判脱节。
- **正确判定**：伤害事件覆盖不完整时否定判断不可靠 → 后端只输出确定性测量（distance/stationaryRatio/damageReceivedDuringSpan/otherFriendly 活动观测），缺失保持内部 UNKNOWN；是否脱节由 LLM 综合判断，不得把「未观察到队友活动」渲染为确定结论。
- **判定依据**：`TeamSeparationEvidenceSkill` 对 `OBSERVED_DAMAGE_IS_PARTIAL` 只输出已观测测量；正向观测到的交火/承伤仍可作为证据。
- **对应 golden case**：`ai-eval/cases/cw-damage-partial-benefit-unknown-01.json`
- **规则引用**：`SEPARATION_EVIDENCE_RULE`（证据不足/矛盾 → 无法确定）。
