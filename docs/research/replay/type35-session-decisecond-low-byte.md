# Type35 — low byte of the session monotonic decisecond counter

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.

## Wire shape

Type35 payload is exactly one byte:

```text
value : u8
```

Canonical 34-arena corpus:

```text
records : 90,318
```

## Strict modulo sequence

For every adjacent Type35 pair within a replay:

```text
next == (current + 1) mod 256
```

Observed transitions tested:

```text
90,284 / 90,284 exact
counterexamples : 0
```

The replay-clock spacing is centered on 0.1 seconds:

```text
median interval ≈ 0.10002 s
p10             ≈ 0.08385 s
p90             ≈ 0.11620 s
p99             ≈ 0.13905 s
```

The interval jitter reflects packet/replay delivery, while the counter itself advances exactly one modulo-256 step per emitted Type35 sample.

## Exact closure with Type36

Type36 is independently proven to carry the same client/session monotonic clock in deciseconds as a `u32` sample.

For every current replay, the Type35 packet immediately preceding Type36:

- has exactly the same raw replay clock as Type36;
- has a byte value exactly equal to the low byte of the Type36 `u32`.

Formally:

```text
Type35.value == (Type36.sessionClockDeciseconds & 0xFF)
34 / 34 arenas
```

This closes the physical identity:

> Type35 = **rolling low 8 bits of the client/session monotonic decisecond counter — PROVEN for current corpus**.

## Relationship over the replay

Using Type36 as the initial full-width anchor:

```text
predictedLowByte(t) = round(Type36_deciseconds + 10 * (rawClock(t)-rawClock(Type36))) & 0xFF
```

matches the overwhelming majority of Type35 samples. Small ±1 and rare larger differences occur because replay raw clock and the session clock are separately sampled and packet delivery is jittered; the strict Type35 sequence itself remains exact.

Therefore Type35 is not merely a generic heartbeat or arbitrary incrementing packet number. It is a quantized session-time surface.

## Safe model

```text
SessionDecisecondLowByte {
    rawClockSec
    low8 : u8
}
```

Useful relationships:

```text
Type36 -> full u32 decisecond anchor near initialization
Type35 -> rolling low-byte decisecond counter
Type32 -> later high-precision f64 samples from the same session time domain
```

These three surfaces jointly provide an internally consistent client/session monotonic timebase.

Do not interpret Type35 as battle-relative seconds, Unix time, network packet sequence, or generic frame number.
