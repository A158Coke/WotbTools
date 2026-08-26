# Vehicle hit-resolution stream — Type8 Vehicle method8

> Corpus: 34 unique arenas, Blitz 11.19.0 China. This document prioritizes battle facts useful for replay reconstruction, AI Review and Battle Playback.

## Executive verdict

The common Vehicle-targeted Type8 `methodId=8` 21-byte argument variant is not merely a generic "damage number" packet. It is a **direct vehicle-hit / hit-feedback family**.

Current safe model:

```text
Type8 / Vehicle method8 / argLen=21

args[0..4)  : attackerEntityId  u32 LE
args[4..8)  : victimEntityId    u32 LE
args[8]     : constant 1 in current corpus
args[9]     : hit/result-category candidate
args[10]    : secondary hit/result-category candidate
args[11..]  : additional packed hit metadata, only partially decoded
args[20]    : small categorical flag, exact meaning PARTIAL
```

The outer Type8 target entity is the victim. For **3822/3822** current direct records:

```text
u32(args[4..8)) == outer targetEntityId
```

so the victim identity is redundantly encoded in the argument body.

## Hit-count closure against settlement

For each player, direct method8 records are grouped by attacker and replay `rawClock`; repeated records at one clock are counted as one observed hit event.

Across 476 player-game rows:

```text
settlement hits                       = 3788
observed unique attacker/method8 clock = 3775
```

Player-row comparison:

```text
exact equality : 445 / 476
under-count    :  19 / 476
over-count     :  12 / 476
```

The remaining differences are almost entirely very small:

```text
-3 : 1 row
-2 : 5 rows
-1 : 13 rows
 0 : 445 rows
+1 : 11 rows
+2 : 1 row
```

Pearson correlation between observed method8 hit-event count and settlement hits is approximately:

```text
r = 0.9947
```

Recorder-only validation is independently strong. Mapping `meta.json.dbid` to the matching settlement participant yields 34 recorder player-games:

```text
method8 hit-event count == settlement hits : 32 / 34
```

The two remaining recorder rows differ by `-2` and `+1` respectively.

Verdict:

> Vehicle method8 / 21-byte variant = **direct vehicle-hit / hit-feedback family — PROVEN behavioral identity** for the current corpus.

This supersedes wording that describes the method only as a generic damage notification.

## Raw protocol value is not authoritative HP loss

Although method8 is tightly associated with vehicle hits, its packed numeric bytes do not equal HP damage.

Authoritative observed HP loss remains:

```text
previous Type7 Vehicle prop3 currentHP
-
new Type7 Vehicle prop3 currentHP
```

Method8 supplies hit/attacker/victim/result metadata; Type7 prop3 supplies absolute HP state.

Consumers must not expose an arbitrary method8 raw integer as `damage`.

## Independent shot-lifecycle support

The projectile stream provides an independent hit/miss relationship:

```text
Avatar method29  -> observed projectile launch / shotId
Avatar method27  -> explodeProjectile environment/miss-resolution family
```

For each player:

```text
observed method29 launches - same-shot method27 events
```

tracks settlement hits very strongly. Across all 476 rows the correlation is approximately `0.966`; when observed launch count exactly equals settlement shots, the inferred-hit count has approximately `0.990` correlation with settlement hits and is exactly equal in the large majority of rows.

This supports the method8 closure from a separate protocol surface.

## Penetration/result candidate in `args[9]`

`args[9]` is a small categorical field with current values:

```text
0, 1, 2, 3, 4
```

Distribution over the 3822 direct records:

```text
0 : 133
1 : 224
2 : 168
3 : 2941
4 : 356
```

The `{3,4}` family is strongly associated with actual HP reduction when the victim's previous HP is observable.

With prior victim HP known:

```text
args[9] in {3,4}:
  same-clock HP loss     : 2695
  no same-clock HP update:  190

args[9] in {0,1,2}:
  same-clock HP loss     :   29
  no same-clock HP update:  293
```

Thus `args[9]` is strongly a **hit/damage-result category** rather than an arbitrary payload byte.

### Settlement penetration comparison

Counting direct method8 events with:

```text
args[9] in {3,4}
```

against settlement `penetrations` gives:

```text
exact player-row equality : 373 / 476
observed candidate total  : 3297
settlement penetrations   : 3415
```

Recorder-only comparison removes most AoI uncertainty:

```text
34 recorder rows:
exact equality : 26
-1             :  7
-2             :  1
positive over-counts: 0
```

This is strong evidence that values `3/4` belong to a penetration/damaging-hit result family, but it is not yet enough to assign exact symbolic enum names or prove that every settlement penetration is represented solely by this predicate.

Verdict:

> `args[9] in {3,4}` = **penetration/damaging-hit result family candidate — PARTIAL (strong)**.

Do **not** yet implement `penetrated = args[9] == 3 || args[9] == 4` as an unconditional cross-version production rule.

## Rejected overfit rule

A brute-force statistical search can improve settlement agreement by combining unrelated categorical conditions, for example adding an `args[10] == 0` branch. That rule produces very high aggregate agreement but fails the independent HP-behavior test: many such additional records have no HP change.

Therefore statistical fit alone is insufficient. The archive explicitly rejects using such an OR rule as protocol semantics.

## Safe battle reconstruction today

For a supported observed direct hit:

```text
HitEvent {
    rawClockSec
    attackerEntityId
    victimEntityId
    resultCategoryRaw      // args[9], retain raw/version-gated
    secondaryCategoryRaw   // args[10]
    packedMetadataRaw
}
```

Join with Type7 prop3:

```text
HitEvent + HP delta > 0
  -> observed damaging hit with exact HP loss

HitEvent + no HP reduction
  -> observed hit with no observed HP damage
     (ricochet / non-penetration / module-only / other result remains to be decoded)
```

The second branch must not be labelled `ricochet` until the result enum is closed.

## Next combat priorities

1. close the exact symbolic meaning of method8 `args[9]` values `0..4`;
2. determine whether `args[10]` is armor-hit subtype, critical/module result or another damage-result dimension;
3. join method8 events to projectile `shotId` reliably enough to produce per-shot hit result;
4. close module/critical-event codes in Type32 short bodies;
5. separate penetration-with-HP-loss, module-only hits, non-penetrations and ricochets using independent evidence;
6. retain AoI/provenance flags so absence of an enemy event is never treated as proof that no event occurred.
