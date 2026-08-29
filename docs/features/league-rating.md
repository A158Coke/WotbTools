# League Rating（训练赛/联赛评分）

> 训练赛（Training）与联赛/锦标赛（Tournament）回放的 0–1000 综合评分，作为现有「回放解析」
> 功能的条件能力存在——没有独立入口、没有独立上传页。实现见
> `wotb-core/.../league/`（纯 Java 评分 core）与 `wotb-web/.../replay/`（模式判定 / DTO / 导出）。

**这不是旧 Rating V2 综合评分**：Rating V2 已随「战斗表现」重构移除；本功能是全新的、只消费
当前上传回放可证明事实的内存级评分，与排行榜、名人堂、AI 复盘均无关系。
> 生产状态：死亡时刻精度 degrade 被接受（UNKNOWN≠非法，允许整场评分）；不做 legacy 死亡启发式。

## 适用范围

| 模式 | raw arenaBonusType | League Rating |
|---|---|---|
| 训练房（Training） | 2 | ✅ |
| 联赛/锦标赛（Tournament） | 4 | ✅ |
| 随机战斗（Random） | 1 | ❌（普通回放，保持现有结果） |
| 游戏内评级战斗（Rating） | 7 | ❌ |
| Mad Games 等其它 | 8… | ❌ |

模式编号证据：`docs/features/hall-of-fame.md` 证据矩阵（1=随机战斗有真实夹具
random-battle-example、2=训练房有真实夹具 training-room-example、4=联赛 supremacy 有真实样本
protocol.md）、`HallOfFameBattleTypePolicy`（单一事实源）、`docs/reference/replay-data.md`。
训练赛与联赛可以在同一批次内混合（都属于 League Rating）。

**模式判定**：每次预览产生明确模式——`STANDARD_REPLAY`（全部普通）、
`LEAGUE_RATING`（全部训练赛/联赛）、`MIXED_UNSUPPORTED`（两类混合 → League Rating 不聚合，
`league=null` + `leagueUnavailableCode=MIXED_LEAGUE_AND_STANDARD_REPLAYS`，battles 仍按普通
回放语义成功返回——混合 League eligibility 不得污染 Replay Parser）。preview / 合并导出 /
每场导出共用同一判定与同一评分 core（禁止两套公式）。

## 数据来源与内存级生命周期

- 只使用当前上传回放解析出的权威事实（`ReplayParser` → `Battle` / `PlayerResult`）：
  team、tankId、winnerTeam、damageDealt、damageAssisted、damageReceived、damageBlocked、
  kills、survived、survivalTimeSec、nShots、nHitsDealt、nPenetrationsDealt、
  victoryPointsEarned、victoryPointsSeized、accountId、nickname、clan、arenaId、arenaBonusType。
- **Rating 计算不用** Tankopedia HP / 期望值、XP/Credits、AI、历史上传、
  外部 API 或全服统计（contribution/kast/impact 是 Replay Performance Metrics，**保留在
  CW 单场/汇总表与选手 Drawer**，只作表现展示，不进七维 Rating；contribution/kast 可经用户
  选择进入自定义 Radar，Impact 无稳定 normalization contract 暂不入 Radar）。
- 全部结果（评分、战队名称覆盖、MVP）只存在于当前 HTTP 请求与前端页面内存中；
  刷新 / 重新上传 / 服务重启后不保留。不写数据库、localStorage、服务端文件。
- 复用 `TradeFacts`（V4.1 directional 互换窗口：玩家死亡后 `[0, +5]` 秒内存在敌方死亡，
  时间窗口启发式，非精确 killer attribution）。

## 严格完整性门槛（7v7）

每场必须：14 个结算记录、14 个唯一非零 accountId、队伍只能为 1/2、两队各 7 人、
`settlementAccountsCoveredByRoster=true`（结算账号全部来自名册 #201，无幽灵结算）且
`settlementRosterTeamConsistent=true`（名册队伍无冲突；名册可含 non-combatant extra，如观战者，
不要求名册全集合 == 结算全集合）、14 名玩家非零 tankId、
`winnerTeam` 明确为 1/2（平局/未知不评分）、统计字段无负值/非有限/违反真实字段关系
（命中≤射击、击穿≤命中）。

**死亡时间 UNKNOWN ≠ 数据非法**：阵亡玩家 `survivalTimeSec == 0` 表示精确死亡时刻无法从
回放可靠证明（`DeathTimeReconciler` 的 fail-closed 结果），这是**合法状态**——整场仍允许评分；
该玩家仅在依赖死亡时刻的 Survival/Trade 维度按 0 分保守计算（`TradeFacts` 无法建立
`[0, +5s]` directional 死亡窗口即 fail-closed 返回 0，绝不猜测），其它六维按真实 Replay facts 正常评分，
总分保持 0–1000 不重新归一化。`survivalTimeSec < 0` / NaN / Infinity /
明显超过战斗时长（`> duration + 1s`）仍为非法 stat facts（`LEAGUE_INVALID_STAT_FACTS`），
整场拒绝评分。

