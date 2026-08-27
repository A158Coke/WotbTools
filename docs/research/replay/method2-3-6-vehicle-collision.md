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

The 1-byte Avatar form is a small state/boolean-like payload.

```text
01 : 101
00 :  88
```

Events are sparse and may repeat the same byte value rather than forming a strict alternating toggle, so the payload must not yet be named as a simple on/off property.

Verdict:

> Avatar method2 = **state/flag/reason-code family — PARTIAL**, exact semantic unknown.

A historical Avatar client method `onAutoAimVehicleLost(UINT8)` is an interesting one-byte shape candidate, but current 11.19 event-level evidence does not yet prove that identity and the numeric method index is version-sensitive.

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

which initially looked like an exact wire-shape candidate. A deeper current-corpus pass, however, weakens that interpretation substantially.

#### One-shot/entity behavior

All 60 Vehicle-method2 records target settled combat vehicles. Within a replay/entity pair, the method appears only once in the current corpus:

```text
60 records
60 distinct (arena, entity) pairs
0 repeated method2 records for the same vehicle in one arena
```

That is unlike a natural repeated push/collision event surface.

The two float values also cluster strongly by settled vehicle descriptor (`PlayerResults field103`). Examples:

```text
vehicle descriptor 29985 : 36 samples
  recurring A/B modes include
  554.550 / 0.025598
  532.076 / 0.024398
  565.788 / 0.026201
  588.262 / 0.027415
  543.313 / 0.024997

vehicle descriptor 4481 : 7 samples
  A ≈ 393 .. 472
  B ≈ 0.0367 .. 0.0454

vehicle descriptor 15697 : 5 samples
  A ≈ 836 .. 903
  B ≈ 0.0421 .. 0.0461
```

This looks more like a vehicle-specific physical/configuration/effect parameter pair than a generic dynamic push notification.

A nearest-position probe also fails to show a universal close-vehicle contact condition; some method2 events have no nearby observed second vehicle at the event clock.

Therefore the earlier historical-name candidate must be downgraded.

Verdict:

> Vehicle method2 = **two-float vehicle-specific parameter/state family — PARTIAL**.
>
> historical `onPushed` = **WEAK/REJECTED as a direct current semantic assignment**; signature equality alone is insufficient and current behavior does not support promotion.

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

The first byte is constant `0x73`; the second byte is a sparse binary value. The method occurs only in five current arenas and targets the recorder Avatar.

The binary byte does not form a strict alternating toggle, and event clocks overlap a wide mix of ordinary combat and UI/arena updates. No current event-level join closes a specific meaning such as auto-aim, sniper state, consumable activation, or gun lock.

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

The trailing `uint8` is currently:

```text
0 : 176
1 :  57
```

Its exact collision/material/state meaning remains unresolved.

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

The one current settlement `deathReason=world_collision` victim does not itself receive a method6 event in the recorder stream, proving that method6 presence is not required for every server-settled world-collision death from a single POV.

Verdict:

> Vehicle method6 = **static/world collision contact family — PROVEN behavioral family**
>
> current exact symbolic method name = **STRONG PARTIAL**, independently supported by historical `onStaticCollision` signature.

## Production implications

1. Dispatch method IDs by at least `(clientVersion, entityClass, methodId)`.
2. Do not decode Avatar method2 with the Vehicle two-float schema.
3. Do not name Vehicle method2 `onPushed` from historical signature equality alone.
4. Preserve method6 as a geometric collision event even before the exact current Blitz symbol is recovered.
5. method6 is potentially useful for collision/world-impact reconstruction and for validating `deathReason=world_collision`, but a death association must be proven separately rather than inferred from method6 presence alone.
