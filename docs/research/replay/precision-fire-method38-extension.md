# Method38 extended result — Precision Fire / special damage provenance

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: Avatar method38 extended variants where the normal shot-result payload carries an additional `u32` extension field.

## Executive verdict

Current evidence supports:

```text
extension_u32 = 1
-> Precision Fire proc marker
-> VERY STRONG / near-PROVEN current behavioral identity

extension_u32 = 2
-> Tungsten / special-damage provenance candidate
-> VERY STRONG PARTIAL, n=1
```

The exact internal enum symbol remains unknown and all semantics must remain version-gated.

## Why the temporary FV215b counterexample is not a real counterexample

One current FV215b record initially appeared to invalidate the Precision Fire hypothesis:

```text
rawClock       = 229.826416 s
extension      = 1
shell family   = HE-family
average damage = 515
observed loss  = 500
pre-hit HP     = 1025
post-hit HP    = 525
```

A naive interpretation would expect a maximum roll of approximately:

```text
515 * 1.25 = 643.75
```

and would therefore reject Precision Fire because the final HP loss is only 500.

That rejection is incorrect for HE.

Wargaming's published Precision Fire mechanics explicitly state that the skill also works for HE shells, but after the next shot is set to maximum possible damage, the **final inflicted HE damage still depends on penetration, armor thickness at the impact point and burst radius**.

Therefore:

```text
Precision Fire internal max-damage selection
-> HE penetration/explosion resolution
-> final observable HP loss may be lower than raw 125% shell alpha
```

The FV 500-damage HE record is therefore compatible with Precision Fire and must not be treated as a negative control.

The target did not have a recorded Reactive Armor activation around the hit, so Reactive Armor is not needed to explain the difference; ordinary HE damage resolution is sufficient as a known mechanic branch.

## Non-HE numeric closure

The remaining extension=1 population gives a much stronger invariant.

### SPHT standard-shell family

For current SPHT wire slot0 hit results:

```text
exact observed 500-damage hits : 9
extension=1                    : 9 / 9
extension absent on exact 500  : 0
```

A further extension=1 terminal hit removes only 415 HP because the target had exactly 415 HP immediately before the shot:

```text
pre-hit HP  = 415
post-hit HP = 0
extension   = 1
```

Thus the observable loss is HP-capped and does not contradict a 500 maximum roll.

### Ho-Ri standard-shell family

```text
exact observed 700-damage hits : 2
extension=1                    : 2 / 2
extension absent on exact 700  : 0
```

### Combined non-HE extension=1 population

```text
SPHT exact maximum         : 9
SPHT HP-capped terminal    : 1
Ho-Ri exact maximum        : 2
------------------------------
non-HE compatible samples  : 12 / 12
```

Every non-HE extension=1 event is therefore either:

- exact ordinary maximum damage; or
- an HP-capped terminal result whose potential damage is above the remaining HP.

The sole HE-family extension=1 event is compatible with Wargaming's documented HE-specific post-processing rule.

## Current population

```text
extension=1 : 13 records
extension=2 :  1 record
```

Current `extension=1` vehicles:

```text
A178_SPHT       : 10
J20_Ho_Ri_type3 :  2
GB13_FV215b     :  1
```

## Precision Fire streak reconstruction boundary

Do not attempt to reconstruct the three-shot charge state solely from:

```text
same-clock observed HP loss > 0
```

The live HP surface is recorder/AoI/sample scoped. Some proven piercing-like method38 hits have no usable same-clock HP delta.

A naive HP-delta streak state machine therefore produces false negatives and false eligibility windows.

The extension field itself is currently a better direct proc signal than a reconstructed streak from incomplete HP telemetry.

## Forced low-HP activation rule

A gameplay rule supplied during current protocol research is:

> once Precision Fire is eligible, if the target's remaining HP is below the shell's ordinary minimum roll, activation is guaranteed rather than probability-based.

The current canonical 13 extension=1 records do not contain a clean controlled sample proving that forced branch.

Keep this as a probe target rather than claiming current replay proof.

## `extension=2` — Tungsten candidate

The only current `extension=2` event is:

```text
vehicle              = VK 72.01
Tungsten activation  = 62.980843 s
hit                   = 63.481049 s
activation -> hit     = ~0.500 s
observed damage       = 723
extension             = 2
```

After the Tungsten active window ends, later recorder hits do not carry extension=2.

Current corpus:

```text
recorder-owned Tungsten-active hits = 1
extension=2 among them              = 1 / 1
non-Tungsten extension=2 hits       = 0
```

Verdict:

> `extension=2` = **Tungsten / special damage-roll provenance candidate — VERY STRONG PARTIAL, n=1**.

Additional controlled Tungsten hits are required for PROVEN status.

## Ammunition-selection caution

Type28 is proven recorder ammunition selection, but the raw values `0/1/2` must not automatically be labeled as user-facing shell-list indices until the current method17 shell descriptor is resolved.

For FV215b, current replay ballistics distinguish:

- one 1440.72 m/s family corresponding to the APCR family;
- two 1152.36 m/s families corresponding to the remaining AP and HE-family selections.

Damage-result distributions distinguish the HE-like selection, but production naming should ultimately join Type28 -> method17 shell descriptor -> version-matched shell catalog.

A previous aggregate Type28 per-vehicle count table was also found internally inconsistent with the independently closed 324 unique recorder-shot total. Future joins must use arena-local state and unique recorder shot IDs rather than the stale aggregate table.

## Safe current model

```text
ShotResultSpecialModifier {
    extensionRaw
    semantic
    confidence
}

extensionRaw=1:
    semantic   = PRECISION_FIRE_PROC
    confidence = VERY_STRONG_CURRENT_RELATIONSHIP

extensionRaw=2:
    semantic   = TUNGSTEN_OR_SPECIAL_DAMAGE_PROVENANCE_CANDIDATE
    confidence = VERY_STRONG_PARTIAL_N1
```

Always preserve the raw extension and current-version provenance.

## Remaining work

1. obtain a controlled Precision Fire HE sample to verify that extension=1 survives HE post-processing exactly as expected;
2. obtain a forced low-HP Precision Fire activation sample;
3. obtain more recorder-owned Tungsten-active hits for extension=2;
4. recover the current Blitz enum/schema/string resource for exact symbolic names;
5. repair the stale Type28 aggregate table using the canonical 324-shot reconstruction.
