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

A strict-corpus pass closes the relationship between live method12 baseType12 and settlement PlayerResults field118. New wrapper12 Supremacy capture-timeline evidence materially strengthens the historical **base-defense / dropped-capture-points** hypothesis, but still does not justify exact symbolic promotion without a controlled or schema-level closure.

### Recorder presence closure

Across the canonical 34 unique arenas:

```text
settlement field118 > 0        : 10 / 34 replay authors
method12 baseType12 present    : 10 / 34 replay authors
presence relation              : 34 / 34 exact
```

There are 12 live baseType12 RPCs in total. Their payload behavior is sparse:

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

The safe structural model remains:

```text
field118
  = final magnitude/statistic in one gameplay family

baseType12.count
  = cumulative battle-feedback/ribbon occurrences for that same family
```

That cross-surface relationship is **PROVEN current corpus**.

### Full settled-player distribution

Across the canonical 34-arena settlement set:

```text
settled combatants             : 476
field118 non-zero              : 63 / 476
positive range                 : 6 .. 283
```

This supports a genuine per-player battle statistic rather than an author/UI-only artifact.

### Not ordinary Supremacy victory points

PlayerResults fields32/33 are independently closed as victory/Supremacy points earned/seized. field118 does not reduce to either field:

- 6 / 10 field118-positive replay authors have both field32=0 and field33=0;
- other positive cases carry unrelated field32/33 magnitudes;
- baseType12 event clocks do not have a universal one-for-one join with wrapper13 realtime team-score changes.

Verdict:

> `field118/baseType12` is **not** the ordinary `victoryPointsEarned / victoryPointsSeized` surface.

### Wrapper12 changes the interpretation of capture evidence

Avatar method48 wrapper12 is now independently decoded as the realtime Supremacy base state machine:

```text
field1 = base index
field2 = owner team
field3 = capturing team
field4 = public/base capture progress
```

This provides the first direct capture-timeline control surface for field118 research.

The important gameplay rule is that a capturing vehicle can lose/reset its own capture contribution when it receives qualifying HP/module damage. Therefore this causal chain is plausible:

```text
enemy vehicle contributes capture points
→ recorder damages / critically affects that capturing vehicle
→ that vehicle's personal contribution is reset/reduced
→ public wrapper12 aggregate progress may drop, pause, or continue depending on other simultaneous capturers
→ recorder receives baseType12 feedback
→ field118 accumulates the magnitude of capture points defended/reset
```

This means a lack of a visible aggregate wrapper12 decrease at exactly the baseType12 clock is **not sufficient negative evidence** against `droppedCapturePoints`: wrapper12 is a public aggregate base-progress stream, while the reset rule acts on one capturer's personal contribution and other capturers may continue adding progress.

### Current event-level evidence

Of the 12 baseType12 RPCs, several occur immediately around recorder projectile/damage activity; examples include recorder projectile launches and victim method8 damage within roughly 0.0–0.1 seconds in the same local event cluster. Other baseType12 RPCs do not have a same-clock projectile, consistent with the method12 surface behaving as cumulative/UI feedback rather than a raw damage notification.

Separately, wrapper12 shows real capture-progress disruptions in the same battles, including high-to-low progress resets and interrupted enemy captures.

These observations are **compatible** with a base-defense statistic but do not yet identify which exact prior damaging event generated every baseType12 increment.

### Why simple aggregate-progress arithmetic does not close field118

Summing visible wrapper12 public progress drops does not equal field118 in several battles. This does not by itself reject dropped capture points because:

1. wrapper12 is aggregate base progress, not per-capturer contribution;
2. simultaneous capturers can continue to add while one player's contribution is reset;
3. packet sampling is roughly 0.5 s, so a reset and ongoing accumulation can be partially or completely hidden between samples;
4. a single combat event may affect more than one capturing vehicle in splash/multi-target situations;
5. method12 is a feedback counter, not guaranteed to be emitted at the exact server-side state-change sample.

Therefore these shortcuts are rejected:

```text
field118 == sum(all visible wrapper12 negative deltas)
baseType12 clock == exact wrapper12 reset packet clock
```

### Historical/cross-project candidate: droppedCapturePoints / base defense points

Independent Blitz/Wargaming statistics expose a distinct `dropped_capture_points` / base-defense statistic alongside ordinary `capture_points`. BlitzKit's current regular-tank-statistics format also preserves both `capturePoints` and `droppedCapturePoints` as separate persistent counters.

The current replay shape is highly compatible with that family:

```text
field118            = potentially large per-battle defense magnitude
baseType12.count    = small cumulative live feedback occurrence count
field118 presence   ↔ baseType12 presence exactly 34/34
wrapper12           = independently proven live base-capture state
```

Updated verdict:

> `field118/baseType12` = **base-defense / dropped-capture-points family — STRONG PARTIAL**.
>
> Exact current Blitz 11.19 symbolic identity `droppedCapturePoints` remains **NOT YET PROVEN**.

The earlier interpretation that wrapper12 non-decrease was strong evidence against this hypothesis is **SUPERSEDED**.

### Remaining closure target

The cleanest decisive validation is a controlled mobile replay where exactly one enemy captures a neutral/owned base and the recorder damages that capturer at a known contribution amount. Record:

1. wrapper12 progress before damage;
2. victim HP/module event;
3. wrapper12 progress after damage;
4. method12 baseType12 increment;
5. settlement field118.

Repeat with two simultaneous enemy capturers to distinguish personal reset magnitude from public aggregate progress.

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
