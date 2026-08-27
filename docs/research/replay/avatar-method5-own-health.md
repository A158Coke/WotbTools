# Avatar method5 — recorder own-health mirror

> Corpus: 34 unique-arena Blitz 11.19.0 China replays.
>
> Scope: current Avatar-targeted 3-byte method5 variant only. Method IDs are class/version scoped; the rare 18-byte method5 variant targets a different entity family and is not decoded here.

## Verdict

Current Avatar method5 3-byte variant is a **PROVEN recorder-own-vehicle health mirror/update surface**.

Wire body:

```text
currentHp : u16 LE
flag      : u8
```

Observed current-corpus facts:

```text
3-byte Avatar method5 events : 298
flag                          : 1 in 298/298
source replays                : 34/34
```

Each replay has one initialization method5 value before the first recorder Type7 vehicle `prop3` HP update, followed by method5 updates that mirror recorder `prop3` exactly.

## Recorder vehicle identity

Recorder vehicle entity ID was inferred independently from Avatar method13 gun-cycle records, whose first `u32` consistently identifies the recorder vehicle in the current corpus.

This avoids selecting a shooter from the global projectile stream, because method29 contains launches for many combatants.

## Exact Type7 prop3 closure

Across the corpus:

```text
method5 3-byte events                  : 298
initialization events without prop3    :  34
non-initial events with same-clock p3  : 264
same-clock method5 HP == prop3 HP      : 264 / 264
```

No value mismatch was found.

Examples:

```text
SPHT:
method5 init         = 3570
then                 = 3149 -> 2765 -> 2340 -> 1840 -> 1467
same-clock prop3     = 3149 -> 2765 -> 2340 -> 1840 -> 1467

FV215b:
method5 init         = 2664
then                 = 2226 -> 1774 -> 1219 -> 719 -> 312 -> 0
same-clock prop3     = 2226 -> 1774 -> 1219 -> 719 -> 312 -> 0
```

The initialization value is especially useful because vehicle `prop3` commonly does not appear until the recorder first receives an HP update/damage event.

## Safe semantic model

```text
OwnVehicleHealthUpdate {
    currentHp : u16
    flagRaw   : u8   // observed 1 in current Avatar variant
}
```

Safe production uses:

- seed recorder current HP at replay initialization;
- maintain recorder HP timeline independently of later vehicle `prop3` updates;
- cross-check `prop3` for corruption/version drift;
- avoid showing an unknown/striped opening HP state for the recorder when method5 is present.

## Entity-class collision

Three method5 events in the 34-arena corpus have 18-byte arguments instead of 3 bytes. They are not part of the Avatar own-health schema and must not be decoded as `u16 HP + flag`.

Therefore dispatch remains:

```text
(clientVersion, targetEntityClass, methodId)
```

not `methodId` alone.

## Confidence

- 3-byte current Avatar method5 structure: **PROVEN**
- `u16 = recorder current HP`: **PROVEN**
- initialization value as opening current HP: **PROVEN current corpus**
- trailing `u8` exact symbolic meaning: **UNKNOWN**; preserve raw