**protobuf 零值策略**：身份/队伍/车辆/胜方等结构字段按真实存在性 fail-closed（0/非法值拒绝）；
伤害/助攻/阻挡/击杀/占点等统计字段**合法为 0**——proto 未编码字段解码为 0 与真实 0 不可区分
（`PlayerResult.raw` 保留字段存在性但不作统计字段的完整性要求），缺失与零值同等对待，
绝不把「字段缺失」误判为损坏。某一场不满足门槛 → 该场不评分，在失败列表返回
文件名 + arenaId + 稳定错误码（如 `LEAGUE_NOT_SEVEN_VS_SEVEN` / `LEAGUE_ROSTER_INCOMPLETE`），
批量中其他合法同类型回放继续。不允许管理员强制绕过。

**评分质量限制（非阻断）**：评分可以生成、但某些子事实无法证明（如死亡时间 UNKNOWN）时，
<b>不进入 failure 列表</b>，而是由响应 `league.ratingQuality.unknownDeathTimePlayers` 返回
该批已评分场次中「死亡时间 UNKNOWN 的阵亡玩家」实例数；这些玩家照常进入单场 Rating、
选手/战队汇总、中位数、MVP、Excel/PNG 导出，仅「存活 / 互换」维度按 0 分保守计算。
前端以非阻断 warning 提示，不允许把 UNKNOWN 伪装成「所有数据完全可靠」。

## 批次去重与冲突（仅当前批次）

- 按正式战斗身份 `arenaId` 去重（不按文件名）。同一 arenaId 多份回放关键事实一致 → 只计一份，
  其余进 duplicates；关键事实不一致（阵容/winnerTeam/玩家结算/生存状态等）→ 该场全部副本
  拒绝评分（`CONFLICTING_REPLAYS_FOR_ARENA`）。不自动选「字段更多」的副本；
  不建立持久化记录，重新上传同一 arenaId 会重新计算。
- **死亡时间三层语义（先判 INVALID，再判 UNKNOWN/KNOWN）**：
  - **INVALID**（`survivalTimeSec < 0` / NaN / Infinity）：非法 stat facts，与**任何**其它值
    （含 UNKNOWN 0）都是冲突——UNKNOWN 不是 wildcard，不能把 INVALID 或两个互相矛盾的 KNOWN
    洗成合法；整场拒绝评分（`CONFLICTING_REPLAYS_FOR_ARENA`）。
  - **UNKNOWN**（`== 0`）：当前 replay 无法可靠证明精确死亡时刻（evidence absence），
    不是「已证明死亡时间为 0 秒」；与任意合法 KNOWN / 其它 UNKNOWN 兼容。
  - **KNOWN**（`> 0`）：两个 KNOWN 差 ≤ 1s 容差一致，超过容差冲突；生死状态（survived）
    不同也是冲突。
- **Group-level all-pairs 判定（上传顺序无关）**：对同 arenaId 全部副本做**全对**一致性检查
  （`LeagueRatingConflictDetector.validateAndReconcile`），不再以 first copy 作 anchor——
  `[UNKNOWN, KNOWN100, KNOWN128]` 因 KNOWN100 vs KNOWN128 超 1s 容差必须 conflict，
  UNKNOWN 不能隔开两个互相矛盾的 KNOWN；上传顺序不改变是否评分。
- **确定性 canonical 死亡时间收口**：全部一致时只保留一份（第一份 source identity），
  其余进 duplicates；死亡时间按与上传顺序无关的规则收口——UNKNOWN+KNOWN → 采用 KNOWN；
  KNOWN+KNOWN → 采用全部 KNOWN 的最小值；全部 UNKNOWN → 保持 UNKNOWN(0)。
  canonicalizer **只处理合法值**（UNKNOWN=0 / KNOWN=finite>0），INVALID 在一致性阶段已
  fail-closed 拒绝，绝不修改、替换、清洗非法值（禁止 INVALID→UNKNOWN）。
  最终进入 Validator / Calculator / 批次汇总 / `ratingQuality` 的是这份 canonical battle，
  上传顺序不改变 Rating 结果（`ratingQuality` 只统计 canonical battle 中的 UNKNOWN 玩家实例）。
