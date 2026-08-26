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

Type 13 inside `data.wotreplay` is the in-stream settlement dump path already shown by existing protocol probes to correspond to the same result payload family. Some POV streams end before Type 13 is recorded; the ZIP-level `battle_results.dat` remains the authoritative available result in those files.

## Root field inventory

Observed root fields are exactly:

```text
1,2,3,4,5,8,9,11,150,201,301,302,303
```

| root field | Occurrences | Wire | Verdict / meaning |
|---:|---:|---|---|
| 1 | 44 | varint | **PROVEN** mode/map compound ID |
| 2 | 44 | varint | **PROVEN** battle Unix timestamp |
| 3 | 44 | varint | **PROVEN** winner team (1/2) |
| 4 | 44 | varint | **PROVEN** finish reason |
| 5 | 44 | varint | **PROVEN/PARTIAL representation** common battle duration in integer-second result time |
| 8 | 44 | bytes | **PROVEN** replay-author result block |
| 9 | 44 | varint | **PROVEN** room type; value 2 throughout this training corpus |
| 11 | 44 | bytes | UNKNOWN; empty length-delimited value in all current samples |
| 150 | 44 | bytes | PARTIAL compound team/time-series/statistics block |
| 201 | 704 | bytes | **PROVEN** player/participant roster entries; may include observers/non-combatants |
| 301 | 616 | bytes | **PROVEN** settled combatant result entries; exactly 14 per replay here |
| 302 | 44 | bytes | PARTIAL per-entity/result extension block |
| 303 | 44 | bytes | PARTIAL two-integer build/config/protocol block; exact names unknown |

Independent Blitz parser evidence identifies root 1/2/3/8/9/201/301 with the same broad meanings.

## root 1 — mode/map compound

Current values are `0x00010000 + mapId` for the supplied Supremacy training-room corpus. The low 16 bits exactly match `meta.json#mapId`; the independent Blitz parser likewise documents the low two bytes as map ID and the next mode byte/flag as the battle gameplay mode.

Do not equate root1 with `arenaBonusType`; room/bonus type is carried separately.

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

It tracks settlement lifetime/common battle duration and differs fundamentally from `meta.json#battleDuration`, which is not a reliable canonical active-battle clock. Survivor `lifeTime` differs from root field5 only at the expected nearest-integer boundary in this corpus.

Verdict: common result-layer battle duration is `PROVEN`; the exact server-side symbol/quantization remains version-scoped.

## root 9 — room type

All 44 current files contain value `2`. Independent Blitz schema defines:

```text
0 Any
1 Regular
2 TrainingRoom
4 Tournament
5 QuickTournament
7 Rating
...
```

This matches the supplied training-room corpus and `meta.json#arenaBonusType=2`.

## root 201 — participant roster

Outer shape:

```text
field1 = account ID
field2 = PlayerInfo message
```

### Complete observed PlayerInfo field set

```text
1,2,3,4,5,6,7,8,9
```

| field | Presence | Verdict / meaning |
|---:|---:|---|
| 1 | 704/704 | **PROVEN** nickname |
| 2 | 704/704 | **PROVEN on current corpus** prebattle/training-room grouping ID; **not a platoon ID here** |
| 3 | 704/704 | **PROVEN** team |
| 4 | 672/704 | **PROVEN** numeric clan DB ID; absent where no clan DB ID is supplied |
| 5 | 672/704 | **PROVEN** clan tag |
| 6 | 704/704 | PARTIAL two-byte participant flags/state; `0000` dominates, `0001` occurs sparsely |
| 7 | 704/704 | **PROVEN** avatar/profile visual block |
| 8 | 554/704 | UNKNOWN/PARTIAL player/profile-related integer |
| 9 | 704/704 | **PROVEN/PARTIAL** participant rank/status field; exact mode-specific semantics version-scoped |

### Cross-surface identity proof

Subtype48 wrapper-1 contains the same participant snapshot in a richer live-arena form. Across all 704 roster records, the following equalities hold exactly where the corresponding field exists:

```text
#201 info f1  == wrapper1 player f3   nickname       704/704
#201 info f2  == wrapper1 player f10  prebattle ID  704/704
#201 info f3  == wrapper1 player f4   team          704/704
#201 info f4  == wrapper1 player f9   clan DB ID    672/672
#201 info f5  == wrapper1 player f8   clan tag      672/672
#201 info f7  == wrapper1 player f17  avatar block  684/684 where wrapper field is present
#201 info f9  == wrapper1 player f20  rank/status   704/704
```

This is stronger than name-based inference and provides a canonical mapping between settlement roster and the live arena participant snapshot.

### Important correction: field 2

An older independent Blitz parser described PlayerInfo field2 as a possible platoon ID. That interpretation does **not** fit this 11.19 training corpus: within each replay the value is shared by all 16/18 roster participants and changes between training-room groups/sessions. It also exactly matches wrapper-1 field10 for every participant.

Therefore for this version/corpus it is a **prebattle/training-room grouping identifier**, not a platoon membership key. Historical parsers must be version-scoped.

### Clan DB ID proof

Field4 separates the two seven-player teams by clan and follows observer clans as well. Example from one arena:

```text
G7   -> 26991 for all seven G7 combatants
CHRD -> 73116 for all seven CHRD combatants
```

and it matches wrapper-1 player field9 672/672. Combined with field5 clan tag, `clanDBID` is `PROVEN`.

