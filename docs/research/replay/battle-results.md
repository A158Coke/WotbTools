# `battle_results.dat` / settlement protobuf

> Corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China.
>
> Settlement data is server-produced final battle evidence and must be inventoried independently from the client event stream.

## Container

`battle_results.dat` is a Python pickle protocol-2 value:

```text
(arenaUniqueId, protobufBytes)
```

The second tuple element is the settlement protobuf root.

Type 13 inside `data.wotreplay` is the in-stream settlement dump path already shown by existing protocol probes to correspond to the same result payload family.

## Root field inventory

Observed root fields are exactly:

```text
1,2,3,4,5,8,9,11,150,201,301,302,303
```

| root field | Occurrences | Wire | Verdict / meaning |
|---:|---:|---|---|
| 1 | 44 | varint | **PROVEN** mode/map compound ID; external Blitz parser names `mode_map_id` |
| 2 | 44 | varint | **PROVEN** battle Unix timestamp |
| 3 | 44 | varint | **PROVEN** winner team (1/2) |
| 4 | 44 | varint | **PROVEN on corpus** finish reason: values 1 or 6 |
| 5 | 44 | varint | **PROVEN/PARTIAL representation** common battle duration in integer-second result time |
| 8 | 44 | bytes | **PROVEN/PARTIAL** replay-author result block |
| 9 | 44 | varint | **PROVEN** room type; value 2 throughout this training corpus |
| 11 | 44 | bytes | UNKNOWN; current samples commonly decode as empty payload/string |
| 150 | 44 | bytes | PARTIAL compound team/time-series/statistics block |
| 201 | 704 | bytes | **PROVEN** player/entity roster entries; may include observers/non-combatants |
| 301 | 616 | bytes | **PROVEN** settled combatant result entries; exactly 14 per replay here |
| 302 | 44 | bytes | PARTIAL special per-player/result compound block |
| 303 | 44 | bytes | UNKNOWN/PARTIAL build/config-like block |

An independent Blitz parser also identifies root 1/2/3/8/9/201/301 with the same broad meanings, providing schema evidence separate from WotBTools.

## root 4 — finish reason

Only values 1 and 6 occur in the supplied corpus:

```text
1 : 20 replays
6 : 24 replays
```

Independent Wargaming client constants define:

```text
FINISH_REASON.EXTERMINATION = 1
FINISH_REASON.WIN_POINTS_CAP = 6
```

Thus root field 4 is `finishReason` for the current schema.

## root 5 — battle duration

Observed range: 172–399 seconds.

It tracks settlement lifetime/common battle duration and differs fundamentally from `meta.json#battleDuration`, which is not a reliable canonical active-battle clock. Survivor `lifeTime` differs from root field5 only at the integer boundary in this corpus.

Verdict: common result-layer battle duration is `PROVEN`; the exact server-side integer quantization/field name should retain version scope.

## root 201 — roster

Outer shape:

```text
field1 = account ID
field2 = PlayerInfo message
```

Current PlayerInfo fields include known identity/team data:

```text
1 nickname
2 platoon ID (optional)
3 team
5 clan tag (optional)
7 avatar/profile block
9 rank (optional)
```

The roster is **not necessarily identical to the 14 settled combatants**. In this corpus it can contain observer/BPC entities, so global protocol reconstruction must not silently equate `#201 size` with combat roster size.

## root 301 — player results

Every current replay has exactly 14 root-301 result records, for 616 records across the 44 files.

Outer structure:

```text
field1 = result/entity ID
field2 = PlayerResultsInfo message
```

### Complete observed `PlayerResultsInfo` field set

```text
1,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,23,24,25,
32,33,101,102,103,105,106,107,116,117,118,119,120
```

All observed fields are varints except field 107, which is `float32`.

### Field map

