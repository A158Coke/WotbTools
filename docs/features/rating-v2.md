# Rating V2 算法规范（管理员灰度）

> **维护状态：** 历史算法的受控灰度实现。后续任何 Rating V2 公式、阈值、输出字段或比较口径的变更，先更新本文件和回归测试，再修改代码。
>
> **实现单一事实源：** `java/wotb-core/src/main/java/com/wotb/core/stats/RatingV2Calculator.java`。
> **历史基线：** Git commit `37a0c0ec`（删除前最后的 Rating V2 实现）；平均 HP 修正来自 `d4b0dd19`。

## 1. 定位与边界

Rating V2 是一套历史综合评分，用于管理员在 `?view=rating-v2` 灰度核验。它不是当前公开产品的
League Rating，也不是当前回放页的战斗表现指标。

| 项目 | Rating V2 规则 |
| --- | --- |
| 页面 | 隐藏深链 `?view=rating-v2`，没有首页、顶栏或用户菜单入口 |
| 权限 | 前端与后端均要求 `wotbtools-admin` |
| API | `POST /api/admin/rating-v2/processing-jobs/{jobId}` |
| 输入 | 当前 Processing Job 已 READY 的 `ProcessedDataset` |
| 生命周期 | 只读 job 的 TTL 内数据；未 READY 返回 `JOB_NOT_READY`，过期/不存在返回 `JOB_NOT_FOUND` |
| 非目标 | 不恢复公开 `/api/rating`、`/extended`、`common/rating.json`、评分列、Excel 或导出 |

**隔离不变式：** 计算过程不得新建 full processing，不得修改共享 `Battle` / `PlayerResult`，不得改变
`PerformanceMetricsCalculator`、League Rating、公开回放页面或 `GET /api/columns`。

## 2. 数据输入与输出

### 2.1 输入事实

V2 消费 Processing Job 已完成 full processing 的 `Battle` / `PlayerResult`。每名玩家使用：

- `damageDealt`、`damageAssisted`、`kills`、`survived`、`survivalTimeSec`；
- `team`、`winnerTeam`、`startTime`、昵称和战队；
- `entryHpSource` / `entryHp` 与 Tankopedia 的 `maxHp`；
- Tankopedia 的 `alphaDamage`（补增已随 `killVictims` 移除而停用，见下）。

> **`PlayerResult.killVictims` 与 potential_damage 补增已从生产移除（PR147/PR162）**：killVictims 是击杀前
> 直接伤害明细，由 damage-threshold 启发式产生且并非所有回放都完整，无法证明 lethal boundary / killer
> identity；该字段无 authoritative producer。**potential_damage 不再作为当前事实链字段**，V2 只消费
> settlement 权威 damage/kills。

### 2.2 管理员 API 输出

响应为 `rows`、`duplicates`、`failures`、`columns`。每行只含稳定英文 key：

```text
nickname, clan, battles, wins, win_rate, rating, kast, contribution, impact,
damage_avg, potential_damage_avg, potential_damage_supplement_avg, assist_avg,
multi_damage_rate, kills, kills_avg
```

`account_id` 与内部 `average_hp` 不对页面输出。前端仅在隐藏页面使用 `ratingV2.labels` 的三语文案。
输出默认按 `rating` 降序；同分保持首次进入聚合结果的顺序。

## 3. 基础约定

### 3.1 截断函数

```text
cap(x, max) = 0                         (x 非有限或 x <= 0)
              min(x, max)               (其它情况)
```

### 3.2 历史本局平均 HP

每场所有玩家共用同一个 `average_hp`：

```text
average_hp = sum(hp(player for team 1/2)) / 14
```

逐车 `hp(player)` 的优先级：

1. `entryHpSource == OBSERVED_EXACT` 且 `entryHp > 0`：使用已证明的进场满血；
2. 否则：使用 Tankopedia `maxHp`；
3. 单车 Tankopedia HP 缺失：仅该车回退 `2400`。

这是**历史兼容口径**：分母恒为 14，即使异常输入缺少参战玩家也不会改成按实际人数除。
若累计总 HP 不为正，内部平均 HP 回退 2400。

它与当前 `BattleHpFacts` 的 fail-closed 口径不同：当前战斗表现遇到 HP UNKNOWN 会产出 unavailable；
V2 为复现历史结果而使用上述回退，且结果只留在 V2 局部输出中。

## 4. 潜在伤害（Potential Damage）

对每个玩家、每个 `KillVictim`：

```text
minimum_damage = 0.9 * alpha_damage * penetrations
supplement(victim) = ceil(minimum_damage - victim.damage)    (victim.damage < minimum_damage)
                     0                                       (其它情况)

potential_damage = damage_dealt + sum(supplement)
```

只有 `alpha_damage > 0` 且存在 `killVictims` 时才计算补增；没有 alpha、没有明细或明细无效时：

