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
| 20 | 5,750 | 28 B | UNKNOWN semantic |
| 25 | 117 | 44 B | UNKNOWN semantic |
| 27 | 702 | 46 B | UNKNOWN semantic |
| 28 | 30 | 48 B | UNKNOWN semantic |
| 29 | 5,602 | 49 B | UNKNOWN semantic |
| 35 | 318 | 25 B | UNKNOWN semantic |
| 36 | 1,142 | 104 B normally; 44×86 B | UNKNOWN semantic |
| 38 | 391 | 22/24/26/28/30 B | UNKNOWN semantic |
| 39 | 1,165 | 14 B | UNKNOWN semantic |
| 43 | 15 | 28–43 B | UNKNOWN semantic |
| 44 | 44 | 28 B | UNKNOWN semantic |
| 46 | 103 | 32/33/44 B | UNKNOWN semantic |
| 47 | 1,845 | ~58–517 B | **version-drift surface**; old UpdateArena schema does not describe current 11.19 payloads |
| 48 | 27,180 | variable, 16 B to ~7 KB | **PROVEN wrapper container / PARTIAL wrapper semantics** |
| 49 | 44 | ~3.2–3.8 KB | UNKNOWN semantic; one large initialization blob per replay |

No other Type 8 subtype was observed after strict packet framing was applied.

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

See `protocol.md` and `health-damage-death` material in this archive for the evidence rules.

## subtype 47 — historical UpdateArena vs current 11.19

An older open-source Blitz parser maps **subtype 47** to `UpdateArena`, using an inner length, wrapper field number and protobuf message containing roster data. That is valuable evidence for historical protocol versions.

However, the supplied 11.19 corpus does **not** conform to that old subtype-47 schema. Current subtype-47 payloads are a different variable structure and old `parseUpdateArena()` assumptions do not decode them.

Verdict:

- historical subtype47=UpdateArena: `PROVEN` for the older parser/version family;
- current 11.19 subtype47 semantics: `UNKNOWN/PARTIAL`;
- reusing the historical decoder against current data without version gating is forbidden.

Current 11.19 wrapped arena updates are carried by subtype 48.

## subtype 48 — wrapped arena-update messages

The current decoder already identifies the envelope family. Observed wrapper IDs are exactly:

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
| 6 | 551 | 6 | **PROVEN/PARTIAL** vehicle alive/death-info update family |
| 7 | 794 | 7 | PARTIAL entity-ID lifecycle/setup notification |
| 12 | 6,723 | 11 | UNKNOWN/PARTIAL small battle-state event family |
| 13 | 9,265 | 12 | **PROVEN** realtime supremacy points |
| 15 | 8,050 | 14 | PARTIAL entity state/value event family; visibility hypothesis not yet proven |
| 16 | 987 | 15 | PARTIAL entity state event family |
| 17 | 44 | 16 | PARTIAL initialization snapshot with entity IDs + float/state |
| 18 | 44 | 17 | **PROVEN structure / PARTIAL field semantics** training/pre-battle configuration |
| 23 | 44 | 20 | **PROVEN** client tutorial/hint configuration/state |
| 25 | 44 | 22 | PARTIAL feature/configuration flags |

### wrapper 1 — roster/entity mapping

Root field 1 contains repeated player/entity records. Stable fields in the corpus include:

```text
1  entity/result ID
3  nickname
4  team
7  account ID
8  clan tag (when present)
...
```

The snapshot can include non-combatant/observer entities in addition to the 14 settled combatants, therefore protocol identity inventory and business battle-roster validation must remain separate concepts.

### wrapper 3 — arena period

Observed nested field 1 values are exactly periods 1,2,3,4. Independent Wargaming client constants define:

```text
0 IDLE
1 WAITING
2 PREBATTLE
3 BATTLE
4 AFTERBATTLE
```

Current records include, for example:

```text
period=1  remaining~60 s
period=2  7 s
period=3  420 s
period=4  60 s
```

Nested fields 2 and 3 represent period timing/length in float64/integer forms. Fields 4–6 are optional period flags/reasons whose exact names remain `PARTIAL`.

The period=3 broadcast is the client-observed active-battle start anchor used in `death-and-battle-clock.md`.

### wrapper 4 — entity-ID set snapshot

