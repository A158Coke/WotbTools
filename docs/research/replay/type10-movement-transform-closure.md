# Type10 movement / transform closure — Blitz 11.19

> Scope: WoT Blitz `11.19.0_china` / `11.19.0_china_apple` replay surface.
>
> Evidence: original 34-arena canonical corpus plus controlled WZ-120 movement, Kanonenjagdpanzer 105 speed, and Rhm airborne + Speed Booster replays.
>
> Numeric packet IDs remain version-gated. Historical BigWorld names are architecture cross-checks only; current controlled replay behavior is authoritative.

## Executive verdict

Type10 is the high-rate entity/vehicle transform source used for movement reconstruction. The current 49-byte payload is structurally closed except for the exact semantic name of its trailing byte:

```text
offset  size  type       current meaning
0x00    4     u32 LE     entityId                              PROVEN
0x04    4     u32 LE     spaceId                               PROVEN
0x08    4     u32 LE     vehicle/attachment parent entity ID   PROVEN
0x0C    12    3*f32 LE   position x,y,z                        PROVEN
0x18    12    3*f32 LE   positionError/filter-error x,y,z      PROVEN structure / PARTIAL generation
0x24    12    3*f32 LE   hull yaw,pitch,roll                   PROVEN
0x30    1     u8          trailingStateRaw                      UNKNOWN semantic
TOTAL   49
```

Important correction:

> The earlier interpretation `offset 0x30 = onGround` is **REJECTED by a controlled airborne replay**. The field must remain raw until a new semantic identity is proven.

The movement facts required by WotBTools are nevertheless closed: position, hull orientation, coordinate scale, forward/reverse direction, speed, vertical motion, hull turn rate, ~10 Hz sampling, turret/hull separation, and AoI continuity boundaries.

---

# 1. Corpus-wide structural closure

Across the 34 unique canonical arenas:

```text
Type10 packets total       1,287,221
payload length 49          1,287,221 / 1,287,221
other payload lengths      0
```

This is a stable current-version fixed-width surface.

The trailing byte has current observed domain `{0,1}`. Corpus frequency alone is not sufficient to name it.

---

# 2. spaceId — offset 0x04

Every canonical arena exposes one Type10 `spaceId` matching the Type11 map/space surface:

```text
Type10 offset 0x04 == Type11 spaceId
34 / 34 arenas
```

Controlled WZ-120 example:

```text
Type10 spaceId = 3588
Type11 spaceId = 3588
```

Verdict:

> `0x04 = spaceId` — **PROVEN current relationship**.

---

# 3. vehicle/attachment parent — offset 0x08

Canonical non-zero references:

```text
non-zero references examined            90,075
reference resolves to another entity    90,075 / 90,075
observed child local position            (0,0,0)
```

Controlled WZ-120 example:

```text
recorder Avatar entity  = 284482053
recorder Vehicle entity = 284159419

Vehicle Type10:
entityId  = 284159419
parentRaw = 0
position  = world-space vehicle position

Avatar attached Type10:
entityId  = 284482053
parentRaw = 284159419
position  = (0,0,0)
```

Production rule:

```text
parentRaw == 0 -> position is direct world position for the entity
parentRaw != 0 -> entity is attached/parented; local zero must not be treated as world origin
```

Verdict:

> offset `0x08` = **vehicle/attachment parent entity ID — PROVEN behavioral role**.

---

# 4. Position — offsets 0x0C..0x17

```text
0x0C  f32 x
0x10  f32 y
0x14  f32 z
```

Avatar method25 independently reproduces the recorder Type10 position over 107 events:

```text
median 3D error  ~9.28e-5 world units
p90              ~7.79e-4
p99              ~1.09e-3
max              ~2.22e-3
```

Verdict:

> `position(x,y,z)` = **entity/vehicle position — PROVEN**.

Coordinate convention in the current reconstruction:

```text
X/Z -> horizontal map plane
Y   -> vertical/height axis
```

---

# 5. Physical scale — 1 Type10 position unit ≈ 1 meter

This is now directly controlled rather than assumed from historical BigWorld convention.

## 5.1 Kanonenjagdpanzer 105 speed probe

Recorder firing markers separate the controlled phases:

```text
21.992561s  start forward-speed phase
54.697941s  start reverse-speed phase
73.397659s  stationary/end marker
```

Stable Type10 planar-speed plateaus:

```text
forward median = 15.8364 world-unit/s
15.8364 * 3.6 = 57.011 km/h

reverse median = 5.5804 world-unit/s
5.5804 * 3.6 = 20.089 km/h
```

The controlled vehicle's current speed limits are 57 km/h forward and 20 km/h reverse.

Two independent signs/directions therefore close the scale:

> **1 Type10 world position unit ≈ 1 meter — PROVEN controlled for current 11.19 movement reconstruction.**

Safe conversion:

