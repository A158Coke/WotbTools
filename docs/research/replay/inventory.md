# Replay protocol inventory — Blitz 11.19 China canonical ledger

> Base corpus: 34 unique arenas / 476 settled players.
>
> Additional evidence: current 11.19 controlled probes for HP/death, ammunition, special modifiers, components/crew, penetration/explosion flags, targeting, movement, physical-unit calibration, airborne motion, and `method38 0x0200`.
>
> Current gate: **P0=0 / P1=0**.
>
> Top-level authority: `WOTB_REPLAY_PROTOCOL_11_19_BILINGUAL_COMPLETE_REFERENCE.md`.

## Evidence grades

`PROVEN / VERY STRONG PARTIAL / PARTIAL / UNKNOWN / SUPERSEDED / REJECTED`.

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

Correct recorder-shot totals:

```text
A178_SPHT       222
GB13_FV215b      32
J20_Ho_Ri_type3  17
Maus             49
VK 72.01          4
TOTAL            324
```

Old 341-shot aggregate: `SUPERSEDED`.

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

Rules: dynamic stream offset; strict framing as canonical path; raw-preserve unknowns; current terminator `0xFFFFFFFF`.

# Top-level current types

```text
0,1,2,4,5,7,8,10,11,13,14,17,23,26,28,29,31,32,33,35,36,39,0xFFFFFFFF
```

High-value semantics:

```text
Type4   leaves recorder-observed AoI; NOT death                 PROVEN
Type5   materialization/re-entry + state/loadout/current HP      PROVEN relationship
Type7   EntityProperty                                          PROVEN envelope
Type8   EntityMethod                                            PROVEN envelope
Type10  high-rate movement/transform                            PROVEN
Type28  recorder ammunition selection                          PROVEN
Type31  aiming-circle/gun-marker size                           PROVEN
Type32  auxiliary effect/state envelope                         PROVEN envelope
Type33  pre-materialization companion                           PROVEN relationship
Type35  monotonic decisecond low byte                           PROVEN
Type36  full-width monotonic decisecond anchor                  PROVEN
Type39  high-rate aim/camera/gun geometry                       PROVEN family
```

# Type10 movement / transform

Canonical population:

```text
Type10 total       1,287,221
49-byte payload    1,287,221 / 1,287,221
```

Current layout:

```text
0x00 entityId                              u32     PROVEN
0x04 spaceId                               u32     PROVEN
0x08 attachment/parent entity ID           u32     PROVEN
0x0C position x,y,z                        3*f32   PROVEN
0x18 position/filter-error x,y,z           3*f32   PROVEN structure / PARTIAL generation
0x24 hull yaw,pitch,roll                   3*f32   PROVEN
0x30 trailingStateRaw                      u8      UNKNOWN semantic
```

Important current correction:

```text
0x30 == onGround     REJECTED controlled
```

Rhm airborne controlled replay: `369/369` recorder Type10 tail values remain `1` while Type10 Y forms a clean ballistic trajectory.

Movement physical-unit closure:

```text
Kanonenjagdpanzer 105 forward median 15.8364 unit/s -> 57.011 km/h
Kanonenjagdpanzer 105 reverse median  5.5804 unit/s -> 20.089 km/h
```

Therefore:

```text
1 Type10 position unit ~= 1 meter     PROVEN controlled
```

Independent Rhm airborne fit: vertical acceleration ~`-9.74 unit/s²`.

Derived safe facts:

```text
velocity = Δposition / Δt
speedKmh = planarSpeedMps * 3.6
forward = (sin(yaw), 0, cos(yaw))
signedForwardSpeed = dot(planarDelta, forward) / Δt
hullYawRate = wrapPi(Δyaw) / Δt
```

Observed cadence ~10 Hz. AoI gaps remain UNKNOWN and must not be interpolated as observed truth.

# Type7 Vehicle properties

