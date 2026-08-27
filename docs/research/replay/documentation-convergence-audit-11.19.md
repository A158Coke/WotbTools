# Blitz 11.19 replay documentation convergence audit

> Purpose: final PR147 contradiction audit after the Type10 movement, airborne counterexample, method36 targeting, and method38 `0x0200` controlled closures.
>
> Scope: **current authoritative documentation**. Historical research notes may retain old hypotheses only when explicitly marked `SUPERSEDED` / `REJECTED` or clearly presented as historical context.

## Current authority set

The current read order is:

1. `WOTB_REPLAY_PROTOCOL_11_19_BILINGUAL_COMPLETE_REFERENCE.md`
2. focused current-version closure documents
3. `inventory.md`
4. `research-completion-audit-11.19.md`
5. older English complete reference and historical notes

`README.md` and the PR147 body both declare this precedence.

The older `WOTB_REPLAY_PROTOCOL_11_19_COMPLETE_REFERENCE.md` remains useful research history but is no longer the highest-precedence authority when a newer controlled closure exists.

## Current research gate

```text
P0 replay-protocol blockers = 0
P1 replay-protocol blockers = 0
```

Key gate closures:

```text
Type10 movement / physical-unit semantics      CLOSED
Type10 vertical/airborne movement              CLOSED
Type10 trailing byte == onGround               REJECTED controlled
method36 high-value targeting roles            CLOSED
method38 0x0200 current positive sample        CLOSED
```

## Audit terms

Current authority was converged specifically around:

```text
Type10
onGround
trailingStateRaw
positionError
world unit
meter
km/h
airborne
0x0008
0x0040
0x0080
0x0100
0x0200
0x0400
0x0800
0x1000
0x2000
0x4000
0x8000
modifierCount
modifierId
Precision Fire
Tungsten
Type4 == death
Tankopedia base HP
causeFlag=5
deathReason=5
method36 root.field3
method36 root.field4
method36 root.field5
method36 field6.field1
P0
P1
```

# Type10 convergence

Current fixed 49-byte structure:

```text
0x00 entityId
0x04 spaceId
0x08 attachment/parent entity ID
0x0C position x,y,z
0x18 position/filter-error x,y,z
0x24 hull yaw,pitch,roll
0x30 trailingStateRaw
```

Current controlled facts:

```text
1 Type10 position unit ~= 1 meter        PROVEN controlled
speed = delta(position) / delta(time)    PROVEN derived
speedKmh = speedMps * 3.6                PROVEN controlled-derived
vertical airborne trajectory             PROVEN controlled
```

Controlled Kanonenjagdpanzer 105 speed plateaus independently match 57 km/h forward and 20 km/h reverse.

Controlled Rhm airborne replay produces a ballistic Type10-Y trajectory while the recorder Type10 trailing byte remains `1` for `369/369` samples.

Therefore:

```text
Type10 trailing byte == onGround    REJECTED controlled
Type10 trailing byte exact meaning  UNKNOWN / raw-preserve
```

Current authority must use a neutral field name such as `trailingStateRaw`, not `onGroundRaw`.

`positionError` is a filter/error vector and is not velocity.

# method38 low16 convergence

Current map:

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

## `0x0200` current positive sample

Controlled Quby -> Maus replay:

```text
phase 1: Gun/barrel, 15 projectiles
phase 2: Fuel Tank, 15 projectiles
method29/method38 same-clock pairs = 30/30
```

Critical Gun/barrel result:

```text
0x0240 = 0x0200 | 0x0040
```

Same phase also contains:

```text
0x0100 + component36 + rawState0
```

Fuel Tank control repeatedly contains:

```text
0x0110 = 0x0010 | 0x0100
component33 rawState0/1
```

Therefore `0x0200` must no longer be listed as UNKNOWN/unobserved/P1 in current authority.

Safe physical label:

```text
PROJECTILE_DEVICE_NOT_PIERCED
```

Historical `DEVICE_NOT_PIERCED_BY_PROJECTILE` naming is corroborative only.

# method38 modifier convergence

Current wire tail:

```text
modifierCount u8
repeat modifierCount:
    modifierId u32 LE
```

```text
modifierId=1 -> Precision Fire   PROVEN controlled
modifierId=2 -> Tungsten Shells  PROVEN controlled
```

Combined controlled sample includes `[1,2]` on the same hit.

Therefore current authority must not describe method38 as a single nullable extension or Precision Fire/Tungsten as mutually exclusive.

# method36 convergence

Current high-value closed fields:

```text
root.field1 = turret/gun relative yaw               PROVEN
root.field2 = gun pitch                             PROVEN
root.field3 = max horizontal angular speed          PROVEN controlled
root.field4 = max vertical angular speed            PROVEN controlled
root.field5 = aiming-time physical scalar           PROVEN
field6.field1 = dynamic gun dispersion/bloom        PROVEN
```

Controlled perturbations include:

```text
Gun damage          -> field6.field1 ×2; root.field4 ×0.675
Repair              -> exact baseline restoration
Reticle Calibration -> root.field5 ×0.70; field6.field1 ×0.70
Reticle end          -> exact baseline restoration
```

Remaining static/nested method36 coefficients are P2/private-name work, not P1 blockers.

# HP / death convergence

Current facts:

```text
Type4 = leaves recorder-observed AoI                 PROVEN
Type4 == death                                       REJECTED
Tankopedia base HP == replay actual HP               REJECTED as primary source
causeFlag=5 = DROWNING                               PROVEN controlled
deathReason=5 = DROWNING                             PROVEN controlled
positive-HP terminal death exists                    PROVEN controlled
single POV guarantees 100% sub-second death          REJECTED
```

# Current main implementation boundary

The current `main` implementation intentionally lags some research closures. This is not a documentation contradiction when clearly labeled as implementation debt.

Known convergence work includes:

```text
Type10 parser: expose positionError + neutral trailingStateRaw
remove stale onGround/is_error semantic assumptions
avoid treating legacy Type8 raw direct-damage value as universal exact HP delta
consume Type4 as AoI/lifecycle evidence, not deterministic death
version-gate current 11.19 numeric mappings
expose additional method38/method36 facts only with evidence metadata
```

# Historical wording policy

The following may exist only in historical notes or explicitly rejected/superseded sections:

```text
0x0200 unobserved / UNKNOWN
Type10 trailing byte = onGround
Type10 positionError = velocity
method38 has one optional extension
Precision Fire and Tungsten are mutually exclusive
Type4 means death
Tankopedia base HP is authoritative battle HP
method36 high-value coefficients are entirely unmapped
P1 > 0
```

They must not be presented as current authoritative truth.

# Final convergence verdict

Current top-level authority, README, inventory, completion audit and PR body agree on:

```text
P0 = 0
P1 = 0
Type10 onGround hypothesis = REJECTED
Type10 movement P1 = CLOSED
method38 0x0200 = PROVEN controlled
method36 high-value semantics = CLOSED
```

Older research files are intentionally subordinate and may preserve historical hypotheses with provenance.

```text
AUTHORITATIVE DOCUMENT CONTRADICTION BLOCKERS: 0
DOCUMENTATION CONVERGENCE STATUS: PASS
CORE PROTOCOL RESEARCH STATUS: COMPLETE FOR CURRENT 11.19 P0/P1 SCOPE
```
