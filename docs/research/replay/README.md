# WoT Blitz Replay Protocol Research Archive

本目录用于系统记录 WotBTools 对 `.wotbreplay` 的逆向研究。

## 研究原则

- 所有语义必须区分 `PROVEN / PARTIAL / UNKNOWN / SUPERSEDED / DEPRECATED`。
- `PROVEN` 必须有真实回放行为闭环；能够找到独立 schema / 客户端代码 / 多 POV 交叉证据时必须记录。
- 不允许为了业务方便把未知字段直接命名成猜测语义。
- 所有结论必须记录已验证版本与样本范围；当前主要样本为 Blitz 11.18/11.19。
- settlement、event stream、multi-POV 三类证据必须区分来源与精度。
- packet/method/property 数字必须按 client version 与 entity class 解释；不能把历史版本索引直接套到当前 Blitz。

## 文档索引

### 总览与容器

- `protocol.md`：历史协议总表与既有逆向记录。
- `inventory.md`：当前样本集完整协议 surface、状态矩阵与待研究项。
- `container-format.md`：ZIP 成员与 `data.wotreplay` 头部结构。
- `packet-stream.md`：严格 packet framing、真实 packet-type inventory、零长度 Type17 等。
- `low-frequency-packets.md`：Type14/17/28/29/36/terminator 等低频结构。

### Entity / RPC

- `entity-routing.md`：entity-class scoped method/property 解释原则与目标实体分类。
- `entity-properties.md`：Type7 property 全量 inventory、HP、engine-mode 等。
- `entity-methods.md`：Type8 method 全量 inventory、subtype48 wrapper inventory。
- `chat-actions.md`：当前 11.19 Avatar method47 / `CHAT_ACTION_DATA`。
- `avatar-synchronized-options.md`：Avatar method49 zlib + Python-pickle 同步客户端配置。
- `avatar-shot-results.md`：Avatar method38 recorder shot-result/hit-feedback、settlement hits 一致性、结构化 critical/module token-state 结果。
- `loadout-materialization.md`：Vehicle Type5 的 6-item consumable/provision descriptor、9-char equipment-slot 编码及当前已闭环映射。

### 战斗事实

- `death-and-battle-clock.md`：`lifeTime`、`killerID`、`deathReason`、死亡证据、battle-start 时钟、多 POV。
- `battle-results.md`：`battle_results.dat` / #301 settlement protobuf inventory。
- `capture-probe.md`：基地/占领相关研究。
- `team-weapon-telemetry.md`：wrapper15 本方武器/装填状态流。
- `adrenaline-and-gun-feed.md`：单发/弹夹负控制、Adrenaline 快装填效应、不同供弹系统状态族。
- `projectile-lifecycle.md`：shotId、projectile/tracer launch、`stopTracer` endpoint 与 terminal-resolution companion。
- `type32-entity-effects.md`：Type32 实体级长度前缀 auxiliary blob；旧 `kind` / runtime-double 解释已废弃。
- `consumable-lifecycle.md`：Type32 mobile `flag=0` 消耗品初始化、激活、持续结束/冷却与 teardown 状态流。
- `wrapper7-avatar-ready-wrapper16-state.md`：wrapper16 ordinary observed-by-enemy state1、Tracer/forced-observation state8 与 T-100 LT/Rhm 方向性研究。
- `avatar-method19-vehicle-misc-status.md`：method19 code1 `IS_OBSERVED_BY_ENEMY` 与 code7 自动修复进度。
- `fire-and-repair-states.md`：Type32 mobile short `...04` 火灾关联、fire-DOT、0x0B/0x0D 灭火差分、Vehicle prop8 recoverable-state token 与机械修复行为。
- `crew-injury-candidates.md`：0x0C First Aid 前置受击、Type32 short packed event-family、0x27/0x29/0x2B crew/tankman-extra 候选与负证据边界。

## 当前 canonical 结论摘要

### 已证明

- `.wotbreplay` 为 ZIP 容器，核心成员包括 `meta.json`、`data.wotreplay`、`battle_results.dat`。
- `data.wotreplay` packet framing 为 `payload_len(u32 LE) + type(u32 LE) + rawClock(f32 LE) + payload`；零长度 payload 合法。
- Type7 / Type8 数字索引必须结合 entity class 与版本解释。
- Vehicle `propId=3` 为当前 HP；Type5 materialization 同样提供当前/开局实际 HP，包括配置带来的 HP 变化。
- Type8 subtype48 提供 arena-update protobuf wrapper；已证明 roster、period、frag-count、death-info、争霸占领以及 observation-state family。
- `ARENA_PERIOD.BATTLE = 3`。
- battle results player field24 为 `lifeTime`，field25 为 `killerID`，field105 为 `deathReason`；当前 `deathReason=1/2/3` 分别闭环为 fire / ramming / world_collision。
- 单 POV replay 无法保证每个阵亡玩家都有亚秒级死亡 event；settlement `lifeTime` 可作为整数秒级 fallback。
- wrapper15 是本方 gun-feed/weapon telemetry；Avatar method35 是当前 effective full reload-duration/config update。
- Avatar method20 为 `stopTracer(shotId,endPoint)`；method29 为 global projectile launch family。
- Type32 mobile 已闭环 Adrenaline、Engine Power Boost、Multi-Purpose Restoration Pack、First Aid Kit、Repair Kit、Improved Engine Power Boost、Reticle Calibration、Reactive Armor、Tungsten Shells 等动态道具生命周期。
- Avatar method19 code1 = recorder vehicle observed by enemy；wrapper16 state1 = own-team ordinary observed-by-enemy entry/re-entry event。
- wrapper16 state8 = recipient-side forced-observation state family；Rhm. Pzw. valid surviving hit 23/23 触发；T-100 LT shooter POV 进一步证明 state8 不是 shooter acknowledgement。
- Vehicle Type5 直接携带 battle loadout：6-item consumable/provision descriptor + 9-character equipment-selection string；当前已闭环 equipment slot4 与 slot8 的行为映射。
- Vehicle prop8 是 count-prefixed recoverable/negative-state token collection，不能简单等同单一 damagedModules 列表。
- Avatar method38 是 recorder shot-result/hit-feedback family，并与 recorder settlement hits 高度闭环。

### 当前业务优先级

PR147 不以“所有 cosmetic/profile 字段全部命名”为完成标准。优先继续解决会影响 WotBTools 业务事实的内容：

1. loadout raw code -> 11.19 当前装备/物资名称映射；
2. method16 剩余高价值 module / crew device IDs；
3. 少量会改变 AI Review / Battle Playback 事实的特殊 combat state；
4. 对未知业务字段保持 fail-safe raw-preserve，而不是猜 semantic。

外观、profile、cosmetics、纯客户端常量等低业务价值字段可留给 future research，不阻塞当前协议研究收口。
