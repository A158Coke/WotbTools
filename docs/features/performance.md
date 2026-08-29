# 战斗表现（Performance Metrics）

WotBTools 的 replay-derived battle facts 只有一个 authoritative source：回放解析与重建管线
（`ReplayParser` → `DefaultReplayProcessingFacade` → `ObservedMaxHp` / `DeathTimeReconciler`
等 evidence 层）。Contribution / KAST / Impact 等指标是**基于统一 battle facts 计算的
derived performance metrics**，不再属于任何 Rating 综合评分体系。

> 本文件取代原「评分系统 (Rating)」文档。Rating V2 综合评分与旧 `Rating.compute`（WN8 式）
> 均已移除；`common/rating.json`、`GET /api/rating`、前端「评分规则」弹窗与评分列一并删除。

## 单一事实源

```text
.wotbreplay
    ↓
ReplayParser（结算战绩）
    ↓
DefaultReplayProcessingFacade（完整重建 + ObservedMaxHp.populate + DeathTimeReconciler）
    ↓
Battle / PlayerResult（唯一 authoritative facts 载体）
    ↓
PerformanceMetricsCalculator（纯派生计算，只读）
```

> `PlayerResult.killVictims`（damage-threshold 击杀前伤害明细）与 `DeathTimeEstimator` 已在 PR147/PR162 从生产
> 移除（damageReceived 不是本局最大 HP，无法证明 lethal boundary / killer identity）；killer authority 为
> settlement `field25`/result-id 映射。

Battle Playback / AI Review / Performance Metrics 全部消费同一 `Battle` / `PlayerResult`
事实；`ReplayProcessingJobService` 在 worker 中完成 full processing，并在 READY 前只调用一次
`PerformanceMetricsCalculator.populateBattle`。之后 Preview、Export、AI Review 与 Playback 都只读消费
同一 `ProcessedDataset`，不会为任一消费者再次 full process 或重算事实。

## 集成方式

战斗表现不再有独立页面/独立端点，也没有独立 tab：**指标直接成为回放解析结果的一部分**。
用户创建一个 Processing Job 后，每个 replay 只在 worker 中做一次完整处理
（`DefaultReplayProcessingFacade` full：parse + reconstruction + `ObservedMaxHp` +
`DeathTimeReconciler`）；finalize 阶段统一回填表现指标并保存 READY `ProcessedDataset`，随后映射到：

- `battles[].players[].cells`：单场玩家表直接包含 `contribution` / `kast` / `impact`
  （`PerformanceMetricsCalculator.battleMetrics` → `populateBattle` 写入 PlayerResult，
  `Columns.PLAYER` 直接消费；与跨场聚合共用同一公式，绝不二次解析/二次计算）
- `aggregate[].cells`：跨场汇总包含 `contribution` / `kast` / `impact` /
  `multi_damage_rate` / `traded_deaths`（`Mapper.toAggregate` 按 accountId 合并
  `PerformanceMetricsCalculator.compute` 结果）

**不再存在** `performance` 数组 / `performanceColumns` / `PerformanceRow` /
`PerformanceTable` 组件——用户上传一次即可在单场表与汇总表直接看到这些指标。

**Preview / Excel export / mode=each 三条输出链使用同一 READY dataset**：浏览器先
`POST /api/replay/processing-jobs`，再在 READY 后读取 result 或创建 Export Job；三者都只读
`ReplayProcessingJobService` 已生成的 `ProcessedDataset`。因此网页与 Excel 同源，且每份 replay
只 full process 一次（不允许 export 走 raw parse 造成 Preview/Excel 差异）。

## 输出列

单场玩家表（`Columns.PLAYER`，Excel 玩家数据表同步）新增：

| key | 含义 |
| --- | --- |
| `contribution` | 贡献率（数值，前端格式化为 `%`） |
| `kast` | 不白给率（数值，前端格式化为 `%`） |
| `impact` | 全场 Impact（数值，前端格式化为 `%`） |

跨场汇总表（`Mapper.aggregateColumns`，Excel 汇总表同步）新增：

| key | 含义 |
| --- | --- |
| `contribution` | 跨场贡献率 |
| `kast` | 跨场 KAST |
| `impact` | 跨场 Impact |
| `multi_damage_rate` | 多伤率 |
| `traded_deaths` | 互换击杀场次数 |

**HP unavailable 语义**：依赖 HP 的指标（contribution / kast / 多伤率）在 HP 全部 UNKNOWN
时输出 `null`（单场 `battleMetrics` 直接 null；跨场 `Row.hpEligible=false` 时 null），
前端统一显示 `--`，绝不冒充真实的 `0`；`impact` 与 `traded_deaths` 不依赖 HP
（Impact 公式不使用平均 HP；互换击杀在 `applyPlayer` 的 HP fail-closed early return 之前
累计），HP UNKNOWN 时仍为数值——API 与 Excel 汇总契约一致。

不再输出任何综合评分（`rating` / `finalRating` / 权重均删除），也不再有独立
「战斗表现」输出块。

## 场均 HP（BattleHpFacts）

`com.wotb.core.replay.facts.BattleHpFacts.averageHp(battle)` 是唯一权威口径：

```text
average_hp = 参战玩家（provenance-aware 满血）之和 ÷ 14
```

逐车满血取 `ObservedMaxHp.fullMaxHp(player)`：`entryHpSource == OBSERVED_EXACT` 用回放
已证明的进场满血（含装备/物资加成）；否则用 Tankopedia 基础 HP（BASE_FALLBACK baseline）。
**禁止硬编码 2400 兜底冒充权威**（历史 Rating V2 曾固定 2400，已移除）。

