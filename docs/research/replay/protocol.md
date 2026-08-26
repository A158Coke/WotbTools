# WoT Blitz 回放包逆向笔记

> 样本：CHRD neptune 团队战（9034890693886323）、random-battle-example 夹具。
> 工具：`PacketReverseProbeTest`（手动探针，不进 CI）。

## CURRENT VERDICT

| type | 语义 | 状态 |
|---|---|---|
| 0 basePlayerCreate | 实体创建 + 竞技场 pickle（权威名册/队名） | PROVEN |
| 1/2 实体创建 | 录像者 avatar cell 等 | PARTIAL |
| 4 EntityLeave | 实体离开（i32） | PROVEN |
| 5 enterWorld | 实体进入世界 | UNKNOWN |
| 7 EntityProperty | 属性包；propId 2=炮塔相对偏航、3=当前血量 | PROVEN（propId 0/4/8/9 语义 UNKNOWN） |
| 8 EntityMethod | sub 47/48 updateArena（名册/点数/配置）、sub 8 伤害**通知**（attacker/victim 身份 PROVEN；damage 字段值语义未证明，见 TYPE8_SUBTYPE8_DAMAGE_FIELD） | PROVEN（值 UNKNOWN） |
| 10 Position | 49B 位置（含 space_id） | PROVEN |
| 11 空间信息 | 含 `spaces/neptune` 字符串 | PARTIAL |
| 13 赛后结算 dump | 与 `battle_results.dat` 字节级相同 | PROVEN |
| 14/29/36 | 低频结束/标记包 | UNKNOWN |
| 23 开火/炮弹事件 | 0=在飞、1=落地结算 | PROVEN |
| 26 敌方炮弹来袭 | 4B 恒 0 告警 | PROVEN |
| 28 4B 小包 | 本样本 0 个 | UNKNOWN |
| 31 散布衰减流 | 开火后瞄准圈衰减（τ≈0.83s） | PROVEN |
| 32 客户端事件 | double = 客户端运行时长（ms） | PARTIAL（事件语义待续） |
| 33 进入世界确认 | 12B 固定 | PROVEN |
| 35 tick 计数 | 单字节递增 ~10Hz | PROVEN |
| 39 相机/瞄准流 | 7 floats × 120Hz | PARTIAL（f0/f1 已定，f5/f6 待第三样本确认） |

> 状态词约定：PROVEN / PARTIAL / UNKNOWN / SUPERSEDED / DEPRECATED。历史实验按日期归档（见下文各「20xx-xx-xx」节），早期相反结论标 SUPERSEDED。

## TYPE8_SUBTYPE8_DAMAGE_FIELD（raw 值语义未证明 · 2026-08-21，WildCat 样本）

**结论**：Type-8 subtype-8 direct damage 通知的 attacker/victim **身份**可证明（与相邻 Type-7 propId=3 HP sample 的掉血窗口对齐验证），但其 `body[14..15]` 的 u16 raw **值不是权威伤害**——真实回放（20260817_2021 WildCat A178_SPHT，neptune，14 人）逐车交叉验证：**每个连续可信 HP sample 的掉血 delta 与附近 raw 值全部不符**（例：录像者 SPHT 掉血 377/368/333/316/368/408/358/419/242 vs 附近 raw 767/767/516/653/256/306/306/722/767；raw 求和 1418 ≠ 结算 dealt 1242）。

**规则**：
- **权威 HP 变化**只来自 Type-7 propId=3 signed i16 绝对当前 HP（EXACT，含装备加成，单调非增无治疗）：连续可信 sample 的 previousHp − currentHp = 该窗口 (prevT, curT] 内真实掉血。
- **attribution** 只信任窗口内全部 DAMAGE 通知同属一个攻击者（0 通知 / 混合攻击者 / 身份无法解析 → 不 attribution，受害者掉血事实保留）。
- Type-8 raw 值不再作为用户可见精确伤害；playback DTO 字段更名 rawProtocolValue（保留研究用），权威掉血经 observedHpLoss（单通知精确 attribution）与车辆级 hpLosses 暴露。
- 解码器：只要包头已确认是 damage-method 调用（payload ≥ 8 且 subtype == 8）就必须产出**带时间戳的冲突证据事件**（warning 只作诊断、绝不能是唯一输出——否则 PlaybackCombatReconstruction 只消费 canonical 事件流、看不到冲突证据，掉血/致死窗口会错误地「无冲突」，把窗口内另一条 direct DAMAGE 错判为攻击者/击杀者）：
  - direct 变体（body[13]==3 且 raw damage > 0）→ DamageEvent（EXACT；raw 数值不是权威伤害，见上）；
  - 结构不足（body < 18，如真实流 len=17 短体变体）→ UnsupportedDamageEvent（PARTIAL，SHORT_DAMAGE_VARIANT）：victim 用可靠 outer entityId（方法调用目标实体 = 受击者）、attacker 未知（0）、无伤害数字；
  - 结构足够（body.length ≥ 18）的非 direct 变体（body[13]≠3）→ UnsupportedDamageEvent（PARTIAL，DAMAGE_METHOD_VARIANT）：保留时间 + 攻击者/受击者 eid，不产生精确伤害数字；受击者 eid 缺失时用可靠 outer entityId 作 victim 证据；
  - direct 变体但 raw == 0 → UnsupportedDamageEvent（PARTIAL，ZERO_RAW_DAMAGE）：raw 数值不是权威 HP delta（见上），不得仅凭 raw=0 判定「无伤害」，身份可解析则填写、victim 缺失回退 outer entityId；
  - 以上 unsupported 证据均使对应 HP-loss attribution 与 killer attribution 都 fail-closed（掉血事实保留、attacker=null、attackerReliable=false、observedHpLoss=null、致死窗口 killer=null；victim 仍无法解析的证据不得静默视为「无冲突」）；身份字段只填确实能够解析的部分、confidence 恒 PARTIAL（不得标 EXACT/PROVEN），绝不进入生产伤害统计；
  - 真正截断（payload < 8，无法确认 damage method）→ MALFORMED + TRUNCATED_PAYLOAD，不产出事件。

