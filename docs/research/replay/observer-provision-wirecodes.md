# Observer-only provision wire codes — corpus boundary

> Scope: the deduplicated 34-arena Blitz 11.19 China tournament corpus used by the replay protocol research.
>
> Purpose: distinguish provision wire codes that merely occur somewhere in the replay stream from provision wire codes proven on settled combatants and therefore safe for the normal Battle Playback production mapping.

## Why this note exists

`loadout-materialization.md` lists every provision-slot wire value observed in Type5 materializations. That inventory is stream-wide: it includes tournament observer entities as well as settled combatants.

The distinction matters because a code being present in a syntactically valid `0A 06 + six descriptors + 0B 09 + nine equipment bytes` loadout does **not** by itself prove that the code belongs to the normal settled-combatant provision namespace.

Production mapping must therefore use participant scope, not only numeric adjacency or slot position.

## Re-analysis result

The 34-arena corpus was re-analysed by correlating:

```text
Type5 materialization entityId
  -> subtype48 / updateArena2 participant mapping
  -> battle_results.dat #301 settled combatants
```

The parser boundaries used by production support this distinction: `ReplayParser` builds `Battle.players` from settlement `#301`, while method48 participant mappings can also contain non-settled observer entities.

Observed full combat-loadout Type5 materializations in this re-analysis:

```text
all full 3+3+9 materializations : 1017
mapped to #301 settled combatant:  960
not mapped to #301              :   57
```

For the 960 settled-combatant materializations, the current production provision mapping has zero unknown provision slots in this corpus.

## `0x13` and `0x1A`

The stream-wide provision inventory contains `0x13` and `0x1A`, but neither occurs on a `#301` settled combatant in the reviewed corpus.

Observed counts:

```text
0x13 provision occurrences: 11
0x1A provision occurrences:  4

0x13 / 0x1A on #301 settled combatants: 0
```

All observed occurrences belong to tournament observer entities.

Two stable observer configurations were observed:

```text
observer: bpc_ob_3
occurrences: 7
provisions: 0x13, 0x1E, 0x1D
opening HP: 2520
equipment:
103,108,114,
104,111,117,
106,113,118
```

```text
observer: bpc_ob_1
occurrences: 4
provisions: 0x13, 0x1D, 0x1A
opening HP: 1208
equipment:
100,109,114,
107,111,117,
105,113,101
```

The numeric layout is suggestive because known food-family codes occupy nearby ranges, but numeric continuity is not identity evidence. There is currently no settled-combatant or controlled UI evidence sufficient to promote either value to a concrete logical provision.

Verdict:

> `0x13` and `0x1A` are **observed observer-scope provision-slot wire values** in the reviewed corpus.
>
> They are **not promoted into the normal settled-combatant production mapping**.
>
> Their raw values must remain preserved and their logical IDs remain null until direct evidence closes their identities.

## Production implication

Do **not** add mappings such as:

```text
0x13 -> LARGE_FOOD
0x1A -> SMALL_FOOD
```

solely from numeric adjacency.

The current fail-closed behavior is intentional:

```text
known settled-combatant wire
  -> deterministic logicalItemId + EXACT slot confidence

unresolved observer/future wire
  -> raw wire preserved
  -> logicalItemId = null
  -> slot confidence PARTIAL
```

An unresolved observer slot must not downgrade an adjacent known slot. Aggregate loadout confidence may be PARTIAL while each proven neighboring slot remains EXACT.

## Documentation reading rule

When `loadout-materialization.md` says **Observed provision-slot codes**, read it as:

> all provision-slot codes observed anywhere in the studied Type5 stream population, including observer entities.

It must not be interpreted as:

> every listed code belongs to the settled-combatant production namespace.

For production support decisions, use the settled-combatant boundary documented here together with controlled replay/UI evidence and the explicit mapping in `VehicleBattleLoadout`.

## Future closure criteria

Promote `0x13` or `0x1A` only if new evidence provides a deterministic identity, for example:

1. a controlled replay where the exact provision slot is changed while the in-game UI identifies the item;
2. an authoritative current data source directly binding the wire value to a provision identity;
3. a sufficiently strong settled-combatant behavioral control that uniquely identifies the item without relying on numeric adjacency.

Until then, keep both values raw-preserved and unmapped.
