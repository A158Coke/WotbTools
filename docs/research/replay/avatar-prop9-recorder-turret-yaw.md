# Avatar property9 — recorder own-vehicle turret-relative yaw mirror

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Numeric property IDs are entity-class and version scoped. This document describes Avatar-targeted property9 only; Vehicle-targeted property9 is a different wire family.

## Wire shape

Avatar property9 is:

```text
payload : float32 LE
```

Canonical corpus:

```text
Avatar property9 records : 67,371
payload length 4 bytes   : 67,371 / 67,371
```

Vehicle-targeted property9 has different 1–3 byte layouts and must not use this decoder.

## Independent cross-surface closure

Vehicle property2 is independently proven as turret yaw relative to the vehicle hull. Its current conversion is:

```text
turretRelativeYawRad = rawU16 * 2π / 65536 - π
```

For each replay, Avatar property9 was compared against the property2 stream of every visible/settled Vehicle entity. Exactly one vehicle per replay forms a near-identity relationship; the other vehicles do not. That unique vehicle is the recorder's own vehicle under the already-established recorder/roster identity mapping.

Across 55,081 matched current-corpus samples within the narrow packet-time join window:

```text
abs(Avatar prop9 - recorder Vehicle prop2 yaw)

median ≈ 0.00528 rad  (~0.30°)
p90    ≈ 0.00784 rad
p99    ≈ 0.00881 rad
```

Per-replay correlation against the matching recorder vehicle is extremely high:

```text
median correlation ≈ 0.999993
best                 ≈ 0.999998
lowest current replay ≈ 0.9557
```

The lower-correlation replay still has the same very small angular-error relationship; correlation is reduced by limited angular variance rather than a different physical quantity.

Verdict:

> Avatar property9 = **recorder own-vehicle turret-relative yaw mirror — PROVEN physical relationship for current corpus**.

## Relationship to Type39 f5

Type39 `f5` was previously classified as a relative turret/camera-yaw family. Avatar property9 provides the missing independent bridge:

```text
Avatar prop9 <-> recorder Vehicle prop2
```

is near-identical, and:

```text
Avatar prop9 <-> Type39 f5
```

has current-corpus correlation approximately `0.9883` during the recorder-local stream.

Therefore Type39 `f5` can be interpreted much more narrowly during recorder-controlled vehicle periods as the same recorder relative-turret-yaw physical family, subject to the already documented spectator/viewpoint caveat after death/viewpoint switching.

## Safe model

```text
RecorderTurretRelativeYaw {
    rawClockSec
    yawRad : float32
    source = AVATAR_PROPERTY_9
}
```

Safe uses:

- recorder turret orientation reconstruction;
- cross-check Vehicle property2 decoding;
- improve Type39 aim/camera interpretation;
- battle playback hull + turret reconstruction.

Do not apply the Avatar float decoder to Vehicle-targeted property9 records.
