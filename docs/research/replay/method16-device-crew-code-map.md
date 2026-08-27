# Avatar method16 — current device/crew `codeB` map

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: this note consolidates the `codeB` namespace used by Avatar method16 vehicle-damage-info events. Exact symbolic names are evidence-graded individually; historical Wargaming layouts are used only as structural support after current Blitz anchors are established.

## Proven current Blitz anchors

Two `codeB` values are independently closed by direct physical behavior and the matching recovery consumable.

### `codeB=32` — ammo rack

Damage lifecycle:

```text
(codeA=4, codeB=32)
```

causes the current vehicle reload-duration configuration (`Avatar method35`) to jump to the persistent damaged state. The clean current samples show the expected approximately `×1.65` reload-duration penalty.

Clear lifecycle:

```text
(codeA=19, codeB=32, relatedEntity=0)
```

is observed at Repair Kit / Multi-Purpose Restoration Pack recovery and restores the normal reload duration.

Verdict:

> `codeB=32 = ammoBay / ammo rack` — **PROVEN current corpus**.

### `codeB=43` — Loader

Injury lifecycle:

```text
(codeA=10, codeB=43)
```

causes a strong persistent reload-speed penalty.

Heal lifecycle:

```text
(codeA=22, codeB=43, relatedEntity=0)
```

is observed at First Aid Kit / Multi-Purpose Restoration Pack recovery and restores the reload state.

Verdict:

> `codeB=43 = Loader` — **PROVEN current corpus**.

## Track pair

`codeB=34` and `codeB=35` form a symmetric mechanical pair:

- both use the same damage/severity `codeA` family;
- both clear through `codeA=19` at Repair Kit / Multi-Purpose Restoration Pack recovery;
- severe states strongly suppress vehicle movement;
- the pair is exactly the shape expected for the two track sides.

Verdict:

> `codeB=34/35 = left/right track module family` — **PROVEN family-level**.
>
> Exact `34=left, 35=right` orientation — **PARTIAL** until current Blitz geometry or producer schema closes the side ordering.

## Contiguous namespace structure

The observed mechanical/crew values occupy a compact contiguous range:

```text
31,32,33,34,35,36,37,38,39,40,41,43
```

Observed lifecycle split is highly structured:

```text
mechanical family
  codes 31..38
  damage/severity codeA includes 0/1/4/5/6/7/18
  clear codeA = 19
  cleared by Repair Kit / Multi-Purpose Restoration Pack

crew family
  codes 39..43
  injury codeA = 10
  heal codeA = 22
  healed by First Aid Kit / Multi-Purpose Restoration Pack
```

The independently proven Loader anchor at `43` confirms that the high end is a crew/tankman namespace rather than another device family.

## Historical structural ordering

Independent historical Wargaming replay/device tooling exposes a compact sequence of mechanical devices followed by crew roles. One historical replay parser lists:

```text
VEHICLE_DEVICE_TYPE_NAMES =
  engine, ammoBay, fuelTank, radio, track, gun, turretRotator, surveyingDevice

VEHICLE_TANKMAN_TYPE_NAMES =
  commander, driver, radioman, gunner, loader
```

Current Blitz differs because the track family is represented as two side-specific codes, but the proven anchors align naturally with this contiguous structure:

```text
31 engine              STRONG PARTIAL
32 ammoBay             PROVEN
33 fuelTank            STRONG PARTIAL
34 track side A        PROVEN family / side PARTIAL
35 track side B        PROVEN family / side PARTIAL
36 gun                 STRONG PARTIAL
37 turretRotator       STRONG PARTIAL
38 surveyingDevice     STRONG PARTIAL
39 commander           STRONG PARTIAL
40 driver              STRONG PARTIAL
41 radioman            STRONG PARTIAL
42 gunner               schema candidate; not materially sampled in current corpus
43 loader              PROVEN
```

This table is the best current namespace model, but only values whose current Blitz physical behavior is independently closed may be exposed as exact production semantics.

## Why `41=Driver` is rejected

A temporary candidate based on a few post-injury movement windows assigned `41` to Driver. That inference is **SUPERSEDED**:

- player control creates large movement confounding;
- the contiguous historical crew ordering places Driver earlier and Radioman at the third crew slot;
- current physical samples are insufficient to overturn that better-structured namespace model.

Thus `41=Driver` must not be used.

## Safe production mapping today

```text
32 -> AMMO_RACK           PROVEN
34 -> TRACK_SIDE_UNKNOWN  PROVEN family
35 -> TRACK_SIDE_UNKNOWN  PROVEN family
43 -> LOADER              PROVEN
```

All other current values should retain both:

```text
rawCodeB
semanticCandidate
confidence=PARTIAL
```

until current-version physical or schema closure is obtained.

## Next closure targets

High-value controlled/current-corpus checks:

1. `31` — engine: top-speed/acceleration impairment and Repair Kit restoration;
2. `36` — gun: dispersion/aiming-time impairment and Repair Kit restoration;
3. `37` — turret rotator: turret-yaw-rate impairment and Repair Kit restoration;
4. `40` — driver: mobility impairment and First Aid restoration;
5. `42` — gunner: aiming/turret-control impairment once a current sample exists;
6. `39/41` — commander/radioman separation through a current schema or controlled battle UI effect.
