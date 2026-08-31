# WOTB replay 回放数据字典

> **Authoritative production replay contract.**
> Primary evidence: **PR147 11.19 corpus**（`11.19.0_china` + `11.19.0_china_apple`）。
> 历史 11.18 观察（`docs/research/replay/`）<b>不自动等于生产语义</b>；每个 capability 均需独立证据（fixture / research / known invariant）。
> 生产状态：文件结构/字段按已证明事实（AFFIRMED）；未证明语义标 UNKNOWN（见 `docs/reference/replay-parsed-fields.md`）。
> 前向兼容由严格 framing、packet/envelope/length/shape 与局部 structural invariants 决定；无法证明的具体 numeric semantic 保留 raw/UNKNOWN，不由 clientVersion allowlist 决定。

## 文件结构

`.wotbreplay` = ZIP 压缩包，包含 3 个条目：

| 条目                   | 说明                          | 本工具使用                |
|----------------------|-----------------------------|----------------------|
| `meta.json`          | JSON 元数据（战斗信息/录像者）          | 是                    |
| `data.wotreplay`     | 原始游戏事件数据（BigWorld 包序列）      | 是（ReplayPacketStreamReader 生产 framing + canonical decoder；EventStreamReader 仅研究/probe 工具） |
| `battle_results.dat` | Python pickle → protobuf 战绩 | 是                    |

### 解析安全预算

- 压缩包不超过 20 MiB，只允许表中 3 个标准条目，目录、额外条目和重复文件名一律拒绝。
- `meta.json` / `battle_results.dat` / `data.wotreplay` 分别不超过 1 / 8 / 20 MiB，总解压不超过 24 MiB。
- pickle：输入/二进制 8 MiB、文本 1 MiB、LONG 128 B、栈 4096、opcode 100000。
- protobuf：消息和 length-delimited 8 MiB、值数 16384、field number ≤ 2²⁹−1、varint ≤ 10 B。
- 单回放 `#201` 名册与 `#301` 战绩各最多 64 项；事件流最多保留 200000 个包（高于已观察约 112K 合法样本）。
  事件流解析使用<b>严格连续 framing</b>：包长度非法、时钟异常、payload 截断、或尾部剩余不足一个完整包
  时直接失败（fail closed），不做逐字节 resync，也不「继续寻找下一个看起来合理的包」。
- ZIP/结构错误抛稳定英文 `IOException`；pickle/protobuf 的非法长度、截断和溢出在 `ReplayParser` 边界统一包装为
  `Invalid replay data: ...`。

---

## data.wotreplay — BigWorld 事件流

二进制流，一个头后接 N 个包（BigWorld 引擎格式，与 WoT PC 通用）。

### 全局头（offset 0 起）

| 偏移     | 长度    | 说明                               |
|--------|-------|----------------------------------|
| 0      | 4     | 魔数 `0x12345678`                  |
| 4      | 8     | 未知（8 字节）                         |
| 12     | 1+len | 客户端哈希（长度前缀）                      |
| 13+len | 1+len | 客户端版本（如 `"11.18.0_china_apple"`） |
| 末      | 1     | 额外字节（忽略）                         |

### 包格式（头后紧跟）

```
payload_len: u32 LE   // 负载长度（≤200K）
type:        u32 LE   // 包类型（见下文）
clock:       f32 LE   // replay/session raw packet clock（非 battle-relative 计时）
payload:     [u8; payload_len]  // 负载
```

**时钟语义：** `rawClockSec` 是 replay/session <b>原始包时钟</b>，<b>不是</b>「从 0 起始的战斗计时」。
只有 battle-start 有权威时，battle-relative 时间 = `rawClock - resolvedBattleStartRawClock`；battle-start UNKNOWN
时不得把 raw clock 当 battle-relative 时间（消费者必须 fail closed）。

**错误容忍：** 采用<b>严格连续 framing</b>（strict contiguous framing）。包长度非法、时钟回退/异常、
payload 截断、或尾部剩余不足一个完整包时直接失败（fail closed）并记录诊断；不做逐字节 resync，也
不「继续寻找下一个看起来合理的包」。整个文件必须是连续的有效包序列，任何 framing 损坏都终止解析。

### 已观察到的包类型

| 类型 | 十六进制   | 含义                       | 负载格式                                                                                | 数量/场（random_game） |
|----|--------|--------------------------|-------------------------------------------------------------------------------------|-------------------|
| 0  | `0x00` | **BasePlayerCreate**     | skip 10B + nickname(1+len) + arena_uid(u64) + arena_type(u32) + pickle(Python dict) | 5                 |
| 1  | `0x01` | **CellCreate**           | domain_id(u32) + entity_id(i32) + init_props_flat                                   | 1                 |
| 2  | `0x02` | **Control/PlayerCreate** | init_props_flat                                                                     | 1                 |
| 4  | `0x04` | **EntityLeave**          | entity_id(i32 LE)                                                                   | 13–21             |
| 5  | `0x05` | **Materialization**      | 物化/重物化（初始 transform 快照 + 类专属初始化负载）                                              | ~100              |
| 7  | `0x07` | **EntityProperty**       | `entity_id(u32)+propId(u32)+valueLen(u32)+value`（generic envelope 结构前向；prop3 正 HP 见下）        | 13K–29K           |
| 8  | `0x08` | **EntityMethod**（RPC 调用） | entity_id(i32) + sub_type(u32) + args                                               | 630–700           |
| 10 | `0x0A` | **Position**（坐标）         | 49 字节（见下）                                                                           | 14K–29K           |
| 11 | `0x0B` | Entity method（未知）        | —                                                                                   | 2                 |
| 14 | `0x0E` | **Stream close / stop**   | —                                                                                   | 1                 |
| 23 | `0x17` | Game-specific            | —                                                                                   | ~32               |
| 29 | `0x1D` | Game-specific            | —                                                                                   | 2                 |
| 31 | `0x1F` | 未知（语义未证明）           | —                                                                                   | ~2.7K             |
| 32 | `0x20` | Game-specific            | —                                                                                   | ~223              |
| 35 | `0x23` | 未知（语义未证明）           | —                                                                                   | 1.4K–2K           |
| 39 | `0x27` | 未知/部分语义              | 最多（24K–35K/场）                                                                       | 16K–35K           |