**证据**：BattlePlaybackHpDamageProbeTest（非 CI 手动探针，-Dprobe.replay=<file>）输出逐车 hpSamples / hpLosses / DAMAGE raw / DESTROYED / KILL；PlaybackCombatReconstructionTest 覆盖 attribution 边界（单攻击者/混合/无通知/窗口左右开闭/击毁击杀推导）。

## 包格式

`data.wotreplay`：magic(4) + 未知(8) + clientHash(1+len) + clientVersion(1+len) + 1B，随后 N 个事件包：
`payload_len(u32) + type(u32) + clock(f32) + payload`。类型与含义见下。

## 已解码 / 已破解

| type | 含义 | 结构 / 备注 |
|------|------|-------------|
| 0 | basePlayerCreate | 实体创建 + **Python pickle 竞技场信息 dict**：`accountDatabaseIds`（全员账号）、`clanTags`、`teamTitles`、`wins`、`battleLevel`、`mmType` 等（已用受限 Unpickler 完整还原） |
| 1/2 | 实体创建（录像者 avatar cell 等） | type 1 含昵称 + 竞技场 pickle；结构待全解 |
| 4 | EntityLeave | entity_id(i32)（已消费） |
| 5 | 实体 enterWorld | eid + 数据块，部分含昵称；未解 |
| 7 | **属性包** | `(eid u32, propId u32, valueLen u32, value 1-4B)`；本方移动后 ~10Hz；propId 0=标志、**2=炮塔相对车体偏航（2026-08-13 已破解）**、3=当前血量（**signed i16**，见 PROP3_HP_SENTINELS）、4=高频状态位掩码（非双态）、8=标志；**HP 未出现在已见 propId** |
| 8 | EntityMethod | subtype 47/48 updateArena protobuf（名册/账号映射）、8 伤害（已消费）；**subtype 48 双层字段：wrapperFieldNumber=13 → root field12=实时争霸点数、wrapperFieldNumber=18 → root field17=赛前配置（见 REALTIME_SUPREMACY_POINTS / SUPREMACY_CONFIG）；两层字段号绝不可混用**；玩家 protobuf 字段 1-24 已全量列出，field 18=float 1.0（疑初始满血比例） |
| 10 | Position | 49B BigWorld 格式（已消费） |
| 11 | 空间信息 | 含字符串 `spaces/neptune` 等 |
| 13 | **赛后结算 dump（= zip 内 battle_results.dat，字节级相同）** | 容器已全解：28B 头 + zlib(偏移 22) → pickle 协议2(arenaId, 53188B protobuf)；protobuf：f2=开战 unix 时间戳(1784988019)、f8=录像者个人统计块(f101=账号/f102=队伍/f103=车型/f25=eid)、f150=逐队统计曲线(f21/f23=打包字段101+逐玩家帧，4B 头；f24=国家/账号维度，含 usa/japan/uk)、f184=锦标赛统计 key、f186=战队标签、f201=14 玩家身份(f1=账号，内层 f1=昵称/f5=战队/f7=头像URL)、f301=逐实体统计(f1=eid，内层 f101=账号/f102=队伍/f103=车型/f25=eid/f107=float 疑个人评分)；**昵称/战队/头像/车型权威来源** |
| 14/29/36 | 低频结束/标记包 | 未深解 |
| 23 | **录像者开火/炮弹事件开关（4B）** | 0=开火/炮弹在飞，1=落地结算；团队 22 次、随机 78 次；每次 0→1 后 0.5–2.8s 内伴随录像者为攻击者的伤害事件（7/11 命中，4 次打飞/跳弹）；与 type 31 重置一一对应 |
| 26 | **敌方炮弹来袭事件（4B，恒 0）** | 8 组中 7 组在录像者受击前 0.2–3.0s 出现（1 组无伤=打偏）；与敌方对录像者的伤害（victim=录像者账号）一一对应 |
| 28 | 4B 小包 | 本样本 0 个 |
| 31 | **开火后散布/瞄准圈衰减流（~30Hz 单 float）** | 每次录像者开火（type 23=0）瞬间重置到 ~54，随后**指数衰减（τ≈0.83s）**到该炮的收敛平台值（团队 SPHT ≈27、随机 ≈7）；战斗全程仅存在于录像者存活窗口；已排除车速/HP%/到车辆距离 |
| 32 | 11-27B | 422 个；结构= `eid u32 + 0x1000 + 00a880 + b + b + double + tail`；**double = 客户端运行时长（ms）**（= 战斗时间 + 客户端启动偏移；团队样本偏移 60426.8s、随机 77973.2s，证明非战斗纪元）；疑客户端事件（常与 type-8 事件同刻） |
| 33 | **实体进入世界确认（12B 固定）** | 134 个；= `eid u32 + 8B 零`；0.2s 起（车辆/空间实体）；与 type 5 数量相同但时间不对齐（1/134 匹配），非配对 |
| 35 | **单字节递增 tick 计数** | ~10Hz，两种模式一致，疑全局心跳/帧计数 |
| 39 | **录像者相机/瞄准状态流 120Hz × 7 floats（28B 恒定）** | 中位间隔 8.3ms（99.5% 一致）；**录像者阵亡时刻整体冻结**（团队 115.095s、随机 300.2s）；**字段映射：f0=相机 yaw（度，0-360，与战车 yaw 偏差 61%<30°=自由视角）、f1=相机 pitch（度，-30..33）、f2/f3/f4=相机位置（x,y,z，62% 样本距战车 <30m）、f3=FOV/缩放档（团队 20/24/35-41、随机 52-62）、f5/f6=有界角（弧度，疑炮/瞄准方向）**；已排除：任何车辆位置、瞄准射线几何；阵亡后 f0/f1 持续跳变=死亡观战镜头旋转 |

