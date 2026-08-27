# Vehicle firing signal — Type8 Vehicle method0

> Corpus: strict-framing 34 unique arenas from the 44-file Blitz 11.19.0 China research corpus.
>
> Type8 method IDs are entity-class/version scoped. This chapter describes **Vehicle-targeted method0** only.

## Executive verdict

Current Blitz 11.19 Vehicle method0 is an observed vehicle **firing / showShooting-family signal**.

```text
args length : 1 byte
args value  : 01 in 4,154 / 4,154 observations
```

It is emitted once for an observed vehicle shot. Missing events are explained by client-AoI/replay coverage; no observed player/replay row over-counts authoritative settlement shots.

Verdict:

> `Vehicle method0 -> observed vehicle firing` — **PROVEN physical role** on the current corpus.

The exact current Blitz symbolic RPC name is kept version-scoped, although historical Wargaming Vehicle clients expose a `showShooting(...)` method serving the same physical role.

## Count closure against settlement shots

For every settled vehicle that has at least one current Vehicle-method0 event in a replay, the event count was compared against authoritative settlement `shots`.

```text
player/replay rows with method0 : 474
exact count == settlement shots : 366 / 474
method0 count > settlement shots:   0 / 474
method0 count < settlement shots: 108 / 474
```

Observed shortfalls:

```text
0  : 366 rows
-1 :  63
-2 :  22
-3 :  10
-4 :   7
-5 :   3
-6 :   1
-8 :   1
-9 :   1
```

The mismatch is strictly one-sided: the client may fail to observe every shot because an enemy is outside the observed AoI, the stream begins/ends incompletely, or another POV-side packet is absent; it never invents additional shots.

This is the characteristic shape of an observation-limited firing signal rather than a periodic state toggle.

## Closure with projectile launch events

Avatar method29 independently provides the projectile/tracer launch family with a shooter entity and shot/projectile ID.

Across the strict corpus:

```text
method29 launch records                            : 4,244
method29 with at least one method0 for same shooter: 4,244 / 4,244
exact same rawClock                                : 4,130 / 4,244
within +/- 0.25 s                                  : 4,237 / 4,244
```

The 1-byte method0 event and the richer method29 projectile launch therefore describe the same firing lifecycle at different detail levels.

Safe interpretation:

```text
Vehicle method0
  -> vehicle fired while that Vehicle entity was observable

Avatar method29
  -> richer projectile launch representation
     shooter + shotId + launch point + launch velocity/direction + ballistic parameter
```

Do not require both events for every physical shot; client observation and replay delivery can omit one surface.

## Relationship to visibility/AoI

Enemy Vehicle method0 is only available while the enemy entity is in the client's active observed/AoI set. During proven Type4 -> Type33 hidden intervals there are no Type8 methods for that entity, therefore hidden enemy firing must not be synthesized.

This makes method0 useful for AI/playback statements such as:

```text
"the observed enemy fired at approximately T"
```

but not for reconstructing shots fired while that enemy was unobserved.

## Historical schema comparison

Historical Wargaming Vehicle client code contains a replay/gameplay method named `showShooting(...)`. Its historical argument schema differs from the current Blitz one-byte body, so the symbolic name must not be transplanted solely by numeric method ID.

What is proven here is the **physical firing role**, based on settlement-shot cardinality and independent projectile-launch timing.

## Consumer guidance

- treat each observed Vehicle method0/`01` as one firing observation;
- retain the target vehicle entity ID and replay raw clock;
- join to Avatar method29 when available for shotId/ballistic geometry;
- never use method0 count as authoritative total shots when the vehicle can leave the client's AoI;
- settlement `shots` remains authoritative final-count evidence.

## Remaining work

1. Recover a version-matched Blitz symbolic RPC name/argument schema.
2. Determine whether the one-byte value has additional domains in other gun systems/modes/versions.
3. Join every observed firing event to shell/ammo identity once that protocol surface is decoded.
4. Validate burst/multi-gun behavior outside the current tournament corpus.