### Type 0：BasePlayerCreate

首包通常为 Type 0。pickle 反序列化为 Python dict，包含：

```python
{
    'accountDatabaseIds': [list of 14 account_ids],  # 全部参战玩家
    'battleLevel': 10,
    'battleCategoryId': 12,
    'mmType': 2,
    'mouseEnabled': False,
    'camouflageSlot': 1,
    'avgMmr': [-1.152, 84.166],  # 两队平均 MM 评分
    'playerWaitTimes': {account_id: wait_sec, ...},
    'playersBattleCategoriesIds': {account_id: (cat_id, tank_id), ...},
    'turboBattlesStats': {...}
}
```

### Type 4：EntityLeave

负载 = entity_id (i32 LE)。

**语义（canonical）：** EntityLeave = AoI（视野/兴趣区域）离开，<b>不是死亡</b>。实体可能多次
离开/重回战场（反复出现 EntityLeave）。死亡 authority 独立（见「死亡时间 authority」）；EntityLeave 只用于
关闭 AoI 观测段（`ReplayAoiLifecycle`），段间为 `UNKNOWN_AOI`。不得把 EntityLeave 当作死亡、也不得据此
推断死亡时刻。

### Type 7：EntityProperty（generic envelope + verified property semantics）

单个属性更新，负载为定长三段头 + 变长值：

```
entity_id: u32 LE   // 实体 ID（车辆实体形如 0x10ca48xx，低字节为车位序号）
prop_id:   u32 LE   // 属性编号（车辆实体上观察到 0/1/2/3/4/7/8/9）
value_len: u32 LE   // 值字节数，观察到 ∈ {1, 2, 4}（对应包总长 13/14/16）
value:     [u8; value_len]
```

该结构在 11.18 样本上 100% 干净解析。`prop_id → 语义` 的<b>逐属性 mapping 已收敛</b>：普通正数 HP 由
回放结构包（Type5 物化当前 HP / Avatar method5 / Vehicle prop3 / Vehicle method1）产生，终结哨兵（FFFD/FFFE）
与 HP numeric evidence 在 decoder-local 的 raw classification 中表达。EntityProperty
解码器保留结构（`prop_id`/`value_len`）+ 已证明的 HP/property 语义；<b>未证明</b>的 prop_id 语义仍标
`UNKNOWN`，绝不臆断血量/存活。

> **可靠的血量/伤害/助攻/格挡/击杀/存活及业务死亡秒值请以 `battle_results.dat`（`Battle`/`PlayerResult`）为准**；
> `field24 lifeTime` 是唯一死亡秒值 authority。逐帧 HP 时间线由 canonical HP facts（`ReplayHpTimeline`）提供，
> live reconstruction 仅用于 Playback/HP/动画/诊断。

> **死亡时刻口径（AI 复盘）**：只消费 settlement `field24 lifeTime`；`PlayerResult` 上的 `deathTimeMillis`/`survivalTimeSec` 只是兼容投影。EntityLeave / 最后位置 / damage threshold 不是死亡 authority；结算秒值无效时相关推理必须 fail-closed。
> 不得把估算数据当作权威；阶段存活人数明确为「至阶段末」，并注入双方逐车阵亡时间线。

> **观测伤害抑制（AI 复盘）**：事件流伤害仅为观测子集（`DamageEvent`），覆盖未达 100% 时后端标记
> `OBSERVED_DAMAGE_IS_PARTIAL` 并抑制观测数字（观测=权威时自动恢复），AI 只引用权威团队总伤害。

### Type 8：EntityMethod（关键）

格式：`entity_id(u32) + methodId(u32) + argLen(u32) + args`（envelope 结构前向兼容）。

**methodId 是 entity-class scoped** —— 同一 methodId 在不同实体类上是不同语义（如
Avatar method4 2B=RoundFinished，Vehicle method4 16B=vehicle-to-vehicle collision）。安全 key 为
`(entityClass, methodId, exact argShape)`；entityClass 只能由独立生命周期/身份证据建立
（Type5 materialization `entityTypeId`；method48 参与映射中的 recorder 账号身份），**method decoder 不得
由 methodId 自证 class**。class UNKNOWN → raw-preserve（`UnknownReplayEvent`）。

**语义按结构与实体证据认可为 EXACT**：future version 只要 envelope、length、shape 与实体类证据成立，
即可解码相同的 proven semantic；无法证明的具体 numeric semantic 仍 raw/Unknown。stable 结构（如 Type10
49B、普通正 HP 结构值）不因版本字符串被拒绝。

