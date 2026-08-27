# Blitz 11.19 replay documentation convergence audit

> Purpose: final PR147 contradiction audit after the Type10 movement, method38 `0x0200`, and method36 targeting closures.
>
> Scope: **current authoritative documentation and current focused closure documents**. Historical research notes may retain old hypotheses only when explicitly marked `SUPERSEDED` / `REJECTED` or clearly presented as historical context.

## Current authority set

Read order:

1. `WOTB_REPLAY_PROTOCOL_11_19_BILINGUAL_COMPLETE_REFERENCE.md`
2. focused current-version closure documents
3. `inventory.md`
4. `research-completion-audit-11.19.md`
5. older English complete reference and historical notes

`README.md` and the PR147 body declare this precedence.

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

The current directory was checked around at least:

```text
root.field3
root.field4
root.field5
field6.field1
PARTIAL
VERY STRONG PARTIAL
candidate
remaining targeting work
Reticle Calibration
```

The convergence rule is:

> **A proven physical role stays PROVEN even when the exact Wargaming private protobuf member name is UNKNOWN.**

Do not merge these two evidence questions into one `PARTIAL` label.

# method36 convergence

Current field map:

```text
root.field1
= turret/gun relative yaw
= PROVEN

root.field2
= gun pitch
= PROVEN

root.field3
= max horizontal turret/gun angular speed
= PROVEN controlled

root.field4
= max vertical gun angular speed
= PROVEN controlled

root.field5
= aiming-time physical scalar
= PROVEN

field6.field1
= dynamic gun dispersion / bloom scalar
= PROVEN physical role
```

Controlled/current-version evidence:

```text
root.field1 <-> Type39 f5                           current replay correlation
root.field2 <-> Type39 f6                           current replay correlation
root.field3 -> controlled horizontal angular limit  current physical closure
root.field4 -> controlled vertical angular limit    current physical closure
shot boundary -> field6.field1 positive bloom jump  326 / 326
Gun damage -> field6.field1 ×2                      exact reversible boundary
Gun damage -> root.field4 ×0.675                    exact reversible boundary
Reticle Calibration -> root.field5 ×0.70            exact reversible boundary
Reticle Calibration -> field6.field1 ×0.70          exact reversible boundary
Reticle end -> exact baseline restoration           current replay boundary
```

### Allowed remaining uncertainty

The following are still valid:

```text
exact private protobuf symbol                          UNKNOWN
root.field5 exact display/UI conversion formula        UNKNOWN/PARTIAL
field6.field1 exact display/UI unit/formula            UNKNOWN/PARTIAL
field6.field2 exact physical role/private symbol       PARTIAL
remaining static/nested coefficients                   PARTIAL
cross-version numeric/schema stability                 UNKNOWN until regression-tested
```

These are private naming/display/static-coefficient boundaries. They do not reopen the six high-value physical roles above.

### Focused-doc convergence performed

The final method36 pass synchronizes the current focused documents so they no longer present closed roles as current candidates or `VERY STRONG PARTIAL`:

```text
avatar-method36-targeting-crosswalk.md
avatar-method36-targeting-info.md
controlled-wz120-movement-dispersion-probe.md
method36-horizontal-vertical-rotation-speed-closure.md
method36-vertical-gun-speed-controlled-closure.md
gun-damage-dispersion-closure.md
reticle-calibration-method36-closure.md
```

Historical statements may still appear when explicitly described as the state of evidence at the time of that experiment or as `SUPERSEDED`/`REJECTED`; they are not current semantic claims.

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

Controlled airborne evidence rejects `trailingStateRaw == onGround`. `positionError` is not velocity.

# method38 convergence

Current `resultFlags16` map includes:

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

Current modifier tail:

```text
modifierCount u8
repeat modifierCount:
    modifierId u32 LE

modifierId=1 -> Precision Fire   PROVEN controlled
modifierId=2 -> Tungsten Shells  PROVEN controlled
same-hit [1,2]                   PROVEN controlled
```

# HP / death convergence

```text
Type4 = leaves recorder-observed AoI                 PROVEN
Type4 == death                                       REJECTED
Tankopedia base HP == replay actual HP               REJECTED as primary source
causeFlag=5 = DROWNING                               PROVEN controlled
deathReason=5 = DROWNING                             PROVEN controlled
positive-HP terminal death exists                    PROVEN controlled
single POV guarantees 100% sub-second death          REJECTED
```

# Historical wording policy

The following may exist only in historical notes, experiment-at-the-time descriptions, or explicitly rejected/superseded sections:

```text
root.field3 current role is only PARTIAL/candidate
root.field4 current role is only PARTIAL/candidate
root.field5 current role is unresolved/candidate
field6.field1 current role is VERY STRONG PARTIAL/candidate
method36 high-value coefficients are entirely unmapped
0x0200 unobserved / UNKNOWN
Type10 trailing byte = onGround
method38 has one optional extension
Type4 means death
P1 > 0
```

They must not be presented as current authoritative truth.

# Final convergence verdict

Current authority and the synchronized focused method36 docs agree on:

```text
P0 = 0
P1 = 0
method36 six high-value physical roles = CLOSED
method36 exact private symbols = UNKNOWN where unrecovered
method36 remaining static coefficients = PARTIAL
method38 0x0200 = PROVEN controlled
Type10 movement P1 = CLOSED
```

```text
AUTHORITATIVE DOCUMENT CONTRADICTION BLOCKERS: 0
METHOD36 DOCUMENTATION CONVERGENCE BLOCKERS: 0
DOCUMENTATION CONVERGENCE STATUS: PASS
CORE PROTOCOL RESEARCH STATUS: COMPLETE FOR CURRENT 11.19 P0/P1 SCOPE
```
