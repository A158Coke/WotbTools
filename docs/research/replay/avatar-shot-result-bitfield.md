# Avatar method38 shot-result bitfield — current Blitz 11.19 evidence

> Canonical corpus: 34 unique Blitz 11.19.0 China arenas.
>
> Scope: recorder Avatar `methodId=38` low-16 result bits. Numeric IDs are version/entity-class scoped. Historical PC/WoT constants are comparison evidence only and are never promoted by ordinal coincidence alone.

## Structural verdict

The four bytes after `victimVehicleId` are **not** one homogeneous u32 hit-flag enum.

Current safe decomposition:

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

Across 295 method38 records:

```text
headerHi16Raw:
0x0002 : 293
0x0012 :   1
0x0028 :   1
```

The two non-0x0002 values occur on the known duplicate/batched Maus feedback boundary. `headerHi16Raw` remains PARTIAL/UNKNOWN and must be preserved raw.

## Historical layout — comparison only

Historical Wargaming clients contain bit positions named approximately:

```text
0x0001 vehicle killed
0x0002 vehicle already dead
0x0004 fire started
0x0008 ricochet
0x0010 material pierced by projectile
0x0020 material not pierced by projectile
0x0040 zero-DF armor pierced by projectile
0x0080 zero-DF armor not pierced by projectile
0x0100 device pierced by projectile
0x0200 device not pierced by projectile
0x0400 device damaged by projectile
0x0800 chassis damaged by projectile
0x1000 gun damaged by projectile
0x2000 material pierced by explosion
0x4000 zero-DF armor pierced by explosion
0x8000 device pierced by explosion
```

Important:

> This table is **not** the current Blitz decoder. Current names below are promoted only where 11.19 behavior independently supports them. In particular, the current high-bit evidence contradicts blindly treating `0x1000` as a universal Gun-damage bit.

# Individually closed / bounded low bits

## `0x0001` — direct shell terminal kill

Current corpus:

```text
bit-set events                              : 22
victim settlement killer == recorder        : 22 / 22
counterexamples                             : 0
recorder settlement kills                   : 24
non-bit recorder kills                      : delayed fire + ramming
```

Verdict:

> direct shell terminal kill — **PROVEN current corpus**.

## `0x0002` — target already dead before attack

One current sample carries the bit; the victim reached terminal HP about 0.3 s earlier.

Verdict:

> target already dead before this attack — **PROVEN observed sample / PARTIAL global due n=1**.

## `0x0004` — fire started

```text
bit-set events                           : 2
same-clock proven Type32 ignition event : 2 / 2
false positives                          : 0
```

Verdict:

> fire started by shot — **PROVEN observed samples / PARTIAL global due n=2**.

## `0x0008` — ricochet candidate

Current two samples both have:

- no usable exact same-clock positive HP loss;
- no structured component token results;
- the same historical numeric position used for ricochet.

The current corpus does not yet provide a full armor-normal/material collision closure for these two impacts.

Verdict:

> ricochet — **high-confidence PARTIAL**, not PROVEN.

# Piercing-like semantic mask

Current behaviorally useful mask:

```text
CURRENT_PIERCING_LIKE_MASK = 0x1110
= 0x0010 | 0x0100 | 0x1000
```

At raw RPC level:

```text
method38 events                   : 295
mask true                         : 269
mask false                        : 26
settlement recorder penetrations : 270
settlement hits - penetrations    : 25
```

The one-count discrepancy is explained by the known Maus duplicate/batched feedback pair at identical `(arena, rawClock, victim)`.

After semantic hit grouping:

```text
non-piercing-like semantic groups = 25
settlement hits - penetrations     = 25
per-arena exact                    = 34 / 34
```

Verdict:

> `0x1110` = **PROVEN current-corpus piercing-like OR relationship at semantic-hit level**.

Do not turn this into one fictional `penetrationBit`; preserve constituent flags.

# Individual-bit occurrence counts

Across 295 method38 records:

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

Not observed:

```text
0x0080
0x0200
0x8000
```

Counts are recorded independently from exact symbolic names.

# Component-result relationships

## `0x0100`

```text
bit set                  : 104
non-empty component list : 104 / 104
```

Verdict:

> **PROVEN component/device-result piercing relationship / PARTIAL exact symbolic name**.

## `0x0400`

```text
bit set                  : 58
non-empty component list : 58 / 58
```

It is strongly coupled to actual component-result state, including many track outcomes.

Verdict:

> **PROVEN module/device damage relationship / PARTIAL exact symbolic name**.

