# Replay protocol inventory — Blitz 11.19 China canonical ledger

> Base corpus: 34 unique arenas / 476 settled player results. Multi-POV duplicates are cross-validation only.
>
> Additional evidence: controlled 11.19 replays for drowning, ammunition switching, Precision Fire/Tungsten, module damage, ricochet/spaced armor/mantlet, HE resolution, movement/targeting and gun-pitch speed.
>
> Status: **RESEARCH-COMPLETE / PRODUCTION-USABLE for the observed 11.19 surfaces**. Numeric packet/property/method/component IDs remain version- and entity-class-scoped.
>
> `WOTB_REPLAY_PROTOCOL_11_19_COMPLETE_REFERENCE.md` is the implementation-oriented top-level reference. This file is the synchronized fact ledger.

## Evidence grades

- `PROVEN`: current replay behavior closes the physical/semantic role for the stated scope.
- `VERY STRONG PARTIAL`: behavior is strongly constrained but an exact private symbol or broad low-N validation remains.
- `PARTIAL`: structure/family known; exact naming/unit/rule incomplete.
- `UNKNOWN`: raw value observed/preserved; semantics unresolved.
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

Correct recorder-shot totals:

```text
A178_SPHT       222
GB13_FV215b      32
J20_Ho_Ri_type3  17
Maus             49
VK 72.01          4
TOTAL            324
```

The old 341-shot Type28 aggregate is `SUPERSEDED`.

# Container / framing

`.wotbreplay` is a ZIP container with `meta.json`, `data.wotreplay`, `battle_results.dat`.

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

Rules: dynamic stream offset; zero-length payloads legal; strict contiguous framing; preserve unknown raw bytes; `0xFFFFFFFF` is the current deterministic terminator.

# High-value top-level types

| Type | Current semantic | Verdict |
|---:|---|---|
| 4 | entity leaves recorder-observed AoI; **not death** | PROVEN |
| 5 | materialization/re-entry + transform/state/loadout/current HP | PROVEN relationship |
| 7 | EntityProperty | PROVEN envelope |
| 8 | EntityMethod | PROVEN envelope |
| 10 | vehicle transform | PROVEN |
| 13 | in-stream settlement/result family | PROVEN family |
| 23 | recorder shot/projectile lifecycle toggle | PROVEN |
| 26 | incoming hostile-shell warning | PROVEN family |
| 28 | recorder ammunition-selection state | PROVEN |
| 31 | recorded aiming-circle/gun-marker size | PROVEN |
| 32 | auxiliary effect/state transport | PROVEN envelope |
| 33 | pre-materialization packet paired with Type5 | PROVEN relationship |
| 35 | low 8 bits of monotonic decisecond clock | PROVEN |
| 36 | full-width monotonic decisecond anchor | PROVEN |
| 39 | high-rate aim/camera/gun geometry | PROVEN family |

# HP / death

Vehicle Type7 prop3:

```text
positive i16 -> actual current HP          PROVEN
0x0000       -> HP-zero terminal           PROVEN
0xFFFD       -> death terminal sentinel    PROVEN current corpus
0xFFFE       -> terminal on verified chain PROVEN sample / version-gated
0xFFFF       -> UNKNOWN; preserve raw
```

Vehicle method1:

```text
currentHpRaw u16
sourceEntity u32
causeFlag    u8
```

Current cause map:

```text
0 direct/default combat damage    PROVEN
1 fire                            PROVEN
2 ramming                         PROVEN
3 world/self-environment impact   PROVEN
4 UNKNOWN                         preserve raw
5 drowning                        PROVEN controlled
```

Controlled drowning closes both live and settlement semantics:

```text
causeFlag=5   -> DROWNING
wrapper6 / settlement deathReason=5 -> DROWNING
terminal HP can remain positive
```

Therefore **death != HP<=0 universally**. Terminal/death state is authoritative.

Death-time coverage in the original corpus remains 283/287 sub-second live closures (98.61%), with four settlement-second fallbacks caused by single-POV/AoI limits.

Tankopedia base HP is `REJECTED` as the primary replay HP source; actual replay HP surfaces are authoritative.

# Component namespace

```text
31 Engine              PROVEN
32 Ammo Rack           PROVEN
33 Fuel Tank           PROVEN direct controlled
34 Right Track         PROVEN
35 Left Track          PROVEN
36 Gun                 PROVEN
37 Turret Rotator      PROVEN version-scoped
38 Observation Device  PROVEN direct controlled
39 Commander           PROVEN
40 Driver              PROVEN
41 Gunner              PROVEN
42 UNKNOWN/unobserved  preserve raw
43 Loader              PROVEN
```

