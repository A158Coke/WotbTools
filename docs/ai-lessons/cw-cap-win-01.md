# AI Lesson：cw-cap-win-01 — 占点致胜（点数推断）

- **案例 id**：`cw-cap-win-01`
- **场景**：争霸赛双方未全灭，结算无 winnerTeam；我方占点分总和（140）高于敌方（40）。
- **AI 常见误判**：看到没有全灭就写「平局或未知」。
- **正确判定**：**点数胜利**（`pointsDecided=true`，`winnerSource=POINTS_INFERENCE`——规则候选，非权威结算）。
- **判定依据**：逐人 `victoryPointsEarned` 权威总量求和对比；`CAPTURE_AND_POINTS` 段提供双方总分。
- **对应 golden case**：`ai-eval/cases/cw-cap-win-01.json`
- **规则引用**：`CAPTURE_RULE`（残局守家 vs 占点决定点数胜负）。