| 实体类 | methodId | 语义 / 证据状态 | exact args shape | 产出 |
|---:|---:|---|---|---|
| Vehicle | 0 | AFFIRMED（观测开火） | 1B | `VehicleFiredEvent` |
| Vehicle | 1 | AFFIRMED（HP/state family；未证明的 cause 数值保留 raw） | 7B | `VehicleHealthStateEvent` |
| Vehicle | 4 | AFFIRMED（vehicle-to-vehicle collision） | 16B | `VehicleVehicleCollisionEvent` |
| Vehicle | 8 | AFFIRMED 结构观测（hit/result feedback；非权威伤害数字） | — | `VehicleHitEvent`/`UnsupportedDamageEvent` |
| Avatar | 4 | AFFIRMED（round-finished，winner + finishReason） | 2B | `RoundFinishedEvent` |
| Avatar | 5 | AFFIRMED（recorder own-health mirror） | 3B | `RecorderHealthChangedEvent` |
| Avatar | 16 | AFFIRMED（module/crew state） | 10B | `VehicleModuleCrewStateEvent` |
| Avatar | 17 | AFFIRMED（recorder ammo state） | 12B | `AmmunitionStateEvent` |
| Avatar | 20 | AFFIRMED（shot terminal endpoint） | 16B | `ProjectileTerminalEvent` |
| Avatar | 27/29 | AFFIRMED（projectile resolution / launch） | 34B / 37B | `ProjectileResolutionEvent` / `ProjectileLaunchedEvent` |
| Avatar | 36 | AFFIRMED field1-5/field6.1 physical roles（private symbol UNKNOWN） | 92/74B | `TargetingInfoSnapshotEvent` |
| Avatar | 38 | AFFIRMED low16 shot-result bitfield（0x0200 等） | 14..22B | `ShotResultEvent` |
| Avatar | 47/48/49 | 47 chat-action（未实现→raw）；48 结构参与映射（entity→account）+ ARENA_PERIOD；49 sync-options | — | `ParticipantMappingEvent`/`ArenaPeriodChangedEvent`/raw |
| Unknown | 其它 | UNKNOWN / 未实现 → raw-preserve（`UnknownReplayEvent`） | — | `UnknownReplayEvent` |

#### sub_type 48 (updateArena2) 完整格式

```
args:
  remaining_len: u32 LE         // 后续字节数（不含这 4 字节）
  field_number:  varint          // 恒为 1
  msg_length:    quirky          // FF u16 00 或 u8
  protobuf:      UpdateArena2 {  // prost Message
    field 1 (len-delim): PlayersWrapper {  // 包所有玩家
      field 1 (len-delim) repeated: Player {
        field 1 (varint): entity_id
        field 2 (bytes):  stats_blob（15 字节）
        field 3 (string): nickname
        field 4 (varint): team (1/2)
        field 5 (varint): flag
        field 7 (varint): account_id
      }
    }
  }
```

**重要性：** 这是唯一能从事件流获取 entity_id ↔ account_id 映射的地方。首批 updateArena2 包（@0.2s）即包含全部 14 名玩家的完整映射。

#### Vehicle method8（hit/result 观测帧，非 entityMethodDamage）

```
args (25B body):
  len:         u32 LE      // 恒为 21
  attackerEid: i32 LE      // 攻击方 entity_id
  victimEid:   i32 LE      // 被击方 entity_id
  type:        u8          // 恒为 01
  sub:         u8          // 3=direct HP damage, 0/1/2/4=module/其他
  value:       u16 BE       // 观测值（非权威 HP 伤害数字；权威 HP loss 以 Type7 prop3 为准）
  data[6]:     bytes       // 位置/方向等额外数据
  flag:        u8          // 末尾标志 (01=正常, 03=致命一击?)
```

方法调用在 victim 实体上（methodEid == victimEid）。**这是 Vehicle method8** 的结构观测帧
（hit/result feedback）。damage 事件只是<b>观测</b>子集
（`DamageEvent`），覆盖未达 100% 时标记 `OBSERVED_DAMAGE_IS_PARTIAL`；它<b>不是</b>死亡 authority，不再累计
到 `damageReceived` 阈值推断阵亡，也不再填充 `PlayerResult.killVictims`（该字段与 `DeathTimeEstimator`
已从生产移除）。<b>击杀归因</b>以 settlement `field25`（killer result/entity ID）+ `#301 outer field1`
result-id 映射为 canonical authority（见「死亡时间 authority」）；不通过 terminal lifecycle + damage backing
猜测 killer。

### Type 10：Position（含 space_id）

BigWorld 标准位置格式 **含 space_id**（WoT PC 共享此格式）：

```
entity_id:     i32    // 4 字节
space_id:      i32    // 4 字节
attachmentParentEntityId: i32  // 4 字节；=0 表示 world 坐标；≠0 为挂接/本地相对坐标系
position_x:    f32    // 4 字节
position_y:    f32    // 4 字节
position_z:    f32    // 4 字节
positionErr_x: f32    // 4 字节
positionErr_y: f32    // 4 字节
positionErr_z: f32    // 4 字节
yaw:           f32    // 4 字节
pitch:         f32    // 4 字节
roll:          f32    // 4 字节
trailingByte:  u8     // 1 字节; PR147 controlled evidence: semantic UNKNOWN（绝非 onGround / isError）
====================
合计: 49 字节
```

canonical：Type10 为精确 49-byte transform 布局；`payload[4..12)` 的第三个 int 为
attachment parent entity id；最后 1 字节 trailing byte 的 semantic **UNKNOWN**（已被受控空中回放驳回
`onGround` 猜想，见 docs/research/replay/type10-movement-transform-closure.md）。实测 `position_x` 和
`position_z` 对应游戏世界 XZ 坐标（范围约 ±1000），`position_y` 对应高度。

### 第 1 包 vs 错误容忍

