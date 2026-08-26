# Type39 — recorder aim/camera stream

> Corpus: 34 strict-framing unique arenas from the 44-file Blitz 11.19.0 China research corpus.
>
> Type39 is a recorder-local high-frequency stream. The current payload is exactly 28 bytes = `7 x float32` in every observed record.

## Current field layout

```text
f0 : float32
f1 : float32
f2 : float32
f3 : float32
f4 : float32
f5 : float32
f6 : float32
```

Current evidence supports:

```text
f0          world-space aim / gun-ray yaw, degrees                 PROVEN
f1          negated world-space aim / gun-ray pitch, degrees       PROVEN
(f2,f3,f4)  world-space point on the current aim/projectile ray    PROVEN physical role
f5          relative turret/camera-yaw family                       PARTIAL
f6          camera/gun vertical-state family                        PARTIAL
```

The last two fields must not yet be exposed under a more specific symbolic name.

## Why `f0` is world aim yaw

The recorder entity is resolved from `meta.json#dbid` through the wrapper-1 account/entity roster. Type39 records were joined to the recorder's Type10 position/orientation stream and to recorder-fired Avatar method29 projectile launches.

For a Type39 record and recorder position `(vx,vy,vz)`, define the horizontal direction from the vehicle to the Type39 point:

```text
yawToPoint = atan2(f2 - vx, f4 - vz)
```

Across normal recorder-controlled periods, `f0` follows this direction tightly. More importantly, at independently identified projectile launches, method29 supplies a proven launch velocity vector.

For 326 recorder projectile launches with a Type39 sample within 80 ms:

```text
abs(f0 - projectileLaunchYaw)
median ~0.27 deg
p90    ~1.73 deg
p99    ~8.14 deg
```

The median signed offset is effectively zero.

Therefore:

> `f0` is the recorder's **world-space aim / gun-ray yaw in degrees** — `PROVEN physical meaning` for the current corpus.

It must not be confused with hull yaw. During active firing, `f0` follows the projectile/gun direction; hull yaw can differ by the turret rotation angle.

## Why `f1` is negated world aim pitch

The same 326 recorder projectile launches provide an independent projectile pitch from method29's proven launch vector:

```text
projectilePitch = atan2(vy, hypot(vx, vz))
```

Comparing the Type39 values shows the correct sign convention is `-f1`:

```text
abs((-f1) - projectilePitch)
median ~0.45 deg
p90    ~5.33 deg
```

The sign inversion is therefore part of the current replay convention rather than an arbitrary UI transform.

Verdict:

> `f1` is **negated world-space aim/gun-ray pitch in degrees** — `PROVEN physical meaning`.

Consumers should preserve the stored value and document the sign convention explicitly rather than silently changing it in raw protocol structures.

## `(f2,f3,f4)` is a world-space aim-ray point

Method29 independently supplies:

```text
launchPoint
launchVelocityVector
```

For the same 326 recorder launches, define the ray from the method29 launch point to the Type39 point:

```text
R = (f2,f3,f4) - method29.launchPoint
```

Comparing `R` against method29's launch vector gives:

```text
yaw error:
  median abs ~0.24 deg
  p90        ~1.26 deg

pitch error:
  median abs ~0.11 deg
  p90        ~0.68 deg
```

This closes the geometry independently from Type10 orientation.

Therefore:

> `(f2,f3,f4)` is a **world-space point lying on the recorder's current aim/projectile ray** — `PROVEN physical role`.

The safe semantic name is `aimRayPoint` / `aimPointFamily`. The corpus does not prove that it is always the final armor collision point, reticle ground intersection, or server-authoritative target point. It may move between those presentation/simulation roles depending on camera/aim state.

Do not equate it with:

- an enemy vehicle position;
- the recorder vehicle position;
- authoritative projectile impact;
- penetration point;
- damage target.

## Relationship to hull and turret yaw

During recorder projectile launches, `f0` is also consistent with hull yaw plus a relative yaw carried by `f5`:

```text
relativeAimYaw = normalize(f0 - hullYaw)
```

For the same 326-shot controlled sample:

```text
abs(relativeAimYaw - degrees(f5))
median ~0.25 deg
p90    ~2.26 deg
p99    ~6.71 deg
```

This is strong evidence that `f5` belongs to a **relative turret/camera yaw family**.

However, outside recorder-controlled firing periods the relationship becomes much weaker, especially after death/spectator transitions. Type39 continues as a camera/observer-oriented stream while the original recorder vehicle is no longer necessarily the active viewpoint reference.

Therefore the exact symbolic identity of `f5` remains deliberately `PARTIAL`. A production decoder may preserve it as a relative-yaw field but must not claim it is universally the vehicle turret yaw without viewpoint-state gating.

## `f6` remains partial

`f6` is a radian-scale angular/state field with a narrow normal range and occasional larger excursions. It does not close cleanly against:

- projectile world pitch;
- Type10 hull pitch;
- a simple `projectilePitch - hullPitch` relation.

This makes it likely to be a camera/gun vertical-state or relative-pitch quantity, but the current corpus does not justify a narrower semantic label.

Verdict:

> `f6` — `PARTIAL`; preserve raw float32 and surrounding viewpoint state.

## Spectator/post-death caveat

Type39 is recorder-local, but "recorder-local" does not mean "always tied to the recorder's original tank".

After death or viewpoint changes, the replay camera can follow another entity or free-camera state. This is why whole-battle correlations against the recorder tank alone produce large outliers even though firing-window projectile geometry closes tightly.

Consumers must therefore separate:

```text
raw Type39 aim/camera state
```

from:

```text
which vehicle/viewpoint currently owns the camera
```

The latter still requires explicit viewpoint-state reconstruction.

## Canonical safe use

Current safe reconstruction:

```text
AimRayState {
    rawClockSec
    worldYawDeg        = f0
    worldPitchDeg      = -f1
    aimRayPoint        = (f2,f3,f4)
    relativeYawRawRad  = f5      // PARTIAL symbolic identity
    verticalRawRad     = f6      // PARTIAL
}
```

Potential consumers:

- battle playback: recorder gun/aim direction and reticle ray;
- AI review: where the player was actually aiming, independent of hull direction;
- shot analysis: compare pre-shot aim ray with method29 projectile launch vector;
- turret reconstruction: use `f0`, hull yaw and independently decoded Type7 turret yaw with viewpoint gating.

## Important negative conclusions

The corpus rejects these shortcuts:

- treating the first three floats as XYZ;
- treating `f0` as vehicle X position;
- treating `f0` as hull yaw in all states;
- treating `(f2,f3,f4)` as a target vehicle location;
- naming `f5/f6` as exact turret yaw/pitch without viewpoint-state gating;
- using Type39 itself as authoritative damage/impact evidence.

## Remaining work

1. recover the explicit viewpoint-switch state and determine which entity/free-camera mode owns Type39 after recorder death;
2. close the exact symbolic meanings of `f5` and `f6`;
3. correlate Type39 aim point with method20 `stopTracer` endpoint and armor-hit/damage events to classify reticle-vs-impact behavior;
4. determine camera mode / zoom relation, likely through Type28 or another recorder-local control packet;
5. validate the same 7-float layout on additional Blitz versions before reusing numeric semantics globally.
