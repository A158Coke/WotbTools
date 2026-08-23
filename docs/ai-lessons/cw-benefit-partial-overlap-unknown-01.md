# AI Lesson：cw-benefit-partial-overlap-unknown-01 — 队友部分重叠交火 → 归属 UNKNOWN

- **案例 id**：`cw-benefit-partial-overlap-unknown-01`
- **场景**：单走 span 60-90s；队友交火 40-65s（部分重叠）；单走成员窗口内承伤 1000 且持续拉大距离。
- **AI/后端常见误判**：把「部分重叠的队友交火」直接跳过并等价为「队友未参与」，从而误判脱节。
- **正确判定**：部分重叠无法可靠归属 → 后端只输出该窗口的确定性测量（distance/distanceGrowth/stationaryRatio/damageReceivedDuringSpan/otherFriendly*），战术含义（是否脱节/拖延/合理分兵）由 LLM 综合判断；不得把「窗口内没有观察到队友参与」渲染为确定结论。
- **判定依据**：`TeamSeparationEvidenceSkill` 输出中性 `SPATIAL_SEPARATION` 测量；部分重叠交火不硬判，缺失保持内部 UNKNOWN——LLM 的 supported tactical inference 才允许给出脱节/拖延等标签（Backend expected evidence vs LLM interpretation expectation 分离）。
- **对应 golden case**：`ai-eval/cases/cw-benefit-partial-overlap-unknown-01.json`
- **规则引用**：`SEPARATION_EVIDENCE_RULE`（证据不足/矛盾 → 无法确定，禁止硬判）。
