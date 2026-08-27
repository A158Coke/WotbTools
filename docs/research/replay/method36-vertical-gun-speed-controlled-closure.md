# Method36 root.field4 — controlled vertical gun-speed closure

> Controlled replay: `uptown.wotbreplay`, Blitz `11.19.0_apple`, recorder vehicle `Maus`.
>
> Purpose: case 6 controlled gun-pitch probe. Vehicle/hull and horizontal turret motion are not used as the discriminator; the proof comes from the recorder Type39 gun-pitch stream itself.

## Verdict

```text
method36.root.field4
= maximum vertical gun pitch/elevation-depression angular speed
= PROVEN physical role for current Blitz 11.19
```

The exact private Wargaming protobuf field name remains unknown. The physical quantity and unit are closed.

## Method36 value

The initialization/configuration snapshot decodes:

```text
root.field3 = 0.2473812228484243
root.field4 = 0.49951977690547217
root.field5 = 2.1792167678269005
```

`root.field4` therefore predicts a vertical gun angular-speed limit of:

```text
0.49951977690547217 rad/s
≈ 28.6204 deg/s
```

## Independent Type39 measurement

Type39 is independently closed as the recorder aim/camera stream, with `f6` representing local gun pitch.

Differentiate the observed Type39 pitch series over replay raw-clock time:

```text
pitchRate = Δ(Type39.f6) / Δt
```

The controlled replay contains repeated positive and negative saturated-rate segments. Representative linear fits are:

```text
18.310070–18.335108 s
pitch slope = +0.4995215408 rad/s

30.907492–30.940794 s
pitch slope = -0.4995260286 rad/s

40.328415–40.478512 s
pitch slope = -0.4995200985 rad/s
```

The longest clean saturated segment differs from `method36.root.field4` by only:

```text
abs(0.4995200985 - 0.4995197769)
≈ 0.0000003216 rad/s
≈ 0.000064 %
```

The sign flips with pitch direction while the magnitude remains the same, exactly as expected for a symmetric maximum vertical traverse-speed magnitude.

## Why this is field-level proof

This is not a historical-schema ordinal transplant.

The closure uses two independent current replay surfaces:

```text
method36.root.field4
  -> static targeting/gun configuration scalar

Type39.f6
  -> live local gun pitch telemetry
  -> differentiated during a controlled pitch sweep
```

The measured live saturation rate numerically equals the method36 scalar to floating-point/clock-sampling tolerance.

Therefore:

> `root.field4` is the recorder gun's maximum vertical pitch/elevation-depression angular speed in radians per second — **PROVEN current physical role**.

## Relationship to root.field3

A previous horizontal-only controlled probe independently showed `root.field3` matching the recorder turret/gun horizontal rotation-speed limit.

The pair can now be modeled as:

```text
root.field3 -> maximum horizontal turret/gun angular speed   PROVEN controlled
root.field4 -> maximum vertical gun angular speed            PROVEN controlled
```

This strongly supports method36 as an actual targeting/gun-configuration protobuf rather than a generic battle-feedback structure.

## Consumer model

For current Blitz 11.19:

```text
TargetingInfoSnapshot {
    ...
    maxHorizontalGunAngularSpeedRadPerSec  // root.field3, proven controlled
    maxVerticalGunAngularSpeedRadPerSec    // root.field4, proven controlled
    ...
}
```

Preserve the raw protobuf fields and client-version provenance.

## Remaining method36 work

Still unresolved at exact field level:

```text
root.field5
field6.field1 exact quantity name/unit
field6.field2
nested field A
nested field B
```

`field6.field1` is already strongly tied to dispersion/bloom because it changes across every recorder shot and doubles under proven Gun damage. The remaining work should focus on controlled dispersion/aiming-time perturbations rather than further horizontal/vertical rotation probes.
