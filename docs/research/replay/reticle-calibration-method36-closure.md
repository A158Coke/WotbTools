# Reticle Calibration -> Avatar method36 closure

> Source replay: `20260827_2143__CHRD-A158布丁_S16_Kranvagn_1177261227795059536.wotbreplay`
>
> Client: Blitz `11.19.0_china_apple`.
>
> Provenance note: this replay was created as a Gun/barrel-damage test. Reticle Calibration (`Type32 effect 0x3E`) was activated incidentally and supplies a clean activation/end boundary.

## Executive verdict

The Reticle Calibration boundary closes two method36 physical roles:

```text
method36.root.field5
= aiming-time physical scalar
= PROVEN

method36.field6.field1
= dynamic gun dispersion / bloom scalar
= PROVEN physical role
```

Both fields are multiplied by exactly `0.70` while Reticle Calibration is active and return to the exact prior baseline when the active window ends.

This matches the current Blitz mechanic: aiming time `-30%` and gun dispersion `-30%`.

The exact Wargaming private protobuf field symbols and user-facing display formulas remain unknown/partial; that naming boundary does not reduce these physical roles to PARTIAL.

## Type32 lifecycle

```text
1.899870   state1 initialized / available
19.073210  state2 activation/start
45.576481  state3 active duration ended / cooldown transition
```

No second targeting consumable is observed at the same activation boundary.

## method36 activation boundary

Before activation:

```text
root.field3          = 0.39771288904092833
root.field4          = 0.4947624456968486
root.field5          = 2.158029879254315
field6.field1        = 0.9171787581399614
field6.field2        = 5.420180732289945
nested scalar A      = 0.602635203879006
nested scalar B      = 9.591313887750857
```

During Reticle Calibration:

```text
root.field5          = 1.5106208897522997
field6.field1        = 0.6420251197643502
```

Exact ratios:

```text
root.field5 active / baseline   = 0.70
field6.field1 active / baseline = 0.70
```

The other decoded configuration scalars remain unchanged at this boundary.

## Active-window shot behavior

Recorder shots continue to show the normal PRE -> launch -> POST method36 sandwich.

Example:

```text
27.076513 PRE  field6.field1 = 0.5970833623853722
27.076513 POST field6.field1 = 0.6420251197643502
```

Independent evidence now forms the following physical chain:

```text
shot boundary       -> field6.field1 increases
Gun damage          -> field6.field1 ×2
Repair Kit          -> restores prior baseline
Reticle Calibration -> field6.field1 ×0.70
```

This closes the dynamic gun-dispersion/bloom physical role.

## End boundary

At `45.576481`, method36 returns exactly to the pre-consumable values:

```text
root.field5   -> 2.158029879254315
field6.field1 -> 0.9171787581399614
```

## root.field5 identity

```text
baseline -> active -> baseline
2.1580298793 -> 1.5106208898 -> 2.1580298793
```

Verdict:

> `method36.root.field5 = aiming-time physical scalar` — **PROVEN**.

Remaining boundary:

```text
exact private protobuf symbol     UNKNOWN
exact display/UI conversion       UNKNOWN/PARTIAL
```

## field6.field1 identity

Reticle Calibration independently modifies gun dispersion by the exact expected 0.70 factor, while the same replay field already has independent shot-bloom and Gun-damage evidence.

Verdict:

> `method36.field6.field1 = dynamic gun dispersion / bloom scalar` — **PROVEN physical role**.

Remaining boundary:

```text
exact private protobuf symbol     UNKNOWN
exact display/UI unit/formula     UNKNOWN/PARTIAL
```

Do not automatically treat the raw scalar as the user-facing `dispersion at 100m` number.

## Type31 boundary

This replay's Type31 samples do not span the Reticle Calibration activation, so it does not directly close the user-visible marker-size conversion formula. That is a display/calibration boundary, not a blocker to the method36 physical-role identity.

## Current method36 model

```text
root.field1   turret/gun relative yaw                    PROVEN
root.field2   gun pitch                                  PROVEN
root.field3   max horizontal turret/gun angular speed    PROVEN controlled
root.field4   max vertical gun angular speed             PROVEN controlled
root.field5   aiming-time physical scalar                PROVEN
field6.field1 dynamic gun dispersion / bloom scalar      PROVEN physical role
remaining static coefficients                            PARTIAL
```

All identities remain current-version gated.