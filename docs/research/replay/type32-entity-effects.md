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

The values `2/3/4/5/6/15/16/17/18` are observed **body sizes**, not symbolic effect IDs. Packet length alone cannot select a semantic event decoder.

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

The entity class cleanly constrains the observed wire layouts:

| Type5 family | flag | bodyLength | packet count |
|---|---:|---|---:|
| mobile `entityTypeId=2` | 0 | 15/16 | 7,780 |
| mobile `entityTypeId=2` | 1 | 2/3/17/18 | 6,939 |
| static `entityTypeId=3` | 1 | 3/4/5/6 | 2,131 |

There are no other class/flag/length combinations in the strict corpus. Body decoding must therefore be conditioned on at least entity class, flag and length; a top-level length-to-event-name table is invalid.

## Body diversity

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

The short repeated bodies and longer high-cardinality bodies are compact/variant update families rather than one scalar schema.

## Mobile `flag=0` long-body structure

The mobile `flag=0` 15/16-byte bodies contain this partial structure:

```text
controlPrefix : 3 or 4 bytes
eventClockRaw : f64 LE at body[-12 .. -4)
parameterRaw  : f32 LE at body[-4 .. end)
```

For every non-zero `eventClockRaw`:

```text
offsetSec = eventClockRaw - packet.rawClockSec
```

Full-corpus result:

```text
replays with non-zero samples             : 34 / 34
non-zero samples                           : 2,892
max within-replay offset spread            : 0.312 s
median within-replay offset spread         : 0.153 s
max within-replay offset standard deviation: 0.070 s
per-replay mean offset range               : 39,155.5 .. 54,344.9 s
```

This proves that `eventClockRaw` is a replay/session-local monotonic time reference. The exact epoch/source remains `PARTIAL`. Zero occurs in 4,888 mobile `flag=0` records and behaves as an absent/uninitialized value for this relation.

The final float32 is layout-specific. In the proven consumable subset it carries effective active-duration/cooldown configuration. Closed mappings are recorded in [`consumable-lifecycle.md`](consumable-lifecycle.md).

## Mobile `flag=1`, 18-byte body — damage/hit presentation side-channel

The 18-byte mobile family is not merely near HP changes. It is directly joined to Vehicle method8 damage notifications at byte level.

For 2,359 uniquely paired records with:

```text
same replay
same target entity
same rawClock
Type32 flag=1 bodyLength=18
Vehicle Type8 method8
```

shared protocol bytes close exactly:

```text
Type32 body[3..9]  == method8 args[10..16] : 2,359 / 2,359
Type32 body[10]    == method8 args[9]       : 2,359 / 2,359
```

This is stronger than timing correlation.

Verdict:

> mobile `flag=1`, bodyLength=18 = **damage/hit presentation side-channel — PROVEN relationship / field semantics PARTIAL**.

The method8 raw numerical value is still not authoritative HP loss; Type7 Vehicle prop3 deltas remain authoritative for observed HP changes.

Safe event layering is therefore:

```text
Vehicle method8
  -> attacker/victim and damage-protocol evidence

Type7 prop3
  -> authoritative resulting current HP / observed HP delta

Type32 flag1 len18
  -> parallel damage/hit presentation metadata sharing the method8 core
```

## Mobile `flag=1` short bodies — compact damage/effect state family

The common 2/3-byte mobile bodies contain repeated patterns such as:

```text
a4 22
9c 22
a0 22
a4 23
9c 23
a1 80 21
9c 04
9d 80 04
```

They show strong compact/bit-packed structure, but the exact field boundaries remain unresolved.

Important negative results:

- the last byte is **not proven** to be a global component/device ID;
- interpreting the entire family as one universal LEB128/varint fails on many bodies that do not terminate as one value;
- decomposing selected bodies into 7-bit chunks reveals stable patterns but does not close direct equality to Type7 prop8 transition tokens;
- historical Wargaming `damageIndex + extraIndex` layouts are structural clues only and cannot be transplanted numerically into Blitz 11.19.

Consumers must therefore preserve the entire short body until a version-matched field layout is recovered.

## Fire-associated short `...04` family

