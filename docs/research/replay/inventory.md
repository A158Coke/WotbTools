# Replay protocol inventory — Blitz 11.19 China canonical corpus

> Canonical corpus: 34 unique arenas / 476 settled player results. Multi-POV duplicates are cross-validation only.
>
> Status: **RESEARCH-COMPLETE for the current observed corpus**. Numeric packet/property/method/component IDs are version- and entity-class-scoped unless explicitly stated otherwise.
>
> Detailed evidence lives in the focused research notes in this directory. This file is the synchronized top-level ledger; focused notes take precedence if a future experiment supersedes a row here.

## Evidence grades

- `PROVEN`: current replay behavior and/or independent current-compatible evidence closes the physical/semantic role.
- `VERY STRONG PARTIAL`: physical role is strongly closed but exact private enum/string or low-N global validation remains.
- `PARTIAL`: structure/family known but exact symbolic name, unit, enum, or rule is incomplete.
- `UNKNOWN`: observed and preserved; exact semantics unresolved.
- `SUPERSEDED`: older interpretation replaced by stronger evidence.
- `REJECTED`: interpretation contradicted by current evidence.

# Canonical consistency gates

```text
unique arenas                         34
settled player results               476
unique recorder method29 shotIds     324
settlement recorder shots            324
method38 recorder hit feedback       295
settlement recorder hits             295
settled dead combatants              287
live sub-second terminal closure     283 / 287 = 98.61%
settlement-second death fallback       4 / 287 = 1.39%
```

The old Type28 per-vehicle shot table that summed to 341 is **SUPERSEDED**. Correct recorder-shot totals:

```text
A178_SPHT 222
FV215b      32
Ho-Ri       17
Maus        49
VK 72.01     4
TOTAL      324
```

# Container and framing

| Surface | Verdict | Current meaning |
|---|---|---|
| `.wotbreplay` | PROVEN | ZIP container with `meta.json`, `data.wotreplay`, `battle_results.dat` |
| `meta.json` | PROVEN/PARTIAL | replay metadata/config facts |
| `data.wotreplay` | PROVEN framing | packet stream |
| `battle_results.dat` | PROVEN container | pickle protocol-2 `(arenaUniqueId, protobufBytes)` |

`data.wotreplay` header:

```text
magic               u32 LE = 0x12345678
unknownHeader       8 bytes
clientHashLength    u8
clientHash
clientVersionLength u8
clientVersion
padding             u8

repeated packets:
payloadLen          u32 LE
type                u32 LE
rawClockSec         f32 LE
payload             bytes[payloadLen]
```

Rules:

- zero-length payloads are legal (`Type17`);
- packet stream starts after the dynamic-length header; never hard-code offset 66;
- strict contiguous parsing is normal; skip-one-byte resync is not;
- all numeric packet/method/property IDs are version scoped.

# Top-level packet inventory

Observed types:

```text
0,1,2,4,5,7,8,10,11,13,14,17,23,26,28,29,31,32,33,35,36,39,0xFFFFFFFF
```

| Type | Verdict | Current semantic |
|---:|---|---|
| 0 | PROVEN/PARTIAL | base-player creation / arena metadata family |
| 1 | PARTIAL | entity/avatar-cell creation/init |
| 2 | PARTIAL | entity/avatar-cell creation/init |
| 4 | PROVEN | enemy leaves recorder-observed AoI; **not death** |
| 5 | PROVEN relationship / PARTIAL full body | materialization/re-entry + initial transform/state/loadout |
| 7 | PROVEN envelope | EntityProperty |
| 8 | PROVEN envelope | EntityMethod |
| 10 | PROVEN | 49-byte vehicle transform |
| 11 | PARTIAL | early space/map/session config |
| 13 | PROVEN family / PARTIAL serialization | in-stream settlement/result dump |
| 14 | PROVEN | stream close marker |
| 17 | PROVEN relationship / PARTIAL symbol | recorder aim/control init boundary |
| 23 | PROVEN | recorder shot/projectile lifecycle toggle |
| 26 | PROVEN | incoming hostile-shell warning family |
| 28 | PROVEN | recorder ammunition-selection value |
| 29 | PROVEN lifecycle / PARTIAL setting | client-options/init companion |
| 31 | PROVEN | recorded arcade gun-marker / aiming-circle size |
| 32 | PROVEN envelope / many closed subfamilies | auxiliary/effect/state transport |
| 33 | PROVEN relationship | pre-materialization packet paired with Type5 |
| 35 | PROVEN | low 8 bits of session monotonic decisecond clock |
| 36 | PROVEN | full-width session monotonic decisecond anchor |
| 39 | PROVEN family / PARTIAL exact fields | high-rate aim/camera/gun geometry |
| `0xFFFFFFFF` | PROVEN | deterministic stream terminator |

