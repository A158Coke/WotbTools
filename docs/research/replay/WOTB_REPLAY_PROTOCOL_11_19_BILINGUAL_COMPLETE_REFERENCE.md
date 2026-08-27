# WoT Blitz 11.19 Replay Protocol / WoT Blitz 11.19 回放协议
## Bilingual Complete Reverse-Engineering & WotBTools Implementation Reference / 中英双语完整逆向与实现参考

> **Scope / 范围**  
> WoT Blitz `11.19.0_china` / `11.19.0_china_apple`, WotBTools replay research archive, PR147 controlled probes, and the current `main` implementation as of the PR147 research cycle.
>
> **Authority / 权威性**  
> This document is the new top-level protocol reference. It distinguishes **protocol truth proved by replay evidence** from **what the current `main` branch already implements**.  
> 本文档是新的顶层协议权威参考。它明确区分：**由回放证据证明的协议事实** 与 **当前 `main` 分支已经实现的能力**。
>
> **Current research gate / 当前研究门槛**
>
> ```text
> P0 replay-protocol blockers = 0
> P1 replay-protocol blockers = 0
>
> Movement / Type10 P1       = CLOSED
> method38 0x0200 P1         = CLOSED
> method36 high-value roles  = CLOSED
>
> Remaining work = P2/P3/private-symbol recovery, low-frequency enums,
>                  implementation convergence, documentation maintenance,
>                  and future-version regression.
> ```

---

# 0. How to read this document / 如何阅读本文档

## 中文

WotBTools 的回放逆向研究使用以下证据等级：

| 等级 | 定义 |
|---|---|
| `PROVEN` | 当前版本 replay 行为已经闭合物理/业务语义；在声明的版本与范围内可安全使用 |
| `VERY STRONG PARTIAL` | 行为已被强约束，但仍缺少精确私有符号、低样本扩展验证或直接 schema |
| `PARTIAL` | 结构/语义家族已知，但精确名称、单位或完整规则尚未闭合 |
| `UNKNOWN` | 字节/ID 已观察并保留，但不能安全命名 |
| `SUPERSEDED` | 旧解释已被更强证据替代 |
| `REJECTED` | 当前证据直接反驳该解释 |

非协商规则：

1. packet ID、method ID、property ID、component ID、enum 全部按 **client version + entity class** 解释。
2. 历史 PC WoT / BigWorld schema 可以做架构 cross-check，但不能把 ordinal 直接移植到当前 Blitz。
3. 单 POV replay 不是 omniscient telemetry；AoI/visibility 缺口是真实信息边界。
4. UNKNOWN 必须 raw-preserve；不能因为 UI/AI 需要一个名字就强行命名。
5. 业务展示名称不能强于证据等级。
6. controlled replay 优先于相关性猜测。
7. “业务不阻塞”与“字段低价值”是两个不同判断；研究优先级与业务关键性必须分轴记录。
8. 如果历史解释与 controlled current replay 冲突，以 current controlled replay 为准。

## English

WotBTools grades replay evidence as follows:

| Grade | Definition |
|---|---|
| `PROVEN` | Current-version replay behavior closes the physical/business role within the stated scope |
| `VERY STRONG PARTIAL` | Strongly constrained behavior, but exact private symbol, low-N generalization, or direct schema is still missing |
| `PARTIAL` | Structure/family is known, exact name/unit/full rule is not |
| `UNKNOWN` | Bytes/IDs are observed and preserved but cannot be safely named |
| `SUPERSEDED` | An older interpretation was replaced by stronger evidence |
| `REJECTED` | Current evidence contradicts the interpretation |

Non-negotiable rules:

1. Packet, method, property, component and enum IDs are **client-version and entity-class scoped**.
2. Historical PC WoT / BigWorld material is an architectural cross-check, not an ordinal source of truth for current Blitz.
3. A single-POV replay is not omniscient telemetry; AoI/visibility gaps are real information boundaries.
4. Unknown values must be raw-preserved.
5. User-facing labels must not be stronger than the evidence grade.
6. Controlled replay evidence outranks correlation.
7. “Non-blocking for current product” does not mean “low research value”.
8. Current controlled evidence outranks historical naming when they conflict.

---

# 1. Source precedence / 信息源优先级

## 中文

当多个文件或实现发生冲突时，按以下顺序判断：

1. **本文档**：`WOTB_REPLAY_PROTOCOL_11_19_BILINGUAL_COMPLETE_REFERENCE.md`
2. 当前版本 focused closure 文档，例如：
   - `type10-movement-transform-closure.md`
   - `method38-0200-device-not-pierced-closure.md`
   - `reticle-calibration-method36-closure.md`
   - `gun-damage-dispersion-closure.md`
   - `method36-vertical-gun-speed-controlled-closure.md`
   - `precision-fire-method38-extension.md`
   - `drowning-deathreason-closure.md`
3. `inventory.md` 与 `research-completion-audit-11.19.md`
4. 原英文 `WOTB_REPLAY_PROTOCOL_11_19_COMPLETE_REFERENCE.md`
5. 早期 broad research notes / `protocol.md`
6. `main` 中 11.18-era reference docs：用于说明当前实现历史，不可反向覆盖 11.19 controlled truth。

**特别注意：** `main/docs/reference/replay-data.md` 和部分 Java 注释仍保留早期解释，例如 Type4 death heuristic、Type10 尾字节 `is_error/onGround` 假设、Type8 direct-damage raw 值等。本文档会明确标注这些 implementation debt。

## English

When sources conflict, use this precedence:

1. **This document**
2. Current-version focused closure documents
3. `inventory.md` and `research-completion-audit-11.19.md`
4. The older English complete reference
5. Historical broad notes such as `protocol.md`
6. `main` 11.18-era references, which describe implementation history and must not override current 11.19 controlled evidence.

Several `main` docs/comments intentionally lag the research archive. This document calls out those gaps explicitly.

---

# 2. Canonical corpus and controlled probes / 样本集与受控实验

## 中文

原 canonical corpus：

```text
unique arenas                         34
settled player results               476
unique recorder method29 shotIds     324
settlement recorder shots            324
method38 recorder hit feedback       295
settlement recorder hits             295
settled dead combatants              287
live sub-second terminal closure     283 / 287 = 98.61%
settlement-second fallback             4 / 287 = 1.39%
```

录像者 shot 总数：

```text
A178_SPHT       222
GB13_FV215b      32
J20_Ho_Ri_type3  17
Maus             49
VK 72.01          4
TOTAL            324
```

旧的 341-shot Type28 汇总已 `SUPERSEDED`。

在 corpus 之外，11.19 受控实验至少覆盖：

- drowning / 正 HP 终止死亡；
- FV215b 弹种重复切换；
- Tungsten Shells；
- Precision Fire；
- Precision Fire + Tungsten 同发共存；
- Maus Fuel Tank / Observation Device；
- P65 Gun/barrel 多批次损坏、critical、自修复、Repair；
- TVP ricochet / spaced armor / mantlet；
- WZ-120 HE direct penetration / no-pen / track / spaced/mantlet / splash；
- WZ-120 movement / hull rotation / turret-only rotation；
- Maus vertical gun-pitch speed；
- Kranvagn Reticle Calibration；
- Kanonenjagdpanzer 105 正/倒车极速，用于 Type10 米制标定；
- Rhm + Speed Booster 腾空轨迹，用于 Type10 垂直运动与尾字节反例；
- Quby → Maus 第一梭子炮管、第二梭子油箱，用于 `method38 0x0200` closure。

