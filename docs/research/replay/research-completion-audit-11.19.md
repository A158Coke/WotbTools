# Blitz 11.19 China replay research — completion audit

> Base corpus: 34 unique arenas / 476 settled players.
>
> Scope: PR147 research archive + all current-version controlled probes used to close P0/P1 replay-protocol semantics.
>
> Top-level authority: `WOTB_REPLAY_PROTOCOL_11_19_BILINGUAL_COMPLETE_REFERENCE.md`.

## Executive verdict

```text
P0 replay-protocol blockers = 0
P1 replay-protocol blockers = 0
```

Current status:

> **CORE PROTOCOL RESEARCH COMPLETE / PRODUCTION-USABLE FOR CURRENT 11.19 OBSERVED AND CONTROLLED SURFACES**

This does **not** claim recovery of every private Wargaming symbol, complete omniscient battle state, or cross-version ordinal stability. Remaining boundaries are P2/P3/private-schema work, low-frequency/unobserved enums, implementation convergence, and future-version regression.

## Canonical consistency

```text
unique arenas                         34
settled players                       476
unique recorder method29 shotIds     324
settlement recorder shots            324
method38 recorder hit feedback       295
settlement recorder hits             295
settled dead combatants              287
live sub-second terminal closure     283 / 287 = 98.61%
settlement-second fallback             4 / 287 = 1.39%
```

Old 341-shot aggregate is `SUPERSEDED`.

## P1 closure ledger

### P1 — Type10 movement / transform: CLOSED

Canonical Type10 population:

```text
1,287,221 packets
49-byte payload 1,287,221 / 1,287,221
```

Closed current fields:

```text
entityId
spaceId
attachment/parent entity ID
position x/y/z
position/filter-error vector structural role
hull yaw/pitch/roll
~10 Hz sampling
```

Controlled movement facts:

```text
forward/reverse classification      CLOSED
hull rotation                       CLOSED
hull vs turret separation           CLOSED
linear speed                        CLOSED derived
physical meter scale                CLOSED controlled
vertical/airborne movement          CLOSED controlled
AoI continuity boundary             CLOSED
```

Physical scale controlled by Kanonenjagdpanzer 105:

```text
15.8364 unit/s -> 57.011 km/h forward
5.5804 unit/s  -> 20.089 km/h reverse
```

Therefore `1 Type10 position unit ~= 1 meter` is PROVEN controlled.

Rhm airborne replay supplies a ballistic Type10-Y trajectory with fitted vertical acceleration around `-9.74 unit/s²`.

Critical correction:

```text
Type10 trailing byte == onGround   REJECTED
```

The Rhm recorder remains `raw=1` for `369/369` Type10 samples across the controlled airborne trajectory. The byte is now `trailingStateRaw` with UNKNOWN exact semantic.

### P1 — method36 high-value targeting semantics: CLOSED

Closed fields:

```text
root.field1 = turret/gun relative yaw               PROVEN
root.field2 = gun pitch                             PROVEN
root.field3 = max horizontal angular speed          PROVEN controlled
root.field4 = max vertical angular speed            PROVEN controlled
root.field5 = aiming-time physical scalar           PROVEN
field6.field1 = dynamic gun dispersion/bloom        PROVEN
```

Independent perturbations:

```text
shot boundary        -> bloom rises
Gun damage           -> field6.field1 ×2; root.field4 ×0.675
Repair               -> exact baseline restore
Reticle Calibration  -> root.field5 ×0.70; field6.field1 ×0.70
Reticle end           -> exact baseline restore
```

Three remaining static/nested coefficients lack exact private names/units, but no longer block current high-value AI Review or battle-reconstruction facts. They are P2/private-schema recovery.

### P1 — method38 `0x0200`: CLOSED

Controlled replay:

```text
recorder = CHRD-A158布丁
vehicle  = G190_VK_1602_Quby
target   = Maus
phase 1  = Gun/barrel, 15 projectiles
phase 2  = Fuel Tank, 15 projectiles
method29/method38 same-clock pairs = 30/30
```

Critical Gun/barrel result:

```text
0x0240 = 0x0200 | 0x0040
```

Same Gun phase also contains:

```text
0x0100 + component36 + rawState0
```

Fuel Tank control repeatedly contains:

```text
0x0110 = 0x0010 | 0x0100
component33 rawState0/1
```

Therefore:

```text
0x0200 = internal device/module not pierced by projectile
       = PROJECTILE_DEVICE_NOT_PIERCED
       = PROVEN controlled current physical role
```

It must not be listed as UNKNOWN/unobserved/P1 in current authoritative docs.

## Complete method38 low16 map

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
0x2000 zero-DF/spaced-layer explosion branch                            PROVEN controlled low-N
0x4000 component/device involved by explosion                           PROVEN controlled
0x8000 component/device damaged by explosion                            PROVEN controlled
```

## HP / death gate

Current safe facts include:

```text
actual replay HP surfaces outrank Tankopedia base HP
Vehicle prop3 current HP / terminal family
Vehicle method1 source/cause updates
causeFlag 0 direct/default
causeFlag 1 fire
causeFlag 2 ramming
causeFlag 3 world/self-environment
causeFlag 5 drowning
wrapper/settlement deathReason5 drowning
positive-HP terminal death possible
```

Therefore:

```text
death == HP<=0 universally   REJECTED
```

Single-POV live death precision is explicitly bounded at 283/287 sub-second closures. Four settlement-second fallbacks are observation boundaries, not fabricated live facts.

## Component / crew gate

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

Core method16 lifecycle:

```text
4 damaged
5 critical
18 automatic critical self-repair -> damaged
19 full repair
10 crew injured
22 crew healed
```

Fuel Tank `codeA=8` ignition/fire-start physical relationship is controlled-closed.

## Projectile / ammunition / special modifier gate

Closed:

```text
method29 launch + shooter + shotId + launch geometry/velocity
method20 terminal endpoint
method27 terminal/explosion family
Type28 recorder ammunition selection
method17 shell descriptor/inventory
Precision Fire modifier1
Tungsten Shells modifier2
simultaneous [1,2] modifier list
```

FV215b controlled current mapping remains vehicle/version scoped.

## AoI / POV gate

```text
Type4 = leaves recorder-observed AoI     PROVEN
Type4 == death                           REJECTED
```

Hidden intervals remain UNKNOWN. No interpolation across hidden intervals may be labeled observed truth.

## Main implementation convergence boundary

The current `main` implementation is not identical to the now-closed research model. Known implementation debt includes:

- Type10 parser does not yet expose positionError or neutral trailingStateRaw;
- older docs/comments still use `is_error/onGround` language for the Type10 tail;
- legacy direct-damage raw-value decoding is not a universal HP authority;
- some death fallbacks still reflect older Type4/damage heuristics;
- current production DTOs do not yet expose all closed method38/method36 semantics.

These are implementation-convergence tasks, not open protocol P1 research blockers.

## Explicit rejected/superseded interpretations

```text
Type4 == death                                             REJECTED
Type28 == target lock / auto aim                          REJECTED
41 == Radioman / 42 == Gunner                             SUPERSEDED
34/35 exact side unresolved                               SUPERSEDED
baseType12 == base defended / dropped capture points      REJECTED
all method38 32 header bits == homogeneous hit enum       REJECTED
method38 0x1000 == universal Gun-damage bit               REJECTED
Tankopedia base HP == actual replay HP                    REJECTED as primary
single POV guarantees 100% sub-second death               REJECTED
method38 tail == one optional u32 extension               SUPERSEDED
Precision Fire/Tungsten mutually exclusive                REJECTED
combined Precision Fire+Tungsten == modifier3             REJECTED
Type10 trailing byte == onGround                          REJECTED controlled
Type10 positionError == velocity                          REJECTED
```

## Remaining P2/P3 boundaries

```text
component42 exact private identity
method38 rawState0 exact enum name
method16 sparse transition private names
method36 remaining static coefficient exact names/units
Vehicle prop7/8/9 complete namespaces
method17 init/feed-tail exact fields
unobserved cause/death enum values
Type10 trailingStateRaw exact semantic
Type10 positionError exact generation rule
observer/cosmetic/platform private names
future-version numeric stability
```

These are raw-preserved/version-gated and do not reopen P0/P1.

## Final audit

```text
P0 replay-protocol blockers                 0
P1 replay-protocol blockers                 0
canonical-count contradiction blockers      0
core controlled-surface semantic blockers   0
single-POV boundaries                       documented
private-symbol boundaries                   documented / non-blocking
implementation convergence                  separate follow-up concern

CURRENT 11.19 STATUS:
CORE PROTOCOL RESEARCH COMPLETE / PRODUCTION-USABLE
```
