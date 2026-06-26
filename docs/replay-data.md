# WOTB replay 回放数据字典

> 基于 v11.18.0_china_apple 版本回放分析。字段号和含义可能随游戏版本变化。

## 文件结构

`.wotbreplay` = ZIP 压缩包，包含 3 个条目：

| 条目 | 说明 | 本工具使用 |
|------|------|-----------|
| `meta.json` | JSON 元数据（战斗信息/录像者） | 是 |
| `data.wotreplay` | 原始游戏事件数据（BigWorld 包序列） | 是（EventStreamReader） |
| `battle_results.dat` | Python pickle → protobuf 战绩 | 是 |

---

## data.wotreplay — BigWorld 事件流

二进制流，一个头后接 N 个包（BigWorld 引擎格式，与 WoT PC 通用）。

### 全局头（offset 0 起）

| 偏移 | 长度 | 说明 |
|------|------|------|
| 0 | 4 | 魔数 `0x12345678` |
| 4 | 8 | 未知（8 字节） |
| 12 | 1+len | 客户端哈希（长度前缀） |
| 13+len | 1+len | 客户端版本（如 `"11.18.0_china_apple"`） |
| 末 | 1 | 额外字节（忽略） |

### 包格式（头后紧跟）

```
payload_len: u32 LE   // 负载长度（≤200K）
type:        u32 LE   // 包类型（见下文）
clock:       f32 LE   // 从 0 起始的战斗计时（秒）
payload:     [u8; payload_len]  // 负载
```

**错误容忍：** 遇到坏包（长度异常/时钟异常）时跳 1 字节继续。整个文件都是有效包序列。

### 已观察到的包类型

| 类型 | 十六进制 | 含义 | 负载格式 | 数量/场（random_game） |
|------|----------|------|----------|----------------------|
| 0 | `0x00` | **BasePlayerCreate** | skip 10B + nickname(1+len) + arena_uid(u64) + arena_type(u32) + pickle(Python dict) | 5 |
| 1 | `0x01` | **CellCreate** | domain_id(u32) + entity_id(i32) + init_props_flat | 1 |
| 2 | `0x02` | **Control/PlayerCreate** | init_props_flat | 1 |
| 4 | `0x04` | **EntityLeave** | entity_id(i32 LE) | 13–21 |
| 5 | `0x05` | **Spotting** | undefined | ~100 |
| 7 | `0x07` | **EntityProperty**（血量等） | entity_id(i32) + prop_changes | 13K–29K |
| 8 | `0x08` | **EntityMethod**（RPC 调用） | entity_id(i32) + sub_type(u32) + args | 630–700 |
| 10 | `0x0A` | **Position**（坐标） | 49 字节（见下） | 14K–29K |
| 11 | `0x0B` | Entity method（未知） | — | 2 |
| 14 | `0x0E` | **BattleEnd** | — | 1 |
| 23 | `0x17` | Game-specific | — | ~32 |
| 29 | `0x1D` | Game-specific | — | 2 |
| 31 | `0x1F` | **Tracked/State** | — | ~2.7K |
| 32 | `0x20` | Game-specific | — | ~223 |
| 35 | `0x23` | **Chat**（聊天消息） | — | 1.4K–2K |
| 39 | `0x27` | **Map/NestedProperty** | 最多（24K–35K/场） | 16K–35K |

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

死亡/离开检测。负载 = entity_id (i32 LE)。

**用途：** 实体可能多次离开/重回战场（反复出现 EntityLeave）。取**最后**一次 leave 时刻作为大致死亡时间。

### Type 8：EntityMethod（关键）

格式：`entity_id(i32) + sub_type(u32) + args`

| sub_type | 名称 | 说明 |
|----------|------|------|
| 8 | **entityMethodDamage** | 伤害事件（仅 sub=3 直接 HP 伤害用于死亡推算） |
| 47 | **updateArena** | 玩家存活名单（WoT PC/Blitz 通用） |
| 48 | **updateArena2** | **Blitz 特有**，含 entity_id↔account_id 映射 |

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

#### sub_type 8 (entityMethodDamage) 格式