## English

The base corpus contains 34 unique arenas and 476 settled players. Recorder shot totals cross-check exactly at 324. Later controlled 11.19 probes intentionally target low-frequency or ambiguous mechanics, including drowning, ammunition switching, special shell modifiers, component damage, penetration-layer flags, targeting coefficients, movement scale, airborne physics, and the previously unobserved `method38 0x0200` bit.

Controlled probes are version-current evidence and are not silently folded into the original 34-arena count ledger.

---

# 3. `.wotbreplay` container / 回放容器

## 中文

`.wotbreplay` 是 ZIP 容器，核心条目：

```text
meta.json
data.wotreplay
battle_results.dat
```

`data.wotreplay` header：

```text
magic               u32 LE = 0x12345678
unknownHeader       8 bytes
clientHashLength    u8
clientHash          bytes[clientHashLength]
clientVersionLength u8
clientVersion       bytes[clientVersionLength]
padding             u8
```

packet stream：

```text
payloadLen          u32 LE
type                u32 LE
rawClockSec         f32 LE
payload             bytes[payloadLen]
```

安全规则：

- packet 起始偏移必须动态计算，不能 hard-code `66`；
- zero-length payload 合法；
- canonical research parser 的默认策略是 strict contiguous framing；
- 对未知 surface 保留 raw packet；
- 当前 corpus 的 `0xFFFFFFFF` 是确定性 terminator；
- 生产解析必须有 ZIP/pickle/protobuf/packet 数量和长度预算，避免 zip bomb、无限扫描与恶意 pickle。

`main` 当前 `ReplayArchiveReader`/`ReplayParser` 已有严格的 archive、pickle、protobuf、player-count、packet-count 安全预算；这是生产安全层，不属于协议字段本身。

## English

A replay is a ZIP containing metadata, the BigWorld-style event stream, and settlement data. Packet framing is length/type/float-clock/payload after a dynamically sized header. Production must enforce archive and parser budgets independently of protocol semantics.

---

# 4. Top-level packet inventory / 顶层 packet 清单

Observed current types:

```text
0, 1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 17,
23, 26, 28, 29, 31, 32, 33, 35, 36, 39, 0xFFFFFFFF
```

| Type | 中文语义 | English role | 证据 |
|---:|---|---|---|
| 0 | base-player / arena metadata | base-player / arena metadata family | PROVEN/PARTIAL |
| 1,2 | entity/avatar-cell create/init | entity/avatar-cell creation/init family | PARTIAL |
| 4 | 离开录像者可观测 AoI，**不是死亡** | leaves recorder-observed AoI, **not death** | PROVEN |
| 5 | materialization/re-entry + state/loadout/current HP | materialization/re-entry family | PROVEN relationship |
| 7 | EntityProperty envelope | EntityProperty envelope | PROVEN |
| 8 | EntityMethod envelope | EntityMethod envelope | PROVEN |
| 10 | 高频 transform / movement | high-rate transform/movement | PROVEN |
| 11 | space/map/session config | space/map/session config family | PARTIAL |
| 13 | in-stream result/settlement family | settlement/result dump family | PROVEN family |
| 14 | stream close marker | stream close marker | PROVEN |
| 17 | recorder aim/control init boundary | recorder aim/control init boundary | PROVEN relationship |
| 23 | recorder projectile/shot lifecycle toggle | recorder projectile/shot lifecycle toggle | PROVEN |
| 26 | incoming hostile-shell warning | incoming hostile-shell warning family | PROVEN |
| 28 | recorder ammunition selection | recorder ammunition selection | PROVEN |
| 29 | init/options companion | init/options companion | PROVEN relationship |
| 31 | aiming-circle / gun-marker size | recorded aiming-circle/gun-marker size | PROVEN |
| 32 | auxiliary effect/state envelope | auxiliary effect/state envelope | PROVEN envelope |
| 33 | pre-materialization packet | pre-materialization companion to Type5 | PROVEN relationship |
| 35 | monotonic decisecond low byte | low 8 bits of monotonic decisecond session clock | PROVEN |
| 36 | full-width decisecond anchor | full-width monotonic decisecond anchor | PROVEN |
| 39 | high-rate aim/camera/gun geometry | high-rate aim/camera/gun geometry | PROVEN family |
| `FFFFFFFF` | terminator | terminator | PROVEN |

---

# 5. Entity identity, lifecycle and AoI / 实体身份、生命周期与可见性

## 中文

`entityId` 是 replay live stream 的主要实体键，但必须通过 arena/update surfaces 解析到 account/player。

关键原则：

```text
identity mapping != visibility lifecycle != death
```

AoI：

```text
visible/materialized
-> Type10 observed transforms
-> Type4 leaves recorder-observed AoI
-> hidden interval = UNKNOWN
-> Type33 + Type5 re-entry/materialization
-> Type10 resumes
```

因此：

```text
Type4 == death            REJECTED
Type4 == leaves AoI       PROVEN
```

不能把隐藏前最后一个坐标和重现后的第一个坐标直接连线，并称为“真实走位”。

推荐表示：

```text
MovementSegment {
  continuity = OBSERVED
  samples[]
}

HiddenGap {
  continuity = UNKNOWN_AOI
  start
  end
}
```

## English

Entity leave is an observation-boundary event, not a death event. Hidden movement must remain unknown. UI interpolation is allowed only inside a continuous observed segment and must never fabricate a path across an AoI gap.

---

# 6. Type10 movement / transform — full closure / Type10 移动与姿态完整闭环

## 6.1 Wire layout / 线格式

Current 49-byte payload:

```text
offset  size  type       semantic
0x00    4     u32 LE     entityId                              PROVEN
0x04    4     u32 LE     spaceId                               PROVEN
0x08    4     u32 LE     attachment/parent entity ID           PROVEN
0x0C    12    3*f32 LE   position x,y,z                        PROVEN
0x18    12    3*f32 LE   position/filter-error x,y,z            PROVEN structure / PARTIAL generation
0x24    12    3*f32 LE   hull yaw,pitch,roll                   PROVEN
0x30    1     u8          trailingStateRaw                      UNKNOWN semantic
TOTAL   49
```

Canonical population:

```text
Type10 packets total  1,287,221
49-byte payload       1,287,221 / 1,287,221
```

### Critical correction / 关键纠错

```text
offset 0x30 == onGround   REJECTED
```

Rhm controlled airborne replay:

```text
recorder Type10 samples = 369
trailing byte raw=1      = 369 / 369
raw=0                    = 0 / 369
```

同时 Type10 Y 明确形成 rise → apex → ballistic fall，拟合垂直加速度约：

```text
-9.74 world-unit/s²
```

因此尾字节不能叫 `onGroundRaw`。生产字段必须保持：

```text
trailingStateRaw
```

直到新的 current-version evidence 证明精确语义。

## 6.2 Position / 坐标

