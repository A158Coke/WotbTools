# Settlement PlayerResults field116 — packed-ID structural probe

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas / 476 settled combatants.
>
> This note records structural evidence only. The exact gameplay/profile item represented by field116 remains unresolved.

## Distribution

In the canonical 34-arena settlement set:

```text
settled combatants : 476
field116 non-zero  : 126
field116 omitted/0 : 350
```

Non-zero values range from approximately `257k` to `541k`, but they are not arbitrary large integers.

## Exact low-byte invariant

Every one of the 126 non-zero values satisfies:

```text
field116 & 0xFF == 0xF8
126 / 126
```

Equivalently:

```text
field116 = (highId << 8) | 0xF8
```

Only 18 distinct `highId = field116 >> 8` values occur:

```text
1004, 1007, 1023, 1024, 1027, 1029, 1030, 1031, 1032,
1034, 1036, 1037, 1039, 1041, 1043, 1044, 1165, 2111
```

Representative raw values:

```text
257272 = 0x0003ECF8 -> highId 1004
258040 = 0x0003EFF8 -> highId 1007
262392 = 0x000400F8 -> highId 1024
264440 = 0x000408F8 -> highId 1032
267512 = 0x000414F8 -> highId 1044
298488 = 0x00048DF8 -> highId 1165
540664 = 0x00083FF8 -> highId 2111
```

This is incompatible with treating field116 as an ordinary unstructured battle magnitude such as damage, distance, credits or XP.

Verdict:

> field116 is a **packed/descriptor-like identifier family — PROVEN structural shape**.
>
> exact item/profile/gameplay semantic = **UNKNOWN/PARTIAL**.

## Persistence evidence

The field can remain identical for the same player/vehicle across repeated battles. For the replay author, all five Maus arenas carry:

```text
field116 = 540664 = 0x83FF8
```

while the other author vehicle groups in the current canonical corpus do not expose the same simple universal value.

Across all players, the field is not determined solely by tank ID: the same tank can have multiple field116 values or zero among different players. It is therefore more plausibly player/config/profile/equipment-associated than a pure tank type constant.

## Historical Wargaming compact-descriptor comparison

Historical Wargaming item compact descriptors use the integer form:

```text
(itemID << 8) + itemTypeID + (nationID << 4)
```

with parser:

```text
itemTypeID = compactDescr & 0x0F
nationID   = (compactDescr >> 4) & 0x0F
itemID     = (compactDescr >> 8) & 0xFFFF
```

The current field116 invariant therefore has exactly the same bit geometry:

```text
low nibble  = 0x8
high nibble = 0xF
item/high ID = 1004..2111
```

This is strong independent support that the value belongs to a compact-descriptor-like namespace.

However the historical PC item table labels low-nibble type `8` as `tankman`, while the high nibble `15` does not fit a normal PC nation ID. Blitz has a different feature/item surface and version lineage, so those historical labels must **not** be transplanted.

Safe conclusion:

> historical compact-descriptor **encoding geometry matches**; historical `tankman/nation` semantic **does not yet transfer**.

## Negative controls

### Not the roster avatar/profile block

Root201 PlayerInfo field7 is the separately proven avatar/profile visual block containing WG CDN avatar URLs and rarity metadata. field116 is neither byte-equal nor ID-equal to that block across the corpus.

Therefore field116 is not simply the already-exposed player avatar value.

### Not a pure vehicle ID

Players using the same tank can have different field116 values, including zero, so field116 is not another copy of PlayerResults field103/tank ID.

## Required closure before naming

To promote field116 beyond packed-ID structure:

1. recover a current Blitz item/feature schema whose compact descriptor accepts the `...F8` namespace;
2. map at least several observed high IDs (`1004`, `1024`, `1032`, `1044`, `1165`, `2111`) to current game assets/configuration;
3. verify the mapping against player-specific live/roster/loadout/profile evidence;
4. use repeated same-player/same-tank battles as stability controls;
5. preserve zero/omission semantics separately from a valid descriptor.

Until that closure, production code should expose only a raw optional `field116`/packed-id value under research diagnostics, not a user-facing item name.
