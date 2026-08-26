# Replay protocol inventory

> Purpose: enumerate every currently observed replay structure and assign an evidence state. This is a research inventory, not an implementation contract.

## Evidence states

- `PROVEN`: semantic meaning closed by replay behavior and/or independent protocol/schema evidence.
- `PARTIAL`: structure or relationship is known but full semantic meaning is not.
- `UNKNOWN`: observed but semantic meaning is not yet established.
- `SUPERSEDED`: prior interpretation invalidated by stronger evidence.
- `DEPRECATED`: old research path retained only for history.

## Container level

| Component | Status | Notes |
|---|---|---|
| `.wotbreplay` ZIP container | PROVEN | Holds replay metadata, packet stream, battle results. |
| `meta.json` | PARTIAL | Many user-visible metadata fields are known; must not be treated as authoritative for every timing fact. |
| `data.wotreplay` | PROVEN framing / PARTIAL semantics | Packet stream framing is known; some packet types/subtypes remain unresolved. |
| `battle_results.dat` | PROVEN container / PARTIAL schema | Settlement protobuf is authoritative for many final battle facts; substantial field surface is still unmapped. |

## `data.wotreplay` framing

```text
header
then repeated:
  payload_len : u32 little-endian
  type        : u32 little-endian
  rawClockSec : f32 little-endian
  payload     : payload_len bytes
```

The raw clock includes pre-battle time. It must not be equated directly with battle-relative time.

## Packet-type inventory

| Type | Current verdict | Current semantic |
|---:|---|---|
| 0 | PROVEN/PARTIAL | base player create + arena pickle; authoritative roster/team metadata present. |
| 1 | PARTIAL | entity creation / avatar-cell related data. |
| 2 | PARTIAL | entity creation / avatar-cell related data. |
| 4 | PROVEN structure | EntityLeave / entity removal; **not equivalent to death**. |
| 5 | UNKNOWN/PARTIAL | enterWorld/lifecycle-related packet; structure not fully decoded. |
| 7 | PROVEN/PARTIAL | EntityProperty. `propId=2` turret-relative yaw; `propId=3` current HP. Other properties unresolved. |
| 8 | PROVEN/PARTIAL | EntityMethod. Several subtypes/wrappers known; large surface remains. |
| 10 | PROVEN | vehicle position packet. |
| 11 | PARTIAL | space information; map/space string observed. |
| 13 | PROVEN | battle-results dump; byte-equivalent settlement payload path. |
| 14 | UNKNOWN | low-frequency marker/end packet. |
| 23 | PROVEN on current samples | recorder shot/projectile lifecycle toggle. |
| 26 | PROVEN on current samples | incoming hostile shell warning/event for recorder. |
| 28 | UNKNOWN | small packet, rarely/never present in current primary corpus. |
| 29 | UNKNOWN | low-frequency marker/end packet. |
| 31 | PROVEN on current samples | recorder dispersion/aim-circle decay stream after firing. |
| 32 | PROVEN envelope / PARTIAL body semantics | entity-scoped `entityId + flag + bodyLength + body`; mobile `flag=0` long bodies contain a proven `float64` event clock and multiple version-mapped consumable lifecycle families. |
| 33 | PROVEN structure | entity enter-world confirmation. |
| 35 | PROVEN structure / PARTIAL semantic | ~10 Hz incrementing tick/counter; not a battle-start marker. |
| 36 | UNKNOWN | low-frequency marker/end packet. |
| 39 | PARTIAL | recorder camera/aim state stream; several float meanings identified, full schema incomplete. |

Any packet type observed later but not listed here must enter the inventory as `UNKNOWN` before semantic promotion.

## Type 7 — EntityProperty

Observed payload framing:

```text
entityId : u32 LE
propId   : u32 LE
valueLen : u32 LE
value    : valueLen bytes
```

| propId | Verdict | Meaning |
|---:|---|---|
| 0 | UNKNOWN/PARTIAL | small boolean/flag-like value; not HP. |
| 2 | PROVEN | turret-relative yaw; `deg = raw * 360 / 65536 - 180`. |
| 3 | PROVEN | current HP, signed-i16 interpretation for sentinel handling. Positive values are real current HP. |
| 4 | UNKNOWN/PARTIAL | high-frequency state/mode bit-like value; not HP. |
| 8 | UNKNOWN/PARTIAL | flag/state-like value. |
| 9 | UNKNOWN/PARTIAL | float/value family; not HP. |

### `propId=3` sentinel inventory

| Raw | Current status | Interpretation |
|---|---|---|
| positive signed i16 | PROVEN | actual current HP |
| `0x0000` | PROVEN | terminal death HP=0 |
| `0xFFFD` | PROVEN on current corpus | death-associated terminal sentinel; documentation/constant naming in main is inconsistent and must be corrected when implemented |
| `0xFFFE` | PROVEN for at least one closed death sample; global meaning PARTIAL | terminal death state in the Intotherainy evidence chain |
| `0xFFFF` and other negative sentinels | UNKNOWN | never infer death without independent evidence |

## Type 8 — EntityMethod

Current payload begins with:

```text
entityId : u32/i32 LE
subtype  : u32 LE
body     : remaining bytes
```

### Known subtypes

