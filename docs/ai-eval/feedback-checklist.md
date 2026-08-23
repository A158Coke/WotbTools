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
- CW（训练房/联赛）恒为争霸赛：result 与 resultSource 三级证据（BATTLE_RESULTS 权威 / SURVIVOR_SETTLEMENT 结算存活推导 / UNKNOWN；POINTS_INFERENCE 已停用、不再产出）；全歼双向（全歼敌方获胜 / 被敌方全歼落败）与 SURVIVOR_SETTLEMENT 仅在结算阵容完整（名册 #201 与战绩 #301 一致）时生效，不写死每队 7 人；双方均有存活才按结束方式判定——标准规则 + 时长<420s → 某一方达到 1000 分上限导致提前结束（具体胜方由 winnerTeam 决定，缺失时未知），时长≥420s → 时间耗尽，不使用任何点数公式；集中一波的代价 = 丢视野 + 被偷家；残局守家 vs 占点影响点数判定；占点分（victoryPointsEarned）的精确定义及是否含被动增长/击杀夺分仍未证明，不是权威终局比分，也不是时间线。

## 已登记反馈

| 日期 | 模式 | 现象 | 期望判断 | 复现方式 | 关联 lesson |
|---|---|---|---|---|---|
| 2026-08-15 | TRAINING | 把 Kranvagn 写成「埃米尔1951（Awesomeman954）」且保持全文（基础满血 2400 数据正确，生成侧幻觉） | 玩家处坦克名必须等于 roster 权威名（Kranvagn） | 零容忍单测：TankNameCorrectorTest.productionCase_kranvagnWrittenAsEmil1951_isCorrected | docs/ai-lessons/tank-name-hallucination-01.md |
