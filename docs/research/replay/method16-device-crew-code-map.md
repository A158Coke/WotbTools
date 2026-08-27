# Avatar method16 — current device/crew `codeB` map

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas plus one independent T-100 LT replay where applicable.
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

### `codeB=41` — Gunner

Current Blitz shell-shock rules define the Gunner-specific penalty as:

```text
increased gun dispersion
halved aiming speed
halved turret traverse speed
```

Three recorder-local `codeA=10, codeB=41` injury windows have enough Vehicle prop2 turret-relative-yaw telemetry to compare the injury interval with adjacent healthy windows.

Using the maximum absolute turret-yaw rate observed inside each injury interval and the maximum in the immediate pre/post healthy windows:

```text
sample A
injured max yaw rate / healthy max ~= 0.560

sample B
injured max yaw rate / healthy max ~= 0.338

sample C
injured max yaw rate / healthy max ~= 0.121
```

Natural player input means a vehicle does not necessarily command maximum turret traverse throughout the short injury interval; therefore ratios may fall below the configured 0.5 ceiling. The important discriminator is that all three Gunner-candidate injury windows show strong turret-yaw suppression and the state is cleared by `codeA=22` / First Aid.

A negative-control comparison against recorder-local `codeB=40` windows does not show the same consistent turret-yaw suppression pattern.

This role-specific physical behavior, combined with the current Blitz four-role crew model, closes the identity.

Verdict:

> `codeB=41 = Gunner` — **PROVEN current 11.19 behavioral identity**.

### `codeB=40` — Driver

Current Blitz shell-shock rules define the Driver-specific penalty as:

```text
top speed halved
maneuverability reduced
acceleration reduced
```

The current method16 shell-shock (`codeA=10`) code domain is exactly:

```text
39, 40, 41, 43
```

with observed counts:

```text
39 injury events : 3
40 injury events : 9
41 injury events : 5
43 injury events : 7
```

No `codeB=42` shell-shock event is present in the canonical corpus.

The other three observed crew codes are independently physically closed:

```text
39 = Commander
41 = Gunner
43 = Loader
```

Blitz's current combat shell-shock model has exactly four relevant crew roles:

```text
Commander
Driver
Gunner
Loader
```

Therefore `40` is the sole remaining current role.

The longest recorder-local `codeB=40` natural injury window lasts about 27.4 seconds. Type10 movement telemetry during that window is directionally compatible with severe mobility degradation; however player input, terrain, turning and combat positioning prevent movement speed alone from being used as an exact configured 0.5 top-speed measurement.

Importantly, `codeB=40` does not show the role-specific turret-yaw suppression that closes `41=Gunner`.

Verdict:

> `codeB=40 = Driver` — **PROVEN by exhaustive current Blitz role closure, with compatible mobility behavior**.

### `codeB=43` — Loader

`codeA=10, codeB=43` causes a strong persistent reload-speed penalty. `codeA=22, codeB=43` at First Aid Kit / Multi-Purpose Restoration Pack recovery restores the reload state.

Verdict:

> `codeB=43 = Loader` — **PROVEN current corpus**.

## Crew token namespace cross-surface closure

The Type32 nested/recoverable crew-state token family uses the same numeric values as method16 `codeB` for current crew injuries.

At same-vehicle, same-clock shell-shock boundaries:

```text
method16 codeB=39 <-> Type32 token 0x27
method16 codeB=40 <-> Type32 token 0x28
method16 codeB=41 <-> Type32 token 0x29
method16 codeB=43 <-> Type32 token 0x2B
```

Since hexadecimal `0x27/0x28/0x29/0x2B` are decimal `39/40/41/43`, the current crew injury subset demonstrates direct numeric namespace identity across method16 and the nested Type32 recoverable-state surface.

This does **not** mean every Vehicle prop8 element is universally equal to method16 `codeB`; prop8 contains a broader mixed recoverable-state collection and earlier all-element literal decoding remains rejected. The safe conclusion is narrower:

> current **crew shell-shock tokens** use the same component ID namespace as method16 `codeB` — **PROVEN**.

This also explains the First Aid chains previously observed for raw crew-compatible tokens `0x27/0x28/0x29/0x2B`.

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

Current proven Blitz crew mapping is now:

```text
39 Commander  PROVEN
40 Driver     PROVEN
41 Gunner     PROVEN
42 unobserved/reserved/other current slot — UNKNOWN
43 Loader     PROVEN
```

`42` is not materially observed in the canonical corpus and must remain raw/UNKNOWN rather than being assigned a historical role.

## Safe production mapping today

```text
32 -> AMMO_RACK           PROVEN
34 -> TRACK_SIDE_UNKNOWN  PROVEN family
35 -> TRACK_SIDE_UNKNOWN  PROVEN family
37 -> TURRET_ROTATOR      PROVEN version-scoped
39 -> COMMANDER           PROVEN
40 -> DRIVER              PROVEN
41 -> GUNNER              PROVEN
43 -> LOADER              PROVEN

31 -> ENGINE              PARTIAL
33 -> FUEL_TANK           PARTIAL
36 -> GUN                 PARTIAL
38 -> OBSERVATION_DEVICE  PARTIAL
42 -> UNKNOWN             UNKNOWN
```

Consumers must preserve `rawCodeB` for every event and expose exact semantics only for mappings at PROVEN confidence.

## Next closure targets

1. `31` Engine — acceleration/top-speed impairment and Repair Kit restoration;
2. `36` Gun — dispersion/aiming impairment and Repair Kit restoration;
3. `38` Observation Device — spotting/view-range effect or current schema;
4. `33` Fuel Tank — current physical/schema closure without relying on fire probability;
5. exact left/right orientation for `34/35` tracks;
6. determine whether `42` is unused/reserved or appears in larger/current-version corpora.
