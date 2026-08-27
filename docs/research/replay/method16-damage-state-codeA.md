# Avatar method16 — `codeA` damage-state lifecycle

> Base corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Additional controlled evidence: Maus Fuel Tank / Observation Device probe on `11.19.0_china_apple`.
>
> `codeA` is interpreted together with `codeB`; do not assume every numeric state has identical semantics for every component family.

## Mechanical device lifecycle

### `codeA=4` — common damaged / degraded but operational

Independent physical anchors include tracks, Ammo Rack and other modules. Vehicles remain operational with degraded performance.

Verdict:

> mechanical `codeA=4` = **common damaged / degraded operational state — PROVEN family-level physical role**.

The controlled Maus replay independently reproduces this on Fuel Tank:

```text
62.243s  codeA=4, codeB=33 Fuel Tank
86.843s  codeA=4, codeB=33 Fuel Tank
```

### `codeA=5` — critical / disabled module state

Track and Engine samples independently show severe functional loss; current module mechanics match a critical/disabled state.

Verdict:

> mechanical `codeA=5` = **critical / disabled device state — PROVEN family-level physical role**.

The controlled Maus Observation Device probe gives another direct sample:

```text
38.441s  codeA=5, codeB=38 Observation Device
44.844s  codeA=18, codeB=38
```

### `codeA=8` — Fuel Tank ignition / fire-start transition

This state was not closed in the original 34-arena corpus. A controlled Maus Fuel Tank probe now supplies a direct positive chain:

```text
62.243s  codeA=4, codeB=33
         Fuel Tank damaged

65.342s  codeA=8, codeB=33
         Type32 short state `9c04`

65.843s  Vehicle method1 causeFlag=1
66.343s  Vehicle method1 causeFlag=1
         consecutive fire-DOT HP losses
```

The `codeA=8` event therefore occurs at the Fuel Tank transition that initiates the observed fire family.

Safe current interpretation:

> `codeA=8` **when paired with `codeB=33 Fuel Tank` = Fuel Tank ignition / fire-start transition — PROVEN controlled physical relationship**.

The exact private enum name is still unknown.

Important boundary:

- do **not** generalize `codeA=8` as a universal mechanical state;
- no controlled evidence yet shows what `codeA=8` would mean on another component, or whether another component can emit it at all.

### `codeA=18` — automatic critical self-repair to degraded/common-damaged state

Canonical Engine behavior already closes the state physically. The controlled Observation Device replay independently reproduces the same lifecycle:

```text
38.441s  codeA=5,  codeB=38
44.844s  codeA=18, codeB=38
```

No Repair Kit boundary is required for this transition.

Verdict:

> mechanical `codeA=18` = **automatic recovery from critical/disabled to common-damaged operational state — PROVEN behavioral role / version-scoped**.

### `codeA=19` — full repair / clear

Source-less `codeA=19` events synchronize with Repair Kit / Multi-Purpose Restoration Pack boundaries and clear persistent module damage.

The controlled Maus replay includes:

```text
66.643s  codeA=19, codeB=33 Fuel Tank
66.643s  codeA=19, codeB=38 Observation Device
95.939s  codeA=19, codeB=33 Fuel Tank
```

Verdict:

> mechanical `codeA=19` = **fully repaired / cleared device damage state — PROVEN**.

## Crew lifecycle

### `codeA=10` — crew shell-shocked / injured

Current crew IDs are independently closed as Commander, Driver, Gunner and Loader. Role-specific degradation closes this state.

Verdict:

> crew `codeA=10` = **crew member shell-shocked / injured — PROVEN family-level**.

### `codeA=22` — crew healed / clear

Observed source-less transitions synchronize with First Aid Kit / Multi-Purpose Restoration Pack and remove role degradation.

Verdict:

> crew `codeA=22` = **crew healed / shell-shock cleared — PROVEN family-level**.

## Other `codeA` values

Other observed values such as:

```text
0, 1, 6, 7
```

remain presentation/severity/transition candidates without isolated current physical closure.

Keep them raw/PARTIAL.

## Safe current state model

```text
mechanical:
    codeA=4  -> DAMAGED_DEGRADED
    codeA=5  -> CRITICAL_DISABLED
    codeA=8  -> FUEL_TANK_IGNITION_OR_FIRE_START   // only proven with codeB=33
    codeA=18 -> AUTO_REPAIRED_TO_DAMAGED
    codeA=19 -> FULLY_REPAIRED_CLEAR

crew:
    codeA=10 -> CREW_SHELL_SHOCKED
    codeA=22 -> CREW_HEALED
```

Consumers must retain raw `codeA`, `codeB`, client version, and confidence for unclosed combinations.