- **hard-conflict 字段**（任一不一致 → 冲突）：settlementAccountsCoveredByRoster /
  settlementRosterTeamConsistent（决定 ROSTER_INCOMPLETE）、durationS（影响死亡时间
  beyond-duration 判定）、nHitsReceived / nPenetrationsReceived / nEnemiesDamaged
  （validator 非法值检查参与）、clan（影响 team autoName / teamKey / batch summary identity）；
  **仅死亡时间 UNKNOWN 允许 evidence reconciliation**，不存在「字段更多 replay 优先」。

## 七维度公式（合计 1000）

| 维度 | 满分 | 本队贡献 | 全场排名 |
|---|---:|---:|---:|
| 伤害 | 365 | 60% | 40% |
| 助攻 | 110 | 70% | 30% |
| 击杀 | 110 | 40% | 60% |
| 换血效率 | 180 | 30% | 70% |
| 阻挡 | 50 | 70% | 30% |
| 存活/互换 | 75 | 状态分 | — |
| 射击效率 | 110 | 特殊公式 | 特殊公式 |

> 历史：Rating 原为八维（含「争霸占点」50 分，合计 1000）。2026-08 收口为七维：
> 删除争霸占点评分维度，射击效率满分从 50 提至 100 补位，总分保持 1000。
> `victoryPointsEarned / victoryPointsSeized` 仅作为 Replay 解析出的客观事实展示
> （单场「获取点数」、汇总「获取点数/场」），**不参与任何 Rating 计算**。

- **本队贡献指数** T(x) = min(1, x / (2 × teamAvg))：本队平均对应 0.5，两倍及以上封顶 1。
- **全场排名指数** G(x) = (14 − avgRank) / 13：14 人内降序、并列共享平均名次；唯一第一=1、
  唯一最后=0、全场全零=0；用未取整值计算排序。
- **换血效率**：O = dmg + 0.6×assist + 0.35×blocked；参与度 = min(1, O/teamAvgEff)；
  效率 = O/(O+received) × 参与度（零安全；少量输出+零承伤不能满分；承伤不直接奖励/扣分）。
- **存活/互换（RC，V4.1）**：胜方存活 75；阵亡且死亡后 `[0, +5]` 秒内存在敌方死亡
  （directional，边界包含）50；败方存活 0；其它 0。优先级自上而下
  （胜方存活 > 有效互换 > 0；胜方阵亡但发生互换仍为 50）。
  preliminary = **六个非 RC 维度之和**（伤害/助攻/击杀/换血/阻挡/射击，不含存活分与
  胜方倍率）；base = preliminary + RC。
- **射击效率（V4.1 Soft Wilson）**：`rawAcc = hits/shots`、`rawPen = pens/hits`
  （zero-safe，clamp [0,1]）；`softAcc = 0.9×Wilson95%下界(acc) + 0.1×rawAcc`、
  `softPen = 0.9×Wilson95%下界(pen) + 0.1×rawPen`；置信度 = 命中 30% / 击穿 70% 合成，
  射击分 = 110 × min(1, 置信度/0.70) × 伤害参与（min(1, dmg/teamAvgDamage)）。
  只给正向奖励，一发一中一穿不得接近满分，高效率无伤害参与不给高分；
  相比 pure Wilson 缓解低射速/高 Alpha 车辆的 sample-size 机械偏差。
- **争霸占点（不评分）**：`victoryPointsEarned/Seized` 仅作为客观统计展示；**不参与任何
  Rating 维度**。单场 UI 显示「获取点数」（raw `victoryPointsEarned`），批次汇总显示
  「获取点数/场」（`earnedTotal / battles` 算术平均）。`victoryPointsSeized` 保留为
  backend fact，CW Rating 主 UI 不展示。不得用这两个字段推断胜方、终局比分、实时点数
  或占点时间线。
- 某项指标全场为零 → 该维度全员 0，不把权重重新分配。
- **最终分**：base = 七维之和；胜方 min(1000, base × 1.05)，败方 = base（不扣分）。
  最终计算保留高精度；API 返回未取整值；**总 Rating 页面只显示整数（如 `927`）**，
  不显示 /1000 换算的冗余完成度百分比（`927 · 92.7%` 会被误读为百分位/胜率）；
  七维维度仍显示 `实际分 / 维度满分 · 百分比`（如 `342 / 365 · 93.7%`，满分来自后端
  `league.columns` metadata）。排名 / MVP / 中位数一律使用未取整分数。

### V4.1 冻结规范速查

