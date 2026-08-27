# Crew/tankman damage and First Aid recovery

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.

## Executive verdict

The current corpus gives direct wire-level evidence that `0x0C` is the **First Aid Kit** and now also closes the crew/tankman recoverable-token identities through the shared method16 component namespace.

- exactly 5 `0x0C`, state-2 activations exist;
- all 5 are preceded by a real hit and exactly one mobile Type32 short nested-property mutation about 0.8–2.1 s earlier;
- precursor terminal values are `0x27`, `0x29`, or `0x2B`;
- at the exact activation clock, Vehicle prop8 is rewritten to a full post-recovery collection in which that precursor value is absent;
- Repair Kit (`0x0D`) can leave `0x28` / `0x2B` behind, while a later Multi-Purpose Restoration Pack (`0x0B`) clears them;
- same-clock Avatar method16 crew-shell-shock events use numerically identical `codeB` values.

Verdict:

> `0x0C` = **First Aid Kit — PROVEN direct behavioral identity** for the current corpus.

> current crew recoverable tokens use the **same numeric component namespace as method16 `codeB` — PROVEN**.

Current closed identities:

```text
0x27 / 39 = Commander
0x28 / 40 = Driver
0x29 / 41 = Gunner
0x2B / 43 = Loader
```

All four are **PROVEN current 11.19 identities** through the method16 physical-role closures documented in `method16-device-crew-code-map.md`.

## Same-clock namespace closure

At crew shell-shock onset, method16 and Type32 short nested mutations align on the same vehicle and clock.

Representative current pairs:

```text
method16 codeB=39  <-> Type32 ...27
method16 codeB=40  <-> Type32 ...28
method16 codeB=41  <-> Type32 ...29
method16 codeB=43  <-> Type32 ...2B
```

The byte values are exactly the hexadecimal representation of the method16 decimal component IDs:

```text
39 decimal = 0x27
40 decimal = 0x28
41 decimal = 0x29
43 decimal = 0x2B
```

This is not a statistical coincidence: the values occur at the same injury boundary, are selectively cleared by First Aid / MPRP, and each method16 role has an independent current-Blitz physical closure.

Safe conclusion:

> Type32 crew nested mutation token = **current crew component ID** in the same namespace as method16 `codeB` — PROVEN.

Important boundary:

> this does **not** imply every element of Vehicle prop8 is universally a literal method16 codeB. prop8 is a broader mixed recoverable-state collection and the previous universal element=component decoder remains rejected.

## Five First Aid chains

```text
Skit         a1 80 29 -> 0x0C after ~1.60 s -> prop8 [0x23]
Skit         a1 80 2b -> 0x0C after ~0.80 s -> prop8 [0x20]
Karelia      a0 29    -> 0x0C after ~1.22 s -> prop8 []
Desert Train a1 80 27 -> 0x0C after ~1.18 s -> prop8 [0x20]
Lumber       a0 29    -> 0x0C after ~2.12 s -> prop8 []
```

With the current role mapping these become:

```text
0x27 = Commander
0x29 = Gunner
0x2B = Loader
```

For all five:

```text
precursor crew token absent from post-First-Aid prop8 : 5 / 5
```

The non-empty post-recovery collections are important: First Aid selectively removes the crew state while unrelated mechanical/recoverable state can remain.

## Vehicle prop8 structure

Vehicle prop8 is a full byte-list snapshot:

```text
count : u8
tokens[count] : u8
```

Examples:

```text
00          -> []
01 23       -> [0x23]
01 22       -> [0x22]
01 28       -> [0x28]
02 23 22    -> [0x23, 0x22]
03 2b 25 20 -> [0x2b, 0x25, 0x20]
```

Because Type32 is nested/slice-property transport, injury can be applied through a compact nested mutation without requiring a simultaneous top-level prop8 setter. The recovery path can later publish the complete collection through Type7 prop8.

For the proven crew subset, prop8 tokens may safely be interpreted as:

```text
0x27 COMMANDER_SHELL_SHOCKED
0x28 DRIVER_SHELL_SHOCKED
0x29 GUNNER_SHELL_SHOCKED
0x2B LOADER_SHELL_SHOCKED
```

Other prop8 token values remain separately evidence-graded; do not infer their identity from numerical proximity alone.

## Repair Kit vs MPRP differential

For recovery activations having a same-clock prop8 setter and a preceding short state mutation within five seconds:

```text
0x0B MPRP:
matched = 251
last short token absent after recovery = 251 / 251

0x0D Repair Kit:
matched = 120
last short token absent = 117 / 120
last short token retained = 3 / 120
```

The retained values are:

```text
0x28 : 2  -> Driver
0x2B : 1  -> Loader
```

This is now an even stronger negative control: Repair Kit can clear the simultaneous mechanical state but leaves a proven crew shell-shock token intact.

### Direct mixed-state chain — Rift

```text
162.0985  Type32 a0 24
162.5987  Type32 a1 80 2b   // Loader shell-shocked
163.1989  0x0D Repair Kit
163.1989  prop8 = [0x2B]
165.6916  0x0B Multi-Purpose Restoration Pack
165.6916  prop8 = []
```

Repair Kit removes the Repair-compatible state but leaves the Loader shell-shock state; the all-purpose restoration pack then clears it.

### Direct mixed-state chain — Karelia

```text
104.5838  Type32 a0 22
107.3017  Type32 a1 80 28   // Driver shell-shocked
108.5862  0x0D Repair Kit
108.5862  prop8 = [0x28]
```

Again, the Repair Kit does not heal the Driver.

## Current Blitz role semantics

Current Blitz shell-shock gameplay has four relevant combat crew roles:

```text
Commander -> view range halved; commander's bonus removed
Gunner    -> dispersion worsened; aiming/turret traverse slowed
Loader    -> reload speed halved
Driver    -> top speed halved; maneuverability/acceleration reduced
```

The replay mapping now matches these four roles:

```text
39 / 0x27 Commander
40 / 0x28 Driver
41 / 0x29 Gunner
43 / 0x2B Loader
```

There is no current Radioman role in this Blitz shell-shock model, and the old PC/WoT five-role ordering must not be imported.

## Safe current model

```text
VehicleRecoverableExtraState {
    token
    category
    exactName
    confidence
}
```

For current 11.19 crew tokens:

```text
0x27 -> COMMANDER_SHELL_SHOCKED  PROVEN
0x28 -> DRIVER_SHELL_SHOCKED     PROVEN
0x29 -> GUNNER_SHELL_SHOCKED     PROVEN
0x2B -> LOADER_SHELL_SHOCKED     PROVEN
```

Other tokens remain raw until independently closed.

## Remaining work

1. close the remaining mechanical prop8 / Type32 token identities without assuming universal element=codeB semantics;
2. determine whether prop8 corresponds exactly to historical `destroyedDevices` or another current Blitz collection;
3. recover the compressed Type32 property path so nested mutations can be mapped to their root property directly;
4. validate on additional versions and controlled samples.
