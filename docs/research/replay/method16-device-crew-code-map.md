# Avatar method16 — current device/crew `codeB` map

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: consolidate the `codeB` namespace used by Avatar method16 vehicle-damage-info events. Exact names are evidence-graded individually. Historical PC/WoT layouts are not authoritative for Blitz.

## Proven current Blitz anchors

### `codeB=32` — ammo rack

`codeA=4, codeB=32` causes the current vehicle reload-duration configuration (`Avatar method35`) to jump to the persistent damaged state. Clean current samples show the expected approximately `×1.65` reload-duration penalty.

`codeA=19, codeB=32` occurs at Repair Kit / Multi-Purpose Restoration Pack recovery and restores normal reload duration.

Verdict:

> `codeB=32 = ammo rack` — **PROVEN current corpus**.

### `codeB=39` — Commander

Two recorder-local natural injury→heal samples provide a role-specific physical closure:

```text
sample A
injured full reload = 12.821728 s
healed  full reload = 12.257659 s
ratio               = 1.046018

sample B
injured full reload = 11.025887 s
healed  full reload = 10.547556 s
ratio               = 1.045350
```

The slower reload exists during `codeA=10, codeB=39` and disappears at the same vehicle's `codeA=22` heal boundary.

This is the expected signature of a shell-shocked Commander in Blitz: the Commander bonus to the effectiveness of the rest of the crew is lost, causing a small cross-role reload degradation even though the Loader is not directly shell-shocked.

The magnitude is sharply different from direct Loader injury, which produces a much larger reload penalty.

Verdict:

> `codeB=39 = Commander` — **PROVEN current 11.19 behavioral identity**.

### `codeB=43` — Loader

`codeA=10, codeB=43` causes a strong persistent reload-speed penalty. `codeA=22, codeB=43` at First Aid Kit / Multi-Purpose Restoration Pack recovery restores the reload state.

Verdict:

> `codeB=43 = Loader` — **PROVEN current corpus**.

## Track pair

`codeB=34` and `codeB=35` form a symmetric mechanical pair:

- same mechanical damage/severity `codeA` family;
- clear through `codeA=19` at Repair Kit / Multi-Purpose Restoration Pack recovery;
- severe states strongly suppress vehicle movement.

Verdict:

> `codeB=34/35 = two track-side modules` — **PROVEN family-level**.
>
> Exact left/right ordering remains **PARTIAL**.

## Mechanical namespace

Observed mechanical values occupy `31..38`:

```text
31 engine              STRONG PARTIAL
32 ammo rack           PROVEN
33 fuel tank           STRONG PARTIAL
34 track side A        PROVEN family / side PARTIAL
35 track side B        PROVEN family / side PARTIAL
36 gun                 STRONG PARTIAL
37 turret rotator      PROVEN on current natural sample / version-scoped
38 observation device  STRONG PARTIAL
```

The `37` closure is supported by a complete damage→automatic-repair→repair chain plus independent turret-yaw-rate collapse while vehicle translation remains substantial.

## Blitz crew namespace — historical Radioman ordering rejected

Blitz does **not** use a Radioman/Radio Operator as a current combat crew role in the shell-shock model relevant to these replay events. The active gameplay roles are:

```text
Commander
Driver
Gunner
Loader
```

Therefore the historical PC/WoT five-role sequence:

```text
Commander / Driver / Radioman / Gunner / Loader
```

must **not** be transplanted into Blitz 11.19.

In particular:

> `codeB=41 = Radioman` — **REJECTED / SUPERSEDED**.

Current observed crew-code domain is:

```text
39, 40, 41, 43
```

`42` is not materially observed in the canonical corpus. The cleanest current model is therefore:

```text
39 Commander  PROVEN
40 Driver     STRONG PARTIAL
41 Gunner     STRONG PARTIAL
42 unobserved/reserved/other current slot — UNKNOWN
43 Loader     PROVEN
```

This arrangement fits the current four-role Blitz gameplay model and the observed absence of `42`, but `40=Driver` and `41=Gunner` remain below PROVEN until role-specific physical behavior closes them.

## Why `40=Driver` remains PARTIAL

A recorder-local `codeB=40` injury window exists long enough to inspect movement, but natural player input, terrain and turning make observed Type10 speed unsuitable as a clean configured top-speed probe.

The expected Driver injury signature is severe mobility degradation; current evidence is directionally compatible but not yet sufficiently controlled.

Verdict:

> `40 = Driver` — **STRONG PARTIAL**.

## Why `41=Gunner` is now the leading candidate

With Radioman eliminated from the Blitz role model, `41` is the remaining repeatedly sampled crew injury code between proven Commander (`39`) and Loader (`43`).

Current recorder-local `41` injury windows are short and do not contain sufficiently clean sustained turret movement / Type31 aim-circle behavior to close the exact role physically.

Verdict:

> `41 = Gunner` — **STRONG PARTIAL**, not yet PROVEN.

## Safe production mapping today

```text
32 -> AMMO_RACK           PROVEN
34 -> TRACK_SIDE_UNKNOWN  PROVEN family
35 -> TRACK_SIDE_UNKNOWN  PROVEN family
37 -> TURRET_ROTATOR      PROVEN version-scoped
39 -> COMMANDER           PROVEN
43 -> LOADER              PROVEN

31 -> ENGINE              PARTIAL
33 -> FUEL_TANK           PARTIAL
36 -> GUN                 PARTIAL
38 -> OBSERVATION_DEVICE  PARTIAL
40 -> DRIVER              PARTIAL
41 -> GUNNER              PARTIAL
42 -> UNKNOWN             UNKNOWN
```

Consumers must preserve `rawCodeB` for every event and expose exact semantics only for mappings at PROVEN confidence.

## Next closure targets

1. `40` Driver — controlled/clean mobility impairment and heal restoration;
2. `41` Gunner — sustained turret/aim behavior before/after First Aid;
3. `31` Engine — acceleration/top-speed impairment and Repair Kit restoration;
4. `36` Gun — dispersion/aiming impairment and Repair Kit restoration;
5. `38` Observation Device — spotting/view-range effect or current schema;
6. determine whether `42` is unused/reserved or appears in larger/current-version corpora.
