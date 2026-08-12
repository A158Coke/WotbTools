# AI Lesson：player-detach-push-01 — 随机战单走推进被集火

- **案例 id**：`player-detach-push-01`
- **场景**：随机战，录像者持续拉大与友军距离、无掩护、承伤高。
- **AI 常见误判**：把无收益推进说成「拖延/拉扯」。
- **正确判定**：**脱节**（持续拉大距离 + 无掩护 + 被白吃）。
- **判定依据**：`SoloPlayIntentSkill` → `SOLO_DETACHED`（移动 + 无目标点 + 承伤高）。
- **对应 golden case**：`ai-eval/cases/player-detach-push-01.json`
- **规则引用**：player `SOLO_INTENT_RULE`（脱节需持续拉大距离 + 无掩护/无收益）。
