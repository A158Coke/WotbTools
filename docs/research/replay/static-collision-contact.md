# Vehicle method6 — static-contact / collision-response research

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Type8 method numbers are entity-class and version scoped. This chapter concerns **Vehicle-targeted method6** only.

## Executive verdict

Current Vehicle method6 is a spatial **vehicle contact / collision-response family**. Its payload has geometry consistent with a contact point and a unit contact-related vector, and its scalar correlates with an observed change in vehicle velocity.

Independent historical Wargaming replay material exposes a Vehicle method named `onStaticCollision`, while an independent WoT replay parser describes `OnStaticCollision` as a tank colliding with static geometry such as a fence and explicitly warns that this event changed frequently across versions.

The current payload/behavior makes `onStaticCollision` the strongest symbolic candidate, but no current Blitz 11.19 method table has been recovered. Therefore:

> Vehicle method6 = **static-contact / collision-response family — PROVEN physical family / PARTIAL symbolic identity**.

It is **not** an authoritative ramming, world-collision-damage or death-reason event.

## Current payload shape

On the strict 34-arena deduplicated corpus:

```text
Vehicle method6 records : 233
argument length          : 29 bytes in 233 / 233
```

A stable physical decomposition is:

```text
scalar        : float32
point         : VECTOR3 / 3 x float32
vector        : VECTOR3 / 3 x float32
flag          : u8

4 + 12 + 12 + 1 = 29 bytes
```

The exact field names and units remain `PARTIAL`.

## Contact-point geometry

For method6 events with usable same-time Type10 vehicle position:

```text
|point - vehicleCenter|
  observed roughly 1.2 .. 5.4 m
  median roughly 3.6 m
```

That is a vehicle-scale local contact region rather than a random arena coordinate.

The second VECTOR3 has unit magnitude to float precision in all observed records:

```text
|vector| ~= 1.0 : 233 / 233
```

This is consistent with a direction/normal-like contact quantity.

Verdict:

> `point` belongs to a vehicle-local contact-point family and `vector` is a unit contact-related direction — **PROVEN physical relationship / exact coordinate-frame semantics PARTIAL**.

## Relationship to vehicle motion

Type10 trajectories immediately before and after method6 were used to estimate the vehicle velocity change.

The first scalar has moderate positive correlation with the size of the motion change, with the strongest tested relationship when the velocity change is projected onto the method6 unit vector:

```text
scalar vs |delta velocity|                    : r ~= 0.46
scalar vs deceleration                        : r ~= 0.46
scalar vs |delta velocity projected on vector|: r ~= 0.52
```

This independently supports a physical contact/response interpretation rather than a module-state, HP or generic UI event.

The final flag has two observed values. Current samples show different motion distributions between them, but the corpus does not identify them as static/dynamic, wall/vehicle, entering/leaving contact or any other named polarity. Preserve the raw flag.

## Historical symbolic clue

Older Blitz replay/client metadata includes a Vehicle method named:

```text
onStaticCollision
```

alongside other familiar replay-exposed methods such as `showShooting`, `showVehicleDamageInfo`, `stopTracer` and Vehicle properties such as `criticalDevices`, `destroyedDevices`, `engineMode` and `health`.

Independent WoT replay-parser documentation describes `OnStaticCollision` as a vehicle colliding with static geometry, for example a fence, and notes that this RPC changed frequently across versions.

This is strong structural context but not a numeric mapping proof. Numeric method indices and argument schemas cannot be transplanted from another version/client family.

Safe symbolic verdict:

> current Vehicle method6 is **consistent with an `onStaticCollision`-like RPC**, exact current Blitz symbol `PARTIAL`.

## Negative control: settlement collision deaths

The strict corpus contains settlement-confirmed collision-related deaths:

```text
deathReason=2 ramming          : 2 samples
deathReason=3 world_collision  : 1 sample
```

For all three terminal events, a +/-2.5 s search found:

```text
method6 on the victim entity : 0 / 3
method6 on any vehicle entity: 0 / 3
```

Therefore method6 cannot be used as:

```text
ramming event
world-collision damage event
collision death event
authoritative collision damage source
```

The terminal collision deaths instead close through settlement `deathReason`, terminal HP/state and the normal death evidence chain.

This absence is compatible with method6 being a narrower client physics/contact callback for particular static contacts rather than a server combat-cause event.

## Consumer guidance

Safe future use, after version gating:

```text
"the vehicle had an observed local static/contact response near T"
```

Unsafe use:

```text
"the vehicle rammed the enemy"
"this collision caused X damage"
"method6 proves world-collision death"
```

Do not infer damage magnitude from the method6 scalar until its units and physical producer are independently closed.

## Remaining work

1. recover a current Blitz 11.19 Vehicle method schema or producer for method6;
2. determine the exact coordinate frame of the contact point and unit vector;
3. identify the scalar's physical quantity and units;
4. determine final-flag semantics;
5. correlate method6 with known static map geometry and destructible objects;
6. test controlled wall/fence/vehicle-contact cases to separate static contact from other physics callbacks;
7. validate across newer/older Blitz versions before exposing a symbolic RPC name.
