# Replay protocol inventory — Blitz 11.19 China canonical corpus

> Purpose: enumerate every currently observed replay surface and assign its latest evidence state.
>
> Corpus: 34 unique arenas. Multi-POV duplicates are used only for cross-validation, not as additional battles.

## Evidence states

- `PROVEN`: semantic/physical role closed by current replay behavior and/or independent schema evidence.
- `PARTIAL`: structure or family known; exact symbolic name/enum/rule incomplete.
- `UNKNOWN`: observed but semantic meaning not yet established.
- `SUPERSEDED`: older interpretation disproved by stronger evidence.
- `DEPRECATED`: retained only for historical research context.

# Container

| Component | Status | Current meaning |
|---|---|---|
| `.wotbreplay` ZIP | PROVEN | contains `meta.json`, `data.wotreplay`, `battle_results.dat` |
| `meta.json` | PROVEN/PARTIAL | authoritative for many replay metadata/config facts, not every battle timing fact |
| `data.wotreplay` | PROVEN framing | replay packet stream |
| `battle_results.dat` | PROVEN container / broad schema | Python pickle protocol-2 tuple `(arenaUniqueId, protobufBytes)` |

## `data.wotreplay` header/framing

```text
magic                  : u32 LE = 0x12345678
unknownHeader          : 8 bytes
clientHashLength       : u8
clientHash
clientVersionLength    : u8
clientVersion
padding                 : u8

repeated packets:
payloadLen              : u32 LE
type                    : u32 LE
rawClockSec             : f32 LE
payload                 : payloadLen bytes
```

Important:

- zero-length packet payloads are legal (`Type17`);
- raw replay clock contains pre-battle time;
- packet numeric IDs are client-version scoped.

# Top-level packet inventory

Observed type set:

```text
0,1,2,4,5,7,8,10,11,13,14,17,23,26,28,29,31,32,33,35,36,39,0xFFFFFFFF
```

| Type | Verdict | Current semantic |
|---:|---|---|
| 0 | PROVEN/PARTIAL | base-player creation / arena metadata family |
| 1 | PARTIAL | entity/avatar-cell creation/init family |
| 2 | PARTIAL | entity/avatar-cell creation/init family |
| 4 | PROVEN | enemy leaves client-observed entity/AoI set; **not death** |
| 5 | PROVEN relationship / PARTIAL full body | entity materialization/re-entry body following Type33 |
| 7 | PROVEN envelope / broad semantics | EntityProperty |
| 8 | PROVEN envelope / broad semantics | EntityMethod |
| 10 | PROVEN | 49-byte vehicle transform/position/orientation packet |
| 11 | PARTIAL | early space/map/session information |
| 13 | PROVEN family / PARTIAL serialization | in-stream battle-results/settlement dump path; present only when end tail is recorded |
| 14 | PROVEN | replay event-stream close marker |
| 17 | PROVEN relationship / PARTIAL symbol | recorder-local aim/camera/projectile-control initialization boundary |
| 23 | PROVEN current corpus | recorder shot/projectile lifecycle toggle |
| 26 | PROVEN current corpus | incoming hostile-shell warning/event family |
| 28 | PROVEN | recorder ammunition/shell-slot selection index |
| 29 | PROVEN lifecycle / PARTIAL setting | duplicated recorder/client-options initialization companion flag |
| 31 | PROVEN | recorded arcade gun-marker / aiming-circle size |
| 32 | PROVEN envelope / multiple proven subfamilies | entity auxiliary/effect/state transport |
| 33 | PROVEN relationship | pre-materialization/re-entry packet paired 1:1 with Type5 |
| 35 | PROVEN | low 8 bits of client/session monotonic decisecond clock |
| 36 | PROVEN relationship | full-width client/session monotonic decisecond anchor |
| 39 | PROVEN family / PARTIAL some fields | recorder high-rate aim/camera/gun geometry stream |
| `0xFFFFFFFF` | PROVEN | deterministic current-version file/stream terminator |