44/44 replays contain exactly one wrapper-4 snapshot at initialization. For every replay, the set of entity IDs in wrapper 4 is exactly equal to the entity-ID set in wrapper 1.

Therefore the relationship to the arena entity roster is `PROVEN`. The exact server method/property name is not yet independently established, so the semantic name remains intentionally generic.

### wrapper 5 — frag count

Payload shape:

```text
field1 = vehicle/entity ID
field2 = cumulative frag count
```

Replay correlation shows wrapper 5 emitted after kills and field2 increments for repeat killers (`1 → 2 ...`). This matches the independent client-side `updateVehiclesFrags(vehicleID, fragsCount)` arena API shape.

Verdict: `PROVEN` vehicle frag-count broadcast.

### wrapper 6 — alive/death-info update family

Observed fields:

```text
field1 = victim/vehicle entity ID
field2 = killer entity ID
field3 = optional related/equipment/entity value
field4 = optional deathReason ID
field5 = optional value (single observation in corpus)
```

For validated deaths, wrapper 6 aligns with the terminal subtype-1/Type-7 event and settlement facts. Optional field4 occurs exactly in the non-default death-reason cases in the corpus and matches the independently verified fire/ramming/world-collision reason IDs.

Independent Wargaming client code consumes vehicle death info as:

```text
victimID, killerID, equipmentID, reasonID, numVehiclesAffected
```

This makes `field3=equipmentID` and `field5=numVehiclesAffected` strong schema hypotheses, but this corpus does not independently close those two optional values. They remain `PARTIAL`.

Important: wrapper 6 is an **alive/death-info update family**, not “every wrapper-6 packet equals a combat death”. Early initialization records exist (including self/self entity values), so consumers must use state/evidence context rather than count every wrapper-6 record as a kill.

### wrapper 7

Contains an entity ID and occurs only in the early setup window (~1.5–23.7 s in this corpus). It is clearly an entity lifecycle/setup notification but its exact method name is not proven.

### wrapper 12

Root field 11 carries small records dominated by fields 1/2/3 and an integer field 4 with a broader domain. It spans active battle time. No user-facing semantic is assigned yet.

### wrapper 13 — supremacy points

Repeated record:

```text
field1 = team (1 or 2)
field2 = current points
```

Point values evolve during battle and correlate with the Supremacy score. Verdict: `PROVEN` realtime Supremacy points.

### wrapper 15

Root field14 records carry:

```text
field1 entity ID
field2 small state/type (5 is common)
field3 optional float32
field4 small flag/state
```

This is a high-value candidate for visibility/distance/state reconstruction, but current evidence does not distinguish those hypotheses. Keep `PARTIAL`.

### wrapper 16

Observed form:

```text
field1 entity/result ID
field2 = 1
field3 = 1 normally, 8 in a small minority
```

Active-battle entity state family; exact meaning `PARTIAL`.

### wrapper 17

One initialization snapshot per replay. Repeated records include:

```text
field1 entity ID
field3 float32
field4 state (1 or 3 observed)
```

The floats repeat across tank/entity classes and appear configuration-like. Exact semantic remains `PARTIAL`.

### wrapper 18 — training configuration

One initialization message per replay. Current corpus is uniform:

```text
field5  = "training"
field9  = 1
field10 = 300
field11 = 1000
field12 = 1
```

This proves a training/pre-battle configuration block. Individual numeric field names are not promoted without independent evidence.

### wrapper 23 — tutorial/hint state

Nested payload contains literal client hint identifiers such as:

```text
back_to_garage
armor_highlight_hint
armor_highlight_fast_hint
sniper_mode_hint
shell_select_hint
player_armor_hint
movement...
```

Verdict: `PROVEN` client tutorial/hint configuration/state. This is not battle-physics evidence.

### wrapper 25

One initialization message per replay; nested fields 1–7 are all `1` in the current corpus. It is a feature/configuration bit/flag block, but exact field meanings are `UNKNOWN/PARTIAL`.

## Research constraints

1. subtype numbers and wrapper IDs are version-sensitive protocol indices;
2. historical subtype47 mappings must not be applied to 11.19 without version gating;
3. unknown methods must retain raw argument bytes;
4. structural decoding and semantic decoding are separate promotion steps;
5. a method is not user-facing evidence until identity, time and semantic confidence are established.
