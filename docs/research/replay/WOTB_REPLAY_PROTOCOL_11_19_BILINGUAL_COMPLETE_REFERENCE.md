# WoT Blitz 11.19 Replay Protocol / WoT Blitz 11.19 回放协议
## Bilingual Current-State Reverse-Engineering Reference / 中英双语当前事实完整参考

> **Scope / 范围**  
> WoT Blitz `11.19.0_china` / `11.19.0_china_apple`, WotBTools PR147 replay research.
>
> **Authority / 权威性**  
> This is the top-level current protocol reference. It contains only `AFFIRMED`, `GUESS`, and `UNKNOWN` states.  
> 本文档是当前顶层协议权威参考，仅保留 `AFFIRMED`、`GUESS`、`UNKNOWN` 三种状态。

```text
P0 replay-protocol blockers = 0
P1 replay-protocol blockers = 0
STATUS = CORE PROTOCOL RESEARCH COMPLETE FOR CURRENT 11.19 OBSERVED/CONTROLLED SURFACES
```

---

# 1. Evidence model / 证据模型

| State | 中文 | English |
|---|---|---|
| `AFFIRMED` | 当前版本 replay 证据已经确认该物理/业务语义 | Current-version replay evidence confirms the role |
| `GUESS` | 证据支持该解释，但尚不足以确认；保留原始值与边界 | Evidence supports the interpretation but does not yet justify confirmation |
| `UNKNOWN` | 已观察原始字节/ID，但当前不能安全命名 | Raw value is observed but cannot currently be safely named |

Rules / 规则：

1. Numeric packet/method/property/component IDs are client-version and entity-class scoped. / 数字 ID 必须按客户端版本与实体类型解释。
2. Historical PC WoT / BigWorld material is architectural cross-check only. / 历史资料只作为架构交叉验证。
3. Single-POV replay has real AoI/visibility boundaries. / 单 POV 存在真实可见性边界。
4. `UNKNOWN` values are raw-preserved. / 未知值必须原样保留。
5. User-facing labels must not exceed the evidence state. / 产品展示不能强于证据等级。
6. Controlled replay evidence has priority over correlation. / 受控实验优先于相关性猜测。

---

# 2. Canonical corpus / 核心样本集

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

Recorder-shot totals / 录像者射击总数：

```text
A178_SPHT       222
GB13_FV215b      32
J20_Ho_Ri_type3  17
Maus             49
VK 72.01          4
TOTAL            324
```

Controlled 11.19 probes cover / 受控实验覆盖：drowning, ammunition switching, Tungsten Shells, Precision Fire, simultaneous special modifiers, Fuel Tank, Observation Device, Gun damage/repair, ricochet, spaced armor, mantlet, HE resolution, movement, hull/turret separation, vertical gun speed, Reticle Calibration, physical speed calibration, airborne motion, and `method38 0x0200`.

---

# 3. Replay container and framing / 回放容器与 framing

`.wotbreplay` is a ZIP container / 是 ZIP 容器：

```text
meta.json
data.wotreplay
battle_results.dat
```

`data.wotreplay` header / 头部：

```text
magic               u32 LE = 0x12345678
unknownHeader       8 bytes
clientHashLength    u8
clientHash          bytes[clientHashLength]
clientVersionLength u8
clientVersion       bytes[clientVersionLength]
padding             u8
```

Packet stream / 包流：

```text
payloadLen          u32 LE
type                u32 LE
rawClockSec         f32 LE
payload             bytes[payloadLen]
```

Current facts / 当前事实：

- dynamic stream offset / packet 起始偏移动态计算 — `AFFIRMED`;
- zero-length payload is legal / 零长度 payload 合法 — `AFFIRMED`;
- current observed terminator `0xFFFFFFFF` — `AFFIRMED`;
- unknown packet data must remain raw-preserved / 未知包保留 raw — `AFFIRMED` production rule.

---

# 4. Top-level packet inventory / 顶层 packet 清单

