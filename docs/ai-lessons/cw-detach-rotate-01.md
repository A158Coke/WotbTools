# AI Lesson：cw-detach-rotate-01 — 脱节被接应 ≠ 失误

- **案例 id**：`cw-detach-rotate-01`
- **场景**：M2 单走推进拉大距离（60–150s），随后队友转场接应（主力质心向 M2 位移），无人阵亡。
- **AI 常见误判**：看到距离拉大就判「单走失误」，忽略队友接应。
- **正确判定（LLM 解释）**：可判**脱节但被接应**——不把转场接应误判为失误（预期 vs 实际对照；基于 Backend 中性测量）。
- **判定依据**：
  - 单走时段移动推进（`type=移动`）；
  - 队友时序关联：主力质心向单走成员位移（接应）；
  - 结果：无白吃、无人阵亡。
- **对应 golden case**：`ai-eval/cases/cw-detach-rotate-01.json`
- **规则引用**：`SEPARATION_EVIDENCE_RULE`（结合 prior 战局类型，避免单因素定罪）。
