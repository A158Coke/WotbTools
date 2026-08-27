# Avatar method38 shot-result bitfield — current Blitz 11.19 evidence

> Corpus: strict 34 unique-arena Blitz 11.19.0 China replay subset.
>
> Scope: recorder-Avatar Type8 `methodId=38`. Numeric method IDs are entity-class/version scoped. This chapter extends `avatar-shot-results.md` and records bit-level findings that reached an evidence threshold after corpus-wide validation.

## Executive verdict

Current method38 remains the recorder's shot-result / hit-feedback family. The newly important structural correction is:

> the previously described four-byte `header` must **not** be treated blindly as one homogeneous 32-bit hit-flag word.

Across 295 method38 records:

```text
header[2..3] interpreted as u16 LE:
  0x0002 : 293 / 295
  0x0012 :   1 / 295
  0x0028 :   1 / 295
```

The two non-`0x0002` values belong to the same known duplicate/batched feedback boundary in one Maus arena.

By contrast, the low 16 bits contain the variable result-bit surface and match the historical `VEHICLE_HIT_FLAGS` numeric layout at multiple independently validated positions.

Therefore the safe current decomposition is:

```text
victimVehicleId : u32 LE
resultFlags16   : u16 LE          // current behavioral bitfield, decoded below
headerHi16Raw   : u16 LE          // usually 0x0002; semantic still PARTIAL/UNKNOWN
count           : u8
repeat count times:
    token       : u8
    rawState    : u8
tail            : u8
optional extension bytes
```

`headerHi16Raw` must remain raw until independently closed.

## Low-16-bit result flags

Historical Wargaming client constants expose the following projectile hit flags:

```text
0x0001 VEHICLE_KILLED
0x0002 VEHICLE_WAS_DEAD_BEFORE_ATTACK
0x0004 FIRE_STARTED
0x0008 RICOCHET
0x0010 MATERIAL_WITH_POSITIVE_DF_PIERCED_BY_PROJECTILE
0x0020 MATERIAL_WITH_POSITIVE_DF_NOT_PIERCED_BY_PROJECTILE
0x0040 ARMOR_WITH_ZERO_DF_PIERCED_BY_PROJECTILE
0x0080 ARMOR_WITH_ZERO_DF_NOT_PIERCED_BY_PROJECTILE
0x0100 DEVICE_PIERCED_BY_PROJECTILE
0x0200 DEVICE_NOT_PIERCED_BY_PROJECTILE
0x0400 DEVICE_DAMAGED_BY_PROJECTILE
0x0800 CHASSIS_DAMAGED_BY_PROJECTILE
0x1000 GUN_DAMAGED_BY_PROJECTILE
0x2000 MATERIAL_WITH_POSITIVE_DF_PIERCED_BY_EXPLOSION
0x4000 ARMOR_WITH_ZERO_DF_PIERCED_BY_EXPLOSION
0x8000 DEVICE_PIERCED_BY_EXPLOSION
```

The current Blitz corpus is not promoted solely from those historical names. Each bit is classified below from current behavior plus the historical numeric cross-check.

### `0x0001` — direct vehicle kill

Current corpus:

```text
bit-set method38 feedback : 22
victim whose settlement killer == recorder : 22 / 22
counterexamples : 0
```

Recorder settlement kills across all 34 arenas = 24. The two recorder kills without this bit are independently special-cause deaths:

- one delayed fire death;
- one ramming death.

Those are not a shell's immediate terminal hit result.

Verdict:

> `0x0001 = VEHICLE_KILLED / direct shot terminal kill` — **PROVEN on current corpus**.

### `0x0002` — vehicle was already dead before attack

Only one current sample carries the bit. The victim has already reached a terminal HP state roughly 0.3 s before the method38 feedback.

Verdict:

> `0x0002 = target already dead before this attack` — **PROVEN on observed sample / PARTIAL global due sample size**.

### `0x0004` — fire started by shot

Current corpus:

```text
bit-set method38 feedback : 2
same-clock proven Type32 ignition `...04` event : 2 / 2
false positives among all other method38 events : 0
```

Both are recorder hits and both carry positive observed HP loss.

Verdict:

> `0x0004 = FIRE_STARTED` — **PROVEN on current observed samples / PARTIAL global due n=2**.

### `0x0008` — ricochet

Two current events carry the bit. Both have:

- no exact same-clock positive HP loss;
- no method38 module-result tokens;
- historical numeric identity `RICOCHET = 0x0008`.

The current corpus lacks an independent impact-normal/armor-angle geometric closure for those two shells.

Verdict:

> `0x0008 = ricochet` — **high-confidence PARTIAL**, not yet PROVEN.

## Piercing classification

### Low-bit piercing mask

The following current low-16-bit OR mask is behaviorally important:

```text
CURRENT_PIERCING_LIKE_MASK = 0x1110

0x0010
| 0x0100
| 0x1000
```

At raw RPC level:

```text
method38 events                  : 295
mask true                        : 269
mask false                       : 26
settlement recorder penetrations : 270
settlement hits-penetrations      : 25
```

A naive event-level comparison is therefore off by exactly one in each class.

### Duplicate-feedback boundary explains the mismatch

Arena `1161438817384243971` (Maus) contains two method38 feedback records at the same replay clock and same victim:

```text
rawClock  = 179.031326
victimEid = 280828258
```

