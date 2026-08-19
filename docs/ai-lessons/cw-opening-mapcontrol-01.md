# AI Lesson：cw-opening-mapcontrol-01 — 开局分散 ≠ 脱节

- **案例 id**：`cw-opening-mapcontrol-01`
- **场景**：7v7 训练房开局（0–45s），全队从出生点分散：阵型多簇、成员未接火、无人阵亡；约 60s 首次接敌。
- **AI 常见误判**：把开局散开判为「脱节/队形分散」（机械脱节窗口不过滤开局，`TEAM_FORMATION_SPLIT` 对散开也触发）。
- **正确判定**：**开局分散（OPENING_SPREAD）**——位置/队形分离事实；是「地图信息覆盖 ↔ 局部兵力集中度」的战术交换，不是脱节、不是失误，也**不能**说成已证明拿视野/点亮。
- **判定依据**：
  - 时间窗 = OPENING 阶段（`[0, min(首次接敌, 45s)]`）；
  - 该成员未接火/未承伤/未阵亡；
  - 队伍呈多簇/高离散阵型（分散，仅位置事实）。
- **对应 golden case**：`ai-eval/cases/cw-opening-mapcontrol-01.json`
- **规则引用**：Step 2 `SOLO_INTENT_RULE`（开局分散窗口抑制脱节候选；视野类收益无专门 evidence 时 UNKNOWN）。