# Type7 — EntityProperty

Envelope:

```text
entityId : u32
propId   : u32
valueLen : u32
value    : bytes[valueLen]
```

Numeric property IDs are **entity-class scoped**.

## Vehicle properties

| propId | Verdict | Current semantic |
|---:|---|---|
| 0 | PROVEN shape / UNKNOWN semantic | 1-byte alternating `0/1` sequence-like state; not movement/visibility/firing/death |
| 1 | PROVEN behavioral family / STRONG PARTIAL exact symbol | terminal active/crew-active boolean; current observations are `00` exactly on terminal prop3 boundary |
| 2 | PROVEN | turret yaw relative to hull; `rad = rawU16 * 2π / 65536 - π` |
| 3 | PROVEN | current HP / terminal sentinel family |
| 4 | PROVEN structure / STRONG PARTIAL | two-u8 discrete vehicle/engine/movement-mode tuple |
| 7 | PROVEN structure / PARTIAL semantic | count-prefixed compact u8 state array |
| 8 | PROVEN structure / strong effect relationship / PARTIAL tokens | count-prefixed compact u8 state/effect array |
| 9 | PROVEN structure / PARTIAL semantic | count-prefixed compact u8 state array |

## Avatar property9

Same numeric propId, different class schema:

```text
float32 yawRad
```

Verdict:

> Avatar prop9 = **recorder own-vehicle turret-relative yaw mirror — PROVEN**.

It closes tightly against recorder Vehicle prop2 and strengthens Type39 f5 interpretation.

## Vehicle prop3 sentinels

| Raw | Verdict | Meaning |
|---|---|---|
| positive signed i16 | PROVEN | real current HP |
| `0x0000` | PROVEN | terminal HP=0 |
| `0xFFFD` | PROVEN current corpus | death-associated terminal sentinel |
| `0xFFFE` | PROVEN terminal on verified sample / PARTIAL global | terminal state observed in closed death chain |
| `0xFFFF` | UNKNOWN exact meaning | preserve raw; never infer death alone |

# Type8 — EntityMethod

Current envelope:

```text
entityId : u32
methodId : u32
argLen   : u32
args     : bytes[argLen]
```

Method IDs are **target-entity-class + version scoped**.

## High-value closed method families

| Method | Verdict | Current semantic |
|---:|---|---|
| Vehicle 0 / 1B | PROVEN | observed vehicle firing signal |
| Vehicle 1 / 7B | PROVEN | live `currentHpRaw:u16 + sourceEntity:u32 + causeFlag:u8` |
| Vehicle 2 / 8B | PROVEN structure / PARTIAL semantic | two-float vehicle-specific config/parameter family; old `onPushed` hypothesis rejected |
| Vehicle 4 / 16B | PROVEN | vehicle↔vehicle collision contact geometry |
| Vehicle 6 / 29B | PROVEN physical role | static/world collision contact geometry |
| Vehicle 8 / 21B common | PROVEN identity / PARTIAL raw-value semantics | direct-damage notification; attacker/victim identity reliable in supported form |
| Avatar 4 / 2B | PROVEN | round finished: winnerTeam + finishReason |
| Avatar 5 / 3B | PROVEN | recorder own-health mirror / opening HP seed |
| Avatar 12 / 6B | PROVEN counter framework | cumulative battle-feedback/ribbon counters |
| Avatar 13 / 9B | PROVEN gun-cycle family | vehicle gun/reload state telemetry |
| Avatar 16 / 10B | PROVEN family | vehicle damage/module/crew presentation info |
| Avatar 17 / 12B | PROVEN/PARTIAL | ammunition state/descriptor family |
| Avatar 19 / 13B | PROVEN family | vehicle misc status; code7 destroyed-device repair progress PROVEN |
| Avatar 20 / 16B | PROVEN | shotId + stopTracer terminal endpoint |
| Avatar 25 / 32B | PROVEN/PARTIAL | recorder own-vehicle pose/state family |
| Avatar 27 / 34B | PROVEN family | projectile explosion / terminal-resolution family |
| Avatar 28 / 36B | PROVEN behavioral family | recorder death/death-view incoming projectile geometry |
| Avatar 29 / 37B | PROVEN | projectile/tracer launch family; shotId + launch geometry/velocity |
| Avatar 35 / 13B | PROVEN physical role | vehicle full reload-duration/config update |
| Avatar 36 / 74/92B | PROVEN targeting family | recorder targeting/aim-state snapshots; shot clocks are pre/post-sandwiched |
| Avatar 38 / variable | PROVEN shot-result family / PARTIAL bits | recorder outgoing shot-result feedback |
| Avatar 39 / 2B | PROVEN cadence / PARTIAL symbol | fixed `0000` recorder/avatar ~10-second heartbeat/control RPC |
| Avatar 44 / 16B | PROVEN config family | client platform/build initialization snapshot; low business value |
| Avatar 46 | PROVEN family | team tactical-marker/ping surface |
| Avatar 48 | PROVEN wrapper container | live arena-update protobuf wrappers |
| Avatar 49 | PROVEN family | synchronized client-options snapshot |

