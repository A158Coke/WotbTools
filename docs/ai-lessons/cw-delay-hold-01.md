# AI Lesson：cw-delay-hold-01 — 空间分离（静止守点 + 敌情压力）：拖延与否由 LLM 判断

- **案例 id**：`cw-delay-hold-01`
- **场景**：联赛 7v7，HT（H1）脱离主力在守点附近静止卡点，有敌情压力但不撤退（60–240s）；队友借机推进/转场。
- **AI 常见误判**：仅凭「与主力距离大」就把空间分离直接判成「脱节」，或把「静止 + 敌情压力」直接判成「拖延」——两者都是 Backend 之外的战术结论。

## Backend expected evidence（只输出事实与确定性测量）

- 空间分离窗口：distance / distanceGrowth / stationaryRatio / movement coverage
- 局部观察敌我数量（observedEnemyNearby 等）
- 窗口内 damage dealt / received、death
- other-friendly 窗口内活动（主力质心位移/转场等时序关联，只描述先后关系）
- objective-region proximity（守点区域邻近）
- coverage / missingness（移动覆盖不足 → UNKNOWN，禁止硬判）

## LLM interpretation expectation（战术含义归 LLM）

- LLM 可以综合以上事实判断：是否形成<b>有效拖延</b>、是否只是<b>脱节</b>、是否属于<b>合理分兵</b>；
- 队友行动与该窗口是否存在 supported tactical relationship——只描述时序关联（「队友转场发生在该成员卡点期间」），
  不声称「A 的行为导致 B 获利」的因果（禁止「队友获利」作为 Backend 确定性字段）；
- 本案例的人类/LLM 最终判断可以倾向「有效拖延」，但必须明确：这是 LLM 基于 Backend 中性测量的
  supported tactical inference，不是 Backend classification。

- **对应 golden case**：`ai-eval/cases/cw-delay-hold-01.json`
- **规则引用**：`SEPARATION_EVIDENCE_RULE`（Backend 只输出中性空间分离测量；是否拖延/脱节由 LLM 综合判断）。