**严格连续 framing**：生产 reader（`ReplayPacketStreamReader`）按「头 → 包 → 下一个包正好在上一个包结束处」
连续解析直到 terminator（type `0xFFFFFFFF`）。任何 framing 损坏（长度非法 / 截断 / 时钟异常 / 尾部垃圾）
都<b>直接失败</b>并记录诊断，不再「跳 1 字节重同步」，也不再维护 1,000,000 次扫描上限。因此正常路径下
不会只读前 ~28KB——整场包序列被完整、严格地消费，Type 10/4/7/31/35 数据按 production decoder 结果可用。

---

## 实体 ID ↔ 账号 ID 映射（Summary）

```
EventStream → Type 8 sub_type 48 (updateArena2)
  → protobuf Player.entity_id (fn 1, varint)
  → protobuf Player.account_id (fn 7, varint)
  → Map<Integer, Long> entityToAccount
```

## 死亡时间 authority

```
死亡权威（PlayerResultFormat.deathSec()）：
  settlement field24 lifeTime（dead=阵亡秒；survivor=battle duration）

死亡时间只由 settlement 事实提供；Playback/live 事件、#104、EntityLeave、damage threshold、
last HP update 均不得覆盖或重新计算业务死亡秒值。
```

PR147 authoritative settlement facts：
- **field24**（`lifeTime` 秒）：dead → settlement death second；survivor → battle duration。
- **field25**：killer **result/entity ID**（非 accountId），经 canonical result-id mapping 解析。
- **field105**（`deathReason`）：survivor sentinel `-1`。
- **不存在 field #104 deathTimeMillis**；`deathTimeMillis` 是派生兼容值（由 field24 lifeTime 求得），非 raw #104。

> **已删除的旧 death 启发式（不再作为权威）：** 早期实现曾用「Type 8 subtype 8 累计 direct HP 伤害 ≥
> `damageReceived` 阈值 → 推断阵亡 + killer」以及「EntityLeave + Position 停止 / 最后位置 / 离开时间」
> 估算死亡时刻。这些启发式（damage-threshold / EntityLeave / last-position / last-attacker）在
> <b>不再写入 `PlayerResult`</b>；`PlayerResult.killVictims` 与 `DeathTimeEstimator` 已从生产
> 移除。业务死亡时刻只允许由 settlement `field24 lifeTime` 给出。

---

## meta.json（14 个键）

| #  | 键                       | 类型     | 单位     | 示例值                     | 说明                                                              | 是否解析                                   |
|----|-------------------------|--------|--------|-------------------------|-----------------------------------------------------------------|----------------------------------------|
| 1  | `version`               | string | —      | `"11.18.0_china_apple"` | 游戏版本                                                            | 是 → `Battle.version`                   |
| 2  | `title`                 | string | —      | `""`                    | 回放标题（通常为空）                                                      | 否                                      |
| 3  | `dbid`                  | string | —      | `"3125699886"`          | 录像者数据库 ID                                                       | 否                                      |
| 4  | `playerName`            | string | —      | `"WHAT_HPSHARING"`      | 录像者昵称                                                           | 是 → `Battle.recorder`                  |
| 5  | `battleStartTime`       | string | Unix 秒 | `"1781873222"`          | 战斗开始时间戳                                                         | 是 → `Battle.startTime`                 |
| 6  | `playerVehicleName`     | string | —      | `"S16_Kranvagn"`        | 录像者车辆名                                                          | 是 → `Battle.recorderVehicle`           |
| 7  | `mapName`               | string | —      | `"lagoon"`              | 地图内部名                                                           | 是 → `Battle.mapName`                   |
| 8  | `arenaUniqueId`         | string | —      | `"1161909687528274499"` | 战斗唯一 ID（去重用）                                                    | 否（pickle tuple[0] 作为 `Battle.arenaId`） |
| 9  | `battleDuration`        | number | 秒      | `306.19186`             | 战斗持续时长（浮点数）                                                     | 是 → `Battle.durationS`                 |
| 10 | `vehicleCompDescriptor` | int    | —      | `4481`                  | 车辆组件描述符（== tankId，**不含炮/模块配置**）                                | 否                                      |
| 11 | `camouflageId`          | int    | —      | `406`                   | 涂装 ID                                                           | 否                                      |
| 12 | `mapId`                 | int    | —      | `26`                    | 地图数字 ID                                                         | 否（已移除）                                 |
| 13 | `arenaBonusType`        | int    | —      | `1`                     | 模式类型（**1=随机；2=训练房**；其他=娱乐/联赛等。经真实样本核实，早期"2=随机"系误标——当时分析的是训练房回放） | 是 → `Battle.arenaBonusType`（排行榜仅收 ==1） |
| 14 | `camouflageCustomData`  | string | —      | `""`                    | 自定义涂装数据                                                         | 否                                      |

---

## battle_results.dat 结构

```
pickle: (arenaUniqueId: int, protobuf_bytes: bytes)
```

### 根层 protobuf（13 个字段）

| 字段号 | 类型        | 数量    | 示例值           | 说明                       | 是否解析                    |
|-----|-----------|-------|---------------|--------------------------|-------------------------|
| 1   | varint    | 1     | `65562`       | 未知 — 小整数                 | 否                       |
| 2   | varint    | 1     | `1781873219`  | 战斗开始 Unix 秒              | 否                       |
| 3   | varint    | 1     | `2`           | **胜方队伍**（1 或 2）          | 是 → `Battle.winnerTeam` |
| 4   | varint    | 1     | `1`           | 未知 — 小整数                 | 否                       |
| 5   | varint    | 1     | `295`         | 未知 — 中整数                 | 否                       |
| 8   | sub_msg   | 1     | (24字段)        | **录像者自身战绩**（结构同 #301→#2） | 否                       |
| 9   | varint    | 1     | `2`           | 未知 — 恒为 2                | 否                       |
| 11  | bytes     | 1     | (空)           | 空字节字段                    | 否                       |
| 150 | sub_msg   | 1     | (16字段, ~30KB) | **竞技场统计数据**（见下文）         | 否                       |
| 201 | sub_msg[] | 15-16 | (2字段/条)       | **名册**（玩家信息列表）           | 是                       |
| 301 | sub_msg[] | 14    | (2字段/条)       | **玩家战绩**（每人一条）           | 是                       |
| 302 | sub_msg   | 1     | (4-5条目)       | **MVP排行**信息              | 否                       |
| 303 | sub_msg   | 1     | (2字段)         | 未知 — 两个常量值               | 否                       |

