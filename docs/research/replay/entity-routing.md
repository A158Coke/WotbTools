# Entity routing and entity-class scope

> Corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China (`11.19.0_china` + `11.19.0_china_apple`).

## Core finding

Both `Type 8` (`EntityMethod`) and `Type 7` (`EntityProperty`) use **entity-class-scoped numeric indices**. A method/property number is not, by itself, a globally unique semantic identifier.

Safe conceptual dispatch is therefore:

```text
(clientVersion, entityClass, methodId) -> method schema
(clientVersion, entityClass, propertyId) -> property schema
```

A decoder that switches only on the numeric ID can accidentally assign one entity class's meaning to another entity class using the same index.

## How the recorder Avatar entity is identified

Each replay has exactly one Avatar subtype-49 synchronized-options message. Its outer `entityId` is used as the recorder Avatar entity for classification. Independent evidence:

- Avatar method 47 chat-action messages target the same entity;
- Avatar method 48 arena-update wrappers target the same entity;
- Avatar method 49 contains recorder-local synchronized client options;
- BasePlayerCreate / player-cell/control data link to the same recorder identity.

The corpus has 39 unique Avatar entity IDs across 44 files because several files are duplicate POV captures of the same sessions/battles.

## Vehicle entity set

Avatar method-48 wrapper-1 `VEHICLE_LIST` snapshots provide the arena entity IDs. They are cross-checked against settlement identity/team records and vehicle-targeted health/damage/property packets.

# Type 8 — EntityMethod routing

Envelope:

```text
entityId : u32 LE
methodId : u32 LE
argLen   : u32 LE
args     : argLen bytes
```

All 69,515 Type-8 packets satisfy `payload.length == 12 + argLen`.

| method ID | packets | target=Avatar | target in roster vehicle/entity set | classification |
|---:|---:|---:|---:|---|
| 0 | 5,542 | 0% | 99.1% | Vehicle-family method |
| 1 | 4,531 | 0% | 100% | Vehicle-family method |
| 2 | 315 | 73.3% | 26.7% | **class-colliding method index** |
| 3 | 92 | 100% | 0% | Avatar-family method |
| 4 | 238 | 16.8% | 83.2% | **class-colliding method index** |
| 5 | 389 | 99.2% | 0.8% | **class-colliding method index** |
| 6 | 319 | 0% | 100% | Vehicle-family method |
| 7 | 2,613 | 100% | 0% | Avatar-family method |
| 8 | 5,417 | 7.3% | 92.7% | **class-colliding method index** |
| 12 | 737 | 100% | 0% | Avatar-family method |
| 13 | 1,512 | 100% | 0% | Avatar-family method |
| 16 | 467 | 100% | 0% | Avatar-family method |
| 17 | 2,724 | 100% | 0% | Avatar-family method |
| 19 | 171 | 100% | 0% | Avatar-family method |
| 20 | 5,750 | 100% | 0% | Avatar-family method |
| 25 | 117 | 100% | 0% | Avatar-family method |
| 27 | 702 | 100% | 0% | Avatar-family method |
| 28 | 30 | 100% | 0% | Avatar-family method |
| 29 | 5,602 | 100% | 0% | Avatar-family method |
| 35 | 318 | 100% | 0% | Avatar-family method |
| 36 | 1,142 | 100% | 0% | Avatar-family method |
| 38 | 391 | 100% | 0% | Avatar-family method |
| 39 | 1,165 | 100% | 0% | Avatar-family method |
| 43 | 15 | 100% | 0% | Avatar-family method |
| 44 | 44 | 100% | 0% | Avatar-family method |
| 46 | 103 | 100% | 0% | Avatar-family method |
| 47 | 1,845 | 100% | 0% | Avatar chat-action method |
| 48 | 27,180 | 100% | 0% | Avatar arena-update wrapper method |
| 49 | 44 | 100% | 0% | Avatar synchronized-options initialization method |

Current closed examples:

- Vehicle method 1: health/state method family; terminal form carries killer/attacker relationship.
- Vehicle method 8: damage-notification family in supported current variants.
- Avatar method 47: `CHAT_ACTION_DATA`.
- Avatar method 48: arena-update wrapper container.
- Avatar method 49: compressed synchronized client-options snapshot.

Therefore statements such as `subtype 8 = damage` or `subtype 47 = updateArena` are incomplete unless entity class and version are stated.

# Type 7 — EntityProperty routing

Envelope:

```text
entityId : u32 LE
propertyId : u32 LE
valueLen : u32 LE
value : valueLen bytes
```

The same class-scope rule is independently visible in Type 7.

| property ID | packets | Avatar target | roster-vehicle target | current routing verdict |
|---:|---:|---:|---:|---|
| 0 | 85,012 | 0 | 85,012 | Vehicle-only in current corpus |
| 1 | 463 | 0 | 463 | Vehicle-only |
| 2 | 826,191 | 0 | 826,191 | Vehicle-only; turret-relative yaw |
| 3 | 4,531 | 0 | 4,531 | Vehicle-only; current HP |
| 4 | 195,756 | 2 | 195,754 | **class-colliding property index** |
| 7 | 415 | 0 | 415 | Vehicle-only |
| 8 | 1,052 | 0 | 1,052 | Vehicle-only |
| 9 | 89,351 | 88,945 | 406 | **class-colliding property index; overwhelmingly Avatar-family** |
| 10 | 357 | 357 | 0 | Avatar-only |
| 11 | 64 | 64 | 0 | Avatar-only |
| 12 | 20 | 20 | 0 | Avatar-only |
| 13 | 17 | 17 | 0 | Avatar-only |

This corrects the earlier research habit of treating the Type-7 numeric property ID as globally meaningful. In particular, property 9 cannot be described as one universal float-like vehicle property: 88,945/89,351 current observations target the recorder Avatar, while 406 target roster entities.

The two Avatar-targeted property-4 records similarly prove that even a strongly vehicle-dominated index must remain class-qualified.

## Consequence for parser architecture

Unsafe:

```text
switch (propertyId) {
  case 3 -> health;
  case 9 -> someVehicleFloat;
}
```

Safer:

```text
entityClass = resolveEntityClass(entityId, replayContext)
schema = propertySchemas.lookup(clientVersion, entityClass, propertyId)
```

If entity class is unresolved, preserve raw bytes and numeric ID rather than borrowing a semantic from another class.

## Historical compatibility warning

Older Blitz/PC protocol tables remain useful as schema evidence, but method/property indices drift as entity definitions and inherited interfaces change. Historical numeric tables must be version-gated and checked against current target class, payload width and behavior before semantic promotion.

## Verdict

- Type-8 envelope: `PROVEN`.
- Type-7 envelope: `PROVEN`.
- Entity-class-scoped method IDs: `PROVEN` on current corpus and consistent with BigWorld entity dispatch.
- Entity-class-scoped property IDs: `PROVEN` on current corpus.
- Recorder Avatar target classification: `PROVEN` on current corpus.
- Global numeric `methodId/propertyId -> semantic` mapping without entity class/version: **INVALID / SUPERSEDED**.
