# Avatar method46 — team tactical marker / quick-command family

> Corpus: strict-framing 34 unique Blitz 11.19 China arenas.
>
> Numeric method IDs are Avatar/version scoped. Exact user-facing command labels are intentionally not guessed.

## Executive verdict

Avatar method46 carries a source combatant identity plus one of several tactical-target payload variants:

```text
sourceVehicleId : u32
sourceAccountId : u32
reservedZero    : u32  // 0 in 89 / 89
payloadLen      : u8
payload         : protobuf-like union
```

Observed union branches:

```text
field 1 -> world-position VECTOR3       (78 events)
field 4 -> target friendly vehicle ID   ( 6 events)
field 5 -> target friendly vehicle ID   ( 5 events)
```

The identity and target structure is PROVEN. The overall family is best described as a **team tactical marker / quick-command communication family**. Exact field4/field5 button semantics remain PARTIAL.

## Corpus shape

```text
method46 events : 89
arg lengths:
  32 B : 78
  21 B :  9
  20 B :  2
```

All events target the recorder Avatar RPC surface rather than a vehicle entity method.

## Source identity closure

The first two u32 values were initially ambiguous because source account IDs around `3.1e9` also decode to meaningless tiny float32 values. Current-version identity checks close them as integer IDs.

For every arena, vehicle entities are independently mapped to settlement accounts by joining:

```text
Type5 vehicle-create entity ID
+ vehicle-create nickname
+ #201 settlement roster nickname/account ID
```

This produces 543 independently resolved vehicle-to-account mappings across the strict corpus.

Method46 result:

```text
method46 sourceVehicleId resolves to sourceAccountId : 89 / 89
reserved u32                                         :  0 / 89 non-zero
```

Therefore the header is not an arbitrary float/control block; it is a combatant identity tuple.

## World-position branch

The 78 longest variants have:

```text
payloadLen = 0x13
payload    = field1 -> nested VECTOR3 float32
```

The VECTOR3 values are valid arena-scale world positions. They do not mirror:

- the source vehicle's current position;
- the recorder Type39 camera/aim values;
- projectile terminal points;
- same-clock damage or shot geometry.

This makes the branch consistent with a player-selected map/world marker rather than automatic vehicle telemetry.

## Vehicle-target branches

The 11 short variants decode as:

```text
field4 -> nested field2 = targetVehicleEntityId
field5 -> nested field2 = targetVehicleEntityId
```

All 11 target IDs resolve to real combat vehicles.

Team relationship:

```text
field4 target same team as source : 6 / 6
field5 target same team as source : 5 / 5
enemy target                      : 0 / 11
```

Thus these branches are friendly-unit-directed tactical actions, not enemy attack-target markers in the current corpus.

## Negative timing evidence

Method46 does not behave like a damage/shot RPC. Across all 89 events there is no exact-clock overlap with the primary combat families:

```text
Vehicle method8 damage
Vehicle method0 showShooting
Avatar method20 stopTracer
Avatar method27 projectile resolution
Avatar method29 launch
Avatar method38 recorder shot result
Avatar method16 damage info
Avatar method17 ammunition state
Avatar method19 vehicle misc status
Avatar method35/36 gun/targeting state
```

Therefore interpreting method46 as hit direction, projectile impact, or weapon-state telemetry is rejected.

## Current semantic level

Safe interpretation:

```text
TeamTacticalCommandEvent {
    rawClockSec
    sourceVehicleEntityId
    sourceAccountId
    targetKind      // WORLD_POSITION | FRIENDLY_VEHICLE_FIELD4 | FRIENDLY_VEHICLE_FIELD5
    worldPosition?  // field1
    targetVehicle?  // field4/field5
    actionFieldRaw
}
```

The family-level interpretation is supported by:

- exact source player identity;
- explicit world-position targeting;
- explicit friendly-vehicle targeting;
- low event frequency consistent with user tactical actions;
- lack of synchronization with automatic damage/projectile state.

Do not yet expose field4/field5 as named commands such as `help`, `follow`, `attention`, or `affirmative` without a current-version command enum or controlled UI replay.

## Product value

Once exact action enums are recovered, this family can provide unusually valuable tactical context:

- team map pings/markers;
- friendly-unit-directed requests;
- AI Review correlation between communicated plan and subsequent movement;
- Battle Playback tactical marker overlay.

Until then, consumers may retain raw typed targets but should avoid fabricating text labels.