34/35 orientation is closed from Vehicle method8 target-local geometry, not historical ordinal order.

method16 lifecycle:

```text
4  damaged/degraded operational          PROVEN
5  critical/disabled                     PROVEN
18 automatic critical self-repair        PROVEN physical role
19 full repair/clear                      PROVEN
10 crew injured/shell-shocked            PROVEN
22 crew healed/clear                      PROVEN
```

Controlled Maus module probe additionally closes:

```text
codeB=33 = Fuel Tank
codeA=8 with codeB=33 -> ignition/fire-start transition family
codeB=38 = Observation Device
```

# Projectile / ammunition lifecycle

High-value current chain:

```text
Vehicle method0 firing
-> Avatar method29 launch + shooter + shotId + launch geometry/velocity
-> Avatar method20 shotId + terminal endpoint
-> method38 outgoing result and/or method27 terminal/explosion branch
```

Type28 = recorder ammunition-selection state — PROVEN.

Safe production chain:

```text
Type28 selectionValue
-> Avatar method17 shellDescriptor
-> version-matched shell catalog
-> display ammunition
```

FV215b controlled mapping for 11.19:

```text
Type28=0 -> 0x003C5A0A -> AP
Type28=1 -> 0x00465A0A -> APCR
Type28=2 -> 0x003B5A0A -> HESH / HE-family
```

Do not promote this vehicle-specific mapping into a global wire-slot rule.

# Avatar method38 — current wire structure

The old `tail + optional single extension` model is `SUPERSEDED`.

Current controlled wire model:

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

`headerHi16Raw` is a separate header/state surface; treating all 32 header bits as one homogeneous hit enum is `REJECTED`.

## method38 low-16 resultFlags16

| Bit | Current physical role | Verdict |
|---:|---|---|
| `0x0001` | direct terminal shell kill | PROVEN |
| `0x0002` | target already dead before attack | PROVEN sample / low-N |
| `0x0004` | fire started | PROVEN |
| `0x0008` | ricochet | **PROVEN controlled** |
| `0x0010` | positive material/vehicle penetration by projectile | PROVEN |
| `0x0020` | projectile non-penetration / material stop | **PROVEN controlled** |
| `0x0040` | zero-DF / spaced-armor layer pierced by projectile | **PROVEN controlled** |
| `0x0080` | zero-DF / spaced-armor layer not pierced | **PROVEN controlled** |
| `0x0100` | internal component/device pierced or involved by projectile | PROVEN relationship |
| `0x0200` | no current positive sample | **UNKNOWN / preserve raw** |
| `0x0400` | chassis/track damaged by projectile | PROVEN |
| `0x0800` | Gun damaged by projectile | PROVEN current samples / low-N |
| `0x1000` | positive-DF material resolved/penetrated by explosion | **PROVEN controlled** |
| `0x2000` | zero-DF/spaced armor resolved/penetrated by explosion | **PROVEN controlled sample / low-N** |
| `0x4000` | internal component/device involved by explosion | **PROVEN controlled** |
| `0x8000` | internal component/device damaged by explosion | **PROVEN controlled** |

Controlled evidence includes repeated TVP ricochet/spaced-armor/mantlet cases and the WZ-120 HE direct-pen / thick-armor / track / mantlet / ground-splash matrix.

The pure HE splash case carries `0x1000|0x4000|0x8000` without projectile-penetration bits, independently closing these as explosion-resolution surfaces.

## method38 component result state

```text
rawState=0 -> component hit/involved, no newly observed persistent negative state
              VERY STRONG physical role; exact private enum unknown
rawState=1 -> module damaged / crew injured            PROVEN
rawState=2 -> module critical/disabled                  PROVEN
```

Module hit and module damage are distinct; multiple intersected components can resolve damage probability independently.

# method38 special modifier list

The old “optional extension=1/2” current model is `SUPERSEDED`.

Current semantics:

```text
modifierId=1 -> Precision Fire proc   PROVEN controlled
modifierId=2 -> Tungsten Shells       PROVEN controlled
```

Controlled simultaneous-proc replay:

```text
shot1 -> modifierCount=1, modifiers=[2]
shot2 -> modifierCount=1, modifiers=[2]
shot3 -> modifierCount=1, modifiers=[2]
shot4 -> modifierCount=2, modifiers=[1,2]
```

