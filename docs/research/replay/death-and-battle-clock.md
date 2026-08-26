# Death, lifetime and battle-clock protocol research

> Scope: WotBTools real replay corpus used during 2026-08-26 research, primarily Blitz 11.18/11.19. 34 unique arena IDs were used for production-equivalent analysis; the pre-dedup corpus also contained multi-POV duplicates and was used only for protocol cross-validation.

## Verdict matrix

| Fact | Verdict | Evidence summary |
|---|---|---|
| player result field 24 = `lifeTime` | PROVEN | 476/476 player results present; all survivors in a battle share the terminal lifetime; 282 precise death events align after battle-clock normalization; Wargaming battle-results model independently contains `lifeTime` adjacent to `killerID`. |
| player result field 25 = `killerID` | PROVEN | present for dead players, absent for survivors in the corpus; maps to valid result/entity IDs; enemy attribution in normal kills and self attribution in the world-collision sample. |
| player result field 105 = `deathReason` | PROVEN | values cross-validated against terminal event shape and Wargaming attack-reason enum. |
| `deathReason=1` = fire | PROVEN on current samples | delayed terminal HP after hostile damage, consistent with FIRE semantics. |
| `deathReason=2` = ramming | PROVEN on current samples | killer is another vehicle, no direct-shot terminal notification, consistent with RAM. |
| `deathReason=3` = world_collision | PROVEN on current sample | unique self-attributed death; terminal attacker/self ID; no hostile direct damage at death; Wargaming enum index 3 = world_collision. |
| Type 7 `propId=3` = current HP | PROVEN | real absolute HP, terminal 0, positive values track observed health; existing protocol probes. |
| `0xFFFD` is death-associated terminal HP sentinel | PROVEN on current samples | terminal state co-occurs with destruction evidence. Name must not imply generic unknown HP. |
| `0xFFFE` can be terminal death state | PROVEN for the verified Intotherainy sample | settlement killer/lifetime, Type 7 sentinel, subtype-1 state and attacker all close the same death event. Global sentinel semantics still require more samples. |
| Type 8 subtype 1 carries health/state + attacker/killer relation | PROVEN on current death corpus | 282/282 known terminal events align with Type 7 terminal time; attacker/result ID matches settlement killer ID in the verified corpus. |
| Type 8 subtype 48 wrapper 3 = arena-period update | PROVEN on current samples | decoded period values match Wargaming `ARENA_PERIOD`; period 3 is battle. |
| `ARENA_PERIOD.BATTLE = 3` | PROVEN | Wargaming client enum. |
| `lifeTime` is nearest-integer battle-relative lifetime, not floor | PROVEN on current corpus | period=3 independent start marker + 204 precise death samples: residuals center around 0 within approximately ±0.5 s; floor model is shifted by ~0.5 s and rejected. |
| single-POV precise sub-second death exists for every dead player | FALSE | four verified deaths occur after the recorded event stream has already ended. Missing event evidence is physical data absence, not decoder failure. |

## Canonical time domains

WotBTools must distinguish three time concepts:

1. **raw replay clock** — the `f32` packet timestamp stored in `data.wotreplay`.
2. **client-observed battle start** — the raw timestamp at which the replay records the server arena-period transition to `BATTLE`.
3. **server battle-relative lifetime** — the settlement lifetime used by battle results and quantized to the nearest integer second.

The correct model is therefore not:

```text
rawClock == battleRelativeSec
```

but conceptually:

```text
preciseBattleRelativeSec ~= rawClockSec - serverBattleStartRawClock
lifeTimeSec = nearestInteger(preciseBattleRelativeSec)
```

The client-observed period-3 packet is a direct protocol anchor, but it can differ from the latent server start by network/recording jitter. Across the validated sample this jitter is sub-second and the death-derived start estimate aligns tightly with the period transition in aggregate.

## Multi-POV validation

The pre-dedup corpus contains several arenas recorded by different players. The same terminal death event across two POVs has raw-clock differences typically on the order of only a few hundredths of a second, generally below roughly 0.1 s in the observed sample.

Therefore multiple POVs can be fused onto one battle timeline after small alignment tolerance. They must still count as one battle for Rating and aggregation.

## Precision model

A death fact must not be represented as an unqualified `double`.

Recommended research model:

```text
DeathFact
  accountId
  survived
  serverLifeTimeSec       // settlement integer second
  preciseEventRawClockSec // when a terminal event exists
  battleRelativeExactSec  // only when start + event can be resolved sufficiently
  lowerBoundSec
  upperBoundSec
  killerId
  deathReason
  source
  precision
  confidence
  evidence[]
```

Suggested precision categories:

- `EVENT_SUBSECOND`: terminal replay event exists and maps reliably to the player.
- `SETTLEMENT_SECOND`: server `lifeTime` exists; semantic time uncertainty is approximately ±0.5 s due to nearest-integer quantization.
- `BOUNDED`: only an interval can be proven.
- `UNKNOWN`: evidence is insufficient; never fabricate a timestamp.

## The former five UNKNOWN deaths

Production previously reported five dead players without reliable exact death time.

Research root cause:

- one case (`Intotherainy`) has a terminal `0xFFFE` state that the current decoder treats as unknown; settlement killer/lifetime plus Type 8 subtype-1 closes the exact death event for this sample;
- four cases have no sub-second terminal death packet because their `data.wotreplay` event stream ends before the server settlement `lifeTime` at which they die.

Therefore the correct distinction is:

- **death is known from settlement for all validated dead players**;
- **sub-second replay-event death is not available for every player in a single POV**.

## Self-attributed death investigation

The single sample where `killerID == victim/self` is not a fire death.

Evidence:

- settlement `deathReason=3`;
- Wargaming `ATTACK_REASONS[3] = world_collision`;
- terminal state attributes attacker/result ID to self;
- no hostile direct-damage notification at terminal time;
- the player was still attacking an enemy shortly before destruction.

Verdict: self-attributed world-collision death, not a generic "suicide" label and not fire.

## Consumer implications

### League Rating

Trade logic should consume death facts/intervals, not force every participant to have a fake exact timestamp. If the interval proves whether an enemy death is within the 5-second trade window, the result can be deterministic. Ambiguous boundary cases must fail closed.

### AI review

AI facts should prefer precise event time when available and otherwise state settlement-second timing without pretending sub-second precision. `killerID` and `deathReason` should become canonical evidence to avoid inventing death cause.

### Battle playback

Playback should use `EVENT_SUBSECOND` for precise visual destruction when available. When only settlement lifetime exists, a server-backed second-level death is better than leaving the vehicle alive past its actual death, but the precision/source should remain explicit in the DTO/fact layer.

## Known code gaps in current main

At the time of this research, current main does not consume all validated evidence:

- `ReplayPacketStreamReader` reports `battleStartIdentified=false` and `battleStartRawClockSec=null` rather than consuming arena-period evidence.
- `EntityMethodDecoder` consumes subtype48 wrappers for roster and supremacy points but does not yet expose wrapper-3 arena-period events.
- subtype1 terminal health/killer semantics are not yet modeled as canonical events.
- player-result fields 24/25/105 are not yet modeled as canonical `lifeTime`/`killerID`/`deathReason` facts.
- the constant/comment around `0xFFFD` must be made semantically consistent with the decoder behavior.

These are implementation gaps, not reasons to downgrade the protocol conclusions above.
