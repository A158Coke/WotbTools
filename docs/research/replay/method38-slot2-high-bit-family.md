# Method38 high result bits — ammunition-slot-2 special shell family

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: current method38 low-16 result bits `0x1000/0x2000/0x4000`, cross-joined to independently proven recorder Type28 ammunition-slot selection.

## Executive correction

Earlier historical-layout hypotheses that treated these upper low-16 bits as generic projectile module flags are not safe for current Blitz 11.19.

Current corpus gives an exact ammunition-state discriminator:

```text
0x1000 set : 13 / 13 events occur with Type28 slot 2
0x2000 set :  1 /  1 event  occurs with Type28 slot 2
0x4000 set :  7 /  7 events occur with Type28 slot 2

non-slot-2 occurrences for all three bits : 0
```

Therefore these bits belong to a **slot-2 special-shell / explosive-resolution family** in the current evidence model.

## Vehicle concentration

Observed `0x1000` population:

```text
GB13_FV215b : 11
A178_SPHT   :  2
```

Observed `0x4000` population:

```text
GB13_FV215b : 6
A178_SPHT   : 1
```

Observed `0x2000` population:

```text
A178_SPHT   : 1
```

No Maus, Ho-Ri, or VK 72.01 shot in the current corpus sets these bits.

## Independent ammunition identity

Type28 is independently proven as recorder ammunition-slot selection.

For FV215b the current BlitzKit tank definition exposes three shell families in order:

```text
slot 0 -> AP-T L1
slot 1 -> APDS L1
slot 2 -> HESH-T L1
```

Thus every current FV215b occurrence of `0x1000/0x4000` is on the HESH slot.

SPHT likewise exposes three shell descriptors (`T102 SPHT`, `M469 SPHT`, `M356 SPHT`); current replay data proves the high-bit events occur only on its slot 2, while exact public shell-type naming for M356 should be independently verified before labeling the bit family HE/HESH-specific across both vehicles.

## Current slot-2 flag combinations

Observed slot-2 method38 flag words include:

```text
0x0020
0x0110
0x1020
0x1021
0x2020
0x5010
0x5020
0x5100
```

This demonstrates that `0x1000`, `0x2000`, and `0x4000` participate in combinations with ordinary penetration/device-result bits rather than acting as a single shell-type enum.

The strongest safe model is therefore:

```text
slot 2 selects the special/explosive shell family
upper result bits describe branches of that shell's hit/explosion resolution
```

not:

```text
0x1000 == Gun damaged globally
0x4000 == one universal module damage bit
```

## Relationship to rawState=0

Many `rawState=0` component entries occur on FV215b slot-2 hits carrying `0x1000|0x4000`.

This no longer implies that rawState=0 itself is an exotic module state. The cleaner interpretation is:

1. the special shell/explosion path reaches multiple components;
2. each component is listed in the method38 result list;
3. each component independently resolves its damage roll;
4. `rawState=0` means no new persistent module damage was applied to that component;
5. `rawState=1/2` identify successful damaged/critical outcomes.

This separation is consistent with mixed-result single hits where some internal elements have state 0 and another component/crew member has state 1 or 2.

## Evidence grade

```text
0x1000/0x2000/0x4000 -> slot-2 special/explosive-shell resolution family
    PROVEN current-corpus relationship

exact individual symbolic names
    PARTIAL / UNKNOWN
```

Historical PC/WoT numeric names for these positions are explicitly not authoritative for current Blitz 11.19 because the exact slot-2 exclusivity conflicts with a generic module-flag interpretation.

## Next closure

To separate the three bits individually:

1. recover the exact SPHT slot-2 shell type from a version-matched data definition;
2. classify HESH/HE direct penetration, non-penetrating splash, armor absorption, and module-only outcomes;
3. join method8 compact local hit segment and HP delta;
4. compare `0x1000` vs `0x2000` vs `0x4000` against direct-hit and explosion/splash geometry;
5. add controlled HE/HESH samples if the current 16 slot-2 hits remain insufficient.