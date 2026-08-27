# Avatar method12 — spotted and cumulative feedback counters

> Corpus: 34 unique Blitz 11.19.0 China arenas.
>
> This note records the method12 counter families that are already behaviorally closed, plus unresolved settlement relationships that still require current-version semantic proof.

## Wire shape

Current Avatar method12 uses a fixed 6-byte body:

```text
eventCode : u16 LE
count     : u16 LE
value     : u16 LE

baseType = eventCode & 0xFF
tierRaw  = eventCode >> 8
```

`eventCode` high byte changes at feedback/ribbon progression boundaries and must not be mistaken for a different base event type.

## baseType2 — enemies spotted

For every arena where baseType2 is emitted, its final count equals PlayerResults field16 exactly.

```text
final baseType2.count == settlement field16
15 / 15 arenas with non-zero observations
```

Verdict:

> method12 baseType2 = **cumulative enemies spotted — PROVEN current corpus**
>
> PlayerResults field16 = **enemies spotted — PROVEN current corpus**

## baseType3 — kills

Final count closes to PlayerResults field18 / recorder kills.

Verdict: **cumulative kills — PROVEN**.

## baseType1 / 5 / 17

Previously closed relations:

```text
baseType1  -> cumulative damage dealt
baseType5  -> cumulative damage blocked
baseType17 -> cumulative total assist damage
               = assist subtype 1 + assist subtype 2
```

## baseType6

Two current samples align one-for-one with method38 FIRE_STARTED feedback.

Verdict: **enemy ignition / set-on-fire counter — PROVEN on current samples, PARTIAL globally due sample size**.

## baseType8 / 16

Current behavior strongly separates the two directions:

```text
baseType8  -> critical/module result inflicted family
baseType16 -> critical/device-damage received family
```

Exact user-facing counter names remain PARTIAL.

## baseType12 and PlayerResults field118

The live/result relationship is exact while the exact symbolic field name remains evidence-gated.

### Recorder presence closure

Across the canonical 34 unique arenas:

```text
settlement field118 > 0        : 10 / 34 replay authors
method12 baseType12 present    : 10 / 34 replay authors
presence relation              : 34 / 34 exact
```

There are 12 live baseType12 RPCs in total:

```text
baseType12 value          : always 0
cumulative count          : 1 .. 3
```

Positive author field118 values:

```text
12, 20, 32, 34, 48, 67, 103, 124, 124, 195
```

Thus:

```text
field118 != baseType12.count
field118 != baseType12.value
```

Safe structural model:

```text
field118
  = final magnitude/statistic in one gameplay family

baseType12.count
  = cumulative live feedback/ribbon occurrence count in the same family
```

This cross-surface relationship is **PROVEN current corpus**.

### Full settled-player distribution

Across the canonical 34-arena settlement set:

```text
settled combatants : 476
field118 non-zero  : 63 / 476
positive range     : 6 .. 283
```

### Not ordinary Supremacy points

PlayerResults fields32/33 are independently closed as victory/Supremacy points earned/seized. field118 is distinct from both.

## Port / Harbor Town clean defense-reset sample

A particularly valuable natural control is:

```text
arenaUniqueId = 1161443361459633110
player        = CHRD-A158布丁
vehicle       = Maus
mapName       = port
mapId         = 15
recorder team = 1
```

Later in the battle B is owned by team 1 and team 2 attempts to recapture it. Near the sole baseType12 increment:

```text
231.813  B owner=1, capturingTeam=2, progress=3
232.305  progress=7
232.813  progress=10
233.314  progress=10, auxiliary field5=1

234.714  recorder projectile / victim damage event cluster begins
235.114  method12 baseType12 -> count=1, value=0
235.214  recorder method29 projectile launch
235.214  enemy Vehicle method8 damage + HP reduction
235.314  wrapper12 B -> owner=1, capturingTeam=2, progress=0, field5=1
```

Final recorder settlement:

```text
field118 = 12
baseType12 final count = 1
```

This is the cleanest current-corpus closure for the historical base-defense interpretation:

```text
enemy actively capturing owned B
→ recorder damages enemy vehicle
→ baseType12 defense-family feedback increments
→ B capture progress resets to zero ~0.2 s later
→ settlement field118 records positive magnitude 12
```

The last visible public progress is 10 rather than 12; wrapper12 is a sampled aggregate base-progress stream, whereas dropped/base-defense points act on server-side personal capture contribution. A two-point difference is therefore not contradictory.

### Updated verdict

Combining the exact 34/34 presence relation, wrapper12 capture-state closure, the Port reset episode, and the distinct current Blitz dropped/base-defense statistic family supports:

> `field118 / method12 baseType12` = **base-defense / dropped-capture-points family — VERY STRONG PARTIAL, near-PROVEN behavioral identity**.

Exact current Blitz 11.19 symbolic identity `droppedCapturePoints` remains below PROVEN until another clean single-capturer defense sample closes the exact magnitude or a current schema names field118 directly.

## baseType15 and PlayerResults field119 — Destruction assistance

This family is now closed.

### Final count equality

Across all canonical arenas, including zero-by-absence:

```text
final method12 baseType15.count == PlayerResults field119
34 / 34
```

Positive author settlement values are only small integer counts (`1..3` in this corpus), and every live stream progresses monotonically by one eligible destroyed vehicle.

### Exact ribbon-tier progression

The method12 event code proves that the high byte is a ribbon/progression tier for baseType15.

Observed progression:

```text
first eligible vehicle:
  eventCode = 0x000F
  tierRaw   = 0
  count     = 1

second eligible vehicle:
  eventCode = 0x010F
  tierRaw   = 1
  count     = 2

third eligible vehicle:
  eventCode = 0x020F
  tierRaw   = 2
  count     = 3
```

Every current multi-increment stream follows this exact sequence; no counterexample occurs.

### Current Blitz ribbon definition

Wargaming's current Blitz ribbon documentation defines **Destruction assistance** as:

```text
player inflicts at least 25% of an enemy vehicle's HP
→ that vehicle is subsequently destroyed by the player's allies
```

Ribbon tiers are:

```text
1 eligible destroyed vehicle -> Common
2                            -> Rare
3                            -> Epic
4+                           -> Legendary
```

That is exactly the behavioral and tier shape observed for baseType15.

### Why earlier positive/negative analysis looked fuzzy

The previous 58-candidate test used replay-observable damage reconstructed from method8/HP observations:

```text
recorder attacked enemy
→ teammate later killed enemy
```

28 cases emitted baseType15 and 30 did not. Positive cases were much more contribution-heavy, but some reconstructed shares appeared below 25%.

That does not contradict the ribbon rule because the old damage estimator was observation-limited:

- an enemy may enter the recorder's observable HP stream after already taking recorder damage;
- AoI/visibility gaps can hide intermediate HP states;
- maximum observed HP is not guaranteed to be true battle-start HP;
- packet pairing can undercount damage around visibility/state boundaries.

The official 25% rule explains why simple "any prior damage" and "two hits" heuristics failed.

### Final verdict

> method12 `baseType15` = **cumulative Destruction assistance eligible-vehicle count — PROVEN current Blitz semantic identity**.
>
> PlayerResults `field119` = **final Destruction assistance count — PROVEN current corpus**.

The current 34 arenas demonstrate counts up to 3; the official ribbon definition predicts the next tier at 4+.

Important distinction:

- wrapper6 field3 remains a separate per-kill secondary attribution/assister surface;
- baseType15/field119 is the cumulative **Destruction assistance ribbon/statistic** governed by the ≥25% damage eligibility rule;
- these surfaces must not be merged.