```
args (25B body):
  len:         u32 LE      // 恒为 21
  attackerEid: i32 LE      // 攻击方 entity_id
  victimEid:   i32 LE      // 被击方 entity_id
  type:        u8          // 恒为 01
  sub:         u8          // 3=direct HP damage, 0/1/2/4=module/其他
  dmg:         u16 BE       // HP 伤害值（仅 sub=3 时为 HP 伤害）
  data[6]:     bytes       // 位置/方向等额外数据
  flag:        u8          // 末尾标志 (01=正常, 03=致命一击?)
```

方法调用在 victim 实体上（methodEid == victimEid）。sub=3 事件累计到达 `damageReceived` 阈值时即判定为阵亡。

### Type 10：Position（含 space_id）

BigWorld 标准位置格式 **含 space_id**（WoT PC 共享此格式）：

```
entity_id:     i32    // 4 字节
space_id:      i32    // 4 字节（= vehicle_id 的 4 字节体？）
vehicle_id:    i32    // 4 字节
position_x:    f32    // 4 字节
position_y:    f32    // 4 字节
position_z:    f32    // 4 字节
positionErr_x: f32    // 4 字节
positionErr_y: f32    // 4 字节
positionErr_z: f32    // 4 字节
yaw:           f32    // 4 字节
pitch:         f32    // 4 字节
roll:          f32    // 4 字节
is_error:      i8     // 1 字节
====================
合计: 49 字节
```

实测 `position_x` 和 `position_z` 对应游戏世界 XZ 坐标（范围约 ±1000），`position_y` 对应高度。

### 第 1 包 vs 错误容忍

旧解析在第 1 个坏包处停止，导致只读前 ~28KB（0–2.4s，仅 Type 0/1/2/部分 39）。**错误容忍** 下，全部 ~72K–112K 包覆盖整场战斗（210s–310s），Type 10/4/7/31/35 数据完整可用。

---

## 实体 ID ↔ 账号 ID 映射（Summary）

```
EventStream → Type 8 sub_type 48 (updateArena2)
  → protobuf Player.entity_id (fn 1, varint)
  → protobuf Player.account_id (fn 7, varint)
  → Map<Integer, Long> entityToAccount
```

## 死亡时间推算（3 层 fallback + 假阳性检测）

```
survivalTimeSec:
  if survived → battleDuration (meta.json)
  else:
    1. deathTimeMillis / 1000  (proto #104; v11.18 实测不存在)
    2. damageDeathTimes         (Type 8 sub_type 8, sub=3 累计 HP 伤害达 threshold)
    3. hybrid EntityLeave / Position:
       a) EntityLeave > 0 且 Position > 0 且 Position > EntityLeave + 5s → Position
       b) EntityLeave > 0 → EntityLeave
       c) 否则 → Position
```

**Layer 2 (damageDeathTimes)：** 遍历 Type 8 subtype 8 body[13]=3 (direct HP damage) 事件，按时间累计 victimEid→accountId 的 HP 伤害量。threshold = min(proto.damageReceived, sub3_total) — 当累计值首次 ≥ threshold 时，该事件时钟即为死亡时间。解决旧 EntityLeave 假阳性（临时离场而非阵亡）和 Position 在部分模式中实体不停止的问题。

**Layer 3 假阳性检测：** EntityLeave 常有临时离场事件被误判为阵亡。若同玩家有 EntityLeave 和 Position 数据，且最后 Position 时间比最后 EntityLeave 晚 5 秒以上，以 Position 为准。

---

## meta.json（14 个键）

