# Avatar/Vehicle method2, method3, method6 — routing and collision-family probe

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Important: method IDs are entity-class scoped. The same numeric method ID must not be decoded globally.

## method2 — class collision

Current corpus:

```text
total method2 RPCs             : 249
arenas                         : 34

Avatar target, 1-byte args     : 189
Vehicle target, 8-byte args    : 60
```

This is direct proof that `method2` is not globally one semantic surface.

### Avatar method2

The 1-byte Avatar form is a small state/boolean-like payload. Current values are dominated by `01` with `00` transitions.

Verdict:

> Avatar method2 = **state/flag family — PARTIAL**, exact semantic unknown.

### Vehicle method2

The Vehicle form is exactly:

```text
float32 A
float32 B
```

Observed ranges in the canonical corpus:

```text
A ≈ 335.0 .. 915.0
B ≈ 0.0088 .. 0.0815
```

Historical Wargaming `Vehicle.def` independently contains:

```text
onPushed(FLOAT32, FLOAT32)
```

which is an exact wire-shape candidate. Current behavior has not yet uniquely distinguished `onPushed` from another two-float vehicle method, so the historical name is not promoted solely from signature matching.

Verdict:

> Vehicle method2 = **two-float vehicle state/effect family — PARTIAL**
>
> historical `onPushed` = **strong schema candidate**, not current-version proof.

## Avatar method3

Current corpus:

```text
total RPCs : 92
arenas     : 5
args       : fixed 2 bytes
```

Observed payloads:

```text
73 00 : 83
73 01 :  9
```

The first byte is constant `0x73`; the second byte is a sparse binary toggle.

All observed targets are non-combat vehicle IDs and route to the recorder Avatar side, not the 14 settled Vehicle entity IDs.

Verdict:

> Avatar method3 = **fixed-code + boolean/state family — PARTIAL**, exact semantic unknown.

## Vehicle method6 — static-collision family

Current corpus:

```text
total RPCs : 233
arenas     : 31 / 34
args       : fixed 29 bytes
all targets: settled Vehicle entity IDs
```

The 29-byte body parses cleanly as:

```text
scalar       : float32
contactPoint : VECTOR3
normal       : VECTOR3
flag         : uint8
```

### Structural validation

Observed scalar range:

```text
≈ 0.996 .. 51.260
```

The `contactPoint` occupies map-world coordinate ranges:

```text
x ≈ -239 .. 241
y ≈   14 ..  62
z ≈ -222 .. 233
```

For all 233 events, joining to the same target Vehicle's nearest Type10 pose shows the point is local to that vehicle:

```text
distance(contactPoint, vehiclePosition)
min    ≈ 1.23 m
median ≈ 3.61 m
max    ≈ 5.44 m
```

The second VECTOR3 is an essentially exact unit vector:

```text
norm min    ≈ 0.99999988
norm median ≈ 1.00000000
norm max    ≈ 1.00000014
```

This is the expected geometry of a collision contact point plus collision/contact normal.

### Independent historical schema match

Historical Wargaming `Vehicle.def` exposes:

```text
onStaticCollision(
    FLOAT32,
    VECTOR3,
    VECTOR3,
    UINT8,
    FLOAT32,
    INT8,
    UINT16
)
```

The current Blitz method6 body is exactly the first four fields:

```text
FLOAT32 + VECTOR3 + VECTOR3 + UINT8 = 29 bytes
```

The older PC schema carried three additional tail arguments, so the historical method number/signature cannot be copied wholesale. But the current behavioral geometry independently matches the same family.

### Damage-event negative control

Only 5 / 233 method6 events share the same clock and victim with a normal Vehicle method8 damage event. Therefore method6 is not a generic shell-hit/damage RPC.

Verdict:

> Vehicle method6 = **static/world collision contact family — PROVEN behavioral family**
>
> current exact symbolic method name = **STRONG PARTIAL**, independently supported by historical `onStaticCollision` signature.

## Production implications

1. Dispatch method IDs by at least `(clientVersion, entityClass, methodId)`.
2. Do not decode Avatar method2 with the Vehicle two-float schema.
3. Preserve method6 as a geometric collision event even before the exact current Blitz symbol is recovered.
4. method6 is potentially useful for collision/world-impact reconstruction and for validating `deathReason=world_collision`, but a death association must be proven separately rather than inferred from method6 presence alone.
