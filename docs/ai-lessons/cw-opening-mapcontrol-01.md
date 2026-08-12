# AI Lesson：cw-opening-mapcontrol-01 — 开局图控 ≠ 脱节

- **案例 id**：`cw-opening-mapcontrol-01`
- **场景**：7v7 训练房开局（0–45s），全队从出生点散开拿视野：阵型多簇、成员未接火、无人阵亡；约 60s 首次接敌。
- **AI 常见误判**：把开局散开判为「脱节/队形分散」（机械脱节窗口不过滤开局，`TEAM_FORMATION_SPLIT` 对散开也触发）。
- **正确判定**：**图控**（开局散开拿视野信息），不是脱节，更不是失误。
- **判定依据**：
  - 时间窗 = OPENING 阶段（`[0, min(首次接敌, 45s)]`）；
  - 该成员未接火/未承伤/未阵亡；
  - 队伍呈多簇/高离散阵型（散开拿视野）。
- **对应 golden case**：`ai-eval/cases/cw-opening-mapcontrol-01.json`
- **规则引用**：Step 2 `SOLO_INTENT_RULE`（图控窗口抑制脱节候选）。
