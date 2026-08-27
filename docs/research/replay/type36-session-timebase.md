# Type36 — client/session monotonic timebase initialization

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.

## Wire shape

Type36 appears exactly once per replay:

```text
payload : u32 LE
```

Canonical corpus:

```text
records : 34
per replay : exactly 1
rawClockSec : 0.000 .. 0.233339
payload values : all distinct in current 34 arenas
```

The raw integer range is approximately 391k..543k.

## Cross-surface closure with Type32

Type32 mobile `flag=0` long bodies independently carry a proven session/client monotonic event clock:

```text
eventClockRaw : f64 LE
```

For each Type32 non-zero clock sample:

```text
sessionOffset = eventClockRaw - packet.rawClockSec
```

Within each replay this offset is effectively constant apart from normal packet/timestamp jitter.

Type36 closes against exactly the same timebase when interpreted in deciseconds:

```text
Type36TimeSec = type36_u32 / 10.0
```

For each replay compare:

```text
Type36TimeSec - Type36.rawClockSec
```

against the median Type32:

```text
median(eventClockRaw - packet.rawClockSec)
```

Across all 34 arenas:

```text
exact relationship tested : 34 / 34 arenas
absolute residual range   : ~0.024 .. 0.124 s
```

Representative samples:

```text
Type36 raw = 391557
Type36Time = 39155.7 s
Type32 median session offset ≈ 39155.484 s

Type36 raw = 530497
Type36Time = 53049.7 s
Type32 median session offset ≈ 53049.585 s

Type36 raw = 503132
Type36Time = 50313.2 s
Type32 median session offset ≈ 50313.011 s
```

The residual size is consistent with a 0.1-second quantized sample plus replay/network timestamp jitter.

## Verdict

> Type36 = **client/session monotonic timebase initialization/sample — PROVEN relationship for current corpus**.

Proven current facts:

```text
payload scale          = 0.1 s per integer unit
same time domain       = Type32 long-body eventClockRaw
occurrence             = once near replay initialization
```

Still version-scoped / PARTIAL:

- exact Blitz C++/ReplayManager symbolic packet name;
- exact monotonic clock source (`appTime`, process uptime, engine gameTime, etc.);
- whether the integer is rounded, floored or otherwise quantized before storage.

## Safe model

```text
SessionTimebaseSample {
    rawClockSec
    sessionClockDeciseconds : u32
    sessionClockSec = sessionClockDeciseconds / 10.0
}
```

A consumer may use this relationship to align Type32 session-local timestamps with replay raw time. It must not interpret this value as Unix time, battle-relative time, arena ID, or a random initialization token.

## Research consequence

This closes an important clock-domain boundary:

```text
replay raw clock
    + per-replay session offset
        = client/session monotonic clock family
```

Type36 provides an early quantized anchor for that offset; Type32 provides later high-precision f64 samples from the same time domain.