```text
X/Z = horizontal map plane
Y   = vertical height axis
```

Avatar method25 的 recorder-local pose 与 Type10 position/orientation 在 107 个样本中高度一致，位置误差远低于坦克尺度，独立证明 Type10 position 与 hull orientation。

## 6.3 Attachment parent / 绑定父实体

非零 offset `0x08`：

```text
non-zero references examined         90,075
reference resolves to another eid    90,075 / 90,075
attached child observed position     (0,0,0)
```

因此：

```text
parentRaw == 0  -> direct world transform
parentRaw != 0  -> attached/parented entity; do not treat local zero as world origin
```

## 6.4 Position error / filter error

`0x18..0x23` 不是速度。WZ-120 在加速、倒车、车体转动、静止、再次移动时，这三个值保持稳定；历史 BigWorld filter input 架构也有 `position + positionError + yaw/pitch/roll` 对应关系。

精确生成机制仍 `PARTIAL`，但结构身份已闭合。

## 6.5 Physical scale / 物理尺度

Kanonenjagdpanzer 105 controlled speed probe：

```text
forward stable median = 15.8364 world-unit/s
15.8364 * 3.6         = 57.011 km/h

reverse stable median = 5.5804 world-unit/s
5.5804 * 3.6          = 20.089 km/h
```

与该车当前 57 / 20 km/h 上限双向吻合。

独立 Rhm airborne gravity cross-check：

```text
vertical acceleration ~= -9.74 world-unit/s²
```

因此：

```text
1 Type10 world position unit ~= 1 meter
```

为 **PROVEN controlled** 的当前 11.19 物理标定。

## 6.6 Derived velocity / 派生速度

Type10 没有已证明的直接 velocity vector。

```text
vx = Δx / Δt
vy = Δy / Δt
vz = Δz / Δt

planarSpeedMps  = sqrt(vx² + vz²)
spatialSpeedMps = sqrt(vx² + vy² + vz²)
speedKmh        = planarSpeedMps * 3.6
```

forward axis：

```text
forward.x = sin(hullYaw)
forward.z = cos(hullYaw)
```

signed longitudinal speed：

```text
vForward = (Δx*sin(yaw) + Δz*cos(yaw)) / Δt
```

解释：

```text
vForward > +epsilon  -> FORWARD
vForward < -epsilon  -> REVERSE
otherwise            -> stationary/no meaningful longitudinal movement
```

Hull yaw rate：

```text
hullYawRate = wrapPi(yaw2 - yaw1) / Δt
```

Acceleration：

```text
acceleration = Δvelocity / Δt
```

Acceleration 是二阶派生量，必须标 `DERIVED_FROM_TYPE10`，不能伪装成 wire field。

## 6.7 Sampling / 采样频率

```text
median same-entity Δt ~= 0.1000595 s
```

即 observed entity movement feed 约 **10 Hz**。

## 6.8 Hull vs turret / 车体与炮塔

```text
Type10 hullYawWorld
+ Vehicle prop2 turretYawRelative
-> turretYawWorld
```

WZ-120 controlled replay 已独立隔离：

- pure translation；
- hull rotation；
- stationary hull + turret-only rotation；
- hull + turret simultaneous movement。

因此 battle reconstruction 可以区分车体动作与炮塔动作。

## 6.9 Airborne / 垂直与腾空

Rhm + Speed Booster replay 的 Speed Booster 会污染自然水平极速/加速度，因此不用于 top-speed 标定；但它不影响：

- Type10 Y 真实垂直轨迹；
- rise/apex/fall；
- ballistic descent；
- trailing byte 反例。

生产可以派生：

```text
AIRBORNE_KINEMATIC_CANDIDATE
```

但不能把 Type10 尾字节当 ground-contact truth。

## English summary

Type10 is a closed high-rate transform source for current 11.19: world position, hull orientation, attachment parent, physical meter scale, ~10 Hz cadence, forward/reverse motion, speed, yaw rate and vertical ballistic movement are all safe. The trailing byte is explicitly **not** an `onGround` flag.

---

# 7. Type7 EntityProperty / 实体属性

Envelope:

```text
entityId u32
propId   u32
valueLen u32
value    bytes[valueLen]
```

Current Vehicle property map:

| propId | 中文 | English | Evidence |
|---:|---|---|---|
| 0 | 一字节状态，精确语义未知 | one-byte state | shape PROVEN / semantic UNKNOWN |
| 1 | active/crew-active terminal boolean family | active/terminal family | PROVEN family |
| 2 | 炮塔相对车体 yaw | turret yaw relative to hull | PROVEN |
| 3 | 当前 HP / terminal sentinel | current HP / terminal sentinel | PROVEN |
| 4 | 双 u8 vehicle/engine/movement-mode tuple | two-u8 state tuple | structure PROVEN / semantic PARTIAL |
| 7 | compact state array | compact state-array family | PARTIAL namespace |
| 8 | recoverable effect/state collection | recoverable state/effect collection | PARTIAL namespace |
| 9 | compact state array | compact state-array family | PARTIAL namespace |

prop2 conversion:

```text
angleRad = rawU16 * 2π / 65536 - π
```

prop3 safe model:

```text
positive i16 -> actual current HP
0x0000       -> HP-zero terminal
0xFFFD       -> death terminal sentinel
0xFFFE       -> terminal on verified current chain; version-gate
0xFFFF       -> UNKNOWN; preserve raw
```

---

# 8. Type8 EntityMethod / RPC transport

Envelope:

```text
entityId u32
methodId u32
argLen   u32
args     bytes[argLen]
```

Method IDs are entity-class scoped.

High-value current methods:

| Entity/method | 中文 | English | Evidence |
|---|---|---|---|
| Vehicle 0 | observed firing | observed firing signal | PROVEN |
| Vehicle 1 | HP/damage/death-cause update | HP-loss/death-cause update | PROVEN |
| Vehicle 2/3/4/6 | vehicle/static collision families | collision/contact families | PROVEN/PARTIAL by method |
| Vehicle 8 | direct-hit notification + target-local segment | target-local hit segment | PROVEN |
| Avatar 4 | winner/finish | winnerTeam + finishReason | PROVEN |
| Avatar 5 | recorder HP mirror/opening HP | recorder own HP | PROVEN |
| Avatar 12 | ribbons/feedback counters | battle-feedback summary | PROVEN framework |
| Avatar 13 | reload/gun-cycle | reload/gun-cycle telemetry | PROVEN family |
| Avatar 16 | module/crew state | module/crew damage presentation | PROVEN family |
| Avatar 17 | ammo descriptor/state | ammunition descriptor/state | PROVEN |
| Avatar 19 | misc vehicle/repair state | misc state family | PROVEN family |
| Avatar 20 | shot terminal endpoint | shotId + endpoint | PROVEN |
| Avatar 25 | own pose snapshot | recorder pose snapshot | PROVEN/PARTIAL |
| Avatar 27 | explosion/terminal projectile | projectile terminal/explosion family | PROVEN family |
| Avatar 28 | recorder death-view projectile geometry | death/death-view incoming projectile | PROVEN family |
| Avatar 29 | projectile launch | launch + shooter + shotId + geometry + velocity | PROVEN |
| Avatar 35 | reload duration config | reload-duration update | PROVEN |
| Avatar 36 | targeting state/config | targeting snapshot protobuf | PROVEN family |
| Avatar 38 | outgoing hit-result feedback | outgoing shot-result feedback | PROVEN |
| Avatar 43 | name/tactical UI family | player-name/tactical-UI family | PARTIAL exact symbol |
| Avatar 46 | tactical marker/ping | tactical marker/ping family | PROVEN family |
| Avatar 47 | chat/action/battle command | chat/action command transport | PROVEN family |
| Avatar 48 | arena update wrapper | arena-update protobuf wrapper | PROVEN |
| Avatar 49 | synced client options | synchronized client options | PROVEN family |

