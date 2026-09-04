# Entity materialization and transform bootstrap

> Corpus: strict-framing 34 unique arenas from the 44-file Blitz 11.19.0 China research corpus, with one independent T-100 LT sample used for later loadout closure.
>
> This document records the relationship between Type33, Type5 and Type10. The goal is to separate an entity's **transport/materialization lifecycle** from combat death, participant identity, and later continuous position streaming.

## Executive verdict

The current corpus proves the following sequence for entities that become materialized in the replay client's observed world:

```text
Type33(entityId, 8 zero bytes)
    |
    | ~0.046 .. 1.207 s, median ~0.400 s
    v
Type5(
    entityId,
    entityTypeId,
    initial transform/state block,
    entity-class-specific initialization payload
)
    |
    | for mobile entityTypeId=2, normal Type10 follows
    v
Type10 continuous transform/position stream
```

Type5 is therefore not an opaque "enterWorld-ish" packet anymore. Its current physical role is **entity materialization with an initial transform/state snapshot and class-specific initialization data**.

For the reviewed mobile/loadout-shaped Type5 family, part of that class-specific initialization is independently decoded as:

```text
3 consumable descriptors
3 provision descriptors
9 equipment IDs
```

This is structural loadout evidence, not participant identity evidence. A valid 3+3+9 Type5 payload does **not** by itself prove that the entity is a `battle_results.dat #301` settled combatant. Participant identity is established independently through entity/account mapping plus settlement evidence. See [`loadout-materialization.md`](loadout-materialization.md) and [`observer-provision-wirecodes.md`](observer-provision-wirecodes.md).

Exact historical BigWorld symbolic message names remain `PARTIAL` until a version-matched transport schema is recovered.

## Type33 / Type5 one-to-one pairing

On the strict 34-arena corpus:

```text
Type33 total : 3,869
Type5 total  : 3,869
```

Grouping occurrences by replay and entity ID gives a one-to-one lifecycle relationship with no count conflicts.

Observed timing:

```text
Type33 always precedes Type5
Type5 - Type33:
  min    ~0.046 s
  median ~0.400 s
  max    ~1.207 s
```

Type33 current payload shape:

```text
entityId : u32 LE
zeroTail : 8 bytes, all zero in current corpus
```

Verdict:

> Type33 is a **pre-materialization / entry-announcement stage** and Type5 is the corresponding **materialization/state stage** — `PROVEN relationship / PARTIAL symbolic names`.

## Type5 outer structure

All current Type5 records begin with:

```text
entityId     : u32 LE
entityTypeId : u16 LE
...          : transform/state bootstrap + class-specific initialization
```

Observed `entityTypeId` domain:

```text
2 : 1,096 records
3 : 2,713 records
```

Settlement classification:

```text
entityTypeId=2:
  settled combat vehicles : 960
  other observed entities : 136

entityTypeId=3:
  settled combat vehicles : 0
  other/static entities   : 2,713
```

Therefore the numeric type ID is real and strongly class-selective in this Blitz version, but **entityTypeId=2 is not equivalent to #301 settled combatant identity**. It must remain version-gated; do not transplant PC entity type numbers or collapse class evidence into settlement identity.

## Initial transform block is structurally tied to Type10

The decisive result is the Type5-to-Type10 prefix comparison.

Every `entityTypeId=2` Type5 record in the corpus has a following Type10 for the same entity ID:

```text
1,096 / 1,096
```

For every one of those 1,096 pairs:

```text
Type5 bytes [6..14)
==
first-following-Type10 bytes [4..12)
```

That is a **1,096 / 1,096 exact match** for the initial transform/state prefix after removing Type5's additional `entityTypeId` field and Type10's leading entity ID.

The first Type10 arrives shortly after materialization:

```text
first Type10 - Type5:
  median ~0.10 s
  max    ~0.705 s
```

The following float/vector portion is also spatially continuous between Type5 and the first Type10, as expected for an initial transform followed by normal movement updates.

Verdict:

> Type5 embeds the **initial transform/state bootstrap for the entity**, using the same transport family later carried continuously by Type10 — `PROVEN` on current mobile entity samples.

## Variable payload size separates transform from class initialization

Type5 record lengths split into broad families.

### `entityTypeId=3` / static-family records

The dominant form is:

```text
51 bytes : 2,713 records
```

This is consistent with:

```text
entityId + entityTypeId + compact transform/state payload
```

without a large vehicle-specific initialization block.

### `entityTypeId=2` / mobile vehicle-family records

Vehicle/mobile-family records are much larger and variable, commonly around:

```text
~208 .. 282 bytes
```

with many distinct lengths.

Their first transform/state region is followed by additional entity-specific data containing observable identity/configuration material. This explains why Type5 must not be treated as merely a position packet with a different header.

