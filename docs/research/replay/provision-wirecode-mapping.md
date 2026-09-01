# Provision wire-code mapping — Blitz 11.19 China replay loadout

> Scope: canonical 34-arena Blitz 11.19 China corpus plus one independent T-100 LT replay.
>
> This document maps provision wire codes for the reviewed **settled-combatant production namespace**. The three provision slots are structurally present on the broader loadout-shaped Type5 family, which also includes tournament observer entities; therefore loadout shape alone is not participant identity evidence. Every mapping keeps a separate evidence grade, and vehicle availability alone is not sufficient for `PROVEN` unless it becomes a unique elimination or is independently closed by a physical battle effect.
>
> Participant-boundary details: [`observer-provision-wirecodes.md`](observer-provision-wirecodes.md). Structural container details: [`loadout-materialization.md`](loadout-materialization.md).

## Proven container context

The reviewed loadout-shaped Type5 family carries:

```text
item[0..2] = three consumables
item[3..5] = three provisions
```

The original structural scan found:

```text
1,037 / 1,037 full six-item loadout-shaped records preserve that positional split
```

This proves slot ordering, not settled-combatant identity.

A later 34-arena participant-boundary re-analysis classified complete 3+3+9 Type5 materializations against `battle_results.dat #301`:

```text
complete 3+3+9 Type5 materializations : 1,017
mapped to #301 settled combatants      :   960
non-#301 entities                      :    57
```

For those 960 settled-combatant materializations, the current production provision mapping has **zero unknown provision slots** in the reviewed corpus.

The stream-wide inventory additionally contains `0x13` and `0x1A`, but both are observer-only in this corpus:

```text
0x13 : 11 stream-wide occurrences, 0 on #301 settled combatants
0x1A :  4 stream-wide occurrences, 0 on #301 settled combatants
```

They are deliberately excluded from the settled-combatant production mapping and remain raw-preserved with unresolved logical identity. Do not infer `LARGE_FOOD` / `SMALL_FOOD` from numeric adjacency.

Provision descriptor shape:

```text
wireCode : u8
state    : u8  // 1 in current initialization population
payload  : 12 bytes
```

Current provision descriptors use the static initialization body ending in `f32 -1.0` in the final four bytes.

The replay wireCode is **not** assumed to equal BlitzKit/public provision source ID.

# Current settled-combatant production mapping table

| wireCode | Current semantic | Evidence grade |
|---:|---|---|
| `0x0E` | Large Food | **PROVEN current production mapping** |
| `0x0F` | USA Large Food | **PROVEN** |
| `0x10` | Large Food | **PROVEN current production mapping** |
| `0x11` | Large Food | **PROVEN current production mapping** |
| `0x12` | Large Food | **PROVEN current production mapping** |
| `0x16` | USA Small Food | **PROVEN** |
| `0x17` | Small Food | **PROVEN current production mapping** |
| `0x18` | Small Food | **PROVEN current production mapping** |
| `0x19` | Small Food | **PROVEN current production mapping** |
| `0x1C` | Standard Fuel | **PROVEN current production mapping** |
| `0x1D` | Improved Fuel | **PROVEN current production mapping** |
| `0x1E` | Protective Kit | **PROVEN current production mapping** |
| `0x44` | Sandbag Armor | **PROVEN** |
| `0x45` | Enhanced Sandbag Armor | **PROVEN** |
| `0x46` | Large Food | **PROVEN current production mapping** |
| `0x47` | Small Food | **PROVEN current production mapping** |
| `0x48` | Small Food | **PROVEN current production mapping** |
| `0x49` | Large Food | **PROVEN current production mapping** |
| `0x6A` | Gear Oil | **PROVEN current production mapping** |
| `0x6B` | Improved Gear Oil | **PROVEN current production mapping** |
| `0x6C` | Improved Gunpowder | **PROVEN** |

Additional sparse provision codes may appear elsewhere in the replay stream. Stream-wide observation does not automatically admit a code into this table; preserve raw values until participant scope and semantic identity are independently closed.

# USA food pair — exact closure