```text
prop0 one-byte state                                      UNKNOWN semantic
prop1 active/terminal boolean family                      PROVEN family
prop2 turret yaw relative to hull                         PROVEN
prop3 current HP / terminal sentinel                      PROVEN
prop4 two-u8 vehicle/engine/movement state tuple           PARTIAL semantic
prop7 compact state-array family                          PARTIAL namespace
prop8 recoverable state/effect collection                 PARTIAL namespace
prop9 compact state-array family                          PARTIAL namespace
```

prop2:

```text
angleRad = rawU16 * 2π / 65536 - π
```

prop3:

```text
positive i16 -> actual HP
0x0000       -> HP-zero terminal
0xFFFD       -> death terminal sentinel
0xFFFE       -> terminal on verified current chain / version-gated
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
0 direct/default combat damage       PROVEN
1 fire                               PROVEN
2 ramming                            PROVEN
3 world/self-environment             PROVEN
4 UNKNOWN                            raw-preserve
5 drowning                           PROVEN controlled
```

Controlled drowning also closes settlement/wrapper `deathReason=5 = DROWNING` and proves terminal death can retain positive HP.

```text
death == HP<=0 universally           REJECTED
Tankopedia base HP == replay HP      REJECTED as primary source
```

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
Type28 = recorder ammunition selection      PROVEN
method17 = shell descriptor/inventory       PROVEN
```

FV215b controlled 11.19:

```text
0 -> 0x003C5A0A -> AP
1 -> 0x00465A0A -> APCR
2 -> 0x003B5A0A -> HESH/HE-family
```

Vehicle/version scoped.

# Component namespace

```text
31 Engine              PROVEN
32 Ammo Rack           PROVEN
33 Fuel Tank           PROVEN
34 Right Track         PROVEN
35 Left Track          PROVEN
36 Gun                 PROVEN
37 Turret Rotator      PROVEN version-scoped
38 Observation Device  PROVEN
39 Commander           PROVEN
40 Driver              PROVEN
41 Gunner               PROVEN
42 UNKNOWN/unobserved  raw-preserve
43 Loader               PROVEN
```

# method16 lifecycle

```text
4  damaged/degraded operational                    PROVEN
5  critical/disabled                               PROVEN
18 automatic critical self-repair -> damaged      PROVEN
19 full repair/clear                               PROVEN
10 crew injured/shell-shocked                      PROVEN
22 crew healed/clear                               PROVEN
```

Fuel Tank controlled relation:

```text
codeA=8 + component33 -> ignition/fire-start transition family
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

Old single-extension model: `SUPERSEDED`.

# method38 resultFlags16 — current complete map

```text
0x0001 direct terminal shell kill                                      PROVEN
0x0002 target already dead before attack                               PROVEN sample / low-N
0x0004 fire started                                                     PROVEN
0x0008 ricochet                                                         PROVEN controlled
0x0010 positive material/vehicle penetration by projectile              PROVEN
0x0020 projectile non-penetration/material stop                         PROVEN controlled
0x0040 zero-DF/spaced layer pierced by projectile                       PROVEN controlled
0x0080 zero-DF/spaced layer not pierced                                 PROVEN controlled
0x0100 internal device/module pierced/involved by projectile            PROVEN
0x0200 internal device/module not pierced by projectile                 PROVEN controlled
0x0400 chassis/track damaged by projectile                              PROVEN
0x0800 Gun damaged by projectile                                        PROVEN
0x1000 positive-DF material explosion branch                            PROVEN controlled
0x2000 zero-DF/spaced-layer explosion branch                            PROVEN controlled low-N
0x4000 internal component/device involved by explosion                  PROVEN controlled
0x8000 internal component/device damaged by explosion                   PROVEN controlled
```

`0x0200` controlled closure:

```text
Quby -> Maus
first 15 projectiles Gun/barrel
second 15 projectiles Fuel Tank
method29/method38 same-clock pairs = 30/30

critical Gun result:
0x0240 = 0x0200 | 0x0040

same Gun phase:
0x0100 + component36 + rawState0

Fuel Tank control:
0x0110 = 0x0010 | 0x0100 + component33 rawState0/1
```

