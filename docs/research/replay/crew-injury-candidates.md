# Crew-injury wire candidates

> Corpus: 34 arenaId-deduplicated Blitz 11.19 China replays.
>
> Purpose: isolate the replay surface behind First Aid Kit without promoting frequency/timing guesses to production semantics.

## Executive verdict

The current corpus proves the consumable wire assignment `0x0C = First Aid Kit`, but does **not yet prove the exact wire code for a specific injured crew member**.

Five First Aid Kit activations are present in the strict 34-arena corpus. All five occur shortly after a real Vehicle method8 damage event, but no persistent Vehicle property or symmetric Type32 restore event uniquely identifies crew injury.

Current strongest candidate surface:

```text
Type32 mobile flag=1 short-body hit family
```

with First-Aid-associated observed bodies:

```text
a18027
a029
a029
a18029
a1802b
```

These bodies must remain protocol values until their packed subfields are independently closed.

## Exact First Aid timing

For the five `0x0C state=2` activations, the preceding same-entity damage method8 occurs approximately:

```text
1.183 s before activation
2.117 s before activation
1.216 s before activation
1.601 s before activation
0.801 s before activation
```

Thus 5/5 First Aid activations are preceded within 0.8–2.2 seconds by a real observed hit/damage event.

This is strong association evidence, but timing alone is not enough to name a crew packet.

## `prop8` is not the canonical crew-injury state

The Vehicle prop8 snapshot at the exact First Aid activation clock is:

```text
01 20
00
00
01 23
01 20
```

Therefore:

- only 2/5 activations have token `0x20`;
- 3/5 have no `0x20` at all;
- prop8 cannot be used as the canonical injured-crew state;
- `0x20 = crew member` is NOT PROVEN and must not enter production decoding.

## Method8 coarse fields are not crew-specific

After stripping the method8 argument-length prefix, all five First Aid-associated method8 packets contain:

```text
args[8]  = 0x01
args[9]  = 0x03
args[10] = 0x02
```

However, the same triple occurs in **904** method8 records across the corpus:

```text
no recovery consumable within 3 s : 790
0x0B Multi-Purpose Restoration   : 88
0x0D Repair Kit                  : 21
0x0C First Aid Kit               : 5
```

Therefore `(1,3,2)` is a broad hit/damage family marker, not a crew-injury discriminator.

Likewise, the same-clock Type32 long companion `body[2] = 0x02` occurs in 2332 damage records and is not First-Aid-specific.

## Type32 short-body event-family split

Decoding each short body as 7-bit chunks reveals strongly different event families.

Same-clock Vehicle method8 association:

```text
low7 = 28 : 315 / 322  = 97.8%
low7 = 29 :   5 /   5  = 100%
low7 = 33 : 431 / 480  = 89.8%
low7 = 36 : 329 / 336  = 97.9%
low7 = 37 :   9 /   9  = 100%

low7 = 32 : 696 / 1102 = 63.2%
low7 = 40 :1119 / 1884 = 59.4%
low7 = 41 : 136 / 494  = 27.5%

low7 = 42/44/47/... : approximately 0% same-clock method8
```

Verdict:

> Type32 short bodies contain both hit/damage-synchronous event families and non-hit control/state families. The first 7-bit group behaves like an event/category discriminator, but its exact symbolic mapping remains PARTIAL.

Historical Wargaming client code independently uses `showVehicleDamageInfo(vehicleID, damageIndex, extraIndex, entityID, equipmentID)` and includes `TANKMAN_HIT`, `TANKMAN_HIT_AT_SHOT`, and `TANKMAN_RESTORED` damage-code families. This is strong structural precedent, but old numeric indices must not be copied onto Blitz 11.19 without current-corpus closure.

## First-Aid-associated packed families

The five First Aid hits map to these 7-bit chunk shapes:

```text
a029    -> (32, 0x29)  [2 samples]
a18027  -> (33, 0x00, 0x27)
a18029  -> (33, 0x00, 0x29)
a1802b  -> (33, 0x00, 0x2B)
```

Across all hit-synchronous occurrences, subsequent recovery-consumable observations within 3 seconds are:

```text
(32, 0x29): 0x0B=25, 0x0C=2, 0x0D=0
(33, 0x27): 0x0B= 7, 0x0C=1, 0x0D=0
(33, 0x29): 0x0B= 9, 0x0C=1, 0x0D=0
(33, 0x2B): 0x0B=11, 0x0C=1, 0x0D=1
```

The `0x27 / 0x29 / 0x2B` tail family is therefore strongly **First-Aid/all-purpose-restoration associated**, and is a plausible crew/tankman-extra family candidate.

It is NOT yet safe to assign:

```text
0x27 = commander
0x29 = gunner
0x2B = driver
```

or any other specific role. The single Repair-Kit-adjacent `(33,0x2B)` sample also demonstrates why consumable-choice correlation alone cannot serve as a symbolic decoder: one hit may create multiple simultaneous conditions, and the player may choose to repair only one of them.

## No symmetric restore packet at consumable activation

At the exact activation clock:

```text
0x0C First Aid Kit: 5/5 have no same-entity Type32 flag1 short restore event
0x0B Multi-Purpose Restoration: 366/369 have no such short event
0x0D Repair Kit: 209/210 have no such short event
```

Therefore the current replay does not reliably expose a simple symmetric:

```text
TANKMAN_HIT -> TANKMAN_RESTORED short packet
```

pair at consumable activation. Recovery must be reconstructed from the proven consumable activation and any independently proven state/property change; absence of a restore short event is normal.

## Safe current consumer contract

A production decoder must currently expose crew evidence conservatively:

```text
CrewDamageCandidate {
    rawClockSec
    entityId
    shortBodyRaw
    packedEventFamily   // numeric only, nullable
    packedTailFamily    // numeric only, nullable
    confidence          // candidate/partial
}
```

Do not expose a user-facing crew role until an independent current-version extra-index mapping or controlled replay sample closes it.

## Next closure experiments

1. obtain a controlled Blitz 11.19 replay where a known crew role is visibly injured and immediately healed;
2. capture several different known crew roles to separate `0x27 / 0x29 / 0x2B` candidates;
3. recover the current Blitz equivalent of `DAMAGE_INFO_CODES` and vehicle `extras[]` from version-matched client resources;
4. validate whether the short-body 7-bit groups correspond to `damageIndex`, an optional middle field, and `extraIndex`;
5. keep historical PC/older-Blitz schemas as structural evidence only until numeric identities close on current-version data.
