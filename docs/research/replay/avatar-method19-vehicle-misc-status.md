# Avatar method 19 — vehicle misc-status / repair-progress family

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Numeric method IDs are entity-class and version scoped.

## Executive verdict

Avatar method 19 is no longer UNKNOWN.

Current fixed body:

```text
vehicleId : u32 LE
code      : u8
intArg    : i32/u32 LE
floatArg  : f32 LE
```

Total body length: `13 bytes`.

This is an exact structural match for Wargaming's historical/current-style client RPC:

```text
updateVehicleMiscStatus(vehicleID, code, intArg, floatArg)
```

The current corpus independently closes one code family through repair-progress behavior.

Verdict:

> Avatar method19 = **vehicle miscellaneous status family — PROVEN behavioral/signature identity for the current corpus**.

Exact numeric `code -> symbolic status` mappings remain version-gated unless current behavior closes them.

## Corpus counts

```text
method19 total : 147
body length    : 13 bytes for 147 / 147
```

Observed code values:

```text
code 1 : 89
code 7 : 58
```

`vehicleId` resolves to an active combat vehicle for all 147 records.

## code 7 — destroyed-device repairing progress

The `code=7` records expose a very distinctive packed `intArg` plus countdown `floatArg` sequence.

Interpreting:

```text
extraIndex = intArg & 0xFF
progress   = (intArg >> 8) & 0xFF
```

produces real repair-progress ladders while `floatArg` decreases as remaining seconds.

Example sequence:

```text
intArg = 0x1722  -> extraIndex 0x22, progress 23%, timeLeft 3.261s
intArg = 0x2E22  -> extraIndex 0x22, progress 46%, timeLeft 2.261s
intArg = 0x4622  -> extraIndex 0x22, progress 70%, timeLeft 1.261s
intArg = 0x5D22  -> extraIndex 0x22, progress 93%, timeLeft 0.261s
```

Another current sample:

```text
0x1122 -> progress 17%, timeLeft 4.625s
0x2322 -> progress 35%, timeLeft 3.625s
0x3522 -> progress 53%, timeLeft 2.625s
0x4722 -> progress 71%, timeLeft 1.625s
0x5822 -> progress 88%, timeLeft 0.625s
```

The low byte remains the same device/extra index while the high-byte progress rises and the float countdown falls.

Independent Wargaming client code for `updateVehicleMiscStatus` contains the same decoding rule for `DESTROYED_DEVICE_IS_REPAIRING`:

```text
extraIndex = intArg & 255
progress   = (intArg & 65280) >> 8
floatArg   = remaining repair seconds
```

This is field-level behavioral closure, not only a method-signature coincidence.

Verdict:

> current `method19 code=7` = **destroyed-device repairing progress family — PROVEN behaviorally**.

The exact symbolic constant number may differ by Blitz version, so the production decoder should version-gate the numeric code.

## code 1

For all 89 `code=1` records:

```text
floatArg = 0
intArg resolves to a combat vehicle/entity ID
```

This is clearly another vehicle-related misc-status state, but the exact current semantic is not yet closed. It must remain PARTIAL/raw rather than borrowing a historical constant by number.

## Product value

This method can expose a real server/client-observed repair progress timeline without estimating it from movement or consumable use.

Safe model:

```text
VehicleMiscStatusEvent {
    rawClockSec
    vehicleId
    codeRaw
    intArgRaw
    floatArgRaw
    repairProgress?   // only when version-gated code identity is proven
    repairExtraIndex?
    repairTimeLeftSec?
}
```

Potential safe uses after version gating:

- Battle Playback: show a destroyed module being repaired and its progress;
- AI Review: distinguish a vehicle that remained disabled because a destroyed module was still repairing;
- protocol diagnostics: cross-check module-state and movement recovery timelines.

## Important boundary

This research does not assign `extraIndex 0x22 / 0x23` to a named Blitz module here. Device-role naming remains a separate controlled-evidence problem.

## Remaining work

1. close current `code=1` behavior without copying historical numeric enums;
2. correlate repair-progress extra indices with controlled module samples when available;
3. determine whether other misc-status codes are absent because this tournament corpus never triggers them;
4. validate numeric-code stability on other Blitz versions.
