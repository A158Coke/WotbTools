# Avatar method38 — hit-result flag experiments

> Corpus: strict 34 unique arenas, Blitz 11.19.0 China.
>
> Scope: the 32-bit `flags` word at current Avatar method38 argument bytes `[4..8)`. Numeric method IDs and flag layouts are version-scoped. Historical Wargaming constants are used only where current replay behavior independently validates the same bit.

## Executive verdict

Current Avatar method38 begins with a structure that matches the core historical `showShotResults` representation:

```text
victimVehicleId : u32 LE
hitFlags        : u32 LE
...             : Blitz-current extension/result data
```

Historical `showShotResults(results)` iterates packed result integers as:

```text
vehicleID = result & 0xFFFFFFFF
flags     = (result >> 32) & 0xFFFFFFFF
```

The current first eight bytes therefore close as the same physical `vehicleId + hitFlags` information family. The remaining current bytes are an additional Blitz result extension and must not be forced into the old PC codec.

The strict corpus independently closes two individual current bits:

```text
0x0001 = direct-shot VEHICLE_KILLED   PROVEN
0x0004 = FIRE_STARTED                 PROVEN
```

It also provides a near-perfect current empirical penetration partition:

```text
CURRENT_EMPIRICAL_PIERCING = 0x0010 | 0x0100 | 0x1000
                           = 0x1110
```

This predicate is `VERY STRONG / PARTIAL symbolic semantics`: it reproduces settlement penetration/non-penetration counts everywhere except the already isolated same-clock multi-result boundary. It must not yet be presented as an official Blitz constant or transplanted to another version.

## Method38 / settlement baseline

Across the strict corpus:

```text
recorder settlement shots        : 324
recorder settlement hits         : 295
recorder settlement penetrations : 270
Avatar method38 records           : 295
```

Every method38 has a same-clock direct Vehicle method8 notification from the independently resolved recorder vehicle to the method38 victim:

```text
295 / 295
```

This establishes the containing RPC as recorder shot-result/hit feedback before any individual flag is interpreted.

## Core 64-bit result shape

Historical Wargaming client code for `showShotResults(results)` extracts each result as:

```text
low  32 bits -> vehicle ID
high 32 bits -> VEHICLE_HIT_FLAGS
```

Current method38 begins exactly with:

```text
bytes 0..3 : victim vehicle entity ID
bytes 4..7 : 32-bit result flags
```

The current flags are not an enum byte. Observed words include combinations such as:

```text
0x00020010
0x00020510
0x00020110
0x00020020
0x00020114
...
```

Current behavior therefore proves a composable flag word rather than padding or a one-of result code.

## Bit `0x0001` — direct-shot vehicle kill

Current records with bit `0x0001`:

```text
22
```

Per arena, the number of `flags & 0x0001` events equals recorder settlement kills in 32/34 arenas.

The only two settlement kills not represented by this bit are independently special non-direct-shot terminal causes:

```text
one deathReason=2 -> ramming
one deathReason=1 -> delayed fire death
```

Thus all 22 kills completed directly by the recorder's shell carry bit `0x0001`, while the two recorder-attributed kills completed by ramming/fire do not require a direct-shot kill flag.

Verdict:

> current Blitz 11.19 `hitFlags & 0x0001` = **direct-shot VEHICLE_KILLED — PROVEN**.

This independently matches the historical low-bit constant, but current replay behavior is the promotion basis.

## Bit `0x0004` — fire started

Current method38 records with bit `0x0004`:

```text
2
```

Both records are `0x...14`, i.e. they combine `0x0010 | 0x0004`.

For both records, the same victim/rawClock has the independently closed Type32 mobile short `...04` ignition/fire-start evidence:

```text
2 / 2 exact association
```

There are no current counterexamples.

Verdict:

> current Blitz 11.19 `hitFlags & 0x0004` = **FIRE_STARTED — PROVEN**.

## Bit `0x0008` — ricochet candidate

Only two current records carry bit `0x0008`.

Both have:

- no observed positive same-clock HP delta;
- no method38 token/state extension entries;
- no same-clock method27 environment-explosion companion.

The same numeric bit is historically `RICOCHET`, and current behavior is compatible with that meaning, but `n=2` is too small for promotion.

Verdict:

> `0x0008` = **ricochet candidate — PARTIAL**.

## Device/module-related low bits

Several historical low bits retain strong current structural relationships.

### `0x0100`

```text
events with bit : 104
with non-empty current token/state extension : 104 / 104
```

Historical Wargaming naming places `DEVICE_PIERCED_BY_PROJECTILE` on this bit. Current evidence proves a device/module-result relationship but does not yet prove the exact symbolic word `PIERCED`.

Verdict: **PROVEN device-result association / PARTIAL exact symbolic name**.

### `0x0400`

```text
events with bit : 58
with non-empty current token/state extension : 58 / 58
```

Historical naming places `DEVICE_DAMAGED_BY_PROJECTILE` on this bit. Again, current behavior independently proves that this bit belongs to the structured device/module-result family.

Verdict: **PROVEN device-result association / PARTIAL exact symbolic name**.

### `0x0800`

Only two records contain this bit, and both have exactly:

```text
token = 0x24
rawState = 1
```

Historical naming places `CHASSIS_DAMAGED_BY_PROJECTILE` on `0x0800`.

A current physical check is compatible with a chassis/track interpretation: one victim decelerates from roughly 4.5 m/s to ~0 within ~0.6 s and remains stationary; the second was already near stationary and later accelerates, so current data cannot equate this with a guaranteed broken track.

