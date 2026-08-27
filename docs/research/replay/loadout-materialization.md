# Vehicle loadout materialization — Type5 / Type32 consumables, provisions and equipment

> Scope: Blitz 11.19 China canonical replay corpus plus one independent T-100 LT replay sample.
>
> This document records battle-loadout structure directly supported by replay bytes and behavioral closure. Numeric equipment effect values are maintained separately in the current item catalog and must not be inferred from historical replay assumptions.

## Executive verdict

Current Vehicle Type5 materialization does not carry only transform/HP state. For combat vehicles it directly exposes battle loadout:

```text
6 × 14-byte item descriptors
9-byte equipment-selection string
```

The six-item surface cross-closes with Type32 item initialization/lifecycle traffic and is now positionally closed as:

```text
item[0..2] = three consumable slots
item[3..5] = three provision slots
```

The nine-byte equipment surface is stronger than a symbolic slot code: **each byte is the equipment numeric ID itself, represented as one ASCII character**.

```text
equipmentId = unsignedByte(equipmentString[slot])
```

Verdict:

> **battle loadout is directly materialized in the replay — PROVEN structural/behavioral family**.
>
> **3 consumable + 3 provision positional ordering — PROVEN on current combat Type5 population**.
>
> **equipment selection is directly decodable by byte value / ASCII code point — PROVEN on current 11.19 corpus**.

This supersedes the earlier need to infer equipment identity slot-by-slot from derived effects such as HP or consumable duration.

# Exact Type5 tail structure for combat vehicles

For every currently decoded combat-vehicle Type5 payload carrying the full loadout, the equipment string is part of a stable tail structure:

```text
0A 06
  6 × 14-byte item descriptor
0B 09
  9 raw equipment-ID bytes
... trailing vehicle state
```

Each item descriptor currently has:

```text
itemWireCode : u8
state        : u8
payload      : 12 bytes
```

Representative T-100 LT recorder materialization:

```text
0A 06
0B 01 000000000000000000000000
0A 01 000000000000000000000000
09 01 000000000000000000000000
10 01 0000000000000000000080BF
1D 01 0000000000000000000080BF
17 01 0000000000000000000080BF
0B 09
64 6D 72 68 6F 74 69 71 65
```

The final nine bytes decode as ASCII `dmrhotiqe`, but the byte values themselves are the authoritative equipment IDs:

```text
64h = 100
6Dh = 109
72h = 114
68h = 104
6Fh = 111
74h = 116
69h = 105
71h = 113
65h = 101
```

## Combat vs non-combat Type5 distinction

Current equipment-string scan:

```text
Type5 payloads with valid 9-byte equipment string : 1,097
full `0A 06` six-item combat-loadout family       : 1,037
smaller `0A 04` four-item family                  :    60
```

The `0A 04` examples belong to non-settlement / observer-style entities and must not be interpreted as a normal player battle loadout.

Safe parser rule:

```text
0A 06 + six descriptors + 0B 09 + nine equipment bytes
  -> supported combat-vehicle loadout surface

other counts
  -> preserve raw; do not coerce to normal 3+3 player loadout
```

# Six item descriptors — consumables + provisions

## Positional closure

Across all 1,037 current full six-item combat loadouts:

```text
item[0] consumable-family code : 1,037 / 1,037
item[1] consumable-family code : 1,037 / 1,037
item[2] consumable-family code : 1,037 / 1,037

item[3] provision/static code  : 1,037 / 1,037
item[4] provision/static code  : 1,037 / 1,037
item[5] provision/static code  : 1,037 / 1,037
```

No positional counterexample exists in the studied 11.19 population.

Verdict:

> Type5 six-item ordering = **three consumables followed by three provisions — PROVEN current corpus**.

## T-100 LT natural sample

The independent T-100 LT replay contains six Type5 item descriptors for the recorder vehicle:

```text
0B
0A
09
10
1D
17
```

The first three are independently closed through Type32 dynamic lifecycle behavior:

```text
0x09 = Adrenaline
0x0A = Engine Power Boost
0x0B = Multi-Purpose Restoration Pack
```

The remaining three occupy the proven provision slots:

```text
0x10
0x1D
0x17
```

Their descriptor payload ends in `80 BF` (`f32 -1.0` in the current tail position), while normal initialized consumables predominantly begin with a zeroed dynamic-state payload before later Type32 transitions.

## Corpus-level dynamic/static code inventory

Observed consumable-slot codes:

```text
08 09 0A 0B 0C 0D 3D 3E 42 69
```

Observed provision-slot codes:

```text
0E 0F 10 11 12 13 16 17 18 19 1A 1C 1D 1E
44 45 46 47 49 6B 6C
```

Exact provision code -> symbolic item identities remain item-specific research. Do not assume these wire codes equal catalog `sourceIds`; the dynamic consumable family already proves that the replay wire namespace is not simply the public catalog ID namespace.

Verdict:

> Type5 six-item descriptor = **consumable/provision battle-loadout surface — PROVEN family**.
>
> Exact consumable/provision slot ordering = **PROVEN**.
>
> Exact provision wire-code names = **PARTIAL** until independently mapped.

# Nine equipment bytes — direct equipment IDs

## Full-corpus proof

Across the current 34-arena corpus plus the independent T-100 LT sample:

```text
Type5 equipment strings inspected      : 1,097
full six-item combat loadout strings   : 1,037
four-item non-combat/observer strings  :    60
string length                          : 9 / 9
observed distinct equipment IDs        : 20
```

For every observed character in every slot:

```text
ord(character) == current equipment numeric ID
```

The byte's slot position also matches the equipment grid position.

Observed mapping:

| replay slot | byte / ASCII | decimal ID | equipment |
|---:|---|---:|---|
| 0 | `d` | 100 | GUN_RAMMER |
| 0 | `f` | 102 | IMPROVED_VENTILATION |
| 0 | `g` | 103 | CALIBRATED_SHELLS |
| 1 | `l` | 108 | ENHANCED_GUN_LAYING_DRIVE |
| 1 | `m` | 109 | SUPERCHARGER |
| 2 | `r` | 114 | VERTICAL_STABILIZER |
| 2 | `s` | 115 | REFINED_GUN |
| 2 | `{` | 123 | IMPROVED_SUSPENSION |
| 3 | `h` | 104 | IMPROVED_MODULES |
| 3 | `k` | 107 | DEFENSE_SYSTEM |
| 4 | `n` | 110 | ENHANCED_ARMOR |
| 4 | `o` | 111 | IMPROVED_ASSEMBLY |
| 5 | `t` | 116 | ENHANCED_TRACKS |
| 5 | `u` | 117 | TOOLBOX |
| 6 | `i` | 105 | IMPROVED_OPTICS |
| 6 | `j` | 106 | CAMOUFLAGE_NET |
| 7 | `p` | 112 | IMPROVED_CONTROL |
| 7 | `q` | 113 | ENGINE_ACCELERATOR |
| 8 | `e` | 101 | HIGH_END_CONSUMABLES |
| 8 | `v` | 118 | CONSUMABLE_DELIVERY_SYSTEM |

Equipment ID 122 (`IMPROVED_VERTICAL_STABILIZER`, byte `z`) is present in the current catalog but was not naturally selected in the studied replay corpus. The general byte=ID encoding rule is nevertheless independently closed across the other 20 observed IDs; unsupported/unseen IDs should still be raw-preserved and catalog-resolved rather than hard-coded as a finite character enum.

Verdict:

> `equipmentIds[slot] = unsignedByte(rawEquipmentBytes[slot])` — **PROVEN current 11.19 encoding**.

## Why earlier behavioral mappings still matter

Earlier effect-based natural experiments remain valuable as independent validation:

### ID 111 / Improved Assembly

SPHT natural population:

```text
slot4 byte `n` / ID110 -> opening actual HP 3400 : 13 / 13
slot4 byte `o` / ID111 -> opening actual HP 3570 : 96 / 96
```

This independently confirms ID111 is the HP-increasing branch. The observed 11.19 uplift is approximately +5%, matching the current 11.19 balance update rather than the older catalog value.

### ID 101 / High-End Consumables

T-100 LT:

```text
slot8 byte `e` / ID101
Adrenaline state2 -> state3 ~= 26.5 s
```

This independently matches the extended consumable-duration branch.

These are validation probes, not required for primary equipment identity decoding now that the direct byte=ID encoding is known.

# Enemy loadout visibility

The loadout surface is not recorder-only.

Enemy vehicles are independently identified through the proven Type4 leave -> later Type5 re-materialization lifecycle. Across the current corpus plus T-100 LT sample:

```text
enemy Type5 re-materializations inspected : 683
with complete 9-byte equipment string     : 683 / 683
with full six-item combat descriptor      : 683 / 683
```

Therefore:

> **when an enemy combat vehicle materializes into the replay POV, its current Type5 payload carries the same complete 3-consumable + 3-provision + 9-equipment loadout descriptor — PROVEN current corpus**.

This does not mean an enemy that never materializes can be reconstructed; absence remains absence of replay evidence.

# 11.19 equipment rebalance boundary

WoT Blitz 11.19 changed several equipment **effect values** without changing the equipment numeric IDs or grid positions used by this replay corpus.

Therefore replay decoding should separate:

```text
replay wire
  -> equipment IDs / selected slots

versioned item catalog
  -> current effect values
```

Do not bake equipment percentages into the replay protocol decoder.

The replay should produce IDs such as `111`; the 11.19 catalog should determine that ID111 currently means Improved Assembly with the current 11.19 modifier.

# Safe consumer model

```text
VehicleBattleLoadout {
    entityId
    replayVersion

    consumables[3] {
        wireCode
        stateRaw
        payloadRaw[12]
        logicalItemId? // only when proven/version-mapped
    }

    provisions[3] {
        wireCode
        stateRaw
        payloadRaw[12]
        logicalItemId? // only when proven/version-mapped
    }

    equipmentIds[9] // direct u8 IDs from Type5
}
```

Safe uses:

- display actual battle equipment for any materialized combat vehicle;
- display consumables/provisions once their wire codes are version-mapped;
- explain observed HP/reload/aim/movement/consumable-duration differences using the actual equipment ID plus a versioned catalog;
- preserve unknown raw item codes without inventing names;
- support enemy loadout only when corresponding enemy Type5 materialization exists.

# Scope boundary

This PR remains protocol research, not production implementation.

Do not:

- hard-code 11.19 equipment percentages into packet decoding;
- assume future client versions retain the same tail framing without version validation;
- guess provision names solely from similar numeric IDs;
- infer a never-materialized enemy loadout;
- reduce equipment decoding to a closed ASCII enum when the byte value itself is the equipment ID.

# Remaining work

1. map provision-slot wire codes to current logical provision IDs using current Blitz definitions plus replay behavior;
2. map any still-unclosed consumable wire codes in the first three item slots;
3. verify the 6+9 tail on non-Tier-X combat vehicles / random battles before widening production version gates;
4. validate future Blitz versions before assuming the Type5 relative tail structure is unchanged;
5. retain raw 14-byte item descriptor payloads until their internal timers/state fields are fully decoded.
