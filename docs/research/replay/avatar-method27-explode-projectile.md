# Avatar method27 — projectile explosion/terminal-resolution family

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Numeric method IDs are entity-class and client-version scoped.

## Executive verdict

Avatar method27 is no longer only a generic projectile-terminal companion candidate. The current 34-arena corpus gives a field-level closure tying it to the same terminal point as method20 (`stopTracer`). Combined with the historical Wargaming `explodeProjectile` replay-visible RPC family, the safe current semantic is:

> **Avatar method27 = projectile explosion / terminal-resolution family — PROVEN behavioral family / PARTIAL exact symbolic schema.**

It is reasonable to use `explodeProjectileFamily` as an internal semantic label, but consumers should preserve the current Blitz raw fields because the payload is not byte-for-byte identical to the historical PC signature.

## Current fixed payload

All current observations are exactly 34 bytes:

```text
shotId          : u32 LE        [0..4)
field4_7Raw     : u32 LE        [4..8)
materialLike    : u8            [8]
terminalPoint   : 3 x float32   [9..21)
vectorLike      : 3 x float32   [21..33)
flagLike        : u8            [33]
```

Observed count:

```text
method27 records = 518
```

## Terminal-point identity — 518/518 exact

For each method27 record, the first `u32` is the same shot/projectile identifier used by Avatar method20.

Joining by `(arena, shotId)` gives:

```text
method27 with method20 partner = 518 / 518
method27.rawClock == method20.rawClock = 518 / 518
```

Most importantly, interpreting bytes `[9..21)` as three little-endian float32 values gives a terminal point that is **exactly identical** to method20's endpoint for every event:

```text
method27 terminalPoint == method20 endPoint
518 / 518
median Euclidean error = 0
max Euclidean error    = 0
```

This is field-level proof that method27 belongs to the projectile terminal/explosion side of the same shot lifecycle.

## Other observed fields

### byte 8 — material-like finite domain

Observed domain:

```text
0 : 168
1 : 255
2 :   3
3 :  27
4 :  18
5 :  47
```

This small `0..5` domain is consistent with a material/contact category, but the exact symbolic enum remains PARTIAL.

### bytes 4..7 — projectile/effect identity family

`field4_7Raw` takes 30 distinct values in the corpus and is strongly structured rather than random. Frequent examples include:

```text
0x0008562a
0x0008552a
0x0001358a
0x00081d5a
0x0008265a
```

The exact mapping is not yet proven. Preserve it raw/version-scoped.

### bytes 21..32 — vector-like field

This region decodes cleanly as three finite float32 values across the corpus. It is plausibly a surface normal / impact vector family, but current geometry has not yet closed the exact physical meaning.

### byte 33 — boolean-like flag

Observed domain:

```text
0 : 238
1 : 280
```

The exact semantic is UNKNOWN/PARTIAL.

## Historical schema support

Historical Wargaming Avatar definitions expose a replay-visible method:

```text
explodeProjectile(
    SHOT_ID,
    UINT8,
    UINT8,
    VECTOR3,
    VECTOR3,
    ARRAY<UINT32>
)
```

That independently supports the method family: shot ID + small categorical fields + terminal/contact vectors + extra resolution data.

However, the current Blitz 11.19 body is not a byte-for-byte copy of that historical schema. Therefore:

- historical symbolic family is useful support;
- historical numeric method ID/order is not reused;
- current fields remain version-gated;
- no current raw field is renamed solely from historical layout.

## Shot-lifecycle implication

Current safe chain becomes:

```text
Vehicle method0(args=01)
  vehicle-fired / showShooting family
        |
        v
Avatar method29
  launch + shooterId + shotId + launch vector
        |
        | shotId
        +------------------+
        |                  |
        v                  v
Avatar method20        Avatar method27
stopTracer endpoint    explosion/terminal-resolution family
PROVEN                 PROVEN family / PARTIAL exact fields
        \__________________/
             same terminal point
```

Do not equate method27 with penetration or HP damage. A projectile explosion/contact event and authoritative damage are separate facts.

## Consumer contract

```text
ProjectileTerminalResolution {
    rawClockSec
    shotId
    terminalPoint
    field4_7Raw
    materialLikeRaw
    vectorLikeRaw
    flagLikeRaw
    confidence = PROVEN_FAMILY
}
```

Safe uses:

- battle playback: terminal/explosion visual event at the proven terminal point;
- AI review: identify that a recorded projectile reached a terminal/contact resolution event;
- research joins: correlate with method38 hit feedback, Vehicle method8 damage and HP deltas.

Unsafe without further closure:

- `method27 == penetration`;
- `materialLikeRaw` exposed as a named armor/material enum;
- `vectorLikeRaw == armor normal` without geometry validation;
- treating absence of method27 as proof a projectile missed.
