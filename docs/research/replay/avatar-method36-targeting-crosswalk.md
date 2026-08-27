# Avatar method36 — targeting-info crosswalk

> Scope: Blitz 11.19 China `Avatar method36` targeting protobuf.
>
> Historical Wargaming targeting APIs are architecture cross-checks only. Current Blitz field semantics below come from current replay behavior and controlled probes.

## Current 11.19 physical-role map

```text
root.field1
= turret/gun relative yaw
= PROVEN

root.field2
= gun pitch
= PROVEN

root.field3
= max horizontal turret/gun angular speed
= PROVEN controlled

root.field4
= max vertical gun angular speed
= PROVEN controlled

root.field5
= aiming-time physical scalar
= PROVEN

field6.field1
= dynamic gun dispersion / bloom scalar
= PROVEN physical role
```

These statements describe the **physical roles carried by the current replay fields**. They do not claim recovery of Wargaming's private protobuf member names.

## Current protobuf shape

The dynamic method36 protobuf exposes nine fixed64/double-like scalars:

```text
root.field1 : fixed64
root.field2 : fixed64
root.field3 : fixed64
root.field4 : fixed64
root.field5 : fixed64
root.field6 {
  field1 : fixed64
  field2 : fixed64
  field3 {
    field1 {
      field1 { field1 : fixed64 }
      field2 { field1 : fixed64 }
    }
  }
}
```

Original 34-arena corpus:

```text
method36 total                     858
dynamic 92-byte records            824
initialization-like 74-byte records 34
recorder launches bracketed by PRE/POST method36 snapshots 326 / 326
```

## Evidence for the closed physical roles

### root.field1 / root.field2

Current replay correlation with the independent Type39 aim/gun stream closes:

```text
root.field1 <-> Type39 f5 -> turret/gun relative yaw   PROVEN
root.field2 <-> Type39 f6 -> gun pitch                 PROVEN
```

### root.field3 / root.field4

Controlled angular-rate probes independently match the method36 values:

```text
root.field3 -> horizontal turret/gun angular-speed limit   PROVEN controlled
root.field4 -> vertical gun angular-speed limit            PROVEN controlled
```

The vertical closure uses the Type39 gun-pitch derivative and matches the method36 scalar to replay clock/sampling tolerance.

### root.field5

Reticle Calibration supplies an exact reversible perturbation:

```text
baseline -> active -> baseline
root.field5 ×0.70 during active window
```

This matches the aiming-time mechanic and closes:

```text
root.field5 = aiming-time physical scalar   PROVEN
```

### field6.field1

Three independent current-version behaviors close the physical role:

```text
ordinary shot       -> immediate positive bloom increase
Gun damage          -> field6.field1 ×2
Repair              -> exact baseline restoration
Reticle Calibration -> field6.field1 ×0.70
Reticle end         -> exact baseline restoration
```

Therefore:

```text
field6.field1 = dynamic gun dispersion / bloom scalar
              = PROVEN physical role
```

## Historical architecture cross-check

Historical Wargaming targeting APIs expose the same broad family of concepts: turret yaw, gun pitch, horizontal/vertical rotation limits, dispersion factors and aiming time. This supports the family-level interpretation of method36 but is not used to assign current fields by ordinal position.

## Remaining schema boundaries

```text
exact private Wargaming protobuf symbols                 UNKNOWN
exact display/UI formula for root.field5                 UNKNOWN/PARTIAL
exact display/UI unit/formula for field6.field1          UNKNOWN/PARTIAL
field6.field2 exact physical role/private symbol         PARTIAL
remaining nested static coefficient roles/private names  PARTIAL
cross-version numeric/schema stability                   UNKNOWN until regression-tested
```

The key distinction is intentional:

> **physical role: PROVEN**
>
> **private Wargaming field symbol: UNKNOWN**

Production may use the proven physical roles while preserving raw protobuf values and version provenance.