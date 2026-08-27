# Type7 property1 / property7 / property8 — terminal-state and compact-array structure

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Numeric property IDs are entity-class and version scoped.

## Vehicle property1 — terminal inactive / crew-active-false family

Current property1 observations:

```text
records     : 351
payload len : 1 byte
payload     : 00 in 351 / 351
```

The key relationship is exact against the independently proven Vehicle property3 current-HP terminal states.

Across the canonical corpus:

```text
property1=00 with same entity + same clock terminal prop3 : 351 / 351
terminal prop3 events with same entity + same clock prop1=00 : 351 / 351
```

The terminal prop3 distribution paired with property1 is:

```text
0     : 223
-1    : 68
-3    : 59
-2    : 1
```

Therefore property1 is not a generic periodic flag; it changes to false exactly on the vehicle terminal/deactivation boundary.

Historical Wargaming `Vehicle.def` independently contains an ALL_CLIENTS boolean property named `isCrewActive`. A transition to false on the same clock as terminal health is structurally and behaviorally compatible with that semantic family.

Verdict:

> Vehicle property1 = **terminal active/crew-active boolean family — PROVEN behavioral relationship / STRONG PARTIAL exact symbolic name**.

Safe use:

- treat `property1=0` as independent terminal/inactive evidence when version-gated to this corpus;
- combine with property3 terminal HP and Vehicle method1 for death-state reconstruction.

Unsafe without current-version schema:

- expose the exact user-facing/internal symbol `isCrewActive` as guaranteed across Blitz versions;
- infer a specific death reason from property1 alone.

## Vehicle property7 — compact u8 state-array family

Current property7:

```text
records : 307
payload lengths:
  1 byte : 302
  2 byte :   5
```

Every payload satisfies:

```text
payload[0] == payload.length - 1
307 / 307
```

Therefore its wire layout is:

```text
count : u8
elements[count] : u8
```

Observed examples:

```text
00       -> []
01 23    -> [0x23]
01 04    -> [0x04]
01 22    -> [0x22]
```

Property7 is strongly event/effect adjacent: 287/307 records share the same entity and raw clock with at least one Type32 entity-auxiliary packet.

Verdict:

> Vehicle property7 = **compact u8 enum/state array — PROVEN structure / PARTIAL semantic**.

The element namespace is not yet closed.

## Vehicle property8 — compact u8 state-array family

Current property8:

```text
records : 790
payload lengths:
  1 byte : 496
  2 byte : 249
  3 byte :  40
  4 byte :   5
```

Every payload satisfies the same count-prefix invariant:

```text
payload[0] == payload.length - 1
790 / 790
```

Safe wire layout:

```text
count : u8
elements[count] : u8
```

Representative examples:

```text
00          -> []
01 23       -> [0x23]
01 22       -> [0x22]
01 28       -> [0x28]
02 23 22    -> [0x23, 0x22]
03 2b 25 20 -> [0x2b, 0x25, 0x20]
```

The array ordering is preserved as observed; consumers must not sort or collapse the raw element list until the current Blitz producer semantics are known.

Property8 is even more tightly coupled to Type32 auxiliary/effect traffic:

```text
property8 records sharing same entity + raw clock with Type32 : 789 / 790
```

This proves that property8 belongs to an entity effect/state surface, but does not prove the symbolic meaning of each element.

A direct assumption that the Type32 short body contains the same element byte fails globally; same-clock joins only occasionally share a literal byte. Therefore property8 and Type32 are related state/effect surfaces, not one simple duplicated byte list.

Verdict:

> Vehicle property8 = **compact u8 enum/state array — PROVEN structure / strong effect-state relationship / PARTIAL element semantics**.

## Important negative results

- property7/property8 are not arbitrary opaque blobs;
- their first byte is a count, not an enum value;
- individual elements must not be named as modules, consumables, buffs, crew states, or device IDs from historical tables without current Blitz closure;
- Type32 same-clock coupling is strong, but literal byte equality is not a valid universal decoder.

## Safe parser model

```text
VehicleCompactStateArray {
    propertyId : 7 | 8
    count      : u8
    elements   : u8[count]
}
```

Preserve the raw ordered elements and event clock for future joins against current-version effect/module schemas.
