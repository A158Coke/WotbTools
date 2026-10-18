# Recorder camera state — Type23 / Type31 / Type39 closure

> Scope: Blitz `11.19.0_china` / `11.19.0_china_apple`.
>
> Base corpus: 34 strict-framing unique arenas.
>
> Tracking issue: #687.

## Executive verdict

Current 11.19 replay data is sufficient to reconstruct the replay recorder's scoped/sniper timeline and replay-visible automatic zoom trajectory:

```text
Type23 -> recorder ARCADE / SNIPER mode family
Type31 -> scoped camera automatic zoom/FOV-like raw trajectory
Type39 -> recorder aim direction and aim ray
```

Production-safe current-version semantics:

```text
rawMode  = Type23.u32
modeCode = rawMode & 0x7fffffff

modeCode == 1 -> ARCADE / default family
modeCode == 0 -> SNIPER / scoped family
otherwise     -> UNKNOWN
```

The high bit in `0x80000000` remains semantically UNKNOWN and must be preserved raw.

Type31 is active only inside the Type23 scoped family. Smaller Type31 values correspond to deeper replay-visible zoom, but the exact physical unit and exact optical magnification formula remain unresolved.

## Corpus counts

```text
unique arenas                 34
11.19.0_china_apple           23
11.19.0_china                 11

Type23 packets              1,440
Type31 samples            137,161
Type39 samples            928,517
```

Observed Type23 values:

```text
1              737
0              689
0x80000000      14
```

Observed transition graph:

```text
1 -> 0               689
0 -> 1               689
1 -> 0x80000000       14
0x80000000 -> 1       14
```

No other Type23 transitions occur in the canonical corpus. Every replay initializes Type23 to `1`.

## Type23 — recorder scope/control mode

### Rejection of the old shot-lifecycle interpretation

There are 703 Type23 non-default sessions:

```text
value 0 sessions             689
value 0x80000000 sessions     14
```

Only 170/703 contain a recorder projectile launch; 533/703 contain none. Recorder launches also occur while Type23 is `1`.

Observed non-default session durations:

```text
min    ~0.108 s
median ~1.501 s
p90    ~3.585 s
p99    ~8.676 s
max   ~41.480 s
```

Therefore the previous `Type23 = recorder projectile/shot lifecycle toggle` interpretation is `REJECTED / SUPERSEDED`.

### Independent camera-vs-gun discriminator

To avoid circularly using Type39 local-angle fields, turret world yaw was reconstructed independently from:

```text
Type10 hull yaw
+ Vehicle Type7 prop2 turret-relative yaw
```

and compared with Type39 `f0` world aim yaw.

Across roughly 675k matched samples:

```text
Type23=0:
  n      108,716
  median aim-vs-turret yaw gap ~0.605°
  p90                            ~5.80°

Type23=1:
  n      565,197
  median                          ~5.885°
  p90                            ~54.51°

Type23=0x80000000:
  n        1,267
  median                          ~0.426°
  p90                            ~13.70°
```

This is the expected physical split between scoped/sniper control, where the camera/aim axis is constrained close to the gun axis, and arcade/third-person control, where camera/aim can separate widely from turret orientation.

The split survives both client families:

```text
11.19.0_china_apple
  state0 median ~0.712°
  state1 median ~6.63°

11.19.0_china
  state0 median ~0.440°
  state1 median ~4.54°
```

and all recorder vehicle groups represented in the corpus.

### Type23 evidence grade

```text
raw state structure / transition graph        PROVEN
low31 1 = ARCADE/default physical role        PROVEN current 11.19
low31 0 = SNIPER/scoped physical role         PROVEN current 11.19
exact native replay symbol                    STRONG/PARTIAL
0x80000000 high-bit exact meaning             UNKNOWN
```

Do not discard or normalize away the high bit.

## Type31 — scoped camera zoom/FOV-like trajectory

### Exact gating by Type23

```text
Type23 non-default sessions   703
Type31 active runs            703
```

Every scoped session has exactly one Type31 active run.

Boundary timing:

```text
Type23 enters scoped family
  -> first Type31 sample median +8.575 ms
  -> Type31 runs at approximately 120 Hz
  -> final Type31 sample occurs at the Type23 exit clock
  -> Type23 returns to 1 and Type31 stops
```

There is no Type31 stream through ordinary arcade gaps.

Observed range:

```text
min    6.75
median ~27.006
max   54.0
```

The `54 / 27 / 13.5 / 6.75` power-of-two structure is notable, but an exact `54/raw = optical magnification` interpretation is not yet production-safe.

### Rejection of the old aiming-circle interpretation

Avatar method36 `field6.field1` is independently closed as the recorder's dynamic gun dispersion/bloom scalar.

For 418 same-time Type31/method36 pairs:

```text
corr(Type31, proven dispersionBloomRaw) ~= -0.01168
```

This is effectively zero.

The canonical corpus also contains 18 scoped sessions with all of the following:

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

Aim distance remains approximately 231.76 m while the tank, turret and gun are effectively static and no shot occurs. The transition is therefore a camera/control transition, not post-shot bloom or movement dispersion.

### Vehicle-independent transition duration

For 195 clean sessions starting above 53.8 and settling near 27, the first crossing of `Type31 <= 27.1` occurs at:

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

Correlation with the independently proven method36 aiming-time scalar is approximately `0.003`, rejecting a gun aiming-time process and supporting a fixed camera transition.

### Type31 evidence grade

```text
scoped-camera gating relationship             PROVEN
automatic zoom/FOV-like camera behavior       PROVEN / VERY STRONG
smaller raw value = deeper zoom               VERY STRONG
exact unit / native replay symbol              PARTIAL / UNKNOWN
exact optical magnification formula            PARTIAL / UNKNOWN
old arcade gun-marker / aiming-circle label    REJECTED / SUPERSEDED
```

Safe canonical representation:

```text
ScopedCameraZoomSample {
    rawClockSec
    zoomFovRaw : float32
    source     : REPLAY_TYPE31
}
```

Do not rename `zoomFovRaw` to literal degrees or a user-facing `Nx` multiplier until unit calibration is closed.

## Type39 relationship

No change to the existing Type39 closure:

```text
f0       -> world aim yaw
-f1      -> world aim pitch
f2..f4   -> world aim-ray point
f5/f6    -> recorder gun/turret local-state families
```

The current 11.19 recorder camera reconstruction is therefore:

```text
Type23 -> exact ARCADE/SNIPER timing
Type31 -> scoped automatic zoom/FOV-like trajectory
Type39 -> actual recorder aim geometry
```

## Production contract guidance

```text
RecorderCameraStateSample {
    rawClockSec
    rawModeU32              // Type23, lossless
    mode                    // ARCADE | SNIPER | UNKNOWN
    scopeVariantHighBit     // preserve; semantic UNKNOWN
    zoomFovRaw?             // Type31; scoped sessions only
    worldAimYawDeg          // Type39 f0
    worldAimPitchDeg        // -Type39 f1
    aimRayPoint             // Type39 f2..f4
}
```

Renderer rules:

1. Never interpolate Type31 across an arcade gap or between distinct sniper sessions.
2. On seek, reconstruct Type23 state first and sample Type31 only if currently scoped.
3. Preserve the raw Type23 value/high bit even when exposing normalized mode.
4. After recorder death/viewpoint switch, stop claiming `Original Recorder Camera` unless viewpoint ownership is separately proven; Type39 can become observer-oriented.
5. Friendly vehicles remain reconstructed `Gunner View`; recorder-local camera closure does not create teammate camera telemetry.

## Architecture cross-check only

Historical Wargaming/Blitz replay architecture exposes separate control-mode, camera/zoom and turret/aim families. This is useful corroboration only; historical numeric IDs are not imported into current Blitz 11.19.

## Remaining bounded work

1. recover Type31 exact physical unit and private/native symbol;
2. determine whether canonical values map exactly to FOV or user-facing magnification labels;
3. identify the Type23 `0x80000000` high-bit meaning;
4. validate numeric IDs/semantics on future Blitz versions;
5. resolve recorder-vs-observer ownership after death/viewpoint switching.
