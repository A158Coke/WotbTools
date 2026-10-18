# Low-frequency / control packet inventory

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas, with pre-dedup source files used only for cross-validation.
>
> This file is the summary inventory. Detailed evidence lives in the dedicated per-packet documents and takes precedence if future work changes a verdict.

## Current top-level type set

Strict contiguous framing observes:

```text
0,1,2,4,5,7,8,10,11,13,14,17,23,26,28,29,31,32,33,35,36,39,0xFFFFFFFF
```

Zero-length packets are legal: Type17 has an empty payload. Parsers must not treat `payloadLen == 0` as automatic framing corruption.

## Type14 — replay event-stream close marker

Current facts:

```text
one per replay
payload = 00
last ordinary packet in 34/34 canonical arenas
followed only by 0xFFFFFFFF file terminator
clock = maximum ordinary stream clock
```

Verdict:

> Type14 = **replay packet-stream end/stop marker — PROVEN physical role**.

It is not the authoritative battle finish reason; Avatar method4 / wrapper3 / settlement provide battle-end semantics.

## Type17 — recorder-local aim/control initialization boundary

Current facts:

```text
payload = empty
one per replay
Type23=1 at exactly the same raw clock
first Type39 aim/camera sample ≈ Type17 + 0.100 s in 34/34
Type10 and Type35 are already active before Type17
```

Verdict:

> Type17 = **recorder-local aim/camera/control initialization boundary — PROVEN relationship / PARTIAL exact symbolic semantic**.

Do not label it global client-ready or battle-start.

## Type23 — recorder ARCADE / SNIPER scope-control state

Current payload:

```text
u32 rawMode
```

Observed values:

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

No other transitions occur in the canonical corpus.

Current normalization:

```text
modeCode = rawMode & 0x7fffffff

modeCode == 1 -> ARCADE/default family
modeCode == 0 -> SNIPER/scoped family
otherwise     -> UNKNOWN
```

Independent camera-vs-turret geometry separates the two states strongly: Type23=0 keeps Type39 world aim close to reconstructed turret world yaw (median gap ~0.605°), while Type23=1 allows broad third-person separation (median ~5.885°, p90 ~54.51°).

The previous `Type23 = recorder projectile/shot lifecycle toggle` interpretation is `REJECTED / SUPERSEDED`: only 170/703 scoped sessions contain a recorder launch, 533/703 contain none, and recorder launches occur in both mode families.

Verdict:

> Type23 low31 `1 = ARCADE/default`, `0 = SNIPER/scoped` — **PROVEN current 11.19 physical role**.

The `0x80000000` high-bit meaning remains UNKNOWN and must be preserved raw.

See [`recorder-camera-state.md`](recorder-camera-state.md).

## Type29 — duplicated recorder/client-options initialization companion flag

Current facts:

```text
payload = 01
exactly four per replay
first pair = first two framed packets at rawClock 0
second pair = same clock as Avatar method49 synchronized client-options snapshot in 34/34
```

Verdict:

> Type29 = **duplicated recorder/client-options/replay-control initialization companion flag — PROVEN lifecycle relationship / PARTIAL exact setting**.

Historical PC-only labels such as sniper mode or target lock are not assigned without current mobile evidence.

## Type28 — recorder ammunition-slot selection

Current payload:

```text
u32 slotIndex
observed domain 0,1,2
```

Current mobile evidence closes it independently of PC control semantics:

- recorder projectile launches are first isolated through current recorder identity;
- slot state predicts stable shell/projectile descriptor and velocity families per vehicle;
- method17 ammunition-state descriptors join the same shots;
- different vehicles expose different slot-to-shell physics while preserving the `0/1/2` selection domain.

Verdict:

> Type28 = **recorder ammunition/shell-slot selection index — PROVEN current corpus**.

The number is a slot index, not a universal AP/APCR/HE enum.

## Type35 — rolling low byte of session monotonic deciseconds

Current facts:

```text
payload : u8
records : 90,318 canonical
adjacent sequence:
next == (current + 1) mod 256
90,284 / 90,284 exact
median packet spacing ≈ 0.10002 s
```

Exact Type36 closure:

