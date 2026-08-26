# Type35 — 10 Hz modulo-256 tick sequence

> Corpus: strict-framing 34 unique arenas from the Blitz 11.19.0 China research set.

## Verdict

> Type35 is a **one-byte modulo-256 sequence counter advancing at the 0.1 s game/server tick cadence** — `PROVEN structure + behavioral timing` for the current corpus.

The exact internal engine symbol producing this replay channel is still `PARTIAL`; this document deliberately does not rename it to a specific BigWorld class/member without a version-matched symbol source.

## Wire shape

Every observed Type35 payload is exactly:

```text
u8 sequence
```

Current strict-corpus observations:

```text
records                         : 90,318
adjacent comparable increments  : 90,284
exact +1 modulo 256             : 90,284 / 90,284
255 -> 0 wraps                  : 356
observed value domain           : 0..255
```

There are no increment violations in the comparable stream.

## Timing closure

Adjacent Type35 packet clocks advance at approximately one tenth of a second:

```text
median dt ~= 0.100021 s
frequency ~= 9.998 Hz
```

Independent Wargaming client constants define:

```text
SERVER_TICK_LENGTH = 0.1
```

The replay stream therefore follows exactly the same 10 Hz cadence.

This closes the physical role more strongly than the earlier description "~10 Hz incrementing counter":

```text
Type35[n+1].value == (Type35[n].value + 1) mod 256
Type35 cadence     ~= 0.1 s
```

## Safe canonical representation

```text
TickSequenceSample {
    rawClockSec
    sequence : u8
}
```

Potential uses:

- detect dropped/missing replay tick records by sequence discontinuity;
- align coarse server/game-tick-relative event batches;
- distinguish packet delivery timestamp from the underlying 10 Hz simulation cadence;
- provide a consistency signal during multi-POV alignment.

## Important boundaries

The current evidence does **not** prove that the byte itself is a globally unique server tick number. It wraps every 256 ticks (~25.6 s), and its engine-level symbolic origin is not recovered.

Do not use it alone as:

- battle start time;
- absolute server timestamp;
- projectile simulation timestamp;
- cross-battle unique sequence.

The separate arena-period and settlement clock evidence remains authoritative for battle-relative time.

## Remaining work

1. identify the native ReplayManager/BigWorld producer symbol for this channel;
2. measure whether sequence discontinuities correspond exactly to omitted network ticks or replay filtering;
3. compare same-arena multi-POV sequence phase and packet clocks;
4. validate the 0.1 s cadence and packet number on future Blitz versions.
