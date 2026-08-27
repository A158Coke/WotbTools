# Type39 f6 — recorder gun vertical angle in vehicle-local space

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> This note narrows only the physical role of Type39 `f6`. The exact current Blitz producer symbol remains version-scoped.

## Starting observation

Type39 is a recorder-local `7 x float32` aim/camera stream. Fields `f0/f1` and `(f2,f3,f4)` are independently proven world aim-ray quantities. `f6` had previously remained a generic vertical-state family because simple scalar comparisons against world projectile pitch and Type10 hull pitch failed.

The missing step was to compare angles in the correct coordinate frame.

## Recorder-owned shot population

The recorder vehicle is identified independently through the proven Avatar-property9 ↔ Vehicle-property2 turret-relative-yaw mirror.

Avatar method29 is a global projectile feed, so only records satisfying:

```text
method29.shooterId == recorderVehicleEntity
```

are used.

Current sample:

```text
recorder-owned method29 RPC records : 326
```

These are the same validated own-shot observations used by the Type28 ammunition-slot closure.

## Transform projectile direction into the vehicle local frame

Method29 supplies the proven projectile launch velocity vector. Type10 supplies recorder vehicle:

```text
yaw
pitch
roll
```

For each shot, construct the current vehicle orientation and inverse-transform the normalized world projectile vector into vehicle-local coordinates.

The current BigWorld-compatible transform that closes the data is:

```text
Rvehicle = Ry(yaw) * Rx(pitch) * Rz(roll)
localProjectile = inverse(Rvehicle) * worldProjectileDirection

localPitch = atan2(
    localProjectile.y,
    hypot(localProjectile.x, localProjectile.z)
)
```

Then compare:

```text
f6 ~= -localPitch
```

Observed errors over 326 recorder-owned projectile launches:

```text
median absolute error : ~0.00302 rad  (~0.17 deg)
p90                   : ~0.01448 rad (~0.83 deg)
```

This is dramatically tighter than comparisons in world coordinates and proves that `f6` belongs to the gun/barrel vertical angle in the vehicle-local frame.

## Vehicle-specific hard limits

The positive upper values observed for `f6` also form exact degree-like caps by vehicle:

```text
Ho-Ri      : +0.10471976 rad = +6 deg
FV215b     : +0.12217305 rad = +7 deg
Maus       : +0.13962634 rad = +8 deg
A178_SPHT  : +0.13962634 rad = +8 deg
VK 72.01   : +0.12217305 rad = +7 deg
```

These vehicle-specific discrete limits are consistent with a gun-depression/elevation constraint surface rather than zoom, FOV, dispersion, arbitrary camera state, or a world-angle scalar.

The negative side has larger vehicle- and battle-dependent excursions; the current corpus does not guarantee that every replay reaches the full opposite mechanical elevation limit.

## Why simple `projectilePitch - hullPitch` failed

A vehicle on uneven terrain may have non-zero yaw, pitch and roll simultaneously. Subtracting one world pitch scalar from one hull pitch scalar does not correctly recover barrel elevation in the local vehicle frame.

The full inverse orientation transform is required. Once yaw/pitch/roll are applied together, the shot-time closure becomes sub-degree.

## Continuous-stream caveat

Away from firing moments, Type39's world aim ray may represent the current reticle/aim solution while the physical barrel is still converging toward that ray. Therefore whole-stream comparison of `f6` against the instantaneous Type39 world aim pitch is intentionally weaker than the independently observed projectile-launch closure.

This is compatible with `f6` representing the physical/local gun vertical state rather than a second copy of `f1`.

## Verdict

> Type39 `f6` = **recorder gun/barrel vertical angle in vehicle-local space, with the current stored sign convention — PROVEN physical role at validated recorder shot times / STRONG PARTIAL continuous symbolic identity**.

Safe current interpretation:

```text
localGunVerticalRawRad = f6
```

At validated shot times:

```text
f6 ~= -local projectile pitch
```

The exact internal name may be gun pitch, gun elevation, barrel pitch, gun-angle component, or an adjacent control-state representation; the current mobile corpus proves the physical role, not the C++ symbol spelling.

## Production value

With viewpoint gating, this field can support:

- actual gun depression/elevation analysis on terrain;
- battle playback barrel reconstruction;
- AI Review checks for whether the gun was near a depression/elevation constraint when firing;
- cross-validation of world aim ray vs physical barrel convergence.

Do not call it zoom/FOV or use it after spectator/viewpoint switching without resolving which vehicle owns the camera/gun state.
