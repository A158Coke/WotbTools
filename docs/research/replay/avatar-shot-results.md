# Avatar method38 — recorder shot-result / hit-feedback family

> Canonical corpus: 34 unique Blitz 11.19.0 China arenas.
>
> Numeric method IDs are entity-class/version scoped. This is the synchronized method38 broad overview; detailed proof lives in the focused closure notes.

## Executive verdict

Avatar `methodId=38` is the recorder's **outgoing shot-result / hit-feedback family — PROVEN behavioral identity**.

Canonical anchors:

```text
unique recorder shots      324
settlement recorder shots  324
method38 events            295
settlement recorder hits   295
```

Every current method38 event is recorder-Avatar scoped and joins the recorder→victim hit path. It is not global world-damage telemetry.

Historical `showShotResults(results)` remains the strongest symbolic RPC candidate, but the production decoder does not depend on the historical function name.

## Wire model

```text
victimVehicleId : u32 LE
resultFlags16   : u16 LE
headerHi16Raw   : u16 LE
count           : u8
repeat count times:
    componentToken : u8
    rawState       : u8
tail            : u8
optionalExtension : u32 LE when present
```

Observed argument lengths:

```text
10 bytes : 173
12 bytes :  93
14 bytes :  24
16 bytes :   3
18 bytes :   2
```

14 records carry the extra four-byte extension.

The four bytes following victim ID are **not** one homogeneous u32 hit-flag word. Low16 is the validated result bitfield. `headerHi16Raw` is `0x0002` in 293/295 records; the two exceptions belong to the known duplicate/batched Maus boundary and remain raw.

## Physical hit grouping

A known same-clock/same-victim Maus boundary contains duplicate/batched method38 transport feedback. Consumers must semantic-group/deduplicate when constructing a settlement-compatible physical hit ledger rather than assuming every RPC is one independent physical hit.

## Current low-16 result reconstruction

| Bit | Verdict | Current physical role |
|---:|---|---|
| `0x0001` | PROVEN | direct terminal shell kill |
| `0x0002` | PROVEN sample / PARTIAL global | target already dead before attack |
| `0x0004` | PROVEN current samples / low-N global | fire started |
| `0x0008` | high-confidence PARTIAL | ricochet-like; exact current armor-normal closure missing |
| `0x0010` | PROVEN relationship | projectile penetration/material-positive branch |
| `0x0020` | VERY STRONG PARTIAL | projectile non-penetration/material-stop branch |
| `0x0040` | PARTIAL | additional projectile/material/armor branch |
| `0x0100` | PROVEN relationship | internal component/device penetration/involvement |
| `0x0400` | PROVEN relationship | track/chassis-damaged result family |
| `0x0800` | PROVEN current samples / PARTIAL global n=2 | Gun-damaged result |
| `0x1000` | VERY STRONG PARTIAL | special/HE-family explosion-material resolution branch |
| `0x2000` | PARTIAL n=1 | special/HE-family explosion-armor branch |
| `0x4000` | PROVEN relationship | special/HE-family explosion internal-component/device branch |

Current semantic-hit penetration-like derivation:

```text
CURRENT_PIERCING_LIKE_MASK = 0x1110
```

This closes against settlement penetrations after semantic hit grouping.

Historical PC/WoT upper-bit ordinal names are **not authoritative** for current Blitz 11.19. Current behavior looks like a compacted/reorganized descendant, but that implementation-history explanation is only a hypothesis.

See `method38-current-hit-flag-reconstruction.md` for the current bit truth source.

## Type28 selectionValue=2 relationship

Strict 324-shot re-audit:

```text
0x1000 : 13/13 -> Type28 selectionValue=2
0x2000 :  1/1  -> Type28 selectionValue=2
0x4000 :  7/7  -> Type28 selectionValue=2
non-value-2 occurrences = 0
```

For FV215b, value2 has HE-family combat behavior. Do not treat wire values as UI shell indices; use Type28 -> method17 descriptor -> versioned shell catalog for final display naming.