Therefore:

```text
modifier list is repeatable                    PROVEN
Precision Fire + Tungsten coexistence [1,2]   PROVEN
Precision Fire overwrites Tungsten             REJECTED
Tungsten overwrites Precision Fire             REJECTED
combined state == modifier 3                   REJECTED current controlled sample
single optional-extension model                SUPERSEDED
```

Unknown future modifier IDs must remain raw and version-gated.

# Targeting / gun state

Type31 = recorded aiming-circle size — PROVEN; not penetration probability.

Type39 is high-rate aim/camera/gun geometry. Current physical relationships include turret/gun-relative yaw and local gun pitch.

Avatar method36 is a recorder targeting/config/snapshot protobuf. Every recorder launch is bracketed by:

```text
method36 PRE -> method29 launch -> method36 POST
```

Closed method36 fields:

```text
root.field1 = recorder turret/gun relative yaw               PROVEN
root.field2 = recorder gun pitch                             PROVEN
root.field3 = maximum horizontal turret/gun angular speed    PROVEN controlled, rad/s
root.field4 = maximum vertical gun angular speed             PROVEN controlled, rad/s
```

Controlled vertical test closes `root.field4`: measured Type39 gun-pitch derivative matches `0.4995197769 rad/s` within ~0.000064% on the clean long segment.

`field6.field1` is a dispersion/accuracy-family scalar: it rises at every shot boundary and becomes exactly ×2 while Gun is damaged, restoring after Repair Kit. Exact private symbol remains unresolved.

# Visibility / AoI

```text
visible/materialized
-> Type4 leaves recorder-observed AoI
-> hidden interval
-> Type33 + Type5 re-entry/materialization
```

`Type4 == death` is **REJECTED**. Never fabricate hidden-state truth as omniscient replay data.

# Settlement / assistance

`battle_results.dat` is the final-result authority and cross-check surface for shots, hits, damage, kills/deaths, team outcome and supported death reasons.

Known closures include:

```text
method12 baseType15 / settlement field119 -> Destruction Assistance count PROVEN
settlement field120 -> Gun Marks count PROVEN
wrapper6.field3 -> >50% prior-damage secondary kill-notification assister PROVEN
```

`field118 / method12 baseType12` remains a **closed UNKNOWN boundary**. Old “base defended / dropped capture points” semantics are `REJECTED`.

# Explicitly superseded / rejected current interpretations

```text
Type4 == death                                             REJECTED
Type28 == target lock / auto aim                          REJECTED
41 == Radioman / 42 == Gunner                             SUPERSEDED
34/35 side unresolved                                     SUPERSEDED
baseType12 == base defended / dropped capture points      REJECTED
all method38 32 header bits == one homogeneous hit enum   REJECTED
historical PC upper hit-flag ordinals == current Blitz    REJECTED
method38 0x1000 == universal Gun-damage bit               REJECTED
Tankopedia base HP == replay actual HP source             REJECTED as primary source
single replay POV guarantees 100% sub-second death        REJECTED
method38 tail == one optional u32 extension               SUPERSEDED
extension=1/2 is the current single-extension model       SUPERSEDED
Precision Fire and Tungsten are mutually exclusive        REJECTED
combined Precision Fire + Tungsten == modifier 3          REJECTED
```

# Remaining bounded unknowns

These are the genuine remaining research boundaries:

- method38 `0x0200` current positive sample / exact role;
- component ID42 exact identity/private symbol;
- method38 rawState0 exact private enum name;
- method16 sparse transition-code exact private symbols;
- method36 remaining coefficient private names/units;
- settlement field118/baseType12 exact statistic name;
- complete Vehicle prop7/8/9 token namespaces;
- some method17 initialization/feed-tail fields;
- unobserved deathReason/causeFlag values;
- observer/cosmetic/platform-only surfaces;
- exact current private protobuf/enum symbols;
- cross-version numeric stability.

# Production gate

Production consumers may use PROVEN current-version facts directly and explicitly approved PARTIAL facts only with confidence/version metadata. Unknown values must preserve raw provenance.

```text
observed-surface blockers                 0
canonical-count contradiction blockers   0
business-critical semantic blockers      0
production-code scope violations          0

STATUS: RESEARCH-COMPLETE / PRODUCTION-USABLE FOR 11.19 OBSERVED SURFACES
```
