# Method16 codeB=36 — Gun damage / method36 closure

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas plus controlled 11.19 training-room probes.
>
> Final current verdict: `codeB=36 = Gun` — **PROVEN current-version behavioral identity**.

## Executive result

The original corpus contained a recorder-local common-damage -> Repair-Kit-clear chain. A later controlled Progetto 65 replay repeated the same signature across common damage, critical damage, automatic self-repair and full repair.

The method36 response is exact and reversible:

```text
Gun negative state
-> field6.field1 ×2
-> root.field4 ×0.675

full repair
-> both return exactly to baseline
```

This proves the Gun component identity and independently reinforces two method36 physical roles.

## Canonical natural-window closure

Immediately before Gun damage:

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

At `codeA=4, codeB=36` onset:

```text
162.098511
root.field4        = 0.513791772516256
field6.field1      = 1.8343575162799228
```

At repair:

```text
163.198868
root.field4        = 0.761172993379767
field6.field1      = 0.9171787581399614
```

Ratios:

```text
field6.field1 damaged / healthy = 2.0
root.field4 damaged / healthy  ~= 0.675
```

## Controlled Progetto 65 closure

Observed recorder-local method16 timeline includes repeated:

```text
codeA=4  common damaged
codeA=5  critical/disabled
codeA=18 automatic critical self-repair -> degraded operational
codeA=19 full repair/clear
```

Healthy baseline:

```text
root.field4   = 0.666026369
field6.field1 = 0.917178758
```

Gun negative state:

```text
root.field4   = 0.449567801
field6.field1 = 1.834357516
```

Again:

```text
root.field4 ratio   = 0.675
field6.field1 ratio = 2.0
```

Every full-repair boundary restores both values exactly.

## Current method36 interpretation

The method36 physical-role map is now:

```text
root.field1
= turret/gun relative yaw
= PROVEN

root.field2
= gun pitch
= PROVEN

root.field3
= max horizontal turret/gun angular speed
= PROVEN controlled

root.field4
= max vertical gun angular speed
= PROVEN controlled

root.field5
= aiming-time physical scalar
= PROVEN

field6.field1
= dynamic gun dispersion / bloom scalar
= PROVEN physical role
```

### root.field4

The Gun-damage `×0.675` response is a modifier on the already-closed vertical gun angular-speed physical role. A separate controlled Type39 derivative experiment directly proves the base role.

Therefore this document must not describe `root.field4` as an unresolved candidate or generic gun-handling scalar.

### field6.field1

Independent current-version perturbations are:

```text
ordinary shot        -> immediate positive bloom jump
Gun damage           -> ×2
Repair                -> exact baseline restoration
Reticle Calibration  -> ×0.70
Reticle end           -> exact baseline restoration
```

Therefore:

> `field6.field1 = dynamic gun dispersion / bloom scalar` — **PROVEN physical role**.

Exact private Wargaming member name and exact display/UI unit/formula remain unknown/partial.

## Reticle Calibration cross-check

A separate Reticle Calibration boundary shows:

```text
root.field5   ×0.70
field6.field1 ×0.70
```

and exact restoration at effect end. This closes `root.field5` as the aiming-time physical scalar and independently confirms the dispersion/bloom role of `field6.field1`.

## Component lifecycle verdict

```text
codeB=36 = Gun                                    PROVEN
codeA=4 + codeB=36 = Gun common damaged           PROVEN
codeA=5 + codeB=36 = Gun critical/disabled        PROVEN
codeA=18 + codeB=36 = auto-repair to degraded     PROVEN
codeA=19 + codeB=36 = Gun full repair/clear        PROVEN
```

## Remaining bounded targeting boundaries

```text
exact private protobuf symbols                           UNKNOWN
root.field5 exact display/UI conversion formula          UNKNOWN/PARTIAL
field6.field1 exact display/UI unit/formula              UNKNOWN/PARTIAL
field6.field2 and remaining static coefficients          PARTIAL
cross-version stability                                  UNKNOWN until regression-tested
```

Those private/display boundaries must remain separate from the already-proven physical roles.