## REALTIME_SUPREMACY_POINTS（实时争霸点数 · PROVEN）

**结论**：`data.wotreplay` Type 8（EntityMethod）→ subtype 48（updateArena2）→ **wrapperFieldNumber=13** → root **field 12** 携带双方**实时争霸点数**广播（重复 protobuf 消息，每条直接携带 field1=team、field2=当前点数）。**门禁：wrapperFieldNumber 必须 == 13 且 root field 12 存在**（wrapper=1 名册/18 配置包即使携带相同 root 结构也绝不产出点数事件）。只消费回放真实广播，绝对禁止按游戏规则（时间/基地数/固定 +3/+5/击杀数）自行模拟比分。

```
Type8
└── subtype48
    ├── wrapperFieldNumber = 13（门禁；13=实时点数 / 1=名册 / 18=赛前配置）
    └── root field12（重复 protobuf 消息）
        ├── field1 = team（已验证 1/2）
        └── field2 = currentPoints（当前实时点数）
```

**证据**（5 个真实回放，field12 点数事件 185/161/69/204/201 = 共 820，protobuf 结构 820/820 一致；与项目内探针 `PointsEvidenceProbeTest` 逐样本复核一致）：
- 客户端：11.18.0_china_apple + 11.19.0_china_apple
- 地图：neptune / malinovka / holland；arenaBonusType 2 / 4；training + tournament
- 最终领先方与 battle_results winnerTeam **5/5 一致**
- 示例（1555 样本）：56.233s team1=303、58.234s team1=306；击毁 ±40 点（78.534s team1 345→305 / team2 321→361；130.322s 反向）；最终 797:232

**解码器**：`EntityMethodDecoder.parseSupremacyPoints`（生产门禁 wrapperFieldNumber==13 且 root field12 存在，保守结构校验；team∈{1,2}、points∈[0,100000] 才 EXACT，结构不合法/数值非法跳过；`readWrapperFieldNumber` 供探针复用同一提取路径）。前端 `teamPointsAt` 取最近一次 ≤ currentTime 的广播值，拖动时间轴时点数实时变化；非争霸赛/无广播不显示，battle_results 结算值不得冒充实时比分。

**跨版本字段稳定性**：暂记 **PARTIAL**（11.18/11.19 已验证，未来客户端版本不假设永久不变）。

## SUPREMACY_CONFIG（赛前配置 · PROVEN for tested samples）

**结论**：同一 subtype48 以 **wrapperFieldNumber=18** 携带争霸赛赛前配置（用户描述「field 18」即此 wrapper 层；实测其 root 为 **field 17**，两层字段号不冲突）——wrapper=18 → root field17：
- root field17 消息：field5="tournament" 或 "training"、field9=1、field10=300、field11=1000、field12=1
- **field10 = 初始点数 300、field11 = 胜利阈值 1000**（5/5 样本一致；11.18 + 11.19）

**状态**：PROVEN for tested 11.18–11.19 samples；生产代码若使用需结构化解码 + 版本/结构校验，结构不符合时安全降级，**不得把 300/1000 重新硬编码成游戏规则**。

## PROP3_HP_SENTINELS（propId=3 血量 sentinel · PROVEN）

**结论**：type-7 propId=3 的 u16 值按 **signed i16** 解释：
- **正数**：当前真实 HP（含装备/物资加成；阵亡到 0、存活不到 0）——注意这只是该时刻的当前 HP，不等于初始满血：真实样本 probe（wotb-web `EntryHpProbeTest`）显示首个样本多与首次受击同刻且低于 tankopedia base，进场满血只能由「严格早于首次受击且 ≥ base 的样本」证明（`EntryHpSource.OBSERVED_EXACT`），否则只能 base baseline
- **0xFFFD（signed -3）**：与车辆死亡强关联的 sentinel——11/11 与争霸击毁 ±40 点**精确同刻**；不得解析为 HP=65533；解码器归一化为死亡 HP=0（alive=false）
- **0xFFFF（signed -1）**：UNKNOWN/不可用/未初始化 sentinel（1535 样本 11.102s 出现，时刻无 ±40 kill points、无死亡证据）；不得当 HP、不得直接变成死亡 0
- **其它 ≤0 高位值**：UNKNOWN sentinel，不臆测语义

