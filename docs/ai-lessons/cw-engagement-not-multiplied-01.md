# AI Lesson：cw-engagement-not-multiplied-01 — 跨窗口交火只累计一次

- **案例 id**：`cw-engagement-not-multiplied-01`
- **场景**：同一交火段横跨 4 个 15s formation window，实际承伤 300、只有 1 名敌人。
- **AI/后端常见误判**：按窗口求和把承伤累计成 1200、敌情累计成 4，误判「被白吃」→ 脱节。
- **正确判定**：无候选（按最终 span 对 `member.engagements()` 去重聚合：承伤 300、敌人 1，不满足被白吃）。
- **判定依据**：`TeamSeparationEvidenceSkill.SoloSpan.enemyPressureCount/damageReceived` 的 span 级去重。
- **对应 golden case**：`ai-eval/cases/cw-engagement-not-multiplied-01.json`
- **规则引用**：`SEPARATION_EVIDENCE_RULE`（脱节需要被白吃/高承伤证据）。
