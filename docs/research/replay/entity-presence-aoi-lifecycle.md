# Entity presence / AoI lifecycle — Type33 + Type5(type=2) + Type4

> Corpus: strict 34 unique-arena Blitz 11.19.0 China subset.
>
> Scope: physical client-observed vehicle entity presence. This document deliberately does **not** equate presence with server-authoritative spotted state unless independent evidence closes that semantic.

## Executive verdict

Current vehicle entities repeatedly cycle through:

```text
Type33(entityId)
  -> shortly after
Type5(entityId, entityTypeId=2, ...)
  -> Type10 position/property/method traffic while present
  -> Type4(entityId)
  -> no Type10 position traffic while absent
  -> later Type33 + Type5(type=2) again
```

This is a **PROVEN client entity-presence / AoI lifecycle** for the current corpus.

It is stronger than an initialization-only create/destroy interpretation because the same combat vehicle entity ID can leave and later re-enter repeatedly during one battle.

The exact higher-level semantic (`spotted/unspotted`, render/AoI interest, visibility, or another client-presence rule) remains `PARTIAL` until team/visibility-specific closure proves it.

## Type5 entity classes

On the strict 34-arena corpus, Type5 `entityTypeId` values are:

```text
3 : 2713
2 : 1096
8 :   60
```

The `entityTypeId=2` family resolves to combat vehicle entities and is the family studied here.

## Type33 -> Type5(type=2) pairing

Every observed vehicle Type5(type=2) entry has a preceding same-entity Type33 record:

```text
vehicle Type5(type=2) entries : 1096
with preceding same-eid Type33: 1096 / 1096
unpaired                       : 0
```

Observed Type33 -> Type5 delay:

```text
median : ~0.246 s
min    : ~0.046 s
max    : ~1.154 s
```

Therefore Type33 and Type5 are related but distinct lifecycle steps; Type33 is not merely duplicate payload noise.

## Repeated leave/re-enter proof

Across the 34 arenas, there are 485 closed cycles where a vehicle entity has:

```text
Type4 leave
  -> later Type5(type=2) re-entry for the same entity ID
```

This alone disproves `Type4 == death` and disproves `Type5(type=2) == one-time vehicle creation`.

A vehicle can leave the client's entity set and later return without changing entity ID.

## Position-stream negative control

For each of those 485 closed Type4 -> later Type5(type=2) cycles, all Type10 position records for the same vehicle entity were inspected.

Result:

```text
closed leave->re-entry cycles                         : 485
cycles containing any Type10 position inside absence : 0
clean absence windows                                 : 485 / 485
```

So while the entity is between Type4 leave and later Type5 re-entry, its vehicle position stream is completely absent in every closed sample.

Position telemetry resumes only after the entity re-enters.

This is strong independent behavioral proof that the lifecycle controls whether the recording client currently has the vehicle entity in its observable/AoI set.

## Safe interpretation

Current safe model:

```text
VehiclePresence {
    entityId
    presentFrom  // Type33/Type5 entry boundary
    absentFrom   // Type4 leave boundary
    source = CLIENT_REPLAY_AOI
}
```

Safe uses:

- mark intervals where exact live vehicle telemetry is observable by this replay POV;
- stop interpolating fresh positions across a Type4 -> re-entry gap;
- retain the last known position separately from current observed position;
- combine multiple POVs by unioning independent presence evidence while preserving source POV.

Unsafe without further closure:

- label every Type4 as `unspotted`;
- label every Type5(type=2) as `spotted`;
- infer that an absent enemy was definitely invisible to all players;
- treat Type4 as death;
- synthesize movement during an absence interval.

## Product implication

Battle Playback and AI Review should distinguish:

```text
currently observed position
last-known position
entity absent from this POV
terminal/dead state
```

These are different facts. The replay can now provide an exact POV-presence interval boundary even when server-authoritative spotting semantics remain unavailable.

## Remaining work

1. resolve team membership for every Type5(type=2) entity and compare repeated absence cycles for allies vs enemies;
2. correlate entry/leave clocks with any current visibility-related Avatar methods/wrappers;
3. test whether allied vehicles remain continuously present while enemy vehicles cycle, which would support a spotted/unspotted promotion;
4. compare multi-POV duplicates: one POV may have an entity present while another does not;
5. preserve `AoI presence` as the canonical semantic unless stronger evidence proves actual spotting state.
