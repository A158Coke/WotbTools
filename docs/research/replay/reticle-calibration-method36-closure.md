# Reticle Calibration -> Avatar method36 closure

> Source replay: `20260827_2143__CHRD-A158布丁_S16_Kranvagn_1177261227795059536.wotbreplay`
>
> Client: Blitz `11.19.0_china_apple`.
>
> Important provenance correction: this replay was created by the user as a **Gun/barrel-damage test**, not as a dedicated Reticle Calibration experiment. Reticle Calibration (`Type32 effect 0x3E`) was nevertheless activated during the run and supplies a clean activation/end boundary. The numerical Reticle evidence below remains valid, but the replay must not be described as a purpose-built reticle controlled probe.

## Executive verdict

This replay supplies a clean incidental Reticle Calibration boundary that closes two method36 physical roles:

```text
method36.root.field5
  = aiming-time scalar / aiming time physical role
  = PROVEN current behavioral relationship

method36.field6.field1
  = dynamic gun-dispersion / bloom scalar
  = PROVEN current behavioral relationship
```

Both fields are multiplied by exactly `0.70` while Reticle Calibration is active and return to the exact prior baseline when the active window ends.

This matches the current Blitz Reticle Calibration mechanic: aiming time `-30%` and gun dispersion `-30%`.

Because Reticle activation was incidental to the user's actual Gun/barrel test, this note claims the exact observed causal boundary, not that all other battle variables were purpose-designed as reticle controls.

## Type32 lifecycle

The replay contains the complete `0x3E` lifecycle:

```text
1.899870   state1 initialized / available
19.073210  state2 activation/start
45.576481  state3 active duration ended / cooldown transition
```

No second targeting consumable is observed at the same activation boundary.

## method36 activation boundary

Immediately before activation, the stable method36 configuration is:

```text
root.field3          = 0.39771288904092833
root.field4          = 0.4947624456968486
root.field5          = 2.158029879254315
field6.field1        = 0.9171787581399614
field6.field2        = 5.420180732289945
nested scalar A      = 0.602635203879006
nested scalar B      = 9.591313887750857
```

At `19.073210`, Reticle Calibration state2 is emitted and method36 changes to:

```text
root.field5          = 1.5106208897522997
field6.field1        = 0.6420251197643502
```

Exact ratios:

```text
1.5106208897522997 / 2.158029879254315
= 0.7000000000000000

0.6420251197643502 / 0.9171787581399614
= 0.7000000000000000
```

The other decoded configuration scalars remain unchanged at this boundary.

## Active-window shot behavior

Recorder shots during the active window continue to show the ordinary PRE -> launch -> POST method36 sandwich.

For example:

```text
27.076513 PRE  field6.field1 = 0.5970833623853722
27.076513 POST field6.field1 = 0.6420251197643502
```

The same pattern repeats at later shots: field6.field1 remains dynamic across shot boundaries, while its active-window reference scale is Reticle-calibrated.

Existing independent evidence now forms the following physical chain:

```text
shot boundary       -> field6.field1 increases
Gun common damage   -> field6.field1 exactly x2
Repair Kit          -> restores prior baseline
Reticle Calibration -> field6.field1 exactly x0.70
```

That combination closes the gun-dispersion/bloom physical role independently of historical ordinal naming.

## End boundary

At `45.576481`, Type32 emits Reticle Calibration state3 and method36 returns exactly to the pre-consumable values:

```text
root.field5   -> 2.158029879254315
field6.field1 -> 0.9171787581399614
```

The exact reversible `baseline -> 0.70x -> baseline` transition is the core evidence used here.

## root.field5 identity

`root.field5` is stable through ordinary shot boundaries and changes exactly by the Reticle Calibration aiming-time multiplier:

```text
baseline -> active -> baseline
2.1580298793 -> 1.5106208898 -> 2.1580298793
```

Verdict:

> `method36.root.field5` = **aiming-time scalar / aiming time physical role — PROVEN current behavioral relationship**.

The archive retains the raw double and does not claim an exact UI-display formula until equipment/provision/crew modifier composition is separately reconstructed.

## field6.field1 identity

Reticle Calibration independently targets gun dispersion, and this field is multiplied by the exact same 0.70 factor while preserving its already-proven shot-bloom and Gun-damage responses.

Verdict:

> `method36.field6.field1` = **dynamic gun-dispersion / bloom scalar — PROVEN physical role**.

Exact display unit remains version/configuration scoped; it must not automatically be treated as the user-facing `dispersion at 100m` number.

## Type31 boundary

This replay contains Type31 aiming-marker samples only around `13.646..14.046s`, before the Reticle Calibration activation at `19.073s`.

Therefore it does **not** provide a direct same-session Type31 before/after Reticle visual-scale ratio. A future dedicated reticle replay that keeps Type31 actively streaming across activation would provide an independent marker-size check.

## Gun/barrel-test boundary

The user's declared purpose for this replay was Gun/barrel damage testing. The recorder fires four shots at:

```text
27.076513
36.872292
41.274452
45.275887
```

However, the recorder Avatar stream contains no method16 `codeB=36` state event in this replay. Therefore this file does not by itself prove that the recorder's own Gun entered a damaged/critical state.

The absence of ordinary Avatar method38 hit-result feedback for these four shots is retained as a separate research observation and must not be conflated with the Reticle closure above.

## Current method36 model

```text
root.field1   turret/gun relative yaw                    PROVEN
root.field2   gun pitch                                  PROVEN
root.field3   horizontal turret/gun rotation-speed limit PROVEN physical role
root.field4   vertical gun-rotation-speed candidate      PARTIAL
root.field5   aiming-time scalar                         PROVEN physical role
field6.field1 dynamic gun-dispersion/bloom scalar         PROVEN physical role
remaining configuration scalars                         PARTIAL exact names
```

All identities remain current-version gated.