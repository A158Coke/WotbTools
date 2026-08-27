# Track-side damage codes — method16 codeB 34 / 35

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: recorder-vehicle Avatar method16 damage-info events joined to Type10 movement and independently proven recovery consumables.

## Executive verdict

Current evidence closes:

```text
method16 codeB=34
method16 codeB=35
```

as the two **track-side / suspension-track module identities**.

Verdict:

> `codeB 34/35 = two track-side modules — PROVEN behavioral family`.
>
> Exact assignment `34=left,35=right` or the reverse remains **PARTIAL** until a current-version side-specific geometry/schema closure exists.

## Current event populations

Recorder-vehicle method16 observations:

```text
codeB=34:
  codeA=4   20
  codeA=5   14
  codeA=6    2
  codeA=7    1
  codeA=18   1
  codeA=19  25

codeB=35:
  codeA=4   12
  codeA=5   12
  codeA=6    2
  codeA=19  16
```

`codeA=19` is the common state-clear/repair transition already observed on the independently proven ammo-rack module (`codeB=32`).

## Critical-state movement effect

Type10 provides the target vehicle's independent movement stream. For recorder events with `codeA=5`, movement slows sharply after the damage transition.

Using 1.5-second before/after movement windows:

```text
codeB=34, codeA=5
  records            : 14
  median speed before: ~2.13 m/s
  median speed after : ~0.78 m/s

codeB=35, codeA=5
  records            : 12
  median speed before: ~2.56 m/s
  median speed after : ~0.46 m/s
```

The effect is much stronger for the `codeA=5` state than the common `codeA=4` state. This is consistent with a more severe/critical track state rather than a generic vehicle-hit code.

Individual movement windows remain player-input dependent, so the exact numeric speed reduction is not treated as a game constant.

## Recovery-consumable closure

Current recorder clear transitions:

```text
(codeA=19, codeB=34) : 25
(codeA=19, codeB=35) : 16
```

Of these, the overwhelming majority occur exactly with an independently proven mechanical recovery consumable:

```text
0x0B Multi-Purpose Restoration Pack
0x0D Repair Kit
```

Observed same-clock recovery counts:

```text
codeB34 clear:
  MPRP       : 13
  Repair Kit : 11
  no same-clock recovery activation : 1

codeB35 clear:
  MPRP       : 8
  Repair Kit : 7
  no same-clock recovery activation : 1
```

The two no-consumable boundaries are compatible with automatic transition/repair behavior and do not change the module-family identity.

## Current Blitz gameplay discriminator

Current World of Tanks Blitz support documentation distinguishes left and right tracks as damageable modules. Critical track damage makes movement and traverse impossible; Repair Kit restores damaged modules.

The current replay therefore independently supplies all required physical dimensions:

```text
paired module IDs
+ severe-state mobility loss
+ mechanical-repair clear
```

This identifies the track-side family without importing a historical numeric mapping.

## Historical structural support, not numeric proof

Historical Wargaming vehicle-device definitions independently contain adjacent left/right track devices (`leftTrack0`, `rightTrack0`). This supports the paired-device shape but is not used to decide which current Blitz numeric code is left vs right.

## Safe consumer model

```text
TrackDamageStateEvent {
    rawClockSec
    vehicleId
    trackSideCodeRaw : 34 | 35
    damageStateCodeRaw
    relatedEntityId
}
```

Safe AI/playback statements after version gating:

- a track-side module was damaged/critically disabled at time T;
- mobility loss around T is supported by Type10 movement;
- Repair Kit/MPRP restored the track-side state at time T.

Unsafe today:

- displaying `left track` vs `right track` solely from 34/35;
- using a fixed movement penalty from the observed corpus;
- treating every track hit as HP damage.

## Remaining side-specific closure

To assign exact left/right identity, use a controlled mobile replay with a shell impact geometrically localized to one hull side and confirm:

```text
method16 codeB
+ method29/27 impact geometry
+ vehicle local coordinate transform
```

Repeat on the opposite track to avoid model/orientation ambiguity.
