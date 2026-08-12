# AI Lesson：cw-partial-observation-01 — 观测子集不得当全局主力

- **案例 id**：`cw-partial-observation-01`
- **场景**：7 名成员存活，但每个 15s formation window 只观测到 4 人（3+1 子集）。
- **AI/后端常见误判**：把子集中人数最多的簇当全局主力，把 1 人簇成员判成单走。
- **正确判定**：无候选（`observedMemberCount < 该时刻应存活成员数` → 主力不确定，窗口跳过）。
- **判定依据**：`TeamSoloIntentSkill.mainClusterOf(phase, expectedAliveMembers)` 观测门控。
- **对应 golden case**：`ai-eval/cases/cw-partial-observation-01.json`
- **规则引用**：`SOLO_INTENT_RULE`（无法确定时写明无法确定，禁止硬判）。