```text
potential_damage = damage_dealt
potential_damage_supplement = 0
```

输入 `damage_dealt < 0` 是非法数据，算法稳定拒绝。补增值不会写回 `PlayerResult`。

## 5. 单场指标

### 5.1 贡献率（仅展示，不参与综合 Rating）

```text
round_contribution = damage + assist + kills * average_hp / 7
contribution = player(round_contribution) / team(round_contribution) * 100
```

跨场 `contribution` 的分子、分母分别累加后再求比例。

### 5.2 KAST

`traded_death` 为：玩家已阵亡、死亡时间有效，且其死亡时间前后 5 秒（含边界）内至少有一名敌方阵亡。
这是 Rating V2 的历史对称窗口，不等同于当前 `TradeFacts` 的 directional `[0, +5s]` 口径。

```text
KAST_battle = 100 * max(
  damage / (average_hp * 1.15),
  assist / (average_hp * 1.25),
  win && survived ? 1 : 0,
  traded_death ? 1 : 0,
  (damage + assist) / (average_hp * 1.20)
)

KAST = cap(avg(KAST_battle), 100)
```

### 5.3 Impact

```text
damage_assist_share = (damage + assist) / battle(sum(damage + assist))
damage_assist_index = damage_assist_share / (1 / 14)
impact_battle = 100 * (0.75 * damage_assist_index + 0.25 * kills)
impact = avg(impact_battle)
```

`impact` 对赢、输场次都计算，并以两位小数百分数字符串输出。

### 5.4 多伤率

一场满足任一条件即计一次：

```text
damage >= average_hp * 1.5
damage >= average_hp * 1.2 && kills >= 1
damage >= average_hp && kills >= 2
kills >= 3
```

```text
multi_damage_rate = multi_damage_battles / battles * 100
```

## 6. 综合 Rating

先计算跨场均值：

```text
potential_dpb = avg(potential_damage)
assist_dpb = avg(assist)
kills_dpb = avg(kills)
average_hp = avg(battle.average_hp)
```

再得到有上限的指数：

| 指数 | 公式 | 上限 | 权重 |
| --- | --- | ---: | ---: |
| Potential | `100 * potential_dpb / average_hp` | 250 | 0.70 |
| KAST | `kast` | 250 | 0.15 |
| Impact | `impact` | 250 | 0.25 |
| AST | `100 * assist_dpb / average_hp` | 200 | 0.30 |
| 多伤率 | `multi_damage_rate` | 无额外截断 | 0.10 |
| 击杀 | `100 * kills_dpb` | 250 | 0.10 |

```text
weighted = 0.70 * potential_index
         + 0.15 * cap(kast, 250)
         + 0.25 * cap(impact, 250)
         + 0.30 * ast_index
         + 0.10 * multi_damage_rate
         + 0.10 * kill_index

rating = round(weighted * 10)
```

分数通常处于约 1000 的量级。`contribution`、`damage_avg` 与 `win_rate` 是解释性展示字段，
不直接进入上式。

## 7. 雷达展示口径（管理员灰度）

V2 雷达图只出现在隐藏的管理员页面 `?view=rating-v2`。它复用 V5 的通用雷达几何、网格与「玩家 / 批次平均」
双多边形展示，但不是 League V5 的七维，也不参与 V2 综合 Rating 的计算。

每个 `RatingV2Calculator.Row` 在完成原有评分后，额外生成只读的 `radar` 投影。投影由后端给出原始值、
历史评分上限归一化值与可用性；前端只能消费投影原始值并对同一 V2 批次求平均，**不得**用表格中已圆整的
字段或 `impact` 百分数字符串重新计算。后端 `normalized` 继续保留为历史解释字段，但不再直接充当最终半径。

| 雷达轴 key | 明细显示的原始值 | 后端历史上限投影（非最终半径） |
| --- | --- | --- |
| `potential_damage_avg` | 场均潜在伤害 | `cap(100 * potential_dpb / average_hp, 250) / 250` |
| `kast` | KAST% | `cap(kast, 100) / 100`（KAST 在其历史定义中已经封顶 100；综合公式的 `cap(kast, 250)` 不会再改变它） |
| `impact` | 数值型 Impact% | `cap(impact, 250) / 250` |
| `assist_avg` | 场均协助 | `cap(100 * assist_dpb / average_hp, 200) / 200` |
| `multi_damage_rate` | 多伤率% | `cap(multi_damage_rate, 100) / 100` |
| `kills_avg` | 场均击杀 | `cap(100 * kills_dpb, 250) / 250` |

虚线「批次平均」的成员是当前 admin API 返回的全部 V2 行（包含选中玩家）。所有成员必须都有同一组六轴；
任何一轴缺失时不以 0 补齐、不按轴过滤玩家，整条参考多边形隐藏并显示不可用提示。选中玩家缺轴时同样不绘制
伪闭合图形。