Observed current types / 当前观察到：

```text
0, 1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 17,
23, 26, 28, 29, 31, 32, 33, 35, 36, 39, 0xFFFFFFFF
```

| Type | Current role / 当前角色 | State |
|---:|---|---|
| 0 | base-player / arena metadata family | AFFIRMED/GUESS |
| 1,2 | entity/avatar-cell creation/init family | GUESS |
| 4 | leaves recorder-observed AoI / 离开录像者可观测 AoI | AFFIRMED |
| 5 | materialization/re-entry + state/loadout/current HP family | AFFIRMED |
| 7 | EntityProperty envelope | AFFIRMED |
| 8 | EntityMethod envelope | AFFIRMED |
| 10 | high-rate movement/transform / 高频移动与姿态 | AFFIRMED |
| 11 | space/map/session config family | GUESS |
| 13 | settlement/result family | AFFIRMED |
| 14 | stream close marker | AFFIRMED |
| 17 | recorder aim/control init boundary | AFFIRMED |
| 23 | recorder projectile/shot lifecycle toggle | AFFIRMED |
| 26 | incoming hostile-shell warning family | AFFIRMED |
| 28 | recorder ammunition selection | AFFIRMED |
| 31 | aiming-circle/gun-marker size | AFFIRMED |
| 32 | auxiliary effect/state envelope | AFFIRMED |
| 33 | pre-materialization companion | AFFIRMED |
| 35 | monotonic decisecond low byte | AFFIRMED |
| 36 | full-width monotonic decisecond anchor | AFFIRMED |
| 39 | high-rate aim/camera/gun geometry | AFFIRMED |

---

# 5. Type7 EntityProperty / 实体属性

Envelope / 包装：

```text
entityId u32
propId   u32
valueLen u32
value    bytes[valueLen]
```

Vehicle properties / 车辆属性：

```text
prop0 one-byte state                                   UNKNOWN
prop1 active/terminal boolean family                   AFFIRMED family
prop2 turret yaw relative to hull                      AFFIRMED
prop3 current HP / terminal family                     AFFIRMED
prop4 two-u8 vehicle/engine/movement state tuple       GUESS exact semantic
prop7 compact state-array family                       GUESS namespace
prop8 recoverable state/effect collection              GUESS namespace
prop9 compact state-array family                       GUESS namespace
```

`prop2` conversion / 转换：

```text
angleRad = rawU16 * 2π / 65536 - π
```

`prop3` current model / 当前模型：

```text
positive i16 -> actual current HP                         AFFIRMED
0x0000       -> HP-zero terminal                          AFFIRMED
0xFFFD       -> death terminal sentinel                   AFFIRMED current corpus
0xFFFE       -> terminal on verified current chain        AFFIRMED sample/version-gated
0xFFFF       -> UNKNOWN
```

---

# 6. Type8 EntityMethod / 实体方法

Envelope / 包装：

```text
entityId u32
methodId u32
argLen   u32
args     bytes[argLen]
```

Method IDs are entity-class scoped / method ID 按 entity class 分命名空间。

High-value current methods / 高价值 method：