**落点**：`EntityPropertyDecoder`（signed 解码 + sentinel 归一化）、`HealthChangedEvent.isPlausibleHp`（>0 且 <0xFF00）、`ObservedMaxHp` / `MapOverviewBuilder.hpSamplesByAccount`（sentinel 永不进入 maxHp/hpSamples）。

**遗留**：需扫描全部真实 fixtures/replays 的 propId3 高位值，确认是否还有 FFFC/FFFE 等其它负值 sentinel。

## SPECTATOR / NON-COMBATANT ENTITY（观战/非参战实体 · 2026-08-19 验证）

**结论**：`battle_results` 名册 #201、`updateArena2`（type-8 sub48 wrapper=1 roster）与事件流
都可能包含<b>不属于 #301（actual combatant 战绩集合）</b>的人员/实体。
tactical analysis 的 actual combatant source 一律以 <b>battle_results #301</b> 为准；
non-#301 实体不得计入 team formation / position coverage / combatant mapping limitation。

- **#201 可含非 #301 账号**：11.18 团队样本（20260725_1535，malinovka）名册 #201=15 人、#301=14 人，
  多出的账号 3117047709（昵称 结城凛音，team=2）不在战绩 #301 中。
- **观战实体在事件流中带完整位置**：该观战账号经 updateArena2 映射到 eid=12183248，
  拥有 1611 个 usable position（battle-relative 0.0s→203.2s，覆盖整场，无 EntityLeave）。
  <b>未观察到 11.18 样本中「battle start 即 leave」</b>；用户提供的 11.19 样本描述观战人员
  在战斗开始时离开/消失——两种生命周期都不改变「non-#301 ≠ actual combatant」的判定。
- **TeamEntityMapper 拒绝观战实体**：账号不在 #301 → reconstruction roster（context 仅含 #301）
  无该账号 → `isVehicleParticipant` 失败 → identity 不可用（identity=null）。
- **历史污染**：这些 non-#301 实体的位置此前全部计入 `UNATTRIBUTED_POSITION_EVENTS_PRESENT`
  （6/6 真实样本 100% 由 non-#301 实体触发；观战镜头实体如 13185652、场景静态物
  12558633/34/49/59/60/78 等也有独立位置流）。PR #103 起按 #301 成员资格重分类：
  仅「#301 成员实体无法归因」进入该 limitation；non-#301 实体仅记 internal diagnostic
  `NON_COMBATANT_POSITION_ENTITY_IGNORED`（不进 AI prompt）。

**判定标准**（production contract）：

```text
出现在 #201 / updateArena2 / event stream  !=  actual combatant
ActualCombatantSet  ==  battle_results #301
spectator != missing team member
no PositionChanged != missing position（静止同坐标 gap 已证实，见下节）
```

**结算阵容完整性证据分层（2026-08-24 probe 验证）**：全局 Battle.rosterComplete 保持
严格 fail-closed 契约（#201 全集合 == #301 全集合 + 队伍一致）——它是 SURVIVOR_SETTLEMENT /
annihilationSuffix / pointsEndReason 等「完整逐人结算」推断的前提，名册 #201 存在无法证明为
spectator 的 extra（如 #201=4 / #301=3）时不得视为完整。League Rating 对 non-combatant extra
的宽容走 League 专属证据（Battle.settlementAccountsCoveredByRoster = #301 每个结算账号都在
名册中；Battle.settlementRosterTeamConsistent = 名册队伍与结算队伍一致，由 LeagueRatingValidator
判断），不扩大全局 rosterComplete 语义。

证据边界：全样本 probe 仅观察到 6/6 真实样本中 5 份 #201=#301=Type0=14（random×1、tournament×4、
11.19 Maus），1 份训练房（20260725_1535，#201=15/Type0=15、#301=14，extra 账号 3117047709 无
#301 settlement）。不把「任何 #201 extra 都是观战者」表述为 universal rule——现有证据只
支持：标准 7v7 且 #301 已完整 14 人时，该 extra 不属于 14 名 settled combatants。League Rating
准入仅要求「结算者全部有名册身份 + 队伍一致」，extra 不导致 ROSTER_INCOMPLETE；其余场景
（非标准人数 / #301 不完整）由 Validator 其他门槛与全局严格契约 fail-closed。

**PositionChanged 是 change/state-driven（2026-08-19 验证）**：
- 存活己方静止车辆可长时间无新位置包：11.18 Maus 样本（20260808_1608，holland）
  7/7 己方成员开局 `gap=10.8s [0.0s→10.8s]` 同坐标（dist=0.0m）且无 EntityLeave，
  其中 4 人整场存活——「>5s 无 PositionChanged」≠ 位置丢失/失效。
