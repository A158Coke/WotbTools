# League Rating V5（训练赛 / 联赛批次证据评分）

> 状态：Implementation Candidate  
> 日期：2026-08-26  
> 项目：A158Coke/WotbTools  
> 适用范围：训练房（Training）与联赛 / 锦标赛（Tournament）回放  
> 关系：**单场评分继续使用 League Rating V4.1；V5 新增 Batch Evidence Adjustment。**

---

## 0. 执行摘要

League Rating V5 不重写 V4.1 的七维单场算法。

V5 解决的是另一个产品问题：

> 用户在回放解析的批次汇总 / 排行榜里，往往只看第一眼的主 Rating 数字；当输入只有 1 场、BO3、BO5 等少量比赛时，直接显示玩家逐场 V4.1 Rating 的中位数会严重放大小样本“爆种”表现。

因此 V5 将评分分成两层：

1. **Single Battle Rating**：一场比赛的表现评分，沿用 V4.1，0–1000。
2. **Batch Player Rating**：先取玩家全部有效单场 V4.1 Rating 的中位数，再根据该玩家在当前上传中实际拥有的有效评分场次数进行单边 evidence adjustment。

最终 Batch Player Rating：

\[
Raw_i = Median(R_{i,1}, R_{i,2}, \ldots, R_{i,n})
\]

\[
E(n)=1-e^{-n/6}
\]

固定 evidence anchor：

\[
A=450
\]

\[
Rating^{V5}_i=
\begin{cases}
Raw_i, & Raw_i \le 450\\[4pt]
450 + E(n_i)\cdot(Raw_i-450), & Raw_i>450
\end{cases}
\]

最终 clamp：

\[
0 \le Rating^{V5}_i \le 1000
\]

核心性质：

- **低于或等于 450 的 Raw Median 不调整、不加分。**
- 只对 `Raw > 450` 的上侧表现做小样本保守修正。
- Evidence 只依赖该玩家自己的有效评分场次数 `n`。
- 同一个玩家、同一组 replay，不得因为同批上传的其他玩家、战队强弱、赛事阶段、对手或地图构成变化而改变 V5 Rating。
- 不存在 `n >= X` 后突然 100% 释放的硬阈值；Evidence 连续趋近 1。
- 单场 V4.1 完全不受 V5 影响。

---

## 1. 为什么升级为 V5

V4.1 已经解决单场 Rating 的核心业务语义：

- 七维总上限 1000；
- Damage / Assist / Kill / Exchange / Blocked / RC / Shooting；
- Winner ×1.05；
- RC 使用 Winner+Survived / directional Trade `[0,+5s]`；
- Shooting 使用 Soft Wilson；
- 不引入 Tankopedia HP normalization；
- Batch Aggregation 使用 Median。

但 V4.1 Batch Median 仍存在小样本问题。

例如一个玩家只上传一场极强比赛：

```text
Single Battle V4.1 = 900
Raw Batch Median    = 900
```

如果汇总排行榜直接显示 900，普通用户会自然理解成：

> 这个玩家目前就是一个 900 Rating 选手。

这超出了单场数据能支持的证据范围。

V5 的目标不是降低优秀表现，而是让**排行榜第一眼的大数字本身带有样本证据约束**。

---

## 2. 产品语义

### 2.1 Single Battle Rating

回答：

> 你这一场打得怎么样？

一场比赛仍直接展示 V4.1 Final Rating。

例如：

```text
Single Battle Rating = 912
```

V5 不修改这个数字。

### 2.2 Batch Player Rating

回答：

> 根据当前上传的这些比赛，目前有多少证据支持你达到这个批次表现水平？

例如只上传一场：

```text
Observed Median = 912
Rated Battles   = 1
V5 Rating       ≈ 521
```

这不是说这一场只值 521。

含义是：

- 单场表现：912；
- 当前只有 1 场证据；
- 汇总排行榜主 Rating 只保守确认到约 521。

### 2.3 UI 第一数据原则

排行榜 / 汇总表中的主 `Rating` 必须直接显示 **V5 Batch Player Rating**。

不要把 Raw Median 作为第一主数字，然后额外放一个“可信度”标签试图纠正用户理解。

用户详情（Player Detail Drawer）应保留至少：