```text
Vehicle 0   firing signal                                  AFFIRMED
Vehicle 1   HP/source/cause update                         AFFIRMED
Vehicle 4   vehicle-to-vehicle collision                   AFFIRMED
Vehicle 6   static/world collision family                  AFFIRMED physical role
Vehicle 8   direct-hit notification + local hit segment    AFFIRMED
Avatar 4    winnerTeam + finishReason                      AFFIRMED
Avatar 5    recorder own HP mirror/opening HP               AFFIRMED
Avatar 12   battle-feedback/ribbon framework               AFFIRMED framework
Avatar 13   reload/gun-cycle telemetry family              AFFIRMED
Avatar 16   recorder module/crew state presentation        AFFIRMED
Avatar 17   ammunition descriptor/state                    AFFIRMED
Avatar 19   vehicle status/repair-progress family          AFFIRMED family
Avatar 20   shotId + projectile terminal endpoint          AFFIRMED
Avatar 25   recorder pose/state                            AFFIRMED/GUESS
Avatar 27   projectile explosion/terminal family           AFFIRMED
Avatar 28   death/death-view incoming projectile geometry AFFIRMED family
Avatar 29   projectile launch + shotId + geometry/velocity AFFIRMED
Avatar 35   reload-duration/config update                  AFFIRMED
Avatar 36   targeting snapshot protobuf                    AFFIRMED family
Avatar 38   outgoing shot-result feedback                  AFFIRMED
Avatar 43   player-name/tactical UI family                 GUESS exact symbol
Avatar 46   tactical marker/ping family                    AFFIRMED family
Avatar 47   chat/action command transport                  AFFIRMED family
Avatar 48   arena-update protobuf wrapper                  AFFIRMED
Avatar 49   synchronized client-options snapshot           AFFIRMED family
```

---

# 7. Type10 movement / transform / 移动与姿态

Canonical population / 样本：

```text
Type10 packets total       1,287,221
payload length 49          1,287,221 / 1,287,221
```

Current wire layout / 当前布局：

```text
0x00  4    u32 LE     entityId                              AFFIRMED
0x04  4    u32 LE     spaceId                               AFFIRMED
0x08  4    u32 LE     attachment/parent entity ID           AFFIRMED
0x0C  12   3*f32 LE   position x,y,z                        AFFIRMED
0x18  12   3*f32 LE   position/filter-error x,y,z           AFFIRMED structural role
0x24  12   3*f32 LE   hull yaw,pitch,roll                   AFFIRMED
0x30  1    u8          trailingStateRaw                      UNKNOWN exact semantic
```

Coordinate model / 坐标：

```text
X/Z = horizontal map plane
Y   = vertical/height
hull yaw/pitch/roll = radians
```

Controlled physical scale / 受控物理标定：

```text
Kanonenjagdpanzer 105 forward median = 15.8364 unit/s = 57.011 km/h
Kanonenjagdpanzer 105 reverse median =  5.5804 unit/s = 20.089 km/h
1 Type10 position unit ~= 1 meter                           AFFIRMED
```

Independent vertical cross-check / 独立垂直验证：

```text
Rhm airborne trajectory fitted vertical acceleration ~= -9.74 unit/s²
trailingStateRaw = 1 for 369/369 recorder Type10 samples in that replay
trailingStateRaw exact semantic = UNKNOWN
```

Heading / 朝向：

```text
forwardWorld.x = sin(hullYaw)
forwardWorld.z = cos(hullYaw)
```

Derived movement / 派生移动：

```text
vx = Δx / Δt
vy = Δy / Δt
vz = Δz / Δt
planarSpeedMps = sqrt(vx² + vz²)
speedKmh = planarSpeedMps * 3.6
signedForwardSpeed = (Δx*sin(yaw) + Δz*cos(yaw)) / Δt
hullYawRate = wrapPi(yaw2 - yaw1) / Δt
```

Current derived facts / 当前可安全派生：

```text
stationary/moving        AFFIRMED derived
forward/reverse          AFFIRMED derived
hull turning             AFFIRMED derived
hull + translation       AFFIRMED derived
vertical ascent/descent  AFFIRMED derived
airborne trajectory      AFFIRMED controlled
approx acceleration      AFFIRMED derived, noise-sensitive
```

Sampling cadence is approximately 10 Hz while observed / 可观测期间约 10 Hz — `AFFIRMED`.

---

# 8. AoI and visibility / 可见性边界

```text
visible/materialized
-> observed Type10 samples
-> Type4 leaves recorder-observed AoI
-> hidden interval = UNKNOWN_AOI
-> Type33 + Type5 re-entry/materialization
-> Type10 resumes
```

Production rule / 生产规则：interpolation is safe only inside one continuous observed segment. A hidden interval remains `UNKNOWN_AOI`.

---

# 9. Hull, turret and gun orientation / 车体炮塔炮管姿态