- 阵亡后服务器仍广播死车位置（同坐标），产生 30s/44.5s 级同坐标 gap（random/1600 样本）。
- 因此己方（actual combatant）位置语义 = last position + 无 EntityLeave + 未 destroyed
  → carry-forward 当前位置；敌方保持 UNKNOWN/LAST_KNOWN（anti-future-leak）。
- **证据层知识契约（2026-08 第六轮）**：FormationDepthEvidence / RelativeDepthHpEvidence 的阶段位置参考
  带 knowledge provenance（CURRENT / LAST_KNOWN，复用 canonical PositionKnowledge）——friendly
  carry-forward → CURRENT；enemy 最后观测 age ≤ canonical 当前阈值（5s）→ CURRENT，否则 LAST_KNOWN；
  exact 阵型/覆盖/距离数学只消费 CURRENT，enemy LAST_KNOWN 不得满足 current completeness / 作为当前
  centroid / 坐标 / 生成 exact 距离（fail-closed）；LAST_KNOWN 只作为独立信息段
  （ENEMY_LAST_KNOWN_POSITION_REFERENCES：account + region + observedAtSec + ageSec + knowledge）输出。
  Region presence 基于 resolved 车辆位置 state（每辆 CURRENT 车辆 +1，不是位置包数量）。
- **Canonical BattleTimeline ActualCombatantEntitySet（2026-08 第七轮）**：timeline 的 tactical
  FrameVehicle universe 在 BattleTimelineBuilder 源头按 #301 过滤——只允许可靠映射到 battle.players
  （#301 actual combatant，accountId > 0）账号的实体进入帧；non-#301 spectator/camera/observer/静态实体
  即使被 broad roster / ParticipantMapping 赋予完整身份（accountId/team/nickname/坦克元数据）也不进入，
  因此不产生 FIRST_KNOWN/ENEMY_LOST/ENEMY_REACQUIRED/POSITION_CHANGE/REGION_CHANGE/DESTROYED 等
  tactical delta（spectator ≠ combatant；#301 是权威边界）。WorldSummary 以 #301 roster 为战术名单；
  raw timeline.events 保留原始事件供协议用途。

## DEATH_TIME_PRECEDENCE（死亡时刻优先级链 · 2026-08 落地）

**结论**：玩家死亡时刻（`PlayerResultFormat#deathSec`，供 playback 死亡 ✕ 与 AI/阶段消费）只信
可归属到同一实体/账号的可靠死亡证据，优先级：

```
1. battle_results 结算 deathTimeMillis（proto #104，游戏权威；>0 时直接采用，不校准）
2. 重建事件流 EXACT alive=false（type-7 propId=3 HP=0 / 0xFFFD 死亡 sentinel，同实体→账号映射，
   取该账号全部实体最后一条 = 最终阵亡；覆盖争霸/复生多次死亡）
3. legacy 启发式估算（damage-threshold / EntityLeave / Position 停止）——仅兜底，且须通过一致性检查：
   legacy 死亡时刻不得早于该账号最后一条 EXACT alive=true（HP>0）；若被证伪 → UNKNOWN
   （survivalTimeSec=0，既有 unknown contract：playback deathSec=null、AI 显示「未知」），
   绝不保留被证伪的值、也不伪造新时刻
```

**落地**：`DeathTimeReconciler`（`DefaultReplayProcessingFacade` 重建成功后对
`deathTimeMillis==0` 且非存活的玩家校准 `survivalTimeSec`）。**身份只复用**
`TeamEntityMapper` 产出的权威 `TeamEntityMapping`：冲突实体（同一 entity 归属多账号 → 整体排除）
与低置信映射（PARTIAL/UNKNOWN → 不可用）的证据一律拒绝；nickname fallback（accountId=0 + 唯一昵称
→ 权威账号）直接复用——死亡校准的身份可信度与 playback 其它功能一致。damage-threshold 启发式只看
累计伤害是否越过结算承伤阈值、无视同实体 EXACT HP 观测，会因 overcount/装备 HP 差提前越阈把
「残血仍存活」误判为「已阵亡」（真实样本：IS-4 96.9s 被判死、实际 HP=102 alive、128.12s 才 HP=0）。
位置/方向/伤害事件不参与推断（阵亡后服务器仍广播死车位置）。

**覆盖范围**：校准只发生在重建路径（`ReplayProcessingOptions.full()`，即 playback 与 AI 复盘）；
`summaryOnly()` 预览/导出路径不跑重建（无事件源），其死亡时刻保留 legacy 估算——文档与产品侧
描述不得夸大「导出全局一致」。

## 关键结论

- 两种战斗模式（7v7 团队 / 30 人随机）类型集一致，频率也一致 → type 31/35/39 是**全局/录像者流**，不是按实体广播。
- **位置覆盖（2026-08-11 修正 team 标签后）**：本方（录像者队伍，本样本 CHRD=team 2）7 车全部从 1.1s 有 type-10 位置；**敌方（BSK-T=team 1）开局 0~30-50s 无位置包**（各车首包 30.5~51.9s≈首次移动时刻）。此前「本方开局缺失」是把 team 1/2 弄反——正确结论：**本方位置开局完整；敌方静止时不上报 type-10 位置**（移动/交火后才出现）。回放为服务器下发完整实体流（与点亮无关）。
- type 0 pickle 的 `accountDatabaseIds` / `clanTags` / `teamTitles` 可作**权威名册与队名来源**（优于 updateArena2 映射）；已落地：`PickleDecoder`（协议 2 精简解码器）+ `EventStreamReader.extractArenaInfo` + 真实载荷单测。
- HP 仍未定位；候选：type 39 某 float、type 8 field 18（初始满血比例）、type 13 玩家统计块、battle_results。

