# Type32 — polymorphic entity-side state/effect envelope

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Earlier probes treated a fixed offset inside some Type32 packets as a client-runtime `double`. That model is superseded by complete length/kind inventory: Type32 is a polymorphic envelope whose body schema depends on a small integer kind ID.

## Envelope

Every current Type32 packet is consistent with:

```text
entityId : u32 LE
flag     : u8
kind     : u32 LE
body     : kind-specific bytes
```

Observed kinds are exactly:

```text
2, 3, 4, 5, 6, 15, 16, 17, 18
```

The packet length is tightly determined by kind:

| kind | total payload length | body length | observed count | flag domain |
|---:|---:|---:|---:|---|
| 2  | 11 B | 2 B  | 3,516 | 1 |
| 3  | 12 B | 3 B  |   673 | 1 |
| 4  | 13 B | 4 B  |    24 | 1 |
| 5  | 14 B | 5 B  | 1,104 | 1 |
| 6  | 15 B | 6 B  |   824 | 1 |
| 15 | 24 B | 15 B |   366 | 0 |
| 16 | 25 B | 16 B | 7,414 | 0 |
| 17 | 26 B | 17 B |   459 | 1 |
| 18 | 27 B | 18 B | 2,470 | 1 |

This regular `9 + kind-specific-body-length` family proves that Type32 must be decoded by `kind`; no single fixed-offset scalar schema is valid across the family.

## Strong combat-state correlation

Several kinds are tightly synchronized with authoritative Vehicle HP/property updates.

Nearest same-entity Type7 `propId=3` HP event in the current strict corpus:

```text
kind 2 : 2,552 / 3,490 within 0.1 s
kind 3 :   417 /   494 within 0.1 s
kind 17:   371 /   457 within 0.1 s
kind 18: 2,143 / 2,469 within 0.1 s
```

Many are exactly the same replay clock.

This establishes that the family participates in vehicle combat/state/effect processing rather than being a generic replay wall-clock channel.

## Why the old `runtime double` interpretation is superseded

Some prior diagnostics read eight bytes beginning at a constant absolute offset (for example offset 13) and observed values that occasionally resembled a runtime-like quantity.

The complete corpus shows that:

- Type32 has nine distinct kind schemas;
- the same absolute offset crosses different logical fields for different kinds;
- arbitrary 8-byte interpretation across those layouts yields nonsensical huge/subnormal values as often as plausible values;
- body length is deterministic from the kind family.

Therefore:

> `Type32 == one client-runtime double event` is **SUPERSEDED/REJECTED**.

Any meaningful scalar inside Type32 must first be located inside a specific kind schema.

## Candidate physical family

The envelope shape is compatible with a native entity-side **extra/effect/state** mechanism:

```text
entityId
activation/state flag
small effect/extra kind
kind-specific parameters
```

This is also consistent with the current Wargaming vehicle client architecture, where vehicle `extras` are started/stopped around shooting, damage and other effects.

However, the current corpus has not yet recovered a version-matched Blitz enum mapping:

```text
kind 2  -> symbolic effect ?
kind 3  -> symbolic effect ?
...
kind 18 -> symbolic effect ?
```

Therefore the umbrella name `entity-side state/effect envelope` is `PROVEN structural/behavioral family`; exact symbolic extra/effect identity remains `PARTIAL`.

## Current observed behavioral groups

### HP/damage-adjacent

Kinds `2`, `3`, `17`, and `18` are especially strongly concentrated at HP-change times.

They are priority candidates for damage/hit visual-state, critical/module effect, or related vehicle extra families. They must **not** be interpreted as authoritative HP loss; Type7 HP deltas remain authoritative.

### State-rich kind 16

Kind 16 is the largest family (`7,414` records) and has a 16-byte body with repeated structured state patterns. It spans initialization and active combat. It is not sufficiently isolated to assign a specific symbolic extra name yet.

### Kind 15

Kind 15 always uses `flag=0` in the current corpus and a 15-byte body. It is frequently HP-adjacent but less common than kind16. The complementary flag/kind pattern is evidence for a start/stop or state-transition style subsystem, but exact polarity is not proven.

## Safe parser model

A research/production-safe structural representation is:

```text
EntityEffectRaw {
    rawClockSec
    entityId
    flag
    kind
    bodyBytes
}
```

with version-gated kind decoders added only after individual closure.

Do not expose kind IDs as user-facing damage/effect names yet.

## Remaining work

1. recover the Blitz/BigWorld enum or native producer for Type32 kinds;
2. decode each kind body field-by-field;
3. correlate HP-adjacent kinds against shot damage, fire, ramming, module damage and collision events;
4. test whether `flag` is activation/deactivation, add/remove, or another state bit for each kind;
5. correlate kind16/15 transition pairs and entity lifecycle;
6. search special death-reason samples for unique kind fingerprints;
7. validate all mappings on additional versions before assigning stable symbolic names.
