# Vehicle property9 — compact u8 state array

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Important: this is Vehicle-targeted property9. Avatar-targeted property9 is a separate float32 schema proven as recorder own-vehicle turret-relative yaw.

## Wire shape

Canonical Vehicle property9 observations:

```text
records : 300
payload lengths:
  1 byte : 295
  2 byte :   4
  3 byte :   1
```

Every record satisfies:

```text
payload[0] == payload.length - 1
300 / 300
```

Therefore the current wire layout is:

```text
count : u8
elements[count] : u8
```

Observed payloads include:

```text
00       -> []
01 22    -> [0x22]
01 25    -> [0x25]
01 23    -> [0x23]
02 23 25 -> [0x23, 0x25]
```

Verdict:

> Vehicle property9 = **compact u8 enum/state array — PROVEN structure / PARTIAL semantic**.

## Class-scope consequence

Property ID 9 is a direct example of why replay property decoders must route by entity class.

Current corpus:

```text
Avatar property9  : 67,371 records, always float32
Vehicle property9 :    300 records, count-prefixed u8 array
```

These are incompatible schemas under the same numeric property ID.

Safe dispatch:

```text
(clientVersion, Avatar,  property9) -> float32 recorder turret-relative yaw mirror
(clientVersion, Vehicle, property9) -> count + u8 state elements
```

The Vehicle element namespace remains unresolved and must stay raw until current-version effect/state definitions are recovered.
