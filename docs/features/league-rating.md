# League Rating（训练赛/联赛评分）

> 训练赛（Training）与联赛/锦标赛（Tournament）回放的 0–1000 综合评分，作为现有「回放解析」
> 功能的条件能力存在——没有独立入口、没有独立上传页。实现见
> `wotb-core/.../league/`（纯 Java 评分 core）与 `wotb-web/.../replay/`（模式判定 / DTO / 导出）。

**这不是旧 Rating V2 综合评分**：Rating V2 已随「战斗表现」重构移除；本功能是全新的、只消费
当前上传回放可证明事实的内存级评分，与排行榜、名人堂、AI 复盘均无关系。

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
回放语义成功返回，plan §21：混合 League eligibility 不得污染 Replay Parser）。preview / 合并导出 /
每场导出共用同一判定与同一评分 core（禁止两套公式）。

## 数据来源与内存级生命周期

- 只使用当前上传回放解析出的权威事实（`ReplayParser` → `Battle` / `PlayerResult`）：
  team、tankId、winnerTeam、damageDealt、damageAssisted、damageReceived、damageBlocked、
  kills、survived、survivalTimeSec、nShots、nHitsDealt、nPenetrationsDealt、
  victoryPointsEarned、victoryPointsSeized、accountId、nickname、clan、arenaId、arenaBonusType。
- **不用** Tankopedia HP / 期望值、Potential Damage、XP/Credits、AI、历史上传、旧
  contribution/kast/impact、外部 API 或全服统计。
- 全部结果（评分、战队名称覆盖、MVP）只存在于当前 HTTP 请求与前端页面内存中；
  刷新 / 重新上传 / 服务重启后不保留。不写数据库、localStorage、服务端文件。
- 复用 `TradeFacts`（±5 秒互换窗口，时间窗口启发式，非精确 killer attribution）。

## 严格完整性门槛（7v7）

每场必须：14 个结算记录、14 个唯一非零 accountId、队伍只能为 1/2、两队各 7 人、
`rosterComplete=true`（结算账号全部来自名册 #201 且名册队伍无冲突；名册可含 non-combatant
extra，如观战者，不要求名册全集合 == 结算全集合）、14 名玩家非零 tankId、
`winnerTeam` 明确为 1/2（平局/未知不评分）、阵亡玩家 `survivalTimeSec > 0` 且与战斗时长无
明显矛盾、统计字段无负值/非有限/违反真实字段关系（命中≤射击、击穿≤命中）。

**protobuf 零值策略**：身份/队伍/车辆/胜方等结构字段按真实存在性 fail-closed（0/非法值拒绝）；
伤害/助攻/阻挡/击杀/占点等统计字段**合法为 0**——proto 未编码字段解码为 0 与真实 0 不可区分
（`PlayerResult.raw` 保留字段存在性但不作统计字段的完整性要求），缺失与零值同等对待，
绝不把「字段缺失」误判为损坏。某一场不满足门槛 → 该场不评分，在失败列表返回
文件名 + arenaId + 稳定错误码（如 `LEAGUE_NOT_SEVEN_VS_SEVEN` / `LEAGUE_MISSING_DEATH_TIME`），
批量中其他合法同类型回放继续。不允许管理员强制绕过。

## 批次去重与冲突（仅当前批次）

- 按正式战斗身份 `arenaId` 去重（不按文件名）。同一 arenaId 多份回放关键事实一致 → 只计一份，
  其余进 duplicates；关键事实不一致（阵容/winnerTeam/玩家结算/生存状态等）→ 该场全部副本
  拒绝评分（`CONFLICTING_REPLAYS_FOR_ARENA`）。不采用第一份、不选「字段更多」的副本；
  不建立持久化记录，重新上传同一 arenaId 会重新计算。

## 八维度公式（合计 1000）

| 维度 | 满分 | 本队贡献 | 全场排名 |
|---|---:|---:|---:|
| 伤害 | 400 | 60% | 40% |
| 助攻 | 100 | 70% | 30% |
| 击杀 | 100 | 40% | 60% |
| 换血效率 | 150 | 30% | 70% |
| 阻挡 | 50 | 70% | 30% |
| 存活/互换 | 100 | 状态分 | — |
| 射击效率 | 50 | 特殊公式 | 特殊公式 |
| 争霸占点 | 50 | 70% | 30% |

- **本队贡献指数** T(x) = min(1, x / (2 × teamAvg))：本队平均对应 0.5，两倍及以上封顶 1。
- **全场排名指数** G(x) = (14 − avgRank) / 13：14 人内降序、并列共享平均名次；唯一第一=1、
  唯一最后=0、全场全零=0；用未取整值计算排序。
- **换血效率**：O = dmg + 0.6×assist + 0.35×blocked；参与度 = min(1, O/teamAvgEff)；
  效率 = O/(O+received) × 参与度（零安全；少量输出+零承伤不能满分；承伤不直接奖励/扣分）。
