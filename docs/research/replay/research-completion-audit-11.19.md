# Blitz 11.19 China replay research — completion audit

> Base corpus: 34 unique arenas / 476 settled players.
>
> Scope: PR147 research archive + current-version controlled probes used to close P0/P1 replay-protocol semantics.
>
> Top-level authority: `WOTB_REPLAY_PROTOCOL_11_19_BILINGUAL_COMPLETE_REFERENCE.md`.

## Evidence policy

Current authoritative documentation uses only:

- `AFFIRMED`
- `GUESS`
- `UNKNOWN`

Historical interpretations that have been disproved are intentionally omitted from this audit.

## Executive verdict

```text
P0 replay-protocol blockers = 0
P1 replay-protocol blockers = 0
```

Current status:

> **CORE PROTOCOL RESEARCH COMPLETE / PRODUCTION-USABLE FOR CURRENT 11.19 OBSERVED AND CONTROLLED SURFACES**

This does not claim recovery of every private Wargaming symbol, omniscient battle state, or cross-version ordinal stability. Remaining boundaries are P2/P3/private-schema work, low-frequency or unobserved enums, implementation convergence, and future-version regression.

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

## P1 closure ledger

### Type10 movement / transform — CLOSED

Canonical Type10 population:

```text
1,287,221 packets
49-byte payload 1,287,221 / 1,287,221
```

Current field model:

```text
entityId                              AFFIRMED
spaceId                               AFFIRMED
attachment/parent entity ID           AFFIRMED
position x/y/z                        AFFIRMED
position/filter-error vector          AFFIRMED structural role; exact generation UNKNOWN
hull yaw/pitch/roll                   AFFIRMED
trailingStateRaw                      UNKNOWN exact semantic
~10 Hz sampling                       AFFIRMED
```

Controlled movement facts:

```text
forward/reverse classification      AFFIRMED derived
hull rotation                       AFFIRMED derived
hull vs turret separation           AFFIRMED
linear speed                        AFFIRMED derived
physical meter scale                AFFIRMED controlled
vertical/airborne movement          AFFIRMED controlled
AoI continuity boundary             AFFIRMED
```

Physical scale controlled by Kanonenjagdpanzer 105:

```text
15.8364 unit/s -> 57.011 km/h forward
5.5804 unit/s  -> 20.089 km/h reverse
```

Current physical scale:

```text
1 Type10 position unit ~= 1 meter   AFFIRMED controlled
```

Rhm airborne replay provides an independent Type10-Y ballistic trajectory with fitted vertical acceleration around `-9.74 unit/s²`. In that replay `trailingStateRaw=1` for `369/369` recorder Type10 samples; the exact meaning of the byte remains `UNKNOWN`.

### method36 high-value targeting semantics — CLOSED

```text
root.field1 = turret/gun relative yaw               AFFIRMED
root.field2 = gun pitch                             AFFIRMED
root.field3 = max horizontal angular speed          AFFIRMED controlled
root.field4 = max vertical angular speed            AFFIRMED controlled
root.field5 = aiming-time physical scalar           AFFIRMED
field6.field1 = dynamic gun dispersion/bloom        AFFIRMED
```

Independent perturbations:

```text
shot boundary        -> bloom rises
Gun damage           -> field6.field1 ×2; root.field4 ×0.675
Repair               -> exact baseline restore
Reticle Calibration  -> root.field5 ×0.70; field6.field1 ×0.70
Reticle end           -> exact baseline restore
```

Remaining static/nested coefficients have `GUESS/UNKNOWN` exact private names/units and do not block current high-value AI Review or battle-reconstruction facts.

### method38 `0x0200` — CLOSED

Controlled replay:

```text
recorder = CHRD-A158布丁
vehicle  = G190_VK_1602_Quby
target   = Maus
phase 1  = Gun/barrel, 15 projectiles
phase 2  = Fuel Tank, 15 projectiles
method29/method38 same-clock pairs = 30/30
```

Key Gun/barrel result:

```text
0x0240 = 0x0200 | 0x0040
```

Same Gun phase:

```text
0x0100 + component36 + rawState0
```