---

# 9. HP, damage and death / 血量、伤害与死亡

## 9.1 Actual HP sources / 实际 HP

Actual replay HP must outrank Tankopedia base HP.

Current authoritative/live chain includes:

- Type5 materialization current HP；
- Avatar method5 recorder opening/current HP mirror；
- Vehicle prop3 current HP / terminal sentinel；
- Vehicle method1 currentHpRaw + source + cause；
- settlement initial/final HP cross-check。

```text
Tankopedia base HP == actual replay HP   REJECTED as primary source
```

This matters because equipment/provisions can change actual HP.

## 9.2 Vehicle method1

```text
currentHpRaw  u16
sourceEntity  u32
causeFlag     u8
```

Current cause map:

```text
0 direct/default combat damage      PROVEN
1 fire                              PROVEN
2 ramming                           PROVEN
3 world/self-environment impact     PROVEN
4 UNKNOWN                           preserve raw
5 drowning                          PROVEN controlled
```

## 9.3 Drowning closure / 溺水

Controlled drowning:

```text
Vehicle method1:
currentHpRaw = 1693
sourceEntity = self
causeFlag    = 5

wrapper6:
victim       = self
killer       = self
deathReason  = 5

settlement:
remaining HP = 1693
```

Therefore:

```text
causeFlag 5   = DROWING
deathReason 5 = DROWING
```

Key rule:

```text
death != HP <= 0 universally
```

A vehicle can terminate while retaining positive HP.

## 9.4 Death precision / 死亡时间精度

Original corpus:

```text
settled dead combatants           287
live sub-second closure           283
settlement-second fallback          4
```

So:

```text
single POV guarantees 100% sub-second death time   REJECTED
```

The remaining 1.39% is a real observation boundary, not a parser failure to be “filled” by invented telemetry.

---

# 10. Main branch damage implementation boundary / main 当前伤害实现边界

## 中文

当前 `main` 中仍存在历史实现与 11.19 研究事实之间的差异，必须明确：

1. `ReplayEventExtractors.extractPositions()` 当前只取：
   - entityId / spaceId / vehicleId
   - x/y/z
   - yaw/pitch/roll  
   它**没有暴露 positionError，也没有暴露 trailingStateRaw**。这不是协议未知，而是 implementation coverage gap。

2. `ReplayEventExtractors.parseDirectDamageEvent()` 仍把一个旧 Type8 method-8 body 的 `body[14..15]` 当作 direct damage 值，用于部分 death/kill fallback。PR147 后续研究已经证明：
   - 该 raw 值不是普遍权威 HP delta；
   - 权威 HP loss 应以连续可靠 HP sample 的 delta 为主；
   - unsupported variants 应 fail-closed，而不是静默当“无冲突”。

3. `main/docs/reference/replay-data.md` 仍有早期：
   - Type4 作为死亡/离开 heuristic；
   - Type10 trailing byte `is_error`；
   - 11.18-era Type7 property uncertainty。  
   这些是历史文档，不是 11.19 canonical truth。

4. `main/docs/reference/replay-parsed-fields.md` 已比早期 `replay-data.md` 新，正式把 `PositionChangedEvent`、`MovementSegment`、AoI/时间边界与 AI evidence 纳入模型，但仍未吸收 PR147 的全部 11.19 closure。

## English

The research archive is ahead of the current production implementation. This is intentional and must be visible:

- main extracts only a subset of the now-known Type10 fields;
- legacy direct-damage decoding is not a universal HP authority;
- some main reference docs still contain 11.18-era assumptions;
- implementation convergence is follow-up work, not evidence against the protocol closures.

---

# 11. Projectile lifecycle / 炮弹生命周期

Canonical graph:

```text
Vehicle method0 observed firing
        |
        v
Avatar method29 launch
        |
        | shotId
        +----------------------+
        |                      |
        v                      v
Avatar method20          Avatar method27
endpoint                 explosion/terminal family
```

Avatar method29 (37 bytes):

```text
0..4    shooterEntityId u32
4..8    shotId          u32
8       raw flag        u8
9..21   launchPoint     VECTOR3<f32>
21..33  launchVelocity  VECTOR3<f32>
33..37  invariant/raw   f32
```

Avatar method20:

```text
shotId   u32
endPoint VECTOR3<f32>
```

Important:

- method29 is a **global observed projectile feed**; filter by shooter identity before calling a shot recorder-owned.
- raw packet clock differences are not guaranteed exact physical flight time because network/batching clocks can differ from simulation timing.
- method27 shares terminal/explosion geometry and complements method20.

---

# 12. Ammunition selection and inventory / 弹种与弹药状态

## 12.1 Type28

Payload:

```text
selectionValue u32 LE
```

Observed current domain:

```text
0, 1, 2
```

Verdict:

```text
Type28 = recorder ammunition-selection state   PROVEN
```

Never carry Type28 state across arenas.

## 12.2 Avatar method17

Normal firing-time 12-byte state includes:

```text
shellDescriptor   u32
...
remainingQuantity u8
...
```

`remainingQuantity` decrements exactly with recorder shots for the same descriptor. Initialization/feed variants must remain separately decoded.

Safe chain:

```text
Type28 selectionValue
-> method17 shellDescriptor
-> version-matched shell catalog
-> display ammunition
```

Never assume the raw selection value globally equals a UI slot number.

## 12.3 FV215b controlled 11.19 mapping

```text
Type28=0 -> 0x003C5A0A -> AP
Type28=1 -> 0x00465A0A -> APCR
Type28=2 -> 0x003B5A0A -> HESH / HE-family
```

Observed launch speeds:

```text
AP    ~1152.36
APCR  ~1440.72
HESH  ~1152.36
```

This mapping is vehicle/version scoped.

---

# 13. Method38 outgoing hit-result wire format / method38 命中结果

Current safe wire:

```text
victimVehicleId  u32
resultFlags16    u16
headerHi16Raw    u16
resultCount      u8
repeat resultCount:
    componentToken u8
    rawState       u8
modifierCount    u8
repeat modifierCount:
    modifierId     u32 LE
```

Old models:

```text
all 32 header bits = homogeneous hit enum        REJECTED
single optional u32 extension                    SUPERSEDED
Precision Fire/Tungsten mutually exclusive       REJECTED
combined modifier = 3                            REJECTED
```

`headerHi16Raw` is a distinct header/state surface and must remain raw unless separately closed.

---

# 14. method38 resultFlags16 — complete current map / 完整位图