| subtype | Verdict | Meaning |
|---:|---|---|
| 1 | PROVEN on current terminal-death corpus / PARTIAL full schema | health/state + attacker/killer relationship; terminal event aligns with Type 7 HP terminal state and settlement killer. |
| 8 | PROVEN identity / PARTIAL value semantics | damage-method notification. attacker/victim identity can be reliable in supported variants; raw damage value is **not authoritative HP loss**. |
| 47 | UNKNOWN for current 11.19 semantics | old parser assumptions about a protobuf alive-roster snapshot do not fit current corpus; must be re-reversed, not reused blindly. |
| 48 | PROVEN wrapper container / PARTIAL wrapper surface | updateArena2-style wrapped protobuf messages. |

### subtype 48 wrapper inventory

| wrapper | Verdict | Meaning |
|---:|---|---|
| 1 | PROVEN | roster / entity-account mapping |
| 3 | PROVEN on current corpus | arena-period update; period=3 means BATTLE |
| 13 | PROVEN | realtime supremacy points |
| 18 | PARTIAL/PROVEN structure | pre-battle/config data already identified in existing protocol research; field-level semantics remain incomplete |
| other observed wrapper values | UNKNOWN until explicitly inventoried and decoded | do not infer by nearby field numbers |

## Arena lifecycle

Independent Wargaming enum:

```text
0 IDLE
1 WAITING
2 PREBATTLE
3 BATTLE
4 AFTERBATTLE
```

Current replay corpus confirms wrapper-3 period transitions consistent with this lifecycle. `BATTLE` packets provide a direct client-observed start marker, but some POVs omit the transition entirely.

## Battle clock

| Fact | Verdict |
|---|---|
| raw packet clock includes pre-battle time | PROVEN |
| period=3 is an independent client-observed battle-start anchor | PROVEN on current corpus |
| client-observed start may have sub-second receive/record jitter vs latent server start | PROVEN |
| settlement `lifeTime` is nearest-integer server battle-relative lifetime | PROVEN on current corpus |
| exact sub-second server death can always be reconstructed from one POV | FALSE |
| multi-POV raw clocks can be aligned within small tolerance | PROVEN on available multi-POV arenas |

## Battle results / settlement

The current parser consumes only part of the settlement protobuf. The settlement layer must be treated as a first-class protocol surface rather than a final-statistics afterthought.

### Player-result fields confirmed in this research

| field | Verdict | Meaning |
|---:|---|---|
| 24 | PROVEN | `lifeTime` |
| 25 | PROVEN | `killerID` |
| 105 | PROVEN | `deathReason` / alive sentinel semantics in current result model |

Existing known fields for account/team/tank/shots/hits/penetrations/damage/assist/received/kills/blocked/xp/credits/etc remain documented in parser code and existing replay-data references; a future complete settlement schema document should consolidate all of them in one table rather than duplicate mappings across code and docs.

### Death reasons validated in current corpus

| value | Verdict | Meaning |
|---:|---|---|
| alive sentinel | PROVEN | survivor |
| 1 | PROVEN on current samples | fire |
| 2 | PROVEN on current samples | ramming |
| 3 | PROVEN on current sample | world_collision |
| additional values | UNKNOWN until real sample closure | Wargaming enums provide hypotheses, but Blitz mapping must be validated before `PROVEN` |

## Multi-POV handling

Multi-POV duplicates must be separated from business deduplication:

- Rating / leaderboard aggregation: one `arenaId` = one battle.
- protocol reconstruction: additional POVs are independent observation sources and can fill missing event evidence.

Observed settlement facts (`lifeTime`, `killerID`, etc.) are stable across validated POV duplicates.

## High-value unresolved research queue

### Priority A — semantic gaps that directly unlock canonical replay facts

- Type 8 subtype 47 current Blitz 11.19 structure.
- remaining subtype 48 wrapper values and nested schemas.
- full Type 8 subtype 1 schema, including all non-terminal states and sentinel behavior.
- global semantics of `0xFFFE`, `0xFFFF`, and other negative HP sentinels.
- authoritative arena-period packet schema, including period length/end-time fields.
- complete settlement player/common protobuf schema, including all currently unnamed fields.

### Priority B — combat reconstruction

- exact shot/hit/penetration relation beyond recorder-only Type 23/26 streams.
- fire lifecycle and periodic-damage representation.
- ramming/collision event schema.
- drowning/overturn/death-zone event representation and Blitz `deathReason` validation.
- visibility/spotted/unspotted lifecycle and last-known position semantics.
- shell identity, shell type, hit result, critical/module damage, equipment effects.

### Priority C — movement and presentation

- complete Type 10 position schema fields beyond current coordinates/orientation consumption.
- complete Type 39 camera/aim schema.
- hull/turret/world orientation normalization across all vehicle classes.
- enterWorld/leaveWorld state machine (types 4/5/33) and relation to visibility vs physical existence.

### Priority D — low-frequency and end-of-battle packets

- Type 14.
- Type 29.
- Type 36.
- any packet types present only in special modes or newer versions.

## Research completion definition

This inventory is considered complete for a given corpus/version only when:

1. every observed packet type is listed;
2. every observed Type 7 propId is listed;
3. every observed Type 8 subtype is listed;
4. every observed subtype48 wrapper is listed;
5. every settlement root/player field is structurally inventoried;
6. every item has a verdict and evidence note;
7. no `PROVEN` item depends only on naming intuition or a single unsupported guess;
8. unknowns remain explicitly unknown rather than being silently discarded.