The same arena has:

```text
method38 RPC count = 12
settlement hits     = 11
```

Thus this clock/victim pair is a duplicate/batched feedback boundary, not two independent settlement hits.

After semantic grouping by the proven hit identity boundary `(arena, rawClock, victim)`:

```text
non-piercing-like semantic groups = 25
settlement hits - penetrations     = 25
per-arena exact                    = 34 / 34
```

Verdict:

> `0x1110` is a **PROVEN current-corpus piercing-like mask at semantic-hit level**.

Important implementation rule:

> method38 RPC cardinality must not be assumed to equal physical/settlement hit cardinality without semantic grouping/dedup.

### Why the mask is not a single `penetration` bit

The three constituent bits have different result relationships:

- `0x0010` is extremely common on ordinary HP-damaging shots;
- `0x0100` is strongly coupled to non-empty module/critical token lists;
- `0x1000` is sparse and concentrated in a subset of gun/special-result cases.

Historical Wargaming constants likewise model piercing as an OR across material/armor/device outcomes rather than one boolean bit.

Therefore consumers should preserve the individual bitset even if they expose a derived `piercingLike` boolean.

## Current individual-bit statistics

Across 295 method38 events, low-16 individual bit occurrence includes:

```text
0x0001 : 22
0x0002 :  1
0x0004 :  2
0x0008 :  2
0x0010 : 247
0x0020 : 77
0x0040 : 11
0x0100 : 104
0x0400 : 58
0x0800 :  2
0x1000 : 13
0x2000 :  1
0x4000 :  7
```

`0x0080`, `0x0200` and `0x8000` are not observed in this strict subset.

These counts are intentionally recorded separately from semantic names so future controlled samples can validate missing branches.

## Module-result relationship

`0x0100` and `0x0400` are strongly associated with the method38 repeated `(token,rawState)` result list:

```text
0x0100 set : 104 events; 104/104 have non-empty result list
0x0400 set :  58 events;  58/58 have non-empty result list
```

This is strong current evidence that those bits belong to the device/module-result surface, consistent with the historical names `DEVICE_PIERCED_BY_PROJECTILE` and `DEVICE_DAMAGED_BY_PROJECTILE`.

However, a token is not itself a flag bit: one hit may carry multiple tokens/states and multiple hit flags.

Verdict:

- `0x0100`: **PROVEN module/device piercing relationship / PARTIAL exact symbolic carry-over**;
- `0x0400`: **PROVEN module/device damage relationship / PARTIAL exact symbolic carry-over**.

## `0x0800` and `0x1000`

Current sample sizes are small:

```text
0x0800 : 2 events
0x1000 : 13 events
```

Historical names are `CHASSIS_DAMAGED_BY_PROJECTILE` and `GUN_DAMAGED_BY_PROJECTILE` respectively. Current token/result correlations are compatible with a specialized module outcome, but there is not yet a version-matched Blitz entity/schema or controlled damaged-track/damaged-gun closure for all samples.

Verdict: **PARTIAL**.

## Explosion-family bits

Current strict subset contains:

```text
0x2000 : 1 event
0x4000 : 7 events
```

These numerically match historical explosion piercing-family bits. They are disproportionately present on the FV215b subset, consistent with special shell/explosion mechanics, but current behavior is not sufficient to assign exact material-vs-armor explosion semantics without a shell/config join.

Verdict: **PARTIAL**.

## Rejected interpretation: treating all 32 header bits as one flag enum

`headerHi16Raw` is `0x0002` in 293/295 records. Interpreting that as a universal high-order hit flag would imply an implausible special result on nearly every hit and conflicts with the observed low-bit behavior.

The two high-half exceptions are exactly the known duplicate/batched Maus boundary:

```text
headerHi16Raw = 0x0012
headerHi16Raw = 0x0028
```

Therefore:

> `u32(header[0..3]) == one homogeneous VEHICLE_HIT_FLAGS word` is **REJECTED**.

The low 16 bits are the current validated hit-result bitfield; the high 16 bits must remain a separate raw field until closed.

## Consumer guidance

Safe current model:

```text
ShotResultFeedback {
    victimVehicleEntityId
    resultFlags16
    headerHi16Raw
    resultTokens[] {
        token
        rawState
    }
    extensionRaw[]
}
```

Safe derived facts, version gated to current evidence:

```text
directKill     = flags & 0x0001 != 0
fireStarted    = flags & 0x0004 != 0     // current-sample proven, low n
ricochetLike   = flags & 0x0008 != 0     // PARTIAL until geometric closure
piercingLike   = flags & 0x1110 != 0     // after semantic hit grouping
```

Do not yet expose exact user-facing names for every remaining bit without evidence-level metadata.

## Remaining work

1. Recover a version-matched Blitz 11.19 Avatar entity definition and exact `showShotResults` codec.
2. Join `0x0800` to independently proven track/chassis state transitions.
3. Join `0x1000` to independently proven gun-damage state transitions.
4. Join `0x2000/0x4000` to shell slot + version-matched shell explosion mechanics.
5. Decode `headerHi16Raw`, especially the duplicate boundary values `0x0012` and `0x0028`.
6. Map method38 token IDs to actual module/crew identities.
7. Close `rawState=0/1/2` with controlled damaged-vs-destroyed-vs-crew outcomes.