| # | 键 | 类型 | 单位 | 示例值 | 说明 | 是否解析 |
|---|-----|------|------|--------|------|---------|
| 1 | `version` | string | — | `"11.18.0_china_apple"` | 游戏版本 | 是 → `Battle.version` |
| 2 | `title` | string | — | `""` | 回放标题（通常为空） | 否 |
| 3 | `dbid` | string | — | `"3125699886"` | 录像者数据库 ID | 否 |
| 4 | `playerName` | string | — | `"WHAT_HPSHARING"` | 录像者昵称 | 是 → `Battle.recorder` |
| 5 | `battleStartTime` | string | Unix 秒 | `"1781873222"` | 战斗开始时间戳 | 是 → `Battle.startTime` |
| 6 | `playerVehicleName` | string | — | `"S16_Kranvagn"` | 录像者车辆名 | 是 → `Battle.recorderVehicle` |
| 7 | `mapName` | string | — | `"lagoon"` | 地图内部名 | 是 → `Battle.mapName` |
| 8 | `arenaUniqueId` | string | — | `"1161909687528274499"` | 战斗唯一 ID（去重用） | 否（pickle tuple[0] 作为 `Battle.arenaId`） |
| 9 | `battleDuration` | number | 秒 | `306.19186` | 战斗持续时长（浮点数） | 是 → `Battle.durationS` |
| 10 | `vehicleCompDescriptor` | int | — | `4481` | 车辆组件描述符（== tankId） | 否 |
| 11 | `camouflageId` | int | — | `406` | 涂装 ID | 否 |
| 12 | `mapId` | int | — | `26` | 地图数字 ID | 否（已移除） |
| 13 | `arenaBonusType` | int | — | `1` | 模式类型（**1=随机；2=训练房**；其他=娱乐/联赛等。经真实样本核实，早期"2=随机"系误标——当时分析的是训练房回放） | 是 → `Battle.arenaBonusType`（排行榜仅收 ==1） |
| 14 | `camouflageCustomData` | string | — | `""` | 自定义涂装数据 | 否 |

---

## battle_results.dat 结构

```
pickle: (arenaUniqueId: int, protobuf_bytes: bytes)
```

### 根层 protobuf（13 个字段）

| 字段号 | 类型 | 数量 | 示例值 | 说明 | 是否解析 |
|--------|------|------|--------|------|---------|
| 1 | varint | 1 | `65562` | 未知 — 小整数 | 否 |
| 2 | varint | 1 | `1781873219` | 战斗开始 Unix 秒 | 否 |
| 3 | varint | 1 | `2` | **胜方队伍**（1 或 2） | 是 → `Battle.winnerTeam` |
| 4 | varint | 1 | `1` | 未知 — 小整数 | 否 |
| 5 | varint | 1 | `295` | 未知 — 中整数 | 否 |
| 8 | sub_msg | 1 | (24字段) | **录像者自身战绩**（结构同 #301→#2） | 否 |
| 9 | varint | 1 | `2` | 未知 — 恒为 2 | 否 |
| 11 | bytes | 1 | (空) | 空字节字段 | 否 |
| 150 | sub_msg | 1 | (16字段, ~30KB) | **竞技场统计数据**（见下文） | 否 |
| 201 | sub_msg[] | 15-16 | (2字段/条) | **名册**（玩家信息列表） | 是 |
| 301 | sub_msg[] | 14 | (2字段/条) | **玩家战绩**（每人一条） | 是 |
| 302 | sub_msg | 1 | (4-5条目) | **MVP排行**信息 | 否 |
| 303 | sub_msg | 1 | (2字段) | 未知 — 两个常量值 | 否 |

---

### 字段 #201 — 名册（Roster）

每条 2 个子字段：

| 子字段 | 类型 | 示例值 | 说明 | 是否解析 |
|--------|------|--------|------|---------|
| #1 | varint | `3106010506` | **accountId** | 是 |
| #2 | sub_msg | (8-9字段) | **PlayerInfo** 子消息 | 是 |

#### PlayerInfo（#201→#2）子字段：

| 子字段 | 常量 | 类型 | 示例值 | 说明 | 是否解析 |
|--------|------|------|--------|------|---------|
| **#1** | `R_NICK = 1` | bytes(UTF-8) | `"田_..."` | **昵称** | 是 → `PlayerResult.nickname` |
| **#2** | `R_PLATOON = 2` | varint | `281447127` | **组队 ID** | 是 → `PlayerResult.platoonId` |
| **#3** | — | varint | `1` / `2` | **队伍**（名册来源） | 否（队伍从战绩 #301→#2→#102 获取） |
| **#4** | — | varint | `380362` | 未知 — 车辆相关 ID？ | 否 |
| **#5** | `R_CLAN = 5` | bytes(UTF-8) | `"猫猫乐坏"` | **战队标签** | 是 → `PlayerResult.clan` |
| **#6** | — | bytes(2) | `\x00\x00` | 未知（2 字节零） | 否 |
| **#7** | — | sub_msg | `{#1:1, #2:1}` | 未知 — 徽章标志？ | 否 |
| **#8** | — | varint | `2281982` | **狗牌 ID** | 否 |
| **#9** | — | varint | `1` / `46` | 未知 — 小整数 | 否 |

