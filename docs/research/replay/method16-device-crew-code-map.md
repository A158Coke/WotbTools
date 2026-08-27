# Avatar method16 — current device/crew `codeB` map

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas plus one independent T-100 LT replay where applicable.
>
> Scope: consolidate the `codeB` namespace used by Avatar method16 vehicle-damage-info events. Exact names are evidence-graded individually. Historical PC/WoT layouts are not authoritative for Blitz.

## Proven current Blitz anchors

### `codeB=31` — Engine

A recorder-local natural critical-damage chain closes the identity physically.

```text
202.527 s  method16 codeA=5, codeB=31
205.48..206.68 s translation effectively zero
206.726 s  method16 codeA=18, codeB=31
206.78 s+   translation resumes without Repair Kit
```

This matches the current Blitz Engine critical-damage/self-repair lifecycle.

> `codeB=31 = Engine` — **PROVEN current 11.19 behavioral identity**.

### `codeB=32` — Ammo Rack

`codeA=4, codeB=32` produces the persistent reload-duration penalty visible in Avatar method35; current clean samples show approximately `×1.65`. `codeA=19, codeB=32` at Repair Kit/MPRP restores normal reload duration.

> `codeB=32 = Ammo Rack` — **PROVEN current corpus**.

### `codeB=36` — Gun

The canonical corpus contains only one recorder-local `codeB=36` damage→repair window, but it is unusually clean and provides a direct current-version physical closure.

Observed chain:

```text
161.298065  healthy method36 snapshot
            root.field4   = 0.761172993379767
            field6.field1 = 0.9171787581399614

162.098511  method16 codeA=4, codeB=36
            root.field4   = 0.513791772516256
            field6.field1 = 1.8343575162799228

163.198868  Type32 0x0D Repair Kit state2/state3
163.198868  method16 codeA=19, codeB=36, relatedEntity=0
            root.field4   = 0.761172993379767
            field6.field1 = 0.9171787581399614
```

Exact ratios:

```text
damage field6.field1 / healthy = 2.0000000000
repair field6.field1 / healthy = 1.0000000000

damage root.field4 / healthy  ~= 0.6750000026
repair root.field4 / healthy   = 1.0000000000
```

Other slow/static targeting scalars in the same snapshots remain unchanged across the module boundary:

```text
root.field3
root.field5
field6.field2
field6.field3... nested config values
```

Only recorder gun yaw/pitch vary naturally with player aiming.

Independent current Blitz module documentation states that ordinary Gun damage halves firing accuracy, critical Gun damage disables firing, and Repair Kit immediately restores damaged modules. The exact `×2` degradation of the current method36 dispersion-like state at the method16 onset, followed by exact same-clock restoration at Repair Kit, is therefore a gun-specific physical signature rather than historical numeric-order inference.

The simultaneous `root.field4 ×0.675` change is an additional targeting/gun-handling effect; its exact symbolic field name remains PARTIAL and must not be positional-transplanted from historical schemas.

Verdict:

> `codeB=36 = Gun` — **PROVEN current Blitz 11.19 behavioral identity**.

> `codeA=4 + codeB=36` = **Gun common-damaged/degraded state — PROVEN relationship**.

> `codeA=19 + codeB=36` = **Gun full repair/clear — PROVEN relationship**.

Detailed evidence: [`gun-damage-dispersion-closure.md`](gun-damage-dispersion-closure.md).

### `codeB=37` — Turret Rotator

A complete damage→automatic-repair→repair chain plus independent turret-yaw-rate collapse while vehicle translation remains substantial closes the identity.

> `codeB=37 = Turret Rotator` — **PROVEN version-scoped**.

### `codeB=39` — Commander

Two recorder-local natural injury→heal samples show a small, repeatable cross-role reload degradation while injured, consistent with loss of the Commander bonus.

```text
sample A injured/healed reload ratio = 1.046018
sample B injured/healed reload ratio = 1.045350
```

> `codeB=39 = Commander` — **PROVEN current 11.19 behavioral identity**.

### `codeB=40` — Driver

The current shell-shock domain is exactly `39,40,41,43`; Commander, Gunner and Loader are independently closed, leaving `40` as the sole Driver role. The longest recorder-local injury window is also mobility-compatible and lacks the Gunner-specific turret-yaw suppression.

> `codeB=40 = Driver` — **PROVEN by exhaustive current Blitz role closure with compatible mobility behavior**.

### `codeB=41` — Gunner

Three recorder-local `codeA=10, codeB=41` windows show strong turret-yaw suppression versus adjacent healthy windows:

```text
injured max yaw / healthy max ~= 0.560
injured max yaw / healthy max ~= 0.338
injured max yaw / healthy max ~= 0.121
```

This matches current Gunner shell-shock gun-handling degradation and clears with First Aid/MPRP.

> `codeB=41 = Gunner` — **PROVEN current 11.19 behavioral identity**.

### `codeB=43` — Loader

`codeA=10, codeB=43` produces strong reload degradation; `codeA=22, codeB=43` at First Aid/MPRP restores reload performance.

> `codeB=43 = Loader` — **PROVEN current corpus**.

## Crew token namespace cross-surface closure

Type32 nested/recoverable crew-state tokens use the same numeric component values as method16 `codeB`:

```text
method16 codeB=39 <-> Type32 token 0x27
method16 codeB=40 <-> Type32 token 0x28
method16 codeB=41 <-> Type32 token 0x29
method16 codeB=43 <-> Type32 token 0x2B
```

This proves current crew shell-shock tokens share the method16 component namespace.

Do not generalize this to every prop8 element; prop8 is a broader mixed recoverable-state collection.

## Track pair

`codeB=34` and `codeB=35` form a symmetric mechanical pair with the same damage/repair family and severe movement suppression.

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
36 gun                 PROVEN
37 turret rotator      PROVEN version-scoped
38 observation device  STRONG PARTIAL
```

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
36 -> GUN                 PROVEN
37 -> TURRET_ROTATOR      PROVEN version-scoped
39 -> COMMANDER           PROVEN
40 -> DRIVER              PROVEN
41 -> GUNNER              PROVEN
43 -> LOADER              PROVEN

33 -> FUEL_TANK           PARTIAL
38 -> OBSERVATION_DEVICE  PARTIAL
42 -> UNKNOWN             UNKNOWN
```

Consumers must preserve `rawCodeB` for every event and expose exact semantics only for mappings at PROVEN confidence.

## Next closure targets

1. `38` Observation Device — view-range/spotting effect or current schema;
2. `33` Fuel Tank — current physical/schema closure without relying only on fire probability;
3. exact left/right orientation for `34/35` tracks;
4. determine whether `42` is unused/reserved or appears in larger/current-version corpora;
5. calibrate method36 `field6.field1` exact unit/semantic beyond the now-proven gun-damage relationship.