| Bit | 中文物理语义 | English physical role | Evidence |
|---:|---|---|---|
| `0x0001` | 直接炮弹终结击杀 | direct terminal shell kill | PROVEN |
| `0x0002` | 攻击前目标已死 | target already dead before attack | PROVEN sample / low-N |
| `0x0004` | 点火 | fire started | PROVEN |
| `0x0008` | 跳弹 | ricochet | PROVEN controlled |
| `0x0010` | projectile 对 positive-DF/material/vehicle 成功穿透 | positive material/vehicle penetration by projectile | PROVEN |
| `0x0020` | projectile 对 material 停止/未穿 | projectile non-penetration/material stop | PROVEN controlled |
| `0x0040` | zero-DF / spaced layer 被 projectile 穿过 | zero-DF/spaced layer pierced by projectile | PROVEN controlled |
| `0x0080` | zero-DF / spaced layer 未被 projectile 穿过 | zero-DF/spaced layer not pierced | PROVEN controlled |
| `0x0100` | internal device/module 被 projectile 穿透/正向涉及 | internal device/module pierced/involved by projectile | PROVEN |
| `0x0200` | internal device/module 被 projectile 遇到但未穿透 | projectile device/module not pierced | **PROVEN controlled** |
| `0x0400` | 履带/chassis 被 projectile 损坏 | chassis/track damaged by projectile | PROVEN |
| `0x0800` | Gun 被 projectile 损坏 | Gun damaged by projectile | PROVEN |
| `0x1000` | positive-DF material 的 explosion resolution | positive-DF material resolved/penetrated by explosion | PROVEN controlled |
| `0x2000` | zero-DF/spaced armor 的 explosion resolution | zero-DF/spaced layer resolved/penetrated by explosion | PROVEN controlled low-N |
| `0x4000` | explosion 涉及 internal component/device | internal component/device involved by explosion | PROVEN |
| `0x8000` | explosion 损坏 internal component/device | internal component/device damaged by explosion | PROVEN |

## 14.1 `0x0200` controlled closure

Controlled replay:

```text
recorder = CHRD-A158布丁
vehicle  = G190_VK_1602_Quby
target   = Maus

phase 1  = Gun/barrel, 15 projectiles
phase 2  = Fuel Tank, 15 projectiles

method29 launches = 30
method38 results  = 30
same-clock pairs  = 30 / 30
```

Critical Gun/barrel sample:

```text
48.797237
flags = 0x0240
      = 0x0200 | 0x0040
resultCount = 0
```

Same phase also contains:

```text
0x0100 + component 36 + rawState 0
```

and repeated `0x0080` around the same barrel region.

Fuel Tank control:

```text
0x0110 = 0x0010 | 0x0100
component 33
rawState 0/1
```

plus final:

```text
0x0114 = 0x0010 | 0x0100 | 0x0004
```

Therefore `0x0200` is no longer unobserved:

```text
0x0200 = PROJECTILE_DEVICE_NOT_PIERCED   PROVEN controlled
```

Historical symbolic name `DEVICE_NOT_PIERCED_BY_PROJECTILE` is a corroborating architecture cross-check, not the sole basis of the result.

## 14.2 Distinguish resolution layers / 区分不同“未穿”

These are not interchangeable:

```text
0x0020 generic positive-material/projectile stop
0x0080 zero-DF/spaced layer not pierced
0x0200 internal device/module not pierced
```

A parser or AI explanation must preserve the layer distinction.

---

# 15. method38 component results / 模块结果

Current `rawState`:

```text
0 -> component involved/hit; no newly observed persistent negative state
1 -> module damaged / crew injured
2 -> module critical/disabled
```

Grades:

- rawState1 = PROVEN
- rawState2 = PROVEN
- rawState0 physical role = VERY STRONG / production-safe generic “involved/no new negative state”; exact private enum name remains unknown.

Module hit is not equivalent to module damage.

---

# 16. Component / crew namespace / 模块与乘员 namespace

Mechanical:

```text
31 Engine              PROVEN
32 Ammo Rack           PROVEN
33 Fuel Tank           PROVEN
34 Right Track         PROVEN
35 Left Track          PROVEN
36 Gun                 PROVEN
37 Turret Rotator      PROVEN version-scoped
38 Observation Device  PROVEN
```

Crew:

```text
39 Commander            PROVEN
40 Driver               PROVEN
41 Gunner               PROVEN
42 UNKNOWN/unobserved   preserve raw
43 Loader               PROVEN
```

Important correction:

```text
41 == Radioman / 42 == Gunner    SUPERSEDED
```

Track side:

```text
34 = Right Track
35 = Left Track
```

closed by target-local hit geometry, not ordinal guessing.

---

# 17. Avatar method16 state lifecycle / 模块与乘员状态生命周期

Mechanical:

```text
codeA=4   damaged/degraded but operational             PROVEN
codeA=5   critical/disabled                            PROVEN
codeA=18  automatic critical self-repair -> damaged   PROVEN
codeA=19  full repair/clear                            PROVEN
```

Crew:

```text
codeA=10  crew injured/shell-shocked   PROVEN
codeA=22  crew healed/clear            PROVEN
```

Fuel Tank:

```text
codeB=33
codeA=8
-> Fuel Tank ignition/fire-start transition family
```

Exact private symbol of `codeA=8` remains version/private-source scoped, but its controlled Fuel Tank behavior is closed.

---

# 18. Gun damage, repair and targeting effects / 主炮损坏与瞄准参数

P65 / Progetto 65 controlled Gun state chain:

```text
codeB=36 = Gun
```

Observed lifecycle includes:

```text
4  common damaged
5  critical
18 automatic self-repair from critical to degraded
19 full repair
```

Method36 signature:

```text
Gun negative state:
field6.field1 ×2
root.field4   ×0.675

full repair:
both restore exact healthy baseline
```

This independently distinguishes Gun from Gunner and other mechanical components.

---

# 19. Method38 special modifiers / 特殊炮弹 modifier list

Current tail is a repeatable list:

```text
modifierCount u8
repeat modifierCount:
    modifierId u32 LE
```

Controlled:

```text
modifierId=1 -> Precision Fire proc   PROVEN
modifierId=2 -> Tungsten Shells       PROVEN
```

Simultaneous sample:

```text
shot1 [2]
shot2 [2]
shot3 [2]
shot4 [1,2]
```

Therefore:

```text
repeatable modifier list                  PROVEN
Precision Fire + Tungsten coexistence     PROVEN
single-extension model                    SUPERSEDED
mutual exclusion                          REJECTED
combined state == modifier 3              REJECTED current sample
```

Unknown future modifier IDs must remain raw and version-gated.

---

# 20. HE, spaced armor, tracks and explosion bits / HE、间隙装甲、履带与爆炸

Controlled TVP and WZ-120 matrices establish independent layers.

Examples:

```text
ricochet:
0x0028 = 0x0020 | 0x0008

spaced-armor penetration:
0x0050 = 0x0010 | 0x0040

mantlet/multi-layer stop:
0x00C0 = 0x0040 | 0x0080
```

HE examples:

```text
direct HE pen:
0xD010 = 0x8000 | 0x4000 | 0x1000 | 0x0010

thick armor no-pen:
0x0020

track hit:
0x1500 = 0x1000 | 0x0400 | 0x0100

spaced/mantlet HE:
0x6080 = 0x4000 | 0x2000 | 0x0080

ground splash:
0xD000 = 0x8000 | 0x4000 | 0x1000

ground no effect:
0x0000
```

The pure ground-splash case is especially important because it proves the high-bit family is an explosion-resolution surface independent from ordinary projectile-penetration bits.

---

# 21. Targeting surfaces / 瞄准系统

## 21.1 Type31

```text
Type31 = recorded aiming-circle / gun-marker size   PROVEN
```

It is not penetration probability.

## 21.2 Type39

High-rate aim/camera/gun geometry. Current closed relationships include:

```text
f5 = turret/gun relative yaw family   PROVEN relationship
f6 = local gun pitch                  PROVEN relationship
```

Camera-related fields are separate from vehicle hull position.

## 21.3 Avatar method36

Current scalar shape contains nine fixed64/double-like values, structurally matching the historical nine-argument targeting-info family but current protobuf ordering/semantics were recovered behaviorally rather than copied ordinally.

Closed high-value fields:

```text
root.field1 = recorder turret/gun relative yaw               PROVEN
root.field2 = recorder gun pitch                              PROVEN
root.field3 = maximum horizontal turret/gun angular speed     PROVEN controlled, rad/s
root.field4 = maximum vertical gun angular speed              PROVEN controlled, rad/s
root.field5 = aiming-time physical scalar                     PROVEN
field6.field1 = dynamic gun-dispersion / bloom scalar         PROVEN
```

### Horizontal speed

WZ-120:

```text
root.field3 = 0.879154807... rad/s ~= 50.37 deg/s
```

matches the controlled turret-only saturation/current vehicle behavior.

### Vertical speed

Maus vertical controlled segment measured Type39 gun-pitch derivative matching method36 root.field4 to extremely small relative error.

### Aiming time

Reticle Calibration boundary:

```text
root.field5:
baseline -> active -> baseline
2.1580298793 -> 1.5106208898 -> 2.1580298793

ratio = 0.70
```

matching the -30% aiming-time effect.

### Dynamic dispersion / bloom

`field6.field1` has three independent perturbations:

```text
shot boundary       -> instantaneous positive bloom change
Gun damage          -> persistent ×2
Reticle Calibration -> ×0.70
```

This is sufficient to classify the physical role as **dynamic gun-dispersion/bloom**.

### Remaining method36 fields

Three static/nested coefficients remain without exact current private names. They likely belong to movement/hull/turret dispersion configuration families, but because current WotBTools can already determine movement, hull/turret rotation, aiming-time and dynamic bloom facts, these are P2/private-schema recovery rather than P1 blockers.

---

# 22. Consumables and effect transport / 消耗品与 effect transport

Type32 is an auxiliary effect/state envelope. Controlled examples include:

- Repair Kit lifecycle；
- First Aid / crew recovery families；
- Adrenaline；
- Reticle Calibration；
- Tungsten-related effect windows；
- Speed Booster in the Rhm airborne test.

Important research rule: an effect activation window is useful as a controlled perturbation only when the mechanic it changes is relevant to the tested field. For example:

- Speed Booster contaminates natural top-speed/acceleration calibration;
- it does **not** invalidate Type10 vertical trajectory or trailing-byte counterexample;
- Adrenaline changes reload/gun-cycle behavior but did not alter the tested method36 targeting config scalars in the controlled WZ-120 sample.

---

# 23. Collision, environment, fire and repair / 碰撞、环境、起火与维修

Current high-value closures include:

- Vehicle method4 = vehicle↔vehicle collision family；
- Vehicle method6 = static/world collision physical role；
- method1 causeFlag 2 = ramming；
- method1 causeFlag 3 = world/self-environment impact；
- causeFlag 5 = drowning；
- Fuel Tank ignition transition；
- method38 `0x0004` = fire started；
- Repair Kit full repair synchronization；
- critical automatic self-repair state `18` distinct from full repair `19`。

Do not infer death solely from collision or HP zero; terminal state/death evidence is authoritative.

---

# 24. Settlement / `battle_results.dat` / 赛后结算

`battle_results.dat` remains the final-result authority for settled battle facts and a cross-check for live reconstruction.

Container:

```text
Python pickle protocol 2
-> tuple(arenaId, protobufBytes)
-> nested protobuf
```

High-value current settlement facts include:

- account / nickname / clan / team / vehicle；
- shots / hits / penetrations / damage；
- damage received / blocked / assisted；
- kills / survival；
- XP / credits；
- winner/team outcome；
- death-related fields；
- selected assistance/counter mappings；
- roster integrity evidence.

Known focused closures include:

```text
method12 baseType15 / settlement field119
-> Destruction Assistance count   PROVEN

settlement field120
-> Gun Marks count                PROVEN

wrapper6.field3
-> >50% prior-damage secondary kill-notification assister   PROVEN
```

`field118 / method12 baseType12` remains a bounded UNKNOWN. The old “base defended / dropped capture points” interpretation is `REJECTED`.

---

# 25. Battle time and clocks / 时间系统

Replay has multiple clock-related surfaces:

- packet `rawClockSec`；
- battle-relative time derived from a reliable battle-start anchor；
- Type35 low-byte decisecond clock；
- Type36 full-width decisecond anchor；
- settlement timestamps/seconds；
- client runtime-like clocks in auxiliary surfaces。

Production must preserve raw clock provenance and avoid pretending all clock surfaces share identical semantic epoch/latency.

For user-facing tactical reconstruction:

```text
battleClockSec = rawClockSec - reliable battleStartRawClockSec
```

only when the start anchor is resolved. Raw-only events should not be silently treated as battle-relative.

---

# 26. Chat, tactical markers and commands / 聊天、战术标记与指令

Current archive closes families for:

- Avatar method46 tactical marker/ping；
- Avatar method47 chat/action command transport；
- battle-command payload observed through method47；
- action/userChatCommand structure.

A drowning controlled replay observed a battle command:

```text
method47 action 20
pickle-like command payload with code 24
```

The exact UI mapping of every command enum remains low-priority/private-symbol work. Transport family is closed; enum namespace is not globally named.

---

# 27. WotBTools production evidence model / WotBTools 生产证据模型

## 中文

协议研究与产品 DTO 必须分层：

### Raw protocol layer

```text
raw packet bytes
raw packet type
raw clock
entityId
method/property IDs
raw flags
raw component tokens
raw states
raw unknown tail fields
```

### Decoded fact layer

只允许 PROVEN 或明确批准的 PARTIAL：

```text
position
hull orientation
HP
death terminal/cause
projectile launch/end
ammo descriptor
module hit/damage/critical
hit-resolution flags
targeting physical scalars
```

### Derived evidence layer

```text
speed
forward/reverse
hull yaw rate
movement segment
airborne kinematic candidate
formation geometry
death proximity
moving-shot classification
aimed/snapshot candidate
```

Derived evidence 必须携带 provenance，并尊重 AoI 与 sampling boundary。

### AI Review layer

AI 不应拿 raw unknown 做确定性叙述。适合 AI 的事实包括：

