# Vehicle method4 — vehicle-to-vehicle collision contact family

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Numeric Type8 method IDs are entity-class and client-version scoped. This note describes **Vehicle-targeted method4 with 16-byte args** only. Avatar-targeted method4 uses a different 2-byte schema and is unrelated.

## Wire structure

All current Vehicle-targeted method4 events use exactly 16 bytes:

```text
sharedScalar : f32 LE
contactPoint : VECTOR3<f32>
```

Canonical corpus:

```text
records : 123
```

The three-vector is spatial rather than arbitrary data. Joining each event to the nearest same-vehicle Type10 transform gives:

```text
distance(vehicle center, contactPoint)

min    ≈ 1.77 m
median ≈ 3.63 m
max    ≈ 4.96 m
```

These distances are characteristic of a point on/near a tank hull rather than an unrelated world coordinate.

## Paired vehicle-contact closure

Grouping method4 records by exact replay raw clock gives:

```text
2 records at same clock : 51 groups
1 record at same clock  : 21 groups
```

Of the 51 two-record groups:

```text
50 / 51 contain two distinct vehicle entity IDs
1 / 51 contains two records for the same vehicle
```

For the 50 distinct-vehicle pairs:

```text
two method4 sharedScalar values are exactly equal : 50 / 50
```

and the two advertised contact points are almost the same world-space point:

```text
distance(contactPointA, contactPointB)

min    ≈ 0.0068 m
median ≈ 0.0666 m
p90    ≈ 0.111 m
max    ≈ 0.286 m
```

At the same time, the two involved Type10 vehicle centers are physically close:

```text
distance(vehicleCenterA, vehicleCenterB)

min    ≈ 5.12 m
median ≈ 6.94 m
max    ≈ 9.01 m
```

This is the expected geometry of two full-size tanks touching/interpenetrating at one shared contact point.

## Relationship to Vehicle method6

Vehicle method6 is independently proven as the static/world-collision contact family and carries:

```text
scalar:f32 + contactPoint3f + normal3f + flag:u8
```

Method4 differs in an important way:

- method6 usually concerns one vehicle against static/world geometry and includes an explicit contact normal;
- method4 commonly appears as a synchronized pair for two different vehicle entities, with the same scalar and the same physical contact point.

Only a small minority of method4 events share an exact clock with method6, so method4 is not merely a truncated duplicate of the static-collision notification.

Verdict:

> Vehicle method4 = **vehicle-to-vehicle collision/contact notification family — PROVEN physical relationship for current corpus**.

## Ramming-death closure

Settlement `PlayerResults.field105=2` is independently proven as ramming death. The canonical 34-arena corpus contains two such deaths.

For both ramming deaths, the victim vehicle has a method4 collision-contact event immediately before its terminal Vehicle property3 HP state:

```text
ramming deaths with method4 within ±1.0 s of terminal HP : 2 / 2
```

In both cases method4 precedes terminal HP by approximately:

```text
~0.317 s
```

As a negative control, among 202 ordinary/default deaths with a comparable terminal property3 sample:

```text
ordinary deaths with method4 within ±1.0 s : 2 / 202
```

This makes method4 strong independent supporting evidence for a ramming death chain, while settlement remains authoritative for the final death reason.

Safe hierarchy:

```text
method4
  -> vehicle-to-vehicle physical contact evidence

Vehicle prop3 terminal HP
  -> observed terminal vehicle state/time

settlement field105=2
  -> authoritative ramming death reason
```

Method4 must not be used by itself to claim that the collision caused damage or death.

## `sharedScalar`

The first float is identical across both participants in every clean paired collision sample. Its observed magnitude does not track replay raw clock and does not correlate cleanly with a simple finite-difference relative-speed estimate.

It is therefore safest to preserve as a shared collision scalar such as an impulse/strength/server collision parameter without assigning an exact symbolic meaning.

Verdict:

> `sharedScalar` = **shared per-collision physical parameter — PROVEN paired identity / PARTIAL exact physical unit and name**.

## Safe parser model

```text
VehicleVehicleCollisionEvent {
    rawClockSec
    vehicleEntityId
    sharedScalar
    contactPointWorld
}
```

A higher-level reconstruction may pair two events when all of these hold:

```text
same replay raw clock
sharedScalar equal
contactPoint distance is very small
vehicle entities are distinct
```

Safe uses:

- battle playback: mark vehicle-to-vehicle contact/ramming geometry;
- AI review: support statements that two tanks physically collided;
- death analysis: provide collision evidence that can be joined to settlement `deathReason=2` ramming cases.

Unsafe without further proof:

- converting `sharedScalar` directly into damage, relative speed or force;
- using method4 alone to assign ramming damage/killer;
- applying this 16-byte decoder to Avatar method4.
