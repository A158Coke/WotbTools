# subtype48 wrapper6 field3 — secondary assist attribution

> Corpus: 34 unique Blitz 11.19.0 China arenas.
>
> Current verdict: **STRONG PARTIAL** for kill-feed/secondary-assister attribution; exact threshold rule remains unproven.

## Already-proven wrapper6 death fields

Post-start wrapper6 records close as:

```text
field1 = victim vehicle/entity ID
field2 = killer vehicle/entity ID
field3 = optional secondary participant/entity
field4 = optional non-default deathReason
```

The optional field3 is a current arena participant ID, never a duplicate killer in the observed samples, and overwhelmingly belongs to the killer's team. It is not the historical PC `equipmentID` field.

## New gameplay hypothesis supplied for controlled validation

A current Blitz gameplay rule was identified for follow-up validation:

> a kill notification may include an assister's name when that player contributed more than roughly 40% of the victim's damage.

This rule is treated as a **testable hypothesis**, not as protocol truth.

## Recorder-specific cross-check

Within the strict 34-arena corpus, there are three post-start deaths where:

```text
wrapper6.field3 == recorder vehicle entity ID
```

For all three, the recorder had independently observed direct HP-loss contribution against that victim before the allied kill. Using current recorder method38 hit-feedback joined to victim Type7 prop3 HP deltas, the observable contribution ratios are approximately:

```text
~57%
~58%
~76%
```

Thus:

```text
field3 == recorder and observed contribution < 40% : 0 samples
field3 == recorder and observed contribution > 40% : 3 / 3 samples
```

This is consistent with the kill-feed assister hypothesis.

## Why this is not yet PROVEN

The inverse condition cannot be validated from a single POV replay corpus:

- other players' exact per-shot HP attribution is incomplete;
- same-clock team focus can make a victim HP delta larger than the recorder's own shot contribution;
- the current event stream does not provide an authoritative full damage ledger for every non-recorder attacker;
- therefore `field3 != recorder` cannot be used to conclude that the recorder failed a particular percentage threshold.

For this reason the exact rule must not yet be encoded as:

```text
field3 = player whose damage > 40%
```

## Safe current semantic

The strongest safe interpretation is:

> wrapper6 field3 = **secondary kill attribution / displayed assister candidate — STRONG PARTIAL**.

This is materially narrower than the previous generic `secondary combat-attribution entity` interpretation, but the exact eligibility/selection rule remains unresolved.

## Controlled replay needed for closure

Use a training-room target with known initial HP and two attackers. Produce separate replays where the non-killer contributes approximately:

```text
30%
39%
40%
41%
50%+
```

Then let the same teammate deliver the killing shot. Record whether the non-killer's name appears in the in-game destruction notification and whether wrapper6 field3 equals that player's vehicle entity ID.

If the transition is clean around one threshold, promote the threshold and field3 symbolic meaning together.
