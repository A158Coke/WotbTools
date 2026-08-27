# Avatar method38 — recorder shot-result / hit-feedback family

> Canonical corpus: 34 unique Blitz 11.19.0 China arenas.
>
> Numeric method IDs are entity-class and version scoped. This file is the synchronized method38 overview; focused evidence lives in the linked closure notes.

## Executive verdict

Avatar `methodId=38` is the replay recorder's **outgoing shot-result / hit-feedback family — PROVEN behavioral identity**.

Current corpus anchors:

```text
settlement recorder shots : 324
settlement recorder hits  : 295
method38 events           : 295
```

Every method38 event is recorder-Avatar scoped and joins a recorder→victim direct-hit path. It is not general world-damage telemetry.

Historical `showShotResults(results)` remains the strongest symbolic candidate, but exact current Blitz RPC symbol/schema is still PARTIAL until version-matched definitions are recovered.

## Safe current wire model

Main structure:

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

Argument lengths in the canonical corpus:

```text
10 bytes : 173
12 bytes :  93
14 bytes :  24
16 bytes :   3
18 bytes :   2
```

The extra four-byte extension occurs in 14 records.

Important correction:

> the four bytes after `victimVehicleId` must not be interpreted as one homogeneous u32 flag enum.

The low 16 bits are the behaviorally validated result-bit surface. `headerHi16Raw` is usually `0x0002` and remains raw/PARTIAL.

## Recorder-hit scope and semantic hit grouping

The strict corpus closes method38 against recorder hit totals, but transport cardinality is not always one physical hit per RPC. A known Maus boundary contains duplicate/batched feedback at the same `(arena, rawClock, victim)`.

Consumers constructing a physical hit ledger must semantic-group/deduplicate rather than assume one RPC equals one settlement hit.

## Current low-16 result facts

```text
0x0001 -> direct shell terminal kill
          PROVEN current corpus

0x0002 -> target already dead before attack
          PROVEN observed sample / PARTIAL global

0x0004 -> fire started by shot
          PROVEN observed samples / PARTIAL global

0x0008 -> ricochet
          high-confidence PARTIAL; current armor-normal geometry closure still absent

0x1110 -> piercing-like OR relationship
          PROVEN current corpus after semantic-hit grouping
```

`0x0010`, `0x0100`, `0x0400` and other individual bit semantics are preserved separately in `avatar-shot-result-bitfield.md` with their own evidence grades.

Re-audited current special-ammunition relationship:

```text
0x1000 : 13/13 -> Type28 selectionValue=2
0x2000 :  1/1  -> Type28 selectionValue=2
0x4000 :  7/7  -> Type28 selectionValue=2
```

This proves a selection-value-2 special ammunition/result-resolution branch, but does **not** justify transplanting historical PC upper-bit names into current Blitz.

## Component-token namespace — now closed

The repeated `componentToken` is not an anonymous critical token anymore. It reuses the current component namespace independently closed across method16 and Type32.

Current version-gated map:

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
42 UNKNOWN / unobserved-reserved
43 Loader
```

Thus consumers may decode known tokens to component names for Blitz 11.19 while preserving the raw value and version gate.

## `rawState` severity/result family — substantially closed

Current safe mapping:

```text
rawState=0
    component hit/involved in resolution
    but no newly observed persistent negative module state
    VERY STRONG physical role / exact internal enum PARTIAL

rawState=1
    mechanical component damaged OR crew member injured
    PROVEN relationship

rawState=2
    mechanical component critical / disabled
    PROVEN relationship
```

Independent method16→Type32 anchors:

```text
method16 codeA=4  common damage -> Type32 a0/a180/a140 : 69/69
method16 codeA=5  critical      -> Type32 a4/9c        : 65/65
method16 codeA=10 crew injury   -> Type32 a0/a180     : 24/24
```

Method38 then reproduces the same state families on same-component result tokens.

### Why rawState=0 is not light damage

Current `rawState=0` population has explicit component tokens but no same-clock matching persistent negative-state mutation. Mixed single-shell results show that one shell can hit several internal components and independently succeed/fail their module-damage probability checks, e.g. components with state0 in the same hit as another crew/module result with state1.

Therefore module hit and module damage are distinct. Do not expose rawState0 as `damaged`.

The exact internal enum name (`unchanged`, `hit-no-damage`, etc.) remains unknown.

## Extended result field

Current population:

```text
extension=1 : 13
extension=2 :  1
```

### extension=1

`extension=1` is a **VERY STRONG Precision Fire proc candidate / near-PROVEN**, but remains provenance-aware rather than production-PROVEN without controlled/schema closure.

Current evidence:

- all 12 non-HE-family samples produce exact maximum ordinary damage or target-HP-capped terminal damage;
- exact SPHT 500-damage samples: 9/9 carry extension1;
- exact Ho-Ri 700-damage samples: 2/2 carry extension1;
- the SPHT 415 terminal sample had exactly 415 HP before the hit, so observable loss is HP-capped;
- the lone FV215b HE-family sample is not a contradiction: Precision Fire may establish the HE maximum-damage proc before HE penetration/armor/explosion-radius resolution determines final HP loss.

Do not infer Precision Fire solely from final damage magnitude. See `precision-fire-method38-extension.md`.

### extension=2

The only current recorder-owned Tungsten-active hit carries `extension=2` approximately 0.5 seconds after activation; no non-Tungsten hit carries that extension.

Verdict:

> Tungsten/special-damage provenance candidate — **VERY STRONG PARTIAL, n=1**.

Additional controlled samples are required before exact naming.

## Type28 relationship

Type28 is independently proven as recorder ammunition-selection state. A strict re-audit reconstructs:

```text
324 unique recorder method29 shotIds
= 324 settlement recorder shots
```

Do not assume wire selection values `0/1/2` equal UI shell-list indices without method17 descriptor closure.

For FV215b, current launch velocity strongly identifies wire value1 as the APCR family. Wire value2 has HE-family combat behavior and is the only value associated with the current `0x1000/0x2000/0x4000` high-result branch, but production naming still belongs behind descriptor/version gating.

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

- identify a recorder shell hit/result feedback event;
- derive current-corpus direct kill, fire-start and piercing-like facts;
- attach version-gated module/crew identities;
- distinguish no-new-module-damage vs damaged/injured vs critical/disabled component result families;
- preserve extension provenance and raw flags for future schema closure.

Still unsafe:

- treating `headerHi16Raw` as a decoded hit flag;
- naming every low-16 bit from historical PC constants;
- naming rawState0 with an exact internal enum;
- globally naming extension2 as Tungsten from a single sample;
- treating method38 as all-player/global telemetry.

## Current remaining work

These are bounded research gaps, not blockers to current-corpus structural completion:

1. recover version-matched Blitz method38 schema/symbol names;
2. close exact rawState0 internal enum naming with a controlled module-hit/no-damage probe;
3. split selectionValue2 high result bits into exact HE/special-shell resolution meanings;
4. obtain more Tungsten-active recorder hits for extension2;
5. validate mappings on future Blitz versions behind version gates.

## Canonical supporting notes

- `avatar-shot-result-bitfield.md`
- `method38-result-state-closure.md`
- `method38-component-token-namespace.md`
- `method38-module-damage-probability.md`
- `precision-fire-method38-extension.md`
- `type28-ammunition-slot.md`
- `track-side-orientation-closure.md`
