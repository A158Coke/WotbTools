# Blitz 11.19 China replay research — completion audit

> Base canonical corpus: 34 unique arenas / 476 settled player results.
>
> Scope: PR147 protocol-research archive plus the subsequent controlled 11.19 probes recorded specifically to close low-frequency/current-behavior boundaries.
>
> This audit judges whether the currently observed 11.19 surfaces are sufficiently closed for production use. It does not claim recovery of every private Wargaming source symbol.

## Executive verdict

**Research blockers: 0. Documentation-convergence blockers: 0 after this revision.**

The current 11.19 replay model is **RESEARCH-COMPLETE / PRODUCTION-USABLE for observed surfaces**, subject to explicit version gating, raw preservation, and single-POV information boundaries.

This verdict means:

1. all observed container/packet/property/method/wrapper/settlement surfaces are inventoried or structurally bounded;
2. business/combat-critical surfaces have a PROVEN role or an explicit bounded UNKNOWN/PARTIAL boundary;
3. controlled probes have replaced several earlier correlation-only hypotheses;
4. stale interpretations are moved to REJECTED/SUPERSEDED history rather than described as current production facts;
5. unknown values remain raw-preserved;
6. remaining work requires genuinely new evidence, exact private schema/string recovery, or future-version regression.

## Canonical consistency gates

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

The old 341-shot Type28 aggregate is `SUPERSEDED`.

## Controlled probes added after the base corpus

The following are no longer “remaining work”; they are completed evidence acquisitions:

- drowning / positive-HP terminal death;
- FV215b repeated ammunition switching;
- Tungsten-only controlled damage windows;
- Precision Fire controlled proc evidence;
- simultaneous Precision Fire + Tungsten on one hit;
- WZ-120 movement/targeting phase isolation;
- Maus Fuel Tank / Observation Device direct positive samples;
- TVP ricochet / spaced-armor / mantlet cases;
- WZ-120 HE direct-pen / thick-armor / track / spaced/mantlet / ground-splash matrix;
- vertical gun-pitch saturation for method36 `root.field4`.

## HP / damage / death closure

Current production-safe facts:

- Type5 materialization actual current HP — PROVEN relationship;
- Avatar method5 recorder opening actual HP — PROVEN;
- Vehicle prop3 current HP / terminal sentinel family — PROVEN;
- settlement initial/final HP cross-check — production-usable;
- Vehicle method1 source-attributed HP-loss family — PROVEN;
- Tankopedia base HP as replay actual HP source — `REJECTED`.

Vehicle method1 cause map:

```text
0 direct/default combat damage     PROVEN
1 fire                             PROVEN
2 ramming                          PROVEN
3 world/self-environment impact    PROVEN
4 UNKNOWN                          preserve raw
5 drowning                         PROVEN controlled
```

Controlled drowning additionally closes:

```text
wrapper6 / settlement deathReason=5 -> DROWNING
vehicle can terminate at positive HP
```

Therefore `dead == HP<=0` is `REJECTED` as a universal rule. Terminal/death state is authoritative.

Single-POV death precision remains honestly bounded at 98.61% live sub-second closure in the base corpus; four deaths require settlement-second fallback.

## Component namespace / lifecycle closure

Current component namespace:

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

Current method16 lifecycle:

```text
mechanical codeA4  -> damaged/degraded operational        PROVEN
mechanical codeA5  -> critical/disabled                   PROVEN
mechanical codeA18 -> automatic critical self-repair      PROVEN physical role
mechanical codeA19 -> full repair/clear                   PROVEN
crew codeA10       -> injured/shell-shocked               PROVEN
crew codeA22       -> healed/clear                        PROVEN
```

Controlled Maus closure:

```text
codeB33 = Fuel Tank
codeA8 with codeB33 = ignition/fire-start transition family
codeB38 = Observation Device
```

Exact private symbol for `codeA8` remains unresolved; physical behavior is closed for the controlled Fuel Tank context.

## method38 current wire structure — CLOSED

The earlier model:

```text
tail + optional single extension
```

is `SUPERSEDED`.

Current controlled wire structure:

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

The modifier tail is therefore a repeatable list, not a mutually exclusive single enum.

## method38 low-16 hit-flag closure

Current behaviorally reconstructed map:

```text
0x0001 direct terminal shell kill                                      PROVEN
0x0002 target already dead before attack                               PROVEN sample / low-N
0x0004 fire started                                                     PROVEN
0x0008 ricochet                                                         PROVEN controlled
0x0010 positive material/vehicle penetration by projectile              PROVEN
0x0020 projectile non-penetration / material stop                       PROVEN controlled
0x0040 zero-DF / spaced-armor layer pierced by projectile               PROVEN controlled
0x0080 zero-DF / spaced-armor layer not pierced                         PROVEN controlled
0x0100 internal component/device pierced/involved by projectile         PROVEN relationship
0x0200 no current positive sample                                       UNKNOWN / preserve raw
0x0400 chassis/track damaged by projectile                              PROVEN
0x0800 Gun damaged by projectile                                        PROVEN current samples / low-N
0x1000 positive-DF material resolved/penetrated by explosion             PROVEN controlled
0x2000 zero-DF/spaced armor resolved/penetrated by explosion             PROVEN controlled sample / low-N
0x4000 internal component/device involved by explosion                   PROVEN controlled
0x8000 internal component/device damaged by explosion                    PROVEN controlled
```

### Controlled flag evidence now completed

TVP probe:

```text
repeated ricochet: 0x0028 = 0x0020 | 0x0008
spaced-armor penetration: 0x0050 = 0x0010 | 0x0040
mantlet/multi-layer stop: 0x00C0 = 0x0040 | 0x0080
```

WZ-120 HE probe:

```text
direct HE pen          0xD010 = 0x8000|0x4000|0x1000|0x0010
thick armor no-pen     0x0020
track hit              0x1500 = 0x1000|0x0400|0x0100
spaced/mantlet HE      0x6080 = 0x4000|0x2000|0x0080
ground splash          0xD000 = 0x8000|0x4000|0x1000
ground no effect       0x0000
```

The pure splash case proves the high family is explosion-resolution state independent of projectile-penetration bits.

## method38 component result state

```text
rawState0 -> component hit/involved; no newly observed persistent negative state
             VERY STRONG physical role / exact private enum unknown
rawState1 -> module damaged / crew injured     PROVEN
rawState2 -> critical / disabled               PROVEN
```

Module hit is not equivalent to module damage.

## method38 special modifier list — CLOSED

Current controlled semantics:

```text
modifierId=1 -> Precision Fire proc    PROVEN
modifierId=2 -> Tungsten Shells        PROVEN
```

Dedicated simultaneous-proc sample:

```text
shot1 [2]
shot2 [2]
shot3 [2]
shot4 [1,2]
```

This closes all of the following:

```text
modifier list repeatability                  PROVEN
Precision Fire + Tungsten coexistence        PROVEN
Precision Fire overwrites Tungsten           REJECTED
Tungsten overwrites Precision Fire           REJECTED
combined state is modifier 3                 REJECTED current controlled sample
single-extension current model               SUPERSEDED
```

The exact private enum symbol names may still differ from user-facing names, but the current gameplay semantics and list structure are production-closed.

## Ammunition selection closure

Type28 = recorder ammunition-selection state — PROVEN.

Safe production chain:

```text
Type28 selectionValue
-> method17 shellDescriptor
-> version-matched shell catalog
```

FV215b controlled repeated switching closes the current mapping:

```text
0 -> 0x003C5A0A -> AP
1 -> 0x00465A0A -> APCR
2 -> 0x003B5A0A -> HESH / HE-family
```

This remains vehicle/version scoped rather than a global wire-slot rule.

## Projectile / targeting / visibility closure

PROVEN/high-confidence production surfaces include:

- method29 launch + shotId + launch geometry/velocity;
- method20 terminal endpoint;
- method27 terminal/explosion family;
- Type31 aiming-circle size;
- Type39 high-rate gun/aim geometry;
- method36 PRE -> launch -> POST snapshots;
- Type10 transforms;
- Vehicle method8 target-local hit geometry;
- Type4 -> hidden AoI -> Type33/Type5 re-entry lifecycle.

`Type4 == death` remains explicitly `REJECTED`.

### method36 closed fields

```text
root.field1 = recorder turret/gun relative yaw              PROVEN
root.field2 = recorder gun pitch                            PROVEN
root.field3 = max horizontal turret/gun angular speed       PROVEN controlled, rad/s
root.field4 = max vertical gun angular speed                PROVEN controlled, rad/s
```

The vertical controlled test matches the Type39 pitch derivative to method36 `root.field4` within ~0.000064% on the clean long segment.

`field6.field1` is a dispersion/accuracy-family scalar: every recorder shot raises it and Gun damage makes it exactly ×2 until repaired. Exact private symbol/unit remains bounded.

## Settlement / assistance closure

Known settlement-facing facts include:

```text
method12 baseType15 / settlement field119 = Destruction Assistance count PROVEN
settlement field120 = Gun Marks count PROVEN
wrapper6.field3 = >50% prior-damage secondary kill-notification assister PROVEN
```

`field118 / method12 baseType12` remains a **closed UNKNOWN boundary**. Old base-defense/dropped-capture semantics are `REJECTED`.

## Genuine remaining boundaries — not blockers

Only genuinely unresolved work remains here:

### Current semantic/private-symbol boundaries

- method38 `0x0200` positive sample / exact current role;
- method38 rawState0 exact private enum name;
- component ID42 exact identity/private symbol;
- method16 sparse transition-code exact private symbols;
- method36 remaining coefficient private names/units;
- settlement field118/baseType12 exact statistic name;
- complete Vehicle prop7/8/9 token namespaces;
- some method17 initialization/feed-tail fields;
- unobserved deathReason/causeFlag values.

### Lower-value / structural / future-version boundaries

- observer-only/cosmetic/platform state exact names;
- exact current private protobuf/enum symbols where gameplay semantics are already closed;
- cross-version numeric stability and future client regression.

Completed controlled probes are intentionally **not** listed as remaining work.

## Stale/rejected interpretations that must never return as current facts

```text
Type4 == death                                             REJECTED
Type28 == target lock / auto aim                          REJECTED
41 == Radioman / 42 == Gunner                             SUPERSEDED
34/35 exact side unresolved                               SUPERSEDED
baseType12 == base defended / dropped capture points      REJECTED
all method38 32 header bits == one homogeneous hit enum   REJECTED
historical PC upper hit-flag ordinals == current Blitz    REJECTED
method38 0x1000 == universal Gun-damage bit               REJECTED
Tankopedia base HP == replay actual HP source             REJECTED as primary source
one replay POV guarantees 100% sub-second death           REJECTED
method38 tail == one optional u32 extension               SUPERSEDED
extension=1/2 single-extension current model              SUPERSEDED
Precision Fire/Tungsten mutually exclusive                REJECTED
combined Precision Fire+Tungsten == modifier3             REJECTED current sample
```

Historical research notes may retain these hypotheses only when clearly marked as historical / SUPERSEDED / REJECTED.

## Production gate

Production consumers may use:

```text
PROVEN current-version facts
or explicitly approved PARTIAL facts carrying confidence/version metadata
```

UNKNOWN values must preserve raw provenance and must not silently become deterministic user-facing claims.

## Final audit status

```text
Observed-surface inventory blockers       0
Canonical-count contradiction blockers   0
Business-critical semantic blockers      0
Documentation-convergence blockers       0
Single-POV information boundaries        documented
Exact private-symbol boundaries           documented / non-blocking

CURRENT 11.19 STATUS: RESEARCH-COMPLETE / PRODUCTION-USABLE
```

Future work is new evidence acquisition or version regression, not unfinished interpretation of the already-controlled cases.
