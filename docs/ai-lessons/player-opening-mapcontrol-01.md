# AI Lesson：player-opening-mapcontrol-01 — 随机战开局分散

- **案例 id**：`player-opening-mapcontrol-01`
- **场景**：随机战开局（0–45s），录像者与队友拉开，未接火未承伤未阵亡。
- **AI 常见误判**：把开局散开判成「脱节/走位失误」（RouteSkill 脱节窗口不过滤开局）。
- **正确判定**：**开局分散（OPENING_SPREAD）**，不是脱节；可分析信息覆盖与局部兵力风险的 trade-off，不得声称已点亮/侦察。
- **判定依据**：`PlayerSeparationEvidenceSkill` 开局窗口抑制脱节候选（OPENING_SPREAD）。
- **对应 golden case**：`ai-eval/cases/player-opening-mapcontrol-01.json`
- **规则引用**：player `SEPARATION_EVIDENCE_RULE`（开局分散是中性 signal；视野类收益无专门 evidence 时 UNKNOWN）。
