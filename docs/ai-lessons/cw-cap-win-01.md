# AI Lesson：cw-cap-win-01 — 占点致胜（点数推断）

- **案例 id**：`cw-cap-win-01`
- **场景**：争霸赛双方未全灭，结算无 winnerTeam；我方占点分总和（140）高于敌方（40）。
- **AI 常见误判**：看到双方未全灭且本方占点分更高就写「获胜」或写出具体终局比分。
- **正确判定**：**点数判定、胜方未知（fail closed）**——结算无 winnerTeam，victoryPointsEarned 是否含被动增长与击杀夺分仍未证明，禁止比较推断胜方；`pointsDecided=true`、`winnerSource=UNKNOWN`，终局比分未知。
- **判定依据**：逐人 `victoryPointsEarned` 部分口径；`CAPTURE_AND_POINTS` 段提供双方部分分。
- **对应 golden case**：`ai-eval/cases/cw-cap-win-01.json`
- **规则引用**：`CAPTURE_RULE`（无权威胜方时 fail closed；残局守家 vs 占点影响点数判定）。
