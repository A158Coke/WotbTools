# WoT Blitz 11.19 Replay Protocol — Complete Reverse-Engineering Reference

> Scope: WoT Blitz `11.19.0_china` / `11.19.0_china_apple` replay research performed for WotBTools.
>
> Purpose: provide one implementation-oriented reference for future maintainers and replay researchers. This file consolidates the current canonical findings, controlled probes, rejected hypotheses, safe parser contracts, and known evidence boundaries.
>
> Status: **current 11.19 observed surfaces are production-usable; remaining unknowns are version/private-symbol/low-frequency boundaries, not blockers for replay parsing, battle reconstruction, HP/death timelines, ammunition, module/crew damage, projectile results, targeting, or AI-review fact extraction.**

---

## 1. Read this first

This project uses evidence grades deliberately. Do not replace them with guesses.

| Grade | Meaning |
|---|---|
| `PROVEN` | current replay behavior closes the physical/semantic role; safe for the stated version/scope |
| `VERY STRONG PARTIAL` | behavior is strongly constrained, but exact symbol or global low-N validation remains |
| `PARTIAL` | structure/family is known but exact naming/unit/rule remains incomplete |
| `UNKNOWN` | observed bytes/IDs are preserved, but semantic identity is not closed |
| `SUPERSEDED` | an earlier interpretation was replaced by stronger evidence |
| `REJECTED` | an interpretation is contradicted by current evidence |

### 1.1 Non-negotiable rules

1. Packet IDs, method IDs, property IDs, component IDs and enums are **client-version and entity-class scoped**.
2. Historical PC WoT schemas are useful as architecture cross-checks, but **must never be copied ordinally into current Blitz without current replay evidence**.
3. Single-POV replay data is not omniscient. AoI/visibility gaps are real information boundaries.
4. Raw fields must be preserved even when a semantic decoder exists.
5. A user-facing label should not be stronger than its evidence grade.
6. Controlled replay experiments are preferred over correlation when a current private symbol cannot be recovered.

---

# 2. Canonical corpus and consistency gates

Original canonical tournament/training corpus:

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

Correct recorder-shot totals:

```text
A178_SPHT       222
GB13_FV215b      32
J20_Ho_Ri_type3  17
Maus             49
VK 72.01          4
TOTAL            324
```

The old table summing to 341 is `SUPERSEDED`.

Additional controlled 11.19 replays were later recorded for:

- drowning / positive-HP terminal death;
- FV215b ammunition switching;
- Tungsten Shells;
- Precision Fire + Tungsten simultaneous proc;
- WZ-120 movement/targeting investigation;
- Maus Observation Device / Fuel Tank damage;
- TVP T 50/51 ricochet, spaced armor and mantlet interactions;
- WZ-120 HE direct penetration / non-penetration / track / spaced armor / splash matrix;
- Maus vertical gun pitch speed.

Those probes are treated as current-version evidence and are not folded into the original 34-arena count ledger unless explicitly stated.

---

# 3. `.wotbreplay` container

A replay is a ZIP container containing at least:

```text
meta.json

data.wotreplay

battle_results.dat
```

## 3.1 `data.wotreplay` framing

Header:

```text
magic               u32 LE = 0x12345678
unknownHeader       8 bytes
clientHashLength    u8
clientHash          bytes[clientHashLength]
clientVersionLength u8
clientVersion       bytes[clientVersionLength]
padding             u8
```

Then a contiguous packet stream:

```text
payloadLen          u32 LE
type                u32 LE
rawClockSec         f32 LE
payload             bytes[payloadLen]
```

Important parser rules:

- packet stream offset is dynamic; never hard-code 66;
- zero-length payloads are legal;
- strict contiguous parsing is the normal path;
- skip-one-byte resynchronization must not be the default parser strategy;
- preserve raw packet bytes for unknown/version-new surfaces;
- `0xFFFFFFFF` is a deterministic stream terminator in the current corpus.

---

# 4. Top-level packet types

Observed current types:

```text
0, 1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 17,
23, 26, 28, 29, 31, 32, 33, 35, 36, 39, 0xFFFFFFFF
```

High-value map:

| Type | Current role | Confidence |
|---:|---|---|
| 0 | base-player / arena metadata family | PROVEN/PARTIAL |
| 1,2 | entity/avatar-cell creation/init family | PARTIAL |
| 4 | entity leaves recorder-observed AoI; **not death** | PROVEN |
| 5 | materialization/re-entry + transform/state/loadout/current HP | PROVEN relationship |
| 7 | EntityProperty envelope | PROVEN |
| 8 | EntityMethod envelope | PROVEN |
| 10 | 49-byte vehicle transform stream | PROVEN |
| 11 | space/map/session config family | PARTIAL |
| 13 | in-stream result/settlement dump family | PROVEN family |
| 14 | stream close marker | PROVEN |
| 17 | recorder aim/control init boundary | PROVEN relationship |
| 23 | recorder projectile/shot lifecycle toggle | PROVEN |
| 26 | incoming hostile-shell warning family | PROVEN |
| 28 | recorder ammunition selection state | PROVEN |
| 29 | client-options/init companion | PROVEN relationship |
| 31 | recorded gun-marker / aiming-circle size | PROVEN |
| 32 | auxiliary effect/state envelope | PROVEN envelope |
| 33 | pre-materialization packet paired with Type5 | PROVEN relationship |
| 35 | low 8 bits of monotonic decisecond session clock | PROVEN |
| 36 | full-width monotonic decisecond anchor | PROVEN |
| 39 | high-rate aim/camera/gun geometry | PROVEN family |
| `0xFFFFFFFF` | stream terminator | PROVEN |

