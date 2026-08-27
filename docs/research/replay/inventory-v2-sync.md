# Replay protocol inventory — Blitz 11.19 China canonical corpus

> Canonical corpus: 34 unique arenas. Multi-POV duplicates are cross-validation only.
>
> This file is a synchronized inventory snapshot. Numeric packet/property/method/component IDs are version- and entity-class-scoped unless explicitly stated otherwise.

## Evidence grades

- `PROVEN`: current replay behavior and/or independent current-compatible evidence closes the physical/semantic role.
- `PARTIAL`: structure/family known but exact symbolic name, unit, enum, or rule is incomplete.
- `UNKNOWN`: observed and preserved, semantics unresolved.
- `SUPERSEDED`: older interpretation disproved by stronger evidence.
- `REJECTED`: tested interpretation contradicted by current evidence.

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
padding              u8

repeated packets:
payloadLen          u32 LE
type                u32 LE
rawClockSec         f32 LE
payload             bytes[payloadLen]
```

Important:

- zero-length packet payloads are legal (`Type17`);
- packet stream starts after the dynamic-length header, never at a hard-coded offset;
- packet IDs are version scoped;
- strict contiguous parsing is the normal strategy; skip-one-byte resync is not.

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
| 28 | PROVEN | recorder ammunition selection value |
| 29 | PROVEN lifecycle / PARTIAL setting | client-options/init companion |
| 31 | PROVEN | recorded arcade gun-marker / aiming-circle size |
| 32 | PROVEN envelope / many closed subfamilies | auxiliary/effect/state transport |
| 33 | PROVEN relationship | pre-materialization packet paired with Type5 |
| 35 | PROVEN | low 8 bits of session monotonic decisecond clock |
| 36 | PROVEN | full-width session monotonic decisecond anchor |
| 39 | PROVEN family / PARTIAL exact fields | high-rate aim/camera/gun geometry |
| `0xFFFFFFFF` | PROVEN | deterministic stream terminator |

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
| 0 | PROVEN shape / UNKNOWN semantic | one-byte alternating state |
| 1 | PROVEN family / PARTIAL symbol | active/crew-active terminal boolean family |
| 2 | PROVEN | turret yaw relative to hull; `rawU16 * 2π / 65536 - π` |
| 3 | PROVEN | current HP / terminal sentinel family |
| 4 | PROVEN structure / PARTIAL symbol | two-u8 vehicle/engine/movement-mode tuple |
| 7 | PROVEN structure / PARTIAL namespace | count-prefixed compact state array |
| 8 | PROVEN structure / strong recovery relationship / PARTIAL complete namespace | recoverable state/effect collection |
| 9 | PROVEN structure / PARTIAL namespace | count-prefixed compact state array |

### Vehicle prop3

```text
positive i16 -> actual current HP          PROVEN
0x0000       -> HP zero terminal           PROVEN
0xFFFD       -> death terminal sentinel    PROVEN current corpus
0xFFFE       -> terminal on verified chain PROVEN sample / PARTIAL global
0xFFFF       -> UNKNOWN; preserve raw
```

## Avatar property9

`float32 yawRad` = recorder own-vehicle turret-relative yaw mirror — **PROVEN**.

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
|---|---|---|
| Vehicle 0 / 1B | PROVEN | observed firing signal |
| Vehicle 1 / 7B | PROVEN | `currentHpRaw:u16 + sourceEntity:u32 + causeFlag:u8` |
| Vehicle 2 / 8B | PROVEN shape / PARTIAL semantic | two-float config family; old `onPushed` rejected |
| Vehicle 4 / 16B | PROVEN | vehicle↔vehicle collision |
| Vehicle 6 / 29B | PROVEN physical role | static/world collision |
| Vehicle 8 / 21B common | PROVEN identity; geometry now substantially decoded | recorder direct-hit notification; includes compact target-local BigWorld hit segment |
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
| Avatar 29 / 37B | PROVEN | projectile launch + shotId + geometry/velocity |
| Avatar 35 / 13B | PROVEN | full reload-duration/config update |
| Avatar 36 / 74/92B | PROVEN targeting family | targeting snapshot; PRE→method29 launch→POST at recorder shots |
| Avatar 38 / variable | PROVEN shot-result family | recorder outgoing hit/result feedback |
| Avatar 39 / 2B | PROVEN cadence / PARTIAL symbol | fixed heartbeat/control RPC |
| Avatar 44 / 16B | PROVEN config family | platform/build init snapshot |
| Avatar 46 | PROVEN family | tactical-marker/ping |
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

The same current component-ID namespace is now closed across recorder method16, Type32 damage/recovery surfaces, and method38 repeated hit-result tokens.

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

### Track orientation closure

Vehicle method8 compact local hit segments geometrically separate `34/35`. BigWorld local coordinates use `+X = left`:

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
18 -> automatic critical self-repair -> damaged   PROVEN version-scoped behavioral role
19 -> fully repaired / cleared                     PROVEN
```

