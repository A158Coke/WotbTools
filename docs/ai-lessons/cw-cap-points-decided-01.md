# AI Lesson：cw-cap-points-decided-01 — 点数胜负

- **案例 id**：`cw-cap-points-decided-01`
- **场景**：双方均未全灭、结算无 winnerTeam；我方占点分更高（170 vs 60）。
- **AI 常见误判**：把点数胜负写错/写成平局。
- **正确判定**：**点数胜利（POINTS_INFERENCE，规则候选）**——AI 必须按 `pointsDecided=true` 口径描述，禁止把占点分总量说成占领进度时间线。
- **判定依据**：`CAPTURE_AND_POINTS.pointsDecided=true` + `winnerSource=POINTS_INFERENCE` + 双方占点分总和。
- **对应 golden case**：`ai-eval/cases/cw-cap-points-decided-01.json`
- **规则引用**：`CAPTURE_RULE`（占点分是权威总量，不代表时间线）。