```text
Type10 hullYawWorld                              AFFIRMED
Vehicle prop2 turretYawRelative                  AFFIRMED
turretYawWorld = wrapPi(hullYawWorld + turretYawRelative)  AFFIRMED derived
Type39 f5 turret/gun-relative yaw family         AFFIRMED relationship
Type39 f6 local gun pitch                        AFFIRMED relationship
```

Controlled WZ-120 phases separately cover translation, hull rotation, turret-only rotation, and combined hull+turret movement.

---

# 10. HP and terminal/death facts / 血量与死亡

Vehicle method1 wire / wire 结构：

```text
currentHpRaw u16
sourceEntity u32
causeFlag    u8
```

Cause map / 原因：

```text
0 direct/default combat damage       AFFIRMED
1 fire                               AFFIRMED
2 ramming                            AFFIRMED
3 world/self-environment             AFFIRMED
4 UNKNOWN
5 drowning                           AFFIRMED controlled
```

Controlled drowning / 溺水受控样本：

```text
causeFlag=5                      AFFIRMED DROWNING
settlement/wrapper deathReason=5 AFFIRMED DROWNING
terminal remaining HP may be positive in this cause chain  AFFIRMED
```

Current modeling rule / 当前建模：HP timeline and terminal/death state are separate authoritative facts. Single-POV sub-second live terminal coverage in the canonical corpus is `283/287 = 98.61%`; four cases use settlement-second fallback.

---

# 11. Projectile lifecycle / 弹丸生命周期

Current observed graph / 当前链：

```text
Vehicle method0 firing
-> Avatar method29 launch
-> Avatar method20 terminal endpoint
-> Avatar method27 terminal/explosion family when present
```

Avatar method29 / 发射：

```text
shooterEntityId  u32
shotId           u32
rawFlag          u8
launchPoint      VECTOR3<f32>
launchVelocity   VECTOR3<f32>
terminalRaw      f32
```

Key facts / 关键事实：

```text
shotId                                AFFIRMED
launch velocity vector                AFFIRMED
launch point/reference family         AFFIRMED
method29 is global observed projectile feed   AFFIRMED
recorder ownership requires shooter filtering AFFIRMED production rule
```

Avatar method20 / 终点：

```text
shotId    u32
endPoint  VECTOR3<f32>
```

`shotId + terminal endpoint` — `AFFIRMED`.

---

# 12. Ammunition / 弹种

```text
Type28 selectionValue u32 LE                 AFFIRMED recorder ammunition-selection state
Avatar method17 shell descriptor/inventory  AFFIRMED
```

Safe chain / 安全链：

```text
Type28 selectionValue
-> method17 shellDescriptor
-> version-matched shell catalog
-> user-facing ammo name/type
```

FV215b controlled 11.19 / 受控映射：

```text
Type28=0 -> descriptor 0x003C5A0A -> AP
Type28=1 -> descriptor 0x00465A0A -> APCR
Type28=2 -> descriptor 0x003B5A0A -> HESH / HE-family
```

This mapping is vehicle/version scoped / 仅限对应车辆与版本。

---

# 13. Component namespace / 模块与乘员命名空间

```text
31 Engine              AFFIRMED
32 Ammo Rack           AFFIRMED
33 Fuel Tank           AFFIRMED
34 Right Track         AFFIRMED
35 Left Track          AFFIRMED
36 Gun                 AFFIRMED
37 Turret Rotator      AFFIRMED version-scoped
38 Observation Device  AFFIRMED
39 Commander           AFFIRMED
40 Driver              AFFIRMED
41 Gunner               AFFIRMED
42 UNKNOWN/unobserved
43 Loader               AFFIRMED
```

Track side orientation is closed from current target-local geometry / 履带左右由当前命中几何确认。

---

# 14. method16 module/crew lifecycle / 模块乘员状态

