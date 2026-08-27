# Method16 codeB=33 / 38 — Fuel Tank and Observation Device closure

> Base corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Additional controlled replay: Maus module probe recorded on `11.19.0_china_apple`.

## Final verdict

```text
codeB=33 = Fuel Tank           PROVEN direct controlled ignition closure
codeB=38 = Observation Device  PROVEN direct controlled positive sample
```

These identities were already proven from exhaustive current mechanical-domain closure plus a critical-behavior discriminator. The Maus controlled replay now supplies direct positive samples for both remaining module identities.

## Current mechanical component map

```text
31 Engine              PROVEN
32 Ammo Rack           PROVEN
33 Fuel Tank           PROVEN
34 Right Track         PROVEN
35 Left Track          PROVEN
36 Gun                 PROVEN
37 Turret Rotator      PROVEN version-scoped
38 Observation Device  PROVEN
```

## Controlled Observation Device sample

The replay was deliberately used to test the observation-device hit region.

Observed lifecycle:

```text
38.441s
method16 codeA=5, codeB=38
Type32 short token includes 0x26 (=38)

44.844s
method16 codeA=18, codeB=38
```

Independent lifecycle semantics are already proven as:

```text
codeA=5  -> critical / disabled device state
codeA=18 -> automatic recovery to damaged/degraded operational state
```

Therefore this controlled positive sample directly validates:

> `codeB=38 = Observation Device` — **PROVEN current 11.19**.

This replaces the earlier situation where `38` was identified primarily by exhaustive-domain elimination plus the absence of Fuel-Tank-style ignition at a critical boundary.

## Controlled Fuel Tank ignition sample

The same Maus replay deliberately tests the fuel-tank region.

Observed sequence:

```text
62.243s
method16 codeA=4, codeB=33
Type32 short state on token 33
=> common damaged/degraded Fuel Tank

65.342s
method16 codeA=8, codeB=33
Type32 short state `9c04`

65.843s
Vehicle method1 causeFlag=1
=> fire damage tick

66.343s
Vehicle method1 causeFlag=1
=> second fire damage tick
```

The codeA=8 transition immediately precedes the periodic fire-DOT sequence.

This provides the previously missing direct physical closure:

> `codeB=33 = Fuel Tank` — **PROVEN direct controlled ignition behavior**.

It also establishes a new state/action relationship:

```text
codeA=8 when codeB=33
-> Fuel Tank ignition / fire-start transition family
```

The exact private enum symbol is still unknown. Do not generalize `codeA=8` to every module until another component emits the same code under controlled conditions.

## Repair boundary in the controlled replay

At `66.643s`, the replay emits full repair/clear events for both components:

```text
method16 codeA=19, codeB=33
method16 codeA=19, codeB=38
```

This is consistent with the independently proven `codeA=19 = fully repaired / cleared device state` family and provides a useful internal positive control for the component decoding.

Later the Fuel Tank is damaged again:

```text
86.843s  codeA=4, codeB=33
95.939s  codeA=19, codeB=33
```

which reproduces the same module identity independently within the same controlled battle.

## Historical corpus evidence retained

Before the controlled replay, the proof used these current-version constraints:

1. method16 mechanical IDs occupy the contiguous `31..38` domain;
2. six of eight components were independently closed physically;
3. current Blitz damageable-module rules leave only Fuel Tank and Observation Device for `33/38`;
4. a canonical `38` critical sample did not start a fire, excluding Fuel Tank and orienting `38` as Observation Device.

That reasoning remains valid, but the controlled replay is now the stronger direct evidence.

## Production-safe mapping

For Blitz 11.19 China:

```text
33 -> FUEL_TANK
38 -> OBSERVATION_DEVICE
```

Preserve raw component IDs and client-version provenance for future versions.

## Remaining work

The identities are closed. Remaining research is narrower:

1. recover exact private enum name for Fuel-Tank `codeA=8`;
2. directly measure Observation Device view-range impairment with a controlled spotting-distance setup;
3. validate numeric stability on non-11.19 clients.