# Type5 materialization / loadout

Type5 is PROVEN to carry materialization/re-entry state, transform/configuration, actual current HP and observable loadout data.

Normal combat-tail model:

```text
0A06 -> six 14-byte item descriptors
  slots 0..2 consumables
  slots 3..5 provisions
0B09 -> nine equipment bytes
```

1037 full-loadout materializations close the 3+3 item ordering. 60 smaller `0A04` observer/non-normal variants must not be forced into 3+3.

Equipment byte identity is a direct current equipment ID; semantic/effect values must come through the versioned item catalog rather than replay-hard-coded percentages.

# Type7 — EntityProperty

Envelope:

```text
entityId u32
propId   u32
valueLen u32
value    bytes[valueLen]
```

## Vehicle properties

| propId | Verdict | Meaning |
|---:|---|---|
| 0 | PROVEN shape / UNKNOWN exact semantic | one-byte alternating state |
| 1 | PROVEN family / PARTIAL symbol | active/crew-active terminal boolean family |
| 2 | PROVEN | turret yaw relative to hull; `rawU16 * 2π / 65536 - π` |
| 3 | PROVEN | current HP / terminal sentinel family |
| 4 | PROVEN structure / PARTIAL symbol | two-u8 vehicle/engine/movement-mode tuple |
| 7 | PROVEN structure / PARTIAL complete namespace | count-prefixed compact state array |
| 8 | PROVEN structure / recovery role / PARTIAL complete namespace | mixed recoverable state/effect collection |
| 9 | PROVEN structure / PARTIAL complete namespace | count-prefixed compact state array |

Vehicle prop3:

```text
positive i16 -> actual current HP          PROVEN
0x0000       -> HP zero terminal           PROVEN
0xFFFD       -> death terminal sentinel    PROVEN current corpus
0xFFFE       -> terminal on verified chain PROVEN sample / PARTIAL global
0xFFFF       -> UNKNOWN; preserve raw
```

Avatar property9 `float32` = recorder own-vehicle turret-relative yaw mirror — **PROVEN**.

# Type8 — EntityMethod

Envelope:

```text
entityId u32
methodId u32
argLen   u32
args     bytes[argLen]
```

## High-value method families

| Method | Verdict | Current semantic |
|---:|---|---|
| Vehicle 0 / 1B | PROVEN | observed firing signal |
| Vehicle 1 / 7B | PROVEN | `currentHpRaw:u16 + sourceEntity:u32 + causeFlag:u8` |
| Vehicle 2 / 8B | PROVEN shape / PARTIAL semantic | two-float config family; old `onPushed` rejected |
| Vehicle 4 / 16B | PROVEN | vehicle↔vehicle collision |
| Vehicle 6 / 29B | PROVEN physical role | static/world collision |
| Vehicle 8 / 21B common | PROVEN | recorder direct-hit notification + compact target-local BigWorld hit segment |
| Avatar 4 / 2B | PROVEN | winnerTeam + finishReason |
| Avatar 5 / 3B | PROVEN | recorder own HP mirror/opening actual HP |
| Avatar 12 / 6B | PROVEN counter framework | battle-feedback/ribbon counters |
| Avatar 13 / 9B | PROVEN gun-cycle family | gun/reload telemetry |
| Avatar 16 / 10B | PROVEN family | recorder module/crew damage presentation |
| Avatar 17 / 12B | PROVEN/PARTIAL | ammunition descriptor/state |
| Avatar 19 / 13B | PROVEN family | vehicle misc status; code7 repair-progress branch proven |
| Avatar 20 / 16B | PROVEN | shotId + terminal endpoint |
| Avatar 25 / 32B | PROVEN/PARTIAL | recorder vehicle pose/state |
| Avatar 27 / 34B | PROVEN family | projectile explosion/terminal-resolution |
| Avatar 28 / 36B | PROVEN family | recorder death/death-view incoming projectile geometry |
| Avatar 29 / 37B | PROVEN | projectile launch + shotId + launch geometry/velocity |
| Avatar 35 / 13B | PROVEN | full reload-duration/config update |
| Avatar 36 / 74/92B | PROVEN targeting family | targeting snapshot; PRE→method29→POST at recorder shots |
| Avatar 38 / variable | PROVEN shot-result family | recorder outgoing hit/result feedback |
| Avatar 39 / 2B | PROVEN cadence / PARTIAL exact symbol | fixed heartbeat/control RPC |
| Avatar 43 | PROVEN family / PARTIAL exact symbol | player-name/tactical-UI family |
| Avatar 44 / 16B | PROVEN config family | platform/build init snapshot |
| Avatar 46 | PROVEN family | tactical marker/ping |
| Avatar 48 | PROVEN wrapper container | arena-update protobuf wrappers |
| Avatar 49 | PROVEN family | synchronized client-options snapshot |

