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

### 战斗事实

- `death-and-battle-clock.md`：`lifeTime`、`killerID`、`deathReason`、死亡证据、battle-start 时钟、多 POV。
- `battle-results.md`：`battle_results.dat` / #301 settlement protobuf inventory。
- `capture-probe.md`：基地/占领相关研究。
- `team-weapon-telemetry.md`：wrapper15 本方武器/装填状态流。
- `adrenaline-and-gun-feed.md`：单发/弹夹负控制、Adrenaline 快装填效应、不同供弹系统状态族。
- `projectile-lifecycle.md`：shotId、projectile/tracer launch、`stopTracer` endpoint 与 terminal-resolution companion。
- `type32-entity-effects.md`：Type32 实体级长度前缀 auxiliary blob；旧 `kind` / runtime-double 解释已废弃。
- `consumable-lifecycle.md`：Type32 mobile `flag=0` 消耗品初始化、激活、持续结束/冷却与 teardown 状态流；已闭环 First Aid / Repair / Multi-Purpose Restoration Pack。
- `fire-and-repair-states.md`：Type32 mobile short `...04` 火灾关联、fire-DOT、0x0B/0x0D 灭火差分、Vehicle prop8 recoverable-state token 与机械修复行为。
- `crew-injury-candidates.md`：0x0C First Aid 前置受击、Type32 short packed event-family、0x27/0x29/0x2B crew/tankman-extra 候选与负证据边界。

## 当前 canonical 结论摘要

### 已证明

- `.wotbreplay` 为 ZIP 容器，核心成员包括 `meta.json`、`data.wotreplay`、`battle_results.dat`。
- `data.wotreplay` packet framing 为 `payload_len(u32 LE) + type(u32 LE) + rawClock(f32 LE) + payload`；零长度 payload 合法，Type17 在当前 corpus 中 44/44 出现。
- Type7 / Type8 数字索引必须结合 entity class 与版本解释。
- Type 7 / Vehicle `propId=3` 为当前血量；正值为实际 HP，`0` 为死亡终态；部分负 sentinel 需要单独建模。
- Type 8 / current Avatar method47 为 `CHAT_ACTION_DATA`；method49 为压缩的同步客户端/UI/控制配置。
- Type 8 / subtype48 提供 arena-update protobuf wrapper；已证明 roster、period、frag-count、death-info 与实时争霸点数等多个 family。
- `ARENA_PERIOD.BATTLE = 3`。
- battle results player field24 为 `lifeTime`，field25 为 `killerID`，field105 为 `deathReason`。
- 当前真实样本中 `deathReason=1/2/3` 分别闭环为 fire / ramming / world_collision。
- `lifeTime` 是服务器结算的最近整数秒生存时长，而不是 floor；客户端观察到的 arena-period packet 存在亚秒级接收/记录抖动。
- 单 POV replay 无法保证每个阵亡玩家都有亚秒级死亡 event；settlement `lifeTime` 可提供服务器整数秒级死亡事实。
- 相同 arena 的多 POV 事件时钟基本共享同一时间轴，已观测对应死亡事件差异通常小于约 0.1 秒。
- wrapper15 是本方 gun-feed/weapon telemetry，而不是敌方 visibility stream；单发与非单发车辆使用不同状态族。
- 单发车辆 `field2=3` 与 shot count / reload duration 闭环；约 `0.853` 动态快档在当前 corpus 中行为上可确定为 Adrenaline reload effect，低 HP 技能解释已由高血量反例排除。
- Kranvagn/Felice 不允许 Adrenaline 且不使用单发 `field2=3` family；其 `field2=7` 与 shots 呈一对一/仅缺失的关系并携带稳定的 gun-cycle timer，证明 wrapper15 是供弹机制感知的状态机。
- Avatar method20 为 `stopTracer(shotId,endPoint)`；method29 为 projectile/tracer launch family，其 launch vector 与 `endPoint-startPoint` 在约 98.8% 样本中方向余弦 >0.99。
- Type32 为 `entityId + flag + bodyLength + body`；16,850/16,850 长度闭合并同时路由到 Type5 mobile/static 实体。mobile `flag=0` 长 body 含 `float64` event clock，并已闭环 Adrenaline、Engine Power Boost、Multi-Purpose Restoration Pack、First Aid Kit、Repair Kit、Improved Engine Power Boost、Reticle Calibration、Reactive Armor、Tungsten Shells 等消耗品生命周期。
- Type32 mobile `flag=1` short `...04` family 与火灾闭环：4/4 settlement fire death 的终末燃烧链出现该 family；`0x0B` 会终止周期 fire-DOT，而 `0x0D` 不会。
- Vehicle prop8 是 count-prefixed recoverable/negative-state token collection；部分 token 可被 `0x0B` 与 `0x0D` 共同清除，另一些当前只观察到 `0x0B` 清除，因此不能简化成单一 `damagedModules` 列表。
- `0x0C` First Aid 的 5/5 当前样本均在约 0.8–2.2 秒前有同实体真实 method8 damage event；但 prop8、method8 `(1,3,2)` 粗字段与 Type32 long `body[2]=2` 均已被全量反证为非 crew-specific，具体 injured crew wire surface 仍为 PARTIAL。
- Avatar method38 是 recorder shot-result/hit-feedback family：严格 34-arena corpus 中 295/295 method38 都与同钟 recorder→victim direct-damage RPC 对齐，且全 corpus method38 总数 295 与 recorder settlement hits 295 精确相等；主 variant 281/295 可解析为 `victimVehicleId + 4-byte header + count + repeated(token,rawState) + tail`。

### 仍需研究

见 `inventory.md` 以及各专题文档的 `Remaining work`。未知项必须保持 UNKNOWN/PARTIAL，直到获得足够证据。
