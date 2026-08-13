# AI 复盘生产反馈登记清单（人工评估）

> B2/B3 已确认：不提供真实回放、不做本地 live runner；评估在 wotbtools.com 生产环境人工测试 + 收集用户反馈。
> 每个可复现反馈：① 写一篇 `docs/ai-lessons/<case-id>.md` ② 转成 synthetic case 入 `ai-eval/cases/*.json`（真实回放不入库）③ CI harness 回归。

## 反馈登记模板

| 字段 | 说明 | 示例 |
|---|---|---|
| 日期 | 反馈发现日期 | 2026-08-12 |
| 回放名 | 生产回放文件名（仅本地记录，不入库） | chrd-vs-nova.wotbreplay |
| 模式 | RANDOM / TRAINING / TOURNAMENT | TOURNAMENT |
| 现象 | AI 输出哪里不对 | 把守点单走判成「脱节」 |
| 期望判断 | 你认为正确结论 | 拖延（队友借机占点） |
| 是否队友获利 | B1 口径必填 | 是（主力转场 + 占点分上涨） |
| 复现方式 | 能否 synthetic 复现 | 可：cw-cap-defense-01 |
| 关联 lesson | docs/ai-lessons/ | cw-cap-defense-01.md |

## 转 golden case 步骤

1. 判断可复现：现象能否用 `AiEvalFixtures` 的 synthetic 场景复现。
2. 写 lesson：`docs/ai-lessons/<case-id>.md`（场景 / AI 常见误判 / 正确判定 / 判定依据 / 对应 case / 规则引用）。
3. 写 case：`ai-eval/cases/<case-id>.json`，`fixtureKey` 指向新增/现有 fixture，`lessonRef` 回指 lesson，`checks` 用 `prompt_contains` / `prompt_omits`。
4. 跑回归：`cd java && JAVA_HOME=<jdk21> mvn -s settings.xml -pl wotb-web -am test -Dtest=AiEvalHarnessTest`。
5. 修复循环：CI 报告 MISS → 改证据/prompt → 重跑 harness → 生产验证。

## 判定口径速查（B1 + 图控 + 占点）

- 开局散开（≤45s / 首次接敌前、未接火未阵亡）＝图控，不是脱节。
- 单走「拖延 vs 脱节」取决于队友是否因他获利（转场/占点/另一侧推进/视野）；后端只给时序关联，禁止因果。
- 判「脱节」需无收益 + 被白吃/丢点；信号不足/矛盾 → 明说无法确定。
- CW（训练房/联赛）恒为争霸赛：胜利方式按 battle result 权威判定，顺序为全歼敌方 → 任一方达到 1000 分 → 时间结束且双方均未全歼时比点数；集中一波的代价 = 丢视野 + 被偷家；残局守家 vs 占点决定点数胜负；占点分是权威总量，不是时间线。
