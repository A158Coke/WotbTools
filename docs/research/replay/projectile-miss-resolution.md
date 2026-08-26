# Avatar method27 — miss / environment-terminal projectile resolution

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> This chapter refines the earlier `projectile terminal-resolution companion` label using settlement shot/hit counts, projectile shot IDs, endpoint geometry and direct-damage negative controls.

## Executive verdict

Avatar method27 is strongly concentrated on projectiles that do **not** become normal settled vehicle hits. Its count tracks settlement `shots - hits` at both arena and player level, its endpoint is usually far from any observed vehicle, and almost all records lack same-clock direct HP-damage evidence.

Safe current verdict:

> Avatar method27 = **observed miss / environment-terminal projectile-resolution family — PROVEN behavioral family / PARTIAL exact symbolic RPC and subcodes**.

Do **not** reduce the event to a universal boolean `miss=true`: a small number of records occur near vehicles, and replay/AoI coverage plus settlement semantics prevent a perfect one-to-one identity.

## Existing structural closure

Current method27 argument body is fixed at 34 bytes and has this partially decoded shape:

```text
shotId       : u32
unknownU32   : u32
code         : u8
endPoint     : VECTOR3
terminalVec  : VECTOR3
flag         : u8
```

For all current records:

```text
method27 records / unique shot IDs         : 518
method27 shot IDs also having method20     : 518 / 518
method27 and method20 rawClock identical   : 518 / 518
method27.endPoint == method20.stopTracer endpoint : 518 / 518
```

For 439 method27 shots that also have a method29 launch packet, `terminalVec` is almost perfectly aligned with the method29 launch direction / launch-to-endpoint displacement. Its magnitude is on a different scale, so only the direction family is proven.

## Settlement miss cardinality

Across the 34 deduplicated arenas, authoritative settlement totals are:

```text
shots         : 4,373
hits          : 3,788
shots - hits  :   585
method27      :   518
```

Per-arena `method27 count` versus settlement `shots - hits` has:

```text
Pearson r ~= 0.9584
```

Many arenas are exact or differ by only one or a few observations. The dominant difference direction is method27 being lower than settlement misses, consistent with the already-proven replay/AoI observation boundary.

Three arenas exceed settlement misses by only `+1`, `+1`, and `+3`, so method27 is not mathematically identical to the settlement miss counter.

## Player/shooter-level closure

Method29 provides the shooter entity for shot IDs. Joining method27 `shotId -> method29 shooter` allows a player/replay comparison against that player's settlement misses.

Across 476 settled player/replay rows:

```text
exact method27 count == settlement misses : 357 / 476
method27 count < settlement misses         : 107 / 476
method27 count > settlement misses         :  12 / 476
Pearson r                                  : ~0.81
```

79 method27 records lack a method29 launch packet in the same POV and therefore cannot be assigned to a shooter through that join. This is another reason not to demand perfect per-player equality from a client-observed stream.

The player-level result independently supports the same physical family as the arena aggregate.

## Direct-damage negative control

A same-rawClock search for a Vehicle method8 direct-damage notification from the same method29 shooter finds:

```text
method27 with no same-clock direct-damage notification : 508 / 518
method27 with such a notification                      :  10 / 518
```

The ten co-timed cases were then checked geometrically against the corresponding damage victim.

Only three have the method27 endpoint within approximately 3 m of that victim. Most of the remainder are 10–300 m away, demonstrating that several apparent same-clock joins are unrelated events batched onto one replay/network tick.

Therefore:

> method27 is overwhelmingly **not** the normal HP-damaging vehicle-hit path.

## Endpoint geometry

For each method27 endpoint, the nearest available Type10 vehicle position at the same replay time was measured.

Current distribution:

```text
nearest vehicle <=  3 m :   7 / 518
nearest vehicle <=  5 m :  13 / 518
nearest vehicle <=  8 m :  31 / 518
nearest vehicle <= 10 m :  52 / 518
nearest vehicle <= 15 m : 121 / 518
median nearest-vehicle distance ~= 29.0 m
```

Many endpoints are tens to hundreds of metres from every currently observed vehicle.

This strongly supports an environment/static-geometry terminal family rather than a vehicle-hit notification.

The small near-vehicle population prevents promotion to `terrain only`: shells can terminate on nearby static geometry, visual collision boxes differ from vehicle centers, and some method27 variants may cover additional non-normal-hit resolutions.

## Fire ignition negative control

The current corpus contains 23 independently identified shell-induced fire-start events (`Type32 ...04`).

All 23 can be joined to a shooter method29 projectile launch. For those launch shot IDs:

```text
fire-start shots with method27 : 0 / 23
```

Therefore method27 codes `0..5` are not a generic fire/ignition result family.

## Current code / flag domains

Observed method27 code distribution:

```text
code 0 : 168
code 1 : 255
code 2 :   3
code 3 :  27
code 4 :  18
code 5 :  47
```

Final flag distribution:

```text
flag 0 : 238
flag 1 : 280
```

Code and flag are correlated, but neither can yet be safely named as terrain material, impact effect, shell result, ricochet type, water, destructible-object category or another symbolic enum.

The second u32 also cannot be treated as ammo slot or universal shell identity: the same vehicle/slot can produce multiple values.

Given the environment-terminal closure, material/effect/impact descriptor hypotheses become more plausible, but remain `UNKNOWN/PARTIAL` until field-level evidence is available.

## Relationship to method20

Safe projectile model now becomes:

```text
method29
  projectile launch
  shotId + launch geometry
       |
       v
method20
  stopTracer / universal observed terminal endpoint
       |
       +--> normal vehicle hit/damage path
       |      Vehicle method8 + Type7 prop3 etc.
       |
       +--> method27 on a large miss/environment-terminal subset
              same shotId
              same endpoint
              environment/resolution metadata
```

Method20 remains the general tracer/projectile terminal surface. Method27 is an additional conditional resolution surface, not a replacement for method20.

## Consumer guidance

Safe future statement:

```text
"this observed projectile terminated away from normal vehicle-hit geometry and carries environment/miss-resolution metadata"
```

Unsafe statements until subcodes close:

```text
code 0 = ground
code 1 = wall
code 2 = water
code 3 = ricochet
unknownU32 = terrain material ID
method27 = settlement miss exactly
```

For final hit/miss statistics, settlement remains authoritative. Method27 is valuable for timeline/playback spatial reconstruction because it supplies the actual observed terminal point and conditional impact metadata.

## Remaining work

1. identify code `0..5` using endpoint joins to known map/static geometry;
2. determine `unknownU32` through material/effect/resource joins rather than ammo-slot guesses;
3. inspect the small near-vehicle method27 population separately;
4. distinguish terrain, destructible props, water and other environment targets;
5. validate the miss/environment relationship on random battles and other client versions;
6. preserve AoI/POV incompleteness when comparing replay events with authoritative settlement totals.