## Vehicle method1 cause map

```text
currentHpRaw : u16
sourceEntity : u32
causeFlag    : u8
```

Current cause identity:

| causeFlag | Verdict | Current meaning |
|---:|---|---|
| 0 | PROVEN | direct/default combat damage family |
| 1 | PROVEN | fire |
| 2 | PROVEN | ramming |
| 3 | PROVEN | world/self-environment collision family |

Evidence includes exact settlement terminal closure:

```text
ordinary/default deaths 276/276 -> 0
fire deaths               4/4   -> 1
ramming deaths             2/2   -> 2
world_collision            1/1   -> 3
```

## Avatar method16 device/crew namespace

Current proven anchors:

| codeB | Verdict | Meaning |
|---:|---|---|
| 32 | PROVEN | ammo rack |
| 34/35 | PROVEN family | two track-side modules; exact left/right assignment PARTIAL |
| 43 | PROVEN | Loader |

Strong current sequence candidates, not promoted solely from historical ordering:

```text
31 engine            STRONG PARTIAL
33 fuel tank         STRONG PARTIAL
36 gun               STRONG PARTIAL
37 turret rotator    STRONG PARTIAL
38 surveying device STRONG PARTIAL
39 commander         STRONG PARTIAL
40 driver            STRONG PARTIAL
41 radioman          STRONG PARTIAL
42 gunner            STRONG PARTIAL / sparse-current evidence
```

Current lifecycle codes:

```text
mechanical codeA=4  -> damaged/critical        PROVEN family
mechanical codeA=5  -> destroyed/severely disabled PROVEN family
mechanical codeA=19 -> repaired/clear          PROVEN family
crew codeA=10       -> injured/shell-shocked   PROVEN family
crew codeA=22       -> healed/clear             PROVEN family
```

### Ammo rack closure

```text
(codeA=4, codeB=32) -> reload duration ×1.65 in 12/12 current samples
(codeA=19,codeB=32) -> Repair Kit/MPRP clear + reload recovery
```

### Loader closure

```text
(codeA=10,codeB=43) -> reload degradation
(codeA=22,codeB=43) -> First Aid/MPRP clear + reload recovery
```

## Avatar method12 feedback counters

Current closed/near-closed base types:

| baseType | Verdict | Meaning |
|---:|---|---|
| 1 | PROVEN | cumulative damage dealt |
| 2 | PROVEN | cumulative enemies spotted |
| 3 | PROVEN | cumulative kills |
| 5 | PROVEN | cumulative damage blocked |
| 6 | PROVEN current samples / limited-N | enemy ignition/set-on-fire feedback |
| 8 | PARTIAL | critical/module result inflicted family |
| 12 | VERY STRONG PARTIAL | base-defense / dropped-capture-points feedback family |
| 15 | PROVEN | Destruction Assistance count/ribbon progression; current rule aligns with ≥25% damage then teammate destroys target |
| 16 | PARTIAL | critical/device damage received family |
| 17 | PROVEN | cumulative total assist damage |

