# WotBTools League Rating V6

> 当前 canonical 算法说明。V4.1 负责单场 Rating；V6 负责多场批次汇总。

## 范围与不变量

V6 只改变批次选手/战队汇总。它不改 V4.1 单场公式、回放解析、战队 identity、数据库、控制器、worker、对手强度、赛程或地图因素。批次仍只聚合 canonical、可评分的 League battles；duplicate/conflict 的既有处理顺序保持不变。

选手汇总使用有效单场选手 `finalRating` 的 raw sum 与 count；战队汇总使用每场
`TeamBattleRating` 的 raw sum 与 count。不得先按 battle 做 median，也不得按 battle median 再平均。

## Research Data Status

本季 2026 锦标赛的 34 个 arena 仅是研究、校准与 sanity 检查语料，不是永久 Golden Dataset，
也不是永久 regression 或 compatibility fixture。长期回归只保留 V6 公式、property 与 invariant 测试。

## 公式

对选手，设 `S` 为有效单场选手 V4.1 Final Rating 之和，`N` 为有效评分场次。
对战队，设每场 `TeamBattleRating = 7 名选手 Final Rating 的算术平均值`，`T` 为这些每场
TeamBattleRating 之和，`N` 为有效评分场次，anchor `A = 475`：

```text
Player V6 Rating = (S + 5 × A) / (N + 5) = (S + 2375) / (N + 5)
Team V6 Rating   = (T + 1 × A) / (N + 1) = (T + 475) / (N + 1)
Player Observed Mean = S / N
Team Observed Mean   = T / N
```

`N = 0` 时没有 Rating、Observed Mean 或维度均值，API 使用 `null`/不可用语义。所有输出保持未取整的有限值并限制在 `[0,1000]`。

选手 prior weight 为 5，战队 prior weight 为 1；两者都对称地把先验 475 作为额外观测。不同上传顺序、chunk 边界、重复输入顺序不得改变结果。

## 维度与战队

七个 League 维度各自按有效评分场次累加 raw dimension score，再除以同一有效场次数。真实 0 必须进入分子，不能因为是 0 而丢弃。维度均值只用于展示和 Radar，不参与批次 Rating、MVP 或排名。

战队 V6 Rating 使用该战队每场 `TeamBattleRating` 的 pooled sum/count 和 team prior；每场
`TeamBattleRating` 是该场 7 名队员 Final Rating 的算术平均值。战队 identity / `teamKey` 规则为：

- ≥4/7 玩家共享同一个非空 clan 标签：`teamKey = clan:<tag>`，该战队可以跨 arena 聚合；
- 否则：`teamKey = arenaId:team`，不自动跨 arena 聚合。

用户输入的战队名称仅是现有 `teamKey` 的显示/导出覆盖，不改变 `teamKey`，也不合并不同 arena
的 unnamed teams。

## API、UI 与导出

批次 domain/API 字段使用：

- `ratedBattles`：有效评分场次；
- `rating`：V6 主 Rating；
- `observedMean`：透明展示用的 pooled Observed Mean；
- `dimensionMeans`：七维 pooled 算术均值。

CW 统一玩家表按 `accountId` 合并；只有玩家与主 Rating 是固定列，其余列可隐藏、重排。单场 Drawer 继续显示 V4.1 Rating 与单场维度；批次 Drawer 显示 V6 Rating、Observed Mean、rated battles 与 dimension means。Radar 仍是 presentation-only，不反向影响任何评分。

Excel 批量汇总导出 V6 主 Rating、Observed Mean 与七维均值；单场明细仍导出 V4.1。导出字段不受前端 ColumnPicker 影响。

## 验收要点

- 单场 V4.1 数值保持不变。
- 选手/战队使用 pooled raw sum/count；median 不参与主 Rating、维度、排行或 MVP。
- 真实 0、unknown death-time、rated/ineligible、duplicate/conflict 与空样本语义保持一致。
- 解析、API、前端、Excel、三语 i18n、测试与文档使用同一 V6 命名；不得保留生产 V5 并行字段。
