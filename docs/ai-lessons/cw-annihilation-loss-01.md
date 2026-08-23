# AI Lesson：cw-annihilation-loss-01 — 被敌方全歼落败（battle result 权威）

- **案例 id**：`cw-annihilation-loss-01`
- **场景**：本方 7 台全部阵亡、结算 `winnerTeam` 给出敌方获胜；双方 `victoryPointsEarned` 均 <1000（100 vs 0）。
- **AI 常见误判**：看到双方点数均 <1000 就写「时间耗尽后以点数优势落败」，或把本方被全歼误写成「全歼敌方获胜」。
- **正确判定**：**被敌方全歼落败**——胜负以 battle result 权威结算为准（`resultSource=BATTLE_RESULTS`）；本方 `survivors=0` 时即使双方点数均 <1000 也是被全歼落败，禁止写成时间耗尽点数判定，更不得把失败方被全歼写成「全歼敌方获胜」。
- **判定依据**：`result=CHRD落败（被敌方全歼）` + `resultSource=BATTLE_RESULTS` + `pointsDecided=false` + 本方 `survivors=0`。
- **对应 golden case**：`ai-eval/cases/cw-annihilation-loss-01.json`
- **规则引用**：`CAPTURE_RULE`（resultSource 三级证据 + 全歼双向语义：全歼敌方获胜 / 被敌方全歼落败）。