```text
TOTAL = 1000
Damage 365 / Assist 110 / Kill 110 / Exchange 180 / Blocked 50 / RC 75 / Shooting 110

Damage:   365 × (0.60T + 0.40G)
Assist:   110 × (0.70T + 0.30G)
Kill:     110 × (0.40T + 0.60G)
Exchange: 180 × (0.30T + 0.70G)
          O = dmg + 0.6×assist + 0.35×blocked
          participation = min(1, O / teamAvgO)
          efficiency = O / (O + received) × participation（零安全）
Blocked:  50 × (0.70T + 0.30G)
RC:       winner survived = 75；dead + enemy death ∈ [playerDeath, playerDeath+5s] = 50；否则 0
Shooting: rawAcc = hits/shots；rawPen = pens/hits（zero-safe，clamp [0,1]）
          softAcc = 0.9×Wilson95%(hits,shots) + 0.1×rawAcc
          softPen = 0.9×Wilson95%(pens,hits) + 0.1×rawPen
          conf = 0.3×softAcc + 0.7×softPen
          score = 110 × min(1, conf/0.70) × min(1, dmg/teamAvgDamage)

Winner final = min(1000, base × 1.05)；Loser final = base
单场 Team Rating = 本队 7 人 finalRating 算术平均；batch（选手/战队）= median
Trade：directional [0, +5s]（敌方不早于玩家，边界包含）；不是 killer attribution
禁止：Tankopedia HP normalization / role bonus / LOSER_TOP4 / dual algorithm / 调参
```

## MVP 与战队 Rating

- 每场一个全场 MVP + Team 1/Team 2 各一个队内最佳（同一玩家可同时拥有）。
- MVP 排序：finalRating → 胜方优先 → damageDealt → damageAssisted → kills → accountId（技术兜底）。
- 战队 Rating = 本队 7 人 finalRating 算术平均（不再叠加胜方倍率）。
- 战队名称：本队 ≥4/7 玩家同军团标签时自动使用该标签（`CLAN_MAJORITY`）；否则待命名
  （`UNNAMED`），由上传者填写。名称只保存在当前页面内存，刷新消失；修改立即反映在单场
  战队 Rating 区域、批次合并汇总、PNG 导出与 Excel 导出（经导出请求 metadata 传递，
  服务端仅本次调用内使用，不保存）。批次战队聚合**不得**把不同比赛的 Team 1 合并成一个战队：
  优先按多数军团标签或用户确认的名称作为批次 team key，无法确定跨场身份时保持为
  `arenaId:team` 行。

## 批次汇总（V5 Batch Player Rating + Raw Median）

> 当前版本：**League Rating V5**。单场评分继续使用 V4.1；V5 只新增 Batch Player
> Evidence Adjustment。完整算法定义（canonical 唯一正文）见
> `docs/WotBTools_League_Rating_V5.md`，本文件只记录与实现相关的契约要点。

- 选手汇总按 accountId：参赛场次、finalRating 中位数、七维度中位数、MVP 次数（仅展示）、
  胜场与关键原始统计总量/均值、获取点数/场（客观统计）。
- 战队汇总按批次 team key：参赛场次、单场 teamRating 中位数、七维度中位数、胜场。
- **V5 Batch Player Rating（主 Rating）**：`raw = 玩家自己的单场 V4.1 Final Rating
  中位数`；`E(n)=1-exp(-n/6)`（`n` = 该玩家自己的有效评分场次数）；`raw <= 450` 时
  V5 = raw（单边，不加分）；`raw > 450` 时 `V5 = 450 + E(n)·(raw-450)`，最后 clamp
  到 0–1000。Anchor=450、tau=6 为冻结常量；无动态 batch prior、无 series/opponent/map
  factor、无 hard release threshold。七维 median/mean 与 Team Rating **不应用** V5。
- **Raw Observed Median**：`ratingMedian` 保留为 explainability 信息（列
  `league_rating_raw_median`，默认可隐藏），与主 Rating 严格区分。
- CW 汇总页（League 模式）：玩家信息合并为**一张统一玩家表**（Replay Aggregate 为基底，
  按 accountId join League Player Summary；有 Aggregate 无 Rating 的玩家保留并补 "--"）。
  **列契约**：只有「玩家 + 总 Rating」固定（sticky 核心对），其余列（七维 / MVP / 表现指标 /
  原始 facts）全部经 ColumnPicker 显示/隐藏/重排并持久化，mergeCwPlayerColumns 只提供合法
  column universe，不替用户决定最终顺序。
  **样本语义**：场次 = Replay Aggregate 解析场次；评分场次 = League Player Summary 评分场次
  （rated-only），两列独立显示，不互相覆盖。
  点击任意玩家行右侧滑出选手详情 Drawer（**可自定义指标/顺序的雷达图** + 表现指标 +
  scope 语义的评分/事实）。战队独立一张表。
- 中位数：奇数取中间值、偶数取两个中间值的算术平均；使用未取整分数；不设最低场次；
  不排序、不产生批次 MVP/前三名；必须显示参赛场次。
- 选手与战队汇总并入库内现有「合并汇总」视图（两个紧邻表格，不混行伪装）。

## Excel 导出

