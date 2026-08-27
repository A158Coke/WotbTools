# Avatar method 36 — recorder targeting / aim-state protobuf

> Base corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Additional controlled probes: WZ-120 horizontal turret rotation, controlled vertical gun-pitch saturation, Gun damage/repair and Reticle Calibration.
>
> Numeric method IDs and protobuf field numbers are entity-class/version scoped.

## Executive verdict

Avatar method36 is the recorder targeting / aim-state/config snapshot family — **PROVEN behavioral identity**.

Current physical-role closures:

```text
root.field1
= turret/gun relative yaw
= PROVEN

root.field2
= gun pitch
= PROVEN

root.field3
= max horizontal turret/gun angular speed
= PROVEN controlled

root.field4
= max vertical gun angular speed
= PROVEN controlled

root.field5
= aiming-time physical scalar
= PROVEN

field6.field1
= dynamic gun dispersion / bloom scalar
= PROVEN physical role
```

The unresolved boundary is private/current protobuf naming and the exact display/UI formula for some scalars, not the physical roles above.

## Wire variants

Original strict 34-arena corpus:

```text
method36 total : 858
92-byte body   : 824
74-byte body   :  34
```

Both are one-byte length-prefixed protobuf bodies:

```text
92-byte body: first byte 0x5B = 91 remaining bytes
74-byte body: first byte 0x49 = 73 remaining bytes
```

Conceptual scalar tree:

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

The 74-byte initialization/config variant omits dynamic `root.field1/root.field2`.

## root.field1 — turret/gun relative yaw

Across the original dynamic records, `root.field1` uniquely cross-correlates with Type39 `f5`.

```text
median circular error root.field1 vs Type39.f5 ~0.00575 rad
p90                                             ~0.06294 rad
```

Verdict:

> `root.field1 = recorder turret/gun relative yaw` — **PROVEN**.

## root.field2 — gun pitch

`root.field2` uniquely cross-correlates with Type39 `f6`:

```text
median absolute error root.field2 vs Type39.f6 ~0.00181 rad
p90                                            ~0.01224 rad
```

Verdict:

> `root.field2 = recorder gun pitch` — **PROVEN**.

## root.field3 — max horizontal turret/gun angular speed

A controlled WZ-120 replay isolated a stationary turret-only rotation phase.

```text
root.field3 = 0.879154807353631 rad/s
```

The measured live relative-yaw rate reaches the same physical limit within replay sampling/control tolerance.

Verdict:

> `root.field3 = max horizontal turret/gun angular speed` — **PROVEN controlled**, physical unit `rad/s`.

## root.field4 — max vertical gun angular speed

A controlled vertical gun-pitch sweep independently measured Type39 `f6` derivatives at the saturation plateau.

```text
method36.root.field4 = 0.49951977690547217 rad/s
observed pitch-rate  ~= ±0.49952 rad/s
```

Verdict:

> `root.field4 = max vertical gun angular speed` — **PROVEN controlled**, physical unit `rad/s`.

## root.field5 — aiming-time physical scalar

Reticle Calibration provides an exact reversible boundary:

```text
baseline                 2.158029879254315
Reticle Calibration      1.5106208897522997
ratio                     0.70
end                       exact baseline restoration
```

Verdict:

> `root.field5 = aiming-time physical scalar` — **PROVEN physical role**.

The exact private protobuf symbol and exact UI/display conversion formula remain UNKNOWN/PARTIAL.

## Exact pre-shot / post-shot pairing

Original strict corpus:

```text
recorder method29 launches examined : 326
launches with method36 pair          : 326 / 326
sandwich-order exceptions            : 0
```

Every recorder launch is ordered:

```text
method36 PRE snapshot
-> method29 projectile launch
-> method36 POST snapshot
```

## field6.field1 — dynamic gun dispersion / bloom scalar

Across the 326 original shot pairs:

```text
field6.field1 changes : 326 / 326
post-shot delta       : always positive
```

Independent perturbations:

```text
ordinary shot       -> immediate positive bloom increase
Gun damage          -> field6.field1 ×2
Repair Kit          -> exact baseline restoration
Reticle Calibration -> field6.field1 ×0.70
Reticle end         -> exact baseline restoration
```

Verdict:

> `field6.field1 = dynamic gun dispersion / bloom scalar` — **PROVEN physical role**.

The exact private protobuf symbol and exact display/UI unit/formula remain UNKNOWN/PARTIAL. Do not automatically equate the raw scalar with the user-facing `dispersion at 100m` number.

## Adrenaline control

In the controlled WZ-120 sample, Adrenaline activation does not change the tested method36 targeting/config scalar set. Its observed effect is carried by reload/gun-cycle telemetry rather than these targeting scalars.

## Production-safe model

```text
TargetingInfoSnapshot {
    rawClockSec
    phase                  // NORMAL / PRE_SHOT / POST_SHOT
    turretYawRad           // root.field1, PROVEN
    gunPitchRad            // root.field2, PROVEN
    maxHorizontalRateRadS  // root.field3, PROVEN controlled
    maxVerticalRateRadS    // root.field4, PROVEN controlled
    aimingTimeScalarRaw    // root.field5, PROVEN physical role
    dispersionBloomRaw     // field6.field1, PROVEN physical role
    remainingConfigRaw     // remaining static coefficients, PARTIAL
    source = AVATAR_METHOD36
}
```

## Remaining boundaries

```text
exact private protobuf symbols                           UNKNOWN
root.field5 exact display/UI conversion formula          UNKNOWN/PARTIAL
field6.field1 exact display/UI unit/formula              UNKNOWN/PARTIAL
field6.field2 and deepest static coefficients             PARTIAL
cross-version numeric/schema stability                   UNKNOWN until regression-tested
```

The evidence distinction is explicit:

> **physical role: PROVEN**
>
> **private Wargaming field symbol: UNKNOWN**