# Avatar method48 wrapper inventory

Current high-value wrappers include:

| Wrapper | Verdict | Meaning |
|---:|---|---|
| 1 | PROVEN | roster / entity-account/team/player snapshot |
| 3 | PROVEN | arena-period lifecycle update |
| 6 | PROVEN kill-feed core / PARTIAL optional field3 | vehicle-killed feed; victim/killer/deathReason; optional secondary attribution |
| 7 | PROVEN behavior | vehicle/avatar-ready lifecycle notification |
| 12 | PROVEN state machine | realtime Supremacy base ownership/capture progress |
| 13 | PROVEN | realtime Supremacy team score |
| 15 | PROVEN gun-feed family / PARTIAL enum labels | own-team weapon/reload telemetry |
| 16 | STRONG PARTIAL | damage-triggered state/event branch |
| 18 | PARTIAL | prebattle/configuration data |

## Wrapper12 — Supremacy capture state

```text
field1 = base index                 PROVEN
field2 = owner team                 PROVEN
field3 = capturing team             PROVEN
field4 = capture progress 0..99      PROVEN
field5 = capture suspended/blocked   PROVEN behavioral identity
field6 = recorder capture participation / recorder-is-capturing STRONG PARTIAL near-PROVEN
```

`field5` is consistent with current Blitz contested-base rules: progress freezes when opposing teams contest the circle.

# Type10 — position/transform

Current complete 49-byte structure:

```text
entityId   : i32
spaceId    : i32
vehicleId  : i32
position   : 3xf32
error      : 3xf32
yaw         : f32
pitch       : f32
roll        : f32
errorFlag   : i8
```

Verdict: **PROVEN wire structure / primary transform meaning**.

# Type31 — arcade gun marker

```text
float32 markerSize
```

Verdict:

> **recorded arcade gun-marker / aiming-circle size scalar — PROVEN**.

Do not convert it directly into penetration probability or an unvalidated dispersion angle.

# Type32 — entity auxiliary/effects

Envelope:

```text
entityId   : u32
flag       : u8
bodyLength : u32
body       : bytes[bodyLength]
```

Current proven subfamilies:

- mobile `flag=0` long body: consumable/control family with session-local f64 clock;
- consumable lifecycle states and wire codes for Adrenaline, Engine Power Boost, MPRP, First Aid, Repair Kit, Improved Engine Boost, Reticle Calibration, Reactive Armor, Tungsten Shells;
- mobile `flag=1` len18: damage/hit presentation side-channel with byte-level identity to Vehicle method8;
- short `...04`: fire-associated damage/effect family;
- static entity short-body families remain only structurally classified.

Important:

> Vehicle prop7/8/9 compact arrays are related effect/state surfaces but are **not** simple literal mirrors of method16 codeB or Type32 bytes.

# Type35 / Type36 / Type32 clock domain

Current closure:

```text
Type36 = u32 session monotonic deciseconds anchor
Type35 = low8(Type36/session decisecond stream), advancing +1 mod256
Type32 long-body eventClockRaw = high-precision sample in same client/session monotonic time domain
```

Verdict: **PROVEN current corpus relationship**.

# Type39 / targeting geometry

Current Type39 body:

```text
7 x float32
```

Closed roles:

- `f0`: world aim/gun-ray yaw;
- `f1`: negated world aim/gun-ray pitch;
- `f2,f3,f4`: world-space point on aim/projectile ray;
- `f5`: recorder relative aim/turret-control yaw family, strongly related to Avatar prop9/Vehicle prop2 but not a literal mirror at all times;
- `f6`: vehicle-local gun/barrel vertical angle physical role, proven at real shot moments; exact producer symbol PARTIAL.