---

### 字段 #301 — 玩家战绩（PlayerResults）

每条 2 个子字段：

| 子字段 | 类型 | 示例值 | 说明 |
|--------|------|--------|------|
| #1 | varint | `280428036` | 内部 accountId（关联 #301→#2→#25） |
| #2 | sub_msg | (18-27字段) | **PlayerResultInfo** — 实际战绩数据 |

#### PlayerResultInfo（#301→#2）全部字段：

| 字段号 | 常量 | 类型 | 单位 | 示例值 | 说明 | 是否解析 |
|--------|------|------|------|--------|------|---------|
| **#1** | — | varint | HP | `86`-`2291` | 点亮/协助分量（与 #9+#10 独立统计） | 否 |
| **#4** | `F_SHOTS = 4` | varint | 次数 | `5`-`14` | **射击次数** | 是 |
| **#5** | `F_HITS = 5` | varint | 次数 | `3`-`11` | **命中次数** | 是 |
| **#6** | — | varint | 次数 | `1`-`6` | 未知 — 基础命中？ | 否 |
| **#7** | `F_PENS = 7` | varint | 次数 | `2`-`10` | **击穿次数** | 是 |
| **#8** | `F_DAMAGE = 8` | varint | HP | `766`-`4571` | **造成伤害** | 是 |
| **#9** | `F_ASSIST[0] = 9` | varint | HP | `99`-`381` | **协助伤害分量 1** | 是（#9 + #10 求和） |
| **#10** | `F_ASSIST[1] = 10` | varint | HP | `86`-`1726` | **协助伤害分量 2** | 同上 |
| **#11** | `F_RECEIVED = 11` | varint | HP | `349`-`3074` | **受到伤害** | 是 |
| **#12** | `F_HITS_RECV = 12` | varint | 次数 | `2`-`11` | **被命中次数** | 是 |
| **#13** | — | varint | 次数 | `1`-`3` | 未知 — 跳弹？未击穿？ | 否 |
| **#15** | `F_PENS_RECV = 15` | varint | 次数 | `1`-`9` | **被击穿次数** | 是 |
| **#16** | — | varint | 次数 | `1`-`3` | 未知 — HE/溅射命中？ | 否 |
| **#17** | `F_ENEMIES_DMG = 17` | varint | 人数 | `1`-`5` | **击伤敌方数**（不同目标） | 是 |
| **#18** | `F_KILLS = 18` | varint | 人数 | `1`-`3` | **击杀数** | 是 |
| **#23** | — | varint | 经验 | `418`-`2527` | **基础经验**（不含加成） | 否 |
| **#24** | — | varint | — | `63`-`295` | 未知 — 小累计值 | 否 |
| **#25** | — | varint | — | `280428036` | 内部 accountId（关联 #301→#1） | 否 |
| **#32** | — | varint | — | `32`-`477` | 点亮/活动分数？ | 否 |
| **#33** | — | varint | — | `40`-`120` | 关联 #32 | 否 |
| **#101** | `F_ACCOUNT = 101` | varint | — | `3100730745` | **accountId**（Wargaming ID） | 是 |
| **#102** | `F_TEAM = 102` | varint | — | `1` / `2` | **队伍** | 是 |
| **#103** | `F_TANK = 103` | varint | — | `4481` | **车辆 ID**（tankId） | 是 |
| **#104** | `F_DEATH_TIME = 104` | varint | 毫秒 | `0`（默认） | ⚠️ **死亡时刻**（存活/缺失=0） | 是 → `deathTimeMillis` |
| **#105** | `F_SURVIVED = 105` | varint | — | `0xFFFFFFFFFFFFFFFF`(-1) | **存活标志**：`-1`=存活，缺失=阵亡 | 是 |
| **#106** | — | varint | 银币 | `68600`-`542712` | **获得银币** | 否（已移除） |
| **#107** | — | varint | — | `1104555167` | 未知 — 大整数，类似哈希 | 否 |
| **#116** | — | varint | — | `262392` | 未知 | 否 |
| **#117** | `F_BLOCKED = 117` | varint | HP | `410`-`1620` | **跳弹/未击穿伤害**（装甲阻挡） | 是 |
| **#118** | — | varint | — | `6`-`176` | 未知 — 小整数 | 否 |
| **#119** | — | varint | — | `1` / `2` | 未知 — 少量 | 否 |
| **#120** | — | varint | — | `2` / `3` | 未知 — 部分存活玩家有 | 否 |
| **#122** | — | sub_msg | — | `{#5:5}` | 未知 — 单字段子消息 | 否 |