Verdict:

> Type5 consists of a **common materialization transform prefix plus entity-class-specific initialization data** — `PROVEN structure / PARTIAL complete field-level schema`.

## Decoded loadout-shaped Type5 tail

The reviewed loadout-shaped Type5 population exposes a stable tail:

```text
0A 06
  6 × 14-byte item descriptors
0B 09
  9 equipment-ID bytes
```

Across the current 34-arena corpus plus one independent T-100 LT sample, the original structural scan found:

```text
Type5 payloads with valid 9-byte equipment surface : 1,097
full six-item loadout-shaped family                : 1,037
four-item non-combat/observer family               :    60
```

For all 1,037 full loadout-shaped records:

```text
item[0..2] = consumable slots : 1,037 / 1,037
item[3..5] = provision slots  : 1,037 / 1,037
```

That proves positional structure only. A later 34-arena participant-boundary re-analysis classified complete 3+3+9 materializations independently against `battle_results.dat #301`:

```text
complete 3+3+9 Type5 materializations : 1,017
mapped to #301 settled combatants      :   960
non-#301 entities                      :    57
```

Therefore:

```text
0A 06 + 3+3+9
  -> loadout-shaped Type5 structure

entity/account mapping + #301 settlement evidence
  -> settled-combatant identity
```

Do not collapse those two evidence dimensions.

The nine equipment bytes are direct numeric equipment IDs:

```text
equipmentId = unsignedByte(rawEquipmentBytes[slot])
```

Twenty distinct current equipment IDs were naturally observed and all satisfy the byte=ID rule with the expected equipment-grid slot position.

Enemy re-materialization independently proves the loadout surface is not recorder-only:

```text
enemy Type5 re-materializations inspected : 683
complete 3+3+9 loadout surface            : 683 / 683
```

Those enemy identities are established independently; the 3+3+9 shape itself is not the identity proof.

See `loadout-materialization.md` for the full equipment table, provision/consumable wire-code inventory and versioning rules. See `observer-provision-wirecodes.md` for the observer-vs-settled participant boundary.

Verdict:

> the reviewed Type5 family carries **direct loadout materialization — PROVEN structural surface**; settled-combatant status remains an independent evidence dimension.

## Relationship to enemy visibility/AoI lifecycle

For enemy combat vehicles, Type4 removes the entity from the replay client's active observed/AoI set. When the same enemy becomes observable again, the current corpus shows:

```text
Type4
  -> no Type7 / Type8 / Type10 for that eid
  -> Type33
  -> Type5
  -> new Type10 stream
```

See `visibility-lifecycle.md` for the full 485-interval proof and last-known-position semantics.

The important architectural distinction is:

```text
Type4            = observed-entity removal / hidden interval start
Type33 -> Type5  = re-entry + materialization
Type10           = continuous observed transform stream
Death            = independent settlement / HP / kill fact
Participant role = independent entity/account + settlement fact
```

These concerns must not be collapsed into one "entity gone" or "combat vehicle" state.

A useful consequence of loadout materialization is that re-entering enemy vehicles re-send their current initialization/loadout surface rather than requiring the recorder to retain an inferred hidden-state configuration.

## Consumer guidance

A safe reconstruction state machine is:

```text
on Type33(eid):
    entity.lifecycle = MATERIALIZING

on Type5(eid, type, initialState, initPayload):
    entity.lifecycle = MATERIALIZED
    entity.entityTypeId = type
    seed transform/state from Type5

    if supported loadout-shaped tail exists:
        decode 3 consumable wire descriptors
        decode 3 provision wire descriptors
        decode 9 direct equipment IDs

    preserve all remaining undecoded initialization bytes

participant classification:
    resolve independently from entity/account mapping + #301 settlement evidence

on Type10(eid, transform):
    entity.lifecycle = ACTIVE_OBSERVED
    update normal transform timeline

on Type4(enemy eid):
    entity.lifecycle = HIDDEN_AOI
    do not infer death
```

## What is still unresolved

1. Exact symbolic BigWorld/Blitz names for Type33 and Type5.
2. Complete byte-level field map of the common transform/state block beyond the already consumed Type10 coordinates/orientation.
3. Remaining vehicle-specific initialization fields outside the now-proven HP/loadout surfaces.
4. Exact identities for unresolved observer/future provision wire codes such as `0x13` / `0x1A`; settled-combatant production mappings are documented separately.
5. Meaning of the remaining non-settlement `entityTypeId=2` population beyond the observer cases already classified.
6. Full semantics of `entityTypeId=3` static entities and whether additional entity type IDs appear in other game modes/maps.

Until these are closed, preserve unknown initialization bytes and raw wire values rather than discarding them or guessing names.