Verdict:

> `0x0800` = **chassis/track-damage candidate — PARTIAL**; token `0x24` = **chassis/track-family candidate — PARTIAL**.

## `0x1000` is NOT the historical PC gun-damage meaning

Current behavior directly rejects blindly transplanting the historical PC `0x1000` label.

Current observations:

```text
flags & 0x1000 : 13 records
Type28 ammo slot 0 : 0
Type28 ammo slot 1 : 0
Type28 ammo slot 2 : 13
```

The current corpus uses slot 2 for explosive/HESH/HE-like ammunition in the vehicles producing these samples. Some `0x1000` results also contribute to the settlement penetration count.

Therefore current `0x1000` is a **slot-2 explosive-shell-associated hit-result bit — PROVEN association / exact symbolic name PARTIAL**. It must not be labelled `GUN_DAMAGED_BY_PROJECTILE` merely because an older PC constant used that bit.

This is a concrete example of partial low-bit stability combined with version/platform divergence.

## Current empirical penetration partition

A brute-force per-arena experiment over the current flag bits found the strongest small predicate:

```text
piercingCandidate = (hitFlags & 0x1110) != 0

0x1110 = 0x0010 | 0x0100 | 0x1000
```

Totals:

```text
predicted piercing method38 records : 269
settlement penetrations             : 270
```

Per arena:

```text
32 / 34 arenas: predicted penetration count == settlement penetrations
Pearson r      : ~0.9924
MAE            : ~0.088 shots/arena
```

The stronger complementary test is non-penetration:

```text
method38 records with no 0x1110 bit : 26
settlement hits - penetrations       : 25
```

This is exact in **33/34 arenas**.

The sole mismatch is the already isolated Maus replay at rawClock `179.031`, where one observed shot/batch produces two same-clock method38 records:

```text
0x00120028
0x00280020
```

That arena has exactly one extra method38 record relative to settlement hits, and exactly one extra no-`0x1110` result relative to settlement non-penetrating hits. Thus the penetration partition's only residual error is co-located with the independently known result-cardinality/canonicalization boundary.

Verdict:

> `(hitFlags & 0x1110) != 0` is a **VERY STRONG current empirical any-piercing predicate** for this 11.19 corpus.

Do **not** yet name `0x1110` as the official Blitz `IS_ANY_PIERCING_MASK`: the individual bit names, especially `0x1000`, differ from historical PC layouts and the one-shot/multi-result boundary must be canonicalized before production use.

## Current high-bit version drift

Historical high-bit names cannot be copied wholesale.

Current bit `0x00020000` is present in:

```text
294 / 295 method38 records
```

The only record lacking it is the second result of the special same-clock Maus multi-result boundary. Since the entire current method38 corpus is recorder-hit scoped, this bit has a **PROVEN recorder/direct-hit association**, and is a strong candidate for a current attack-family marker.

Older/newer PC constant tables assign incompatible high-bit meanings at this location. Therefore the exact current symbolic name stays `PARTIAL`.

The archive must treat:

```text
low bits proven individually by current behavior
!=
permission to transplant the complete historical VEHICLE_HIT_FLAGS table
```

## `rawState` severity experiment

The Blitz-current extension carries `(token, rawState)` entries. A repair-response experiment supplies independent severity evidence.

Considering hit-result records whose non-empty entries are exclusively one state:

```text
only rawState=1 : 69 events
Repair Kit / MPRP within 3 s : 21 / 69 = 30.4%

only rawState=2 : 28 events
Repair Kit / MPRP within 3 s : 17 / 28 = 60.7%
```

State2 therefore triggers immediate mechanical recovery roughly twice as often as state1. This independently agrees with the already observed Type32 prefix separation:

```text
state1 -> mainly a0 / a180
state2 -> mainly a4 / 9c
```

Verdict:

> `rawState=2` is a **more severe repair-relevant module-result state than rawState=1 — PROVEN behavioral ordering / exact `critical` vs `destroyed` labels PARTIAL**.

## Safe decoder model

```text
ShotResultFeedback {
    victimVehicleEntityId
    hitFlags : u32
    extensionEntries[] {
        token
        rawState
    }
    extensionRaw[]
}
```

Current safe semantic flags:

```text
0x0001 direct-shot vehicle killed : PROVEN
0x0004 fire started               : PROVEN
0x0008 ricochet                   : PARTIAL
0x0100 device-result association  : PROVEN relationship
0x0400 device-result association  : PROVEN relationship
0x0800 chassis/track candidate    : PARTIAL
0x1000 slot2 explosive-shell result: PROVEN association / exact name PARTIAL
0x20000 recorder/direct-hit association: PROVEN relationship / exact name PARTIAL
```

Current safe derived predicate:

```text
(hitFlags & 0x1110) != 0
    -> observed-piercing candidate
    -> VERY STRONG on 11.19 strict corpus
    -> version-gated and not yet a universal protocol constant
```

## Remaining work

1. Resolve the Maus same-clock multi-result bundle to a canonical shotId/result grouping.
2. Validate `0x0008` on additional controlled ricochet samples.
3. Separate the exact current meanings of `0x0010`, `0x0100`, and `0x1000` using shell type and armor/device outcomes.
4. Resolve current high attack-family bits without copying historical PC values.
5. Map extension tokens to engine/tracks/gun/turret/ammo-rack/tankmen using controlled or descriptor-level evidence.
6. Close `rawState=1/2` to exact common/critical/destroyed terminology with a direct functional-state probe.
7. Validate all promoted bits on another Blitz client version before production implementation.
