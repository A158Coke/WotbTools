# 评分系统 (Rating)

本项目现在有两套评分链路：

- 原解析页 / 导出评分：`Rating.compute(...)`，类 WN8，相对当前上传批次按车型 EC 基准归一化；不改现有 index 页面和字段。
- 扩展页实时 rating：`POST /api/rating` + `/extended`，只基于本次上传回放实时计算，不落库、不读取历史，用目标因子综合评分。

## 扩展页实时 rating

实现位置：`java/wotb-core/.../stats/RatingAnalyzer.java`。

输出列：

| key | 含义 |
| --- | --- |
| `rating` | 综合评分 |
| `kast` | 不白给率百分比 |
| `contribution` | 贡献率百分比 |
| `impact` | 全场 Impact 百分比 |
| `damage_avg` | 均伤 |
| `potential_damage_avg` | 潜在均伤 |
| `potential_damage_supplement_avg` | 场均补增伤害 |
| `assist_avg` | AST，场均协助伤害 |
| `multi_damage_rate` | 多伤率百分比 |
| `kills` | 总人头 |
| `kills_avg` | 场均人头 |

`average_hp` 和 `account_id` 当前只作为内部计算 / 标识字段，不在扩展页 rating 表展示。

### average-HP

每场所有玩家使用同一个本局平均 HP。

```text
average_hp = 本局 14 台参战车辆的总血量 / 14
```

总血量逐车取值：`entryHpSource == OBSERVED_EXACT` 时使用回放已证明的进场满血（含装备/物资加成）；其他车辆使用 Tankopedia 基础 HP。双方所有玩家使用该均值，不再把 2400 作为整场平均血量。

注意：`OBSERVED_EXACT` 有严格受击覆盖与受击前样本证明；无法证明的进场满血不会猜测，仍使用车辆库基础 HP。车辆库也没有该车 HP 时，单车才暂定 2400。

### KAST

CS2 / CS:GO 的 KAST 是回合级统计：玩家在该回合有 Kill、Assist、Survive 或 Traded 任一贡献，就记为该回合 KAST 成立。扩展页现在按“单场贡献最大项”计算：

```text
KAST_battle = 100 * max(
  damage / (average_hp * 1.15),
  assist / (average_hp * 1.25),
  win && survived ? 1 : 0,
  traded_death ? 1 : 0,
  (damage + assist) / (average_hp * 1.20)
)
```

最终：

```text
KAST = min(100, avg(KAST_battle))
```

`traded_death`：玩家阵亡且死亡时间前后 5 秒窗口内至少有 1 名敌方阵亡。当前 KAST 的 trade 项按成立 / 不成立处理，不再按一换多叠加。

### Impact

统计全部场次，不再只统计赢局。单局按 `damage + assist` 在双方总池中的占比和人头折算：

```text
damageAssistShare = (damage + assist) / battle(damage + assist)
damageAssistIndex = damageAssistShare / (1 / 14)
impact_battle = 100 * (0.75 * damageAssistIndex + 0.25 * kills)
```

最终 `impact` 为所有场次 `impact_battle` 平均值，并以百分比字符串展示。这样输局玩家也会有 impact，不会因为无胜局直接为 0。

### 贡献率

贡献率覆盖全部场次，仍按本方队伍内占比计算。当前只作为展示字段，不参与最终 rating 权重：

```text
roundContribution = damage + assist + kills * average_hp / 7
contribution = player(roundContribution) / team(roundContribution) * 100
```

### 多伤率

单场满足任一条件记为一次多伤：

```text
damage >= average_hp * 1.5
damage >= average_hp * 1.2 && kills >= 1
damage >= average_hp && kills >= 2
kills >= 3
```

最终 `multi_damage_rate = 多伤场次 / 总场次 * 100`。

### 综合 rating

先把各因子转为 100 左右的指数，再加权：

| 因子 | 系数 |
| --- | --- |
| `potential-DPB / average_hp` | 0.70 |
| `KAST` | 0.15 |
| `impact` | 0.25 |
| `AST / average_hp` | 0.30 |
| `multi_damage_rate` | 0.10 |
| `kills_avg` | 0.10 |

