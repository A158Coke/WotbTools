# Controlled WZ-120 movement / targeting probe — Blitz 11.19 China

> Controlled replay: `20260827_2131__CHRD-A158布丁_Ch18_WZ-120_1168508771640578177.wotbreplay`.
>
> User-declared experiment: movement-dispersion probe. Adrenaline was intentionally activated only at the end and is treated as a separate negative-control window.

## Replay facts

```text
vehicle      Ch18_WZ-120
arena        1168508771640578177
client       11.19.0_china_apple
battle type  training
```

## Controlled phase reconstruction

Type10 hull transform + Type7 prop2 turret-relative yaw reconstruct the phases:

```text
~9–13 s    fully stationary baseline
~14–20 s   forward/back movement only
~21–34 s   sustained hull rotation
~35–51 s   turret-only rotation
~52–58 s   hull + turret movement together
59 s+      stationary again
62.402657  shot 1
65.712090  Adrenaline activation
70.505692  shot 2 while Adrenaline active
```

## Method36 population

```text
2.203987   74-byte initialization/config snapshot
9.205333   74-byte initialization/config snapshot
62.402657  PRE_SHOT 92-byte
62.402657  POST_SHOT 92-byte
70.505692  PRE_SHOT 92-byte
70.505692  POST_SHOT 92-byte
```

No method36 snapshots are emitted during the clean movement/rotation phases from ~14–58 s.

Therefore:

> method36 is not a continuous live movement-dispersion stream. Live movement/aim geometry is carried by high-rate surfaces such as Type10/Type39/Type7 prop2, while method36 carries angle/configuration plus shot-boundary targeting state.

## root.field3 — max horizontal turret/gun angular speed

```text
root.field3 = 0.879154807353631 rad/s
            ~= 50.37 deg/s
```

During the controlled turret-only phase, Type7 prop2 reaches approximately:

```text
~0.859 rad/s
~49.2 deg/s
```

Verdict:

> `method36.root.field3 = max horizontal turret/gun angular speed` — **PROVEN controlled physical role**.

Exact private protobuf member name remains `UNKNOWN`.

## Other method36 scalars in this replay

Stable post-initialization values:

```text
root.field4                 0.49951977690547217
root.field5                 0.7506190969245778
field6.field1 baseline/post 0.9171787581399614
field6.field2               7.883899113468042
field6.3.1.1.1              0.736554104815215
field6.3.1.2.1             11.722716444578055
```

At both shot clocks:

```text
field6.field1 PRE  = 0.8529762465052021
field6.field1 POST = 0.9171787581399614
```

This replay by itself originally did not close the other physical roles. Later controlled probes did, so the current archive-wide status is:

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

The later evidence does not change the historical fact that this WZ-120 replay alone only directly closed `root.field3`; it changes the current canonical interpretation of the fields.

## Adrenaline negative control

Type32 activation:

```text
65.712090  consumable 0x09 Adrenaline state2
```

Comparing method36 before and during the active window:

```text
root.field3                  identical
root.field4                  identical
root.field5                  identical
field6.field2                identical
field6.3.1.1.1               identical
field6.3.1.2.1               identical
field6.field1 PRE/POST pair  identical
```

Verdict:

> Adrenaline does not modify this method36 targeting/config scalar set in the controlled sample. Its observed effect belongs to reload/gun-cycle telemetry.

## Current bounded remainder

```text
exact private protobuf symbols                           UNKNOWN
root.field5 exact display/UI conversion formula          UNKNOWN/PARTIAL
field6.field1 exact display/UI unit/formula              UNKNOWN/PARTIAL
field6.field2 and remaining static coefficients          PARTIAL
cross-version stability                                  UNKNOWN until regression-tested
```

No current method36 high-value physical role listed above remains a candidate or VERY STRONG PARTIAL.