最终几何使用 V2/V5 共用的相对表现标尺。对每轴原始值设 `q = playerRaw / batchAverageRaw`：

```text
q <= 1: visual = 75 * q
q > 1:  visual = min(150, 75 + 25 * log2(q))
radius = visual / 150
```

因此批次平均固定形成规则 75 环，2 倍平均落在 100 强势线，4 倍为 125，8 倍及以上在不可见 150 上限截断。
可见网格只有 25/50/100，75 由虚线平均环表达；不得绘制 150 polygon/tick/标签。玩家多边形每个可用顶点
常驻标注四舍五入后的 0–150 `visual` 分数。明细默认显示同一视觉分数（玩家 / 批次平均），并提供「分数 / 原始数值」
切换；原始模式继续显示真实玩家值与真实批次平均，切换不得改变雷达几何或顶点标注。任一轴平均值非正、非有限
或缺失时整图 fail-closed，不除零、不伪造相对表现。

交互承载使用右侧选手抽屉，而不是把雷达追加到结果表底部：点击昵称后通过 `Teleport` 打开固定抽屉；
桌面/平板为非模态面板，结果表保持可点击并可直接切换选中玩家；移动端使用遮罩面板。关闭按钮与 `Escape`
均关闭抽屉并把焦点交还触发昵称；移动端 `Tab` / `Shift+Tab` 在模态抽屉内循环，桌面非模态抽屉不锁焦点；
桌面抽屉宽度为 560px。共享雷达提供 50%–150% 缩放（默认 100%、步进 10%），仅改变页面 SVG 尺寸，
不改变明细、相对分数或几何值；窄屏放大后在雷达 viewport 内横向滚动。文件选择、Processing Job 或结果
代次变化时继续清除旧选中玩家。

### 展示变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-08-30 | 抽屉空间与缩放 | V2 桌面抽屉扩大至 560px；V2/V5 共享 50%–150% 页面缩放；PNG 尺寸不变。 |
| 2026-08-30 | 顶点分数与明细切换 | 每轴显示 0–150 视觉分；明细默认分数并可切换原始值；移动端补齐焦点循环。 |
| 2026-08-30 | 相对表现标尺 | V2/V5 共用平均=75、2×平均=100、隐藏150上限的展示几何；V2 评分公式与 API 原始值不变。 |
| 2026-08-29 | V2 雷达抽屉 | 雷达从长结果表底部移入右侧选手抽屉；不修改六轴数据、归一化、批次平均或 V2 评分。 |
| 2026-08-28 | V2 雷达展示 | 复用 V5 通用雷达组件；新增 V2 六轴只读投影与同批次平均，未修改任何 V2 评分公式或权重。 |

## 8. 修改与维护规则

后续升级 V2 时按以下顺序执行：

1. 先在本文件的「算法变更记录」说明目标、公式/参数差异、兼容性和是否需要重新解释历史结果；
2. 同步修改 `RatingV2Calculator`，不得通过当前 Performance 或 League 代码间接改写 V2；
3. 更新 `RatingV2CalculatorTest` 的精确公式、边界和零写回断言；影响 API 时同步 DTO/mapper、
   三语文案、安全契约和前端测试。若触及 `radar` 投影或其六轴口径，还必须同步本节、
   `ratingV2Radar` 前端测试与批次平均缺失契约；
4. 若希望把变更公开给普通用户，必须另立方案，不能仅放宽本灰度页权限；
5. 全量通过 Java、前端、ArchUnit 与文档审查后再合并。

### 算法变更记录

| 日期 | 版本/变更 | 说明 |
| --- | --- | --- |
| 2026-08-26 | V2 灰度恢复基线 | 以 `37a0c0ec` 的最终公式为准；平均 HP 保留 `d4b0dd19` 的双方 14 车总 HP / 14 修正；仅管理员灰度。 |

## 9. 回归基线

`RatingV2CalculatorTest` 至少必须覆盖：

- KAST 的击杀/协助/存活/对称 trade 边界；
- `OBSERVED_EXACT`、Tankopedia、单车 2400 fallback 与固定 `/14`；
- 潜在伤害补增与缺 alpha 的回退；
- 空白昵称、非法负伤害、综合分数尺度与排序；
- 六轴 radar 的 key/顺序、精确归一化、0 值可用性，且新增展示投影前后综合 Rating 不变；
- 调用前后 `PlayerResult` 不被写回。

`RatingV2AdminControllerContractTest`、`RatingV2AdminServiceTest`、`SecurityConfigTest` 还必须证明：
只读取 READY dataset、API key 纯英文、`radar` 只在管理员响应中追加、匿名/普通用户拒绝、管理员允许。
