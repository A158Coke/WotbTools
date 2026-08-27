# Type7 property0 / property4 — vehicle mode/state probes

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Numeric property IDs are version- and entity-class-scoped.

## Vehicle property0 — alternating boolean-like state, semantic unresolved

Current property0 is structurally simple:

```text
records     : 62,530
payload len : 1 byte
values      : 0 or 1 only

0 : 31,280
1 : 31,250
```

The value almost always alternates on every update for the same vehicle:

```text
1 -> 0 : 31,161
0 -> 1 : 30,741
1 -> 1 :     80
0 -> 0 :     74
```

Median same-vehicle update interval is approximately 0.50 s, but the distribution is broad.

### Negative controls

Property0 is not a simple moving/stationary flag.

Using nearest bracketing Type10 positions to estimate same-vehicle speed:

```text
value 0 median speed ≈ 4.53 m/s
value 1 median speed ≈ 4.86 m/s
```

The distributions overlap heavily.

It is also not a direct copy of Type10 `errorFlag`, and same-clock joins with firing, static collision and damage do not produce a unique state interpretation.

An older Blitz-native replay property inventory contains a boolean `isStrafing`, but current property0 behavior does not justify equating the two merely because both are boolean. That candidate remains unpromoted.

Verdict:

> Vehicle property0 = **alternating boolean/sequence-like vehicle state — PROVEN shape / UNKNOWN exact semantic**.

## Vehicle property4 — `engineMode` family

Current property4:

```text
records : 146,116

2-byte payload : 146,114
1-byte payload :       2   // class-collision/edge records; do not force through Vehicle tuple decoder
```

For the normal Vehicle form:

```text
modeA : u8
modeB : u8
```

Observed `modeA` domain:

```text
0, 1, 2, 3
```

Observed `modeB` domain:

```text
0, 1, 2, 4, 5, 6, 8, 9, 10
```

The second-byte domain forms three visible groups:

```text
0/1/2
4/5/6
8/9/10
```

which is consistent with a compact composite/discrete mode rather than a continuous scalar.

### Movement relationship

Joining property4 updates to bracketing Type10 movement gives a clear but non-exclusive kinematic relationship.

Median estimated speed by `modeA`:

```text
modeA 0 : ~1.65 m/s
modeA 1 : ~2.07 m/s
modeA 2 : ~4.71 m/s
modeA 3 : ~1.31 m/s
```

`modeA=2` occurs disproportionately in higher-motion periods, but every mode has overlapping speeds. Therefore the tuple is not a simple ordinal speed state.

### Blitz-native symbolic evidence

Two independent symbolic sources now point to the same family:

1. historical Wargaming `Vehicle.def` exposes:

```text
engineMode : TUPLE<UINT8, size=2>
```

2. an older **World of Tanks Blitz replay-code property inventory** independently lists:

```text
engineMode
```

The current 11.19 property4 normal body is exactly the same two-u8 shape and its real movement behavior is consistent with an engine/drivetrain mode tuple.

Verdict:

> Vehicle property4 = **`engineMode` family — PROVEN structure + behavior / VERY STRONG PARTIAL exact current symbolic identity**.

The exact current symbolic name remains one evidence level below unqualified PROVEN only because the available Blitz symbolic listing is from an older client and property indices can drift across entity-definition revisions.

## Parser guidance

```text
VehicleProperty0Raw {
    state : u8
}

VehicleEngineModeCandidate {
    modeA : u8
    modeB : u8
}
```

For 11.19 consumers, `engineMode` is a safe internal family label when explicitly version-scoped; preserve both raw bytes rather than assigning unsupported sub-mode names.
