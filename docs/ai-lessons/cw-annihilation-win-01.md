# AI Lesson：cw-annihilation-win-01 — 全歼胜利（battle result 权威）

- **案例 id**：`cw-annihilation-win-01`
- **场景**：对方 7 台全部阵亡、结算 `winnerTeam` 给出我方获胜；双方 `victoryPointsEarned` 均 <1000（240 vs 0）。
- **AI 常见误判**：看到双方点数均 <1000 就写「时间耗尽后以点数优势获胜」，忽略对方已全歼。
- **正确判定**：**全歼敌方获胜**——胜利队伍以 battle result 权威结算为准；对方全部阵亡时，即使双方点数均 <1000 也是全歼获胜，禁止写成时间耗尽点数判定。
- **判定依据**：`CAPTURE_AND_POINTS.pointsDecided=false`（结束时刻存在全员阵亡方）+ `result=CHRD获胜`（无点数后缀）+ 对方逐车阵亡信息。
- **对应 golden case**：`ai-eval/cases/cw-annihilation-win-01.json`
- **规则引用**：`CAPTURE_RULE`（胜利方式判定顺序：全歼敌方 → 点数达到 1000 → 时间结束且双方均未全歼时比较点数）。