- **XLSX = 数据导出**：永远导出完整合法数据字段，完全不受当前 UI ColumnPicker 影响
  （与前端显示偏好解耦；backend export 不读取任何前端列偏好）。
- 普通模式 Excel 保持现状。
- League 单场工作簿：玩家数据（身份 + 单场 Performance Metrics（contribution/kast/impact）
  + Rating 关键原始字段 + 占点原始字段 + 七维度实际分/满分/百分比
  + 总 Rating）、战斗信息（含双方战队 Rating、全场 MVP、双方队内最佳）、原始字段。
- League 批量工作簿：选手汇总、战队汇总、每场明细、战斗列表（含重复/冲突/校验失败）；
  不产生赛季排名或批次奖项。
- mode=each：逐场导出单场工作簿——League 模式已评分场次为 League 单场工作簿、未评分场次
  回退普通单场工作簿；解析失败/冲突场次跳过并计入 failures 进度。
- **混合批次（普通 + 训练赛/联赛混传）**：League Rating 不聚合（`league=null` +
  `leagueUnavailableCode=MIXED_LEAGUE_AND_STANDARD_REPLAYS`），preview 的 battles 仍按普通
  回放语义成功返回；aggregate 导出按 Standard Replay 汇总工作簿语义；each 导出按普通回放
  逐场生成标准单场工作簿。Preview 与 Excel 复用同一评分 core。

## PNG 导出

- **PNG = 当前视图（所见即所得）**：导出用户当前页面看到的表格——列 = 当前 ColumnPicker
  勾选列，顺序 = 当前用户 reorder 顺序，行序 = 当前排序；不再强制输出隐藏列。
  - 单场 Battle PNG：列 = 当前 `shownCols`（playerOrder + visibleKeys）。
  - Standard aggregate PNG：列 = 当前 `shownAggCols`（aggOrder + aggVisibleKeys）。
  - CW 统一玩家表 PNG：列 = 当前 `unifiedShownCols`（cwOrder + cwVisibleKeys）。
  - Team Summary PNG：当前完整显示列（Team Summary 无独立 ColumnPicker，保持整表）。
  - CW 固定列（nickname + league_rating）本就属于 fixed visible，自然始终出现，
    PNG export helper 不做额外 column policy。
- 实现：克隆当前结果 panel DOM（`createExportClone` + `getExportTarget`），即得到当前
  可见列/顺序/排序/战队名称覆盖；clone 中取消 sticky 定位（避免固定列覆盖其他列），
  `.tablewrap` 使用 `max-content` 自然宽度；按真实 descendant 宽度测量，在 canvas
  16384 限制内自动降 scale，不裁切右侧列、不压缩到视口宽度；深色/浅色主题均可读。
- Rating-ineligible 场次 Rating/七维导出 `--`（只有真实 raw 0 才显示 0，
  禁止 `Number(raw) || 0` 伪造）。
- 普通回放 PNG 行为保持现状（同样是当前视图）。

## 前端集成

- 不新建页面/上传入口。当前 `ReplayPage` / `BattleTable`：概览卡下方、玩家表上方增加
  League Rating 概览（双方战队名称与 Rating、全场 MVP、双方队内最佳、占点实验性说明）。
- 玩家表固定「玩家」与「总 Rating」两列（sticky，左偏移响应真实列宽；hidden/reorder 后
  重新测量），其余列横向滚动；Team 1/Team 2 行底色不覆盖 sticky 单元格；MVP 徽标固定尺寸
  避免列宽跳动。sticky 测量逻辑抽取为 utils/stickyColumns.js 供单场表与统一玩家表复用。
- **CW 列契约**：仅「玩家 + 总 Rating」固定不可隐藏/移动；单场表、CW 统一玩家表都经
  useColumns（league scope）控制可见性与顺序，持久化独立于普通模式。CW 统一玩家表另有独立
  cw scope（wotb-league-cw-* storage），同样复用同一 ColumnPicker /拖拽/持久化基础设施，
  不另建第二套系统。
- League 默认可见列：单场表 = 玩家/战队/车辆/伤害/助攻/击杀/总 Rating（contribution/kast/impact
  在列 universe 中，可经 ColumnPicker 显示）；CW 统一玩家表默认 = 玩家/总 Rating/七维/MVP/
  场次/评分场次/胜场/胜率/场均伤害/场均助攻/场均击杀/获取点数每场/表现指标
  （rated_battles 进入生产 Column contract：leaguePlayerSummaryColumns → mergeCwPlayerColumns
  → useColumns cw scope → ColumnPicker）。列名与原始字段区分（「伤害」vs「伤害评分」）。