```text
Rating            648
Observed Median    800
Rated Battles        5
```

可以解释 Evidence Adjustment，但不要求普通用户理解概率或统计学。

不得把 `E(n)` 直接包装成“56.5% 可信概率”；它是 release/evidence weight，不是后验概率。

---

## 3. V4.1 单场公式保持冻结

V5 不改变以下 V4.1 公式。

### 3.1 七维满分

| Dimension | Max |
|---|---:|
| Damage | 365 |
| Assist | 110 |
| Kill | 110 |
| Exchange | 180 |
| Blocked | 50 |
| RC | 75 |
| Shooting | 110 |
| **Total** | **1000** |

### 3.2 Generic normalization

Damage / Assist / Kill / Exchange / Blocked：

\[
T(x)=
\begin{cases}
0,&x\le0 \text{ or } teamAvg\le0\\
\min(1,\frac{x}{2\cdot teamAvg}),&otherwise
\end{cases}
\]

\[
G(x)=\frac{14-averageDescendingRank}{13}
\]

并列使用平均名次；非正值 `G=0`。

维度：

\[
Score=Max\cdot(teamWeight\cdot T + globalWeight\cdot G)
\]

权重：

| Dimension | Team | Global |
|---|---:|---:|
| Damage | 0.60 | 0.40 |
| Assist | 0.70 | 0.30 |
| Kill | 0.40 | 0.60 |
| Exchange | 0.30 | 0.70 |
| Blocked | 0.70 | 0.30 |

### 3.3 Exchange

\[
O=damage+0.60\cdot assist+0.35\cdot blocked
\]

\[
participation=\min(1,\frac{O}{teamAvgEffectiveOutput})
\]

\[
ExchangeEfficiency=
\frac{O}{O+received}\cdot participation
\]

不使用 max HP / Tankopedia / vehicle class bonus。

### 3.4 RC

状态：

- `WIN_SURVIVED` → 75
- `TRADE` → 50
- `NONE` → 0

Trade：

> 玩家最终死亡时刻后 `[0,+5.000s]` 内存在敌方最终死亡。

- `-1s`：不是 Trade
- 同 timestamp：Trade
- `+5.000s`：Trade
- `+5.001s`：不是 Trade
- unknown death time：fail-closed，RC=0
- loser survived：0
- 不存在 `LOSER_TOP4`
- 不要求 killer attribution

### 3.5 Shooting

95% Wilson lower bound，`z=1.96`。

\[
rawAcc=shots>0 ? hits/shots : 0
\]

\[
rawPen=hits>0 ? pens/hits : 0
\]

\[
Acc_{soft}=0.9\cdot WilsonLB(hits,shots)+0.1\cdot rawAcc
\]

\[
Pen_{soft}=0.9\cdot WilsonLB(pens,hits)+0.1\cdot rawPen
\]

\[
Confidence=0.3\cdot Acc_{soft}+0.7\cdot Pen_{soft}
\]

\[
DamageParticipation=\min(1,\frac{damage}{teamAvgDamage})
\]

\[
Shooting=110\cdot\min(1,\frac{Confidence}{0.70})\cdot DamageParticipation
\]

### 3.6 Final single-battle Rating

\[
Base=\sum sevenDimensions
\]

\[
Final=
\begin{cases}
\min(1000,Base\cdot1.05),&winner\\
Base,&loser
\end{cases}
\]

---

## 4. V5 Batch Evidence Adjustment

### 4.1 Raw Batch Rating

对玩家当前批次所有**成功产生 League Rating 的合法、去重 battle**：

\[
Raw=Median(SingleBattleFinalRatings)
\]

`n`：

\[
n=RatedBattleCountForThisPlayer
\]

注意：

- `n` 是该玩家实际参与且成功评分的 battle 数；
- 不是整个上传 batch 文件数；
- 不是 batch 总评分场数；
- 轮换选手按自己的 `n`；
- duplicate arena 只计 canonical battle 一次；
- Rating-ineligible / failure battle 不计入 `n`；
- 同一玩家同一组 canonical battle 必须产生确定性相同结果。

### 4.2 Evidence curve

\[
E(n)=1-e^{-n/6}
\]

`n <= 0` 时没有 Batch Rating。

典型 Evidence：