## 2026-08-12 进展

- **type 31 窗口 = 录像者存活期**：团队样本 type 31 在 115.0s 戛然而止，与录像者（CHRD-A158布丁 SPHT）阵亡时刻吻合；type-10 位置在其后仍持续到 146.9s 但完全静止（死车位置广播），佐证了 AI 复盘「布丁 115s 阵亡」的时间线；随机样本 type 31 窗口 50.7–296.8s 同样止于录像者存活末期（其语义见下条：开火散布流，阵亡即停）。
- **type 23 = 录像者开火事件（已破解）**：0=开火在飞、1=落地结算；与录像者为攻击者的伤害事件一一对应（团队 22/随机 78 次，7/11 命中）。**type 31 在每次开火瞬间重置到 ~54，指数衰减（τ≈0.83s）至该炮收敛平台（团队 SPHT≈27、随机≈7）——即开火后散布/瞄准圈状态**。两流共同定义了录像者的射击时间线与散布演化。
- **type 26 = 敌方炮弹来袭事件（已破解）**：4B 恒 0；8 组中 7 组在录像者受击前 0.2–3.0s 出现、1 组无伤（打偏），与敌方→录像者伤害一一对应；可与 type 23 一起重建双方开火时间线。
- **type 33 = 实体进入世界确认**：134 个 `eid + 8B零`，0.2s 起，与 type 5 同数量（疑配对）。
- **type 32 历史全局 runtime-double 解释已 SUPERSEDED**：完整 34-arena strict corpus 证明结构为 `entityId:u32 + flag:u8 + bodyLength:u32 + body`，且 `bodyLength == remaining bytes` 为 16,850/16,850、零反例。旧探针固定偏移读取的所谓 `double` 跨越不同长度的 variable body，不构成字段。Type32 同时覆盖 Type5 mobile 与 static entity family。进一步按 class/flag/length 分流后，mobile `flag=0` 的 15/16B body 倒数第 8 字节处存在真实 `float32` 缩放时钟：2,892 个非零样本在 34/34 replay 内满足 `value*65536-rawClock≈常量`，场内最大 spread 0.331s；准确 epoch/source 仍 PARTIAL，其余 body 语义待续。
- **type 13 = battle_results.dat（已全解）**：回放 zip 内 `battle_results.dat` 与 type 13 载荷**字节级相同**（pickle→同一 53188B protobuf）；`meta.json` 提供权威键：`dbid`=录像者账号、`playerVehicleName`=A178_SPHT、`vehicleCompDescriptor`=29985、`mapId`=42、`arenaBonusType`=4、`battleDuration`=145.16s。type 13 的 f201=昵称/战队/头像、f301=逐实体账号/队伍/车型、f8=录像者统计块——是**赛后名册与战绩的权威来源**（优于 type-0 pickle 与 updateArena2）。车型号示例：29985=SPHT、6225=FV215b、7297=60TP。统计字段与事件流伤害暂未直接对应（f31 仅 165/633 两值、f106 与车型相关但非血量/承伤），待后续用第二场结算交叉验证。
- **type 39 = 录像者相机/瞄准状态流**：7 floats × 120Hz（恰为客户端渲染 tick），阵亡即整体冻结（后 5 元组精确冻结、f0/f1 仍跳变），两种模式结构一致；f3 离散档位疑 FOV（两样本玩家设置不同）；f2/f3/f4 慢移贴车（团队 62% <30m）；f0/f1 大值跳变疑瞄准点/视角（阵亡后观战仍动）。已排除车辆位置与简单瞄准射线模型。
- **type 39 字段映射收口（2026-08-12 晚）**：f0 与录像者战车 type-10 yaw 偏差 61%<30°、79%<60°（mean 38°，自由视角所致）→ **f0=相机 yaw（度）**；f1 范围 -30..33 度 → 相机 pitch；f2/f3/f4 贴车 → 相机位置；f5/f6 有界弧度角 → 疑炮/瞄准方向。阵亡后 f0/f1 持续旋转（死亡观战镜头），f2-f6 冻结于死车上方约 7m。两样本（团队/随机）结构一致，字段语义需第三样本或录屏最终确认。
- **观战镜头实体 13185652 发现**：拥有独立 type-10 流（~10Hz、0.2s–146.9s），开局 0.2–1.1s 在录像者出生点，随后静止于 (0,0,0)（yaw=-178.5°），**录像者阵亡后位置在队友间瞬移**（119.1/120.9/126.3/133.3/134.1/134.5/135.5/144.4s 各一次，均为单包位置 + 方位角跳变），即观战镜头切换痕迹。
- **神秘实体 12558633/12558634/12558649 排除**：出现后完全静止（团队样本），为场景静态物体（建筑/可破坏物），非炮弹。
- **type 7 propId=2 与炮塔朝向**：对照 eid=12558550 的 622 个 propId=2 样本与 type-10 pitch，误差分布不支持车体 pitch，炮塔朝向假设仍待炮塔数据源。

