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

- 约 `1分52秒–2分12秒` 的连续减员窗口必须被 `TimelineFocusWindowSelector` 选中为 Top Focus Window：
  本方 3 死、对方 1 死；BEFORE 7v7 → AFTER 4v6；精确秒数以 backend 最终事实为准（禁止硬编码）。
- 输出只描述 canonical facts + evidence limitation（原因 UNKNOWN：掩体/射界/指挥沟通/个人操作无法区分）。

## Expected evidence boundaries

- FACT：只能来自权威结算/权威阵容/已验证 canonical timeline/后端确定性证据
- SUPPORTED INFERENCE：有 FACT 支撑、措辞保守（更符合…/从当前证据看…/较可能意味着…）
- UNKNOWN：正常答案，质量高于编造原因
- RECOMMENDATION：从可确认问题反推、不创造数字、不形成通用规则

## 回归

- 单元：`TimelineFocusWindowSelectorTest`（连续减员窗口）、`TeamReviewQualityGateContractTest`（prompt contract）、
  `TeamAutopsyPromptBuilderTest`（重点复查对象/归因降级）
- 真实回放：`TeamReviewRealReplayProbeTest`（common/data 样本，可重复运行、无样本自动跳过）
- eval：`ai-eval/cases/team-review-causal-overreach-01.json`