| Rated Battles | E(n) |
|---:|---:|
| 1 | 15.35% |
| 2 | 28.35% |
| 3 | 39.35% |
| 4 | 48.66% |
| 5 | 56.54% |
| 6 | 63.21% |
| 7 | 68.86% |
| 8 | 73.64% |
| 9 | 77.69% |
| 10 | 81.11% |
| 12 | 86.47% |
| 15 | 91.79% |
| 18 | 95.02% |
| 22 | 97.44% |
| 25 | 98.45% |

这些百分比是算法 release weight，不是“玩家 Rating 正确概率”。

### 4.3 Anchor

固定：

\[
A=450
\]

450 是 V5 Batch Evidence V1 的 calibration constant。

选择固定 anchor 的原因：

1. 消除 cohort dependence；
2. 同一玩家同一组 replay 不受同批其他玩家影响；
3. 真实 34 场冠军赛数据中，425–475 形成平坦稳定区；
4. 450 在小样本 anti-lucky-high 与产品可读性之间优于 500；
5. 不把当前上传 batch 的人群构成偷偷写入玩家 Rating。

### 4.4 单边修正

如果：

\[
Raw\le450
\]

则：

\[
V5=Raw
\]

禁止：

```text
Raw 350
因为样本少
→ V5 420
```

小样本不能成为低分玩家的加分器。

如果：

\[
Raw>450
\]

则：

\[
V5=450+E(n)(Raw-450)
\]

例如 `Raw=800`：

| n | V5 |
|---:|---:|
| 1 | ≈504 |
| 3 | ≈588 |
| 5 | ≈648 |
| 9 | ≈722 |
| 12 | ≈753 |
| 18 | ≈783 |
| 25 | ≈795 |

例如 `Raw=900`：

| n | V5 |
|---:|---:|
| 1 | ≈519 |
| 3 | ≈627 |
| 5 | ≈704 |
| 9 | ≈800 |
| 12 | ≈839 |
| 18 | ≈878 |
| 25 | ≈893 |

---

## 5. 输入形态

V5 **不识别或硬编码** BO3 / BO5 / BO9 / 四强 / 八强 / 训练六图12局。

这些只是 `n` 的自然来源。

典型用户输入：

| Input | Typical player n | Algorithm |
|---|---:|---|
| 单场训练 | 1 | 直接使用 E(1) |
| BO3 | 2–3 | E(2..3) |
| BO5 | 3–5 | E(3..5) |
| 总决赛 BO9 | 5–9 | E(5..9) |
| 六图12局训练 | 12 | E(12) |
| 四强全部比赛 | 玩家各自实际 n | E(n) |
| 八强全部比赛（约18局上下） | 玩家各自实际 n | E(n) |
| 更多轮次完整赛事 | 玩家各自实际 n | E(n) |

不得根据“赛事叫总决赛”额外加分。

不得因为一个 batch 总共有 18 场，就把只参加 4 场的轮换玩家按 `n=18` 计算。

---

## 6. 为什么暂时不加入 Series / Opponent / Map Diversity

研究阶段曾测试：

\[
Evidence=f(Battles,Series,Opponents,MapCoverage)
\]

未采用。

### 6.1 Series count

初步观察：

- 1 series MAE 高；
- 2 series MAE 更低；
- ≥3 series 更低。

但控制 **同一玩家 + 相同 battle count** 后：

> 跨多个 series 没有稳定独立降低误差。

player-equal 配对差异约 -1.18 Rating，bootstrap 95% CI 跨过 0。

因此早期 series improvement 主要与：

- 场次数增加；
- 晋级深度；
- 玩家样本选择

混杂。

当前数据不足以把 SeriesFactor 写入生产公式。

### 6.2 Opponent diversity

有弱趋势，但没有稳定独立增益。

不加入。

### 6.3 Map / side coverage

34 场正式赛样本中 unique maps 与 battle count 高度共线，无法独立估计 map coverage 的额外价值。

六图12局训练是合理产品场景，但当前数据不足以证明应增加额外 bonus。

不加入。

### 6.4 原则

未来如果获得新的独立赛事 / 训练数据，可以重新验证这些变量。

在没有跨数据集稳定证据前：

> 不增加复杂度。

---

## 7. 为什么不使用动态 Batch Median Prior

曾测试：

