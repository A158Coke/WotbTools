# 回放解析字段字典（已确认）

> 用途：记录本项目**已确认解析**的字段与含义，方便后人查阅，避免重复逆向。
> 解析实现细节见 `docs/reference/replay-data.md`（文件结构/事件流逆向）与 `docs/research/replay/protocol.md`；
> AI 证据链见 `docs/architecture/ai-review.md`。
> 字段号基于 v11.18.0_china_apple 回放分析，可能随游戏版本变化。

## 1. 权威结算层（`battle_results.dat` → `PlayerResult`）

来源：`ReplayParser` 解析 pickle → protobuf（`#301` 玩家战绩 → `#2` 单场明细），字段号来自 protobuf schema。

| 字段 | 类型 | protobuf 来源 | 含义 | 备注 |
|---|---|---|---|---|
| `accountId` | long | 名册 | 玩家账号 ID | 身份主键（>0 可用） |
| `nickname` | String | 名册 | 昵称 | 录像者按昵称匹配（无 accountId 兜底） |
| `clan` | String | 名册 | 军团标签 | 团队标签 dominant clan（如 CHRD） |
| `team` | int | 名册 | 原始队伍编号 1/2 | 只用于内部计算；prompt 禁止直出 |
| `tankId` | long | 名册 | 坦克 ID | tankopedia 单一数据源映射 |
| `nShots` / `nHitsDealt` / `nPenetrationsDealt` | int | 战绩 | 开炮/命中/击穿次数 | |
| `damageDealt` | int | 战绩 | 输出伤害 | 权威 |
| `damageAssisted` | int | 战绩 `#9 + #10` | 协助伤害 | 两字段求和 |
| `damageReceived` | int | 战绩 | 损失血量（结算字段曾名「承伤」） | prompt 统一称「损失血量」 |
| `damageBlocked` | int | 战绩 | 格挡伤害 | 越高越好，与损失血量严格区分 |
| `nHitsReceived` / `nPenetrationsReceived` | int | 战绩 | 被命中/被击穿次数 | |
| `nEnemiesDamaged` | int | 战绩 | 击伤敌数 | |
| `kills` | int | 战绩 | 击杀数 | |
| `victoryPointsEarned` | int | 战绩 `#32` | 占点得分 | supremacy 争霸赛逐人 |
| `victoryPointsSeized` | int | 战绩 `#33` | 占点占领分 | supremacy 争霸赛逐人 |
| `survived` | boolean | 战绩 | 是否存活 | |
| `deathTimeMillis` | long | 战绩 `#104` | 死亡时刻（毫秒，battle-relative） | 存活/未知=0 → 事件流估算 |
| `survivalTimeSec` | double | 派生 | 存活时间（秒） | ReplayParser 计算 |
| `xp` / `credits` | int | 战绩 | 经验/银币 | 展示用 |
| `tankName` / `tankTier` / `tankType` / `tankNation` / `alphaDamage` | String | tankopedia 映射 | 展示派生字段 | 非回放原始值 |

## 2. 战斗层（`Battle`，来源按字段区分）

