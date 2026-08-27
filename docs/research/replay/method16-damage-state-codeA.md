# Avatar method16 — `codeA` damage-state lifecycle

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> This note describes the state/action role of method16 `codeA`, independently from the device/crew identity carried by `codeB`.

## Mechanical device lifecycle

Current mechanical `codeB` values occupy the `31..38` family. The most useful state anchors come from the independently proven engine (`31`), ammo rack (`32`), track pair (`34/35`) and turret rotator (`37`).

### `codeA=4` — common damaged / degraded but operational

For track-side events with `codeA=4`:

```text
usable kinematic samples : 38
median post-event speed   : ~3.15 m/s
median post/pre speed ratio: ~1.01
```

The vehicle commonly remains mobile. This is inconsistent with a fully destroyed track state.

For ammo-rack `codeB=32`, `codeA=4` produces the persistent reload-duration penalty proven through Avatar method35 while leaving the weapon operational.

Current Blitz module rules describe this family as common damage: the module remains operational with reduced performance.

Verdict:

> mechanical `codeA=4` = **common damaged / degraded operational state — PROVEN family-level physical role**.

### `codeA=5` — critical / disabled module state

For track-side events with `codeA=5`:

```text
usable kinematic samples : 31
median post-event speed   : ~0.70 m/s
median post/pre speed ratio: ~0.31
```

The lower quartile contains near-zero movement ratios, matching a broken-track immobilization state. Player input and momentum prevent every short post-hit window from becoming exactly zero immediately.

The engine anchor gives a second role-specific closure:

```text
202.527 s  codeA=5, codeB=31 Engine
205.48 .. 206.68 s  translation effectively zero
```

Current Blitz rules define critical Engine damage as movement/traverse impossible.

Verdict:

> mechanical `codeA=5` = **critical / disabled device state — PROVEN family-level physical role**.

### `codeA=18` — automatic critical self-repair to degraded/common-damaged state

A current recorder-local Engine chain supplies the clearest natural closure:

```text
202.527 s  codeA=5, codeB=31  // Engine critical/disabled
           Type32 token 0x1F

205.48 .. 206.68 s
           vehicle translation effectively zero

206.726 s  codeA=18, codeB=31
           Type32 transition on token 0x1F

206.78 s+
           translation resumes without Repair Kit activation
```

Current Blitz module mechanics state that a critically damaged module self-repairs after a period into the common-damaged state: it becomes operational again but remains degraded until a Repair Kit fully restores it.

The observed non-consumable transition from immobilized Engine to moving vehicle matches that lifecycle directly.

Verdict:

> mechanical `codeA=18` = **automatic recovery from critical/disabled to common-damaged operational state — PROVEN behavioral role on current Engine sample / version-scoped**.

The exact internal enum symbol is still unknown; consumer semantics should describe the physical transition rather than invent a historical constant name.

### `codeA=19` — full repair / clear

For proven mechanical codes, source-less `codeA=19` events occur at the module recovery boundary and are repeatedly synchronized with:

```text
Repair Kit
or
Multi-Purpose Restoration Pack
```

For ammo rack, method35 reload duration returns to its normal configuration after the clear.

Unlike `codeA=18`, this is the explicit full-repair path rather than automatic critical self-repair into a still-damaged state.

Verdict:

> mechanical `codeA=19` = **fully repaired / cleared device damage state — PROVEN**.

## Crew lifecycle

The current Blitz crew-shell-shock component IDs are independently closed as:

```text
39 Commander
40 Driver
41 Gunner
43 Loader
```

### `codeA=10` — crew shell-shocked / injured

Role-specific physical closures include:

- Commander: loss of commander bonus causes small cross-role reload degradation;
- Driver: current four-role closure plus mobility-compatible behavior;
- Gunner: strong turret-yaw suppression;
- Loader: strong reload-speed penalty.

Verdict:

> crew `codeA=10` = **crew member shell-shocked / injured — PROVEN family-level**.

### `codeA=22` — crew healed / clear

The sampled crew codes clear through source-less `codeA=22`, synchronized with:

```text
First Aid Kit
or
Multi-Purpose Restoration Pack
```

Role-specific degraded behavior disappears after the heal boundary.

Verdict:

> crew `codeA=22` = **crew healed / shell-shock cleared — PROVEN family-level**.

## Other `codeA` values

Observed mechanical codes also include values such as:

```text
0, 1, 6, 7
```

These remain presentation/severity/transition candidates without enough isolated current physical evidence for exact symbolic labels.

Keep them raw/PARTIAL.

## Safe current state model

```text
mechanical:
    codeA=4  -> DAMAGED_DEGRADED
    codeA=5  -> CRITICAL_DISABLED
    codeA=18 -> AUTO_REPAIRED_TO_DAMAGED   // version-scoped behavioral name
    codeA=19 -> FULLY_REPAIRED_CLEAR

crew:
    codeA=10 -> CREW_SHELL_SHOCKED
    codeA=22 -> CREW_HEALED
```

Consumers must still retain raw `codeA` and `codeB` for version gating and unclosed states.
