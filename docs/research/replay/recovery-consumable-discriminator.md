# Recovery-consumable discriminator — crew vs module vs fire

> Corpus: strict 34 unique-arena Blitz 11.19 China replay set.
>
> This note records a gameplay-semantic discriminator supplied by observed Blitz consumable behavior and applies it conservatively to replay-wire hypotheses.

## Gameplay behavior used as discriminator

For the current Blitz behavior model:

- `0x0B` Multi-Purpose Restoration Pack clears **all negative effects**: crew injury, module negative states and fire.
- `0x0C` First Aid Kit clears **injured crew only**. Crew are modeled as injured/restored, not dead.
- `0x0D` Repair Kit clears **module negative states only**. It does not heal crew and does not extinguish fire.

This gives three useful supervised classes:

```text
cleared/associated with 0x0B + 0x0C, not 0x0D -> crew-injury candidate
cleared/associated with 0x0B + 0x0D, not 0x0C -> module-state candidate
terminated by 0x0B, not 0x0C/0x0D           -> fire candidate
```

The rule is evidence guidance, not permission to infer a state from consumable timing alone: one hit can create multiple simultaneous negative effects and the player may choose only one consumable.

## Consequence for Vehicle prop8

Vehicle `prop8` is a count-prefixed recoverable-state token collection. Existing exact-clock removal evidence strongly favors the **module-state subsystem**:

```text
token 0x21 removals:
  0x0B activation : 9
  0x0D activation : 9
  other           : 0
```

In contrast, the five First Aid activations do not expose a stable prop8 crew token:

```text
prop8 at 0x0C activation:
01 20
00
00
01 23
01 20
```

Only 2/5 contain `0x20`; 3/5 have no such token. Therefore prop8 must not be used as the canonical injured-crew collection.

Current verdict:

> Vehicle `prop8` = recoverable negative-state collection with strong **module-state** evidence; specific token names remain PARTIAL.

## Consequence for Type32 short hit families

The strongest current crew-injury candidates remain Type32 mobile `flag=1` short-body hit families associated with First Aid use:

```text
a029
a18027
a18029
a1802b
```

Observed recovery-consumable association within 3 seconds:

```text
(32, 0x29): 0x0B=25, 0x0C=2, 0x0D=0
(33, 0x27): 0x0B= 7, 0x0C=1, 0x0D=0
(33, 0x29): 0x0B= 9, 0x0C=1, 0x0D=0
(33, 0x2B): 0x0B=11, 0x0C=1, 0x0D=1
```

The first three families fit the crew-vs-module discriminator cleanly. The single `0x0D`-adjacent `(33,0x2B)` sample is not sufficient to reject the crew hypothesis because simultaneous module + crew damage can make Repair Kit usage adjacent to a crew event.

Verdict:

> `0x27 / 0x29 / 0x2B` short-tail families remain **crew/tankman-extra candidates — PARTIAL**, now with a stronger consumable-class discriminator.

They must not yet be mapped to commander/gunner/driver/loader roles without a controlled known-role injury sample or version-matched extras mapping.

## Mobility interpretation constraint

Movement behavior must not conflate ordinary track damage with track destruction.

- ordinary track damage: no required mobility penalty;
- track destroyed/broken: vehicle loses movement until repaired/restored;
- engine damage or driver injury: produces noticeable mobility degradation but is not necessarily an instantaneous hard stop.

Therefore a speed drop can support a **severe mobility-disabled state**, but cannot by itself label an ordinary track-damage token.

For token `0x21`, current onset samples show a strong mobility collapse and all closed removals are via `0x0B/0x0D`, not First Aid. This makes `0x21` a strong **mechanical severe-mobility-state** candidate and argues against driver injury. Exact identity (track destroyed vs engine destroyed/critical) remains PARTIAL.

## Safe decoding guidance

Until token identities close:

```text
NegativeStateEvidence {
    entityId
    rawClockSec
    surface        // prop8 / Type32 short / hit-result list
    tokenRaw
    stateRaw
    classCandidate // CREW / MODULE / FIRE / UNKNOWN
    confidence
}
```

Do not expose specific component or crew-role names solely from timing or speed correlation.
