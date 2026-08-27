# Avatar method 19 — vehicle misc-status / repair-progress family

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

The current behavior and Blitz/Wargaming method-family precedent identify this as:

> Avatar method19 = **vehicle miscellaneous status / `updateVehicleMiscStatus` family — PROVEN behavioral/signature identity**.

Observed code values:

```text
code 1 : 89
code 7 : 58
```

## code 7 — destroyed-device repairing progress

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

The missing boundaries concentrate in replay/AoI or externally interrupted repair windows rather than contradictory device IDs.

This proves that:

```text
method19.code7.extraIndex
==
method16.codeB device identifier namespace
```

for the current mechanical-device population.

Verdict:

> **same device namespace — PROVEN current corpus**.

This matters because method16 gives the instantaneous damage/repair transition while method19 gives the server/client-observed self-repair countdown for a destroyed device.

## Current proven / high-confidence device anchors

From independent physical behavior:

```text
32 = ammo rack                  PROVEN
34/35 = two track-side devices  PROVEN family
37 = turret rotator             PROVEN on current natural sample / version-scoped
```

### `extraIndex=37` — turret rotator natural closure

One current natural episode has the complete chain:

```text
method16 codeA=5, codeB=37       // severe/destroyed device state
method19 code=7, extraIndex=37   // repair-progress countdown
~0.98 s later
method16 codeA=19, codeB=37      // repaired/clear
```

Vehicle movement remains substantial during the disabled interval (approximately 12 m/s), excluding a generic track/engine immobilization interpretation.

Using independently proven Vehicle prop2 turret-relative yaw, observed turret angular velocity changes from approximately:

```text
pre-damage median   ~0.80 rad/s
disabled interval   ~0.0018 rad/s
post-repair          resumes non-zero rotation
```

Thus the turret is effectively locked while the chassis can continue moving.

This is the defining physical behavior of the turret-rotation device.

Verdict:

> current `device extraIndex/codeB 37` = **turret rotator / turret rotation mechanism — PROVEN on the available natural sample, version-scoped**.

Sample count is one complete natural destruction/repair episode, so future versions/corpora should revalidate the numeric ID even though the present event is physically decisive.

## code 1

For all 89 `code=1` records:

```text
vehicleId = recorder's own vehicle in 89 / 89
intArg    = another valid enemy combat vehicle in 89 / 89
floatArg  = 0
```

Additional negatives:

- no allied target IDs;
- target distance is broad (~23..270 m), excluding collision/proximity-only semantics;
- no exact relationship to Type4/Type33/Type5 visibility lifecycle;
- no unique identity with simple aim-target geometry.

Verdict:

> `code=1` = **recorder-own-vehicle -> enemy misc relation/state — PROVEN shape / UNKNOWN exact semantic**.

Do not borrow an old numeric status name merely because a historical `updateVehicleMiscStatus` enum contains a value 1.

## Product model

```text
VehicleMiscStatusEvent {
    rawClockSec
    vehicleId
    codeRaw
    intArgRaw
    floatArgRaw

    repairDeviceId?       // code7
    repairProgressPct?    // code7
    repairTimeLeftSec?    // code7
}
```

Safe uses:

- Battle Playback: display automatic repair progress for destroyed devices;
- AI Review: explain periods where a destroyed track/turret mechanism remained under repair;
- cross-check method16 damage-state transitions;
- preserve exact module/device IDs even when symbolic role is still PARTIAL.

## Important boundaries

- numeric device IDs are version-scoped;
- current proof of `37=turret rotator` is behaviorally strong but N=1 complete episode;
- `code1` remains unnamed;
- do not map unproven device IDs solely from PC or old Blitz enum ordering.
