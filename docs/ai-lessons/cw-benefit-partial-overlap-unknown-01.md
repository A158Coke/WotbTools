# AI Lesson：cw-benefit-partial-overlap-unknown-01 — 队友部分重叠交火 → 获利 UNKNOWN

- **案例 id**：`cw-benefit-partial-overlap-unknown-01`
- **场景**：单走 span 60-90s；队友 FAVORABLE 交火 40-65s（部分重叠）；单走成员窗口内承伤 1000 且持续拉大距离。
- **AI/后端常见误判**：把「部分重叠的队友有利交火」直接跳过并等价为 teammateBenefit=false，从而误判脱节。
- **正确判定**：无候选（部分重叠无法可靠归属 → `teammateBenefit=UNKNOWN`；SOLO_DELAY 必须 TRUE、SOLO_DETACHED 必须 FALSE，UNKNOWN 均不生成）。
- **判定依据**：`TeamSoloIntentSkill.teammateBenefit` 三态（TRUE/FALSE/UNKNOWN），部分重叠队友交火 → UNKNOWN；不得把 UNKNOWN 渲染为 0。
- **对应 golden case**：`ai-eval/cases/cw-benefit-partial-overlap-unknown-01.json`
- **规则引用**：`SOLO_INTENT_RULE`（证据不足/矛盾 → 无法确定，禁止硬判）。