Crew:

```text
10 -> shell-shocked / injured PROVEN
22 -> healed / cleared         PROVEN
```

Other observed values such as `0,1,6,7` remain PARTIAL/UNKNOWN presentation-transition states.

## Gun codeB=36 physical closure

Recorder-local natural damage→Repair Kit chain:

```text
field6.field1: 0.9171787581 -> 1.8343575163 -> 0.9171787581
root.field4:   0.7611729934 -> 0.5137917725 -> 0.7611729934
```

The exact ×2 dispersion-like penalty and same-clock Repair Kit restoration close `36=Gun` independently from historical ordering.

## Fuel Tank 33 / Observation Device 38

A recorder-local `38, codeA=5` critical event produces no fire HP tick / fire-associated Type32 surface. Current critical Fuel Tank behavior would ignite; therefore 38 is Observation Device. With the full mechanical domain closed, 33 is Fuel Tank by exhaustive current-domain elimination.

# Avatar method38 shot-result structure

Safe current shape:

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

## Proven/approved low-bit facts

```text
0x0001 direct shell terminal kill     PROVEN current corpus
0x0002 target already dead            PROVEN sample / PARTIAL global
0x0004 fire started                   PROVEN samples / PARTIAL global
0x0008 ricochet                       high-confidence PARTIAL
0x1110 piercing-like OR relationship  PROVEN after semantic-hit dedup
```

`headerHi16Raw` is usually `0x0002` and remains raw/UNKNOWN; treating all 32 header bits as one homogeneous flag word is REJECTED.

## method38 component token

Repeated `componentToken` uses the same current component namespace listed above — **PROVEN relationship**.

## method38 rawState

```text
rawState=0 -> component hit/involved; no newly observed persistent negative module state
              VERY STRONG PARTIAL physical role; exact internal enum unknown
rawState=1 -> module damaged / crew injured family
              PROVEN relationship
rawState=2 -> module critical / disabled family
              PROVEN relationship
```

Module-hit and module-damage are distinct. A shell can list multiple internal components and independently succeed/fail the module damage roll per component.

Observed mixed example behavior includes components with `rawState=0` in the same hit as another crew/module result with `rawState=1`.

## method38 extension

Current population:

```text
extension=1 : 13
extension=2 :  1
```

`extension=1` is a **VERY STRONG Precision Fire proc candidate / near-PROVEN**, not yet production-PROVEN solely from numeric damage:

- all 12 non-HE-family current samples produce exact maximum ordinary damage or target-HP-capped terminal damage;
- the lone FV215b HE-family sample is not a contradiction because published Precision Fire behavior for HE still passes through HE penetration/armor/explosion-radius damage resolution after the proc;
- a controlled or direct schema/string closure is still preferred before final production naming.

`extension=2` is a **VERY STRONG PARTIAL Tungsten/special-damage provenance candidate, n=1**: the only recorder-owned Tungsten-active hit carries value 2, and no non-Tungsten hit does.

## Type28 re-audited ammunition selection

Type28 remains **PROVEN ammunition selection state**, but older per-vehicle aggregate counts were stale and have been superseded by strict own-shot reconstruction:

```text
method29 shooterId == recorder
unique (arena, shotId)
= 324 unique recorder shots
= 324 settlement shots
```

Current vehicle totals:

```text
A178_SPHT 222
FV215b     32
Ho-Ri      17
Maus       49
VK 72.01    4
TOTAL      324
```

Known launch-velocity families by Type28 value:

```text
SPHT:   0->760,     1->560,     2->560
FV215b: 0->1152.36, 1->1440.72, 2->1152.36
Ho-Ri:  0->972,     1->1026
Maus:   0->680,     1->1032
VK72:   0->600,     1->552
```

Do not assume wire value `0/1/2` equals UI list order without method17 descriptor closure. For FV215b, the user-facing current shell family is AP / APCR / HE; wire value `1` is strongly identified as APCR by projectile velocity, while the exact remaining descriptor↔name mapping remains version-gated.