## Component-token namespace

`componentToken` reuses the current namespace independently closed across method16 and Type32:

```text
31 Engine
32 Ammo Rack
33 Fuel Tank
34 Right Track
35 Left Track
36 Gun
37 Turret Rotator
38 Observation Device
39 Commander
40 Driver
41 Gunner
42 UNKNOWN / unobserved
43 Loader
```

This relationship is **PROVEN current 11.19**. Preserve raw token and version gate even when a name is known.

## rawState

```text
rawState=0
    component was hit/involved in resolution
    but module-damage probability did not create a newly observed persistent negative state
    VERY STRONG physical role / exact private enum unknown

rawState=1
    mechanical module damaged OR crew member injured
    PROVEN relationship

rawState=2
    mechanical module critical / disabled
    PROVEN relationship
```

Independent anchors:

```text
method16 codeA4  common damage -> Type32 a0/a180/a140 : 69/69
method16 codeA5  critical      -> Type32 a4/9c        : 65/65
method16 codeA10 crew injury   -> Type32 a0/a180      : 24/24
```

A single shell may list multiple internal components and produce state0 on some while state1/2 occurs on another. **Module hit does not guarantee module damage**; each component resolves its damage probability separately.

See `method38-component-hit-damage-roll.md` and `method38-result-state-closure.md`.

## Optional extension

Current population:

```text
extension=1 : 13
extension=2 :  1
```

### extension=1

**VERY STRONG Precision Fire proc candidate / near-PROVEN**.

Current evidence:

- all 12 non-HE-family samples are exact ordinary maximum damage or terminal-HP capped;
- SPHT exact 500-damage shots: 9/9 extension1;
- Ho-Ri exact 700-damage shots: 2/2 extension1;
- SPHT 415 terminal sample had exactly 415 HP before the hit;
- lone FV215b HE-family sample remains compatible because HE can undergo penetration/armor/explosion-radius final resolution after the Precision Fire proc.

Production-PROVEN exact enum naming still requires controlled or direct current schema/string evidence.

### extension=2

Only current recorder-owned Tungsten-active hit carries value2 about 0.5 s after `0x69` activation; no non-Tungsten method38 hit carries value2.

Verdict: **VERY STRONG PARTIAL Tungsten/special-damage provenance candidate, n=1**.

A second positive controlled sample is required before exact naming.

## Safe decoder model

```text
ShotResultFeedback {
    rawClockSec
    victimVehicleEntityId
    resultFlags16
    headerHi16Raw
    results[] {
        componentIdRaw
        componentNameNullable
        rawState
        stateFamilyNullable
        confidence
    }
    extensionRawNullable
    recorderScoped = true
}
```

Safe current uses:

- identify recorder hit/result feedback;
- derive version-gated direct-kill, fire-start, penetration-like and proven module-result facts;
- attach closed module/crew identities;
- distinguish hit-with-no-new-damage vs damaged/injured vs critical/disabled;
- preserve raw flags/header/extension for future schema closure.

Unsafe:

- decode `headerHi16Raw` as a known hit flag;
- transplant historical PC bit positions wholesale;
- call rawState0 an exact private enum;
- globally call extension2 Tungsten from `n=1`;
- use method38 as global/all-player telemetry.

## Bounded future work

Not blockers to current-corpus completion:

1. direct current schema/string names;
2. controlled rawState0 module-hit/no-damage probe;
3. larger low-N flag samples (`0x0008`, `0x0800`, `0x2000`);
4. more Tungsten-active recorder hits;
5. future-version validation behind version gates.

## Current supporting notes

- `method38-current-hit-flag-reconstruction.md`
- `avatar-shot-result-bitfield.md`
- `method38-result-state-closure.md`
- `method38-component-token-namespace.md`
- `method38-component-hit-damage-roll.md`
- `precision-fire-method38-extension.md`
- `type28-ammunition-slot.md`
- `track-side-orientation-closure.md`
