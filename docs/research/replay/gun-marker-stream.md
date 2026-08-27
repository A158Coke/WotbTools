# Type31 — recorded arcade gun-marker size

> Corpus: 34 strict-framing unique arenas / 44 source replay files, Blitz 11.19.0 China.

## Verdict

> Type31 is the recorder's **recorded arcade gun-marker / aiming-circle size scalar** — `PROVEN behavioral identity + independent replay-writer evidence` for the current corpus.

It is not a direct hit-probability value and must not be treated as authoritative projectile dispersion without the surrounding client aiming model.

## Wire shape

Every observed Type31 packet is exactly:

```text
float32 size
```

Current strict-corpus count:

```text
137,161 records
```

Observed scalar range:

```text
min    6.75
median ~27.01
p90    ~43.90
max    54.0
```

The stream is high-frequency. For positive sub-second adjacent deltas:

```text
median dt ~= 0.00835 s
frequency ~= 119.8 Hz
```

This is a live recorder presentation/aiming stream, not a low-rate settlement or server-event feed.

## Independent Wargaming replay-writer evidence

The Wargaming default gun-marker controller explicitly records the marker's `size` value through the native replay manager while a replay is being recorded:

```text
if replayCtrl.isRecording:
    ...
    replayCtrl.setArcadeGunMarkerSize(size)
```

During playback the same controller reads the value back through:

```text
replayCtrl.getArcadeGunMarkerSize()
```

The client code then projects that recorded world/marker size into a screen-space circle using the current marker position and projection state.

This supplies an independent one-float replay channel with exactly the semantics and update cadence observed in Type31.

## Behavioral closure

The Type31 scalar behaves as an aiming-circle/gun-marker size rather than a generic timer:

- it changes continuously at approximately display/update cadence;
- firing windows produce the expected disturbance/expansion behavior;
- it subsequently relaxes/contracts as aiming settles;
- movement/aim changes can keep it elevated or interrupt convergence;
- the same stream exists independently from authoritative shot, hit and HP facts.

The current values should therefore be interpreted as the replay-recorded marker-size state itself, not reverse-converted into an unproven physical dispersion angle.

## Safe canonical representation

```text
GunMarkerSizeSample {
    rawClockSec
    arcadeMarkerSize : float32
    source           : REPLAY_TYPE31
}
```

Potential uses:

- Battle Playback: reproduce the player's aiming-circle expansion/convergence;
- AI Review: quantify whether the player fired while the marker was still large vs substantially aimed-in;
- shot analysis: sample marker size immediately before recorder fire;
- UX reconstruction: synchronize marker size with Type39 aim-ray geometry.

## Relationship to Type39

Type31 and Type39 both run at approximately high client-frame/update cadence but carry different information:

```text
Type31 -> marker/aim-circle size scalar
Type39 -> aim-ray orientation + world aim-ray point + additional camera/turret state
```

They should be joined by replay raw clock for recorder aiming reconstruction.

## Important boundaries

Type31 does **not** by itself prove:

- shell impact dispersion;
- server RNG result;
- penetration probability;
- exact gun dispersion angle in radians;
- reticle pixel radius on every screen resolution;
- client vs server marker selection in versions/settings not represented by this corpus.

The Wargaming controller records the marker `size` before later screen projection/scaling, so consumers should preserve the raw scalar and avoid inventing pixel units.

## Remaining work

1. determine the exact world/marker units used by Blitz 11.19 for the recorded scalar;
2. correlate pre-shot Type31 values with vehicle/gun base dispersion and movement penalties;
3. determine whether server-aim configuration can cause a different source marker to be recorded while preserving Type31's top-level packet number;
4. validate Type31 numbering and range on additional Blitz versions.
