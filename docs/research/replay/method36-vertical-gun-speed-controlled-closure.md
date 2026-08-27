# Method36 root.field4 — controlled vertical gun-speed closure

> Controlled replay: `uptown.wotbreplay`, Blitz `11.19.0_apple`, recorder vehicle `Maus`.
>
> Purpose: controlled gun-pitch probe. The proof comes from the recorder Type39 gun-pitch stream itself.

## Verdict

```text
method36.root.field4
= max vertical gun angular speed
= PROVEN controlled
```

The exact private Wargaming protobuf field name remains `UNKNOWN`; the physical role and physical unit are closed for current Blitz 11.19.

## Method36 value

The initialization/configuration snapshot decodes:

```text
root.field3 = 0.2473812228484243
root.field4 = 0.49951977690547217
root.field5 = 2.1792167678269005
```

`root.field4` predicts:

```text
0.49951977690547217 rad/s
≈ 28.6204 deg/s
```

## Independent Type39 measurement

Type39 `f6` is independently closed as local gun pitch. Differentiate over replay raw-clock time:

```text
pitchRate = Δ(Type39.f6) / Δt
```

Representative saturated-rate segments:

```text
18.310070–18.335108 s   +0.4995215408 rad/s
30.907492–30.940794 s   -0.4995260286 rad/s
40.328415–40.478512 s   -0.4995200985 rad/s
```

The longest clean segment differs from `method36.root.field4` by only:

```text
~0.0000003216 rad/s
~0.000064 %
```

Therefore:

> `root.field4 = max vertical gun angular speed` — **PROVEN controlled current physical role**.

## Relationship to the rest of method36

Current physical-role map:

```text
root.field1   turret/gun relative yaw                    PROVEN
root.field2   gun pitch                                  PROVEN
root.field3   max horizontal turret/gun angular speed    PROVEN controlled
root.field4   max vertical gun angular speed             PROVEN controlled
root.field5   aiming-time physical scalar                PROVEN
field6.field1 dynamic gun dispersion / bloom scalar      PROVEN physical role
```

Gun damage applies an exact persistent multiplier to `root.field4`, but that damage response does not make the base physical identity uncertain; the base role is already closed by direct Type39 derivative measurement.

## Private-symbol boundary

```text
root.field4 physical role              PROVEN controlled
root.field4 physical unit              rad/s
exact Wargaming protobuf member name   UNKNOWN
```

Unknown private naming must not be represented as `root.field4 = PARTIAL`.

## Remaining bounded method36 work

```text
field6.field2 exact role/private symbol                 PARTIAL
remaining deepest static coefficients                  PARTIAL
root.field5 exact display/UI conversion formula         UNKNOWN/PARTIAL
field6.field1 exact display/UI unit/formula             UNKNOWN/PARTIAL
exact private protobuf symbols                          UNKNOWN
cross-version stability                                 UNKNOWN until regression-tested
```

No further vertical-speed experiment is required for the current 11.19 physical-role closure.