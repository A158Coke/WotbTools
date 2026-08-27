# Avatar method16 — vehicle damage/module/crew state family

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Numeric method IDs are entity-class and client-version scoped.

## Executive verdict

Avatar method16 is a fixed 10-byte recorder-Avatar RPC carrying vehicle module/crew state presentation:

```text
vehicleId      : u32 LE
codeA          : u8       // state/lifecycle code
codeB          : u8       // component ID
relatedEntity  : u32 LE   // attacker/source for damage onsets; often 0 on clears
```

Current behavioral identity:

> **vehicle damage/module/crew state presentation family — PROVEN relationship**.

This file has been synchronized to the later dedicated closure notes. Older mappings that left most IDs PARTIAL are SUPERSEDED.

## Current component namespace

### Mechanical

```text
31 Engine              PROVEN
32 Ammo Rack           PROVEN
33 Fuel Tank           PROVEN
34 Right Track         PROVEN
35 Left Track          PROVEN
36 Gun                 PROVEN
37 Turret Rotator      PROVEN version-scoped
38 Observation Device  PROVEN
```

The 34/35 orientation is geometrically closed from Vehicle method8 target-local BigWorld hit segments:

```text
34 -> minimum local-X side -> vehicle right -> Right Track
35 -> maximum local-X side -> vehicle left  -> Left Track
```

### Crew

```text
39 Commander  PROVEN
40 Driver     PROVEN
41 Gunner     PROVEN
42 UNKNOWN / unobserved-reserved
43 Loader     PROVEN
```

The old `41=Radioman / 42=Gunner` interpretation is **SUPERSEDED**.

## Current codeA lifecycle

Mechanical:

```text
4  -> common damaged / degraded operational       PROVEN
5  -> critical / disabled                         PROVEN
18 -> automatic critical self-repair -> damaged   PROVEN version-scoped behavioral role
19 -> full repair / clear                         PROVEN
```

Crew:

```text
10 -> shell-shocked / injured  PROVEN
22 -> healed / clear           PROVEN
```

Other observed values (`0,1,6,7`) remain PARTIAL/UNKNOWN presentation-transition states.

## High-value physical closures

### Ammo Rack — 32

`codeA=4, codeB=32` produces the independently measured reload penalty; `codeA=19` with Repair Kit/MPRP restores reload duration.

### Gun — 36

A recorder-local natural damage→Repair Kit chain changes method36 targeting parameters reversibly:

```text
field6.field1: 0.9171787581 -> 1.8343575163 -> 0.9171787581
root.field4:   0.7611729934 -> 0.5137917725 -> 0.7611729934
```

The exact ×2 dispersion-like penalty closes `36=Gun` independently from historical ordering.

### Fuel Tank 33 / Observation Device 38

A recorder-local `codeB=38, codeA=5` critical event produces no fire HP tick / proven fire Type32 surface. Critical Fuel Tank damage would ignite; therefore `38=Observation Device`. Exhaustive closure of the current mechanical domain then gives `33=Fuel Tank`.

### Turret Rotator — 37

Damage→automatic repair→full repair lifecycle is accompanied by a strong turret-yaw-rate collapse while translation remains substantial, closing the turret-rotation mechanism.

### Crew

Role-specific behavioral anchors:

- Commander 39: loss/recovery of commander bonus produces the expected small cross-role reload effect;
- Driver 40: closed by current four-role shell-shock domain plus mobility-compatible behavior;
- Gunner 41: injury windows produce strong turret-yaw suppression;
- Loader 43: injury windows produce strong reload degradation and recover through First Aid/MPRP.

## Cross-surface namespace

The same current component identity namespace is reused by:

- method16 `codeB`;
- Type32 damage/recovery tokens;
- method38 repeated shot-result `componentToken`.

Current crew Type32 crosswalk:

```text
0x27 <-> 39 Commander
0x28 <-> 40 Driver
0x29 <-> 41 Gunner
0x2B <-> 43 Loader
```

Do not generalize every prop8 token as a pure crew or pure module token: prop8 remains a mixed recoverable-state collection.

## Consumer contract

```text
VehicleDamageInfoEvent {
    rawClockSec
    vehicleId
    codeARaw
    codeBRaw
    relatedEntityId
    componentName      // version-gated; nullable for unknown 42/future IDs
    stateFamily        // version-gated; nullable for unclosed codeA values
    confidence
}
```

Safe current decoder map:

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
42 UNKNOWN
43 Loader
```

Safe state map:

```text
mechanical 4  DAMAGED_DEGRADED
mechanical 5  CRITICAL_DISABLED
mechanical 18 AUTO_REPAIRED_TO_DAMAGED
mechanical 19 FULL_REPAIRED_CLEAR
crew       10 CREW_SHELL_SHOCKED
crew       22 CREW_HEALED
```

Retain raw IDs and version-gate all decoded names.

## Canonical detailed notes

Use these as evidence sources for the synchronized map:

- `method16-device-crew-code-map.md`
- `method16-damage-state-codeA.md`
- `ammo-rack-and-loader-damage-codes.md`
- `gun-damage-dispersion-closure.md`
- `fuel-tank-observation-device-closure.md`
- `track-side-orientation-closure.md`
- `recovery-consumable-discriminator.md`

Historical PC/WoT schemas remain cross-checks only; current Blitz identities above are promoted from current replay behavior and exhaustive current-domain closure.
