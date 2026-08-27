# Avatar method12 — spotted and cumulative feedback counters

> Corpus: 34 unique Blitz 11.19.0 China arenas.
>
> This note records method12 counter families that are behaviorally closed, plus unresolved settlement relationships that still require current-version semantic proof.

## Wire shape

```text
eventCode : u16 LE
count     : u16 LE
value     : u16 LE

baseType = eventCode & 0xFF
tierRaw  = eventCode >> 8
```

The high byte changes at feedback/ribbon progression boundaries and must not be treated as a different base event type.

## baseType2 — enemies spotted

```text
final baseType2.count == settlement field16
15 / 15 arenas with non-zero observations
```

Verdict:

> method12 baseType2 = **cumulative enemies spotted — PROVEN**
>
> PlayerResults field16 = **enemies spotted — PROVEN current corpus**.

## baseType3 — kills

Final count closes to PlayerResults field18.

Verdict: **cumulative kills — PROVEN**.

## baseType1 / 5 / 17

```text
baseType1  -> cumulative damage dealt
baseType5  -> cumulative damage blocked
baseType17 -> cumulative total assist damage
               = assist subtype A + assist subtype B
```

Verdict: **PROVEN current corpus relationships**.

## baseType6

Two current samples align with proven FIRE_STARTED feedback.

Verdict: **enemy ignition / set-on-fire counter — PROVEN current samples / PARTIAL globally due low N**.

## baseType8 / 16

```text
baseType8  -> critical/module result inflicted family
baseType16 -> critical/device-damage received family
```

Exact ribbon/user-facing names remain PARTIAL.

# baseType12 and PlayerResults field118

## Cross-surface relationship — PROVEN

Across the canonical 34 arenas:

```text
settlement field118 > 0     : 10 / 34 replay authors
method12 baseType12 present : 10 / 34 replay authors
presence relation           : 34 / 34 exact
```

There are 12 live baseType12 RPCs:

```text
value : 0 in 12 / 12
count : cumulative 1..3
```

Positive author field118 values:

```text
12, 20, 32, 34, 48, 67, 103, 124, 124, 195
```

Therefore:

```text
field118 != baseType12.count
field118 != baseType12.value
```

Safe current structural model:

```text
baseType12.count
  = cumulative live feedback occurrence count in one gameplay family

field118
  = final magnitude/statistic in that same gameplay family
```

This cross-surface relation is **PROVEN current corpus**.

Across all 476 settled combatants:

```text
field118 non-zero : 63 / 476
positive range    : 6 .. 283
```

It is therefore a real per-player battle statistic rather than a recorder/UI artifact.

## Base-defense / dropped-capture-points hypothesis — REJECTED for this corpus

An earlier research path proposed:

```text
field118 / baseType12 == base-defense / droppedCapturePoints
```

That interpretation is no longer supportable.

### 1. Current official Blitz mode rule is incompatible

Current Wargaming Blitz ribbon documentation states that **Base defended** and **Capture assistance** ribbons are awarded in Encounter battles. The canonical corpus used here is Supremacy tournament/training-room combat, not Encounter.

Therefore a live baseType12 family occurring in 10/34 of these Supremacy replays cannot safely be identified as the current `Base defended` ribbon merely because capture-reset activity also exists in the battle.

Verdict:

> `baseType12 == Base defended ribbon` — **REJECTED / SUPERSEDED**.

### 2. Ribbon-tier thresholds do not match field118

The current official Base defended ribbon thresholds are based on dropped capture points:

```text
1..49   -> Common
50..79  -> Rare
80..99  -> Epic
100+    -> Legendary
```

If method12 `tierRaw` represented that ribbon tier and field118 represented dropped capture points, the two should be monotonically determined by these thresholds.

Actual recorder samples:

```text
field118  tierRaw observed
12        0
20        0
32        0
34        0
48        0
67        0
103       0
124       0   // one arena
124       1   // another arena
195       1
```

The same final `field118=124` appears with both `tierRaw=0` and `tierRaw=1`, and values above 100 do not map to a unique legendary-tier code.

Therefore:

> `tierRaw = Base defended tier derived from field118` — **REJECTED**.

### 3. Harbor Town temporal association remains correlation only

Replay:

```text
arenaUniqueId = 1161443361459633110
player        = CHRD-A158布丁
vehicle       = Maus
mapName       = port
```

Near the sole baseType12 increment:

```text
231.813  B owner=recorderTeam, enemy capturing, progress=3
232.305  progress=7
232.813  progress=10
233.314  progress=10, field5=1
235.114  method12 baseType12 -> count=1
235.314  B enemy capture progress resets to 0 / remains blocked
```

Final recorder settlement:

```text
field118 = 12
baseType12 final count = 1
```

This remains a real temporal association, but it is not causal proof of base defense. The same-clock projectile previously attributed to the recorder is independently proven to have a different shooter entity. Global projectile traffic must not be assigned to the replay author without shooter identity closure.

Thus the Harbor Town sequence is retained as correlation/negative-control history only.

## Current verdict for field118/baseType12

The exact symbolic gameplay identity is now:

> **UNKNOWN/PARTIAL semantic, PROVEN cross-surface relationship**.

What is safe:

```text
field118 > 0  <-> baseType12 present   // 34/34 authors
baseType12.count = cumulative occurrence count
field118 = separate final magnitude/statistic in same family
```

What is unsafe:

```text
field118 == droppedCapturePoints
baseType12 == Base defended ribbon
field118 thresholds determine tierRaw
```

Promotion now requires current-version schema/string/resource evidence or a distinct current-mobile behavioral invariant that is not mode-incompatible.

# baseType15 and PlayerResults field119 — Destruction Assistance

This family is closed.

## Final count equality

```text
final method12 baseType15.count == PlayerResults field119
34 / 34 arenas including zero-by-absence
```

## Ribbon-tier progression

Observed progression:

```text
1st eligible vehicle -> eventCode 0x000F, tierRaw 0, count 1
2nd                  -> eventCode 0x010F, tierRaw 1, count 2
3rd                  -> eventCode 0x020F, tierRaw 2, count 3
```

No counterexample occurs.

Current Blitz ribbon behavior independently defines **Destruction Assistance** for sufficient damage contribution followed by an allied destruction of the target, with ribbon tier increasing by eligible vehicle count. This explains why earlier "any prior hit" and "two direct attacks" heuristics were insufficient.

Verdict:

> method12 baseType15 = **cumulative Destruction Assistance eligible-vehicle count — PROVEN**
>
> PlayerResults field119 = **final Destruction Assistance count — PROVEN current corpus**.

Important distinction:

- wrapper6 field3 is a separate per-kill secondary attribution/assister surface;
- baseType15/field119 is a cumulative ribbon/statistic;
- the two must not be merged.
