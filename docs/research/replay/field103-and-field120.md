# Settlement field103 identity and field120 persistent-state probe

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> This note records one correction caused by a manual vehicle-name lookup mistake and one new unresolved settlement-field discriminator.

## PlayerResults field103 — vehicle/tank descriptor identity

`PlayerResultsInfo.field103` is the battle vehicle/tank descriptor ID.

For every replay author in the canonical 34-arena corpus:

```text
battle_results root8 author.field103
    == meta.json.vehicleCompDescriptor

34 / 34 exact
```

Observed author vehicle identities:

```text
meta playerVehicleName     descriptor / field103   arenas
A178_SPHT                   29985                   23
Maus                         6929                    5
GB13_FV215b                  6225                    3
J20_Ho_Ri_type3              3937                    2
VK7201                      58641                    1
```

The current repository BlitzKit tankopedia independently confirms, among others:

```text
6225 = FV215b
3937 = Ho-Ri
6929 = Maus
```

An independent Blitz replay parser also describes protobuf tag 103 as the player's `tank_id` as used by Wargaming APIs.

### Important correction

A previous live research comment incorrectly interpreted `6225` as **FV215b 183**. That was a manual model-name lookup error.

Current authoritative distinction:

```text
6225 = FV215b
9297 = FV215b 183
```

No replay in the canonical 34-arena corpus uses FV215b 183 as the replay author's vehicle.

This correction does **not** invalidate field103 itself; it strengthens the rule that numeric IDs must be resolved through a version-matched tank catalog rather than guessed from similar vehicle names.

Verdict:

> PlayerResults field103 = **vehicle/tank descriptor ID — PROVEN**.
>
> For current Blitz data, the observed values directly match the tank IDs used by the project/BlitzKit catalog; no additional conversion formula is supported or required by this corpus.

## Consequence for Avatar method3 vehicle grouping

Avatar method3 occurs in exactly five canonical arenas. After correcting the vehicle lookup, those five recorder vehicles are:

```text
FV215b : 3 arenas
Ho-Ri  : 2 arenas
```

They are **not** FV215b 183 + Ho-Ri and therefore are not a two-TD-only sample.

Method3 remains:

```text
92 RPCs
fixed 2-byte body
73 00 : 83
73 01 :  9
```

Two wire interpretations remain possible and must both stay open:

```text
u8 code 0x73 + u8 state 0/1
```

or

```text
u16 LE packed/state value = 0x0073 / 0x0173
```

The corpus does not yet prove the field boundary.

The five arenas share one initial `73 01` occurrence in the early prebattle/setup window followed by `73 00`; additional `73 01` records occur only in the two Ho-Ri arenas. Later `73 00` records frequently occur around shot/aim/ammunition activity, but not with a one-to-one relation sufficient to name the method as auto-aim, gun lock, consumable state, reload state or another mechanic.

Verdict remains **PARTIAL**.

## PlayerResults field120 — persistent player×tank state candidate

Current full settled-player distribution across the canonical 34 arenas:

```text
settled combatants : 476

field120 = 0 : 371
field120 = 1 :   3
field120 = 2 :   4
field120 = 3 :  98
```

The strongest discriminator is persistence by `(account/player, tankId)` across repeated tournament battles.

Examples:

```text
Chisato_Nshiki + A178_SPHT : field120=3 in 16 / 16 samples
QingYi_        + Kranvagn  : field120=3 in  9 /  9
CHRD-A158布丁  + FV215b    : field120=1 in  3 /  3
WannsiNn.      + tank28689 : field120=2 in  3 /  3
```

Many other repeated player×tank pairs remain consistently zero.

This strongly argues against an ordinary event counter that is generated independently by each battle.

### Not the participant/vehicle rank field

Root201 PlayerInfo field9 carries much larger participant/rank-like values such as:

```text
30, 32, 38, 42, 44, 46, 50
```

while field120 is limited to `0..3` in this corpus. There is no direct equality relation.

Therefore:

> field120 != root201 participant/rank field9.

### Not a mastery badge earned in the current battle

A tempting candidate is the common Blitz/Wargaming `mark_of_mastery` enum:

```text
0 None
1 3rd Class
2 2nd Class
3 1st Class
4 Ace Tanker
```

The numeric domain is compatible with the observed 0..3 values. However field120 does **not** behave like a mastery result earned by the current battle.

Current settlement XP (`field23`) grouped by field120:

```text
field120=0 : n=371, median XP=869,   range 237..2753
field120=1 : n=3,   median XP=875,   range 567..1077
field120=2 : n=4,   median XP=1256.5, range 797..2045
field120=3 : n=98,  median XP=853.5, range 210..1694
```

In particular, field120=3 occurs on battles with XP as low as 210 and remains stable across repeated player×tank pairs despite widely varying battle performance.

Therefore:

> field120 is **not** safely interpretable as "mastery badge earned in this battle".

### Persistent `mark_of_mastery` profile value remains a candidate

The Wargaming Blitz tank-stat API exposes a persistent per-player/per-tank `mark_of_mastery` value using the same 0..4 enum. That shape is compatible with the observed player×tank persistence.

But the current corpus has no independent China-account API snapshot or current Blitz protobuf schema tying tag 120 specifically to that API field.

So the safe status is:

```text
field120 = persistent player×tank profile/state enum — STRONG PARTIAL
persistent mark_of_mastery snapshot                 — candidate only
current-battle mastery award                         — REJECTED
```

No user-facing mastery label should be implemented until field-level closure is obtained.

## Next validation targets

1. obtain a version-matched schema or parser that explicitly assigns protobuf tag 120;
2. compare field120 against a player/tank API snapshot where `mark_of_mastery` is known;
3. seek a sample with known Ace Tanker (`mark_of_mastery=4`) and test whether field120 can take value 4;
4. continue Avatar method3 controlled contrasts between FV215b and Ho-Ri with shot, aiming, gun-lock and mechanic state windows.
