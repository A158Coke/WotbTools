# Method38 high result bits — Type28 selectionValue=2 family

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: current method38 low-16 result bits `0x1000 / 0x2000 / 0x4000` joined to corrected recorder-own-shot Type28 state.

## Executive verdict

After rebuilding the canonical 324 unique recorder shots from raw replay data, the following relationship remains exact:

```text
0x1000 set : 13 / 13 -> Type28 selectionValue = 2
0x2000 set :  1 /  1 -> Type28 selectionValue = 2
0x4000 set :  7 /  7 -> Type28 selectionValue = 2

non-selectionValue-2 occurrences : 0
```

Verdict:

> `0x1000 / 0x2000 / 0x4000` belong to a **selectionValue=2 special-ammunition result family — PROVEN current-corpus relationship**.

Exact individual symbolic names remain PARTIAL/UNKNOWN.

## Important terminology correction

Type28 is proven ammunition selection state, but its numeric wire values are not automatically the user-facing shell-list indices.

Therefore this document deliberately says:

```text
selectionValue=2
```

not:

```text
third shell / UI slot 3
```

until Type28 is joined through method17 shell descriptor to the version-matched shell catalog.

## Corrected shot association

All joins use:

```text
method29.shooterId == recorderVehicleEntity
unique (arena, shotId)
latest Type28 value in same arena at method29 launch clock
```

No Type28 state is carried across arena/init boundaries.

This reconstruction produces exactly:

```text
324 unique recorder shots == 324 settlement shots
```

and supersedes the stale aggregate table previously present in the Type28 note.

## Current high-bit populations

```text
0x1000 : 13
0x2000 :  1
0x4000 :  7
```

Vehicle distribution:

```text
0x1000
  GB13_FV215b : 11
  A178_SPHT   :  2

0x2000
  A178_SPHT   :  1

0x4000
  GB13_FV215b :  6
  A178_SPHT   :  1
```

No current Ho-Ri, Maus or VK 72.01 event sets these bits.

## FV215b selectionValue=2 behavior

Current FV215b gameplay shell families are AP / APCR / HE-family.

Replay ballistic families:

```text
selectionValue 0 -> ~1152.36 m/s
selectionValue 1 -> ~1440.72 m/s
selectionValue 2 -> ~1152.36 m/s
```

The high-velocity value 1 family is independently compatible with APCR.

Hit-damage distributions further distinguish value 2 from value 0:

```text
FV selectionValue 0 hits:
  n      = 10
  median = 365.5
  max    = 481

FV selectionValue 2 hits:
  n      = 12
  median = 149
  max    = 537
```

The low median and broad damage behavior are strongly HE-like, while value 0 behaves like the ordinary AP-family branch.

This is strong behavioral evidence that FV `selectionValue=2` is the HE-family selection, but exact production naming should still use method17 descriptor -> current shell catalog.

## Why historical upper flag names are not safe

Historical PC/WoT `VEHICLE_HIT_FLAGS` assigned generic module/explosion names to similar numeric positions.

Current Blitz 11.19 instead shows exact selectionValue=2 exclusivity for all observed `0x1000/0x2000/0x4000` events.

Therefore historical ordinal names cannot be transplanted directly.

Safe current interpretation:

```text
selectionValue=2
-> special shell resolution branch
-> one or more of 0x1000 / 0x2000 / 0x4000 describe sub-results
```

not:

```text
0x1000 == universal Gun damage
0x4000 == universal module damage
```

## Relationship to component result tokens

The selectionValue=2 branch may produce multiple component result tokens with independent rawState outcomes.

This is compatible with HE/explosion-style internal resolution where one shell can interact with several modules/crew elements and each component has its own damage probability/state outcome.

Do not conflate:

```text
high hit-result bit
component token
rawState
```

They are separate dimensions of the shot result.

## Safe model

```text
ShotResultFeedback {
    resultFlags16
    ammunitionSelectionValue
    componentResults[]
}

if flags & (0x1000 | 0x2000 | 0x4000) != 0:
    current corpus requires ammunitionSelectionValue == 2
```

Exact bit names remain nullable.

## Remaining work

1. close Type28 selectionValue=2 -> exact method17 shell descriptor per vehicle;
2. map FV descriptor to AP/APCR/HE-family in the version-matched catalog;
3. recover SPHT selectionValue=2 shell type;
4. separate `0x1000`, `0x2000`, `0x4000` by penetration/explosion/module behavior;
5. add controlled HE/HESH samples if current counts remain too small.
