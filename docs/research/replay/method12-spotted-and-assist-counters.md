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

The same replay independently supplies a known single-capturer B episode for wrapper12 field6 validation.

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

The final recorder settlement contains:

```text
field118 = 12
baseType12 final count = 1
```

This is the cleanest current-corpus closure for the historical base-defense interpretation:

```text
enemy is actively capturing owned B
→ recorder fires / damages enemy vehicle
→ baseType12 defense-family feedback increments
→ public B capture progress is reset to zero ~0.2 s later
→ settlement field118 records a positive magnitude (12)
```

The visible wrapper12 progress immediately before the reset is `10`, not `12`. This difference does not invalidate the relation because wrapper12 is a sampled aggregate base-progress stream while defense points operate on individual capturer contribution/server state. The last visible public sample can lag the actual contribution at the damaging event.

### Important gameplay causality

A capturing vehicle losing HP or receiving qualifying module damage can lose/reset its personal capture contribution. Therefore the relevant causal path is:

```text
capturer personal contribution
→ qualifying recorder damage/module event
→ contribution reset/reduction
→ aggregate wrapper12 base progress reacts
→ live baseType12 feedback
→ field118 settlement magnitude
```

When multiple vehicles are capturing simultaneously, resetting one vehicle's contribution may be partly hidden by continued contribution from the others. Consequently, absence of a visible aggregate wrapper12 decrease is not valid negative evidence against this statistic.

### Updated verdict

Combining:

1. exact 34/34 presence relation between field118 and baseType12;
2. small live occurrence count vs larger settlement magnitude;
3. independently decoded wrapper12 Supremacy capture state;
4. the Port defense-reset sequence above;
5. historical/current Blitz result terminology exposing a separate dropped/base-defense capture statistic;

supports:

> `field118 / method12 baseType12` = **base-defense / dropped-capture-points family — VERY STRONG PARTIAL, near-PROVEN behavioral identity**.

Exact current Blitz 11.19 symbolic identity `droppedCapturePoints` is deliberately kept below PROVEN until either:

- a current-version schema names field118 directly; or
- another clean single-capturer defense sample closes the numerical magnitude against the exact pre-hit personal contribution.

The Port sample is sufficient to reject ordinary capture contribution, critical-hit count, kill count and ordinary Supremacy score as primary identities.

## baseType15 and PlayerResults field119

A separate exact relation is already proven:

```text
final method12 baseType15.count == PlayerResults field119
34 / 34 arenas including zero-by-absence
```

Realtime baseType15 increments cluster after allied destruction of enemy vehicles for which the recorder had prior combat involvement. It is not identical to wrapper6 field3.

### 58-candidate eligibility split

```text
recorder attacked enemy victim
→ later a recorder teammate killed that victim
```

Current split:

```text
baseType15 increment after kill : 28
no baseType15 increment         : 30
```

All 28 positives have at least two supported direct recorder attacks, but 17 negatives also do. Observable damage and recency separate the populations statistically but do not define a hard threshold.

Current safest model:

> `baseType15 / field119` = **assisted-destruction / combat-contribution feedback family with additional eligibility rule — PROVEN family-level / PARTIAL exact rule**.
