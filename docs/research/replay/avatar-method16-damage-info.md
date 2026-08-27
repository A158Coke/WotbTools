# Avatar method16 — vehicle damage-info relationship

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Numeric method IDs are entity-class and client-version scoped.

## Executive verdict

Avatar method16 is a fixed 10-byte vehicle damage-information family. Its outer Avatar target is the recorder Avatar, while the payload identifies a victim vehicle, two compact damage/state codes, and a related vehicle/entity ID.

Current behavioral closure:

> **Avatar method16 = vehicle damage-info / module-and-crew state presentation family — PROVEN relationship.**

Several `codeB` identities are now independently closed by current-Blitz physical effects and recovery consumables; the remaining codes stay raw/PARTIAL.

## Fixed payload

All 355 observations are exactly 10 bytes:

```text
vehicleId      : u32 LE   [0..4)
codeA          : u8       [4]
codeB          : u8       [5]
relatedEntity  : u32 LE   [6..10)
```

All 355 `vehicleId` values resolve to a combat vehicle in the current arena.

## Direct damage relationship

Joining method16 to same-clock Vehicle method8 gives:

```text
method16 total                         = 355
same-clock Vehicle method8             = 176
exact vehicleId == victim AND
      relatedEntity == attacker        = 170
victim-only relation                   =   2
other / ambiguous boundary             =   4
```

Thus for clean same-clock damage samples:

```text
method16.vehicleId      = victim
method16.relatedEntity  = attacker/source
```

Source-less state-clear events commonly use `relatedEntity=0`.

## Proven `codeB` identities

### `codeB=32` — ammo rack

Current recorder-vehicle closure:

```text
(codeA=4, codeB=32) onset records : 12
method35 effective reload change   : x1.65 in 12 / 12
```

Observable clears:

```text
(codeA=19, codeB=32, relatedEntity=0) : 9
```

All 9 are same-clock with Multi-Purpose Restoration Pack or Repair Kit and restore method35 reload duration by the exact inverse effective factor.

Current Blitz gameplay documentation independently states that ammo-rack damage degrades gun loading performance and that Repair Kit restores damaged modules.

Verdict:

```text
codeB=32                 = ammo rack                     PROVEN
codeA=4  + codeB=32      = ammo-rack damaged onset      PROVEN
codeA=19 + codeB=32      = ammo-rack repair/clear       PROVEN relationship
```

Detailed evidence: [`ammo-rack-and-loader-damage-codes.md`](ammo-rack-and-loader-damage-codes.md).

### `codeB=34/35` — two track-side modules

Both values form the paired track/suspension damage family.

Severe `codeA=5` states show strong mobility collapse in Type10 movement. Clear transitions use `codeA=19` and overwhelmingly coincide with Repair Kit or Multi-Purpose Restoration Pack.

Verdict:

```text
codeB=34/35 = two track-side modules   PROVEN family
```

Exact left/right assignment remains PARTIAL.

Detailed evidence: [`track-damage-codes.md`](track-damage-codes.md).

### `codeB=43` — Loader

Current closure:

```text
(codeA=10, codeB=43) injury onset : 5
```

All five produce a large effective reload-duration degradation; four update method35 at the exact clock and one within ~0.09 s.

Clear events:

```text
(codeA=22, codeB=43, relatedEntity=0) : 4
```

All four coincide with First Aid Kit or Multi-Purpose Restoration Pack and restore reload performance.

Current Blitz documentation independently states that Loader shell-shock reduces reloading speed and First Aid Kit heals shell-shocked crew.

Verdict:

```text
codeB=43                 = Loader                         PROVEN
codeA=10 + codeB=43      = Loader injury/shell-shock    PROVEN
codeA=22 + codeB=43      = Loader heal/clear            PROVEN relationship
```

Detailed evidence: [`ammo-rack-and-loader-damage-codes.md`](ammo-rack-and-loader-damage-codes.md).

## `codeA` lifecycle families now visible

The current closed examples show at least two state-machine families:

```text
mechanical module:
  codeA=4/5/... -> damage/severity states
  codeA=19      -> repair/clear family

crew member:
  codeA=10      -> injury/shell-shock onset
  codeA=22      -> heal/clear family
```

Exact meanings of every mechanical `codeA` value (`4/5/6/7/18/...`) remain PARTIAL. In particular, do not globally equate one numeric code with `damaged` or `destroyed` until more module families close.

## Remaining `codeB` values

Current unresolved/partially resolved codeB values include:

```text
31, 33, 36, 37, 38,
39, 40, 41, 42
```

The `39..43` region is strongly crew-like because 39/40/41 and proven Loader 43 share the same `codeA=10 -> codeA=22` injury/heal lifecycle. Exact Commander/Gunner/Driver/etc assignments for 39/40/41 remain evidence-gated.

Similarly, the remaining low-30s values are mechanical-device candidates, but must be assigned through current physical effects and correct recovery consumables rather than historical numeric order.

## Historical structural support

Historical Wargaming clients expose a conceptually similar family:

```text
showVehicleDamageInfo(
    vehicleID,
    damageIndex,
    extraIndex,
    entityID,
    equipmentID
)
```

and maintain separate device and tankman damage states. This is useful structural precedent only; current Blitz code identities above were promoted from current-corpus behavioral closure, not transplanted indices.

## Consumer contract

```text
VehicleDamageInfoEvent {
    rawClockSec
    vehicleId
    codeARaw
    codeBRaw
    relatedEntityId
    decodedComponent // nullable, version-gated
    decodedState     // nullable, version-gated
    confidence
}
```

Safe current decoded identities:

```text
32    ammo rack
34/35 track-side family
43    Loader
```

All other codeB values remain raw until separately closed.

Do not treat every method16 event as HP damage; it is a module/crew/damage-presentation state surface that often accompanies, but is not identical to, Vehicle method8 HP-damage evidence.
