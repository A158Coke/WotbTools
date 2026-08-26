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

The structure is strongly projectile-like for four independent reasons.

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

### 3. Projectile launch velocity / direction vector

The second VECTOR3-like vector has magnitude in the observed range:

```text
~480 .. 1,441
median ~760
```

More importantly, it aligns with the independently observed terminal displacement from method29 start point to method20 `stopTracer` endpoint.

Across all 4,244 matched method29→method20 observations:

```text
cos(angle(launchVector, endPoint - startPoint)) > 0.90 : ~99.3%
cos(angle(launchVector, endPoint - startPoint)) > 0.99 : ~98.8%
median cosine                                     : ~0.9999998
```

Restricting to records where method29 and method20 have different packet clocks produces the same directional result.

This closes the vector's physical family far more strongly than magnitude alone:

> method29's second VECTOR3 is the **projectile launch velocity/direction vector** — `PROVEN physical meaning` for the current corpus.

Its magnitude is speed-like and consistent with shell velocities, but exact coordinate units and whether the vector is the initial server simulation velocity or a client tracer velocity remain version-specific implementation details.

The final float32 scalar is strikingly invariant:

```text
6.278400421
4,244 / 4,244 observed method29 records
```

This is consistent with a shared ballistic/gravity-like parameter, although the exact symbolic field name and units remain unproven.

### 4. Launch-before-end ordering

For the 4,161 shot IDs shared by method29 and method20:

```text
method29 - method20
median : 0 s
min    : about -1.117 s
```

3,499 pairs share the same recorded packet clock; the remaining population has method29 preceding method20 by up to roughly 1.12 s.

This one-sided ordering is consistent with projectile launch followed by tracer termination, but it also reveals an important timing limitation.

## Packet rawClock is not projectile simulation time

A direct kinematic test compared:

```text
geometric distance = |endPoint - startPoint|
reported vector magnitude = |launchVector|
packet clock delta = method20.rawClock - method29.rawClock
```

For the 697 records with a positive packet-clock delta greater than 1 ms, a naive ballistic estimate:

```text
distance / (|launchVector| * packetClockDelta)
```

has median roughly `2.15`, not `1`, with a wide distribution. Meanwhile the vector direction itself is extremely well aligned with the endpoint displacement.

Therefore the failure is not a spatial interpretation problem. The replay `rawClock` timestamps these network/replay deliveries and can batch launch and terminal RPCs onto the same tick; it is **not a reliable per-projectile simulation-time clock**.

Verdict:

> `method20.rawClock - method29.rawClock` must **not** be presented as exact projectile flight time.

A future flight-time reconstruction requires either a simulation timestamp carried inside an RPC, ballistic integration from a proven velocity/gravity schema, or another independently timestamped projectile event.

## Method 29 verdict

> Avatar method29 is a **projectile/tracer launch-family event** — `PROVEN behavioral/physical family / PARTIAL symbolic schema`.

Current proven fields/relationships:

```text
shooter/entity relationship
shot/projectile ID
launch/reference point family
projectile launch velocity/direction vector
method29 -> method20 shot lifecycle
```

Still PARTIAL:

```text
small flag/code
the invariant 6.278400421 scalar's exact name/units
current Blitz symbolic RPC name
```

Do **not** assign a historical PC method number/name solely from this numeric ID. Current Blitz entity-method numbering is version/component-order dependent.

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
- `method20.rawClock - method29.rawClock == true shell flight time`;
- numeric Avatar method IDs from a different Wargaming version == current Blitz numeric IDs;
- projectile visual events == authoritative HP loss.

Authoritative observed HP loss continues to come from Type7 current-HP deltas; settlement remains authoritative for final combat statistics.

## Remaining work

1. Recover a version-matched symbolic method29 launch RPC and exact names for its flag/scalar fields.
2. Decode method27 against projectile terminal/explosion/hit-result schemas and determine why only a subset of shots carry it.
3. Determine method28's event family through identifier and geometry joins, not payload-size matching.
4. Investigate whether method29's velocity vector plus a proven ballistic constant can reconstruct simulation flight time independently of packet rawClock.
5. Correlate projectile resolution with Type8 damage methods, HP deltas and settlement hit/penetration counts while preserving the distinction between visual projectile state and authoritative damage.