## High result bits and Type28 value 2

Re-audited against the corrected 324-shot ledger:

```text
0x1000: 13/13 -> Type28 selectionValue=2
0x2000:  1/1  -> Type28 selectionValue=2
0x4000:  7/7  -> Type28 selectionValue=2
```

This proves a **selectionValue=2 special ammunition/result-resolution relationship** in the current corpus. Exact individual names (HE/HESH direct penetration, explosion branch, material/armor branch, etc.) remain PARTIAL. Historical PC upper-bit names are not transplanted as current Blitz truth.

# Avatar method12 battle-feedback counters

| baseType | Verdict | Meaning |
|---:|---|---|
| 1 | PROVEN | cumulative damage dealt |
| 2 | PROVEN | cumulative enemies spotted |
| 3 | PROVEN | cumulative kills |
| 5 | PROVEN | cumulative damage blocked |
| 6 | PROVEN samples / limited-N | enemy ignition/set-on-fire |
| 8 | PARTIAL | critical/module result inflicted family |
| 12 | UNKNOWN exact semantic; old base-defense hypothesis REJECTED | gameplay-stat family correlating in presence with settlement field118 |
| 15 | PROVEN | Destruction Assistance count/ribbon progression |
| 16 | PARTIAL | critical/device damage received family |
| 17 | PROVEN | cumulative total assist damage |

`baseType12 = base defended / droppedCapturePoints` is **REJECTED/SUPERSEDED** for the current 11.19 corpus. Presence correlation with field118 remains real, but the exact statistic is unresolved.

# Avatar method48 wrapper inventory

| Wrapper | Verdict | Meaning |
|---:|---|---|
| 1 | PROVEN | roster/entity-account/team/player snapshot |
| 3 | PROVEN | arena-period lifecycle |
| 6 | PROVEN kill-feed core / PARTIAL optional field3 | victim/killer/deathReason + optional prior contributor |
| 7 | PROVEN behavior | vehicle/avatar-ready lifecycle |
| 12 | PROVEN | Supremacy base ownership/capture state machine |
| 13 | PROVEN | Supremacy team score |
| 15 | PROVEN gun-feed family / PARTIAL exact enum names | own-team weapon/reload telemetry |
| 16 state1 | PROVEN behavioral role | team-visible ordinary observed-by-enemy entry/re-entry family |
| 16 state8 | PROVEN forced-observation behavior / PARTIAL exact symbol | hit-applied forced-observation/forced-spot recipient behavior; `TRACER_SHELL` symbolic candidate remains PARTIAL |
| 18 | PARTIAL | prebattle/configuration data |

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

# Type31 / Type36 / Type39 targeting

## Type31

`float32 markerSize` = recorded arcade gun-marker / aiming-circle size — **PROVEN**. Do not call it penetration probability.

## Avatar method36

- 74-byte init/config variant and 92-byte dynamic variant;
- nine fixed64/double-like scalars in the decoded nested structure;
- `root.field1` = turret/gun relative yaw relationship — PROVEN;
- `root.field2` = gun pitch relationship — PROVEN;
- `field6.field1` = dynamic gun-dispersion/bloom family — VERY STRONG physical role;
- every recorder shot has exact `method36 PRE -> method29 -> method36 POST` ordering in the strict corpus;
- Gun damage doubles `field6.field1` and Repair Kit returns it to baseline.

Exact remaining scalar names/units remain PARTIAL. Historical nine-argument `updateTargetingInfo` is architectural cross-check only; ordinal parameter transplantation is REJECTED.

## Type39

Seven float32 values:

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

Closed subfamilies:

- mobile `flag=0` long body = consumable lifecycle transport;
- states `1 init`, `2 activation`, `3 active-end/cooldown transition`, `255 teardown`;
- current mapped consumables: Adrenaline, Engine Power Boost, MPRP, First Aid Kit, Repair Kit, Improved Engine Power Boost, Reticle Calibration, Reactive Armor, Tungsten Shells;
- `0x0D Repair Kit`, `0x0C First Aid Kit`, `0x0B MPRP` behaviorally closed;
- mobile `flag=1` damage/effect families correlate with method8/method16/method38 component state;
- short `...04` = fire-associated state/event family;
- Vehicle prop8 remains a mixed recoverable collection and must not be interpreted as a pure crew-only or module-only list.