## Vehicle method1 causeFlag

```text
0 direct/default combat damage PROVEN
1 fire                         PROVEN
2 ramming                      PROVEN
3 world/self-environment       PROVEN
```

Settlement terminal closure:

```text
ordinary/default deaths 276/276 -> 0
fire deaths               4/4   -> 1
ramming deaths             2/2   -> 2
world collision            1/1   -> 3
```

# Current component namespace — method16 / Type32 / method38

The same current component-ID namespace is closed across method16, Type32 damage/recovery surfaces and method38 repeated hit-result tokens.

## Mechanical components

| ID | Verdict | Identity |
|---:|---|---|
| 31 | PROVEN | Engine |
| 32 | PROVEN | Ammo Rack |
| 33 | PROVEN | Fuel Tank |
| 34 | PROVEN | Right Track |
| 35 | PROVEN | Left Track |
| 36 | PROVEN | Gun |
| 37 | PROVEN version-scoped | Turret Rotator |
| 38 | PROVEN | Observation Device |

Track orientation is closed by method8 target-local hit geometry. BigWorld local `+X=left`:

```text
34 -> minimum-X side -> Right Track
35 -> maximum-X side -> Left Track
```

## Crew components

| ID | Verdict | Identity |
|---:|---|---|
| 39 | PROVEN | Commander |
| 40 | PROVEN | Driver |
| 41 | PROVEN | Gunner |
| 42 | UNKNOWN / unobserved | reserved/unused/other; do not name |
| 43 | PROVEN | Loader |

`41=Radioman / 42=Gunner` is **SUPERSEDED**.

## method16 codeA lifecycle

Mechanical:

```text
4  -> common damaged / degraded operational       PROVEN
5  -> critical / disabled                         PROVEN
18 -> automatic critical self-repair -> damaged   PROVEN version-scoped physical role
19 -> fully repaired / cleared                     PROVEN
```

Crew:

```text
10 -> shell-shocked / injured PROVEN
22 -> healed / cleared         PROVEN
```

Other observed `0,1,6,7` remain presentation-transition `PARTIAL/UNKNOWN`; raw values are preserved.

## Gun codeB=36

Recorder-local natural damage→Repair Kit chain:

```text
field6.field1: 0.9171787581 -> 1.8343575163 -> 0.9171787581
root.field4:   0.7611729934 -> 0.5137917725 -> 0.7611729934
```

The exact ×2 dispersion-like penalty plus same-clock Repair Kit restoration closes `36=Gun` independently of historical ordinal assumptions.

## Fuel Tank 33 / Observation Device 38

A recorder-local `38, codeA=5` critical sample produces no fire HP tick/fire-associated Type32 surface. Critical Fuel Tank behavior would ignite; therefore 38 is Observation Device. The completed mechanical domain then uniquely leaves 33 as Fuel Tank.

# Avatar method38 shot-result structure

Safe current wire model:

```text
victimVehicleId u32
resultFlags16   u16
headerHi16Raw   u16
count           u8
repeat count:
  componentToken u8
  rawState       u8
tail            u8
optional extension bytes
```

`headerHi16Raw` is `0x0002` in 293/295 records. The two exceptions belong to the known duplicate/batched Maus feedback boundary. Treating the full 32-bit header as one homogeneous hit-flag enum is **REJECTED**.

## method38 low-16 result flags

