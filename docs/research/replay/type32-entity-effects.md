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

### Not one client-runtime `double`

Earlier diagnostics read eight bytes at a fixed absolute offset and sometimes obtained runtime-like numbers. That offset crosses differently sized, variable bodies; arbitrary eight-byte interpretations also produce huge and subnormal values. No fixed scalar schema is valid across this family.

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
```

Requirements:

1. validate `bodyLength == remaining payload bytes`;
2. preserve `flag` and body bytes losslessly;
3. route through the Type5 entity class/version context;
4. add semantic sub-decoders only after independent closure;
5. do not expose body length or raw bytes as user-facing effect names.

## Remaining work

1. recover the Blitz 11.19 producer or transport schema for Type32;
2. determine the exact meaning of `flag`;
3. cluster bodies by Type5 entity class, length, prefix bits and lifecycle phase;
4. run controlled probes for track destruction/repair, static collision/destruction, fire, ramming and module damage;
5. compare same-arena multi-POV bodies to separate server facts from client-local representation;
6. validate any body decoder on additional client versions before promotion.
