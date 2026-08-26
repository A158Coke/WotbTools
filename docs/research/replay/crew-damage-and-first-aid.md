# Crew/tankman damage and First Aid recovery

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.

## Executive verdict

The current corpus now gives direct wire-level evidence that `0x0C` is the **First Aid Kit**, not merely a pair-elimination assignment.

- exactly 5 `0x0C`, state-2 activations exist;
- all 5 are preceded by a real hit and exactly one mobile Type32 short nested-property mutation about 0.8–2.1 s earlier;
- precursor terminal values are `0x27`, `0x29`, or `0x2B`;
- at the exact activation clock, Vehicle prop8 is rewritten to a full post-recovery collection in which that precursor value is absent;
- Repair Kit (`0x0D`) can leave `0x28` / `0x2B` behind, while a later Multi-Purpose Restoration Pack (`0x0B`) clears them.

Verdict:

> `0x0C` = **First Aid Kit — PROVEN direct behavioral identity** for the current corpus.

> `0x27/0x28/0x29/0x2B` = **crew/tankman-compatible recoverable-state family — PARTIAL/strong**. Exact token-to-crew-member names remain `UNKNOWN`.

## Five First Aid chains

```text
Skit         a1 80 29 -> 0x0C after ~1.60 s -> prop8 [0x23]
Skit         a1 80 2b -> 0x0C after ~0.80 s -> prop8 [0x20]
Karelia      a0 29    -> 0x0C after ~1.22 s -> prop8 []
Desert Train a1 80 27 -> 0x0C after ~1.18 s -> prop8 [0x20]
Lumber       a0 29    -> 0x0C after ~2.12 s -> prop8 []
```

For all five:

```text
precursor value absent from post-First-Aid prop8 : 5 / 5
```

The non-empty post-recovery collections are important: First Aid selectively removes one recoverable state while unrelated state can remain.

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
02 23 22    -> [0x23, 0x22]
03 23 21 22 -> [0x23, 0x21, 0x22]
```

Because Type32 is nested/slice-property transport, injury can be applied through a compact nested mutation without requiring a simultaneous top-level prop8 setter. The recovery path can later publish the complete collection through Type7 prop8.

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
0x28 : 2
0x2B : 1
```

### Direct mixed-state chain — Rift

```text
162.0985  Type32 a0 24
162.5987  Type32 a1 80 2b
163.1989  0x0D Repair Kit
163.1989  prop8 = [0x2B]
165.6916  0x0B Multi-Purpose Restoration Pack
165.6916  prop8 = []
```

Repair Kit removes the Repair-compatible state but leaves `0x2B`; the all-purpose restoration pack then clears `0x2B`.

### Direct mixed-state chain — Karelia

```text
104.5838  Type32 a0 22
107.3017  Type32 a1 80 28
108.5862  0x0D Repair Kit
108.5862  prop8 = [0x28]
```

Again, the Repair Kit does not remove `0x28`.

## Semantic boundary

Historical Wargaming clients route tankman hit/restored states through the same vehicle-extra/device-state architecture used by mechanical devices. That architecture matches the current observation that crew-compatible and mechanical values can coexist in one recoverable-state collection while different consumables selectively clear them.

Historical numeric extra indices are not reused. Current values remain version-scoped.

Safe current model:

```text
VehicleRecoverableExtraState {
    token        // version-scoped raw byte
    category     // mechanical / crew-compatible / unknown
    exactName    // nullable until independently closed
}
```

## Remaining work

1. distinguish `0x27 / 0x28 / 0x29 / 0x2B` crew-member identities;
2. determine whether prop8 corresponds exactly to historical `destroyedDevices` or another current Blitz collection;
3. recover the compressed Type32 property path so nested mutations can be mapped to their root property directly;
4. validate on additional versions and controlled samples.
