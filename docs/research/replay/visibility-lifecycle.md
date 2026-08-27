# Enemy visibility / client-AoI lifecycle

> Corpus: strict-framing 34 unique arenas from the 44-file Blitz 11.19.0 China research corpus.
>
> This document separates **client-observed entity visibility/AoI presence** from death. That distinction is required for correct last-known positions, AI evidence and battle playback.

## Executive verdict

The current corpus proves this enemy-entity lifecycle:

```text
VISIBLE / present in client-observed entity set
  |
  | Type4(entityId)
  v
HIDDEN / outside client-observed entity-AoI set
  |
  | no Type7 / Type8 / Type10 updates for that eid
  |
  | Type33(entityId, zero payload tail)
  | Type5(entityId, full materialization/state block)
  v
VISIBLE / materialized again
```

`Type4` is **not death**.

The exact engine/API symbol (for example leaveAoI / entityLeave / visibility removal) remains version-specific, but the physical client-observation semantics are closed for this corpus.

## Type4 — enemy leaves client-observed entity/AoI set

Observed Type4 structure:

```text
entityId : u32 LE
```

Total current count:

```text
503
```

Team classification is decisive:

```text
enemy vehicle Type4 : 503 / 503
ally vehicle Type4  :   0 / 503
```

All 503 entity IDs belong to settled combat vehicles.

### Re-entry disproves death semantics

Of the 503 Type4 events:

```text
485 / 503
```

are followed later in the **same replay** by a new Type33 -> Type5 lifecycle pair for the exact same entity ID.

Observed time from Type4 to the next Type33 re-entry:

```text
median ~10.30 s
range  ~0.094 .. 207.44 s
```

The corresponding Type5 follows shortly afterward.

Therefore:

> `Type4 == death/destroyed` is **REJECTED**.

A vehicle cannot be destroyed, then repeatedly re-enter as the same live combat entity minutes later.

Verdict:

> Type4 is an **enemy client-observation/AoI removal event** — `PROVEN physical role` on the current corpus.

## Type33 and Type5 are a one-to-one re/materialization pair

Corpus totals:

```text
Type33 : 3,869
Type5  : 3,869
```

Grouping by replay and entity ID produces:

```text
3,384 distinct replay/eid occurrence groups
count(Type33) == count(Type5) in every group
0 count mismatches
```

Pairing occurrences in order gives:

```text
Type33 always precedes Type5
Type5 - Type33:
  min    ~0.046 s
  median ~0.400 s
  max    ~1.207 s
```

Type33 has the stable current shape:

```text
entityId : u32 LE
8 bytes  : zero
```

Type5 is the subsequent variable-length entity materialization/state payload; settled combat vehicles commonly carry ~200+ byte forms while many non-vehicle/static entities use shorter fixed families such as 51 bytes.

Verdict:

> Type33 -> Type5 is a **paired entity re-entry/materialization lifecycle** — `PROVEN relationship`; exact BigWorld symbolic packet names remain `PARTIAL`.

## Hard blackout between Type4 and re-entry

For every one of the 485 Type4 -> next Type33 enemy re-entry intervals, the same entity ID was checked for canonical gameplay updates.

Result:

```text
Type7 EntityProperty updates inside hidden interval : 0
Type8 EntityMethod updates inside hidden interval   : 0
Type10 Position updates inside hidden interval      : 0
```

There are **zero counterexamples** in the current corpus.

This is much stronger than a UI-visibility correlation. The entity leaves the replay client's active observation/update set: position, HP/property and methods all stop until materialization resumes.

Verdict:

> The interval is a true **client-unobserved/AoI-off interval** for that enemy entity — `PROVEN`.

Whether the server's gameplay term is exactly `unspotted`, `out of AoI`, or another visibility subsystem label is kept separate from the proven transport behavior. Consumers may safely call it `clientObserved=false`; user-facing spotted terminology should remain version/gameplay-context aware.

## Last-known position semantics

Every one of the 485 closed hidden intervals has a Type10 position immediately before Type4 and a new Type10 after re-entry.

### Last position before disappearance

```text
485 / 485 have a preceding Type10

Type4 time - last Type10 time:
  min    ~0.031 s
  median ~0.101 s
  p90    ~0.192 s
  p99    ~0.217 s
  max    ~0.240 s
```

Therefore the final Type10 before Type4 is an extremely tight protocol-supported **last-known position**.

### First position after re-entry

```text
485 / 485 have a following Type10

first Type10 - Type33:
  median ~0.299 s
  max    ~0.434 s

first Type10 - Type5:
  median ~0.100 s
  p99    ~0.140 s
  max    ~0.232 s
```

This places Type5 immediately before normal position streaming resumes.

## Canonical visibility state machine

Safe reconstruction model:

```text
on Type10 / active observed updates:
    entity.clientObserved = true
    entity.lastKnownPosition = current position

on Type4(enemyEntity):
    entity.clientObserved = false
    freeze lastKnownPosition at final pre-Type4 Type10
    DO NOT mark dead

while clientObserved == false:
    do not interpolate hidden movement
    do not synthesize HP/method events
    preserve last-known position only

on Type33(enemyEntity):
    begin re-entry/materialization

on Type5(enemyEntity):
    materialized in client observation set

on first new Type10:
    entity.clientObserved = true
    replace stale last-known position with newly observed position
```

This exactly supports a grey last-known marker in battle playback without inventing hidden enemy motion.

## Relationship to death

Death remains an independent fact sourced from settlement `lifeTime` / `killerID` / `deathReason` and exact terminal HP/death events when present.

An enemy can:

```text
Type4 disappear
Type33/Type5 re-enter
continue fighting
later die
```

Therefore visibility/AoI lifecycle must never be used as a death fallback.

Likewise, a replay stream can terminate while an enemy remains unobserved; absence of re-entry is not proof of death.

## AI / playback consumer guidance

### AI Review

Safe evidence:

```text
"enemy last observed near X at time T"
```

when T is the last Type10 before Type4.

Unsafe inference:

```text
"enemy stayed at X until re-spotted"
```

because no position information exists in the blackout interval.

### Battle Playback

Safe behavior:

- show live marker while observed;
- on Type4, freeze a visually distinct last-known marker at the final known position;
- do not animate the enemy through hidden time;
- on Type33/Type5 + resumed Type10, transition to the newly observed position/state;
- death is applied only from the independent death fact layer.

## Remaining work

1. Recover the version-matched BigWorld/Blitz symbolic names for Type33 and Type5.
2. Determine whether Type4 maps exactly to gameplay `unspotted` or to a broader client AoI removal condition.
3. Correlate first appearance at battle start with team visibility rules and any separate spotted-notification RPC.
4. Test additional random-battle/current-version samples because training/tournament observation rules may differ.
5. Decode Type5 field-by-field: entity class/type, initial transform, vehicle state and embedded identity/configuration fields.
