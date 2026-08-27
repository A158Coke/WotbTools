# subtype48 wrapper6 field3 — >50% kill-notification assister

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.

## Final verdict

> wrapper6 `field3` = **secondary kill-notification assister entity whose prior damage contribution exceeded 50% of the victim's actual initial HP — PROVEN current corpus**.

This is a per-kill notification/attribution surface. It is **not** the same mechanic as method12 baseType15 / settlement field119 Destruction Assistance, whose eligibility threshold is lower and whose result is a cumulative ribbon/stat counter.

## Proven wrapper6 death fields

Post-start wrapper6 records close as:

```text
field1 = victim vehicle/entity ID
field2 = killer vehicle/entity ID
field3 = optional >50%-damage assister entity
field4 = optional non-default deathReason
```

## Independent official gameplay rule

Wargaming introduced the assisted-destruction notification in Blitz 8.1 for cases where another player had previously damaged the destroyed vehicle by more than 51%.

In Blitz 9.3 the threshold was explicitly changed to:

```text
more than 50%
```

and the notification shows both the destroying player and the assisting player's name.

That official notification behavior is exactly the presentation responsibility represented by wrapper6 field3.

## Exact current-corpus damage-ledger validation

Earlier research could only estimate recorder contribution from method38 + observed HP deltas. That limitation is now removed by three independently proven current-version surfaces:

```text
Type5 vehicle materialization bytes[51..53)
    = current HP snapshot at materialization

Vehicle method1
    = currentHpRaw:u16 + sourceEntity:u32 + causeFlag:u8

PlayerResults
    initialActualHp = max(signed field1, 0) + field11
```

This allows the observed HP-loss ledger to be attributed to source entities without same-clock shooter guessing.

### Population

Canonical post-start wrapper6 deaths:

```text
total live wrapper6 deaths : 283
field3 present              :  46
field3 absent               : 237
```

### Positive population

For all 46 deaths with field3:

```text
field3 == highest-damage non-killer source : 46 / 46
field3 observed damage / actual initial HP > 0.50 : 46 / 46
```

Observed contribution ratio:

```text
minimum ≈ 0.50150  (50.150%)
median  ≈ 0.58540  (58.54%)
maximum ≈ 0.97311  (97.31%)
```

There is no positive sample at or below 50%.

### Negative population

For the 237 wrapper6 deaths with no field3, no reconstructable non-killer source crosses the official threshold:

```text
observed non-killer contribution > 50% : 0 / 237
maximum observed ratio                 : ≈49.21%
```

Hidden/AoI damage can make a negative case incomplete, so this inverse population is supporting evidence rather than the sole proof. The positive population plus official rule already closes the semantic identity.

## Why the old ~40% hypothesis was wrong

An earlier provisional research note used only three recorder-specific examples (~57%, ~58%, ~76%) and a user-supplied ~40% hypothesis. That evidence was sufficient to identify a secondary-assister family but not the threshold.

The official Blitz history provides the actual threshold:

```text
8.1  : >51%
9.3+ : >50%
```

Therefore:

> `field3 threshold ≈40%` — **REJECTED / SUPERSEDED**.

## Relationship to method12 baseType15 / field119

Do not merge these mechanics.

```text
wrapper6.field3
  per-kill displayed assister
  requires >50% prior damage

method12 baseType15 / PlayerResults field119
  cumulative Destruction Assistance statistic/ribbon
  current official eligibility uses >=25% damage before an ally destroys the target
```

A player can satisfy Destruction Assistance without qualifying for wrapper6 field3.

## Production-safe model

```text
KillFeedEvent {
    victimEntityId
    killerEntityId
    assisterEntityId?   // present when >50% prior-damage notification rule qualifies
    deathReasonRaw?
    rawClockSec
}
```

Safe uses:

- render the same secondary assister identity shown by the game kill notification;
- AI Review: distinguish killing blow from majority-damage assister;
- combat analysis: preserve >50% notification attribution separately from ordinary assist damage and Destruction Assistance ribbon counters.

The exact threshold should remain version-gated because Wargaming has changed it historically (51% -> 50%).