- **选手 Drawer 雷达**：只允许七维 League Rating，用户可自定义维度与顺序（min 3 / max 7），
  偏好独立 localStorage（`wotb-radar-metric-order`），Summary 与 Battle 共用；Contribution/KAST/Impact
  继续保留在表现指标区，不进入 Radar。每个玩家顶点常驻标注 0–150 视觉分；明细默认显示玩家/平均视觉分，
  可切换为 raw `score/max` 与真实平均值，切换不改变几何。维度 raw score 与 `score/max` 解释仍来自后端 metadata，最终几何
  则按当前 Battle/Global Average 使用共用相对表现标尺（平均=75、2×平均=100、隐藏150上限）；max
  metadata 缺失时 raw 模式降级显示 raw score，但不影响 raw/reference 完整轴的相对几何。Rating Profile PNG
  与页面复用同一顶点分数定位并默认导出分数明细。
- 所有可见列（单场 / 普通汇总 / CW 统一玩家表 / 战队汇总）均支持 ASC/DESC 排序：
  数值 numeric、字符串自然序（Intl.Collator numeric）、缺失（null/''/NaN/--）恒排最后、
  排序基于 raw 值（格式化单元格按原始数值排）。
- 列偏好与普通模式独立 storage scope，互不污染；Reset 各自恢复默认。

## 测试

- core 单测：T/G 边界、七维度满分/零分（V4.1 精确 365/110/110/180/50/75/110）、
  换血（零承伤/零输出/参与度限制/高助攻/高阻挡）、Soft Wilson（0/0、1/1 不得满分、
  多次高效、高效率低参与、精确公式、低/高样本机械偏差收敛）、存活状态
  （胜方存活 75 / directional trade 50 / 败方存活恒 0 —— LOSER_TOP4 回归锁）、
  trade 边界（[0,+5s] 含边界、敌方早死不计、同队/存活/UNKNOWN 不计）、
  胜方 ×1.05 与 1000 封顶、MVP/队内最佳/重复徽标、战队七人平均、七维满分总和=1000、
  争霸点数不影响 Rating（points independence）、奇数/偶数中位数。
- 完整性：标准 7v7、13/15 人、非 7/7、重复账号、缺 tankId、roster 不完整、队伍冲突、
  未知胜方、平局、死亡时间 UNKNOWN（`survivalTimeSec == 0`）不阻塞评分、负数/NaN/Infinity/
  超时长死亡时间拒绝、合法零值、protobuf 缺失字段不误拒、非法数值关系、
  arenaId 重复一致/冲突、UNKNOWN 不得推断 trade。
- 模式：单普通/单训练/单联赛/随机/游戏内评级、Training+Tournament 允许、Training+Random
  与 Tournament+评级 整体 400、preview/合并导出/每场导出规则一致。
- API 契约：普通模式响应兼容、League 含 typed 数据、League playerColumns/aggregateColumns
  **含** contribution/kast/impact、总 Rating 固定列元数据、七维度 max、leagueMode 显式标记
  （唯一事实源，league=null 不改变模式）、failures/duplicates/conflicts。
- 前端：普通模式不显示 Rating UI、League 显示战队 Rating/MVP/新列、混合错误、固定列、
  ColumnPicker 控制维度、普通/League 偏好隔离、sticky 列、队名编辑即时更新、重复徽标、
  **CW 列契约（仅玩家+Rating 固定，其余用户控制，两个自定义顺序测试）**、
  **leagueMode=true + league envelope 存在但 0 评分（battle.league=null、playerSummaries=[]）
  仍是 CW（Drawer/Performance/facts 照常，Rating 显示 --）**、
  **自定义 Radar（默认七维/自定义/重排/持久化/非法偏好 fallback/缺失轴 --）**、
  批次只汇总不排名、手机/平板/桌面滚动无覆盖。
- 导出：普通 Excel 不回归、League Excel 含总分/七维度/MVP/战队分/队名覆盖、
  **含单场 contribution/kast/impact**、XLSX 完整字段不受 ColumnPicker 影响、PNG 当前视图
  列/顺序/排序导出、sticky 不覆盖、超宽不裁切、深浅主题、canvas 限制安全缩放。

## Build-to-Learn（设计决策）

1. **为什么不用 Tankopedia HP 和历史均值**：HP 在回放中并非总能证明（`BattleHpFacts` 的
   fail-closed 已经证明这一点）；历史均值需要持久化且会跨场污染。本功能只依赖每场结算
   必然存在的数值字段，任何一场都能独立复算，结果可解释、可审计。
2. **本队指数与全场排名分别解决什么问题**：本队贡献指数把「在 7 人小队的相对输出」归一化，
   不受车辆/版本差异影响；全场排名指数给出 14 人内的相对位置。两者加权可以同时表达
   「对本队的价值」与「全场压过多少人」，且天然都是 [0,1] 可合成。