**Provenance 语义（fail-closed）**：`BattleHpFacts.averageHp(battle)` 返回
`BattleAverageHp(value, complete)`。`complete=true` 仅当：**标准 14 名有效参战玩家（team 1/2）
全部存在、且 HP fact 全部 known**——此时 value 才是权威均值 `total / 14`。以下任一情况均为
**unavailable（complete=false）**：参战玩家数 != 14（不足 14 人不得用部分玩家 total/14 冒充）、
或 14 人中存在 HP UNKNOWN（无 OBSERVED_EXACT 且无 tankopedia base，**禁止按 0 参与**）、
或 battle/players 为 null。依赖 averageHp 的衍生指标（贡献度击杀项 / KAST / 多伤率 /
场均 HP）在 unavailable 场次 fail-closed（按「HP 已知场次」做分母，不产生伪精确结果）；
不依赖 HP 的原始权威数据（damage / assist / kills / survival / traded / impact）仍正常显示。

## KAST

沿用原业务公式（单场贡献最大项，KAST 暂不大改）：

```text
KAST_battle = 100 * max(
  damage / (average_hp * 1.15),
  assist / (average_hp * 1.25),
  win && survived ? 1 : 0,
  traded_death ? 1 : 0,
  (damage + assist) / (average_hp * 1.20)
)
KAST = min(100, avg(KAST_battle))
```

`traded_death` 由 `com.wotb.core.replay.facts.TradeFacts.tradedDeaths` 提供（见下）。

## Impact

```text
damageAssistShare = (damage + assist) / battle(damage + assist)
damageAssistIndex = damageAssistShare / (1 / 14)
impact_battle = 100 * (0.75 * damageAssistIndex + 0.25 * kills)
impact = avg(impact_battle)，百分比字符串展示
```

## 贡献率

```text
roundContribution = damage + assist + kills * average_hp / 7
contribution = player(roundContribution) / team(roundContribution) * 100
```

## 多伤率 / 存活率 / 互换击杀

- 多伤：单场 `damage >= average_hp * 1.5`，或 `>= 1.2 * average_hp && kills >= 1`，
  或 `>= average_hp && kills >= 2`，或 `kills >= 3` 任一成立；`average_hp <= 0`（HP 未知）
  时不判定（fail-closed）。
- 存活率：`survived 场次 / 总场次 * 100`。
- 互换击杀：`TradeFacts` V4.1 directional 死亡时刻窗口启发式——玩家阵亡且其死亡后
  `[0, +5]` 秒内（边界包含）存在敌方阵亡；敌方早于玩家死亡不计。

## Trade 事实（TradeFacts）

`com.wotb.core.replay.facts.TradeFacts.tradedDeaths(player, players)`：死亡时刻
`[0, +5s]` directional 窗口（玩家死亡 ≤ 敌方死亡 ≤ 玩家死亡+5s）内的敌方死亡数；
存活或死亡时刻未知 → 0（fail-closed，不猜测）。消费
`DeathTimeReconciler` 校准后的权威 `survivalTimeSec`。注意这是**死亡时刻窗口启发式**，
不是 killer attribution；回放 reconstruction 的 killer 证据并非所有对局可靠，后续如需
killer 级 trade 语义应在事实层扩展，不在 metrics 层重推。

## API

- `POST /api/replay/processing-jobs` 创建异步处理；`GET /api/replay/processing-jobs/{jobId}/result`
  在 READY 后返回 `battles`（单场 players cells 含 contribution/kast/impact）+
  `aggregate`（含跨场 contribution/kast/impact/multi_damage_rate/traded_deaths）+
  `playerColumns` / `aggregateColumns` + `duplicates` / `failures`。
- `POST /api/preview`、`POST /api/export` 和已删除的 `POST /api/performance` 都不是当前处理入口；
  前两者为稳定的 legacy 410，`/extended` 页面也不再存在。
- 列 key 纯英文 + 是否数值，显示名由前端三语 `player_labels` / `agg_labels` 映射。

## 管理员灰度：历史 Rating V2

历史 Rating V2 不是当前产品评分体系。它只以隐藏深链 `?view=rating-v2` 提供给
`wotbtools-admin`，只读 READY `ProcessedDataset`，不恢复公开 `/api/rating`、`/extended`、Excel 列或
`/api/columns` 变更。

完整的算法、输入口径、输出契约、历史兼容边界和后续迭代规则以
[Rating V2 算法规范](rating-v2.md) 为准；不要在本战斗表现文档复制或演化 V2 公式。

## 测试

- `PerformanceMetricsCalculatorTest` 覆盖 Trade death KAST、多伤率、协助、Impact、
  OBSERVED_EXACT 进场满血 ÷ 14、HP 未知 fail-closed（多伤率不猜测），以及 `battleMetrics`
  单场值 == `compute(List.of(battle))` 聚合值（单一事实源回归）、HP UNKNOWN → contribution/kast null、
  accountId 映射不受排序影响。
- `ReplayMapperTest` 覆盖 cells 含 contribution/kast/impact 与汇总合并、HP unknown → null；
  `WebApiTest` 覆盖同步 `POST /api/preview` 一律 410 `REPLAY_LEGACY_DEPRECATED`（metrics
  契约已随 `GET /api/replay/processing-jobs/{jobId}/result` 迁移，见 Processing Job result）。
- 单一事实源回归必须保证：Playback 伤害 == Performance Metrics 输入伤害
  （同一 `PlayerResult.damageDealt`）。
- 历史 V2 的算法和回归维护基线见 [Rating V2 算法规范](rating-v2.md)；不要把其
  公式或测试规则回写进本战斗表现文档。