Fuel Tank control:

```text
0x0110 = 0x0010 | 0x0100
component33 rawState0/1
```

Current physical meaning:

```text
0x0200 = PROJECTILE_DEVICE_NOT_PIERCED
       = internal device/module not pierced by projectile
       = AFFIRMED controlled
```

## Complete method38 low16 map

```text
0x0001 direct terminal shell kill                                      AFFIRMED
0x0002 target already dead before attack                               AFFIRMED sample / low-N
0x0004 fire started                                                     AFFIRMED
0x0008 ricochet                                                         AFFIRMED controlled
0x0010 positive material/vehicle penetration by projectile              AFFIRMED
0x0020 projectile non-penetration / material stop                       AFFIRMED controlled
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

## HP / death gate

Current safe facts:

```text
Vehicle prop3 current HP / terminal family                 AFFIRMED
Vehicle method1 source/cause updates                       AFFIRMED
causeFlag 0 direct/default                                 AFFIRMED
causeFlag 1 fire                                           AFFIRMED
causeFlag 2 ramming                                        AFFIRMED
causeFlag 3 world/self-environment                         AFFIRMED
causeFlag 4                                                UNKNOWN
causeFlag 5 drowning                                       AFFIRMED controlled
wrapper/settlement deathReason5 drowning                   AFFIRMED controlled
positive-HP terminal death possible                        AFFIRMED controlled
```

Live terminal state and HP are modeled as separate facts. Single-POV live death precision is explicitly bounded at 283/287 sub-second closures; four settlement-second fallbacks are observation boundaries.

## Component / crew gate

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

Core method16 lifecycle:

```text
4 damaged/degraded                         AFFIRMED
5 critical/disabled                        AFFIRMED
18 automatic critical self-repair          AFFIRMED physical role
19 full repair                             AFFIRMED
10 crew injured                            AFFIRMED
22 crew healed                             AFFIRMED
```

Fuel Tank `codeA=8` has an `AFFIRMED` ignition/fire-start physical relationship.

## Projectile / ammunition / modifier gate

```text
method29 launch + shooter + shotId + launch geometry/velocity   AFFIRMED
method20 terminal endpoint                                      AFFIRMED
method27 terminal/explosion family                              AFFIRMED
Type28 recorder ammunition selection                            AFFIRMED
method17 shell descriptor/inventory                             AFFIRMED
modifier1 Precision Fire                                        AFFIRMED
modifier2 Tungsten Shells                                       AFFIRMED
same-hit modifier list [1,2]                                   AFFIRMED
```

FV215b controlled mapping remains vehicle/version scoped.

## AoI / POV gate

```text
Type4 = leaves recorder-observed AoI       AFFIRMED
```

Hidden intervals are `UNKNOWN_AOI`. No interpolation across a hidden interval may be labeled observed truth.

## Main implementation convergence boundary

The current `main` implementation does not yet expose every closed research field. Known convergence work includes:

- expose Type10 `positionError` and neutral `trailingStateRaw` if needed by production;
- align older Type10 comments/DTO names with neutral current semantics;
- keep live HP/terminal facts distinct from legacy direct-damage heuristics;
- reduce dependence on coarse death fallbacks as new live facts are implemented;
- expose closed method38/method36 semantics in production DTOs where useful.

These are implementation-convergence tasks, not open protocol P1 research blockers.

## Remaining P2/P3 boundaries

```text
component42 exact private identity                         UNKNOWN
method38 rawState0 exact enum name                         UNKNOWN
method16 sparse transition private names                   UNKNOWN
method36 remaining static coefficient exact names/units    GUESS/UNKNOWN
Vehicle prop7/8/9 complete namespaces                      GUESS/UNKNOWN
method17 init/feed-tail exact fields                       UNKNOWN
unobserved cause/death enum values                         UNKNOWN
Type10 trailingStateRaw exact semantic                     UNKNOWN
Type10 positionError exact generation rule                 UNKNOWN
observer/cosmetic/platform private names                   UNKNOWN
future-version numeric stability                           UNKNOWN until regression-tested
```

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