- **存活/互换**：胜方存活 100；阵亡且 ±5s 内有互换 75；败方存活且 preliminary 进入本队前四 50；
  其他 0。preliminary = 前七个维度之和（不含存活分与胜方倍率）；第四名同分依次按
  preliminary → damageDealt → damageAssisted → kills → accountId。
- **射击效率**：命中 30% / 击穿 70% 的 **Wilson 95% 置信下界**合成 × 伤害参与
  （min(1, dmg/teamAvgDamage)）；只给正向奖励（0–50），一发一中一穿不得接近满分，
  高效率无伤害参与不给高分。
- **争霸占点**：earned/seized 分别归一化（**禁止直接相加原始值**），
  earnedIndex = 0.7T + 0.3G、seizedIndex = 0.7T + 0.3G，
  objective = 50 × (0.3×earnedIndex + 0.7×seizedIndex)。
  两个原始字段必须同时显示在 UI 与导出。**这是实验性个人占点口径**：不得用两个字段推断
  胜方、终局比分、实时点数或占点时间线。非争霸赛全 0 时所有人占点分为 0。
- 某项指标全场为零 → 该维度全员 0，不把权重重新分配。
- **最终分**：base = 八维之和；胜方 min(1000, base × 1.05)，败方 = base（不扣分）。
  最终计算保留高精度；API 返回未取整值；页面总分显示整数 + 完成度（如 `927 · 92.7%`），
  维度显示 `342 / 400 · 85.5%`。排名 / MVP / 中位数一律使用未取整分数。

## MVP 与战队 Rating

- 每场一个全场 MVP + Team 1/Team 2 各一个队内最佳（同一玩家可同时拥有）。
- MVP 排序：finalRating → 胜方优先 → damageDealt → damageAssisted → kills → accountId（技术兜底）。
- 战队 Rating = 本队 7 人 finalRating 算术平均（不再叠加胜方倍率）。
- 战队名称：本队 ≥4/7 玩家同军团标签时自动使用该标签（`CLAN_MAJORITY`）；否则待命名
  （`UNNAMED`），由上传者填写。名称只保存在当前页面内存，刷新消失；修改立即反映在单场
  战队 Rating 区域、批次合并汇总、PNG 导出与后续 Excel 导出（经导出请求 metadata 传递，
  服务端仅本次调用内使用，不保存）。批次战队聚合**不得**把不同比赛的 Team 1 合并成一个战队：
  优先按多数军团标签或用户确认的名称作为批次 team key，无法确定跨场身份时保持为
  `arenaId:team` 行。

## 批次汇总（中位数）

- 选手汇总按 accountId：参赛场次、finalRating 中位数、八维度中位数、MVP 次数（仅展示）、
  胜场与关键原始统计总量/均值。
- 战队汇总按批次 team key：参赛场次、单场 teamRating 中位数、八维度中位数、胜场。
- 中位数：奇数取中间值、偶数取两个中间值的算术平均；使用未取整分数；不设最低场次；
  不排序、不产生批次 MVP/前三名；必须显示参赛场次。
- 选手与战队汇总并入库内现有「合并汇总」视图（两个紧邻表格，不混行伪装）。

## Excel 导出

- 普通模式 Excel 保持现状。
- League 单场工作簿：玩家数据（身份 + Rating 关键原始字段 + 占点原始字段 + 八维度
  实际分/满分/百分比 + 总 Rating）、战斗信息（含双方战队 Rating、全场 MVP、双方队内最佳）、
  原始字段；**不含 Contribution / KAST / Impact**。
- League 批量工作簿：选手汇总、战队汇总、每场明细、战斗列表（含重复/冲突/校验失败）；
  不产生赛季排名或批次奖项。
- mode=each：只导出通过校验并完成评分的场次；冲突/不合格按失败策略跳过；混合模式与
  preview 一样整体拒绝。Preview 与 Excel 复用同一评分 core。

## PNG 导出

- League 模式 PNG 导出**完整超宽表格**（全部 Rating 维度 + 原始字段），不受当前 ColumnPicker
  可见列限制；导出 clone 中取消 sticky 定位（避免固定列覆盖其他列），`.tablewrap` 使用
  `max-content` 自然宽度；按真实 descendant 宽度测量，在 canvas 16384 限制内自动降 scale，
  不裁切右侧列、不压缩到视口宽度；深色/浅色主题均可读；战队名称覆盖随克隆 DOM 导出。
- 普通回放 PNG 行为保持现状。

## 前端集成

- 不新建页面/上传入口。当前 `ReplayPage` / `BattleTable`：概览卡下方、玩家表上方增加
  League Rating 概览（双方战队名称与 Rating、全场 MVP、双方队内最佳、占点实验性说明）。