## 2026-08-13 进展（PR #71 战局回放门禁 A/B 探针，5 样本：fixture + target/probe p1–p4）

- **门禁 A（敌方可见性）VERDICT: PARTIAL**：不存在可直接证明「录像者客户端当前点亮」的标志位——
  type 4/5/33 = 服务器实体流生命周期（敌方首 enterWorld≈首 type-10≈首移动；leave≠阵亡；enter/leave 与录像者交火相关率 0–8%；距离无固定半径 42–451m）；
  type 7 propId=4/0 = 高频状态位掩码（每车 24–471 次翻转、值含 2^k 位、0.1–0.5s 间隔，与位置流出现不同步），**非双态可见性**；
  type 8 sub=0/1 = 伤害/命中通知（sub=0 挂受击方、sub=1 挂攻击方且 args 含对方 eid）；type 10 gap≤5s 聚类会误发 2–9 个 LOST/场（静止/死车/断包全部误报）。
  可靠锚点仅两类交火证据：录像者命中敌 X（5 样本 35 次、83% 相机 yaw 指向目标）、敌命中录像者（type 26 + 伤害归因）——覆盖稀疏、不能闭环「从未/当前/失去/重观察」状态机。
  详见 `docs/research/replay/visibility.md`（探针 `VisibilitySignalProbeTest`，S1–S11 量化）。
- **门禁 B（炮塔相对方向）——历史中间结论（已 SUPERSEDED）**：受控旋转实验之前曾判 NOT_PROVEN——
  type-7 propId=2 是双方 7/7 全覆盖的独立平滑量（静止车体下变化、角速度 17.5°/s、与 hull yaw 不锁定），但开火时刻
  三种**恒等**假设（prop2 / yaw+prop2 / yaw−prop2，无偏移）误差 47.9–111.6° 全部失败，且当时值域仅 ≈126–247°、
  与 type-39 f5/f6 非同源。**该结论被 2026-08-13 受控训练房实验推翻**：车体静止、炮塔顺时针转一圈的
  `common/data/test/test.wotbreplay`（gitignored research sample，未入库）证明 prop2 完整扫 360° 并在 0° 干净 wrap，
  历史「恒等失败」缺的是 −180° 零点偏移；加入偏移后（b=−180°）41 个开火锚点拟合残差 9.5°、34 个独立受击集
  交叉验证残差 2.3°。**权威最终结论：prop2 = 炮塔相对车体偏航，`u16*360/65536−180` 度，VERDICT = PROVEN**（已落地生产）。
  **hull yaw PROVEN 可用**：type-10 yaw 全部 finite、相邻步长 3.9–9.6°、静止恒定、倒车案例 113/1190（录像者）→ 车头朝向权威源（弧度）。
  详见 `docs/research/replay/turret-direction.md`（权威最终状态在文首与「受控实验定案」节）。
- 需要用户补充：① 录像者客户端录屏逐秒标注点亮/失察（≥2 场：随机+supremacy）；② 训练房回放 + 炮塔匀速转动录屏校准 prop2；③ 对方视角回放区分团队/个人点亮。
- **多样本复跑（2026-08-13，common/data 扩充）**：6 个 11.18.0 样本（随机/训练/supremacy）+ 9 个 9.4.0–10.1.0 旧版样本。
  - 编码稳定性：type-7 propId=2 恒为 valueLen=2，自 9.4.0（2022）到 11.18.0（2026）不变，满编战斗双方 7/7 覆盖。
  - 开火指向 4 样本 30 次命中：三种**恒等**假设（prop2 / yaw+prop2 / yaw−prop2，无偏移）误差均值 47.9–111.6° 全部失败——
    该历史否定已被受控实验 + 偏移定标（b=−180°）SUPERSEDED，最终结论 PROVEN（见上一段）。
  - gap 聚类伪 LOST 多模式坐实（每场 2–9 个误报）；敌方首包与首次交火无关（全部 engBeforePos=false）。
  - 旧版样本 eid→账号映射为空（updateArena 格式差异），暂不参与可见性/方向判定。

## 已知修正记录

- 2026-08-11：team 标签曾误判（以 AI 复盘中的「CHRD=A 队」为前提），经 type-0 pickle（`teamTitles{2:'chrd'}`）+ updateArena2 field 4 验证后修正：CHRD=team 2=录像者队伍；位置覆盖结论随之反转（本方完整、敌方开局缺失）。附带发现：pickle `wins{1:1,2:0}` 显示本样本胜方为 team 1（BSK-T），与早前「CHRD 7-3 获胜」的说法冲突，待用 battle_results 核验。

## 外部对照（社区先例）

- `eigenein/wotbreplay-parser`（Rust，v0.4.2）为 Blitz 回放公开实现：仅解 **type 0（BasePlayerCreate）与 type 8（EntityMethod）**，其余全部 `Unknown`；type 0 用 `serde_pickle` 解 arguments（与我们的 PickleDecoder 思路一致），字段 schema 与我们解出的 dict 吻合且我们的字段更全（clanTags/teamTitles/wins/webEmitterID 等社区未覆盖）。
- 结论：type 7/31/35/39 在全球公开资料中均未破解，本分支的成果（type 7 结构 + propId 部分语义、type 23/26/31 射击与散布时间线、type 35 tick、type 13 容器、type 39 相机流与排除性结论）为新增贡献。