```text
4  damaged/degraded operational                    AFFIRMED
5  critical/disabled                               AFFIRMED
18 automatic critical self-repair -> damaged      AFFIRMED physical role
19 full repair/clear                               AFFIRMED
10 crew injured/shell-shocked                      AFFIRMED
22 crew healed/clear                               AFFIRMED
```

Fuel Tank controlled relation / 油箱：

```text
codeA=8 + component33 -> ignition/fire-start transition family  AFFIRMED physical relationship
```

---

# 15. method38 wire structure / 命中结果结构

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

This structure is `AFFIRMED` for current controlled/canonical 11.19 samples.

---

# 16. method38 resultFlags16 / 命中位图

```text
0x0001 direct terminal shell kill                                      AFFIRMED
0x0002 target already dead before attack                               AFFIRMED sample / low-N
0x0004 fire started                                                     AFFIRMED
0x0008 ricochet                                                         AFFIRMED controlled
0x0010 positive material/vehicle penetration by projectile              AFFIRMED
0x0020 projectile non-penetration/material stop                         AFFIRMED controlled
0x0040 zero-DF/spaced layer pierced by projectile                       AFFIRMED controlled
0x0080 zero-DF/spaced layer not pierced                                 AFFIRMED controlled
0x0100 internal device/module pierced/involved by projectile            AFFIRMED
0x0200 internal device/module not pierced by projectile                 AFFIRMED controlled
0x0400 chassis/track damaged by projectile                              AFFIRMED
0x0800 Gun damaged by projectile                                        AFFIRMED
0x1000 positive-DF material explosion branch                            AFFIRMED controlled
0x2000 zero-DF/spaced-layer explosion branch                            AFFIRMED controlled / low-N
0x4000 component/device involved by explosion                           AFFIRMED controlled
0x8000 component/device damaged by explosion                            AFFIRMED controlled
```

---

# 17. `0x0200` controlled closure / 受控确认

Controlled replay / 受控回放：

```text
recorder = CHRD-A158布丁
vehicle  = G190_VK_1602_Quby
target   = Maus
phase 1  = Gun/barrel, 15 projectiles
phase 2  = Fuel Tank, 15 projectiles
method29 launches = 30
method38 results  = 30
same-clock pairs  = 30/30
```

Gun phase key result / 炮管阶段关键结果：

```text
0x0240 = 0x0200 | 0x0040
```

Same phase also contains / 同阶段另有：

```text
0x0100 + component36 + rawState0
```

Fuel Tank control / 油箱对照：

```text
0x0110 = 0x0010 | 0x0100
component33 rawState0/1
```

Current physical identity / 当前物理语义：

```text
0x0200 = PROJECTILE_DEVICE_NOT_PIERCED
       = internal device/module not pierced by projectile
       = AFFIRMED controlled
```

---

# 18. method38 component results / 模块结果状态

```text
rawState0 = component involved/hit with no newly observed persistent negative state
            AFFIRMED physical role; exact private enum UNKNOWN
rawState1 = module damaged / crew injured     AFFIRMED
rawState2 = module critical/disabled           AFFIRMED
```

Module involvement and persistent damage are separate result dimensions / 模块命中与持续损坏是两个独立维度。

---

# 19. method38 special modifiers / 特殊炮弹效果

```text
modifierId=1 -> Precision Fire    AFFIRMED controlled
modifierId=2 -> Tungsten Shells   AFFIRMED controlled
```

Controlled simultaneous hit / 同发受控样本：

```text
modifierCount=2
modifiers=[1,2]
```

Repeatable modifier list and same-hit coexistence are `AFFIRMED`.

---

# 20. Type31 / Type39 / method36 targeting / 瞄准状态

```text
Type31 = aiming-circle/gun-marker size                    AFFIRMED
Type39 f5 = turret/gun-relative yaw family                AFFIRMED relationship
Type39 f6 = local gun pitch                               AFFIRMED relationship
```

method36 current high-value fields / 当前高价值字段：

