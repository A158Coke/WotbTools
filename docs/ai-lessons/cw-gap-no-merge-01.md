# AI Lesson：cw-gap-no-merge-01 — 缺窗口禁止跨缺口合并单走 span

- **案例 id**：`cw-gap-no-merge-01`
- **场景**：[60,75] 与 [90,105] 都是单走窗口，但中间缺失 75-90 的 formation phase；窗口内承伤 1800。
- **AI/后端常见误判**：把两个窗口合并成一个 45s span，用首尾距离差伪造「持续拉大距离」。
- **正确判定**：无候选（span 只能合并时间连续的 15s 窗口；拆分后各窗口无距离增长）。
- **判定依据**：`TeamSeparationEvidenceSkill.soloSpans` 连续性检查（`SPAN_CONTINUITY_EPSILON_SEC`）。
- **对应 golden case**：`ai-eval/cases/cw-gap-no-merge-01.json`
- **规则引用**：`SEPARATION_EVIDENCE_RULE`（脱节需要持续拉大距离）。