3. **为什么射击效率用 Soft Wilson（V4.1）**：一发一中一穿在经典命中率口径下是 100%，
   会过度奖励小样本；Wilson 95% 下界让小样本置信度显著低于大样本，多次高效射击才接近满分。
   但 pure Wilson 对低射速 / 高 Alpha 车辆存在 sample-size 机械偏差（同 raw 比例下
   射击次数越多分数越高），V4.1 冻结为 **90% Wilson 下界 + 10% 原始比例**：保留小样本
   保守性，同时让低射速车辆获得更公平评价。
4. **为什么承伤不能直接奖励**：承伤本身可能是错误走位的代价；本公式只把承伤作为
   「输出/(输出+承伤)」的分母（换血效率），并叠加参与度限制——少量输出零承伤不能拿满分，
   承伤不作为直接奖励或扣分。
5. **为什么占点字段不参与 Rating**：`victoryPointsEarned/Seized` 是逐人结算统计，
   不包含实时点数广播/胜负阈值信息（protocol.md 证明实时点数走事件流 wrapper=13），
   且其精确定义（是否含被动占点增长/击杀夺分）尚未证明；把结算值合成进个人评分属于
   过度推断。2026-08 起两个字段仅作为客观统计展示（获取点数 / 获取点数/场），
   **不进入任何 Rating 维度**。
6. **为什么 League 与普通回放必须使用模式化列契约**：两种模式都保留 contribution/kast/impact
   （它们是 Replay Performance Metrics，不属于 League Rating）；League 模式**新增** Rating
   维度列（league_*），且只有「玩家 + 总 Rating」固定。若不模式化，两种模式会互相污染列配置
   （ColumnPicker 偏好、Excel 表头、PNG），且用户会把「伤害」与「伤害评分」混淆。模式化后：
   API 按模式返回列集合、前端按模式隔离 storage scope、导出按模式选择 writer。
7. **为什么 Radar 指标需要 Registry 而不是组件硬编码**：不同指标取值语义不同（League 维度
   满分由后端 metadata 提供），组件不应现场猜 raw source 或维度顺序。Registry 负责稳定取数与明细，
   共用 `radarScale` 负责相对当前比较组的几何；因此形状会随 Battle/Global Average 改变，必须明确标注
   比较范围，不能宣称跨批次绝对可比。Radar 是 visualization preference，永远不改 Rating。
7. **如何避免 preview / Excel / PNG 出现三套算法**：评分 core（`LeagueRatingCalculator`）
   是纯 Java 单点实现；preview 与 Excel 都由 `LeagueReplays.collect` 产出同一
   `LeagueRatingBatch`（Excel 从 ProcessedDataset 复用，不二次解析/不二次计算）；
   PNG 的数值直接来自 preview DTO 的同一 cells。任何公式改动只改 core 一处。
## 原始射击比例（raw shooting rates）

正式契约（UI 展示层真实百分比，与 Rating 内部 Wilson confidence 是两套独立语义）：

```
hit_rate  = hits / shots        （命中率）
pen_rate  = penetrations / hits （击穿率——分母是命中次数，不是射击次数）
```

- denominator == 0（无射击 / 无命中）→ **null（unavailable）**：API null、Excel 空单元格、UI 显示 "--"，禁止 0/0 伪装成 0%。
- numerator == 0 且 denominator > 0 → **合法 0%**（有射击全未命中 / 有命中全未击穿）。
- 跨场（aggregate）基于**总量**：`sum(pens) / sum(hits)`、`sum(hits) / sum(shots)`，
  不是各场比例的简单平均。
- **UI raw rate ≠ Rating shooting score**：League Rating 射击维度内部使用
  Soft Wilson（90% Wilson 95% 置信下界 + 10% raw rate，命中 30% / 击穿 70%，
  见 LeagueRatingCalculator），不因 UI 显示真实百分比而改成纯裸比例。

## Player Radar 数据契约（Summary mean / Battle 单场）

Radar 是 presentation / player-profile visualization，不参与 finalRating / MVP /
Team Rating 计算；Radar aggregation 只发生在多场 player summary visualization。

| Context   | 指标        | 数据来源                                |
| --------- | ----------- | --------------------------------------- |
| Summary   | Final Rating | `batchRatingV5`（V5 Evidence Adjustment 后主 Rating） |
| Summary   | Raw Median   | `ratingMedian`（Raw Observed Median，explainability） |
| Summary   | League 七维  | `dimensionMeans`（rated-battle 算术平均） |
| Battle    | Final Rating | 当前单场 `league_rating`                 |
| Battle    | League 七维  | 当前单场 `league_*_score`（`dimensionScores`） |
| Summary   | Contribution/KAST | 当前批次 Performance aggregate（全部已解析场次样本） |
| Battle    | Contribution/KAST | 当前单场 Performance metric               |

