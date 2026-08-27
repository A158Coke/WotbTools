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

The high byte changes at ribbon/progression boundaries and must not be treated as a different base event type.

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
  = cumulative feedback/ribbon occurrence count in one gameplay family

field118
  = final magnitude/statistic in that same gameplay family
```

This relation is **PROVEN current corpus**.

Across all 476 settled combatants:

```text
field118 non-zero : 63 / 476
positive range    : 6 .. 283
```

It is therefore a genuine per-player battle statistic rather than a recorder/UI artifact.

## Not ordinary Supremacy points

Fields32/33 are independently proven victory/Supremacy points earned/seized. field118 is distinct from both and can be non-zero when 32/33 are zero.

## Wrapper12 capture-state evidence

Wrapper12 is independently proven as the realtime Supremacy base state machine:

```text
field1 base index
field2 owner team
field3 capturing team
field4 capture progress
field5 capture suspended/blocked
field6 recorder capture-participation family
```

This makes a base-defense / dropped-capture-points interpretation structurally plausible, and current Blitz statistics expose a distinct dropped/base-defense point family separate from ordinary Supremacy scoring.

However, **the earlier Port/Harbor Town attribution chain was overstated**.

### Port sample — corrected evidence boundary

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

This is a strong **temporal association between baseType12 and a real enemy capture-reset episode**.

But the earlier archive text additionally claimed:

```text
235.214 recorder projectile
235.214 recorder -> enemy method8 damage
```

That recorder attribution is **NOT PROVEN**. Avatar method29 is a global projectile feed, and same-clock method8 records at this boundary do not resolve to the recorder as attacker under the current validated identity decoder. Treating all same-clock projectile/damage events as recorder-owned was an observation-attribution error.

Therefore the following stronger causal statement is **SUPERSEDED**:

```text
"the recorder shot the capturing enemy in this exact packet cluster"
```

What remains valid is:

```text
baseType12 feedback
+ enemy capture episode
+ public progress interruption/reset shortly afterward
+ positive field118 settlement magnitude
```

## Current verdict for field118/baseType12

The best hypothesis remains:

> `field118 / baseType12` = **base-defense / dropped-capture-points family — STRONG PARTIAL**.

It is **not** currently near-PROVEN because the clean recorder→capturer damage attribution has not been closed from current mobile packet identity.

Required promotion evidence:

1. a current-version schema naming field118; or
2. a controlled/single-capturer replay where recorder attacker identity is independently proven and the defender reset magnitude closes numerically; or
3. another current-mobile protocol surface directly linking baseType12 to a dropped-capture ribbon/stat name.

Until then production should preserve field118 and baseType12 as linked raw/base-defense-candidate facts rather than expose the exact label `droppedCapturePoints` as guaranteed.

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