---

### 字段 #201 — 名册（Roster）

每条 2 个子字段：

| 子字段 | 类型      | 示例值          | 说明                 | 是否解析 |
|-----|---------|--------------|--------------------|------|
| #1  | varint  | `3106010506` | **accountId**      | 是    |
| #2  | sub_msg | (8-9字段)      | **PlayerInfo** 子消息 | 是    |

#### PlayerInfo（#201→#2）子字段：

| 子字段    | 常量              | 类型           | 示例值            | 说明            | 是否解析                         |
|--------|-----------------|--------------|----------------|---------------|------------------------------|
| **#1** | `R_NICK = 1`    | bytes(UTF-8) | `"田_..."`      | **昵称**        | 是 → `PlayerResult.nickname`  |
| **#2** | `R_PREBATTLE_GROUP = 2` | varint       | `281447127`    | **prebattle/training-room 分组 ID**（PR147: NOT a platoon ID，见 battle-results.md） → `PlayerResult.prebattleGroupId` |
| **#3** | —               | varint       | `1` / `2`      | **队伍**（名册来源）  | 是 → 结算阵容完整性校验（与战绩 #301→#2→#102 对比；全局 `Battle.rosterComplete` 要求全集合一致，League Rating 走 League 专属证据 `settlementAccountsCoveredByRoster` / `settlementRosterTeamConsistent`，见 protocol.md「SPECTATOR / NON-COMBATANT ENTITY」） |
| **#4** | —               | varint       | `380362`       | 未知 — 车辆相关 ID？ | 否                            |
| **#5** | `R_CLAN = 5`    | bytes(UTF-8) | `"猫猫乐坏"`       | **战队标签**      | 是 → `PlayerResult.clan`      |
| **#6** | —               | bytes(2)     | `\x00\x00`     | 未知（2 字节零）     | 否                            |
| **#7** | —               | sub_msg      | `{#1:1, #2:1}` | 未知 — 徽章标志？    | 否                            |
| **#8** | —               | varint       | `2281982`      | **狗牌 ID**     | 否                            |
| **#9** | —               | varint       | `1` / `46`     | 未知 — 小整数      | 否                            |

---

### 字段 #301 — 玩家战绩（PlayerResults）

每条 2 个子字段：

| 子字段 | 类型      | 示例值         | 说明                            |
|-----|---------|-------------|-------------------------------|
| #1  | varint  | `280428036` | 内部 accountId（关联 #301→#2→#25）  |
| #2  | sub_msg | (18-27字段)   | **PlayerResultInfo** — 实际战绩数据 |

#### PlayerResultInfo（#301→#2）全部字段：

| 字段号      | 常量                   | 类型      | 单位 | 示例值                      | 说明                          | 是否解析                  |
|----------|----------------------|---------|----|--------------------------|-----------------------------|-----------------------|
| **#1**   | —                    | varint  | HP | `86`-`2291`              | 点亮/协助分量（与 #9+#10 独立统计）      | 否                     |
| **#4**   | `F_SHOTS = 4`        | varint  | 次数 | `5`-`14`                 | **射击次数**                    | 是                     |
| **#5**   | `F_HITS = 5`         | varint  | 次数 | `3`-`11`                 | **命中次数**                    | 是                     |
| **#6**   | —                    | varint  | 次数 | `1`-`6`                  | 未知 — 基础命中？                  | 否                     |
| **#7**   | `F_PENS = 7`         | varint  | 次数 | `2`-`10`                 | **击穿次数**                    | 是                     |
| **#8**   | `F_DAMAGE = 8`       | varint  | HP | `766`-`4571`             | **造成伤害**                    | 是                     |
| **#9**   | `F_ASSIST[0] = 9`    | varint  | HP | `99`-`381`               | **协助伤害分量 1**                | 是（#9 + #10 求和）        |
| **#10**  | `F_ASSIST[1] = 10`   | varint  | HP | `86`-`1726`              | **协助伤害分量 2**                | 同上                    |
| **#11**  | `F_RECEIVED = 11`    | varint  | HP | `349`-`3074`             | **受到伤害**                    | 是                     |
| **#12**  | `F_HITS_RECV = 12`   | varint  | 次数 | `2`-`11`                 | **被命中次数**                   | 是                     |
| **#13**  | —                    | varint  | 次数 | `1`-`3`                  | 未知 — 跳弹？未击穿？                | 否                     |
| **#15**  | `F_PENS_RECV = 15`   | varint  | 次数 | `1`-`9`                  | **被击穿次数**                   | 是                     |
| **#16**  | —                    | varint  | 次数 | `1`-`3`                  | 未知 — HE/溅射命中？               | 否                     |
| **#17**  | `F_ENEMIES_DMG = 17` | varint  | 人数 | `1`-`5`                  | **击伤敌方数**（不同目标）             | 是                     |
| **#18**  | `F_KILLS = 18`       | varint  | 人数 | `1`-`3`                  | **击杀数**                     | 是                     |
| **#23**  | —                    | varint  | 经验 | `418`-`2527`             | **基础经验**（不含加成）              | 否                     |
| **#24**  | —                    | varint  | —  | `63`-`295`               | 未知 — 小累计值                   | 否                     |
| **#25**  | —                    | varint  | —  | `280428036`              | 内部 accountId（关联 #301→#1）    | 否                     |
| **#32**  | —                    | varint  | —  | `32`-`477`               | 点亮/活动分数？                    | 否                     |
| **#33**  | —                    | varint  | —  | `40`-`120`               | 关联 #32                      | 否                     |
| **#101** | `F_ACCOUNT = 101`    | varint  | —  | `3100730745`             | **accountId**（Wargaming ID） | 是                     |
| **#102** | `F_TEAM = 102`       | varint  | —  | `1` / `2`                | **队伍**                      | 是                     |
| **#103** | `F_TANK = 103`       | varint  | —  | `4481`                   | **车辆 ID**（tankId）           | 是                     |
| **#105** | `F_DEATH_REASON = 105` | varint | — | `-1`（存活 sentinel）      | **deathReason**：`-1`=存活 sentinel，其它=阵亡原因 | 是 → `deathReasonRaw` |
| **#106** | —                    | varint  | 银币 | `68600`-`542712`         | **获得银币**                    | 否（已移除）                |
| **#107** | —                    | varint  | —  | `1104555167`             | 未知 — 大整数，类似哈希               | 否                     |
| **#116** | —                    | varint  | —  | `262392`                 | 未知                          | 否                     |
| **#117** | `F_BLOCKED = 117`    | varint  | HP | `410`-`1620`             | **跳弹/未击穿伤害**（装甲阻挡）          | 是                     |
| **#118** | —                    | varint  | —  | `6`-`176`                | 未知 — 小整数                    | 否                     |
| **#119** | —                    | varint  | —  | `1` / `2`                | 未知 — 少量                     | 否                     |
| **#120** | —                    | varint  | —  | `2` / `3`                | 未知 — 部分存活玩家有                | 否                     |
| **#122** | —                    | sub_msg | —  | `{#5:5}`                 | 未知 — 单字段子消息                 | 否                     |

