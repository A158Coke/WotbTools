# Arena wrapper7 `AVATAR_READY` and wrapper16 observation-state research

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas plus one independent T-100 LT replay sample.
>
> Historical numeric names are accepted only when current wire shape and replay behavior independently agree.

## wrapper7 — vehicle/avatar-ready notification

Current subtype48 wrapper7:

```text
root field7
  -> child field1 = entity / vehicle ID
```

Across the canonical 34 arenas all 14 settled combatant entity IDs are present in wrapper7 in 34/34 arenas; extra IDs are observer/non-combatant entities.

Verdict:

> wrapper7 = **vehicle/avatar-ready lifecycle notification — PROVEN behavioral family**.
>
> child field1 = **vehicle/entity ID — PROVEN**.

# wrapper16 — own-team observation-state broadcast family

Current shape:

```text
root field15
  child field1 = entity / vehicle ID
  child field2 = 1
  child field3 = state/event code
```

Canonical 34-arena counts:

```text
records total : 741
field3 = 1    : 718
field3 = 8    :  23
```

All current wrapper16 targets belong to the recorder's team. The two observed branches correspond to ordinary observed-by-enemy state and a special forced-observation state.

# field3=1 — ordinary observed-by-enemy entry/re-entry

Canonical corpus:

```text
field3=1 records                       : 718
recorder-team targets                  : 718 / 718
enemy targets                          :   0 / 718
```

For the recorder vehicle, Avatar method19 `code=1` is the local companion surface:

```text
method19 code1 records                       : 89
vehicleId == recorder vehicle                : 89 / 89
intArg resolves an enemy entity              : 89 / 89
followed by wrapper16 state1 same vehicle    : 89 / 89
```

Delay:

```text
~0.06 .. 0.14 s
median ~0.100 s
```

This proves that method19 code1 and wrapper16 field3=1 are two surfaces of the same observation-state family:

```text
method19 code1
  -> recorder-local observed-by-enemy notification
     including an associated enemy entity

wrapper16 state1
  -> own-team ordinary observed-by-enemy broadcast
```

## 10-second re-trigger boundary

The canonical corpus contains hundreds of repeated state1 events for the same allied target.

For repeated same-target state1 intervals:

```text
no repeat inside the ordinary ~10-second spotting-persistence window
```

The independent T-100 LT replay contains an especially clean natural sample for the recorder vehicle:

```text
method19 code1:
129.610 -> enemy E
139.728 -> same enemy E
Delta ~= 10.118 s

wrapper16 state1:
129.716
139.817
Delta ~= 10.101 s
```

This strongly supports state1 as an **entry/re-entry transition/event**, not a periodic heartbeat or persistent boolean packet.

Safe behavioral state machine:

```text
UNOBSERVED
  -> enemy observation begins
  -> state1 emitted
  -> ordinary visible/persistence window
  -> observation expires
  -> later observation can emit state1 again
```

Verdict:

> wrapper16 `field3=1` = **ordinary observed-by-enemy entry/re-entry event — PROVEN behavioral identity**.

# Avatar method19 code1 direction — enemy observes recorder

A major ambiguity was whether:

```text
vehicleId = recorder
intArg    = enemy
```

meant recorder-observes-enemy or enemy-observes-recorder.

Current negative controls close the direction.

In canonical samples, method19 code1 can reference an enemy that has not yet materialized into the recorder's observed Type33/Type5 entity set. Therefore code1 cannot require the recorder to currently see that enemy.

The opposite direction remains physically consistent:

```text
enemy exists server-side
-> enemy can observe recorder
-> recorder receives observed-by-enemy notification
-> recorder may still not observe that enemy
```

Combined with the numeric/symbolic Wargaming status family containing `IS_OBSERVED_BY_ENEMY = 1`:

> Avatar method19 `code=1` = **recorder vehicle observed by enemy — PROVEN behavioral identity + strong symbolic closure**.

The `intArg` enemy is safely preserved as an associated observer/source entity; exact server wording such as original spotter vs current observer remains version-gated.

