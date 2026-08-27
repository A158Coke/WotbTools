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

Across the realtime stream, all 25 baseType2 count updates occur immediately around an enemy Type5 vehicle-visibility entry. 24/25 are the first observed entry of that enemy vehicle in the entire replay; the remaining sample sits on a visibility transition boundary.

The same field also occupies the expected result-layout position immediately before enemies-damaged and enemies-destroyed counters.

Verdict:

> method12 baseType2 = **cumulative enemies spotted — PROVEN current corpus**
>
> PlayerResults field16 = **enemies spotted — PROVEN current corpus**

This is a recorder contribution counter, not a count of every enemy that happened to become visible through team spotting; ordinary enemy re-entry does not necessarily increment it.

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

These are UI/battle-feedback mirrors of independently proven live/settlement counters.

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

A new strict-corpus pass closes the relationship between live method12 baseType12 and settlement PlayerResults field118, while also rejecting several overly simple semantic interpretations.

### Recorder presence closure

Across the canonical 34 unique arenas:

```text
settlement field118 > 0        : 10 / 34 replay authors
method12 baseType12 present    : 10 / 34 replay authors
presence relation              : 34 / 34 exact
```

There are 12 live baseType12 RPCs in total. Their payload behavior is unusually sparse:

```text
baseType12 value               : 0 / 12 non-zero
observed cumulative count      : 1 .. 3
one stream emits count=2 directly without an earlier visible count=1 RPC
```

The corresponding positive author field118 values are:

```text
12, 20, 32, 34, 48, 67, 103, 124, 124, 195
```

Therefore:

```text
field118 != baseType12.count
field118 != baseType12.value
```

The safest current model is:

```text
field118
  = final magnitude/statistic in one gameplay family

baseType12.count
  = cumulative battle-feedback/ribbon occurrences for that same family
```

That cross-surface relationship is **PROVEN current corpus**. The exact gameplay/stat name remains **PARTIAL/UNKNOWN**.

### Full settled-player distribution

The same field is not recorder-only. Across the canonical 34-arena settlement set:

```text
settled combatants             : 476
field118 non-zero              : 63 / 476
positive range                 : 6 .. 283
```

This supports a genuine per-player battle statistic rather than an author/UI-only artifact.

### Not ordinary Supremacy victory points

PlayerResults fields32/33 are already independently closed as victory/Supremacy points earned/seized. field118 does not reduce to either field:

- 6 / 10 field118-positive replay authors have both field32=0 and field33=0;
- other positive cases carry unrelated field32/33 magnitudes;
- baseType12 event clocks do not have a universal one-for-one join with wrapper13 realtime team-score changes.

Verdict:

> `field118/baseType12` is **not** the ordinary `victoryPointsEarned / victoryPointsSeized` surface.

### Nearby combat feedback is not an exact identity

Some baseType12 events share a clock with baseType8 critical/module feedback or occur near kills, but this is not universal. Therefore neither `critical hit count` nor `kill count` is supported as an exact semantic identity.

### Historical/cross-project candidate: base-defense magnitude

Independent Blitz tooling and Wargaming-facing result terminology expose separate `base_capture_points` and `base_defend_points` / `droppedCapturePoints` statistics in addition to Supremacy/victory-point fields. The observed field118/baseType12 shape is compatible with a family of that kind: a potentially large accumulated result magnitude paired with a small number of live feedback/ribbon occurrences.

However no current Blitz 11.19 field-level schema or controlled replay yet proves:

```text
field118 == baseDefendPoints / droppedCapturePoints
```

So that label remains a **candidate only** and must not be promoted into the production decoder.

### Controlled validation target

To close baseType12/field118 exactly, capture controlled replays that independently vary base interaction while minimizing damage/kill/module confounders, then compare:

1. base capture progress made;
2. enemy capture progress reset/defended;
3. live baseType12 increments;
4. settlement field118 magnitude;
5. fields32/33 and wrapper13 Supremacy points as negative controls.

## baseType15 and PlayerResults field119

A separate exact relation is already proven:

```text
final method12 baseType15.count == PlayerResults field119
34 / 34 arenas including zero-by-absence
```

Realtime baseType15 increments cluster after allied destruction of enemy vehicles for which the recorder had prior combat involvement. However it is **not identical** to wrapper6 field3.

### 58-candidate eligibility split

Using strict current-corpus vehicle method8 attacker/victim identity plus wrapper6 death records, the 34 arenas contain 58 cases with this shape:

```text
recorder attacked enemy victim
→ later a recorder teammate killed that victim
```

The split is:

```text
baseType15 increment after kill : 28
no baseType15 increment         : 30
```

Therefore the old broad hypothesis:

```text
"recorder damaged/attacked target and teammate later killed it"
```

is **REJECTED as sufficient eligibility**.

### Direct-attack count is necessary in this sample, not sufficient

For those 58 candidates:

```text
positive baseType15 cases: direct recorder attack count min = 2
negative cases:            direct recorder attack count min = 1
```

All 28 positives have at least two supported direct method8 attack events against the victim. But 17 negatives also have at least two such attacks.

Thus:

```text
>=2 direct attacks
```

is a useful discriminator in this corpus but **not** the exact rule.

### Observable damage and timing separate the populations but do not close a threshold

Using same-clock victim prop3 current-HP changes to estimate recorder-attributed observable damage:

```text
positive median observable damage ≈ 1119 HP
negative median observable damage ≈  418 HP
```

The positive population is therefore substantially more contribution-heavy. Time since the recorder's last supported direct attack to teammate kill also differs:

```text
positive median ≈  8.8 s
negative median ≈ 23.1 s
```

But neither dimension is a hard threshold:

- positive cases include long delays;
- positive observable damage share can be as low as roughly 11% of the victim's maximum observed HP;
- negative cases can exceed roughly 27% observable share;
- therefore neither a fixed recent-hit timer nor a simple `>40%` damage-share threshold explains baseType15.

This is especially important because wrapper6 field3 has a separate kill-feed secondary-attribution behavior and must not be used as a proxy for baseType15.

### Current safe interpretation

The strongest current model is:

```text
baseType15 / field119
= cumulative assisted-destruction / combat-contribution feedback family
  with an additional eligibility rule not yet recovered
```

Verdict:

> relationship to teammate destruction after recorder contribution: **PROVEN family-level**
>
> exact qualification rule / user-facing stat name: **PARTIAL**

Important distinction:

- wrapper6 field3 is an optional participant/entity attached to a specific vehicle-killed record and is a separate strong kill-feed assister candidate;
- method12 baseType15 is a cumulative recorder feedback counter;
- many baseType15 increments occur when wrapper6 field3 is another player, so the two surfaces must not be merged.

## Controlled validation target for baseType15

A later controlled corpus should independently vary:

1. non-killer damage share to the victim;
2. number of separate damaging hits;
3. time from last contribution to teammate kill;
4. tracking/spotting assist state;
5. whether the non-killer appears by name in the kill notification;
6. wrapper6 field3;
7. method12 baseType15 increment;
8. settlement field119.

This will determine whether field119 is a separate assisted-destruction/ribbon counter, a broader combat-contribution counter, or another kill-related feedback class.
