# 评分系统 (Rating)

> 自包含的表现评分，类 WN8 机制，但"期望值"来自当前处理的这批战斗，不依赖外部表。

## 算法公式

### 有效贡献 (Effective Contribution)

```
EC = damageDealt  +  0.6 * damageAssisted  +  0.35 * damageBlocked  +  200 * kills
```

各权重可从 `common/rating.json` 调整：

| 参数        | 默认值 | 说明             |
| ----------- | ------ | ---------------- |
| `assist`    | 0.6    | 协助伤害系数     |
| `block`     | 0.35   | 格挡伤害系数     |
| `killValue` | 200    | 每击杀的固定分值 |

### 车型基准 (Class Baseline)

按车型（轻坦/中坦/重坦/TD/其他）分别统计 EC 均值作为基准：

- 某车型样本数 ≥ `minSamples`(默认 5) → 基准 = 该车型 EC 均值
- 某车型样本数 < `minSamples` → 基准 = 全体 EC 均值 × 车型难度系数

车型难度系数：

| 车型 | 系数 |
| ---- | ---- |
| 重坦 | 1.0  |
| 中坦 | 0.9  |
| TD   | 1.0  |
| 轻坦 | 0.7  |
| 其他 | 0.9  |

> 轻坦系数最低(0.7)，因为轻坦伤害通常低于重坦，但实际作用不小——降低系数使其评分更公平。

### 评分公式

```
rating = round( scale  ×  (EC / baseline)  ×  (1 + winBonus if 获胜) )
```

| 参数       | 默认值 | 说明                              |
| ---------- | ------ | --------------------------------- |
| `scale`    | 1000   | 评分基准分(理论上同型平均 = 1000) |
| `winBonus` | 0.05   | 胜场加成(+5%)                     |

**结果范围经验：**

- `< 700` — 较差
- `700 ~ 999` — 中等
- `1000 ~ 1299` — 良好
- `1300 ~ 1599` — 优秀
- `≥ 1600` — 卓越

## 基准范围

评分基准来自**一同计算的那批战斗**，不同场景基准不同：

| 场景         | 基准范围               |
| ------------ | ---------------------- |
| 单场导出     | 仅该场内的 14 人       |
| 多场汇总导出 | 所有上传的场次全部选手 |
| 预览         | 本次上传的全部回放     |

因此单场评分可能高于汇总评分（样本少、波动大），属正常现象。

## 配置方式

**调参数（不改代码）：** 只改 `common/rating.json`，然后重建即可。

**改公式结构：** 需要改 `java/wotb-core/src/main/java/com/wotb/core/stats/Rating.java`。

## 列定义

| 位置               | 中文名   | key                   | 类型 |
| ------------------ | -------- | --------------------- | ---- |
| 单场"玩家数据"表   | 评分     | `rating`              | 数值 |
| 汇总"汇总"表       | 场均评分 | `rating_avg`          | 数值 |
| API `/api/columns` | —        | `rating`/`rating_avg` | 数值 |

## 前端展示

- 彩色徽章 (`rbadge`) 按分数段着色
- 同一组（单场/汇总）最高分标记 🥇，最低分标记 🍅
- 汇总页顶部指标卡显示"最高场均评分"

## 数据流

```
Rating.compute(battles, tankopedia)
  │
  ├─ 遍历所有玩家，计算各人 EC
  ├─ 按车型分组，求各车型 EC 基准
  ├─ 写入 PlayerResult.rating
  │
  ├─ [导出] Rating → Columns(key=rating) / AggregateSheets(key=rating_avg)
  ├─ [API]  Mapper 的 AGG_COLS → rating_avg
  ├─ [聚合] Aggregator 累加 ratingSum → Agg.avgRating()
  └─ [前端] ratingTier() 分色 + medal() 极值标记
```

## 测试

`ParityTest.ratingComputedAndCentered()` 验证：

- 每位玩家都有非 null 评分
- 平均评分 ≈ 1000（在 850~1150 之间）
