# Blitz 11.19 China replay research — completion audit

> Canonical corpus: 34 unique arenas / 476 settled player results.
>
> Scope: PR147 protocol-research archive only. This audit judges whether the **current observed corpus** is research-complete under the archive's own evidence rules. It does not claim that every private Blitz symbol or future-version enum has been recovered.

## Executive verdict

**Current-corpus research blockers: 0.**

The Blitz 11.19 China canonical corpus is now **RESEARCH-COMPLETE for observed surfaces**, subject to version gating and the explicit information/sample boundaries below.

This verdict means:

1. every observed top-level packet/property/method/wrapper/settlement surface is inventoried;
2. business/combat-relevant surfaces have either a proven semantic role or an explicitly bounded PARTIAL/UNKNOWN role;
3. disproved hypotheses are marked REJECTED/SUPERSEDED;
4. unresolved raw values remain preserved;
5. remaining exact symbolic names require evidence that is **not present in this corpus** rather than more inference over the same samples;
6. no production consumer should use a PARTIAL/UNKNOWN semantic as if it were PROVEN.

It does **not** mean “100% of internal Wargaming source names recovered”.

## Canonical consistency gates

### Replay count

```text
unique arenas = 34
settled players = 476
```

Multi-POV duplicates are cross-validation only and are not counted as extra battles.

### Recorder shot ledger

After the Type28 re-audit:

```text
unique recorder method29 shotIds = 324
settlement recorder shots        = 324
```

The stale earlier per-vehicle table that summed to 341 has been superseded.

Current recorder-shot totals:

```text
A178_SPHT 222
FV215b      32
Ho-Ri       17
Maus        49
VK 72.01     4
TOTAL      324
```

### Recorder hit ledger

```text
method38 recorder hit-feedback records = 295
settlement recorder hits               = 295
```

Known duplicate/batched feedback boundaries are retained rather than silently discarded.

### Death precision

```text
settled dead combatants = 287
live terminal closure   = 283
sub-second live coverage = 98.61%
settlement-second fallback = 4 / 287
```

The remaining four are a real single-POV/AoI information boundary, not a parser blocker.

## Combat protocol closure

### HP and damage

PROVEN current facts include:

- Type5 materialization actual HP;
- Avatar method5 recorder opening actual HP;
- Vehicle prop3 current HP + terminal sentinel family;
- settlement reconstruction of initial actual HP;
- Vehicle method1 direct/fire/ram/world damage causes;
- source-attributed HP-loss ledger where observable.

Tankopedia base HP is not used when replay actual HP exists.

### Component namespace

Mechanical domain is fully closed and oriented:

```text
31 Engine
32 Ammo Rack
33 Fuel Tank
34 Right Track
35 Left Track
36 Gun
37 Turret Rotator
38 Observation Device
```

Crew:

```text
39 Commander
40 Driver
41 Gunner
43 Loader
42 unobserved / reserved-or-other UNKNOWN
```

The `34/35` exact orientation is independently closed from target-local method8 hit geometry.

### Damage-state lifecycle

```text
mechanical codeA4  -> damaged/degraded
mechanical codeA5  -> critical/disabled
mechanical codeA18 -> automatic critical self-repair to damaged
mechanical codeA19 -> fully repaired/clear
crew codeA10       -> injured/shell-shocked
crew codeA22       -> healed/clear
```

Other sparse `codeA` presentation values remain raw/PARTIAL because the current corpus does not isolate their exact symbolic names.

### method38 component result state

Current physical mapping:

```text
rawState0 -> component was involved/hit; module-damage probability did not create a new persistent negative state
             VERY STRONG physical role / exact enum unknown
rawState1 -> module damaged / crew injured
             PROVEN relationship
rawState2 -> critical / disabled
             PROVEN relationship
```

The distinction between module **hit** and module **damage** is essential: a single shell may traverse multiple components and resolve the damage probability independently for each.

## method38 hit flags

Current behaviorally reconstructed facts:

```text
0x0001 direct terminal shell kill                         PROVEN
0x0002 target already dead before attack                 PROVEN sample / low-N global boundary
0x0004 fire started                                      PROVEN current samples
0x0008 ricochet                                          high-confidence PARTIAL; geometry control still missing
0x0010 projectile penetration/material-positive branch  PROVEN relationship
0x0020 non-penetration/material-stop branch              VERY STRONG relationship
0x0100 internal component/device involvement             PROVEN relationship
0x0400 track/chassis damaged result                      PROVEN relationship
0x0800 Gun-damaged result                                PROVEN current samples / n=2 global boundary
0x1000 special/HE-family explosion material branch       VERY STRONG relationship
0x2000 special/HE-family explosion armor branch          PARTIAL n=1
0x4000 special/HE-family internal-component branch       PROVEN relationship
```

The current Blitz upper-bit behavior is **not** copied ordinally from historical PC `VEHICLE_HIT_FLAGS`.

The current data behaves like a compacted/reorganized descendant. The exact implementation-history explanation remains hypothesis; the current behavioral decoder does not depend on it.

### Special-result extension

```text
extension=1 -> Precision Fire proc candidate
               VERY STRONG / near-PROVEN
extension=2 -> Tungsten/special-damage provenance candidate
               VERY STRONG PARTIAL, n=1
```

`extension=1` current evidence:

- all 12 non-HE-family samples are exact maximum damage or terminal-HP capped;
- the FV215b HE-family sample is compatible with Precision Fire followed by HE-specific penetration/armor/explosion-radius resolution;
- direct schema/string or a controlled skill probe is still required for production-PROVEN naming.

