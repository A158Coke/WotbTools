# Controlled WZ-120 movement / targeting probe — Blitz 11.19 China

> Controlled replay: `20260827_2131__CHRD-A158布丁_Ch18_WZ-120_1168508771640578177.wotbreplay`.
>
> User-declared experiment: item 9 movement-dispersion probe. Adrenaline was intentionally activated only at the end and is treated as a separate contamination/negative-control window.

## Replay facts

```text
vehicle      Ch18_WZ-120
arena        1168508771640578177
client       11.19.0_china_apple
battle type  training
```

Recorder vehicle entity is independently recovered from method29 shooter identity.

## Controlled phase reconstruction

Type10 hull transform + Type7 prop2 turret-relative yaw reconstruct the user-performed phases without relying on remembered timestamps.

```text
~9–13 s    fully stationary baseline

~14–20 s   forward/back movement only
            hull translation substantial
            hull yaw ~= 0
            turret-relative yaw ~= 0

~21–34 s   sustained hull rotation
            hull yaw rate about 1.1 rad/s
            turret-relative yaw compensates strongly

~35–51 s   turret-only rotation
            hull speed ~= 0
            hull yaw rate ~= 0
            turret-relative yaw stable magnitude about 0.859 rad/s

~52–58 s   hull + turret movement together

59 s+      stationary again

62.402657  shot 1
65.712090  Adrenaline Type32 0x09 activation
70.505692  shot 2 while Adrenaline active
```

## Method36 population

This replay contains only six Avatar method36 snapshots:

```text
2.203987   74-byte initialization/config snapshot
9.205333   74-byte initialization/config snapshot
62.402657  PRE_SHOT 92-byte
62.402657  POST_SHOT 92-byte
70.505692  PRE_SHOT 92-byte
70.505692  POST_SHOT 92-byte
```

No method36 snapshots are emitted during the clean movement/rotation phases from ~14–58 s.

This is an important negative result:

> method36 is not a continuous live movement-dispersion stream. Its remaining slow scalars behave as configuration/limit coefficients, while live movement/aim geometry is carried by other high-rate surfaces such as Type10/Type39/Type7 prop2.

## root.field3 — maximum turret/gun horizontal rotation speed

Decoded current WZ-120 method36 value:

```text
root.field3 = 0.879154807353631 rad/s
            ~= 50.37 deg/s
```

During the controlled turret-only phase, Type7 prop2 gives a sustained observed relative turret-yaw speed of approximately:

```text
~0.859 rad/s
~49.2 deg/s
```

The current public WZ-120 stat is approximately 51 deg/s turret traverse.

The replay scalar is therefore the only method36 configuration field directly matching the experimentally isolated physical limit and the version-current vehicle stat.

Verdict:

> `method36.root.field3` = **maximum turret/gun horizontal rotation speed — PROVEN physical role for current 11.19 evidence model**.

Exact private protobuf field name remains version scoped.

## Other current WZ-120 method36 scalars

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

This is consistent with the already-closed dynamic gun-dispersion/bloom role of field6.field1.

The current probe does not isolate vertical gun movement, so `root.field4` must not yet be promoted to a max gun-pitch rate solely from historical argument ordering.

## Adrenaline negative control

Type32 identifies activation exactly:

```text
65.712090  consumable 0x09 Adrenaline state2
```

Comparing the method36 pair before activation (62.402657) with the pair during the active window (70.505692):

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

> Adrenaline does **not** modify this method36 targeting/config scalar set in the controlled sample. Its effect belongs to reload/gun-cycle telemetry.

## Next controlled probes enabled by this result

1. vertical-only gun elevation/depression at maximum input — test whether `root.field4` is max gun pitch speed;
2. Reticle Calibration while completely stationary — test which remaining coefficient/aim-time surface changes;
3. repeat movement/hull/turret phases on a second vehicle with very different dispersion coefficients — cross-vehicle regression for the remaining nested scalars;
4. use a client/UI or other replay surface that exposes live aim-circle radius during the same phases, if available, to calibrate the static movement/rotation coefficients.
