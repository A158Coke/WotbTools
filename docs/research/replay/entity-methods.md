# Type 8 — EntityMethod

> Corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China.
>
> This file inventories **every Type 8 subtype observed in the corpus**. Semantic labels are promoted only when independent replay behavior or a client/schema source closes the meaning.

## Envelope

All 69,515 observed Type 8 packets fit the same structural envelope:

```text
entityId : u32/i32 LE
subtype  : u32 LE
argLen   : u32 LE
args     : argLen bytes
```

For every observed record:

```text
packetPayloadLength == 12 + argLen
```

This is `PROVEN` for the current corpus.

## Complete subtype inventory

Observed subtype set:

```text
0,1,2,3,4,5,6,7,8,12,13,16,17,19,20,25,27,28,29,
35,36,38,39,43,44,46,47,48,49
```

| subtype | Count | Packet length(s) | Verdict / current meaning |
|---:|---:|---|---|
| 0 | 5,542 | 13 B normally; 48×40 B | UNKNOWN semantic; structure preserved |
| 1 | 4,531 | 19 B | **PROVEN/PARTIAL** vehicle health/state method; terminal state carries killer/attacker relationship |
| 2 | 315 | 13 or 20 B | UNKNOWN semantic |
| 3 | 92 | 14 B | UNKNOWN semantic |
| 4 | 238 | 28 or 14 B | UNKNOWN semantic |
| 5 | 389 | 15 B normally; 3×30 B | UNKNOWN semantic |
| 6 | 319 | 41 B | UNKNOWN semantic |
| 7 | 2,613 | 17 B | UNKNOWN semantic |
| 8 | 5,417 | 33 B normally; 393×17 B | **PROVEN identity / PARTIAL value** damage-method family |
| 12 | 737 | 18 B | UNKNOWN semantic |
| 13 | 1,512 | 21 B | UNKNOWN semantic |
| 16 | 467 | 22 B | UNKNOWN semantic |
| 17 | 2,724 | 24 B | UNKNOWN semantic |
| 19 | 171 | 25 B | UNKNOWN semantic |
| 20 | 5,750 | 28 B | **PROVEN** Avatar `stopTracer` family on current corpus; see `projectile-lifecycle.md` |
| 25 | 117 | 44 B | UNKNOWN semantic |
| 27 | 702 | 46 B | **PROVEN relationship / PARTIAL semantic** projectile terminal-resolution companion |
| 28 | 30 | 48 B | UNKNOWN/PARTIAL; 36-byte args, size-only `updateTargetingInfo` hypothesis rejected |
| 29 | 5,602 | 49 B | **PROVEN behavioral family / PARTIAL symbolic schema** projectile/tracer launch family |
| 35 | 318 | 25 B | UNKNOWN semantic |
| 36 | 1,142 | 104 B normally; 44×86 B | UNKNOWN semantic |
| 38 | 391 | 22/24/26/28/30 B | UNKNOWN semantic |
| 39 | 1,165 | 14 B | UNKNOWN semantic |
| 43 | 15 | 28–43 B | UNKNOWN semantic |
| 44 | 44 | 28 B | UNKNOWN semantic |
| 46 | 103 | 32/33/44 B | UNKNOWN semantic |
| 47 | 1,845 | ~58–517 B | **PROVEN current 11.19 chat-action family**; historical numbering differs |
| 48 | 27,180 | variable, 16 B to ~7 KB | **PROVEN wrapper container / PARTIAL wrapper semantics** |
| 49 | 44 | ~3.2–3.8 KB | **PROVEN behavioral role / PARTIAL RPC symbol** synchronized client/UI/control options |

No other Type 8 subtype was observed after strict packet framing was applied.

## Entity-class routing is mandatory

Method/subtype numbers are not global protocol names. Current evidence requires dispatch by at least:

```text
(clientVersion, targetEntityClass, methodId)
```