`extension=2` cannot be upgraded from one Tungsten-active recorder hit without new samples.

## Ammunition selection

Type28 = recorder ammunition-selection state — PROVEN.

Important boundary:

> wire values `0/1/2` are selection IDs, not automatically UI list indices.

For FV215b:

```text
selectionValue1 projectile velocity ~=1440.72 -> APCR family
selectionValue2 hit behavior -> HE-family strongly established
```

Exact descriptor-to-display-name mapping remains version gated.

## Projectile / aim / replay reconstruction

PROVEN or approved high-confidence surfaces include:

- method29 launch + shotId + launch point/velocity;
- method20 terminal endpoint;
- method27 explosion/environment-terminal family;
- Type31 live aim-circle size;
- Type39 world aim ray and gun geometry;
- method36 targeting snapshots with exact PRE -> launch -> POST ordering;
- method36 dynamic dispersion/bloom family;
- Gun damage exact ×2 dispersion-like penalty and Repair Kit restoration;
- Type10 vehicle transforms;
- method8 target-local compact hit segment;
- Type4 -> hidden AoI -> Type33/Type5 re-entry visibility lifecycle.

Remaining exact method36 scalar names/units are source-schema bounded; their raw values are preserved.

## Consumables / recovery / fire

Current mapped Type32 consumables:

```text
Adrenaline
Engine Power Boost
Multi-Purpose Restoration Pack
First Aid Kit
Repair Kit
Improved Engine Power Boost
Reticle Calibration
Reactive Armor
Tungsten Shells
```

Repair/crew/fire discriminators are behaviorally closed for the mapped current codes.

## Kill and assistance attribution

wrapper6 core:

```text
field1 victim
field2 killer
field3 optional majority-damage assister
field4 optional non-default deathReason
```

`wrapper6.field3` exact current eligibility is already PROVEN:

```text
field3 positives                 46
field3 == highest non-killer     46/46
prior damage / actual initial HP > 50% 46/46
negative population with observed non-killer >50% 0/237
```

This is distinct from Destruction Assistance:

```text
method12 baseType15 / settlement field119
= cumulative Destruction Assistance count
```

Do not merge the >50% kill-notification assister with the lower-threshold Destruction Assistance statistic.

## Settlement field118 / method12 baseType12

This family is now a **closed UNKNOWN boundary**.

Current author population:

```text
baseType12 present : 10/34
field118 present   : 10/34
presence mismatch  : 0
```

method12:

```text
value always 0
count 1..3
```

field118 observed values:

```text
12,20,32,34,48,67,103,124,124,195
```

The old base-defense/dropped-capture interpretation is REJECTED.

No current hit/kill/module/capture/known-settlement correlation uniquely identifies the statistic. Public typed Blitz parsers also leave tag118 unnamed.

Required promotion evidence is explicitly bounded to:

- version-matched schema/client symbol; or
- controlled gameplay contrasts/new corpus samples.

This field therefore does not block current-corpus completion.

## Remaining exact-name boundaries — not blockers

The following are retained because the evidence required to close them is absent from the canonical corpus.

### Requires direct schema/string or controlled samples

- method38 rawState0 exact internal enum;
- method38 extension1/2 exact internal enum names;
- method38 low-N `0x0008`, `0x0800`, `0x2000` global validation;
- method36 remaining targeting scalar exact names/units;
- settlement field118/baseType12 exact name;
- unobserved component ID42 identity;
- unobserved deathReason values;
- complete Vehicle prop7/8/9 token namespaces.

### Structurally bounded, low product value

- Vehicle prop0 exact alternating-state name;
- Vehicle prop4 exact symbolic tuple;
- Vehicle method2 two-float config symbol;
- Avatar method3 exact two-byte state symbol;
- Avatar method43 exact UI/tactical symbol;
- Type11 exact session/space-config body naming;
- Type13 exact in-stream settlement serialization naming;
- settlement field116 exact cosmetic/customization item class;
- root11/150/302/303 exact low-level subfield names;
- observer/BPC/static/special-entity variants.

All remain preserved raw with structure/evidence boundaries documented.

## Stale/rejected interpretations that must never return

At completion time the following are explicitly invalid:

```text
Type4 == death                                      REJECTED
Type28 == target lock / auto aim                   REJECTED
41 == Radioman / 42 == Gunner                      SUPERSEDED
baseType12 == base defended / dropped capture      REJECTED
all method38 32 header bits == one hit-flag enum   REJECTED
historical PC high hit-flag ordinal mapping == current Blitz mapping  REJECTED
Tankopedia base HP == replay actual HP             REJECTED as primary source
one replay POV can guarantee 100% sub-second death REJECTED
```

## Production gate

Production implementation may consume only:

```text
PROVEN current-version facts
or explicitly approved PARTIAL facts with confidence/version metadata
```

Every UNKNOWN/low-N field must retain raw provenance and must not silently become a user-facing deterministic fact.

## Final audit status

```text
Observed-surface inventory blockers       0
Canonical-count contradiction blockers   0
Business-critical semantic blockers      0
Known single-POV information blockers     documented boundaries
Exact private-symbol recovery blockers    external evidence required, non-blocking

CURRENT 11.19 CORPUS STATUS: RESEARCH-COMPLETE
```

Future work is now **new evidence acquisition**, not unfinished interpretation of the same canonical 34 replays.