---

# 5. Type7 — EntityProperty

Envelope:

```text
entityId u32
propId   u32
valueLen u32
value    bytes[valueLen]
```

## 5.1 Vehicle properties

| propId | Meaning | Confidence |
|---:|---|---|
| 0 | one-byte state; exact semantic unknown | PROVEN shape / UNKNOWN semantic |
| 1 | active/crew-active terminal boolean family | PROVEN family |
| 2 | turret yaw relative to hull | PROVEN |
| 3 | current HP / terminal sentinel family | PROVEN |
| 4 | two-u8 vehicle/engine/movement-mode tuple | PROVEN structure / PARTIAL semantic |
| 7 | compact state-array family | PROVEN structure / PARTIAL namespace |
| 8 | recoverable state/effect collection | PROVEN structure / PARTIAL namespace |
| 9 | compact state-array family | PROVEN structure / PARTIAL namespace |

### 5.2 Vehicle prop2 — turret yaw

```text
angleRad = rawU16 * 2π / 65536 - π
```

This is turret yaw relative to hull.

### 5.3 Vehicle prop3 — HP / terminal

Current safe model:

```text
positive i16 -> actual current HP
0x0000       -> HP zero terminal
0xFFFD       -> death terminal sentinel
0xFFFE       -> terminal on verified current chain; preserve/version-gate
0xFFFF       -> UNKNOWN; preserve raw
```

**Never define death as `HP <= 0` globally.** Controlled drowning proves a vehicle can die while retaining positive HP.

---

# 6. Type8 — EntityMethod

Envelope:

```text
entityId u32
methodId u32
argLen   u32
args     bytes[argLen]
```

Method IDs are entity-class scoped. `Vehicle method 1` and `Avatar method 1` are unrelated namespaces.

High-value current methods:

| Method | Role | Confidence |
|---|---|---|
| Vehicle 0 | observed firing signal | PROVEN |
| Vehicle 1 | HP-damage / death-cause update | PROVEN |
| Vehicle 4 | vehicle↔vehicle collision | PROVEN |
| Vehicle 6 | static/world collision | PROVEN physical role |
| Vehicle 8 | recorder direct-hit notification + target-local hit segment | PROVEN |
| Avatar 4 | winnerTeam + finishReason | PROVEN |
| Avatar 5 | recorder own HP mirror/opening actual HP | PROVEN |
| Avatar 12 | battle-feedback/ribbon counters | PROVEN framework |
| Avatar 13 | reload/gun-cycle telemetry | PROVEN family |
| Avatar 16 | recorder module/crew damage presentation | PROVEN family |
| Avatar 17 | ammunition descriptor/state | PROVEN behavioral identity |
| Avatar 19 | misc vehicle status / repair-progress branches | PROVEN family |
| Avatar 20 | shotId + projectile/tracer terminal endpoint | PROVEN |
| Avatar 25 | recorder pose/state | PROVEN/PARTIAL |
| Avatar 27 | projectile explosion/terminal resolution | PROVEN family |
| Avatar 28 | recorder death/death-view incoming projectile geometry | PROVEN family |
| Avatar 29 | projectile launch + shotId + geometry + velocity | PROVEN |
| Avatar 35 | reload-duration/config update | PROVEN |
| Avatar 36 | targeting snapshot protobuf | PROVEN family |
| Avatar 38 | outgoing shot-result feedback | PROVEN |
| Avatar 43 | player-name/tactical-UI family | PROVEN family / PARTIAL exact symbol |
| Avatar 46 | tactical marker/ping family | PROVEN family |
| Avatar 47 | chat/action command transport; battle-command payload observed | PROVEN family / PARTIAL command enum |
| Avatar 48 | arena-update protobuf wrapper container | PROVEN |
| Avatar 49 | synchronized client-options snapshot | PROVEN family |

---

# 7. Vehicle method1 — damage and death causes

Current wire shape:

```text
currentHpRaw  u16
sourceEntity  u32
causeFlag     u8
```

Current cause map:

```text
0 = direct/default combat damage      PROVEN
1 = fire                              PROVEN
2 = ramming                           PROVEN
3 = world/self-environment impact     PROVEN
4 = UNKNOWN                           unobserved/unclosed
5 = drowning                          PROVEN controlled
```

Original settlement closure:

```text
ordinary/default terminal deaths 276/276 -> cause 0
fire deaths                        4/4   -> cause 1
ramming deaths                     2/2   -> cause 2
world collision                    1/1   -> cause 3
```

## 7.1 Drowning closure

Controlled drowning sample:

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
damageTaken  = 40
killer       = self
deathReason  = 5
```

Therefore:

```text
causeFlag 5  = DROWNING
 deathReason 5 = DROWNING
```

Most important consequence:

> **terminal/death state is authoritative; HP=0 is not a universal death predicate.**

---

# 8. Projectile lifecycle

Canonical graph:

```text
Vehicle method0          observed firing
        |
        v
Avatar method29          projectile/tracer launch
        |
        | shotId
        +------------------------------+
        |                              |
        v                              v
Avatar method20                   Avatar method27
terminal endpoint                 explosion/terminal-resolution family
```

## 8.1 Avatar method29

37-byte body:

```text
bytes  0..4   shooterEntityId : u32 LE
bytes  4..8   shotId          : u32 LE
byte   8      flag/raw         : u8
bytes  9..21  launchPoint      : VECTOR3<f32>
bytes 21..33  launchVelocity   : VECTOR3<f32>
bytes 33..37  invariant/raw    : f32
```

Current physical conclusions:

- launch velocity vector is PROVEN;
- launch point/reference point is PROVEN physical family;
- method29 is a **global observed projectile feed**; filter by shooter identity before calling a shot recorder-owned.

Do not use raw packet clock difference between method29 and method20 as exact projectile flight time; packet clocks can be batched/network-delivery timestamps.

## 8.2 Avatar method20

```text
shotId    u32
endPoint  VECTOR3<f32>
```

Every current method29 shotId closes against a method20 endpoint in the observed corpus.

## 8.3 Avatar method27

Projectile explosion / terminal-resolution family. The terminal point is byte-for-byte identical to the paired method20 endpoint in the observed population.

---

# 9. Ammunition — Type28 + Avatar method17

## 9.1 Type28

Payload:

```text
selectionValue u32 LE
```

Observed domain:

```text
0, 1, 2
```

Type28 is **recorder ammunition-selection state — PROVEN current 11.19 behavior**.

Associate to a recorder shot using the latest Type28 value in the same arena before/at launch. If no value has yet been emitted, keep selection `UNKNOWN`; never carry state across arenas.

## 9.2 Avatar method17

Normal firing-time 12-byte state:

```text
shellDescriptor   u32 LE
args[4]           0
remainingQuantity u8
args[6..12]       zero on normal firing variant
```

`remainingQuantity` decrements exactly on recorder shots for the same descriptor. Initialization/feed variants contain additional non-zero bytes and must remain separately decoded.

## 9.3 Safe production chain

```text
Type28 selectionValue
        -> method17 shellDescriptor
        -> version-matched shell catalog
        -> user-facing shell type/name
