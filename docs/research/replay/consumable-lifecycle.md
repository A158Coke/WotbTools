# Consumable lifecycle — Type32 mobile `flag=0` long bodies

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Scope: Type32 routed to Type5 `entityTypeId=2`, `flag=0`, 16-byte active/control bodies. Numeric mappings are version-scoped.

## Executive verdict

Type32 mobile `flag=0` long bodies expose an observed vehicle's **consumable lifecycle**:

```text
wireCode : body[2]
state    : body[3]
clock    : f64 LE body[4..12)
param    : f32 LE body[12..16)
```

For the closed families:

```text
state 1   -> initialized/available registration
state 2   -> activation/start
state 3   -> active duration ended / cooldown-state transition
state 255 -> entity/control teardown
```

`state=2` carries effective active duration for duration consumables and zero for instant consumables. `state=3` carries the effective cooldown configuration. Duration states close against real packet-clock intervals; instant states 2 and 3 occur at the same replay clock.

## Version-matched item-catalog closure

The repository's current consumable catalog independently supplies activation type, base duration and base cooldown. Matching those configurations against Type32 produces:

| wireCode | Proven identity | state2 param | state3 param | observed 2→3 closures |
|---:|---|---|---|---:|
| `0x09` | Adrenaline | 20.0 / 26.6 | 80.0 / 68.376 | 414 |
| `0x0A` | Engine Power Boost | 12.0 | 55.556 | 32 |
| `0x0B` | Multi-Purpose Restoration Pack | 0.0 | 100.0 / 85.470 | 368 |
| `0x0C` | First Aid Kit | 0.0 | 75.0 / 64.103 | 5 |
| `0x0D` | Repair Kit | 0.0 | 75.0 / 64.103 | 210 |
| `0x3D` | Improved Engine Power Boost | 15.0 / 19.95 | 65.0 / 55.556 | 167 |
| `0x3E` | Reticle Calibration | 20.0 / 26.6 | 55.0 / 47.009 | 111 |
| `0x42` | Reactive Armor | 10.0 | 55.556 | 11 |
| `0x69` | Tungsten Shells | 15.0 / 19.95 | 70.0 / 59.829 | 33 |

The catalog combinations are distinctive. For example, only Adrenaline has the common `20 s active / 80 s cooldown` pair, while Reticle Calibration is `20 s / 55 s` and Improved Engine Power Boost is `15 s / 65 s`.

The alternate duration values are exactly the `1.33x` High-End Consumables family:

```text
20.0 * 1.33 = 26.6
15.0 * 1.33 = 19.95
```

The alternate cooldown family is consistently approximately `0.8547x` base:

```text
100 -> 85.470
 80 -> 68.376
 75 -> 64.103
 70 -> 59.829
 65 -> 55.556
 55 -> 47.009
```

This proves that `param` carries effective battle configuration, not only catalog base values. The exact modifier stack responsible for the observed cooldown ratio should remain provenance-aware rather than being inferred from the number alone.

## `0x0C` / `0x0D` assignment closure

The earlier archive kept the `0x0C` / `0x0D` First Aid Kit / Repair Kit pair unresolved because cooldown/duration alone cannot distinguish the two instant consumables. The strict 34-arena corpus now provides an independent behavioral discriminator.

### `0x0D` clears Repair-Kit-compatible vehicle states

Type7 Vehicle prop8 exposes count-prefixed recoverable state-token snapshots. For observable token removals in the `0x21..0x26` family, every closed removal is aligned to either Multi-Purpose Restoration Pack `0x0B` or `0x0D` activation; `0x0D` accounts for many exact-clock clears, including all observed removals of some sparse tokens.

For example:

```text
prop8 token 0x21 removals:
  0x0B activation : 9
  0x0D activation : 9
  other           : 0
```

This establishes that `0x0D` operates the mechanical/Repair-Kit-compatible state subsystem.

### `0x0D` does not extinguish the proven fire-DOT family

Type32 mobile short `...04` is independently closed as fire-associated by 4/4 settlement `deathReason=1` fire deaths and repeated periodic HP-loss sequences.

