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

The important behavioral fact is that the value almost always alternates on every update for the same vehicle:

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

It is also not a direct copy of Type10 `errorFlag`: the current 49-byte Type10 records use `errorFlag=1` at both property0 values.

Same-clock joins with Vehicle method0 shooting, method6 static collision and method8 damage do not produce a unique state interpretation.

Verdict:

> Vehicle property0 = **alternating boolean/sequence-like vehicle state — PROVEN shape / UNKNOWN exact semantic**.

Do not expose it as movement, visibility, firing, collision or alive state.

## Vehicle property4 — two-u8 discrete vehicle-mode tuple

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

Joining property4 updates to bracketing Type10 movement shows a clear but non-exclusive kinematic relationship.

Median estimated speed by `modeA`:

```text
modeA 0 : ~1.65 m/s
modeA 1 : ~2.07 m/s
modeA 2 : ~4.71 m/s
modeA 3 : ~1.31 m/s
```

`modeA=2` therefore occurs disproportionately in higher-motion periods, but every mode has overlapping speeds. This rules out a simple direct `modeA == moving` boolean/ordinal interpretation.

Median estimated speed also varies by `modeB`; states `1/5/9` are concentrated at higher-motion samples than `0/2/4/8`, supporting a vehicle drivetrain/movement-mode family without closing exact labels.

### Historical schema candidate

Historical Wargaming `Vehicle.def` contains a replay-exposed property:

```text
engineMode : TUPLE<UINT8, size=2>
```

The current Blitz property4 normal body is exactly two uint8 values, and its behavior is compatible with a discrete engine/movement state family.

However property indices drift across entity-definition versions and the current corpus lacks a Blitz 11.19 symbolic producer schema.

Verdict:

> Vehicle property4 = **two-u8 discrete vehicle mode tuple — PROVEN structure / STRONG PARTIAL engine-or-movement-mode family**.
>
> historical `engineMode` = strong schema candidate, **not promoted to exact current symbolic identity**.

## Parser guidance

```text
VehicleProperty0Raw {
    state : u8 // observed 0/1
}

VehicleProperty4Mode {
    modeA : u8
    modeB : u8
}
```

Preserve raw values and version-gate future semantic labels.
