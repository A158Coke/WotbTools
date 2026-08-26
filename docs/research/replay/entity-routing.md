# EntityMethod routing and entity-class scope

> Corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China (`11.19.0_china` + `11.19.0_china_apple`).

## Core finding

`Type 8` is a generic BigWorld `EntityMethod` envelope. The `subtype`/method index is **not a globally unique semantic ID**. It is meaningful only together with the **target entity class**.

Envelope:

```text
entityId : u32 LE
methodId : u32 LE
argLen   : u32 LE
args     : argLen bytes
```

All 69,515 Type-8 packets in the corpus satisfy `payload.length == 12 + argLen`.

## How the recorder Avatar entity is identified

Each replay has exactly one subtype-49 initialization/options message. Its outer `entityId` is used as the recorder Avatar entity for classification. Independent evidence:

- subtype 47 chat-action messages are all addressed to the same entity;
- subtype 48 arena-update wrappers are all addressed to the same entity;
- subtype 49 contains recorder-local synchronized client options;
- top-level BasePlayerCreate / CellPlayerCreate / control packets use the same player/avatar identity chain.

The corpus has 39 unique Avatar entity IDs across 44 files because several files are duplicate POV captures of the same session/battle set.

## Vehicle entity set

Subtype-48 wrapper-1 roster snapshots provide per-battle entity IDs. These are cross-checked against settlement accounts/teams and vehicle-targeted health/damage messages.

## Method target classification

| method/subtype | packets | target=Avatar | target in roster vehicle/entity set | classification |
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

## Consequence

A decoder such as:

```text
switch (subtype) {
  case 8 -> damage;
  ...
}
```

is not a safe protocol abstraction by itself. It is only safe when the decoder has already proved that the target entity is the expected class/version.

Correct conceptual dispatch is:

```text
(entityClass, methodId, clientVersion) -> method schema
```

The method ID may be reused by another entity class for a completely different RPC.

## Current examples

- Vehicle-targeted subtype 1: health/state method family; terminal form carries killer/attacker relationship.
- Vehicle-targeted subtype 8: damage-notification family in the supported current variants.
- Avatar-targeted subtype 47: `CHAT_ACTION_DATA`.
- Avatar-targeted subtype 48: arena-update wrapper container.
- Avatar-targeted subtype 49: compressed synchronized client-options snapshot.

Therefore any documentation that says simply `subtype 8 = damage` or `subtype 47 = updateArena` without target-class/version qualification is superseded.

## Historical compatibility warning

Older Blitz parsers mapped subtype 47 to an `UpdateArena` protobuf. The current 11.19 corpus proves subtype 47 is chat-action data on the Avatar target and subtype 48 carries current arena-update wrappers. Method indices drift with entity definitions/client versions, so old numeric tables must be version-gated rather than copied forward.

## Verdict

- Type-8 envelope: `PROVEN`.
- Entity-class-scoped method IDs: `PROVEN` on current corpus and consistent with BigWorld entity method dispatch design.
- Recorder Avatar target classification: `PROVEN` on current corpus.
- Global `subtype -> semantic` mapping without entity class: **INVALID / SUPERSEDED**.
