# Avatar method38 shot-result bitfield — current Blitz 11.19 evidence

> Canonical corpus: 34 unique Blitz 11.19.0 China arenas / 295 method38 records.
>
> Scope: recorder Avatar `methodId=38` low-16 result bits. Historical PC/WoT constants are structural comparison evidence only; current meanings are promoted from current Blitz behavior.

## Wire decomposition

The four bytes after `victimVehicleId` are **not** one homogeneous u32 hit-flag enum.

```text
victimVehicleId : u32 LE
resultFlags16   : u16 LE
headerHi16Raw   : u16 LE
count           : u8
repeat count times:
    componentToken : u8
    rawState       : u8
tail            : u8
optionalExtension : u32 LE
```

`headerHi16Raw`:

```text
0x0002 : 293
0x0012 :   1
0x0028 :   1
```

The two exceptions are the known duplicate/batched Maus feedback boundary. Keep this high half raw.

# Current synchronized low-16 map

| Bit | Verdict | Current behavioral role |
|---:|---|---|
| `0x0001` | PROVEN | direct terminal shell kill |
| `0x0002` | PROVEN sample / PARTIAL global n=1 | target already dead before attack |
| `0x0004` | PROVEN current samples / PARTIAL global n=2 | fire started |
| `0x0008` | high-confidence PARTIAL | ricochet-like; current armor-normal closure missing |
| `0x0010` | PROVEN relationship | projectile penetration/material-positive branch |
| `0x0020` | VERY STRONG PARTIAL | projectile non-penetration/material-stop branch |
| `0x0040` | PARTIAL | additional projectile/material/armor branch |
| `0x0100` | PROVEN relationship | internal component/device penetration/involvement |
| `0x0400` | PROVEN relationship | track/chassis-damaged result family |
| `0x0800` | PROVEN current samples / PARTIAL global n=2 | Gun-damaged result |
| `0x1000` | VERY STRONG PARTIAL | special/HE-family explosion-material resolution branch |
| `0x2000` | PARTIAL n=1 | special/HE-family explosion-armor branch |
| `0x4000` | PROVEN relationship | special/HE-family explosion internal-component/device branch |

Not observed in this corpus:

```text
0x0080
0x0200
0x8000
```

Preserve unobserved/unknown bits raw.

# Direct low bits

## `0x0001` direct shell kill

```text
bit-set events                       22
victim settlement killer=recorder    22/22
counterexamples                       0
recorder settlement kills            24
```

The two recorder kills without this bit are delayed fire and ramming rather than immediate shell-terminal kills.

Verdict: **PROVEN current corpus**.

## `0x0002` target already dead

Single current sample: victim had already reached terminal HP roughly 0.3 s earlier.

Verdict: **PROVEN observed sample / PARTIAL global n=1**.

## `0x0004` fire started

```text
bit-set events                        2
same-clock proven Type32 ignition     2/2
false positives                       0
```

Verdict: **PROVEN current samples / PARTIAL global low-N**.

## `0x0008` ricochet

Two samples have no usable positive HP loss and no component-result list; historical numeric position also supports ricochet, but current armor normal/material geometry is not sufficiently closed.

Verdict: **high-confidence PARTIAL**.

# Penetration-like current mask

```text
CURRENT_PIERCING_LIKE_MASK = 0x1110
= 0x0010 | 0x0100 | 0x1000
```

Raw RPC level:

```text
method38 events                  295
mask true                       269
mask false                       26
settlement penetrations         270
settlement non-penetrating hits  25
```

The one-RPC mismatch comes from the known duplicate/batched Maus pair. After semantic grouping:

```text
non-piercing-like semantic groups = 25
settlement hits - penetrations     = 25
per-arena exact                    = 34/34
```

Verdict: **PROVEN current-corpus relationship at semantic-hit level**.

This is an OR relationship, not one fictional penetration bit.

# Individual occurrence counts

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

# Internal component/device branch — `0x0100`

