# Type10 movement / transform closure — Blitz 11.19

> Scope: WoT Blitz `11.19.0_china` / `11.19.0_china_apple` replay surface.
>
> Evidence: original 34-arena canonical corpus plus the controlled WZ-120 movement replay `1168508771640578177`.
>
> Numeric packet IDs remain version-gated.

## Executive verdict

Type10 is not merely a generic “position packet”. The current 49-byte payload can now be decomposed into the BigWorld movement-filter input surface:

```text
offset  size  type       current meaning
0x00    4     u32 LE     entityId
0x04    4     u32 LE     spaceId
0x08    4     u32 LE     vehicleId / attachment parent entity
0x0C    12    3*f32 LE   position x,y,z
0x18    12    3*f32 LE   positionError x,y,z
0x24    12    3*f32 LE   yaw,pitch,roll
0x30    1     u8          onGround flag
TOTAL   49
```

Current verdict:

> `Type10` = **BigWorld entity movement/filter input — PROVEN structure and high-value physical semantics for current 11.19**.

The exact private packet-class/function symbol remains version/private-source scoped, but the production fields needed by WotBTools are closed.

---

## 1. Corpus-wide structural closure

Across all 34 unique canonical arenas:

```text
Type10 packets total       1,287,221
payload length 49          1,287,221 / 1,287,221
other payload lengths      0
```

The layout is therefore not inferred from one replay variant.

The final byte population is:

```text
onGroundRaw=1   1,286,386
onGroundRaw=0         835
```

The current parser must preserve the raw flag even when exposing `onGround`.

---

## 2. `spaceId` at offset 0x04

Every canonical arena has one Type10 `spaceId` value.

Cross-surface check:

```text
Type10 offset 0x04 spaceId
== Type11 map/space packet spaceId
34 / 34 arenas
```

Example controlled WZ-120 replay:

```text
Type10 spaceId = 3588
Type11 spaceId = 3588
```

Verdict:

> offset `0x04` = **spaceId — PROVEN current relationship**.

---

## 3. `vehicleId` / attachment parent at offset 0x08

The third u32 is not part of the world position.

Canonical evidence for non-zero values:

```text
non-zero parent/vehicle references examined  90,075
reference points to another Type10 entity    90,075 / 90,075
child local position when reference != 0     exactly (0,0,0) in observed population
```

The controlled WZ-120 replay provides a particularly clean example:

```text
recorder Avatar entity  = 284482053
recorder Vehicle entity = 284159419

Vehicle Type10:
entityId  = 284159419
vehicleId = 0
position  = world-space vehicle position

Avatar attached Type10:
entityId  = 284482053
vehicleId = 284159419
position  = (0,0,0)
```

Before attachment, the same Avatar temporarily appears with `vehicleId=0` and world-space position; after attachment it references the vehicle and its local position becomes zero.

This is exactly the architecture expected from the BigWorld movement filter input parameter named `vehicleID`/attachment entity.

Verdict:

> offset `0x08` = **vehicle/parent attachment entity ID — PROVEN behavioral role; preserve the raw field name as `vehicleIdRaw` if private naming is desired**.

Production rule:

- `vehicleId == 0`: `position` is directly world-space for the entity;
- `vehicleId != 0`: treat the entity as attached/parented; do not mistake the local zero vector for a world origin position.

---

## 4. Position at offsets 0x0C..0x17

```text
0x0C  f32 x
0x10  f32 y
0x14  f32 z
```

This position is independently closed by Avatar method25.

Across 107 recorder-local method25 pose snapshots:

```text
median 3D error against nearest Type10 position  ~9.28e-5 world units
p90                                              ~7.79e-4
p99                                              ~1.09e-3
max                                              ~2.22e-3
```

Therefore:

> Type10 `position(x,y,z)` = **entity/vehicle position — PROVEN**.

For unattached vehicles this is the authoritative high-rate world transform source used by battle reconstruction.

BigWorld uses Y-up coordinates. For map-plane movement use X/Z; retain Y for terrain height and vertical motion.

---

## 5. Position-error vector at offsets 0x18..0x23

```text
0x18  f32 positionError.x
0x1C  f32 positionError.y
0x20  f32 positionError.z
```

These values are **not velocity**.

The controlled WZ-120 replay proves this negative statement directly: while the vehicle accelerates, reverses, rotates, becomes stationary and moves again, these three values remain constant:

```text
positionError.x = 2.997797491843812e-05
positionError.y = 1.9073486328125e-06
positionError.z = 2.997797491843812e-05
```

Other current replays expose a small quantized family of values rather than motion-correlated vectors.

The exact 49-byte field ordering matches the public BigWorld `FilterBase::input(...)` architecture:

```text
input(
  time,
  SpaceID spaceID,
  EntityID vehicleID,
  Position3D position,
  Vector3 positionError,
  float * auxFiltered   // yaw,pitch,roll
)
```

This is independent architectural confirmation that the middle VECTOR3 is `positionError` rather than velocity/acceleration.

Verdict:

> offsets `0x18..0x23` = **BigWorld position-error/filter-error vector — PROVEN structural identity / PARTIAL exact generation semantics**.

Do not expose this vector as vehicle speed.

---

## 6. Hull orientation at offsets 0x24..0x2F

```text
0x24  f32 yaw
0x28  f32 pitch
0x2C  f32 roll
```

The three values are radians.

Independent recorder method25 closure over 107 samples:

```text
yaw median error     ~3.34e-5 rad
pitch median error   ~1.22e-5 rad
roll median error    ~2.09e-5 rad
```

Verdict:

> Type10 `yaw/pitch/roll` = **vehicle/entity hull orientation — PROVEN**.

Important distinction:

- Type10 yaw = **hull/world yaw**;
- Vehicle prop2 / Type39 / method36 provide **turret/gun-relative orientation**.

Do not use Type10 yaw as turret yaw.

---

## 7. Current forward-axis convention

The controlled WZ-120 forward/back phase isolates translation with essentially no hull rotation.

At approximately yaw `-3.084 rad`, the observed displacement follows:

```text
headingWorld = (sin(yaw), 0, cos(yaw))
```

During the clean 14–20 s translation phase:

```text
maximum planar speed observed             ~6.81 world-units/s
maximum lateral residual against heading  ~0.0019 world-units/s
median lateral residual                   ~0.0005 world-units/s
```

The same phase contains both positive and negative signed longitudinal velocity, matching deliberate forward/back movement.

Safe current heading model:

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

Interpretation:

```text
vForward > +epsilon  -> forward movement
vForward < -epsilon  -> reverse movement
|vForward| <= epsilon -> no meaningful longitudinal motion
```

Use a noise threshold and a short smoothing window in production rather than comparing to exact zero.

---

## 8. Speed and movement state are derived, not direct fields

No Type10 field in the current 49-byte structure is a direct velocity vector.

Production linear velocity must be derived from successive world positions:

```text
vx = Δx / Δt
vy = Δy / Δt
vz = Δz / Δt

planarSpeed = sqrt(vx² + vz²)
spatialSpeed = sqrt(vx² + vy² + vz²)
```

Hull yaw rate:

```text
hullYawRate = wrapPi(yaw2 - yaw1) / dt
```

This directly supports:

- stationary / moving;
- forward / reverse;
- acceleration/deceleration after smoothing;
- hull turning;
- stationary hull + turret-only turning;
- moving + hull turning;
- moving shot vs stationary shot classification.

Acceleration is a second derivative and should be treated as derived/noise-sensitive, not a wire fact.

---

## 9. Sampling cadence

After grouping Type10 records by entity and ignoring long AoI gaps / exact duplicate timestamps, the canonical population gives:

```text
same-entity short-interval observations   1,281,806
median Δt                                 ~0.1000595 s
median arena-level Δt                     ~0.1000528 s
arena median range                        ~0.09984 .. 0.10080 s
```

Thus the observed Type10 movement feed is effectively **~10 Hz** for entities while updates are available.

Production consequence:

- raw Type10 is the authoritative sampled transform;
- smooth playback may interpolate between adjacent samples;
- interpolation is presentation/reconstruction, not an additional observed fact.

---

## 10. Controlled movement phase reconstruction

WZ-120 controlled replay `1168508771640578177`:

```text
~9–13 s    stationary
~14–20 s   forward/back only
~21–34 s   sustained hull rotation
~35–51 s   turret-only rotation; hull Type10 pose stationary
~52–58 s   hull + turret motion
59 s+      stationary again
```

Derived Type10 movement checks:

```text
14–20 s:
  signed longitudinal speed range ~ -6.08 .. +6.81
  hull yaw rate ~ 0
  lateral residual near zero

21–34 s:
  hull yaw rate reaches ~1.23 rad/s

35–51 s:
  planar hull speed ~0
  hull yaw rate ~0
  turret-relative yaw continues changing on Vehicle prop2

52–58 s:
  planar motion + hull yaw change both present
```

This independently proves that Type10 hull motion and Vehicle prop2 turret motion can be separated correctly.

---

## 11. Hull / turret / gun orientation composition

For current battle reconstruction keep the layers separate:

```text
Type10 hullYawWorld
+ Vehicle prop2 turretYawRelative
-> turret world horizontal orientation
```

Conceptually:

```text
turretYawWorld = wrapPi(hullYawWorld + turretYawRelative)
```

For the recorder, Type39/method36 provide additional high-rate/current gun-relative yaw and gun pitch surfaces.

Do not infer gun pitch from hull pitch.

---

## 12. AoI / visibility boundary

Type10 is not omniscient telemetry.

For enemies the authoritative visibility lifecycle remains:

```text
visible/materialized
-> Type10 transforms while observed
-> Type4 leaves recorder-observed AoI
-> hidden interval: no authoritative live trajectory
-> Type33 + Type5 re-entry/materialization
-> Type10 resumes
```

Production rule:

> Never connect the last pre-hide Type10 point to the first post-reentry point and label the interpolated path as observed truth.

Safe representation:

```text
MovementSegment {
    observedStart
    observedEnd
    samples[]
    continuity = OBSERVED
}

HiddenGap {
    start
    end
    continuity = UNKNOWN_AOI
}
```

A UI may visually interpolate only inside a continuous observed segment.

---

## 13. `onGround` at offset 0x30

The trailing byte behaves as the BigWorld on-ground state and aligns with the shared engine architecture for movement filtering/ground resolution.

Canonical population:

```text
1 -> 1,286,386
0 ->       835
```

Verdict:

> offset `0x30` = **onGround flag — VERY STRONG current physical role / PROVEN structural position in the BigWorld movement layout**.

Until a deliberately airborne/falling controlled replay is recorded, consumers should retain `onGroundRaw` in addition to the decoded boolean.

This is not a blocker for ordinary ground-vehicle movement reconstruction.

---

## 14. Production-safe model

```text
Type10MovementSample {
    rawClockSec
    entityId
    spaceId
    vehicleIdRaw

    position {
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
    onGroundRaw
}
```

Derived layer:

```text
DerivedMovementState {
    planarVelocity
    spatialVelocity
    planarSpeed
    signedForwardSpeed
    hullYawRate

    stationary
    forward
    reversing
    hullTurning

    provenance = DERIVED_FROM_TYPE10
}
```

Do not store derived speed as though it were a raw replay field.

---

## 15. AI Review / battle reconstruction use

Type10 now safely supports facts such as:

- player was stationary or moving at shot time;
- forward vs reverse motion;
- approximate speed from adjacent observed samples;
- hull was rotating while aiming/firing;
- hull stopped but turret continued rotating;
- approach/retreat relative to another observed vehicle;
- path length and observed route;
- movement before death or damage event;
- observed formation spacing/depth when all relevant vehicles are in AoI.

These facts must retain the single-POV visibility boundary.

---

## 16. Remaining movement-specific boundaries

After this closure, the remaining movement questions are not P1 blockers for the base transform model:

1. deliberately control an airborne/fall event to upgrade `onGround` from VERY STRONG physical role to direct controlled PROVEN;
2. recover exact private meaning/generation rule of `positionError` magnitudes;
3. decide product-specific filtering/smoothing thresholds for speed/acceleration;
4. validate numeric stability on future client versions.

The core movement/transform chain itself is closed for current 11.19.

---

## 17. External architecture cross-check

BigWorld client programming documentation describes filter input as:

```text
FilterBase::input(
  double time,
  SpaceID spaceID,
  EntityID vehicleID,
  const Position3D & position,
  const Vector3 & positionError,
  float * auxFiltered
)
```

where `auxFiltered` contains yaw, pitch and roll.

The current Type10 payload is exactly the expected data surface once the packet's target `entityId` and trailing ground-state byte are included.

This external architecture is used as an independent cross-check. The semantic promotion above also depends on current 11.19 corpus/controlled behavior; it is not an ordinal transplant from historical PC WoT.
