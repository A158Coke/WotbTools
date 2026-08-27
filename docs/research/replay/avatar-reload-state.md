# Avatar gun / reload cycle state — method13 + method35

> Corpus: strict 34 unique-arena Blitz 11.19.0 China subset.
>
> Numeric Avatar method IDs are version-scoped. Historical Wargaming method signatures are used only as cross-checks; behavioral closure on the current corpus is authoritative.

## Executive verdict

Current Avatar methods 13 and 35 form one **vehicle gun/reload-cycle telemetry family — PROVEN relationship / PARTIAL exact symbols**.

They share the same target vehicle ID and, for every observed method35 event, occur at exactly the same replay clock.

Current method13 wire:

```text
vehicleId : u32
state     : u8
value     : f32
```

Current method35 wire:

```text
vehicleId : u32
cycleTime : f32
zeroTail  : 5 bytes  // 0000000000 in all current records
```

## Method13 structure and firing relationship

Strict-corpus totals:

```text
Avatar method13 records : 1146
first u32 resolves to a settled combat vehicle : 1146 / 1146
```

Observed `state` values:

```text
0 : 435
3 : 385
4 : 175
5 : 126
6 :  13
7 :  12
```

The trailing float spans approximately:

```text
0.0 .. 25.011 s
median ~8.59 s
```

The key behavioral result is exact-clock firing closure:

```text
state=3 events exactly same-clock with
that vehicle's method0(args=01) showShooting : 385 / 385

state=7 events exactly same-clock with
that vehicle's method0(args=01) showShooting : 12 / 12
```

Therefore method13 is not a generic vehicle setting or health update. It belongs directly to the vehicle gun/feed/reload state machine.

The exact symbolic state labels remain `PARTIAL`; state 3 and state 7 are shot-emission/gun-cycle states in the observed feed families, but current evidence does not justify globally naming them `shot`, `clip shot`, `shell reload`, etc. without vehicle/feed-type separation.

## Method35 companion relationship

Current method35 records:

```text
count                         : 250
vehicleId resolves            : 250 / 250
payload                       : vehicleId + f32 + 0000000000
float range                   : ~6.197 .. 25.727 s
```

Most importantly:

```text
method35 events having same-clock method13
for the same vehicle          : 250 / 250
counterexamples               : 0
```

So method35 is not an unrelated damage-info method. It is a companion value in the same gun/reload state update.

### State-0 initialization/full-cycle closure

For method35 + method13 pairs where method13 `state=0`:

```text
pairs                         : 78
method35.timer == method13.timer exactly : 67 / 78
median absolute difference    : 0.0 s
```

This is consistent with state 0 carrying an initialized/full-cycle timer while method35 carries the corresponding cycle/base duration.

### Non-zero states

For method13 state 4, the paired method13 timer is commonly smaller than method35's full-cycle timer. State 5 frequently carries zero or a distinct terminal/stage value while method35 retains the complete cycle duration.

This supports the conceptual model:

```text
method35 -> full/effective cycle duration or companion cycle parameter
method13 -> current gun/feed state + current stage/time value
```

Exact field names remain `PARTIAL`.

## Historical-schema caution

Historical Avatar schemas contain several similarly sized replay-exposed methods such as `updateVehicleHealth(...)` and `updateVehicleSetting(...)`. Payload length alone therefore cannot assign the current Blitz numeric ID.

The current behavior wins:

- every method13 vehicleId resolves to a combat vehicle;
- states 3 and 7 are one-for-one with actual vehicle firing;
- every method35 record is same-clock with same-vehicle method13;
- both expose timer-scale float values typical of gun/feed cycles.

Therefore health/ordinary-setting interpretations are rejected for this current method family.

## Safe consumer model

```text
GunCycleStateEvent {
    rawClockSec
    vehicleEntityId
    stateCode
    stageValueSec
    fullCycleSec?   // method35 companion when present
    confidence
}
```

Safe uses now:

- reconstruct that a vehicle entered a gun/feed cycle state;
- attach an observed full/effective cycle timer when method35 is present;
- identify state-3/state-7 transitions as shot-synchronous gun-state transitions;
- correlate with method0 showShooting, wrapper15 team weapon telemetry and consumable-independent reload analysis.

Unsafe until further closure:

- expose state 0/3/4/5/6/7 with guessed user-facing enum names;
- assume one state map is identical for single-shot, autoloader, autoreloader and special feed systems;
- equate the method35 float with nominal garage reload without proving the active modifiers and feed mode;
- use method13 alone as authoritative shot count when method0/settlement already provide stronger shot evidence.

## Remaining work

1. split the state machine by vehicle/feed type;
2. join state 4/5/6 transitions to the next method0 shot and wrapper15 stage timers;
3. determine whether method35 is base reload, effective full-cycle duration, clip stage duration or another companion parameter;
4. validate modifier behavior against known Adrenaline/high-end-consumable windows separately from core protocol identity;
5. recover a version-matched Blitz Avatar definition for the exact RPC symbols.