\[
\mu=Median(CurrentBatchPlayerRawRatings)
\]

未采用。

问题：

> 同一个玩家、同一组比赛，仅仅因为本次一起上传的其他玩家更强或更弱，最终 Rating 会改变。

这是 cohort dependence。

例如相同：

```text
Raw = 800
n   = 5
```

如果动态 batch prior 变化，最终显示分可能相差 100+。

这破坏关键不变量：

\[
Rating(player,replays)
\]

不应变成：

\[
Rating(player,replays,otherUploadedPlayers)
\]

因此 V5 使用固定 450 anchor。

---

## 8. 被拒绝的 Batch 调整方案

### 8.1 Reliability label only

例如：

```text
827 · 4场 · Provisional
```

未采用作为主要解决方案。

原因：

> 用户第一眼仍然只记住 827。

可靠性必须进入主 Rating 本身。

### 8.2 Symmetric Bayesian shrinkage

未采用。

会出现：

```text
Raw 350
→ Adjusted 420
```

少场低分被向总体 prior 上拉，不符合竞技排行榜产品语义。

### 8.3 Bootstrap Median LCB

未采用。

小 n 时 Median bootstrap 分布离散，BO3 / BO5 可能产生数百分的跳跃惩罚，产品体验过于粗暴。

### 8.4 Hard release threshold

例如：

```text
n >= 12 → 100% Raw
```

未采用。

会产生 11→12 场的人为评分跳变。

指数 evidence curve 连续趋近 1，不需要硬阈值。

### 8.5 BO /赛事阶段硬编码

禁止：

```text
if BO5 ...
if BO9 ...
if semifinals ...
if finals ...
```

评分只看可验证 replay facts 和该玩家有效评分场次数。

---

## 9. 真实数据研究基础

V5 Batch Evidence 调整基于用户提供的冠军赛回放研究：

- 原始 `.wotbreplay`：44
- `arenaId` 去重后：34 场
- 标准 7v7
- 476 player-game
- 主要战队：CHRD / TOP / KSR / G7

原 V4.1 研究已明确：

- Golden Dataset 用于 offline calibration / regression；
- 不允许把这届比赛战队名、玩家名、车辆 meta 写入生产评分；
- 新数据应做 out-of-sample validation，而不是反复调当前数据到完美。

V5 同样遵守。

### 9.1 Batch stability experiment

以高场次玩家完整可用 Median 作为 reference，随机抽取较少比赛。

Raw Median 在小样本下误差很大：

- 2–3 场：非常不稳定；
- 5–6 场：仍然明显 noisy；
- 8–10 场：开始进入可用区间；
- 更大样本逐渐稳定。

### 9.2 不同典型输入的 Raw 风险

离线模拟中：

- 单场：高波动；
- BO3-like：高波动；
- BO5-like：仍有明显 lucky-high；
- BO9-like：明显好转但仍非完整证据；
- 四强 / 八强规模：逐渐接近 full-sample 排名。

指数 evidence adjustment 在这些场景下整体降低 MAE 和少场高估概率，同时改善排行榜 Top-N 恢复。

### 9.3 参数停止规则

已经确定：

- Anchor = 450
- Evidence time constant = 6

不继续为了当前 34 场尝试 445 / 455 / 5.8 / 6.2 等微调。

否则属于 overfitting。

下一步需要另一届独立赛事 / 训练数据进行真正 out-of-sample validation。

---

## 10. Team Rating

V5 当前只改变 **Batch Player Rating**。

不把 evidence adjustment 自动套给 Team Rating。

原因：

- 队伍比赛场数与晋级高度相关；
- 对 Team Rating 做相同样本修正可能隐式引入 bracket / advancement bias；
- 当前研究没有足够证据冻结 Team-level evidence model。

因此：

- 单场 Team Rating：保持现有 V4.1 定义；
- Batch Team Rating：保持现有 Median；
- Player Batch Rating：升级为 V5 evidence-adjusted Rating。

后续若研究 Team Evidence，必须独立版本化，不得顺手复用玩家公式。

---

## 11. API / DTO 语义要求

V5 实现后，玩家批次 summary 至少应能明确表达：

- `league_rating`：V5 Batch Player Rating（主显示值）
- `league_rating_raw_median`：V4.1 单场 Final 的 raw median
- `league_rated_battles`：玩家实际参与且成功产生 Rating 的 canonical battle 数

