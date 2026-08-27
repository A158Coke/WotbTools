# Avatar method16 — vehicle damage-info relationship

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Numeric method IDs are entity-class and client-version scoped.

## Executive verdict

Avatar method16 is a fixed 10-byte vehicle damage-information family. Its outer Avatar target is the recorder Avatar, while the payload identifies a victim vehicle, two small damage/extra codes, and a related vehicle/entity ID.

Current behavioral closure:

> **Avatar method16 = vehicle damage-info / extra-damage presentation family — PROVEN relationship / PARTIAL exact symbolic field names.**

The historical Wargaming `showVehicleDamageInfo(vehicleID, damageIndex, extraIndex, entityID, equipmentID)` family is strong structural precedent, but current Blitz 11.19 is not assumed to have the identical signature.

## Fixed payload

All 355 observations are exactly 10 bytes:

```text
vehicleId      : u32 LE   [0..4)
codeA          : u8       [4]
codeB          : u8       [5]
relatedEntity  : u32 LE   [6..10)
```

All 355 `vehicleId` values resolve to a combat vehicle in the current arena.

## Direct damage relationship

Vehicle method8 is independently established as a current damage-notification family. Its current supported body carries attacker/victim identity, and the method is invoked on the victim vehicle entity.

Joining method16 to same-clock Vehicle method8 events gives:

```text
method16 total                         = 355
same-clock Vehicle method8             = 176
exact method16.vehicleId == victim AND
      method16.relatedEntity == attacker = 170
victim-only relation                     =   2
other / ambiguous multi-event boundary   =   4
```

So for the overwhelming majority of clean same-clock damage samples:

```text
method16.vehicleId      = victim
method16.relatedEntity  = attacker
```

This is a direct per-event relationship, not a frequency-only correlation.

## Set/clear-like dual behavior

The remaining population reveals a strong second mode:

```text
same-clock damage + relatedEntity is valid vehicle : 171
no same-clock damage + relatedEntity == 0          : 171
```

with only a small number of boundary/other cases.

This suggests method16 is not simply a duplicate damage-number RPC. It behaves like presentation/state information carrying:

- victim identity;
- damage/extra category codes;
- optional source/attacker entity;
- source-less or clear/state transitions where `relatedEntity=0`.

The exact lifecycle meaning of the zero-source mode remains PARTIAL.

## codeA / codeB

The two one-byte fields have compact structured domains rather than arbitrary data.

Frequent `(codeA, codeB)` pairs include:

```text
(26,  0)
(19, 34)
( 0, 35)
(19, 35)
( 4, 34)
( 0, 34)
( 5, 34)
( 4, 32)
( 4, 35)
( 5, 35)
(19, 32)
```

The second field is often in the `31..43` range, which is consistent with an extra/device/tankman index family. The first field is consistent with a damage-info category family.

However, current evidence does **not** yet justify assigning individual symbolic names to every value.

## Historical structural support

Historical Wargaming client code uses a vehicle damage-information RPC family conceptually shaped as:

```text
showVehicleDamageInfo(
    vehicleID,
    damageIndex,
    extraIndex,
    entityID,
    equipmentID
)
```

and historical damage-code families include device/module and tankman/crew presentation states.

Current method16 has the same core behavioral responsibility:

```text
victim vehicle
+ compact damage category
+ compact extra index
+ related attacker/source entity
```

But because current Blitz payload width differs, the exact historical signature must not be copied field-for-field.

## Consumer contract

```text
VehicleDamageInfoEvent {
    rawClockSec
    vehicleId          // proven victim relation on clean same-clock damage
    codeARaw
    codeBRaw
    relatedEntityId    // proven attacker relation on clean same-clock damage; may be 0
    confidence
}
```

Safe uses:

- preserve extra combat-state evidence associated with a hit;
- join to Vehicle method8 damage and method38 recorder shot feedback;
- use as a future bridge for module/crew semantic decoding once code mappings close.

Unsafe today:

- naming `codeA` or `codeB` as a specific module/crew role without controlled/current-version closure;
- treating every method16 event as HP damage;
- treating `relatedEntity=0` as a specific attacker or environment reason without proof.