`0x0100` spans the complete observed current component namespace, including mechanical and crew results:

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
43 Loader
```

It occurs with all rawState families.

Verdict:

> `0x0100` = **internal component/device penetration/involvement relationship — PROVEN current behavior; exact private symbolic wording PARTIAL**.

# Track/chassis damage — `0x0400`

Current population:

```text
bit-set events                         58
records with decodable result list     53
those containing Right/Left Track      53/53
```

Token concentration:

```text
Right Track 34 : 36 occurrences
Left Track 35  : 18 occurrences
```

Other tokens occur only as co-results in the same shell path. The five bit-set records without a decoded result list provide no contradictory component identity.

Track IDs and sides are independently PROVEN by method16 movement/repair behavior plus method8 target-local hit geometry.

Verdict:

> `0x0400` = **track/chassis-damaged result family — PROVEN current relationship**.

This supersedes the earlier broad `generic device-damage` description.

# Gun damage — `0x0800`

Only two current events set the bit. Both contain exactly one repeated result:

```text
componentToken = 36 Gun
rawState       = 1 damaged
```

No other component result appears in either sample.

Verdict:

> `0x0800` = **Gun-damaged result — PROVEN on current samples / PARTIAL global because n=2**.

# Special/HE-family upper branch

Strict recorder-shot ledger:

```text
unique recorder method29 shotIds = 324
settlement recorder shots        = 324
```

Join Type28 state at **launch clock**:

```text
0x1000 : 13/13 -> selectionValue=2
0x2000 :  1/1  -> selectionValue=2
0x4000 :  7/7  -> selectionValue=2
non-selectionValue2 occurrences = 0
```

FV215b `selectionValue=2` independently shows HE-family damage behavior.

## `0x1000`

Representative FV clusters:

```text
0x1020 -> component list absent; low/no HP loss common
0x5010 -> high HP loss + internal component results
0x5100 -> internal component result + lower explosion-style HP loss
```

Verdict:

> **special/HE-family explosion-material resolution branch — VERY STRONG current relationship**.

Do not call this a universal Gun-damage bit. That earlier current-version interpretation is **REJECTED**.

## `0x2000`

One sample:

```text
flags=0x2020
selectionValue=2
HP loss=0
component list empty
```

Compatible with a distinct explosion/armor resolution branch, but exact name is sample-limited.

Verdict: **PARTIAL n=1**.

## `0x4000`

```text
bit-set events              7
selectionValue2             7/7
non-empty component results 7/7
```

Results cover mechanical and crew components with mixed rawState outcomes.

Verdict:

> **special/HE-family explosion internal-component/device branch — PROVEN current relationship; exact private symbol PARTIAL**.

# `0x0040`

Occurs 11 times and is concentrated around track/fuel-tank/internal-result cases, often alongside `0x0010/0x0020`, `0x0100`, or `0x0400`.

The current corpus cannot uniquely separate zero-damage-factor armor/spaced-armor behavior from another material-resolution branch.

Verdict: **PARTIAL; preserve raw**.

# Component result state

```text
rawState=0 -> component hit/involved; module-damage probability did not produce a new persistent negative state
              VERY STRONG physical role / exact private enum unknown
rawState=1 -> damaged module / injured crew
              PROVEN relationship
rawState=2 -> critical / disabled module
              PROVEN relationship
```

Module hit ≠ module damage. A shell can interact with multiple internal components and independently succeed/fail the damage roll for each.

See:

- `method38-result-state-closure.md`
- `method38-component-hit-damage-roll.md`
- `method38-component-token-namespace.md`

# Optional extension is not a hit flag

```text
extension=1 : 13
extension=2 :  1
```

Current evidence:

- extension1 = Precision Fire proc **VERY STRONG / near-PROVEN**, with HE-specific final damage-resolution caveat;
- extension2 = Tungsten/special-damage provenance **VERY STRONG PARTIAL, n=1**.

Do not OR extension values into `resultFlags16`.

# Historical layout — comparison only

Historical Wargaming PC tables contain positions such as:

```text
0x0100 DEVICE_PIERCED_BY_PROJECTILE
0x0200 DEVICE_NOT_PIERCED_BY_PROJECTILE
0x0400 DEVICE_DAMAGED_BY_PROJECTILE
0x0800 CHASSIS_DAMAGED_BY_PROJECTILE
0x1000 GUN_DAMAGED_BY_PROJECTILE
0x2000 MATERIAL...BY_EXPLOSION
0x4000 ARMOR...BY_EXPLOSION
0x8000 DEVICE...BY_EXPLOSION
```

Current Blitz 11.19 **does not** preserve those upper positions ordinally. Current behavior instead places track/chassis at `0x0400`, Gun at `0x0800`, and special/HE explosion branches from `0x1000` upward.

A plausible history is that Blitz omitted/merged one historical PC device-damage flag and compacted later roles, but this implementation-history explanation remains **HYPOTHESIS**. The current decoder relies on current behavior only.

# Rejected / superseded interpretations

```text
full u32 header == one current hit-flag enum                 REJECTED
blind historical upper-bit ordinal transplantation           REJECTED
current 0x1000 == universal Gun-damage bit                   REJECTED
current 0x0400 == generic all-module damage                  SUPERSEDED by track/chassis closure
method38 component tokens anonymous/unmappable                SUPERSEDED
rawState completely unknown                                   SUPERSEDED
```

# Safe consumer model

```text
ShotResultFlags {
    raw16
    directKill
    targetAlreadyDead
    fireStarted
    ricochetLike
    projectilePenetrationLike
    projectileNonPenetrationLike
    componentInvolvement
    trackChassisDamage
    gunDamage
    explosionMaterialLike
    explosionArmorLike
    explosionComponentLike
    confidenceByFact
}
```

Flags are not mutually exclusive. Preserve the original bitset.

# Bounded future work

Not blockers to current-corpus completion:

1. controlled armor-normal sample for `0x0008` / `0x0040`;
2. larger Gun-damage population for global `0x0800` validation;
3. controlled HE/HESH samples for exact `0x1000/0x2000/0x4000` private labels;
4. future occurrence of currently unobserved bits;
5. direct version-matched Blitz hit-flag schema/string recovery.

Current authoritative companion: `method38-current-hit-flag-reconstruction.md`.