```text
root.field1 = turret/gun relative yaw               AFFIRMED
root.field2 = gun pitch                             AFFIRMED
root.field3 = max horizontal angular speed          AFFIRMED controlled
root.field4 = max vertical angular speed            AFFIRMED controlled
root.field5 = aiming-time physical scalar           AFFIRMED
field6.field1 = dynamic gun dispersion/bloom        AFFIRMED
```

Controlled perturbations / 受控扰动：

```text
shot boundary        -> field6.field1 positive bloom jump
Gun damage           -> field6.field1 ×2; root.field4 ×0.675
Repair               -> exact baseline restoration
Reticle Calibration  -> root.field5 ×0.70; field6.field1 ×0.70
Reticle end           -> exact baseline restoration
```

Remaining static/nested method36 coefficients have `GUESS/UNKNOWN` exact private names/units.

---

# 21. Clocks / 时间轴

```text
rawClockSec          packet float clock                     AFFIRMED
Type35               monotonic decisecond low-byte surface  AFFIRMED
Type36               full-width decisecond anchor           AFFIRMED
```

Production should preserve raw clocks and explicit derived-time provenance. Network/batch delivery clock differences are not automatically physical flight time.

---

# 22. Collision / 碰撞

```text
Vehicle method4 = vehicle-to-vehicle collision/contact       AFFIRMED
Vehicle method6 = static/world collision physical family     AFFIRMED
```

Collision evidence can be combined with Type10 position/velocity and Vehicle method1 cause updates for impact-context reconstruction.

---

# 23. Settlement / 结算

`battle_results.dat` is the final-result authority/cross-check for settled battle facts / 是最终结算事实与交叉验证源。

Current focused closures include / 已确认：

```text
shots / hits / damage / kills / team outcome             AFFIRMED settlement facts
deathReason=5 drowning                                   AFFIRMED controlled
method12 baseType15 / settlement field119 destruction assistance count   AFFIRMED
settlement field120 Gun Marks count                      AFFIRMED
selected wrapper6 secondary assist attribution           AFFIRMED focused relationship
```

```text
field118 / method12 baseType12 exact statistic name = UNKNOWN
```

---

# 24. Production-safe fact model / 推荐生产事实模型

```text
ProtocolFact<T> {
    value
    evidenceState   // AFFIRMED | GUESS | UNKNOWN
    clientVersion
    rawProvenance
}
```

