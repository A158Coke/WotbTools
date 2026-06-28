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

公式口径已确定：每场每名玩家取敌方队伍平均 HP。

```text
average_hp = 敌方 7 台车实际进场总血量 / 7
```

也就是 1 队玩家看 2 队总血量 / 7，2 队玩家看 1 队总血量 / 7。这样可以覆盖同车因配件、消耗品或模式导致的实际血量差异。

注意：当前本地 `common/tankopedia.json` 和更新脚本都没有 HP 字段，也还没从回放确认/解析出“每台车实际进场血量”或“双方总血量”字段。现有实现只是让算法能跑：车辆库有 HP 时用车辆库，否则暂定单车 HP 为 2400，因此敌方平均血量为 2400。后续需要补真实数据源。

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

贡献率覆盖全部场次，仍按本方队伍内占比计算：

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

实现位置：`java/wotb-core/.../stats/Rating.java`。

有效贡献：

```text
EC = damageDealt + 0.6 * damageAssisted + 0.35 * damageBlocked + 200 * kills
```

配置来自 `common/rating.json`：`assist`、`block`、`killValue`、`winBonus`、`minSamples`、`scale`、`classFactor`。

计算逻辑：

1. 按车辆类型统计当前批次 EC 均值作为基准。
2. 车型样本不足时，用全体 EC 均值 × 车型系数。
3. `rating = round(scale * EC / baseline * winBonusFactor)`。

该链路继续服务原解析页和 Excel 导出，避免扩展算法影响现有字段。

## API

- `GET /api/rating`：返回原评分参数快照，供旧评分说明弹窗使用。
- `POST /api/rating`：上传本次回放，返回实时 rating 表、重复文件、解析失败文件和 `ratingColumns`。
- `/api/columns.rating`：只返回英文 key + 是否数值，显示名由前端三语 `rating_labels` 映射。

## 测试

- `RatingAnalyzerTest` 覆盖 Trade death KAST、多伤率、协助、Impact 和综合 rating 排序。
- `WebApiTest` 覆盖 `/api/columns.rating` 和 `POST /api/rating` 返回字段。