- 录像者开火时是否移动；
- 是否前进/倒车；
- 是否车体转向；
- 炮塔与车体是否分离运动；
- 瞄准时间/动态 bloom 的可靠状态；
- 实际 HP/死亡原因；
- 命中结果：跳弹、不同装甲层未穿、模块 involvement/damage；
- 弹种；
- 可观测走位与 AoI hidden gap。

## English

The product should keep raw protocol, decoded facts, derived evidence and AI-facing interpretation separate. Derived fields must carry provenance. Unknown protocol bytes must never become deterministic AI claims.

---

# 28. Main implementation mapping / main 实现映射

Current `main` already contains useful production infrastructure:

- `ReplayArchiveReader` safety limits；
- `ReplayParser` settlement parsing；
- entity/account roster mapping；
- `EventStreamReader` packet forwarder；
- `ReplayEventExtractors` Type4 / Type10 / updateArena / legacy damage extraction；
- death-time fallbacks；
- battle reconstruction context；
- `PositionChangedEvent` and movement evidence in higher-level replay reconstruction；
- AI Review evidence builders/formatters；
- map semantics and canonical 500×500 normalization；
- League/HoF consumers using settlement facts.

However PR147 establishes several convergence tasks:

### 28.1 Type10 parser convergence

Current `main` `PositionData` exposes:

```text
clock
entityId
spaceId
vehicleId
x/y/z
yaw/pitch/roll
```

Research truth additionally knows:

```text
positionError x/y/z
trailingStateRaw
```

The trailing byte must **not** be named `onGround` or `is_error` without evidence.

### 28.2 Movement units

Where main produces `MovementSegment.distance/avgSpeed`, the implementation should consistently use the now-controlled scale:

```text
1 Type10 position unit ~= 1 meter
speedKmh = m/s * 3.6
```

Map normalization to canonical 500×500 is a presentation/spatial-analysis layer and must not replace raw meter coordinates.

### 28.3 Damage authority

Legacy Type8 raw direct-damage values are not a universal exact HP source. New implementation should prefer:

```text
reliable HP sample delta
+ conflict-aware attribution
+ raw unsupported event preservation
```

and fail closed when attacker attribution is ambiguous.

### 28.4 Type4

Type4 must be consumed as AoI/lifecycle evidence, not a deterministic death signal.

### 28.5 Protocol version gating

11.19 IDs and enum meanings should be guarded by client version. A future client must default unknown rather than silently reuse ordinals.

---

# 29. Explicitly rejected or superseded interpretations / 明确推翻的旧解释

```text
Type4 == death                                             REJECTED
Type28 == target lock / auto aim                          REJECTED
41 == Radioman / 42 == Gunner                             SUPERSEDED
34/35 exact side unresolved                               SUPERSEDED
baseType12 == base defended / dropped capture points      REJECTED
all method38 32 header bits == one homogeneous hit enum   REJECTED
historical PC upper hit-flag ordinals == current Blitz    REJECTED as a method
method38 0x1000 == universal Gun-damage bit               REJECTED
old Type28 341-shot aggregate                             SUPERSEDED
Tankopedia base HP == replay actual HP source             REJECTED as primary source
single replay POV guarantees 100% sub-second death        REJECTED
method38 tail == one optional u32 extension               SUPERSEDED
extension=1/2 single-extension model                      SUPERSEDED
Precision Fire/Tungsten mutually exclusive                REJECTED
combined Precision Fire + Tungsten == modifier3           REJECTED
Type10 trailing byte == onGround                          REJECTED controlled
Type10 positionError == velocity                          REJECTED
```

---

# 30. Current bounded unknowns / 当前仍保留的未知

These are **not P0/P1 protocol blockers**.

## P2 research / 中等研究价值

```text
component ID42 exact identity/private symbol
method38 rawState0 exact private enum name
method16 sparse transition-code exact private symbols
method36 remaining static coefficient exact names/units
Vehicle prop7/8/9 complete token namespaces
method17 initialization/feed-tail exact fields
unobserved causeFlag/deathReason enum values
Type10 trailingStateRaw exact semantic
Type10 positionError exact generation rule
```

## P3 / structural/private naming

```text
observer-only/cosmetic/platform exact names
private protobuf field names where physical role is already closed
platform/build/session cosmetic fields
future-version numeric stability
```

Important: a field defaults to `UNKNOWN`, not `LOW`. It should be downgraded to low business value only after evidence shows redundancy, presentation-only behavior, or non-mechanical impact.

---

# 31. Research completion gate / 研究收口标准

## 中文

本轮研究不以“业务能跑”作为停止条件，而使用用户要求的：

```text
P0 = 0
P1 = 0
```

当前结论：

```text
P0 = 0
P1 = 0
```

关键 P1 closure：

```text
Type10 movement / physical units      CLOSED
Type10 airborne / vertical motion     CLOSED
Type10 onGround hypothesis            REJECTED and corrected
method36 high-value targeting roles   CLOSED
method38 0x0200 positive sample       CLOSED
```

因此 11.19 当前 replay-protocol 高价值 surface 可以定义为：

```text
CORE PROTOCOL RESEARCH COMPLETE
PRODUCTION-USABLE FOR CURRENT 11.19 OBSERVED/CONTROLLED SURFACES
```

这不表示：

- 获得全部 Wargaming 私有变量名；
- replay 是 omniscient；
- 所有未来 enum 已知；
- 11.20+ numeric IDs 自动稳定。

## English

The research stop condition is not merely “the product works”; it is **P0=0 and P1=0**. That gate is now satisfied for current 11.19 observed/controlled gameplay surfaces. Remaining work is bounded P2/P3 research, implementation convergence and future-version regression.

---

# 32. Recommended production DTOs / 推荐生产模型

```text
Type10MovementSample {
    rawClockSec
    entityId
    spaceId
    parentEntityIdRaw

    positionMeters { x, y, z }
    positionErrorRaw { x, y, z }

    hullYawRad
    hullPitchRad
    hullRollRad

    trailingStateRaw
}

DerivedMovementState {
    velocityMps
    planarSpeedMps
    speedKmh
    signedForwardSpeedMps
    verticalSpeedMps
    hullYawRateRadPerSec

    stationary
    forward
    reversing
    hullTurning
    airborneKinematicCandidate

    provenance = DERIVED_FROM_TYPE10
}

Method38HitResult {
    victimVehicleId
    resultFlags16
    headerHi16Raw
    componentResults[]
    modifiers[]
}

ComponentResult {
    componentTokenRaw
    decodedComponent?
    rawState
    decodedPhysicalState?
}

ProtocolFact<T> {
    value
    evidenceGrade
    clientVersion
    rawProvenance
}
```

---

# 33. Version regression checklist / 版本回归清单

Every new stable client version should verify at least:

1. header/framing and terminator；
2. observed top-level type inventory；
3. Type7 envelope and critical props；
4. Type8 envelope and critical method IDs by entity class；
5. Type10 payload length and field ordering；
6. Type10 meter scale with at least one controlled speed or map-scale check；
7. method29/method20 shotId pairing；
8. Type28/method17 ammunition state；
9. method38 wire shape, hit flags and modifier list；
10. component namespace；
11. method16 lifecycle；
12. method36 scalar shape and controlled effect ratios；
13. Type31/39 targeting relationships；
14. HP/death cause mappings；
15. AoI lifecycle；
16. settlement field compatibility；
17. all UNKNOWN/future IDs raw-preserved.

