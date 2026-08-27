# Method38 extended result — special damage modifier research

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: Avatar method38 extended variants where the main shot-result payload carries an additional `u32` extension field.

## Executive correction

The earlier conclusion

```text
extension_u32 = 1 == Precision Fire maximum-damage proc
```

is **SUPERSEDED / REJECTED as an exact identity**.

A current FV215b counterexample breaks the required maximum-damage invariant:

```text
vehicle        = GB13_FV215b
rawClock       = 229.826416 s
extension_u32  = 1
observedHpLoss = 500
current third-shell average damage = 515
ordinary maximum roll              = 515 * 1.25 = 643.75
```

The 500 HP result is neither the ordinary maximum roll nor an HP-cap case. Therefore `extension=1` cannot safely mean `PRECISION_FIRE_MAX_DAMAGE_PROC` globally.

This correction takes precedence over the previous 13-record interpretation.

## Current extension population

```text
extension=1 : 13 records
extension=2 :  1 record
```

The `extension=1` population is concentrated on SPHT, Ho-Ri and FV215b and frequently coincides with conspicuously high / exact-looking damage values, but the FV215b 515-average-shell counterexample proves that exact maximum damage is not the invariant encoded by this value.

The previous 415-damage SPHT terminal sample remains correctly interpreted as HP-capped observed loss:

```text
preHitHp = 415
postHitHp = 0
observedHpLoss = 415
extension=1
```

but that sample alone cannot identify the extension semantic.

## Precision Fire remains a gameplay hypothesis, not the field identity

Precision Fire is still relevant to this research because some extension=1 shots numerically resemble skill-forced maximum rolls.

However:

```text
some extension=1 samples compatible with Precision Fire
!=
extension=1 means Precision Fire
```

A correct future closure must prove either:

1. all `extension=1` events share another common gameplay state or damage-resolution branch; or
2. the extension is a broader provenance/annotation enum whose value 1 can be emitted for multiple special-damage causes.

Until then, do not expose Precision Fire from this field in production.

## `extension=2`

The sole current `extension=2` event remains:

```text
vehicle       = VK 72.01
Tungsten activation -> ~0.500 s -> hit
observed damage = 723
extension=2
```

The next post-Tungsten shot lacks the extension.

Current evidence:

```text
recorder-owned Tungsten-active hits = 1
extension=2 among them              = 1 / 1
non-Tungsten extension=2 hits       = 0
```

Verdict:

> `extension=2` = **Tungsten / special-damage provenance candidate — VERY STRONG PARTIAL, n=1**.

Do not promote to PROVEN without additional controlled samples.

## Ammunition-state caution discovered during re-audit

Type28 is proven to represent recorder ammunition selection, but the wire values `0/1/2` must not be assumed to equal the user-facing shell-list order without descriptor closure.

For FV215b, current replay evidence distinguishes three ammunition families by Type28 + method17 shell descriptor + launch velocity. The user-facing shell set is AP / APCR / HE-family, while the exact wire-value-to-shell-name mapping requires descriptor-level closure.

During re-audit, an older per-vehicle Type28 shot-count table was found internally inconsistent with the proven 324 unique recorder-shot total. All future extension/ammunition joins must therefore use:

```text
method29.shooterId == recorderVehicleEntity
unique (arena, shotId)
Type28 state scoped within the same arena
slot state sampled at launch time
```

rather than reusing the stale aggregate table.

## Safe current model

```text
ShotResultSpecialModifier {
    extensionRaw
    semantic        // nullable
    confidence
}

extensionRaw=1 -> UNKNOWN_SPECIAL_DAMAGE_OR_RESULT_PROVENANCE
                  exact Precision Fire identity REJECTED

extensionRaw=2 -> TUNGSTEN_OR_SPECIAL_DAMAGE_PROVENANCE_CANDIDATE
                  VERY_STRONG_PARTIAL, n=1
```

Always preserve the raw extension.

## Remaining work

1. rebuild all 13 `extension=1` events against authoritative per-shot ammunition descriptor and shell family;
2. compare them against Precision Fire readiness, consumables, special equipment and shell mechanics;
3. obtain additional Tungsten-active recorder hits to test extension=2;
4. search current Blitz client/schema/string resources for the extension enum;
5. never infer a skill proc solely from final damage magnitude.
