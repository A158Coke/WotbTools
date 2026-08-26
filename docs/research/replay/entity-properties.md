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

Observed complete property-ID set in this corpus:

```text
0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13
```

No property IDs 5 or 6 were observed.

## Full observed inventory

| propId | Count | Value lengths | Verdict | Proven/observed facts |
|---:|---:|---|---|---|
| 0 | 85,012 | 1 B | PARTIAL | binary domain `00/01`, almost perfectly balanced; 474 entities; not HP |
| 1 | 463 | 1 B | PARTIAL | all observed values `00`; 361 entities |
| 2 | 826,191 | 2 B | **PROVEN** | turret-relative yaw; complete 16-bit angular domain |
| 3 | 4,531 | 2 B | **PROVEN/PARTIAL sentinels** | absolute current HP for positive signed-i16 values; terminal/sentinel family documented below |
| 4 | 195,756 | normally 2 B; two 1-B records | PARTIAL | high-frequency state/mode value; multi-valued, not a boolean and not HP |
| 7 | 415 | mostly 1 B, seven 2-B values | PARTIAL | mostly `00`, rare multi-byte states |
| 8 | 1,052 | 1–4 B | PARTIAL | variable-length state/list-like value; `00` common; not HP |
| 9 | 89,351 | mostly 4 B; 1–3 B edge values | PARTIAL | 4-B values form a float-like family; existing probes exclude HP semantics |
| 10 | 357 | 4 B | UNKNOWN semantic / PROVEN structure | sparse integer-like values; only 39 entities |
| 11 | 64 | 4 B | UNKNOWN semantic / PROVEN structure | sparse integer-like values; 27 entities |
| 12 | 20 | 4 B | UNKNOWN semantic / PROVEN structure | sparse integer-like values; 12 entities |
| 13 | 17 | 4 B | UNKNOWN semantic / PROVEN structure | sparse integer-like values; 8 entities |

The absence of a semantic name is intentional. A value is not promoted to `PROVEN` merely because its width resembles an integer or float.

## propId 2 — turret-relative yaw

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

## propId 3 — current HP

For positive signed-i16 values, propId 3 is the authoritative current-HP sample observed by the recording client.

```text
raw    = u16 LE(value)
signed = i16(raw)
```

### Positive values

`PROVEN`:

- represent actual current HP, including loadout-derived HP increase;
- consecutive positive samples provide authoritative observed HP loss;
- Type 8 subtype 8 raw protocol values must not replace this HP delta.

### Terminal/sentinel values

Observed in the 44-file corpus:

| Raw | Count in corpus | Verdict |
|---|---:|---|
| `0x0000` | 291 | **PROVEN** terminal HP=0 |
| `0xFFFF` | 88 | UNKNOWN sentinel; not sufficient by itself to assert death |
| `0xFFFD` | 83 | **PROVEN on current death corpus** death-associated terminal sentinel |
| `0xFFFE` | observed in the closed Intotherainy chain | **PROVEN for that terminal chain / PARTIAL global semantic** |

`0xFFFE` was independently closed in one death sequence by settlement `lifeTime`, settlement `killerID`, Type 8 subtype 1 terminal state and matching attacker identity. The corpus does not justify blindly defining every future `0xFFFE` as death without the same evidence gate.

### Main-code naming inconsistency

Current main names `0xFFFD` as an “unknown HP” sentinel in one place while decoding it as an exact death state elsewhere. The research verdict is that this naming is inconsistent; the documentation must preserve the proven terminal association and an implementation PR should later clean the constant semantics.

## propId 0

Observed domain:

```text
00 : 42,536
01 : 42,476
```

The near-perfect balance and high frequency prove only that this is a frequently changing binary property. It does **not** prove movement, visibility, firing, engine state or any other specific semantic. Those remain hypotheses until a controlled replay isolates the variable.

## propId 4

The most common raw 2-byte values include:

```text
0100, 0301, 0201, 0202, 0302, 0209, 0305, 0205, 0309, ...
```

This disproves earlier descriptions of propId 4 as a simple two-state flag. It is a structured/mode-like state family. Full bit/byte semantics remain `PARTIAL`.

## propId 8

Variable length (1–4 B) with recurrent values such as:

```text
00
0122
0123
0128
0121
012b
022322
...
```

The first byte often behaves like a count/variant prefix, but that interpretation is not yet independently proven. Preserve raw bytes.

## propId 9

Most values are exactly 4 B and decode to finite float-like values; 399 one-byte zero records and a handful of 2–3 B records also exist. The heterogeneous width means production code must not unconditionally decode every propId 9 payload as `float32`.

Current status: `PARTIAL`, with HP semantics explicitly rejected by prior probes.

## Sparse properties 10–13

Properties 10–13 are real protocol surface, not parser noise:

- each is aligned inside valid contiguous Type 7 framing;
- all have repeat observations across multiple entities/replays;
- all use 4-B values in this corpus;
- their semantic names remain `UNKNOWN`.

They must be preserved in raw evidence and included in future controlled probes instead of being silently discarded.

## Version scope

These conclusions are verified for the supplied 11.19.0 China corpus. Property IDs are version-sensitive protocol indices; future versions must be revalidated before reusing semantic labels.