Therefore `0x0200 = PROJECTILE_DEVICE_NOT_PIERCED` is PROVEN current controlled physical role.

# method38 component state

```text
rawState0 component involved/hit, no newly observed persistent negative state
rawState1 module damaged / crew injured                     PROVEN
rawState2 module critical/disabled                           PROVEN
```

rawState0 exact private enum name remains unknown.

# method38 modifiers

```text
modifier1 Precision Fire       PROVEN
modifier2 Tungsten Shells      PROVEN
[1,2] same hit                 PROVEN
```

Mutual-exclusion and combined-modifier3 models: `REJECTED`.

# Targeting

```text
Type31 = aiming-circle/gun-marker size                      PROVEN
Type39 f5 = turret/gun-relative yaw family                  PROVEN relationship
Type39 f6 = local gun pitch                                 PROVEN relationship

method36.root.field1 = turret/gun relative yaw              PROVEN
method36.root.field2 = gun pitch                            PROVEN
method36.root.field3 = max horizontal angular speed         PROVEN controlled
method36.root.field4 = max vertical angular speed           PROVEN controlled
method36.root.field5 = aiming-time physical scalar          PROVEN
method36.field6.field1 = dynamic gun dispersion/bloom       PROVEN
```

Controlled perturbations:

```text
shot -> field6.field1 positive bloom jump
Gun damage -> field6.field1 ×2; root.field4 ×0.675
Reticle Calibration -> root.field5 ×0.70; field6.field1 ×0.70
repair/end -> exact baseline restoration
```

Remaining static/nested coefficients are P2/private-name work, not P1 blockers.

# Visibility / POV boundary

```text
Type4 leaves recorder-observed AoI       PROVEN
Type4 == death                           REJECTED
```

Single POV is not omniscient. Hidden trajectories and four settlement-second death fallbacks are real information boundaries.

# Settlement

`battle_results.dat` is final-result authority/cross-check for settled facts. Known focused closures include destruction assistance, gun marks, selected secondary assist attribution, and drowning deathReason.

`field118 / baseType12` remains bounded UNKNOWN; old base-defense meaning is REJECTED.

# Rejected / superseded facts

```text
Type4 == death                                             REJECTED
Type28 == target lock / auto aim                          REJECTED
41 == Radioman / 42 == Gunner                             SUPERSEDED
34/35 exact side unresolved                               SUPERSEDED
baseType12 == base defended / dropped capture points      REJECTED
all method38 32 header bits == homogeneous hit enum       REJECTED
method38 0x1000 == universal Gun-damage bit               REJECTED
old Type28 341-shot aggregate                             SUPERSEDED
Tankopedia base HP == actual replay HP                    REJECTED as primary
single POV guarantees 100% sub-second death               REJECTED
method38 tail == one optional u32 extension               SUPERSEDED
Precision Fire/Tungsten mutually exclusive                REJECTED
combined Precision Fire+Tungsten == modifier3             REJECTED
Type10 trailing byte == onGround                          REJECTED controlled
Type10 positionError == velocity                          REJECTED
```

# Remaining bounded P2/P3 research

```text
component42 exact private identity
method38 rawState0 exact private symbol
method16 sparse transition-code private names
method36 remaining static coefficient exact names/units
prop7/8/9 complete token namespaces
method17 init/feed-tail exact fields
unobserved cause/death enum values
Type10 trailingStateRaw exact semantic
Type10 positionError exact generation rule
observer/cosmetic/platform exact symbols
future-version numeric stability
```

# Gate

```text
P0 protocol blockers                         0
P1 protocol blockers                         0
canonical-count contradiction blockers       0
core controlled-surface semantic blockers    0

STATUS: CORE PROTOCOL RESEARCH COMPLETE / PRODUCTION-USABLE FOR CURRENT 11.19
```
