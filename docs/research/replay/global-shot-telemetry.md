# Global shot telemetry — Vehicle method0 + Avatar method29/method20

> Corpus: strict 34 unique-arena Blitz 11.19.0 China replay subset.
>
> This chapter extends `projectile-lifecycle.md`. The key new result is that the Avatar projectile RPC surface is not merely recorder-local: the current POV replay carries near-global shot terminal telemetry for the settled 14-player battle.

## Executive verdict

The current strict corpus closes three complementary shot surfaces:

```text
Vehicle method0(args=01)
    -> shooter-vehicle `showShooting` / fired notification family

Avatar method29
    -> projectile launch family
    -> contains shooter entity ID + shot ID + launch geometry/velocity

Avatar method20
    -> stopTracer(shotId, endPoint)
    -> terminal endpoint
```

The major new corpus-level finding is:

> Avatar method20 cardinality almost exactly equals **all 14 settled players' total shots**, not merely the recorder's shots.

This enables a near-global shot ledger from one POV, subject to explicit replay-stream completeness boundaries.

## Settlement baseline

Across the strict 34 arenas, summing `PlayerResultsInfo.field4` over all 14 settled combatants gives:

```text
all-player settlement shots : 4,373
all-player settlement hits  : 3,788
all-player penetrations      : 3,415
```

These server settlement totals are the independent cardinality baseline.

## Avatar method20 is near-global shot terminal telemetry

Current method20 structure remains:

```text
shotId   : u32/i32
endPoint : VECTOR3 / 3 x float32
```

and is independently identified as the replay-visible `stopTracer(shotId,endPoint)` family.

Strict-corpus cardinality:

```text
unique method20 shot IDs : 4,358
settlement all-player shots: 4,373
```

Per arena:

```text
31 / 34 arenas : method20 count == total settlement shots exactly
remaining deltas: -1, -2, -12
Pearson r(method20, total shots) ≈ 0.9946
mean absolute per-arena error    ≈ 0.44 shots
```

Verdict:

> method20 is **near-global all-player shot terminal telemetry — PROVEN relationship on the current corpus**.

This supersedes any architecture that treats the Avatar projectile lifecycle as recorder-only.

### Important boundary: event-stream completeness

The largest mismatch is arena `1161440170298931846`:

```text
settlement total shots        : 118
method20 terminals            : 106
missing                        : 12
settlement/root5 duration     : 175 s
meta.json battleDuration      : ~163.23 s
Type14 stream-close raw clock : ~165.26 s
```

The event recording ends materially before the settlement battle duration, while `battle_results.dat` still contains the complete server result.

Therefore the 12-shot deficit is evidence of **POV/event-stream incompleteness**, not evidence that the method20 decoder lost those packets.

The other two mismatches are only `-1` and `-2` and remain small boundary cases.

Consumer rule:

> method20 may support a high-confidence global shot ledger only when replay-stream completeness checks pass; settlement remains authoritative for final shot counts.

## Avatar method29 shooter field is independently closed

Method29 has 37-byte args. Its first u32 is the shooter/vehicle entity ID.

Across the strict corpus:

```text
method29 launch records              : 4,244
method29 shooter IDs resolving to one
of the 14 settlement result entities : 4,244 / 4,244
```

Per-player comparison against settlement shots across 476 settled player-records:

```text
players with method29 count == settlement shots exactly : 317 / 476
mean absolute per-player error                            : ~0.557 shots
```

Most deficits are small; larger deficits concentrate in arenas/players with incomplete or AoI-limited launch observation.

Thus:

> method29's first u32 is the **shooter vehicle/entity ID — PROVEN on current corpus**.

The method29 launch surface is broad but less complete than method20 terminal telemetry.

## Vehicle method0 normal variant = `showShooting` / vehicle fired family

Current Vehicle-targeted method0 has two structural families in this 34-arena subset:

```text
normal: argsLen=1, args=01 : 4,154 records
long/special variant        : 26 records, separate semantic path
```

The normal `01` family is overwhelmingly tied to projectile launches.

