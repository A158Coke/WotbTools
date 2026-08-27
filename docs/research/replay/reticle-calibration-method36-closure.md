# Reticle Calibration -> Avatar method36 controlled closure

> Controlled replay: `20260827_2143__CHRD-A158布丁_S16_Kranvagn_1177261227795059536.wotbreplay`
>
> Client: Blitz `11.19.0_china_apple`.
>
> Purpose: isolate Reticle Calibration (`Type32 effect 0x3E`) against Avatar method36 targeting scalars.

## Executive verdict

The controlled replay closes two method36 physical roles at the Reticle Calibration activation boundary:

```text
method36.root.field5
  = aiming-time scalar / aiming time physical role
  = PROVEN current controlled behavior

method36.field6.field1
  = dynamic gun-dispersion / bloom scalar
  = PROVEN current controlled behavior
```

Both fields are multiplied by exactly `0.70` while Reticle Calibration is active and return to the exact prior baseline when the active window ends.

This matches the current Blitz Reticle Calibration mechanic: aiming time `-30%` and gun dispersion `-30%`.

## Type32 lifecycle

The replay contains the complete `0x3E` lifecycle:

```text
1.899870   state1 initialized / available
19.073210  state2 activation/start
45.576481  state3 active duration ended / cooldown transition
```

No other targeting consumable is activated in the same controlled interval.

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

The other decoded configuration scalars remain unchanged.

## Active-window shot behavior

Recorder shots during the active window continue to show the ordinary PRE -> launch -> POST method36 sandwich.

For example:

```text
27.076513 PRE  field6.field1 = 0.5970833623853722
27.076513 POST field6.field1 = 0.6420251197643502
```

The same pattern repeats at later shots: field6.field1 is dynamic across the shot boundary, but its active-window reference scale remains Reticle-calibrated.

This independently strengthens the previous physical interpretation:

```text
field6.field1
  is not a static configuration-only coefficient;
  it is a dynamic gun-dispersion / bloom family scalar.
```

Existing independent evidence already shows:

```text
shot boundary      -> field6.field1 increases
Gun common damage  -> field6.field1 exactly x2
Repair Kit         -> restores prior baseline
Reticle Calibration-> field6.field1 exactly x0.70
```

That combination closes the physical role much more strongly than historical ordinal matching.

## End boundary

At `45.576481`, Type32 emits Reticle Calibration state3 and method36 returns exactly to the pre-consumable values:

```text
root.field5   -> 2.158029879254315
field6.field1 -> 0.9171787581399614
```

Therefore the effect is reversible and tied to the exact consumable lifecycle rather than unrelated battle progression.

## root.field5 identity

`root.field5` is stable during ordinary aiming/shooting and changes exactly by the Reticle Calibration aiming-time multiplier:

```text
baseline -> active -> baseline
2.1580298793 -> 1.5106208898 -> 2.1580298793
```

The current Kranvagn public tank data reports an aiming-time value in the same approximate numerical family, while loadout/configuration modifiers can account for an exact replay value differing from the unmodified public headline number.

Verdict:

> `method36.root.field5` = **aiming-time scalar / aiming time physical role — PROVEN current controlled behavior**.

The archive should retain the raw double and avoid claiming an exact UI-display formula until equipment/provision/crew modifier composition is separately reconstructed.

## field6.field1 identity

Reticle Calibration independently targets gun dispersion, and this field is multiplied by the exact same 0.70 factor while preserving its known shot-bloom and Gun-damage responses.

Verdict:

> `method36.field6.field1` = **dynamic gun-dispersion / bloom scalar — PROVEN physical role**.

Exact display unit remains version/configuration scoped; it should not be assumed to be the user-facing `dispersion at 100m` number itself.

## Type31 boundary

This replay contains Type31 aiming-marker samples only around `13.646..14.046s`, before the Reticle Calibration activation at `19.073s`.

Therefore it does **not** provide a direct same-session Type31 before/after Reticle visual-scale ratio. The method36 closure is authoritative for this experiment; a future controlled replay that keeps Type31 actively streaming across the `0x3E` activation boundary can independently test the marker-size representation.

## Production/research consequence

Current safe method36 model is strengthened to:

```text
root.field1   turret/gun relative yaw                    PROVEN
root.field2   gun pitch                                  PROVEN
root.field3   horizontal turret/gun rotation-speed limit PROVEN physical role
root.field4   vertical gun-rotation-speed candidate      PARTIAL
root.field5   aiming-time scalar                         PROVEN physical role
field6.field1 dynamic gun-dispersion/bloom scalar         PROVEN physical role
remaining configuration scalars                         PARTIAL exact names
```

This result is current-version controlled evidence and should remain version gated.