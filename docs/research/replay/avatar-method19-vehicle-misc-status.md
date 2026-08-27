# Avatar method19 — vehicle misc-status / repair-progress / observed-by-enemy family

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Numeric method IDs and status codes are entity-class/version scoped.

## Executive verdict

Current fixed body:

```text
vehicleId : u32 LE
code      : u8
intArg    : i32/u32 LE
floatArg  : f32 LE
```

Total body length: `13 bytes`.

The current behavior and Wargaming method-family evidence identify this as:

> Avatar method19 = **vehicle miscellaneous status / `updateVehicleMiscStatus` family — PROVEN behavioral/signature identity**.

Observed code values:

```text
code 1 : 89
code 7 : 58
```

# code 1 — `IS_OBSERVED_BY_ENEMY`

Current corpus structure:

```text
records                    : 89
vehicleId == recorder car  : 89 / 89
intArg resolves enemy car  : 89 / 89
floatArg                   : 0 in 89 / 89
```

No code1 record points to an ally.

The same recorder/enemy pair may re-trigger later, but never inside the ordinary 10-second spotting-persistence window:

```text
same recorder↔enemy pair repeat intervals:
count  : 17
min    : ~11.882 s
median : ~35.631 s
max    : ~276.817 s
```

This is incompatible with collision, direct damage, firing, or ordinary aim-target state, and is strongly consistent with a spotting/observation onset that can only fire again after the prior observed state has expired and a new observation occurs.

## Exact companion relationship to wrapper16 state1

Every current method19 code1 event is followed by a wrapper16 state1 broadcast for the recorder's vehicle:

```text
method19 code1 records                       : 89
followed by wrapper16 field3=1 same vehicle : 89 / 89
```

Observed delay:

```text
~0.06 .. 0.14 s
median ~0.100 s
```

This proves that method19 code1 and wrapper16 field3=1 are two surfaces of the same observation/spot-state family:

```text
method19 code1
  -> recorder-local status including enemy entity identity

wrapper16 field3=1
  -> own-team vehicle observation-state broadcast
```

## Symbolic enum closure

Independent Wargaming `VEHICLE_MISC_STATUS` constants expose:

```text
OTHER_VEHICLE_DAMAGED_DEVICES_VISIBLE = 0
IS_OBSERVED_BY_ENEMY                  = 1
_NOT_USED                             = 2
VEHICLE_IS_OVERTURNED                 = 3
VEHICLE_DROWN_WARNING                 = 4
IN_DEATH_ZONE                         = 5
DESTROYED_DEVICE_IS_REPAIRING         = 7
```

The same enum value `7` independently closes against the current method19 repair-progress behavior, giving a strong anchor that this status-number family is structurally stable enough to use as supporting evidence for code1.

Combined with the current 89/89 enemy-entity relationship and the >10-second repeat boundary:

> current `method19 code=1` = **`IS_OBSERVED_BY_ENEMY` / recorder vehicle observed by enemy — PROVEN behavioral identity + strong symbolic closure**.

`intArg` is the enemy entity associated with that observation notification in the current corpus. The exact producer-side wording of whether it is the original spotter, current observer, or notification-source enemy remains version-gated; consumers may safely expose the entity as `observerEnemyEntityIdRaw` rather than overstate server internals.

# code 7 — destroyed-device repairing progress

For `code=7`:

```text
extraIndex = intArg & 0xFF
progress   = (intArg >> 8) & 0xFF
floatArg   = remaining repair seconds
```

Representative ladder:

```text
0x1722 -> extraIndex 0x22, progress 23%, timeLeft 3.261s
0x2E22 -> extraIndex 0x22, progress 46%, timeLeft 2.261s
0x4622 -> extraIndex 0x22, progress 70%, timeLeft 1.261s
0x5D22 -> extraIndex 0x22, progress 93%, timeLeft 0.261s
```

Independent `VEHICLE_MISC_STATUS` constants name value 7 as:

```text
DESTROYED_DEVICE_IS_REPAIRING = 7
```

Verdict:

> current `method19 code=7` = **destroyed-device repairing progress — PROVEN**.

## `extraIndex` is the same device namespace as method16 `codeB`

Current method19 code7 extraIndex distribution:

```text
31 :  4 records
34 : 27 records
35 : 26 records
37 :  1 record
```

Grouping by `(arena, vehicleId, extraIndex)` yields 31 natural repair episodes.

For those episodes:

```text
preceding method16 same vehicle + same codeB + codeA=5 : 30 / 31
following method16 same vehicle + same codeB + codeA=19: 26 / 31
```

This proves:

```text
method19.code7.extraIndex
==
method16.codeB device namespace
```

for the current mechanical-device population.

Verdict:

> **same device namespace — PROVEN current corpus**.

## Current proven / high-confidence device anchors

```text
32 = ammo rack                  PROVEN
34/35 = two track-side devices  PROVEN family
37 = turret rotator             PROVEN on current natural sample / version-scoped
```

### `extraIndex=37` — turret rotator natural closure

One current natural episode has the complete chain:

```text
method16 codeA=5, codeB=37
method19 code=7, extraIndex=37
~0.98 s later
method16 codeA=19, codeB=37
```

Vehicle movement remains substantial during the disabled interval (~12 m/s), while independently proven Vehicle prop2 turret-relative yaw shows turret angular velocity collapse from approximately:

```text
pre-damage median : ~0.80 rad/s
disabled interval : ~0.0018 rad/s
post-repair        : resumes non-zero rotation
```

Verdict:

> current `device extraIndex/codeB 37` = **turret rotator / turret rotation mechanism — PROVEN on the available natural sample, version-scoped**.

## Product model

```text
VehicleMiscStatusEvent {
    rawClockSec
    vehicleId
    codeRaw
    intArgRaw
    floatArgRaw

    observedByEnemy?        // code1
    observerEnemyEntityId?  // code1, preserve as raw relationship

    repairDeviceId?         // code7
    repairProgressPct?      // code7
    repairTimeLeftSec?      // code7
}
```

Safe uses:

- AI Review / playback: mark the recorder's ordinary observed-by-enemy onset and associated enemy source identity;
- combine with wrapper16 state1 for own-team spotting-state reconstruction;
- display destroyed-device automatic repair progress;
- cross-check method16 device state transitions.

## Important boundaries

- ordinary observation-state duration is inferred from current event re-trigger behavior and known Blitz spotting persistence; the packet itself is an onset/status event, not a literal countdown;
- do not confuse ordinary `code1 / wrapper16 state1` with Tracer Shell forced-spot `wrapper16 state8`;
- numeric device IDs remain version-scoped.
