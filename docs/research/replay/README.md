# WoT Blitz Replay Protocol Research Archive

本目录记录 WotBTools 对 WoT Blitz `.wotbreplay` 的逆向研究。

> Scope: Blitz `11.19.0_china` / `11.19.0_china_apple`.
>
> Base canonical corpus: 34 unique arenas / 476 settled players.
>
> Current research gate: **P0=0 / P1=0**.
>
> Status: **CORE PROTOCOL RESEARCH COMPLETE / PRODUCTION-USABLE FOR CURRENT 11.19 OBSERVED AND CONTROLLED SURFACES**.

这里的 complete 不表示拿到了全部 Wargaming 私有变量名，也不表示单 POV replay 是 omniscient telemetry。它表示当前 WotBTools 高价值 replay surfaces 已经没有已知 P0/P1 语义 blocker；剩余工作属于 P2/P3 私有符号、低频 enum、实现收敛和未来版本回归。

## 权威读取顺序

后续实现、审查和研究必须按以下优先级读取：

1. **`WOTB_REPLAY_PROTOCOL_11_19_BILINGUAL_COMPLETE_REFERENCE.md`** — 新的中英双语顶层权威文档；同时区分 protocol truth 与 `main` 当前实现状态。
2. 当前 focused closure 文档，例如 `type10-movement-transform-closure.md`、`method38-0200-device-not-pierced-closure.md`、method36 / HP / ammo / component 专项 closure。
3. `inventory.md` — canonical fact ledger。
4. `research-completion-audit-11.19.md` — completion gate / remaining-boundary audit。
5. `WOTB_REPLAY_PROTOCOL_11_19_COMPLETE_REFERENCE.md` — 较早英文综合参考；若与 1–4 冲突，以 1–4 为准。
6. `protocol.md` 和早期 broad probe notes — 研究轨迹与历史上下文。

`main/docs/reference/replay-data.md` 等 11.18-era production docs 不能覆盖 PR147 current controlled evidence；其中部分 Type4、Type10 tail、legacy direct-damage 解释已被后续研究推翻或收敛。

## 研究原则

- Evidence grades: `PROVEN / VERY STRONG PARTIAL / PARTIAL / UNKNOWN / SUPERSEDED / REJECTED`.
- `PROVEN` 必须依赖当前 replay 行为；历史 PC/WoT/BigWorld 只做 architecture cross-check。
- numeric IDs 全部 version + entity-class scoped。
- UNKNOWN 默认 raw-preserve，不为了业务完整度强行命名。
- single POV / AoI 是真实信息边界。
- controlled replay 优先于相关性猜测。
- non-blocking != low-value。

## Current P0/P1 closure summary

```text
P0 = 0
P1 = 0

Type10 movement / physical units      CLOSED
Type10 vertical/airborne movement     CLOSED
Type10 trailing byte == onGround      REJECTED and corrected
method36 high-value targeting roles   CLOSED
method38 0x0200 positive sample       CLOSED
```

### Type10 movement

Current 49-byte layout:

```text
0x00 entityId
0x04 spaceId
0x08 attachment/parent entity ID
0x0C position x,y,z
0x18 position/filter-error x,y,z
0x24 hull yaw,pitch,roll
0x30 trailingStateRaw  // semantic UNKNOWN; NOT onGround
```

Canonical population: `1,287,221 / 1,287,221` Type10 packets are 49 bytes.

Controlled speed calibration:

```text
Kanonenjagdpanzer 105 forward  15.8364 unit/s -> 57.011 km/h
Kanonenjagdpanzer 105 reverse   5.5804 unit/s -> 20.089 km/h
```

Therefore `1 Type10 position unit ~= 1 meter` is PROVEN controlled for current 11.19.

Rhm airborne controlled replay independently gives a ballistic Type10-Y trajectory with ~`-9.74 unit/s²` vertical acceleration, while the trailing byte remains `1` for `369/369` recorder samples. Therefore `offset 0x30 == onGround` is REJECTED.

### method38 resultFlags16