| Bit | Verdict | Current behavioral role |
|---:|---|---|
| `0x0001` | PROVEN | direct terminal shell kill |
| `0x0002` | PROVEN sample / PARTIAL global | target already dead before this attack |
| `0x0004` | PROVEN current samples / low-N global | fire started |
| `0x0008` | high-confidence PARTIAL | ricochet-like; geometry control still needed |
| `0x0010` | PROVEN relationship | projectile penetration/material-positive branch |
| `0x0020` | VERY STRONG PARTIAL | projectile non-penetration/material-stop branch |
| `0x0040` | PARTIAL | additional projectile/material/armor branch; preserve raw |
| `0x0100` | PROVEN relationship | internal component/device penetration/involvement |
| `0x0400` | PROVEN relationship | track/chassis-damaged result family |
| `0x0800` | PROVEN current samples / PARTIAL global n=2 | Gun-damaged result |
| `0x1000` | VERY STRONG PARTIAL | special/HE-family explosion-material resolution branch |
| `0x2000` | PARTIAL n=1 | special/HE-family explosion-armor branch |
| `0x4000` | PROVEN relationship | special/HE-family explosion internal-component/device branch |

Unobserved current bits `0x0080`, `0x0200`, `0x8000` remain raw/unassigned.

Semantic-hit dedup proves:

```text
CURRENT_PIERCING_LIKE_MASK = 0x1110
```

Historical PC/WoT `VEHICLE_HIT_FLAGS` upper-bit ordinal names are **not authoritative** for current Blitz. Current behavior suggests a compacted/reorganized descendant, but the implementation-history explanation remains a hypothesis.

## method38 componentToken

Repeated `componentToken` uses the same 31..43 current component namespace — **PROVEN relationship**.

## method38 rawState

```text
rawState=0 -> component was hit/involved; module-damage probability produced no newly observed persistent negative state
              VERY STRONG physical role / exact internal enum unknown
rawState=1 -> module damaged / crew injured
              PROVEN relationship
rawState=2 -> module critical / disabled
              PROVEN relationship
```

Module hit and module damage are distinct. One shell can traverse multiple internal components and resolve damage probability independently per component.

## method38 optional extension

Current population:

```text
extension=1 : 13
extension=2 :  1
```

`extension=1` = **VERY STRONG Precision Fire proc candidate / near-PROVEN**:

- all 12 non-HE-family samples produce exact ordinary maximum damage or terminal-HP-capped damage;
- the lone FV215b HE-family sample is compatible with Precision Fire followed by HE-specific penetration/armor/explosion-radius final resolution;
- controlled skill samples or a direct current schema/string are still required for production-PROVEN naming.

`extension=2` = **VERY STRONG PARTIAL Tungsten/special-damage provenance candidate, n=1**:

- only recorder-owned Tungsten-active hit occurs ~0.5 s after `0x69` activation and carries extension 2;
- no non-Tungsten current hit carries extension 2;
- no second positive sample exists in the canonical corpus.

# Type28 ammunition-selection state

Type28 remains **PROVEN recorder ammunition-selection state**.

Strict own-shot reconstruction:

```text
method29 shooterId == recorder
unique (arena, shotId)
= 324 unique recorder shots
= 324 settlement shots
```

Known launch-velocity families by wire selection value:

```text
SPHT:   0->760,     1->560,     2->560
FV215b: 0->1152.36, 1->1440.72, 2->1152.36
Ho-Ri:  0->972,     1->1026
Maus:   0->680,     1->1032
VK72:   0->600,     1->552
```

Do **not** assume wire `0/1/2` equals UI shell-list index. For current FV215b the user-facing family is AP / APCR / HE; wire value 1 is strongly APCR by projectile velocity, while wire value 2 is strongly HE-family by hit/damage behavior. Exact descriptor→display-name mapping remains version gated.

Re-audited high-bit relationship:

```text
0x1000: 13/13 -> selectionValue=2
0x2000:  1/1  -> selectionValue=2
0x4000:  7/7  -> selectionValue=2
non-value-2 occurrences = 0
```

# Avatar method12 battle-feedback counters

| baseType | Verdict | Meaning |
|---:|---|---|
| 1 | PROVEN | cumulative damage dealt |
| 2 | PROVEN | cumulative enemies spotted |
| 3 | PROVEN | cumulative kills |
| 5 | PROVEN | cumulative damage blocked |
| 6 | PROVEN samples / limited-N | enemy ignition/set-on-fire |
| 8 | PARTIAL | critical/module result inflicted family |
| 12 | closed UNKNOWN exact semantic | same gameplay-stat family as settlement field118; old base-defense hypothesis REJECTED |
| 15 | PROVEN | Destruction Assistance count/ribbon progression |
| 16 | PARTIAL | critical/device damage received family |
| 17 | PROVEN | cumulative total assist damage |

