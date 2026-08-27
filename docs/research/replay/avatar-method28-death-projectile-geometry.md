# Avatar method28 — recorder death-projectile terminal geometry

> Corpus: strict-framing 34 unique Blitz 11.19 China arenas.
>
> Numeric method IDs are Avatar/version scoped. This document describes current 11.19 behavior only.

## Executive verdict

Avatar method28 is a fixed 36-byte / 9-float32 geometry event tied to projectile-caused recorder death / immediate post-mortem projectile handling.

Current body:

```text
P1 : VECTOR3
P2 : VECTOR3
B  : VECTOR3
```

`B` is the projectile terminal endpoint from Avatar method20. In the ordinary single-projectile terminal case `P1 == P2`, but a newly isolated same-clock multi-projectile edge case proves that equality is **not a protocol invariant**.

Verdict:

> method28 = **incoming death-projectile / death-view terminal trajectory geometry family — PROVEN behavioral identity / PARTIAL exact symbolic RPC name**.

## Geometry closure

Observed method28 packets:

```text
count      : 24
arg length : 36 bytes for 24 / 24
layout     : 9 x float32 LE
P1 == P2   : 23 / 24 exact
```

For every event, the third VECTOR3 `B` exactly equals a same-clock Avatar method20 `stopTracer` endpoint:

```text
method28 B == method20 terminal endpoint : 24 / 24
coordinate error                         : 0
```

For ordinary single-projectile terminal samples, the segment from the repeated `P1/P2` point to `B` is approximately 100 world units and aligns almost perfectly with the matching method29 projectile velocity. This remains the dominant current behavior.

## The 1/24 non-duplicate edge case

Replay:

```text
20260822_1231__CHRD-A158布丁_VK7201_1161440170298931846
rawClock ≈ 138.187 s
```

At this exact clock the recorder stream contains **two method29 projectile-launch records** plus multiple same-clock damage records around the terminal boundary.

For this one method28 body:

```text
P1 != P2
```

and `P2` is essentially identical to the second same-clock method29 launch-position vector, while `P1 -> B` remains aligned with the other projectile trajectory family.

This disproves the earlier archive statement:

```text
P1 == P2 in 24 / 24
```

That statement is **SUPERSEDED**.

Safe conclusion:

> method28 can carry two distinct projectile/death-view geometry points when multiple projectile events overlap at the same terminal clock. Consumers must preserve all three vectors losslessly and must not normalize `P2 = P1`.

## Recorder-death closure

The 34 arenas split as:

- direct-projectile recorder deaths;
- recorder survivors;
- one recorder ramming death.

method28 is confined to the direct-projectile death / immediate post-mortem projectile boundary in the current corpus. It does not occur for the observed recorder survivor set or ramming death.

One arena carries two method28 events separated by roughly 0.18 s: the first is on the lethal projectile boundary and the second is an immediate post-mortem incoming projectile. Therefore this is a death-view terminal projectile family rather than a strict `killerShotOnly` packet.

## Relationship to other projectile events

Safe current chain:

```text
Vehicle firing observation
        |
Avatar method29 projectile launch
        | shot/projectile identity
        v
Avatar method20 stopTracer / terminal endpoint
        |
        +--> Vehicle method8 / method1 damage-terminal evidence
        |
        +--> Avatar method28 terminal/death-view geometry
```

method28 is distinct from method27 `explodeProjectile` and from recorder-outgoing method38 shot-result feedback.

## Safe schema

```text
DeathProjectileGeometryEvent {
    rawClockSec
    point1
    point2
    terminalEndpoint
    joinedShotId?
    joinedShooterEntityId?
    confidence
}
```

Do **not** collapse `point1` and `point2` merely because 23/24 current samples happen to be equal.

## Product value

Safe uses:

- Battle Playback: render terminal incoming projectile/death-view geometry;
- AI Review: recover lethal incoming direction/source when shooter linkage exists;
- death analysis: distinguish projectile death from ramming/fire/environment using settlement + live geometry;
- preserve overlapping post-mortem projectile events rather than dropping them as duplicates.

Do not generalize method28 to every incoming shot; current proof is terminal/death-view scoped.