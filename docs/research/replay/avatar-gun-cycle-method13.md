# Avatar method13 — observed vehicle gun-cycle / reload-state family

> Corpus: strict 34 unique-arena Blitz 11.19 China replay set.
>
> Numeric method IDs are version- and entity-class-scoped. This note documents current Avatar-targeted method13 behavior only.

## Wire structure

All 1,146 method13 events in the strict corpus use 9-byte arguments:

```text
vehicleEntityId : u32 LE
stateCode       : u8
timerValue      : f32 LE
```

Observed state codes:

```text
0 : 435
3 : 385
4 : 175
5 : 126
6 :  13
7 :  12
```

The timer is finite and positive in the observed family, commonly in plausible gun-cycle/reload-duration ranges (for example roughly 7.7–8.8 s in conventional single-shot samples, with longer values on other feed systems/states).

## Shooting synchronization

Vehicle method0 `(args=01)` is independently established as the current vehicle-fired / showShooting family.

Joining method13 by exact replay clock and `vehicleEntityId` gives:

```text
stateCode=3 : 385 / 385 exactly same-clock with vehicle firing
stateCode=7 :  12 /  12 exactly same-clock with vehicle firing
stateCode=4 :   3 / 175 exactly same-clock
stateCode=6 :   3 /  13 exactly same-clock
```

Across all states, 403 method13 events are exactly same-clock with a firing event from the referenced vehicle.

This is not a generic timer or arbitrary per-vehicle telemetry: particular state codes are deterministically tied to the shot transition.

## Current verdict

> Avatar method13 is an observed **vehicle gun-cycle / reload-state telemetry family — PROVEN relationship / PARTIAL exact state semantics**.

The exact current Blitz RPC symbol is not yet proven. A historical PC method such as `updateVehicleGunReloadTime` is only a structural candidate: historical signatures include different argument layouts, so the current 9-byte Blitz body must not be renamed solely by historical symbol matching.

The `stateCode` likely distinguishes feed/reload mechanisms or phases. This is consistent with independently proven wrapper15 behavior, where conventional single-shot vehicles and non-single-shot/autoloading families use different gun-feed state codes.

## Next closure work

1. join each method13 event to wrapper15 records for the same vehicle and clock;
2. split by vehicle/gun-feed mechanism and compare timer values with known reload-cycle durations;
3. test Adrenaline windows (`0x09`) for the independently observed ~0.853 reload-duration mode;
4. test gun-damage candidate hit flags/tokens for persistent timer changes before and after Repair Kit / Multi-Purpose restoration;
5. only then assign exact meanings to stateCode 0/3/4/5/6/7.

## Safe consumer contract

Until state semantics close:

```text
GunCycleStateEvent {
    rawClockSec
    vehicleEntityId
    stateCodeRaw
    timerSec
    confidence
}
```

Safe use: preserve/reconstruct observed gun-cycle transitions and join them to firing/reload telemetry.

Unsafe: expose stateCode as a named reload/autoloader stage without a vehicle/feed-specific closure.
