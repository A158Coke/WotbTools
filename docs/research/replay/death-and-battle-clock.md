# Death, lifetime and battle-clock protocol research

> Scope: WotBTools real replay corpus used during 2026-08-26/27 research, primarily Blitz 11.18/11.19. 34 unique arena IDs are the canonical production-equivalent corpus; pre-dedup multi-POV duplicates are used only for protocol cross-validation.

## Verdict matrix

| Fact | Verdict | Evidence summary |
|---|---|---|
| player result field 24 = `lifeTime` | PROVEN | 476/476 player results present; survivor/death timing and independent result-layout evidence close the field. |
| player result field 25 = `killerID` | PROVEN | present for dead players/default-omitted for survivors; maps to valid result/entity IDs; normal hostile kills and self-attributed world-collision sample close behavior. |
| player result field 105 = `deathReason` | PROVEN | values cross-validated against live terminal cause and Wargaming attack-reason family. |
| `deathReason=1` = fire | PROVEN current samples | 4/4 current fire deaths close to live method1 causeFlag=1. |
| `deathReason=2` = ramming | PROVEN current samples | 2/2 current ramming deaths close to method1 causeFlag=2 and nearby Vehicle method4 vehicle-contact evidence. |
| `deathReason=3` = world_collision | PROVEN current sample | 1/1 current sample closes to method1 causeFlag=3 with self/environment source behavior. |
| Type7 Vehicle prop3 = current HP | PROVEN | absolute HP plus terminal sentinel family; current corpus closure. |
| Vehicle method1 = live HP + source + cause family | PROVEN | 3471/3471 HP word equals same-clock prop3; direct subset source closes to method8 attacker; flags 1/2/3 close fire/ramming/environment. |
| single-POV precise sub-second death exists for every dead player | FALSE | canonical 34 arenas contain 287 deaths; 283 have live terminal clock and 4 have no live death surface in that POV. |
| canonical single-POV sub-second death coverage | PROVEN current corpus | 283/287 = **98.61%**; remaining 4 require settlement-second fallback. |
| `lifeTime` is nearest-integer battle-relative lifetime, not floor | PROVEN current corpus | period-3 battle-start anchor plus precise death samples center residuals around nearest integer rather than floor. |

## Vehicle method1 live death/cause surface

Current Vehicle-targeted method1 is a fixed 7-byte live state body:

```text
currentHpRaw : u16 LE
sourceEntity : u32 LE
causeFlag    : u8
```

Across the canonical 34 arenas:

```text
method1 records                         : 3,471
currentHpRaw == same-clock prop3 raw16  : 3,471 / 3,471
```

For supported direct-damage records:

```text
causeFlag = 0
sourceEntity == Vehicle method8 attacker : 3,225 / 3,225
```

Terminal method1 events joined to settlement death reason close exactly in the current corpus:

```text
ordinary/default shot death : 276 -> causeFlag 0   276 / 276
fire                        :   4 -> causeFlag 1     4 / 4
ramming                     :   2 -> causeFlag 2     2 / 2
world collision             :   1 -> causeFlag 3     1 / 1
```

Non-terminal samples preserve the same physical family:

```text
causeFlag 1 fire-family samples      : 64/64 sourceEntity != victim
causeFlag 2 ramming-family samples   : 96/96 sourceEntity != victim
causeFlag 3 environment/self samples : 17/17 sourceEntity == victim
```

Current safe cause map:

```text
0 = direct/default combat damage
1 = fire
2 = ramming
3 = world/self-environment collision family
```

This is a live-stream source; settlement remains authoritative for final `killerID` and final `deathReason` when available.

## Canonical single-POV death-time coverage

The canonical 34-arena settlement contains:

```text
dead settled combatants : 287
```

Live terminal coverage:

```text
with Type7 prop3 terminal      : 283 / 287
with Vehicle method1 terminal  : 283 / 287
with both live surfaces        : 283 / 287

EVENT_SUBSECOND coverage       : 98.61%
```

The remaining four deaths were checked against other plausible live surfaces:

```text
terminal prop3 near death      : absent
terminal Vehicle method1       : absent
wrapper6 vehicle-killed feed   : absent
useful Type33 removal at death : absent
```

All four are ordinary/default-shot deaths in settlement. Their absence across multiple independent packet families means this is not a decoder-specific gap. The single recorder POV simply did not contain a usable live terminal death observation for those remote entities.