Avatar method36 provides lower-rate structured targeting snapshots and brackets every recorder shot with pre/post state.

# Projectile lifecycle

Current high-confidence chain:

```text
Vehicle method0 observed firing
        |
Avatar method29 launch + shotId + launch geometry/velocity
        |
        +-------------------------+
        |                         |
Avatar method20              Avatar method27
stopTracer endpoint          terminal/explosion resolution
        |
        +--> method28 recorder death/death-view geometry when applicable
```

Method28 correction:

- 24 current events;
- terminal endpoint equals same-clock method20 endpoint 24/24;
- first two VECTOR3 are equal 23/24, **not 24/24**;
- the one non-duplicate sample is a same-clock multi-projectile terminal edge case.

# Visibility/AoI lifecycle

Current proven enemy lifecycle:

```text
observed
  -> Type4
hidden / no Type7,Type8,Type10
  -> Type33
  -> Type5
observed again
```

Closed current facts:

```text
Type4 enemy-only in canonical corpus
485/503 later re-enter
0 property/method/position updates inside closed hidden intervals
last Type10 before Type4 is a tight last-known position
```

Type4 must never be used as a death proxy.

# Settlement / `battle_results.dat`

Root observed fields:

```text
1,2,3,4,5,8,9,11,150,201,301,302,303
```

High-value root identities:

```text
1   mode/map compound
2   battle Unix timestamp
3   winner team
4   finish reason
5   result-layer battle duration
8   author result block
9   room type
201 participant roster
301 settled combatant results
```

## PlayerResults high-value mapping

| field | Verdict | Meaning |
|---:|---|---|
| 1 | PROVEN | final hitpointsLeft / terminal sentinel family |
| 4 | PROVEN | shots fired |
| 5 | PROVEN | hits dealt |
| 6 | PARTIAL | HE/splash-hit family |
| 7 | PROVEN | penetrations dealt |
| 8 | PROVEN | damage dealt |
| 9 | PROVEN family / PARTIAL subtype name | assist damage subtype A |
| 10 | PROVEN family / PARTIAL subtype name | assist damage subtype B |
| 11 | PROVEN | damage received |
| 12 | PROVEN | hits/shots received |
| 13 | PROVEN | non-penetrating hits received |
| 14 | PARTIAL | HE/splash-received family |
| 15 | PROVEN | penetrations received |
| 16 | PROVEN current corpus | enemies spotted |
| 17 | PROVEN | enemies damaged |
| 18 | PROVEN | enemies destroyed/kills |
| 23 | PROVEN | XP result; exact premium/base naming version-sensitive |
| 24 | PROVEN | `lifeTime` |
| 25 | PROVEN | `killerID` |
| 32 | PROVEN | Supremacy/victory points earned |
| 33 | PROVEN | Supremacy/victory points seized |
| 101 | PROVEN | account ID |
| 102 | PROVEN | team |
| 103 | PROVEN | vehicle/tank compact descriptor ID |
| 105 | PROVEN | deathReason / alive sentinel family |
| 106 | PROVEN | credits result |
| 107 | PROVEN/PARTIAL display semantic | matchmaking/rating float |
| 116 | PROVEN cross-surface config identity / PARTIAL exact cosmetic symbol | same as loading-roster player field16; customization/display descriptor family; low business value |
| 117 | PROVEN | damage blocked |
| 118 | VERY STRONG PARTIAL near-PROVEN | base-defense / dropped-capture-points magnitude |
| 119 | PROVEN | Destruction Assistance count |
| 120 | PROVEN | Gun Marks count `0..3` |

## field118 / baseType12

Current evidence:

```text
field118 > 0 iff method12 baseType12 present : 34/34 recorder arenas
```

Port / Harbor Town natural control:

```text
enemy captures owned B
recorder damages capturing enemy
baseType12 increments
public B progress resets to 0 shortly after
settlement field118 = 12
```

Verdict:

> **base-defense / dropped-capture-points family — VERY STRONG PARTIAL, near-PROVEN**.

