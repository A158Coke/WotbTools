# Avatar method27 — `explodeProjectile` family closure

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Numeric method IDs remain version/entity-class scoped. This chapter identifies the **behavioral/symbolic family**, not a permanent global method number.

## Executive verdict

Avatar method27 is the current replay-visible **`explodeProjectile` family**.

This closure is supported by four independent layers:

1. every method27 shot ID closes to the universal method20 `stopTracer` terminal endpoint;
2. the current 34-byte body contains the same physical field families as the historical Wargaming `explodeProjectile` RPC: shot ID, effect fields, endpoint, velocity direction and a trailing destructible/variant field;
3. method27 count tracks settlement misses (`shots - hits`) extremely strongly;
4. method27 endpoints are usually far from observed vehicles, matching an environment/static-geometry projectile explosion path.

Verdict:

> current Blitz 11.19 Avatar method27 = **`explodeProjectile` behavioral/symbolic family — PROVEN**, while several current field boundaries/names remain `PARTIAL`.

## Independent Wargaming schema

Historical Wargaming client code exposes:

```text
explodeProjectile(
    shotID,
    effectsIndex,
    effectMaterialIndex,
    endPoint,
    velocityDir,
    damagedDestructibles
)
```

The implementation:

- looks up `shotEffects[effectsIndex]`;
- looks up `EFFECT_MATERIALS[effectMaterialIndex]`;
- passes `shotID`, effect descriptor/material, `endPoint` and `velocityDir` to the projectile explosion renderer;
- separately processes destructible-object information when present.

Independent replay/mod research describes the RPC as the projectile impact on ground/environment geometry and explicitly uses `endPoint` and `velocityDir` as the impact point/direction.

This historical symbol is not accepted from numeric method equality. It is accepted because the current replay behavior and body shape independently match the same RPC family.

## Current Blitz body

Current method27 argument length is fixed:

```text
34 bytes
518 / 518 records
```

Current empirical decomposition:

```text
bytes  0..3   shotId                 u32            PROVEN
bytes  4..7   packed/effect field    4 bytes        PARTIAL
byte      8   small effect/material candidate 0..5 PARTIAL
bytes  9..20  endPoint               VECTOR3        PROVEN
bytes 21..32  terminal/velocity direction VECTOR3  PROVEN physical direction
byte     33   trailing binary field  0/1            UNKNOWN/PARTIAL
```

The body-size arithmetic is exactly compatible with a compact Blitz specialization of the historical `explodeProjectile` argument family:

```text
4 + 4 + 1 + 12 + 12 + 1 = 34
```

However, current field names must not be copied blindly from the historical PC schema.

## `shotId` and endpoint closure

For all current records:

```text
method27 records / unique shot IDs : 518
also have method20 stopTracer      : 518 / 518
same packet rawClock as method20   : 518 / 518
method27.endPoint == method20.endPoint : 518 / 518 exactly
```

Thus current method27 acts at the exact same projectile terminal point already proven by `stopTracer`.

## Direction-vector closure

For the 439 method27 shots also carrying a method29 launch packet:

```text
cos(method27 terminalVec, method29 launchVector)
median ~= 0.999999
439 / 439 > 0.90
```

The direction also aligns with `endPoint - launchPoint`.

Its magnitude is on a different scale from method29 launch velocity, so the safe conclusion is:

> method27 carries the **terminal projectile/impact direction family — PROVEN physical direction**.

Exact units and whether it is normalized/scaled client velocity remain `PARTIAL`.

## Miss/environment behavior

Authoritative settlement across the strict corpus:

```text
shots        : 4,373
hits         : 3,788
misses       :   585
method27     :   518
```

Per-arena correlation:

```text
corr(method27 count, shots - hits) ~= 0.9584
```

Player/shooter-level join using method29 shot IDs:

```text
476 player/replay rows
exact method27 == settlement misses : 357
method27 < settlement misses        : 107
method27 > settlement misses        :  12
correlation                         : ~0.81
```

The predominantly short direction is consistent with replay/AoI observation limits.

This does not make method27 mathematically identical to the settlement miss counter; it proves the same miss/environment-terminal behavioral family.

## Endpoint geometry

Nearest observed vehicle-center distance for method27 endpoints:

```text
<=  3 m :   7 / 518
<=  5 m :  13 / 518
<=  8 m :  31 / 518
<= 10 m :  52 / 518
<= 15 m : 121 / 518
median  : ~29 m
```

Most endpoint locations are therefore not normal vehicle-impact geometry.

A same-clock Vehicle method8 direct-damage search initially found only ten co-timed cases. Geometry shows most of those method27 endpoints are 10–300 m away from the corresponding damage victim, proving that many are unrelated events batched on the same replay tick.

## Fire negative control

23 independently closed shell-induced fire ignitions were joined to their method29 projectile launch.

```text
fire-start projectile with method27 : 0 / 23
```

Thus the method27 small code is not a generic ignition/fire-result enum.

## Effect/material fields

Current byte 8 has exactly this domain:

```text
0 : 168
1 : 255
2 :   3
3 :  27
4 :  18
5 :  47
```

The historical `explodeProjectile` schema contains an `effectMaterialIndex`, making this field a strong **effect/material-index candidate**.

The four bytes before it have structured values rather than an arbitrary random ID. Their exact current encoding is not yet closed, so they should remain a raw packed/effect field rather than being unconditionally labelled `effectsIndex`.

The final byte is strictly binary:

```text
0 : 238
1 : 280
```

Historical `explodeProjectile` carries `damagedDestructibles`, but current tests do **not** support directly naming this final bool as `hasDamagedDestructibles`: flag=1 is not enriched for same-clock static-entity Type32 updates. The field stays `UNKNOWN/PARTIAL`.

## Static-entity correlation by small material/effect code

Same-clock Type32 updates on entities without normal Type10 mobile streams vary by code:

```text
code 0 : 14 / 168
code 1 :  9 / 255
code 2 :  1 /   3
code 3 :  8 /  27
code 4 :  1 /  18
code 5 :  0 /  47
```

The variation supports the idea that code `0..5` distinguishes impact/effect material families, but individual symbolic materials remain `UNKNOWN` until an authoritative `EFFECT_MATERIALS` table or controlled map-object probes are available.

## Safe parser model

```text
ExplodeProjectileEvent {
    rawClockSec
    avatarEntityId
    shotId
    rawEffectField
    effectMaterialCandidate
    endPoint
    terminalDirection
    trailingFlag
}
```

Version-gated semantic status:

```text
RPC family              : PROVEN explodeProjectile
shotId                   : PROVEN
endPoint                  : PROVEN
terminal direction        : PROVEN physical meaning
effect/material fields    : PARTIAL
trailing binary field     : UNKNOWN/PARTIAL
```

## Consumer implications

- battle playback can place an observed projectile environment explosion at the actual endpoint;
- AI Review can distinguish an observed projectile that terminates on environment geometry from a normal damage path when evidence is sufficient;
- final hit/miss counts must still use settlement;
- do not expose raw material codes as `ground`, `wall`, `water`, etc. until they are independently mapped.

## Remaining work

1. recover the current Blitz effect/material enum for byte 8;
2. decode the 4-byte packed/effect field against current shot-effect resources;
3. determine the trailing binary field;
4. map environment endpoints to terrain/destructible/water geometry;
5. investigate the small near-vehicle explodeProjectile population;
6. validate the RPC family and field layouts on other Blitz versions.
