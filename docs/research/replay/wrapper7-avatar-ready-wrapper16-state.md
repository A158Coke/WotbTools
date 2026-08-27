# Arena wrapper7 `AVATAR_READY` and wrapper16 state-family research

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> This note follows the strict current-version rule: historical Wargaming numeric names are accepted only when the current 11.19 wire shape and replay behavior independently agree.

## wrapper7 — vehicle/avatar-ready notification

Current subtype48 wrapper7 has a minimal protobuf shape:

```text
root field7
  -> child field1 = entity / vehicle ID
```

Across the canonical 34 arenas:

```text
wrapper7 records per arena:
  18 : 31 arenas
  16 :  2 arenas
  20 :  1 arena

unique IDs per arena:
  14 : 26 arenas
  15 :  4 arenas
  16 :  4 arenas
```

The important identity closure is stronger than raw cardinality:

```text
all 14 settled combatant entity IDs are present in wrapper7
34 / 34 arenas
```

Where wrapper7 has 15 or 16 unique IDs, the extras are outside root-301 settled combatants and therefore fit the already-proven fact that the live arena can also contain observer/non-combatant entities.

Timing is likewise lifecycle-specific. wrapper7 appears only in the initial setup/ready window in this corpus, before active combat telemetry dominates. A typical arena emits one wrapper7 record for every combat vehicle plus repeated records for one entity; repeated notification is therefore idempotent lifecycle evidence, not an independent combat counter.

### Independent historical schema/client evidence

Historical Wargaming constants define:

```text
ARENA_UPDATE.AVATAR_READY = 7
```

and the corresponding `ClientArena.__onAvatarReady(argStr)` decodes exactly one `vehicleID`, sets:

```text
vehInfo['isAvatarReady'] = True
```

and emits `onAvatarReady(vehicleID)`.

This independently matches both the current one-ID payload and its prebattle/setup behavior.

Verdict:

> wrapper7 = **vehicle/avatar-ready lifecycle notification — PROVEN behavioral family for current corpus**.
>
> child field1 = **vehicle/entity ID — PROVEN**.

The symbolic spelling `AVATAR_READY` is supported by independent Wargaming lineage plus current behavior, but remains version-scoped rather than assumed globally stable.

## wrapper16 — active entity-state family

Current wrapper16 shape remains:

```text
root field15
  child field1 = entity / vehicle ID
  child field2 = 1
  child field3 = state/event code
```

Canonical 34-arena counts:

```text
records total : 741
field3 = 1    : 718
field3 = 8    :  23
```

The rare `field3=8` branch now has a strong event-level discriminator.

### field3=8 is damage-adjacent

For all 23 `field3=8` records:

```text
same-entity Vehicle method8 direct-damage event within ±0.15 s : 23 / 23
same-entity Vehicle method1 HP/state event within ±0.15 s      : 17 / 23
```

By contrast, for `field3=1`:

```text
same-entity method8 within ±0.15 s : 12 / 718
same-entity method1 within ±0.15 s : 13 / 718
```

Neither state branch aligns with enemy Type5 observation entry, Type4 observation leave, or wrapper6 death records at the same clock.

Therefore `field3=8` is not a generic visibility or death marker. It is strongly a **damage-triggered entity-state subfamily**.

The 23 events occur in only two current arenas, so this is not enough evidence to assign a user-facing symbolic label such as damaged-module, hit reaction, stun, or another specific status.

Verdict:

```text
wrapper16 overall         = active entity-state/event family — PARTIAL
wrapper16 field1          = entity / vehicle ID — PROVEN structure
wrapper16 field2          = constant 1 in current corpus — raw-preserve
wrapper16 field3=8        = damage-triggered state/event branch — STRONG PARTIAL
wrapper16 field3=1        = dominant state/event branch — PARTIAL
```

### Historical numeric mapping is rejected as a direct name

A historical Wargaming `ARENA_UPDATE` table assigns numeric update 16 to `FLAG_TEAMS`. That name does not match the current Blitz 11.19 wrapper16 payload or its damage-adjacent behavior.

Therefore this is another explicit version/schema-divergence case:

> do **not** label current Blitz wrapper16 as `FLAG_TEAMS` merely from historical numeric equality.

## Product implications

- wrapper7 can safely support prebattle entity-ready/lifecycle reconstruction.
- wrapper7 must not be treated as a 14-player-only business roster because observer/non-combatant IDs can be present.
- wrapper16 `field3=8` is useful as evidence around damage reactions, but is not yet safe for a specific UI status.
- raw wrapper16 fields must remain preserved until a controlled or independent current-version schema closes the exact enum.