## baseType12 / settlement field118 boundary

Current author population:

```text
baseType12 present : 10 / 34
field118 present   : 10 / 34
presence mismatch  : 0
```

method12 baseType12:

```text
value always 0
count 1..3
```

field118 current author values:

```text
12,20,32,34,48,67,103,124,124,195
```

The field is **not** a copy of method12 count/value. Old `base defended / droppedCapturePoints` semantics are **REJECTED/SUPERSEDED**. Current hit/kill/module/capture/known-settlement controls do not uniquely identify the statistic.

Status: **closed UNKNOWN boundary**. Promotion requires a version-matched schema/client symbol or controlled/new samples; more correlation mining over these same 10 positives is non-authoritative.

# Avatar method48 wrapper inventory

| Wrapper | Verdict | Meaning |
|---:|---|---|
| 1 | PROVEN | roster/entity-account/team/player snapshot |
| 3 | PROVEN | arena-period lifecycle |
| 6 | PROVEN | kill feed: victim/killer + optional >50% prior-damage assister + optional non-default deathReason |
| 7 | PROVEN behavior | vehicle/avatar-ready lifecycle |
| 12 | PROVEN | Supremacy base ownership/capture state machine |
| 13 | PROVEN | Supremacy team score |
| 15 | PROVEN gun-feed family / PARTIAL exact enum names | own-team weapon/reload telemetry |
| 16 state1 | PROVEN behavioral role | team-visible ordinary observed-by-enemy entry/re-entry family |
| 16 state8 | PROVEN forced-observation behavior / PARTIAL exact symbol | hit-applied forced-observation/forced-spot recipient behavior |
| 18 | PARTIAL | prebattle/configuration data |

## wrapper6 field3 majority-damage assister

Current exact threshold behavior is **PROVEN**:

```text
post-start wrapper6 deaths               283
field3 present                            46
field3 == highest-damage non-killer       46 / 46
field3 prior damage / actual initial HP > 50% 46 / 46
field3 absent                              237
reconstructable non-killer >50% among negatives 0 / 237
```

This is the >50% secondary kill-notification assister. It is **not** method12 base15/field119 Destruction Assistance, which is a separate lower-threshold cumulative statistic.

## Wrapper12 Supremacy

```text
field1 base index                         PROVEN
field2 owner team                         PROVEN
field3 capturing team                     PROVEN
field4 capture progress 0..99             PROVEN
field5 contested/frozen capture behavior  PROVEN
field6 recorder capture participation     STRONG PARTIAL / near-PROVEN
```

# Type10 transform

```text
entityId  i32
spaceId   i32
vehicleId i32
position  3xf32
error     3xf32
yaw       f32
pitch     f32
roll      f32
errorFlag i8
```

Wire structure and primary transform meaning — **PROVEN**.

# Type31 / method36 / Type39 targeting

## Type31

`float32 markerSize` = recorded arcade gun-marker / aiming-circle size — **PROVEN**. Do not call it penetration probability.

## Avatar method36

- 74-byte init/config and 92-byte dynamic variants;
- nine fixed64/double-like scalars in the nested structure;
- `root.field1` = turret/gun relative yaw relationship — PROVEN;
- `root.field2` = gun pitch relationship — PROVEN;
- `field6.field1` = dynamic gun-dispersion/bloom family — VERY STRONG physical role;
- every recorder shot has exact `method36 PRE -> method29 launch -> method36 POST` order;
- Gun damage doubles `field6.field1`; Repair Kit restores baseline.

Exact remaining scalar names/units are schema-bounded PARTIAL. Historical nine-argument `updateTargetingInfo` is architectural cross-check only; ordinal transplantation is REJECTED.

## Type39

```text
f0 world aim/gun-ray yaw                         PROVEN
f1 negated world aim/gun-ray pitch               PROVEN
f2,f3,f4 world point on aim/projectile ray       PROVEN
f5 recorder relative aim/turret-control family   PROVEN relationship / PARTIAL exact producer
f6 vehicle-local gun/barrel vertical angle       PROVEN physical role / PARTIAL exact symbol
```

