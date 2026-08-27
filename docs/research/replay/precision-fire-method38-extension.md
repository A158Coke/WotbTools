# Method38 extended result — Precision Fire closure

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: Avatar method38 extended variants where the main shot-result payload carries an additional `u32` extension field.

## Executive verdict

The current corpus strongly closes:

> `method38 extension_u32 = 1` = **Precision Fire maximum-damage proc marker — PROVEN current 11.19 behavioral identity**.

The conclusion is based on current replay behavior, not merely on historical skill documentation.

## Current population

Extended method38 records:

```text
extension=1 : 13 records
extension=2 :  1 record
```

The `extension=1` records occur on:

```text
A178_SPHT       maximum ordinary AP-family damage = 500
J20_Ho_Ri_type3 maximum ordinary AP-family damage = 700
GB13_FV215b     maximum ordinary AP-family damage = 500
```

Observed `extension=1` HP-loss results:

```text
12 / 13 = exact vehicle/shell maximum damage
1 / 13  = 415 HP terminal kill where target had exactly 415 HP before the shot
```

Thus every `extension=1` event satisfies:

```text
observedHpLoss = min(maximumDamageRoll, targetPreHitHp)
```

for the current samples.

## The apparent 415-damage counterexample is actually a terminal-HP cap

Replay:

```text
arenaUniqueId = 8965612873726874
recorder      = A178_SPHT
shot clock    = 139.121658 s
victim entity = 11668277
```

Victim HP chain immediately before the hit:

```text
130.540207  HP = 811
135.837708  HP = 415
139.121658  recorder hit
139.121658  HP = 0
```

Method38 on the terminal shot carries:

```text
extension_u32 = 1
direct-kill bit 0x0001 = set
observed HP loss = 415
```

The SPHT maximum roll in this family is 500. The replay can only observe 415 HP removed because the victim had only 415 HP remaining. Therefore this sample is not a 415 damage roll; it is a maximum-damage proc whose observable HP subtraction is capped by remaining target HP.

This removes the only apparent numeric counterexample in the 13-record `extension=1` population.

## Independent gameplay rule cross-check

Wargaming's published Precision Fire rule states that after three consecutive shots that each cause damage, the next shot has a skill-level-dependent chance to deal the maximum possible damage. The normal random damage range is ±25% around average damage.

This predicts exactly the observed `extension=1` damage families:

```text
400 average -> 500 maximum
560 average -> 700 maximum
```

Historical/public rules are used only as independent semantic support; the current replay behavior above is the primary closure.

## Important streak-counter boundary

Do **not** reconstruct Precision Fire readiness solely from:

```text
same-clock observed HP loss > 0
```

for the previous three method38 records.

The replay's live HP surface is client/AoI/sample scoped. Some piercing-like method38 hits have no usable same-clock HP delta even though the hit may have caused real damage. A naive rolling HP-loss counter therefore creates false streak failures and false eligibility windows.

A correct future streak model needs one of:

1. authoritative current skill-state transport if found;
2. a complete semantic shot ledger combining method38, settlement-compatible damage evidence and HP visibility boundaries;
3. controlled replay probes where all four shots and target HP are continuously observable.

## User-reported current gameplay rule requiring controlled validation

A current gameplay behavior reported during protocol research is:

> when Precision Fire is already eligible/charged and the target's remaining HP is below the shell's minimum ordinary damage, the skill is guaranteed to activate rather than using the normal probability.

This is retained as a **current gameplay hypothesis / probe target**, not yet promoted from the canonical corpus.

The existing 13 `extension=1` samples contain no clean case where the target pre-hit HP is below the represented gun's minimum ordinary damage, so the forced-execution branch cannot yet be independently closed from these samples.

The right controlled probe is:

```text
Precision Fire readiness known with certainty
-> target HP deliberately reduced below minimum roll
-> fire eligible shot
-> verify extension=1 appears 100%
-> repeat negative control with target HP above minimum roll
```

## `extension=2` remains separate

The sole `extension=2` event occurs on a VK 72.01 shot roughly 0.5 seconds after recorder Tungsten Shells activation and produces an elevated 723-damage result. The next post-Tungsten shot no longer carries the extension.

This is strong evidence for a different special-damage modifier/provenance branch, but `extension=2 = Tungsten Shells` remains PARTIAL because `n=1`.

Do not merge `extension=1` and `extension=2` into one generic boolean.

## Safe current model

```text
ShotResultSpecialModifier {
    extensionRaw
    semantic
    confidence
}

extensionRaw=1 -> PRECISION_FIRE_MAX_DAMAGE_PROC  PROVEN current 11.19
extensionRaw=2 -> SPECIAL_DAMAGE_MODIFIER         PARTIAL; Tungsten candidate n=1
```

Consumers must still retain the raw extension and version-gate the semantic mapping.

## Product value

This can support:

- AI Review: explain that a maximum-damage roll was skill-forced rather than normal RNG;
- battle playback: annotate Precision Fire proc shots;
- replay analytics: avoid treating skill-forced max rolls as ordinary damage-roll luck;
- protocol research: separate special damage provenance from penetration/module hit flags.