> **⚠️ 字段 #104 现状：** 在 v11.18 sample 回放的 `PlayerResultInfo` 中 **实际不存在**（protobuf 字节级确认无 #104 标签）。`Protobuf.firstLong(…,0)` 返回默认值 `0`，因此 fallback 自动落到第 2 层（Damage）。此字段可能在新版本回放中存在，代码保持兼容。

### 字段 #106 说明

`#106` 的值域（`68600`-`542712`）与银币数量级吻合，此前被解析为 `credits`（已移除）。其数值约为基础经验（#23）的 `20-200` 倍，取决于加成/高级账号。

---

### 字段 #150 — 竞技场统计数据（~30KB）

16 个子字段，包含丰富的分车辆/分玩家统计和成就事件。

| 子字段 | 类型 | 值 | 说明 |
|--------|------|----|------|
| #8 | bytes(4) | `00000000` | 恒为 4 字节零 |
| #9 | bytes(2) | `0000` | 恒为 2 字节零 |
| #10 | bytes(2) | `0000` | 恒为 2 字节零 |
| #12 | varint | `1` | 常量 |
| #13 | varint | `15` | 最大队伍数？ |
| #14 | varint | `15` | 每队最大玩家数？ |
| #15 | varint | `10` | 1 队实际人数 |
| #16 | varint | `10` | 2 队实际人数 |
| #17 | varint | `10` | 未知 |
| **#20** | sub_msg | (28字段) | **玩家统计数组**（一队） |
| **#21** | sub_msg | (1字段) | 队伍统计变体 |
| **#22** | sub_msg | (28字段) | **玩家统计数组**（另一队） |
| **#23** | sub_msg | (1字段) | 队伍统计变体 |
| #25 | bytes(2) | `0000` | 2 字节零 |
| #26 | bytes(2) | `0000` | 2 字节零 |
| **#114** | sub_msg[] | (6-8条) | **成就/事件列表** |

#### #150→#20/#22 — 玩家统计子消息（28 字段）

| 子字段 | 类型 | 示例值 | 说明 |
|--------|------|--------|------|
| #5[0] | fixed32 | `134220032` | 玩家/车辆 ID |
| #5[1] | fixed32 | `111692050` | 另一个 ID |
| #5[2] | sub_msg | (36字段: #401-#476) | **分车辆统计数据** |
| #6 | sub_msg | (3字段: #601, #604, #605) | 战斗结果标志 |
| #7 | sub_msg | (5字段: #701-#708) | 战区/位置数据 |
| #8 | sub_msg | (2字段: #801, #802) | 会话/活动数据 |
| #9 | sub_msg[] | (89条) | **装备/消耗品使用**（#901=类型ID, #902=次数） |
| #19 | sub_msg | (18字段: #1103-#1128) | **伤害明细分解** |
| #25 | varint | `9` | 常量 |
| #26 | sub_msg | (3字段) | 未知 |
| #27 | bytes | (空) | 空 |
| #28 | sub_msg | (1字段: #4) | 未知 |
| #102 | varint | `141` | 伤害变体 |
| #103 | varint | `100` | 命中变体 |
| #104 | varint | `39` | 击穿变体 |
| #105 | varint | `77` | 受击变体 |
| #106 | varint | `76` | 射击变体 |
| #107 | varint | `204` | 阻挡变体 |
| #108 | varint | `204` | 阻挡变体（同 #107） |
| #109 | varint | `1520` | 经验变体 |
| #110 | varint | `1357` | 经验变体 |
| #111 | varint | `242` | 未知 |
| #112 | varint | `431633` | **对车辆总伤害**（分车伤害和） |
| #113 | varint | `302161` | **协助总伤害**（分车协助和） |
| #115 | varint | `97` | 未知 |
| #116 | varint | `44` | 未知 |
| #117 | varint | `2153` | 阻挡伤害变体 |
| #118 | varint | `1650` | 未知 |
| #119 | varint | `106835` | **总经验**（可能含加成） |
| #120 | varint | `16` | 未知 |