The repeated list itself uses the fully closed current component namespace (`31..43`, with 42 unobserved/unknown); see `method38-component-token-namespace.md`.

# `rawState` is no longer unresolved

Current result-state family:

```text
rawState=0 -> component hit/involved, no newly observed persistent negative module state
              VERY STRONG physical role / exact enum PARTIAL
rawState=1 -> damaged module / injured crew
              PROVEN relationship
rawState=2 -> critical / disabled module
              PROVEN relationship
```

Module hit and module damage are distinct probability outcomes. Do not infer a persistent damaged module merely because a component token is present.

See `method38-result-state-closure.md` and `method38-module-damage-probability.md`.

# Current high-bit correction — `0x1000 / 0x2000 / 0x4000`

A strict re-audit joined method38 to the corrected recorder own-shot ledger:

```text
324 unique recorder method29 shotIds
= 324 settlement recorder shots
```

At shot launch, Type28 is independently proven as recorder ammunition-selection state.

Current result:

```text
0x1000 : 13 / 13 -> Type28 selectionValue=2
0x2000 :  1 /  1 -> Type28 selectionValue=2
0x4000 :  7 /  7 -> Type28 selectionValue=2

non-selectionValue2 occurrences across these bits : 0
```

Therefore:

> `0x1000/0x2000/0x4000` belong to a **selectionValue=2 special-ammunition/result-resolution branch — PROVEN current relationship**.

This directly invalidates the earlier current-version hypothesis:

```text
0x1000 == universal Gun-damaged result
```

That interpretation is **SUPERSEDED/REJECTED for current Blitz 11.19**.

For FV215b, selectionValue1 is strongly APCR-family by projectile velocity, while selectionValue2 shows HE-family combat behavior. Exact descriptor→shell name and individual high-bit semantics still require descriptor/version-matched shell resolution; wire value must not be blindly treated as a UI list index.

Possible individual current meanings inside the selectionValue2 branch include direct HE/HESH penetration, non-penetrating explosion/material resolution, armor resolution, or related special-shell outcomes. Current sample size does not uniquely distinguish them.

# `0x0800`

Only two current events carry `0x0800`. Both are specialized component-result cases, but current 11.19 evidence is insufficient to assign an exact universal symbolic name.

Historical `CHASSIS_DAMAGED_BY_PROJECTILE` is retained only as a comparison candidate, not current truth.

Verdict: **PARTIAL**.

# Extension is a separate field, not a hit flag

Fourteen records carry a separate trailing `u32` extension:

```text
extension=1 : 13
extension=2 :  1
```

Current evidence:

- extension1 = Precision Fire proc **VERY STRONG / near-PROVEN**, with HE-specific post-proc damage resolution caveat;
- extension2 = Tungsten/special-damage provenance **VERY STRONG PARTIAL, n=1**.

These values must not be OR-ed into `resultFlags16`.

See `precision-fire-method38-extension.md`.

# Rejected interpretations

The following are explicitly rejected/superseded:

1. `u32(header[0..3])` as one homogeneous current hit-flag enum;
2. blind transplantation of all historical PC upper-bit names to current Blitz;
3. current `0x1000 == universal Gun damage`;
4. treating method38 token IDs as anonymous/unmappable — their current component namespace is now closed;
5. treating `rawState=0/1/2` as completely unknown — state families are substantially closed.

# Safe consumer model

```text
ShotResultFeedback {
    victimVehicleEntityId
    resultFlags16
    headerHi16Raw
    resultTokens[] {
        componentIdRaw
        componentNameNullable
        rawState
        stateFamilyNullable
    }
    extensionRawNullable
}
```

Safe derived facts:

```text
directKill   = flags & 0x0001 != 0
fireStarted  = flags & 0x0004 != 0        // low-n version-gated proof
ricochetLike = flags & 0x0008 != 0        // PARTIAL
piercingLike = flags & 0x1110 != 0        // semantic-hit grouped
```

Do not expose exact individual names for unresolved bits without evidence metadata.

# Remaining bounded work

1. recover a version-matched Blitz method38 entity/schema definition;
2. identify `headerHi16Raw` exact role, including duplicate-boundary values 0x0012/0x0028;
3. split selectionValue2 `0x1000/0x2000/0x4000` into exact special-shell result meanings using controlled HE/HESH samples or current shell/schema definitions;
4. geometrically close `0x0008` ricochet against armor/material normals if version-matched collision data becomes available;
5. identify exact `0x0800` current meaning from additional controlled samples.

These are bounded future probes; token namespace and rawState severity are no longer blockers.