```

Do not globally assume wire value equals UI slot number.

## 9.4 FV215b controlled mapping — 11.19

Controlled repeated switching produced zero conflicts:

```text
Type28=0 -> descriptor 0x003C5A0A -> AP
Type28=1 -> descriptor 0x00465A0A -> APCR
Type28=2 -> descriptor 0x003B5A0A -> HESH / HE-family
```

Observed effective launch velocities:

```text
AP    ~1152.36
APCR  ~1440.72
HESH  ~1152.36
```

This mapping is safe for this vehicle/version because it is directly controlled and descriptor-joined; it must not be promoted into a cross-vehicle global rule.

---

# 10. Current component namespace

The same current 31..43 namespace appears across Avatar method16, Type32 damage/recovery surfaces, and method38 result tokens.

## 10.1 Mechanical components

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

Track orientation is not guessed from ordinal order. It was closed from Vehicle method8 target-local hit geometry:

```text
BigWorld local +X = vehicle left
component 34 -> min-X side -> vehicle Right Track
component 35 -> max-X side -> vehicle Left Track
```

## 10.2 Crew components

```text
39 Commander      PROVEN
40 Driver         PROVEN
41 Gunner         PROVEN
42 UNKNOWN        unobserved/reserved/unused/other; do not hard-code
43 Loader         PROVEN
```

`41=Radioman / 42=Gunner` is `SUPERSEDED`.

Public Blitz-style vehicle definitions commonly merge `radioman` into another crew role rather than instantiate a separate damageable crew member. That architecture explains why a historical/shared namespace slot may remain absent, but it is not sufficient to promote ID42 to an exact name.

---

# 11. Avatar method16 — module/crew state lifecycle

Current component state map:

Mechanical:

```text
codeA=4   damaged/degraded but operational             PROVEN
codeA=5   critical/disabled                            PROVEN
codeA=18  automatic critical self-repair -> damaged    PROVEN current physical role
codeA=19  full repair/clear                            PROVEN
```

Crew:

```text
codeA=10  shell-shocked/injured   PROVEN
codeA=22  healed/cleared          PROVEN
```

Other sparse codes such as `0,1,6,7` remain presentation/transition `PARTIAL/UNKNOWN` and must be preserved raw.

## 11.1 Fuel Tank controlled closure

Controlled Maus probe:

```text
62.243s  codeA=4, codeB=33     Fuel Tank damaged
65.342s  codeA=8, codeB=33
65.843s  fire damage tick      causeFlag=1
66.343s  fire damage tick      causeFlag=1
```

Therefore:

```text
33 = Fuel Tank                         PROVEN direct controlled
codeA=8 with component33 -> ignition / fire-start transition family
```

The exact private enum name for codeA=8 remains unknown; do not automatically generalize codeA=8 to unrelated modules.

## 11.2 Observation Device controlled closure

Controlled Maus probe:

```text
38.441s  codeA=5, codeB=38
44.844s  codeA=18, codeB=38
```

This supplies a direct positive controlled sample for:

```text
38 = Observation Device
```

The exact numeric view-range penalty was not independently measured by this replay; module identity itself is closed.

## 11.3 Gun damage physical closure

A natural damage→Repair Kit chain produces a deterministic targeting effect:

```text
method36 dispersion-like scalar
baseline -> exactly ×2 while Gun damaged -> baseline after Repair Kit
```

This independently closes `36 = Gun` and proves the targeting penalty is represented in replay state.

---

# 12. Avatar method38 — outgoing shot result

This is one of the highest-value surfaces in the replay.

## 12.1 Correct current structural model

The original research initially treated the tail as an optional single extension. Controlled combined-proc replay superseded that interpretation.

Safe current model:

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

`headerHi16Raw` is usually `0x0002` in the canonical sample. The full 32-bit header must **not** be treated as one homogeneous hit-flag enum.

## 12.2 resultFlags16 — current 11.19 behavioral map

| Bit | Current physical role | Evidence |
|---:|---|---|
| `0x0001` | direct terminal shell kill | PROVEN |
| `0x0002` | target already dead before attack | PROVEN sample / global low-N |
| `0x0004` | fire started | PROVEN |
| `0x0008` | ricochet | PROVEN controlled |
| `0x0010` | positive material/vehicle penetration by projectile | PROVEN |
| `0x0020` | projectile non-penetration / material stop | PROVEN controlled |
| `0x0040` | zero-damage-factor / spaced-armor layer pierced by projectile | PROVEN controlled |
| `0x0080` | zero-damage-factor / spaced-armor layer not pierced | PROVEN controlled |
| `0x0100` | internal component/device pierced or involved by projectile | PROVEN relationship |
| `0x0200` | current positive sample not observed | UNKNOWN — preserve raw |
| `0x0400` | chassis/track damaged by projectile | PROVEN |
| `0x0800` | Gun damaged by projectile | PROVEN current samples / global low-N |
| `0x1000` | positive-DF material resolved/penetrated by explosion | PROVEN controlled |
| `0x2000` | zero-DF/spaced armor resolved/penetrated by explosion | PROVEN controlled sample / low-N |
| `0x4000` | internal component/device involved by explosion | PROVEN controlled |
| `0x8000` | internal component/device damaged by explosion | PROVEN controlled |

### 12.2.1 Ricochet controlled probe

TVP controlled ricochet sequence:

```text
38.392s  flags 0x0028
55.891s  flags 0x0028
61.794s  flags 0x0028
```

```text
0x0028 = 0x0020 | 0x0008
       = non-penetration/material stop + ricochet
```

This closes `0x0008` as current ricochet behavior.

### 12.2.2 Spaced armor / mantlet controlled probe

TVP:

```text
84.086s
flags = 0x0050 = 0x0010 | 0x0040
HP damage = yes
```

Current physical reading: projectile penetrates/traverses a zero-damage-factor / spaced layer and continues into a damaging path.

Mantlet/multi-layer example:

```text
87.588s
flags = 0x00C0 = 0x0040 | 0x0080
HP damage = no
```

Current physical reading: one zero-DF layer is traversed and another zero-DF/spaced layer stops the projectile.

### 12.2.3 WZ-120 HE controlled matrix

Six deliberate HE cases:

```text
34.391s direct HE penetration
flags = 0xD010
      = 0x8000 | 0x4000 | 0x1000 | 0x0010
HP damage = yes
components = RightTrack:0, LeftTrack:1, Engine:0

45.588s thick armor non-penetration
flags = 0x0020
HP damage = no

54.492s track hit
flags = 0x1500
      = 0x1000 | 0x0400 | 0x0100
HP damage = yes
component = LeftTrack:2

63.387s spaced/mantlet interaction
flags = 0x6080
      = 0x4000 | 0x2000 | 0x0080
HP damage = no
component = LeftTrack:1

72.391s ground-near-target splash
flags = 0xD000
      = 0x8000 | 0x4000 | 0x1000
HP damage = yes
component = RightTrack:1

