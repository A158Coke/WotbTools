# AI Lesson：player-opening-mapcontrol-01 — 随机战开局图控

- **案例 id**：`player-opening-mapcontrol-01`
- **场景**：随机战开局（0–45s），录像者散开拿视野，未接火未承伤未阵亡。
- **AI 常见误判**：把开局散开判成「脱节/走位失误」（RouteSkill 脱节窗口不过滤开局）。
- **正确判定**：**开局图控**，不是脱节。
- **判定依据**：`SoloPlayIntentSkill` 开局窗口抑制脱节候选（OPENING_MAP_CONTROL）。
- **对应 golden case**：`ai-eval/cases/player-opening-mapcontrol-01.json`
- **规则引用**：player `SOLO_INTENT_RULE`（开局散开是图控/拿视野）。
