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
args[9]     : primary hit/result category
args[10]    : secondary hit/result category
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
settlement hits                        = 3788
observed unique attacker/method8 clocks = 3775
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

## Exact observed damage attribution

When a Type7 prop3 decrease has a known previous positive HP value and the same victim/rawClock has exactly one supported method8 attacker, that HP loss can be attributed fail-closed to that attacker.

Across the strict 34-arena corpus:

```text
settlement total damageDealt       = 1,233,475
exact observed attributed HP loss  = 1,029,610
```

The event-stream reconstruction therefore captures a large but incomplete single-POV subset of authoritative damage. Median per-player observed/settlement damage coverage is approximately `0.85`.

Victim-side HP reconstruction is independently strong:

```text
settlement total damageReceived = 1,233,736
observed prop3 HP loss          = 1,048,967
correlation by player row       ≈ 0.987
```

Missing coverage is expected from AoI boundaries, unknown initial HP before the first observed state, fire/special-damage paths and ambiguous same-clock attribution.

Safe rule:

> individual observed HP deltas can be `EXACT`; single-POV event-stream aggregate damage is **not** a replacement for settlement totals.

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

## Primary result category `args[9]`

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

The categories have sharply different HP behavior.

With prior victim HP known:

```text
sub=1 : 224 total; only 1 known same-clock HP-loss sample
sub=2 : 168 total; only 3 known same-clock HP-loss samples
sub=3 : 2941 total; 2463 / 2516 known-HP samples lose HP
sub=4 : 356 total; 231 / 310 known-HP samples lose HP
```

All categories remain strongly shot-associated, so `1/2` are not simply unrelated state packets. They are hit-result families that usually do not produce direct HP reduction, while `3/4` are strongly damaging/penetrating families.

## Penetration family — stronger current behavioral closure

A recorder-only natural experiment removes most AoI ambiguity. Several recorder battles have:

```text
settlement hits == settlement penetrations
```

meaning every recorded hit in that player-game must belong to the settlement penetration set.

Those all-penetration battles contain method8 hits with:

```text
args[9]  = 2
args[10] = 0
```

Therefore `(2,0)` cannot be classified as a generic non-penetration merely because it often has no same-clock HP loss. It belongs to the penetration family and is a strong candidate for a penetration/module-only or other non-HP penetration result.

Current coarse penetration predicate:

```text
args[9] in {3,4}
OR
(args[9] == 2 AND args[10] == 0)
```

Across all 476 player-game rows:

```text
exact settlement penetration count : 420 / 476
candidate total                     : 3375
settlement penetrations             : 3415
correlation                         : ~0.992
```

Recorder-only validation:

```text
34 recorder rows:
exact equality : 32
-1             : 1
-2             : 1
positive over-counts: 0
```

The `-2` recorder row also under-observes method8 hits by two, so its penetration deficit is explained by missing hit events. The remaining complete-observation `-1` row proves that one additional penetration subtype is encoded in finer metadata and that the coarse predicate is not yet a complete universal decoder.

Verdict:

> `{sub=3, sub=4, sub=2+secondary=0}` = **penetration-family classifier — PROVEN behavioral subset / PARTIAL complete enum** for current Blitz 11.19 corpus.

Do not yet expose the individual symbolic names of result values `0..4`, and do not assume the predicate is complete across versions.

## Important distinction: penetration != HP loss

The all-penetration recorder samples prove that some `sub=2, secondary=0` hits are settlement penetrations despite often producing no observable same-clock HP decrease.

Therefore battle reconstruction must keep separate facts:

```text
hit
penetration/result family
observed HP loss
module/critical side effect
```

They are related but not interchangeable.

A penetration can belong to a non-HP/module-only family; conversely raw packed method8 bytes must never be treated as direct damage amount.

## Module-only penetration boundary

One fully observed recorder battle has:

```text
11 hits
9 settlement penetrations
11 observed method8 hit bundles
8 coarse penetration candidates
```

Among the three coarse non-candidates, one `sub=2, secondary=3` event has a same-clock Type32 short component event (`a18024`) while the other two do not. This is consistent with a module-only penetration candidate, but adding "any Type32 short event" to the global penetration predicate over-counts six other recorder battles.

Therefore the example is retained as a **PARTIAL module-only penetration clue**, not a production rule.

## Safe battle reconstruction today

For a supported observed direct hit:

```text
HitEvent {
    rawClockSec
    attackerEntityId
    victimEntityId
    primaryResultRaw      // args[9]
    secondaryResultRaw    // args[10]
    penetrationFamily     // version-gated behavioral classifier, confidence-aware
    packedMetadataRaw
}
```

Join with Type7 prop3:

```text
HitEvent + HP delta > 0
  -> observed damaging hit with exact HP loss

HitEvent + no HP reduction
  -> observed hit with no observed HP damage
     (may be non-penetration, ricochet, module-only penetration, track/device hit, etc.)
```

The second branch must not be labelled `ricochet` until the complete result enum is closed.

## Next combat priorities

1. close exact symbolic meanings for method8 primary result values `0..4` and secondary values;
2. decode the remaining module-only penetration subtype using packed metadata + Type32 component evidence;
3. join method8 events to projectile `shotId` reliably enough to produce a per-shot result chain;
4. close module/critical-event codes in Type32 short bodies;
5. recover realtime fire/ram/world-collision damage attribution beyond settlement-only reason codes;
6. decode wrapper6 secondary combat attribution against settlement assist fields;
7. retain AoI/provenance flags so absence of an enemy event is never treated as proof that no event occurred.