| field | Presence | Verdict / meaning |
|---:|---:|---|
| 1 | 322/616 | PARTIAL; signed/sentinel-like result value, includes encoded `-3`; exact name unresolved |
| 4 | 616/616 | **PROVEN** shots fired |
| 5 | 616/616 | **PROVEN** hits dealt |
| 6 | 238/616 | UNKNOWN/PARTIAL combat counter |
| 7 | 616/616 | **PROVEN** penetrations dealt |
| 8 | 614/616 | **PROVEN** damage dealt; omission represents protobuf default zero in the two missing records |
| 9 | 201/616 | **PROVEN/PARTIAL subtype** assisted damage family 1 |
| 10 | 130/616 | **PROVEN/PARTIAL subtype** assisted damage family 2 |
| 11 | 606/616 | **PROVEN** damage received; omission is default zero |
| 12 | 608/616 | **PROVEN** hits received |
| 13 | 318/616 | **PROVEN** non-penetrating hits received |
| 14 | 2/616 | UNKNOWN sparse combat flag/counter |
| 15 | 606/616 | **PROVEN** penetrations received |
| 16 | 340/616 | UNKNOWN/PARTIAL combat counter |
| 17 | 616/616 | **PROVEN** enemies damaged |
| 18 | 254/616 | **PROVEN** enemies destroyed / kills; omission is zero |
| 23 | 616/616 | **PROVEN** XP result used by current parser; exact base/premium naming is version-sensitive |
| 24 | 616/616 | **PROVEN** `lifeTime` (nearest-integer server battle-relative lifetime) |
| 25 | 379/616 | **PROVEN** `killerID`; absent for survivors/default cases |
| 32 | 270/616 | **PROVEN** victory/Supremacy points earned |
| 33 | 178/616 | **PROVEN** victory/Supremacy points seized |
| 101 | 616/616 | **PROVEN** account ID |
| 102 | 616/616 | **PROVEN** team 1/2 |
| 103 | 616/616 | **PROVEN** vehicle/tank compact descriptor ID |
| 105 | 246/616 | **PROVEN** death reason/alive sentinel field; encoded `-1` = alive where present, 1/2/3 validated special death reasons |
| 106 | 616/616 | **PROVEN** credits result used by current parser |
| 107 | 303/616 | **PROVEN/PARTIAL display semantic** matchmaking/rating float; independent parser names `mm_rating` |
| 116 | 176/616 | UNKNOWN/PARTIAL large integer field |
| 117 | 403/616 | **PROVEN** damage blocked |
| 118 | 87/616 | UNKNOWN/PARTIAL combat/stat counter |
| 119 | 301/616 | UNKNOWN/PARTIAL small enum/counter (1/2/3 observed) |
| 120 | 147/616 | UNKNOWN/PARTIAL small enum/counter (1/2/3 observed) |

Protobuf omission must be interpreted according to the field's default semantics; absence is not automatically “data unavailable”.

## lifeTime / killerID / deathReason

These fields are documented in detail in `death-and-battle-clock.md`.

Current verdict:

```text
field24  lifeTime    PROVEN
field25  killerID    PROVEN
field105 deathReason PROVEN
```

Validated special `deathReason` values:

```text
1 = fire
2 = ramming
3 = world_collision
```

A self-attributed killer sample was independently shown to have reason 3 (`world_collision`), so `killerID == self` must not be labelled “intentional suicide” without the reason field.

## field 107

An independent Blitz protobuf implementation declares field107 as a float matchmaking/rating value (`mm_rating`) and documents client display conversion for that historical/current schema family. The current corpus also observes field107 exclusively as float32.

Verdict: wire type and rating-family semantic are `PROVEN`; whether a particular WotBTools product should expose it is outside protocol research scope.

## root 302 / 303

Both appear exactly once per replay and remain structurally valid but not fully named.

`root303` examples consistently contain two small/medium integer fields in the current corpus. Their stability suggests a build/config/protocol parameter pair, but no semantic promotion is justified yet.

`root302` is a richer nested result block and remains a priority for field-level inventory.

## Author block (root 8)

Independent parser evidence confirms this is the replay author's personal result block and includes account/team plus personal battle statistics. WotBTools should keep this separate from the full 14-player `#301` dataset; author-only fields cannot be generalized to every participant unless the corresponding `#301` field is independently found.

## Research requirements for unresolved settlement fields

Before promoting fields 1/6/14/16/116/118/119/120 or root 11/302/303:

1. correlate values against already-known settlement facts across all players;
2. compare duplicate POVs of the same arena (server settlement values should match);
3. search independent Wargaming/Blitz schema sources;
4. use controlled replay contrasts where a single combat fact changes;
5. record counterexamples and protobuf omission behavior.

Until then they remain first-class raw fields with `UNKNOWN/PARTIAL` semantics, not discarded data.
