# AI Lesson：cw-cap-points-decided-01 — 点数胜负

- **案例 id**：`cw-cap-points-decided-01`
- **场景**：双方均未全灭、结算无 winnerTeam；我方占点分更高（170 vs 60）。
- **AI 常见误判**：按双方占点分总和直接推断胜方并写出具体比分。
- **正确判定**：**点数判定、胜方未知（fail closed）**——结算无 winnerTeam 时，victoryPointsEarned 是否含被动增长与击杀夺分仍未证明，禁止比较推断胜方；AI 必须按 `pointsDecided=true` 口径描述，禁止把占点分总量说成占领进度时间线或终局比分。
- **判定依据**：`CAPTURE_AND_POINTS.pointsDecided=true` + `winnerSource=UNKNOWN` + 双方占点分（部分口径）。
- **对应 golden case**：`ai-eval/cases/cw-cap-points-decided-01.json`
- **规则引用**：`CAPTURE_RULE`（占点分是逐人统计，不是终局比分；无权威胜方时禁止推断）。
