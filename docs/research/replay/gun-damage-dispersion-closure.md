# Method16 codeB=36 — Gun damage / dispersion closure

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Final current verdict: `codeB=36 = Gun` — **PROVEN current-version behavioral identity**.

## Executive result

The strict 34-arena corpus contains only two `codeB=36` events total, both on the recorder vehicle and both in the same battle. They form one complete common-damage→Repair-Kit-clear chain:

```text
162.098511  method16 codeA=4, codeB=36
163.198868  method16 codeA=19, codeB=36, relatedEntity=0
```

Window duration:

```text
1.100357 s
```

Although sample count is only one natural damage window, the targeting-state change is exact, same-clock, reversible and gun-specific.

## Same-clock method36 closure

Immediately before the damage boundary:

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

The naturally changing recorder yaw/pitch fields are omitted above because player aim input changes them continuously and they are not configuration controls.

## Exact effect ratios

The damage boundary changes two targeting scalars and leaves the remaining slow/static targeting scalars unchanged:

```text
field6.field1:
  damaged / healthy = 2.0000000000
  repaired / healthy = 1.0000000000

root.field4:
  damaged / healthy ~= 0.6750000026
  repaired / healthy = 1.0000000000
```

Thus the same component-state boundary causes:

```text
one dispersion-like scalar -> exact ×2 degradation
one gun-handling scalar     -> exact ×0.675 degradation
```

and both revert exactly at repair.

## Repair-Kit synchronization

At the exact clear clock:

```text
163.198868 Type32 wireCode 0x0D state2  // Repair Kit activation
163.198868 Type32 wireCode 0x0D state3  // instant action / cooldown transition
163.198868 method16 codeA=19, codeB=36
163.198868 method36 targeting values return to healthy configuration
```

`0x0D` is independently proven as Repair Kit in the current corpus and clears mechanical negative states, not crew shell-shock or fire.

This proves the `codeB=36` state is a mechanical module state and that the targeting degradation is removed by module repair.

## Current Blitz gameplay cross-check

Current Blitz support documentation describes Gun module behavior as:

```text
common damage  -> firing accuracy halved
critical damage -> firing impossible
Repair Kit      -> immediately restores damaged modules
```

The replay gives an exact current-version counterpart:

```text
method16 Gun-candidate common damage
-> dispersion-like targeting scalar doubles
-> Repair Kit
-> scalar returns exactly to baseline
```

This is the expected mathematical signature of halved firing accuracy / strongly worsened gun dispersion and is not explained by Engine, Tracks, Fuel Tank, Observation Device or Turret Rotator behavior.

The simultaneous `root.field4 ×0.675` change further supports a gun-handling configuration effect. Its exact symbolic field name remains PARTIAL; historical positional argument order is not enough to name it safely.

## Type31 boundary

Type31 is the high-rate replay-recorded arcade gun-marker size stream, but in this particular battle the local Type31 segment begins only after the Repair-Kit boundary (~0.142 s later). Therefore Type31 cannot provide an independent pre-damage marker-size comparison for this one natural window.

This does not weaken the method36 closure because method36 itself supplies exact before/onset/repair targeting snapshots at the relevant boundaries.

Type31 remains useful for calibrating the exact unit/meaning of method36 `field6.field1` across ordinary shots and other perturbation windows.

## Distinguishing this from Gunner injury

`codeB=41` is independently PROVEN Gunner shell-shock and is cleared by First Aid/MPRP rather than Repair Kit. It also produces strong turret-yaw/aiming degradation.

The `codeB=36` chain is different in all important respects:

```text
component class      mechanical
clear consumable     Repair Kit
method16 lifecycle   codeA=4 -> codeA=19
core signature       exact dispersion-like ×2 -> baseline
```

Therefore the observed effect cannot be a crew-role alias.

## Final verdict

> `codeB=36 = Gun` — **PROVEN current Blitz 11.19 behavioral identity**.

> `codeA=4 + codeB=36` = **Gun common-damaged / degraded state — PROVEN relationship**.

> `codeA=19 + codeB=36` = **Gun full repair / clear — PROVEN relationship**.

## Method36 implication

This natural experiment also upgrades the interpretation of `method36.field6.field1`.

It is now independently known to respond to both:

```text
ordinary shot boundary -> positive post-shot change in every sampled recorder shot pair
Gun module damage      -> exact persistent ×2 state
Gun module repair      -> exact restoration to baseline
```

Safe current semantic:

> `field6.field1` = **dynamic gun-dispersion / bloom-state scalar — PROVEN family-level physical role / PARTIAL exact symbolic unit**.

Do not yet call it a literal dispersion angle, probability, or historical `shotDispMultiplierFactor`; exact unit/name still requires calibration or a version-matched Blitz schema.

## Remaining targeting work

1. calibrate `field6.field1` against Type31 convergence curves and Reticle Calibration;
2. identify `root.field4` exact gun-handling role;
3. compare Gunner injury and Gun damage mathematically to separate crew and module modifiers;
4. validate `codeB=36` on additional 11.19+ replays because current canonical corpus contains only one damage window;
5. preserve raw values and version gates in any product-facing decoder.
