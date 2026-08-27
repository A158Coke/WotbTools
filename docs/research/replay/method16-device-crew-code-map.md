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

### `codeB=33` — Fuel Tank

After independent current-version closure of Engine, Ammo Rack, both Tracks, Gun and Turret Rotator, only `33` and `38` remained unnamed in the complete observed mechanical domain `31..38`. Current Blitz's remaining damageable modules are exactly Fuel Tank and Observation Device.

A recorder-local `codeB=38, codeA=5` critical sample does not start the proven fire family, directly rejecting Fuel Tank for `38`; current Blitz documentation states Fuel Tank critical damage starts a fire, whereas Observation Device critical damage halves view range.

Therefore the remaining pair closes exhaustively:

> `codeB=33 = Fuel Tank` — **PROVEN by exhaustive current mechanical-domain closure**.

Current recorder-local `33` population contains six `codeA=4` onsets and six `codeA=19` clears. No recorder-local `codeA=5` Fuel Tank critical sample exists in this corpus, so direct ignition closure for `33` remains desirable as an additional validation but is no longer required for identity orientation.

Detailed evidence: [`fuel-tank-observation-device-closure.md`](fuel-tank-observation-device-closure.md).

### `codeB=36` — Gun

The canonical corpus contains only one recorder-local `codeB=36` damage→repair window, but it provides a direct current-version physical closure.

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
damage root.field4 / healthy  ~= 0.6750000026
```

Other slow/static targeting scalars remain unchanged. Current Blitz documentation states ordinary Gun damage halves firing accuracy and Repair Kit restores damaged modules.

> `codeB=36 = Gun` — **PROVEN current Blitz 11.19 behavioral identity**.

> `codeA=4 + codeB=36` = **Gun common-damaged/degraded state — PROVEN relationship**.

> `codeA=19 + codeB=36` = **Gun full repair/clear — PROVEN relationship**.

Detailed evidence: [`gun-damage-dispersion-closure.md`](gun-damage-dispersion-closure.md).

### `codeB=37` — Turret Rotator

A complete damage→automatic-repair→repair chain plus independent turret-yaw-rate collapse while vehicle translation remains substantial closes the identity.

> `codeB=37 = Turret Rotator` — **PROVEN version-scoped**.

### `codeB=38` — Observation Device

The canonical corpus contains one recorder-local `codeB=38` critical→clear chain:

```text
128.587601  method16 codeA=5, codeB=38
128.587601  Type32 nested component token 0x26 (= 38)
129.382904  method16 codeA=19, codeB=38
129.382904  MPRP 0x0B activation
```

The raw event stream from the critical boundary to recovery shows:

```text
no Vehicle method1 causeFlag=1 fire damage
no proven Type32 ...04 fire-associated state
no periodic fire-DOT HP-loss sequence
```

Current Blitz documentation states Fuel Tank critical damage starts a fire, while Observation Device critical damage halves view range. Therefore the real `38` critical sample rejects Fuel Tank. Since only Fuel Tank/Observation Device remained in the exhaustive current mechanical domain:

> `codeB=38 = Observation Device` — **PROVEN current 11.19 identity by critical-behavior discriminator + exhaustive-domain closure**.

Detailed evidence: [`fuel-tank-observation-device-closure.md`](fuel-tank-observation-device-closure.md).

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

## Mechanical namespace — current complete identity map

```text
31 engine              PROVEN
32 ammo rack           PROVEN
33 fuel tank           PROVEN
34 track side A        PROVEN family / side PARTIAL
35 track side B        PROVEN family / side PARTIAL
36 gun                 PROVEN
37 turret rotator      PROVEN version-scoped
38 observation device  PROVEN
```

All observed mechanical component identities are now closed for Blitz 11.19; only exact left/right orientation of the 34/35 pair remains unresolved.

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
33 -> FUEL_TANK           PROVEN
34 -> TRACK_SIDE_UNKNOWN  PROVEN family
35 -> TRACK_SIDE_UNKNOWN  PROVEN family
36 -> GUN                 PROVEN
37 -> TURRET_ROTATOR      PROVEN version-scoped
38 -> OBSERVATION_DEVICE  PROVEN
39 -> COMMANDER           PROVEN
40 -> DRIVER              PROVEN
41 -> GUNNER              PROVEN
43 -> LOADER              PROVEN
42 -> UNKNOWN             UNKNOWN
```

Consumers must preserve `rawCodeB` for every event and retain version gating even for PROVEN current identities.

## Next closure targets

1. exact left/right orientation for `34/35` tracks;
2. determine whether `42` is unused/reserved or appears in larger/current-version corpora;
3. calibrate method36 `field6.field1` exact unit/semantic beyond its proven dynamic gun-dispersion role;
4. map remaining Type32/prop8 mechanical token paths;
5. validate the complete component map outside Blitz 11.19 China.