规则：

- **Summary 七维 = arithmetic mean of rated battle scores**（分母 = 评分场次，
  Rating-ineligible 场不进入；UNKNOWN death-time 场是合法 rated sample，
  Survival/Trade 的真实 0 必须进入 mean，不能过滤；真实 0 参与平均，
  禁止只平均非零场次）。「典型比赛得分」（Table/Excel）仍用
  `dimensionMedians`——两个 UI 回答不同问题，禁止把 mean 改名成 median 或反之。
- **Battle Radar 永远显示本场数据**；`ReplayPage` / `PlayerDetailDrawer` 按 scope
  取数（summary → `dimensionMeans`，battle → `dimensionScores`），
  禁止 summary 数据污染 battle radar 或 battle 数据污染 summary radar。
- **missing / invalid ≠ 真实 0**：`dimensionScores` 非 7 维、null、NaN、Infinity 是
  invariant violation（`LeagueRatingBatchAggregator.chunkMeans/chunkMedians`
  对残缺 stride fail fast）；Radar 轴缺失显示 `--`，不冒充 0/0%。
- **几何标尺**：League 维度满分仍来自后端 `resp.league.columns`（key/max）供明细解释，frontend 不硬编码
  domain max；max 缺失只让明细退化为 raw score，不改变 geometry availability。最终半径按 player raw
  score / 当前 Battle/Global Average 映射为平均75、2×平均100、
  4×平均125、>=8×平均150。150 只作不可见坐标上限，不绘制外边界或刻度。
- **分数标注 / 明细模式**：每个玩家顶点显示与最终半径同源、四舍五入后的 0–150 视觉分。明细默认显示
  玩家视觉分与固定 75 的平均分，可切换回原始玩家 `score/max`（max 不可用则 raw score）和真实参考值；
  模式切换不改变雷达几何、顶点标注或 Rating Profile PNG。PNG 固定输出默认分数模式，确保静态图可直接比较。
- **Impact 不入 Radar**（无稳定 normalization contract）；hit_rate / pen_rate
  也不入 Radar candidate。

## 最常使用坦克（选手 Drawer）

> Summary 与 Battle 两个 scope 的坦克展示，纯 presentation / profile 信息，**不参与任何
> Rating / 七维 / MVP / Team Rating 计算**；不写入数据库或历史赛季。

- **Summary**：显示当前上传批次中该选手的 **rated-only** 场次里使用最多的坦克
  （贴图 + 官方名 + 使用场次 + 使用比例 `mostUsed.battles / ratedBattles`）。
- **判定**：只统计 rated battle；按 `tankId` 累计场次；场次最多者胜出。**并列时**只对具有
  可靠官方名的坦克按 `tankName` 忽略大小写升序选择第一辆，名称仍相同再按 `tankId` 升序
  稳定兜底。Tankopedia 对未知 ID 返回的 `#<tankId>` 占位名视作「无可靠名称」——不参与排序、
  不伪造坦克；若全部最大次数候选均无可靠名称则返回 null。不使用最近出场时间 / Rating /
  胜率 / 伤害打破平局，也不退回使用次数较少的坦克。
- **Battle**：直接显示该场玩家行的 `tank_id` / `tank_name`（来源 `PlayerResult.tankId`），
  不执行统计、不显示无意义的 `1 场 · 100%`。
- **数据流**：Core 聚合器在 rated-only 循环中把 `(tankId, 场次)` 直方图累计进
  `PlayerLeagueSummary.vehicleUsage`（`List<PlayerVehicleUsage>`，只有 tankId + battles，
  Core 不复制 Tankopedia）；Web `Mapper` 消费现有 `Tankopedia` 单一事实源做最终选择并
  生成 `LeagueVehicleUsageDto(tankId, tankName, battles)`。API 只回 key + 数据；
  **无可靠车辆数据时返回 null，不得伪造坦克**。
- **贴图**：只用随前端发布的本地 WebP（`frontend/src/assets/tank-portraits/tier-x/`，经
  `vehicle-portraits/runtime.js` 的 `loadVehiclePortrait` 按 tankId 懒加载），
  **禁止浏览器运行时请求 BlitzKit**；快速切换选手用 token 防旧异步结果覆盖。
  缺图 / 非 Tier X 时保留名称与统计、隐藏图片区、不显示破图图标，不影响雷达与 Drawer。

## Potential Damage（潜在伤害）

Potential Damage / 潜在伤害指标已从当前产品整体移除：不再计算、不再进入 Replay data
model、API、Standard/League 表格、单场/汇总 Excel、mode=each、Radar，也不参与任何
Rating / Performance 指标。删除记录见 CHANGELOG。