# Type32 auxiliary/effects

Envelope:

```text
entityId   u32
flag       u8
bodyLength u32
body       bytes[bodyLength]
```

Closed mobile-consumable lifecycle states:

```text
1   initialized/available
2   activation/start
3   active duration ended / cooldown transition
255 teardown
```

Mapped current consumables:

```text
0x09 Adrenaline
0x0A Engine Power Boost
0x0B Multi-Purpose Restoration Pack
0x0C First Aid Kit
0x0D Repair Kit
0x3D Improved Engine Power Boost
0x3E Reticle Calibration
0x42 Reactive Armor
0x69 Tungsten Shells
```

`0x0B/0x0C/0x0D` are behaviorally discriminated. Type32 short `...04` is fire-associated. Vehicle prop8 is a mixed recoverable collection and must not be interpreted as pure crew-only or module-only state.

Crew token cross-surface mapping:

```text
0x27 <-> 39 Commander
0x28 <-> 40 Driver
0x29 <-> 41 Gunner
0x2B <-> 43 Loader
```

# Type35 / Type36 session clock

```text
Type36 = u32 session monotonic deciseconds anchor
Type35 = low8(Type36), +1 modulo 256
Type32 long eventClockRaw = higher-precision sample in same session clock domain
```

Relationship — **PROVEN**.

# Visibility / AoI lifecycle

```text
observed
 -> Type4
hidden; no Type7/8/10 updates
 -> Type33
 -> Type5
observed again
```

Closed facts:

- Type4 is enemy-only in canonical corpus;
- 485/503 Type4 cases later re-enter;
- no property/method/position updates occur inside closed hidden intervals;
- last Type10 before Type4 is correct last-known position;
- Type4 must never be a death proxy.

wrapper16 state1 = team-visible ordinary observed-by-enemy entry/re-entry behavior — PROVEN.

wrapper16 state8 = hit-applied forced-observation/forced-spot continuation behavior — PROVEN physical relationship; exact `TRACER_SHELL`-like private enum name remains PARTIAL.

# Projectile lifecycle

```text
Vehicle method0 firing
 -> Avatar method29 launch + shotId + launch geometry/velocity
 -> Avatar method20 terminal endpoint
 -> method38 on recorder-hit path
 -> method27 on many miss/environment/explosion-terminal paths
```

Recorder unique method29 shotIds = settlement shots = 324 after semantic dedup.

Avatar method28 current 24-event boundary:

- endpoint equals same-clock method20 24/24;
- first two vectors are equal 23/24, not 24/24;
- one non-duplicate sample is a same-clock multi-projectile terminal edge case.

# Settlement / battle_results.dat

Root observed fields:

```text
1,2,3,4,5,8,9,11,150,201,301,302,303
```

High-value roots:

```text
1 mode/map compound
2 battle Unix timestamp
3 winner team
4 finish reason
5 result-layer duration
8 author result block
9 room type
201 participant roster
301 settled combatant results
```

Roots `11`, `150`, `302`, `303` remain structurally preserved PARTIAL/UNKNOWN at exact low-level semantic naming.

## PlayerResults

| field | Verdict | Meaning |
|---:|---|---|
| 1 | PROVEN | final hitpointsLeft / terminal sentinel |
| 4 | PROVEN | shots fired |
| 5 | PROVEN | hits |
| 6 | PARTIAL | HE/splash-hit family |
| 7 | PROVEN | penetrations |
| 8 | PROVEN | damage dealt |
| 9 | PROVEN family / PARTIAL subtype | assist damage subtype A |
| 10 | PROVEN family / PARTIAL subtype | assist damage subtype B |
| 11 | PROVEN | damage received |
| 12 | PROVEN | hits/shots received |
| 13 | PROVEN | non-penetrating hits received |
| 14 | PARTIAL | HE/splash received family |
| 15 | PROVEN | penetrations received |
| 16 | PROVEN | enemies spotted |
| 17 | PROVEN | enemies damaged |
| 18 | PROVEN | kills |
| 23 | PROVEN | XP result; exact display/base/premium naming version-sensitive |
| 24 | PROVEN | lifeTime |
| 25 | PROVEN | killerID |
| 32 | PROVEN | Supremacy/victory points earned |
| 33 | PROVEN | Supremacy/victory points seized |
| 101 | PROVEN | account ID |
| 102 | PROVEN | team |
| 103 | PROVEN | vehicle compact descriptor |
| 105 | PROVEN | deathReason/alive sentinel family |
| 106 | PROVEN | credits result |
| 107 | PROVEN/PARTIAL display semantic | matchmaking/rating float |
| 116 | PROVEN cross-surface identity / PARTIAL exact symbol | roster/config/customization descriptor family |
| 117 | PROVEN | damage blocked |
| 118 | closed UNKNOWN exact semantic | same family as method12 baseType12; raw preserved |
| 119 | PROVEN | Destruction Assistance count |
| 120 | PROVEN | Gun Marks count `0..3` |

