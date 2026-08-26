# Type32 — length-prefixed entity auxiliary blob

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Correction: the `u32` at payload offset 5 was previously described as an effect `kind`. Full-corpus validation proves that it is the exact byte length of the remaining body. The former kind/effect interpretation is **SUPERSEDED**.

## Proven envelope

Every current Type32 packet has this structure:

```text
entityId   : u32 LE
flag       : u8
bodyLength : u32 LE
body       : bodyLength bytes
```

Across all 16,850 Type32 packets in the strict corpus:

```text
bodyLength == payloadLength - 9 : 16,850 / 16,850
mismatches                       : 0
```

Observed length and flag combinations:

| bodyLength | packet count | flag |
|---:|---:|---:|
| 2  | 3,516 | 1 |
| 3  |   673 | 1 |
| 4  |    24 | 1 |
| 5  | 1,104 | 1 |
| 6  |   824 | 1 |
| 15 |   366 | 0 |
| 16 | 7,414 | 0 |
| 17 |   459 | 1 |
| 18 | 2,470 | 1 |

The values `2/3/4/5/6/15/16/17/18` are therefore observed **body sizes**, not symbolic effect IDs. Packet length alone cannot select a semantic event decoder.

## Entity routing

Type32 is scoped to materialized entities, not only combat vehicles.

Per-replay distinct-entity aggregation across the 34 arenas gives:

```text
Type32 entity occurrences             : 968
also present in Type5 materialization : 968 / 968
Type5 entityTypeId=2 mobile family    : 540
Type5 entityTypeId=3 static family    : 428
```

All 540 Type32 entities in the Type5 mobile family also have Type10 transform streams. The other 428 route to Type5 `entityTypeId=3`, which the current corpus classifies as the static/non-vehicle family and which has no normal Type10 stream.

This disproves a vehicle-only damage/effect envelope. Type32 is a generic entity-side auxiliary update family that can target both mobile and static materialized entities.

The entity class also cleanly constrains the observed wire layouts:

| Type5 family | flag | bodyLength | packet count |
|---|---:|---|---:|
| mobile `entityTypeId=2` | 0 | 15/16 | 7,780 |
| mobile `entityTypeId=2` | 1 | 2/3/17/18 | 6,939 |
| static `entityTypeId=3` | 1 | 3/4/5/6 | 2,131 |

There are no other class/flag/length combinations in the strict corpus. Body decoding must therefore be conditioned on at least entity class, flag and length; a top-level length-to-event-name table is invalid.

## Body diversity

The body is not a fixed scalar:

| bodyLength | distinct bodies | packet count |
|---:|---:|---:|
| 2  | 29    | 3,516 |
| 3  | 222   |   673 |
| 4  | 24    |    24 |
| 5  | 1,102 | 1,104 |
| 6  | 824   |   824 |
| 15 | 13    |   366 |
| 16 | 3,021 | 7,414 |
| 17 | 459   |   459 |
| 18 | 2,470 | 2,470 |

The short repeated bodies and the longer high-cardinality bodies are consistent with a compact/bit-packed or variant update stream. This is a structural observation only; no current evidence identifies individual body fields.

## Mobile `flag=0` scaled-clock field

The mobile `flag=0` 15/16-byte bodies contain one independently closed subfield:

```text
scaledClockRaw : f32 LE at body[-8 .. -4)
```

For every non-zero value, define:

```text
scaledClockSec = scaledClockRaw * 65536
offsetSec      = scaledClockSec - packet.rawClockSec
```

Full-corpus result:

```text
replays with non-zero samples             : 34 / 34
non-zero samples                           : 2,892
max within-replay offset spread            : 0.331 s
median within-replay offset spread         : 0.166 s
max within-replay offset standard deviation: 0.072 s
per-replay mean offset range               : 465,139.5 .. 480,328.9 s
```

This proves that the field is a replay-local/session-local monotonic time reference encoded at a scale of `1/65536` seconds. The small residual is consistent with float32 quantization and packet clock sampling.

The exact epoch/source remains `PARTIAL`: current evidence does not distinguish client process time, engine session time or another monotonic reference. Values of zero occur in 4,888 mobile `flag=0` records and act as an absent/uninitialized sentinel for this relation.

The final four bytes of the same bodies form a separate float32-shaped value with domains including `-1`, `0`, and multiple positive values. Its meaning is not closed and must not be named as reload duration, effect strength or percentage without a controlled correlation.

## Flag boundary

In the current corpus:

```text
flag=0 -> bodyLength 15 or 16 only
flag=1 -> bodyLength 2..6, 17 or 18 only
```

This proves two encoding/layout families. It does **not** prove activation/deactivation, add/remove, compression polarity, or an effect state. The raw flag must be preserved until a producer/schema or controlled probe closes its meaning.

## Why earlier interpretations are rejected

### Not an effect `kind`

The alleged `kind` equals the remaining body length in every packet. Treating it as both an enum and a coincidentally identical byte count adds an unsupported field and hides the actual length prefix.

### Not one top-level client-runtime `double`

Earlier diagnostics read eight bytes at a fixed absolute offset and sometimes obtained runtime-like numbers. That offset crosses differently sized, variable bodies; arbitrary eight-byte interpretations also produce huge and subnormal values. No fixed scalar schema is valid across this family.

The scoped mobile `flag=0` decoder above does recover a real scaled `float32` clock after class/layout gating. This does not restore the rejected global-double interpretation.

### HP proximity is not semantic identity

Some Type32 packets occur near Type7 current-HP updates, but the family also targets 428 static-family entity occurrences and carries highly diverse bodies. Timing proximity can nominate body-level probes; it cannot promote the whole top-level packet to damage, HP, critical-module, or effect semantics.

## Historical parser clue

An older World of Tanks PC parser described packet `0x20` as a tank track-status packet and read status bytes after the entity-scoped prefix. This is useful only as a research lead:

- the client family and version differ from Blitz 11.19;
- the current Type32 family also targets static entities;
- current bodies are variable and appear compactly encoded.

Therefore no PC field offsets or symbolic name are transplanted into the Blitz schema.

## Safe parser model

```text
EntityAuxiliaryBlobRaw {
    rawClockSec
    entityId
    flag
    bodyLength
    bodyBytes
}

MobileFlag0LongBodyPartial {
    scaledClockRaw     // PROVEN physical clock relation when non-zero
    trailingFloatRaw   // UNKNOWN semantic
}
```

Requirements:

1. validate `bodyLength == remaining payload bytes`;
2. preserve `flag` and body bytes losslessly;
3. route through the Type5 entity class/version context;
4. decode the scaled clock only for mobile `flag=0` bodies of length 15/16;
5. add other semantic sub-decoders only after independent closure;
6. do not expose body length or raw bytes as user-facing effect names.

## Remaining work

1. recover the Blitz 11.19 producer or transport schema for Type32;
2. determine the exact meaning of `flag`;
3. recover the exact epoch/source of the mobile `flag=0` scaled clock and the meaning of its trailing float;
4. cluster remaining bodies by Type5 entity class, length, prefix bits and lifecycle phase;
5. run controlled probes for track destruction/repair, static collision/destruction, fire, ramming and module damage;
6. compare same-arena multi-POV bodies to separate server facts from client-local representation;
7. validate any body decoder on additional client versions before promotion.
