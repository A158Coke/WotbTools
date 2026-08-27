# Type32 — nested/slice entity-property transport

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> This note supersedes the architectural description of Type32 as a generic “entity effect/auxiliary blob”. The byte-level envelope remains correct, but independent BigWorld transport evidence now identifies the packet family much more narrowly.

## Executive verdict

Current evidence supports:

```text
Type32
  = replay capture of nested/slice entity-property updates
  ≈ BigWorld onNestedEntityProperty(entityID, data, isSlice)
```

Evidence level:

- **PROVEN physical role:** entity-scoped nested property-change transport;
- **PARTIAL symbolic replay name:** historical Blitz exposes `MSG_ON_NESTED_ENTITY_PROPERTY`, but the exact Blitz 11.19 numeric enum mapping has not been recovered from a version-matched producer;
- **PARTIAL/strong `flag == isSlice`:** the current outer boolean is structurally and behaviorally consistent with BigWorld's `isSlice`, but a version-matched recorder implementation is still missing.

The old “Type32 effect kind” interpretation remains **SUPERSEDED**.

## Current 11.19 envelope

Across all 16,850 Type32 packets in the strict 34-arena corpus:

```text
entityId   : u32 LE
flag       : u8
bodyLength : u32 LE
body       : bodyLength bytes
```

and:

```text
bodyLength == payloadLength - 9 : 16,850 / 16,850
mismatch                         : 0
```

Observed body families:

```text
flag=0 -> bodyLength 15 / 16
flag=1 -> bodyLength 2 / 3 / 4 / 5 / 6 / 17 / 18
```

## Independent BigWorld transport evidence

BigWorld's client-side property transport has a dedicated callback:

```text
onNestedEntityProperty(entityID, data, isSlice)
```

with two network entry points:

```text
nestedEntityProperty(stream)
    -> onNestedEntityProperty(selectedEntityID, stream, false)

sliceEntityProperty(stream)
    -> onNestedEntityProperty(selectedEntityID, stream, true)
```

The nested/slice decoder then applies the compressed property path to the entity's property owner.

This is an unusually close structural match to the current replay Type32 envelope:

```text
BigWorld callback              current Type32
-------------------------------------------------
entityID                       u32 entityId
isSlice                        u8 flag candidate
BinaryIStream data             u32 length + body bytes
```

Historical Blitz replay strings independently list `MSG_ON_NESTED_ENTITY_PROPERTY` among replay message names.

No other known current Type32 interpretation explains the outer entity id, boolean discriminator, length-prefixed opaque property stream, and the observed nested collection behavior this directly.

## Why the behavior also matches nested properties

### `flag=0`, mobile 15/16-byte family

This family is already behaviorally closed to active consumable/equipment lifecycle updates:

```text
wireCode
state = 1 / 2 / 3 / 255
eventClockRaw
parameterRaw
```

with proven equipment identities including Adrenaline, Engine Power Boost, Multi-Purpose Restoration Pack, Reticle Calibration, Reactive Armor and Tungsten Shells.

Historical Blitz entity definitions expose an `activeEquipments` property.

A mutation of one existing equipment entry is exactly the kind of update expected from a **nested non-slice property change**.

Therefore:

> mobile `flag=0`, 15/16-byte family = **active-equipment nested-update family — PROVEN behavior / PARTIAL exact root-property wire path**.

### `flag=1`, mobile 17/18-byte family

This family is joined byte-for-byte to Vehicle method8 hit/damage notifications and is high-cardinality per hit.

Historical Blitz entity definitions expose a `damageStickers` collection. A new impact mark is naturally represented as an append/insert/slice-style collection mutation.

Therefore:

> mobile `flag=1`, 17/18-byte family = **hit/damage-sticker-like slice-update family — PROVEN hit relationship / PARTIAL exact root-property identity**.

Do not yet rename it unconditionally to `damageStickers` in production until the current Blitz compressed property path is decoded.

### `flag=1`, mobile 2/3-byte family

These compact updates are strongly associated with fire/device/crew damage state and contain repeated terminal bytes in the `0x1F..0x2B` range.

Historical Blitz entity definitions expose separate `criticalDevices` and `destroyedDevices` collections. Compact insert/remove/slice mutations are a natural fit for this family.

New First Aid evidence strengthens that interpretation:

```text
0x0C First Aid activations in strict corpus: 5
preceded by one short Type32 update:         5 / 5
terminal byte of that short update:
  0x27 : 1
  0x29 : 3
  0x2B : 1
```

By contrast:

```text
terminal byte 0x28 short updates: 291
followed by 0x0C First Aid within 3 s: 0
```

The current safe verdict is:

> mobile `flag=1`, 2/3-byte family = **critical/destroyed device-or-crew collection mutation family — PARTIAL**, with `0x27/0x29/0x2B` strongly First-Aid-compatible.

The terminal byte must not yet be published as a specific crew member name.

### static `flag=1`, 3/4/5/6-byte family

Type32 also targets Type5 `entityTypeId=3` static entities. Under the nested-property model this is expected: static/destructible entities can expose their own collection/state properties and receive slice mutations without being combat vehicles.

This is a better architectural fit than calling every static Type32 packet a generic “effect”.

## `flag` as `isSlice`

The current boolean discriminator has the exact domain required by BigWorld's callback:

```text
0 / 1 only
```

The observed family split is behaviorally consistent with:

```text
flag=0 -> nested single-value/member update
flag=1 -> slice/list/collection mutation
```

Examples:

- equipment entry lifecycle -> `flag=0`;
- hit-sticker-like insertion -> `flag=1`;
- compact critical/destroyed device list mutation -> `flag=1`;
- static collection/state mutations -> `flag=1`.

This is strong convergent evidence, but until a Blitz 11.19 replay-recorder producer is recovered the archive keeps the exact equality `flag == isSlice` at **PARTIAL/strong**, not universal `PROVEN`.

## Architectural correction

The old conceptual model:

```text
Type32 = arbitrary entity effect packet
```

should be replaced by:

```text
Type32NestedPropertyRaw {
    rawClockSec
    entityId
    isSliceCandidate
    bodyLength
    compressedPropertyChangeBytes
}
```

Semantic decoding must happen one level deeper:

```text
compressed property path
    -> root property family
    -> nested index/key/slice
    -> new value / inserted value / removed range
```

This explains why body length alone never formed a valid global event enum.

## Consequences for reverse engineering

The highest-value next step is no longer guessing short event IDs. It is recovering the **compressed property path** used by BigWorld's `PropertyChangeReader` for the current Vehicle and static entity schemas.

Once root paths are decoded, the current families should become directly testable against historical property names:

```text
activeEquipments
criticalDevices
destroyedDevices
damageStickers
```

and the `0x27 / 0x29 / 0x2B` First-Aid-compatible values can be interpreted as values/indices inside the correct collection instead of as global Type32 event IDs.

## Production safety rule

Until compressed paths are decoded:

1. preserve `entityId`, `flag`, `bodyLength`, and `body` losslessly;
2. keep existing version-gated behavioral decoders for consumables and fire;
3. do not expose the last short-body byte as a universal module/crew ID;
4. do not assume historical PC/Blitz property ordering equals current 11.19 ordering;
5. model Type32 as nested-property transport, not a flat effect enum.
