# Fire, repair and vehicle-state correlations

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> This chapter records direct behavioral joins between Type32 mobile `flag=1` short bodies, Type7 vehicle state properties, HP ticks and Type32 consumable activations. Numeric identities are version-scoped. Historical Wargaming client code is used only as structural context and never as a direct numeric mapping.

## Executive verdict

The current corpus closes four high-value relationships:

1. Type32 mobile `flag=1` short-body family ending in `0x04` is a **fire-associated event family** — `PROVEN behavioral association`.
2. Type32 consumable `0x0B` is **Multi-Purpose Restoration Pack** and extinguishes the observed fire-DOT family — `PROVEN`.
3. Type32 consumable `0x0D` is **Repair Kit**: it clears a large mechanical/repair-compatible state family but does **not** extinguish the fire-DOT family — `PROVEN behavioral identity` on the current corpus.
4. The remaining paired instant-consumable code `0x0C` is therefore **First Aid Kit** — `PROVEN by pair elimination after independent 0x0D closure`; a direct crew-state wire surface is still unresolved.

Type7 Vehicle `propId=8` is a count-prefixed state-token collection, but it is **not** one flat list of mechanical modules: some token families are cleared by both Multi-Purpose Restoration Pack and Repair Kit, while others are only observed being cleared by Multi-Purpose Restoration Pack. Exact token-to-device names remain `PARTIAL/UNKNOWN`.

## Type32 short `...04` is fire-associated

Four strict-corpus deaths have settlement `deathReason=1`, independently proven as fire in `death-and-battle-clock.md`.

All four show a Type32 mobile `flag=1` short-body `...04` event during the final fire-DOT sequence:

```text
fire deaths checked                         : 4
with Type32 short ...04 during terminal burn: 4 / 4
```

Representative bodies:

```text
9c 04
9d 80 04
```

The corresponding HP stream shows repeated small losses at roughly 0.4–0.5 s cadence before terminal zero, rather than a single direct-hit delta.

Representative terminal chains:

```text
HP 662
  -> Type32 9c04
HP 74
  -> ~0.42 s
HP 0
```

```text
HP 107
  -> Type32 9d8004
HP 33
  -> ~0.49 s
HP 0
```

Verdict:

> Type32 mobile short `...04` = **fire-associated damage/effect family — PROVEN behavioral association**.

The current evidence does **not** prove that the final byte is a globally standalone `fire enum`. Short bodies are compact/variant encoded, and their exact field boundaries are still `PARTIAL`.

## Fire-consumable differential: `0x0B` vs `0x0D`

A direct behavioral test searched vehicle `...04` fire events followed within 3 s by an observed instant recovery consumable.

Observed matched cases:

```text
0x0B after fire event : 14
0x0D after fire event :  2
```

HP decreases after the consumable were then checked against nearby Vehicle method8 damage notifications so that a new shell hit would not be mistaken for continuing fire DOT.

### `0x0B` extinguishes the periodic fire-DOT stream

Of the 14 `0x0B` cases:

```text
13 / 14
```

have no subsequent independent periodic HP-loss tick after activation once new direct-hit method8 events are excluded.

The remaining case has one HP decrease exactly at the activation clock, consistent with the already-in-flight fire tick and not evidence of continuing post-activation burn.

Typical sequence:

```text
fire ...04
HP 2572
+0.50 s -> 2461
+1.02 s -> 2362
+1.52 s -> 2275
+1.90 s -> 0x0B activation
then periodic burn ticks stop
```

This independently closes the previously catalog-matched identity:

> `0x0B` = **Multi-Purpose Restoration Pack — PROVEN**.

## `0x0D` does not extinguish fire

Both observed `0x0D`-during-fire cases continue the same small periodic HP-loss cadence after activation, without matching direct-hit method8 events.

Example A:

```text
fire ...04
HP 1598
+0.50 s -> 1525
+1.02 s -> 1461
+1.10 s -> 0x0D activation
+1.48 s -> 1407
+2.00 s -> 1362
+2.50 s -> 1326
```

Example B:

```text
fire ...04
HP 2436
+0.40 s -> 2360
+0.80 s -> 0x0D activation
+0.91 s -> 2293
+1.37 s -> 2236
+1.89 s -> 2188
+2.38 s -> 2149
+2.88 s -> 2120
```

Thus `0x0D` can be used while the vehicle is burning, but it does not stop the observed fire DOT.

This rejects the alternative hypothesis that `0x0D` is another all-purpose restoration consumable.

Combined with its repair-state behavior below:

> `0x0D` = **Repair Kit — PROVEN behavioral identity** on the current 11.19 corpus.

## `0x0C` becomes First Aid Kit

The item catalog had previously reduced `0x0C` and `0x0D` to the pair:

```text
First Aid Kit
Repair Kit
```

After `0x0D` is independently closed as Repair Kit by:

- clearing Repair-Kit-compatible vehicle state tokens; and
- failing to extinguish the independently proven fire-DOT family,

there is only one remaining assignment:

> `0x0C` = **First Aid Kit — PROVEN by pair elimination** for this version/corpus.

Only five `0x0C` activations are present, so the underlying crew-injury property/method is still unresolved. In particular, a coincident `prop8` token must not be labelled as crew injury merely from proximity to First Aid use.

## Vehicle `propId=8` — count-prefixed state-token collection

Observed Vehicle prop8 payloads include:

```text
00
01 21
01 22
01 23
01 28
02 23 22
03 23 21 22
...
```

The current corpus supports the structural interpretation:

```text
byte0      = token count
byte1..N   = active state tokens
```

Token additions/removals were tracked as set transitions rather than treating every snapshot as a new event.

Observed prop8 token additions in the strict corpus include:

```text
0x1f  3
0x20  3
0x21 25
0x22 78
0x23 91
0x24  5
0x25  2
0x26  1
0x27 10
0x28 36
0x29 13
0x2b 18
```

### Removal-to-consumable closure

For observable removals, the following exact-clock relationships were found:

```text
token  removals   0x0B MPRP   0x0D Repair Kit   no matching instant recovery
0x21      18           9              9                    0
0x22      74          43             31                    0
0x23      87          46             39                    2
0x24       5           3              2                    0
0x25       1           0              1                    0
0x26       1           0              1                    0
0x27      10          10              0                    0
0x28      32          32              0                    0
0x29      12          12              0                    0
0x2b      16          16              0                    0
```

Therefore prop8 cannot safely be named `damagedModules` or another one-category collection.

Current safe interpretation:

> Vehicle prop8 = **count-prefixed recoverable/negative vehicle-state token collection — PROVEN structure / PARTIAL semantics**.

The token families are behaviorally heterogeneous:

- `0x21..0x26` are Repair-Kit-compatible in current observations;
- `0x27/0x28/0x29/0x2b` are only observed being cleared by Multi-Purpose Restoration Pack in this corpus.

This may reflect multiple device/effect categories encoded in one exposed property, or an index system whose meaning requires another state dimension. Exact names require a version-matched Blitz schema or controlled probes.

## Token `0x21` — mobility-correlated mechanical state

Only true set onsets were used.

For 25 observed `0x21` additions with usable Type10 trajectories:

```text
median speed before onset : ~2.61 m/s
median speed after onset  : ~0.25 m/s
within 1 s below 0.5 m/s  : 14 / 25
```

All 18 observable `0x21` removals are exactly aligned with either `0x0B` or `0x0D` activation:

```text
0x0B removals : 9
0x0D removals : 9
other         : 0
```

Verdict:

> `prop8 token 0x21` = **mobility-correlated, Repair-Kit-compatible mechanical state — PROVEN physical relationship / exact component UNKNOWN**.

Movement alone cannot distinguish engine critical from track critical because both can immobilize a Blitz vehicle. Do not expose `0x21 = track` or `0x21 = engine` yet.

A separate geometry test also failed to support the tempting `0x22=left track / 0x23=right track` hypothesis: 44 projectile-endpoint-aligned samples showed no stable left/right hull-local separation. That mapping remains `REJECTED / NOT PROVEN`.

## Type32 short-body encoding boundary

Repeated bodies such as:

```text
a4 22
9c 22
a0 22
a4 23
9c 23
a1 80 21
```

show clear compact/bit-packed structure. Some two-byte forms can be decomposed into stable 7-bit chunks, but the entire short-body family is **not** one universal LEB128 value: many observed bodies do not terminate as a single valid varint, and direct equality between a decoded high chunk and prop8 transition tokens has very low closure.

Therefore these shortcuts are invalid:

```text
lastByte == componentId
high7bits == prop8 token
entire short body == one universal varint
```

Historical Wargaming client interfaces exposing separate damage-code and vehicle-extra/device information are useful structural clues, but numeric fields must not be transplanted into Blitz 11.19 until field-level closure exists.

## prop7 `0x04` is not a canonical fire flag

One live fire/recovery sequence contains:

```text
prop7 = 01 04
0x0B activation
prop7 = 00
```

However, among 17 fire-`...04` events with nearby prop7 observations:

```text
prop7 = 00    : 16 occurrences
prop7 = 01 04 :  1 occurrence
prop7 = 01 23 :  1 occurrence
```

Therefore the stable fire evidence is the Type32 short `...04` family, not prop7.

Verdict:

> `prop7 token 0x04 == fire` is **NOT PROVEN** and must not be used as a canonical fire flag.

## Safe reconstruction guidance

A current evidence-preserving model is:

```text
FireEventEvidence {
    entityId
    rawClockSec
    rawType32Body
    source = TYPE32_MOBILE_FLAG1_SHORT_04_FAMILY
    confidence = PROVEN_BEHAVIORAL_ASSOCIATION
}

VehicleRecoverableStateSnapshot {
    entityId
    rawClockSec
    propertyId
    rawTokens[]
    semanticTokenNames = nullable
}
```

AI Review / playback may eventually use the proven fire family after a version gate and AoI boundary are implemented, but must not fabricate exact ignition time from the first observed DOT packet: the recorded `...04` event may represent a fire damage tick rather than the original ignition transition.

## Remaining work

1. identify the exact Type32 short-body bit layout and distinguish fire-start, fire-tick and fire-stop variants;
2. recover a current Blitz 11.19 mapping from state tokens to engine/tracks/gun/ammo-rack/turret/crew/effects;
3. locate the direct crew-injury state surface underlying `0x0C` First Aid Kit;
4. determine the exact semantics of prop7 vs prop8 and any class-colliding Vehicle prop9 variants;
5. validate the fire/repair mappings on additional client versions and random-battle samples;
6. keep all production consumers fail-closed until version gating and entity/AoI evidence are modeled.
