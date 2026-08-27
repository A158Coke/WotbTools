# Avatar method28 — recorder death-projectile terminal geometry

> Corpus: strict-framing 34 unique Blitz 11.19 China arenas.
>
> Numeric method IDs are Avatar/version scoped. This document describes current 11.19 behavior only.

## Executive verdict

Avatar method28 is a fixed 36-byte / 9-float32 geometry event tied to projectile-caused recorder death.

Current body:

```text
A : VECTOR3
A : VECTOR3   // exact duplicate of first vector in 24 / 24
B : VECTOR3
```

`B` is the projectile terminal endpoint from Avatar method20, while `A -> B` is an approximately 100-world-unit segment aligned almost perfectly with the projectile launch velocity.

Across the current corpus, method28 appears exactly around recorder direct-projectile death / immediate post-mortem projectile handling. It does not occur for surviving recorders or the observed ramming death.

Verdict:

> method28 = **incoming death-projectile / death-view terminal trajectory geometry family — PROVEN behavioral identity / PARTIAL symbolic RPC name**.

## Geometry closure

Observed method28 packets:

```text
count      : 24
arg length : 36 bytes for 24 / 24
layout     : 9 x float32 LE
A1 == A2   : 24 / 24 exact
```

For every event, the third VECTOR3 `B` is compared with the same-clock Avatar method20 `stopTracer` endpoint.

```text
method28 B == method20 terminal endpoint : 24 / 24
coordinate error                         : 0
```

For the 23 events with a same-shot method29 launch available, the vector `B - A` is compared with method29 projectile launch velocity.

```text
|B - A| range        : ~99.68 .. 104.04 world units
median                : ~101.35

cos(B-A, launchVel)
min                   : ~0.999958
median                : ~0.9999976
max                   : ~0.99999995
```

Therefore `A -> B` is a short terminal trajectory segment immediately preceding the projectile endpoint, not an arbitrary target/camera vector.

## Recorder-death closure

The 34 arenas split cleanly by recorder outcome.

- 23 arenas: recorder dies to a direct projectile/vehicle-shot family.
- 10 arenas: recorder survives.
- 1 arena: recorder dies by ramming (`deathReason=2`).

Observed method28 coverage:

```text
direct-projectile death arenas with method28 : 23 / 23
surviving recorder arenas with method28       :  0 / 10
ramming-death arena with method28              :  0 / 1
```

Twenty-two of the 23 direct-projectile death arenas have a recoverable same-shot method29 launch. In all 22:

```text
method29 shooter == settlement killerID : 22 / 22
```

The remaining direct-death arena lacks the method29 launch boundary but still has method20/method28 terminal evidence.

## Last-hit ordering

For every arena carrying method28, the event occurs on the recorder's final observed Vehicle method8 damage boundary.

Most arenas contain exactly one method28 event.

One arena contains two events separated by ~0.18 s:

- the first projectile is from the settlement killer;
- the second projectile arrives immediately after the lethal boundary from another shooter.

This indicates that the family is associated with death/death-view incoming projectile geometry rather than a strict single-record `killerShotOnly` model. A consumer should therefore retain every observed method28 around the terminal window rather than arbitrarily dropping post-mortem geometry.

## Relationship to other projectile events

Current terminal chain for this family:

```text
non-recorder Vehicle method0 showShooting
        |
Avatar method29 launch (23 / 24 available)
        | shotId
        v
Avatar method20 stopTracer / terminal endpoint
        |
        +--> Vehicle method8 damage on recorder
        |
        +--> Avatar method28 terminal ~100m trajectory segment
```

method28 is not method27 `explodeProjectile`: the current 24 method28 events have no same-clock method27 event.

It is also not recorder method38 shot-result feedback; method38 is recorder-outgoing shot feedback, whereas method28 describes incoming terminal geometry at recorder death.

## Symbolic-name boundary

Historical Wargaming interfaces contain projectile/hitting-area/death-view presentation RPCs, but the current 36-byte `3 x VECTOR3` Blitz layout has not yet been matched to a version-identical symbolic `.def` declaration.

Therefore do not hardcode an old PC method name solely from conceptual similarity.

Safe schema:

```text
DeathProjectileGeometryEvent {
    rawClockSec
    segmentStart
    segmentEnd
    terminalEndpoint = segmentEnd
    shotId?          // joined through same-clock method20
    shooterEntityId? // joined through method29 when available
    confidence
}
```

## Product value

Safe uses:

- Battle Playback: draw the final incoming projectile segment that killed the replay author;
- AI Review: identify the direction/source of the lethal incoming shot when shooter linkage exists;
- death analysis: distinguish projectile death from ramming/fire/world-collision using settlement plus event geometry;
- multi-POV analysis: preserve the recorder-specific nature of this death-view event.

Do not generalize method28 to every incoming shot: only the terminal/death boundary is proven in the current corpus.