| 字段 | 类型 | 含义 |
|---|---|---|
| `arenaId` | String | 地图/竞技场 ID（来源：`battle_results.dat`） |
| `winnerTeam` | Integer | 获胜队伍原始编号；null=平局/未知（来源：`battle_results.dat`） |
| `players` | List\<PlayerResult\> | 全部玩家战绩（来源：`battle_results.dat`） |
| `rosterComplete` | Boolean | 结算阵容完整性证据（<b>严格 fail-closed 全局契约</b>）：名册(#201)与战绩(#301)账号集合完全一致且名册队伍(#201→#2→#3)（存在时）与结算队伍一致时为 true；null=未知/不完整（来源：`ReplayParser`）。<b>不因 League Rating 弱化</b>：它是全歼 / SURVIVOR_SETTLEMENT / POINTS_INFERENCE / pointsEndReason 等「完整逐人结算」推断的 fail-closed 前提；#201 存在无法证明为 spectator 的 extra（如 #201=4/#301=3）时不得视为完整。League Rating 对 non-combatant extra 的宽容走 League 专属证据（见下两字段） |
| `settlementAccountsCoveredByRoster` | Boolean | League 专属结算覆盖证据（`ReplayParser` 设置）：战绩 #301 每个结算账号都出现在名册 #201 中（无幽灵结算）；null=无名册证据（非回放解析路径）。#201 可含 non-combatant extra（标准 7v7 且 #301 完整 14 人时 extra 不属于 14 名 settled combatants），extra 不影响本字段 |
| `settlementRosterTeamConsistent` | Boolean | League 专属队伍一致性证据（`ReplayParser` 设置）：名册 #201→#2→#3 提供的队伍字段（存在时）与结算队伍一致；null=无队伍证据 |
| `version` | String | 游戏版本（来源：`meta.json`） |
| `mapName` | String | 内部地图 code（如 `desert_train`；来源：`meta.json`） |
| `durationS` | Double | 战斗时长（秒，来源：`meta.json#battleDuration`，上限 420） |
| `startTime` | Long | 战斗开始时间戳（来源：`meta.json`） |
| `recorder` | String | 录像者昵称（meta 无 accountId，靠昵称匹配名册；来源：`meta.json#playerName`） |
| `recorderVehicle` | String | 录像者坦克（来源：`meta.json#playerVehicleName`） |
| `arenaBonusType` | Integer | 模式：1=随机战斗、2=训练房、3..10=联赛/锦标赛；null=未知（来源：`meta.json`） |
| `clientVersion` | String | 客户端版本（来源：`data.wotreplay` 事件流头部） |

## 3. 事件流层（`data.wotreplay` → `ReplayEvent` 子类）

所有事件共用：`sequence`（包序号）、`timestamp`、`packetType`、`DecodeConfidence`。
`ReplayTimestamp` 同时保存 `rawClockSec`（原始回放时钟，底层事实）与可空的 `battleClockSec`
（battle-relative，`rawClockSec - battleStartRawClockSec`；战斗开始事件无法可靠识别时为 null）。
派生证据优先使用可靠的 `battleClockSec`；原始 ReplayEvent 并不天然只有 battle-relative 时间，
战斗开始无法解析时 `tryRelative()` 返回 `UNRESOLVED_RAW_ONLY`（limitation=`UNRESOLVED_RAW_ONLY_EVENTS_IGNORED`），
这类事件被排除在所有需要 battle-relative 时间的派生计算之外；`rawClockSec` 仍保留，但不作为可用时间。

`DecodeConfidence` 四级：`EXACT`（所有已知字段精确解析）/ `INFERRED`（部分字段上下文推断）/ `PARTIAL`（仅部分成功）/ `UNKNOWN`（未解码）。

| 事件 | 已确认字段 | 含义 | AI 用途 |
|---|---|---|---|
| `ParticipantMappingEvent` | `entityId` ↔ `accountId` / `nickname` / `team` | 实体-玩家身份映射 | 视角解析、成员归属、录像者实体 |
| `PositionChangedEvent` | `entityId`, `x/y/z`, `positionErrorX/Y/Z`, `yaw/pitch/roll`, `errorFlag` | 位置更新 | 移动段、阵型簇、脱节/接应/图控、最后已知位置 |
| `DamageEvent` | `attackerEid`/`victimEid` (+`accountId`), `damage`, `lethal` | 单次伤害 | 交火段、集火候选、对炮明细、死亡估算 |
| `HealthChangedEvent` | `entityId`, `currentHealth`, `maxHealth`, `alive` | HP 变化 | HP 动量（只取两端共同可靠观察） |
| `VehicleDestroyedEvent` | `entityId`, `killerEid`, `inferred` | 车辆被击毁 | 死亡事件流估算 |
| `BattleEndedEvent` | `winnerTeam` | 战斗结束 | battle-end 兜底 |
| `EntityCreatedEvent` / `EntityRemovedEvent` | `entityId`（+未解析 `unknownInitData`） | 实体生命周期 | 覆盖统计 |
| `UnknownReplayEvent` | — | 未解码包 | 覆盖率（decodedRatio） |

> **观测伤害边界**：事件流迄今只逆向出 sub3 直接伤害子类型（type 5/31/35/39 等未解），
> 观测聚合 ≠ 权威结算时标记 `OBSERVED_DAMAGE_IS_PARTIAL`，prompt 层抑制观测数字。

## 4. 派生/证据字段（AI 复盘使用，由上面数据确定性计算）

| 字段/记录 | 计算规则 | 含义 |
|---|---|---|
| `MovementSegment` | 位置流压缩为移动段 | `type=MOVING/STATIONARY/UNKNOWN`、raw 起终点、distance（canonical 米）、avgSpeed |
| `TeamFormationPhase` / `TeamFormationCluster` | 15s 窗口；X/Z ≤100m 连通簇 | 质心（canonical 500×500）、region 1-9、离散度 |
| `TeamEngagementSummary` | 相邻可靠伤害 ≤10s 一段；同目标 ≤5s 内 ≥2 人命中=集火候选 | 交火段、集火、目标切换、结果 |
| `BattlePhaseSummary` | OPENING=45s / FIRST_CONTACT / MID_GAME / ENDGAME | 阶段 + 阶段末双方存活人数 |
| `DeathProximity` | 阵亡时刻与主力质心（其余 OBSERVED 本队均值）距离 | canonical 米 + 观测时间差 + 置信度；无 OBSERVED 不硬算 |
| `TeamAggregateResult` | `battle_results` 权威聚合 | 团队伤害/承伤/击杀/存活/死亡时刻 |
| `TeamObservedAggregate` | 事件流观测子集 | 非权威；覆盖不全时抑制数字 |
| `KeyBattleEvent` | 事件流/派生 | `TEAM_MEMBER_DESTROYED` / `TEAM_FIRST_CONTACT` / `TEAM_FORMATION_SPLIT` / `BATTLE_END` |

## 5. 口径约定（易错点）

- **录像者昵称**：`meta.json#playerName` 在部分版本中是「军团-昵称」拼接（如 `CHRD-A158布丁`），roster 的 nickname 是纯昵称。解析层 `ReplayParser.resolveRecorderNickname` 会先精确匹配 roster 昵称，再尝试「clan+分隔符+nickname」常见形式并唯一匹配时归一化为纯昵称；随机战斗复盘只使用玩家 nickname，不得把军团名当作玩家名。
- **死亡时刻**：`deathTimeMillis=0`（存活/未知）→ 回退事件流估算；prompt 用 `DEATH_SOURCE=权威结算/事件流估算/未知` 标注，禁止把估算当权威。
- **坐标**：优先使用每张地图 `map-semantics/*.semantic.json` 的 `playableBoundsMeters` 推导 `centerX/centerZ/halfExtent`，再映射到 500×500 canonical；只有语义缺失或边界无效时才回退中心原点、`halfExtent=250`。三态 `VALID/CLAMPED/INVALID`；九宫格 region 只描述方位，禁止用 region 差推断距离。
- **时间**：派生证据优先使用可靠的 battle-relative 时间（`battleClockSec`）；战斗开始无法解析时 `tryRelative()` 返回 `UNRESOLVED_RAW_ONLY`，事件以 `UNRESOLVED_RAW_ONLY_EVENTS_IGNORED` 标记并从派生计算中排除（`rawClockSec` 仍保留，但不作为可用时间）；准备阶段事件排除。
- **权威 vs 观测**：`battle_results` 是唯一可信口径；事件流数字只是观测子集。
- **录像者**：只用于确定视角（PLAYER_FOCUSED 的个人复盘 / TEAM_PERSPECTIVE 的视角队伍），不参与团队结论权重。

## 6. 相关文档

- `docs/reference/replay-data.md` — 文件结构、事件流格式、解析安全预算
- `docs/research/replay/protocol.md` — 逆向记录
- `docs/architecture/ai-review.md` — 架构与 AI 证据链
- `docs/features/team-ai-review.md` — Team-Level AI 复盘设计