Joining by exact float32 replay clock:

```text
method29 launches                         : 4,244
launches with same-clock normal method0   : 4,142
of those, method29 shooterId is present in
the same-clock method0 outer entity set   : 4,130 / 4,142 = 99.71%
```

This is an exact-clock and entity-identity closure, not only a count correlation.

The normal method0 outer entity IDs also all resolve to settled combatant entities in this corpus.

Per-player comparison against settlement shots:

```text
settled player records                         : 476
method0 normal count == settlement shots exact : 366 / 476
mean absolute per-player error                 : ~0.460 shots
```

Independent historical Blitz replay method inventories contain the vehicle RPC name `showShooting`.

Verdict:

> Vehicle method0 with `args == 01` is the **vehicle fired / `showShooting` family — PROVEN behavioral identity / strong historical symbolic candidate**.

The 28-byte method0 argument variant must remain separate and is not included in this semantic promotion.

## Same-clock shooter attribution

For method29 launches, same-clock normal method0 candidates have this multiplicity:

```text
exactly one candidate shooter : 3,763 launches
multiple same-clock shooters  :   379 launches
no same-clock method0         :   102 launches
```

Because method29 itself carries shooterId, the multi-shooter batches are still resolvable: in 4,130/4,142 same-clock joins the method29 shooterId appears in the method0 vehicle set.

This provides independent validation of both surfaces and demonstrates why raw clock alone is insufficient when multiple shots are batched on one replay tick.

## Method20 vs method29 coverage

Existing lifecycle evidence:

```text
method20 unique shot IDs : 4,358
method29 unique shot IDs : 4,161
all method29 unique IDs have a method20 terminal : 4,161 / 4,161
```

Therefore at least:

```text
4,358 - 4,161 = 197
```

method20 terminal shot IDs have no observed method29 launch in the strict corpus.

Interpretation:

> the client can retain a shot's terminal/stopTracer observation even when its launch-side method29 record is absent from the POV stream.

This is consistent with AoI/visibility/batching boundaries and explains why method20 is significantly closer to the authoritative all-player shot count than method29.

Do not fabricate launch positions or shooter identities for terminal-only method20 shots without another evidence surface.

## Current reconstructable shot graph

For the highest-confidence population:

```text
Vehicle method0(showShooting)
    outer entityId = shooter
        |
        | exact-clock / identity cross-check
        v
Avatar method29
    shooterEntityId
    shotId
    launchPoint
    launchVelocity
        |
        | shotId
        v
Avatar method20
    shotId
    terminal endpoint
        |
        +--> method38 when recorder's own hit-result feedback applies
        +--> method27 on many environment/miss terminal paths
```

For global reconstruction, method38 remains recorder-feedback scoped, while method20/method29 are not recorder-only.

## Production implications

Safe, version-gated uses:

1. Build a near-global list of shot terminal endpoints from method20.
2. Join method29 by shotId when present to recover shooter, launch point and velocity.
3. Use Vehicle method0 as an independent `vehicle fired` cross-check and a separate shooter firing timeline.
4. Keep a `streamComplete`/coverage confidence marker; never force event totals to equal settlement totals.
5. Preserve terminal-only shots when method29 is missing instead of dropping them.

Unsafe shortcuts:

- `Avatar projectile RPC == recorder-only` — **FALSE on current corpus**.
- `method29 count == all shots` — false under AoI/stream boundaries.
- `method20 count == authoritative settlement shots without completeness gating` — too strong; 3/34 current arenas have deficits.
- `same rawClock == unique shooter` — false when multiple vehicles fire on the same replay tick.

## Remaining work

1. Explain the `-1` and `-2` method20/settlement boundary arenas.
2. Decode the 26 current method0 long-argument variants.
3. Determine whether terminal-only method20 shot IDs can be attributed through other server/Arena methods.
4. Join global method20/method29 shots to shell slot/type where the shooter is not the recorder.
5. Determine which projectile/hit result surfaces can provide global hit/penetration semantics beyond recorder-scoped method38.
