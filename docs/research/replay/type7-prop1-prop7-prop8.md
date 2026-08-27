# Type7 property1 / property7 / property8 — terminal-state and compact-array structure

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Numeric property IDs are entity-class and version scoped.

## Vehicle property1 — `isAlive` false boundary

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

### Blitz-native symbolic evidence

An old **World of Tanks Blitz replay-code property inventory** independently lists a replay property named:

```text
isAlive
```

alongside other replay properties that are already independently recovered in the current 11.19 corpus (`health`, `engineMode`, `criticalDevices`, `destroyedDevices`, `publicStateModifiers`, etc.).

That Blitz-native evidence is materially stronger than importing a PC-only `isCrewActive` name. The current behavior also fits `isAlive` more directly: the only observed property1 transition is `false` exactly at terminal vehicle state.

Verdict:

> Vehicle property1 = **vehicle alive-state false boundary — PROVEN behavioral identity / VERY STRONG PARTIAL exact current symbolic name `isAlive`**.

Why the exact name remains one level below unqualified PROVEN:

- the symbolic source is an older Blitz replay implementation rather than the exact 11.19 producer schema;
- numeric property indices can drift when entity definitions change.

Safe use:

- treat `property1=0` as independent terminal/not-alive evidence for the current version family;
- combine with property3 terminal HP and Vehicle method1 for death-state reconstruction.

Do not infer a specific death reason from property1 alone.

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

The Blitz-native replay property inventory contains several array/state families including `criticalDevices`, `destroyedDevices`, `publicStateModifiers`, and `activeEquipments`. That makes one of these families a plausible symbolic source, but the current corpus does **not** uniquely map property7 to one exact name.

Verdict:

> Vehicle property7 = **compact u8 enum/state array — PROVEN structure / PARTIAL semantic**.

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

Every payload satisfies:

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

Property8 is tightly coupled to Type32 auxiliary/effect traffic:

```text
property8 records sharing same entity + raw clock with Type32 : 789 / 790
```

It also reacts frequently on method16 module/crew repair/heal boundaries, but a direct literal `property8 element == method16 codeB` decoder fails. Therefore property8 is a related effect/device/state surface, not a simple list of method16 component IDs.

Verdict:

> Vehicle property8 = **compact u8 enum/state array — PROVEN structure / strong effect-state relationship / PARTIAL symbolic identity and element semantics**.

## Important negative results

- property7/property8 are not arbitrary opaque blobs;
- their first byte is a count, not an enum value;
- individual elements must not be named as modules, consumables, buffs, crew states, or device IDs from historical tables without current closure;
- Type32 same-clock coupling is strong, but literal byte equality is not a valid universal decoder;
- the older Blitz names `criticalDevices` / `destroyedDevices` / `publicStateModifiers` are useful candidate families, but current numeric property-to-name assignment is not yet uniquely proven.

## Safe parser model

```text
VehicleCompactStateArray {
    propertyId : 7 | 8
    count      : u8
    elements   : u8[count]
}
```

Preserve the raw ordered elements and event clock for future version-matched schema joins.
