# Avatar method36 — horizontal/vertical gun rotation-speed closure

> Scope: controlled Blitz 11.19 China replay probes supplied after the canonical 34-arena corpus.
>
> Goal: identify `method36.root.field3` and `method36.root.field4` by direct physical measurement rather than historical ordinal transplant.

## Executive verdict

Current controlled evidence closes:

```text
method36.root.field3
= maximum horizontal turret/gun rotation speed
= PROVEN physical identity

method36.root.field4
= maximum vertical gun pitch/elevation rotation speed
= PROVEN physical identity
```

Both identities are established by replay-measured angular-rate plateaus that match the method36 configuration scalar in the same battle.

## Horizontal rotation — WZ-120 controlled probe

Controlled replay phases included a clean vehicle-stationary / turret-only rotation interval.

Observed Type10/Type39 behavior:

```text
vehicle speed      ~= 0
hull yaw rate      ~= 0
turret-relative yaw stable rate ~= 0.859 rad/s
```

Same-battle method36 configuration:

```text
root.field3 = 0.8791548074 rad/s
            ~= 50.37 deg/s
```

The measured reachable horizontal turret rate is consistent with the configured upper bound after client sampling/control effects.

Verdict:

> `root.field3` = **maximum horizontal turret/gun rotation speed — PROVEN physical role**.

The same replay also showed that movement/hull/turret motion does not cause continuous method36 emissions; method36 behaves as angle/configuration plus shot-boundary targeting state rather than a continuously sampled movement-dispersion stream.

## Vertical rotation — A178_SPHT controlled pitch probe

Controlled replay:

```text
20260827_2154__CHRD-A158布丁_A178_SPHT_1177260957212120593.wotbreplay
```

The player repeatedly drove the gun from depression toward elevation and back while the vehicle remained suitable for a clean gun-pitch-rate measurement.

Type39 field6 is independently proven as vehicle-local gun pitch. Differentiating the 120 Hz-ish Type39 stream gives a stable maximum absolute pitch-rate plateau:

```text
max observed |d(gunPitch)/dt| ~= 0.7613 rad/s
                               ~= 43.62 deg/s
```

Same-battle method36 configuration:

```text
root.field4 = 0.761172993379767 rad/s
            ~= 43.612 deg/s
```

Representative instantaneous derivatives repeatedly reach:

```text
+0.761337 rad/s
-0.761317 rad/s
-0.761305 rad/s
```

The agreement is approximately 0.02% at the observed plateau and occurs in both elevation and depression directions.

This is a direct numeric closure, not a historical schema-order inference.

Verdict:

> `method36.root.field4` = **maximum vertical gun pitch/elevation rotation speed — PROVEN current Blitz 11.19 physical identity**.

## Current method36 scalar map

```text
root.field1  turret/gun relative yaw                         PROVEN
root.field2  gun pitch                                       PROVEN
root.field3  maximum horizontal turret/gun rotation speed    PROVEN
root.field4  maximum vertical gun rotation speed              PROVEN
root.field5  unresolved targeting/config scalar               PARTIAL
field6.1     dynamic gun-dispersion/bloom family              VERY STRONG physical role
field6.2     unresolved targeting/config scalar               PARTIAL
nested A     unresolved targeting/config scalar               PARTIAL
nested B     unresolved targeting/config scalar               PARTIAL
```

## Consequence for historical crosswalk

Historical Wargaming targeting-info APIs contain horizontal turret rotation speed and vertical gun rotation speed parameters. The current controlled probes now independently establish the same two physical roles in the Blitz protobuf.

Historical ordering remains non-authoritative for the still-unresolved fields; each remaining scalar still requires a current-version behavioral or numeric closure.

## Next best probes

High-value controlled experiments for the remaining fields:

1. aiming-time / stationary shrink probe with and without Reticle Calibration;
2. chassis-only forward movement at several stable speeds;
3. chassis-only rotation at stable angular rates;
4. turret-only rotation at multiple controlled rates below maximum;
5. fire -> fully stationary shrink-to-baseline sequence with dense Type31 capture.

These should be used to separate aiming time, movement-dispersion, chassis-rotation dispersion, turret-rotation dispersion and any normalized shot-dispersion multiplier.
