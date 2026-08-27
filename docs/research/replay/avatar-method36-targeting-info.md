# Avatar method 36 — recorder targeting / aim-state protobuf

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Numeric method IDs are entity-class and version scoped. This document describes the current Avatar-targeted 11.19 corpus only.

## Executive verdict

Avatar method 36 is no longer UNKNOWN. The current corpus proves that it carries the recorder's targeting / aiming state and forms an exact pre-shot / post-shot snapshot pair around every recorder projectile launch.

Verdict:

> `Avatar method36` = **recorder targeting / aim-state family — PROVEN behavioral identity / PARTIAL exact current symbolic schema**.

The earlier temporary `battle events / battle feedback` hypothesis is REJECTED by stronger corpus evidence.

## Two wire variants

Strict 34-arena counts:

```text
method36 total : 858
92-byte body   : 824
74-byte body   :  34
```

Both variants are one-byte length-prefixed protobuf messages:

```text
92-byte body: first byte 0x5B = 91 remaining bytes
74-byte body: first byte 0x49 = 73 remaining bytes
```

The remaining bytes parse cleanly as standard protobuf wire types.

## Protobuf scalar surface

The 92-byte variant exposes nine scalar `fixed64` / double-like values through a nested message shape.

Conceptually:

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

The 74-byte variant has the same static/configuration subtree but omits `root.field1` and `root.field2`.

Exactly one 74-byte record occurs per arena (`34 / 34`), consistent with an initialization/configuration snapshot before dynamic gun angles are supplied.

## root.field1 = recorder turret-relative yaw

Across the 824 dynamic records, `root.field1` is angle-shaped:

```text
range approximately -2.65 .. +3.06 rad
```

It was independently compared with the nearest Type39 seven-float recorder aim/camera stream.

The best and overwhelmingly unique match is Type39 `f5`, already behaviorally identified as the recorder gun/turret-relative yaw candidate.

```text
median circular error root.field1 vs Type39.f5 : ~0.00575 rad
p90                                        : ~0.06294 rad
```

No other Type39 field is remotely comparable.

Verdict:

> `method36.root.field1` = **recorder turret/gun relative yaw — PROVEN relationship**.

## root.field2 = recorder gun pitch

`root.field2` lies in a gun-elevation-like interval:

```text
approximately -0.30 .. +0.14 rad
```

Nearest-Type39 comparison again gives one unique match:

```text
median absolute error root.field2 vs Type39.f6 : ~0.00181 rad
p90                                             : ~0.01224 rad
```

Verdict:

> `method36.root.field2` = **recorder gun pitch — PROVEN relationship**.

## Exact pre-shot / post-shot pairing

Recorder identity is inferred independently from the dominant method29 shooter that closes against recorder settlement shots.

Across the strict corpus:

```text
recorder method29 launches examined : 326
launches with method36 pair          : 326 / 326
```

For every recorder launch, packet order is exactly:

```text
method36 snapshot A
  -> method29 projectile launch
  -> method36 snapshot B
```

Result:

```text
sandwich ordering : 326 / 326
exceptions        : 0
```

At each recorder shot clock there are exactly two 92-byte method36 records.

There are also 176 additional single-snapshot method36 clocks not tied to a recorder shot.

A strong arena-level identity holds for all 34 arenas:

```text
method36_92B_event_count
  = method36_92B_unique_clock_groups
  + recorder_method29_launch_count
```

This is exactly what is expected when normal update clocks contain one snapshot and every shot clock contains one additional post-shot snapshot.

## What changes across the shot

Comparing the two method36 messages surrounding each of the 326 recorder launches:

```text
nested field6.field1 changes : 326 / 326
root field3 also changes     :   2 / 326
all other decoded scalar fields remain identical for the shot pair
```

The nested `field6.field1` delta is always positive in the observed corpus:

```text
post-shot minus pre-shot
min    : ~+0.0543
median : ~+0.0642
max    : ~+0.1228
```

This is strongly consistent with an instantaneous post-shot dispersion/bloom factor.

Exact symbolic naming remains PARTIAL until a version-matched Blitz schema is recovered, so production should expose it as a targeting/dispersion scalar rather than hard-code a historical PC field name.

## Historical schema cross-check

Independent Wargaming Avatar client code exposes replay-visible `updateTargetingInfo(...)` data containing:

- turret yaw;
- gun pitch;
- turret/gun rotation limits;
- shot-dispersion multiplier/factors;
- aiming time.

The current method36 protobuf contains exactly nine scalar values, the first two independently close to turret yaw and gun pitch, and the remaining values are slow-changing or configuration-like numbers in plausible targeting/dispersion/aim-time ranges.

This is strong architectural support for the `targeting-info` family, but historical flat argument ordering must not be transplanted onto the current Blitz nested protobuf without field-level current-version proof.

## Rejected hypothesis: method36 = battle feedback/events

The earlier provisional hypothesis was motivated by the frequent same-clock relationship with method38 hit feedback.

The complete shot-level analysis rejects it:

- method36 pairs exist for **every recorder launch**, not only hits;
- 326/326 recorder launches are exactly bracketed by method36 snapshots;
- the decoded first two fields are physical gun yaw/pitch;
- the only universal pre/post-shot change is a dispersion-like scalar.

Therefore:

> `method36 = battleEvents / battle feedback` — **REJECTED / SUPERSEDED**.

## Safe consumer model

```text
TargetingInfoSnapshot {
    rawClockSec
    phase               // NORMAL / PRE_SHOT / POST_SHOT when derivable
    turretYawRad        // proven
    gunPitchRad         // proven
    configScalarsRaw    // remaining decoded protobuf fixed64 values
    dispersionLikeRaw   // nested field that increases after every shot
    source = AVATAR_METHOD36
}
```

Safe uses:

- reconstruct recorder gun orientation more precisely;
- mark exact pre/post-shot targeting state;
- improve AI Review evidence around aimed vs snap-shot behavior once the dispersion scalar receives a stable semantic calibration;
- cross-check Type39 gun-angle telemetry.

Do not expose historical field names for the remaining seven scalars until current-version evidence closes them.

## Remaining work

1. map the remaining seven scalars against tank gun parameters and Type39/other targeting telemetry;
2. identify whether the universal post-shot-changing scalar is dispersion angle, multiplier, bloom, or another normalized quantity;
3. recover a version-matched Blitz targeting protobuf definition;
4. determine why two shot pairs also change root field3;
5. validate the same schema on non-11.19 clients before widening version support.