81.295s ground with no effective damage
flags = 0x0000
HP damage = no
```

The pure splash sample is decisive: it contains explosion bits without projectile-penetration bits, proving the high family is genuinely explosion-resolution state.

## 12.3 componentToken

Repeated method38 `componentToken` uses the same current component namespace listed in section 10.

## 12.4 rawState

Current physical model:

```text
rawState=0
-> component was hit/involved
-> no newly observed persistent negative state was produced
-> compatible with per-module damage probability
-> physical role VERY STRONG; exact private enum name unknown

rawState=1
-> module damaged / crew injured
-> PROVEN

rawState=2
-> module critical/disabled
-> PROVEN
```

A shell can intersect several components. Damage probability resolves independently per component, so `component hit` is not equal to `component damaged`.

---

# 13. method38 special modifier list

Controlled experiments closed the structure and semantics.

Current IDs:

```text
modifierId 1 = Precision Fire proc   PROVEN current 11.19
modifierId 2 = Tungsten Shells       PROVEN current 11.19
```

## 13.1 Tungsten-only controlled sequence

WZ-120 example:

```text
ordinary hit before Tungsten   -> no modifier
Tungsten active hit            -> [2]
Tungsten active hit            -> [2]
post-Tungsten Precision Fire   -> [1]
```

Observed damage on 400-alpha shell:

```text
ordinary            356
Tungsten active     432
Tungsten active     475
Precision Fire      500
```

## 13.2 Simultaneous Precision Fire + Tungsten

A dedicated controlled replay kept Tungsten active through the fourth damaging shot and obtained a Precision Fire proc on that fourth hit.

Wire result:

```text
shot 1: modifierCount=1 modifiers=[2]
shot 2: modifierCount=1 modifiers=[2]
shot 3: modifierCount=1 modifiers=[2]
shot 4: modifierCount=2 modifiers=[1,2]
```

Therefore all of the following are closed:

```text
modifier list is repeatable                       PROVEN
1 and 2 can coexist on the same hit               PROVEN
Precision Fire does not overwrite Tungsten        REJECTED
Tungsten does not overwrite Precision Fire        REJECTED
combined state is not encoded as modifier 3        REJECTED current sample
single optional extension model                    SUPERSEDED
```

Production model:

```text
ShotResultSpecialModifiers {
    rawIds: List<u32>
    decoded: Set<ModifierSemantic>
}
```

Always preserve unknown IDs.

---

# 14. Targeting / aim geometry

## 14.1 Type31

Type31 is the recorded gun-marker / aiming-circle size stream.

It is **not penetration probability**.

## 14.2 Type39

Type39 is a high-rate aim/camera/gun geometry stream. Two fields have direct current physical closure:

- `f5` corresponds to turret/gun relative yaw family;
- `f6` corresponds to local gun pitch.

Type39 is particularly useful for reconstructing continuous gun orientation between lower-rate state snapshots.

## 14.3 Avatar method36 protobuf

Two wire variants occur:

```text
92-byte dynamic body
74-byte initialization/config body
```

Conceptual scalar tree:

```text
root.field1 : fixed64
root.field2 : fixed64
root.field3 : fixed64
root.field4 : fixed64
root.field5 : fixed64
root.field6 {
  field1 : fixed64
  field2 : fixed64
  field3 {
    field1 {
      field1 { field1 : fixed64 }
      field2 { field1 : fixed64 }
    }
  }
}
```

### 14.3.1 Closed fields

```text
root.field1
= recorder turret/gun relative yaw
= PROVEN relationship to Type39 f5

root.field2
= recorder gun pitch
= PROVEN relationship to Type39 f6

root.field3
= maximum horizontal turret/gun angular speed
= PROVEN controlled physical role
= rad/s