Current crew Type32 token cross-surface mapping:

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
Type32 long eventClockRaw = higher precision sample in same session clock domain
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

Current closed facts:

- Type4 is enemy-only in canonical corpus;
- 485/503 Type4 cases later re-enter;
- no property/method/position updates inside closed hidden intervals;
- last Type10 before Type4 is the correct last-known position;
- Type4 must never be a death proxy.

Rhm.Pzw forced-observation mechanic supplies a strong state8 wrapper16 closure: non-terminal recorder hits on surviving targets produce state8 in the tested recorder-enemy relation, while terminal hits do not need the same continuation behavior. Exact symbolic enum remains version-scoped.

# Projectile lifecycle

```text
Vehicle method0 firing
 -> Avatar method29 launch + shotId + launch geometry/velocity
 -> Avatar method20 terminal endpoint
 -> method38 on recorder-hit path
 -> method27 on many miss/environment/explosion terminal paths
```

Recorder unique method29 shotIds = settlement shots = 324 after dedup.

Method28 current 24-event correction:

- endpoint equals same-clock method20 24/24;
- first two vectors are equal 23/24, not 24/24;
- one non-duplicate sample is a same-clock multi-projectile terminal edge case.

# Settlement / `battle_results.dat`

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

Fields `11`, `150`, `302`, `303` remain structured PARTIAL/UNKNOWN at exact semantic level.

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
| 118 | PARTIAL/UNKNOWN exact semantic | presence correlates 34/34 with method12 baseType12; old base-defense meaning REJECTED |
| 119 | PROVEN | Destruction Assistance count |
| 120 | PROVEN | Gun Marks count `0..3` |

## field118 / baseType12 correction

Current proven relationship:

```text
field118 present/non-zero iff baseType12 present in recorder feedback: 34/34
```

But the prior `base defended / droppedCapturePoints` semantic is contradicted by mode/event controls and is **REJECTED/SUPERSEDED**. Keep field118 and baseType12 linked only as the same unresolved gameplay-stat family.

## field119

Final method12 base15 count == field119 in 34/34 including zero-by-absence — **Destruction Assistance count PROVEN**.

## field120

wrapper1 player field26 == settlement field120 in 476/476; domain `0..3` — **Gun Marks count PROVEN**.

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

The four fallback deaths also lack usable live kill/death-time surfaces. This is a real single-POV/AoI information boundary, not a decoder bug. Never claim 100% sub-second death time from one replay POV.

# Remaining unresolved queue

## Priority A — business relevant

1. method38 exact individual unresolved flag names, especially selectionValue=2 high-bit branches.
2. method38 `rawState=0` exact internal enum name; physical no-new-damage outcome is already strongly bounded.
3. method38 `extension=1/2` direct schema/string closure; current Precision Fire/Tungsten evidence is strong but should remain provenance-aware.
4. method36 remaining scalar exact names/units.
5. settlement field118/baseType12 exact statistic identity.
6. Vehicle prop7/8/9 complete element namespaces.
7. wrapper6 optional secondary-attribution exact eligibility.
8. uncommon deathReason values absent from this corpus need new real samples.

## Priority B — structurally safe, lower product value

1. Vehicle prop0 exact alternating-state meaning.
2. Vehicle prop4 exact symbolic tuple.
3. Vehicle method2 two-float config semantics.
4. Avatar method3 exact two-byte state meaning.
5. Avatar method43 player-name/tactical-UI family exact symbol.
6. Type11 exact space/config body.
7. Type13 exact in-stream settlement serialization.
8. settlement field116 exact cosmetic/customization item class.
9. settlement root11/150/302/303 exact low-level field semantics.

## Priority C — special/non-combat variants

- 28-byte Vehicle method0 class-specific variant on special/non-settled entities;
- rare 18-byte method5 non-Avatar variant;
- static Type32 entity families;
- observer/BPC-specific payloads.

# Research-complete definition

For the current Blitz 11.19 China corpus, research can be considered complete when:

1. every observed top-level type/property/method/wrapper/settlement surface is inventoried;
2. every surface has an explicit evidence grade;
3. all disproved hypotheses are marked REJECTED/SUPERSEDED;
4. unresolved fields preserve raw bytes and have bounded hypotheses/sample requirements;
5. no known stale aggregate table contradicts canonical counts;
6. low-business cosmetic/platform exact labels do not block completion once structurally bounded;
7. production consumers use only version-gated PROVEN or explicitly approved PARTIAL facts.
