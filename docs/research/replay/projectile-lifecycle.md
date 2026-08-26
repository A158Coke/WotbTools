# Projectile / tracer lifecycle

> Corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China. Detailed lifecycle statistics below were computed on the strict-framing 34-arena deduplicated set unless stated otherwise.
>
> Type-8 method numbers are **entity-class and version scoped**. This document describes current Avatar-targeted 11.19 observations; it does not claim that the same numeric method ID has the same meaning on another entity class or client version.

## Why this family matters

The current replay stream contains more than the recorder-local Type23 firing switch. Avatar-targeted Type-8 methods preserve a shot/projectile identifier that allows several packets to be joined into one projectile lifecycle.

Observed high-value methods:

```text
Avatar method 29 : 37-byte args
Avatar method 20 : 16-byte args
Avatar method 27 : 34-byte args
Avatar method 28 : 36-byte args
```

The important join key is a 32-bit shot/projectile ID present in these event families.

## Method 20 — projectile/tracer terminal endpoint

Current argument body:

```text
SHOT_ID  : i32/u32
endPoint : VECTOR3 / 3 x float32
```

Total body length:

```text
4 + 12 = 16 bytes
```

Independent Wargaming Avatar schema/client code exposes the replay-visible method:

```text
stopTracer(shotID, endPoint)
```

with exactly `SHOT_ID + VECTOR3` arguments.

Corpus lifecycle evidence:

```text
unique shot IDs with method20 : 4,358
```

For every method29 launch-family shot ID observed in the strict corpus, a method20 record exists:

```text
method29 unique shot IDs       : 4,161
method29 IDs also having m20   : 4,161 / 4,161
```

Verdict:

> Avatar method20 is `stopTracer / projectile terminal endpoint` — **PROVEN** for the current corpus.

The endpoint is protocol evidence for where the client stops/hides that tracer/projectile representation. Whether that point is always a physical armor-contact point is a separate semantic question; consumers must not equate `stopTracer` with authoritative penetration/damage.

## Method 29 — projectile/tracer launch family

Current method29 body length is 37 bytes. Empirical parsing exposes:

- a shooter/entity identifier;
- a shot/projectile identifier;
- a small flag/code;
- a first VECTOR3-like point;
- a second VECTOR3-like vector;
- a final float32 scalar.

The structure is strongly projectile-like for three independent reasons.

### 1. Shot-ID lifecycle closure

```text
method29 unique shot IDs : 4,161
with method20 endpoint   : 4,161 / 4,161
```

No method29 shot ID in the strict corpus is orphaned from the method20 terminal endpoint.

### 2. Launch-point geometry

The first VECTOR3-like point lies close to the shooter vehicle's position at the same replay time. Across matched samples the median separation is approximately:

```text
~2.5 m
```

That is consistent with a gun/muzzle/reference launch position rather than an arbitrary arena vector.

### 3. Velocity-like vector

The second VECTOR3-like vector has magnitude in the observed range:

```text
~480 .. 1,441
```

with a median around the mid-hundreds of units per second. The magnitude distribution is compatible with shell/projectile velocity rather than normalized direction, map position or camera orientation.

The final float32 scalar is strikingly invariant:

```text
6.278400421
4,244 / 4,244 observed method29 records
```

This is consistent with a shared ballistic/gravity-like parameter, although the exact symbolic field name and units remain unproven.

### Launch-before-end timing

For the 4,161 shot IDs shared by method29 and method20:

```text
method29 - method20
median : 0 s
min    : about -1.117 s
```

3,499 pairs share the same recorded packet clock; the remaining population has method29 preceding method20 by up to roughly 1.12 s. That one-sided relation is consistent with projectile launch/in-flight followed by tracer termination, with batching causing many same-clock deliveries.

Verdict:

> Avatar method29 is a **projectile/tracer launch-family event** — `PROVEN behavioral family / PARTIAL symbolic schema`.

Do **not** assign a historical PC method number/name solely from this numeric ID. Current Blitz entity-method numbering is version/component-order dependent. The launch geometry and shot-ID lifecycle are proven; exact flag/scalar names remain PARTIAL.

## Method 27 — same-tick projectile resolution family

Observed:

```text
method27 records / shot IDs : 518
m27 IDs also having m20     : 518 / 518
m27 and m20 packet clock    : identical for 518 / 518
m27 IDs also having m29     : 439
```

Therefore method27 belongs to the terminal/resolution side of the projectile lifecycle rather than the launch side.

Independent Wargaming Avatar interfaces contain replay-visible projectile-resolution methods such as `explodeProjectile(...)`, but the current 34-byte Blitz body has not yet been mapped field-for-field to a version-matched symbolic signature. In particular, naïvely treating its trailing floats as the method20 endpoint fails geometry checks.

Verdict:

> Avatar method27 is a **projectile terminal/impact-resolution companion event** — `PROVEN relationship / PARTIAL semantic`.

It must not yet be exposed as `explodeProjectile`, penetration, explosion, or damage without a current Blitz schema or stronger field-level closure.

## Method 28 — 36-byte vector-like event remains unresolved

Method28 has a fixed 36-byte body that can be interpreted as nine float32 values, and a historical/current PC Avatar schema contains an `updateTargetingInfo` method whose fixed payload is also nine float32 values.

That size match is **not sufficient evidence**.

Current corpus geometry checks found:

- repeated 3xVECTOR3-like structure;
- in many records the first and second triplets are identical;
- no sufficiently stable mapping to recorder vehicle position, Type39 camera position, or target vehicle geometry;
- method28 shares identifiers/data relationships with nearby projectile event bundles.

Therefore the prior `36 bytes == updateTargetingInfo` hypothesis is deliberately not promoted.

Verdict:

> Avatar method28 — `UNKNOWN/PARTIAL`; preserve all nine float32 values and surrounding shot/event relationships.

## Current shot lifecycle graph

Safe current model:

```text
projectile/tracer launch family
  Avatar method29
       |
       | shotId
       v
projectile active / network delivery
       |
       +------------------+
       |                  |
       v                  v
Avatar method20       Avatar method27
stopTracer endpoint   terminal-resolution companion
PROVEN                PARTIAL semantic
```

Type23 remains a separate recorder-local firing/projectile switch and should be correlated with this lifecycle rather than replaced by it.

## Important negative conclusions

The current protocol does **not** justify these shortcuts:

- `stopTracer endpoint == penetration point`;
- `method27 == damage`;
- `method28 == targetingInfo` from payload length alone;
- numeric Avatar method IDs from a different Wargaming version == current Blitz numeric IDs;
- projectile visual events == authoritative HP loss.

Authoritative observed HP loss continues to come from Type7 current-HP deltas; settlement remains authoritative for final combat statistics.

## Remaining work

1. Decode every field in method29 and recover a version-matched symbolic launch RPC if available.
2. Decode method27 against projectile terminal/explosion/hit-result schemas and determine why only a subset of shots carry it.
3. Determine method28's event family through identifier and geometry joins, not payload-size matching.
4. Join method29 launch point/vector and method20 endpoint to map coordinates to derive measured projectile flight vector, distance and flight time.
5. Correlate projectile resolution with Type8 damage methods, HP deltas and settlement hit/penetration counts while preserving the distinction between visual projectile state and authoritative damage.
