# Avatar method16 — current device/crew `codeB` map

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas plus one independent T-100 LT replay where applicable.
>
> Scope: consolidate the `codeB` namespace used by Avatar method16 vehicle-damage-info events. Exact names are evidence-graded individually. Historical PC/WoT layouts are not authoritative for Blitz.

## Proven current Blitz anchors

### `codeB=31` — Engine

A recorder-local natural critical-damage chain closes the identity physically.

Current sequence:

```text
202.527 s  method16 codeA=5, codeB=31
           Type32 nested token 0x1F (= decimal 31)

205.48 .. 206.68 s
           Type10 translation is effectively zero

206.726 s  method16 codeA=18, codeB=31
           Type32 nested transition on token 0x1F

206.78 s+  vehicle translation resumes immediately
```

This matches the current Blitz module mechanic:

```text
Engine common damage   -> engine power halved
Engine critical damage -> movement/traverse impossible
critical module         -> self-repairs after time into common-damaged state
```

The temporary immobilization followed by an automatic non-consumable recovery transition distinguishes this from ammo rack, gun, turret rotator, observation device and fuel tank behavior. Track-side IDs are independently closed at 34/35.

Verdict:

> `codeB=31 = Engine` — **PROVEN current 11.19 behavioral identity**.

The same event also strongly closes mechanical `codeA=18` as the **critical self-repair / restored-to-common-damaged transition** for the current device family. The exact symbolic enum name remains version-gated.

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

Verdict:

> `codeB=39 = Commander` — **PROVEN current 11.19 behavioral identity**.

### `codeB=41` — Gunner

Current Blitz shell-shock rules define the Gunner-specific penalty as increased dispersion plus halved aiming/turret-traverse performance.

Three recorder-local `codeA=10, codeB=41` injury windows have enough Vehicle prop2 turret-relative-yaw telemetry to compare injury against adjacent healthy windows.

```text
sample A injured max yaw / healthy max ~= 0.560
sample B injured max yaw / healthy max ~= 0.338
sample C injured max yaw / healthy max ~= 0.121
```

Natural player input means the commanded yaw is not necessarily saturated throughout a short injury interval, so ratios can fall below the configured ceiling. The important discriminator is consistent strong turret-yaw suppression and First Aid restoration; recorder-local `codeB=40` negative controls do not show the same pattern.

Verdict:

> `codeB=41 = Gunner` — **PROVEN current 11.19 behavioral identity**.

### `codeB=40` — Driver

Current Blitz shell-shock role domain has four gameplay roles:

```text
Commander / Driver / Gunner / Loader
```

The current method16 shell-shock (`codeA=10`) domain is exactly:

```text
39, 40, 41, 43
```

with no `42` shell-shock event in the canonical corpus. The other three are independently closed as Commander, Gunner and Loader; therefore `40` is the sole remaining current role.

The longest recorder-local `40` injury window lasts about 27.4 seconds and Type10 movement is directionally compatible with severe mobility degradation, while turret-yaw behavior does not show the Gunner-specific suppression.

Verdict:

> `codeB=40 = Driver` — **PROVEN by exhaustive current Blitz role closure with compatible mobility behavior**.

### `codeB=43` — Loader

`codeA=10, codeB=43` causes a strong persistent reload-speed penalty. `codeA=22, codeB=43` at First Aid Kit / Multi-Purpose Restoration Pack recovery restores the reload state.

Verdict:

> `codeB=43 = Loader` — **PROVEN current corpus**.

## Crew token namespace cross-surface closure

The Type32 nested/recoverable crew-state token family uses the same numeric values as method16 `codeB` for current crew injuries:

```text
method16 codeB=39 <-> Type32 token 0x27
method16 codeB=40 <-> Type32 token 0x28
method16 codeB=41 <-> Type32 token 0x29
method16 codeB=43 <-> Type32 token 0x2B
```

This proves current crew shell-shock tokens share the method16 component ID namespace.

Do not generalize this to every prop8 element; prop8 is a broader mixed recoverable-state collection.

## Track pair

`codeB=34` and `codeB=35` form a symmetric mechanical pair with the same damage/repair family and severe movement suppression.

Verdict:

> `codeB=34/35 = two track-side modules` — **PROVEN family-level**.
>
> Exact left/right ordering remains **PARTIAL**.

## Mechanical namespace

Current state:

```text
31 engine              PROVEN
32 ammo rack           PROVEN
33 fuel tank           STRONG PARTIAL
34 track side A        PROVEN family / side PARTIAL
35 track side B        PROVEN family / side PARTIAL
36 gun                 STRONG PARTIAL
37 turret rotator      PROVEN version-scoped
38 observation device  STRONG PARTIAL
```

The `37` closure is supported by a complete damage→automatic-repair→repair chain plus independent turret-yaw-rate collapse while vehicle translation remains substantial.

## Blitz crew namespace

Historical PC/WoT Radioman ordering is rejected for current Blitz shell-shock semantics.

```text
39 Commander  PROVEN
40 Driver     PROVEN
41 Gunner     PROVEN
42 unobserved/reserved/other — UNKNOWN
43 Loader     PROVEN
```

## Safe production mapping today

```text
31 -> ENGINE              PROVEN
32 -> AMMO_RACK           PROVEN
34 -> TRACK_SIDE_UNKNOWN  PROVEN family
35 -> TRACK_SIDE_UNKNOWN  PROVEN family
37 -> TURRET_ROTATOR      PROVEN version-scoped
39 -> COMMANDER           PROVEN
40 -> DRIVER              PROVEN
41 -> GUNNER              PROVEN
43 -> LOADER              PROVEN

33 -> FUEL_TANK           PARTIAL
36 -> GUN                 PARTIAL
38 -> OBSERVATION_DEVICE  PARTIAL
42 -> UNKNOWN             UNKNOWN
```

Consumers must preserve `rawCodeB` for every event and expose exact semantics only for mappings at PROVEN confidence.

## Next closure targets

1. `36` Gun — dispersion/aiming impairment and Repair Kit restoration;
2. `38` Observation Device — view-range/spotting effect or current schema;
3. `33` Fuel Tank — current physical/schema closure without relying only on fire probability;
4. exact left/right orientation for `34/35` tracks;
5. determine whether `42` is unused/reserved or appears in larger/current-version corpora.
