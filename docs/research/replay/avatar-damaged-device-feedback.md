# Avatar method38 — structured damaged-device feedback

> Corpus: strict 34 unique-arena Blitz 11.19.0 China subset from the replay research archive.
>
> Scope: current Avatar-targeted Type8 `methodId=38`. Numeric method IDs are version- and entity-class-scoped.

## Executive verdict

Current Avatar method38 is a **vehicle-scoped structured device-damage feedback family** — `PROVEN physical/behavioral role / PARTIAL exact symbolic RPC identity`.

The strongest historical symbolic candidate is Wargaming `showOtherVehicleDamagedDevices(vehicleID, damagedExtras, destroyedExtras)`, because historical client code uses that RPC to show the currently monitored vehicle's damaged/destroyed devices. The current Blitz wire structure and behavior fit that role, but a version-matched Blitz 11.19 entity definition has not been recovered, so the symbolic name remains `PARTIAL`.

The method also closes an important relationship with Type32 mobile `flag=1` short bodies: the short-body suffix and method38 structured token usually identify the same per-hit device/extra family, while the short-body prefix strongly tracks method38 state severity.

## Entity routing

The recorder Avatar entity for each replay can be independently identified from the already-proven projectile method29 stream.

On the strict 34-arena corpus:

```text
method38 total                     : 295
method38 targeted at recorder Avatar: 295 / 295
method38 args start with valid vehicle entityId: 295 / 295
```

Therefore current method38 is an **Avatar RPC carrying another vehicle's identity**, not a Vehicle-entity method whose numeric ID happens to collide with an Avatar method.

## Main wire variant

Argument lengths are:

```text
10 bytes : 173
12 bytes :  93
14 bytes :  24
16 bytes :   3
18 bytes :   2
```

For 281/295 records, the following structural decoder closes exactly:

```text
vehicleId : u32 LE
header    : 4 bytes, semantics PARTIAL
count     : u8
repeat count times:
    token : u8
    state : u8
tail      : u8
```

with:

```text
argLength == 10 + 2 * count
```

Observed `count` values are `0..4`.

The remaining 14 records are an extended variant. They retain the same recognizable prefix/list material but carry an additional four-byte tail-like extension. Their extension semantics remain `UNKNOWN`; consumers must preserve the raw bytes rather than forcing them through the main decoder.

Representative current bodies after the Type8 envelope:

```text
<vehicleId> 10 05 02 00 01 22 01 00
<vehicleId> 10 01 02 00 01 21 01 00
<vehicleId> 00 05 02 00 02 22 02 23 02 00
<vehicleId> 20 05 02 00 01 22 02 00
```

The exact semantics of the four-byte `header` are not yet closed.

## Relationship to Type32 damage short bodies

For the 108 main-variant method38 records with a non-empty token list, same-clock Type32 mobile `flag=1` short events for the referenced vehicle were compared by their final token byte.

```text
method38 token set == same-clock short suffix set : 86 / 108
method38 token set subset of short suffix set      : 90 / 108
at least one token/suffix intersection             : 96 / 108
```

Examples:

```text
method38 token 0x22, state1
same clock Type32 short: a0 22

method38 token 0x21, state1
same clock Type32 short: a0 21

method38 token 0x22, state2
same clock Type32 shorts include: a4 22 / 9c 22

method38 tokens 0x22 state2, 0x23 state2
same clock short family includes ...22 and ...23
```

This proves that method38 and the Type32 short family expose related structured damage/device evidence, but they are not byte-for-byte mirrors and one surface must not be substituted for the other.

## State-to-short-prefix separation

When a method38 `(token,state)` pair has a same-clock Type32 short ending in the same token, the prefix distribution separates strongly by state.

### `state=1`

```text
a0   : 52
 a180: 17
 a140:  2
 a1e0:  1
```

### `state=2`

```text
a4   : 29
9c   : 26
a580 :  1
9d80 :  1
```

### `state=0`

Current state0 observations do not form an equivalent same-clock damage-short family.

Verdict:

> The compact Type32 prefix and method38 state carry a strongly shared **damage-severity/state dimension — PROVEN relationship**.

The exact labels `common/critical/destroyed/repaired` are still `PARTIAL`; numeric state labels must not be promoted solely from historical naming intuition.

## Historical client evidence

Historical Wargaming client code exposes:

```text
showOtherVehicleDamagedDevices(vehicleID, damagedExtras, destroyedExtras)
```

and sends those collections to battle feedback for the currently monitored/targeted vehicle. The same historical client also distinguishes module critical/destroyed/repaired states in its damage-info system.

This is strong independent structural context for current method38, but current Blitz method numbering and collection serialization may differ. Therefore the safe current verdict is:

```text
physical role      : structured damaged-device feedback — PROVEN
vehicle identity   : args begin with vehicle entityId — PROVEN
list count/pairs   : main variant structure — PROVEN
short-body relation: PROVEN
exact RPC symbol   : showOtherVehicleDamagedDevices candidate — PARTIAL
state names 0/1/2 : PARTIAL/UNKNOWN
header bytes       : UNKNOWN/PARTIAL
extended variant   : PARTIAL structure / UNKNOWN extension semantic
```

## Important negative findings

Do not make any of the following shortcuts:

```text
Type32 short suffix == Type7 prop8 token snapshot
method38 state1 == critical       // not yet independently closed
method38 state2 == destroyed      // not yet independently closed
method38 state0 == repaired       // not yet independently closed
method38 == showVehicleDamageInfo // historical signature does not fit this wire shape
```

A separate tested candidate, current Avatar method35, does not fit historical `showVehicleDamageInfo(vehicleID, damageIndex, extraIndex, entityID, equipmentID)`: its 13-byte arguments decode as `vehicleId + float32 + five zero bytes` in the current corpus and only weakly co-occur with damage short events. That hypothesis is `REJECTED`.

## Consumer guidance

Until the symbolic state names are closed, preserve method38 as structured evidence:

```text
DamagedDeviceFeedback {
    rawClockSec
    vehicleEntityId
    headerRaw[4]
    entries[] {
        token
        rawState
    }
    extensionRaw[]
    confidence
}
```

This structure can later be joined to Type32 short events, Type7 recoverable-state properties and consumable repair actions without inventing a module name or severity label prematurely.

## Remaining work

1. Recover a version-matched Blitz 11.19 Avatar/entity definition for the exact method38 RPC symbol and collection types.
2. Close `rawState=0/1/2` against controlled common-vs-critical module outcomes.
3. Map token IDs to actual `extras[]` entries (engine, tracks, gun, turret, ammo rack, crew, etc.) using vehicle descriptors or controlled probes.
4. Decode the four-byte method38 header.
5. Decode the 14-record extended variant and determine the extra four-byte field.
6. Determine whether method38 is emitted only for the recorder's currently monitored target, as historical `showOtherVehicleDamagedDevices` would predict.