# field3=8 — Tracer Shell / forced-observation state

## Rhm. Pzw. current-corpus closure

All 23 canonical state8 records occur in two arenas containing an enemy Rhm. Pzw. (`tankId=28689`). Five other arenas contain a friendly Rhm. Pzw. and produce zero state8 records.

Across the two enemy-Rhm arenas:

```text
valid Rhm hit where target survives             : 23
same-victim wrapper16 state8 within ~0.15 s     : 23 / 23

lethal Rhm hit                                  : 2
state8 on terminal target                       : 0 / 2
```

The triggering set includes hit-result families that do not necessarily produce HP loss. Therefore the precise behavioral wording is **valid hit-applied**, not `HP-damage hit-applied`.

Verdict:

> field3=8 = **enemy special forced-observation effect applied by a valid Rhm. Pzw. hit to a surviving recorder-team target — PROVEN behavioral identity**.

## Recipient-side direction proven by T-100 LT shooter POV

A separate Blitz 11.19 T-100 LT replay was added after the canonical corpus.

Recorder:

```text
vehicle = T-100 LT
tankId  = 24321
```

The recorder produces 10 observed method8 hits against enemy vehicles, but the replay contains:

```text
wrapper16 state8 = 0
```

This is not a contradiction. Instead it proves the direction of the surface:

```text
state8 is not shooter-side:
  "my Tracer Shell hit an enemy"

state8 is recipient/team-side:
  "a vehicle on my team has received the enemy forced-observation effect"
```

The recorder does not receive the enemy team's team-state broadcast after applying its own Tracer Shell effect.

Verdict:

> wrapper16 state8 = **recipient-side / recorder-team forced-observation broadcast — PROVEN directionality**.

## Tracer Shell exact identity

Current gameplay behavior aligns strongly with the Tracer Shell mechanic:

```text
valid hit
-> surviving target receives extended forced visibility
-> repeated valid hits can re-apply/refresh the state
```

Rhm. Pzw. supplies the current recipient-side natural closure. T-100 LT supplies an independent shooter-side negative control proving that wrapper16 is not a shooter acknowledgement.

Evidence grading:

```text
field3=8 behavioral forced-observation family      : PROVEN
recipient-side/team-side direction                 : PROVEN
Rhm valid-hit producer closure                     : PROVEN
exact internal Tracer Shell enum/symbol            : VERY STRONG PARTIAL
```

One ideal remaining natural sample would be:

```text
recorder is not T-100 LT
enemy T-100 LT hits a surviving recorder-team vehicle
-> same victim emits state8
```

That would provide the cross-vehicle recipient-side closure for the exact Tracer Shell identity.

# Unified observation model

Current safest model:

```text
wrapper16 observation-state family
|
|-- field3=1
|   ordinary observed-by-enemy entry/re-entry
|   paired with recorder-local method19 code1
|
`-- field3=8
    special forced-observation / Tracer-Shell-compatible state
    recipient-side team broadcast
```

Do not collapse these into one generic `visible` flag. They have different trigger semantics and gameplay persistence rules.

# Product implications

- Battle Playback can represent ordinary `observed-by-enemy` onset separately from enemy-visibility/AoI Type4/Type5 lifecycle.
- AI Review can distinguish normal spotting from an enemy-applied forced-spot effect.
- state8 must use a producer-agnostic semantic such as `FORCED_OBSERVATION_STATE`; do not hard-code `RHM_ONLY`.
- method19 code1's enemy entity can be preserved as observation-source evidence without claiming it is necessarily the only/current spotter.

# Remaining work

1. obtain an enemy-T-100-LT recipient-side state8 natural sample if available;
2. recover a current-version Blitz enum/schema for the exact state8 symbolic name;
3. keep normal observed-by-enemy events distinct from Type4/Type33/Type5 recorder-POV enemy visibility lifecycle;
4. validate the same model on random battles/future versions before widening the version gate.
