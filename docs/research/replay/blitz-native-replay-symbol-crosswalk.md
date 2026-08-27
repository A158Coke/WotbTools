# Blitz-native replay symbol crosswalk

> Scope: Blitz replay evidence only. This note deliberately separates old **World of Tanks Blitz** replay-code symbols from PC World of Tanks schemas.
>
> Current behavior remains authoritative. Historical Blitz names are used only after the current 11.19 corpus independently closes the physical/behavioral family.

## Source provenance

A 2016 World of Tanks Blitz modding discussion quoted strings extracted from Blitz replay code. The quoted native replay message names include:

```text
MSG_CLIENT_VERSION
MSG_ON_AMMO_BUTTON_PRESSED
MSG_ON_BASE_PLAYER_CREATE
MSG_ON_CELL_PLAYER_CREATE
MSG_ON_CHANGE_CONTROL_MODE
MSG_ON_CLIENT_READY
MSG_ON_ENTITIES_RESET
MSG_ON_ENTITY_CACHE_TEST
MSG_ON_ENTITY_CONTROL
MSG_ON_ENTITY_CREATE
MSG_ON_ENTITY_LEAVE
MSG_ON_ENTITY_METHOD
MSG_ON_ENTITY_MOVE_WITH_ERROR
MSG_ON_ENTITY_PROPERTY
MSG_ON_NESTED_ENTITY_PROPERTY
MSG_ON_SPACE_DATA
MSG_ON_STREAM_COMPLETE
MSG_ON_UPDATE_CAMERA
MSG_ON_UPDATE_TURRET_YAW_PITCH
MSG_SET_ARENA_LENGTH
MSG_SET_ARENA_PERIOD
```

The same quoted Blitz code surface also contains entity property/method names such as:

```text
activeEquipments
criticalDevices
damageStickers
destroyedDevices
engineMode
explodeProjectile
gunAnglesPacked
health
isAlive
isStrafing
onChatAction
onClientOptionsLoad
onHealthChanged
onRoundFinished
onStaticCollision
publicStateModifiers
showDamageFromShot
showOwnVehicleHitDirection
showShooting
showShotResults
showTracer
showVehicleDamageInfo
stopTracer
updateArena
updatePositions
updateTargetingInfo
updateVehicleAmmo
updateVehicleGunReloadTime
updateVehicleHealth
updateVehicleMiscStatus
updateVehicleSetting
```

Historical source page:

```text
https://4pda.to/forum/index.php?showtopic=579979&st=158080
```

The post describes these strings as taken from Blitz replay code. It predates the current 11.19 client, so symbolic-family continuity is useful evidence while numeric IDs are **not** assumed stable.

# Top-level packet crosswalk

## Closed current behavior + strong Blitz-native symbolic identity

| Current 11.19 packet | Current proven behavior | Blitz-native symbol support | Verdict |
|---:|---|---|---|
| Type4 | enemy entity leaves client-observed/AoI set | `MSG_ON_ENTITY_LEAVE` | PROVEN physical role / STRONG symbolic match |
| Type7 | EntityProperty envelope | `MSG_ON_ENTITY_PROPERTY` | PROVEN family / STRONG symbolic match |
| Type8 | EntityMethod envelope | `MSG_ON_ENTITY_METHOD` | PROVEN family / STRONG symbolic match |
| Type10 | continuous entity transform/move-with-error packet | `MSG_ON_ENTITY_MOVE_WITH_ERROR` | PROVEN family / STRONG symbolic match |
| Type11 | space/map/session information family | `MSG_ON_SPACE_DATA` | PARTIAL current body / STRONG family match |
| Type14 | final ordinary replay event-stream close marker | `MSG_ON_STREAM_COMPLETE` | PROVEN physical role / STRONG symbolic match |
| Type28 | recorder ammunition slot/button selection index | `MSG_ON_AMMO_BUTTON_PRESSED` | PROVEN current behavior / STRONG symbolic match |

### Type14

Current corpus:

```text
exactly one Type14 per replay
payload = 00
last ordinary packet in 34/34
followed only by deterministic file terminator
```

Among the historical Blitz-native message names, `MSG_ON_STREAM_COMPLETE` is the direct symbolic family match.

Safe label:

```text
Type14 = stream-complete / event-stream-close family
```

Do not use it as authoritative battle-finish reason or server finish time.

### Type17

Current Type17:

```text
exactly once per replay
zero-byte payload
occurs at recorder-local control/aim initialization boundary
Type39 aim/camera stream begins ~100ms afterward
```

The historical Blitz message list includes `MSG_ON_CLIENT_READY` and `MSG_ON_CHANGE_CONTROL_MODE`.

A zero-argument once-per-replay initialization event is structurally much more compatible with `MSG_ON_CLIENT_READY` than a control-mode change, which would require a mode value.

Verdict:

> Type17 = **strong `MSG_ON_CLIENT_READY` symbolic candidate — STRONG PARTIAL exact identity**.

Do not promote solely from the historical name list; a version-matched 11.19 writer schema is still absent.

### Type29

Type29 carries a one-byte `01` flag four times per replay in a deterministic initialization pattern. Historical Blitz symbols include both client-ready and control-mode/client-control families, but the current multiplicity does not uniquely identify one.

Verdict:

> retain current **client-options/replay-control initialization companion** semantic; no exact native symbol yet.

### Type39

Current Type39 is a fixed 7-float recorder aim/camera/gun geometry stream. Historical Blitz replay code contains:

```text
MSG_ON_UPDATE_CAMERA
MSG_ON_UPDATE_TURRET_YAW_PITCH
```

The current 28-byte seven-float body is strongly camera/aim related, but it may combine state that older clients split across multiple native replay messages.

Verdict:

> `MSG_ON_UPDATE_CAMERA` = strong family candidate; exact one-to-one identity remains PARTIAL.

# Entity property/method crosswalk

The current corpus independently closes the following families, which also appear by name in old Blitz replay code:

| Current surface | Current behavior | Blitz-native name support |
|---|---|---|
| Vehicle prop3 | current HP / terminal health | `health` |
| Vehicle prop4 | 2-u8 engine/movement mode tuple | `engineMode` candidate |
| Vehicle method0 normal | vehicle firing | `showShooting` |
| Vehicle method6 | static/world collision contact | `onStaticCollision` |
| Avatar method4 | round finished | `onRoundFinished` |
| Avatar method16 | vehicle damage/module/crew presentation | `showVehicleDamageInfo` |
| Avatar method19 | vehicle misc status + repair progress | `updateVehicleMiscStatus` |
| Avatar method20 | shotId + terminal endpoint | `stopTracer` |
| Avatar method27 | projectile explosion/terminal resolution | `explodeProjectile` family |
| Avatar method35 | full current reload-duration update | `updateVehicleGunReloadTime` |
| Avatar method36 | targeting info snapshots | `updateTargetingInfo` |
| method48 wrapper transport | arena state/update container | `updateArena` family |

These symbolic links are useful because they are **Blitz-native precedent**, not PC-only architecture.

## Critical/destroyed device arrays

The old Blitz replay code explicitly contains the property names:

```text
criticalDevices
destroyedDevices
publicStateModifiers
```

The current 11.19 corpus has multiple compact u8 array properties (Vehicle prop7/8/9) strongly tied to effect/state traffic. However, there are three current arrays and the historical interfaces/property ordering can drift.

Therefore:

> do **not** assign prop7/8/9 one-to-one to `criticalDevices`, `destroyedDevices`, or `publicStateModifiers` until current state-transition behavior uniquely closes the mapping.

# Numeric-ID warning

The historical quoted name list is **not a numeric ID table**.

Current evidence itself proves that simply taking the list order as packet numbers would be wrong. Numeric packet IDs and entity property/method IDs can move when the replay writer, interfaces, or generated entity definitions change.

Safe rule:

```text
current 11.19 wire behavior -> primary evidence
old Blitz symbolic name     -> independent family support
old list position/number    -> never reused as current numeric ID
```

# Research value

This crosswalk reduces reliance on PC World of Tanks decompilation for families that Blitz itself historically exposed. Future protocol work should prefer evidence in this order:

1. current 11.19 China corpus behavior;
2. version-matched Blitz schema/resources if recovered;
3. historical Blitz replay symbols;
4. PC World of Tanks history only as a final architectural candidate.