如果 API 已有等价字段，复用并明确语义；不要为了名字一致制造重复字段。

不得把 `league_rating` 同时用于：

- 单场 V4.1；
- 批次 Raw Median；
- 批次 V5 Rating

而不给 scope 区分。

单场 Battle DTO 的 `league_rating` 仍代表 V4.1 Single Battle Final。

批次 Player Summary 的 `league_rating` 代表 V5 Batch Player Rating。

文档和 mapper 必须明确 scope。

---

## 12. 导出语义

### 单场 Excel / PNG

继续导出：

> Single Battle V4.1 Rating

不应用 V5 Batch evidence adjustment。

### Batch Excel / PNG

玩家主 `Rating`：

> V5 Batch Player Rating

同时应保留可追溯字段：

- Observed Median
- Rated Battles

七维 Batch 汇总语义保持既有设计，不因为 V5 改成 evidence-adjusted dimension score。

V5 evidence adjustment 只作用于最终 Batch Player Rating，不重新缩放七维 Radar / dimension means / dimension medians。

---

## 13. Radar 与 Player Detail

### Radar

V5 Evidence Adjustment 不修改七维 raw score；Radar 的 presentation geometry 由 V2/V5 共用相对表现标尺负责。

Radar 仍然展示：

- 单场：V4.1 `dimensionScores`
- 批次：`dimensionMeans`（rated battle arithmetic mean）

每轴与当前 Battle/Global Average 比较：平均映射为规则 75 环，2 倍平均为 100 强势线，4 倍为 125，
8 倍及以上在不可见 150 上限截断。可见 SVG 不生成 150 边界/刻度/标签；玩家顶点标注与半径同源的
0–150 视觉分。明细默认显示玩家/平均视觉分，并可切换为原始 `score/max` 与真实平均；切换不改变图形。
Rating Profile PNG 复用同一顶点标注位置并固定输出默认分数明细。
该相对图形只回答“相对当前比较组的轮廓”，不承诺跨上传批次绝对可比。

`resp.league.columns[].max` 只用于原始数值模式的 `score / max` 解释，不参与 reference membership 或 geometry availability；
max 缺失/非法时原始模式降级为 raw score，只要 player/reference raw 完整，相对多边形仍必须可绘制。

Evidence Adjustment 不作用于单个维度。

禁止为了让 Radar “看起来和 V5 Rating 一致”把七个维度一起乘 `E(n)`。

### Player Detail Drawer

Batch scope 建议：

```text
Rating             <V5>
Observed Median    <Raw>
Rated Battles      <n>
```

Single Battle scope：

```text
Rating             <V4.1 single battle>
```

不得把 Batch V5 Rating 当作单场 Rating 显示。

---

## 14. 回放解析页面文档入口

League Rating 是回放解析的条件能力，因此用户应该能从回放解析直接查看算法说明。

要求：

- 在 Replay Parsing / League Rating 可见上下文增加明确入口，例如：
  - `Rating V5 说明`
  - `算法说明`
  - `League Rating V5`
- 入口在 League Rating UI 可发现，而不是藏在全局设置。
- 桌面、约 11" 平板、手机都可用。
- 不应跳走并丢失当前 replay selection / processing result / active tab / drawer state。
- 优先使用 modal / drawer / overlay / 新标签等不会销毁当前页面状态的交互。
- 文档只有一个 canonical source：本文件。
- 禁止复制整份正文到 Vue 组件 / locale / 第二份 markdown 中形成双事实源。
- Agent 实现前必须检查当前 Vite / Spring 资源能力，选择最小、可维护的方式让前端读取 canonical doc。
- 如果最终选择外部 GitHub 文档链接，也必须确保不会替换当前页面且用户可返回；但优先 in-app 阅读体验。

---

## 15. 核心不变量

实现必须保持：