Never assume a numeric mapping survives a version bump just because the payload length is unchanged.

---

# 34. Controlled-replay methodology / 受控实验方法

Best practice:

```text
one variable per replay when possible
declare vehicle / target / ammo / consumable / aimed region
use shotId/projectile lifecycle as intrinsic markers
use explicit idle gaps between phases
preserve SHA-256 and arenaId
compare current positive and negative controls in the same replay
record contamination windows (consumables, fire, repair, collision)
```

Examples of strong controls from this archive:

- forward and reverse top-speed plateaus independently closing meter scale；
- airborne ballistic Y trajectory rejecting `onGround`；
- Reticle Calibration reversible exact 0.70 multipliers；
- Gun damage exact ×2 / ×0.675 and repair restoration；
- Quby→Maus Gun vs Fuel Tank phases closing `0x0200`；
- Precision Fire + Tungsten simultaneous `[1,2]` list.

A failed hypothesis must remain documented; controlled counterexamples are first-class evidence.

---

# 35. Documentation maintenance rules / 文档维护规则

1. This bilingual file is the top-level current truth.
2. Focused closure docs retain raw timelines and experimental detail.
3. Historical docs may keep old hypotheses only when visibly marked `REJECTED/SUPERSEDED`.
4. Any new PROVEN fact must update:
   - focused closure；
   - this document；
   - `inventory.md`；
   - `research-completion-audit-11.19.md` when gate-relevant.
5. Any current private symbol recovered later must not erase raw physical naming or provenance.
6. Main implementation docs should be updated separately when production code converges.

---

# 36. Focused research-document index / 专项研究文档索引

High-value focused documents include, but are not limited to:

```text
actual-hp-type5-settlement.md
adrenaline-and-gun-feed.md
ammo-rack-and-loader-damage-codes.md
avatar-gun-cycle-method13.md
avatar-method12-battle-feedback-summary.md
avatar-method16-damage-info.md
avatar-method17-ammunition-state.md
avatar-method19-vehicle-misc-status.md
avatar-method25-own-vehicle-pose.md
avatar-method27-explode-projectile.md
avatar-method28-death-projectile-geometry.md
avatar-method35-reload-duration-update.md
avatar-method36-targeting-crosswalk.md
avatar-method36-targeting-info.md
avatar-method39-periodic-heartbeat.md
avatar-method4-round-finished.md
avatar-method46-team-tactical-markers.md
avatar-method5-own-health.md
avatar-prop9-recorder-turret-yaw.md
avatar-reload-state.md
avatar-shot-result-bitfield.md
avatar-shot-results.md
battle-results.md
blitz-native-replay-symbol-crosswalk.md
capture-probe.md
chat-actions.md
consumable-lifecycle.md
container-format.md
controlled-probes-maus-tvp-wz120-20260827.md
controlled-wz120-movement-dispersion-probe.md
crew-damage-and-first-aid.md
crew-injury-candidates.md
death-and-battle-clock.md
drowning-deathreason-closure.md
entity-materialization.md
entity-methods.md
entity-presence-aoi-lifecycle.md
entity-properties.md
entity-routing.md
explode-projectile.md
field103-and-field120.md
field118-basetype12-boundary.md
field120-gun-marks-candidate.md
fire-and-repair-states.md
fire-dot-stream.md
fuel-tank-observation-device-closure.md
global-shot-telemetry.md
gun-damage-dispersion-closure.md
gun-marker-stream.md
hit-resolution.md
loadout-materialization.md
low-frequency-packets.md
method12-spotted-and-assist-counters.md
method16-damage-state-codeA.md
method16-device-crew-code-map.md
method2-3-6-vehicle-collision.md
method36-horizontal-vertical-rotation-speed-closure.md
method36-vertical-gun-speed-controlled-closure.md
method38-0200-device-not-pierced-closure.md
method38-component-hit-damage-roll.md
method38-component-token-namespace.md
method38-current-hit-flag-reconstruction.md
method38-result-state-closure.md
packet-stream.md
precision-fire-method38-extension.md
projectile-lifecycle.md
projectile-miss-resolution.md
protocol.md
provision-wirecode-mapping.md
recovery-consumable-discriminator.md
reticle-calibration-method36-closure.md
settlement-field116-packed-id.md
settlement-field120-gun-marks-candidate.md
shot-result-flags.md
static-collision-contact.md
team-weapon-telemetry.md
tick-stream.md
track-damage-codes.md
track-side-orientation-closure.md
type10-movement-transform-closure.md
type17-type29-recorder-initialization.md
type28-ammunition-slot.md
type28-target-lock-state.md
type32-entity-effects.md
type32-nested-entity-property.md
type35-session-decisecond-low-byte.md
type36-session-timebase.md
type39-aim-camera.md
type39-f6-local-gun-pitch.md
type7-prop0-prop4-vehicle-mode.md
type7-prop1-prop7-prop8.md
vehicle-firing.md
vehicle-method1-hp-source-damage-cause.md
vehicle-method4-vehicle-collision-contact.md
vehicle-prop9-compact-state-array.md
visibility-lifecycle.md
visibility.md
wrapper12-supremacy-capture-state.md
wrapper6-secondary-assist-attribution.md
wrapper7-avatar-ready-wrapper16-state.md
```

---

# 37. Final bilingual status / 最终双语结论

## 中文

WoT Blitz 11.19 China replay 的核心高价值协议面已经达到：

```text
P0 = 0
P1 = 0
```

当前可以可靠支持：

- 回放容器与 packet framing；
- 实体身份与 AoI 生命周期；
- Type10 真实位置、姿态、米制单位、速度、前后退、转向、垂直腾空；
- 实际 HP、死亡与死亡原因；
- projectile launch / endpoint / explosion lifecycle；
- 弹种 selection + descriptor；
- 跳弹、普通未穿、间隙层穿透/未穿、device 穿透/未穿、履带/主炮损坏、爆炸 resolution；
- Engine / Ammo Rack / Fuel Tank / Tracks / Gun / Turret Rotator / Observation Device；
- Commander / Driver / Gunner / Loader；
- damage / critical / auto-repair / full repair / crew injury/heal；
- Precision Fire / Tungsten 与同时触发；
- Type31 / Type39 / method36 的高价值 targeting 事实；
- 单 POV 的真实可见性边界；
- settlement 与 AI Review 的事实证据链。

仍然未知的字段必须继续 raw-preserve，但它们已经不构成当前 11.19 WotBTools replay protocol 的 P0/P1 blocker。

## English

The current WoT Blitz 11.19 China replay protocol has **no known P0 or P1 semantic blocker** for WotBTools’ present high-value use cases. Movement, HP/death, projectile lifecycle, ammunition, hit resolution, component/crew damage, special modifiers and targeting are production-usable within explicit version and POV boundaries.

Unknown private symbols and low-frequency values remain raw-preserved research boundaries rather than excuses for speculative decoding.