root.field4
= maximum vertical gun elevation/depression angular speed
= PROVEN controlled physical role
= rad/s
```

### 14.3.2 root.field4 vertical-speed controlled closure

Maus controlled test:

```text
method36.root.field4 = 0.49951977690547217 rad/s
```

Observed Type39 gun-pitch derivative on saturated vertical movement:

```text
18.310070–18.335108s   +0.499521541 rad/s
30.907492–30.940794s   -0.499526029 rad/s
40.328415–40.478512s   -0.499520098 rad/s
```

Clean long-segment difference:

```text
~0.000000322 rad/s
~0.000064%
```

This is direct physical closure, not schema-order inference.

### 14.3.3 Shot sandwich

Every recorder launch in the canonical reconstruction is bracketed:

```text
method36 PRE snapshot
-> method29 projectile launch
-> method36 POST snapshot
```

The nested `field6.field1` changes on every observed recorder shot pair and increases after firing. It is therefore a targeting/dispersion/bloom-family scalar.

A Gun-damage chain makes the same scalar exactly ×2 until repaired, which strongly ties it to gun dispersion/accuracy state.

Exact private name and normalized unit of the remaining targeting coefficients are still not closed.

### 14.3.4 Important negative result

A controlled movement experiment separated:

- static;
- forward/back movement;
- hull rotation;
- turret-only rotation;
- simultaneous hull+turret motion.

method36 did **not** stream continuously through those movement stages. Therefore it is not a high-rate current-dispersion stream. It behaves as a targeting/config/snapshot surface; high-rate motion comes from Type10/Type39/etc.

---

# 15. Type10 transform / movement

Type10 is the high-value vehicle transform stream used for battle reconstruction.

Use it for:

- vehicle position;
- hull orientation;
- movement trajectory;
- motion-derived speed/yaw-rate analysis.

Do not infer turret-relative yaw from hull orientation; use Vehicle prop2 / Type39 / method36 for the gun/turret side.

---

# 16. Type32 — effects, module state, consumables

Type32 is an envelope carrying several effect/state families rather than one universal semantic.

A commonly used current envelope shape is:

```text
entityId u32
flag     u8
bodyLen  u32
body     bytes[bodyLen]
```

Both longer state/config bodies and short effect tokens occur.

High-value current conclusions:

- module/crew damage and recovery tokens correlate with method16 component IDs;
- consumable activations can be isolated as state transitions;
- repair/clear events can be cross-validated against method16;
- effect state must be parsed per subfamily rather than by one global struct.

Known controlled consumable/effect observations include:

```text
Tungsten Shells activation/state family -> current token/provision path used to define active windows
Adrenaline activation                    -> independently visible state transition
Repair Kit / First Aid / MPRP            -> distinct recovery behavior
```

Adrenaline does not modify the tested method36 targeting/config scalar set; its effect belongs to reload/gun-cycle behavior rather than the aiming-config snapshot.

---

# 17. Visibility / AoI

This is one of the most important single-POV boundaries.

Current lifecycle:

```text
entity visible/materialized
-> Type4
-> entity leaves recorder-observed AoI
-> no normal hidden-interval live updates
-> Type33 + Type5
-> entity materializes/re-enters observation
```

Therefore:

```text
Type4 == death   REJECTED
```

A hidden enemy may continue moving, firing, taking damage or dying outside the recorder's observed stream. Do not fabricate hidden-state interpolation as authoritative replay fact.

---

# 18. HP model

Priority for replay truth:

```text
live Type7 prop3 / verified live HP surfaces
> materialization current HP
> settlement initial/final facts for fallback/cross-check
> external Tankopedia base HP only as metadata/fallback, never authoritative actual battle HP
```

Why:

- equipment/provisions can modify actual battle HP;
- Tankopedia base HP is not actual replay HP;
- current replay exposes actual HP directly on several surfaces.

For visualization where initial HP is temporarily unknown but the vehicle is an allied alive participant at battle start, UI may reasonably display 100% until exact actual HP materializes; parser truth and presentation fallback should remain separate concepts.

---

# 19. Death-time reconstruction

Canonical original corpus:

```text
settled dead combatants          287
sub-second live terminal found   283
settlement-second fallback         4
```

So single recorder POV achieved:

```text
98.61% live sub-second closure
```

but **must not claim 100%**.

Preferred death authority:

1. explicit terminal/death state/event;
2. verified Type7 terminal sentinel / method1 terminal chain;
3. other live death-notification surfaces;
4. settlement-second fallback if the terminal event is outside observer coverage.

Do not require HP to become zero; drowning proves positive-HP terminal death.

---

# 20. Settlement / battle results

`battle_results.dat` is a pickle protocol-2 container whose useful payload includes an arena identifier and protobuf result bytes.

Settlement is authoritative for final battle facts and is essential as a cross-check for:

- shots fired;
- hits;
- damage;
- kills/deaths;
- team/winner outcome;
- player/vehicle result data;
- exact initial HP when exposed;
- death reason in supported result shapes.

It should not replace higher-resolution live replay telemetry when the latter exists.

## 20.1 Known unresolved settlement boundary

`field118` and the observed `baseType12` family correlate perfectly in presence within the current positive samples but the exact public statistic name was not uniquely closed. Earlier “base defended / dropped capture points” interpretations are `REJECTED/SUPERSEDED`.

Keep raw values/version provenance.

---

# 21. Clock surfaces

Current session-clock relationship:

```text
Type35 = low 8 bits of monotonic decisecond clock
Type36 = full-width monotonic decisecond anchor
```

This can be used to reconstruct a stable battle/session clock alongside the packet `rawClockSec` stream.

Packet raw clocks are useful for ordering/sub-second replay-local timing but should not be mistaken for perfect simulation timestamps for every networked effect.

---

# 22. Battle commands / tactical UI

A controlled replay with the radial battle-command UI produced an Avatar method47 `userChatCommand` action with a compact payload such as:

```text
(24, 0, 0, '', '')
```

Current safe conclusion:

```text
method47 participates in chat/action command transport
radial battle-command actions can travel through this family
```

The exact current UI-command enum for value `24` remains PARTIAL because the specific selected wedge was not independently labeled in that sample.

Do not confuse this surface with Avatar method46 tactical map marker/ping events.

---

# 23. Historical hit-flag architecture — useful but not authoritative

Historical Wargaming code exposes a `VEHICLE_HIT_FLAGS` family resembling:

```text
0x0001 VEHICLE_KILLED
0x0002 VEHICLE_WAS_DEAD_BEFORE_ATTACK
0x0004 FIRE_STARTED
0x0008 RICOCHET
0x0010 MATERIAL...PIERCED_BY_PROJECTILE
0x0020 MATERIAL...NOT_PIERCED_BY_PROJECTILE
0x0040 ARMOR_WITH_ZERO_DF_PIERCED_BY_PROJECTILE
0x0080 ARMOR_WITH_ZERO_DF_NOT_PIERCED_BY_PROJECTILE
0x0100 DEVICE_PIERCED_BY_PROJECTILE
...
```

The current Blitz 11.19 behavior is highly compatible with a descendant/reorganization of this architecture. Controlled current replay experiments independently recovered the low bits and explosion families.

Correct methodological use:

```text
current replay behavior -> semantic closure
historical schema        -> architecture cross-check
```

Incorrect use:

```text
historical numeric ordinal -> blindly assign current Blitz meaning
```

---

# 24. Explicitly rejected/superseded interpretations

Do not reintroduce these:

```text
Type4 == death                                            REJECTED
Type28 == target lock / auto aim                         REJECTED
41 == Radioman / 42 == Gunner                            SUPERSEDED
34/35 exact track side unresolved                        SUPERSEDED
baseType12 == base defended/dropped capture points       REJECTED
all method38 32 header bits are one hit enum              REJECTED
historical PC upper hit-flag ordinals are authoritative   REJECTED
method38 0x1000 is universal Gun-damage bit               REJECTED
Tankopedia base HP is replay actual HP source              REJECTED as primary source
single replay POV guarantees 100% sub-second death         REJECTED
method38 tail is one optional u32 extension                SUPERSEDED
Precision Fire and Tungsten are mutually exclusive         REJECTED
combined Precision Fire + Tungsten must be modifier 3      REJECTED current controlled sample
```

---

# 25. Production-safe data model

A parser should separate raw protocol from semantic interpretation.

Suggested conceptual model:

```text
ReplayPacket {
    type
    rawClockSec
    rawPayload
    decoded?
    clientVersion
}