1. 同一玩家、同一组 canonical rated battles → V5 Rating 确定。
2. 改变同批其他玩家 → 该玩家 V5 Rating 不变。
3. 改变 batch 文件顺序 → 不变。
4. 添加 duplicate replay → 不变。
5. `Raw <= 450` → `V5 == Raw`。
6. `Raw > 450` 且 `n` 增加 → 在 Raw 不变的反事实下，V5 单调不减。
7. `n → ∞` → `V5 → Raw`。
8. `V5 <= Raw`（当 Raw>450）。
9. V5 不修改任何 Single Battle V4.1 Rating。
10. V5 不修改七维 score。
11. V5 不修改 Team Rating。
12. V5 不依赖 Tankopedia / AI / DB / historical player profile / current batch prior。
13. 所有输出 finite、0–1000。
14. 不产生 NaN / Infinity。
15. 无 TODO / FIXME / 临时兼容双路径 / V4.1 Batch 与 V5 Batch 并存的技术债。

---

## 16. 必须覆盖的回归测试

### 16.1 Evidence curve

验证：

- `n=1`
- `n=3`
- `n=5`
- `n=6`
- `n=9`
- `n=12`
- `n=18`
- `n=25`
- 大 n 数值稳定
- `n<=0` 的 contract

验证：

\[
E(n)=1-e^{-n/6}
\]

并单调增长、`0<E(n)<1`。

### 16.2 Anchor

- Raw 0
- Raw 449.99
- Raw 450
- Raw 450.01
- Raw 800
- Raw 1000

验证 `Raw<=450` 完全不变。

### 16.3 Median

奇数、偶数、中位数、duplicate canonicalization 后 `n` 和 Raw 的一致性。

### 16.4 Cohort independence

固定玩家自己的 rated battle list。

加入 / 删除其它玩家或改变其它玩家 Rating：

> 目标玩家 V5 Rating 必须完全不变。

### 16.5 Scope

- battle row：V4.1 single battle
- player summary：V5
- team summary：仍旧既有 Team Median
- export：scope 正确
- drawer：scope 正确

### 16.6 UI

- League Mode 有文档入口；
- 普通 Random replay 不误显示 League V5 文档 CTA（除非产品明确决定全局可查看）；
- 点击文档入口不丢失回放解析状态；
- 可关闭并返回；
- mobile 无横向溢出；
- i18n 文案完整；
- accessibility：button/label/focus/escape contract 与项目现有 modal/drawer 方式一致。

---

## 17. 版本与迁移规则

这是：

> **League Rating V5**

不是 V4.2。

版本边界：

- V4.1：Single Battle Formula
- V5：V4.1 Single Battle Formula + Batch Player Evidence Adjustment

实现完成后：

- 用户可见文案使用 `League Rating V5`；
- 文档不能继续把 Batch Player Rating 描述成“仅 Median”；
- 旧 V4.1 文档中的单场公式历史仍可保留；
- 不得留下“V4.1 Batch Rating 与 V5 Batch Rating 可选切换”；
- 不需要 feature flag / legacy compatibility，除非真实生产数据契约明确要求，并且必须有移除路径；当前目标是一次性收口。
- 不修改历史档案文件以伪装 V5 一直存在；需要保留 V4.1 研究历史。

---

## 18. 未来验证

V5 上线后优先收集：

1. 另一届完整 7v7 tournament replay；
2. ≥100 场独立比赛；
3. 单独的 BO3 / BO5 / BO9；
4. 六图12局训练样本；
5. 轮换人数明显不同的战队；
6. 不同 meta / 坦克构成。

第一步是验证：

- Anchor=450 是否仍处于稳定区域；
- `tau=6` 是否仍减少 lucky-high；
- 是否保持 Top-N stability；
- 是否出现系统性低估高水平少场玩家。

**先验证，不先重新调参。**

只有跨数据集出现一致、可复现的系统性偏差，才考虑 V5.1 / V6。

---

## 19. 最终冻结定义

### Single Battle

\[
R_{battle}=V4.1
\]

### Raw Batch Player

\[
Raw=Median(R_{battle,1...n})
\]

### Evidence

\[
E(n)=1-e^{-n/6}
\]

### Anchor

\[
A=450
\]

### V5 Batch Player Rating

\[
\boxed{
R_{V5}=
\begin{cases}
Raw,&Raw\le450\\[4pt]
450+(1-e^{-n/6})(Raw-450),&Raw>450
\end{cases}
}
\]

### Clamp

\[
R_{V5}=\min(1000,\max(0,R_{V5}))
\]

这就是 League Rating V5 Batch Player Rating 的唯一生产定义。
