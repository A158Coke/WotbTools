# Type17 / Type29 — recorder-local initialization boundaries

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: this note records current mobile replay behavior only. Historical PC replay callbacks are not used to assign platform-specific semantics without current Blitz evidence.

## Type17 — zero-byte recorder-local control/aim initialization boundary

Current wire shape:

```text
payloadLen = 0
packetType = 17
payload    = empty
```

Canonical corpus:

```text
records      : 34
per replay   : exactly 1
raw clock    : early setup window
```

### Immediate packet relationship

For every arena:

```text
Type17
  -> immediately followed by Type23 payload 01 00 00 00
```

The Type23 packet has exactly the same replay raw clock as Type17 in all 34 arenas.

The packet immediately before Type17 is Type10 in all 34 arenas, but Type10 position streaming has already begun before this point, so Type17 is not a global position/entity-stream start marker.

### Type39 start boundary

Type39 is independently proven as the recorder-local aim/camera stream.

For each arena, compare the sole Type17 clock to the first Type39 clock:

```text
firstType39Clock - type17Clock

min    ≈ 0.09973 s
median ≈ 0.10009 s
max    ≈ 0.10282 s
```

Thus the recorder aim/camera stream begins almost exactly 100 ms after Type17 in 34/34 arenas.

This is not a generic high-frequency-stream boundary:

```text
Type10 position stream : already active before Type17
Type35 tick stream     : already active before Type17
Type7 property stream  : common first appearance is ~5.3..12.6 s after Type17
Type39 aim/camera      : starts ~0.100 s after Type17
Type23                 : initialized to state 1 at exactly Type17 clock
```

Verdict:

> Type17 = **recorder-local aim/camera/projectile-control initialization boundary — PROVEN relationship / PARTIAL exact semantic**.

Still unknown:

- exact Blitz C++/ReplayManager symbolic packet name;
- whether the marker means gun-control ready, recorder-control ready, aim-system ready, projectile-state reset, or another adjacent subsystem transition.

Do not call Type17 a global client-ready or battle-start marker.

## Type29 — duplicated client-options/replay-control initialization companion flag

Current wire shape:

```text
payload : uint8
```

All current payloads are:

```text
01
```

Canonical corpus:

```text
records    : 136
per replay : exactly 4
```

Every replay has the exact pattern:

```text
packet index 0 : Type29 = 01 @ rawClock 0
packet index 1 : Type29 = 01 @ rawClock 0

later setup:
Type29 = 01
Type29 = 01
at exactly the same raw clock
```

The first pair is therefore the first two framed replay packets in 34/34 arenas.

### Second pair relationship to Avatar method49

Avatar method49 is independently identified as the recorder synchronized client-options snapshot.

For every current arena:

```text
second Type29 pair rawClock == Avatar method49 rawClock
34 / 34 arenas
```

The second pair occurs after Type17 by:

```text
min    ≈ 0.383 s
median ≈ 0.747 s
max    ≈ 0.917 s
```

This proves that Type29 belongs to the same early recorder/client-options/replay-control initialization phase.

However, many initialization RPCs share the method49 clock. The current corpus does not uniquely identify which particular boolean/config flag Type29 represents.

Verdict:

> Type29 = **duplicated recorder/client-options/replay-control initialization companion flag — PROVEN lifecycle relationship / PARTIAL exact semantic**.

The following are not proven:

- sniper mode;
- target lock;
- server aim;
- GUI visibility;
- any other individual historical PC ReplayManager boolean.

## Combined startup timeline

Safe current startup sequence:

```text
rawClock 0
  Type29=1
  Type29=1

~0..0.23 s
  Type36 session monotonic timebase sample

~1.7..7.3 s
  Type17 zero-byte recorder-control boundary
  Type23=1 at the same clock

~Type17 + 0.100 s
  Type39 aim/camera stream begins

~Type17 + 0.38..0.92 s
  Type29=1
  Type29=1
  Avatar method49 synchronized client-options snapshot at same clock
```

This timeline is useful for parser/state-machine staging without assigning unsupported UI semantics.
