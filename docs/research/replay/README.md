# WoT Blitz Replay Protocol Research Archive

本目录用于系统记录 WotBTools 对 `.wotbreplay` 的逆向研究。

## 研究原则

- 所有语义必须区分 `PROVEN / PARTIAL / UNKNOWN / SUPERSEDED / DEPRECATED`。
- `PROVEN` 必须有真实回放行为闭环；能够找到独立 schema / 客户端代码 / 多 POV 交叉证据时必须记录。
- 不允许为了业务方便把未知字段直接命名成猜测语义。
- 所有结论必须记录已验证版本与样本范围；当前主要样本为 Blitz 11.18/11.19。
- settlement、event stream、multi-POV 三类证据必须区分来源与精度。

## 文档索引

- `protocol.md`：现有协议总表与历史逆向记录。
- `death-and-battle-clock.md`：死亡时间、lifeTime、killerID、deathReason、battle-start 时钟研究。
- `inventory.md`：当前样本集的协议结构盘点与待研究项。

## 当前 canonical 结论摘要

### 已证明

- `.wotbreplay` 为 ZIP 容器，核心成员包括 `meta.json`、`data.wotreplay`、`battle_results.dat`。
- `data.wotreplay` packet framing 为 `payload_len(u32 LE) + type(u32 LE) + rawClock(f32 LE) + payload`。
- Type 7 / `propId=3` 为当前血量；正值为实际 HP，`0` 为死亡终态；部分负 sentinel 需要单独建模。
- Type 8 / subtype 48 提供 updateArena2 protobuf wrapper；已证明 wrapper 1 为 roster、wrapper 3 为 arena period、wrapper 13 为实时争霸点数。
- `ARENA_PERIOD.BATTLE = 3`。
- battle results player field 24 为 `lifeTime`，field 25 为 `killerID`，field 105 为 `deathReason`。
- 当前真实样本中 `deathReason=1/2/3` 分别闭环为 fire / ramming / world_collision。
- `lifeTime` 是服务器结算的最近整数秒生存时长，而不是 floor；客户端观察到的 arena-period packet 存在亚秒级接收/记录抖动。
- 单 POV replay 无法保证每个阵亡玩家都有亚秒级死亡事件；settlement `lifeTime` 可提供服务器整数秒级死亡事实。
- 相同 arena 的多 POV 事件时钟基本共享同一时间轴，已观测对应死亡事件差异通常小于约 0.1 秒。

### 仍需研究

见 `inventory.md`。未知项必须保持 UNKNOWN/PARTIAL，直到获得足够证据。
