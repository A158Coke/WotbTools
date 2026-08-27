# Avatar method16 — `codeA` damage-state lifecycle

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> This note describes the state/action role of method16 `codeA`, independently from the device/crew identity carried by `codeB`.

## Mechanical device lifecycle

Current mechanical `codeB` values occupy the `31..38` family. The most useful state anchors come from the independently proven two-side track family (`codeB=34/35`) and ammo rack (`codeB=32`).

### `codeA=4` — damaged / critical but still operational

For track-side events with `codeA=4`:

```text
usable kinematic samples : 38
median post-event speed   : ~3.15 m/s
median post/pre speed ratio: ~1.01
```

The vehicle commonly remains mobile. This is inconsistent with a fully destroyed track state.

For ammo-rack `codeB=32`, `codeA=4` produces the persistent reload-duration penalty proven through Avatar method35 while leaving the weapon operational.

Verdict:

> mechanical `codeA=4` = **damaged/critical device state — PROVEN family-level physical role**.

The exact UI adjective may vary by module and client version.

### `codeA=5` — destroyed / severely disabled device state

For track-side events with `codeA=5`:

```text
usable kinematic samples : 31
median post-event speed   : ~0.70 m/s
median post/pre speed ratio: ~0.31
```

The lower quartile contains near-zero movement ratios, matching a broken-track immobilization state. Player input and momentum prevent every short post-hit window from becoming exactly zero immediately.

Verdict:

> mechanical `codeA=5` = **destroyed/severely disabled device state — PROVEN family-level physical role**.

### `codeA=19` — repair / clear

For proven mechanical codes (ammo rack and track family), source-less `codeA=19` events occur at the module recovery boundary and are repeatedly synchronized with:

```text
Repair Kit
or
Multi-Purpose Restoration Pack
```

For ammo rack, method35 reload duration returns to its normal configuration after the clear.

Verdict:

> mechanical `codeA=19` = **repaired/cleared device damage state — PROVEN**.

## Crew lifecycle

The current crew/tankman family occupies the high `codeB` range. Loader (`codeB=43`) is independently proven.

### `codeA=10` — crew injured / shell-shocked

Loader `codeB=43` with `codeA=10` produces a strong persistent reload-speed penalty.

Other high-range crew codes 39/40/41 use the same onset state.

Verdict:

> crew `codeA=10` = **crew member injured/shell-shocked — PROVEN family-level**.

### `codeA=22` — crew healed / clear

Loader and the other sampled crew codes clear through source-less `codeA=22`, synchronized with:

```text
First Aid Kit
or
Multi-Purpose Restoration Pack
```

Loader reload performance returns after the clear.

Verdict:

> crew `codeA=22` = **crew healed/cleared — PROVEN family-level**.

## Other `codeA` values

Observed mechanical codes also include values such as:

```text
0,1,6,7,18
```

These likely represent additional presentation/severity/transition states, but the current corpus does not isolate their exact role cleanly enough to assign symbolic labels.

They remain raw/PARTIAL.

## Safe current state model

```text
if codeB in proven/candidate mechanical-device namespace:
    codeA=4  -> DAMAGED_CRITICAL
    codeA=5  -> DESTROYED_DISABLED
    codeA=19 -> REPAIRED_CLEAR

if codeB in crew namespace:
    codeA=10 -> CREW_INJURED
    codeA=22 -> CREW_HEALED
```

Consumers must still retain raw `codeA` and `codeB` for version gating and unclosed states.