```text
0x0001 direct terminal shell kill                                      PROVEN
0x0002 target already dead before attack                               PROVEN sample / low-N
0x0004 fire started                                                     PROVEN
0x0008 ricochet                                                         PROVEN controlled
0x0010 positive material/vehicle penetration by projectile              PROVEN
0x0020 projectile non-penetration / material stop                       PROVEN controlled
0x0040 zero-DF/spaced layer pierced by projectile                       PROVEN controlled
0x0080 zero-DF/spaced layer not pierced                                 PROVEN controlled
0x0100 internal device/module pierced/involved by projectile            PROVEN
0x0200 internal device/module not pierced by projectile                 PROVEN controlled
0x0400 chassis/track damaged by projectile                              PROVEN
0x0800 Gun damaged by projectile                                        PROVEN
0x1000 positive-DF material explosion branch                            PROVEN controlled
0x2000 zero-DF/spaced layer explosion branch                            PROVEN controlled low-N
0x4000 component/device involved by explosion                           PROVEN controlled
0x8000 component/device damaged by explosion                            PROVEN controlled
```

`0x0200` closure comes from the controlled Quby -> Maus replay: first 15 projectiles aimed at the Gun/barrel, second 15 at the Fuel Tank, with `30/30` recorder method29 launches paired same-clock to method38. The critical Gun-phase sample is `0x0240 = 0x0200 | 0x0040`; the same phase also contains `0x0100 + component36`, while the Fuel Tank control repeatedly produces `0x0110 + component33`.

### Components / crew

```text
31 Engine
32 Ammo Rack
33 Fuel Tank
34 Right Track
35 Left Track
36 Gun
37 Turret Rotator
38 Observation Device
39 Commander
40 Driver
41 Gunner
42 UNKNOWN/unobserved
43 Loader
```

### method16 lifecycle

```text
4  damaged/degraded operational
5  critical/disabled
18 automatic critical self-repair -> damaged
19 full repair/clear
10 crew injured/shell-shocked
22 crew healed/clear
```

### Targeting

```text
Type31 = aiming-circle/gun-marker size                     PROVEN
Type39 f5 = turret/gun relative yaw family                 PROVEN relationship
Type39 f6 = local gun pitch                                PROVEN relationship

method36.root.field1 = turret/gun relative yaw             PROVEN
method36.root.field2 = gun pitch                           PROVEN
method36.root.field3 = max horizontal angular speed        PROVEN controlled
method36.root.field4 = max vertical angular speed          PROVEN controlled
method36.root.field5 = aiming-time physical scalar         PROVEN
method36.field6.field1 = dynamic gun dispersion/bloom      PROVEN
```

Gun damage makes `field6.field1 ×2`; Reticle Calibration makes both aiming-time and bloom scalars exactly `×0.70` and they restore at the end boundary.

### HP / death

```text
causeFlag 0 = direct/default
causeFlag 1 = fire
causeFlag 2 = ramming
causeFlag 3 = world/self-environment
causeFlag 4 = UNKNOWN
causeFlag 5 = drowning
```

Controlled drowning proves positive-HP terminal death and `deathReason=5 = DROWNING`; therefore `death == HP<=0` is REJECTED.

### Ammunition / special modifiers

```text
Type28 = recorder ammo selection state       PROVEN
method17 = shell descriptor/inventory        PROVEN
modifier 1 = Precision Fire                  PROVEN
modifier 2 = Tungsten Shells                 PROVEN
[1,2] on one hit                             PROVEN
```

## Remaining bounded research

Not P0/P1 blockers:

```text
component42 exact private identity
method38 rawState0 exact enum symbol
method16 sparse transition-code private names
method36 remaining static coefficient exact names/units
Vehicle prop7/8/9 complete namespaces
method17 init/feed-tail exact fields
unobserved cause/death enum values
Type10 trailingStateRaw exact semantic
Type10 positionError exact generation rule
observer/cosmetic/platform private names
future-version numeric stability
```

## Maintenance rule

任何新的 current-version PROVEN 事实必须同步：focused closure + bilingual complete reference + inventory；若影响 completion gate，再同步 completion audit。UNKNOWN 必须继续 raw-preserve/version-gate。
