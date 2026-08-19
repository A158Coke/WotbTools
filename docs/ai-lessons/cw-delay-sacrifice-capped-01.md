# AI Lesson：cw-delay-sacrifice-capped-01 — 牺牲拖延有价值

- **案例 id**：`cw-delay-sacrifice-capped-01`
- **场景**：残局，H1 以 1vN 在守点静止拖延（180–238s），240s 被围后阵亡；队友借机占点并获胜。
- **AI 常见误判**：看到阵亡 + 距离主力远，直接判「脱节白死」。
- **正确判定（LLM 解释）**：可倾向**牺牲拖延（有价值）**——阵亡不等于失误；队友是否借机获利只能由 LLM 从 other-friendly 活动与占点事实推断，不是 Backend 字段。
- **判定依据**：
  - 阵亡前静止卡点、敌情压力（1vN）；
  - 阵亡时刻与主力质心距离大（`deathProximityMeters`）；
  - 队友时序关联：阵亡时段内队友向目标点位移/占点/获胜。
- **对应 golden case**：`ai-eval/cases/cw-delay-sacrifice-capped-01.json`
- **规则引用**：`SEPARATION_EVIDENCE_RULE`（Backend 只给测量；牺牲拖延是否成立由 LLM 综合判断）。
