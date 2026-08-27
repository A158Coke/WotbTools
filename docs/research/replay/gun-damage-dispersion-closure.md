# Method16 codeB=36 — Gun damage / dispersion closure

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas plus controlled 11.19 training-room probes.
>
> Final current verdict: `codeB=36 = Gun` — **PROVEN current-version behavioral identity**.

## Executive result

The original canonical corpus contained one natural recorder-local common-damage→Repair-Kit-clear chain:

```text
162.098511  method16 codeA=4, codeB=36
163.198868  method16 codeA=19, codeB=36, relatedEntity=0
```

That natural window already closed Gun physically because method36 changed exactly and reversibly at the module state boundary.

A later controlled Progetto 65 training-room replay independently repeats the same signature across multiple Gun states, including critical damage, automatic self-repair, full repair and repeated common damage.

Therefore this identity no longer depends on a single natural damage window.

## Canonical natural-window closure

Immediately before the natural damage boundary:

```text
161.298065
root.field3        = 0.35836024475917727
root.field4        = 0.761172993379767
root.field5        = 2.1792167678269005
field6.field1      = 0.9171787581399614
field6.field2      = 6.89841190784587
nested config A    = 0.602635203879006
nested config B    = 9.591313887750857
```

At the exact `codeA=4, codeB=36` onset:

```text
162.098511
root.field3        = 0.35836024475917727
root.field4        = 0.513791772516256
root.field5        = 2.1792167678269005
field6.field1      = 1.8343575162799228
field6.field2      = 6.89841190784587
nested config A    = 0.602635203879006
nested config B    = 9.591313887750857
```

At the exact repair boundary:

```text
163.198868
root.field3        = 0.35836024475917727
root.field4        = 0.761172993379767
root.field5        = 2.1792167678269005
field6.field1      = 0.9171787581399614
field6.field2      = 6.89841190784587
nested config A    = 0.602635203879006
nested config B    = 9.591313887750857
```

Exact ratios:

```text
field6.field1 damaged / healthy = 2.0000000000
root.field4 damaged / healthy  ~= 0.6750000026
```

The naturally changing recorder yaw/pitch fields are omitted above because player aim input changes them continuously and they are not configuration controls.

## Controlled Progetto 65 closure

Controlled replay:

```text
vehicle : It08_Progetto_M40_mod65
version : 11.19.0_china_apple
arenaId : 1177261227795059340
purpose : repeated Gun / barrel damage-state probe
```

Observed recorder-local method16 timeline:

```text
34.811146  codeA=5   codeB=36  Gun critical
39.004589  codeA=18  codeB=36  automatic critical self-repair -> damaged
47.808376  codeA=19  codeB=36  full repair / clear

63.506565  codeA=4   codeB=36  common damaged
64.807091  codeA=5   codeB=36  escalates to critical
69.008949  codeA=18  codeB=36  automatic critical self-repair -> damaged
76.011772  codeA=19  codeB=36  full repair / clear

82.906303  codeA=4   codeB=36  common damaged again
```

The same method36 targeting signature repeats throughout the controlled sequence.

Healthy/full-repair baseline:

```text
root.field4   = 0.666026369
field6.field1 = 0.917178758
```

Gun negative state (`codeA=4`, `5`, or post-`18` degraded state):

```text
root.field4   = 0.449567801
field6.field1 = 1.834357516
```

Exact ratios:

```text
0.449567801 / 0.666026369 = 0.675
1.834357516 / 0.917178758 = 2.0
```

Every full-repair boundary returns both values exactly to baseline.

This is a stronger closure than the original natural sample because it demonstrates the same module-specific physical transform across repeated state transitions and independent attackers.

## codeA lifecycle upgraded by controlled evidence

The Progetto probe independently reinforces the Gun-specific lifecycle:

```text
codeA=4  -> common damaged / degraded operational
codeA=5  -> critical / disabled
codeA=18 -> automatic self-repair from critical to degraded operational
codeA=19 -> full repair / clear
```

In particular, the sequence:

```text
5 -> 18 -> 19
```