Movement / 移动：

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
```

Derived movement / 派生：

```text
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
```

Hit result / 命中结果：

```text
Method38HitResult {
    victimVehicleId
    resultFlags16
    headerHi16Raw
    componentResults[]
    modifiers[]
}
```

---

# 25. Current `main` implementation boundary / 当前 main 实现边界

PR147 is protocol research documentation. Current `main` does not yet expose every closed research surface.

Implementation convergence work / 后续业务实现工作：

```text
Type10: expose positionError if useful
Type10: expose neutral trailingStateRaw if useful
movement: derive m/s, km/h, forward/reverse and yaw rate from Type10
HP/death: use live HP/terminal surfaces with explicit fallback provenance
method38: expose complete low16 hit semantics and component/modifier results
method36: expose high-value targeting scalars where AI Review benefits
AoI: preserve hidden intervals as UNKNOWN_AOI
```

These are implementation tasks; they do not reopen protocol P0/P1.

---

# 26. Current bounded research / 当前剩余研究边界

```text
component42 exact private identity                         UNKNOWN
method38 rawState0 exact private enum name                 UNKNOWN
method16 sparse transition private names                   UNKNOWN
method36 remaining static coefficient exact names/units    GUESS/UNKNOWN
Vehicle prop7/8/9 complete token namespaces                GUESS/UNKNOWN
method17 init/feed-tail exact fields                       UNKNOWN
unobserved cause/death enum values                         UNKNOWN
Type10 trailingStateRaw exact semantic                     UNKNOWN
Type10 positionError exact generation rule                 UNKNOWN
observer/cosmetic/platform exact private names             UNKNOWN
future-version numeric stability                           UNKNOWN until regression-tested
```

An unresolved field defaults to `UNKNOWN`, not to low value. / 未解析字段默认是 `UNKNOWN`，不能仅因暂时不阻塞业务就判定低价值。

---

# 27. Version regression checklist / 版本回归清单

For every new stable client version / 每个新稳定版本至少验证：

1. container/header/framing and terminator;
2. top-level type inventory;
3. Type7 envelope and high-value props;
4. Type8 envelope and entity-class method IDs;
5. Type10 payload length/ordering and meter scale;
6. method29/method20 shotId pairing;
7. Type28/method17 ammunition chain;
8. method38 wire, flags, component states, modifiers;
9. component namespace;
10. method16 lifecycle;
11. Type31/39/method36 targeting shape and controlled ratios;
12. HP/death causes;
13. AoI lifecycle;
14. settlement compatibility;
15. raw preservation of new/unknown values.

---

# 28. Controlled-replay methodology / 受控回放方法

```text
one variable per replay when possible
record vehicle / target / ammo / consumable / aimed region
use shotId/projectile lifecycle as intrinsic markers
use idle gaps between phases
preserve SHA-256 and arenaId
compare positive and negative controls
record contamination windows such as consumables, fire, repair, collision
```

Strong examples in this archive / 强受控样本：

- forward + reverse top-speed plateaus independently calibrating Type10 meter scale;
- airborne ballistic Type10-Y trajectory constraining vertical movement and preserving `trailingStateRaw` as `UNKNOWN`;
- Reticle Calibration exact reversible `0.70` targeting multipliers;
- Gun damage exact `×2` / `×0.675` targeting effects with repair restoration;
- Quby→Maus Gun/Fuel-Tank phases closing `0x0200`;
- Precision Fire + Tungsten same-hit `[1,2]` modifier list.

---

# 29. Documentation maintenance / 文档维护

1. This bilingual document is the top-level current-state authority. / 本文档是当前事实顶层权威。
2. Current authoritative summaries use only `AFFIRMED`, `GUESS`, and `UNKNOWN`.
3. Focused research notes may keep raw experiment timelines, but current product semantics must be taken from this document.
4. Every new `AFFIRMED` field must update this reference and the current inventory/audit.
5. New versions require regression before numeric IDs are reused.
6. Raw fields and provenance remain available even after semantic decoding.

---

# 30. Final status / 最终状态

## 中文

WoT Blitz 11.19 China 当前高价值 replay protocol 已达到：

```text
P0 = 0
P1 = 0
```

当前 `AFFIRMED` 能力覆盖：

- replay container 与 packet framing；
- 实体身份与 AoI 生命周期；
- Type10 位置、姿态、米制单位、速度、前后退、转向、垂直运动；
- HP 与 terminal/death cause；
- projectile launch / endpoint / terminal family；
- ammunition selection + descriptor；
- ricochet、material stop、spaced/zero-DF layer、device pierce/non-pierce、track/gun damage、explosion resolution；
- Engine / Ammo Rack / Fuel Tank / Tracks / Gun / Turret Rotator / Observation Device；
- Commander / Driver / Gunner / Loader；
- damaged / critical / auto-repair / full repair / crew injury/heal；
- Precision Fire / Tungsten 与 same-hit modifier list；
- Type31 / Type39 / method36 高价值 targeting；
- single-POV visibility boundary；
- settlement cross-check 与 AI Review 事实链。

剩余项按 `GUESS` 或 `UNKNOWN` 保留，不构成当前 11.19 P0/P1 blocker。

## English

Current WoT Blitz 11.19 China replay research has no known P0/P1 semantic blocker for WotBTools’ high-value use cases. Movement, HP/death, projectile lifecycle, ammunition, hit resolution, component/crew state, special modifiers, targeting and POV visibility boundaries are production-usable within explicit version and evidence-state constraints. Remaining private symbols and low-frequency values stay `GUESS` or `UNKNOWN` and remain raw-preserved.