Exact symbolic promotion awaits a current schema or another clean numerical single-capturer closure.

## field119

```text
final method12 base15 count == field119
34/34 including zero-by-absence
```

Ribbon tier progression:

```text
1st -> eventCode 0x000F, count1
2nd -> eventCode 0x010F, count2
3rd -> eventCode 0x020F, count3
```

Current Blitz Destruction Assistance rule closes the previously missing eligibility condition: sufficient damage contribution before teammate destruction.

Verdict:

> **Destruction Assistance count — PROVEN**.

## field120

Cross-surface closure:

```text
wrapper1 player field26 == settlement field120
476 / 476 exact including protobuf default zero
```

Value distribution:

```text
0:371
1:3
2:4
3:98
```

Together with current Blitz loading/results Gun Marks behavior:

> **field120 = Gun Marks count — PROVEN**.

# Death-time precision

Canonical deaths:

```text
settled dead combatants : 287
live Type7 terminal     : 283
live method1 terminal   : 283
both live surfaces      : 283
```

Thus:

```text
EVENT_SUBSECOND coverage = 283/287 = 98.61%
SETTLEMENT_SECOND fallback = 4/287 = 1.39%
```

The four fallback deaths also lack wrapper6 and useful death-time Type33 events. This is a true single-POV/AoI observation limit, not a decoder gap.

100% sub-second coverage requires multi-POV fusion where available; otherwise explicit settlement-second precision is the correct fallback.

# Current genuinely unresolved / low-confidence queue

## Priority A — business-relevant remaining semantics

1. `field118/baseType12` exact symbolic closure (`droppedCapturePoints` candidate near-PROVEN).
2. method16 remaining exact device/crew IDs:
   - engine;
   - fuel tank;
   - gun;
   - turret rotator;
   - surveying device;
   - commander/driver/radioman/gunner.
   Current ordering is STRONG PARTIAL but exact names must not be promoted only from historical PC enums.
3. Vehicle prop7/8/9 element namespaces.
4. exact method38 shot-result bit semantics beyond already proven flags/families.
5. Type32 compact module/effect token layout and remaining fire lifecycle distinctions.
6. wrapper6 optional secondary attribution exact eligibility rule.
7. Type39 `f5` exact producer meaning and method36 remaining targeting scalar names.
8. uncommon deathReason values absent from the 34-arena corpus (drowning, overturn, death-zone, etc.) require new real samples.

## Priority B — structurally known but lower product value

1. Vehicle prop0 exact alternating-state meaning.
2. Vehicle prop4 exact current symbolic tuple (`engineMode` strong historical candidate).
3. Vehicle method2 two-float config semantics.
4. Avatar method3 two-byte state family.
5. Avatar method19 `code=1`: recorder vehicle + enemy vehicle relation; not visibility/aim/collision; exact semantic unknown.
6. Avatar method43 player-name notification/tactical UI family.
7. Type11 exact space/config body.
8. Type13 exact in-stream settlement serialization.
9. settlement field116 exact cosmetic/customization item class — intentionally deprioritized.

## Priority C — special entity / non-combat variants

- 28-byte Vehicle method0 class-specific variant on non-settled/special entities;
- 18-byte method5 rare non-Avatar variant;
- static Type32 entity families;
- other observer/BPC-specific payloads.

# Research completion definition

This version/corpus is research-complete only when:

1. every observed top-level packet type is inventoried;
2. every observed Type7 property is class-scoped and inventoried;
3. every observed Type8 method is class-scoped and inventoried;
4. every observed method48 wrapper is structurally inventoried;
5. settlement root/player fields are structurally inventoried;
6. every surface has an explicit evidence grade;
7. superseded hypotheses are marked rather than silently reused;
8. unknowns remain explicitly unknown when the corpus cannot prove more;
9. low-business cosmetic/platform surfaces do not block completion once safely classified;
10. product-facing decoders consume only version-gated PROVEN/approved PARTIAL facts.