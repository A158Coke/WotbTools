# Avatar method36 — targeting-info historical crosswalk

> Scope: structural cross-check for the Blitz 11.19 China `Avatar method36` targeting protobuf. This note does **not** transplant historical PC/WoT numeric IDs or flat argument ordering into current Blitz.

## Current 11.19 evidence

Current corpus evidence already establishes:

- `Avatar method36` is a recorder targeting / aim-state family;
- 858 total records across 34 unique arenas;
- 824 dynamic 92-byte records and 34 initialization-like 74-byte records;
- the dynamic protobuf exposes exactly **nine fixed64/double-like scalar values**;
- `root.field1` closes against Type39 `f5` as recorder turret/gun-relative yaw;
- `root.field2` closes against Type39 `f6` as recorder gun pitch;
- all 326 recorder projectile launches are exactly bracketed by a pre-shot and post-shot method36 snapshot;
- `field6.field1` changes on **326 / 326** shot pairs and its post-shot delta is always positive in the observed corpus.

The current shape is conceptually:

```text
root.field1 : fixed64
root.field2 : fixed64
root.field3 : fixed64
root.field4 : fixed64
root.field5 : fixed64
root.field6 {
  field1 : fixed64
  field2 : fixed64
  field3 {
    field1 {
      field1 { field1 : fixed64 }
      field2 { field1 : fixed64 }
    }
  }
}
```

Total scalar count: **9**.

## Historical Wargaming targeting surface

Historical Wargaming client `Avatar.updateTargetingInfo(...)` exposes exactly nine targeting arguments:

```text
turretYaw
gunPitch
maxTurretRotationSpeed
maxGunRotationSpeed
shotDispMultiplierFactor
gunShotDispersionFactorsTurretRotation
chassisShotDispersionFactorsMovement
chassisShotDispersionFactorsRotation
aimingTime
```

The client uses them in two groups:

```text
gunRotator.update(
    turretYaw,
    gunPitch,
    maxTurretRotationSpeed,
    maxGunRotationSpeed
)
```

and stores:

```text
shotDispMultiplierFactor
gunShotDispersionFactorsTurretRotation
chassisShotDispersionFactorsMovement
chassisShotDispersionFactorsRotation
aimingTime
```

as aiming/dispersion configuration.

Historical `updateGunMarker(shotPos, shotVec, dispersionAngle)` is a separate surface, which is consistent with the current archive treating Type31 gun-marker size separately from method36 targeting configuration/state.

## Strong structural conclusion

There is a high-value architectural isomorphism:

```text
historical updateTargetingInfo scalar count = 9
current Blitz 11.19 method36 scalar count   = 9
```

The first two current values independently close to the first two historical roles:

```text
current root.field1 -> turret-relative yaw  PROVEN relationship
current root.field2 -> gun pitch            PROVEN relationship
```

This strongly supports the current symbolic family:

> `Avatar method36` is the modern Blitz descendant/equivalent of a targeting-info transport surface.

This is **structural support**, not proof that current protobuf field ordering equals the historical flat argument order.

## Critical negative control: do not positional-transplant the remaining seven values

The current 11.19 protobuf is not behaviorally compatible with a naive positional copy of the historical argument list.

Most importantly:

```text
current nested field6.field1 changes after every recorder shot
326 / 326 shot pairs
post - pre is always positive
```

Historical dispersion-factor inputs such as:

```text
gunShotDispersionFactorsTurretRotation
chassisShotDispersionFactorsMovement
chassisShotDispersionFactorsRotation
aimingTime
```

are configuration-like values in the old client implementation, not values expected to receive an instantaneous positive jump after every shot.

Therefore:

> `current field6.field1 = historical argument #6` solely by ordinal position — **REJECTED**.

The current Blitz protobuf likely reorganizes static targeting configuration together with dynamic dispersion/bloom state into a nested message. The exact schema must be recovered from current behavior or a version-matched Blitz definition.

## Current safe semantic grading

```text
root.field1          turret/gun relative yaw             PROVEN relationship
root.field2          gun pitch                           PROVEN relationship
root.field3          targeting/config scalar             PARTIAL
root.field4          targeting/config scalar             PARTIAL
root.field5          targeting/config scalar             PARTIAL
field6.field1        post-shot dispersion/bloom family   VERY STRONG PARTIAL
field6 remaining     targeting/dispersion/aiming family  PARTIAL
```

`field6.field1` may represent a dispersion angle, normalized bloom state, multiplier, or another dynamic aiming scalar. Do not choose among those names without current-version calibration.

## Why this matters for WotBTools

Once `field6.field1` is calibrated, method36 can provide much stronger evidence for AI Review than merely knowing the shot direction:

```text
pre-shot aim state
-> projectile launch
-> immediate post-shot bloom state
```

This can eventually support evidence-backed classification of aimed shots versus snap shots and improve replay reconstruction around gun handling.

Until calibration is closed, production should retain the raw double and expose only a generic `dispersionLikeRaw` / targeting scalar with confidence metadata.

## Next evidence required

1. Compare `field6.field1` absolute values and deltas against Type31 gun-marker size around the same 326 shots.
2. Compare recovery curves after shots to infer whether the quantity decays according to aiming time.
3. Compare tanks with materially different dispersion / aiming-time parameters.
4. Use Gunner injury (`method16 codeB=41`) as a natural perturbation: current Blitz Gunner shell-shock worsens aiming/dispersion behavior.
5. Use Reticle Calibration activation as an independent negative/positive control where present.
6. Recover a version-matched Blitz protobuf/schema if available.

Only promote an exact field name after at least one current-version physical closure or direct schema match.