appears twice in the controlled probe and reproduces the same method36 state transition each time.

## Repair synchronization

In the original natural window:

```text
163.198868 Type32 wireCode 0x0D state2  // Repair Kit activation
163.198868 Type32 wireCode 0x0D state3
163.198868 method16 codeA=19, codeB=36
163.198868 method36 targeting values return to healthy configuration
```

The controlled Progetto replay also contains full-repair boundaries whose method36 values return exactly to the healthy baseline.

`0x0D` is independently proven as Repair Kit in the current corpus and clears mechanical negative states rather than crew shell shock.

## Current Blitz gameplay cross-check

Current Blitz Gun behavior is consistent with:

```text
common damage  -> strongly degraded firing accuracy / handling
critical damage -> firing disabled
Repair Kit      -> restores damaged modules
```

The replay gives an exact current-version mathematical counterpart:

```text
Gun negative state
-> field6.field1 ×2
-> root.field4 ×0.675

full repair
-> both return exactly to baseline
```

This physical signature is not explained by Engine, Tracks, Fuel Tank, Observation Device or Turret Rotator behavior.

## Reticle Calibration cross-check

A separate controlled Kranvagn Reticle Calibration probe independently shows:

```text
Reticle Calibration active:
root.field5   ×0.70
field6.field1 ×0.70

Reticle Calibration end:
both restore exactly
```

Therefore `field6.field1` is now independently perturbed by three different causes:

```text
ordinary shot      -> instantaneous positive bloom change
Gun damage         -> persistent ×2 degradation
Reticle Calibration -> ×0.70 improvement
```

This substantially upgrades its physical identity beyond the original natural Gun-damage closure.

## Type31 boundary

Type31 is the high-rate replay-recorded arcade gun-marker size stream. The original natural Gun-damage window did not include a useful pre/onset Type31 comparison, so method36 remains the authoritative exact damage-state closure.

Controlled targeting probes should continue to use Type31 for calibration of user-visible reticle size and convergence, but the Gun identity itself no longer depends on obtaining more Type31 samples.

## Distinguishing this from Gunner injury

`codeB=41` is independently PROVEN Gunner shell-shock and is cleared by First Aid/MPRP rather than Repair Kit. It also produces gun-handling degradation, but the lifecycle and recovery path differ.

The `codeB=36` chain is distinct:

```text
component class      mechanical
clear consumable     Repair Kit / MPRP mechanical repair path
method16 lifecycle   4 / 5 / 18 / 19
core signature       field6.field1 ×2 + root.field4 ×0.675
```

Therefore Gun and Gunner are independently distinguishable on both namespace and physical lifecycle.

## Final verdict

> `codeB=36 = Gun` — **PROVEN current Blitz 11.19 behavioral identity**.

> `codeA=4 + codeB=36` = **Gun common-damaged / degraded state — PROVEN**.

> `codeA=5 + codeB=36` = **Gun critical / disabled state — PROVEN**.

> `codeA=18 + codeB=36` = **automatic critical self-repair to degraded operational state — PROVEN current/version**.

> `codeA=19 + codeB=36` = **Gun full repair / clear — PROVEN**.

## Method36 implication

`method36.field6.field1` now has independent controlled perturbations from ordinary firing, Gun damage and Reticle Calibration.

Safe current semantic:

> `field6.field1` = **dynamic gun-dispersion / bloom-state scalar — PROVEN physical role / exact private unit-name still version-scoped**.

`method36.root.field4` is also a Gun-handling scalar because Gun negative state applies an exact persistent `×0.675` transform and repair restores baseline. Its exact private name remains unresolved.

Do not call either field a probability or import a historical flat-argument symbolic name without current-version proof.

## Remaining targeting work

1. identify `root.field4` exact gun-handling role;
2. calibrate `field6.field1` numerical unit against Type31 reticle size/convergence;
3. compare Gunner injury and Gun damage quantitatively where controlled probes allow;
4. recover a version-matched Blitz targeting protobuf definition;
5. preserve raw values and version gates in any product-facing decoder.
