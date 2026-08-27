# Method16 codeB=36 — Gun damage / dispersion closure protocol

> Scope: define a falsifiable current-Blitz experiment for closing `Avatar method16 codeB=36` as the Gun component.
>
> Current evidence grade before this experiment: `36 = Gun` — STRONG PARTIAL.

## Why this needs a dedicated closure

The low-30s method16 namespace is strongly mechanical, but exact component names must not be promoted from historical ordering alone.

Current proven anchors are:

```text
31 Engine              PROVEN
32 Ammo Rack           PROVEN
34/35 Track-side pair  PROVEN family
37 Turret Rotator      PROVEN version-scoped
```

Remaining candidates:

```text
33 Fuel Tank           STRONG PARTIAL
36 Gun                 STRONG PARTIAL
38 Observation Device  STRONG PARTIAL
```

`36` should be promoted only if its damage/recovery window produces a gun-specific physical signature distinct from Engine, Track, Turret Rotator, Fuel Tank and Observation Device.

## Available current 11.19 observables

### Type31 — high-rate gun-marker size

Type31 is independently closed as the replay-recorded arcade aiming-circle / gun-marker size scalar.

```text
body      : float32 markerSize
frequency : ~120 Hz median update cadence
```

It expands around firing and subsequently contracts as aim settles.

### Avatar method36 — targeting / aim-state protobuf

Current method36 is independently closed as a targeting-info family.

```text
root.field1 = turret/gun relative yaw  PROVEN
root.field2 = gun pitch                PROVEN
```

All 326 recorder projectile launches in the strict corpus are exactly bracketed by:

```text
method36 PRE_SHOT
-> method29 projectile launch
-> method36 POST_SHOT
```

The nested `field6.field1` changes on 326/326 shot pairs, always with a positive post-shot delta. It is therefore a dynamic post-shot dispersion/bloom-family scalar, but its exact symbolic unit remains PARTIAL.

### Method16 lifecycle

Mechanical lifecycle states are independently closed:

```text
codeA=4  common damaged / degraded operational
codeA=5  critical / disabled
codeA=18 automatic critical self-repair -> degraded operational
codeA=19 fully repaired / cleared
```

A clean `codeB=36` onset->repair window can therefore be bounded precisely.

### Recovery controls

```text
0x0D Repair Kit
0x0B Multi-Purpose Restoration Pack
```

Both clear mechanical negative states. First Aid Kit is a crew-only negative control.

### Natural targeting controls

Current corpus already contains two useful independent perturbations:

```text
method16 codeB=41 Gunner shell-shock
Type32 wireCode 0x3E Reticle Calibration
```

Gunner injury worsens aiming/dispersion and suppresses turret traverse; Reticle Calibration reduces dispersion and aiming time for its active window. These can be used to verify that the Type31/method36 metrics are sensitive to gun-handling changes before applying them to codeB=36.

## Historical architecture cross-check

Historical Wargaming `updateTargetingInfo(...)` exposes nine targeting configuration parameters:

```text
turretYaw
gunPitch
maxTurretRotationSpeed
maxGunRotationSpeed
shotDispMultiplierFactor
gunShotDispersionFactorsTurretRotation
chassisShotDispersionFactorsMovement
chassisShotDispersionFactorsRotation
aimingTime
```

The historical client computes current shot dispersion separately from those static/slow-changing inputs. The dynamic calculation includes a shot-dispersion factor which changes after firing; damaged-gun state is also represented through the shot-dispersion term.

This is structural precedent only. It supports using dynamic dispersion behavior as a Gun-damage discriminator, but historical field names or numeric indices must not be transplanted into Blitz 11.19.

## Correct statistical model

Do **not** compare method36 `field6.field1` and Type31 by raw equality. They are different surfaces with different cadence and possibly different units.

Use event-normalized shot windows.

For each recorder shot at clock `t0`:

```text
M_pre  = Type31 marker size immediately before t0
M_peak = maximum Type31 marker size in [t0, t0 + 250 ms]
M_1s   = marker size near t0 + 1 s
M_2s   = marker size near t0 + 2 s

B_pre  = method36 field6.field1 PRE_SHOT
B_post = method36 field6.field1 POST_SHOT
B_jump = B_post - B_pre
```

Then derive normalized quantities:

```text
marker_bloom_ratio = M_peak / max(M_pre, epsilon)
marker_decay_1s    = (M_peak - M_1s) / max(M_peak - M_pre, epsilon)
marker_decay_2s    = (M_peak - M_2s) / max(M_peak - M_pre, epsilon)
```

The primary comparison is the distribution of these quantities across vehicle-state classes, not absolute cross-surface equality.

## codeB=36 closure experiment

### Step 1 — locate recorder-local damage windows

Select method16 events satisfying:

```text
vehicleId == recorder vehicle
codeB == 36
codeA in {4,5}
```

For each onset, determine the end boundary using the first same-component:

```text
codeA=18  automatic critical self-repair
or
codeA=19  full repair/clear
```

Also record Repair Kit / MPRP activation at the recovery clock when present.

### Step 2 — classify shots by state

For each recorder shot, classify:

```text
HEALTHY_BEFORE
GUN36_DAMAGED
GUN36_CRITICAL
AFTER_AUTO_REPAIR
AFTER_FULL_REPAIR
```

Exclude windows with overlapping Gunner shell-shock (`codeB=41`) or Reticle Calibration unless they are being used intentionally as factorial controls.

### Step 3 — compare targeting signatures

For each state compare:

```text
Type31 pre-shot marker size
Type31 post-shot expansion ratio
Type31 recovery/convergence curve
method36 B_jump
method36 subsequent normal-snapshot decay
shot cadence / ability to fire
```

A Gun identity predicts a persistent aiming/dispersion impairment while the component remains damaged, followed by restoration at the codeA=18/19 recovery boundary.

A mere one-shot disturbance is insufficient; the effect must track the component-state interval.

### Step 4 — repair boundary test

The strongest single replay closure is:

```text
codeB=36 damage onset
-> measurable persistent gun-handling degradation
-> same component recovery / Repair Kit clear
-> immediate return toward the vehicle's adjacent healthy targeting distribution
```

The before/after comparison should use the same recorder and same vehicle whenever possible to avoid tank-to-tank gun-stat confounding.

## Required negative controls

### Gunner injury

`codeB=41` is already PROVEN Gunner. The targeting metrics should detect its known gun-handling degradation.

If the proposed Type31/method36 metrics cannot distinguish Gunner injury from adjacent healthy periods, they are not sensitive enough to prove `codeB=36`.

### Reticle Calibration

`0x3E` is independently PROVEN Reticle Calibration with observed 20.0/26.6 s active windows.

During activation, the same metrics should shift in the beneficial direction: smaller marker state and/or faster convergence, depending on movement/input.

This provides an opposite-sign control to damage/injury.

### Turret Rotator damage

`codeB=37` is PROVEN Turret Rotator. Its strongest physical signature is turret-yaw-rate collapse while translation can remain substantial.

A valid Gun36 closure must not merely rediscover turret-rotation impairment. If the principal change is yaw-rate only, the Gun hypothesis is weakened.

## Promotion rule

Promote:

> `codeB=36 = Gun — PROVEN current Blitz 11.19 behavioral identity`

only if at least one clean recorder-local window closes all of:

1. method16 state interval is unambiguous;
2. targeting/dispersion behavior is materially degraded during the interval;
3. degradation persists beyond a single shot/input transient;
4. the effect restores at automatic/full repair boundary;
5. the signature is not better explained by Gunner injury, turret rotator damage, movement, Reticle Calibration or another overlapping state;
6. raw values and version scope are retained.

Multiple independent windows are preferred. If only directionally compatible samples exist, retain STRONG PARTIAL.

## What this can also calibrate

Even if `36` cannot yet be promoted, the experiment can advance method36 itself.

If `field6.field1` shows:

```text
shot -> positive jump
then monotonic/approximately exponential relaxation
with relaxation rate tracking Type31 convergence / aiming-time perturbations
```

then it can be promoted from generic `post-shot dispersion/bloom family` toward a more specific dynamic dispersion-state interpretation.

Exact units (`angle`, `multiplier`, normalized bloom state) still require either direct current-version schema or parameter-level physical calibration.

## Remaining data requirement

The archive currently contains the necessary decoded surfaces and known control families, but final numeric closure requires event-level joins over the raw canonical corpus. If the existing branch does not retain a reproducible extraction artifact for method36/Type31 shot windows, add one before promoting semantics so the statistics can be independently rerun.
