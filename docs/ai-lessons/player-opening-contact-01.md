# AI Lesson：player-opening-contact-01 — 开局窗口内有交火 ≠ 开局分散

- **案例 id**：`player-opening-contact-01`
- **场景**：随机战，开局窗口（45s 内）内发生交火（窗口内承伤 > 0）。
- **AI/后端常见误判**：只看「开局 + 未阵亡」就标开局图控，忽略窗口内已接火。
- **正确判定**：无候选（开局分散必须满足窗口内未造成伤害、未承受伤害、未阵亡；信号矛盾不硬判）。
- **判定依据**：`SoloPlayIntentSkill.classify` 用窗口内重叠 engagement 的 `damageDealt/damageReceived` 计算 `contactObserved`，开局窗口内有接触 → 空候选。
- **对应 golden case**：`ai-eval/cases/player-opening-contact-01.json`
- **规则引用**：player `SOLO_INTENT_RULE`（开局分散 = 未接火未承伤未阵亡）。