```text
rating = round(10 * weightedIndex)
```

分数大致保持 1000 量级。极端值会封顶，避免单项异常把总分拉爆。

## 原解析页 / 导出评分

自包含的表现评分（类 WN8 机制，但**期望值来自当前处理的这批战斗，不依赖外部表**）。实现：`wotb-core/Rating.java`。

> **可调项集中在 `common/rating.json`**（权重/阈值/scale/车型系数）——Java 经 classpath 读取，**改它即生效，不必改代码**；文件缺失/损坏则用内置默认。配置键：`assist`、`block`、`killValue`、`winBonus`、`minSamples`、`scale`、`classFactor`。

- **有效贡献 EC** = `伤害 + 0.6*协助 + 0.35*格挡 + 200*击杀`（权重见 `rating.json`）。
- **按车型基准**：从这批数据按车型(轻/中/重/TD)求 EC 均值；某车型样本 `< 5`(含"没有同类车")时 `基准 = 全体均值 × 车型难度系数`(可调常量 `CLASS_FACTOR`，默认 轻坦0.7/中坦0.9/重坦1.0/TD1.0)，避免独苗轻坦被高 EC 的重坦拉低。
- **评分** = `round(1000 * EC/基准 * (1 + 0.05*胜))`；`1000` = 同车型平均。
- **基准范围 = 一起处理的这批战斗**：单场导出即相对该场；多场/预览相对整批。所以 rating 是"相对该批"的，不是绝对天梯分。
- **列**：单场「评分」`key=rating`(在 `Columns.STAT`)、汇总「场均评分」`key=rating_avg`(Mapper/AggregateSheets)。计算时机：`ExcelExporter.writeSingle/writeAggregate`(门面) 与 `ReplayService.preview` 在用之前先 `Rating.compute(...)`。

该链路继续服务原解析页和 Excel 导出，避免扩展算法影响现有字段。

## API

- `GET /api/rating`：返回原评分参数快照，供旧评分说明弹窗使用。
- `POST /api/rating`：上传本次回放，完整处理回放以回填 `OBSERVED_EXACT` 进场满血，返回实时 rating 表、重复文件、解析失败文件和 `ratingColumns`；重建不可用时保留结算战绩并回退车辆库基础 HP。
- `/api/columns.rating`：只返回英文 key + 是否数值，显示名由前端三语 `rating_labels` 映射。

## 已知限制与后续

- **进场满血覆盖并非全量**：只有 `OBSERVED_EXACT` 的车辆使用回放实测进场满血；其余车辆仍使用 `common/tankopedia-tier{7,8,9,10}.json` 基础 HP，车辆库也缺失时才暂定单车 HP 为 2400。后续方向见 `docs/ROADMAP.md`（Research）。
- **特殊伤害未校验**：殉爆 / 火烧等非 direct HP damage 场景尚未用真实样本校验，可能误补/漏补潜在伤害。
- **rating 参数未经大批量回归**：权重与封顶值基于当前样本，后续用真实比赛批量样本微调（见 `docs/ROADMAP.md`）。

## 测试

- `RatingAnalyzerTest` 覆盖 Trade death KAST、多伤率、协助、Impact、综合 rating 排序，以及总血量 ÷ 14 时的 `OBSERVED_EXACT` 进场满血。
- `ReplayServiceTest` 覆盖 `/api/rating` 走完整回放处理；`WebApiTest` 覆盖 `/api/columns.rating` 和 `POST /api/rating` 返回字段。

## 潜在伤害（Potential Damage）链路

扩展分析页同时支持主 SPA 路由 `?view=extended` 和独立 `/extended` 多页构建入口；生产 nginx 对 `/extended` 映射到 `extended.html`，Spring 静态资源由 `StaticForwardController` 转发。

