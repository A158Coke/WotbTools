# Replay protocol inventory — Blitz 11.19 China canonical ledger

> Base corpus: 34 unique arenas / 476 settled players.
>
> Additional evidence: current 11.19 controlled probes for HP/death, ammunition, special modifiers, components/crew, penetration/explosion flags, targeting, movement, physical-unit calibration, airborne motion, and `method38 0x0200`.
>
> Current gate: **P0=0 / P1=0**.
>
> Top-level authority: `WOTB_REPLAY_PROTOCOL_11_19_BILINGUAL_COMPLETE_REFERENCE.md`.

## Evidence grades

Only these three states are used in current authoritative documentation:

- `AFFIRMED` — current-version replay evidence confirms the physical/business role in the stated scope.
- `GUESS` — evidence supports an interpretation but does not yet justify confirmation.
- `UNKNOWN` — raw value/field is observed and preserved but cannot currently be safely named.

Confirmed-wrong historical interpretations are not part of this current ledger.

Numeric packet/property/method/component IDs are client-version and entity-class scoped. Historical PC WoT / BigWorld material is architecture cross-check only.

# Canonical consistency

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

Recorder-shot totals:

```text
A178_SPHT       222
GB13_FV215b      32
J20_Ho_Ri_type3  17
Maus             49
VK 72.01          4
TOTAL            324
```

# Container / framing

```text
.wotbreplay = ZIP
meta.json
data.wotreplay
battle_results.dat
```

`data.wotreplay`:

```text
magic               u32 LE = 0x12345678
unknownHeader       8 bytes
clientHashLength    u8
clientHash          bytes[clientHashLength]
clientVersionLength u8
clientVersion       bytes[clientVersionLength]
padding             u8

repeat:
payloadLen          u32 LE
type                u32 LE
rawClockSec         f32 LE
payload             bytes[payloadLen]
```

Current parser rules: dynamic stream offset; strict framing as the canonical path; unknown bytes raw-preserved; current observed terminator `0xFFFFFFFF`.

# Top-level current types

```text
0,1,2,4,5,7,8,10,11,13,14,17,23,26,28,29,31,32,33,35,36,39,0xFFFFFFFF
```

High-value semantics:

| Type | Current role | Grade |
|---:|---|---|
| 4 | leaves recorder-observed AoI | AFFIRMED |
| 5 | materialization/re-entry + state/loadout/current HP family | AFFIRMED |
| 7 | EntityProperty envelope | AFFIRMED |
| 8 | EntityMethod envelope | AFFIRMED |
| 10 | high-rate movement/transform | AFFIRMED |
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

# Type10 movement / transform

Canonical population:

```text
Type10 total       1,287,221
49-byte payload    1,287,221 / 1,287,221
```

Current layout:

```text
0x00 entityId                              u32     AFFIRMED
0x04 spaceId                               u32     AFFIRMED
0x08 attachment/parent entity ID           u32     AFFIRMED
0x0C position x,y,z                        3*f32   AFFIRMED
0x18 position/filter-error x,y,z           3*f32   AFFIRMED structural role; exact generation UNKNOWN
0x24 hull yaw,pitch,roll                   3*f32   AFFIRMED
0x30 trailingStateRaw                      u8      UNKNOWN exact semantic
```

Controlled physical-unit closure:

```text
Kanonenjagdpanzer 105 forward median 15.8364 unit/s -> 57.011 km/h
Kanonenjagdpanzer 105 reverse median  5.5804 unit/s -> 20.089 km/h
1 Type10 position unit ~= 1 meter                         AFFIRMED
```

Independent Rhm airborne sample: Type10 Y forms a clean ballistic trajectory with fitted vertical acceleration near `-9.74 unit/s²`; the recorder's `trailingStateRaw` is `1` for `369/369` samples. The exact meaning of that byte remains `UNKNOWN`.

Safe derived movement:

```text
velocity = Δposition / Δt
speedKmh = planarSpeedMps * 3.6
forwardWorld = (sin(hullYaw), 0, cos(hullYaw))
signedForwardSpeed = dot(planarDelta, forwardWorld) / Δt
hullYawRate = wrapPi(Δyaw) / Δt
```

Observed cadence is approximately 10 Hz. AoI gaps remain `UNKNOWN_AOI` and must not be presented as observed trajectory.

# Type7 Vehicle properties

```text
prop0 one-byte state                                      UNKNOWN
prop1 active/terminal boolean family                      AFFIRMED family
prop2 turret yaw relative to hull                         AFFIRMED
prop3 current HP / terminal sentinel                      AFFIRMED
prop4 two-u8 vehicle/engine/movement state tuple          GUESS exact semantic
prop7 compact state-array family                          GUESS namespace
prop8 recoverable state/effect collection                 GUESS namespace
prop9 compact state-array family                          GUESS namespace
```

prop2:

```text
angleRad = rawU16 * 2π / 65536 - π
```

prop3 current safe model:

```text
positive i16 -> actual current HP                         AFFIRMED
0x0000       -> HP-zero terminal                          AFFIRMED
0xFFFD       -> death terminal sentinel                   AFFIRMED current corpus
0xFFFE       -> terminal on verified current chain        AFFIRMED sample / version-gated
0xFFFF       -> UNKNOWN
```

# HP / death

Vehicle method1:

```text
currentHpRaw u16
sourceEntity u32
causeFlag    u8
```

Cause map:

```text
0 direct/default combat damage       AFFIRMED
1 fire                               AFFIRMED
2 ramming                            AFFIRMED
3 world/self-environment             AFFIRMED
4 UNKNOWN                            raw-preserve
5 drowning                           AFFIRMED controlled
```