> **⚠️ 权威：** 结算中没有 field #104 deathTimeMillis。死亡时刻由 **field24（lifeTime 秒）** 派生
> （dead=settlement death second；survivor=battle duration），`PlayerResult.deathTimeMillis` 是派生兼容值。
> `field25` 是 killer result/entity ID（非 accountId）；`field105` 是 deathReason（survivor sentinel `-1`）。

### 字段 #106 说明

`#106` 的值域（`68600`-`542712`）与银币数量级吻合，此前被解析为 `credits`（已移除）。其数值约为基础经验（#23）的 `20-200`
倍，取决于加成/高级账号。

---

### 字段 #150 — 竞技场统计数据（~30KB）

16 个子字段，包含丰富的分车辆/分玩家统计和成就事件。

| 子字段      | 类型        | 值          | 说明              |
|----------|-----------|------------|-----------------|
| #8       | bytes(4)  | `00000000` | 恒为 4 字节零        |
| #9       | bytes(2)  | `0000`     | 恒为 2 字节零        |
| #10      | bytes(2)  | `0000`     | 恒为 2 字节零        |
| #12      | varint    | `1`        | 常量              |
| #13      | varint    | `15`       | 最大队伍数？          |
| #14      | varint    | `15`       | 每队最大玩家数？        |
| #15      | varint    | `10`       | 1 队实际人数         |
| #16      | varint    | `10`       | 2 队实际人数         |
| #17      | varint    | `10`       | 未知              |
| **#20**  | sub_msg   | (28字段)     | **玩家统计数组**（一队）  |
| **#21**  | sub_msg   | (1字段)      | 队伍统计变体          |
| **#22**  | sub_msg   | (28字段)     | **玩家统计数组**（另一队） |
| **#23**  | sub_msg   | (1字段)      | 队伍统计变体          |
| #25      | bytes(2)  | `0000`     | 2 字节零           |
| #26      | bytes(2)  | `0000`     | 2 字节零           |
| **#114** | sub_msg[] | (6-8条)     | **成就/事件列表**     |

#### #150→#20/#22 — 玩家统计子消息（28 字段）

| 子字段   | 类型        | 示例值                     | 说明                               |
|-------|-----------|-------------------------|----------------------------------|
| #5[0] | fixed32   | `134220032`             | 玩家/车辆 ID                         |
| #5[1] | fixed32   | `111692050`             | 另一个 ID                           |
| #5[2] | sub_msg   | (36字段: #401-#476)       | **分车辆统计数据**                      |
| #6    | sub_msg   | (3字段: #601, #604, #605) | 战斗结果标志                           |
| #7    | sub_msg   | (5字段: #701-#708)        | 战区/位置数据                          |
| #8    | sub_msg   | (2字段: #801, #802)       | 会话/活动数据                          |
| #9    | sub_msg[] | (89条)                   | **装备/消耗品使用**（#901=类型ID, #902=次数） |
| #19   | sub_msg   | (18字段: #1103-#1128)     | **伤害明细分解**                       |
| #25   | varint    | `9`                     | 常量                               |
| #26   | sub_msg   | (3字段)                   | 未知                               |
| #27   | bytes     | (空)                     | 空                                |
| #28   | sub_msg   | (1字段: #4)               | 未知                               |
| #102  | varint    | `141`                   | 伤害变体                             |
| #103  | varint    | `100`                   | 命中变体                             |
| #104  | varint    | `39`                    | 击穿变体                             |
| #105  | varint    | `77`                    | 受击变体                             |
| #106  | varint    | `76`                    | 射击变体                             |
| #107  | varint    | `204`                   | 阻挡变体                             |
| #108  | varint    | `204`                   | 阻挡变体（同 #107）                     |
| #109  | varint    | `1520`                  | 经验变体                             |
| #110  | varint    | `1357`                  | 经验变体                             |
| #111  | varint    | `242`                   | 未知                               |
| #112  | varint    | `431633`                | **对车辆总伤害**（分车伤害和）                |
| #113  | varint    | `302161`                | **协助总伤害**（分车协助和）                 |
| #115  | varint    | `97`                    | 未知                               |
| #116  | varint    | `44`                    | 未知                               |
| #117  | varint    | `2153`                  | 阻挡伤害变体                           |
| #118  | varint    | `1650`                  | 未知                               |
| #119  | varint    | `106835`                | **总经验**（可能含加成）                   |
| #120  | varint    | `16`                    | 未知                               |

