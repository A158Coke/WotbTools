# Avatar method25 — own-vehicle pose snapshot family

> Corpus: strict-framing 34 unique Blitz 11.19 China arenas.
>
> Method IDs are entity-class/version scoped. This note describes Avatar-targeted method25 in the current corpus only.

## Executive verdict

Avatar method25 is a 32-byte fixed payload whose first six float32 values reproduce the recorder vehicle's live Type10 pose at the same replay clock:

```text
f0 = recorder x
f1 = recorder y
f2 = recorder z
f3 = recorder yaw
f4 = recorder pitch
f5 = recorder roll
f6 = UNKNOWN small scalar
f7 = UNKNOWN small scalar
```

The pose relationship is **PROVEN** for the current corpus. The exact symbolic RPC name and the final two scalar semantics remain `PARTIAL/UNKNOWN`.

## Corpus shape

```text
method25 packets : 107
arg length       : 32 bytes for 107 / 107
encoding         : 8 x float32 LE
```

The event is recorder-local: the Avatar method target is the recorder Avatar and no vehicle ID is carried in the method body.

## Position closure against Type10

For every method25 event, the recorder vehicle entity is resolved independently from the recorder projectile/Avatar linkage. The nearest same-clock Type10 pose is then compared with method25 `f0..f2`.

Result over all 107 events:

```text
median 3D position error : ~9.28e-5 world units
p90                      : ~7.79e-4
p99                      : ~1.09e-3
max                      : ~2.22e-3
```

Representative event:

```text
method25 position : (13.9079828, 23.7137890, -9.8402081)
Type10 position   : (13.9081116, 23.7137909, -9.8398209)
3D error          : ~0.000408
```

This is far below any tank-scale spatial distance and proves that the first VECTOR3 is the recorder vehicle's own pose position, not a target point or arbitrary map vector.

## Orientation closure against Type10

`f3..f5` are compared with the recorder Type10 yaw/pitch/roll at the same event time using circular error for angular fields.

Observed errors:

```text
yaw median   : ~3.34e-5 rad
yaw max      : ~4.79e-5 rad

pitch median : ~1.22e-5 rad
pitch p99    : ~2.23e-5 rad

roll median  : ~2.09e-5 rad
roll p99     : ~4.65e-5 rad
```

A small number of pitch/roll samples show larger but still tiny replay-sampling differences. The six-field pose identity is independently stable across vehicles and arenas.

Verdict:

> method25 `f0..f5` = recorder vehicle `position + yaw/pitch/roll` — **PROVEN current-corpus behavioral identity**.

## Final two float32 values

`f6` and `f7` are small signed scalars. Current ranges are approximately:

```text
f6 : -0.428 .. +0.146, median near 0
f7 : -0.006 .. +0.152, median near 0
```

They are not required to reproduce the Type10 six-degree pose and have not yet been closed against velocity, angular velocity, interpolation error, suspension state, or another current-version schema.

Do not name them yet.

## Event-frequency boundary

method25 is sparse rather than a continuous transform stream. Many arenas repeat an identical body several times while others emit changing bodies. Therefore it must not replace Type10 for movement reconstruction.

Safe consumer interpretation:

```text
OwnVehiclePoseSnapshot {
    rawClockSec
    position
    yaw
    pitch
    roll
    scalar6Raw
    scalar7Raw
}
```

Use Type10 as the high-rate vehicle movement source; method25 is an independent recorder-local pose snapshot/validation surface.

## Rejected interpretations

Current evidence rejects treating method25 as:

- a generic target/world point;
- an enemy vehicle position;
- a projectile impact vector;
- a replacement for the full Type10 movement stream.

## Remaining work

1. correlate `f6/f7` with Type10 position-error fields and finite-difference linear/angular velocity;
2. search a version-matched Blitz schema for an own-vehicle pose/checkpoint RPC with this exact eight-float layout;
3. determine why the event is sparse and often repeated unchanged late in a battle;
4. validate whether method25 has any replay-seek/checkpoint or physics-correction role.