VehicleState {
    entityId
    position
    hullOrientation
    turretYaw
    gunPitch
    currentHp
    terminalState
    visibleToRecorder
    components
    crew
}

ProjectileLaunch {
    shooterEntityId
    shotId
    launchPoint
    launchVelocity
    shellSelectionRaw?
    shellDescriptorRaw?
}

ShotResult {
    victimVehicleId
    resultFlagsRaw16
    headerHi16Raw
    componentResults[]
    specialModifierIds[]
}

ComponentResult {
    componentIdRaw
    semantic?
    rawState
    stateSemantic?
}

SpecialModifier {
    rawId
    semantic? // 1 Precision Fire, 2 Tungsten in current 11.19
}

DeathEvent {
    victim
    source
    rawCause
    semanticCause?
    terminalHp?
    evidenceSource
    precision
}
```

### 25.1 Preserve provenance

Every promoted semantic should ideally retain:

```text
clientVersion
raw packet/method/property ID
raw value/flags
confidence/evidence source
```

That makes future protocol migrations auditable instead of silently wrong.

---

# 26. Recommended event reconstruction order

A robust parser/reconstruction pipeline should roughly do:

```text
1. unzip replay
2. parse meta + client version
3. strict-frame data.wotreplay
4. materialize entity/class ownership
5. identify recorder/avatar/vehicle
6. decode Type7/Type8 envelopes
7. reconstruct Type10 + turret/gun geometry
8. reconstruct Type28/method17 ammunition state
9. reconstruct method29 -> method20 projectile lifecycle
10. join method38 outgoing results
11. apply component/rawState semantics
12. reconstruct Type32 effects/consumables/recovery
13. build HP timeline
14. build visibility/AoI timeline
15. build death timeline with terminal events first
16. parse settlement
17. cross-check shot/hit/death/result totals
18. expose unknown/raw/version-new fields instead of discarding them
```

---

# 27. AI Review / battle reconstruction usage

Current replay evidence is strong enough to feed AI Review with authoritative facts such as:

- exact observed recorder shot launch time;
- shell selection/descriptor family;
- projectile launch direction and velocity;
- hit/miss/ricochet/non-penetration/spaced-armor/explosion result branches;
- actual HP changes when observed;
- module/crew involvement and persistent damage state;
- Precision Fire / Tungsten modifiers;
- firing while gun damaged;
- recorder gun yaw/pitch at shot boundary;
- observed death causes including drowning;
- visibility/AoI boundaries;
- consumable activation and repair windows.

AI output must not invent information hidden outside the replay POV. Facts should be labeled as observed, reconstructed, fallback, or unknown.

---

# 28. Remaining bounded unknowns

These are legitimate future research targets, not reasons to distrust the current production-capable model:

```text
method38 bit 0x0200 current positive sample
component ID42 exact identity/private symbol
method36 remaining coefficient private names/units
method38 rawState0 exact private enum name
method16 sparse transition codes exact private symbols
settlement field118/baseType12 exact statistic name
Vehicle prop7/8/9 complete token namespaces
some method17 initialization/feed tail fields
unobserved deathReason/causeFlag values
observer-only / cosmetic / platform fields
exact current Wargaming protobuf/enum symbol names
cross-version numeric stability
```

The correct behavior is to preserve raw values and add evidence when new replays/versions appear.

---

# 29. Controlled-replay research methodology

The most successful breakthroughs came from changing one gameplay variable at a time.

Recommended principles:

1. one experiment per replay where possible;
2. keep target/vehicle/ammunition constant;
3. create positive and negative controls;
4. repeat probabilistic module-damage cases;
5. record exact gameplay intent alongside the replay;
6. correlate multiple independent protocol surfaces;
7. only promote to `PROVEN` when the behavior is diagnostic, not merely plausible.

Examples that worked:

```text
Drowning:
positive HP + explicit terminal cause -> causeFlag/deathReason 5