A specific mobile short-body family is now behaviorally closed to fire.

The strict corpus contains four settlement deaths with `deathReason=1`, independently proven as fire deaths. All four show Type32 short `...04` during the final repeated burn-HP sequence:

```text
settlement fire deaths checked : 4
with mobile short ...04         : 4 / 4
```

Representative forms:

```text
9c 04
9d 80 04
```

The associated Type7 prop3 stream shows small repeated losses at approximately 0.4–0.5 s cadence instead of one direct-shot delta.

An independent consumable differential strengthens the identity:

- `0x0B` Multi-Purpose Restoration Pack stops the periodic burn sequence in 13/14 matched cases after excluding new direct-hit method8 events; the remaining loss occurs exactly at activation time;
- `0x0D` Repair Kit is observed twice during active fire and in both cases the periodic fire HP ticks continue for multiple ticks afterward.

Verdict:

> Type32 mobile short `...04` = **fire-associated damage/effect family — PROVEN behavioral association**.

This does **not** yet prove whether a given `...04` packet means ignition, one fire-DOT tick, fire state refresh, or another fire-side presentation event. In particular, consumers must not use the first observed `...04` as exact ignition time without further closure.

Detailed evidence is archived in [`fire-and-repair-states.md`](fire-and-repair-states.md).

## Flag boundary

In the current corpus:

```text
flag=0 -> bodyLength 15 or 16 only
flag=1 -> bodyLength 2..6, 17 or 18 only
```

This proves two layout families, but not a generic semantic such as activation/deactivation. `flag=0` contains the consumable control family; `flag=1` contains several mobile/static presentation/state families whose semantics depend on class and body layout.

## Why earlier interpretations are rejected

### Not an effect `kind`

The alleged `kind` equals the remaining body length in every packet. Treating it as both enum and byte count hides the actual length prefix.

### Not one top-level client-runtime `double`

Earlier diagnostics read eight bytes at a fixed absolute offset across variable bodies. No fixed global-double schema survives class/layout gating. The real f64 clock exists only in the scoped mobile `flag=0` long-body decoder.

### Not globally “damage” merely from HP proximity

Type32 also targets 428 static-family entity occurrences. The damage/hit identity applies only to the independently closed mobile `flag=1` 18-byte subset; the top-level Type32 packet remains a generic entity auxiliary envelope.

## Historical parser/client clues

Historical Wargaming clients expose separate concepts for vehicle damage presentation, damaged/destroyed devices, fire, crew and recovery. Those interfaces are useful structural guidance because the current replay similarly shows multiple compact/state subfamilies.

However:

- client/version differ;
- numeric method/property/extra indices drift;
- current Type32 also covers static entities;
- current short bodies are compact and not field-for-field matched yet.

No historical numeric offset/name is promoted without current Blitz evidence.

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
    controlPrefix
    eventClockRaw
    parameterRaw
}

MobileFlag1DamagePresentationRaw {
    rawClockSec
    entityId
    bodyBytes
    sharedMethod8CoreBytes
}

MobileFlag1ShortEffectRaw {
    rawClockSec
    entityId
    bodyBytes
    fireAssociated // only when version-gated ...04 family evidence applies
}
```

Requirements:

1. validate `bodyLength == remaining payload bytes`;
2. preserve flag/body bytes losslessly;
3. route by client version + Type5 entity class + flag + body length;
4. decode f64 event clock only for the proven mobile `flag=0` long-body family;
5. do not reinterpret method8 raw values as authoritative HP loss;
6. do not expose unclosed short-body bytes as named modules/components;
7. version-gate any fire or consumable semantic decoder.

## Remaining work

1. recover the Blitz 11.19 producer/transport schema for Type32;
2. identify the exact mobile short-body bit layout and distinguish fire-start, fire-tick and fire-stop variants;
3. decode remaining 17-byte mobile flag1 variants and static 3/4/5/6-byte families;
4. recover exact vehicle module/crew/effect indices from a current Blitz schema or controlled probes;
5. compare same-arena multi-POV bodies to separate server facts from client-local presentation;
6. validate all sub-decoders on additional client versions before production promotion.