- 玩家表固定「玩家」与「总 Rating」两列（sticky，左偏移响应真实列宽），其余列横向滚动；
  Team 1/Team 2 行底色不覆盖 sticky 单元格；MVP 徽标固定尺寸避免列宽跳动。
- League 默认可见列：玩家/战队/车辆/伤害/助攻/击杀/总 Rating；八个维度经 ColumnPicker
  显示/隐藏/重排；总 Rating 固定不可隐藏。列名与原始字段区分（「伤害」vs「伤害评分」）。
- 列偏好与普通模式独立 storage scope，互不污染；Reset 各自恢复默认。

## 测试

- core 单测：T/G 边界、八维度满分/零分、换血（零承伤/零输出/参与度限制/高助攻/高阻挡）、
  Wilson（0/0、1/1 不得满分、多次高效、高效率低参与）、存活状态、败方前四与第四名同分、
  胜方 ×1.05 与 1000 封顶、MVP/队内最佳/重复徽标、战队七人平均、占点 30/70、奇数/偶数中位数。
- 完整性：标准 7v7、13/15 人、非 7/7、重复账号、缺 tankId、roster 不完整、队伍冲突、
  未知胜方、平局、阵亡时间缺失、合法零值、protobuf 缺失字段不误拒、非法数值关系、
  arenaId 重复一致/冲突。
- 模式：单普通/单训练/单联赛/随机/游戏内评级、Training+Tournament 允许、Training+Random
  与 Tournament+评级 整体 400、preview/合并导出/每场导出规则一致。
- API 契约：普通模式响应兼容、League 含 typed 数据、League playerColumns/aggregateColumns
  不含 contribution/kast/impact、总 Rating 固定列元数据、八维度 max、failures/duplicates/conflicts。
- 前端：普通模式不显示 Rating UI、League 显示战队 Rating/MVP/新列、混合错误、固定列、
  ColumnPicker 控制维度、普通/League 偏好隔离、sticky 列、队名编辑即时更新、重复徽标、
  旧三指标不存在、批次只汇总不排名、手机/平板/桌面滚动无覆盖。
- 导出：普通 Excel 不回归、League Excel 含总分/八维度/MVP/战队分/队名覆盖、不含旧三指标、
  PNG 全列导出、sticky 不覆盖、超宽不裁切、深浅主题、canvas 限制安全缩放。

## Build-to-Learn（设计决策）

1. **为什么不用 Tankopedia HP 和历史均值**：HP 在回放中并非总能证明（`BattleHpFacts` 的
   fail-closed 已经证明这一点）；历史均值需要持久化且会跨场污染。本功能只依赖每场结算
   必然存在的数值字段，任何一场都能独立复算，结果可解释、可审计。
2. **本队指数与全场排名分别解决什么问题**：本队贡献指数把「在 7 人小队的相对输出」归一化，
   不受车辆/版本差异影响；全场排名指数给出 14 人内的相对位置。两者加权可以同时表达
   「对本队的价值」与「全场压过多少人」，且天然都是 [0,1] 可合成。
3. **为什么射击效率需要 Wilson 修正**：一发一中一穿在经典命中率口径下是 100%，
   会过度奖励小样本；Wilson 95% 下界让小样本置信度显著低于大样本，多次高效射击才接近满分。
4. **为什么承伤不能直接奖励**：承伤本身可能是错误走位的代价；本公式只把承伤作为
   「输出/(输出+承伤)」的分母（换血效率），并叠加参与度限制——少量输出零承伤不能拿满分，
   承伤不作为直接奖励或扣分。
5. **为什么占点字段不能推断终局比分**：`victoryPointsEarned/Seized` 是逐人结算统计，
   不包含实时点数广播/胜负阈值信息（protocol.md 证明实时点数走事件流 wrapper=13）；
   用结算值反推比分属于过度推断。本功能只把两个字段各自归一化后合成个人占点维度，
   并在 UI 同时显示原始字段与实验性说明。
6. **为什么 League 与普通回放必须使用模式化列契约**：普通模式保留 contribution/kast/impact
   与既有列；League 模式移除旧三指标并新增 Rating 维度列。若不模式化，两种模式会互相
   污染列配置（ColumnPicker 偏好、Excel 表头、PNG），且用户会把「伤害」与「伤害评分」混淆。
   模式化后：API 按模式返回列集合、前端按模式隔离 storage scope、导出按模式选择 writer。
7. **如何避免 preview / Excel / PNG 出现三套算法**：评分 core（`LeagueRatingCalculator`）
   是纯 Java 单点实现；preview 与 Excel 都由 `LeagueReplays.collect` 产出同一
   `LeagueRatingBatch`（Excel 从 ProcessedDataset 复用，不二次解析/不二次计算）；
   PNG 的数值直接来自 preview DTO 的同一 cells。任何公式改动只改 core 一处。
