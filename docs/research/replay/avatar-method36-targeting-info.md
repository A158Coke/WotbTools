# Avatar method 36 — recorder targeting / aim-state protobuf

> Base corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Additional controlled probes: WZ-120 horizontal turret-rotation experiment and Maus vertical gun-pitch saturation experiment.
>
> Numeric method IDs and protobuf field numbers are entity-class/version scoped.

## Executive verdict

Avatar method36 is the recorder targeting / aim-state/config snapshot family — **PROVEN behavioral identity / PARTIAL exact private schema**.

Current field-level closures:

```text
root.field1 = recorder turret/gun relative yaw               PROVEN
root.field2 = recorder gun pitch                             PROVEN
root.field3 = maximum horizontal turret/gun angular speed    PROVEN controlled, rad/s
root.field4 = maximum vertical gun angular speed             PROVEN controlled, rad/s
```

The remaining coefficients belong to targeting/dispersion/config state but their exact private names/units are not all closed.

The old `method36 = battle feedback/events` hypothesis is `REJECTED`.

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

Across the original dynamic records, `root.field1` is angle-shaped and uniquely cross-correlates with Type39 `f5`.

```text
median circular error root.field1 vs Type39.f5 ~0.00575 rad
p90                                             ~0.06294 rad
```

Verdict:

> `root.field1 = recorder turret/gun relative yaw` — **PROVEN relationship**.

## root.field2 — gun pitch

`root.field2` uniquely cross-correlates with Type39 `f6`:

```text
median absolute error root.field2 vs Type39.f6 ~0.00181 rad
p90                                            ~0.01224 rad
```

Verdict:

> `root.field2 = recorder gun pitch` — **PROVEN relationship**.

## root.field3 — maximum horizontal turret/gun angular speed

A controlled WZ-120 replay isolated these phases:

- stationary;
- forward/back only;
- hull rotation;
- turret-only rotation;
- hull + turret;
- stationary shot boundary.

method36 configuration contained:

```text
root.field3 = 0.879154807353631 rad/s
```

The controlled turret-only phase physically reached approximately the same horizontal relative-yaw rate (~0.86 rad/s, about 49–50 deg/s), independently matching the current vehicle's horizontal gun/turret traverse behavior.

Verdict:

> `root.field3 = maximum horizontal turret/gun angular speed` — **PROVEN controlled physical role**, unit `rad/s`.

This field is not a live movement-dispersion stream; method36 did not continuously emit through the movement phases.

## root.field4 — maximum vertical gun angular speed

A dedicated Maus controlled replay kept the vehicle/horizontal turret state stable while repeatedly sweeping the gun from maximum depression to maximum elevation and back.

method36 configuration:

```text
root.field4 = 0.49951977690547217 rad/s
```

Observed Type39 `f6` gun-pitch derivatives on saturated linear movement:

```text
18.310070–18.335108s   +0.499521541 rad/s
30.907492–30.940794s   -0.499526029 rad/s
40.328415–40.478512s   -0.499520098 rad/s
```

The clean long-segment difference is approximately:

```text
0.000000322 rad/s
~0.000064%
```

Verdict:

> `root.field4 = maximum vertical gun elevation/depression angular speed` — **PROVEN controlled physical role**, unit `rad/s`.

This is direct physical closure from live gun-pitch derivative, not historical schema-order inference.

## Exact pre-shot / post-shot pairing

Original strict corpus:

```text
recorder method29 launches examined : 326
launches with method36 pair          : 326 / 326
```

Every recorder launch is ordered:

```text
method36 PRE snapshot
-> method29 projectile launch
-> method36 POST snapshot
```

```text
sandwich ordering : 326 / 326
exceptions        : 0
```

## field6.field1 — dispersion/accuracy family

Across the 326 original shot pairs:

```text
nested field6.field1 changes : 326 / 326
post-shot delta is always positive
```

Observed delta range:

```text
min    ~+0.0543
median ~+0.0642
max    ~+0.1228
```

Independent Gun-damage closure:

```text
baseline -> exactly ×2 while Gun damaged -> baseline after Repair Kit
```

Therefore `field6.field1` is safely modeled as a **dispersion/accuracy/bloom-family scalar**. Exact private field name and normalized unit remain unresolved.

## Controlled Adrenaline negative control

In the WZ-120 controlled movement replay, Adrenaline activated between two shots. The tested method36 targeting/config scalar set did not change because of Adrenaline.

Safe conclusion:

> Adrenaline's observed effect belongs to reload/gun-cycle behavior rather than this method36 targeting/config scalar set.

## Historical architecture cross-check

Historical Wargaming targeting APIs contain concepts such as turret yaw, gun pitch, rotation limits, dispersion factors and aiming time. That architecture is compatible with the current nested protobuf.

Correct use:

```text
current replay behavior -> field semantic closure
historical schema        -> architecture cross-check only
```

Do not transplant historical flat argument ordering into current Blitz.

## Rejected/superseded interpretations

```text
method36 == battle feedback/events                     REJECTED
root.field3 remains one of seven wholly-unmapped scalars SUPERSEDED
root.field4 remains an unproven rotation-speed candidate SUPERSEDED
method36 is a continuous movement-dispersion stream      REJECTED by controlled movement probe
```

## Production-safe model

```text
TargetingInfoSnapshot {
    rawClockSec
    phase                  // NORMAL / PRE_SHOT / POST_SHOT
    turretYawRad           // root.field1, PROVEN
    gunPitchRad            // root.field2, PROVEN
    maxHorizontalRateRadS  // root.field3, PROVEN controlled
    maxVerticalRateRadS    // root.field4, PROVEN controlled
    dispersionLikeRaw      // field6.field1, physical family closed
    remainingConfigRaw     // preserve remaining coefficients
    source = AVATAR_METHOD36
}
```

## Remaining work

Only the genuinely unresolved targeting boundaries remain:

1. identify exact private names/units for `root.field5`, `field6.field1`, `field6.field2` and the two deepest nested scalars;
2. explain the small number of historical shot pairs where root.field3 changed at a shot boundary without contradicting its configuration role;
3. recover a version-matched Blitz protobuf definition if available;
4. validate numeric/schema stability on later client versions before widening support.
