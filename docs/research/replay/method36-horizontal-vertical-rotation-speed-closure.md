# Avatar method36 — horizontal/vertical gun rotation-speed closure

> Scope: controlled Blitz 11.19 China replay probes supplied after the canonical 34-arena corpus.
>
> Goal: identify `method36.root.field3` and `method36.root.field4` by direct physical measurement rather than historical ordinal transplant.

## Executive verdict

Current controlled evidence closes:

```text
method36.root.field3
= max horizontal turret/gun angular speed
= PROVEN controlled

method36.root.field4
= max vertical gun angular speed
= PROVEN controlled
```

Both physical roles are established by replay-measured angular-rate plateaus that match the method36 configuration scalars in the same battles.

## Horizontal rotation — WZ-120 controlled probe

Controlled replay phases included a clean vehicle-stationary / turret-only rotation interval.

Observed live behavior:

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

> `root.field3 = max horizontal turret/gun angular speed` — **PROVEN controlled**.

## Vertical rotation — controlled pitch probe

A dedicated controlled replay repeatedly drove the gun through saturated elevation/depression motion while Type39 `f6` supplied the independently closed local gun-pitch stream.

Representative closure:

```text
method36.root.field4 = 0.49951977690547217 rad/s
observed Type39 pitch slopes ~= +0.499521541 / -0.499526029 / -0.499520098 rad/s
```

The longest clean segment differs from the method36 scalar by roughly `0.000064%`.

Verdict:

> `root.field4 = max vertical gun angular speed` — **PROVEN controlled**.

## Current method36 physical-role map

```text
root.field1   turret/gun relative yaw                    PROVEN
root.field2   gun pitch                                  PROVEN
root.field3   max horizontal turret/gun angular speed    PROVEN controlled
root.field4   max vertical gun angular speed             PROVEN controlled
root.field5   aiming-time physical scalar                PROVEN
field6.field1 dynamic gun dispersion / bloom scalar      PROVEN physical role
```

Remaining method36 static coefficients may remain `PARTIAL` until their exact physical role is isolated.

## Important semantic boundary

The archive distinguishes two different questions:

```text
physical role of root.field3/root.field4  -> PROVEN controlled
exact Wargaming private protobuf symbol   -> UNKNOWN
```

The same distinction applies to already-closed `root.field5` and `field6.field1`: unknown private naming does not reduce the proven physical role to PARTIAL.

## Historical crosswalk

Historical Wargaming targeting-info APIs contain horizontal turret rotation speed and vertical gun rotation speed parameters. That is compatible with the current result but is only architecture cross-check. Current field identities come from current-version physical measurements.

## Remaining bounded work

```text
exact private protobuf symbols                           UNKNOWN
exact display/UI formulas for aiming/bloom scalars       UNKNOWN/PARTIAL
field6.field2 and deepest static coefficients             PARTIAL
cross-version schema/numeric stability                    UNKNOWN until regression-tested
```

No further horizontal/vertical rotation experiment is required for the current 11.19 physical-role closure.