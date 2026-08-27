# Type28 — recorder ammunition slot / selection index

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> This semantic identity is derived from current China Blitz mobile replay data only. It does not depend on the historical PC target-lock callback path; that hypothesis is retained separately as SUPERSEDED.

## Wire shape

Current Type28:

```text
payload : u32 LE slotIndex
```

Canonical corpus:

```text
arenas with Type28 : 33 / 34
records            : 320
observed values    : 0, 1, 2
```

The value changes recurrently during battle and behaves like the recorder's current ammunition selection state.

## Step 1 — identify the recorder vehicle independently

Avatar property9 has already been proven as a recorder-local mirror of the recorder vehicle's Type7 property2 turret-relative yaw.

For each replay, exactly one Vehicle entity produces the near-identity property2 ↔ Avatar-property9 relationship. That entity is used as the recorder vehicle for the joins below.

This avoids assuming that all Avatar method29 projectile launches belong to the recorder; method29 is a global projectile feed.

## Step 2 — isolate recorder-owned projectile launches

Filter Avatar method29 to:

```text
method29.shooterId == recorderVehicleEntity
```

Current result:

```text
method29 recorder-owned RPC records : 326
unique (replay, shotId)             : 324
settlement recorder shots fired     : 324
```

The two extra RPC records are duplicate/repeated delivery observations; the semantic unique-shot count closes exactly against settlement.

Therefore the resulting 324 shot IDs are a strongly validated recorder-owned shot population.

## Step 3 — Type28 splits own shots into stable ammunition/velocity families

For each recorder-owned method29 shot, carry forward the current Type28 value and inspect the independently proven method29 projectile launch-velocity magnitude.

Observed current-corpus families:

```text
vehicle 3937  Ho-Ri
  slot 0 : 11 shots, velocity ≈ 972
  slot 1 :  2 shots, velocity ≈ 1026

vehicle 6225  FV215b
  slot 0 : 55 shots, velocity ≈ 1152.36
  slot 1 :  1 shot,  velocity ≈ 1440.72
  slot 2 :  3 shots, velocity ≈ 1152.36

vehicle 6929  Maus
  slot 0 : 54 shots, velocity ≈ 680
  slot 1 :  5 shots, velocity ≈ 1032

vehicle 29985 A178_SPHT
  slot 0 : 188 shots, velocity ≈ 760
  slot 1 :   6 shots, velocity ≈ 560
  slot 2 :   1 shot,  velocity ≈ 560

vehicle 58641 VK 72.01
  slot 0 : 13 shots, velocity ≈ 600
  slot 1 :  2 shots, velocity ≈ 552
```

Within a vehicle, Type28 selection state therefore partitions the recorder's shots into discrete ballistic families rather than camera/target-lock states.

## Step 4 — independent closure with Avatar method17 ammunition descriptors

Avatar method17 is independently proven as recorder ammunition state. Its current 12-byte body includes:

```text
shellDescriptor : u32 LE at body[0..4]
quantity        : least-byte quantity field in current schema
```

Join recorder-owned method29 shots to same-clock method17 ammunition-state records.

Stable Type28 slot → descriptor relationships are observed:

```text
A178_SPHT 29985
  slot 0 -> 139733514
  slot 1 -> 139799050
  slot 2 -> 139864586

Maus 6929
  slot 0 -> 4628490
  slot 1 -> 4694026

Ho-Ri 3937
  slot 0 -> 5595146
  slot 1 -> 5660682

VK 72.01 58641
  slot 0 -> 1002954
  slot 1 -> 1068490
```

In each of those vehicles, adjacent slot descriptors differ by:

```text
0x00010000
```

which is exactly the shape expected from discrete ammunition entries within one vehicle/gun descriptor namespace.

FV215b likewise shows stable slot-linked descriptors, with slot2 occasionally resolving to another descriptor after ammunition-state changes/exhaustion. That is compatible with selection/fallback behavior and is not compatible with a PC target-lock state interpretation.

## Verdict

> Type28 = **recorder current ammunition slot / selection index — PROVEN for the current Blitz 11.19 China mobile corpus**.

Proven facts:

```text
payload type      : u32 LE
observed domain   : {0,1,2}
recorder-local    : yes
semantic family   : ammunition selection
own-shot closure  : 324 unique method29 shotIds == 324 settlement shots
method17 closure  : stable slot ↔ shell descriptor families
ballistic closure : stable slot ↔ projectile velocity families per vehicle
```

The exact UI numbering convention is version/client scoped. Do not assume every future vehicle exposes exactly three slots or that all indices are populated.

## Safe event model

```text
AmmunitionSlotChanged {
    rawClockSec
    slotIndex : u32
}
```

Safe production uses include:

- reconstruct the recorder's selected ammunition slot over time;
- associate own shots with ammunition selection;
- cross-check method17 shell descriptors and ammunition quantity;
- improve AI Review analysis of ammunition choice;
- battle playback/UI reconstruction.

## Important negative conclusion

Type28 must not be labeled as target lock, auto-aim, target lost, sniper mode, or another PC control-state enum. That interpretation was a historical numeric coincidence and is explicitly SUPERSEDED.
