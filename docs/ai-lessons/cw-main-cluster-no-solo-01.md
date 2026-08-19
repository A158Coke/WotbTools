# AI Lesson：cw-main-cluster-no-solo-01 — 主力簇成员不得判单走

- **案例 id**：`cw-main-cluster-no-solo-01`
- **场景**：5+2 分簇，H1 在五人主力簇内（静止 + 接火 + 主力转场），T1/L1 独立成簇。
- **AI/后端常见误判**：把「排除自身所在簇后选最大簇」导致主力簇成员反向判成单走。
- **正确判定**：主力簇成员不产生单走候选；只有明显小于主力簇（人数差 ≥2）且距离 ≥150m 的独立簇成员才进入候选。
- **判定依据**：`TeamSeparationEvidenceSkill.mainClusterOf`（全局最大簇，平票不判）→ 成员在主力簇 → 无候选。
- **对应 golden case**：`ai-eval/cases/cw-main-cluster-no-solo-01.json`
- **规则引用**：`SEPARATION_EVIDENCE_RULE`（单走=脱离主力，主力内成员不是单走）。