field119: final method12 base15 count == field119 in 34/34 including zero-by-absence.

field120: wrapper1 player field26 == settlement field120 in 476/476.

# Actual HP policy

Use replay actual HP, not Tankopedia base HP, whenever present:

```text
Type5 materialization HP
Avatar method5 recorder opening HP
Vehicle prop3 live HP
settlement initialActualHp = max(signed finalHpField1,0) + damageReceived
```

Allied settlement initial HP == Type5 opening HP in 238/238 validated samples.

# Death-time precision boundary

```text
settled dead combatants 287
live Type7 terminal     283
live method1 terminal   283
```

Therefore:

```text
EVENT_SUBSECOND       283/287 = 98.61%
SETTLEMENT_SECOND       4/287 = 1.39%
```

The four fallbacks also lack usable live kill/death-time surfaces. This is a real single-POV/AoI boundary, not a decoder bug. Never claim 100% sub-second death time from one replay POV.

# Closed evidence boundaries — non-blocking future work

These items are **not current-corpus research blockers**. Each requires new evidence that the canonical 34 replays do not contain.

## Direct schema/string or controlled/new-sample bounded

1. method38 `rawState=0` exact private enum name.
2. method38 `extension=1/2` exact private enum/string; Precision Fire/Tungsten physical evidence is already bounded.
3. method38 low-N/global validation for ricochet `0x0008`, Gun-damage `0x0800`, explosion-armor `0x2000`, and unobserved bits.
4. method36 remaining scalar exact names/units.
5. settlement field118/baseType12 exact statistic name.
6. Vehicle prop7/8/9 complete token namespaces beyond observed closed components.
7. component ID42 identity; it is unobserved in this corpus.
8. uncommon deathReason values absent from this corpus.

## Structurally safe / lower product value

1. Vehicle prop0 exact alternating-state symbol.
2. Vehicle prop4 exact symbolic tuple.
3. Vehicle method2 two-float config semantics.
4. Avatar method3 exact two-byte state symbol.
5. Avatar method43 exact private tactical/name-UI symbol.
6. Type11 exact session/space-config field names.
7. Type13 exact in-stream settlement serialization naming.
8. settlement field116 exact cosmetic/customization item class.
9. settlement roots11/150/302/303 exact low-level subfield names.
10. observer/BPC/static/special-entity variants and rare class-specific method bodies.

All remain inventoried, evidence-graded and raw-preserved.

# Explicit rejected/superseded interpretations

```text
Type4 == death                                             REJECTED
Type28 == target lock / auto aim                          REJECTED
41 == Radioman / 42 == Gunner                             SUPERSEDED
baseType12 == base defended / dropped capture points      REJECTED
all method38 32 header bits == one homogeneous hit enum   REJECTED
historical PC upper hit-flag ordinals == current Blitz    REJECTED
method38 0x1000 == current global Gun-damage bit          REJECTED by current behavior
Tankopedia base HP == replay actual HP source             REJECTED as primary replay source
single replay POV guarantees 100% sub-second death        REJECTED
```

# Production gate

Production consumers may use only:

```text
version-gated PROVEN facts
or explicitly approved PARTIAL facts with confidence/provenance metadata
```

UNKNOWN/low-N values must retain their raw representation and must not silently become deterministic user-facing facts.

# Research-complete verdict

For Blitz 11.19 China canonical corpus:

```text
observed-surface inventory blockers       0
canonical-count contradiction blockers   0
business-critical semantic blockers      0
single-POV information boundaries        documented
private-symbol/schema boundaries          documented and non-blocking

STATUS: RESEARCH-COMPLETE FOR CURRENT CORPUS
```

Future progress now requires **new evidence acquisition** (controlled replays, new mechanics/samples, or version-matched client/schema symbols), not additional unconstrained inference over the same 34 arenas.
