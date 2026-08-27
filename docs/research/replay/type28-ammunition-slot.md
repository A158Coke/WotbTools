# Type28 — recorder ammunition selection state

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Numeric slot values are current-version wire values. Do not assume they equal the user-facing shell-list index without descriptor closure.

## Wire shape

```text
payload : u32 LE selectionValue
```

Observed current domain:

```text
0, 1, 2
```

## Recorder-shot population

Recorder identity is resolved independently from recorder-scoped Avatar/Vehicle relationships and same-clock shot-result attacker closure.

Filter:

```text
Avatar method29.shooterId == recorderVehicleEntity
```

Deduplicate by:

```text
(arena, shotId)
```

Current strict corpus:

```text
method29 recorder-owned RPC records : 326
unique recorder shotIds             : 324
settlement recorder shots fired     : 324
```

The two extra method29 records are duplicate delivery observations. The semantic own-shot population closes exactly against settlement.

## Corrected per-vehicle shot audit

A previous version of this document contained a stale per-vehicle Type28 table whose counts summed to more than the proven 324 recorder-shot total. That table is SUPERSEDED.

Rebuilding from the raw 34 replays with arena-local Type28 state and unique recorder shotIds gives:

```text
A178_SPHT       : 222 shots
GB13_FV215b     :  32
J20_Ho_Ri_type3 :  17
Maus            :  49
VK 72.01        :   4
----------------------
total           : 324
```

Some shots occur before the first explicit Type28 selection packet in their arena. Those must remain UNKNOWN rather than inheriting state across an arena/init boundary.

### Selection-value distribution

```text
A178_SPHT
  unknown-before-first-selection : 27
  value 0                        : 127
  value 1                        : 61
  value 2                        : 7

GB13_FV215b
  unknown-before-first-selection : 7
  value 0                        : 10
  value 1                        : 2
  value 2                        : 13

J20_Ho_Ri_type3
  value 0 : 8
  value 1 : 9

Maus
  value 0 : 40
  value 1 : 9

VK 72.01
  unknown-before-first-selection : 2
  value 0                        : 1
  value 1                        : 1
```

## Ballistic closure

For each unique recorder-owned method29 launch, carry forward the current arena-local Type28 value at the **launch clock** and inspect the independently decoded launch-velocity magnitude.

Corrected current families:

```text
A178_SPHT
  value 0 : n=127, velocity ~760
  value 1 : n=61,  velocity ~560
  value 2 : n=7,   velocity ~560

GB13_FV215b
  value 0 : n=10, velocity ~1152.36
  value 1 : n=2,  velocity ~1440.72
  value 2 : n=13, velocity ~1152.36

J20_Ho_Ri_type3
  value 0 : n=8, velocity ~972
  value 1 : n=9, velocity ~1026

Maus
  value 0 : n=40, velocity ~680
  value 1 : n=9,  velocity ~1032

VK 72.01
  value 0 : n=1, velocity ~600
  value 1 : n=1, velocity ~552
```

Within each vehicle, Type28 partitions recorder shots into stable ammunition/ballistic families. This is incompatible with the old target-lock/auto-aim hypothesis.

## Relationship to method17 shell descriptors

Avatar method17 is independently proven as recorder ammunition state and exposes a current shell descriptor family.

The correct production path is:

```text
Type28 selectionValue
-> method17 shellDescriptor
-> version-matched shell catalog
-> user-facing shell name/type
```

Do **not** hardcode:

```text
wire value 0 == first UI shell
wire value 1 == second UI shell
wire value 2 == third UI shell
```

without descriptor-level closure for that vehicle/version.

For FV215b, current gameplay shell families are AP / APCR / HE-family. Replay ballistics independently identify the 1440.72 m/s family as the high-velocity APCR selection, while the two 1152.36 m/s selections require descriptor/damage behavior to distinguish AP from HE-family.

## Verdict

> Type28 = **recorder ammunition selection state — PROVEN current Blitz 11.19 behavioral identity**.

Proven facts:

```text
payload codec     : u32 LE
observed domain   : {0,1,2}
recorder-local    : yes
own-shot closure  : 324 unique shotIds == 324 settlement shots
ballistic closure : stable selectionValue -> projectile velocity family
```

Still version-scoped / not globally safe:

```text
selectionValue -> UI slot number
selectionValue -> exact shell name/type without method17/catalog join
```

## Safe event model

```text
AmmunitionSelectionChanged {
    rawClockSec
    selectionValue : u32
}
```

When associating a shot:

```text
selection = latest Type28 value in the same arena at launchClock
```

If no Type28 value exists yet in that arena, preserve `selection = UNKNOWN`.

## Important negative conclusion

Type28 must not be labeled as target lock, auto-aim, target lost, sniper mode or another historical PC control-state enum. That interpretation is SUPERSEDED.