Two observed cases use `0x0D` during an active `...04` fire sequence. In both cases, periodic small HP-loss ticks continue after activation at roughly 0.5-second cadence, with no corresponding direct-hit method8 event:

```text
example A:
  ...04 fire
  HP 1461
  0x0D activation
  HP 1407 -> 1362 -> 1326

example B:
  ...04 fire
  HP 2293
  0x0D activation
  HP 2236 -> 2188 -> 2149 -> 2120
```

Therefore `0x0D` is not another all-purpose restoration packet and does not extinguish fire in the observed corpus.

Verdict:

> `0x0D` = **Repair Kit — PROVEN behavioral identity** for Blitz 11.19 China current corpus.

### `0x0B` is the all-purpose restoration positive control

Among 14 observed `...04` fire sequences followed within 3 seconds by `0x0B`, 13/14 have no subsequent independent periodic HP-loss tick after activation once new direct-hit method8 events are excluded. The remaining case has one loss exactly at the activation clock, consistent with the already-in-flight fire tick.

Thus `0x0B` independently exhibits both:

- repair-state clearing; and
- fire extinguishing.

This behavior closes its catalog identity as **Multi-Purpose Restoration Pack** independently of cooldown matching.

### `0x0C` is First Aid Kit

The version-matched item catalog had already reduced the equal-duration/cooldown `0x0C` / `0x0D` pair to First Aid Kit and Repair Kit. Once `0x0D` is independently closed as Repair Kit, the remaining assignment is unique:

> `0x0C` = **First Aid Kit — PROVEN by pair elimination**.

Only five `0x0C` activations exist in the current corpus, so the exact replay property/method representing injured crew remains unresolved. Do not infer a crew token from mere timing proximity to those five uses.

Detailed fire/state evidence is archived in [`fire-and-repair-states.md`](fire-and-repair-states.md).

## Duration closure

Representative state2→state3 replay-clock deltas:

```text
0x09 standard : ~19.9 s for param 20.0
0x0A          : ~11.9 s for param 12.0
0x3D standard : ~14.9 s for param 15.0
0x3E standard : ~19.9 s for param 20.0
0x42          :  ~9.9 s for param 10.0
0x69 standard : ~14.9 s for param 15.0
0x0B/0x0C/0x0D: 0.0 s for instant actions
```

The roughly 0.1-second shortfall is consistent with replay/network tick sampling and does not change the configured-duration identity.

## Coverage boundary

Type32 is entity/AoI scoped. The corpus proves mobile flag0 coverage for all 540 distinct mobile entity occurrences, but consumers must still respect Type4→Type33 hidden intervals and replay truncation:

- a recorded activation is reliable for that observed entity;
- absence of an activation while an enemy is outside the client-observed set is not proof that it did not use a consumable;
- incomplete state2→state3 pairs near stream/entity boundaries must remain incomplete rather than synthesized.

## Safe consumer model

```text
ConsumableLifecycleEvent {
    rawClockSec
    entityId
    wireCode
    consumableCode       // version-gated proven mapping, nullable
    state                // 1 / 2 / 3 / 255
    eventClockRaw
    effectiveParamSec
}
```

Safe uses:

- AI Review: cite an observed Adrenaline, First Aid Kit, Repair Kit, Multi-Purpose Restoration Pack, Reticle Calibration, Reactive Armor, engine boost or Tungsten activation at a specific time;
- battle playback: show actual observed active windows and cooldown transitions;
- combat analysis: join Adrenaline windows to wrapper15 reload telemetry and recovery consumables to proven damage/state evidence;
- configuration inference: retain effective duration/cooldown without pretending the complete equipment loadout is known.

Do not expose raw wire codes to users when the version mapping is absent.

## Remaining work

1. locate and decode the direct crew-injury state surface underlying `0x0C` First Aid Kit;
2. map remaining initialization/teardown-only control prefixes;
3. validate code stability on Blitz versions outside 11.19 China;
4. close the exact cooldown modifier provenance against explicit equipment/configuration data;
5. correlate every mapped activation with wrapper15, Type31/Type39 and damage/module events;
6. implement only after version gates and AoI boundaries are part of the production contract.