## INITIAL_HP_PROBE（开局/最大 HP 调查 · 2026-08-21，PR #107 附加任务，7 样本 + WildCat）

**结论：进场 max HP 无法从现有协议可靠证明（NOT_PROVEN）**——但已排除一批候选并确立安全 UX 语义。
探针：`InitialHpProtocolProbeTest`（非 CI 手动探针，覆盖 common/data 全部 6 样本 + fixtures 夹具，无样本自动跳过）。

| 候选来源 | 证据 | 分级 |
|---|---|---|
| Type-7 propId=3（当前 HP）开局满血广播 | 全部 7 样本首个 positive sample 与首次受击同刻或更晚（11.1s~93.1s），无一在开战广播初始满血 | REJECTED（作为开局满血来源） |
| Type-7 propId=4（len=2） | 值域 0/1/258/259/514/515/1026/1027/...（256×n+(0|1) 模式）——高字节步进+低位标志，非连续 HP | REJECTED |
| Type-7 propId=0（len=1） | 值域 {0,1} 布尔 | REJECTED |
| Type-7 propId=9（len=1..4） | 值域 ~1e9（float 类），非 HP | REJECTED |
| Type 0/1/2 EntityCreate | 全样本仅 1-2 个 create 包且未映射玩家（系统/相机实体），不覆盖车辆 | REJECTED |
| Type 5 / Type 33 | type33=12B（eid+8B零）；type5 无 payload；均不含 HP | REJECTED |
| Type-8 subtype48 wrapper=18（赛前配置） | 每样本仅 1 次；root field17=初始点数/胜利阈值（PROVEN）；**无 HP 字段证据** | CANDIDATE（待深挖） |
| battle_results root field150 | 逐队统计（f21/f23 打包曲线）；含 f1=tankId 等，**无明确 max HP 字段** | CANDIDATE |
| battle_results root field184/185/186 | 锦标赛/战队统计 | REJECTED |

**循环门禁确认（任务 C）**：真实回放中所有受击车辆 `observedReceived < damageReceived`
（差 446~675，如 SPHT 结算 3536 vs 观测 3067）→ `coverageExact=false` → `entryHpSource`
恒为 BASE_FALLBACK → 前端旧逻辑显示 UNKNOWN/黑条。根因：首个 prop3 sample 缺失 →
首个 HP loss 无法推导 → 事件流 received 恒小于结算 → 覆盖永不完全。**这是真实数据限制，
不是门禁 bug**；不得放宽真实性门禁，由前端「相对满血状态」解决 UX（见 docs/features/battle-playback.md）。

**HP provenance 语义（前端，docs/current-plan.md §4 扩展 + PR #107 Blocker 3 收口）**：
- `OBSERVED_EXACT`：进场满血已证明（entryHpSource=OBSERVED_EXACT）→ 精确 current/entryHp/pct
  （pct = current/entryHp；只有实际进场 max 已被可靠证明时才允许计算真实 HP 百分比）；
- `CURRENT_HP_EXACT_MAX_UNKNOWN`：有真实 Type-7 current 采样但进场 max 未证明 →
  **current 精确、maxHp=null、pct=null**——绝不使用 tankopedia base 或观测容量计算百分比
  （baseHp/observedCapacityHp 只是 metadata）；前端渲染阵营色 indeterminate 斜纹
  （「当前 HP 已观测，进场最大 HP 未知」），不渲染黑条；
- `RULE_DERIVED_FULL_AT_SPAWN`：仅本方存活 + 无采样 + 无战前掉血证据 → 开局相对满血
  （marker 100% 阵营色完整血条无条纹，Details Panel 显示「100%」——100% 是相对 UI 状态、
  不是具体 HP、也不证明 actual max HP；tankopedia base 永不冒充 max/current）；
- `UNKNOWN`：敌方/无依据 → 灰段未知样式（Details Panel —），不因己方 fallback 泄漏。
## 下一步

1. type 39 字段映射：收集第三个真实回放（最好录像者阵亡时间明确），验证冻结时刻与 f2/f3/f4 贴车规律；或游戏内录屏对照 FOV 档位/瞄准动作。
2. type 31 语义收口：当前证据指向「开火后散布/瞄准圈」，建议用第三样本验证衰减时间常数与收敛平台值随炮型变化。
3. type 13/battle_results 集成：解码进解析器，作为权威名册（账号/昵称/战队/车型/头像）与结算统计来源。
4. type 32 事件语义、type 5/33 归属；type 7 propId 0/4/7/8/9 语义（propId=2 已破解）。
   propId=2 破解详情（2026-08-13）：编码 = u16 LE，度 = raw*360/65536-180（[-180,180)，满圈 ±180 回绕）；
   证明链 = 旋转实验回放（车体静止炮塔转一圈恰好扫 360° 带 wrap）+ 开火锚点拟合（41 锚点残差 9.5°）+
   独立受击集交叉验证（34 锚点 2.3°）；炮口世界方向 = normalize(hullYaw + prop2)。
5. 将破解结果沉淀为解析器实现 + 契约测试。
