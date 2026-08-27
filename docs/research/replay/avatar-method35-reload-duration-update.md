# Avatar method35 — vehicle reload-duration/configuration update

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: Avatar-targeted Type8 method35 only. Numeric method IDs are entity-class/version scoped.

## Executive verdict

Avatar method35 is a recorder-local/Avatar-delivered **vehicle gun reload-duration configuration update**.

Current wire body is fixed at 13 bytes:

```text
vehicleEntityId : u32 LE
reloadDuration  : f32 LE
unknownU32      : u32 LE   // 0 in 250 / 250 current samples
unknownU8       : u8       // 0 in 250 / 250 current samples
```

Canonical corpus:

```text
records           : 250
body length       : 13 / 13 bytes in 250 / 250
unique first u32  : 34, one recorder-vehicle identity per replay
reload range      : ~6.197 .. 25.727 s
unknownU32        : 0 in 250 / 250
unknownU8         : 0 in 250 / 250
```

Verdict:

> method35 `reloadDuration` = **current full gun reload-duration/config value — PROVEN physical role**.
>
> exact current Blitz RPC symbol and the two trailing zero fields remain `PARTIAL/UNKNOWN`.

## Exact relationship to Avatar method13

Avatar method13 is independently proven as the observed vehicle gun-cycle/reload-state family:

```text
vehicleEntityId : u32
stateCode       : u8
timerValue      : f32
```

Every current method35 event occurs at exactly the same replay clock as at least one method13 event for the same vehicle:

```text
method35 records                                   : 250
same vehicle + same clock method13 counterpart     : 250 / 250
```

This places method35 inside the same gun/reload state machine rather than an unrelated vehicle telemetry family.

The two floats are not universally identical. In particular, method13 can carry a phase/remaining timer while method35 carries the current complete reload-duration configuration. Therefore method35 must not be treated as a duplicate remaining-reload timer.

## Adrenaline activation gives decisive behavioral closure

Type32 mobile `flag=0` wireCode `0x09` is independently proven as the Adrenaline consumable. Its lifecycle contains:

```text
state 2 -> activation/start
state 3 -> active duration ended / cooldown transition
```

For the recorder vehicle, every observed Adrenaline activation has a method35 event at exactly the same replay clock:

```text
Adrenaline state2 activations : 46
same-clock method35           : 46 / 46
```

At activation, method35 immediately switches to the faster reload-duration mode.

Representative SPHT sequence:

```text
161.002 s  Type32 0x09 state2 (Adrenaline activation)
161.002 s  method35 reloadDuration = 7.525569 s

~20 s active window

180.899 s  Type32 0x09 state3 (Adrenaline active end)
180.899 s  method35 reloadDuration = 8.804916 s
```

The same relationship exists at every current Adrenaline active-end event with a complete state3 record:

```text
Adrenaline state3 endings : 39
same-clock method35       : 39 / 39
```

The active-end event restores the normal reload-duration family.

This is direct current-Blitz evidence that method35 carries the gun's **configured full reload duration under the currently active modifiers**.

## Why this is not a generic cooldown or remaining timer

The value is vehicle/gun-duration shaped and responds deterministically to a known +reload-speed consumable.

Method13, wrapper15 and shot telemetry independently carry gun-cycle phases and remaining/stage timers. Method35 instead changes when the effective full reload configuration changes, including Adrenaline modifier transitions.

Safe conceptual separation:

```text
method35
  -> current configured/full reload duration

method13
  -> gun-cycle/reload state + phase/remaining timer family

wrapper15
  -> own-team gun/reload telemetry, including shot-associated reload duration
```

These are related but not interchangeable surfaces.

## Safe consumer model

```text
VehicleReloadDurationUpdate {
    rawClockSec
    vehicleEntityId
    reloadDurationSec
    trailingU32Raw
    trailingU8Raw
}
```

Safe uses:

- reconstruct changes to effective reload duration;
- identify the exact start/end of observed reload-speed modifier windows when the modifier identity is independently known;
- cross-check method13/wrapper15 gun-cycle telemetry;
- future controlled tests for ammo-rack/gun/crew penalties or other reload modifiers.

Do not infer the cause of every method35 change from the float alone. Adrenaline is proven only where the independent Type32 `0x09` activation/end event is present.

## Remaining work

1. classify the non-Adrenaline method35 changes against damaged-module/crew/equipment states;
2. recover the exact current Blitz symbolic RPC name;
3. determine whether the trailing zero `u32/u8` fields take non-zero values on other gun systems/client versions;
4. validate autoloader/autoreloader behavior outside the current recorder-vehicle set.