```text
speed_mps = distance_type10 / delta_time_sec
speed_kmh = speed_mps * 3.6
```

## 5.2 Independent airborne/gravity cross-check

The controlled Rhm airborne replay supplies an unrelated vertical-physics check. During the clean ballistic descent, a quadratic fit to Type10 Y gives approximately:

```text
vertical acceleration ~= -9.74 world-unit/s^2
```

Under the meter scale this is approximately `-9.74 m/s²`, independently consistent with the expected gravity scale.

This gravity result is a cross-check, not the primary speed calibration.

---

# 6. positionError/filter-error vector — offsets 0x18..0x23

```text
0x18  f32 positionError.x
0x1C  f32 positionError.y
0x20  f32 positionError.z
```

These fields are **not velocity**.

Controlled WZ-120 movement changes acceleration, direction, hull rotation and stationary state while these values remain constant:

```text
x = 2.997797491843812e-05
y = 1.9073486328125e-06
z = 2.997797491843812e-05
```

Historical BigWorld filter architecture independently contains `position + positionError + yaw/pitch/roll`, matching the observed structure.

Verdict:

> offsets `0x18..0x23` = **position/filter-error vector — PROVEN structural identity / PARTIAL exact generation semantics**.

Production rule: preserve raw; never expose this vector as speed or acceleration.

---

# 7. Hull orientation — offsets 0x24..0x2F

```text
0x24  f32 hullYaw
0x28  f32 hullPitch
0x2C  f32 hullRoll
```

The fields are radians. Independent method25 cross-check:

```text
yaw median error     ~3.34e-5 rad
pitch median error   ~1.22e-5 rad
roll median error    ~2.09e-5 rad
```

Verdict:

> `yaw/pitch/roll` = **hull/entity orientation — PROVEN**.

Do not confuse Type10 hull yaw with turret-relative yaw.

---

# 8. Forward axis and signed movement direction

Controlled WZ-120 translation isolates movement with negligible hull yaw change.

Current heading convention:

```text
forward.x = sin(hullYaw)
forward.z = cos(hullYaw)
```

Signed longitudinal speed:

```text
dx = x2 - x1
dz = z2 - z1
dt = t2 - t1

vForward = (dx * sin(yaw) + dz * cos(yaw)) / dt
```

Interpretation after smoothing/noise threshold:

```text
vForward >  epsilon -> FORWARD
vForward < -epsilon -> REVERSE
otherwise           -> no meaningful longitudinal motion
```

Controlled phase residuals against the heading axis are near zero, and the sign flips exactly with deliberate forward/back input.

Verdict:

> **forward/reverse classification — PROVEN derived relationship.**

---

# 9. Velocity, turn rate and acceleration are derived facts

There is no proven direct velocity vector in the Type10 49-byte packet.

Linear velocity:

```text
vx = Δx / Δt
vy = Δy / Δt
vz = Δz / Δt

planarSpeed  = sqrt(vx² + vz²)
spatialSpeed = sqrt(vx² + vy² + vz²)
```

Hull yaw rate:

```text
hullYawRate = wrapPi(yaw2 - yaw1) / Δt
```

Acceleration:

```text
acceleration = Δvelocity / Δt
```

Acceleration is second-order and noise-sensitive. It must carry `DERIVED_FROM_TYPE10` provenance rather than be represented as a raw packet field.

Closed production classifications include:

- stationary / moving;
- forward / reversing;
- straight movement / hull turning;
- stationary hull rotation;
- hull + translation together;
- moving shot / stationary shot;
- vertical ascent/descent;
- approximate acceleration after filtering.

---

# 10. Sampling cadence

Canonical same-entity short intervals:

```text
observations       1,281,806
median Δt          ~0.1000595 s
arena median       ~0.1000528 s
arena range        ~0.09984 .. 0.10080 s
```

Thus Type10 is effectively a **~10 Hz observed transform stream** while the entity is available to the recorder.

Interpolation between adjacent continuous observations is a playback/presentation operation, not additional telemetry.

---

# 11. Hull / turret / gun separation

Keep the layers separate:

```text
Type10 hullYawWorld
+ Vehicle prop2 turretYawRelative
-> turretYawWorld
```

Conceptually:

```text
turretYawWorld = wrapPi(hullYawWorld + turretYawRelative)
```

For the recorder, Type39/method36 supply additional high-rate gun-relative yaw and gun pitch.

The controlled WZ-120 replay independently isolates:

```text
forward/back only
hull rotation
stationary hull + turret-only rotation
hull + turret movement together
```

Therefore hull and turret movement are separately reconstructable.

---

# 12. Vertical movement and airborne trajectory

The Rhm + Speed Booster replay was explicitly recorded as an airborne test. The booster contaminates natural horizontal top-speed/acceleration and is therefore not used for speed-limit calibration.

