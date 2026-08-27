# Method38 current hit-flag reconstruction — Blitz 11.19 China

> Corpus: canonical 34 unique arenas, 324 unique recorder shots, 295 recorder hit-feedback records.
>
> Scope: low-16 `resultFlags16` in Avatar method38. Numeric values are current-version evidence only. Historical PC/WoT constants are used only as a structural cross-check after current Blitz behavior is established.

## Executive verdict

The current Blitz 11.19 bit layout is behaviorally compatible with a compacted descendant of historical `VEHICLE_HIT_FLAGS`, but **must not be copied ordinally from historical PC constants**.

Current evidence closes or strongly bounds:

```text
0x0001  direct terminal shell kill                         PROVEN current corpus
0x0002  target already dead before attack                 PROVEN sample / PARTIAL global
0x0004  fire started                                      PROVEN samples / PARTIAL global
0x0008  ricochet                                          HIGH-CONFIDENCE PARTIAL
0x0010  projectile material/vehicle penetration-like      PROVEN relationship
0x0020  projectile non-penetration/material-stop-like     VERY STRONG relationship
0x0100  internal component/device penetration/involvement PROVEN relationship
0x0400  track/chassis damaged result                      PROVEN relationship
0x0800  gun damaged result                                PROVEN on current samples / PARTIAL global n=2
0x1000  explosion/special-shell material branch           VERY STRONG current relationship
0x2000  explosion armor/special branch                    PARTIAL n=1
0x4000  explosion internal-component/device branch        PROVEN relationship
```

The exact internal symbolic enum names remain version-scoped unless explicitly marked PROVEN.

## Current evidence: 0x0100

`0x0100` occurs on 104 method38 events and is broadly associated with non-empty internal result lists.

Its result-token domain spans the complete current component namespace:

```text
31 Engine
32 Ammo Rack
33 Fuel Tank
34 Right Track
35 Left Track
36 Gun
37 Turret Rotator
38 Observation Device
39 Commander
40 Driver
41 Gunner
43 Loader
```

Current state coverage includes `rawState=0/1/2`.

This is not a generic damage bit; it is best modeled as an internal component/device penetration or involvement branch.

Verdict:

> `0x0100` = **internal component/device penetration-involvement relationship — PROVEN current behavior; exact symbolic carry-over PARTIAL**.

## Current evidence: 0x0400

Observed:

```text
0x0400 events: 58
records with decoded result list: 53
```

For all 53 decodable result-list events:

```text
Right Track and/or Left Track present: 53 / 53
```

The remaining five records have no decoded component list in that method38 record and therefore provide no contradictory component identity.

Pair-level concentration is overwhelming:

```text
Right Track token 34 : 36
Left Track token 35  : 18
other component-result occurrences are incidental co-results in the same hit
```

The track IDs themselves are independently PROVEN from method8 target-local hit geometry and method16 movement/repair lifecycle.

Verdict:

> `0x0400` = **track/chassis-damaged result family — PROVEN current relationship**.

Do not call this the historical PC `DEVICE_DAMAGED_BY_PROJECTILE` solely by numeric position.

## Current evidence: 0x0800

Only two current events carry `0x0800`.

Both are SPHT standard-ammunition hits and both contain exactly one method38 repeated result:

```text
componentToken = 36 Gun
rawState       = 1 damaged
```

No other component result appears in either event.

Verdict:

> `0x0800` = **Gun-damaged result — PROVEN on current observed samples / PARTIAL global because n=2**.

This is an important negative control against directly transplanting historical PC upper-bit positions.

## Current evidence: 0x1000 / 0x2000 / 0x4000

All three bits are exclusive to Type28 `selectionValue=2` in the corrected 324-shot recorder ledger:

```text
0x1000 : 13 / 13 -> selectionValue=2
0x2000 :  1 /  1 -> selectionValue=2
0x4000 :  7 /  7 -> selectionValue=2
non-value-2 occurrences: 0
```

For FV215b, `selectionValue=2` is independently HE-family by behavior:

```text
12 hit samples
median observed HP loss ~149
high-damage direct results ~500-537
low-damage non-penetrating/explosion results 74/104/142/etc.
```

### `0x1000`

Representative FV combinations:

```text
0x1020 -> no component result; low/no HP loss common
0x5010 -> high HP loss + internal component result list
0x5100 -> internal component result + lower explosion-style HP loss
```

`0x1000` therefore marks the common explosion/special-shell material-resolution path rather than Gun damage.

Verdict:

> `0x1000` = **explosion/special-shell material-resolution branch — VERY STRONG current relationship**.

### `0x2000`

Only one sample exists:

```text
flags = 0x2020
selectionValue = 2
HP loss = 0
component list = empty
```

This is compatible with a distinct explosion/armor-resolution branch, but sample size is insufficient for exact naming.

Verdict: **PARTIAL n=1**.

### `0x4000`

Observed:

```text
0x4000 events : 7
non-empty internal component list : 7 / 7
selectionValue=2                  : 7 / 7
```

The repeated results cover mechanical and crew components, including mixed `rawState=0/1/2` outcomes.

Verdict:

> `0x4000` = **explosion/special-shell internal-component/device branch — PROVEN current relationship; exact symbolic label PARTIAL**.

## Structural historical cross-check

A historical Wargaming PC `VEHICLE_HIT_FLAGS` table contains, in order:

```text
0x0100 DEVICE_PIERCED_BY_PROJECTILE
0x0200 DEVICE_NOT_PIERCED_BY_PROJECTILE
0x0400 DEVICE_DAMAGED_BY_PROJECTILE
0x0800 CHASSIS_DAMAGED_BY_PROJECTILE
0x1000 GUN_DAMAGED_BY_PROJECTILE
0x2000 MATERIAL...PIERCED_BY_EXPLOSION
0x4000 ARMOR...PIERCED_BY_EXPLOSION
0x8000 DEVICE_PIERCED_BY_EXPLOSION
```

Current Blitz behavior does **not** match those upper positions ordinally.

Instead the 11.19 data behaves like a compacted/reorganized descendant in which the current observable sequence after the device-involvement pair is approximately:

```text
0x0400 track/chassis damage
0x0800 gun damage
0x1000 explosion material/special-shell branch
0x2000 explosion armor branch
0x4000 explosion device/internal-component branch
```

One plausible implementation history is that Blitz omitted or merged a separate PC-style `DEVICE_DAMAGED_BY_PROJECTILE` flag, shifting later roles down one position. This historical-evolution explanation is a **hypothesis**, not required for the current decoder.

The production decoder should use only current behaviorally closed roles and retain raw bits.

## `0x0010` / `0x0020`

Current semantic-hit dedup already proves:

```text
CURRENT_PIERCING_LIKE_MASK = 0x1110
```

The `selectionValue=2` HE-family provides an additional physical discriminator:

```text
0x1020 family -> low/no HP-loss non-penetrating/explosion outcomes
0x5010 family -> high-damage penetration-like outcomes
```

This further supports:

```text
0x0010 -> projectile positive material/vehicle penetration-like branch
0x0020 -> projectile non-penetration/material-stop-like branch
```

Exact material-vs-armor symbolic wording remains version-scoped.

## `0x0040`

`0x0040` occurs only 11 times. It is concentrated in track/fuel-tank-related internal results and often coexists with `0x0010/0x0020`, `0x0100`, or `0x0400`.

The current corpus does not uniquely distinguish between an armor-zero-damage-factor / spaced-armor style role and another projectile material branch.

Verdict: **PARTIAL; preserve raw**.

## Consumer model

```text
ShotResultFlags {
    raw16
    directKill
    targetAlreadyDead
    fireStarted
    ricochetLike
    projectilePenetrationLike
    projectileNonPenetrationLike
    componentInvolvement
    trackChassisDamage
    gunDamage
    explosionMaterialLike
    explosionArmorLike
    explosionComponentLike
    confidenceByFact
}
```

Do not convert the bitfield into one mutually exclusive enum. Multiple flags describe orthogonal portions of the same hit-resolution path.

## Remaining closure

1. controlled HE/HESH probes for `0x1000/0x2000/0x4000` exact labels;
2. armor-model geometry closure for `0x0008` and `0x0040`;
3. a larger Gun-damage sample for global `0x0800` validation;
4. recover version-matched Blitz 11.19 hit-flag symbol/schema if possible;
5. preserve unknown/unobserved `0x0080/0x0200/0x8000` rather than inventing semantics.