#### #150→#114 — 成就/事件列表

每条含 #1=事件类型ID、#2=次数？、#3=参数？、#4=值：

| 事件类型    | 说明             |
|---------|----------------|
| `#1=1`  | 击杀/里程碑（#4=伤害值） |
| `#1=3`  | 团队事件           |
| `#1=5`  | 阻挡里程碑（#4=阻挡伤害） |
| `#1=8`  | 命中里程碑？         |
| `#1=15` | 存活事件           |
| `#1=17` | 协助里程碑（#4=协助伤害） |

---

### 字段 #302 — MVP 排行

4-5 条记录，每条含：

- `#1 = accountId`
- `#2 = sub_msg` — 未知标志位

---

## 当前解析字段总表

### 单场展示列（Columns.java）

| 列 key                         | 类型  | 来源字段                                     | 单位/格式 | 说明                                                                              |
|-------------------------------|-----|------------------------------------------|-------|---------------------------------------------------------------------------------|
| `nickname`                    | 文本  | `PlayerResult.nickname`                  | —     | 昵称（名册 #201→#2→#1）                                                               |
| `clan`                        | 文本  | `PlayerResult.clan`                      | —     | 战队（名册 #201→#2→#5）                                                               |
| `tank_name`                   | 文本  | `Tankopedia.info(tankId).name()`         | —     | 车辆名（查表）                                                                         |
| `tank_tier`                   | 整数  | `Tankopedia.info(tankId).tier()`         | 等级    | 车辆等级（查表）                                                                        |
| `tank_type`                   | 文本  | `Tankopedia.info(tankId).type()`         | —     | API 稳定码：`HEAVY_TANK`/`MEDIUM_TANK`/`LIGHT_TANK`/`TANK_DESTROYER`/`OTHER`；导出使用中文 |
| `tank_nation`                 | 文本  | `Tankopedia.info(tankId).nation()`       | —     | API 稳定国家码；导出使用中文                                                                |
| `survived_label`              | 文本  | `PlayerResult.survived`                  | —     | API 返回 `SURVIVED`/`DESTROYED`，前端映射存活/阵亡（#105==-1 → 存活）                          |
| `kills`                       | 整数  | `PlayerResult.kills`                     | 人数    | #18                                                                             |
| `damage_dealt`                | 整数  | `PlayerResult.damageDealt`               | HP    | #8                                                                              |
| `damage_assisted`             | 整数  | `PlayerResult.damageAssisted`            | HP    | #9 + #10                                                                        |
| `contribution`               | 浮点数 | `PerformanceMetricsCalculator.battleMetrics` → `PlayerResult.contribution` | %  | 单场贡献率（派生；HP 全 UNKNOWN 时为 null → 前端 `--`）                                     |
| `kast`                       | 浮点数 | `PerformanceMetricsCalculator.battleMetrics` → `PlayerResult.kast`          | %  | 单场 KAST（派生；HP 全 UNKNOWN 时为 null → 前端 `--`）                                    |
| `impact`                     | 浮点数 | `PerformanceMetricsCalculator.battleMetrics` → `PlayerResult.impact`        | %  | 单场 Impact（派生，不依赖 HP，恒有值）                                                     |
| `damage_received`             | 整数  | `PlayerResult.damageReceived`            | HP    | #11                                                                             |
| `damage_blocked`              | 整数  | `PlayerResult.damageBlocked`             | HP    | #117                                                                            |
| `survival_time`               | 浮点数 | `PlayerResult.survivalTimeSec`           | 秒     | settlement lifeTime 的兼容投影；live reconstruction 不覆盖业务值 |
| `n_shots`                     | 整数  | `PlayerResult.nShots`                    | 次数    | #4                                                                              |
| `n_hits_dealt`                | 整数  | `PlayerResult.nHitsDealt`                | 次数    | #5                                                                              |
| `n_penetrations_dealt`        | 整数  | `PlayerResult.nPenetrationsDealt`        | 次数    | #7                                                                              |
| `hit_rate`                    | 浮点数/空 | `nHitsDealt / nShots * 100`              | %     | 推导（`nShots == 0` → null，前端 `--`，禁止 0/0 伪装 0%）                              |
| `pen_rate`                    | 浮点数/空 | `nPenetrationsDealt / nHitsDealt * 100`  | %     | 推导（分母是命中次数不是射击次数；`nHitsDealt == 0` → null）                             |
| `n_hits_received`             | 整数  | `PlayerResult.nHitsReceived`             | 次数    | #12                                                                             |
| `n_penetrations_received`     | 整数  | `PlayerResult.nPenetrationsReceived`     | 次数    | #15                                                                             |
| `n_enemies_damaged`           | 整数  | `PlayerResult.nEnemiesDamaged`           | 人数    | #17                                                                             |
| ~~`platoon_label`~~             | —     | 已删除（PR147：field2 是 prebattle/training-room 分组 ID，非排/小队；A/B/C 排标签为错误业务语义） | — |推导）                                                          |
| `tank_id`                     | 长整数 | `PlayerResult.tankId`                    | —     | #103                                                                            |
| `account_id`                  | 长整数 | `PlayerResult.accountId`                 | —     | #101                                                                            |