Therefore the production-safe precision model is:

```text
283 / 287 deaths
  -> EVENT_SUBSECOND
  -> precise replay raw clock available

4 / 287 deaths
  -> SETTLEMENT_SECOND
  -> use authoritative lifeTime integer
  -> approximately ±0.5 s quantization uncertainty
```

A parser must not invent sub-second timestamps for the four fallback cases.

## Why 100% sub-second precision is impossible from one POV in this corpus

The four uncovered deaths do not expose an alternative packet that can be decoded into the missing time. They are a physical observation/AoI coverage limitation.

Consequently:

> **100% sub-second death timing from every single `.wotbreplay` POV is not achievable for the canonical corpus.**

Two valid strategies remain:

1. accept explicit `SETTLEMENT_SECOND` fallback for uncovered players;
2. when multiple POV recordings of the same `arenaUniqueId` exist, fuse them after battle-clock alignment and use another POV's live terminal event when available.

This is a data-availability boundary, not an invitation to synthesize a timestamp.

## Canonical time domains

WotBTools must distinguish:

1. **raw replay clock** — packet `f32` timestamp in `data.wotreplay`;
2. **client-observed battle start** — wrapper3 arena-period transition to `BATTLE`;
3. **server battle-relative lifetime** — settlement `lifeTime`, nearest-integer seconds.

Conceptually:

```text
preciseBattleRelativeSec ~= rawClockSec - serverBattleStartRawClock
lifeTimeSec              = nearestInteger(preciseBattleRelativeSec)
```

The period-3 packet is a direct protocol anchor. Small client/network timing differences remain sub-second.

## Multi-POV validation

The pre-dedup corpus contains same-arena recordings from different players. Matching terminal deaths across POVs differ in raw clock by only small fractions of a second in observed samples, commonly below roughly 0.1 s after alignment.

Thus multi-POV fusion is viable for improving observation coverage, while `arenaUniqueId` deduplication must still ensure one physical battle is counted only once for Rating/aggregation.

## Precision model

A death fact must not be represented as an unqualified floating-point timestamp.

Recommended model:

```text
DeathFact
  accountId
  survived
  serverLifeTimeSec
  preciseEventRawClockSec
  battleRelativeExactSec
  lowerBoundSec
  upperBoundSec
  killerId
  deathReason
  source
  precision
  confidence
  evidence[]
```

Precision categories:

```text
EVENT_SUBSECOND
SETTLEMENT_SECOND
BOUNDED
UNKNOWN
```

`UNKNOWN` must never be replaced by a fabricated exact time.

## The former five UNKNOWN deaths

Production previously reported five dead players without reliable exact death time.

Research root cause:

- one (`Intotherainy`) uses a terminal `0xFFFE` state that older decoder logic treated as unknown; settlement + live terminal method1/prop3 evidence closes it;
- four have no live terminal death packet in the recorder POV and therefore require settlement `lifeTime` fallback.

Correct distinction:

- death fact is known from settlement for all validated dead players;
- sub-second live-event time exists for **283/287 (98.61%)**, not every player in one POV.

## Self-attributed death investigation

The sole `killerID == victim/self` case is not generic suicide/fire:

```text
settlement deathReason = 3
method1 causeFlag       = 3
sourceEntity            = victim/self
```

Verdict: world/self-environment collision death family.

## Consumer implications

### League Rating

Trade logic should consume a precision-bearing death fact. If an EVENT_SUBSECOND clock exists, use it. If only settlement-second precision exists, use interval reasoning and fail closed on ambiguous threshold boundaries.

### AI Review

Prefer exact event time when present. For fallback cases, state the settlement-backed second-level timing rather than inventing decimal precision. `killerID`, `deathReason`, method1 source/cause and collision/fire evidence should be canonical facts.

### Battle playback

Use live terminal time for 98.61% current-corpus deaths. For settlement-only cases, placing destruction at the server lifetime second is preferable to keeping the tank alive incorrectly, but source/precision must remain visible in the fact/DTO layer.

## Known implementation boundary

Protocol conclusions and production support are separate. Main-branch code must explicitly consume:

- wrapper3 battle-start/period events;
- Vehicle method1 HP/source/cause semantics;
- settlement fields 24/25/105;
- Type7 terminal sentinel family;
- precision-aware settlement fallback.

Missing implementation is not a reason to downgrade the protocol evidence.