Current SPHT provision availability is a decisive natural constraint. The current BlitzKit definition exposes exactly five provision source choices:

```text
18  Standard Fuel
19  Improved Fuel
22  Protective Kit
99  USA Small Food
100 USA Large Food
```

The current SPHT settled-combat replay population exposes exactly five corresponding provision wire codes:

```text
0x0F
0x16
0x1C
0x1D
0x1E
```

The two nation-specific codes are `0x0F` and `0x16`; the three cross-nation/common codes are `0x1C/0x1D/0x1E`.

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

It is present in the entire observed SPHT settled-combat population (`253/253` first-materialization rows in the analyzed loadout population), while `0x16` is optional.

Verdict:

> `0x0F = LARGE_FOOD (USA source100)` — **PROVEN by pair elimination + corpus structure**.

# Cross-nation food family

The same two-family structure repeats across settled combatants:

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

The codes are nation-exclusive in this settled-combat population and match vehicles whose current available provision sets contain exactly their nation's two food source IDs plus common fuel/protection choices.

Because the USA pair is physically closed, the homologous settled-combat interpretation is:

```text
0x0E..0x12 mapped members -> large-food family
0x16..0x19 mapped members -> small-food family
```

This notation does **not** imply that every numerically adjacent wire is part of those families. In particular, stream-wide observer values `0x13` and `0x1A` remain unmapped.

The food-family identity is behaviorally/structurally closed for the reviewed 11.19 settled-combat production mapping. The raw wire code remains attached to each slot so future-version remapping can be introduced without losing evidence.

# Common `0x1C / 0x1D / 0x1E` family

These three codes are cross-nation on settled combatants and fit the three common provision identities:

```text
Standard Fuel
Improved Fuel
Protective Kit
```

SPHT provides a clean set-level elimination because its five allowed provisions are exactly two USA foods plus these three common items.

Observed SPHT usage supports:

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

The current production decoder promotes these identities under the reviewed 11.19 settled-combat mapping scope. Engine-power/traverse effects remain useful validation work, but do not change the raw-preserving wire contract.

Verdict:

> mapping above = **PROVEN current production mapping** under the reviewed 11.19 settled-combat scope.

Production exposure remains limited to the reviewed scope; the raw wire code remains available for future validation.

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

A sparse Chieftain-specific settled-combat replay code appears as:

```text
0x6B : 13 current Chieftain loadout occurrences
```

The adjacent code:

```text
0x6C = Improved Gunpowder
```

is already physically closed on VK 72.01 K, and the corresponding current special provision source IDs `44/45/46` are Gear Oil / Improved Gear Oil / Improved Gunpowder.

This produces the reviewed settled-combat namespace/order mapping:

```text
0x6A -> Gear Oil
0x6B -> Improved Gear Oil
0x6C -> Improved Gunpowder PROVEN
```

Current Type10 speed traces are too control-input/noise dependent to call the `0x6B` +4 km/h effect a clean physical proof from the natural games alone.

Verdict:

> `0x6B = IMPROVED_GEAR_OIL` — **PROVEN current production mapping** under the reviewed 11.19 settled-combat scope.

# Product guidance

A production decoder should separate wire parsing, participant scope, and item-catalog semantics:

```text
Type5
  -> provisionWireCodes[3]

entity/account mapping + #301 settlement
  -> settled-combatant participant scope

versioned replay mapping
  -> logical provision code when PROVEN for that scope

versioned item catalog
  -> numeric effect values
```

Never infer a provision from player behavior if a direct wire mapping exists; behavioral effects are validation evidence, not the primary storage format.

For unmapped values, retain raw wireCode and omit user-facing exact identity. An observer/future wire being structurally present in a provision slot is not sufficient reason to promote it into the normal settled-combatant mapping.

# Remaining work

1. validate these mappings on non-Tier-X/random-battle settled-combat replay material before widening production support;
2. validate future Blitz versions before assuming the same wire namespace;
3. retain raw descriptor payloads while the internal static-state fields remain undecoded;
4. promote observer/future codes such as `0x13` / `0x1A` only after direct semantic evidence closes their identities.