Ricochet:
repeated high-angle ricochets -> 0x0008

Spaced armor:
penetrated outer layer vs stopped multi-layer -> 0x0040 / 0x0080

HE:
direct pen / thick armor / track / mantlet / ground splash -> explosion high bits

Fuel Tank:
component33 damage -> codeA8 -> fire ticks

Tungsten + Precision Fire:
keep Tungsten active through fourth proc -> modifier list [1,2]

Vertical gun speed:
continuous saturated pitch movement -> Type39 derivative == method36.root.field4
```

---

# 30. How to extend this work for a new client version

Do **not** copy the 11.19 numeric map blindly.

For each new version:

```text
1. parse framing and verify stream integrity
2. inventory observed top-level types
3. verify recorder shot/hit counts against settlement
4. re-check entity-class method/property IDs
5. run a small controlled regression suite:
   - one normal AP penetration
   - one ricochet
   - one spaced-armor hit
   - one HE splash
   - one module damage + repair
   - ammunition switch
   - Precision Fire if available
   - Tungsten if available
   - drowning/environment death if practical
6. compare numeric IDs and payload lengths
7. only then widen the version gate
```

Recommended decoder contract:

```text
supportsExact(11.19 current schema)
fallsBackToRaw(unknown version/change)
never silently reinterpret unknown bytes
```

---

# 31. Current completion statement

For the observed Blitz 11.19 replay surface plus controlled probes, the research has reached the point where the major gameplay facts required by WotBTools are reconstructable without relying on unsafe guesses.

Current status:

```text
container/framing                           closed
recorder shot/hit consistency               closed
projectile lifecycle                        closed
actual HP                                   closed
visibility/AoI lifecycle                    closed with POV boundary
death timing                                production-usable with explicit fallback
death causes 0/1/2/3/5                     closed; remaining values raw
module/crew namespace                      closed except ID42
module damage lifecycle                    closed for major states
ammunition selection/descriptor            closed behavioral model
FV215b current shell mapping               closed controlled
method38 low16 gameplay flags              closed except 0x0200
method38 component/rawState model          production-usable
method38 special modifier list             closed
Precision Fire modifier 1                  closed controlled
Tungsten modifier 2                        closed controlled
combined modifier list [1,2]               closed controlled
method36 targeting family                  closed
method36 yaw/pitch                         closed
method36 horizontal angular-speed config   closed controlled
method36 vertical angular-speed config     closed controlled
settlement integration                     production-usable
```

The remaining work is primarily **exact private naming, low-frequency unseen values, and future-version validation**.

That is the correct boundary between reverse engineering and fabrication.

---

# 32. Focused evidence documents

This reference is the implementation-oriented consolidation. Detailed evidence, counterexamples, packet dumps and research history remain in the focused files in this directory, including:

```text
inventory.md
research-completion-audit-11.19.md
protocol.md
projectile-lifecycle.md
type28-ammunition-slot.md
avatar-method17-ammunition-state.md
avatar-shot-results.md
method38-current-hit-flag-reconstruction.md
method38-result-state-closure.md
method38-component-token-namespace.md
method38-component-hit-damage-roll.md
precision-fire-method38-extension.md
method16-device-crew-code-map.md
method16-damage-state-codeA.md
track-side-orientation-closure.md
fuel-tank-observation-device-closure.md
gun-damage-dispersion-closure.md
avatar-method36-targeting-info.md
method36-vertical-gun-speed-controlled-closure.md
type39-aim-camera.md
type39-f6-local-gun-pitch.md
actual-hp-type5-settlement.md
death-and-battle-clock.md
visibility-lifecycle.md
type32-entity-effects.md
consumable-lifecycle.md
battle-results.md
field118-basetype12-boundary.md
```

If a future controlled experiment supersedes a statement here, update both the focused closure and this complete reference in the same PR.