#### #150→#114 — 成就/事件列表

每条含 #1=事件类型ID、#2=次数？、#3=参数？、#4=值：

| 事件类型 | 说明 |
|----------|------|
| `#1=1` | 击杀/里程碑（#4=伤害值） |
| `#1=3` | 团队事件 |
| `#1=5` | 阻挡里程碑（#4=阻挡伤害） |
| `#1=8` | 命中里程碑？ |
| `#1=15` | 存活事件 |
| `#1=17` | 协助里程碑（#4=协助伤害） |

---

### 字段 #302 — MVP 排行

4-5 条记录，每条含：
- `#1 = accountId`
- `#2 = sub_msg` — 未知标志位

---

## 当前解析字段总表

### 单场展示列（Columns.java）

| 列 key | 类型 | 来源字段 | 单位/格式 | 说明 |
|--------|------|----------|-----------|------|
| `nickname` | 文本 | `PlayerResult.nickname` | — | 昵称（名册 #201→#2→#1） |
| `clan` | 文本 | `PlayerResult.clan` | — | 战队（名册 #201→#2→#5） |
| `tank_name` | 文本 | `Tankopedia.info(tankId).name()` | — | 车辆名（查表） |
| `tank_tier` | 整数 | `Tankopedia.info(tankId).tier()` | 等级 | 车辆等级（查表） |
| `tank_type` | 文本 | `Tankopedia.info(tankId).type()` | — | 车辆类型（查表） |
| `tank_nation` | 文本 | `Tankopedia.info(tankId).nation()` | — | 国家（查表） |
| `rating` | 整数 | `PlayerResult.rating` | 评分 | EC 标准化评分（Rating 计算） |
| `survived_label` | 文本 | `PlayerResult.survived` | — | 存活/阵亡（#105==-1 → 存活） |
| `kills` | 整数 | `PlayerResult.kills` | 人数 | #18 |
| `damage_dealt` | 整数 | `PlayerResult.damageDealt` | HP | #8 |
| `damage_assisted` | 整数 | `PlayerResult.damageAssisted` | HP | #9 + #10 |
| `damage_received` | 整数 | `PlayerResult.damageReceived` | HP | #11 |
| `damage_blocked` | 整数 | `PlayerResult.damageBlocked` | HP | #117 |
| `survival_time` | 浮点数 | `PlayerResult.survivalTimeSec` | 秒 | 存活者=durationS，阵亡者=#104>Damage>hybrid EntityLeave/Position |
| `n_shots` | 整数 | `PlayerResult.nShots` | 次数 | #4 |
| `n_hits_dealt` | 整数 | `PlayerResult.nHitsDealt` | 次数 | #5 |
| `n_penetrations_dealt` | 整数 | `PlayerResult.nPenetrationsDealt` | 次数 | #7 |
| `hit_rate` | 浮点数 | `nHitsDealt / nShots * 100` | % | 推导 |
| `pen_rate` | 浮点数 | `nPenetrationsDealt / nShots * 100` | % | 推导 |
| `n_hits_received` | 整数 | `PlayerResult.nHitsReceived` | 次数 | #12 |
| `n_penetrations_received` | 整数 | `PlayerResult.nPenetrationsReceived` | 次数 | #15 |
| `n_enemies_damaged` | 整数 | `PlayerResult.nEnemiesDamaged` | 人数 | #17 |
| `platoon_label` | 文本 | `PlayerResult.platoonLabel` | — | 组队标记（名册 #201→#2→#2 推导） |
| `tank_id` | 长整数 | `PlayerResult.tankId` | — | #103 |
| `account_id` | 长整数 | `PlayerResult.accountId` | — | #101 |

### 汇总列（AggregateSheets / AGG_COLS）