### Roster cardinality

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
| 1 | 322/616 | **PROVEN** final `hitpointsLeft` / health result with signed sentinel states |
| 4 | 616/616 | **PROVEN** shots fired |
| 5 | 616/616 | **PROVEN** hits dealt |
| 6 | 238/616 | PARTIAL splash/HE-hit-family combat counter; exact Blitz symbol unresolved |
| 7 | 616/616 | **PROVEN** penetrations dealt |
| 8 | 614/616 | **PROVEN** damage dealt; omission represents protobuf default zero |
| 9 | 201/616 | **PROVEN/PARTIAL subtype** assisted damage family 1 |
| 10 | 130/616 | **PROVEN/PARTIAL subtype** assisted damage family 2 |
| 11 | 606/616 | **PROVEN** damage received; omission is default zero |
| 12 | 608/616 | **PROVEN** hits/shots received |
| 13 | 318/616 | **PROVEN** non-penetrating hits received |
| 14 | 2/616 | PARTIAL HE/splash-received-family counter; only two non-zero samples |
| 15 | 606/616 | **PROVEN** penetrations received |
| 16 | 340/616 | **HIGH-CONFIDENCE/PARTIAL** enemies spotted count; values 1–6 and historical result schema position agree |
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
| 105 | 246/616 | **PROVEN** death reason/alive sentinel field; encoded `-1` = alive, default/omitted = ordinary shot/default death, 1/2/3 validated special causes |
| 106 | 616/616 | **PROVEN** credits result used by current parser |
| 107 | 303/616 | **PROVEN/PARTIAL display semantic** matchmaking/rating float; independent parser names `mm_rating` |
| 116 | 176/616 | UNKNOWN/PARTIAL large integer result field |
| 117 | 403/616 | **PROVEN** damage blocked |
| 118 | 87/616 | UNKNOWN/PARTIAL combat/stat counter |
| 119 | 301/616 | UNKNOWN/PARTIAL small enum/counter (1/2/3 observed) |
| 120 | 147/616 | UNKNOWN/PARTIAL small enum/counter (1/2/3 observed) |

Protobuf omission must be interpreted according to the field's default semantics; absence is not automatically “data unavailable”.

## field 1 — final hitpointsLeft

This field is now closed rather than merely inferred.

For every one of the 44 replay authors, `root8(author).field1` exactly equals that author's corresponding `#301 -> info.field1`, including zero-by-omission and negative sentinels: **44/44 exact equality**.

The independent Blitz parser explicitly names root8 field1 `hitpoints_left`. In the full #301 corpus:

- all 237 survivors have a positive field1 value;
- ordinary dead vehicles typically omit field1, which protobuf-defaults to zero;
- 84 records contain signed `-3` and one contains `-2` special state;
- external schema evidence documents `-2` for auto-destroy/inactivity in the author result family; `-3` remains a signed terminal/special state whose exact reason must not be guessed.

Thus the field semantic is `PROVEN`, while the complete negative-sentinel enum remains `PARTIAL`.

## historical combat-result ordering evidence

Historical Wargaming result schemas independently contain the sequence:

```text
health, credits, xp, shots, hits, thits/he-hits, pierced, damageDealt,
damageAssistedRadio, damageAssistedTrack, damageReceived, shotsReceived,
noDamageShotsReceived, heHitsReceived, piercedReceived, spotted, damaged,
kills, ... mileage, lifeTime, killerID, ...
```

The current Blitz protobuf field layout preserves many of these positions exactly (1,4–18,24,25), which is useful independent evidence. It is **not** permission to auto-name every remaining field solely from the 2013 PC schema; current Blitz validation is still required before `PROVEN` promotion.

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

An independent Blitz protobuf implementation declares field107 as a float matchmaking/rating value (`mm_rating`) and documents client display conversion for that schema family. The current corpus also observes field107 exclusively as float32.

Verdict: wire type and rating-family semantic are `PROVEN`; whether a particular WotBTools product should expose it is outside protocol research scope.

## root 302

Root302 appears exactly once per replay and contains repeated field1 records. Each child record has:

```text
field1 = entity/result ID
field2 = nested sparse result/achievement extension message
```

The child field1 values resolve to current battle entity/result IDs. Nested field2 contains sparse small counters/enums and repeated tiny `{id,value}` messages. This proves root302 is a **per-entity post-battle extension/result block**; exact achievement/mission/ribbon field names remain `PARTIAL`.

It must not be discarded simply because WotBTools currently does not consume it.

## root 303

Root303 appears exactly once per replay and contains exactly two integer fields. Values are stable across many files and appear build/config/protocol-like rather than player statistics. Exact semantic names remain `UNKNOWN/PARTIAL`.

## Author block (root 8)

Independent parser evidence confirms this is the replay author's personal result block. In this corpus it mirrors the same core combat fields used by #301 and additionally contains an author-only field122 (2-byte length-delimited value) absent from the general result records.

WotBTools must keep root8 separate from the full 14-player `#301` dataset; author-only fields cannot be generalized to every participant unless the corresponding `#301` field is independently found.

## root 150

Root150 is a large compound block present once per replay. Its observed top-level fields are:

```text
8,9,10,12,13,14,15,16,17,20,21,22,23,25,26,107,114
```

Fields 20/22 and 21/23 are large paired byte blocks; field114 is repeated. Existing protocol probes show team/player time-series/statistical content inside this surface. Complete semantic naming remains `PARTIAL`; structural preservation is mandatory.

## Research requirements for unresolved settlement fields

Before promoting PlayerInfo 6/8, PlayerResultsInfo 6/14/16/116/118/119/120, or root 11/150/302/303 subfields:

1. correlate values against already-known settlement/event facts across all players;
2. compare duplicate POVs of the same arena (server settlement values should match);
3. search independent Wargaming/Blitz schema sources;
4. use controlled replay contrasts where a single combat fact changes;
5. record counterexamples and protobuf omission behavior.

Until then they remain first-class raw fields with `UNKNOWN/PARTIAL` semantics, not discarded data.
