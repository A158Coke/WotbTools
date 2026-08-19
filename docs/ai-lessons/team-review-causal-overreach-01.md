# AI Lesson: team-review-causal-overreach-01

- **类型**：Team AI Review 因果过度断言（FACT → TACTICAL INFERENCE → RECOMMENDATION 质量不合格）
- **replay**：`20260817_2021____WildCat__A178_SPHT_1161423218062589123(2).wotbreplay`
  （本地样本，不入库；放置于 `common/data/` 后由 `TeamReviewRealReplayProbeTest` 自动回归）
- **对应计划**：docs/current-plan.md（AI Review V2.1 — Team Review Quality Gate）

## 失败类别

| 类别 | 出现过的错误表达 | 正确边界 |
|---|---|---|
| A 位置→视野/图控 | 「这种开局分兵本身可以理解为图控拿视野」「鼠式……前期起到了一定的视野作用」 | 位置/移动/last-known 不能推出视野/点亮/侦察；散开目的 UNKNOWN |
| B 位置/掉血→地形/掩体 | 「本队车辆没有掩体切割」 | 无 raycast/LOS/terrain 证据，禁止掩体/卖头/hull-down/射界断言 |
| C settlement→timeline 因果 | 「位置感很好」（依据仅 4765 输出/888 助攻/1200 格挡/存活）「几乎每一波伤害都有他」 | 聚合结算不能文学化成时间线因果 |
| D 无证据确定性因果 | 「必然被逐个收走」「本队没有形成有效反击」「对方主力早早就位」 | 区分 FACT / SUPPORTED INFERENCE / UNKNOWN |
| E 凭空创造战术数值 | 「FV215b 保持在重坦身后 15–25 米」「血量低于三分之一就退」「连续挨两炮就退」 | 无来源精确阈值一律禁止，用非伪精确表达 |
| F 残局万能规则 | 「一旦2v4或3v5，立刻离开当前掩体，朝地图另一端转移」 | 残局决策依赖地图/位置/车型/血量/点数/时间/敌方分布，证据不足只描述观察 |

## Allowed facts（本案例可用）

- canonical BattleTimeline 的阵亡时刻与双方存活变化（如 1分52秒–2分12秒 本方 3 死、对方 1 死）
- 权威结算（输出/损失血量/助攻/格挡/击杀/存活）
- 权威阵容（tankName / vehicleClass / tier）
- 确定性证据段（FORMATION_DEPTH / BEHIND_LINE / POINTS_SITUATION / SOLO_INTENT 候选等）

## Forbidden inference（无新增证据时）

- 掩体切割 / 无掩体 / 卡掩体 / 卖头 / hull-down / 无遮挡射界
- 提供视野 / 拿到视野 / 点亮 / 侦察 / 「开局散开就是图控/拿视野」
- 位置感好坏 / 「每一波伤害都有他」 / 「助攻高=制造输出窗口」 / 「队友没有保护他」
- 必然性因果（必然导致 / 必然被逐个收走）
- 自创精确阈值（15m / 25m / 1/3 血 / 两炮 / 5s）与残局万能指令（2v4/3v5 必须转场）
- 自创车辆角色（薄皮输出型 / 前排 / 肉盾 / 狙击车）

## Expected focus window

- `TimelineFocusWindowSelector` 用 bounded core window（≤20s 子区间）识别短时间连续减员，
  不被窗口末尾的对方后续阵亡污染（PR #103 B2）。
- 真实回放验证（20260817 WildCat SPHT）：Top collapse core = `[109s, 128s]`（约 1分49秒–2分08秒，
  与计划叙事 1分52秒–2分12秒在容差内），**本方 3 死、对方 1 死，BEFORE 7v7 → AFTER 4v6**；
  精确秒数来自 canonical facts，不硬编码。
- 输出只描述 canonical facts；原因 UNKNOWN 时按 selective 原则自然表达（只有不说明会误写成因果、或该未知影响核心结论/训练建议、或用户自然会关心时才说明；不逐条列 evidence limitation）。
- Golden probe（PR #103 review §7）：TeamReviewRealReplayProbeTest 样本存在时<b>硬断言</b> friendlyDeaths==3、enemyDeaths==1、BEFORE 7v7、AFTER 4v6、core 接近 109–128s（±8s）；不再接受 print-only matchesNarrative 通过。

## Expected evidence boundaries

- FACT：只能来自权威结算/权威阵容/已验证 canonical timeline/后端确定性证据
- SUPPORTED INFERENCE：有 FACT 支撑、措辞保守（更符合…/从当前证据看…/较可能意味着…）
- UNKNOWN：正常答案，质量高于编造原因；向用户披露是 <b>selective</b> 的（4 条件），不逐条列出
- RECOMMENDATION：从可确认问题反推、不创造数字、不形成通用规则
- internal vs user-facing（PR #103 review §3）：AUTHORITATIVE_*/OBSERVED_*/FACT/UNKNOWN/canonical 等是
  后台推理材料，正文不得复述标签或解释证据体系；像真人教练说结论
- battle-specific 合流推断（PR #103 review §6）：「敌方主力确认后本方没有及时合流」是本场具体结论，
  需 4 证据门（enemy-known 支持主力确认 + 本方多分离集群 + 后续未靠近 + 首次关键交火在一侧集群）；
  known=4/unknown=3 只能说「至少观察到 4 辆，其余 3 辆位置不明确」，禁止「7 辆主力已集中在这一侧」；
  后知信息不得回填（anti-future-leak）

## 回归

- 单元：`TimelineFocusWindowSelectorTest`（连续减员窗口）、`TeamReviewQualityGateContractTest`（prompt contract）、
  `TeamAutopsyPromptBuilderTest`（重点复查对象/归因降级）
- 真实回放：`TeamReviewRealReplayProbeTest`（common/data 样本，可重复运行、无样本自动跳过）
- eval：`ai-eval/cases/team-review-causal-overreach-01.json`