Controlled drowning also confirms settlement/wrapper `deathReason=5 = DROWNING` and demonstrates a terminal death with positive remaining HP. Live terminal/death state is therefore modeled independently from a universal HP-zero predicate.

# Projectile lifecycle

```text
Vehicle method0 firing
-> Avatar method29 launch + shooter + shotId + launchPoint + launchVelocity
-> Avatar method20 shotId + terminal endpoint
-> Avatar method27 explosion/terminal branch when present
```

method29 is a global observed projectile feed; recorder ownership requires shooter filtering.

# Ammunition

```text
Type28 = recorder ammunition selection      AFFIRMED
method17 = shell descriptor/inventory       AFFIRMED
```

FV215b controlled 11.19 mapping:

```text
0 -> 0x003C5A0A -> AP
1 -> 0x00465A0A -> APCR
2 -> 0x003B5A0A -> HESH/HE-family
```

This mapping is vehicle/version scoped.

# Component namespace

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
42 UNKNOWN/unobserved  raw-preserve
43 Loader               AFFIRMED
```

# method16 lifecycle

```text
4  damaged/degraded operational                    AFFIRMED
5  critical/disabled                               AFFIRMED
18 automatic critical self-repair -> damaged      AFFIRMED
19 full repair/clear                               AFFIRMED
10 crew injured/shell-shocked                      AFFIRMED
22 crew healed/clear                               AFFIRMED
```

Fuel Tank controlled relation:

```text
codeA=8 + component33 -> ignition/fire-start transition family   AFFIRMED physical relationship
```

# method38 wire

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

# method38 resultFlags16

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
0x4000 internal component/device involved by explosion                  AFFIRMED controlled
0x8000 internal component/device damaged by explosion                   AFFIRMED controlled
```

`0x0200` controlled closure:

```text
Quby -> Maus
phase 1: Gun/barrel, 15 projectiles
phase 2: Fuel Tank, 15 projectiles
method29/method38 same-clock pairs = 30/30

Gun-phase key result:
0x0240 = 0x0200 | 0x0040

same Gun phase:
0x0100 + component36 + rawState0

Fuel Tank control:
0x0110 = 0x0010 | 0x0100 + component33 rawState0/1
```

Current physical meaning:

```text
0x0200 = PROJECTILE_DEVICE_NOT_PIERCED    AFFIRMED controlled
```

# method38 component state

```text
rawState0 = component involved/hit with no newly observed persistent negative state   AFFIRMED physical role; exact private enum UNKNOWN
rawState1 = module damaged / crew injured                                             AFFIRMED
rawState2 = module critical/disabled                                                   AFFIRMED
```

# method38 modifiers

```text
modifier1 = Precision Fire       AFFIRMED
modifier2 = Tungsten Shells      AFFIRMED
same-hit modifiers [1,2]         AFFIRMED
```

# Targeting

```text
Type31 = aiming-circle/gun-marker size                       AFFIRMED
Type39 f5 = turret/gun-relative yaw family                   AFFIRMED relationship
Type39 f6 = local gun pitch                                  AFFIRMED relationship

method36.root.field1 = turret/gun relative yaw               AFFIRMED
method36.root.field2 = gun pitch                             AFFIRMED
method36.root.field3 = max horizontal angular speed          AFFIRMED controlled
method36.root.field4 = max vertical angular speed            AFFIRMED controlled
method36.root.field5 = aiming-time physical scalar           AFFIRMED
method36.field6.field1 = dynamic gun dispersion/bloom        AFFIRMED
```

Controlled perturbations:

```text
shot boundary        -> field6.field1 positive bloom jump
Gun damage           -> field6.field1 ×2; root.field4 ×0.675
repair               -> exact baseline restore
Reticle Calibration  -> root.field5 ×0.70; field6.field1 ×0.70
Reticle end           -> exact baseline restore
```

Remaining static/nested coefficients are `GUESS/UNKNOWN` private-schema work and are not P1 blockers.

# Visibility / POV boundary

```text
Type4 = leaves recorder-observed AoI       AFFIRMED
```

Single POV is not omniscient. Hidden trajectories and four settlement-second death fallbacks are explicit information boundaries.

# Settlement

`battle_results.dat` is the final-result authority/cross-check for settled facts. Focused closures include destruction assistance, gun marks, selected secondary assist attribution, and drowning deathReason.

`field118 / baseType12` exact statistic meaning remains `UNKNOWN`.

# Remaining bounded P2/P3 research

```text
component42 exact private identity                         UNKNOWN
method38 rawState0 exact private symbol                    UNKNOWN
method16 sparse transition-code private names              UNKNOWN
method36 remaining static coefficient exact names/units    GUESS/UNKNOWN
prop7/8/9 complete token namespaces                        GUESS/UNKNOWN
method17 init/feed-tail exact fields                       UNKNOWN
unobserved cause/death enum values                         UNKNOWN
Type10 trailingStateRaw exact semantic                     UNKNOWN
Type10 positionError exact generation rule                 UNKNOWN
observer/cosmetic/platform exact symbols                   UNKNOWN
future-version numeric stability                           UNKNOWN until regression-tested
```

# Gate

```text
P0 protocol blockers                         0
P1 protocol blockers                         0
canonical-count contradiction blockers       0
core controlled-surface semantic blockers    0

STATUS: CORE PROTOCOL RESEARCH COMPLETE / PRODUCTION-USABLE FOR CURRENT 11.19
```