| 列 key | 类型 | 计算方式 | 单位 |
|--------|------|----------|------|
| `battles` | 整数 | Sum | 场次 |
| `wins` | 整数 | Sum（team==winnerTeam） | 场次 |
| `win_rate` | 浮点数 | `wins/battles * 100` | % |
| `survival_rate` | 浮点数 | `survived/battles * 100` | % |
| `survival_avg` | 浮点数 | `survivalSum/battles` | 秒 |
| `rating_avg` | 浮点数 | `ratingSum/battles` | 评分/场 |
| `kills` | 整数 | Sum | 人数 |
| `kills_avg` | 浮点数 | `kills/battles` | 人数/场 |
| `damage` | 整数 | Sum | HP |
| `damage_avg` | 浮点数 | `damage/battles` | HP/场 |
| `assisted` | 整数 | Sum | HP |
| `assisted_avg` | 浮点数 | `assisted/battles` | HP/场 |
| `received_avg` | 浮点数 | `received/battles` | HP/场 |
| `blocked_avg` | 浮点数 | `blocked/battles` | HP/场 |
| `hit_rate` | 浮点数 | `hits/shots * 100` | % |
| `pen_rate` | 浮点数 | `pens/shots * 100` | % |
| `shots` | 整数 | Sum | 次数 |
| `hits` | 整数 | Sum | 次数 |
| `pens` | 整数 | Sum | 次数 |
| `enemies_damaged_avg` | 浮点数 | `enemiesDamaged/battles` | 人数/场 |
| `tanks` | 文本 | `Map<车辆名, 场次>` | — |
| `account_id` | 长整数 | — | — |

---

## 单位速查

| 含义 | 单位 | 说明 |
|------|------|------|
| 伤害值 | **HP** | 游戏内生命值点数 |
| 存活时间 | **秒** | 3 层 fallback（#104→Damage→hybrid EntityLeave/Position） |
| 战斗时长 | **秒** | `meta.json#battleDuration`（浮点） |
| 时间戳 | **Unix 秒** | 自 1970-01-01 起的秒数 |
| 次数/计数 | **次** | 射击/命中/击杀/人数 |
| 百分比 | **%** | `0.0-100.0` |
| 评分 | **rating** | EC 归一化评分（≈200-1500） |
| 银币 | **银币** | 字段 #106（未使用） |
| 经验 | **经验** | 字段 #23（未使用） |

---

## 已知问题

### 1. 死亡时间估算精度

字段 #104（`F_DEATH_TIME`）在 v11.18 sample 回放的 `PlayerResultInfo`（#301→#2）中 **实际不存在**。

当前 fallback 方案：

| 层级 | 来源 | 适用场景 | 精度 |
|------|------|----------|------|
| 1 | proto #104 | 新版本回放（含此字段） | 精确 ms |
| 2 | Damage (Type 8 sub 8 sub=3) | 所有受到直接 HP 伤害的阵亡玩家 | 秒级（伤害事件间隔） |
| 3 | EntityLeave / Position (hybrid) | EntityLeave 有假阳性时以 Position 为准 | 秒级 |

Layer 2 为 **2026-06 新增**，解决了旧方法的两个缺陷：
- EntityLeave 假阳性（实体临时离场被误判为阵亡）
- Position 在一些模式里实体坐标持续更新至战斗结束（spectator 实体，阵亡不停止）

**EntityLeave 限制：** EntityLeave（type 4）并非所有阵亡玩家都触发——约 30-50% 的死亡对应的实体不产生 leave 事件。需要 entity_id↔account_id 映射（来自 method 48 updateArena2 protobuf）。某些实体会多次 leave/enter，取最后一次 keep。部分 leave 是**假阳性**（临时离场而非阵亡），通过 Position 识别：若 Position 最后时间显著晚于 EntityLeave（>5s），以 Position 为准。

**Position 补充：** Position（type 10）覆盖大多数玩家实体，是比 EntityLeave 更可靠的死亡指标。阵亡后实体停止发送坐标更新。Damage 层已在第 2 层优先处理，EntityLeave/Position 仅作为第 3 层兜底。

### 2. 战斗时长上限

`meta.json#battleDuration` 已按标准随机战 7 分钟截断：`Math.min(val, 420)`。

### 3. 未解析的潜在有用数据

- `#301→#2→#23` — 基础经验
- `#301→#2→#1` — 单独统计的点亮协助分量
- `#150` — 丰富的分车统计/成就事件
- `#302` — MVP 排行数据
