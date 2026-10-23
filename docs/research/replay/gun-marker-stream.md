# Type31 — recorder scoped camera zoom/FOV-like stream

> Corpus: 34 strict-framing unique arenas / 44 source replay files, Blitz 11.19.0 China.
>
> **SUPERSEDED NOTICE (2026-10-18):** this document previously identified Type31 as the recorder arcade gun-marker / aiming-circle size. New corpus-wide camera-state analysis rejects that interpretation. The current canonical closure is documented in [`recorder-camera-state.md`](recorder-camera-state.md).

## Current verdict

> Type31 is the recorder's **scoped-camera automatic zoom/FOV-like raw scalar** — `PROVEN scoped-camera relationship / VERY STRONG behavioral identity` for the current 11.19 corpus.

The previous primary semantic:

```text
Type31 = arcade gun-marker / aiming-circle size
```

is `REJECTED / SUPERSEDED`.

The independently proven gun-dispersion/bloom authority is Avatar method36 `field6.field1`, not Type31.

## Wire shape

Every observed Type31 packet is exactly:

```text
float32 zoomFovRaw
```

Current strict-corpus count:

```text
137,161 records
```

Observed scalar range:

```text
min    6.75
median ~27.006
max    54.0
```

The stream is high-frequency while active:

```text
median dt ~= 0.00835 s
frequency ~= 119.8 Hz
```

## Exact relationship to Type23

Type31 is not continuously present through normal third-person replay state. It is strictly gated by Type23's scoped family:

```text
Type23 non-default sessions  703
Type31 active runs           703
```

For every observed scoped session:

```text
Type23 enters scoped family
  -> first Type31 sample median +8.575 ms
  -> Type31 updates at ~120 Hz
  -> final Type31 sample occurs at the Type23 exit clock
  -> Type23 returns to ARCADE/default and Type31 stops
```

There is no Type31 stream through ordinary arcade gaps.

Current Type23 normalization for Blitz 11.19:

```text
rawMode  = Type23.u32
modeCode = rawMode & 0x7fffffff

modeCode == 1 -> ARCADE/default
modeCode == 0 -> SNIPER/scoped
```

The Type23 high bit remains semantically UNKNOWN and must be preserved raw.

## Why the old marker-size interpretation is rejected

### Independent gun-bloom negative control

Avatar method36 `field6.field1` is independently closed as dynamic gun dispersion/bloom through shot, Gun-damage/repair and Reticle Calibration controls.

For 418 same-time Type31/method36 pairs:

```text
corr(Type31, proven dispersionBloomRaw) ~= -0.01168
```

This is effectively zero.

### Static no-shot scoped sessions

The canonical corpus contains 18 scoped sessions satisfying all of:

- no recorder shot during the session;
- no shot in the preceding ~2 seconds;
- recorder vehicle stationary;
- turret span <1°;
- gun-pitch span <1°.

Representative SPHT session:

```text
Type23 1 -> 0 at 32.461296
+~0.008 s Type31 53.97598
+~0.50 s          29.47
+~1.00 s          27.00768
then ~27.00768 remains stable for ~5 s
Type23 0 -> 1 at 38.538692
```

Aim distance remains approximately 231.76 m. With the vehicle, turret and gun effectively static and no firing boundary, this transition cannot be explained as physical post-shot bloom or movement dispersion.

### Vehicle-independent camera transition

For 195 clean sessions beginning above 53.8 and settling near 27, the first crossing of `Type31 <= 27.1` occurs at:

```text
median ~0.616959 s
p10    ~0.6108 s
p90    ~0.6338 s
```

Per-vehicle medians are effectively identical:

```text
SPHT    ~0.616959 s
FV215b  ~0.616945 s
Ho-Ri   ~0.616959 s
Maus    ~0.616959 s
```

Correlation between this transition duration and the independently proven method36 aiming-time scalar is approximately `0.003`.

This is consistent with a fixed camera transition and inconsistent with a vehicle/gun aiming-time process.

## Zoom interpretation boundary

Current behavior supports:

```text
smaller Type31 raw value -> deeper scoped zoom
```

The numeric structure is notable:

```text
54 / 2 = 27
54 / 4 = 13.5
54 / 8 = 6.75
```

However, the following are **not yet proven**:

- Type31 is literally horizontal or vertical FOV in degrees;
- `54 / raw` is the authoritative optical magnification;
- the exact private/native replay message symbol;
- an exact target-distance -> zoom function.

Consumers must therefore preserve the raw float and avoid inventing user-facing `2x/4x/8x` labels until unit calibration is closed.

## Safe canonical representation

```text
ScopedCameraZoomSample {
    rawClockSec
    zoomFovRaw : float32
    source     : REPLAY_TYPE31
}
```

Potential uses:

- Recorder Sniper POV: replay the recorded scoped camera transition/automatic zoom trajectory;
- camera-state analysis: join with Type23 exact ARCADE/SNIPER timing;
- AI Review: preserve how deeply the recorder was scoped while aiming;
- playback reconstruction: combine with Type39 actual aim direction/ray.

## Relationship to Type39

```text
Type23 -> recorder ARCADE/SNIPER mode family
Type31 -> scoped zoom/FOV-like raw trajectory
Type39 -> actual recorder aim orientation + aim-ray point + local gun/turret state
```

Join by replay raw clock, but never interpolate Type31 across an arcade gap or between distinct scoped sessions.

## Evidence grade

```text
Type31 scoped-camera gating                    PROVEN
Type31 automatic zoom/FOV-like behavior        PROVEN / VERY STRONG
smaller value = deeper zoom                    VERY STRONG
exact unit / native symbol                     PARTIAL / UNKNOWN
old gun-marker / aiming-circle interpretation  REJECTED / SUPERSEDED
```

## Remaining work

1. recover the exact Type31 physical unit/private symbol;
2. determine whether canonical values map exactly to FOV or magnification labels;
3. validate Type31 numbering and behavior on later Blitz versions;
4. resolve recorder-vs-observer camera ownership after death/viewpoint switching.