新增字段：
- 单场玩家列：`alpha_damage`、`rank`、`potential_damage`、`potential_damage_supplement`、`potential_damage_detail`。
- 汇总列：`potential_damage`、`potential_damage_avg`、`potential_damage_supplement_avg`。
- 实时 rating 展示列：`rating`、`kast`、`contribution`、`impact`、`damage_avg`、`potential_damage_avg`、`potential_damage_supplement_avg`、`assist_avg`、`multi_damage_rate`、`kills`、`kills_avg`；`contribution` 仅展示，不参与最终权重；`average_hp` 和 `account_id` 不再展示。

`frontend/src/composables/useColumns.js` 会过滤 `EXTENDED_ONLY_PLAYER_KEYS`，所以原回放解析页面不展示扩展专用列；扩展页 `/extended` 直接读取 `playerColumns`，可展示完整字段。列选择器缓存只作用于原回放解析页，不影响扩展页完整字段展示。

`ReplayParser` 仍解析 `xp`、`credits` 到 `PlayerResult`，但这两个值受经济/加成/首胜等因素影响，不作为玩家战绩展示字段、导出列或 rating 输入。

`Tankopedia` 读取车辆库（`common/tankopedia-tier{7,8,9,10}.json`，blitzkit 生成，全部英文/数字）：`name` / `tier` / `class`（英文） / `nation`（英文） / `hp` / vehicle 级 `alphaDamage` / 手工 `extraInfo`。vehicle 级 `alphaDamage` 只在数据层有唯一权威依据时由生成器输出（单炮车 / 7–9 级顶配炮 = 最高 tier 同 tier 最高 alpha，如 T-34-2=400），**10 级多终局炮车不输出**——`Tankopedia.info(...).alphaDamage()` 返回 null，AI structured facts 省略炮伤，不会把数组第一把炮的伤害伪装成本场实际炮伤；`alphaDamage` 取标准弹（`shells[0]`，已用真实数据验证；HE 往往伤害更高故禁止 `max`）。`hp` = 车体 + 顶配炮塔；`forwardSpeed`/`reverseSpeed` 来自 `speed_forwards`/`speed_backwards`，`turretRotationSpeed` 取顶配炮塔 traverse，`hullRotationSpeed` 取顶配履带 traverse，`powerToWeightRatio` = 顶配引擎功率 / 车重。10 级多炮车（如 E 100 的 12,8cm/15cm、AC Atlas 的 V1/V2）在 `guns` 数组中保留全部炮（`isDefault` 均为 false）。刷新时旧数据只从 `--existing-dir` 读取、新数据只写 `--output-dir`（Workflow 两者路径分离），并按 tank_id 保留合并旧文件中的 `extraInfo`（兼容旧 `extraKnowledge`），若仍存在的车辆知识点丢失会直接失败。`average_hp` 取本局双方 14 辆参战车辆的满血总和 ÷ 14：仅 `OBSERVED_EXACT` 使用回放已证明的进场满血，其余使用车辆库基础 HP；车辆库也缺失时，才按单车 2400 兜底。

`ReplayParser` 会从 `data.wotreplay` 的 Type 8 / subtype 8 / sub=3 direct HP damage 事件解析攻击者、受害者和伤害值；当阵亡玩家的累计 direct damage 达到 `damageReceived` 阈值时，当前攻击者被推断为击杀者，并把该击杀者对受害者的累计 direct damage / penetrations 写入 `PlayerResult.killVictims`。

`PotentialDamage.apply(...)` 会读取 `killVictims` 和 `Tankopedia.alphaDamage`，按 `0.9 * alphaDamage * penetrations` 补增潜在伤害。若回放事件缺失、entity_id 无法映射、特殊伤害未被 direct HP damage 覆盖，仍保守回退为 `potential_damage == damage_dealt`、`potential_damage_supplement == 0`、`potential_damage_detail == 未解析`。

`POST /api/rating` 只基于本次上传的 multipart 回放实时计算，不落库、不读取历史记录；`GET /api/rating` 仍保留为旧评分参数接口。扩展页的实时 rating 由 `RatingAnalyzer` 独立计算，不替换原解析页/导出的旧 `Rating.compute(...)` 字段。
