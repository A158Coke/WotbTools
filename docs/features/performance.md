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
ReplayParser（结算战绩 + killVictims）
    ↓
DefaultReplayProcessingFacade（完整重建 + ObservedMaxHp.populate + DeathTimeReconciler）
    ↓
Battle / PlayerResult（唯一 authoritative facts 载体）
    ↓
PerformanceMetricsCalculator（纯派生计算，只读）
```

Battle Playback / AI Review / Performance Metrics 全部消费同一 `Battle` / `PlayerResult`
事实；`PotentialDamage.apply` 由编排层（`ReplayService`）在 metrics 之前执行，metrics 不再
mutate 任何字段，也不再自行解析回放或查询 Tankopedia。

## 输出列（`POST /api/performance`）

| key | 含义 |
| --- | --- |
| `contribution` | 贡献率百分比 |
| `kast` | 不白给率百分比 |
| `impact` | 全场 Impact 百分比 |
| `damage_avg` | 均伤 |
| `potential_damage_avg` | 潜在均伤 |
| `potential_damage_supplement_avg` | 场均补增伤害 |
| `assist_avg` | AST，场均协助伤害 |
| `multi_damage_rate` | 多伤率百分比 |
| `survival_rate` | 存活率百分比 |
| `traded_deaths` | 互换击杀场次数 |
| `kills` / `kills_avg` | 总人头 / 场均人头 |

不再输出任何综合评分（`rating` / `finalRating` / 权重均删除）。

## 场均 HP（BattleHpFacts）

`com.wotb.core.replay.facts.BattleHpFacts.averageHp(battle)` 是唯一权威口径：

```text
average_hp = 参战玩家（provenance-aware 满血）之和 ÷ 14
```

逐车满血取 `ObservedMaxHp.fullMaxHp(player)`：`entryHpSource == OBSERVED_EXACT` 用回放
已证明的进场满血（含装备/物资加成）；否则用 Tankopedia 基础 HP（BASE_FALLBACK baseline）。
车辆库也没有时该车贡献 0——**禁止硬编码 2400 兜底冒充权威**（历史 Rating V2 曾固定 2400，
已移除）。HP 完全未知时 `average_hp = 0`，指标按 unknown fail-closed（如多伤率不再猜测）。

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
- 互换击杀：`TradeFacts` 死亡时刻窗口启发式——玩家阵亡且死亡时刻 ±5 秒内存在敌方阵亡。

## Trade 事实（TradeFacts）

`com.wotb.core.replay.facts.TradeFacts.tradedDeaths(player, players)`：死亡时刻 ±5s 窗口
内的敌方死亡数；存活或死亡时刻未知 → 0（fail-closed，不猜测）。消费
`DeathTimeReconciler` 校准后的权威 `survivalTimeSec`。注意这是**死亡时刻窗口启发式**，
不是 killer attribution；回放 reconstruction 的 killer 证据并非所有对局可靠，后续如需
killer 级 trade 语义应在事实层扩展，不在 metrics 层重推。

## API

- `POST /api/performance`：上传本次回放，完整处理以回填 `OBSERVED_EXACT` 进场满血，
  返回战斗表现表、重复文件、解析失败文件和 `performanceColumns`；重建不可用时保留结算
  战绩并回退车辆库基础 HP。
- `/api/columns.performance`：只返回英文 key + 是否数值，显示名由前端三语
  `performance_labels` 映射。

## 潜在伤害（Potential Damage）链路

- `ReplayParser` 从 `data.wotreplay` 的 Type 8 / subtype 8 / sub=3 direct HP damage 事件
  解析攻击者、受害者和伤害值；阵亡玩家累计 direct damage 达到 `damageReceived` 阈值时，
  推断当前攻击者为击杀者，并把累计 direct damage / penetrations 写入
  `PlayerResult.killVictims`。
- `PotentialDamage.apply(battles, tankopedia)` 在编排层（`ReplayService.preview` /
  `performanceLeaderboard`）执行：读 `killVictims` 与 `Tankopedia.alphaDamage`，按
  `0.9 * alphaDamage * penetrations` 补增潜在伤害；事件缺失 / entity 无法映射 / 特殊伤害
  未覆盖时保守回退 `potential_damage == damage_dealt`、`potential_damage_supplement == 0`、
  `potential_damage_detail == 未解析`。

## 测试

- `PerformanceMetricsCalculatorTest` 覆盖 Trade death KAST、多伤率、协助、Impact、
  OBSERVED_EXACT 进场满血 ÷ 14，以及 HP 未知 fail-closed（多伤率不猜测）。
- `ReplayServiceTest` 覆盖 `performanceLeaderboard` 走完整回放处理；`WebApiTest` 覆盖
  `POST /api/performance` 返回字段（不含 `rating`）。
- `docs/current-plan.md` 要求单一事实源回归：Playback 伤害 == Performance Metrics 输入
  伤害（同一 `PlayerResult.damageDealt`）。