```text
Type35.value == (Type36.sessionClockDeciseconds & 0xFF)
34 / 34 arenas
```

Verdict:

> Type35 = **low 8 bits of the client/session monotonic decisecond counter — PROVEN**.

It is not a generic heartbeat, packet sequence or battle-relative timer.

## Type36 — full-width session monotonic decisecond anchor

Current shape:

```text
payload : u32 LE
one near initialization per replay
```

Interpretation:

```text
sessionClockSec = u32 / 10.0
```

This closes against the independently proven Type32 mobile-long-body f64 session clock in 34/34 arenas, with only expected quantization/timestamp residual.

It also closes to Type35 at initialization through the exact low-byte identity above.

Verdict:

> Type36 = **client/session monotonic timebase initialization/sample — PROVEN relationship**.

Do not interpret it as arena ID, Unix time or battle start.

## Type31 — recorder scoped-camera zoom/FOV-like raw trajectory

Type31 is high-frequency rather than low-frequency, but is retained here as an important control surface:

```text
payload : float32 zoomFovRaw
active  : only inside Type23 scoped sessions
```

Exact gating:

```text
Type23 scoped sessions  703
Type31 active runs       703
```

The stream starts a median ~8.575 ms after Type23 enters the scoped family, updates at ~120 Hz, and stops when Type23 returns to ARCADE/default.

The previous `Type31 = arcade gun-marker / aiming-circle size` interpretation is `REJECTED / SUPERSEDED`. Avatar method36 `field6.field1` is independently proven as the actual dynamic gun dispersion/bloom scalar, and Type31 is effectively uncorrelated with it (`r ~= -0.01168`). Static no-shot sessions and a vehicle-independent ~0.617 s Type31 transition further identify this as a camera/control process.

Verdict:

> Type31 = **recorder scoped-camera automatic zoom/FOV-like raw scalar — PROVEN relationship / VERY STRONG behavioral identity**.

Safe boundary:

```text
smaller raw value -> deeper zoom        VERY STRONG
exact FOV unit / native symbol          UNKNOWN/PARTIAL
exact optical magnification formula     UNKNOWN/PARTIAL
```

See [`recorder-camera-state.md`](recorder-camera-state.md) and [`gun-marker-stream.md`](gun-marker-stream.md).

## Type39 — recorder aim/camera stream

Current fixed body:

```text
7 x float32
```

Closed current physical roles include world aim/gun-ray yaw/pitch, world-space point on the aim/projectile ray, and recorder-local gun/turret control-angle families. Type39 is the high-rate recorder aiming geometry surface.

See `type39-aim-camera.md` and targeting-info follow-ups for field-level evidence.

## Stream terminator `0xFFFFFFFF`

Current corpus:

```text
type         = 0xFFFFFFFF
one per replay
clock        = 0
constant 16-byte payload in this client version
```

Verdict:

> **deterministic file/stream terminator — PROVEN current version**.

Keep the constant payload version-scoped.

## Startup time/control hierarchy

Current safe startup ordering:

```text
rawClock 0
  Type29=1
  Type29=1

~0..0.23 s
  Type35 low-byte session clock
  Type36 full u32 session decisecond anchor

later setup
  Type17
  Type23=1 (ARCADE/default) same clock

~Type17 + 0.100 s
  Type39 recorder aim/camera begins

~Type17 + 0.38..0.92 s
  Type29=1
  Type29=1
  Avatar method49 synchronized client-options snapshot
```

This is a replay/control initialization timeline, not the battle-start timeline. Battle start is independently represented by the arena-period `BATTLE` transition.

## Research implications

1. framing semantics and gameplay semantics must remain separate;
2. zero-length Type17 must parse legally;
3. Type14 and `0xFFFFFFFF` are stream lifecycle, not win/loss facts;
4. Type35/36/32 share a client/session monotonic clock domain;
5. Type28 is ammunition selection and must not regress to the superseded PC target-lock hypothesis;
6. Type23 is recorder ARCADE/SNIPER mode state, not projectile lifecycle;
7. Type31 is scoped camera zoom/FOV-like state, not gun dispersion authority;
8. initialization packets must not be used as battle-start markers;
9. every new client version must revalidate numeric packet IDs before widening decoder support.
