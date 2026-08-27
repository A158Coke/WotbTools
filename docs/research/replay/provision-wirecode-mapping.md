# Provision wire-code mapping — Blitz 11.19 China replay loadout

> Scope: canonical 34-arena Blitz 11.19 China corpus plus one independent T-100 LT replay.
>
> This document maps the three provision descriptors embedded in combat Vehicle Type5. Every mapping keeps a separate evidence grade; vehicle availability alone is not sufficient for `PROVEN` unless it becomes a unique elimination or is independently closed by a physical battle effect.

## Proven container context

Combat Vehicle Type5 carries:

```text
item[0..2] = three consumables
item[3..5] = three provisions
```

Current full six-item combat materializations:

```text
1,037 / 1,037 preserve that positional split
```

Provision descriptor shape:

```text
wireCode : u8
state    : u8  // 1 in current initialization population
payload  : 12 bytes
```

Current provision descriptors use the static initialization body ending in `f32 -1.0` in the final four bytes.

The replay wireCode is **not** assumed to equal BlitzKit/public provision source ID.

# Current mapping table

| wireCode | Current semantic | Evidence grade |
|---:|---|---|
| `0x0E` | German large-food family | STRONG PARTIAL exact size / PROVEN food family |
| `0x0F` | USA Large Food | **PROVEN** |
| `0x10` | USSR large-food family | STRONG PARTIAL exact size / PROVEN food family |
| `0x11` | UK large-food family | STRONG PARTIAL exact size / PROVEN food family |
| `0x12` | Japan large-food family | STRONG PARTIAL exact size / PROVEN food family |
| `0x16` | USA Small Food | **PROVEN** |
| `0x17` | USSR small-food family | STRONG PARTIAL exact size / PROVEN food family |
| `0x18` | UK small-food family | STRONG PARTIAL exact size / PROVEN food family |
| `0x19` | Japan small-food family | STRONG PARTIAL exact size / PROVEN food family |
| `0x1C` | Standard Fuel candidate | VERY STRONG PARTIAL |
| `0x1D` | Improved Fuel candidate | VERY STRONG PARTIAL |
| `0x1E` | Protective Kit candidate | VERY STRONG PARTIAL |
| `0x44` | Sandbag Armor | **PROVEN** |
| `0x45` | Enhanced Sandbag Armor | **PROVEN** |
| `0x46` | European/Italian food-family branch | PARTIAL |
| `0x47` | paired European/Italian food-family branch | PARTIAL |
| `0x49` | European/Swedish food-family branch | PARTIAL |
| `0x6B` | Improved Gear Oil candidate | VERY STRONG PARTIAL |
| `0x6C` | Improved Gunpowder | **PROVEN** |

Additional sparse provision code(s) may appear outside this table; preserve raw values until independently closed.

# USA food pair — exact closure

Current SPHT provision availability is a decisive natural constraint. The current BlitzKit definition exposes exactly five provision source choices:

```text
18  Standard Fuel
19  Improved Fuel
22  Protective Kit
99  USA Small Food
100 USA Large Food
```

The current SPHT replay population exposes exactly five corresponding provision wire codes:

```text
0x0F
0x16
0x1C
0x1D
0x1E
```

The two nation-specific codes are `0x0F` and `0x16`; the three cross-nation/common candidates are `0x1C/0x1D/0x1E`.

## `0x16` = USA Small Food

A same-vehicle SPHT natural reload contrast removes the remaining large-vs-small ambiguity.

Compared configurations retain the same gun family and no differing equipment branch that modifies reload time:

```text
0x0F + 0x1D + 0x16
initial full reload = 8.691794 s

0x0F + 0x1D + 0x1E
initial full reload = 8.804916 s
```

The `0x16` branch therefore provides an additional crew-performance/reload improvement beyond the always-present `0x0F` branch.

Current catalog semantics assign USA source99 to Small Food and source100 to Large Food. The smaller food effect is exactly the optional additive food branch expected here.

Verdict:

> `0x16 = SMALL_FOOD (USA source99)` — **PROVEN behavioral + availability elimination**.

## `0x0F` = USA Large Food

Once `0x16` is closed as USA Small Food, `0x0F` is the only remaining USA-specific food code in the five-choice SPHT provision set.

It is present in the entire observed SPHT population (`253/253` first-materialization rows in the analyzed loadout population), while `0x16` is optional.

Verdict:

> `0x0F = LARGE_FOOD (USA source100)` — **PROVEN by pair elimination + corpus structure**.

# Cross-nation food family

The same two-family structure repeats across nations:

```text
primary family:
Germany  0x0E
USA      0x0F
USSR     0x10
UK       0x11
Japan    0x12

secondary family:
USA      0x16
USSR     0x17
UK       0x18
Japan    0x19
```

Observed counts in the current settled-combat loadout population:

```text
0x0E : 45
0x0F : 253
0x10 : 11
0x11 : 90
0x12 : 8

0x16 : 43
0x17 : 7
0x18 : 28
0x19 : 4
```

The codes are nation-exclusive in this corpus and match vehicles whose current available provision sets contain exactly their nation's two food source IDs plus common fuel/protection choices.

Because the USA pair is physically closed, the homologous interpretation is:

```text
0x0E..0x12 family -> large-food family
0x16..0x19 family -> small-food family
```

The food-family identity itself is behaviorally/structurally closed. Exact large-vs-small symbolic promotion for each non-USA nation remains `STRONG PARTIAL` until an independent current-version effect sample or direct schema closes the final label without relying only on homologous numbering.

# Common `0x1C / 0x1D / 0x1E` family

These three codes are cross-nation and fit the three common provision identities:

```text
Standard Fuel
Improved Fuel
Protective Kit
```

SPHT provides a clean set-level elimination because its five allowed provisions are exactly two USA foods plus these three common items.

Observed SPHT usage strongly suggests:

```text
0x1C = Standard Fuel
0x1D = Improved Fuel
0x1E = Protective Kit
```

Corpus prevalence is consistent with player behavior:

```text
0x1C : very sparse
0x1D : dominant cross-nation common provision
0x1E : common but less universal
```

However prevalence is not a physical semantic proof. Engine-power/traverse effects are difficult to close from uncontrolled player movement because Type10 telemetry records actual control outcome rather than a clean configured maximum.

Verdict:

> mapping above = **VERY STRONG PARTIAL**, not `PROVEN`.

Do not expose the exact names in production until direct current schema evidence or controlled movement/turret experiments close them.

# HP provisions

## `0x44` = Sandbag Armor

Maus base HP in the current vehicle data is 2900. Restrict to an equipment branch without Improved Assembly HP bonus.

Observed:

```text
0x44 -> opening actual HP 2987
2900 × 1.03 = 2987
```

Verdict:

> `0x44 = SANDBAG_ARMOR` — **PROVEN current 11.19 behavioral mapping**.

## `0x45` = Enhanced Sandbag Armor

Same control:

```text
0x45 -> opening actual HP 3074
2900 × 1.06 = 3074
```

Verdict:

> `0x45 = ENHANCED_SANDBAG_ARMOR` — **PROVEN current 11.19 behavioral mapping**.

# Projectile-speed provision

## `0x6C` = Improved Gunpowder

VK 72.01 K is the current corpus vehicle carrying the unique Improved Gunpowder provision branch.

Avatar method29 launch-velocity magnitudes provide a clean physical contrast:

```text
600.0 -> 810.0
ratio = 1.3500

552.0 -> 745.2
ratio = 1.3500
```

Current Improved Gunpowder effect is shell velocity ×1.35.

Verdict:

> `0x6C = IMPROVED_GUNPOWDER` — **PROVEN current 11.19 behavioral mapping**.

This is also an independent validation of method29's `[21..33)` VECTOR3 as physical projectile launch velocity.

# Gear-oil family

Chieftain Mk. 6 current allowed provisions include the common fuel/protection family, its two UK foods, and source IDs 44/45 (Gear Oil / Improved Gear Oil).

A sparse Chieftain-specific replay code appears as:

```text
0x6B : 13 current Chieftain loadout occurrences
```

The adjacent code:

```text
0x6C = Improved Gunpowder
```

is already physically closed on VK 72.01 K, and the corresponding current special provision source IDs `44/45/46` are Gear Oil / Improved Gear Oil / Improved Gunpowder.

This produces a very strong namespace/order candidate:

```text
0x6A -> Gear Oil candidate (not naturally sampled)
0x6B -> Improved Gear Oil candidate
0x6C -> Improved Gunpowder PROVEN
```

Current Type10 speed traces are too control-input/noise dependent to call the `0x6B` +4 km/h effect a clean physical proof from the natural games alone.

Verdict:

> `0x6B = IMPROVED_GEAR_OIL` — **VERY STRONG PARTIAL**.

# Product guidance

A production decoder should separate wire parsing from item-catalog semantics:

```text
Type5
  -> provisionWireCodes[3]

versioned replay mapping
  -> logical provision code when PROVEN

versioned item catalog
  -> numeric effect values
```

Never infer a provision from player behavior if a direct wire mapping exists; behavioral effects are validation evidence, not the primary storage format.

For mappings below `PROVEN`, retain raw wireCode and omit user-facing exact identity.

# Remaining work

1. close `0x1C/0x1D/0x1E` using direct current schema or controlled movement/engine/turret probes;
2. close non-USA food large/small labels with independent effect samples;
3. close `0x6B` Gear Oil through a controlled speed/traverse sample or current schema;
4. map European food branches `0x46/0x47/0x49` against source103..110 nation-specific foods;
5. validate these mappings on non-Tier-X/random-battle replay material before widening production version support.