Type10 Y nevertheless shows a clean ballistic rise/apex/fall sequence, including a descent reaching roughly `-10.9 m/s` vertical velocity and a fitted acceleration near `-9.74 m/s²`.

Verdict:

> **Type10 Y carries real vertical vehicle motion, including airborne ballistic movement — PROVEN controlled.**

This is safe for:

- vertical trajectory reconstruction;
- detecting strong airborne/fall candidates from kinematics;
- jump/fall timing;
- impact-context reconstruction when combined with collision/damage events.

A product may derive an `AIRBORNE_KINEMATIC_CANDIDATE`, but it must not use the trailing byte as a ground-contact boolean.

---

# 13. Trailing byte at offset 0x30 — onGround hypothesis REJECTED

Earlier corpus evidence showed:

```text
raw=1  overwhelmingly common
raw=0  rare
```

Historical BigWorld architecture made `onGround` a plausible hypothesis. That hypothesis is now directly contradicted by the controlled Rhm airborne replay.

Recorder vehicle:

```text
Type10 samples examined = 369
trailing byte raw=1      = 369 / 369
trailing byte raw=0      = 0 / 369
```

During the same sequence, Type10 Y forms a clear ballistic airborne trajectory.

Therefore:

```text
offset 0x30 == onGround       REJECTED
exact current semantic        UNKNOWN
observed raw domain           {0,1}
production behavior           preserve raw only
```

Do not rename this field `onGroundRaw`; use a neutral name such as:

```text
trailingStateRaw
movementStateTailRaw
```

until current evidence closes the exact semantic.

This correction is evidence-positive: the controlled replay prevented a historical-architecture assumption from becoming a false production fact.

---

# 14. AoI / visibility boundary

Type10 is not omniscient telemetry.

```text
visible/materialized
-> Type10 observed samples
-> Type4 leaves recorder-observed AoI
-> hidden interval: trajectory UNKNOWN
-> Type33 + Type5 re-entry/materialization
-> Type10 resumes
```

Never interpolate across an AoI hidden interval and present the result as observed truth.

Safe representation:

```text
MovementSegment {
    samples[]
    continuity = OBSERVED
}

HiddenGap {
    start
    end
    continuity = UNKNOWN_AOI
}
```

---

# 15. Production-safe model

```text
Type10MovementSample {
    rawClockSec
    entityId
    spaceId
    parentEntityIdRaw

    positionMeters {
        x
        y
        z
    }

    positionErrorRaw {
        x
        y
        z
    }

    hullYawRad
    hullPitchRad
    hullRollRad

    trailingStateRaw   // semantic UNKNOWN; NOT onGround
}
```

Derived layer:

```text
DerivedMovementState {
    velocityMps
    planarSpeedMps
    speedKmh
    signedForwardSpeedMps
    verticalSpeedMps
    hullYawRateRadPerSec

    stationary
    forward
    reversing
    hullTurning
    airborneKinematicCandidate

    provenance = DERIVED_FROM_TYPE10
}
```

---

# 16. AI Review / battle reconstruction use

Current movement evidence safely supports:

- observed route and last-known position;
- exact sampled x/y/z and hull orientation;
- speed in m/s and km/h from adjacent samples;
- forward/reverse movement;
- stationary vs moving at a shot/damage event;
- hull turning while firing/aiming;
- turret-only movement vs hull movement;
- approach/retreat relative to another observed entity;
- path length and formation spacing;
- vertical rise/fall and airborne-kinematic candidates;
- movement immediately before death, collision or damage;
- explicit UNKNOWN gaps outside recorder AoI.

---

# 17. Movement closure status

```text
Type10 fixed 49-byte layout                  CLOSED
entityId                                     PROVEN
spaceId                                      PROVEN
attachment/parent identity                   PROVEN
position x/y/z                               PROVEN
physical scale ~1 unit = 1 meter             PROVEN controlled
positionError structural role                PROVEN / generation PARTIAL
hull yaw/pitch/roll                          PROVEN
~10 Hz sampling                              PROVEN
forward-axis convention                      PROVEN controlled
forward/reverse                              PROVEN derived
linear speed / km/h                          PROVEN controlled-derived
hull yaw rate                                PROVEN derived
vertical movement                            PROVEN controlled
airborne ballistic trajectory                PROVEN controlled
trailing byte == onGround                    REJECTED
trailing byte exact semantic                 UNKNOWN / raw-preserve
AoI movement continuity boundary             PROVEN
```

## Remaining movement-specific research

The remaining Type10 movement questions are **not P1 business blockers**:

1. exact meaning of `trailingStateRaw`;
2. exact generation rule for `positionError` magnitudes;
3. product-level smoothing/threshold tuning for second-order acceleration;
4. future-version numeric regression.

**Movement/transform P1 status: CLOSED for current 11.19 WotBTools business use.**