The same numeric method IDs are observed on different target classes with incompatible payloads. Historical PC/Wargaming method numbering is useful for structural comparison, but numeric equality alone is never enough to assign a current Blitz symbol.

## subtype 1 — health/state + killer relationship

The common packet is 19 B total, i.e. a 7-byte argument body after the envelope.

On the current terminal-death corpus:

- subtype 1 is timestamp-aligned with Type 7 `propId=3` terminal health state;
- its health/state value mirrors the terminal HP/sentinel family;
- its 32-bit actor/result ID matches settlement `killerID` in validated deaths;
- `0xFFFE` for Intotherainy is closed by this method, settlement `killerID`, the matching damage notification and no later alive HP.

Therefore subtype 1 is promoted to `PROVEN` as a vehicle-health/state method family and `PROVEN` for the killer relationship on validated terminal samples. The complete meaning of the trailing byte and all non-terminal variants remains `PARTIAL`.

## subtype 8 — damage method

Supported current direct variant provides attacker/victim identity. The protocol raw u16 value previously labelled “damage” is **not authoritative HP loss**; Type 7 current-HP deltas are authoritative for observed HP change.

Short and non-direct subtype-8 variants remain evidence-bearing but partially decoded. They must not be silently discarded because their presence can invalidate a unique-attacker attribution window.

See `protocol.md` and the death/combat material in this archive for the evidence rules.

## subtype 20 / 27 / 29 — projectile lifecycle

These current Avatar-targeted methods form a shot-ID-linked projectile family. The detailed evidence is kept in `projectile-lifecycle.md`.

Safe current facts:

```text
method20
  -> SHOT_ID + VECTOR3
  -> stopTracer / terminal endpoint
  -> PROVEN

method29
  -> launch-family event
  -> launch/reference point near shooter
  -> projectile velocity/direction vector
  -> every observed launch shotId closes to method20
  -> PROVEN behavioral family

method27
  -> same-shot terminal/resolution companion
  -> exact symbolic method/field schema PARTIAL
```

Replay packet `rawClock` is a delivery/recording timestamp and cannot be treated as exact projectile-simulation flight time; batching produces many launch/end RPCs at the same recorded clock.

## subtype 47 — current 11.19 chat action, historical numbering drift

Historical open-source Blitz material assigned numeric subtype 47 to an arena-update method. That historical observation is valid for its own version family but is **not** valid for the supplied 11.19 corpus.

Current 11.19 subtype47 has been fully parsed as a `CHAT_ACTION_DATA`-shaped message containing:

```text
requestID
action
actionResponse
time
sentTime
channel
originator
originatorNickName
group
Python/pickle data
flags
```

Observed action codes independently close to chat/channel actions including enter, broadcast, leave, self-enter/self-leave and command/system-message families.

Verdict:

> current Blitz 11.19 Avatar subtype47 = **chat-action family — PROVEN**.

This is direct evidence that numeric method IDs drift with version/component layout. Historical subtype47 arena decoders must be version-gated and must not be applied to 11.19.

## subtype 49 — synchronized client options

One Avatar-targeted method49 appears in every source replay. Its argument body contains a fixed outer prefix followed by a zlib stream; decompression yields a Python pickle dictionary containing synchronized player/client options such as controls, camera inversion, aiming/UI, minimap/chat settings and platform form-factor data.

Verdict:

> subtype49 = **synchronized client/UI/control-options family — PROVEN behavioral role / PARTIAL exact RPC symbol**.

See `avatar-synchronized-options.md`.

## subtype 48 — wrapped arena-update messages

Observed wrapper IDs are exactly:

```text
1,3,4,5,6,7,12,13,15,16,17,18,23,25
```

Counts:

| wrapper | Count | Root field | Verdict / meaning |
|---:|---:|---:|---|
| 1 | 44 | 1 | **PROVEN** roster / entity-account-team mapping snapshot |
| 3 | 172 | 3 | **PROVEN** arena period update |
| 4 | 44 | 4 | **PROVEN structure** entity-ID roster/set snapshot; exact method name PARTIAL |
| 5 | 374 | 5 | **PROVEN** vehicle frag/kill-count update |
| 6 | 551 | 6 | **PROVEN/PARTIAL** `VEHICLE_KILLED` / death-info family; optional secondary attribution field unresolved |
| 7 | 794 | 7 | PARTIAL entity-ID lifecycle/setup notification |
| 12 | 6,723 | 11 | PARTIAL active battle-state / equipment-adjacent family; exact record semantics unresolved |
| 13 | 9,265 | 12 | **PROVEN** realtime supremacy points |
| 15 | 8,050 | 14 | **PROVEN/PARTIAL** own-team weapon/feed/reload telemetry; see dedicated docs |
| 16 | 987 | 15 | PARTIAL entity state event family |
| 17 | 44 | 16 | PARTIAL initialization snapshot with entity IDs + float/state |
| 18 | 44 | 17 | **PROVEN structure / PARTIAL field semantics** training/pre-battle configuration |
| 23 | 44 | 20 | **PROVEN** client tutorial/hint configuration/state |
| 25 | 44 | 22 | PARTIAL feature/configuration flags |

### wrapper 1 — roster/entity mapping

Root field 1 contains repeated player/entity records. Stable current fields include entity/result ID, nickname, team, account ID, clan information and additional player metadata. The snapshot can contain observers/non-combatants in addition to settled combatants; protocol identity and business battle-roster validation must remain separate.

### wrapper 3 — arena period

Observed period values follow the independently known Wargaming lifecycle:

```text
0 IDLE
1 WAITING
2 PREBATTLE
3 BATTLE
4 AFTERBATTLE
```

The period=3 update is the client-observed battle-start anchor used by `death-and-battle-clock.md`. Current payload also carries period timing/length values; optional flag/reason fields remain PARTIAL.

### wrapper 4 — entity-ID set snapshot

44/44 source replays contain one initialization wrapper4. Its entity-ID set is exactly equal to wrapper1's entity-ID set in every replay. The roster/set relationship is PROVEN; the precise symbolic server label remains PARTIAL.

### wrapper 5 — frag count

Current payload:

```text
field1 = vehicle/entity ID
field2 = cumulative frag count
```

Values increment after kills and close against settlement/kill events. Verdict: **PROVEN vehicle frag-count broadcast**.

### wrapper 6 — `VEHICLE_KILLED` / death-info family

For post-start validated deaths, current Blitz fields close as:

```text
field1 = victim/vehicle entity ID
field2 = killer entity ID
field3 = optional secondary combat-attribution entity (semantic PARTIAL)
field4 = optional/non-default deathReason ID
field5 = optional value, very sparse
```

Current death correlation is exact for the authoritative fields:

```text
victim vs settled dead player : 375 / 375
killer vs settlement killerID : 375 / 375
reason vs settlement reason   : 375 / 375
```

#### Important version divergence: field3 is NOT current Blitz `equipmentID`

Historical PC `ClientArena.__onVehicleKilled()` decodes its version's tuple as:

```text
(victimID, killerID, equipmentID, reason, numVehiclesAffected)
```

That historical third-field name does **not** fit the current Blitz 11.19 corpus.

For the current optional field3 observations:

```text
field3 values are valid current arena participant/entity IDs
field3 != killer in every observed field3 death
55 / 56 are on the killer's team
```

The sole team-side exception is the independently verified `world_collision` self-death: `killerID=self`, while field3 points to an enemy vehicle that had attacked the victim earlier. This is physically incompatible with an ordinary small equipment identifier and proves a current-version schema divergence from the historical PC tuple.

On the strict 34-arena subset where the supported direct-damage stream provides usable attack histories, 46 field3 deaths can be examined further:

```text
field3 entity had attacked victim previously       : 46 / 46
field3 == previous non-killer attacker              : 30 / 46
field3 == first attacker                            : 30 / 46
field3 == first non-killer attacker                 : 33 / 46
field3 == non-killer with most direct attack events : 43 / 46
field3 == final direct attacker                     :  4 / 46
```

Therefore field3 is strongly a **secondary combat-attribution entity**, not a duplicate killer and not the historical PC equipmentID. The exact current rule — assist credit, spotting/track attribution, contribution ranking, or another combat-credit relation — remains `PARTIAL` because the supported direct-damage stream is incomplete and its raw numerical value is not authoritative damage.

Safe verdict:

> wrapper6 field3 = **secondary combat-attribution participant/entity — PARTIAL**.

Do not expose a user-facing `assistant`, `spotter`, `lastAttacker`, or `equipmentID` name until a current Blitz schema or a complete assist-attribution closure proves one of those meanings.

Early initialization wrapper6 records also exist; consumers must use arena-period/lifecycle context and not count every wrapper6 as a post-start kill.

### wrapper 7

Contains an entity ID and occurs in setup/lifecycle windows. Exact symbolic meaning remains PARTIAL.

### wrapper 12

The historical Wargaming `ARENA_UPDATE` enum contains `COMBAT_EQUIPMENT_USED` at update ID 12. Current wrapper12 is therefore equipment/combat-state relevant, but current records have not yet been field-for-field closed to a per-player consumable activation identity. In particular it must **not** be labelled as an Adrenaline activation packet merely from timing correlation.

### wrapper 13 — supremacy points

Repeated record:

```text
field1 = team
field2 = current points
```

Values evolve with the Supremacy score. Verdict: **PROVEN realtime supremacy points**.

### wrapper 15 — own-team gun/feed/reload telemetry

The earlier visibility hypothesis is rejected: all 8,050 current wrapper15 records target the recorder's own team.

Dedicated studies prove multiple gun-feed state families, including:

- conventional single-shot shot/reload telemetry;
- actual reload/gun-cycle duration in field3;
- a dynamic ~0.853 duration mode identified behaviorally as the Adrenaline reload effect in eligible single-shot vehicles;
- distinct Kranvagn/Felice non-single-shot state codes and feed-stage timers;
- a terminal/death reaction state emitted after own-team vehicle death.

See `team-weapon-telemetry.md` and `adrenaline-and-gun-feed.md`. Individual symbolic state enum labels remain version-scoped/PARTIAL where no current Blitz enum has been recovered.

### wrapper 16

Current form:

```text
field1 entity/result ID
field2 = 1
field3 = 1 normally, 8 in a small minority
```

Active-battle entity state family; exact meaning PARTIAL.

### wrapper 17

One initialization snapshot per replay. Repeated records include entity ID, float32 value and small state. Exact semantic remains PARTIAL.

### wrapper 18 — training configuration

One initialization message per replay. Current training corpus is uniform on key values and includes literal `"training"`; this closes the block as training/pre-battle configuration. Individual numeric field names remain PARTIAL.

### wrapper 23 — tutorial/hint state

Payload carries literal client hint IDs such as `back_to_garage`, armor highlight, sniper mode, shell-selection and movement hints. Verdict: **PROVEN client tutorial/hint configuration/state**, not battle physics.

### wrapper 25

One initialization message per replay; current nested fields are feature/configuration flags. Exact names remain PARTIAL.

## Research constraints

1. subtype numbers and wrapper IDs are version-sensitive and entity-class scoped;
2. historical numeric mappings must not be transplanted into Blitz 11.19 without current evidence;
3. unknown methods must retain raw argument bytes;
4. structural decoding and semantic decoding are separate promotion steps;
5. a method is not user-facing evidence until identity, time and semantic confidence are established;
6. when current replay behavior contradicts a historical PC field name, the current corpus wins and the divergence must be documented explicitly.
