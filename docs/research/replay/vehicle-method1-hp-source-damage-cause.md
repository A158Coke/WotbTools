# Vehicle method1 — live HP + damage source + cause family

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Numeric Type8 method IDs are entity-class and client-version scoped. This note describes Vehicle-targeted method1 with the current fixed 7-byte args.

## Wire structure

All current records use:

```text
currentHpRaw : u16 LE
sourceEntity : u32 LE
causeFlag    : u8
```

Canonical corpus:

```text
records : 3,471
```

## `currentHpRaw` closure

Vehicle Type7 property3 is independently proven as current HP / terminal sentinel.

For every method1 event, at the exact same vehicle entity and exact same replay raw clock:

```text
method1.currentHpRaw == Vehicle property3 raw16
3,471 / 3,471
```

This includes positive HP and the terminal/sentinel family:

```text
0x0000 -> 0
0xFFFF -> -1 signed sentinel
0xFFFD -> -3 signed sentinel
```

Verdict:

> `currentHpRaw` = **the same current-HP/terminal-state value carried by Vehicle property3 — PROVEN**.

Method1 therefore supplies a richer attribution record at selected HP transitions, while property3 remains the authoritative full HP state stream.

## `causeFlag=0` — direct weapon damage

For 3,225 method1 records with `causeFlag=0`, a same-clock Vehicle method8 direct-damage RPC exists on the same victim entity.

The source identity closes exactly:

```text
method1.sourceEntity == method8.attackerEntity
3,225 / 3,225
```

Verdict:

> `causeFlag=0` = **ordinary/direct weapon-damage cause family — PROVEN current corpus**.

The method1 HP value is still preferable to the raw numerical damage scalar inside method8 for resulting current HP.

## Special-cause closure against authoritative settlement

Settlement `PlayerResults.field105` is independently proven as the final death-reason field:

```text
0/default = ordinary/default shot death
1         = fire
2         = ramming
3         = world collision
```

For every terminal method1 death record that can be joined to settlement in the canonical corpus:

```text
settlement ordinary/default : 276 -> method1 causeFlag=0 : 276 / 276
settlement fire             :   4 -> method1 causeFlag=1 :   4 / 4
settlement ramming          :   2 -> method1 causeFlag=2 :   2 / 2
settlement world_collision  :   1 -> method1 causeFlag=3 :   1 / 1
```

There are no cross-class counterexamples.

Thus the current cause mapping is:

```text
0 = direct/default weapon damage
1 = fire damage
2 = ramming / vehicle-collision damage
3 = world-collision / self-environment damage family
```

The flag3 label intentionally retains a family qualifier: settlement closes the only terminal sample as `world_collision`, while non-terminal flag3 events demonstrate the same self/environment source behavior but do not provide a separate exact server reason enum for every occurrence.

## Source-entity behavior for non-direct causes

The complete current event population gives another independent discriminator:

```text
causeFlag=1 fire:
  records                    : 64
  sourceEntity != victim     : 64 / 64

causeFlag=2 ramming:
  records                    : 96
  sourceEntity != victim     : 96 / 96

causeFlag=3 world/self env:
  records                    : 17
  sourceEntity == victim     : 17 / 17
```

This is exactly the expected attribution shape:

- fire retains another vehicle as the credited source/igniter;
- ramming identifies the other vehicle involved in the collision;
- world/self-environment damage carries the victim itself as the source-side entity.

The two settlement ramming deaths are additionally supported by Vehicle method4 vehicle-to-vehicle collision contact shortly before terminal HP.

## Safe damage/death reconstruction hierarchy

```text
Vehicle property3
  -> full authoritative observed current-HP timeline

Vehicle method1
  -> selected HP transition
  -> exact live sourceEntity
  -> damage cause family

Vehicle method8
  -> direct attack protocol identity/detail

Vehicle method4
  -> vehicle-to-vehicle collision contact geometry

Vehicle method6
  -> static/world collision contact geometry when observed

settlement field105
  -> authoritative final death reason
```

Method1 materially improves live reconstruction because non-direct HP losses no longer need to be inferred solely from timing proximity.

## Consumer model

```text
VehicleHpAttributedEvent {
    rawClockSec
    victimEntityId
    currentHpRaw
    sourceEntityId
    causeFlagRaw
    cause:
      DIRECT
      FIRE
      RAMMING
      WORLD_OR_SELF_ENVIRONMENT
}
```

Recommended confidence for Blitz 11.19 China:

```text
0 DIRECT                    PROVEN
1 FIRE                      PROVEN
2 RAMMING                   PROVEN
3 WORLD_OR_SELF_ENVIRONMENT PROVEN family / PARTIAL exact non-terminal subtype
```

## Production value

This surface is directly useful for:

- exact death-time reconstruction;
- fire-DOT attribution to the original attacker;
- ramming attribution before final settlement is consumed;
- distinguishing direct-shell HP loss from collision/environment loss;
- AI Review explanations that need the physical cause of an HP transition.

Do not infer a numerical damage amount from method8 raw values when the before/after HP state is available; derive observed HP loss from the authoritative HP stream.
