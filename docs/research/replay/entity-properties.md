# Type 7 — EntityProperty

> Corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China.

## Envelope

All observed Type 7 packets use:

```text
entityId : u32 LE
propId   : u32 LE
valueLen : u32 LE
value    : valueLen bytes
```

Observed complete property-ID set:

```text
0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13
```

No property IDs 5 or 6 were observed.

Important: property IDs are **entity-class scoped**. See `entity-routing.md`. The table therefore records the target class as part of the evidence.

## Full observed inventory

| propId | Count | Target class in current corpus | Value lengths | Verdict | Proven/observed facts |
|---:|---:|---|---|---|---|
| 0 | 85,012 | Vehicle 85,012 | 1 B | PARTIAL | binary `00/01`, almost perfectly balanced; not HP |
| 1 | 463 | Vehicle 463 | 1 B | PARTIAL | all observed values `00` |
| 2 | 826,191 | Vehicle 826,191 | 2 B | **PROVEN** | turret-relative yaw |
| 3 | 4,531 | Vehicle 4,531 | 2 B | **PROVEN/PARTIAL sentinels** | absolute current HP / terminal sentinel family |
| 4 | 195,756 | Vehicle 195,754; Avatar 2 | normally 2 B; two 1-B records | **PARTIAL, strong engine-mode-family evidence on Vehicle** | two-byte vehicle state strongly matches replay-exposed `engineMode`; exact Blitz symbol/index still version-scoped |
| 7 | 415 | Vehicle 415 | mostly 1 B, seven 2-B | PARTIAL | sparse state family |
| 8 | 1,052 | Vehicle 1,052 | 1–4 B | PARTIAL | variable-length state/list-like value |
| 9 | 89,351 | Avatar 88,945; Vehicle 406 | mostly 4 B; 1–3 B edge values | PARTIAL / **class collision** | overwhelmingly recorder-Avatar property; old global “vehicle float” interpretation invalid |
| 10 | 357 | Avatar 357 | 4 B | UNKNOWN semantic / PROVEN routing | recorder-Avatar-only in corpus |
| 11 | 64 | Avatar 64 | 4 B | UNKNOWN semantic / PROVEN routing | recorder-Avatar-only |
| 12 | 20 | Avatar 20 | 4 B | UNKNOWN semantic / PROVEN routing | recorder-Avatar-only |
| 13 | 17 | Avatar 17 | 4 B | UNKNOWN semantic / PROVEN routing | recorder-Avatar-only |

## propId 2 — vehicle turret-relative yaw

`PROVEN` on controlled rotation/fire-anchor probes:

```text
raw = u16 LE(value)
deg = raw * 360 / 65536 - 180
```

World gun direction is consistent with:

```text
normalize(hullYaw + turretRelativeYaw)
```

The field wraps naturally at ±180°.

## propId 3 — vehicle current HP

For positive signed-i16 values, propId 3 is authoritative current HP observed by the recording client.

```text
raw    = u16 LE(value)
signed = i16(raw)
```

Positive values are proven to represent actual current HP, including loadout-derived HP increases. Consecutive positive samples provide authoritative observed HP loss; Type-8 damage-method raw values must not replace these HP deltas.

### Terminal/sentinel values

| Raw | Corpus observation | Verdict |
|---|---|---|
| `0x0000` | 291 | **PROVEN** terminal HP=0 |
| `0xFFFF` | 88 | UNKNOWN sentinel; insufficient alone to assert death |
| `0xFFFD` | 83 | **PROVEN on current death corpus** death-associated terminal sentinel |
| `0xFFFE` | closed Intotherainy death chain | **PROVEN for that chain / PARTIAL global semantic** |

`0xFFFE` was independently closed by settlement `lifeTime`, settlement `killerID`, Type-8 vehicle health/state method, matching attacker identity and absence of later alive HP. Future `0xFFFE` observations must still pass evidence gating until its global sentinel definition is independently closed.

Current main names `0xFFFD` as “unknown HP” in one place while treating it as exact death elsewhere. That naming is inconsistent with the current research evidence and should be cleaned in a later implementation PR.

## propId 0 — vehicle binary property

Observed domain:

```text
00 : 42,536
01 : 42,476
```

It is a real, high-frequency vehicle property but current evidence does not uniquely distinguish physics mode, visibility, movement or another binary state. Keep `PARTIAL`.

## propId 4 — vehicle engine-mode family

The vehicle-targeted form is overwhelmingly two bytes. Frequent raw tuples include:

```text
01 00
03 01
02 01
02 02
03 02
03 05
02 05
03 09
02 09
...
```

Independent Wargaming entity definitions expose a replay-recorded vehicle property named `engineMode` with exactly this structural type:

```text
TUPLE
  of UINT8
  size 2
ExposedForReplay = true
```

Client vehicle code further uses the second element as movement flags:

```text
hasMovingFlags = engineMode is not None and engineMode[1] & 3
```

The current replay corpus independently matches that behavior. On 17,982 recorder-vehicle prop-4 samples for which position-derived local speed can be estimated:

```text
secondByte & 3 == 0 : n=3,293, median speed ≈ 0.94 m/s
secondByte & 3 == 1 : n=9,667, median speed ≈ 3.85 m/s
secondByte & 3 == 2 : n=5,022, median speed ≈ 2.15 m/s
```

A simple `secondByte & 3 != 0` vs position-motion comparison agrees about 83.9% at a 0.1 m/s threshold; residual disagreement is expected around low-speed interpolation/network sampling and does not justify assigning a more precise physical speed meaning to either byte.

Verdict:

- two-byte replay-exposed vehicle **engine-mode family**: `PROVEN/PARTIAL` by independent schema + behavior;
- exact semantic of each byte/bit in Blitz 11.19: `PARTIAL`;
- the two Avatar-targeted prop-4 records prove the numeric index itself is not globally unique, so dispatch still requires entity class/version.

## propId 7 / 8 — vehicle state families

`propId=7` is sparse and usually `00`, with a few two-byte variants. `propId=8` is variable length (1–4 B), with recurrent values such as:

```text
00
01 22
01 23
01 28
01 21
01 2b
02 23 22
...
```

The first byte often resembles a count/variant prefix, but there is not enough independent evidence to promote a named semantic. Preserve raw bytes.

## propId 9 — class-colliding property

Previous notes treated prop9 as a generic float-like property because most payloads are 4 bytes. Target routing disproves that abstraction:

```text
Avatar target : 88,945 / 89,351
Vehicle target:    406 / 89,351
```

Therefore the 4-byte Avatar form and the rarer Vehicle form must be reverse-engineered independently. The heterogeneous 1–4 byte widths also forbid unconditional `float32` decoding.

## propId 10–13 — recorder-Avatar properties

All observed records target the recorder Avatar:

```text
prop10 357/357 Avatar
prop11  64/64  Avatar
prop12  20/20  Avatar
prop13  17/17  Avatar
```

All are four bytes in this corpus. Their semantic names remain `UNKNOWN`; the routing/classification itself is `PROVEN`.

## Version scope

These conclusions are verified for the supplied 11.19.0 China corpus. Property IDs are version-sensitive class-local protocol indices; future versions must revalidate both the target entity class and payload schema before reusing semantic labels.