### 汇总列（AggregateSheets / AGG_COLS）

| 列 key                 | 类型  | 计算方式                     | 单位   |
|-----------------------|-----|--------------------------|------|
| `battles`             | 整数  | Sum                      | 场次   |
| `wins`                | 整数  | Sum（team==winnerTeam）    | 场次   |
| `win_rate`            | 浮点数 | `wins/battles * 100`     | %    |
| `survival_rate`       | 浮点数 | `survived/battles * 100` | %    |
| `survival_avg`        | 浮点数 | `survivalSum/battles`    | 秒    |
| `kills`               | 整数  | Sum                      | 人数   |
| `kills_avg`           | 浮点数 | `kills/battles`          | 人数/场 |
| `damage`              | 整数  | Sum                      | HP   |
| `damage_avg`          | 浮点数 | `damage/battles`         | HP/场 |
| `assisted`            | 整数  | Sum                      | HP   |
| `assisted_avg`        | 浮点数 | `assisted/battles`       | HP/场 |
| `received_avg`        | 浮点数 | `received/battles`       | HP/场 |
| `blocked_avg`         | 浮点数 | `blocked/battles`        | HP/场 |
| `hit_rate`            | 浮点数/空 | `sum(hits)/sum(shots) * 100` | %  | 跨场基于总量；`sum(shots)==0` → null |
| `pen_rate`            | 浮点数/空 | `sum(pens)/sum(hits) * 100` | %   | 跨场基于总量；`sum(hits)==0` → null  |
| `shots`               | 整数  | Sum                      | 次数   |
| `hits`                | 整数  | Sum                      | 次数   |
| `pens`                | 整数  | Sum                      | 次数   |
| `enemies_damaged_avg` | 浮点数 | `enemiesDamaged/battles` | 人数/场 |
| `contribution`        | 浮点数 | `PerformanceMetricsCalculator.compute` 按 accountId 合并 | %  | 跨场贡献率（无 HP 已知场次时 null → 前端 `--`） |
| `kast`                | 浮点数 | `PerformanceMetricsCalculator.compute` 按 accountId 合并 | %  | 跨场 KAST（无 HP 已知场次时 null → 前端 `--`）   |
| `impact`              | 浮点数 | `PerformanceMetricsCalculator.compute` 按 accountId 合并 | %  | 跨场 Impact（不依赖 HP）                          |
| `multi_damage_rate`   | 浮点数 | `PerformanceMetricsCalculator.compute` 按 accountId 合并 | %  | 多伤率（无 HP 已知场次时 null → 前端 `--`）      |
| `traded_deaths`       | 整数  | `PerformanceMetricsCalculator.compute` 按 accountId 合并 | 场次 | 互换击杀                                        |
| `tanks`               | 文本  | `Map<车辆名, 场次>`           | —    |
| `account_id`          | 长整数 | —                        | —    |

---

## 单位速查

| 含义    | 单位         | 说明                                                    |
|-------|------------|-------------------------------------------------------|
| 伤害值   | **HP**     | 游戏内生命值点数                                              |
| 存活时间  | **秒**      | settlement `field24 lifeTime`（死亡玩家为死亡秒值，幸存者为战斗时长） |
| 战斗时长  | **秒**      | `meta.json#battleDuration`（浮点）                        |
| 时间戳   | **Unix 秒** | 自 1970-01-01 起的秒数                                     |
| 次数/计数 | **次**      | 射击/命中/击杀/人数                                           |
| 百分比   | **%**      | `0.0-100.0`                                           |
| 银币    | **银币**     | 字段 #106（未使用）                                          |
| 经验    | **经验**     | 字段 #23（未使用）                                           |

---

## 已知问题

### 1. 死亡时间 authority

无 field #104 deathTimeMillis。死亡权威链为：

| 层级 | 来源                                  | 精度               |
|----|-------------------------------------|------------------|
| SETTLEMENT       | 结算 field24 lifeTime（dead=死亡秒；survivor=battle duration） | 整数秒 authority |

死亡时间统一经 `PlayerResultFormat.deathSec()`（canonical），消费方绝不重读 raw field24 / #104 /
EntityLeave / damage threshold 自行计算。

> **旧启发式已移除：** 早期用「Type 8 subtype 8 累计 direct HP 伤害 ≥ `damageReceived` 阈值」的 damageDeathTimes，
> 以及「EntityLeave + Position 停止 / 最后位置 / 离开时间」的 EntityLeave/Position 兜底估算死亡时刻。这些
> 启发式（damage-threshold / EntityLeave / last-position / last-attacker）此后<b>不再是死亡
> authority</b>——它们是假阳性来源（临时离场、spectator 实体坐标继续更新），且无法证明 lethal boundary /
> killer identity。生产死亡时刻只来自 canonical 死亡 authority；EntityLeave 仅用于 AoI 观测段收口。

### 2. 战斗时长上限

`meta.json#battleDuration` 已按标准随机战 7 分钟截断：`Math.min(val, 420)`。

### 3. 未解析的潜在有用数据

- `#301→#2→#23` — 基础经验
- `#301→#2→#1` — 单独统计的点亮协助分量
- `#150` — 丰富的分车统计/成就事件
- `#302` — MVP 排行数据
